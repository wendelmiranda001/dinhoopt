using System.Runtime.InteropServices;
using Windows.Win32;
using Windows.Win32.System.Memory;
using Windows.Win32.System.SystemInformation;

namespace DiNho.Capture.Poc.Memory;

public enum RamProfileLevel
{
    LowMemory,
    Balanced,
    Full
}

public sealed class CaptureProfile
{
    public RamProfileLevel Level { get; set; }
    public int Cq { get; set; }
    public int MaxrateKbps { get; set; }
    public int BufsizeKbps { get; set; }
    public int Bframes { get; set; }
    public int Lookahead { get; set; }
    public int ReplaySeconds { get; set; }
    public int EncodeWidth { get; set; }
    public int EncodeHeight { get; set; }
    public int MaxBufferBytes { get; set; }
}

public sealed class RamManager : IDisposable
{
    private const long MinBufferBytes = 80L * 1024 * 1024;
    private const long GameReserveBytes = 400L * 1024 * 1024;
    private const long CaptureOverheadBytes = 200L * 1024 * 1024;
    private const int MinReplaySec = 30;
    private const int MinHeight = 720;
    private const int MaxCq = 26;

    private const double PressureThreshold = 0.85;
    private const double CriticalThreshold = 0.93;
    private const double NormalThreshold = 0.75;

    private readonly int _captureWidth;
    private readonly int _captureHeight;
    private readonly int _configuredReplaySec;
    private readonly int _configuredCq;
    private readonly int _configuredMaxrateKbps;
    private readonly int _configuredBufsizeKbps;
    private readonly int _configuredBframes;
    private readonly int _configuredLookahead;

    private Timer? _watchdog;
    private readonly Lock _lock = new();
    private bool _disposed;
    private CaptureProfile? _lastProfile;
    private bool _wasUnderPressure;

    public RamManager(
        int captureWidth,
        int captureHeight,
        int configuredReplaySec,
        int configuredCq,
        int configuredMaxrateKbps = 50000,
        int configuredBufsizeKbps = 100000,
        int configuredBframes = 2,
        int configuredLookahead = 4)
    {
        _captureWidth = captureWidth;
        _captureHeight = captureHeight;
        _configuredReplaySec = configuredReplaySec;
        _configuredCq = configuredCq;
        _configuredMaxrateKbps = configuredMaxrateKbps;
        _configuredBufsizeKbps = configuredBufsizeKbps;
        _configuredBframes = configuredBframes;
        _configuredLookahead = configuredLookahead;
    }

    public Action<string>? OnBroadcast { get; set; }
    public Action<int>? OnReduceReplay { get; set; }
    public Action? OnNormal { get; set; }

    // 6.10: seam de RAM disponível p/ testes determinísticos do ResolveProfile.
    internal static Func<long> GetAvailableRamBytesProbe = GetAvailableRamBytes;

    public static long ComputeSafeBudget(long availableBytes)
    {
        long budget = availableBytes - GameReserveBytes - CaptureOverheadBytes;
        return Math.Clamp(budget, MinBufferBytes, int.MaxValue);
    }

    /// <summary>
    /// Clamp explícito do MaxBufferBytes (6.10): o buffer efetivo NUNCA excede
    /// 75% do safe budget (teto de RAM), sobe até o necessário pro bitrate×replay
    /// quando o default do perfil é pequeno, e nunca estoura int (overflow negativo
    /// em máquinas com &gt;3GB de budget era possível antes do cast final).
    /// </summary>
    public static int ResolveMaxBufferBytes(
        int defaultMaxBufferBytes,
        long maxrateKbps,
        int replaySeconds,
        long safeBudgetBytes)
    {
        long neededBytes = maxrateKbps * replaySeconds * 1024L * 13L / 80L; // +30% headroom
        long budgetLimit = safeBudgetBytes * 3 / 4;                        // no máx. 75% do safe budget
        long wanted = Math.Max(defaultMaxBufferBytes, neededBytes);
        long capped = Math.Min(wanted, budgetLimit);
        return (int)Math.Clamp(capped, MinBufferBytes, int.MaxValue);
    }

