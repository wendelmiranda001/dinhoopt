using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Channels;

namespace DiNho.Capture.Poc.Encoders;

public sealed class FfmpegAacEncoder : IDisposable
{
    private Process? _process;
    private Stream? _stdin;
    private Stream? _stdout;
    private readonly Channel<EncodedPacket> _outputChannel =
        Channel.CreateBounded<EncodedPacket>(new BoundedChannelOptions(4096)
        {
            FullMode = BoundedChannelFullMode.DropWrite
        });

    private int _sampleRate;
    private int _channels;
    private bool _initialized, _disposed;
    private volatile bool _isHealthy = true;
    private Thread? _readerThread;
    private CancellationTokenSource? _readerCts;
    private long _outputFrameIndex;
    private byte[]? _pcmBuf;
    private long _pcmBytesWritten;
    private long _pcmBatchesWritten;
    private int _pcmWriteErrors;
    private int _totalAacFrames;
    private volatile int _droppedFrameCount;
    private volatile bool _flushing;
    private readonly Lock _writeLock = new();

    // Timeout de escrita no stdin: warm-up (encoder ainda não produziu batches)
    // usa timeout generoso para o ffmpeg abrir; estado estável usa timeout estrito
    // de proteção contra travas — espelha o padrão do FfmpegEncoder (vídeo).
    internal const int StdinWriteWarmupTimeoutMs = 5000;
    internal const int StdinWriteTimeoutMs = 250;

    /// <summary>0 = auto (warmup/steady); &gt;0 = fixo (usado pelos testes).</summary>
    private int _writeTimeoutMs;

    internal static int ComputeAacWriteTimeout(long batchesWritten) =>
        batchesWritten == 0 ? StdinWriteWarmupTimeoutMs : StdinWriteTimeoutMs;

    /// <summary>
    /// Classifica o fechamento do stdout do ffmpeg AAC (ReaderLoop, read == 0).
    /// exitCode == 0 = shutdown limpo (stopCapture intencional fecha o stdin → EOF → ffmpeg sai com 0).
    /// Não é falha: não deve logar Error nem marcar UNHEALTHY (evita falso-positivo de log/telemetria).
    /// Qualquer outro exit (crash, kill, erro do ffmpeg) = falha real — Error + UNHEALTHY (fail-closed,
    /// consistente com a política do projeto para checagens de processo).
    /// </summary>
    internal static (bool LogAsError, bool MarkUnhealthy) ClassifyStdoutClosed(int exitCode) =>
        exitCode == 0 ? (LogAsError: false, MarkUnhealthy: false) : (LogAsError: true, MarkUnhealthy: true);

    /// <summary>
    /// Seam de teste — injeta o stdin (e um timeout de escrita fixo) sem spawnar
    /// um processo ffmpeg real. Não inicia o ReaderLoop nem cria o processo;
    /// apenas exercita EncodeAudio/Dispose contra o Stream injetado.
    /// </summary>
    internal FfmpegAacEncoder(Stream stdin, int writeTimeoutMs = 100)
    {
        _stdin = stdin;
        _sampleRate = 48000;
        _channels = 2;
        _writeTimeoutMs = writeTimeoutMs;
        _initialized = true;
    }

    public FfmpegAacEncoder()
    {
    }

    public void Initialize(int sampleRate, int channels, int bitrate = 128000)
    {
        _sampleRate = sampleRate;
        _channels = channels;

        _process = new Process
        {
            StartInfo = FfmpegPathResolver.CreateFfmpegStartInfo(
                args: $"-y -loglevel warning " +
                $"-f f32le -ar {sampleRate} -ac {channels} -i pipe:0 " +
                $"-c:a aac -b:a {bitrate} -f adts pipe:1",
                redirectInput: true,
                redirectOutput: true,
                redirectError: true)
        };
        _process.Start();
        try { _process.PriorityClass = ProcessPriorityClass.BelowNormal; } catch { }

        // Read stderr asynchronously to prevent pipe deadlock
        int stderrCount = 0;
        _process.BeginErrorReadLine();
        _process.ErrorDataReceived += (_, e) =>
        {
            if (string.IsNullOrEmpty(e.Data)) return;
            // Log first 20 stderr lines at Error level to capture WHY ffmpeg dies
            // After that, only log every 500th to avoid flood
            int count = Interlocked.Increment(ref stderrCount);
            if (count <= 20 || count % 500 == 0)
                Log.E("ffmpeg-aac-stderr", $"[{count}] {e.Data}");
        };

        _stdin = _process.StandardInput.BaseStream;
        _stdout = _process.StandardOutput.BaseStream;

        Log.I("FfmpegAacEncoder", $"Initialized (ffmpeg PID={_process.Id})");

        _readerCts = new CancellationTokenSource();
        _readerThread = new Thread(() => ReaderLoop(_readerCts.Token))
        {
            IsBackground = true,
            Name = "AacReader"
        };
        _readerThread.Start();
        _initialized = true;
    }

