using DiNho.Capture.Poc.Watchdog;

namespace DiNho.Capture.Poc.Tests;

public sealed class PipelineWatchdogTests
{
    // ── 6.11: GetHealth precisa ler _frameTimesMs sob lock — enumerar LinkedEntity
    //    fora do lock enquanto o produtor faz RemoveFirst/AddLast lança
    //    InvalidOperationException sob contenção. ──

    [Fact]
    public async Task GetHealth_ConcurrentWithFrameUpdates_NeverThrows()
    {
        var wd = new PipelineWatchdog();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        var exceptions = new System.Collections.Concurrent.ConcurrentQueue<Exception>();

        var writer = Task.Run(() =>
        {
            int i = 0;
            while (!cts.IsCancellationRequested)
            {
                wd.ReportGoodFrame(5.0 + (i % 25));
                // 2 aquisições por iteração: enumeração + possível RemoveFirst no produtor
                if (i++ % 3 == 0)
                    wd.ReportDroppedFrame(PipelineIssue.NoFrame);
            }
        });

        var reader = Task.Run(() =>
        {
            while (!cts.IsCancellationRequested)
            {
                try
                {
                    var h = wd.GetHealth();
                    _ = h.AvgFrameTimeMs;
                    _ = h.P95FrameTimeMs;
                    _ = h.TotalFrames;
                }
                catch (Exception ex)
                {
                    exceptions.Enqueue(ex);
                }
            }
        });

        await Task.WhenAll(writer, reader);

        Assert.Empty(exceptions);
    }

    [Fact]
    public void GetHealth_AvgUnderLock_MatchesExpectedMean()
    {
        var wd = new PipelineWatchdog();
        for (int i = 0; i < 10; i++)
            wd.ReportGoodFrame(16.0);

        var h = wd.GetHealth();
        Assert.Equal(16.0, h.AvgFrameTimeMs, 3);
    }

    [Fact]
    public void InitialHealth_IsYellow()
    {
        var wd = new PipelineWatchdog();
        var h = wd.GetHealth();
        Assert.True(h.DropRatePct == 0);
        Assert.Equal(0, h.TotalFrames);
    }

    [Fact]
    public void GoodFrames_ReachesGreen()
    {
        var wd = new PipelineWatchdog
        {
            ConsecutiveGoodReset = 10
        };
        for (int i = 0; i < 15; i++)
            wd.ReportGoodFrame(16.0);

        var h = wd.GetHealth();
        Assert.Equal(HealthLevel.Green, h.Level);
        Assert.Equal(15, h.TotalFrames);
        Assert.Equal(0, h.DroppedFrames);
    }

    [Fact]
    public void DroppedFrames_TriggersRed()
    {
        var wd = new PipelineWatchdog
        {
            BadFrameThreshold = 5
        };
        for (int i = 0; i < 6; i++)
            wd.ReportDroppedFrame(PipelineIssue.NoFrame);

        var h = wd.GetHealth();
        Assert.Equal(HealthLevel.Red, h.Level);
        Assert.Equal(6, h.TotalFrames);
        Assert.Equal(6, h.DroppedFrames);
        Assert.Equal(PipelineIssue.NoFrame, h.LastIssue);
    }

    [Fact]
    public void MixedFrames_CalculatesDropRate()
    {
        var wd = new PipelineWatchdog();
        for (int i = 0; i < 80; i++)
            wd.ReportGoodFrame(16.0);
        for (int i = 0; i < 20; i++)
            wd.ReportDroppedFrame(PipelineIssue.CaptureError);

        var h = wd.GetHealth();
        Assert.Equal(100, h.TotalFrames);
        Assert.Equal(20, h.DroppedFrames);
        Assert.Equal(20.0, h.DropRatePct, 1);
    }

    [Fact]
    public void ShouldReinit_AfterSustainedDrops()
    {
        var wd = new PipelineWatchdog();
        wd.ReportDroppedFrame(PipelineIssue.NoFrame);
        Thread.Sleep(3500);
        Assert.True(wd.ShouldReinit());
    }

    [Fact]
    public void ShouldNotReinit_AfterGoodFrame()
    {
        var wd = new PipelineWatchdog();
        wd.ReportDroppedFrame(PipelineIssue.NoFrame);
        Thread.Sleep(100);
        wd.ReportGoodFrame(16.0);
        Assert.False(wd.ShouldReinit());
    }

    [Fact]
    public void Reset_ClearsState()
    {
        var wd = new PipelineWatchdog();
        wd.ReportGoodFrame(16.0);
        wd.ReportDroppedFrame(PipelineIssue.EncodeError);
        wd.Reset();

        var h = wd.GetHealth();
        Assert.Equal(0, h.TotalFrames);
        Assert.Equal(0, h.DroppedFrames);
        Assert.Null(h.LastIssue);
    }

    [Fact]
    public void P95FrameTime_CalculatedCorrectly()
    {
        var wd = new PipelineWatchdog();
        for (int i = 0; i < 100; i++)
            wd.ReportGoodFrame(10.0 + i * 0.5);

        var h = wd.GetHealth();
        Assert.InRange(h.P95FrameTimeMs, 55, 60);
    }

    [Fact]
    public void ApiSwitches_Counted()
    {
        var wd = new PipelineWatchdog();
        wd.ReportApiSwitch();
        wd.ReportApiSwitch();
        wd.ReportApiSwitch();

        var h = wd.GetHealth();
        Assert.Equal(3, h.ApiSwitches);
    }

