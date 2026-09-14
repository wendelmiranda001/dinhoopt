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
            StopInBackground(capture);
    }

    // NAudio's StopRecording()/Dispose() Join the capture thread. On endpoints that stop
    // producing data (inert/removed) that Join can block forever. Bound it: if the thread
    // does not return in time, abandon it so the app/tests never hang.
    private static void StopInBackground(WasapiRecorder capture)
    {
        var thread = new Thread(() =>
        {
            try { capture.StopRecording(); } catch { }
        })
        { IsBackground = true };
        thread.Start();
        if (!thread.Join(TimeSpan.FromSeconds(2)))
            Log.W("WasapiMicSource", "StopRecording did not finish in 2s — abandoning capture thread");
    }

    public void Dispose()
    {
        _running = false;
        var capture = _capture;
        _capture = null;
        if (capture != null)
        {
            // NAudio StopRecording()/Dispose() Join the capture thread; on inert endpoints the
            // Join blocks forever. Run everything (incl. the NAudio 3.1 Starting-race spin) on a
            // background thread and bound the Join so app shutdown can never hang.
            var thread = new Thread(() =>
            {
                try
                {
                    // NAudio 3.1 race: StopRecording applied before the capture thread reaches its
                    // `captureState = Capturing` assignment is swallowed and never re-applied, leaving
                    // the thread looping forever and Dispose's Join blocked. Wait until the thread is
                    // capturing before stopping — deterministic on both sides.
                    var sw = System.Diagnostics.Stopwatch.StartNew();
                    while (capture.CaptureState == CaptureState.Starting && sw.ElapsedMilliseconds < 3000)
                        Thread.Sleep(5);
                }
                catch { }
                try { capture.StopRecording(); } catch { }
                try { capture.Dispose(); } catch { }
            })
            { IsBackground = true };
            thread.Start();
            if (!thread.Join(TimeSpan.FromSeconds(4)))
                Log.W("WasapiMicSource", "StopRecording/Dispose did not finish in 4s — abandoned capture thread");
        }
        _device?.Dispose();
    }
}