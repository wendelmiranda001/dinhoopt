using System.Reflection;
using DiNho.Capture.Poc.Buffer;
using DiNho.Capture.Poc.Config;
using DiNho.Capture.Poc.Export;
using DiNho.Capture.Poc.GameDetection;
using DiNho.Capture.Poc.Hotkeys;
using DiNho.Capture.Poc.Ipc;
using DiNho.Capture.Poc.Status;
using DiNho.Capture.Poc.Sync;
using DiNho.Capture.Poc.Watchdog;

namespace DiNho.Capture.Poc.Tests;

public sealed class EngineCoordinatorDisposeTests : IDisposable
{
    private static readonly Type CoordinatorType = typeof(EngineCoordinator);
    private readonly List<ConfigManager> _disposables = new();

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

    private static object? GetField(EngineCoordinator coord, string name)
    {
        return CoordinatorType.GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(coord);
    }

    private static int CountSubscribers(object source, string eventFieldName)
    {
        var field = source.GetType().GetField(eventFieldName, BindingFlags.Instance | BindingFlags.NonPublic)!;
        return (field.GetValue(source) as Delegate)?.GetInvocationList().Length ?? 0;
    }

    private static T Bind<T>(EngineCoordinator coord, string methodName) where T : Delegate
    {
        var method = CoordinatorType.GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic)!;
        return (T)Delegate.CreateDelegate(typeof(T), coord, method);
    }

    private ConfigManager CreateConfig()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "DiNhoDisposeTests_" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(tempDir);
        var cfg = new ConfigManager(Path.Combine(tempDir, "config.json"));
        _disposables.Add(cfg);
        return cfg;
    }

    private EngineCoordinator CreateCoordWithModules()
    {
        var coord = CreateUninitialized();
        SetField(coord, "_config", CreateConfig());
        SetField(coord, "_dinhoHwnds", new List<IntPtr>());
#pragma warning disable CS9216 // falso positivo: SetValue(reflection) exige object; prod relê o campo como Lock (EnterScope).
        SetField(coord, "_pipelineLock", new object());
#pragma warning restore CS9216
        SetField(coord, "_buffer", new ReplayBuffer(TimeSpan.FromSeconds(30)));
        SetField(coord, "_status", new EngineStatus());
        SetField(coord, "_clock", new MasterClock());
        SetField(coord, "_watchdog", new PipelineWatchdog());
        SetField(coord, "_hotkeys", new HotkeyManager());
        SetField(coord, "_ptt", new PushToTalkManager((HotkeyManager)GetField(coord, "_hotkeys")!));
        SetField(coord, "_gameDetector", new GameDetector());
        SetField(coord, "_exporter", new ClipExporter());
        SetField(coord, "_pipeServer", new NamedPipeServer("DiNhoDisposeTests_" + Guid.NewGuid().ToString("N")[..8]));
        return coord;
    }

    public void Dispose()
    {
        foreach (var d in _disposables)
            d.Dispose();
    }

    [Fact]
    public void Dispose_ClearsAndDisposesCleanupTimer()
    {
        var coord = CreateCoordWithModules();
        SetField(coord, "_cleanupTimer", new Timer(_ => { }, null, Timeout.Infinite, Timeout.Infinite));

        coord.Dispose();

        Assert.Null(GetField(coord, "_cleanupTimer"));
    }

    [Fact]
    public void Dispose_UnsubscribesEventHandlersWiredInConstructor()
    {
        var coord = CreateCoordWithModules();
        var config = (ConfigManager)GetField(coord, "_config")!;
        var hotkeys = (HotkeyManager)GetField(coord, "_hotkeys")!;
        var ptt = (PushToTalkManager)GetField(coord, "_ptt")!;
        var gameDetector = (GameDetector)GetField(coord, "_gameDetector")!;
        var pipeServer = (NamedPipeServer)GetField(coord, "_pipeServer")!;

        if (CoordinatorType.GetField("_onConfigChangedHandler", BindingFlags.Instance | BindingFlags.NonPublic) is { } configHandlerField)
        {
            var configHandler = new Action<AppConfig>(_ => { });
            configHandlerField.SetValue(coord, configHandler);
            config.OnConfigChanged += configHandler;
            Assert.Equal(1, CountSubscribers(config, "OnConfigChanged"));
        }
        hotkeys.OnHotkeyPressed += Bind<Action<HotkeyPressedEventArgs>>(coord, "OnHotkeyPressed");
        gameDetector.OnGameChanged += Bind<Action<GameInfo>>(coord, "OnGameChanged");
        ptt.OnMicStateChanged += Bind<Action<bool>>(coord, "OnMicStateChanged");
        pipeServer.OnMessage += Bind<Func<IpcMessage, Task<IpcMessage?>>>(coord, "OnIpcMessage");
        pipeServer.GetStatus += Bind<Func<EngineStatusMessage>>(coord, "GetStatusMessage");
        pipeServer.OnStatusBroadcast += Bind<Action<EngineStatusMessage>>(coord, "BroadcastStatus");

        Assert.Equal(1, CountSubscribers(hotkeys, "OnHotkeyPressed"));
        Assert.Equal(1, CountSubscribers(gameDetector, "OnGameChanged"));
        Assert.Equal(1, CountSubscribers(ptt, "OnMicStateChanged"));
        Assert.Equal(1, CountSubscribers(pipeServer, "OnStatusBroadcast"));
        Assert.Single(pipeServer.OnMessage!.GetInvocationList());
        Assert.Single(pipeServer.GetStatus!.GetInvocationList());

        coord.Dispose();

        if (CoordinatorType.GetField("_onConfigChangedHandler", BindingFlags.Instance | BindingFlags.NonPublic) is not null)
            Assert.Equal(0, CountSubscribers(config, "OnConfigChanged"));
        Assert.Equal(0, CountSubscribers(hotkeys, "OnHotkeyPressed"));
        Assert.Equal(0, CountSubscribers(gameDetector, "OnGameChanged"));
        Assert.Equal(0, CountSubscribers(ptt, "OnMicStateChanged"));
        Assert.Equal(0, CountSubscribers(pipeServer, "OnStatusBroadcast"));
        Assert.Null(pipeServer.OnMessage);
        Assert.Null(pipeServer.GetStatus);
    }

    [Fact]
    public void Dispose_WithNullModules_DoesNotThrow()
    {
        var coord = CreateUninitialized();
        SetField(coord, "_config", CreateConfig());
        SetField(coord, "_dinhoHwnds", new List<IntPtr>());
#pragma warning disable CS9216 // falso positivo: SetValue(reflection) exige object; prod relê o campo como Lock (EnterScope).
        SetField(coord, "_pipelineLock", new object());
#pragma warning restore CS9216
        SetField(coord, "_buffer", new ReplayBuffer(TimeSpan.FromSeconds(30)));
        SetField(coord, "_status", new EngineStatus());
        SetField(coord, "_clock", new MasterClock());
        SetField(coord, "_watchdog", new PipelineWatchdog());

        coord.Dispose();
    }
}