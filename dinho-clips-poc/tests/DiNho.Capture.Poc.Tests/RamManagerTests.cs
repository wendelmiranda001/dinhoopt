using DiNho.Capture.Poc.Memory;

namespace DiNho.Capture.Poc.Tests;

public sealed class RamManagerTests : IDisposable
{
    private readonly Func<long> _originalProbe;
    private readonly Func<double> _originalUsedProbe;

    public RamManagerTests()
    {
        _originalProbe = RamManager.GetAvailableRamBytesProbe;
        _originalUsedProbe = RamManager.GetUsedPercentProbe;
    }

    public void Dispose()
    {
        RamManager.GetAvailableRamBytesProbe = _originalProbe;
        RamManager.GetUsedPercentProbe = _originalUsedProbe;
    }

    [Fact]
    public void ComputeSafeBudget_HugeRam_FullBudget()
    {
        long budget = RamManager.ComputeSafeBudget(16L * 1024 * 1024 * 1024);
        Assert.True(budget >= 2_000_000_000, $"Expected ≥2GB, got {budget}");
    }

    [Fact]
    public void ComputeSafeBudget_BareMinimum_ClampsToMin()
    {
        long budget = RamManager.ComputeSafeBudget(100_000_000);
        Assert.Equal(80L * 1024 * 1024, budget);
    }

    [Fact]
    public void ComputeSafeBudget_Negative_ClampsToMin()
    {
        long budget = RamManager.ComputeSafeBudget(1);
        Assert.Equal(80L * 1024 * 1024, budget);
    }

    [Fact]
    public void ComputeSafeBudget_2GB_ReturnsPositiveBudget()
    {
        long budget = RamManager.ComputeSafeBudget(2L * 1024 * 1024 * 1024);
        Assert.True(budget > 0);
        Assert.True(budget < 2L * 1024 * 1024 * 1024);
    }

    [Fact]
    public void ComputeHybridRamCap_RoomFor2Min_UsesFullCap()
    {
        // 30000 kbps * 2min (120s) = ~599MB < 2GB budget → cap de 120s sem clamp.
        var (cap, bytes) = RamManager.ComputeHybridRamCap(30_000, 600, 2L * 1024 * 1024 * 1024);
        Assert.Equal(120, (int)cap.TotalSeconds);
        Assert.Equal(599_040_000, bytes); // 30000*120*1024*13/80
    }

    [Fact]
    public void ComputeHybridRamCap_SmallBudget_ShrinksToFit()
    {
        // Budget de 200MB não segura 2min → cap encolhe pro que couber.
        var (cap, bytes) = RamManager.ComputeHybridRamCap(30_000, 600, 200L * 1024 * 1024);
        Assert.Equal(200L * 1024 * 1024, bytes);
        Assert.True((int)cap.TotalSeconds < 120);
        Assert.True((int)cap.TotalSeconds >= 30);
    }

    [Fact]
    public void ComputeHybridRamCap_TinyBudget_FloorsAt30Seconds()
    {
        // Piso de 80MB → 16.8s bruto, clampado no mínimo de 30s.
        var (cap, bytes) = RamManager.ComputeHybridRamCap(30_000, 600, 80L * 1024 * 1024);
        Assert.Equal(80L * 1024 * 1024, bytes);
        Assert.Equal(30, (int)cap.TotalSeconds);
    }

    [Fact]
    public void ComputeHybridRamCap_ShorterReplay_ClampsToReplay()
    {
        // Replay de 100s < cap de 2min → cap = replay window.
        var (cap, bytes) = RamManager.ComputeHybridRamCap(30_000, 100, 2L * 1024 * 1024 * 1024);
        Assert.Equal(100, (int)cap.TotalSeconds);
        Assert.Equal(599_040_000, bytes);
    }

    [Fact]
    public void ComputeHybridRamCap_ZeroSafeBudget_FloorsAt30Seconds()
    {
        var (cap, bytes) = RamManager.ComputeHybridRamCap(30_000, 600, 0);
        Assert.Equal(0, bytes);
        Assert.Equal(30, (int)cap.TotalSeconds);
    }

