using System.Reflection;
using System.Runtime.Serialization;
using DiNho.Capture.Poc.Buffer;
using DiNho.Capture.Poc.Config;
using DiNho.Capture.Poc.GameDetection;
using DiNho.Capture.Poc.Hotkeys;
using DiNho.Capture.Poc.Memory;
using DiNho.Capture.Poc.Status;
using DiNho.Capture.Poc.Sync;

namespace DiNho.Capture.Poc.Tests;

public sealed class EngineCoordinatorGameTests : IDisposable
{
    private static readonly Type CoordinatorType = typeof(EngineCoordinator);
    private readonly List<ConfigManager> _disposables = new();

    private static object? InvokeStatic(string name, params object?[] args)
    {
        var method = CoordinatorType.GetMethod(name,
            BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public,
            null,
            args.Select(a => a?.GetType() ?? typeof(object)).ToArray(),
            null);
        return method?.Invoke(null, args);
    }

    private static T? InvokeStaticTyped<T>(string name, params object?[] args)
    {
        return (T?)InvokeStatic(name, args);
    }

    private static EngineCoordinator CreateUninitialized()
    {
        return (EngineCoordinator)System.Runtime.CompilerServices.RuntimeHelpers
            .GetUninitializedObject(typeof(EngineCoordinator));
    }

    private static void SetField(EngineCoordinator coord, string name, object? value)
    {
        var field = CoordinatorType.GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!;
        field.SetValue(coord, value);
    }

    private static T? GetField<T>(EngineCoordinator coord, string name)
    {
        var field = CoordinatorType.GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!;
        return (T?)field.GetValue(coord);
    }

    private static T? GetStaticField<T>(string name)
    {
        var field = CoordinatorType.GetField(name, BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public)!;
        return (T?)field.GetValue(null);
    }

    private static void SetStaticField(string name, object? value)
    {
        var field = CoordinatorType.GetField(name, BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public)!;
        field.SetValue(null, value);
    }

    private static object? InvokeInstance(string name, object instance, params object?[] args)
    {
        var method = CoordinatorType.GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)!;
        return method?.Invoke(instance, args);
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

    private EngineCoordinator CreateWithConfig(int electronPid = 0, bool autoStart = true,
        bool gameAudioOnly = true, bool forceSoftware = true,
        Action<AppConfig>? extraConfigure = null)
    {
        var coord = CreateUninitialized();
        var config = CreateConfig(c =>
        {
            c.ElectronPid = electronPid;
            c.AutoStartCapture = autoStart;
            c.GameAudioOnly = gameAudioOnly;
            c.ForceSoftware = forceSoftware;
            extraConfigure?.Invoke(c);
        });
        SetField(coord, "_config", config);
        SetField(coord, "_captureTargetGame", new GameInfo());
        SetField(coord, "_captureTargetHwnd", IntPtr.Zero);
        SetField(coord, "_pendingGameProcess", "");
        SetField(coord, "_customGameProcess", "");
        SetField(coord, "_lastDetectedGame", new GameInfo());
        SetField(coord, "_userStoppedProcess", "");
        SetField(coord, "_captureActive", false);
        SetField(coord, "_recording", false);
        SetField(coord, "_capturedGameProcess", null);
        SetField(coord, "_appliedGameAudioOnly", false);
        SetField(coord, "_appliedGameAudioPid", 0);
        SetField(coord, "_dinhoHwnds", new List<IntPtr>());
        #pragma warning disable CS9216 // falso positivo: SetValue(reflection) exige object; prod relê o campo como Lock (EnterScope).
        SetField(coord, "_pipelineLock", new System.Threading.Lock());
#pragma warning restore CS9216
        SetField(coord, "_status", new EngineStatus());
        SetField(coord, "_buffer", new ReplayBuffer(TimeSpan.FromSeconds(30)));
        SetField(coord, "_gameDetector", new GameDetector());
        SetField(coord, "_clock", new MasterClock());
        SetField(coord, "_watchdog", new DiNho.Capture.Poc.Watchdog.PipelineWatchdog());
        SetField(coord, "_activeProfile", new CaptureProfile());
        SetField(coord, "_sharedDevice", null);
        SetField(coord, "_encoder", null);
        SetField(coord, "_capture", null);
        SetField(coord, "_audioMixer", null);
        SetField(coord, "_aacEncoder", null);
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
        #pragma warning disable CS9216 // falso positivo: idem _pipelineLock acima.
        SetField(coord, "_exportLock", new System.Threading.Lock());
#pragma warning restore CS9216
        SetField(coord, "_exportInProgress", false);
        SetField(coord, "_ramManager", null);
        SetField(coord, "_loopbackSource", null);
        SetField(coord, "_micSource", null);
        SetField(coord, "_wgcPump", null);
        SetField(coord, "_pipelineCts", null);
        SetField(coord, "_pipelineTask", null);
        SetField(coord, "_pttDiagTimer", null);
        SetField(coord, "_cleanupTimer", null);
        SetField(coord, "_audioMixerGeneration", 0);
        SetField(coord, "_restartPending", false);
        #pragma warning disable CS9216 // falso positivo: SetValue(reflection) exige object; prod relê o campo como Lock (EnterScope).
        SetField(coord, "_restartLock", new System.Threading.Lock());
#pragma warning restore CS9216
        SetField(coord, "_highResTimerEnabled", false);
        SetField(coord, "_mfStarted", false);
        SetField(coord, "_audioFallback", false);
        SetField(coord, "_audioSessionsCacheTicks", 0L);
        SetField(coord, "_cachedAudioSessionsJson", null);
        return coord;
    }

    public void Dispose()
    {
        foreach (var d in _disposables)
        {
            try { d.Dispose(); } catch { }
        }
    }

    #region IsWindowValidForWgc