    /// <summary>
    /// Hybrid buffer sizing: video in RAM is capped at ~2 minutes (fixed); the
    /// excess is evicted to the disk spill (video-only). If the safe RAM budget
    /// cannot hold 2 min at the target bitrate, the cap shrinks to what fits
    /// (ComputeSafeBudget already clamps to an 80MB floor). Never exceeds safe RAM.
    /// </summary>
    public static (TimeSpan RamCap, long RamCapBytes) ComputeHybridRamCap(int maxrateKbps, int replaySeconds, long safeBudget)
    {
        long ramCapBytes = (long)maxrateKbps * 120L * 1024L * 13L / 80L; // 2 min fixos
        if (ramCapBytes > safeBudget)
            ramCapBytes = safeBudget;
        long capSeconds = ramCapBytes * 80L / Math.Max(1L, (long)maxrateKbps * 1024L * 13L);
        capSeconds = Math.Max(capSeconds, 30L);
        var ramCap = TimeSpan.FromSeconds(Math.Min(capSeconds, replaySeconds));
        return (ramCap, ramCapBytes);
    }

    public static CaptureProfile BuildSettings(
        RamProfileLevel level,
        int captureWidth,
        int captureHeight,
        int configuredCq,
        int configuredReplaySec,
        int configuredMaxrateKbps,
        int configuredBufsizeKbps,
        int configuredBframes,
        int configuredLookahead)
    {
        int cq, maxrateKbps, bufsizeKbps, bframes, lookahead, replaySec, encodeW, encodeH, maxBufferBytes;

        switch (level)
        {
            case RamProfileLevel.LowMemory:
                cq = Math.Min(Math.Max(configuredCq, 26), MaxCq);
                maxrateKbps = Math.Min(configuredMaxrateKbps, 20000);
                bufsizeKbps = Math.Min(configuredBufsizeKbps, 40000);
                bframes = 0;
                lookahead = 0;
                replaySec = Math.Max(Math.Min(configuredReplaySec, 60), MinReplaySec);
                encodeW = Math.Min(captureWidth, 1280);
                encodeH = Math.Min(captureHeight, 720);
                maxBufferBytes = 128 * 1024 * 1024;
                break;
            case RamProfileLevel.Balanced:
                cq = Math.Min(Math.Max(configuredCq, 24), MaxCq);
                maxrateKbps = Math.Min(configuredMaxrateKbps, 35000);
                bufsizeKbps = Math.Min(configuredBufsizeKbps, 70000);
                bframes = 0;  // Always 0 — EmitPacket() assumes strict FIFO PTS
                lookahead = configuredLookahead;
                replaySec = Math.Max(Math.Min(configuredReplaySec, 180), MinReplaySec);
                encodeW = captureWidth;
                encodeH = Math.Max(Math.Min(captureHeight, 1080), MinHeight);
                maxBufferBytes = 256 * 1024 * 1024;
                break;
            default:
                cq = configuredCq;
                maxrateKbps = configuredMaxrateKbps;
                bufsizeKbps = configuredBufsizeKbps;
                bframes = 0;  // Always 0 — EmitPacket() assumes strict FIFO PTS order
                lookahead = configuredLookahead;
                replaySec = configuredReplaySec;
                encodeW = captureWidth;
                encodeH = captureHeight;
                maxBufferBytes = 512 * 1024 * 1024;
                break;
        }

        return new CaptureProfile
        {
            Level = level,
            Cq = cq,
            MaxrateKbps = maxrateKbps,
            BufsizeKbps = bufsizeKbps,
            Bframes = bframes,
            Lookahead = lookahead,
            ReplaySeconds = replaySec,
            EncodeWidth = encodeW,
            EncodeHeight = encodeH,
            MaxBufferBytes = maxBufferBytes
        };
    }

