using System.Diagnostics;

namespace DiNho.Capture.Poc.Status;

public sealed class EngineStatusSnapshot
{
    public string CaptureBackend { get; set; } = "NONE";
    public string Encoder { get; set; } = "NONE";
    public bool DiskSpaceOk { get; set; } = true;
    public bool LastCrashRecovered { get; set; } = false;
    public string? Game { get; set; } = null;
    public bool Recording { get; set; } = false;
    public long UptimeSeconds { get; set; } = 0;
    public double LastFrameMs { get; set; } = 0;
    public long LastClipSize { get; set; } = 0;
    public int ActivePipelines { get; set; } = 0;
    public bool WatchdogOk { get; set; } = true;
    public int MemoryMB { get; set; } = 0;
    public long ReplayBufferBytes { get; set; } = 0;
    public int ReplayBufferVideoFrames { get; set; } = 0;
    public long ReplayBufferVideoBytes { get; set; } = 0;
    public int ReplayBufferAudioPackets { get; set; } = 0;
    public long ReplayBufferAudioBytes { get; set; } = 0;
    public bool AudioFallback { get; set; } = false;
    public float MicLevel { get; set; } = 0;
    public string OutputDirectory { get; set; } = "";
    public long DroppedFrames { get; set; } = 0;
    public long GpuBusyDrops { get; set; } = 0;

    /// <summary>Perfil calibrado da máquina ("Weak"/"Medium"/"Strong"); "" = não aplicado.</summary>
    public string CalibrationTier { get; set; } = "";
}

public sealed class EngineStatus : IDisposable
{
    private EngineStatusSnapshot _current = new();
    private readonly Lock _lock = new();
    private Timer? _watchdogTimer;
    private DateTime _lastHeartbeat = DateTime.UtcNow;

    public EngineStatusSnapshot Current
    {
        get { lock (_lock) return _current; }
    }

    public event Action<EngineStatusSnapshot>? OnStatusUpdate;
    public event Action? OnWatchdogTimeout;

    public EngineStatus()
    {
        _watchdogTimer = new Timer(WatchdogCheck, null, 5000, 5000);
    }

    public void Heartbeat()
    {
        _lastHeartbeat = DateTime.UtcNow;
    }

    private static int SampleMemoryMb()
    {
        try { return (int)(Process.GetCurrentProcess().WorkingSet64 / (1024L * 1024L)); }
        catch { return 0; }
    }

    public void Update(Action<EngineStatusSnapshot> updater)
    {
        lock (_lock)
        {
            updater(_current);
            _current.MemoryMB = SampleMemoryMb();
            var snapshot = new EngineStatusSnapshot
            {
                CaptureBackend = _current.CaptureBackend,
                Encoder = _current.Encoder,
                DiskSpaceOk = _current.DiskSpaceOk,
                LastCrashRecovered = _current.LastCrashRecovered,
                Game = _current.Game,
                Recording = _current.Recording,
                UptimeSeconds = _current.UptimeSeconds,
                LastFrameMs = _current.LastFrameMs,
                LastClipSize = _current.LastClipSize,
                ActivePipelines = _current.ActivePipelines,
                WatchdogOk = _current.WatchdogOk,
                MemoryMB = _current.MemoryMB,
                ReplayBufferBytes = _current.ReplayBufferBytes,
                ReplayBufferVideoFrames = _current.ReplayBufferVideoFrames,
                ReplayBufferVideoBytes = _current.ReplayBufferVideoBytes,
                ReplayBufferAudioPackets = _current.ReplayBufferAudioPackets,
                ReplayBufferAudioBytes = _current.ReplayBufferAudioBytes,
                AudioFallback = _current.AudioFallback,
                MicLevel = _current.MicLevel,
                OutputDirectory = _current.OutputDirectory,
                DroppedFrames = _current.DroppedFrames,
                CalibrationTier = _current.CalibrationTier,
            };
            OnStatusUpdate?.Invoke(snapshot);
            Heartbeat();
        }
    }

    private void WatchdogCheck(object? state)
    {
        var elapsed = DateTime.UtcNow - _lastHeartbeat;
        if (elapsed.TotalSeconds > 30)
        {
            _current.WatchdogOk = false;
            OnWatchdogTimeout?.Invoke();
        }
        else
        {
            _current.WatchdogOk = true;
            try
            {
                var desktop = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
                var drive = new DriveInfo(desktop);
                _current.DiskSpaceOk = drive.AvailableFreeSpace > 100_000_000;
            }
            catch
            {
                _current.DiskSpaceOk = true;
            }
        }
    }

    public void Dispose()
    {
        _watchdogTimer?.Dispose();
    }
}
