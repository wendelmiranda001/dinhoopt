using DiNho.Capture.Poc.Sync;

namespace DiNho.Capture.Poc.Tests;

public sealed class MasterClockTests
{
    [Fact]
    public void Now_Elapsed_Increases()
    {
        using var clock = new MasterClock();
        var t1 = clock.Now;
        Thread.Sleep(50);
        var t2 = clock.Now;
        Assert.True(t2 > t1, "Clock should advance");
    }

    [Fact]
    public void Now_TracksStopwatch_WithinTolerance()
    {
        using var clock = new MasterClock();
        var sw = System.Diagnostics.Stopwatch.StartNew();
        Thread.Sleep(100);
        var realElapsed = sw.Elapsed.TotalMilliseconds;
        var clockElapsed = clock.Now.TotalMilliseconds;
        Assert.InRange(clockElapsed, realElapsed - 15, realElapsed + 15);
    }

    [Fact]
    public void NowHns_Monotonic()
    {
        using var clock = new MasterClock();
        var hns1 = clock.NowHns;
        Thread.Sleep(10);
        var hns2 = clock.NowHns;
        Assert.True(hns2 >= hns1);
    }

    [Fact]
    public void FromTimestamp_AtCreation_ReturnsZero()
    {
        using var clock = new MasterClock();
        var ts = clock.FromTimestamp(clock.StartTimestamp);
        Assert.Equal(0, ts.TotalSeconds);
    }

    [Fact]
    public void FromTimestamp_OneSecondLater()
    {
        using var clock = new MasterClock();
        var freq = System.Diagnostics.Stopwatch.Frequency;
        var ts = clock.FromTimestamp(clock.StartTimestamp + freq);
        Assert.InRange(ts.TotalSeconds, 0.95, 1.05);
    }
}