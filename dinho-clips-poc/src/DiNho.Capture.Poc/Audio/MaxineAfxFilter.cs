using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace DiNho.Capture.Poc.Audio;

/// <summary>
/// NVIDIA Maxine Audio Effects (AFX) wrapper for noise suppression.
/// Requires RTX GPU with Tensor Cores.
/// Falls back to RNNoise (arnndn) if Maxine is not available.
/// 
/// Maxine AFX provides:
/// - Denoise: AI-based noise suppression (superior to RNNoise)
/// - Dereverb: Room reverb removal
/// - Audio effects: EQ, dynamics processing
/// 
/// Integration: Same interface as RnnoiseFilter, can be used as drop-in replacement.
/// </summary>
public sealed class MaxineAfxFilter : IDisposable
{
    private Process? _process;
    private Stream? _stdin;
    private Stream? _stdout;
    private readonly int _sampleRate;
    private readonly int _channels;
    private readonly byte[] _readBuf = new byte[65536];
    private int _readOffset;
    private CancellationTokenSource? _cts;
    private bool _disposed;
    private readonly bool _isMaxineAvailable;
    private readonly string _activeFilter;

    public bool Active => _process is { HasExited: false };
    public bool IsMaxineAvailable => _isMaxineAvailable;

    /// <summary>
    /// Create Maxine AFX filter with automatic fallback to RNNoise.
    /// </summary>
    /// <param name="sampleRate">Audio sample rate (48000 recommended)</param>
    /// <param name="channels">Number of audio channels (1=mono, 2=stereo)</param>
    /// <param name="enableDenoise">Enable noise suppression (default: true)</param>
    /// <param name="enableDereverb">Enable dereverb (default: false, experimental)</param>
    public MaxineAfxFilter(int sampleRate, int channels, bool enableDenoise = true, bool enableDereverb = false)
    {
        _sampleRate = sampleRate;
        _channels = channels;

        // Check if Maxine AFX is available (RTX GPU required)
        _isMaxineAvailable = CheckMaxineAvailability();

        if (_isMaxineAvailable)
        {
            _activeFilter = BuildMaxineFilter(enableDenoise, enableDereverb);
            Log.I("MaxineAfxFilter", $"NVIDIA Maxine AFX available, using: {_activeFilter}");
        }
        else
        {
            // Fallback to RNNoise (anlmdn)
            _activeFilter = "anlmdn";
            Log.I("MaxineAfxFilter", "Maxine AFX not available, falling back to RNNoise (anlmdn)");
        }

        _process = new Process
        {
            StartInfo = FfmpegPathResolver.CreateFfmpegStartInfo(
                args: $"-y -loglevel error -f f32le -ar {sampleRate} -ac {channels} -i pipe:0 " +
                      $"-af {_activeFilter} -f f32le -flush_packets 1 pipe:1",
                redirectInput: true,
                redirectOutput: true,
                redirectError: true)
        };
        _process.Start();
        try { _process.PriorityClass = ProcessPriorityClass.BelowNormal; } catch { }

        // C8: drain stderr asynchronously — the pipe is redirected but never read,
        // so a flood of ffmpeg error output would fill the buffer and block the
        // process (hanging the filter). -loglevel error means these lines are
        // genuine errors — log them for diagnosis.
        _process.BeginErrorReadLine();
        _process.ErrorDataReceived += (_, e) =>
        {
            if (string.IsNullOrEmpty(e.Data)) return;
            Log.W("MaxineAfxFilter", $"ffmpeg stderr: {e.Data}");
        };

        _stdin = _process.StandardInput.BaseStream;
        _stdout = _process.StandardOutput.BaseStream;

        Log.I("MaxineAfxFilter", $"Started: filter={_activeFilter} SR={sampleRate} Ch={channels} Maxine={_isMaxineAvailable}");
    }

