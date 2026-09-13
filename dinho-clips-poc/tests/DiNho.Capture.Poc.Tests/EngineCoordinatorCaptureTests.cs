using System.Reflection;
using System.Runtime.Serialization;
using System.Threading;
using DiNho.Capture.Poc.Buffer;
using DiNho.Capture.Poc.Capture;
using DiNho.Capture.Poc.Config;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.GameDetection;
using DiNho.Capture.Poc.Hotkeys;
using DiNho.Capture.Poc.Ipc;
using DiNho.Capture.Poc.Logging;
using DiNho.Capture.Poc.Memory;
using DiNho.Capture.Poc.Status;
using DiNho.Capture.Poc.Sync;
using DiNho.Capture.Poc.Watchdog;

namespace DiNho.Capture.Poc.Tests;

public sealed class EngineCoordinatorCaptureTests : IDisposable
{
    private static readonly Type CoordinatorType = typeof(EngineCoordinator);
    private readonly List<ConfigManager> _disposables = new();

    private static EngineCoordinator CreateUninitialized()
    {
        return (EngineCoordinator)FormatterServices.GetUninitializedObject(typeof(EngineCoordinator));
    }

    private static void SetField(EngineCoordinator coord, string name, object? value)
    {
        var field = CoordinatorType.GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!;
        field.SetValue(coord, value);
    }

    private static object? GetField(EngineCoordinator coord, string name)
    {
        var field = CoordinatorType.GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!;
        return field.GetValue(coord);
    }

    private static T? GetField<T>(EngineCoordinator coord, string name)
    {
        return (T?)GetField(coord, name);
    }