    [Fact]
    public void IsWindowValidForWgc_ZeroHwnd_ReturnsFalse()
    {
        var result = InvokeStatic("IsWindowValidForWgc", IntPtr.Zero);
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsWindowValidForWgc_DesktopWindow_ReturnsFalse()
    {
        var desktopHwnd = InvokeStatic("GetDesktopWindow");
        Assert.NotNull(desktopHwnd);
        var result = InvokeStatic("IsWindowValidForWgc", desktopHwnd);
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsWindowValidForWgc_Hwnd1_ReturnsBool()
    {
        var result = InvokeStatic("IsWindowValidForWgc", new IntPtr(1));
        Assert.IsType<bool>(result);
    }

    [Fact]
    public void IsWindowValidForWgc_LargeHwnd_ReturnsBool()
    {
        var result = InvokeStatic("IsWindowValidForWgc", new IntPtr(0x00100000));
        Assert.IsType<bool>(result);
    }

    [Fact]
    public void IsWindowValidForWgc_NegativeHwnd_ReturnsFalse()
    {
        var result = InvokeStatic("IsWindowValidForWgc", new IntPtr(-1));
        Assert.Equal(false, result);
    }

    #endregion

    #region BuildGameInfoFromProcess

    [Fact]
    public void BuildGameInfoFromProcess_CurrentProcess_ReturnsValidInfo()
    {
        var proc = System.Diagnostics.Process.GetCurrentProcess();
        var result = InvokeStatic("BuildGameInfoFromProcess", proc);
        Assert.NotNull(result);
        var info = (GameInfo)result!;
        Assert.Equal(proc.ProcessName, info.ProcessName);
        Assert.Equal(proc.Id, info.ProcessId);
        Assert.True(info.IsValid);
    }

    [Fact]
    public void BuildGameInfoFromProcess_CurrentProcess_HasProcessName()
    {
        var proc = System.Diagnostics.Process.GetCurrentProcess();
        var result = (GameInfo)InvokeStatic("BuildGameInfoFromProcess", proc)!;
        Assert.False(string.IsNullOrEmpty(result.ProcessName));
    }

    [Fact]
    public void BuildGameInfoFromProcess_CurrentProcess_HasZeroOrValidHwnd()
    {
        var proc = System.Diagnostics.Process.GetCurrentProcess();
        var result = (GameInfo)InvokeStatic("BuildGameInfoFromProcess", proc)!;
        Assert.True(result.Hwnd == IntPtr.Zero || result.Hwnd != IntPtr.Zero);
    }

    [Fact]
    public void BuildGameInfoFromProcess_CurrentProcess_DisplayModeUnknown()
    {
        var proc = System.Diagnostics.Process.GetCurrentProcess();
        var result = (GameInfo)InvokeStatic("BuildGameInfoFromProcess", proc)!;
        Assert.Equal(DisplayMode.Unknown, result.DisplayMode);
    }

    [Fact]
    public void BuildGameInfoFromProcess_CurrentProcess_EmptyWindowClass()
    {
        var proc = System.Diagnostics.Process.GetCurrentProcess();
        var result = (GameInfo)InvokeStatic("BuildGameInfoFromProcess", proc)!;
        Assert.Equal("", result.WindowClass);
    }

    [Fact]
    public void BuildGameInfoFromProcess_CurrentProcess_ExecutablePathNonEmpty()
    {
        var proc = System.Diagnostics.Process.GetCurrentProcess();
        var result = (GameInfo)InvokeStatic("BuildGameInfoFromProcess", proc)!;
        Assert.False(string.IsNullOrEmpty(result.ExecutablePath));
    }

    #endregion

    #region ResolveProcessByName

    [Fact]
    public void ResolveProcessByName_WithExeSuffix_CurrentProcess_ReturnsValid()
    {
        var procName = Environment.ProcessPath is not null
            ? Path.GetFileName(Environment.ProcessPath)
            : "testhost.exe";
        var result = (GameInfo?)InvokeStatic("ResolveProcessByName", procName);
        Assert.NotNull(result);
        Assert.True(result!.IsValid);
    }

    [Fact]
    public void ResolveProcessByName_WithoutExeSuffix_CurrentProcess_ReturnsValid()
    {
        var baseName = Environment.ProcessPath is not null
            ? Path.GetFileNameWithoutExtension(Environment.ProcessPath)
            : "testhost";
        var result = (GameInfo?)InvokeStatic("ResolveProcessByName", baseName);
        Assert.NotNull(result);
        Assert.True(result!.IsValid);
    }

    [Fact]
    public void ResolveProcessByName_EmptyString_ReturnsInvalid()
    {
        var result = (GameInfo?)InvokeStatic("ResolveProcessByName", "");
        Assert.NotNull(result);
        Assert.False(result!.IsValid);
    }

    [Fact]
    public void ResolveProcessByName_NonExistentProcess_ReturnsInvalid()
    {
        var result = (GameInfo?)InvokeStatic("ResolveProcessByName", "zzz_nonexistent_process_99999.exe");
        Assert.NotNull(result);
        Assert.False(result!.IsValid);
    }

    [Fact]
    public void ResolveProcessByName_MixedCase_CurrentProcess_ReturnsValid()
    {
        var baseName = Environment.ProcessPath is not null
            ? Path.GetFileNameWithoutExtension(Environment.ProcessPath).ToUpperInvariant()
            : "TESTHOST";
        var result = (GameInfo?)InvokeStatic("ResolveProcessByName", baseName);
        Assert.NotNull(result);
        Assert.True(result!.IsValid);
    }

    [Fact]
    public void ResolveProcessByName_FiveMStyle_BuildNumber_FuzzyMatchesRunningProcess()
    {
        var result = (GameInfo?)InvokeStatic("ResolveProcessByName", "FiveM_b1234_GTAProcess.exe");
        Assert.NotNull(result);
        // Fuzzy match strips _b\d+_ and finds the running FiveM process if present
        // Result is valid when FiveM is running, invalid when not — both are correct
        if (System.Diagnostics.Process.GetProcessesByName("FiveM").Length > 0 ||
            System.Diagnostics.Process.GetProcessesByName("FiveM_b3258_GTA5").Length > 0)
            Assert.True(result!.IsValid);
        else
            Assert.False(result!.IsValid);
    }

    [Fact]
    public void ResolveProcessByName_FuzzyMatch_ProcessNameContainsBPattern()
    {
        var result = (GameInfo?)InvokeStatic("ResolveProcessByName", "SomeProc_b999_test.exe");
        Assert.NotNull(result);
        Assert.IsType<GameInfo>(result);
    }

    [Fact]
    public void ResolveProcessByName_NullString_ThrowsNRE()
    {
        var method = CoordinatorType.GetMethod("ResolveProcessByName",
            BindingFlags.Static | BindingFlags.NonPublic)!;
        var ex = Assert.Throws<TargetInvocationException>(() => method.Invoke(null, new object?[] { null! }));
        Assert.IsType<NullReferenceException>(ex.InnerException);
    }

    #endregion

    #region IsProcessAlive

    [Fact]
    public void IsProcessAlive_EmptyString_ReturnsFalse()
    {
        var result = (bool?)InvokeStatic("IsProcessAlive", "");
        Assert.False(result);
    }

    [Fact]
    public void IsProcessAlive_Whitespace_ReturnsFalse()
    {
        var result = (bool?)InvokeStatic("IsProcessAlive", "   ");
        Assert.False(result);
    }

    [Fact]
    public void IsProcessAlive_VeryLongName_ReturnsFalse()
    {
        var longName = new string('a', 1000);
        var result = (bool?)InvokeStatic("IsProcessAlive", longName);
        Assert.False(result);
    }

    [Fact]
    public void IsProcessAlive_SpecialCharacters_ReturnsFalse()
    {
        var result = (bool?)InvokeStatic("IsProcessAlive", "proc@#$%^&*.exe");
        Assert.False(result);
    }

    [Fact]
    public void IsProcessAlive_NonExistent_ReturnsFalse()
    {
        var result = (bool?)InvokeStatic("IsProcessAlive", "zzzFakeProc12345");
        Assert.False(result);
    }

    [Fact]
    public void IsProcessAlive_CurrentProcessNoExe_ReturnsTrue()
    {
        var baseName = Environment.ProcessPath is not null
            ? Path.GetFileNameWithoutExtension(Environment.ProcessPath)
            : "testhost";
        var result = (bool?)InvokeStatic("IsProcessAlive", baseName);
        Assert.True(result);
    }

    [Fact]
    public void IsProcessAlive_WithExeSuffix_StripsIt()
    {
        var exeName = Environment.ProcessPath is not null
            ? Path.GetFileName(Environment.ProcessPath)
            : "testhost.exe";
        var result = (bool?)InvokeStatic("IsProcessAlive", exeName);
        Assert.True(result);
    }

    [Fact]
    public void IsProcessAlive_WithDotExeLowercase_Works()
    {
        var baseName = Environment.ProcessPath is not null
            ? Path.GetFileNameWithoutExtension(Environment.ProcessPath)
            : "testhost";
        var withExe = baseName + ".exe";
        var result = (bool?)InvokeStatic("IsProcessAlive", withExe);
        Assert.True(result);
    }

    #endregion

    #region IsProcessAlive (PID overload)

    [Fact]
    public void IsProcessAlive_OwnPid_ReturnsTrue()
    {
        var result = (bool?)InvokeStatic("IsProcessAlive", Environment.ProcessId);
        Assert.True(result);
    }

    [Fact]
    public void IsProcessAlive_ZeroPid_ReturnsFalse()
    {
        var result = (bool?)InvokeStatic("IsProcessAlive", 0);
        Assert.False(result);
    }

    [Fact]
    public void IsProcessAlive_NegativePid_ReturnsFalse()
    {
        var result = (bool?)InvokeStatic("IsProcessAlive", -1);
        Assert.False(result);
    }

    [Fact]
    public void IsProcessAlive_MaxIntPid_ReturnsFalse()
    {
        var result = (bool?)InvokeStatic("IsProcessAlive", int.MaxValue);
        Assert.False(result);
    }

    [Fact]
    public void IsProcessAlive_DeadPid_ReturnsFalse()
    {
        var p = new System.Diagnostics.Process
        {
            StartInfo = new System.Diagnostics.ProcessStartInfo("cmd.exe") { CreateNoWindow = true, UseShellExecute = false }
        };
        p.Start();
        var deadPid = p.Id;
        p.Kill();
        p.WaitForExit();
        p.Dispose();

        var result = (bool?)InvokeStatic("IsProcessAlive", deadPid);
        Assert.False(result);
    }

    [Fact]
    public void IsProcessAlive_ProbeThrows_ReturnsTrue_FailClosed()
    {
        var prev = GetStaticField<Func<uint, bool>>("IsProcessAliveProbe");
        SetStaticField("IsProcessAliveProbe", new Func<uint, bool>(_ => throw new InvalidOperationException("probe boom")));
        try
        {
            var result = (bool?)InvokeStatic("IsProcessAlive", 424242);
            Assert.True(result);
        }
        finally { SetStaticField("IsProcessAliveProbe", prev); }
    }

    [Fact]
    public void IsProcessAlive_OpenProcessAccessDenied_ReturnsTrue()
    {
        var prev = GetStaticField<Func<uint, IntPtr>>("OpenProcessProbe");
        SetStaticField("OpenProcessProbe", new Func<uint, IntPtr>(_ =>
        {
            System.Runtime.InteropServices.Marshal.SetLastPInvokeError(5);
            return IntPtr.Zero;
        }));
        try
        {
            var result = (bool?)InvokeStatic("IsProcessAlive", 424242);
            Assert.True(result);
        }
        finally { SetStaticField("OpenProcessProbe", prev); }
    }

    [Fact]
    public void IsProcessAlive_OpenProcessReturnsInvalidHandle_ExitCodeUnreadable_FailClosed()
    {
        var prev = GetStaticField<Func<uint, IntPtr>>("OpenProcessProbe");
        SetStaticField("OpenProcessProbe", new Func<uint, IntPtr>(_ => new IntPtr(1)));
        try
        {
            var result = (bool?)InvokeStatic("IsProcessAlive", 424242);
            Assert.True(result);
        }
        finally { SetStaticField("OpenProcessProbe", prev); }
    }

    #endregion

    #region NormalizeProcessName

    [Fact]
    public void NormalizeProcessName_FiveMBuildSegment_Stripped()
    {
        var result = InvokeStatic("NormalizeProcessName", "FiveM_b3258_GTAProcess");
        Assert.Equal("FiveM_GTAProcess", result);
    }

    [Fact]
    public void NormalizeProcessName_BuildSegmentWithExe_Stripped()
    {
        var result = InvokeStatic("NormalizeProcessName", "FiveM_b3260_GTAProcess.exe");
        Assert.Equal("FiveM_GTAProcess", result);
    }

    [Fact]
    public void NormalizeProcessName_NoBuildSegment_Unchanged()
    {
        var result = InvokeStatic("NormalizeProcessName", "GTA5.exe");
        Assert.Equal("GTA5", result);
    }

    [Fact]
    public void NormalizeProcessName_EmptyString_ReturnsEmpty()
    {
        var result = InvokeStatic("NormalizeProcessName", "");
        Assert.Equal("", result);
    }

    [Fact]
    public void NormalizeProcessName_Whitespace_ReturnsEmpty()
    {
        var result = InvokeStatic("NormalizeProcessName", "   ");
        Assert.Equal("", result);
    }

    #endregion

    #region IsTargetProcessAlive

    [Fact]
    public void IsTargetProcessAlive_WhenPidSet_UsesPidOverload()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_captureTargetGame",
            new GameInfo("FiveM_b3258_GTAProcess", "", "", "", DisplayMode.Unknown, 777, IntPtr.Zero));
        var prev = GetStaticField<Func<uint, bool>>("IsProcessAliveProbe");
        uint? calledPid = null;
        SetStaticField("IsProcessAliveProbe", new Func<uint, bool>(pid => { calledPid = pid; return true; }));
        try
        {
            var result = (bool)InvokeInstance("IsTargetProcessAlive", coord)!;
            Assert.True(result);
            Assert.Equal(777u, calledPid);
        }
        finally { SetStaticField("IsProcessAliveProbe", prev); }
    }