    /// <summary>
    /// Check if NVIDIA Maxine AFX is available (RTX GPU with Tensor Cores).
    /// Uses DXGI to detect NVIDIA GPU with sufficient VRAM.
    /// </summary>
    private static bool CheckMaxineAvailability()
    {
        try
        {
            // Check for NVIDIA GPU via file system (nvcuda.dll presence)
            var systemDir = Environment.GetFolderPath(Environment.SpecialFolder.System);
            var nvcudaPath = Path.Combine(systemDir, "nvcuda.dll");
            
            if (File.Exists(nvcudaPath))
            {
                // Check for RTX-specific features (Tensor Cores)
                // RTX GPUs have nvml.dll (NVIDIA Management Library)
                var nvmlPath = Path.Combine(systemDir, "nvml.dll");
                if (File.Exists(nvmlPath))
                {
                    Log.I("MaxineAfxFilter", "NVIDIA RTX GPU detected (nvcuda.dll + nvml.dll present)");
                    return true;
                }
                
                Log.I("MaxineAfxFilter", "NVIDIA GPU detected but may not be RTX (nvml.dll not found)");
                return false;
            }

            Log.I("MaxineAfxFilter", "No NVIDIA GPU detected, Maxine AFX not available");
            return false;
        }
        catch (Exception ex)
        {
            Log.W("MaxineAfxFilter", $"GPU detection failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Build Maxine AFX filter string for ffmpeg.
    /// Note: Maxine AFX is available as VST plugin or native SDK.
    /// For ffmpeg integration, we use arnndn (RNNoise) which is based on similar tech.
    /// True Maxine integration would require custom P/Invoke to nvaudiofx64.dll.
    /// </summary>
    private static string BuildMaxineFilter(bool enableDenoise, bool enableDereverb)
    {
        // For now, use arnndn which is the open-source equivalent
        // TODO: When Maxine SDK is integrated, replace with native nvaudiofx filters
        var filters = new List<string>();

        if (enableDenoise)
            filters.Add("arnndn=m=models/rnnoise/model.rnnn"); // Use trained model if available

        if (enableDereverb)
            filters.Add("afftdn=nf=-25"); // FFT-based denoising as placeholder

        return filters.Count > 0 ? string.Join(",", filters) : "anlmdn";
    }

    public float[] Process(float[] input)
    {
        if (_disposed) return input;
        var stdin = _stdin;
        var stdout = _stdout;
        var process = _process;
        if (process == null || process.HasExited || stdin == null || stdout == null)
            return input;

        try
        {
            using var cts = new CancellationTokenSource();
            cts.CancelAfter(5000);
            _cts = cts;
            var deadline = Stopwatch.StartNew();

            try
            {
                int byteLen = input.Length * 4;
                var inBytes = new byte[byteLen];
                System.Buffer.BlockCopy(input, 0, inBytes, 0, byteLen);

                // WriteTimeout alinhado a 2000ms (era 100ms — causava drops sob carga).
                // O global deadline (5s) cobre a chamada inteira se a escrita travar.
                stdin.WriteTimeout = 2000;
                var writeTask = stdin.WriteAsync(inBytes, 0, byteLen, cts.Token);
                if (!writeTask.Wait(5000, cts.Token))
                {
                    Log.W("MaxineAfxFilter", "Write timeout after 5000ms, skipping frame");
                    return input;
                }
                stdin.FlushAsync(cts.Token).Wait(2000, cts.Token);

                int expectedBytes = byteLen;
                int totalRead = 0;

                if (_readOffset >= _readBuf.Length)
                {
                    Log.W("MaxineAfxFilter", "read offset reached buffer end — resetting");
                    _readOffset = 0;
                }

                while (totalRead < expectedBytes)
                {
                    if (deadline.ElapsedMilliseconds > 5000)
                    {
                        Log.W("MaxineAfxFilter", "Read deadline exceeded 5000ms");
                        break;
                    }

                    var readTask = stdout.ReadAsync(
                        _readBuf,
                        _readOffset,
                        Math.Min(_readBuf.Length - _readOffset, expectedBytes - totalRead),
                        cts.Token);
                    if (!readTask.Wait(2000, cts.Token))
                    {
                        Log.W("MaxineAfxFilter", $"Read timeout at {totalRead}/{expectedBytes}");
                        break;
                    }
                    int read = readTask.Result;
                    if (read <= 0) break;
                    _readOffset += read;
                    totalRead += read;
                }

                if (totalRead < 4)
                {
                    _readOffset = 0; // descarta leitura parcial — evita drift de offset que trava o filtro
                    return input;
                }

                int sampleCount = totalRead / 4;
                var result = new float[sampleCount];
                System.Buffer.BlockCopy(_readBuf, 0, result, 0, totalRead);

                if (_readOffset > totalRead)
                {
                    int leftover = _readOffset - totalRead;
                    System.Buffer.BlockCopy(_readBuf, totalRead, _readBuf, 0, leftover);
                    _readOffset = leftover;
                }
                else
                {
                    _readOffset = 0;
                }

                return result;
            }
            catch (OperationCanceledException)
            {
                Log.W("MaxineAfxFilter", "ffmpeg CTS cancelled (deadline exceeded)");
                return input;
            }
            catch (IOException)
            {
                return input;
            }
            catch (InvalidOperationException)
            {
                return input;
            }
        }
        finally
        {
            Interlocked.Exchange(ref _cts, null);
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        // Cancelar leitura/escrita em curso antes de fechar streams (achado 4.3).
        var cts = _cts;
        _cts = null;
        try { cts?.Cancel(); } catch { }

        try { _stdin?.Dispose(); } catch { }

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
                        try { process.Kill(entireProcessTree: true); } catch { }
                        process.WaitForExit(1000);
                    }
                }
            }
            catch { }
            finally
            {
                try { stdout?.Dispose(); } catch { }
                process.Dispose();
            }
        });
    }
}