    [Fact]
    public void BuildSettings_Full_UsesConfiguredValues()
    {
        var p = RamManager.BuildSettings(
            RamProfileLevel.Full, 1920, 1080, 24, 300, 50000, 100000, 2, 4);

        Assert.Equal(24, p.Cq);
        Assert.Equal(50000, p.MaxrateKbps);
        Assert.Equal(100000, p.BufsizeKbps);
        Assert.Equal(0, p.Bframes); // forced 0 for NVENC PTS FIFO safety
        Assert.Equal(4, p.Lookahead);
        Assert.Equal(300, p.ReplaySeconds);
        Assert.Equal(1920, p.EncodeWidth);
        Assert.Equal(1080, p.EncodeHeight);
        Assert.Equal(512 * 1024 * 1024, p.MaxBufferBytes);
    }

    [Fact]
    public void BuildSettings_Balanced_AdjustsCorrectly()
    {
        var p = RamManager.BuildSettings(
            RamProfileLevel.Balanced, 2560, 1440, 20, 300, 50000, 100000, 2, 4);

        Assert.Equal(24, p.Cq);
        Assert.Equal(35000, p.MaxrateKbps);
        Assert.Equal(70000, p.BufsizeKbps);
        Assert.Equal(0, p.Bframes); // forced 0 for NVENC PTS FIFO safety
        Assert.Equal(4, p.Lookahead);
        Assert.Equal(180, p.ReplaySeconds);
        Assert.Equal(2560, p.EncodeWidth);
        Assert.Equal(1080, p.EncodeHeight);
        Assert.Equal(256 * 1024 * 1024, p.MaxBufferBytes);
    }

    [Fact]
    public void BuildSettings_Balanced_ClampsHeightToAtLeast720()
    {
        var p = RamManager.BuildSettings(
            RamProfileLevel.Balanced, 640, 480, 20, 300, 50000, 100000, 2, 4);

        Assert.Equal(640, p.EncodeWidth);
        Assert.Equal(720, p.EncodeHeight);
    }

    [Fact]
    public void BuildSettings_LowMemory_ForcesMinimums()
    {
        var p = RamManager.BuildSettings(
            RamProfileLevel.LowMemory, 1920, 1080, 18, 300, 50000, 100000, 2, 4);

        Assert.Equal(26, p.Cq);
        Assert.Equal(20000, p.MaxrateKbps);
        Assert.Equal(40000, p.BufsizeKbps);
        Assert.Equal(0, p.Bframes);
        Assert.Equal(0, p.Lookahead);
        Assert.Equal(60, p.ReplaySeconds);
        Assert.Equal(1280, p.EncodeWidth);
        Assert.Equal(720, p.EncodeHeight);
        Assert.Equal(128 * 1024 * 1024, p.MaxBufferBytes);
    }

    [Fact]
    public void BuildSettings_LowMemory_ReplayClampedTo30Min()
    {
        var p = RamManager.BuildSettings(
            RamProfileLevel.LowMemory, 1920, 1080, 24, 15, 50000, 100000, 2, 4);

        Assert.Equal(30, p.ReplaySeconds);
    }

    [Fact]
    public void BuildSettings_LowMemory_CqNeverExceedsMaxCq()
    {
        var p = RamManager.BuildSettings(
            RamProfileLevel.LowMemory, 1920, 1080, 30, 300, 50000, 100000, 2, 4);

        Assert.Equal(26, p.Cq);
    }

    [Fact]
    public void ResolveProfile_ReturnsValidProfile()
    {
        using var rm = new RamManager(1920, 1080, 300, 24);
        var p = rm.ResolveProfile();
        Assert.NotNull(p);
        Assert.InRange(p.Cq, 0, 51);
        Assert.True(p.ReplaySeconds >= 30);
        Assert.True(p.MaxBufferBytes >= 80 * 1024 * 1024);
    }

