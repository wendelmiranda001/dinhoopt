using DiNho.Capture.Poc.Ipc;
using DiNho.Capture.Poc.Logging;
using System.Text.Json;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    private IpcMessage HandleCaptureMessages(IpcMessage msg, string action)
    {
        return action switch
        {
            "startCapture" => HandleStartCapture(msg),
            "stopCapture" => HandleStopCapture(msg),
            "getStatus" => HandleGetStatus(),
            "saveClip" => throw new InvalidOperationException("saveClip must be awaited"),
            _ => throw new InvalidOperationException($"Unexpected capture action: {action}")
        };
    }

    private async Task<IpcMessage?> HandleCaptureMessagesAsync(IpcMessage msg, string action)
    {
        if (action == "saveClip")
            return await HandleSaveClip();
        return HandleCaptureMessages(msg, action);
    }

    private IpcMessage HandleStartCapture(IpcMessage msg)
    {
        if (_captureActive)
        {
            Log.I("EngineCoordinator", "startCapture ignorado — captura já ativa");
            return new IpcMessage { Action = "ok" };
        }
        if (msg.Value.HasValue)
        {
            try
            {
                var gameProcess = msg.Value.Value.GetProperty("gameProcess").GetString();
                if (!string.IsNullOrEmpty(gameProcess))
                {
                    _pendingGameProcess = gameProcess;
                    Log.I("EngineCoordinator", $"startCapture pending game process '{gameProcess}'");
                }
            }
            catch (Exception ex) { Log.D("IpcMessageHandler", $"startCapture: gameProcess not provided or invalid: {ex.Message}"); }
        }
        StartCapture();
        return new IpcMessage
        {
            Action = _captureActive ? "ok" : "error",
            Value = _captureActive
                ? null
                : JsonSerializer.SerializeToElement(new { error = "Capture failed to start" })
        };
    }

    private IpcMessage HandleStopCapture(IpcMessage msg)
    {
        // 5.5: stop IPC preserva o buffer por padrão (mesma semântica do hotkey);
        // o caller opta por limpar com clearBuffer:true explícito.
        var clearBuffer = false;
        if (msg.Value is { } payload && payload.TryGetProperty("clearBuffer", out var cb))
            clearBuffer = cb.ValueKind == JsonValueKind.True;

        StopCapture(clearBuffer);
        return new IpcMessage { Action = "ok" };
    }

    private IpcMessage HandleGetStatus()
    {
        return new IpcMessage
        {
            Action = "status",
            Value = JsonSerializer.SerializeToElement(GetStatusMessage())
        };
    }

    private async Task<IpcMessage?> HandleSaveClip()
    {
        var stats = _buffer.Stats();
        Log.I("EngineCoordinator", $"saveClip: video={stats.videoCount} audio={stats.audioCount} " +
            $"dur={stats.duration.TotalSeconds:F1}s bytes={stats.bytes} " +
            $"recording={_recording} captureActive={_captureActive}");
        if (stats.videoCount == 0)
        {
            return new IpcMessage
            {
                Action = "error",
                Value = JsonSerializer.SerializeToElement(new { error = "Nothing to save (buffer empty)" })
            };
        }
        return await SaveClipAndRespondAsync();
    }

    // ── Save Clip ──

    private async Task<IpcMessage?> SaveClipAndRespondAsync()
    {
        try
        {
            await SaveClipAsync();
            return new IpcMessage { Action = "ok" };
        }
        catch (Exception ex)
        {
            Log.E("EngineCoordinator", $"Export falhou: {ex.Message}");
            return new IpcMessage
            {
                Action = "error",
                Value = JsonSerializer.SerializeToElement(new { error = $"Export failed: {ex.Message}" })
            };
        }
    }
}