    public void EncodeAudio(float[] pcmSamples)
    {
        if (!_initialized || _disposed || _flushing || !_isHealthy) return;

        // Detect ffmpeg process death immediately — avoids wasting write attempts
        if (_process is { HasExited: true })
        {
            _isHealthy = false;
            Log.E("FfmpegAacEncoder", $"ffmpeg process exited (code={_process.ExitCode}) after {_pcmBytesWritten} bytes — encoder UNHEALTHY");
            return;
        }

        // Sanitize NaN/Inf + clamp to [-1,1] — FFmpeg AAC encoder crashes on NaN input
        // and MDCT can overflow on extreme values. This is the single sanitization gate.
        int badCount = 0;
        for (int i = 0; i < pcmSamples.Length; i++)
        {
            float v = pcmSamples[i];
            if (float.IsNaN(v) || float.IsInfinity(v))
            {
                pcmSamples[i] = 0f;
                badCount++;
            }
            else if (v > 1.0f)
            {
                pcmSamples[i] = 1.0f;
                badCount++;
            }
            else if (v < -1.0f)
            {
                pcmSamples[i] = -1.0f;
                badCount++;
            }
        }
        if (badCount > 0 && _pcmWriteErrors <= 3)
            Log.W("FfmpegAacEncoder", $"Sanitized {badCount} samples (NaN/Inf/clamp) in PCM buffer");

        int byteLen = pcmSamples.Length * 4;

        // EncodeAudio pode ser chamado por 2 threads WASAPI (loopback + mic) quando o
        // mic está ativo. O lock serializa o buffer compartilhado (_pcmBuf) E a escrita
        // no stdin — sem isso, batches corrompidos chegavam ao ffmpeg (race).
        lock (_writeLock)
        {
            if (_pcmBuf == null || _pcmBuf.Length < byteLen)
                _pcmBuf = new byte[byteLen * 2];

            System.Buffer.BlockCopy(pcmSamples, 0, _pcmBuf, 0, byteLen);

            // Timeout de escrita: warm-up (primeiro batch) usa timeout generoso para o
            // ffmpeg abrir; estado estável usa timeout estrito — um pipe preso marca
            // UNHEALTHY e não trava mais a thread WASAPI (auto-recovery do engine).
            long batch = _pcmBatchesWritten++;
            int timeoutMs = _writeTimeoutMs > 0 ? _writeTimeoutMs : ComputeAacWriteTimeout(batch);
            var result = FfmpegEncoder.TryWriteStdin(_stdin!, _pcmBuf, 0, byteLen, timeoutMs, out var fault);

            switch (result)
            {
                case FfmpegEncoder.StdinWriteResult.Ok:
                    _stdin!.Flush();
                    _pcmBytesWritten += byteLen;
                    break;
                case FfmpegEncoder.StdinWriteResult.Timeout:
                    _pcmWriteErrors++;
                    _isHealthy = false;
                    Log.E("FfmpegAacEncoder",
                        $"PCM write TIMEOUT after {timeoutMs}ms (batch #{batch}, {byteLen} bytes, totalWrote={_pcmBytesWritten}) — encoder UNHEALTHY (ffmpeg pipe preso)");
                    break;
                default:
                    _pcmWriteErrors++;
                    if (_pcmWriteErrors <= 3 || _pcmWriteErrors % 500 == 0)
                        Log.E("FfmpegAacEncoder", $"PCM write #{_pcmWriteErrors} failed ({byteLen} bytes, totalWrote={_pcmBytesWritten}): {fault?.GetType().Name}: {fault?.Message}");
                    if (fault is IOException)
                    {
                        _isHealthy = false;
                        Log.E("FfmpegAacEncoder", $"Pipe broken (IOException) — encoder UNHEALTHY after {_pcmWriteErrors} errors ({_pcmBytesWritten} bytes)");
                    }
                    else if (_pcmWriteErrors >= 10)
                    {
                        _isHealthy = false;
                        Log.E("FfmpegAacEncoder", $"Too many errors ({_pcmWriteErrors}) — encoder UNHEALTHY ({_pcmBytesWritten} bytes)");
                    }
                    break;
            }

            if (_pcmBuf.Length > byteLen * 4 && _pcmBuf.Length > 65536)
                Array.Resize(ref _pcmBuf, Math.Max(byteLen, 65536));
        }
    }

    public int TotalAacFrames => _totalAacFrames;
    public int DroppedFrameCount => _droppedFrameCount;
    public bool IsHealthy => _isHealthy && !_disposed;