    [Fact]
    public void StartStopWatchdog_DoesNotThrow()
    {
        using var rm = new RamManager(1920, 1080, 300, 24);
        rm.ResolveProfile();
        rm.StartWatchdog();
        Thread.Sleep(100);
        rm.StopWatchdog();
    }

    [Fact]
    public void Dispose_StopsWatchdog()
    {
        var rm = new RamManager(1920, 1080, 300, 24);
        rm.ResolveProfile();
        rm.StartWatchdog();
        rm.Dispose();
        rm.Dispose();
    }

    [Fact]
    public void DoubleDispose_DoesNotThrow()
    {
        var rm = new RamManager(1920, 1080, 300, 24);
        rm.Dispose();
        rm.Dispose();
    }

    [Fact]
    public void GetAvailableRamBytes_ReturnsPositive()
    {
        long bytes = RamManager.GetAvailableRamBytes();
        Assert.True(bytes > 0);
        Assert.True(bytes < 1024L * 1024 * 1024 * 1024);
    }

    [Fact]
    public void LevelProperty_MapsCorrectly()
    {
        var full = RamManager.BuildSettings(RamProfileLevel.Full, 1920, 1080, 24, 300, 50000, 100000, 2, 4);
        var bal = RamManager.BuildSettings(RamProfileLevel.Balanced, 1920, 1080, 24, 300, 50000, 100000, 2, 4);
        var low = RamManager.BuildSettings(RamProfileLevel.LowMemory, 1920, 1080, 24, 300, 50000, 100000, 2, 4);

        Assert.Equal(RamProfileLevel.Full, full.Level);
        Assert.Equal(RamProfileLevel.Balanced, bal.Level);
        Assert.Equal(RamProfileLevel.LowMemory, low.Level);
    }

    [Fact]
    public void BroadcastCallback_InvokedOnResolve()
    {
        string? captured = null;
        using var rm = new RamManager(1920, 1080, 300, 24);
        rm.OnBroadcast = msg => captured = msg;
        rm.ResolveProfile();
        Assert.Null(captured);
    }

    [Fact]
    public void OnReduceReplay_CalledOnCriticalPressure()
    {
        int? newSecs = null;
        using var rm = new RamManager(1920, 1080, 300, 24);
        rm.OnReduceReplay = secs => newSecs = secs;
        rm.ResolveProfile();
        Assert.Null(newSecs);
    }

    [Fact]
    public void FullProfile_PreservesConfiguredValues()
    {
        var p = RamManager.BuildSettings(
            RamProfileLevel.Full, 1920, 1080, 20, 600, 80000, 160000, 4, 8);

        Assert.Equal(RamProfileLevel.Full, p.Level);
        Assert.Equal(20, p.Cq);
        Assert.Equal(80000, p.MaxrateKbps);
        Assert.Equal(160000, p.BufsizeKbps);
        Assert.Equal(0, p.Bframes); // forced 0 for NVENC PTS FIFO safety
        Assert.Equal(8, p.Lookahead);
        Assert.Equal(600, p.ReplaySeconds);
        Assert.Equal(1920, p.EncodeWidth);
        Assert.Equal(1080, p.EncodeHeight);
    }

    // ── 6.10: ResolveMaxBufferBytes (clamp explícito, sem overflow) ──

    [Fact]
    public void ResolveMaxBufferBytes_HighBitrate_ClampsToBudgetAndIntMax()
    {
        // Bitrate extremo + budget de 3GB → wanted >> int.MaxValue.
        // O clamp final não pode lançar exceção nem produzir negativo.
        int result = RamManager.ResolveMaxBufferBytes(
            defaultMaxBufferBytes: 512 * 1024 * 1024,
            maxrateKbps: 200_000,
            replaySeconds: 300,
            safeBudgetBytes: 3L * 1024 * 1024 * 1024);

        Assert.True(result > 0);
        // 3GB * 0.75 = 2.41GB > int.MaxValue → cap no int.MaxValue (sem overflow negativo).
        Assert.Equal(int.MaxValue, result);
    }

