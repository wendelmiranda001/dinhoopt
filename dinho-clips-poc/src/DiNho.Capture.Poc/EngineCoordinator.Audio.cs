using DiNho.Capture.Poc.Audio;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Logging;
using System.Diagnostics;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    private AudioMixer CreateAudioMixer()
    {
        Interlocked.Increment(ref _audioMixerGeneration);
        _audioFallback = false;
        var cfg = _config.Config;
        var sampleRate = cfg.AudioSampleRate is 44100 or 48000 or 96000 ? cfg.AudioSampleRate : 48000;

        // ── Loopback source (independente do mic) ──
        _loopbackSource = CreateLoopbackSource(sampleRate);

        // ── Mic source (independente do loopback) ──
        _micSource = CreateMicSource(sampleRate);

        // Limpa DeviceId inválido do config (só depois que _micSource já foi atribuído)
        if (_micSource is WasapiMicSource wasapiMic && string.IsNullOrEmpty(wasapiMic.DeviceId) && !string.IsNullOrEmpty(_config.Config.MicDeviceId))
        {
            Log.I("EngineCoordinator", $"Limpando MicDeviceId inválido '{_config.Config.MicDeviceId}' — usando default");
            _config.Update(c => c.MicDeviceId = "");
        }

        if (_loopbackSource == null && _micSource == null)
        {
            Log.W("EngineCoordinator", "Nenhum dispositivo de áudio disponível — captura será SOMENTE VÍDEO");
        }

        return new AudioMixer(_loopbackSource, _micSource, _clock);
    }

    private IAudioSource? CreateLoopbackSource(int sampleRate)
    {
        var cfg = _config.Config;
        try
        {
            if (cfg.UseExcludeMode && cfg.ExcludeProcessId > 0)
            {
                return CreateProcessLoopbackWithFallback(
                    cfg.ExcludeProcessId, includeTree: false, sampleRate,
                    $"EXCLUDE mode — excluindo PID {cfg.ExcludeProcessId} (e filhos), capturando TODO o resto");
            }

            var selectedPids = cfg.SelectedAudioSessions;

            if (selectedPids.Count > 0)
            {
                var processes = ResolveAudioPids(selectedPids);

                if (processes.Count > 0)
                {
                    foreach (var (pid, name) in processes)
                        Log.I("EngineCoordinator", $"PID alvo {pid}: {name}");

                    var (targetPid, _) = processes[0];
                    _audioFallback = false;
                    return CreateProcessLoopbackWithFallback(
                        targetPid, includeTree: true, sampleRate,
                        $"INCLUDE para {processes.Count} processo(s)");
                }

                Log.I("EngineCoordinator", "Nenhum PID selecionado está vivo — usando loopback completo");
            }
            else
            {
                Log.I("EngineCoordinator", "Áudio: captura completa (loopback) — NENHUM filtro ativo");
            }

            return new WasapiLoopbackSource(sampleRate);
        }
        catch (Exception ex)
        {
            Log.W("EngineCoordinator", $"Loopback indisponível: {ex.Message}");

            // Fallback: tenta WasapiLoopbackSource genérico se o C++ DLL falhou
            if (ex is not InvalidOperationException)
            {
                try
                {
                    Log.I("EngineCoordinator", "Tentando fallback para WasapiLoopbackSource...");
                    return new WasapiLoopbackSource(sampleRate);
                }
                catch (Exception ex2)
                {
                    Log.W("EngineCoordinator", $"Fallback loopback também falhou: {ex2.Message}");
                }
            }

            return null;
        }
    }

    /// <summary>
    /// Per-process loopback: NAudio 3 gerenciado primeiro (WasapiProcessLoopbackSource),
    /// C++ DLL (CppLoopbackSource) como fallback — Win10 &lt; 2004 ou falha de ativação.
    /// </summary>
    private IAudioSource CreateProcessLoopbackWithFallback(int pid, bool includeTree, int sampleRate, string modeLabel)
    {
        try
        {
            var source = new WasapiProcessLoopbackSource(pid, includeTree, sampleRate);
            try
            {
                // Start adiantado: valida a ativação WASAPI agora (BuildAsync roda aqui)
                // para que falha caia no fallback da DLL. O Start() do AudioMixer vira no-op.
                source.Start();
                Log.I("EngineCoordinator", $"Áudio: {modeLabel} — NAudio 3 process loopback (PID {pid})");
                return source;
            }
            catch
            {
                source.Dispose();
                throw;
            }
        }
        catch (Exception ex)
        {
            Log.W("EngineCoordinator", $"NAudio 3 process loopback falhou (PID {pid}): {ex.Message} — caindo para C++ DLL");
        }

        Log.I("EngineCoordinator", $"Áudio: {modeLabel} — CppLoopbackSource (C++ DLL) PID {pid}");
        _audioFallback = false;
        return new CppLoopbackSource(pid, includeTree, sampleRate);
    }

    private IAudioSource? CreateMicSource(int sampleRate)
    {
        try
        {
            if (!string.IsNullOrEmpty(_config.Config.MicDeviceId))
                return new WasapiMicSource(sampleRate, _config.Config.MicDeviceId);
            else
                return new WasapiMicSource(sampleRate, null);
        }
        catch (Exception ex)
        {
            Log.W("EngineCoordinator", $"Microfone indisponível — captura continua sem mic: {ex.Message}");
            return null;
        }
    }

    private int _audioPacketCount;
    private int _audioSampleRate = 48000;
    private long _lastAudioAnchorTicks; // TimeSpan.Ticks via Interlocked (16-byte struct torn read fix)
    private int _maxAacDrainCount;

    private TimeSpan LastAudioAnchor
    {
        get => new TimeSpan(Interlocked.Read(ref _lastAudioAnchorTicks));
        set => Interlocked.Exchange(ref _lastAudioAnchorTicks, value.Ticks);
    }

    private void OnAudioPacket(EncodedPacket packet)
    {
        if (!_recording)
        {
            if (_audioPacketCount == 0)
                Log.D("AudioDiag", $"Primeiro packet DESCARTADO: !_recording. packet pts={packet.Pts.TotalSeconds:F3}s");
            _audioPacketCount++;
            return;
        }

        _audioPacketCount++;

        var anchor = LastAudioAnchor; // snapshot once — avoid repeated volatile reads

        if (_audioPacketCount <= 5 || _audioPacketCount % 100 == 0)
            Log.D("AudioDiag", $"packet #{_audioPacketCount} pts={packet.Pts.TotalSeconds:F3}s clock={_clock.Now.TotalSeconds:F3}s anchor={anchor.TotalSeconds:F3}s");

        // Envia PCM ao encoder ANTES de drenar AAC — o encoder precisa de dados
        // para produzir frames. A drenagem usa _lastAudioAnchor (PTS do batch PCM
        // que gerou estes AAC frames), que é atualizado SÓ DEPOIS do drain.
        if (packet.PcmSamples != null)
        {
            if (_aacEncoder is { IsHealthy: true })
            {
                _aacEncoder.EncodeAudio(packet.PcmSamples);
            }
            else
            {
                // Auto-recovery: se o encoder morreu, tenta recriar (max 3 vezes por sessão)
                if (_aacEncoderRecoveryAttempts < 3)
                {
                    _aacEncoderRecoveryAttempts++;
                    Log.E("AudioDiag", $"encoder UNHEALTHY — auto-recovery attempt {_aacEncoderRecoveryAttempts}/3");
                    try
                    {
                        _aacEncoder?.Dispose();
                        _aacEncoder = new FfmpegAacEncoder();
                        _aacEncoder.Initialize(_audioSampleRate, 2, 192000);
                        _aacEncoder.EncodeAudio(packet.PcmSamples);
                        Log.I("AudioDiag", $"AAC encoder recriado com sucesso (PID={_aacEncoder.TotalAacFrames})");
                    }
                    catch (Exception ex)
                    {
                        Log.E("AudioDiag", $"Falha ao recriar encoder: {ex.Message}");
                    }
                }
                else if (_audioPacketCount % 5000 == 0)
                {
                    Log.W("AudioDiag", $"packet #{_audioPacketCount}: encoder UNHEALTHY — recovery esgotado ({_aacEncoderRecoveryAttempts} tentativas)");
                }
            }
        }
        else if (_audioPacketCount <= 5)
            Log.W("AudioDiag", $"packet #{_audioPacketCount}: PcmSamples=null (sem dados PCM)");

        // Drena AAC frames usando anchor (PTS do PCM que os produziu)
        // — NÃO packet.Pts (que pode ser de um batch MAIS NOVO se o encoder
        // estiver acumulando backlog). Isso limita o erro de PTS a ~20ms.
        int aacCount = 0;
        while (_aacEncoder?.TryReadPacket() is { } aacPkt)
        {
            aacCount++;
            var pts = anchor + TimeSpan.FromSeconds((double)(aacCount - 1) * 1024.0 / _audioSampleRate);
            var corrected = new EncodedPacket(aacPkt.Data, aacPkt.Type, pts, aacPkt.Duration, aacPkt.IsKeyFrame);
            _buffer.AddAudio(corrected);
        }

        // Avança o anchor SÓ DEPOIS do drain, usando o PTS do batch atual.
        // Antes o anchor era atualizado ANTES do drain, fazendo AAC frames
        // receberem PTS de batches MAIS NOVOS que os produziram.
        if (packet.Pts > anchor || anchor == TimeSpan.Zero)
            LastAudioAnchor = packet.Pts;

        // Diagnóstico de A/V sync: rastreia pico de aacCount (frames AAC drenados por batch).
        // Se aacCount > 1, o offset dentro do batch usa o mesmo anchor → erro potencial
        // de (aacCount-1) * 21.3ms (1024 samples / 48kHz).
        if (aacCount > _maxAacDrainCount)
            _maxAacDrainCount = aacCount;

        var currentAnchor = LastAudioAnchor;
        if (_audioPacketCount % 1000 == 0 && _audioPacketCount > 0)
            Log.I("AudioDiag", $"SYNC-DIAG: packets={_audioPacketCount} maxAacDrain={_maxAacDrainCount} anchorGap={(currentAnchor - TimeSpan.FromSeconds((_audioPacketCount - 1) * 1024.0 / _audioSampleRate)).TotalMilliseconds:F1}ms");

        if ((_audioPacketCount <= 5 || _audioPacketCount % 100 == 0) && aacCount > 0)
            Log.D("AudioDiag", $"packet #{_audioPacketCount}: AAC frames produced={aacCount}");
        else if (_audioPacketCount <= 5 && aacCount == 0 && packet.PcmSamples != null)
            Log.W("AudioDiag", $"packet #{_audioPacketCount}: AAC frames produced=0 (encoder pode estar aquecendo)");
    }

    private List<(int Pid, string Name)> ResolveAudioPids(Dictionary<int, string> selectedPids)
    {
        var resolved = new Dictionary<int, string>();
        foreach (var (pid, name) in selectedPids)
        {
            bool alive = false;
            try { using var p = Process.GetProcessById(pid); alive = !p.HasExited; }
            catch (Exception ex) { Log.W("AudioPids", $"PID {pid}: {ex.GetType().Name}"); }

            if (alive)
            {
                resolved[pid] = name;
                // Inclui subprocessos — FiveM e outros jogos modernos usam múltiplos processos
                // e o áudio pode vir de um filho (ex: FiveM_GTAProcess.exe)
                var children = GetChildProcesses(pid);
                foreach (var childPid in children)
                {
                    if (!resolved.ContainsKey(childPid))
                    {
                        resolved[childPid] = $"{name}>child#{childPid}";
                        Log.I("EngineCoordinator", $"Subprocesso encontrado: PID {childPid} (filho de {name}/{pid})");
                    }
                }
            }
            else
            {
                var matches = Process.GetProcessesByName(name.Replace(".exe", ""));
                try
                {
                    var found = matches.FirstOrDefault(p => !p.HasExited);
                    if (found != null)
                    {
                        Log.I("EngineCoordinator", $"PID {pid} ({name}) morto na resolução — resolvido para PID {found.Id}");
                        resolved[found.Id] = name;
                        // Também inclui subprocessos do PID resolvido
                        var children = GetChildProcesses(found.Id);
                        foreach (var childPid in children)
                        {
                            if (!resolved.ContainsKey(childPid))
                            {
                                resolved[childPid] = $"{name}>child#{childPid}";
                                Log.I("EngineCoordinator", $"Subprocesso {childPid} de {name} (resolvido)");
                            }
                        }
                    }
                }
                finally
                {
                    foreach (var m in matches) m.Dispose();
                }
            }
        }
        return resolved.Select(kvp => (kvp.Key, kvp.Value)).ToList();
    }

    private void ToggleMic()
    {
        var mixer = _audioMixer;
        if (mixer != null)
        {
            mixer.MicEnabled = !mixer.MicEnabled;
            Log.I("EngineCoordinator", $"[toggleMic] Microfone: {(mixer.MicEnabled ? "ATIVO" : "MUTO")}");
        }
    }

    private void OnMicStateChanged(bool active)
    {
        var mixer = _audioMixer;
        if (mixer != null)
            mixer.MicEnabled = active;
        Log.I("EngineCoordinator", $"[pttEvent] Microfone (PTT): {(active ? "ATIVO" : "MUTO")}");
    }
    private bool _appliedGameAudioOnly;

    private int _appliedGameAudioPid;

    private long _lastGameAudioOnlyRestartUtc;

    private void ApplyAudioSessionsInternal(List<int> pids)
    {
        _config.Update(c =>
        {
            if (pids.Count > 0)
            {
                var selectedPids = new Dictionary<int, string>();
                foreach (var pid in pids)
                {
                    try
                    {
                        using var proc = Process.GetProcessById(pid);
                        selectedPids[pid] = proc.ProcessName;
                    }
                    catch (Exception ex)
                    {
                        Log.W("EngineCoordinator", $"ApplyAudioSessionsInternal: PID {pid} lookup failed: {ex.Message}");
                        selectedPids[pid] = $"PID:{pid}";
                    }
                }
                c.SelectedAudioSessions = selectedPids;
            }
            else
            {
                c.SelectedAudioSessions = new Dictionary<int, string>();
            }
        });

        if (_recording)
            TryScheduleRestart("GameAudioOnly");
    }

    private void TryScheduleRestart(string reason)
    {
        lock (_restartLock)
        {
            if (_restartPending)
            {
                Log.I("EngineCoordinator", $"Restart já pendente — ignorando ({reason})");
                return;
            }
            _restartPending = true;
        }

        Log.I("EngineCoordinator", $"Reiniciando pipeline ({reason})...");
        _ = Task.Run(() =>
        {
            try
            {
                StopCapture();
                StartCapture();
            }
            finally
            {
                lock (_restartLock)
                    _restartPending = false;
            }
        });
    }
}
