using System.Collections.Concurrent;
using System.Reflection;
using System.Text.Json;
using DiNho.Capture.Poc.Ipc;

namespace DiNho.Capture.Poc.Tests;

public sealed class NamedPipeServerTests
{
    // ── IpcEnvelope ─────────────────────────────────────────────────

    [Fact]
    public void ToEnvelope_SetsVersionAndCommand()
    {
        var msg = new IpcMessage { Action = "startCapture", Value = null };
        var env = msg.ToEnvelope();
        Assert.Equal(1, env.Version);
        Assert.Equal("startCapture", env.Command);
    }

    [Fact]
    public void ToEnvelope_PreservesPayload()
    {
        var val = JsonSerializer.SerializeToElement(new { fps = 60 });
        var msg = new IpcMessage { Action = "setConfig", Value = val };
        var env = msg.ToEnvelope();
        Assert.NotNull(env.Payload);
        Assert.Equal(60, env.Payload.Value.GetProperty("fps").GetInt32());
    }

    [Fact]
    public void ToEnvelope_NullPayload_StaysNull()
    {
        var msg = new IpcMessage { Action = "ping" };
        var env = msg.ToEnvelope();
        Assert.Null(env.Payload);
    }

    // ── IpcMessage.FromEnvelope ─────────────────────────────────────

    [Fact]
    public void FromEnvelope_Version1_ReturnsMessage()
    {
        var env = new IpcEnvelope { Version = 1, Command = "stopCapture" };
        var msg = IpcMessage.FromEnvelope(env);
        Assert.NotNull(msg);
        Assert.Equal("stopCapture", msg.Action);
    }

    [Fact]
    public void FromEnvelope_Version2_ReturnsNull()
    {
        var env = new IpcEnvelope { Version = 2, Command = "test" };
        Assert.Null(IpcMessage.FromEnvelope(env));
    }

    [Fact]
    public void FromEnvelope_Version0_ReturnsNull()
    {
        var env = new IpcEnvelope { Version = 0, Command = "test" };
        Assert.Null(IpcMessage.FromEnvelope(env));
    }

    [Fact]
    public void FromEnvelope_PreservesPayload()
    {
        var payload = JsonSerializer.SerializeToElement(new { key = "value" });
        var env = new IpcEnvelope { Version = 1, Command = "cmd", Payload = payload };
        var msg = IpcMessage.FromEnvelope(env);
        Assert.NotNull(msg);
        Assert.NotNull(msg.Value);
        Assert.Equal("value", msg.Value.Value.GetProperty("key").GetString());
    }

    [Fact]
    public void FromEnvelope_NullPayload_StaysNull()
    {
        var env = new IpcEnvelope { Version = 1, Command = "cmd", Payload = null };
        var msg = IpcMessage.FromEnvelope(env);
        Assert.NotNull(msg);
        Assert.Null(msg.Value);
    }

    // ── Roundtrip ───────────────────────────────────────────────────

    [Fact]
    public void Roundtrip_SerializeEnvelope_PreservesData()
    {
        var original = new IpcEnvelope
        {
            Version = 1,
            Command = "setConfig",
            Payload = JsonSerializer.SerializeToElement(new { quality = "high", fps = 60 })
        };

        var json = JsonSerializer.Serialize(original);
        var deserialized = JsonSerializer.Deserialize<IpcEnvelope>(json);

        Assert.NotNull(deserialized);
        Assert.Equal(1, deserialized.Version);
        Assert.Equal("setConfig", deserialized.Command);
        Assert.NotNull(deserialized.Payload);
        Assert.Equal("high", deserialized.Payload.Value.GetProperty("quality").GetString());
        Assert.Equal(60, deserialized.Payload.Value.GetProperty("fps").GetInt32());
    }

    [Fact]
    public void Roundtrip_MessageToEnvelopeToMessage_PreservesAction()
    {
        var msg = new IpcMessage { Action = "saveClip", Value = JsonSerializer.SerializeToElement(new { path = "/tmp/clip.mp4" }) };
        var env = msg.ToEnvelope();
        var json = JsonSerializer.Serialize(env);
        var parsed = JsonSerializer.Deserialize<IpcEnvelope>(json);
        var result = IpcMessage.FromEnvelope(parsed!);

        Assert.NotNull(result);
        Assert.Equal("saveClip", result.Action);
        Assert.Equal("/tmp/clip.mp4", result.Value!.Value.GetProperty("path").GetString());
    }

