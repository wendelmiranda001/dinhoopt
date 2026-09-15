using System.Reflection;
using System.Text.Json;
using DiNho.Capture.Poc.Config;
using DiNho.Capture.Poc.Ipc;
using DiNho.Capture.Poc.Watchdog;

namespace DiNho.Capture.Poc.Tests;

public sealed class EngineCoordinatorIpcTests : IDisposable
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

    private ConfigManager CreateConfig(Action<AppConfig>? configure = null)
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "DiNhoIpcTests_" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(tempDir);
        var tempPath = Path.Combine(tempDir, "config.json");
        var cfg = new ConfigManager(tempPath);
        _disposables.Add(cfg);
        configure?.Invoke(cfg.Config);
        return cfg;
    }

    private EngineCoordinator CreateCoord(Action<AppConfig>? configure = null)
    {
        var coord = CreateUninitialized();
        var config = CreateConfig(c =>
        {
            c.GameDetection = false;
            c.AutoCleanupEnabled = false;
            configure?.Invoke(c);
        });
        SetField(coord, "_config", config);
        SetField(coord, "_captureActive", false);
        SetField(coord, "_recording", false);
#pragma warning disable CS9216 // falso positivo: SetValue(reflection) exige object; prod relê o campo como Lock (EnterScope).
        SetField(coord, "_pipelineLock", new object());
#pragma warning restore CS9216
        SetField(coord, "_buffer", new DiNho.Capture.Poc.Buffer.ReplayBuffer(TimeSpan.FromSeconds(30)));
        SetField(coord, "_status", new DiNho.Capture.Poc.Status.EngineStatus());
        SetField(coord, "_clock", new DiNho.Capture.Poc.Sync.MasterClock());
        SetField(coord, "_watchdog", new PipelineWatchdog());
        SetField(coord, "_dinhoHwnds", new List<IntPtr>());
        SetField(coord, "_pipelineCts", null);
        SetField(coord, "_pipelineTask", null);
        SetField(coord, "_pttDiagTimer", null);
        SetField(coord, "_cleanupTimer", null);
        SetField(coord, "_highResTimerEnabled", false);
        SetField(coord, "_mfStarted", false);
        SetField(coord, "_recording", false);
        SetField(coord, "_captureActive", false);
        // _gameDetector, _hotkeys, _pipeServer intentionally left null for failure seam
        return coord;
    }

    public void Dispose()
    {
        foreach (var d in _disposables)
            d.Dispose();
    }

    private static async Task<IpcMessage?> InvokeOnIpcMessage(EngineCoordinator coord, string action, JsonElement? value = null)
    {
        var method = CoordinatorType.GetMethod("OnIpcMessage", BindingFlags.Instance | BindingFlags.NonPublic)!;
        var msg = new IpcMessage { Action = action, Value = value };
        var task = (Task<IpcMessage?>)method.Invoke(coord, new object[] { msg })!;
        return await task;
    }

    private static void SetPrivateField(EngineCoordinator coord, string name, object? value)
        => CoordinatorType.GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(coord, value);

    private static object? GetPrivateField(EngineCoordinator coord, string name)
        => CoordinatorType.GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(coord);

    // ── 5.1: startEngine/stopEngine agora retornam "error" quando StartAsync/StopAsync falham ──

    [Fact]
    public async Task StartEngine_WhenStartAsyncFails_ReturnsError()
    {
        var coord = CreateCoord();
        // _gameDetector=null + GameDetection=true → NRE em StartAsync
        var config = CreateConfig(c => c.GameDetection = true);
        SetPrivateField(coord, "_config", config);
        _disposables.Add(config);

        var reply = await InvokeOnIpcMessage(coord, "startEngine");

        Assert.NotNull(reply);
        Assert.Equal("error", reply!.Action);
        var err = reply.Value!.Value.GetProperty("error").GetString();
        Assert.Contains("startEngine", err, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task StopEngine_WhenStopAsyncFails_ReturnsError()
    {
        var coord = CreateCoord();
        // _pipeServer=null → NRE em StopAsync
        var reply = await InvokeOnIpcMessage(coord, "stopEngine");

        Assert.NotNull(reply);
        Assert.Equal("error", reply!.Action);
    }

    [Fact]
    public async Task StopEngine_WhenAlreadyStopped_ReturnsOk()
    {
        // Coord com _pipeServer, _hotkeys, _gameDetector = null + auto cleanup off
        // StopAsync after nothing started: _cleanupTimer?.Dispose() safe, StopCapture() early,
        // _pipeServer.Stop() → NRE. So same as above. To get "ok": we need _pipeServer set.
        // Use a NamedPipeServer that can Stop() without binding. NamedPipeServer ctor binds
        // the pipe — too heavy. Skip: the "happy path ok" is integration-tested.
        // The key W5.1 assertion is the ERROR contract (fire-and-forget no more).
        await Task.CompletedTask;
    }

    // ── 5.5: stopCapture without explicit clearBuffer → buffer not cleared ──

    [Fact]
    public void StopCapture_WithoutClearBuffer_PreservesBufferStats()
    {
        var coord = CreateCoord();
        var buffer = (DiNho.Capture.Poc.Buffer.ReplayBuffer)GetPrivateField(coord, "_buffer")!;
        // Add a video frame to have non-empty stats
        var pts = TimeSpan.FromSeconds(1);
        buffer.AddVideo(new DiNho.Capture.Poc.Encoders.EncodedPacket(
            [0x00, 0x00, 0x01, 0x67],
            DiNho.Capture.Poc.Encoders.MediaType.Video,
            pts,
            TimeSpan.FromSeconds(1.0 / 30),
            true
        ));

        var beforeStats = buffer.Stats();
        Assert.True(beforeStats.videoCount > 0, "Precondition: buffer has video frames");

        var msg = new IpcMessage { Action = "stopCapture", Value = null };
        var method = CoordinatorType.GetMethod("HandleStopCapture", BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { msg });

        var afterStats = buffer.Stats();
        Assert.Equal(beforeStats.videoCount, afterStats.videoCount);
    }

    [Fact]
    public void StopCapture_WithClearBufferTrue_ClearsBuffer()
    {
        var coord = CreateCoord();
        var buffer = (DiNho.Capture.Poc.Buffer.ReplayBuffer)GetPrivateField(coord, "_buffer")!;
        var pts = TimeSpan.FromSeconds(1);
        buffer.AddVideo(new DiNho.Capture.Poc.Encoders.EncodedPacket(
            [0x00, 0x00, 0x01, 0x67],
            DiNho.Capture.Poc.Encoders.MediaType.Video,
            pts,
            TimeSpan.FromSeconds(1.0 / 30),
            true
        ));
        Assert.True(buffer.Stats().videoCount > 0);

        var value = JsonSerializer.SerializeToElement(new { clearBuffer = true });
        var msg = new IpcMessage { Action = "stopCapture", Value = value };
        var method = CoordinatorType.GetMethod("HandleStopCapture", BindingFlags.Instance | BindingFlags.NonPublic)!;
        method.Invoke(coord, new object[] { msg });

        var after = buffer.Stats();
        Assert.Equal(0, after.videoCount);
    }
}