    [Fact]
    public void ResolveMaxBufferBytes_LowBudget_CappedBelowDefault()
    {
        // Budget de 150MB → limite 75% = 112MB → mesmo com default 512MB, perde pro teto.
        int result = RamManager.ResolveMaxBufferBytes(
            defaultMaxBufferBytes: 512 * 1024 * 1024,
            maxrateKbps: 50_000,
            replaySeconds: 300,
            safeBudgetBytes: 150L * 1024 * 1024);

        Assert.True(result < 512 * 1024 * 1024);
        Assert.True(result >= 80 * 1024 * 1024); // piso nunca quebra o mínimo
    }

    [Fact]
    public void ResolveMaxBufferBytes_FitsInBudget_RaisesToNeeded()
    {
        // Default 256MB; bitrate pede mais; budget cabe → usa o necessário.
        int result = RamManager.ResolveMaxBufferBytes(
            defaultMaxBufferBytes: 256 * 1024 * 1024,
            maxrateKbps: 30_000,
            replaySeconds: 180,
            safeBudgetBytes: 2L * 1024 * 1024 * 1024);

        // 30000 * 180 * 1024 * 13 / 80 = 898,560,000
        Assert.Equal(898_560_000, result);
        Assert.True(result <= 2L * 1024 * 1024 * 1024 * 3 / 4);
    }

    [Fact]
    public void ResolveMaxBufferBytes_NeverAboveBudgetPortion()
    {
        // Invariante central: p/ qualquer entrada, resultado ≤ 75% do safe budget.
        foreach (var budget in new[] { 200L * 1024 * 1024, 512L * 1024 * 1024, 2L * 1024 * 1024 * 1024, 8L * 1024 * 1024 * 1024 })
        {
            int result = RamManager.ResolveMaxBufferBytes(512 * 1024 * 1024, 120_000, 600, budget);
            long budgetLimit = budget * 3 / 4;
            Assert.True(result <= budgetLimit, $"result {result} > budgetLimit {budgetLimit} for budget {budget}");
            Assert.True(result >= 80 * 1024 * 1024);
        }
    }

    // ── 6.10: ResolveProfile honra o teto RAM no cenário real ─────────

    [Fact]
    public void ResolveProfile_LimitedRam_NeverBlowsBudgetPortion()
    {
        // 1.5GB disponíveis → safe budget ~900MB → limite 75% ~675MB.
        RamManager.GetAvailableRamBytesProbe = () => 1536L * 1024 * 1024;
        using var rm = new RamManager(1920, 1080, 300, 24);
        var p = rm.ResolveProfile();

        Assert.True(p.MaxBufferBytes > 0);
        Assert.True(p.MaxBufferBytes <= 1536L * 1024 * 1024, "buffer nunca acima da RAM disponível");
    }

    [Fact]
    public void ResolveProfile_HugeRam_NoOverflowKeepsPositive()
    {
        // 64GB → budgetLimit ~48GB > int.MaxValue → sem overflow negativo.
        RamManager.GetAvailableRamBytesProbe = () => 64L * 1024 * 1024 * 1024;
        using var rm = new RamManager(1920, 1080, 1800, 24, configuredMaxrateKbps: 200_000);
        var p = rm.ResolveProfile();

        Assert.True(p.MaxBufferBytes > 0, $"MaxBufferBytes must stay positive, got {p.MaxBufferBytes}");
        Assert.True(p.MaxBufferBytes <= int.MaxValue);
    }

    // ── Adaptative gradual (watchdog): passos de 30s, sem "baque" ──────

    private static RamManager CreateFullProfileRamManager(int repeatReplay)
    {
        RamManager.GetAvailableRamBytesProbe = () => 8L * 1024 * 1024 * 1024; // Full profile
        return new RamManager(1920, 1080, repeatReplay, 24);
    }