    // ── JSON property names ─────────────────────────────────────────

    [Fact]
    public void Envelope_JsonPropertyNames_MatchExpected()
    {
        var env = new IpcEnvelope { Version = 1, Command = "test" };
        var json = JsonSerializer.Serialize(env);
        Assert.Contains("\"v\":1", json);
        Assert.Contains("\"cmd\":\"test\"", json);
    }

    [Fact]
    public void Message_JsonPropertyNames_MatchExpected()
    {
        var msg = new IpcMessage { Action = "ping", Version = "1.0" };
        var json = JsonSerializer.Serialize(msg);
        Assert.Contains("\"action\":\"ping", json);
        Assert.Contains("\"version\":\"1.0\"", json);
    }

    [Fact]
    public void Envelope_DeserializeFromJson_Works()
    {
        var json = """{"v":1,"cmd":"startCapture","payload":{"targetGame":"FiveM"}}""";
        var env = JsonSerializer.Deserialize<IpcEnvelope>(json);

        Assert.NotNull(env);
        Assert.Equal(1, env.Version);
        Assert.Equal("startCapture", env.Command);
        Assert.Equal("FiveM", env.Payload!.Value.GetProperty("targetGame").GetString());
    }

    // ── EngineStatusMessage ─────────────────────────────────────────

    [Fact]
    public void EngineStatusMessage_DefaultValues_AreCorrect()
    {
        var status = new EngineStatusValue();
        Assert.Equal("DXGI", status.CaptureBackend);
        Assert.Equal("NONE", status.Encoder);
        Assert.True(status.DiskSpaceOk);
        Assert.False(status.Recording);
        Assert.Null(status.Game);
        Assert.Equal(0, status.UptimeSeconds);
        Assert.False(status.AudioFallback);
    }

    [Fact]
    public void EngineStatusMessage_ToEnvelope_WrapsCorrectly()
    {
        var statusMsg = new EngineStatusMessage
        {
            Event = "engineStatus",
            Value = new EngineStatusValue
            {
                CaptureBackend = "WGC",
                Encoder = "NVENC",
                Game = "FiveM",
                Recording = true,
                UptimeSeconds = 120,
                DiskSpaceOk = true
            }
        };

        var env = statusMsg.ToEnvelope();

        Assert.Equal(1, env.Version);
        Assert.Equal("_event", env.Command);
        Assert.NotNull(env.Payload);

        var payloadJson = env.Payload.Value.GetRawText();
        Assert.Contains("engineStatus", payloadJson);
        Assert.Contains("WGC", payloadJson);
        Assert.Contains("NVENC", payloadJson);
        Assert.Contains("FiveM", payloadJson);
    }

    [Fact]
    public void EngineStatusMessage_SerializeRoundtrip_PreservesAllFields()
    {
        var statusMsg = new EngineStatusMessage
        {
            Event = "engineStatus",
            Value = new EngineStatusValue
            {
                CaptureBackend = "WGC",
                Encoder = "NVENC_H264",
                DiskSpaceOk = false,
                Game = "GTA5.exe",
                Recording = true,
                UptimeSeconds = 3600,
                AudioFallback = true,
                LastFrameMs = 16.67,
                LastClipSize = 52428800,
                ActivePipelines = 2,
                WatchdogOk = false,
                MemoryMB = 1024,
                ReplayBufferBytes = 536870912,
                ReplayBufferVideoFrames = 18000,
                ReplayBufferVideoBytes = 500000000,
                ReplayBufferAudioPackets = 18000,
                ReplayBufferAudioBytes = 36870912,
                OutputDirectory = "C:\\Users\\test\\DiNhoClips",
                CalibrationTier = "Medium"
            }
        };

        var env = statusMsg.ToEnvelope();
        var json = JsonSerializer.Serialize(env);
        var parsed = JsonSerializer.Deserialize<IpcEnvelope>(json);
        Assert.NotNull(parsed);
        Assert.Equal(1, parsed.Version);

        var dataElement = parsed.Payload!.Value.GetProperty("data");
        Assert.Equal("WGC", dataElement.GetProperty("captureBackend").GetString());
        Assert.Equal("NVENC_H264", dataElement.GetProperty("encoder").GetString());
        Assert.False(dataElement.GetProperty("diskSpaceOk").GetBoolean());
        Assert.Equal("GTA5.exe", dataElement.GetProperty("game").GetString());
        Assert.True(dataElement.GetProperty("recording").GetBoolean());
        Assert.Equal(3600, dataElement.GetProperty("uptimeSeconds").GetInt64());
        Assert.True(dataElement.GetProperty("audioFallback").GetBoolean());
        Assert.Equal(1024, dataElement.GetProperty("memoryMB").GetInt32());
        Assert.Equal(536870912, dataElement.GetProperty("replayBufferBytes").GetInt64());
        Assert.Equal("Medium", dataElement.GetProperty("calibrationTier").GetString());
    }

