using NAudio.Wave;
using NAudio.CoreAudioApi;
using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Audio;

public sealed class WasapiMicSource : IAudioSource
{
    private WasapiRecorder? _capture;
    private readonly MMDevice _device;
    private bool _running;
    private readonly int _sampleRate;

    public int SampleRate => _sampleRate;
    public int Channels { get; private set; } = 1;
    public string DeviceId { get; }

    public event Action<AudioBuffer>? OnAudioData;

    public WasapiMicSource(int sampleRate = 48000, string? deviceId = null)
    {
        _sampleRate = sampleRate;
        using var enumerator = new MMDeviceEnumerator();
        if (!string.IsNullOrEmpty(deviceId))
        {
            try
            {
                _device = enumerator.GetDevice(deviceId);
                DeviceId = deviceId;
                return;
            }
            catch (System.Runtime.InteropServices.COMException ex)
            {
                Log.W("WasapiMicSource", $"Microfone '{deviceId}' não encontrado (0x{ex.ErrorCode:X8}) — usando default");
            }
        }

        // Fallback: default Multimedia primeiro (o padrão Communications pode não
        // existir em máquinas sem headset VoIP), senão primeiro device de captura ativo.
        DeviceId = "";
        try
        {
            _device = enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Multimedia);
        }
        catch (System.Runtime.InteropServices.COMException)
        {
            Log.W("WasapiMicSource", "Default capture device not found — trying first available");
            var devices = enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active);
            if (devices.Count == 0)
                throw new InvalidOperationException("No audio capture devices available on this system");
            _device = devices[0];
            Log.I("WasapiMicSource", $"Using fallback device: {_device.FriendlyName}");
        }
    }

    public void Start()
    {
        if (_running) return;
        _capture = new WasapiRecorderBuilder()
            .WithDevice(_device)
            .WithEventSync()
            .WithMmcssThreadPriority("Audio")
            .WithFormat(WaveFormat.CreateIeeeFloatWaveFormat(_sampleRate, 1))
            .Build();
        _capture.DataAvailable += OnDataAvailable;
        _capture.RecordingStopped += (s, e) => _running = false;
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
            WasapiStopGuard.StopInBackground(capture, nameof(WasapiMicSource));
    }

    public void Dispose()
    {
        _running = false;
        var capture = _capture;
        _capture = null;
        if (capture != null)
            WasapiStopGuard.DisposeInBackground(capture, nameof(WasapiMicSource));
        _device?.Dispose();
    }
}