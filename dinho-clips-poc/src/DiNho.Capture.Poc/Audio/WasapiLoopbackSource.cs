using DiNho.Capture.Poc.Logging;
using NAudio.Wave;
using NAudio.CoreAudioApi;

namespace DiNho.Capture.Poc.Audio;

public sealed class WasapiLoopbackSource : IAudioSource
{
    private WasapiRecorder? _capture;
    private readonly MMDevice _device;
    private bool _running;
    private readonly int _sampleRate;

    public int SampleRate => _sampleRate;
    public int Channels { get; private set; }

    public event Action<AudioBuffer>? OnAudioData;

    public WasapiLoopbackSource(int sampleRate = 48000)
    {
        _sampleRate = sampleRate;
        using var enumerator = new MMDeviceEnumerator();
        try
        {
            _device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        }
        catch (System.Runtime.InteropServices.COMException)
        {
            Log.W("WasapiLoopbackSource", "Default render device not found — trying first available");
            var devices = enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active);
            if (devices.Count == 0)
                throw new InvalidOperationException("No audio render devices available on this system");
            _device = devices[0];
            Log.I("WasapiLoopbackSource", $"Using fallback device: {_device.FriendlyName}");
        }
    }

    public void Start()
    {
        if (_running) return;

        try
        {
            _capture = new WasapiRecorderBuilder()
                .WithDevice(_device)
                .WithLoopbackCapture()
                .WithMmcssThreadPriority("Audio")
                .WithFormat(WaveFormat.CreateIeeeFloatWaveFormat(_sampleRate, 2))
                .Build();
        }
        catch
        {
            Log.W("WasapiLoopbackSource", $"Format {_sampleRate}/2 rejected, using device default");
            _capture = new WasapiRecorderBuilder()
                .WithDevice(_device)
                .WithLoopbackCapture()
                .WithMmcssThreadPriority("Audio")
                .Build();
        }
        Log.I("WasapiLoopbackSource", $"Format set: {_capture.WaveFormat.Encoding} SR={_capture.WaveFormat.SampleRate} Ch={_capture.WaveFormat.Channels} Bps={_capture.WaveFormat.BitsPerSample}");
        Channels = _capture.WaveFormat.Channels;

        _capture.DataAvailable += OnDataAvailable;
        _capture.RecordingStopped += (s, e) =>
        {
            Log.I("WasapiLoopbackSource", "RecordingStopped");
            _running = false;
        };

        try
        {
            _capture.StartRecording();
        }
        catch
        {
            _capture.Dispose();
            _capture = null;
            throw;
        }
        _running = true;
        Log.I("WasapiLoopbackSource", "StartRecording() OK");
    }

    private void OnDataAvailable(ReadOnlySpan<byte> buffer, AudioClientBufferFlags flags, long devicePosition, long qpcPosition)
    {
        if (OnAudioData == null) return;

        var samples = System.Runtime.InteropServices.MemoryMarshal.Cast<byte, float>(buffer).ToArray();
        OnAudioData(new AudioBuffer(samples, SampleRate, Channels));
    }

    public void Stop()
    {
        if (!_running) return;
        _running = false;
        var capture = _capture;
        if (capture != null)
            WasapiStopGuard.StopInBackground(capture, nameof(WasapiLoopbackSource));
    }

    public void Dispose()
    {
        _running = false;
        var capture = _capture;
        _capture = null;
        if (capture != null)
            WasapiStopGuard.DisposeInBackground(capture, nameof(WasapiLoopbackSource));
        _device?.Dispose();
    }
}