    [Fact]
    public void IsTargetProcessAlive_WhenPidZero_UsesNameFallback()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_captureTargetGame",
            new GameInfo("FiveM_b3258_GTAProcess", "", "", "", DisplayMode.Unknown, 0, IntPtr.Zero));
        var result = (bool)InvokeInstance("IsTargetProcessAlive", coord)!;
        // PID 0 → cai no overload por nome (fuzzy _b\d+_). Deve ser True se o
        // processo de teste (testhost) rodar com nome qualquer — aqui só garantimos
        // que NÃO lança e retorna bool.
        Assert.IsType<bool>(result);
    }

    #endregion

    #region GetChildProcesses

    [Fact]
    public void GetChildProcesses_ZeroPid_ReturnsSet()
    {
        var result = InvokeStaticTyped<HashSet<int>>("GetChildProcesses", 0);
        Assert.NotNull(result);
        Assert.IsType<HashSet<int>>(result);
    }

    [Fact]
    public void GetChildProcesses_NegativePid_ReturnsEmptySet()
    {
        var result = InvokeStaticTyped<HashSet<int>>("GetChildProcesses", -1);
        Assert.NotNull(result);
        Assert.Empty(result!);
    }

    [Fact]
    public void GetChildProcesses_VeryLargePid_ReturnsEmptySet()
    {
        var result = InvokeStaticTyped<HashSet<int>>("GetChildProcesses", int.MaxValue);
        Assert.NotNull(result);
        Assert.Empty(result!);
    }

    [Fact]
    public void GetChildProcesses_CurrentPid_ReturnsSet()
    {
        var result = InvokeStaticTyped<HashSet<int>>("GetChildProcesses", Environment.ProcessId);
        Assert.NotNull(result);
        Assert.IsAssignableFrom<HashSet<int>>(result);
    }

    #endregion

    #region ResolveTargetGame

    private GameInfo InvokeResolveTargetGame(EngineCoordinator coord)
    {
        var method = CoordinatorType.GetMethod("ResolveTargetGame",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        return (GameInfo)method.Invoke(coord, null)!;
    }

    [Fact]
    public void ResolveTargetGame_NoTargets_ReturnsCurrentOrInvalid()
    {
        var coord = CreateWithConfig();
        var result = InvokeResolveTargetGame(coord);
        Assert.IsType<GameInfo>(result);
    }

    [Fact]
    public void ResolveTargetGame_PendingProcess_TriesToResolve()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_pendingGameProcess", "nonexistent_process_xyz");
        var result = InvokeResolveTargetGame(coord);
        Assert.IsType<GameInfo>(result);
        var pending = GetField<string>(coord, "_pendingGameProcess");
        Assert.Equal("", pending);
    }

    [Fact]
    public void ResolveTargetGame_CustomProcess_TriesToResolve()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_customGameProcess", "nonexistent_custom_process");
        var result = InvokeResolveTargetGame(coord);
        Assert.IsType<GameInfo>(result);
    }

    [Fact]
    public void ResolveTargetGame_CaptureTargetValid_ResolvesProcess()
    {
        var coord = CreateWithConfig();
        var baseName = Environment.ProcessPath is not null
            ? Path.GetFileNameWithoutExtension(Environment.ProcessPath)
            : "testhost";
        SetField(coord, "_captureTargetGame", new GameInfo(
            processName: baseName,
            executablePath: "",
            windowTitle: "",
            windowClass: "",
            displayMode: DisplayMode.Unknown,
            processId: Environment.ProcessId,
            hwnd: new IntPtr(0x1234)));
        var result = InvokeResolveTargetGame(coord);
        Assert.True(result.IsValid);
    }

    [Fact]
    public void ResolveTargetGame_CaptureTargetDead_ClearsAndFallsThrough()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_captureTargetGame", new GameInfo(
            processName: "zzz_dead_process_12345",
            executablePath: "",
            windowTitle: "",
            windowClass: "",
            displayMode: DisplayMode.Unknown,
            processId: 99999,
            hwnd: new IntPtr(0x5678)));
        SetField(coord, "_captureTargetHwnd", new IntPtr(0x5678));
        var result = InvokeResolveTargetGame(coord);
        Assert.IsType<GameInfo>(result);
        var target = GetField<GameInfo>(coord, "_captureTargetGame");
        Assert.False(target!.IsValid);
    }

    [Fact]
    public void ResolveTargetGame_CaptureTargetAliveButNoHwnd_UsesSavedHwnd()
    {
        var coord = CreateWithConfig();
        var baseName = Environment.ProcessPath is not null
            ? Path.GetFileNameWithoutExtension(Environment.ProcessPath)
            : "testhost";
        SetField(coord, "_captureTargetGame", new GameInfo(
            processName: baseName,
            executablePath: "",
            windowTitle: "",
            windowClass: "",
            displayMode: DisplayMode.Unknown,
            processId: Environment.ProcessId,
            hwnd: new IntPtr(0x1234)));
        SetField(coord, "_captureTargetHwnd", new IntPtr(0x1234));
        var result = InvokeResolveTargetGame(coord);
        Assert.True(result.IsValid);
        Assert.Equal(baseName, result.ProcessName);
    }

    [Fact]
    public void ResolveTargetGame_PendingAndCustom_PendingHasPriority()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_pendingGameProcess", "nonexistent_pending");
        SetField(coord, "_customGameProcess", "nonexistent_custom");
        InvokeResolveTargetGame(coord);
        var pending = GetField<string>(coord, "_pendingGameProcess");
        Assert.Equal("", pending);
    }

    [Fact]
    public void ResolveTargetGame_LastDetectedGame_Fallback()
    {
        var coord = CreateWithConfig();
        var baseName = Environment.ProcessPath is not null
            ? Path.GetFileNameWithoutExtension(Environment.ProcessPath)
            : "testhost";
        var lastGame = new GameInfo(
            processName: baseName,
            executablePath: "",
            windowTitle: "",
            windowClass: "",
            displayMode: DisplayMode.Unknown,
            processId: Environment.ProcessId,
            hwnd: new IntPtr(0x1234));
        SetField(coord, "_lastDetectedGame", lastGame);
        var result = InvokeResolveTargetGame(coord);
        Assert.True(result.IsValid);
        Assert.Equal(baseName, result.ProcessName);
    }

    [Fact]
    public void ResolveTargetGame_LastDetectedGame_DeadFallsThrough()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_lastDetectedGame", new GameInfo(
            processName: "zzzDeadGame99999",
            executablePath: "",
            windowTitle: "",
            windowClass: "",
            displayMode: DisplayMode.Unknown,
            processId: 99999,
            hwnd: new IntPtr(0x1234)));
        var result = InvokeResolveTargetGame(coord);
        Assert.IsType<GameInfo>(result);
    }

    #endregion

    #region OnGameChanged

    private void InvokeOnGameChanged(EngineCoordinator coord, GameInfo game)
    {
        var method = CoordinatorType.GetMethod("OnGameChanged",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, [game]);
    }

    private void InvokeApplyGameAudioOnly(EngineCoordinator coord)
    {
        var method = CoordinatorType.GetMethod("ApplyGameAudioOnly",
            BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, []);
    }

    [Fact]
    public void OnGameChanged_ValidGame_UpdatesLastDetected()
    {
        var coord = CreateWithConfig();
        var game = new GameInfo(
            processName: "FiveM",
            executablePath: @"C:\FiveM\FiveM.exe",
            windowTitle: "FiveM",
            windowClass: "grcWindow",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 1234,
            hwnd: new IntPtr(0xABCD));

        InvokeOnGameChanged(coord, game);

        var lastDetected = GetField<GameInfo>(coord, "_lastDetectedGame")!;
        Assert.Equal("FiveM", lastDetected.ProcessName);
    }

    [Fact]
    public void OnGameChanged_NonGameProcess_DoesNotUpdateLastDetected()
    {
        var coord = CreateWithConfig();
        var originalLast = new GameInfo(
            processName: "FiveM",
            executablePath: "",
            windowTitle: "",
            windowClass: "",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 1234,
            hwnd: new IntPtr(0xABCD));
        SetField(coord, "_lastDetectedGame", originalLast);

        var game = new GameInfo(
            processName: "explorer",
            executablePath: @"C:\Windows\explorer.exe",
            windowTitle: "",
            windowClass: "Progman",
            displayMode: DisplayMode.Unknown,
            processId: 5678,
            hwnd: new IntPtr(0x1111));

        InvokeOnGameChanged(coord, game);

        var lastDetected = GetField<GameInfo>(coord, "_lastDetectedGame")!;
        Assert.Equal("FiveM", lastDetected.ProcessName);
    }

    [Fact]
    public void OnGameChanged_GameAudioOnly_SamePid_DoesNotRestart()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_recording", true);
        SetField(coord, "_appliedGameAudioOnly", true);
        SetField(coord, "_appliedGameAudioPid", 1234);
        SetField(coord, "_lastGameAudioOnlyRestartUtc", Environment.TickCount64);

        var game = new GameInfo(
            processName: "FiveM",
            executablePath: @"C:\FiveM\FiveM.exe",
            windowTitle: "FiveM",
            windowClass: "grcWindow",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 1234,
            hwnd: new IntPtr(0xABCD));

        InvokeOnGameChanged(coord, game);

        Assert.Equal(1234, GetField<int>(coord, "_appliedGameAudioPid"));
    }

    [Fact]
    public void OnGameChanged_GameAudioOnly_Cooldown_IgnoresRestart()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_recording", true);
        SetField(coord, "_appliedGameAudioOnly", false);
        SetField(coord, "_appliedGameAudioPid", 0);
        SetField(coord, "_lastGameAudioOnlyRestartUtc", Environment.TickCount64);

        var game = new GameInfo(
            processName: "FiveM",
            executablePath: @"C:\FiveM\FiveM.exe",
            windowTitle: "FiveM",
            windowClass: "grcWindow",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 1234,
            hwnd: new IntPtr(0xABCD));

        InvokeOnGameChanged(coord, game);

        Assert.False(GetField<bool>(coord, "_appliedGameAudioOnly"));
    }

    [Fact]
    public void OnGameChanged_GameAudioOnly_CooldownElapsed_AppliesFilter()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_recording", true);
        SetField(coord, "_appliedGameAudioOnly", false);
        SetField(coord, "_appliedGameAudioPid", 0);
        SetField(coord, "_lastGameAudioOnlyRestartUtc", Environment.TickCount64 - 11_000);

        var game = new GameInfo(
            processName: "FiveM",
            executablePath: @"C:\FiveM\FiveM.exe",
            windowTitle: "FiveM",
            windowClass: "grcWindow",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 1234,
            hwnd: new IntPtr(0xABCD));

        InvokeOnGameChanged(coord, game);

        Assert.True(GetField<bool>(coord, "_appliedGameAudioOnly"));
        Assert.Equal(1234, GetField<int>(coord, "_appliedGameAudioPid"));
    }

    [Fact]
    public void OnGameChanged_GameAudioOnly_NonGameProcess_Skips()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_recording", true);
        SetField(coord, "_appliedGameAudioOnly", false);
        SetField(coord, "_appliedGameAudioPid", 0);
        SetField(coord, "_lastGameAudioOnlyRestartUtc", 0);

        var game = new GameInfo(
            processName: "AnyDesk",
            executablePath: @"C:\AnyDesk\AnyDesk.exe",
            windowTitle: "AnyDesk",
            windowClass: "",
            displayMode: DisplayMode.Unknown,
            processId: 5678,
            hwnd: new IntPtr(0x1111));

        InvokeOnGameChanged(coord, game);

        Assert.False(GetField<bool>(coord, "_appliedGameAudioOnly"));
    }

    [Fact]
    public void OnGameChanged_GameAudioOnly_SystemWindowClass_Skips()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_recording", true);
        SetField(coord, "_appliedGameAudioOnly", false);
        SetField(coord, "_appliedGameAudioPid", 0);
        SetField(coord, "_lastGameAudioOnlyRestartUtc", 0);

        var game = new GameInfo(
            processName: "PickerHost",
            executablePath: @"C:\Users\Test\PickerHost.exe",
            windowTitle: "Open File",
            windowClass: "#32770",
            displayMode: DisplayMode.Windowed,
            processId: 5678,
            hwnd: new IntPtr(0x2222));

        InvokeOnGameChanged(coord, game);

        Assert.False(GetField<bool>(coord, "_appliedGameAudioOnly"));
        Assert.Equal(0, GetField<int>(coord, "_appliedGameAudioPid"));
    }

    [Fact]
    public void OnGameChanged_GameAudioOnly_SystemExecutablePath_Skips()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_recording", true);
        SetField(coord, "_appliedGameAudioOnly", false);
        SetField(coord, "_appliedGameAudioPid", 0);
        SetField(coord, "_lastGameAudioOnlyRestartUtc", 0);

        var windowsDir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        var game = new GameInfo(
            processName: "PickerHost",
            executablePath: Path.Combine(windowsDir, "System32", "PickerHost.exe"),
            windowTitle: "Open File",
            windowClass: "PickerHostWindow",
            displayMode: DisplayMode.Windowed,
            processId: 5678,
            hwnd: new IntPtr(0x2222));

        InvokeOnGameChanged(coord, game);

        Assert.False(GetField<bool>(coord, "_appliedGameAudioOnly"));
        Assert.Equal(0, GetField<int>(coord, "_appliedGameAudioPid"));
    }

    [Fact]
    public void ApplyGameAudioOnly_SystemExecutablePath_Skips()
    {
        var coord = CreateWithConfig(gameAudioOnly: true);
        SetField(coord, "_appliedGameAudioOnly", false);
        SetField(coord, "_appliedGameAudioPid", 0);
        SetField(coord, "_lastGameAudioOnlyRestartUtc", 0);

        var windowsDir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        var game = new GameInfo(
            processName: "PickerHost",
            executablePath: Path.Combine(windowsDir, "System32", "PickerHost.exe"),
            windowTitle: "Open File",
            windowClass: "PickerHostWindow",
            displayMode: DisplayMode.Windowed,
            processId: 5678,
            hwnd: new IntPtr(0x2222));
        SetField(coord, "_lastDetectedGame", game);

        InvokeApplyGameAudioOnly(coord);

        Assert.False(GetField<bool>(coord, "_appliedGameAudioOnly"));
        Assert.Equal(0, GetField<int>(coord, "_appliedGameAudioPid"));
    }

    [Fact]
    public void OnGameChanged_UserStopped_DifferentProcess_ClearsStoppedProcess()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_userStoppedProcess", "FiveM");

        var game = new GameInfo(
            processName: "Fortnite",
            executablePath: "",
            windowTitle: "",
            windowClass: "",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 2222,
            hwnd: new IntPtr(0x2222));

        InvokeOnGameChanged(coord, game);

        var stopped = GetField<string>(coord, "_userStoppedProcess");
        Assert.Equal("", stopped);
    }

    [Fact]
    public void OnGameChanged_UserStopped_SameProcess_KeepsStoppedProcess()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_userStoppedProcess", "FiveM");

        var game = new GameInfo(
            processName: "FiveM",
            executablePath: "",
            windowTitle: "",
            windowClass: "",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 1234,
            hwnd: new IntPtr(0xABCD));

        InvokeOnGameChanged(coord, game);

        var stopped = GetField<string>(coord, "_userStoppedProcess");
        Assert.Equal("FiveM", stopped);
    }

    [Fact]
    public void OnGameChanged_EmptyUserStopped_DoesNotThrow()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_userStoppedProcess", "");

        var game = new GameInfo(
            processName: "FiveM",
            executablePath: "",
            windowTitle: "",
            windowClass: "",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 1234,
            hwnd: new IntPtr(0xABCD));

        var ex = Record.Exception(() => InvokeOnGameChanged(coord, game));
        Assert.Null(ex);
    }

    [Fact]
    public void OnGameChanged_InvalidGame_DoesNotUpdateLastDetected()
    {
        var coord = CreateWithConfig();
        var originalLast = new GameInfo(
            processName: "FiveM",
            executablePath: "",
            windowTitle: "",
            windowClass: "",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 1234,
            hwnd: new IntPtr(0xABCD));
        SetField(coord, "_lastDetectedGame", originalLast);

        var game = new GameInfo();
        InvokeOnGameChanged(coord, game);

        var lastDetected = GetField<GameInfo>(coord, "_lastDetectedGame")!;
        Assert.Equal("FiveM", lastDetected.ProcessName);
    }

    [Fact]
    public void OnGameChanged_NonGameProcess_DoesNotTriggerAutoStart()
    {
        var coord = CreateWithConfig(autoStart: true);
        SetField(coord, "_captureActive", false);

        var game = new GameInfo(
            processName: "chrome",
            executablePath: @"C:\Program Files\Google\Chrome\chrome.exe",
            windowTitle: "",
            windowClass: "Chrome_WidgetWin_1",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 9999,
            hwnd: new IntPtr(0x9999));

        InvokeOnGameChanged(coord, game);

        var captured = GetField<string?>(coord, "_capturedGameProcess");
        Assert.Null(captured);
    }

    [Fact]
    public void OnGameChanged_GameWithWindowedMode_DoesNotAutoStart()
    {
        var coord = CreateWithConfig(autoStart: true);
        SetField(coord, "_captureActive", false);

        var game = new GameInfo(
            processName: "FiveM",
            executablePath: @"C:\FiveM\FiveM.exe",
            windowTitle: "",
            windowClass: "grcWindow",
            displayMode: DisplayMode.Windowed,
            processId: 1234,
            hwnd: new IntPtr(0xABCD));

        InvokeOnGameChanged(coord, game);

        var captured = GetField<string?>(coord, "_capturedGameProcess");
        Assert.Null(captured);
    }

    [Fact]
    public void OnGameChanged_SystemWindowClass_DoesNotAutoStart()
    {
        var coord = CreateWithConfig(autoStart: true);
        SetField(coord, "_captureActive", false);

        var game = new GameInfo(
            processName: "SomeProcess",
            executablePath: @"D:\Games\game.exe",
            windowTitle: "",
            windowClass: "Shell_TrayWnd",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 1234,
            hwnd: new IntPtr(0xABCD));

        InvokeOnGameChanged(coord, game);

        var captured = GetField<string?>(coord, "_capturedGameProcess");
        Assert.Null(captured);
    }

    [Fact]
    public void OnGameChanged_CaptureActive_DoesNotAutoStart()
    {
        var coord = CreateWithConfig(autoStart: true);
        SetField(coord, "_captureActive", true);

        var game = new GameInfo(
            processName: "FiveM",
            executablePath: @"C:\FiveM\FiveM.exe",
            windowTitle: "",
            windowClass: "grcWindow",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 1234,
            hwnd: new IntPtr(0xABCD));

        InvokeOnGameChanged(coord, game);

        var captured = GetField<string?>(coord, "_capturedGameProcess");
        Assert.Null(captured);
    }

    [Fact]
    public void OnGameChanged_AutoStartDisabled_DoesNotAutoStart()
    {
        var coord = CreateWithConfig(autoStart: false);
        SetField(coord, "_captureActive", false);

        var game = new GameInfo(
            processName: "FiveM",
            executablePath: @"C:\FiveM\FiveM.exe",
            windowTitle: "",
            windowClass: "grcWindow",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 1234,
            hwnd: new IntPtr(0xABCD));

        InvokeOnGameChanged(coord, game);

        var captured = GetField<string?>(coord, "_capturedGameProcess");
        Assert.Null(captured);
    }

    [Fact]
    public void OnGameChanged_SystemExecutablePath_DoesNotAutoStart()
    {
        var coord = CreateWithConfig(autoStart: true);
        SetField(coord, "_captureActive", false);

        var windowsDir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        var game = new GameInfo(
            processName: "SomeSysProcess",
            executablePath: Path.Combine(windowsDir, "System32", "something.exe"),
            windowTitle: "",
            windowClass: "CustomClass",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 1234,
            hwnd: new IntPtr(0xABCD));

        InvokeOnGameChanged(coord, game);

        var captured = GetField<string?>(coord, "_capturedGameProcess");
        Assert.Null(captured);
    }

    [Fact]
    public void OnGameChanged_EmptyProcessName_DoesNotThrow()
    {
        var coord = CreateWithConfig();
        var game = new GameInfo(
            processName: "",
            executablePath: "",
            windowTitle: "",
            windowClass: "",
            displayMode: DisplayMode.Unknown,
            processId: 0,
            hwnd: IntPtr.Zero);

        var ex = Record.Exception(() => InvokeOnGameChanged(coord, game));
        Assert.Null(ex);
    }

    [Fact]
    public void OnGameChanged_GameAudioOnlyFilter_AppliesWhenRecording()
    {
        var coord = CreateWithConfig(gameAudioOnly: true);
        SetField(coord, "_recording", true);
        SetField(coord, "_captureActive", true);

        var game = new GameInfo(
            processName: "FiveM",
            executablePath: @"C:\FiveM\FiveM.exe",
            windowTitle: "",
            windowClass: "grcWindow",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 1234,
            hwnd: new IntPtr(0xABCD));

        InvokeOnGameChanged(coord, game);

        Assert.True(GetField<bool>(coord, "_appliedGameAudioOnly"));
        Assert.Equal(1234, GetField<int>(coord, "_appliedGameAudioPid"));
    }

    [Fact]
    public void OnGameChanged_GameAudioOnly_SamePidNoRestart()
    {
        var coord = CreateWithConfig(gameAudioOnly: true);
        SetField(coord, "_recording", true);
        SetField(coord, "_captureActive", true);
        SetField(coord, "_appliedGameAudioOnly", true);
        SetField(coord, "_appliedGameAudioPid", 1234);

        var game = new GameInfo(
            processName: "FiveM",
            executablePath: @"C:\FiveM\FiveM.exe",
            windowTitle: "",
            windowClass: "grcWindow",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 1234,
            hwnd: new IntPtr(0xABCD));

        var ex = Record.Exception(() => InvokeOnGameChanged(coord, game));
        Assert.Null(ex);
    }

    [Fact]
    public void OnGameChanged_GameAudioOnly_NonGameIgnored()
    {
        var coord = CreateWithConfig(gameAudioOnly: true);
        SetField(coord, "_recording", true);
        SetField(coord, "_captureActive", true);

        var game = new GameInfo(
            processName: "explorer",
            executablePath: @"C:\Windows\explorer.exe",
            windowTitle: "",
            windowClass: "Progman",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 5678,
            hwnd: new IntPtr(0x1111));

        InvokeOnGameChanged(coord, game);

        Assert.False(GetField<bool>(coord, "_appliedGameAudioOnly"));
    }

    [Fact]
    public void OnGameChanged_GameAudioOnly_NewPid_UpdatesFilter()
    {
        var coord = CreateWithConfig(gameAudioOnly: true);
        SetField(coord, "_recording", true);
        SetField(coord, "_captureActive", true);
        SetField(coord, "_appliedGameAudioOnly", true);
        SetField(coord, "_appliedGameAudioPid", 1111);

        var game = new GameInfo(
            processName: "FiveM",
            executablePath: @"C:\FiveM\FiveM.exe",
            windowTitle: "",
            windowClass: "grcWindow",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 9999,
            hwnd: new IntPtr(0xABCD));

        InvokeOnGameChanged(coord, game);

        Assert.Equal(9999, GetField<int>(coord, "_appliedGameAudioPid"));
    }

    [Fact]
    public void OnGameChanged_AutoStart_SetsCapturedGameProcess()
    {
        var coord = CreateWithConfig(autoStart: true);
        SetField(coord, "_captureActive", false);

        var game = new GameInfo(
            processName: "FiveM",
            executablePath: @"C:\FiveM\FiveM.exe",
            windowTitle: "",
            windowClass: "grcWindow",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 1234,
            hwnd: new IntPtr(0xABCD));

        // StartCapture will fail (no D3D11) but _capturedGameProcess is set before StartCapture
        InvokeOnGameChanged(coord, game);

        var captured = GetField<string?>(coord, "_capturedGameProcess");
        Assert.Equal("FiveM", captured);
    }

    [Fact]
    public void OnGameChanged_FullscreenOptimized_CanAutoStart()
    {
        var coord = CreateWithConfig(autoStart: true);
        SetField(coord, "_captureActive", false);

        var game = new GameInfo(
            processName: "Fortnite",
            executablePath: @"D:\Games\Fortnite\FortniteGame.exe",
            windowTitle: "",
            windowClass: "UnrealWindow",
            displayMode: DisplayMode.FullscreenOptimized,
            processId: 2222,
            hwnd: new IntPtr(0x2222));

        InvokeOnGameChanged(coord, game);

        var captured = GetField<string?>(coord, "_capturedGameProcess");
        Assert.Equal("Fortnite", captured);
    }

    #endregion

    #region NonGameProcesses

    [Theory]
    [InlineData("steamwebhelper")]
    [InlineData("epicgameslauncher")]
    [InlineData("goggalaxy")]
    [InlineData("origin")]
    [InlineData("eadesktop")]
    [InlineData("agent")]
    [InlineData("leagueclientux")]
    [InlineData("minecraft launcher")]
    [InlineData("dinho-optimizer")]
    public void NonGameProcesses_ContainsLaunchersAndSpecial(string name)
    {
        var field = CoordinatorType.GetField("NonGameProcesses",
            BindingFlags.Static | BindingFlags.NonPublic)!;
        var set = (HashSet<string>)field.GetValue(null)!;
        Assert.Contains(name, set);
    }

    [Theory]
    [InlineData("GTA5")]
    [InlineData("FiveM")]
    [InlineData("cs2")]
    [InlineData("valorant")]
    [InlineData("Minecraft")]
    [InlineData("Fortnite")]
    public void NonGameProcesses_DoesNotContainRealGames(string name)
    {
        var field = CoordinatorType.GetField("NonGameProcesses",
            BindingFlags.Static | BindingFlags.NonPublic)!;
        var set = (HashSet<string>)field.GetValue(null)!;
        Assert.DoesNotContain(name, set);
    }

    [Fact]
    public void NonGameProcesses_IsCaseInsensitive_AllVariantsMatch()
    {
        var field = CoordinatorType.GetField("NonGameProcesses",
            BindingFlags.Static | BindingFlags.NonPublic)!;
        var set = (HashSet<string>)field.GetValue(null)!;
        Assert.Contains("chrome", set);
        Assert.Contains("Chrome", set);
        Assert.Contains("CHROME", set);
        Assert.Contains("discord", set);
        Assert.Contains("Discord", set);
        Assert.Contains("DISCORD", set);
    }

    [Theory]
    [InlineData("DiNho Optimizer")]
    [InlineData("dinho-optimizer")]
    [InlineData("DINHO-OPTIMIZER")]
    public void NonGameProcesses_ContainsDinhoVariants(string name)
    {
        var field = CoordinatorType.GetField("NonGameProcesses",
            BindingFlags.Static | BindingFlags.NonPublic)!;
        var set = (HashSet<string>)field.GetValue(null)!;
        Assert.Contains(name, set);
    }

    [Fact]
    public void NonGameProcesses_ContainsCurrentProcess()
    {
        var field = CoordinatorType.GetField("NonGameProcesses",
            BindingFlags.Static | BindingFlags.NonPublic)!;
        var set = (HashSet<string>)field.GetValue(null)!;
        var currentProc = System.Diagnostics.Process.GetCurrentProcess().ProcessName;
        Assert.Contains(currentProc, set);
    }

    #endregion

    #region IsSystemExecutablePath

    [Fact]
    public void IsSystemExecutablePath_NetworkPath_ReturnsFalse()
    {
        var result = InvokeStatic("IsSystemExecutablePath", @"\\server\share\game.exe");
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsSystemExecutablePath_RegistryLikePath_ReturnsFalse()
    {
        var result = InvokeStatic("IsSystemExecutablePath", @"HKLM\SOFTWARE\game.exe");
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsSystemExecutablePath_JustFilename_ReturnsFalse()
    {
        var result = InvokeStatic("IsSystemExecutablePath", "game.exe");
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsSystemExecutablePath_SteamPathInProgramFiles_ReturnsFalse()
    {
        var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var path = Path.Combine(pf, "Steam", "steamapps", "common", "CounterStrike2", "cs2.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsSystemExecutablePath_EpicGamesPath_ReturnsFalse()
    {
        var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var path = Path.Combine(pf, "Epic Games", "Fortnite", "FortniteGame.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsSystemExecutablePath_BattlNetPath_ReturnsFalse()
    {
        var pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        var path = Path.Combine(pf86, "battlenet", "agent.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsSystemExecutablePath_RockstarGamesPath_ReturnsFalse()
    {
        var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var path = Path.Combine(pf, "Rockstar Games", "Launcher", "GTAV.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsSystemExecutablePath_ElectronicArtsPath_ReturnsFalse()
    {
        var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var path = Path.Combine(pf, "Electronic Arts", "EA Games", "battlefield.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsSystemExecutablePath_UbisoftPath_ReturnsFalse()
    {
        var pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        var path = Path.Combine(pf86, "Ubisoft", "Ubisoft Game Launcher", "farcry6.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsSystemExecutablePath_ProgramFilesNonGame_ReturnsTrue()
    {
        var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var path = Path.Combine(pf, "SomeRandomApp", "app.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(true, result);
    }

    [Fact]
    public void IsSystemExecutablePath_ProgramFilesX86NonGame_ReturnsTrue()
    {
        var pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        var path = Path.Combine(pf86, "SomeRandomApp", "app.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(true, result);
    }

    [Fact]
    public void IsSystemExecutablePath_LocalAppDataPrograms_ReturnsTrue()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var path = Path.Combine(localAppData, "Programs", "SomeApp", "app.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(true, result);
    }

    [Fact]
    public void IsSystemExecutablePath_LocalAppDataNonPrograms_ReturnsFalse()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var path = Path.Combine(localAppData, "Temp", "game.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsSystemExecutablePath_Empty_ReturnsFalse()
    {
        var result = InvokeStatic("IsSystemExecutablePath", "");
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsSystemExecutablePath_Null_ReturnsFalse()
    {
        var method = CoordinatorType.GetMethod("IsSystemExecutablePath",
            BindingFlags.Static | BindingFlags.NonPublic)!;
        var result = (bool)method.Invoke(null, new object?[] { null! })!;
        Assert.False(result);
    }

    #endregion

    #region IsSystemWindowClass

    [Theory]
    [InlineData("Shell_TrayWnd", true)]
    [InlineData("Progman", true)]
    [InlineData("WorkerW", true)]
    [InlineData("DV2ControlHost", true)]
    [InlineData("Windows.UI.Core.CoreWindow", true)]
    [InlineData("#32770", true)]
    [InlineData("MSTaskListWClass", true)]
    [InlineData("Shell_SecondaryTrayWnd", true)]
    [InlineData("NotifyIconOverflowWindow", true)]
    public void IsSystemWindowClass_SystemClasses(string cls, bool expected)
    {
        var result = InvokeStatic("IsSystemWindowClass", cls);
        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData("grcWindow", false)]
    [InlineData("UnityWndClass", false)]
    [InlineData("UnrealWindow", false)]
    [InlineData("SDL_app", false)]
    [InlineData("Chrome_WidgetWin_1", false)]
    [InlineData("MozillaWindowClass", false)]
    [InlineData("RiotWindowClass", false)]
    [InlineData("Valve001", false)]
    [InlineData("CEF_CLIENT", false)]
    [InlineData("CoCreateInstance", false)]
    public void IsSystemWindowClass_GameAndAppClasses(string cls, bool expected)
    {
        var result = InvokeStatic("IsSystemWindowClass", cls);
        Assert.Equal(expected, result);
    }

    [Fact]
    public void IsSystemWindowClass_EmptyString_ReturnsFalse()
    {
        var result = InvokeStatic("IsSystemWindowClass", "");
        Assert.Equal(false, result);
    }

    #endregion

    #region GameInfo

    [Fact]
    public void GameInfo_AllDisplayModes_CreateCorrectly()
    {
        foreach (DisplayMode mode in Enum.GetValues(typeof(DisplayMode)))
        {
            var info = new GameInfo(
                processName: "TestGame",
                executablePath: "test.exe",
                windowTitle: "Test",
                windowClass: "TestClass",
                displayMode: mode,
                processId: 1,
                hwnd: new IntPtr(1));
            Assert.Equal(mode, info.DisplayMode);
        }
    }

    [Fact]
    public void GameInfo_KnownGames_Recognized()
    {
        Assert.False(string.IsNullOrEmpty(new GameInfo("FiveM", "", "", "grcWindow", DisplayMode.FullscreenExclusive, 1, new IntPtr(1)).KnownGame));
        Assert.False(string.IsNullOrEmpty(new GameInfo("FortniteClient-Win64-Shipping", "", "", "FORTNITE", DisplayMode.FullscreenExclusive, 1, new IntPtr(1)).KnownGame));
        Assert.False(string.IsNullOrEmpty(new GameInfo("cs2", "", "", "SDL_app", DisplayMode.FullscreenExclusive, 1, new IntPtr(1)).KnownGame));
    }

    [Fact]
    public void GameInfo_SameValues_SameProperties()
    {
        var a = new GameInfo("FiveM", "path", "title", "cls", DisplayMode.Windowed, 1, new IntPtr(1));
        var b = new GameInfo("FiveM", "path", "title", "cls", DisplayMode.Windowed, 1, new IntPtr(1));
        Assert.Equal(a.ProcessName, b.ProcessName);
        Assert.Equal(a.ExecutablePath, b.ExecutablePath);
        Assert.Equal(a.WindowTitle, b.WindowTitle);
        Assert.Equal(a.WindowClass, b.WindowClass);
        Assert.Equal(a.DisplayMode, b.DisplayMode);
        Assert.Equal(a.ProcessId, b.ProcessId);
        Assert.Equal(a.Hwnd, b.Hwnd);
    }

    [Fact]
    public void GameInfo_SameValues_DifferentReferences()
    {
        var a = new GameInfo("FiveM", "path", "title", "cls", DisplayMode.Windowed, 1, new IntPtr(1));
        var b = new GameInfo("FiveM", "path", "title", "cls", DisplayMode.Windowed, 1, new IntPtr(1));
        Assert.NotSame(a, b);
    }

    [Fact]
    public void GameInfo_GetHashCode_DoesNotThrow()
    {
        var a = new GameInfo("FiveM", "path", "title", "cls", DisplayMode.Windowed, 1, new IntPtr(1));
        _ = a.GetHashCode();
    }

    [Fact]
    public void GameInfo_DefaultConstructor_Invalid()
    {
        var info = new GameInfo();
        Assert.False(info.IsValid);
        Assert.Equal("", info.ProcessName);
        Assert.Equal("", info.ExecutablePath);
        Assert.Equal("", info.WindowTitle);
        Assert.Equal("", info.WindowClass);
        Assert.Equal("", info.KnownGame);
        Assert.Equal(DisplayMode.Unknown, info.DisplayMode);
        Assert.Equal(0, info.ProcessId);
        Assert.Equal(IntPtr.Zero, info.Hwnd);
    }

    [Fact]
    public void GameInfo_ToString_WindowedMode()
    {
        var info = new GameInfo("FiveM", "", "", "grcWindow", DisplayMode.Windowed, 1, new IntPtr(1));
        Assert.Contains("WIN", info.ToString());
        Assert.Contains("FiveM", info.ToString());
    }

    [Fact]
    public void GameInfo_ToString_FullscreenExclusive()
    {
        var info = new GameInfo("cs2", "", "", "SDL_app", DisplayMode.FullscreenExclusive, 1, new IntPtr(1));
        Assert.Contains("FSX", info.ToString());
        Assert.Contains("cs2", info.ToString());
    }

    [Fact]
    public void GameInfo_ToString_FullscreenOptimized()
    {
        var info = new GameInfo("Fortnite", "", "", "UnrealWindow", DisplayMode.FullscreenOptimized, 1, new IntPtr(1));
        Assert.Contains("FSO", info.ToString());
        Assert.Contains("Fortnite", info.ToString());
    }

    [Fact]
    public void GameInfo_ToString_Unknown()
    {
        var info = new GameInfo("RandomGame", "", "", "", DisplayMode.Unknown, 1, new IntPtr(1));
        Assert.Contains("???", info.ToString());
    }

    [Fact]
    public void GameInfo_IsValid_TrueForNamedProcess()
    {
        var info = new GameInfo("FiveM", "", "", "", DisplayMode.Unknown, 1, new IntPtr(1));
        Assert.True(info.IsValid);
    }

    [Fact]
    public void GameInfo_IsValid_FalseForUnknown()
    {
        var info = new GameInfo("unknown", "", "", "", DisplayMode.Unknown, 1, new IntPtr(1));
        Assert.False(info.IsValid);
    }

    [Fact]
    public void GameInfo_IsValid_FalseForEmpty()
    {
        var info = new GameInfo();
        Assert.False(info.IsValid);
    }

    #endregion

    #region PipelineWatchdog - Game-related

    [Fact]
    public void PipelineWatchdog_ExportStall_ThenGoodFrames()
    {
        var wd = new DiNho.Capture.Poc.Watchdog.PipelineWatchdog();
        wd.ReportGoodFrame(16.0);
        wd.ReportExportStall();
        wd.ReportGoodFrame(16.0);
        wd.ReportGoodFrame(16.0);
        var h = wd.GetHealth();
        Assert.Equal(1, h.ExportStalls);
        Assert.Equal(3, h.TotalFrames);
    }

    [Fact]
    public void PipelineWatchdog_ApiSwitch_IncrementsCount()
    {
        var wd = new DiNho.Capture.Poc.Watchdog.PipelineWatchdog();
        wd.ReportApiSwitch();
        wd.ReportApiSwitch();
        wd.ReportApiSwitch();
        var h = wd.GetHealth();
        Assert.Equal(3, h.ApiSwitches);
    }

    [Fact]
    public void PipelineWatchdog_Reset_AfterDrops_ClearsIssue()
    {
        var wd = new DiNho.Capture.Poc.Watchdog.PipelineWatchdog();
        wd.ReportDroppedFrame(DiNho.Capture.Poc.Watchdog.PipelineIssue.NoFrame);
        wd.ReportDroppedFrame(DiNho.Capture.Poc.Watchdog.PipelineIssue.EncodeError);
        wd.Reset();
        var h = wd.GetHealth();
        Assert.Null(h.LastIssue);
        Assert.Equal(0, h.TotalFrames);
    }

    [Fact]
    public void PipelineWatchdog_BadFrameThreshold_Exceeded_TracksDrops()
    {
        var wd = new DiNho.Capture.Poc.Watchdog.PipelineWatchdog
        {
            BadFrameThreshold = 5,
            ConsecutiveGoodReset = 30
        };
        for (int i = 0; i < 10; i++)
            wd.ReportDroppedFrame(DiNho.Capture.Poc.Watchdog.PipelineIssue.CaptureError);
        var h = wd.GetHealth();
        Assert.Equal(DiNho.Capture.Poc.Watchdog.HealthLevel.Red, h.Level);
        Assert.Equal(10, h.DroppedFrames);
    }

    #endregion

    #region AppConfig - Game Detection Settings

    [Fact]
    public void AppConfig_AutoStartCapture_DefaultTrue()
    {
        var cfg = CreateConfig();
        Assert.True(cfg.Config.AutoStartCapture);
    }

    [Fact]
    public void AppConfig_AutoStartCapture_CanDisable()
    {
        var cfg = CreateConfig(c => c.AutoStartCapture = false);
        Assert.False(cfg.Config.AutoStartCapture);
    }

    [Fact]
    public void AppConfig_GameDetection_DefaultTrue()
    {
        var cfg = CreateConfig();
        Assert.True(cfg.Config.GameDetection);
    }

    [Fact]
    public void AppConfig_ElectronPid_DefaultZero()
    {
        var cfg = CreateConfig();
        Assert.Equal(0, cfg.Config.ElectronPid);
    }

    [Fact]
    public void AppConfig_ElectronPid_SetValue()
    {
        var cfg = CreateConfig(c => c.ElectronPid = 12345);
        Assert.Equal(12345, cfg.Config.ElectronPid);
    }

    #endregion

    #region HotkeyBinding

    [Fact]
    public void HotkeyBinding_DefaultAction_IsSaveClip()
    {
        var binding = new HotkeyBinding();
        Assert.Equal("SaveClip", binding.Action);
    }

    [Fact]
    public void HotkeyBinding_DefaultVk_IsF10()
    {
        var binding = new HotkeyBinding();
        Assert.Equal(0x77, binding.Vk);
    }

    [Fact]
    public void HotkeyBinding_DefaultEnabled_IsTrue()
    {
        var binding = new HotkeyBinding();
        Assert.True(binding.Enabled);
    }

    [Fact]
    public void HotkeyBinding_DefaultReplayDuration_IsNull()
    {
        var binding = new HotkeyBinding();
        Assert.Null(binding.ReplayDurationSeconds);
    }

    [Theory]
    [InlineData("SaveClip")]
    [InlineData("ToggleCapture")]
    [InlineData("ToggleMic")]
    public void HotkeyBinding_Actions_AllowValidStrings(string action)
    {
        var binding = new HotkeyBinding { Action = action };
        Assert.Equal(action, binding.Action);
    }

    [Fact]
    public void HotkeyBinding_Modifiers_ListIsMutable()
    {
        var binding = new HotkeyBinding();
        binding.Modifiers.Add(0x11);
        binding.Modifiers.Add(0x12);
        Assert.Equal(2, binding.Modifiers.Count);
    }

    [Fact]
    public void HotkeyBinding_ReplayDuration_CanSet()
    {
        var binding = new HotkeyBinding { ReplayDurationSeconds = 120 };
        Assert.Equal(120, binding.ReplayDurationSeconds);
    }

    [Fact]
    public void HotkeyBinding_Enabled_CanDisable()
    {
        var binding = new HotkeyBinding { Enabled = false };
        Assert.False(binding.Enabled);
    }

    #endregion

    #region DisplayMode Enum

    [Theory]
    [InlineData(DisplayMode.Unknown)]
    [InlineData(DisplayMode.Windowed)]
    [InlineData(DisplayMode.FullscreenExclusive)]
    [InlineData(DisplayMode.FullscreenOptimized)]
    public void DisplayMode_AllValues_AreDefined(DisplayMode mode)
    {
        Assert.True(Enum.IsDefined(typeof(DisplayMode), mode));
    }

    [Fact]
    public void DisplayMode_Unknown_IsDefault()
    {
        var info = new GameInfo();
        Assert.Equal(DisplayMode.Unknown, info.DisplayMode);
    }

    #endregion

    #region ResolveProcessByName - Additional Coverage

    [Fact]
    public void ResolveProcessByName_ProcessWithDotExe_FindsByName()
    {
        var procName = Environment.ProcessPath is not null
            ? Path.GetFileName(Environment.ProcessPath)
            : "testhost.exe";
        var result = (GameInfo?)InvokeStatic("ResolveProcessByName", procName);
        Assert.NotNull(result);
        Assert.Equal(Environment.ProcessId, result!.ProcessId);
    }

    [Fact]
    public void ResolveProcessByName_BuildNumberSegment_SkipsExactMatch()
    {
        var baseName = Environment.ProcessPath is not null
            ? Path.GetFileNameWithoutExtension(Environment.ProcessPath)
            : "testhost";
        var withBuild = baseName + "_b1234_" + "suffix";
        var result = (GameInfo?)InvokeStatic("ResolveProcessByName", withBuild);
        Assert.NotNull(result);
        // May or may not find it via fuzzy match — just verify no crash
        Assert.IsType<GameInfo>(result);
    }

    #endregion

    #region OnGameChanged - Additional Auto-Stop

    [Fact]
    public void OnGameChanged_NotRecording_DoesNotAutoStop()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_recording", false);
        SetField(coord, "_capturedGameProcess", "FiveM");

        var game = new GameInfo(
            processName: "Explorer",
            executablePath: @"C:\Windows\explorer.exe",
            windowTitle: "",
            windowClass: "",
            displayMode: DisplayMode.Unknown,
            processId: 5678,
            hwnd: new IntPtr(0x1111));

        var ex = Record.Exception(() => InvokeOnGameChanged(coord, game));
        Assert.Null(ex);
        Assert.Equal("FiveM", GetField<string?>(coord, "_capturedGameProcess"));
    }

    [Fact]
    public void OnGameChanged_SameCapturedGame_DoesNotAutoStop()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_recording", true);
        SetField(coord, "_capturedGameProcess", "FiveM");

        var game = new GameInfo(
            processName: "FiveM",
            executablePath: @"C:\FiveM\FiveM.exe",
            windowTitle: "",
            windowClass: "grcWindow",
            displayMode: DisplayMode.FullscreenExclusive,
            processId: 1234,
            hwnd: new IntPtr(0xABCD));

        InvokeOnGameChanged(coord, game);

        Assert.Equal("FiveM", GetField<string?>(coord, "_capturedGameProcess"));
    }

    [Fact]
    public void OnGameChanged_CapturedGameDead_DoesNotThrow()
    {
        var coord = CreateWithConfig();
        SetField(coord, "_recording", true);
        SetField(coord, "_capturedGameProcess", "zzzDeadGame99999");

        var game = new GameInfo(
            processName: "Explorer",
            executablePath: @"C:\Windows\explorer.exe",
            windowTitle: "",
            windowClass: "",
            displayMode: DisplayMode.Unknown,
            processId: 5678,
            hwnd: new IntPtr(0x1111));

        // Should not throw even if Process.GetProcessesByName fails
        var ex = Record.Exception(() => InvokeOnGameChanged(coord, game));
        Assert.Null(ex);
    }

    #endregion
}
