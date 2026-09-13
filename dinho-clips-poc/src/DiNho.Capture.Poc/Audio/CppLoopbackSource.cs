using DiNho.Capture.Poc.Logging;
using System.Runtime.InteropServices;

namespace DiNho.Capture.Poc.Audio;

[UnmanagedFunctionPointer(CallingConvention.StdCall)]
internal delegate void AudioCallback(IntPtr data, int length);

internal static class NativeMethods
{
    private const string DllName = "ApplicationLoopback.dll";

    [DllImport(DllName, CallingConvention = CallingConvention.StdCall)]
    internal static extern void SetAudioCallback(AudioCallback callback);

    [DllImport(DllName, CallingConvention = CallingConvention.StdCall)]
    internal static extern int StartCaptureAsync(
        uint processId,
        [MarshalAs(UnmanagedType.Bool)] bool includeProcessTree,
        ushort channel,
        uint sampleRate,
        ushort bitsPerSample);

    [DllImport(DllName, CallingConvention = CallingConvention.StdCall)]
    internal static extern int StopCaptureAsync();
}

public sealed class CppLoopbackSource : IAudioSource
{
    private readonly int _processId;
    private readonly bool _includeTree;
    private readonly int _sampleRate;
    private Thread? _captureThread;
    private volatile bool _running;
    private int _channels = 2;
    private GCHandle _callbackHandle;
    private AudioCallback? _managedCallback;
    private readonly Queue<AudioBuffer> _pendingBuffers = new();
    private readonly object _lock = new();
    private Thread? _pumpThread;
    private short[]? _shortBuffer;

    public int SampleRate => _sampleRate;
    public int Channels => _channels;

    public event Action<AudioBuffer>? OnAudioData;

    public CppLoopbackSource(int processId, bool includeTree = true, int sampleRate = 48000)
    {
        _processId = processId;
        _includeTree = includeTree;
        _sampleRate = sampleRate;
    }

    public void Start()
    {
        if (_running) return;
        _running = true;

        _managedCallback = OnAudioCallback;
        _callbackHandle = GCHandle.Alloc(_managedCallback);

        try
        {
            NativeMethods.SetAudioCallback(_managedCallback);
        }
        catch
        {
            _callbackHandle.Free();
            _running = false;
            throw;
        }

        try
        {
            _captureThread = new Thread(CaptureThreadProc)
            {
                Name = $"CppLoopback-{_processId}",
                IsBackground = true
            };
            _captureThread.Start();

            _pumpThread = new Thread(PumpThreadProc)
            {
                Name = $"CppLoopbackPump-{_processId}",
                IsBackground = true
            };
            _pumpThread.Start();
        }
        catch
        {
            _running = false;
            if (_callbackHandle.IsAllocated)
                _callbackHandle.Free();
            throw;
        }

        Log.I("CppLoopbackSource", $"PID={_processId} includeTree={_includeTree} — thread iniciada");
    }

    private void CaptureThreadProc()
    {
        try
        {
            int hr = NativeMethods.StartCaptureAsync(
                (uint)_processId,
                _includeTree,
                (ushort)_channels,
                (uint)_sampleRate,
                16);

            Log.I("CppLoopbackSource", $"StartCaptureAsync returned: HR=0x{hr:X8}");
        }
        catch (ThreadInterruptedException)
        {
            Log.I("CppLoopbackSource", "Capture thread interrupted (normal stop)");
        }
        catch (Exception ex)
        {
            Log.E("CppLoopbackSource", $"Capture thread error: {ex.Message}");
        }
    }

    private const int MaxPendingBuffers = 512;

    private void OnAudioCallback(IntPtr data, int length)
    {
        if (!_running || OnAudioData == null || data == IntPtr.Zero || length <= 0)
            return;

        int sampleCount = length / 2;

        if (_shortBuffer == null || _shortBuffer.Length < sampleCount)
            _shortBuffer = new short[sampleCount];

        Marshal.Copy(data, _shortBuffer, 0, sampleCount);

        // ALWAYS allocate a new float array — never reuse _floatBuffer.
        // Reusing causes a race condition: the native callback overwrites the array
        // with new data while the pump thread is still reading the old AudioBuffer,
        // corrupting samples and producing NaN that crashes the FFmpeg AAC encoder.
        var samples = new float[sampleCount];
        for (int i = 0; i < sampleCount; i++)
            samples[i] = _shortBuffer[i] / 32768f;

        var buffer = new AudioBuffer(samples, _sampleRate, _channels)
        {
            CaptureTimestamp = DateTime.UtcNow  // stamp at native capture time, not delivery
        };
        lock (_lock)
        {
            if (_pendingBuffers.Count >= MaxPendingBuffers)
                _pendingBuffers.Dequeue();
            _pendingBuffers.Enqueue(buffer);
            Monitor.Pulse(_lock);
        }
    }

    private void PumpThreadProc()
    {
        while (_running)
        {
            AudioBuffer? buffer = null;
            lock (_lock)
            {
                if (_pendingBuffers.Count > 0)
                    buffer = _pendingBuffers.Dequeue();
                else
                    Monitor.Wait(_lock, 50);
            }

            if (buffer != null && OnAudioData != null)
            {
                try { OnAudioData(buffer); }
                catch (Exception ex) { Log.D("CppLoopbackSource", $"Audio callback consumer error: {ex.Message}"); }
            }
        }
    }

    public void Stop()
    {
        if (!_running) return;
        _running = false;

        lock (_lock)
            Monitor.Pulse(_lock);

        Log.I("CppLoopbackSource", "Parando captura...");

        // Stop native capture first so it stops calling the callback
        int hr = NativeMethods.StopCaptureAsync();
        Log.I("CppLoopbackSource", $"StopCaptureAsync: HR=0x{hr:X8}");

        if (_captureThread != null && _captureThread.IsAlive)
        {
            try
            {
                _captureThread.Interrupt();
                _captureThread.Join(3000);
            }
            catch (Exception ex) { Log.D("CppLoopbackSource", $"Capture thread stop error: {ex.Message}"); }
        }

        if (_pumpThread != null && _pumpThread.IsAlive)
        {
            try { _pumpThread.Join(2000); }
            catch (Exception ex) { Log.D("CppLoopbackSource", $"Pump thread stop error: {ex.Message}"); }
        }
        _pumpThread = null;

        if (_callbackHandle.IsAllocated)
            _callbackHandle.Free();

        _managedCallback = null;
        _shortBuffer = null;

        Log.I("CppLoopbackSource", "Parado.");
    }

    public void Dispose() => Stop();
}