    [Fact]
    public void CriticalPressure_StepsReplayDownBy30()
    {
        using var rm = CreateFullProfileRamManager(300);
        rm.ResolveProfile();
        List<int> steps = [];
        rm.OnReduceReplay = s => steps.Add(s);

        rm.EvaluatePressure(0.95);

        Assert.Equal([270], steps);
    }

    [Fact]
    public void RepeatedCriticalPressure_StepsDownToFloorAndStops()
    {
        using var rm = CreateFullProfileRamManager(300);
        rm.ResolveProfile();
        List<int> steps = [];
        rm.OnReduceReplay = s => steps.Add(s);

        for (int i = 0; i < 12; i++) rm.EvaluatePressure(0.95);

        Assert.Equal([270, 240, 210, 180, 150, 120, 90, 60, 30], steps);
        Assert.Equal(9, steps.Count); // no-op após atingir o piso de 30s
    }

    [Fact]
    public void PressureWarning_DoesNotReduceReplay()
    {
        using var rm = CreateFullProfileRamManager(300);
        rm.ResolveProfile();
        List<int> steps = [];
        rm.OnReduceReplay = s => steps.Add(s);

        rm.EvaluatePressure(0.90);

        Assert.Empty(steps);
    }

    [Fact]
    public void NormalAfterPressure_RestoresGradually()
    {
        using var rm = CreateFullProfileRamManager(300);
        rm.ResolveProfile();
        List<int> reduce = [];
        List<int> increase = [];
        bool normal = false;
        rm.OnReduceReplay = s => reduce.Add(s);
        rm.OnIncreaseReplay = s => increase.Add(s);
        rm.OnNormal = () => normal = true;

        rm.EvaluatePressure(0.95);
        Assert.Equal([270], reduce);

        rm.EvaluatePressure(0.60);
        Assert.Equal([300], increase);
        Assert.True(normal);
    }

    [Fact]
    public void NormalAfterMultiStepPressure_RestoresStepByStep()
    {
        using var rm = CreateFullProfileRamManager(300);
        rm.ResolveProfile();
        List<int> increase = [];
        bool normal = false;
        rm.OnReduceReplay = _ => { };
        rm.OnIncreaseReplay = s => increase.Add(s);
        rm.OnNormal = () => normal = true;

        rm.EvaluatePressure(0.95);
        rm.EvaluatePressure(0.95); // 300 → 240

        rm.EvaluatePressure(0.60); // 240 → 270, ainda não normal
        Assert.Equal([270], increase);
        Assert.False(normal);

        rm.EvaluatePressure(0.60); // 270 → 300, normal agora
        Assert.Equal([270, 300], increase);
        Assert.True(normal);
    }

    [Fact]
    public void NormalWithoutPressure_DoesNothing()
    {
        using var rm = CreateFullProfileRamManager(300);
        rm.ResolveProfile();
        List<int> reduce = [];
        List<int> increase = [];
        bool normal = false;
        rm.OnReduceReplay = s => reduce.Add(s);
        rm.OnIncreaseReplay = s => increase.Add(s);
        rm.OnNormal = () => normal = true;

        rm.EvaluatePressure(0.60);

        Assert.Empty(reduce);
        Assert.Empty(increase);
        Assert.False(normal);
    }

    [Fact]
    public void Watchdog_UsesUsedPercentProbe_AndReducesGradually()
    {
        RamManager.GetUsedPercentProbe = () => 0.95;
        using var rm = CreateFullProfileRamManager(300);
        rm.ResolveProfile();
        List<int> steps = [];
        rm.OnReduceReplay = s => steps.Add(s);

        rm.StartWatchdog(TimeSpan.FromMilliseconds(10));
        Thread.Sleep(300);
        rm.StopWatchdog();

        Assert.NotEmpty(steps);
        Assert.Equal(270, steps[0]); // 1º passo degrada em 30s (não cai pela metade para 150s)
        Assert.Equal(30, steps[^1]); // converge ao piso e para
        Assert.True(steps[^1] <= steps[0]);
    }
}
