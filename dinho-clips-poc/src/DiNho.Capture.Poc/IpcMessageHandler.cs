using DiNho.Capture.Poc.Ipc;
using System.Text.Json;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    // ── IPC Message Handler ──
    // Dispatches to focused handler methods in partial class files:
    //   IpcMessageHandler.Config.cs  — handshake, setReplayTime, startEngine, stopEngine, setCustomGameProcess, config, getGpus
    //   IpcMessageHandler.Capture.cs — startCapture, stopCapture, getStatus, saveClip
    //   IpcMessageHandler.Audio.cs   — getAudioSessions, setAudioSessions
    //   IpcMessageHandler.Mic.cs     — getMicDevices, setMicDevice
    //   IpcMessageHandler.Clips.cs   — listClips, deleteClip, renameClip

    private async Task<IpcMessage?> OnIpcMessage(IpcMessage msg)
    {
        switch (msg.Action)
        {
            // Config messages
            case "handshake":
            case "setReplayTime":
            case "setCustomGameProcess":
            case "config":
            case "getGpus":
                return HandleConfigMessages(msg, msg.Action);

            // Lifecycle — awaitado: erro real vira "error" em vez de fire-and-forget.
            case "startEngine":
            case "stopEngine":
                return await HandleEngineLifecycleAsync(msg.Action);

            // Capture messages (saveClip needs async)
            case "startCapture":
            case "stopCapture":
            case "getStatus":
            case "saveClip":
                return await HandleCaptureMessagesAsync(msg, msg.Action);

            // Audio messages
            case "getAudioSessions":
            case "setAudioSessions":
                return HandleAudioMessages(msg, msg.Action);

            // Mic messages
            case "getMicDevices":
            case "setMicDevice":
                return HandleMicMessages(msg, msg.Action);

            // Clips messages
            case "listClips":
            case "deleteClip":
            case "renameClip":
                return HandleClipsMessages(msg, msg.Action);

            default:
                return new IpcMessage
                {
                    Action = "error",
                    Value = JsonSerializer.SerializeToElement(new { error = $"Unknown action: {msg.Action}" })
                };
        }
    }

}
