using System.Runtime;
using DiNho.Capture.Poc.Memory;

namespace DiNho.Capture.Poc.Tests;

public sealed class WorkingSetTrimmerTests : IDisposable
{
    private readonly Action _originalCollect = WorkingSetTrimmer.CollectGen2Probe;
    private readonly Action _originalTrimWs = WorkingSetTrimmer.SetProcessWorkingSetSizeProbe;
    private readonly Func<DateTime> _originalNow = WorkingSetTrimmer.NowProbe;
    private readonly TimeSpan _originalInterval = WorkingSetTrimmer.MinimumInterval;

    public WorkingSetTrimmerTests()
    {
        WorkingSetTrimmer.CollectGen2Probe = () => { };
        WorkingSetTrimmer.SetProcessWorkingSetSizeProbe = () => { };
        WorkingSetTrimmer.NowProbe = () => DateTime.UnixEpoch;
        WorkingSetTrimmer.LastTrimUtc = null;
    }

    public void Dispose()
    {
        WorkingSetTrimmer.CollectGen2Probe = _originalCollect;
        WorkingSetTrimmer.SetProcessWorkingSetSizeProbe = _originalTrimWs;
        WorkingSetTrimmer.NowProbe = _originalNow;
        WorkingSetTrimmer.MinimumInterval = _originalInterval;
        WorkingSetTrimmer.LastTrimUtc = null;
    }

    [Fact]
    public void Trim_SetsCompactOnce_BeforeCollect()
    {
        // Coleta no-op injectada: o CompactOnce não é consumido e deve estar
        // visível após o Trim — prova que a compactação LOH é configurada.
        WorkingSetTrimmer.Trim();

        Assert.Equal(
            GCLargeObjectHeapCompactionMode.CompactOnce,
            GCSettings.LargeObjectHeapCompactionMode);
    }

    [Fact]
    public void Trim_ForcesGen2Collection()
    {
        var before = GC.CollectionCount(2);

        // Coleta real (probe de working set no-op, coleta padrão).
        WorkingSetTrimmer.CollectGen2Probe = _originalCollect;
        WorkingSetTrimmer.Trim();

        Assert.True(GC.CollectionCount(2) > before, "gen2 collection count must increase after Trim");
    }

    [Fact]
    public void Trim_CallsSetProcessWorkingSetSize()
    {
        var called = 0;
        WorkingSetTrimmer.SetProcessWorkingSetSizeProbe = () => called++;

        WorkingSetTrimmer.Trim();

        Assert.Equal(1, called);
    }

    [Fact]
    public void Trim_ProbeThrows_DoesNotPropagate()
    {
        WorkingSetTrimmer.SetProcessWorkingSetSizeProbe = () => throw new InvalidOperationException("probe");

        var ex = Record.Exception(() => WorkingSetTrimmer.Trim());

        Assert.Null(ex);
    }

    // ── 6.9: throttle pós-save recente ──────────────────────────────

    [Fact]
    public void Trim_WhenNeverTrimmed_Runs()
    {
        int calls = 0;
        WorkingSetTrimmer.SetProcessWorkingSetSizeProbe = () => calls++;

        Assert.True(WorkingSetTrimmer.Trim());
        Assert.Equal(1, calls);
    }

    [Fact]
    public void Trim_SecondCallWithinInterval_Skips()
    {
        int calls = 0;
        WorkingSetTrimmer.SetProcessWorkingSetSizeProbe = () => calls++;
        WorkingSetTrimmer.NowProbe = () => DateTime.UnixEpoch;

        Assert.True(WorkingSetTrimmer.Trim());
        // Mesmo instante (0s depois) → dentro do intervalo → SKIP.
        Assert.False(WorkingSetTrimmer.Trim());
        Assert.Equal(1, calls);
    }

    [Fact]
    public void Trim_AfterInterval_TrimsAgain()
    {
        int calls = 0;
        WorkingSetTrimmer.SetProcessWorkingSetSizeProbe = () => calls++;
        WorkingSetTrimmer.NowProbe = () => DateTime.UnixEpoch;

        Assert.True(WorkingSetTrimmer.Trim());
        // +31s → fora do intervalo (30s) → trim de novo.
        WorkingSetTrimmer.NowProbe = () => DateTime.UnixEpoch.AddSeconds(31);
        Assert.True(WorkingSetTrimmer.Trim());
        Assert.Equal(2, calls);
    }

    [Fact]
    public void Trim_SaveThenBackgroundWithinWindow_ThrottledTogether()
    {
        int calls = 0;
        WorkingSetTrimmer.SetProcessWorkingSetSizeProbe = () => calls++;
        WorkingSetTrimmer.NowProbe = () => DateTime.UnixEpoch;

        // Pós-save (chamada 1)
        Assert.True(WorkingSetTrimmer.Trim());
        // Alt-tab/background logo depois → throttled, não dispara gen2 extra.
        Assert.False(WorkingSetTrimmer.Trim());
        Assert.Equal(1, calls);
    }

    [Fact]
    public void Trim_ProbeThrows_DoesNotRecordLastTrim()
    {
        WorkingSetTrimmer.NowProbe = () => DateTime.UnixEpoch;
        WorkingSetTrimmer.SetProcessWorkingSetSizeProbe = () => throw new InvalidOperationException("probe");

        // Trim falhou → não conta como trim recente.
        Assert.False(WorkingSetTrimmer.Trim());

        // Próximo Trim (mesmo instante) deve tentar de novo, não ser throttled.
        WorkingSetTrimmer.SetProcessWorkingSetSizeProbe = () => { };
        Assert.True(WorkingSetTrimmer.Trim());
    }
}
