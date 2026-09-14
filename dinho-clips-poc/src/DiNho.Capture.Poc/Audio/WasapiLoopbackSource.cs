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
            StopInBackground(capture);
    }

    // NAudio's StopRecording()/Dispose() Join the capture thread. On endpoints that stop
    // producing data (dead loopback) that Join can block forever. Bound it: if the thread
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
            Log.W("WasapiLoopbackSource", "StopRecording did not finish in 2s — abandoning capture thread");
    }

    public void Dispose()
    {
        _running = false;
        var capture = _capture;
        _capture = null;
        if (capture != null)
        {
            // NAudio StopRecording()/Dispose() Join the capture thread; on dead endpoints the
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
                Log.W("WasapiLoopbackSource", "StopRecording/Dispose did not finish in 4s — abandoned capture thread");
        }
        _device?.Dispose();
    }
}