    public EncodedPacket? TryReadPacket()
    {
        _outputChannel.Reader.TryRead(out var pkt);
        return pkt;
    }

    public void LogStats()
    {
        Log.I("FfmpegAacEncoder", $"STATS: pcmBytesWritten={_pcmBytesWritten} aacFrames={_totalAacFrames} pcmWriteErrors={_pcmWriteErrors}");
        int ch = _channels > 0 ? _channels : 2;
        long expectedAacFrames = _pcmBytesWritten / 4 / ch / 1024;
        if (_totalAacFrames > 0 && expectedAacFrames > 0 && _totalAacFrames < expectedAacFrames * 0.95)
            Log.W("FfmpegAacEncoder", $"AAC frames ({_totalAacFrames}) << expected ({expectedAacFrames}) — PCM data may be lost");
    }

    public int FlushAndDrain(List<EncodedPacket> outBuffer)
    {
        int count = 0;
        _flushing = true;
        try
        {
            _stdin?.Dispose();
            _readerThread?.Join(1000);
        }
        catch { }

        while (_outputChannel.Reader.TryRead(out var pkt))
        {
            outBuffer.Add(pkt);
            count++;
        }
        return count;
    }

    private void ReaderLoop(CancellationToken ct)
    {
        var buf = new byte[8192];
        int offset = 0;
        int totalReads = 0, totalFrames = 0;

        while (!ct.IsCancellationRequested)
        {
            int read;
            try { read = _stdout!.Read(buf, offset, buf.Length - offset); }
            catch (Exception ex)
            {
                Log.E("FfmpegAacEncoder", $"ReaderLoop: stdout read failed: {ex.Message} — encoder UNHEALTHY");
                _isHealthy = false;
                break;
            }

            if (read == 0)
            {
                int exitCode = -1;
                try { if (_process is { HasExited: true }) exitCode = _process.ExitCode; } catch { }
                var (logAsError, markUnhealthy) = ClassifyStdoutClosed(exitCode);
                if (logAsError)
                {
                    Log.E("FfmpegAacEncoder", $"ReaderLoop: stdout closed (reads={totalReads} frames={totalFrames} exitCode={exitCode}) — encoder UNHEALTHY");
                    _isHealthy = false;
                }
                else
                {
                    Log.D("FfmpegAacEncoder", $"ReaderLoop: stdout closed (reads={totalReads} frames={totalFrames} exitCode={exitCode}) — clean shutdown");
                }
                break;
            }

            totalReads++;
            int total = offset + read;
            int pos = 0;
            int framesInChunk = 0;

            while (pos + 7 < total)
            {
                if (buf[pos] != 0xFF || (buf[pos + 1] & 0xF0) != 0xF0)
                {
                    pos++;
                    continue;
                }

                int frameLen = ((buf[pos + 3] & 0x03) << 11)
                             | (buf[pos + 4] << 3)
                             | ((buf[pos + 5] >> 5) & 0x07);

                if (frameLen < 7 || pos + frameLen > total) break;

                var data = new byte[frameLen];
                System.Buffer.BlockCopy(buf, pos, data, 0, frameLen);

                long dur = 1024L * 10_000_000 / _sampleRate;
                long pts = _outputFrameIndex * dur;

                if (!_outputChannel.Writer.TryWrite(new EncodedPacket(
                        data, MediaType.Audio,
                        TimeSpan.FromTicks(pts), TimeSpan.FromTicks(dur),
                        false)))
                {
                    Interlocked.Increment(ref _droppedFrameCount);
                    Log.W("FfmpegAacEncoder", $"AAC frame dropped (channel full at {_outputFrameIndex}) — totalDrops={_droppedFrameCount}");
                }

                _outputFrameIndex++;
                framesInChunk++;
                pos += frameLen;
            }

            totalFrames += framesInChunk;
            _totalAacFrames = totalFrames;
            if (framesInChunk > 0 && totalFrames % 1000 == 0)
                Log.D("FfmpegAacEncoder", $"ReaderLoop: read={read} bytes framesInChunk={framesInChunk} totalFrames={totalFrames}");

            offset = total - pos;
            if (offset > 0 && pos < total)
                System.Buffer.BlockCopy(buf, pos, buf, 0, offset);
            else
                offset = 0;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _isHealthy = false;
        _readerCts?.Cancel();
        try { _stdin?.Dispose(); } catch { }
        if (_process is { HasExited: false })
        {
            try { _process.Kill(entireProcessTree: true); } catch { }
            _process.WaitForExit(2000);
        }
        _readerThread?.Join(1000);
        // Drain output channel — return ArrayPool buffers to avoid pool pressure
        while (_outputChannel.Reader.TryRead(out var pkt))
            pkt.Release();
        _readerCts?.Dispose();
        _process?.Dispose();
    }
}