    // ── EngineStatusValue defaults ──────────────────────────────────

    [Theory]
    [InlineData(nameof(EngineStatusValue.CaptureBackend), "DXGI")]
    [InlineData(nameof(EngineStatusValue.Encoder), "NONE")]
    [InlineData(nameof(EngineStatusValue.OutputDirectory), "")]
    [InlineData(nameof(EngineStatusValue.CalibrationTier), "")]
    public void EngineStatusValue_DefaultStringFields(string propName, string expected)
    {
        var val = new EngineStatusValue();
        var prop = typeof(EngineStatusValue).GetProperty(propName);
        Assert.NotNull(prop);
        Assert.Equal(expected, prop!.GetValue(val));
    }

    [Theory]
    [InlineData(nameof(EngineStatusValue.DiskSpaceOk), true)]
    [InlineData(nameof(EngineStatusValue.Recording), false)]
    [InlineData(nameof(EngineStatusValue.AudioFallback), false)]
    [InlineData(nameof(EngineStatusValue.WatchdogOk), true)]
    [InlineData(nameof(EngineStatusValue.LastCrashRecovered), false)]
    public void EngineStatusValue_DefaultBoolFields(string propName, bool expected)
    {
        var val = new EngineStatusValue();
        var prop = typeof(EngineStatusValue).GetProperty(propName);
        Assert.NotNull(prop);
        Assert.Equal(expected, prop!.GetValue(val));
    }

    [Theory]
    [InlineData(nameof(EngineStatusValue.UptimeSeconds), 0L)]
    [InlineData(nameof(EngineStatusValue.LastClipSize), 0L)]
    [InlineData(nameof(EngineStatusValue.ReplayBufferBytes), 0L)]
    [InlineData(nameof(EngineStatusValue.ReplayBufferVideoBytes), 0L)]
    [InlineData(nameof(EngineStatusValue.ReplayBufferAudioBytes), 0L)]
    public void EngineStatusValue_DefaultLongFields(string propName, long expected)
    {
        var val = new EngineStatusValue();
        var prop = typeof(EngineStatusValue).GetProperty(propName);
        Assert.NotNull(prop);
        Assert.Equal(expected, prop!.GetValue(val));
    }

    // ── IpcMessage defaults ─────────────────────────────────────────

    [Fact]
    public void IpcMessage_DefaultAction_IsEmpty()
    {
        var msg = new IpcMessage();
        Assert.Equal("", msg.Action);
    }

    [Fact]
    public void IpcMessage_DefaultVersion_Is1_0()
    {
        var msg = new IpcMessage();
        Assert.Equal("1.0", msg.Version);
    }

    // ── Invalid JSON handling ───────────────────────────────────────

    [Fact]
    public void Deserialize_InvalidJson_ReturnsNull()
    {
        IpcEnvelope? env = null;
        try { env = JsonSerializer.Deserialize<IpcEnvelope>("not json at all"); }
        catch (JsonException) { }
        Assert.Null(env);
    }

