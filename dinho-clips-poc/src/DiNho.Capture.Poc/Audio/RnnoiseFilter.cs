using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Logging;
using System.Diagnostics;

namespace DiNho.Capture.Poc.Audio;

/// <summary>
/// Optional PCM audio filter using ffmpeg's arnndn (RNNoise) or anlmdn.
/// Wraps a long-lived ffmpeg process; input/output via stdin/stdout as f32le.
/// Safe to call Process from any thread (stdin.Write + stdout.Read are thread-safe in practice).
/// </summary>
public sealed class RnnoiseFilter : IDisposable
{
    private Process? _process;
    private Stream? _stdin;
    private Stream? _stdout;
    private readonly int _sampleRate;
    private readonly int _channels;
    private readonly byte[] _readBuf = new byte[65536];
    private int _readOffset;
    private volatile bool _disposed;
    private readonly CancellationTokenSource _cts = new();

    public bool Active => _process is { HasExited: false };

    public RnnoiseFilter(int sampleRate, int channels, string? modelPath = null)
    {
        _sampleRate = sampleRate;
        _channels = channels;

        var filter = !string.IsNullOrEmpty(modelPath) && File.Exists(modelPath)
            ? $"arnndn=m={modelPath}"
            : "anlmdn";

        _process = new Process
        {
            StartInfo = FfmpegPathResolver.CreateFfmpegStartInfo(
                args: $"-y -loglevel error -f f32le -ar {sampleRate} -ac {channels} -i pipe:0 " +
                      $"-af {filter} -f f32le -flush_packets 1 pipe:1",
                redirectInput: true,
                redirectOutput: true,
                redirectError: true)
        };
        _process.Start();

        // C8: drain stderr asynchronously — the pipe is redirected but never read,
        // so a flood of ffmpeg error output would fill the buffer and block the
        // process (hanging the filter). -loglevel error means these lines are
        // genuine errors — log them for diagnosis.
        _process.BeginErrorReadLine();
        _process.ErrorDataReceived += (_, e) =>
        {
            if (string.IsNullOrEmpty(e.Data)) return;
            Log.W("RnnoiseFilter", $"ffmpeg stderr: {e.Data}");
        };

        _stdin = _process.StandardInput.BaseStream;
        _stdout = _process.StandardOutput.BaseStream;

        Log.I("RnnoiseFilter", $"Started: filter={filter} SR={sampleRate} Ch={channels}");
    }

    public float[] Process(float[] input)
    {
        if (_disposed) return input;
        var stdin = _stdin;
        var stdout = _stdout;
        var process = _process;
        if (process == null || process.HasExited || stdin == null || stdout == null)
            return input;

        int byteLen = input.Length * 4;
        var inBytes = new byte[byteLen];
        System.Buffer.BlockCopy(input, 0, inBytes, 0, byteLen);

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
        try
        {
            cts.CancelAfter(5000);

            var writeTask = stdin.WriteAsync(inBytes, 0, byteLen, cts.Token);
            if (!writeTask.Wait(5000))
            {
                Log.W("RnnoiseFilter", "Write timeout after 5000ms, skipping frame");
                return input;
            }
            // Async flush with 1s timeout — avoids blocking if ffmpeg stdin buffer is full
            var flushTask = stdin.FlushAsync(cts.Token);
            if (!flushTask.Wait(1000))
            {
                Log.W("RnnoiseFilter", "Flush timeout after 1000ms — ffmpeg may be stuck");
            }

            int expectedBytes = byteLen;

            // Leftover de chamadas anteriores (surplus de leituras que excederam o
            // frame) já está em _readBuf[0.._readOffset]. Só lê quando faltar dado
            // para completar um frame de saída de tamanho pleno.
            if (_readOffset < expectedBytes)
            {
                var sw = Stopwatch.StartNew();
                while (_readOffset < expectedBytes)
                {
                    if (sw.ElapsedMilliseconds > 5000 || cts.Token.IsCancellationRequested)
                    {
                        Log.W("RnnoiseFilter", "Read timeout after 5000ms while waiting for filtered audio — returning original frame");
                        break;
                    }
                    int free = _readBuf.Length - _readOffset;
                    if (free <= 0)
                        break; // buffer cheio de dados não consumidos — nada mais a ler
                    // Async read com timeout por chamada — impede bloqueio indefinido
                    var readTask = stdout.ReadAsync(_readBuf, _readOffset, free, cts.Token);
                    if (!readTask.Wait(2000))
                    {
                        Log.W("RnnoiseFilter", "ReadAsync timeout after 2000ms — returning original frame");
                        break;
                    }
                    int read = readTask.Result;
                    if (read <= 0)
                        break;
                    _readOffset += read;
                }
            }

            if (_readOffset < 4)
                return input;

            // Consome até expectedBytes (alinha ao tamanho do frame original). Em
            // timeout/EOF consome o que tiver; o surplus vira leftover para a próxima
            // chamada — a lógica antiga (`_readOffset > totalRead`) nunca disparava
            // porque totalRead era incrementado junto com _readOffset, então o excedente
            // de uma leitura maior que o frame ficava preso no pipe e corrompia o
            // alinhamento do stream na chamada seguinte.
            int consume = Math.Min(_readOffset, expectedBytes);
            int sampleCount = consume / 4;
            if (sampleCount == 0)
                return input;
            var result = new float[sampleCount];
            System.Buffer.BlockCopy(_readBuf, 0, result, 0, consume);

            int leftover = _readOffset - consume;
            if (leftover > 0)
                System.Buffer.BlockCopy(_readBuf, consume, _readBuf, 0, leftover);
            _readOffset = leftover;

            return result;
        }
        catch (OperationCanceledException)
        {
            Log.D("RnnoiseFilter", "Process: cancelled (timeout or disposed)");
            return input;
        }
        catch (IOException ex)
        {
            Log.D("RnnoiseFilter", $"Process: IO error: {ex.Message}");
            return input;
        }
        catch (InvalidOperationException ex)
        {
            Log.D("RnnoiseFilter", $"Process: invalid state: {ex.Message}");
            return input;
        }
        finally { cts.Dispose(); }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _cts.Cancel();
        _cts.Dispose();

        try { _stdin?.Dispose(); } catch (Exception ex) { Log.D("RnnoiseFilter", $"stdin dispose error: {ex.Message}"); }

        var process = _process;
        var stdout = _stdout;
        _stdin = null;
        _stdout = null;
        _process = null;

        if (process == null) return;

        _ = Task.Run(() =>
        {
            try
            {
                if (!process.HasExited)
                {
                    if (!process.WaitForExit(5000))
                    {
                        try { process.Kill(entireProcessTree: true); } catch (Exception ex) { Log.D("RnnoiseFilter", $"Kill error: {ex.Message}"); }
                        process.WaitForExit(1000);
                    }
                }
            }
            catch (Exception ex) { Log.D("RnnoiseFilter", $"Process stop error: {ex.Message}"); }
            finally
            {
                try { stdout?.Dispose(); } catch (Exception ex) { Log.D("RnnoiseFilter", $"stdout dispose error: {ex.Message}"); }
                process.Dispose();
            }
        });
    }
}