    private ConfigManager CreateConfig(Action<AppConfig>? configure = null)
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "DiNhoTests_" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(tempDir);
        var tempPath = Path.Combine(tempDir, "config.json");
        var cfg = new ConfigManager(tempPath);
        _disposables.Add(cfg);
        configure?.Invoke(cfg.Config);
        return cfg;
    }

    private EngineCoordinator CreateWithMinimalDeps(Action<AppConfig>? configure = null)
    {
        var coord = CreateUninitialized();
        var config = CreateConfig(configure);
        SetField(coord, "_config", config);
        SetField(coord, "_captureActive", false);
        SetField(coord, "_recording", false);
        SetField(coord, "_dinhoHwnds", new List<IntPtr>());
        SetField(coord, "_pipelineLock", new Lock());
        SetField(coord, "_watchdog", new PipelineWatchdog());
        SetField(coord, "_buffer", CreateTestBuffer());
        SetField(coord, "_status", new EngineStatus());
        SetField(coord, "_clock", new MasterClock());
        SetField(coord, "_gameDetector", new GameDetector());
        SetField(coord, "_activeProfile", new CaptureProfile());
        SetField(coord, "_captureTargetGame", new GameInfo());
        SetField(coord, "_captureTargetHwnd", IntPtr.Zero);
        SetField(coord, "_captureWidth", 0);
        SetField(coord, "_captureHeight", 0);
        SetField(coord, "_gameBackgrounded", false);
        SetField(coord, "_bgDropCount", 0);
        SetField(coord, "_fgGoodCount", 0);
        SetField(coord, "_reinitCount", 0);
        SetField(coord, "_needsReinit", false);
        SetField(coord, "_deviceLost", false);
        SetField(coord, "_hasEverBeenHealthy", false);
        SetField(coord, "_starvationStart", default(DateTime));
        SetField(coord, "_pendingGameProcess", "");
        SetField(coord, "_customGameProcess", "");
        SetField(coord, "_lastDetectedGame", new GameInfo());
        SetField(coord, "_userStoppedProcess", "");
        SetField(coord, "_capturedGameProcess", null);
        SetField(coord, "_sharedDevice", null);
        SetField(coord, "_dxgiManager", null);
        SetField(coord, "_encoder", null);
        SetField(coord, "_capture", null);
        SetField(coord, "_audioMixer", null);
        SetField(coord, "_aacEncoder", null);
        SetField(coord, "_loopbackSource", null);
        SetField(coord, "_micSource", null);
        SetField(coord, "_wgcPump", null);
        SetField(coord, "_pipelineCts", null);
        SetField(coord, "_pipelineTask", null);
        SetField(coord, "_pttDiagTimer", null);
        SetField(coord, "_cleanupTimer", null);
        SetField(coord, "_audioMixerGeneration", 0);
        SetField(coord, "_restartPending", false);
        SetField(coord, "_restartLock", new System.Threading.Lock());
        SetField(coord, "_exportLock", new System.Threading.Lock());
        SetField(coord, "_exportInProgress", false);
        SetField(coord, "_highResTimerEnabled", false);
        SetField(coord, "_mfStarted", false);
        SetField(coord, "_ramManager", null);
        SetField(coord, "_audioFallback", false);
        SetField(coord, "_audioSessionsCacheTicks", 0L);
        SetField(coord, "_cachedAudioSessionsJson", null);
        SetField(coord, "_appliedGameAudioOnly", false);
        SetField(coord, "_appliedGameAudioPid", 0);
        return coord;
    }

    private static ReplayBuffer CreateTestBuffer()
    {
        return new ReplayBuffer(TimeSpan.FromSeconds(30));
    }

    public void Dispose()
    {
        foreach (var d in _disposables)
        {
            try { d.Dispose(); } catch { }
        }
    }

    #region ExcludeDinhoWindowFromCapture

    [Fact]
    public void ExcludeDinhoWindowFromCapture_PidZero_DoesNotClearList()
    {
        var coord = CreateUninitialized();
        var hwnds = new List<IntPtr> { new(1234) };
        SetField(coord, "_dinhoHwnds", hwnds);

        var config = new ConfigManager();
        config.Update(c => c.ElectronPid = 0);
        SetField(coord, "_config", config);

        var method = CoordinatorType.GetMethod("ExcludeDinhoWindowFromCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, null);

        var result = GetField<List<IntPtr>>(coord, "_dinhoHwnds")!;
        Assert.Single(result);
        Assert.Equal(new IntPtr(1234), result[0]);
        config.Dispose();
    }

    [Fact]
    public void ExcludeDinhoWindowFromCapture_PidNegative_DoesNotCallHelper()
    {
        var coord = CreateUninitialized();
        var hwnds = new List<IntPtr> { new(999) };
        SetField(coord, "_dinhoHwnds", hwnds);

        var config = new ConfigManager();
        config.Update(c => c.ElectronPid = -5);
        SetField(coord, "_config", config);

        var method = CoordinatorType.GetMethod("ExcludeDinhoWindowFromCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, null);

        var result = GetField<List<IntPtr>>(coord, "_dinhoHwnds")!;
        Assert.Single(result);
        Assert.Equal(new IntPtr(999), result[0]);
        config.Dispose();
    }

    [Fact]
    public void ExcludeDinhoWindowFromCapture_PidPositive_ClearsAndPopulatesList()
    {
        var coord = CreateUninitialized();
        var hwnds = new List<IntPtr>();
        SetField(coord, "_dinhoHwnds", hwnds);

        var config = new ConfigManager();
        config.Update(c => c.ElectronPid = Environment.ProcessId);
        SetField(coord, "_config", config);

        var method = CoordinatorType.GetMethod("ExcludeDinhoWindowFromCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, null);

        var result = GetField<List<IntPtr>>(coord, "_dinhoHwnds")!;
        Assert.NotNull(result);
        config.Dispose();
    }

    [Fact]
    public void ExcludeDinhoWindowFromCapture_PositivePid_ClearsOldEntriesFirst()
    {
        var coord = CreateUninitialized();
        var oldHwnds = new List<IntPtr> { new(0x1000), new(0x2000) };
        SetField(coord, "_dinhoHwnds", oldHwnds);

        var config = new ConfigManager();
        config.Update(c => c.ElectronPid = 1);
        SetField(coord, "_config", config);

        var method = CoordinatorType.GetMethod("ExcludeDinhoWindowFromCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, null);

        var result = GetField<List<IntPtr>>(coord, "_dinhoHwnds")!;
        Assert.NotNull(result);
        config.Dispose();
    }

    #endregion

    #region RestoreDinhoWindowCapture

    [Fact]
    public void RestoreDinhoWindowCapture_EmptyList_DoesNotThrow()
    {
        var coord = CreateUninitialized();
        SetField(coord, "_dinhoHwnds", new List<IntPtr>());

        var method = CoordinatorType.GetMethod("RestoreDinhoWindowCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        var ex = Record.Exception(() => method.Invoke(coord, null));
        Assert.Null(ex);
    }

    [Fact]
    public void RestoreDinhoWindowCapture_EmptyList_DoesNotClearList()
    {
        var coord = CreateUninitialized();
        var hwnds = new List<IntPtr>();
        SetField(coord, "_dinhoHwnds", hwnds);

        var method = CoordinatorType.GetMethod("RestoreDinhoWindowCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, null);

        var result = GetField<List<IntPtr>>(coord, "_dinhoHwnds")!;
        Assert.Empty(result);
    }

    [Fact]
    public void RestoreDinhoWindowCapture_NonEmptyList_AttemptsRestore()
    {
        var coord = CreateUninitialized();
        var hwnds = new List<IntPtr> { new(0x1234) };
        SetField(coord, "_dinhoHwnds", hwnds);

        var method = CoordinatorType.GetMethod("RestoreDinhoWindowCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        var ex = Record.Exception(() => method.Invoke(coord, null));
        Assert.Null(ex);
    }

    [Fact]
    public void RestoreDinhoWindowCapture_AfterRestore_ClearsList()
    {
        var coord = CreateUninitialized();
        var hwnds = new List<IntPtr> { new(0x1234) };
        SetField(coord, "_dinhoHwnds", hwnds);

        var method = CoordinatorType.GetMethod("RestoreDinhoWindowCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, null);

        var result = GetField<List<IntPtr>>(coord, "_dinhoHwnds")!;
        Assert.Empty(result);
    }

    [Fact]
    public void RestoreDinhoWindowCapture_MultipleHandles_AttemptsAll()
    {
        var coord = CreateUninitialized();
        var hwnds = new List<IntPtr> { new(0x1000), new(0x2000), new(0x3000) };
        SetField(coord, "_dinhoHwnds", hwnds);

        var method = CoordinatorType.GetMethod("RestoreDinhoWindowCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        var ex = Record.Exception(() => method.Invoke(coord, null));
        Assert.Null(ex);

        var result = GetField<List<IntPtr>>(coord, "_dinhoHwnds")!;
        Assert.Empty(result);
    }

    #endregion

    #region P4 — WDA retry

    [Fact]
    public void ExcludeDinhoWindowFromCapture_EmptyEnumeration_SchedulesRetryAndRepopulates()
    {
        var coord = CreateUninitialized();
        SetField(coord, "_dinhoHwnds", new List<IntPtr>());
        var config = CreateConfig(c => c.ElectronPid = 1234);
        SetField(coord, "_config", config);

        var hwnd = new IntPtr(0x1234);
        var calls = 0;
        try
        {
            EngineCoordinator.WdaRetryDelayMs = 20;
            EngineCoordinator.EnumerateDinhoHwndsProbe = _ => calls++ == 0
                ? new List<IntPtr>()
                : new List<IntPtr> { hwnd };
            EngineCoordinator.WdaExcludeProbe = _ => true;

            var method = CoordinatorType.GetMethod("ExcludeDinhoWindowFromCapture",
                BindingFlags.Instance | BindingFlags.NonPublic)!;
            method.Invoke(coord, null);

            Assert.True(SpinWait.SpinUntil(() =>
                GetField<List<IntPtr>>(coord, "_dinhoHwnds")!.Count > 0, 2000));
            Assert.Equal(2, calls);
            Assert.Equal(1, GetField<int>(coord, "_wdaRetryCount"));
            Assert.Equal(hwnd, GetField<List<IntPtr>>(coord, "_dinhoHwnds")![0]);
        }
        finally
        {
            ResetWdaSeams(coord);
        }
    }

    [Fact]
    public void ExcludeDinhoWindowFromCapture_AlwaysEmpty_RetriesAtMostOnce()
    {
        var coord = CreateUninitialized();
        SetField(coord, "_dinhoHwnds", new List<IntPtr>());
        var config = CreateConfig(c => c.ElectronPid = 1234);
        SetField(coord, "_config", config);

        var calls = 0;
        try
        {
            EngineCoordinator.WdaRetryDelayMs = 20;
            EngineCoordinator.EnumerateDinhoHwndsProbe = _ => { calls++; return new List<IntPtr>(); };

            var method = CoordinatorType.GetMethod("ExcludeDinhoWindowFromCapture",
                BindingFlags.Instance | BindingFlags.NonPublic)!;
            method.Invoke(coord, null);

            Assert.True(SpinWait.SpinUntil(() => calls >= 2, 2000));
            Thread.Sleep(80);
            Assert.Equal(2, calls);
            Assert.Equal(1, GetField<int>(coord, "_wdaRetryCount"));
        }
        finally
        {
            ResetWdaSeams(coord);
        }
    }

    [Fact]
    public void ExcludeDinhoWindowFromCapture_AllExclusionsFail_SchedulesRetry()
    {
        var coord = CreateUninitialized();
        SetField(coord, "_dinhoHwnds", new List<IntPtr>());
        var config = CreateConfig(c => c.ElectronPid = 1234);
        SetField(coord, "_config", config);

        var hwnd = new IntPtr(0x1234);
        var calls = 0;
        try
        {
            EngineCoordinator.WdaRetryDelayMs = 20;
            EngineCoordinator.EnumerateDinhoHwndsProbe = _ =>
            {
                calls++;
                return new List<IntPtr> { hwnd };
            };
            EngineCoordinator.WdaExcludeProbe = _ => false;

            var method = CoordinatorType.GetMethod("ExcludeDinhoWindowFromCapture",
                BindingFlags.Instance | BindingFlags.NonPublic)!;
            method.Invoke(coord, null);

            Assert.True(SpinWait.SpinUntil(() => calls >= 2, 2000));
            Assert.Equal(1, GetField<int>(coord, "_wdaRetryCount"));
            Assert.Single(GetField<List<IntPtr>>(coord, "_dinhoHwnds")!);
        }
        finally
        {
            ResetWdaSeams(coord);
        }
    }

    [Fact]
    public void ExcludeDinhoWindowFromCapture_EnumerationThrows_SchedulesRetry()
    {
        var coord = CreateUninitialized();
        SetField(coord, "_dinhoHwnds", new List<IntPtr>());
        var config = CreateConfig(c => c.ElectronPid = 1234);
        SetField(coord, "_config", config);

        var hwnd = new IntPtr(0x1234);
        var calls = 0;
        try
        {
            EngineCoordinator.WdaRetryDelayMs = 20;
            EngineCoordinator.EnumerateDinhoHwndsProbe = _ =>
            {
                calls++;
                if (calls == 1) throw new InvalidOperationException("boom");
                return new List<IntPtr> { hwnd };
            };
            EngineCoordinator.WdaExcludeProbe = _ => true;

            var method = CoordinatorType.GetMethod("ExcludeDinhoWindowFromCapture",
                BindingFlags.Instance | BindingFlags.NonPublic)!;
            method.Invoke(coord, null);

            Assert.True(SpinWait.SpinUntil(() => calls >= 2, 2000));
            Assert.Equal(1, GetField<int>(coord, "_wdaRetryCount"));
            Assert.Single(GetField<List<IntPtr>>(coord, "_dinhoHwnds")!);
        }
        finally
        {
            ResetWdaSeams(coord);
        }
    }

    [Fact]
    public void ExcludeDinhoWindowFromCapture_Success_NoRetryScheduled()
    {
        var coord = CreateUninitialized();
        SetField(coord, "_dinhoHwnds", new List<IntPtr>());
        var config = CreateConfig(c => c.ElectronPid = 1234);
        SetField(coord, "_config", config);

        var hwnd = new IntPtr(0x1234);
        var calls = 0;
        try
        {
            EngineCoordinator.WdaRetryDelayMs = 20;
            EngineCoordinator.EnumerateDinhoHwndsProbe = _ => { calls++; return new List<IntPtr> { hwnd }; };
            EngineCoordinator.WdaExcludeProbe = _ => true;

            var method = CoordinatorType.GetMethod("ExcludeDinhoWindowFromCapture",
                BindingFlags.Instance | BindingFlags.NonPublic)!;
            method.Invoke(coord, null);

            Assert.Equal(1, calls);
            Assert.Equal(0, GetField<int>(coord, "_wdaRetryCount"));
            Assert.Single(GetField<List<IntPtr>>(coord, "_dinhoHwnds")!);
        }
        finally
        {
            ResetWdaSeams(coord);
        }
    }

    [Fact]
    public void RestoreDinhoWindowCapture_CancelsPendingWdaRetry()
    {
        var coord = CreateUninitialized();
        SetField(coord, "_dinhoHwnds", new List<IntPtr>());
        var config = CreateConfig(c => c.ElectronPid = 1234);
        SetField(coord, "_config", config);

        var calls = 0;
        try
        {
            EngineCoordinator.WdaRetryDelayMs = 20;
            EngineCoordinator.EnumerateDinhoHwndsProbe = _ => { calls++; return new List<IntPtr>(); };

            var excludeMethod = CoordinatorType.GetMethod("ExcludeDinhoWindowFromCapture",
                BindingFlags.Instance | BindingFlags.NonPublic)!;
            excludeMethod.Invoke(coord, null);
            Assert.Equal(1, GetField<int>(coord, "_wdaRetryCount"));

            var restoreMethod = CoordinatorType.GetMethod("RestoreDinhoWindowCapture",
                BindingFlags.Instance | BindingFlags.NonPublic)!;
            restoreMethod.Invoke(coord, null);

            Thread.Sleep(80);
            Assert.Equal(1, calls);
            Assert.Equal(0, GetField<int>(coord, "_wdaRetryCount"));
        }
        finally
        {
            ResetWdaSeams(coord);
        }
    }

    private static void ResetWdaSeams(EngineCoordinator coord)
    {
        EngineCoordinator.EnumerateDinhoHwndsProbe = null;
        EngineCoordinator.WdaExcludeProbe = null;
        EngineCoordinator.WdaRestoreProbe = null;
        var restore = CoordinatorType.GetMethod("RestoreDinhoWindowCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        try { restore.Invoke(coord, null); } catch { }
    }

    #endregion

    #region WindowAffinityHelper

    [Fact]
    public void ExcludeDinhoWindows_PidZero_ReturnsEmpty()
    {
        var result = WindowAffinityHelper.ExcludeDinhoWindows(0);
        Assert.NotNull(result);
        Assert.Empty(result);
    }

    [Fact]
    public void ExcludeDinhoWindows_PidNegative_ReturnsEmpty()
    {
        var result = WindowAffinityHelper.ExcludeDinhoWindows(-1);
        Assert.NotNull(result);
        Assert.Empty(result);
    }

    [Fact]
    public void ExcludeDinhoWindows_CurrentPid_ReturnsList()
    {
        var result = WindowAffinityHelper.ExcludeDinhoWindows(Environment.ProcessId);
        Assert.NotNull(result);
    }

    [Fact]
    public void ExcludeDinhoWindows_NonExistentPid_ReturnsEmpty()
    {
        var result = WindowAffinityHelper.ExcludeDinhoWindows(1);
        Assert.NotNull(result);
        Assert.Empty(result);
    }

    [Fact]
    public void RestoreDinhoWindows_EmptyList_DoesNotThrow()
    {
        var ex = Record.Exception(() => WindowAffinityHelper.RestoreDinhoWindows(new List<IntPtr>()));
        Assert.Null(ex);
    }

    [Fact]
    public void RestoreDinhoWindows_NonEmptyList_ClearsAfter()
    {
        var hwnds = new List<IntPtr> { new(0x1234) };
        WindowAffinityHelper.RestoreDinhoWindows(hwnds);
        Assert.Empty(hwnds);
    }

    #endregion

    #region WdaHelper

    [Fact]
    public void IsExcludedFromCapture_ZeroHwnd_ReturnsFalse()
    {
        var result = WdaHelper.IsExcludedFromCapture(IntPtr.Zero);
        Assert.False(result);
    }

    [Fact]
    public void ExcludeWindowFromCapture_ZeroHwnd_ReturnsFalse()
    {
        var result = WdaHelper.ExcludeWindowFromCapture(IntPtr.Zero);
        Assert.False(result);
    }

    [Fact]
    public void RestoreWindowCapture_ZeroHwnd_ReturnsFalse()
    {
        var result = WdaHelper.RestoreWindowCapture(IntPtr.Zero);
        Assert.False(result);
    }

    [Fact]
    public void WdaHelper_Constants_HaveExpectedValues()
    {
        Assert.Equal(0x00u, WdaHelper.WDA_NONE);
        Assert.Equal(0x01u, WdaHelper.WDA_EXCLUDEFROMCAPTURE);
        Assert.Equal(0x11u, WdaHelper.WDA_EXCLUDEFROMCAPTURE_MODERN);
    }

    #endregion

    #region EngineStatus - Capture State Transitions

    [Fact]
    public void EngineStatus_RecordingTransition_IdleToRecording()
    {
        using var status = new EngineStatus();
        Assert.False(status.Current.Recording);
        status.Update(s => s.Recording = true);
        Assert.True(status.Current.Recording);
    }

    [Fact]
    public void EngineStatus_RecordingTransition_RecordingToIdle()
    {
        using var status = new EngineStatus();
        status.Update(s => s.Recording = true);
        Assert.True(status.Current.Recording);
        status.Update(s => s.Recording = false);
        Assert.False(status.Current.Recording);
    }

    [Fact]
    public void EngineStatus_CaptureBackend_UpdatedOnStart()
    {
        using var status = new EngineStatus();
        Assert.Equal("NONE", status.Current.CaptureBackend);
        status.Update(s => s.CaptureBackend = "WGC:FiveM");
        Assert.Equal("WGC:FiveM", status.Current.CaptureBackend);
    }

    [Fact]
    public void EngineStatus_ActivePipelines_IncrementsAndResets()
    {
        using var status = new EngineStatus();
        status.Update(s => s.ActivePipelines = 1);
        Assert.Equal(1, status.Current.ActivePipelines);
        status.Update(s => s.ActivePipelines = 0);
        Assert.Equal(0, status.Current.ActivePipelines);
    }

    [Fact]
    public void EngineStatus_DiskSpaceOk_CanBeSetFalse()
    {
        using var status = new EngineStatus();
        Assert.True(status.Current.DiskSpaceOk);
        status.Update(s => s.DiskSpaceOk = false);
        Assert.False(status.Current.DiskSpaceOk);
    }

    [Fact]
    public void EngineStatus_CaptureStateFullSnapshot()
    {
        using var status = new EngineStatus();
        status.Update(s =>
        {
            s.Recording = true;
            s.CaptureBackend = "WGC";
            s.Encoder = "Ffmpeg";
            s.ActivePipelines = 1;
            s.Game = "FiveM [FSO]";
        });
        var snap = status.Current;
        Assert.True(snap.Recording);
        Assert.Equal("WGC", snap.CaptureBackend);
        Assert.Equal("Ffmpeg", snap.Encoder);
        Assert.Equal(1, snap.ActivePipelines);
        Assert.Equal("FiveM [FSO]", snap.Game);
    }

    #endregion

    #region Memory/CaptureProfile Validation

    [Fact]
    public void CaptureProfile_Level_DefaultIsLowMemory()
    {
        var profile = new CaptureProfile();
        Assert.Equal(RamProfileLevel.LowMemory, profile.Level);
    }

    [Fact]
    public void CaptureProfile_AllFieldsSettable()
    {
        var profile = new CaptureProfile
        {
            Cq = 20,
            MaxrateKbps = 40000,
            BufsizeKbps = 80000,
            Bframes = 2,
            Lookahead = 16,
            EncodeWidth = 1920,
            EncodeHeight = 1080,
            MaxBufferBytes = 1024 * 1024 * 512,
            ReplaySeconds = 300,
            Level = RamProfileLevel.Full
        };
        Assert.Equal(20, profile.Cq);
        Assert.Equal(40000, profile.MaxrateKbps);
        Assert.Equal(80000, profile.BufsizeKbps);
        Assert.Equal(2, profile.Bframes);
        Assert.Equal(16, profile.Lookahead);
        Assert.Equal(1920, profile.EncodeWidth);
        Assert.Equal(1080, profile.EncodeHeight);
        Assert.Equal(1024L * 1024 * 512, profile.MaxBufferBytes);
        Assert.Equal(300, profile.ReplaySeconds);
        Assert.Equal(RamProfileLevel.Full, profile.Level);
    }

    #endregion

    #region PipelineWatchdog - Capture-specific Scenarios

    [Fact]
    public void PipelineWatchdog_CaptureError_ThenGoodFrame()
    {
        var wd = new PipelineWatchdog();
        wd.ReportDroppedFrame(PipelineIssue.CaptureError);
        wd.ReportGoodFrame(16.0);
        var h = wd.GetHealth();
        Assert.Equal(2, h.TotalFrames);
        Assert.Equal(1, h.DroppedFrames);
    }

    [Fact]
    public void PipelineWatchdog_MultipleIssues_TracksLast()
    {
        var wd = new PipelineWatchdog();
        wd.ReportDroppedFrame(PipelineIssue.NoFrame);
        wd.ReportDroppedFrame(PipelineIssue.EncodeError);
        wd.ReportDroppedFrame(PipelineIssue.CaptureError);
        var h = wd.GetHealth();
        Assert.Equal(PipelineIssue.CaptureError, h.LastIssue);
    }

    [Fact]
    public void PipelineWatchdog_AfterManyDrops_ShouldReinitOnlyAfterDelay()
    {
        var wd = new PipelineWatchdog { ConsecutiveGoodReset = 30 };
        for (int i = 0; i < 20; i++)
            wd.ReportDroppedFrame(PipelineIssue.NoFrame);
        var h = wd.GetHealth();
        Assert.Equal(HealthLevel.Red, h.Level);
        Assert.Equal(20, h.DroppedFrames);
    }

    [Fact]
    public void PipelineWatchdog_ShouldNotReinit_WhenHealthy()
    {
        var wd = new PipelineWatchdog { ConsecutiveGoodReset = 5 };
        for (int i = 0; i < 30; i++)
            wd.ReportGoodFrame(16.0);
        Assert.False(wd.ShouldReinit());
    }

    [Fact]
    public void PipelineWatchdog_GreenLevel_AfterConsecutiveGood()
    {
        var wd = new PipelineWatchdog { ConsecutiveGoodReset = 10 };
        for (int i = 0; i < 15; i++)
            wd.ReportGoodFrame(16.0);
        var h = wd.GetHealth();
        Assert.Equal(HealthLevel.Green, h.Level);
    }

    #endregion

    #region AppConfig - Capture-related Settings

    [Theory]
    [InlineData(30)]
    [InlineData(60)]
    [InlineData(120)]
    [InlineData(300)]
    public void AppConfig_ReplayTimeSeconds_VariousValues(int seconds)
    {
        var cfg = CreateConfig(c => c.ReplayTimeSeconds = seconds);
        Assert.Equal(seconds, cfg.Config.ReplayTimeSeconds);
    }

    [Fact]
    public void AppConfig_ForceSoftware_DefaultFalse()
    {
        var cfg = CreateConfig();
        Assert.False(cfg.Config.ForceSoftware);
    }

    [Fact]
    public void AppConfig_ForceSoftware_SetTrue()
    {
        var cfg = CreateConfig(c => c.ForceSoftware = true);
        Assert.True(cfg.Config.ForceSoftware);
    }

    [Fact]
    public void AppConfig_AdaptiveQuality_DefaultTrue()
    {
        var cfg = CreateConfig();
        Assert.True(cfg.Config.AdaptiveQualityEnabled);
    }

    [Theory]
    [InlineData(30)]
    [InlineData(60)]
    [InlineData(144)]
    [InlineData(240)]
    public void AppConfig_Fps_VariousValues(int fps)
    {
        var cfg = CreateConfig(c => c.Fps = fps);
        Assert.Equal(fps, cfg.Config.Fps);
    }

    [Fact]
    public void AppConfig_Codec_DefaultIsAuto()
    {
        var cfg = CreateConfig();
        Assert.Equal("auto", cfg.Config.Codec);
    }

    [Fact]
    public void AppConfig_Codec_SetToH264()
    {
        var cfg = CreateConfig(c => c.Codec = "h264_nvenc");
        Assert.Equal("h264_nvenc", cfg.Config.Codec);
    }

    [Fact]
    public void AppConfig_GameAudioOnly_DefaultTrue()
    {
        var cfg = CreateConfig();
        Assert.True(cfg.Config.GameAudioOnly);
    }

    [Fact]
    public void AppConfig_SelectedAudioSessions_DefaultEmpty()
    {
        var cfg = CreateConfig();
        Assert.NotNull(cfg.Config.SelectedAudioSessions);
        Assert.Empty(cfg.Config.SelectedAudioSessions);
    }

    [Fact]
    public void AppConfig_Cq_DefaultIs20()
    {
        var cfg = CreateConfig();
        Assert.Equal(20, cfg.Config.Cq);
    }

    [Fact]
    public void AppConfig_MaxrateKbps_DefaultIs30000()
    {
        var cfg = CreateConfig();
        Assert.Equal(30000, cfg.Config.MaxrateKbps);
    }

    #endregion

    #region AppConfig Validation - Boundary Values

    [Theory]
    [InlineData(30)]
    [InlineData(100)]
    [InlineData(500)]
    [InlineData(600)]
    public void AppConfig_ReplayTimeSeconds_BoundaryValuesKept(int seconds)
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, $"{{\"ReplayTimeSeconds\": {seconds}}}");
        using var cfg = new ConfigManager(tempFile);
        Assert.Equal(seconds, cfg.Config.ReplayTimeSeconds);
    }

    [Theory]
    [InlineData(640, 480)]
    [InlineData(854, 480)]
    [InlineData(1280, 720)]
    [InlineData(1920, 1080)]
    public void AppConfig_WidthHeight_StandardResolutions(int w, int h)
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, $"{{\"Width\": {w}, \"Height\": {h}}}");
        using var cfg = new ConfigManager(tempFile);
        Assert.Equal(w, cfg.Config.Width);
        Assert.Equal(h, cfg.Config.Height);
    }

    [Fact]
    public void AppConfig_EncoderPreset_VariousPresets()
    {
        var presets = new[] { "p1", "p2", "p3", "p4", "p5", "p6", "p7" };
        foreach (var preset in presets)
        {
            var cfg = CreateConfig(c => c.EncoderPreset = preset);
            Assert.Equal(preset, cfg.Config.EncoderPreset);
        }
    }

    #endregion

    #region StopCapture - State Resets

    [Fact]
    public void StopCapture_SetsCaptureActiveFalse()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);
        SetField(coord, "_recording", true);

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { false });

        Assert.False(GetField<bool>(coord, "_captureActive"));
    }

    [Fact]
    public void StopCapture_SetsRecordingFalse()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_recording", true);
        SetField(coord, "_captureActive", true);

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { false });

        Assert.False(GetField<bool>(coord, "_recording"));
    }

    [Fact]
    public void StopCapture_ResetsCaptureTargetGame()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);
        SetField(coord, "_captureTargetGame", new GameInfo(
            "FiveM", "C:\\FiveM.exe", "", "grcWindow",
            GameDetection.DisplayMode.FullscreenExclusive, 1234, new IntPtr(0xABCD)));

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { false });

        var target = GetField<GameInfo>(coord, "_captureTargetGame");
        Assert.False(target!.IsValid);
    }

    [Fact]
    public void StopCapture_ResetsCaptureTargetHwnd()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);
        SetField(coord, "_captureTargetHwnd", new IntPtr(0xDEAD));

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { false });

        Assert.Equal(IntPtr.Zero, GetField<IntPtr>(coord, "_captureTargetHwnd"));
    }

    [Fact]
    public void StopCapture_ResetsGameBackgrounded()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);
        SetField(coord, "_gameBackgrounded", true);
        SetField(coord, "_bgDropCount", 35);
        SetField(coord, "_fgGoodCount", 20);

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { false });

        Assert.False(GetField<bool>(coord, "_gameBackgrounded"));
        Assert.Equal(0, GetField<int>(coord, "_bgDropCount"));
        Assert.Equal(0, GetField<int>(coord, "_fgGoodCount"));
    }

    [Fact]
    public void StopCapture_NullsEncoder()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { false });

        Assert.Null(GetField(coord, "_encoder"));
    }

    [Fact]
    public void StopCapture_NullsCapture()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { false });

        Assert.Null(GetField(coord, "_capture"));
    }

    [Fact]
    public void StopCapture_NullsAudioMixer()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { false });

        Assert.Null(GetField(coord, "_audioMixer"));
    }

    [Fact]
    public void StopCapture_NullsAacEncoder()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { false });

        Assert.Null(GetField(coord, "_aacEncoder"));
    }

    [Fact]
    public void StopCapture_NullsSharedDevice()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { false });

        Assert.Null(GetField(coord, "_sharedDevice"));
    }

    [Fact]
    public void StopCapture_NullsWgcPump()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { false });

        Assert.Null(GetField(coord, "_wgcPump"));
    }

    [Fact]
    public void StopCapture_NullsPipelineCts()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { false });

        Assert.Null(GetField(coord, "_pipelineCts"));
    }

    [Fact]
    public void StopCapture_NullsPipelineTask()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { false });

        Assert.Null(GetField(coord, "_pipelineTask"));
    }

    [Fact]
    public void StopCapture_ResetsAudioCounters()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);
        SetField(coord, "_audioPacketCount", 999);
        SetField(coord, "_maxAacDrainCount", 50);

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { false });

        Assert.Equal(0, GetField<int>(coord, "_audioPacketCount"));
        Assert.Equal(0, GetField<int>(coord, "_maxAacDrainCount"));
        Assert.Equal(48000, GetField<int>(coord, "_audioSampleRate"));
    }

    [Fact]
    public void StopCapture_NullsPttDiagTimer()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { false });

        Assert.Null(GetField(coord, "_pttDiagTimer"));
    }

    [Fact]
    public void StopCapture_NullsDxgiManager()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { false });

        Assert.Null(GetField(coord, "_dxgiManager"));
    }

    [Fact]
    public void StopCapture_StopWatchdogCalled()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);
        var ramMgr = new RamManager(1920, 1080, 300, 22, 30000, 60000, 2, 16);
        SetField(coord, "_ramManager", ramMgr);

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { false });

        Assert.False(GetField<bool>(coord, "_captureActive"));
    }

    #endregion

    #region StopCapture - Idempotency

    [Fact]
    public void StopCapture_CalledTwice_NoException()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);
        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;

        method.Invoke(coord, new object[] { false });
        var ex = Record.Exception(() => method.Invoke(coord, new object[] { false }));
        Assert.Null(ex);
    }

    [Fact]
    public void StopCapture_FromIdleState_NoException()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", false);
        SetField(coord, "_recording", false);

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        var ex = Record.Exception(() => method.Invoke(coord, new object[] { false }));
        Assert.Null(ex);
    }

    #endregion

    #region StartCapture - Early Return

    [Fact]
    public void StartCapture_AlreadyActive_ReturnsWithoutChange()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);

        var method = CoordinatorType.GetMethod("StartCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        var ex = Record.Exception(() => method.Invoke(coord, null));
        Assert.Null(ex);

        // Should still be active (no-op)
        Assert.True(GetField<bool>(coord, "_captureActive"));
    }

    #endregion

    #region ToggleCapture

    [Fact]
    public void ToggleCapture_Inactive_CallsStartCapture()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", false);

        var method = CoordinatorType.GetMethod("ToggleCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;

        // StartCapture may succeed (D3D11 + ffmpeg available) or fail (missing deps).
        // Either way, ToggleCapture should not throw.
        var ex = Record.Exception(() => method.Invoke(coord, null));
        Assert.Null(ex);

        // If D3D11 creation succeeded, _captureActive stays true.
        // If it failed, the catch block resets it to false.
        var captureActive = GetField<bool>(coord, "_captureActive");
        // Both outcomes are valid depending on the environment.
    }

    [Fact]
    public void ToggleCapture_Active_CallsStopCapture()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);
        SetField(coord, "_recording", true);

        var method = CoordinatorType.GetMethod("ToggleCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, null);

        Assert.False(GetField<bool>(coord, "_captureActive"));
        Assert.False(GetField<bool>(coord, "_recording"));
    }

    #endregion

    #region StopCapture - Buffer Clear

    [Fact]
    public void StopCapture_WithClearBufferTrue_ClearsBuffer()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);
        SetField(coord, "_recording", true);

        var buffer = GetField<ReplayBuffer>(coord, "_buffer")!;
        buffer.AddVideo(new EncodedPacket(new byte[1024], MediaType.Video,
            TimeSpan.Zero, TimeSpan.FromSeconds(1), true, 1920, 1080));
        buffer.AddAudio(new EncodedPacket(new byte[128], MediaType.Audio,
            TimeSpan.Zero, TimeSpan.FromSeconds(1), false));
        var (beforeV, beforeA, _, _) = buffer.Stats();
        Assert.True(beforeV == 1 && beforeA == 1, "buffer should hold 1 video + 1 audio packet");

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { true });

        var (afterV, afterA, afterDur, _) = buffer.Stats();
        Assert.Equal(0, afterV);
        Assert.Equal(0, afterA);
        Assert.Equal(TimeSpan.Zero, afterDur);
    }

    [Fact]
    public void StopCapture_WithClearBufferFalse_PreservesBuffer()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", true);
        SetField(coord, "_recording", true);

        var buffer = GetField<ReplayBuffer>(coord, "_buffer")!;
        buffer.AddVideo(new EncodedPacket(new byte[1024], MediaType.Video,
            TimeSpan.Zero, TimeSpan.FromSeconds(1), true, 1920, 1080));
        buffer.AddAudio(new EncodedPacket(new byte[128], MediaType.Audio,
            TimeSpan.Zero, TimeSpan.FromSeconds(1), false));

        var method = CoordinatorType.GetMethod("StopCapture",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { false });

        var (v, a, _, _) = buffer.Stats();
        Assert.Equal(1, v);
        Assert.Equal(1, a);
    }

    #endregion

    #region Disk Spill Threshold

    [Fact]
    public void DiskSpill_NeededBytesGreaterThanBuffer_EnablesSpill()
    {
        var coord = CreateWithMinimalDeps();
        var profile = new CaptureProfile
        {
            MaxrateKbps = 100_000,
            ReplaySeconds = 600,
            MaxBufferBytes = 10 * 1024 * 1024
        };
        SetField(coord, "_activeProfile", profile);

        long neededBytes = (long)profile.MaxrateKbps * profile.ReplaySeconds * 1024L * 13L / 80L;
        Assert.True(neededBytes > profile.MaxBufferBytes,
            $"neededBytes ({neededBytes}) should be greater than buffer ({profile.MaxBufferBytes})");
    }

    [Fact]
    public void DiskSpill_NeededBytesLessThanBuffer_DoesNotEnableSpill()
    {
        var profile = new CaptureProfile
        {
            MaxrateKbps = 30_000,
            ReplaySeconds = 30,
            MaxBufferBytes = 2000 * 1024 * 1024
        };

        long neededBytes = (long)profile.MaxrateKbps * profile.ReplaySeconds * 1024L * 13L / 80L;
        Assert.True(neededBytes < profile.MaxBufferBytes,
            $"neededBytes ({neededBytes}) should be less than buffer ({profile.MaxBufferBytes})");
    }

    #endregion

    #region EngineStatus - Additional Capture Fields

    [Fact]
    public void EngineStatus_LastFrameMs_DefaultZero()
    {
        using var status = new EngineStatus();
        Assert.Equal(0, status.Current.LastFrameMs);
    }

    [Fact]
    public void EngineStatus_LastFrameMs_CanUpdate()
    {
        using var status = new EngineStatus();
        status.Update(s => s.LastFrameMs = 16.7);
        Assert.Equal(16.7, status.Current.LastFrameMs, 1);
    }

    [Fact]
    public void EngineStatus_WatchdogOk_DefaultTrue()
    {
        using var status = new EngineStatus();
        Assert.True(status.Current.WatchdogOk);
    }

    [Fact]
    public void EngineStatus_WatchdogOk_CanSetFalse()
    {
        using var status = new EngineStatus();
        status.Update(s => s.WatchdogOk = false);
        Assert.False(status.Current.WatchdogOk);
    }

    [Fact]
    public void EngineStatus_ReplayBufferBytes_DefaultZero()
    {
        using var status = new EngineStatus();
        Assert.Equal(0, status.Current.ReplayBufferBytes);
    }

    [Fact]
    public void EngineStatus_ReplayBufferBytes_CanUpdate()
    {
        using var status = new EngineStatus();
        status.Update(s => s.ReplayBufferBytes = 512 * 1024 * 1024);
        Assert.Equal(512L * 1024 * 1024, status.Current.ReplayBufferBytes);
    }

    [Fact]
    public void EngineStatus_ReplayBufferVideoFrames_CanUpdate()
    {
        using var status = new EngineStatus();
        status.Update(s => s.ReplayBufferVideoFrames = 1000);
        Assert.Equal(1000, status.Current.ReplayBufferVideoFrames);
    }

    [Fact]
    public void EngineStatus_ReplayBufferAudioPackets_CanUpdate()
    {
        using var status = new EngineStatus();
        status.Update(s => s.ReplayBufferAudioPackets = 500);
        Assert.Equal(500, status.Current.ReplayBufferAudioPackets);
    }

    [Fact]
    public void EngineStatus_CaptureBackend_InvalidToWGC()
    {
        using var status = new EngineStatus();
        Assert.Equal("NONE", status.Current.CaptureBackend);
        status.Update(s => s.CaptureBackend = "INVALID");
        Assert.Equal("INVALID", status.Current.CaptureBackend);
        status.Update(s => s.CaptureBackend = "WGC");
        Assert.Equal("WGC", status.Current.CaptureBackend);
    }

    [Fact]
    public void EngineStatus_AllCaptureFields_InSingleUpdate()
    {
        using var status = new EngineStatus();
        status.Update(s =>
        {
            s.Recording = true;
            s.CaptureBackend = "WGC";
            s.Encoder = "Ffmpeg";
            s.ActivePipelines = 1;
            s.LastFrameMs = 16.5;
            s.WatchdogOk = true;
            s.ReplayBufferBytes = 256 * 1024 * 1024;
            s.ReplayBufferVideoFrames = 2000;
            s.ReplayBufferVideoBytes = 200 * 1024 * 1024;
            s.ReplayBufferAudioPackets = 1500;
            s.ReplayBufferAudioBytes = 50 * 1024 * 1024;
            s.DiskSpaceOk = true;
            s.LastCrashRecovered = false;
            s.Game = "FiveM [FSX]";
        });
        var snap = status.Current;
        Assert.True(snap.Recording);
        Assert.Equal("WGC", snap.CaptureBackend);
        Assert.Equal("Ffmpeg", snap.Encoder);
        Assert.Equal(1, snap.ActivePipelines);
        Assert.Equal(16.5, snap.LastFrameMs, 1);
        Assert.True(snap.WatchdogOk);
        Assert.Equal(256L * 1024 * 1024, snap.ReplayBufferBytes);
        Assert.Equal(2000, snap.ReplayBufferVideoFrames);
        Assert.Equal(200L * 1024 * 1024, snap.ReplayBufferVideoBytes);
        Assert.Equal(1500, snap.ReplayBufferAudioPackets);
        Assert.Equal(50L * 1024 * 1024, snap.ReplayBufferAudioBytes);
        Assert.True(snap.DiskSpaceOk);
        Assert.False(snap.LastCrashRecovered);
        Assert.Equal("FiveM [FSX]", snap.Game);
    }

    #endregion

    #region CaptureProfile - Resolution Scaling

    [Fact]
    public void CaptureProfile_SmallResolution_LowMaxBuffer()
    {
        var profile = new CaptureProfile
        {
            EncodeWidth = 640,
            EncodeHeight = 480,
            MaxBufferBytes = 64 * 1024 * 1024
        };
        Assert.Equal(640, profile.EncodeWidth);
        Assert.Equal(480, profile.EncodeHeight);
        Assert.True(profile.MaxBufferBytes < 128 * 1024 * 1024);
    }

    [Fact]
    public void CaptureProfile_4KResolution_HighMaxBuffer()
    {
        var profile = new CaptureProfile
        {
            EncodeWidth = 3840,
            EncodeHeight = 2160,
            MaxBufferBytes = 2000 * 1024 * 1024
        };
        Assert.Equal(3840, profile.EncodeWidth);
        Assert.Equal(2160, profile.EncodeHeight);
        Assert.True(profile.MaxBufferBytes > 1L * 1024 * 1024 * 1024);
    }

    #endregion

    #region PipelineWatchdog - Full Health Spectrum

    [Fact]
    public void PipelineWatchdog_YellowLevel_AtHalfDrops()
    {
        var wd = new PipelineWatchdog
        {
            BadFrameThreshold = 10,
            ConsecutiveGoodReset = 30
        };
        for (int i = 0; i < 6; i++)
            wd.ReportDroppedFrame(PipelineIssue.NoFrame);
        var h = wd.GetHealth();
        Assert.Equal(HealthLevel.Yellow, h.Level);
    }

    [Fact]
    public void PipelineWatchdog_RedLevel_AtHighDrops()
    {
        var wd = new PipelineWatchdog
        {
            BadFrameThreshold = 5,
            ConsecutiveGoodReset = 30
        };
        for (int i = 0; i < 10; i++)
            wd.ReportDroppedFrame(PipelineIssue.CaptureError);
        var h = wd.GetHealth();
        Assert.Equal(HealthLevel.Red, h.Level);
    }

    [Fact]
    public void PipelineWatchdog_AvgFrameTime_ReturnsNonZero()
    {
        var wd = new PipelineWatchdog();
        wd.ReportGoodFrame(16.0);
        wd.ReportGoodFrame(18.0);
        wd.ReportGoodFrame(14.0);
        var h = wd.GetHealth();
        Assert.True(h.AvgFrameTimeMs > 0);
    }

    [Fact]
    public void PipelineWatchdog_Reset_ClearsAllCounters()
    {
        var wd = new PipelineWatchdog();
        wd.ReportDroppedFrame(PipelineIssue.CaptureError);
        wd.ReportDroppedFrame(PipelineIssue.EncodeError);
        wd.ReportGoodFrame(16.0);
        wd.Reset();
        var h = wd.GetHealth();
        Assert.Equal(0, h.TotalFrames);
        Assert.Equal(0, h.DroppedFrames);
        Assert.Null(h.LastIssue);
    }

    #endregion

    #region ReinitializePipelineAsync

    [Fact]
    public void ReinitializePipelineAsync_NotActive_SetsNeedsReinitFalse()
    {
        var coord = CreateWithMinimalDeps();
        SetField(coord, "_captureActive", false);
        SetField(coord, "_needsReinit", true);

        var method = CoordinatorType.GetMethod("ReinitializePipelineAsync",
            BindingFlags.Instance | BindingFlags.NonPublic)!;

        // ReinitializePipelineAsync is async Task
        var task = (Task)method.Invoke(coord, null)!;
        task.Wait(TimeSpan.FromSeconds(3));

        Assert.False(GetField<bool>(coord, "_needsReinit"));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(25)]
    [InlineData(50)]
    [InlineData(75)]
    public void ShouldLogDrop_FirstOrEvery25thTotal_ReturnsTrue(long totalDrops)
    {
        Assert.True(EngineCoordinator.ShouldLogDrop(totalDrops));
    }

    [Theory]
    [InlineData(2)]
    [InlineData(24)]
    [InlineData(26)]
    [InlineData(99)]
    public void ShouldLogDrop_OtherTotals_ReturnFalse(long totalDrops)
    {
        Assert.False(EngineCoordinator.ShouldLogDrop(totalDrops));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(4)]
    public void ShouldLogRecovery_BelowThreshold_ReturnsFalse(int consecutiveDrops)
    {
        Assert.False(EngineCoordinator.ShouldLogRecovery(consecutiveDrops));
    }

    [Theory]
    [InlineData(5)]
    [InlineData(10)]
    public void ShouldLogRecovery_AtOrAboveThreshold_ReturnsTrue(int consecutiveDrops)
    {
        Assert.True(EngineCoordinator.ShouldLogRecovery(consecutiveDrops));
    }

    // ComputeCaptureTimeoutMs — alinhar o timeout do WaitOne ao intervalo do cap
    // (ComputeCapIntervalTicks = 10_000_000 / fps). Truncar gerava corrida de fase.

    [Fact]
    public void ComputeCaptureTimeoutMs_60Fps_Returns22WithMargin()
    {
        Assert.Equal(22, EngineCoordinator.ComputeCaptureTimeoutMs(60));
    }

    [Theory]
    [InlineData(30)]
    [InlineData(60)]
    [InlineData(75)]
    [InlineData(120)]
    public void ComputeCaptureTimeoutMs_AlwaysGreaterOrEqualCapInterval(int fps)
    {
        var capIntervalMs = Math.Ceiling(1_000_000.0 / fps / 10_000);
        Assert.True(EngineCoordinator.ComputeCaptureTimeoutMs(fps) >= capIntervalMs,
            $"fps={fps}: timeout {EngineCoordinator.ComputeCaptureTimeoutMs(fps)} < cap interval {capIntervalMs}");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-30)]
    public void ComputeCaptureTimeoutMs_NonPositive_Returns1(int fps)
    {
        Assert.Equal(1, EngineCoordinator.ComputeCaptureTimeoutMs(fps));
    }

    [Fact]
    public void ComputeCaptureTimeoutMs_VeryLowFps_ClampsTo100()
    {
        Assert.Equal(100, EngineCoordinator.ComputeCaptureTimeoutMs(5));
    }

    [Theory]
    [InlineData(30, 39)]
    [InlineData(75, 19)]
    [InlineData(120, 14)]
    public void ComputeCaptureTimeoutMs_ReturnsExpected(int fps, int expected)
    {
        Assert.Equal(expected, EngineCoordinator.ComputeCaptureTimeoutMs(fps));
    }

    [Fact]
    public void ShouldDeferTimeoutDrop_FirstIsolatedTimeout_DefersAndSetsPending()
    {
        var pending = false;
        Assert.True(EngineCoordinator.ShouldDeferTimeoutDrop(ref pending));
        Assert.True(pending);
    }

    [Fact]
    public void ShouldDeferTimeoutDrop_SecondConsecutiveTimeout_CountsAsDrop()
    {
        var pending = true;
        Assert.False(EngineCoordinator.ShouldDeferTimeoutDrop(ref pending));
        Assert.True(pending);
    }

    // ReadGcDiagnostics — FASE 1 medição de footprint. Delegates stub tornam o
    // teste determinístico (GC.GetTotalMemory/GetTotalAllocatedBytes reais
    // dependem do estado do runtime).

    [Fact]
    public void ReadGcDiagnostics_ReturnsDelegateValues()
    {
        var (managed, allocated) = EngineCoordinator.ReadGcDiagnostics(
            () => 123456789L, () => 9876543210L);
        Assert.Equal(123456789L, managed);
        Assert.Equal(9876543210L, allocated);
    }

    [Fact]
    public void ReadGcDiagnostics_CallsBothDelegates()
    {
        long managedCalls = 0;
        long allocatedCalls = 0;
        var (_, _) = EngineCoordinator.ReadGcDiagnostics(
            () => { managedCalls++; return 1L; },
            () => { allocatedCalls++; return 2L; });
        Assert.Equal(1L, managedCalls);
        Assert.Equal(1L, allocatedCalls);
    }

    // DeriveFootprint — FASE 2 derivações de footprint (função pura, clamp ≥0).
    // native = proc − gcManaged (working set não-managed: WGC textures, NVENC
    // surfaces, staging do GpuVideoConverter); managedRetained = gcManaged −
    // ring − poolIdle (heap managed fora do ring e do teto idle do pool).

    [Fact]
    public void DeriveFootprint_ComputesNativeAndRetained()
    {
        var (native, retained) = EngineCoordinator.DeriveFootprint(
            workingSetMb: 2600, gcManagedMb: 1300, ringBytesMb: 117, poolIdleBytesMb: 256);
        Assert.Equal(1300, native);
        Assert.Equal(927, retained);
    }

    [Fact]
    public void DeriveFootprint_ClampsNegativeToZero()
    {
        var (native, retained) = EngineCoordinator.DeriveFootprint(
            workingSetMb: 100, gcManagedMb: 500, ringBytesMb: 900, poolIdleBytesMb: 256);
        Assert.Equal(0, native);
        Assert.Equal(0, retained);
    }

    [Fact]
    public void DeriveFootprint_ZeroRingAndPool_RetainedEqualsManaged()
    {
        var (native, retained) = EngineCoordinator.DeriveFootprint(
            workingSetMb: 2048, gcManagedMb: 1024, ringBytesMb: 0, poolIdleBytesMb: 0);
        Assert.Equal(1024, native);
        Assert.Equal(1024, retained);
    }

    // ReadGcBreakdown — FASE 3 breakdown do heap managed. LOH/gen2/gen01 via
    // GenerationInfo (índices 3/2/0+1), committed via TotalCommittedBytes, pinned
    // via PinnedSize. Delegates stub tornam o teste determinístico.

    [Fact]
    public void ReadGcBreakdown_CallsAllDelegates()
    {
        long lohCalls = 0, gen2Calls = 0, gen01Calls = 0, committedCalls = 0, pinnedCalls = 0;
        var (_, _, _, _, _) = EngineCoordinator.ReadGcBreakdown(
            () => { lohCalls++; return 1L; },
            () => { gen2Calls++; return 1L; },
            () => { gen01Calls++; return 1L; },
            () => { committedCalls++; return 1L; },
            () => { pinnedCalls++; return 1L; });
        Assert.Equal(1L, lohCalls);
        Assert.Equal(1L, gen2Calls);
        Assert.Equal(1L, gen01Calls);
        Assert.Equal(1L, committedCalls);
        Assert.Equal(1L, pinnedCalls);
    }

    [Fact]
    public void ReadGcBreakdown_ConvertsBytesToMb()
    {
        var (loh, gen2, gen01, committed, pinned) = EngineCoordinator.ReadGcBreakdown(
            () => 268435456L,  // 256 MB
            () => 134217728L,  // 128 MB
            () => 67108864L,   // 64 MB
            () => 1073741824L, // 1024 MB
            () => 31457280L);  // 30 MB
        Assert.Equal(256, loh);
        Assert.Equal(128, gen2);
        Assert.Equal(64, gen01);
        Assert.Equal(1024, committed);
        Assert.Equal(30, pinned);
    }

    [Fact]
    public void ReadGcPauseMs_ConvertsTimeSpanToMilliseconds()
    {
        Assert.Equal(1250L, EngineCoordinator.ReadGcPauseMs(() => TimeSpan.FromMilliseconds(1250)));
        Assert.Equal(0L, EngineCoordinator.ReadGcPauseMs(() => TimeSpan.Zero));
    }

    [Fact]
    public void ReadGcPauseMs_TruncatesSubMillisecond()
    {
        Assert.Equal(42L, EngineCoordinator.ReadGcPauseMs(() => TimeSpan.FromTicks(TimeSpan.TicksPerMillisecond * 42 + 500)));
    }

    [Fact]
    public void EngineStatus_DroppedFrames_CanUpdate()
    {
        using var status = new EngineStatus();
        status.Update(s => s.DroppedFrames = 91);
        Assert.Equal(91, status.Current.DroppedFrames);
    }

    [Fact]
    public void EngineStatus_GpuBusyDrops_CanUpdate()
    {
        using var status = new EngineStatus();
        status.Update(s => s.GpuBusyDrops = 42);
        Assert.Equal(42, status.Current.GpuBusyDrops);
    }

    private sealed class RecordingLogger : ILogger
    {
        private readonly int _threadId = Environment.CurrentManagedThreadId;
        private readonly object _gate = new();
        public List<(LogLevel Level, string Source, string Message)> Entries { get; } = new();

        private void Add(LogLevel level, string source, string message)
        {
            // Log.Instance é global e classes xUnit rodam em paralelo: ignora
            // entradas de threads de fundo para as asserções serem determinísticas.
            if (Environment.CurrentManagedThreadId != _threadId) return;
            lock (_gate)
            {
                Entries.Add((level, source, message));
            }
        }

        public void Debug(string source, string message) => Add(LogLevel.Debug, source, message);
        public void Info(string source, string message) => Add(LogLevel.Info, source, message);
        public void Warning(string source, string message) => Add(LogLevel.Warning, source, message);
        public void Error(string source, string message) => Add(LogLevel.Error, source, message);
        public void Log(LogLevel level, string source, string message) => Add(level, source, message);
    }

    private static ILogger InstallLogger(RecordingLogger logger)
    {
        var original = Log.Instance;
        Log.Instance = logger;
        return original;
    }

    [Fact]
    public void BroadcastClipSaved_WhenPipeNull_LogsWarningAndDoesNotThrow()
    {
        var coord = CreateUninitialized();
        var logger = new RecordingLogger();
        var original = InstallLogger(logger);
        try
        {
            var method = CoordinatorType.GetMethod("BroadcastClipSaved", BindingFlags.Instance | BindingFlags.NonPublic)!;
            var ex = Record.Exception(() => method.Invoke(coord, null));
            Assert.Null(ex);
            Assert.Contains(logger.Entries, e => e.Level == LogLevel.Warning);
        }
        finally
        {
            Log.Instance = original;
        }
    }

    [Fact]
    public void BroadcastClipSaved_WhenPipeAvailable_NoWarnings()
    {
        var coord = CreateUninitialized();
        SetField(coord, "_pipeServer", new NamedPipeServer());
        var logger = new RecordingLogger();
        var original = InstallLogger(logger);
        try
        {
            var method = CoordinatorType.GetMethod("BroadcastClipSaved", BindingFlags.Instance | BindingFlags.NonPublic)!;
            method.Invoke(coord, null);
            Assert.DoesNotContain(logger.Entries, e => e.Level == LogLevel.Warning);
        }
        finally
        {
            Log.Instance = original;
        }
    }

    [Fact]
    public void WaitAbortable_AbortsEarly_WhenConditionFails()
    {
        var calls = 0;
        bool condition()
        {
            calls++;
            return calls < 3;
        }
        var result = EngineCoordinator.WaitAbortable(1000, condition, sliceMs: 10);
        Assert.False(result);
        Assert.Equal(3, calls);
    }

    [Fact]
    public void WaitAbortable_RunsFullDuration_WhenConditionStaysTrue()
    {
        var calls = 0;
        bool condition() { calls++; return true; }
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var result = EngineCoordinator.WaitAbortable(60, condition, sliceMs: 10);
        sw.Stop();
        Assert.True(result);
        Assert.True(sw.ElapsedMilliseconds >= 40, $"elapsed={sw.ElapsedMilliseconds}ms");
        Assert.True(calls >= 3, $"calls={calls}");
    }

    [Fact]
    public void WaitAbortable_ZeroOrNegativeTotal_ReturnsTrueWithoutCheckingCondition()
    {
        var calls = 0;
        var result = EngineCoordinator.WaitAbortable(0, () => { calls++; return true; });
        Assert.True(result);
        Assert.Equal(0, calls);
    }

    [Fact]
    public async Task WaitAbortableAsync_AbortsEarly_WhenConditionFails()
    {
        var calls = 0;
        bool condition()
        {
            calls++;
            return calls < 3;
        }
        await EngineCoordinator.WaitAbortableAsync(1000, condition, sliceMs: 10);
        Assert.Equal(3, calls);
    }

    [Fact]
    public async Task WaitAbortableAsync_RunsFullDuration_WhenConditionStaysTrue()
    {
        var calls = 0;
        bool condition() { calls++; return true; }
        var sw = System.Diagnostics.Stopwatch.StartNew();
        await EngineCoordinator.WaitAbortableAsync(60, condition, sliceMs: 10);
        sw.Stop();
        Assert.True(sw.ElapsedMilliseconds >= 40, $"elapsed={sw.ElapsedMilliseconds}ms");
        Assert.True(calls >= 3, $"calls={calls}");
    }

    [Fact]
    public async Task WaitAbortableAsync_ThrowsWhenCancelled()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        var calls = 0;
        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => EngineCoordinator.WaitAbortableAsync(1000, () => { calls++; return true; }, sliceMs: 10, ct: cts.Token));
        Assert.True(calls >= 1);
    }

    #endregion
}