    [Fact]
    public void Deserialize_EmptyJson_ReturnsDefaults()
    {
        var env = JsonSerializer.Deserialize<IpcEnvelope>("{}");
        Assert.NotNull(env);
        Assert.Equal(1, env.Version);
        Assert.Equal("", env.Command);
        Assert.Null(env.Payload);
    }

    [Fact]
    public void Deserialize_PartialEnvelope_HandlesGracefully()
    {
        var env = JsonSerializer.Deserialize<IpcEnvelope>("{\"v\":1}");
        Assert.NotNull(env);
        Assert.Equal(1, env.Version);
        Assert.Equal("", env.Command);
    }

    // ── EngineStatusMessage JSON structure ──────────────────────────

    [Fact]
    public void EngineStatusMessage_ToEnvelope_ContainsEventType()
    {
        var msg = new EngineStatusMessage { Event = "engineStatus" };
        var env = msg.ToEnvelope();
        var payloadStr = env.Payload!.Value.GetRawText();
        Assert.Contains("\"type\":\"engineStatus\"", payloadStr);
    }

    [Fact]
    public void EngineStatusMessage_CustomEvent_WrappedCorrectly()
    {
        var msg = new EngineStatusMessage { Event = "clipSaved", Value = new EngineStatusValue { LastClipSize = 1024 } };
        var env = msg.ToEnvelope();
        var payloadStr = env.Payload!.Value.GetRawText();
        Assert.Contains("clipSaved", payloadStr);
        Assert.Contains("1024", payloadStr);
    }

    // ═══════════════════════════════════════════════════════════════
    //  NamedPipeServer — BroadcastRaw queue
    // ═══════════════════════════════════════════════════════════════

    private static ConcurrentQueue<string> GetRawBroadcastQueue(NamedPipeServer server)
    {
        return (ConcurrentQueue<string>)typeof(NamedPipeServer)
            .GetField("_rawBroadcastQueue", BindingFlags.NonPublic | BindingFlags.Instance)!
            .GetValue(server)!;
    }

    private static void EnqueueLongRunningResultViaReflection(NamedPipeServer server, string json)
    {
        typeof(NamedPipeServer)
            .GetMethod("EnqueueLongRunningResult", BindingFlags.NonPublic | BindingFlags.Instance)!
            .Invoke(server, [json]);
    }

    private static ConcurrentQueue<string> GetLongRunningResultQueue(NamedPipeServer server)
    {
        return (ConcurrentQueue<string>)typeof(NamedPipeServer)
            .GetField("_longRunningResultQueue", BindingFlags.NonPublic | BindingFlags.Instance)!
            .GetValue(server)!;
    }

    private static HashSet<string> GetLongRunningCommands(NamedPipeServer server)
    {
        return (HashSet<string>)typeof(NamedPipeServer)
            .GetField("_longRunningCommands", BindingFlags.NonPublic | BindingFlags.Static)!
            .GetValue(null)!;
    }

    [Fact]
    public void BroadcastRaw_EnqueuesMessage()
    {
        using var server = new NamedPipeServer();
        var queue = GetRawBroadcastQueue(server);

        server.BroadcastRaw("{\"test\":1}");

        Assert.Single(queue);
        Assert.Equal("{\"test\":1}", queue.First());
    }

    [Fact]
    public void BroadcastRaw_MultipleMessages_AllEnqueued()
    {
        using var server = new NamedPipeServer();
        var queue = GetRawBroadcastQueue(server);

        server.BroadcastRaw("msg1");
        server.BroadcastRaw("msg2");
        server.BroadcastRaw("msg3");

        Assert.Equal(3, queue.Count);
    }

    [Fact]
    public void BroadcastRaw_OverMaxSize_TrimsOldest()
    {
        using var server = new NamedPipeServer();
        var queue = GetRawBroadcastQueue(server);

        for (int i = 0; i < 1002; i++)
            server.BroadcastRaw($"msg{i}");

        // MaxBroadcastQueueSize = 1000
        Assert.Equal(1000, queue.Count);
        // oldest was trimmed
        Assert.DoesNotContain("msg0", queue);
        Assert.Contains("msg1001", queue);
    }

