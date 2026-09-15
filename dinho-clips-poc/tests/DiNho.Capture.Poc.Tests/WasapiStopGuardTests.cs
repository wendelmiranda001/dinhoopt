using System.Diagnostics;
using DiNho.Capture.Poc.Audio;

namespace DiNho.Capture.Poc.Tests;

// Guarda de teardown do WasapiRecorder: o Join da NAudio pode travar para sempre
// em endpoints mortos. O mecanismo testável é RunBounded (bounded + não-bloqueante)
// e o ciclo DisposalQueue/SweepOnce (retry sem leak). Tudo que exige WasapiRecorder
// real (WASAPI) é HW-bound e fica coberto pelos testes de lifecycle pass-and-skip.
public sealed class WasapiStopGuardTests : IDisposable
{
    public WasapiStopGuardTests()
    {
        WasapiStopGuard.AutoSweepEnabled = false; // teste dirige SweepOnce manualmente
    }

    public void Dispose()
    {
        WasapiStopGuard.AutoSweepEnabled = true;
    }

    [Fact]
    public void RunBounded_QuickWork_ReturnsTrue()
    {
        bool ran = false;
        bool result = WasapiStopGuard.RunBounded(() => ran = true, TimeSpan.FromSeconds(1), "Test");
        Assert.True(result);
        Assert.True(ran);
    }

    [Fact]
    public void RunBounded_BlockingWork_ReturnsFalseWithoutHanging()
    {
        var sw = Stopwatch.StartNew();
        bool result = WasapiStopGuard.RunBounded(() => Thread.Sleep(30_000), TimeSpan.FromMilliseconds(300), "Test");

        Assert.False(result);
        Assert.True(sw.ElapsedMilliseconds < 3000, $"elapsed={sw.ElapsedMilliseconds}ms");
    }

    [Fact]
    public void RunBounded_ThrowingWork_DoesNotPropagate()
    {
        bool result = WasapiStopGuard.RunBounded(
            () => throw new InvalidOperationException("boom"), TimeSpan.FromSeconds(1), "Test");
        Assert.True(result);
    }

    [Fact]
    public void DeferRetry_SweepOnce_DrainsQueue()
    {
        int runCount = 0;
        WasapiStopGuard.DeferRetry(() => runCount++, "Test");

        bool drained = WasapiStopGuard.SweepOnce();

        Assert.True(drained);
        Assert.Equal(0, WasapiStopGuard.PendingRetryCount);
        Assert.Equal(1, runCount);
    }

    [Fact]
    public void SweepOnce_BlockedItem_IsReEnqueuedForNextRound()
    {
        int runCount = 0;
        WasapiStopGuard.DeferRetry(() => { runCount++; Thread.Sleep(30_000); }, "Test");

        bool drained = WasapiStopGuard.SweepOnce();

        Assert.False(drained);
        Assert.True(WasapiStopGuard.PendingRetryCount >= 1, "item que voltou a estourar o tempo deve ser reenfileirado");
        Assert.Equal(1, runCount);
    }
}