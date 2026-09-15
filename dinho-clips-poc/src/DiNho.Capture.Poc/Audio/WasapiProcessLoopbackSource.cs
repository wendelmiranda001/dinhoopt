using DiNho.Capture.Poc.Logging;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace DiNho.Capture.Poc.Audio;

/// <summary>
/// Per-process loopback capture via NAudio 3 managed API (WasapiRecorder +
/// ActivateAudioInterfaceAsync/AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS).
/// Replaces the primary path previously owned by CppLoopbackSource (C++ DLL),
/// which remains as fallback for older systems or activation failures.
/// Requires Windows 10 build 19041+.
/// </summary>
public sealed class WasapiProcessLoopbackSource : IAudioSource
{
    private readonly int _processId;
    private readonly bool _includeTree;
    private readonly int _sampleRate;
    private const int ChannelsCount = 2;
    private WasapiRecorder? _recorder;
    private bool _running;

    // Seam for tests: production builds the recorder via NAudio builder;
    // tests replace this to simulate activation failure without WASAPI.
    internal static Func<uint, bool, int, WasapiRecorder> RecorderFactory { get; set; } =
        (pid, includeTree, sampleRate) =>
        {
            var mode = includeTree
                ? ProcessLoopbackMode.IncludeTargetProcessTree
                : ProcessLoopbackMode.ExcludeTargetProcessTree;
            var task = new WasapiRecorderBuilder()
                .WithProcessLoopback(pid, mode)
                .WithMmcssThreadPriority("Audio")
                .WithFormat(WaveFormat.CreateIeeeFloatWaveFormat(sampleRate, ChannelsCount))
                .BuildAsync();
            return task.GetAwaiter().GetResult();
        };

    public int SampleRate => _sampleRate;
    public int Channels => ChannelsCount;

    public event Action<AudioBuffer>? OnAudioData;

    public WasapiProcessLoopbackSource(int processId, bool includeTree = true, int sampleRate = 48000)
    {
        _processId = processId;
        _includeTree = includeTree;
        _sampleRate = sampleRate;
    }

    public void Start()
    {
        if (_running) return;

        var recorder = RecorderFactory((uint)_processId, _includeTree, _sampleRate);
        if (recorder == null)
        {
            // Factory trocada pelo teste p/ simular falha de ativação sem WASAPI.
            Log.W("WasapiProcessLoopback", "RecorderFactory devolveu null — captura não iniciou");
            return;
        }
        _recorder = recorder;
        _recorder.DataAvailable += OnDataAvailable;
        _recorder.RecordingStopped += (_, _) =>
        {
            Log.I("WasapiProcessLoopback", "RecordingStopped");
            _running = false;
        };
        _recorder.StartRecording();
        _running = true;
        Log.I("WasapiProcessLoopback",
            $"PID={_processId} includeTree={_includeTree} SR={_sampleRate} — captura NAudio 3 ativa");
    }

    private void OnDataAvailable(ReadOnlySpan<byte> buffer, AudioClientBufferFlags flags, long devicePosition, long qpcPosition)
    {
        if (!_running || OnAudioData == null || buffer.IsEmpty)
            return;

        var samples = ConvertFloatBytes(buffer);
        OnAudioData(new AudioBuffer(samples, _sampleRate, ChannelsCount));
    }

    /// <summary>Pure conversion: IEEE float32 LE bytes → float samples. Truncated trailing bytes ignored.</summary>
    internal static float[] ConvertFloatBytes(ReadOnlySpan<byte> buffer)
    {
        var sampleCount = buffer.Length / sizeof(float);
        var samples = new float[sampleCount];
        if (sampleCount > 0)
            buffer.Slice(0, sampleCount * sizeof(float)).CopyTo(System.Runtime.InteropServices.MemoryMarshal.AsBytes(samples.AsSpan()));
        return samples;
    }

    public void Stop()
    {
        if (!_running) return;
        _running = false;
        var recorder = _recorder;
        if (recorder != null)
        {
            // StopRecording é bloqueante (Join da thread de captura). Em endpoints mortos esse
            // Join pode travar o shutdown — roda em background com deadline (achado 4.2).
            WasapiStopGuard.StopInBackground(recorder, nameof(WasapiProcessLoopbackSource));
            Log.I("WasapiProcessLoopback", "Parado.");
        }
    }

    public void Dispose()
    {
        Stop();
        var recorder = _recorder;
        _recorder = null;
        if (recorder != null)
            WasapiStopGuard.DisposeInBackground(recorder, nameof(WasapiProcessLoopbackSource));
    }
}