    [Fact]
    public void EnqueueBounded_UnderMax_KeepsAll()
    {
        var queue = new ConcurrentQueue<string>();
        NamedPipeServer.EnqueueBounded(queue, "a", 3);
        NamedPipeServer.EnqueueBounded(queue, "b", 3);
        NamedPipeServer.EnqueueBounded(queue, "c", 3);

        Assert.Equal(3, queue.Count);
        Assert.Equal(new[] { "a", "b", "c" }, queue.ToArray());
    }

    [Fact]
    public void EnqueueBounded_OverMax_DropsOldest()
    {
        var queue = new ConcurrentQueue<string>();
        NamedPipeServer.EnqueueBounded(queue, "1", 2);
        NamedPipeServer.EnqueueBounded(queue, "2", 2);
        NamedPipeServer.EnqueueBounded(queue, "3", 2);

        Assert.Equal(2, queue.Count);
        Assert.Equal(new[] { "2", "3" }, queue.ToArray());
    }

    // ── EnqueueLongRunningResult ────────────────────────────────────

    [Fact]
    public void EnqueueLongRunningResult_EnqueuesMessage()
    {
        using var server = new NamedPipeServer();
        var queue = GetLongRunningResultQueue(server);

        EnqueueLongRunningResultViaReflection(server, "{\"result\":1}");

        Assert.Single(queue);
        Assert.Equal("{\"result\":1}", queue.First());
    }

    [Fact]
    public void EnqueueLongRunningResult_OverMaxSize_TrimsOldest()
    {
        using var server = new NamedPipeServer();
        var queue = GetLongRunningResultQueue(server);

        for (int i = 0; i < 34; i++)
            EnqueueLongRunningResultViaReflection(server, $"msg{i}");

        // MaxLongRunningResultQueueSize = 32
        Assert.Equal(32, queue.Count);
        Assert.DoesNotContain("msg0", queue);
        Assert.Contains("msg33", queue);
    }

    // ── Long-running commands ───────────────────────────────────────

    [Fact]
    public void LongRunningCommands_ContainsSaveClip()
    {
        using var server = new NamedPipeServer();
        var cmds = GetLongRunningCommands(server);
        Assert.Contains("saveClip", cmds);
    }

    [Fact]
    public void LongRunningCommands_ContainsTrimClip()
    {
        using var server = new NamedPipeServer();
        var cmds = GetLongRunningCommands(server);
        Assert.Contains("trimClip", cmds);
    }

    [Fact]
    public void LongRunningCommands_ContainsMergeClips()
    {
        using var server = new NamedPipeServer();
        var cmds = GetLongRunningCommands(server);
        Assert.Contains("mergeClips", cmds);
    }

    [Fact]
    public void LongRunningCommands_IsCaseInsensitive()
    {
        using var server = new NamedPipeServer();
        var cmds = GetLongRunningCommands(server);
        Assert.Contains("SaveClip", cmds);
        Assert.Contains("SAVECLIP", cmds);
    }

    [Fact]
    public void LongRunningCommands_DoesNotContainRegularCommands()
    {
        using var server = new NamedPipeServer();
        var cmds = GetLongRunningCommands(server);
        Assert.DoesNotContain("startCapture", cmds);
        Assert.DoesNotContain("setConfig", cmds);
        Assert.DoesNotContain("getStatus", cmds);
    }

    // ── ProcessLongRunningAsync ─────────────────────────────────────

    private static async Task ProcessLongRunningAsyncViaReflection(
        NamedPipeServer server, string cmd, IpcMessage msg, CancellationToken ct)
    {
        await (Task)typeof(NamedPipeServer)
            .GetMethod("ProcessLongRunningAsync", BindingFlags.NonPublic | BindingFlags.Instance)!
            .Invoke(server, [cmd, msg, ct])!;
    }