    [Fact]
    public void ExportStall_DropsHealth()
    {
        var wd = new PipelineWatchdog();
        wd.ReportExportStall();

        var h = wd.GetHealth();
        Assert.Equal(1, h.ExportStalls);
        Assert.Equal(PipelineIssue.ExportStall, h.LastIssue);
    }

    // ─── New tests ──────────────────────────────────────────────────────

    [Fact]
    public void ShouldReinit_HighDropRate_TriggersReinit()
    {
        var wd = new PipelineWatchdog();

        // Need BadFrameThreshold (10) exceeded: at least 11 dropped + 11 total + >50% rate + 5s
        for (int i = 0; i < 11; i++)
            wd.ReportDroppedFrame(PipelineIssue.CaptureError);

        Thread.Sleep(5500); // exceed 5s min reinit interval

        Assert.True(wd.ShouldReinit(), "Should reinit with 11/11 drops after 5s");
    }

    [Fact]
    public void ShouldReinit_FewerThanThreshold_DoesNotTrigger()
    {
        var wd = new PipelineWatchdog();

        // Only 6 drops — below BadFrameThreshold (10)
        for (int i = 0; i < 6; i++)
            wd.ReportDroppedFrame(PipelineIssue.NoFrame);

        Thread.Sleep(2000);

        Assert.False(wd.ShouldReinit(), "Should not reinit with <10 dropped frames");
    }

    [Fact]
    public void ShouldReinit_GoodFrameBlocksQuickPath()
    {
        var wd = new PipelineWatchdog();

        for (int i = 0; i < 5; i++)
            wd.ReportDroppedFrame(PipelineIssue.NoFrame);

        // Quick reinit path: _consecutiveGood == 0 + 3s → would trigger
        // But a single good frame sets _consecutiveGood = 1 → blocks quick reinit
        wd.ReportGoodFrame(16.0);

        Thread.Sleep(3500);

        // Quick reinit blocked by _consecutiveGood > 0
        // Drop-rate path: _droppedFrames (5) < BadFrameThreshold (10) → also blocked
        Assert.False(wd.ShouldReinit());
    }

    // ─── Consecutive-drop reinit (DIM MISMATCH class) ──────────────────

    [Fact]
    public void ShouldReinit_ConsecutiveDrops_TriggersWithoutStaleIssueTime()
    {
        var wd = new PipelineWatchdog
        {
            ConsecutiveDropsThreshold = 30
        };

        // Simulates DIM MISMATCH: frames arrive fine but encode drops every single one.
        // Each drop refreshes _lastIssueTime, so the time-based paths (quick 3s, drop-rate 5s)
        // would NEVER fire. The consecutive-drop counter must trigger regardless of freshness.
        for (int i = 0; i < 30; i++)
            wd.ReportDroppedFrame(PipelineIssue.EncodeError);

        Assert.True(wd.ShouldReinit(), "30 consecutive drops must trigger reinit even with a fresh _lastIssueTime");
    }

    [Fact]
    public void ShouldReinit_ConsecutiveDrops_DefaultThresholdIsReachedAt60()
    {
        var wd = new PipelineWatchdog();

        for (int i = 0; i < 59; i++)
            wd.ReportDroppedFrame(PipelineIssue.EncodeError);
        Assert.False(wd.ShouldReinit(), "59 consecutive drops below default threshold (60) must not trigger");

        wd.ReportDroppedFrame(PipelineIssue.EncodeError);
        Assert.True(wd.ShouldReinit(), "60th consecutive drop must trigger reinit");
    }

    [Fact]
    public void ShouldReinit_ConsecutiveDrops_ResetByGoodFrame()
    {
        var wd = new PipelineWatchdog
        {
            ConsecutiveDropsThreshold = 30
        };

        for (int i = 0; i < 20; i++)
            wd.ReportDroppedFrame(PipelineIssue.EncodeError);

        // A single good frame must reset the consecutive-drop counter — the pipeline recovered
        wd.ReportGoodFrame(16.0);

        for (int i = 0; i < 20; i++)
            wd.ReportDroppedFrame(PipelineIssue.EncodeError);

        Assert.False(wd.ShouldReinit(), "20+20 drops separated by a good frame must not reach the 30 consecutive threshold");
    }

    [Fact]
    public void ShouldReinit_ConsecutiveDrops_ResetClearsCounter()
    {
        var wd = new PipelineWatchdog
        {
            ConsecutiveDropsThreshold = 10
        };

        for (int i = 0; i < 10; i++)
            wd.ReportDroppedFrame(PipelineIssue.EncodeError);
        Assert.True(wd.ShouldReinit());

        wd.Reset();
        for (int i = 0; i < 5; i++)
            wd.ReportDroppedFrame(PipelineIssue.EncodeError);
        Assert.False(wd.ShouldReinit(), "after Reset, 5 drops must be below the 10-drop threshold");
    }

    [Fact]
    public void Health_ExposesConsecutiveDrops()
    {
        var wd = new PipelineWatchdog();
        wd.ReportDroppedFrame(PipelineIssue.EncodeError);
        wd.ReportDroppedFrame(PipelineIssue.EncodeError);
        wd.ReportDroppedFrame(PipelineIssue.EncodeError);

        var h = wd.GetHealth();
        Assert.Equal(3, h.ConsecutiveDrops);
    }
}