    public CaptureProfile ResolveProfile()
    {
        long availableBytes = GetAvailableRamBytesProbe();
        long budgetBytes = ComputeSafeBudget(availableBytes);
        int budgetMb = (int)(budgetBytes / (1024L * 1024L));

        RamProfileLevel level;
        if (budgetMb < 256)
            level = RamProfileLevel.LowMemory;
        else if (budgetMb < 512)
            level = RamProfileLevel.Balanced;
        else
            level = RamProfileLevel.Full;

        var profile = BuildSettings(
            level,
            _captureWidth,
            _captureHeight,
            _configuredCq,
            _configuredReplaySec,
            _configuredMaxrateKbps,
            _configuredBufsizeKbps,
            _configuredBframes,
            _configuredLookahead);

        // Override MaxBufferBytes based on actual bitrate × replay duration.
        // Fixed 512MB for Full profile is insufficient at higher bitrates
        // (observed: 512MB holds only ~151s at 15.8 Mbps → TrimExcess evicts).
        // 6.10: o clamp passa por ResolveMaxBufferBytes (nunca > 75% do safe budget).
        profile.MaxBufferBytes = ResolveMaxBufferBytes(
            profile.MaxBufferBytes, profile.MaxrateKbps, profile.ReplaySeconds, budgetBytes);

        _lastProfile = profile;
        _wasUnderPressure = level != RamProfileLevel.Full;
        var memMb = (int)(availableBytes / (1024L * 1024L));
        Logging.Log.I("RamManager", $"ResolveProfile: availableRAM={memMb}MB budget={budgetMb}MB profile={level} cq={profile.Cq} replay={profile.ReplaySeconds}s encode={profile.EncodeWidth}x{profile.EncodeHeight} maxBuf={profile.MaxBufferBytes / (1024*1024)}MB");
        return profile;
    }

    public void StartWatchdog()
    {
        if (_disposed) return;
        lock (_lock)
        {
            _watchdog?.Dispose();
            _watchdog = new Timer(WatchdogCheck, null, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5));
        }
    }

    public void StopWatchdog()
    {
        lock (_lock)
        {
            _watchdog?.Dispose();
            _watchdog = null;
        }
    }

    private void WatchdogCheck(object? state)
    {
        if (_disposed) return;
        try
        {
            double usedPct = GetRamUsedPercent();
            if (usedPct >= CriticalThreshold)
            {
                if (_lastProfile != null)
                {
                    int reducedReplay = Math.Max(_lastProfile.ReplaySeconds / 2, MinReplaySec);
                    OnReduceReplay?.Invoke(reducedReplay);
                    _wasUnderPressure = true;
                    var msg = BuildPressureMessage("critical", usedPct, reducedReplay);
                    OnBroadcast?.Invoke(msg);
                }
            }
            else if (usedPct >= PressureThreshold)
            {
                _wasUnderPressure = true;
                var msg = BuildPressureMessage("warning", usedPct, null);
                OnBroadcast?.Invoke(msg);
            }
            else if (usedPct < NormalThreshold - 0.05 && _wasUnderPressure)
            {
                _wasUnderPressure = false;
                OnNormal?.Invoke();
                var msg = BuildNormalMessage(usedPct);
                OnBroadcast?.Invoke(msg);
            }
        }
        catch (Exception ex)
        {
            Logging.Log.E("RamManager", $"Watchdog error: {ex.Message}");
        }
    }

    private static string BuildPressureMessage(string level, double usedPct, int? reducedReplay)
    {
        var msg = new Dictionary<string, object?>
        {
            ["event"] = "ramPressure",
            ["level"] = level,
            ["usedPercent"] = usedPct,
            ["reducedReplay"] = reducedReplay
        };
        return System.Text.Json.JsonSerializer.Serialize(msg);
    }

    private static string BuildNormalMessage(double usedPct)
    {
        var msg = new Dictionary<string, object?>
        {
            ["event"] = "ramPressure",
            ["level"] = "normal",
            ["usedPercent"] = usedPct
        };
        return System.Text.Json.JsonSerializer.Serialize(msg);
    }

    internal static long GetAvailableRamBytes()
    {
        try
        {
            var memStatus = new MEMORYSTATUSEX();
            memStatus.dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>();
            if (PInvoke.GlobalMemoryStatusEx(ref memStatus))
                return (long)memStatus.ullAvailPhys;
            return 2L * 1024 * 1024 * 1024;
        }
        catch
        {
            return 2L * 1024 * 1024 * 1024;
        }
    }

    private static double GetRamUsedPercent()
    {
        try
        {
            var memStatus = new MEMORYSTATUSEX();
            memStatus.dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>();
            if (PInvoke.GlobalMemoryStatusEx(ref memStatus) && memStatus.ullTotalPhys > 0)
            {
                long used = (long)(memStatus.ullTotalPhys - memStatus.ullAvailPhys);
                return (double)used / memStatus.ullTotalPhys;
            }
            return 0.0;
        }
        catch
        {
            return 0.0;
        }
    }

    // MEMORYSTATUSEX and GlobalMemoryStatusEx — generated by CsWin32 (NativeMethods.txt)

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        StopWatchdog();
    }
}