    [Fact]
    public async Task ProcessLongRunningAsync_WithResponse_EnqueuesCommandResult()
    {
        using var server = new NamedPipeServer();
        var queue = GetLongRunningResultQueue(server);

        var responseMsg = new IpcMessage { Action = "saveClip", Value = JsonSerializer.SerializeToElement(new { path = "/tmp/clip.mp4" }) };
        server.OnMessage = msg => Task.FromResult<IpcMessage?>(responseMsg);

        var msg = new IpcMessage { Action = "saveClip" };
        await ProcessLongRunningAsyncViaReflection(server, "saveClip", msg, CancellationToken.None);

        Assert.Single(queue);
        var resultJson = queue.First();
        var env = JsonSerializer.Deserialize<IpcEnvelope>(resultJson);
        Assert.NotNull(env);
        Assert.Equal("_event", env.Command);
        Assert.Equal(1, env.Version);

        var payload = env.Payload!.Value;
        Assert.Equal("commandResult", payload.GetProperty("type").GetString());
        Assert.Equal("saveClip", payload.GetProperty("originalCmd").GetString());
        Assert.NotEqual(JsonValueKind.Undefined, payload.GetProperty("value").ValueKind);
    }

    [Fact]
    public async Task ProcessLongRunningAsync_WithNullResponse_EnqueuesEmptyValue()
    {
        using var server = new NamedPipeServer();
        var queue = GetLongRunningResultQueue(server);

        server.OnMessage = msg => Task.FromResult<IpcMessage?>(null);

        var msg = new IpcMessage { Action = "saveClip" };
        await ProcessLongRunningAsyncViaReflection(server, "saveClip", msg, CancellationToken.None);

        Assert.Single(queue);
        var env = JsonSerializer.Deserialize<IpcEnvelope>(queue.First());
        var payload = env!.Payload!.Value;
        Assert.Equal("commandResult", payload.GetProperty("type").GetString());
        Assert.Equal("saveClip", payload.GetProperty("originalCmd").GetString());
        // value should be empty object
        var value = payload.GetProperty("value");
        Assert.True(value.ValueKind == JsonValueKind.Object);
        Assert.Empty(value.EnumerateObject());
    }

    [Fact]
    public async Task ProcessLongRunningAsync_WhenOnMessageThrows_EnqueuesError()
    {
        using var server = new NamedPipeServer();
        var queue = GetLongRunningResultQueue(server);

        server.OnMessage = msg => throw new InvalidOperationException("disk full");

        var msg = new IpcMessage { Action = "trimClip" };
        await ProcessLongRunningAsyncViaReflection(server, "trimClip", msg, CancellationToken.None);

        Assert.Single(queue);
        var env = JsonSerializer.Deserialize<IpcEnvelope>(queue.First());
        var payload = env!.Payload!.Value;
        Assert.Equal("commandResult", payload.GetProperty("type").GetString());
        Assert.Equal("trimClip", payload.GetProperty("originalCmd").GetString());
        Assert.Contains("disk full", payload.GetProperty("error").GetString());
    }

    // ── OnMessage / GetStatus delegates ─────────────────────────────

    [Fact]
    public void OnMessage_DefaultIsNull()
    {
        using var server = new NamedPipeServer();
        Assert.Null(server.OnMessage);
    }

    [Fact]
    public void GetStatus_DefaultIsNull()
    {
        using var server = new NamedPipeServer();
        Assert.Null(server.GetStatus);
    }

    [Fact]
    public void OnMessage_CanBeAssigned()
    {
        using var server = new NamedPipeServer();
        server.OnMessage = msg => Task.FromResult<IpcMessage?>(null);
        Assert.NotNull(server.OnMessage);
    }

    [Fact]
    public void GetStatus_CanBeAssigned()
    {
        using var server = new NamedPipeServer();
        server.GetStatus = () => new EngineStatusMessage { Value = new EngineStatusValue { Game = "Test" } };
        Assert.NotNull(server.GetStatus);
    }

    // ── OnStatusBroadcast event ─────────────────────────────────────

    [Fact]
    public void OnStatusBroadcast_CanSubscribeAndUnsubscribe()
    {
        using var server = new NamedPipeServer();
        Action<EngineStatusMessage> handler = msg => { };
        server.OnStatusBroadcast += handler;
        server.OnStatusBroadcast -= handler;
        // no exception = success
    }

    // ── Dispose ─────────────────────────────────────────────────────

    [Fact]
    public void Dispose_CanBeCalledMultipleTimes()
    {
        var server = new NamedPipeServer();
        server.Dispose();
        server.Dispose(); // no exception
    }

