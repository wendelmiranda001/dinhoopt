using System.Collections.Generic;
using System.Threading;
using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Encoders;

internal sealed partial class FfmpegEncoder
{
    /// <summary>
    /// O3 (fase 1): thread dedicada para escrever os frames NV12 no stdin do ffmpeg,
    /// desacoplando a thread de captura do encoder. Quando o encoder é mais lento que a
    /// captura (máquina fraca / codec pesado), o pipe enche e o write sincronizado antigo
    /// bloqueava o loop de captura até o timeout (200ms/wamrup) — frame drop visível.
    ///
    /// Com o writer em thread própria, a captura simplesmente ENFILEIRA o frame (nunca
    /// bloqueia; a fila é bounded com drop-oldest: o frame mais antigo enfileirado — nunca
    /// o em escrita — é sacrificado, "agora" vence, mesma filosofia do replay buffer).
    ///
    /// Contratos preservados do caminho síncrono:
    ///  - FIFO estrita: frames escritos na ordem de chegada; PTS enfileirado SOMENTE após
    ///    Write bem-sucedido, na mesma ordem → sync A/V intocado.
    ///  - Timeout/Fault do pipe → mesmo cause ("encoder:stdin_timeout"/"encoder:stdin_io_error")
    ///    via callbacks; o restart continua gateado pelo EncodeFrame.
    ///  - Abort (restart/dispose): frames enfileirados são devolvidos ao pool SEM write —
    ///    nenhum PTS órfão, nenhum byte no pipe morto (evita o déja vu do duplo write/pipeline antigo).
    ///  - Buffers NV12 pooled por frame (VideoPacketPool.Rent/Return) — o scratch único
    ///    `_nv12Scratch` não serve mais: o writer pode ainda estar escrevendo quando a
    ///    captura produz o próximo frame.
    /// </summary>
    internal sealed class FrameWriter : IDisposable
    {
        private readonly Func<System.IO.Stream?> _stdinProvider;
        private readonly Func<int> _writeTimeoutMs;
        private readonly Action<TimeSpan> _onWritten;
        private readonly Action<string, Exception?> _onWriteFailed;
        private readonly int _maxQueued;

        private readonly object _sync = new();
        private readonly Queue<Frame> _queue = new();
        private readonly Stack<Frame> _framePool = new();
        private bool _stop;
        private volatile bool _abort;
        private int _droppedOverflow;
        private readonly Thread _thread;

        private sealed class Frame
        {
            internal byte[]? Data;
            internal TimeSpan Pts;
        }

        internal FrameWriter(
            Func<System.IO.Stream?> stdin,
            Func<int> writeTimeoutMs,
            Action<TimeSpan> onWritten,
            Action<string, Exception?> onWriteFailed,
            int maxQueued = 8)
        {
            _stdinProvider = stdin ?? throw new ArgumentNullException(nameof(stdin));
            _writeTimeoutMs = writeTimeoutMs ?? throw new ArgumentNullException(nameof(writeTimeoutMs));
            _onWritten = onWritten ?? throw new ArgumentNullException(nameof(onWritten));
            _onWriteFailed = onWriteFailed ?? throw new ArgumentNullException(nameof(onWriteFailed));
            _maxQueued = Math.Max(1, maxQueued);
            _thread = new Thread(Loop) { IsBackground = true, Name = "FfmpegInput" };
            _thread.Start();
        }

        /// <summary>Frames atualmente enfileirados (aguardando escrita).</summary>
        internal int QueuedCount
        {
            get
            {
                lock (_sync) return _queue.Count;
            }
        }

        /// <summary>Frames sacrificados por drop-oldest (fila cheia).</summary>
        internal int DroppedOverflow => Volatile.Read(ref _droppedOverflow);

        /// <summary>
        /// Enfileira um frame NV12 (pooled) para escrita assíncrona no stdin.
        /// Retorna false se o writer já foi parado — o produtor devolve o buffer ao pool.
        /// Nunca bloqueia o chamador; se a fila estiver cheia, o frame enfileirado mais
        /// antigo é descartado (o buffer volta ao pool).
        /// </summary>
        internal bool TryEnqueue(byte[] nv12, TimeSpan pts)
        {
            lock (_sync)
            {
                if (_stop) return false;

                if (_queue.Count >= _maxQueued)
                {
                    ReturnFrame(_queue.Dequeue());
                    int drops = Interlocked.Increment(ref _droppedOverflow);
                    if (drops == 1 || drops % 100 == 0)
                        Log.W("FfmpegEncoder.FrameWriter", $"input queue overflow — {drops} queued frames dropped total (encoder slower than capture)");
                }

                var frame = _framePool.Count > 0 ? _framePool.Pop() : new Frame();
                frame.Data = nv12;
                frame.Pts = pts;
                _queue.Enqueue(frame);
                Monitor.Pulse(_sync);
                return true;
            }
        }

        /// <summary>
        /// Para o writer. <paramref name="abort"/>=true (restart/dispose): frames enfileirados
        /// são devolvidos ao pool SEM escrita. <paramref name="abort"/>=false (flush): drena a
        /// fila escrevendo tudo antes de sair — os frames pendentes do clip não são perdidos.
        /// </summary>
        internal void Stop(bool abort, int joinMs)
        {
            lock (_sync)
            {
                _abort = abort;
                _stop = true;
                Monitor.PulseAll(_sync);
            }
            if (_thread.IsAlive && Thread.CurrentThread != _thread)
                _thread.Join(joinMs);
            lock (_sync)
            {
                while (_queue.Count > 0)
                    ReturnFrame(_queue.Dequeue());
            }
        }

        public void Dispose() => Stop(abort: true, joinMs: 0);

        private void Loop()
        {
            while (true)
            {
                Frame? frame;
                lock (_sync)
                {
                    while (!_stop && _queue.Count == 0)
                        Monitor.Wait(_sync);
                    if (_queue.Count == 0)
                        break; // stopped e fila vazia
                    frame = _queue.Dequeue();
                }

                // Abort: descarta sem escrever (o pipe foi/está sendo morto).
                if (_abort)
                {
                    ReturnFrame(frame);
                    continue;
                }

                var stdin = _stdinProvider();
                var result = FfmpegEncoder.StdinWriteResult.Faulted;
                Exception? fault = stdin == null
                    ? new System.ObjectDisposedException("stdin")
                    : null;
                if (stdin != null)
                {
                    try
                    {
                        result = TryWriteStdin(stdin, frame.Data!, _writeTimeoutMs(), out fault);
                    }
                    catch (Exception ex) when (ex is IOException or System.ObjectDisposedException)
                    {
                        result = StdinWriteResult.Faulted;
                        fault = ex;
                    }
                }

                // Se um Abort aconteceu durante a escrita em voo, descarta silenciosamente —
                // o processo é outro agora; reportar falha causaria churn de restart.
                if (!_abort)
                {
                    switch (result)
                    {
                        case StdinWriteResult.Ok:
                            _onWritten(frame.Pts);
                            break;
                        case StdinWriteResult.Timeout:
                            _onWriteFailed("encoder:stdin_timeout", null);
                            break;
                        case StdinWriteResult.Faulted:
                            _onWriteFailed("encoder:stdin_io_error", fault);
                            break;
                    }
                }
                ReturnFrame(frame);
            }
        }

        private void ReturnFrame(Frame frame)
        {
            if (frame.Data != null)
            {
                VideoPacketPool.Return(frame.Data);
                frame.Data = null;
            }
            lock (_sync)
            {
                if (_framePool.Count < 512)
                    _framePool.Push(frame);
            }
        }
    }
}