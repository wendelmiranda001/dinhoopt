using DiNho.Capture.Poc.Audio;
using DiNho.Capture.Poc.Hotkeys;
using DiNho.Capture.Poc.Ipc;
using DiNho.Capture.Poc.Logging;
using System.Text.Json;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    private IpcMessage HandleMicMessages(IpcMessage msg, string action)
    {
        return action switch
        {
            "getMicDevices" => HandleGetMicDevices(),
            "setMicDevice" => HandleSetMicDevice(msg),
            _ => throw new InvalidOperationException($"Unexpected mic action: {action}")
        };
    }

    private IpcMessage HandleGetMicDevices()
    {
        Log.I("EngineCoordinator", $"getMicDevices: enumerating...");
        var list = MicDeviceEnumerator.EnumerateMicDevices();
        Log.I("EngineCoordinator", $"getMicDevices: returning {list.Count} devices");
        return new IpcMessage
        {
            Action = "micDevices",
            Value = JsonSerializer.SerializeToElement(new { devices = list })
        };
    }

    private IpcMessage HandleSetMicDevice(IpcMessage msg)
    {
        try
        {
            if (msg.Value.HasValue)
            {
                var deviceId = msg.Value.Value.GetProperty("deviceId").GetString() ?? "";
                _config.Update(c => c.MicDeviceId = deviceId);

                // Se estiver capturando, recria o mic source com o novo device
                if (_recording)
                {
                    // Create new mixer BEFORE disposing old one to avoid null window
                    var oldMixer = _audioMixer;
                    _audioMixer = null;

                    try
                    {
                        _audioMixer = CreateAudioMixer();
                    }
                    catch (Exception ex)
                    {
                        // 5.4: antes só fazia _recording=false e relançava — sobrava
                        // pipeline rodando (zumbi) com estado inconsistente. Marca a
                        // captura inativa e encerra o pipeline de verdade.
                        _audioMixer = oldMixer;
                        _recording = false;
                        _captureActive = false;
                        Log.E("EngineCoordinator", $"setMicDevice: falha ao recriar o mixer ({ex.Message}) — encerrando captura");
                        try { StopCapture(); }
                        catch (Exception stopEx) { Log.W("EngineCoordinator", $"setMicDevice: StopCapture pós-falha falhou: {stopEx.Message}"); }
                        // Retorno antecipado: o deviceId novo já foi persistido no
                        // config e o StopCapture anulou/dispôs o mixer. Seguir adiante
                        // reaqueceria um mixer antigo/descartado (NRE + pipeline
                        // fantasma) — estado inconsciente que o comentário 5.4 queria
                        // eliminar.
                        return new IpcMessage { Action = "ok" };
                    }

                    var pttModeAtReinit = PttModeHelper.Normalize(_config.Config.PttMode);
                    if (pttModeAtReinit is "Hold" or "Toggle")
                        _audioMixer.MicEnabled = _ptt.MicActive;
                    else
                        _audioMixer.MicEnabled = _config.Config.MicEnabled;
                    Log.I("EngineCoordinator", $"[reinitMic] pttMode={pttModeAtReinit} pttActive={_ptt.MicActive} -> MicEnabled={_audioMixer.MicEnabled}");
                    _audioMixer.GameGain = _config.Config.GameVolume;
                    _audioMixer.MicGain = _config.Config.MicVolume;
                    _audioMixer.NoiseSuppressionEnabled = _config.Config.NoiseSuppressionEnabled;
                    _audioMixer.OnMixedAudio += OnAudioPacket;
                    _audioMixer.Start();

                    // Dispose old AFTER new is successfully created and started
                    oldMixer?.Stop();
                    oldMixer?.Dispose();
                }

                Log.I("EngineCoordinator", $"Mic device set to '{deviceId}'");
            }
        }
        catch (Exception ex)
        {
            Log.E("EngineCoordinator", $"Erro ao setar mic device: {ex.Message}");
        }
        return new IpcMessage { Action = "ok" };
    }
}