    // ── Start / Stop ────────────────────────────────────────────────

    [Fact]
    public void StartStop_CanBeCalledInSequence()
    {
        var server = new NamedPipeServer();
        server.Start();
        Thread.Sleep(100);
        server.Stop();
        // no exception = success
    }

    [Fact]
    public void Stop_WithoutStart_DoesNotThrow()
    {
        var server = new NamedPipeServer();
        server.Stop(); // should be safe
    }

    // ── EngineStatusValue extra fields ──────────────────────────────

    [Theory]
    [InlineData(nameof(EngineStatusValue.LastFrameMs), 0.0)]
    [InlineData(nameof(EngineStatusValue.ActivePipelines), 0)]
    [InlineData(nameof(EngineStatusValue.MemoryMB), 0)]
    public void EngineStatusValue_DefaultNumericFields(string propName, double expected)
    {
        var val = new EngineStatusValue();
        var prop = typeof(EngineStatusValue).GetProperty(propName);
        Assert.NotNull(prop);
        Assert.Equal(expected, Convert.ToDouble(prop!.GetValue(val)));
    }

    [Theory]
    [InlineData(nameof(EngineStatusValue.ReplayBufferVideoFrames), 0)]
    [InlineData(nameof(EngineStatusValue.ReplayBufferAudioPackets), 0)]
    public void EngineStatusValue_DefaultIntFields(string propName, int expected)
    {
        var val = new EngineStatusValue();
        var prop = typeof(EngineStatusValue).GetProperty(propName);
        Assert.NotNull(prop);
        Assert.Equal(expected, prop!.GetValue(val));
    }

    // ── IpcMessage from non-envelope JSON (fallback path) ───────────

    [Fact]
    public void FromEnvelope_NonVersion1_WithPayload_ReturnsNull()
    {
        var env = new IpcEnvelope { Version = 3, Command = "test", Payload = JsonSerializer.SerializeToElement(new { a = 1 }) };
        var msg = IpcMessage.FromEnvelope(env);
        Assert.Null(msg);
    }

    // ── EngineStatusMessage defaults ────────────────────────────────

    [Fact]
    public void EngineStatusMessage_DefaultEvent_IsEngineStatus()
    {
        var msg = new EngineStatusMessage();
        Assert.Equal("engineStatus", msg.Event);
    }

    [Fact]
    public void EngineStatusMessage_DefaultVersion_Is1_0()
    {
        var msg = new EngineStatusMessage();
        Assert.Equal("1.0", msg.Version);
    }

    [Fact]
    public void EngineStatusMessage_DefaultValue_IsNotNull()
    {
        var msg = new EngineStatusMessage();
        Assert.NotNull(msg.Value);
    }

    // ── EngineStatusValue roundtrip ─────────────────────────────────

    [Fact]
    public void EngineStatusValue_Serialize_PreservesAllJsonProperties()
    {
        var val = new EngineStatusValue
        {
            CaptureBackend = "DXGI",
            Encoder = "libx264",
            DiskSpaceOk = true,
            LastCrashRecovered = false,
            Game = "FiveM",
            Recording = false,
            UptimeSeconds = 600,
            AudioFallback = false,
            LastFrameMs = 16.67,
            LastClipSize = 1024000,
            ActivePipelines = 1,
            WatchdogOk = true,
            MemoryMB = 512,
            ReplayBufferBytes = 256000,
            OutputDirectory = "C:\\Clips",
            CalibrationTier = "Strong"
        };

        var json = JsonSerializer.Serialize(val);
        var parsed = JsonSerializer.Deserialize<EngineStatusValue>(json);

        Assert.NotNull(parsed);
        Assert.Equal("DXGI", parsed.CaptureBackend);
        Assert.Equal("libx264", parsed.Encoder);
        Assert.Equal("FiveM", parsed.Game);
        Assert.Equal(600, parsed.UptimeSeconds);
        Assert.Equal(16.67, parsed.LastFrameMs, 2);
        Assert.Equal(1024000, parsed.LastClipSize);
        Assert.Equal("C:\\Clips", parsed.OutputDirectory);
        Assert.Equal("Strong", parsed.CalibrationTier);
    }
}
