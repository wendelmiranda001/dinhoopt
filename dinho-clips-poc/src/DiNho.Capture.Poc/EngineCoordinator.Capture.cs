using DiNho.Capture.Poc.Audio;
using DiNho.Capture.Poc.Capture;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.GameDetection;
using DiNho.Capture.Poc.Graphics;
using DiNho.Capture.Poc.Logging;
using DiNho.Capture.Poc.Memory;
using DiNho.Capture.Poc.Watchdog;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.MediaFoundation;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.WindowsAndMessaging;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    private void ToggleCapture()
    {
        if (_captureActive)
            StopCapture(clearBuffer: true);
        else
            StartCapture();
    }

    /// <summary>
    /// Regra D3D11: quando um <see cref="IDXGIAdapter"/> é passado explicitamente
    /// para D3D11CreateDevice, o <see cref="DriverType"/> DEVE ser Unknown —
    /// Hardware + adapter não-nulo retorna E_INVALIDARG (0x80070057). Adapter nulo
    /// = Windows escolhe o default → Hardware.
    /// </summary>
    internal static DriverType SelectDeviceDriverType(IDXGIAdapter? adapter) =>
        SelectDeviceDriverType(adapter is not null);

    // Overload puro para teste unitário — a regra depende só de "há adapter ou
    // não", não do adapter em si (não dá para instanciar um IDXGIAdapter fake).
    internal static DriverType SelectDeviceDriverType(bool adapterProvided) =>
        adapterProvided ? DriverType.Unknown : DriverType.Hardware;

    /// <summary>
    /// Aplica a estratégia de buffer do <see cref="ReplayBufferMode"/> configurado
    /// sobre o buffer ativo (RAM caps + spill). Extraído de StartCapture para
    /// permitir teste unitário direto por reflexão.
    /// </summary>
    private void ApplyReplayBufferMode()
    {
        var buffer = _buffer;
        if (_config.Config.ReplayBufferMode == "hybrid")
        {
            // Híbrido: vídeo em RAM é capado em ~2 min (fixos); o excedente é
            // evictado para o disco (vídeo-only). Se a RAM segura não couber
            // 2 min no bitrate alvo, o cap encolhe para o que couber do
            // orçamento (ComputeSafeBudget já clampa no piso de 80MB) —
            // nunca excede a RAM segura. MaxBytes é elevado para o byte
            // budget do cap (90% vídeo + 10% áudio), então o teto de tempo
            // (2 min) é o limitante real — não o byte budget do perfil.
            long safeBudget = RamManager.ComputeSafeBudget(RamManager.GetAvailableRamBytes());
            var (ramCap, ramCapBytes) = RamManager.ComputeHybridRamCap(
                _activeProfile.MaxrateKbps, _activeProfile.ReplaySeconds, safeBudget);
            buffer.VideoRamDuration = ramCap;
            buffer.MaxBytes = ramCapBytes * 10L / 9L;
            if (!buffer.IsDiskSpillEnabled)
                buffer.EnableDiskSpill();
            Log.I("EngineCoordinator",
                $"Hybrid buffer: RAM cap video={ramCap.TotalSeconds:F0}s ({ramCapBytes / (1024 * 1024)}MB) " +
                $"diskSpill=ON budget={safeBudget / (1024 * 1024)}MB");
        }
        else if (_config.Config.ReplayBufferMode == "disk")
        {
            // Disk-only: RAM vira staging transitório (~1s). Todo o replay
            // (vídeo + áudio) vive no disco (spill), escrito sequentialmente
            // com buffer de 64KB e trim por janela de tempo no spill. RAM é
            // quase zero (1s de cada stream) → WGC/encoder/mixers ficam estáveis
            // mesmo em sessões longas; o custo é I/O síncrono extra no hot
            // path de captura (aceito explicitamente: "demora mais, mas HW ok").
            buffer.VideoRamDuration = TimeSpan.FromSeconds(1);
            buffer.AudioRamDuration = TimeSpan.FromSeconds(1);
            buffer.SpillAudioWhenEvicted = true;
            if (!buffer.IsDiskSpillEnabled)
                buffer.EnableDiskSpill();
            Log.I("EngineCoordinator",
                "Disk-only buffer: RAM staging ~1s video + ~1s audio, spill=ON (video+audio)");
        }
        else
        {
            // Legado 'ram': RAM guarda a janela completa; spill só emergencial
            // quando a duração pedida excede o que a RAM segura por bytes.
            buffer.VideoRamDuration = null;
            long neededBytes = (long)_activeProfile.MaxrateKbps * _activeProfile.ReplaySeconds * 1024L * 13L / 80L;
            if (neededBytes > _activeProfile.MaxBufferBytes && !buffer.IsDiskSpillEnabled)
            {
                buffer.EnableDiskSpill();
                Log.I("EngineCoordinator", $"Disk spill ENABLED — need={neededBytes / (1024 * 1024)}MB buf={_activeProfile.MaxBufferBytes / (1024 * 1024)}MB");
            }
        }
    }

    private void StartCapture()
    {
        lock (_pipelineLock)
        {
            if (_captureActive) return;

            try
            {
                // Se o usuário iniciou manualmente (Alt+1 ou botão), permite auto-start novamente
                _userStoppedProcess = "";

                _reinitCount = 0;
                _gameBackgrounded = false;
                _bgDropCount = 0;
                _fgGoodCount = 0;

                var game = ResolveTargetGame();
                _captureTargetGame = game;

                _captureActive = true;

                Log.I("EngineCoordinator", "=== StartCapture INICIADO ===");

                // D3D11 device compartilhado entre capture + encoder
                if (_sharedDevice == null)
                {
                    var creationFlags = DeviceCreationFlags.BgraSupport;

                    // Item 2: resolve o adapter que detém o monitor do jogo (dGPU do
                    // monitor em notebooks híbridos); AdapterIndex do config vale como
                    // override manual. Null = Windows escolhe (comportamento atual).
                    var gameHwnd = _captureTargetHwnd != IntPtr.Zero
                        ? _captureTargetHwnd
                        : _gameDetector.CurrentGame.Hwnd;
                    IDXGIAdapter? resolvedAdapter = null;
                    if (gameHwnd != IntPtr.Zero)
                    {
                        resolvedAdapter = MonitorAdapterResolver.TryResolveGameAdapter(gameHwnd, _config.Config.AdapterIndex);
                        if (resolvedAdapter != null)
                            Log.I("EngineCoordinator", $"D3D11 device usando adapter {resolvedAdapter.Description.Description.TrimEnd('\0')} (AdapterIndex={_config.Config.AdapterIndex})");
                    }

                    // D3D11 exige DriverType.Unknown quando pAdapter != NULL (senão
                    // retorna E_INVALIDARG -2147024809). Com adapter nulo, o Windows
                    // escolhe o default → Hardware.
                    var driverType = SelectDeviceDriverType(resolvedAdapter);
                    var hr = Vortice.Direct3D11.D3D11.D3D11CreateDevice(
                        resolvedAdapter, driverType, creationFlags,
                        new[] { FeatureLevel.Level_11_1, FeatureLevel.Level_11_0 },
                        out _sharedDevice, out _, out _);

                    // Fallback defensivo: o adapter resolvido (monitor do jogo em
                    // multi-GPU) pode falhar por driver/OEM — tenta o adapter default.
                    if ((!hr.Success || _sharedDevice is null) && resolvedAdapter is not null)
                    {
                        Log.W("EngineCoordinator", $"D3D11CreateDevice({driverType}, adapter resolvido) falhou: {hr} — tentando adapter default");
                        hr = Vortice.Direct3D11.D3D11.D3D11CreateDevice(
                            null, DriverType.Hardware, creationFlags,
                            new[] { FeatureLevel.Level_11_1, FeatureLevel.Level_11_0 },
                            out _sharedDevice, out _, out _);
                    }
                    resolvedAdapter?.Dispose();
                    if (!hr.Success || _sharedDevice is null)
                    {
                        Log.E("EngineCoordinator", $"D3D11CreateDevice falhou: {hr}");
                        _captureActive = false;
                        return;
                    }
                    Log.I("EngineCoordinator", $"D3D11 device criado (feature level {_sharedDevice.FeatureLevel})");

                    _dxgiManager = MediaFactory.MFCreateDXGIDeviceManager();
                    _dxgiManager.ResetDevice(_sharedDevice!).CheckError();
                }
                Log.I("EngineCoordinator", "[1/7] D3D11 device OK");

                // Seleciona fonte de captura (WGC/DXGI/Hybrid/PrintWindow) — async selector with Task.Delay retries
                SelectCaptureSourceAsync().GetAwaiter().GetResult();
                Log.I("EngineCoordinator", "[2/7] SelectCaptureSource OK (async)");

                // WDA_EXCLUDEFROMCAPTURE — esconde a janela DnHo do recording.
                // Evita que o usuário veja a UI do DiNho ao alt-tab durante gameplay.
                ExcludeDinhoWindowFromCapture();

                if (_capture == null)
                {
                    Log.E("EngineCoordinator", "Nenhuma fonte de captura disponível");
                    _encoder?.Dispose();
                    _encoder = null;
                    _sharedDevice?.Dispose();
                    _sharedDevice = null;
                    _captureActive = false;
                    return;
                }

                // Inicializa dimensões reais da captura
                _captureWidth = Math.Max(_capture.Width, 320);
                _captureHeight = Math.Max(_capture.Height, 240);

                // Calibração por capacidade da máquina (defaults calibrados p/ PCs fracos)
                // roda ANTES do RamManager — que continua ajustando em runtime por cima.
                // Override explícito do usuário sempre vence. Não persiste em disco.
                var calibrationApplied = TryApplyMachineCalibration(_config, out var appliedTier);
                var calibrationTier = calibrationApplied ? appliedTier.ToString() : "";
                if (calibrationApplied)
                    Log.I("EngineCoordinator", $"Calibração de máquina aplicada: tier={calibrationTier}");

                // RamManager — resolve o perfil ANTES de criar o encoder, para que a
                // qualidade configurada pelo usuário (Cq/Maxrate/Bufsize/Bframes/Lookahead)
                // chegue ao encoder já no primeiro start. Antes, o encoder era criado
                // com o perfil default (Cq=20/Lookahead=4) e só o reinit do watchdog
                // usava os valores reais — a qualidade "Muito Alta" nunca era aplicada.
                if (_config.Config.AdaptiveQualityEnabled)
                {
                    // Recria o RamManager a cada sessão: ele armazena as dimensões e valores de
                    // config no construtor — reutilizar (??=) manteria valores obsoletos se o
                    // usuário mudasse a qualidade ou a resolução do jogo entre capturas.
                    _ramManager?.Dispose();
                    _ramManager = new RamManager(
                        _captureWidth, _captureHeight,
                        _config.Config.EffectiveReplaySeconds,
                        _config.Config.Cq,
                        _config.Config.MaxrateKbps,
                        _config.Config.BufsizeKbps,
                        _config.Config.Bframes,
                        _config.Config.Lookahead);
                    // Watchdog wiring: repassa a pressão de RAM ao pipe (broadcast) e reduz
                    // o replay buffer em RAM crítica, restaurando quando volta ao normal.
                    // Estes callbacks foram perdidos na refatoração para partial classes
                    // (08e8761) — sem eles o watchdog media mas nunca agia.
                    _ramManager.OnBroadcast = msg => _pipeServer.BroadcastRaw(msg);
                    _ramManager.OnReduceReplay = reducedReplay =>
                    {
                        // Callbacks são async (thread do watchdog) — _buffer/_activeProfile
                        // podem estar nulos se o stop for simultâneo. Guard defensivo.
                        if (_buffer != null && _buffer.MaxDuration > TimeSpan.FromSeconds(reducedReplay))
                        {
                            _buffer.MaxDuration = TimeSpan.FromSeconds(reducedReplay);
                            Log.W("EngineCoordinator", $"RAM crítica — replay buffer reduzido para {reducedReplay}s");
                        }
                    };
                    _ramManager.OnNormal = () =>
                    {
                        if (_buffer != null && _activeProfile != null)
                        {
                            _buffer.MaxDuration = TimeSpan.FromSeconds(_activeProfile.ReplaySeconds);
                            Log.I("EngineCoordinator", $"RAM normal — replay buffer restaurado para {_activeProfile.ReplaySeconds}s");
                        }
                    };
                    _ramManager.StartWatchdog();
                    _activeProfile = _ramManager.ResolveProfile();
                }
                else
                {
                    _ramManager?.StopWatchdog();
                    _activeProfile = RamManager.BuildSettings(
                        RamProfileLevel.Full, _captureWidth, _captureHeight,
                        _config.Config.Cq, _config.Config.EffectiveReplaySeconds,
                        _config.Config.MaxrateKbps, _config.Config.BufsizeKbps,
                        _config.Config.Bframes, _config.Config.Lookahead);
                    Log.I("EngineCoordinator", "AdaptiveQuality DISABLED — usando config do usuário sem ajuste RAM");
                }

                // Resolução de saída do usuário: nunca faz upscale (limita à captura nativa) e
                // respeita o cap de resolução do perfil RAM (LowMemory ≤1280×720, Balanced height ≤1080).
                int profileCapW = _activeProfile.EncodeWidth > 0 ? _activeProfile.EncodeWidth : _captureWidth;
                int profileCapH = _activeProfile.EncodeHeight > 0 ? _activeProfile.EncodeHeight : _captureHeight;
                _outputWidth = Math.Max(0, Math.Min(_config.Config.Width, Math.Min(_captureWidth, profileCapW))) & ~1;
                _outputHeight = Math.Max(0, Math.Min(_config.Config.Height, Math.Min(_captureHeight, profileCapH))) & ~1;
                Log.I("EngineCoordinator", $"Output resolution: user={_config.Config.Width}x{_config.Config.Height} capture={_captureWidth}x{_captureHeight} profileCap={profileCapW}x{profileCapH} → encoded={(_outputWidth > 0 ? $"{_outputWidth}x{_outputHeight}" : "native")}");

                // Encoder (NVENC/AMF/QSV/software) — usa o perfil já resolvido
                Log.I("EngineCoordinator", $"EncoderPreset config: '{_config.Config.EncoderPreset}' Cq={_activeProfile.Cq} Maxrate={_activeProfile.MaxrateKbps}kbps Bframes={_activeProfile.Bframes} Lookahead={_activeProfile.Lookahead}");
                _encoder?.Dispose();
                _encoder = null;
                _encoder = EncoderManager.CreateBestEncoder(_config.Config.ForceSoftware, _sharedDevice, _activeProfile.MaxrateKbps);
                if (_encoder is FfmpegEncoder fe)
                {
                    fe.SetQualityParams(
                        cq: _activeProfile.Cq,
                        maxrateKbps: _activeProfile.MaxrateKbps,
                        bufsizeKbps: _activeProfile.BufsizeKbps,
                        bframes: _activeProfile.Bframes,
                        lookahead: _activeProfile.Lookahead,
                        preset: _config.Config.EncoderPreset,
                        codec: _config.Config.Codec,
                        multipass: _config.Config.Multipass);
                    Log.I("EngineCoordinator", $"SetQualityParams aplicado: preset='{_config.Config.EncoderPreset}' cq={_activeProfile.Cq} maxrate={_activeProfile.MaxrateKbps} bufsize={_activeProfile.BufsizeKbps} bf={_activeProfile.Bframes} lookahead={_activeProfile.Lookahead} multipass={_config.Config.Multipass}");
                fe.SetOutputResolution(_outputWidth, _outputHeight);
                fe.SetStretchToFit(_config.Config.StretchToFit);
                }
                _encoder.Initialize(_captureWidth, _captureHeight, _config.Config.Fps, _activeProfile.MaxrateKbps);
                _status.Update(s =>
                {
                    s.Recording = true;
                    s.Encoder = _encoder.GetType().Name.Replace("Encoder", "");
                    s.ActivePipelines = 1;
                    s.CalibrationTier = calibrationTier;
                });

                string encodedDesc = _outputWidth > 0 ? $"{_outputWidth}x{_outputHeight}" : $"{_captureWidth}x{_captureHeight}";
                Log.I("EngineCoordinator", $"[3/7] Encoder: {_encoder.GetType().Name} ({encodedDesc} @ {_config.Config.Fps}fps)");

                // Áudio
                _audioMixer = CreateAudioMixer();
                _audioSampleRate = _audioMixer.SampleRate;
                LastAudioAnchor = TimeSpan.Zero;
                _audioPacketCount = 0;
                _maxAacDrainCount = 0;
                _aacEncoderRecoveryAttempts = 0;
                _audioMixer.OnMixedAudio += OnAudioPacket;
                _audioMixer.Start();
                Log.I("EngineCoordinator", "[4/7] Audio mixer started");

                // AAC encoder
                _aacEncoder?.Dispose();
                _aacEncoder = null;
                _aacEncoder = new FfmpegAacEncoder();
                _aacEncoder.Initialize(_audioSampleRate, 2, 192000);
                Log.I("EngineCoordinator", "[5/7] AAC encoder initialized");

                // Limites do buffer (perfil já resolvido antes do encoder)
                var replayWindow = TimeSpan.FromSeconds(_activeProfile.ReplaySeconds);
                _buffer.MaxDuration = replayWindow;
                _buffer.MaxBytes = _activeProfile.MaxBufferBytes;
                Log.I("EngineCoordinator", "[6/7] Buffer limits aplicados");

                ApplyReplayBufferMode();

                Log.I("EngineCoordinator", $"RAM profile: {_activeProfile.Level} — {_activeProfile.EncodeWidth}x{_activeProfile.EncodeHeight} " +
                    $"maxRate={_activeProfile.MaxrateKbps}kbps maxBuf={_buffer.MaxBytes / (1024 * 1024)}MB " +
                    $"replay={_activeProfile.ReplaySeconds}s diskSpill={_buffer.IsDiskSpillEnabled}");

                // Pipeline loop
                _recording = true;
                _needsReinit = false;
                _pipelineCts = new CancellationTokenSource();
                _pipelineTask = Task.Run(() => PipelineLoop(_pipelineCts.Token));
                Log.I("EngineCoordinator", $"[7/7] Pipeline task created (status={_pipelineTask.Status})");

                // Timer de diagnóstico PTT
                _pttDiagTimer = new Timer(_ =>
                {
                    var mixer = _audioMixer;
                    // Guard de null: em testes/embeddings sem HotkeyManager, _ptt é null —
                    // exceção não tratada aqui crasha o processo inteiro (threadpool timer).
                    if (mixer != null && _ptt != null)
                        Log.D("PTT", $"pttKeys=[{string.Join(",", _config.Config.PushToTalkKeys)}] mode={_config.Config.PttMode} mic={mixer.MicEnabled} active={_ptt.MicActive}");
                }, null, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5));

                // Timer periódico de trim do VideoPacketPool: a cada 30s reduz
                // o idle para 64MB (1/4 de 256MB) — evita que o working set
                // fique preso no pico histórico mesmo com o buffer estabilizado.
                _poolTrimTimer = new Timer(_ =>
                {
                    try
                    {
                        var limit = VideoPacketPool.MaxIdleBytes / 4;
                        VideoPacketPool.TrimIdleBytes(limit);
                    }
                    catch { /* fail-closed: trim é best-effort */ }
                }, null, TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(30));

                Log.I("EngineCoordinator", "=== StartCapture CONCLUIDO ===");
            }
            catch (Exception ex)
            {
                Log.E("EngineCoordinator", $"=== StartCapture FALHOU: {ex.GetType().Name}: {ex.Message}\n{ex.StackTrace} ===");

                // Full cleanup so future startCapture calls can retry
                _recording = false;
                _captureActive = false;
                _captureTargetGame = new GameInfo();
                _captureTargetHwnd = IntPtr.Zero;

                _audioMixer?.Stop();
                _audioMixer?.Dispose();
                _audioMixer = null;

                _aacEncoder?.Dispose();
                _aacEncoder = null;

                _capture?.Dispose();
                _capture = null;

                _encoder?.Dispose();
                _encoder = null;

                _wgcPump?.Dispose();
                _wgcPump = null;

                _sharedDevice?.Dispose();
                _sharedDevice = null;

                _dxgiManager?.Dispose();
                _dxgiManager = null;

                _status.Update(s =>
                {
                    s.Recording = false;
                    s.CalibrationTier = "";
                });
            }
        }
    }

    private void StopCapture(bool clearBuffer = false)
    {
        lock (_pipelineLock)
        {
            _recording = false;
            _captureActive = false;
            _ramManager?.StopWatchdog();
            _captureTargetGame = new GameInfo();
            _captureTargetHwnd = IntPtr.Zero;
            _gameBackgrounded = false;
            _bgDropCount = 0;
            _fgGoodCount = 0;
            _consecutiveDrops = 0;
            _droppedFrames = 0;

            _pipelineCts?.Cancel();
            try
            {
                _pipelineTask?.Wait(2000);
            }
            catch (AggregateException)
            {
                // Pipeline cancelado ou falhou, ignorar
            }
            _pipelineTask = null;
            _pipelineCts?.Dispose();
            _pipelineCts = null;

            _audioMixer?.Stop();
            _audioMixer?.Dispose();
            _audioMixer = null;

            if (_loopbackSource != null)
            {
                _loopbackSource.Stop();
                _loopbackSource.Dispose();
                _loopbackSource = null;
            }

            if (_micSource != null)
            {
                _micSource.Stop();
                _micSource.Dispose();
                _micSource = null;
            }

            if (_aacEncoder != null)
            {
                var remaining = new List<EncodedPacket>();
                _aacEncoder.FlushAndDrain(remaining);
                int flushIdx = 0;
                foreach (var pkt in remaining)
                {
                    var pts = LastAudioAnchor + TimeSpan.FromSeconds((double)flushIdx * 1024.0 / _audioSampleRate);
                    flushIdx++;
                    var corrected = new EncodedPacket(pkt.Data, pkt.Type, pts, pkt.Duration, pkt.IsKeyFrame);
                    _buffer.AddAudio(corrected);
                }
                _aacEncoder.Dispose();
                _aacEncoder = null;
            }

            // Só o stop real do usuário (UI/hotkey) limpa o replay buffer.
            // Auto-recuperação do pipeline preserva os frames para o próximo save.
            if (clearBuffer)
            {
                _buffer.Clear();
            }

            // Reseta contadores entre sessões de captura
            _audioPacketCount = 0;
            _maxAacDrainCount = 0;
            _audioSampleRate = 48000;

            _capture?.Dispose();
            _capture = null;

            _pttDiagTimer?.Dispose();
            _pttDiagTimer = null;

            _poolTrimTimer?.Dispose();
            _poolTrimTimer = null;

            _encoder?.Dispose();
            _encoder = null;

            _wgcPump?.Dispose();
            _wgcPump = null;

            _sharedDevice?.Dispose();
            _sharedDevice = null;

            _dxgiManager?.Dispose();
            _dxgiManager = null;

            _status.Update(s =>
            {
                s.Recording = false;
                s.CalibrationTier = "";
            });
            Log.I("EngineCoordinator", "Captura parada.");

            // Restaura visibilidade da janela DnHo no recording
            RestoreDinhoWindowCapture();
        }
    }

    #region WDA_EXCLUDEFROMCAPTURE — exclude DnHo window from capture

    private readonly List<IntPtr> _dinhoHwnds = new();
    private int _wdaRetryCount;

    // Seams p/ teste determinístico do retry (P4).
    internal static int WdaRetryDelayMs = 2000;
    internal static Func<int, List<IntPtr>>? EnumerateDinhoHwndsProbe = null;
    internal static Func<IntPtr, bool>? WdaExcludeProbe = null;
    internal static Action<IntPtr>? WdaRestoreProbe = null;

    /// <summary>
    /// Finds DnHo windows by Electron PID and sets WDA_EXCLUDEFROMCAPTURE.
    /// This hides the DiNho UI from recording footage when the user alt-tabs.
    /// </summary>
    private unsafe void ExcludeDinhoWindowFromCapture()
    {
        var electronPid = _config.Config.ElectronPid;
        if (electronPid <= 0) return;
        try
        {
            var enumerated = EnumerateDinhoHwndsProbe != null
                ? EnumerateDinhoHwndsProbe(electronPid)
                : EnumerateDinhoHwnds(electronPid);

            lock (_dinhoHwnds)
            {
                _dinhoHwnds.Clear();
                var excluded = 0;
                foreach (var hwnd in enumerated)
                {
                    var ok = WdaExcludeProbe != null
                        ? WdaExcludeProbe(hwnd)
                        : WdaHelper.ExcludeWindowFromCapture(hwnd);
                    if (ok) excluded++;
                    _dinhoHwnds.Add(hwnd);
                }

                if (excluded > 0)
                {
                    Log.I("EngineCoordinator", $"WDA: excluded {excluded} DnHo window(s) from capture (PID={electronPid})");
                    return;
                }
            }

            ScheduleWdaRetryIfNeeded();
        }
        catch (Exception ex)
        {
            Log.W("EngineCoordinator", $"WDA exclude failed: {ex.Message}");
            ScheduleWdaRetryIfNeeded();
        }
    }

    private unsafe List<IntPtr> EnumerateDinhoHwnds(int electronPid)
    {
        var result = new List<IntPtr>();
        PInvoke.EnumWindows((hwnd, _) =>
        {
            uint pid;
            PInvoke.GetWindowThreadProcessId(hwnd, &pid);
            if (pid == electronPid && PInvoke.IsWindowVisible(hwnd))
                result.Add((IntPtr)hwnd);
            return true;
        }, default);
        return result;
    }

    /// <summary>
    /// Agenda um único retry (atrasado) para tentar excluir de novo.
    /// _wdaRetryCount == 0 => retry pendente/possível; == 1 => já agendado (at-most-once).
    /// RestoreDinhoWindowCapture zera o contador e cancela o retry pendente.
    /// </summary>
    private void ScheduleWdaRetryIfNeeded()
    {
        lock (_dinhoHwnds)
        {
            if (_wdaRetryCount != 0) return;
            _wdaRetryCount = 1;
        }
        Log.W("EngineCoordinator", "WDA: excluding failed — scheduling one retry to hide DnHo window(s)");
        _ = Task.Run(async () =>
        {
            await Task.Delay(WdaRetryDelayMs);
            lock (_dinhoHwnds)
            {
                if (_wdaRetryCount == 0) return;
                try
                {
                    ExcludeDinhoWindowFromCapture();
                }
                catch (Exception ex)
                {
                    Log.W("EngineCoordinator", $"WDA retry failed: {ex.Message}");
                }
            }
        });
    }

    /// <summary>
    /// Restores WDA_NONE on DnHo windows — makes them visible in capture again.
    /// </summary>
    private void RestoreDinhoWindowCapture()
    {
        List<IntPtr> toRestore;
        lock (_dinhoHwnds)
        {
            _wdaRetryCount = 0;
            if (_dinhoHwnds.Count == 0) return;
            toRestore = new List<IntPtr>(_dinhoHwnds);
            _dinhoHwnds.Clear();
        }

        try
        {
            foreach (var hwnd in toRestore)
            {
                if (WdaRestoreProbe != null) WdaRestoreProbe(hwnd);
                else WdaHelper.RestoreWindowCapture(hwnd);
            }
            Log.I("EngineCoordinator", $"WDA: restored {toRestore.Count} DnHo window(s) visibility");
        }
        catch (Exception ex)
        {
            Log.W("EngineCoordinator", $"WDA restore failed: {ex.Message}");
        }
    }

    #endregion

    // ── Agregação de frames dropped ──────────────────────────────────────────
    // Em vez de logar cada frame dropped (91 linhas numa rajada GPU típica),
    // loga no 1º drop e a cada 25 totais; ao recuperar, resume a rajada.
    internal static bool ShouldLogDrop(long totalDrops)
        => totalDrops == 1 || totalDrops % 25 == 0;

    internal static bool ShouldLogRecovery(int consecutiveDrops)
        => consecutiveDrops >= 5;

    // Timeout do WaitOne na captura — deve ser >= intervalo do cap do WGC
    // (ComputeCapIntervalTicks = 10_000_000 / fps). Truncar (1000 / fps) deixava
    // o timeout 0,33-0,67ms menor que o intervalo -> drop espúrio por corrida de
    // fase. Math.Ceiling garante margem >= intervalo; o produtor sinaliza exato.
    // Margem extra (opção C): o DWM entrega frames com jitter de 1-3ms; sem
    // folga, ~1/6 dos polls expiravam no instante da rejeição do cap (width=0).
    internal const int CaptureTimeoutMarginMs = 5;
    internal static int ComputeCaptureTimeoutMs(int fps)
        => fps <= 0 ? 1 : Math.Max(1, Math.Min(100, (int)Math.Ceiling(1000.0 / fps) + CaptureTimeoutMarginMs));

    // Timeout isolado do WaitOne pode ser jitter do DWM — o frame chega no
    // instante seguinte, fora da janela do cap. O 1º timeout é DIFERIDO: se o
    // próximo frame recuperar, nunca conta como drop nem toca o watchdog. Só
    // timeouts CONSECUTIVOS (stall real do WGC/DWM) progridem para a contagem.
    internal static bool ShouldDeferTimeoutDrop(ref bool pendingTimeoutDrop)
    {
        if (pendingTimeoutDrop)
        {
            return false;
        }
        pendingTimeoutDrop = true;
        return true;
    }

    // FASE 1 medição de footprint. GC.GetTotalMemory(false) = heap managed atual
    // (sem forçar coleta); GC.GetTotalAllocatedBytes() = alocado acumulado desde
    // o arranque (monotônico, útil p/ detectar churn não-recoletado). Delegates
    // permitem teste determinístico sem depender do estado real do runtime GC.
    internal static (long managed, long allocated) ReadGcDiagnostics(Func<long> getTotalMemory, Func<long> getAllocatedBytes)
        => (getTotalMemory(), getAllocatedBytes());

    // FASE 2 derivação de footprint. native = proc − heap managed (GPU/driver/
    // memória nativa); managedRetained = heap managed − ring (ReplayBuffer) − pool
    // ocioso (buckets retidos do VideoPacketPool). Ambos clampados ≥0 — quando a
    // medição erra o estado (ex.: GC coleta entre amostras), não reporta negativo.
    internal static (long native, long managedRetained) DeriveFootprint(long workingSetMb, long gcManagedMb, long ringBytesMb, long poolIdleBytesMb)
    {
        long native = workingSetMb - gcManagedMb;
        long managedRetained = gcManagedMb - ringBytesMb - poolIdleBytesMb;
        if (native < 0) native = 0;
        if (managedRetained < 0) managedRetained = 0;
        return (native, managedRetained);
    }

    // FASE 3 breakdown do heap por geração. Valores crus do GC.GetGCMemoryInfo()
    // (bytes) convertidos para MB: LOH = GenerationInfo[3].SizeAfterBytes,
    // gen2 = [2].SizeAfterBytes, gen01 = [0]+[1].SizeAfterBytes,
    // committed = TotalCommittedBytes. .NET não expõe pinned em bytes — o 5º
    // delegate recebe PinnedObjectsCount (contagem, não bytes); /MB resulta ~0
    // quando não há objetos pinados relevantes.
    // Delegates permitem teste determinístico sem depender do estado real do GC.
    internal static (long loh, long gen2, long gen01, long committed, long pinned) ReadGcBreakdown(
        Func<long> lohBytes, Func<long> gen2Bytes, Func<long> gen01Bytes, Func<long> committedBytes, Func<long> pinnedBytes)
    {
        const long MB = 1048576;
        return (lohBytes() / MB, gen2Bytes() / MB, gen01Bytes() / MB, committedBytes() / MB, pinnedBytes() / MB);
    }

    // ServerGC experiment: cumulative GC pause time (since process start), in ms.
    // The [RAM] tick logs total + per-tick delta so field logs can compare
    // pause behavior between Workstation GC baseline and ServerGC builds.
    internal static long ReadGcPauseMs(Func<TimeSpan> getTotalPause)
    {
        return (long)getTotalPause().TotalMilliseconds;
    }

    private void ReportDrop(string reason)
    {
        _consecutiveDrops++;
        _droppedFrames++;
        if (ShouldLogDrop(_droppedFrames))
        {
            Log.W("Pipeline", $"Frame dropped — drop #{_consecutiveDrops} consecutivo (total {_droppedFrames}). {reason}");
        }
    }

    private void LogRecoveryIfDropped()
    {
        if (_consecutiveDrops == 0)
        {
            return;
        }
        if (ShouldLogRecovery(_consecutiveDrops))
        {
            Log.I("Pipeline", $"Captura recuperada após {_consecutiveDrops} drops consecutivos (total {_droppedFrames} na sessão).");
        }
        _consecutiveDrops = 0;
    }

    private async Task PipelineLoop(CancellationToken ct)
    {
        try
        {
            Log.I("Pipeline", $"PipelineLoop INICIADO — capture={_capture?.GetType().Name ?? "null"} encoder={_encoder?.GetType().Name ?? "null"} fps={_config.Config.Fps} ct={ct.IsCancellationRequested}");
        }
        catch (Exception ex)
        {
            Log.E("Pipeline", $"PipelineLoop Log.I CRASHED: {ex.GetType().Name}: {ex.Message}");
            return;
        }

        // AvSetMmThreadCharacteristics prioriza esta thread no scheduler
        // como thread de captura multimídia, reduzindo latência e glitches
        SetMmThreadPriority();

        var frameIntervalUs = 1_000_000L / _config.Config.Fps;
        var frameDuration = TimeSpan.FromSeconds(1.0 / _config.Config.Fps);
        var frameDurationHns = frameDuration.Ticks;
        var freq = Stopwatch.Frequency;
        var freqPerUs = freq / 1_000_000L;
        var spinTargetTicks = 0L;
            var modeCheckDue = DateTime.UtcNow;
            var diagFrames = 0;
            var loggedFirstNullFrame = false;
            var loggedFirstFailFrame = false;
            var lastRamLogUtc = DateTime.UtcNow.AddSeconds(-2);

        while (!ct.IsCancellationRequested && _capture != null && _encoder != null)
        {
            var cap = _capture;
            var enc = _encoder;

            var beforeCapture = Stopwatch.GetTimestamp();
            // Captura o PTS da câmera ANTES de TryCaptureFrame — reflete o momento
            // real da captura, não o momento após latência de encoding (NVENC/AMF)
            var capturePts = TimeSpan.FromSeconds((double)(beforeCapture - _clock.StartTimestamp) / Stopwatch.Frequency);

            // Log de RAM em tempo real (~1s). Usa clock, não diagFrames, para que
            // continue rodando mesmo durante stall de vídeo (frames null/success=false)
            // — o cenário exato em que se quer vigiar crescimento de memória.
            var nowUtc = DateTime.UtcNow;
            if ((nowUtc - lastRamLogUtc).TotalSeconds >= 1)
            {
                lastRamLogUtc = nowUtc;
                var d = _buffer.StatsDetailed();
                double videoMb = d.videoBytes / (1024.0 * 1024.0);
                double audioMb = d.audioBytes / (1024.0 * 1024.0);
                double totalMb = videoMb + audioMb;
                long workingSetMb = 0;
                long gcManagedMb = 0;
                long allocatedMb = 0;
                long lohMb = 0;
                long gen2Mb = 0;
                long gen01Mb = 0;
                long committedMb = 0;
                long pinnedMb = 0;
                long gcPauseTotalMs = 0;
                try
                {
                    workingSetMb = Process.GetCurrentProcess().WorkingSet64 / (1024L * 1024L);
                    (gcManagedMb, allocatedMb) = ReadGcDiagnostics(
                        () => GC.GetTotalMemory(false) / (1024L * 1024L),
                        () => GC.GetTotalAllocatedBytes() / (1024L * 1024L));
                    var info = GC.GetGCMemoryInfo();
                    (lohMb, gen2Mb, gen01Mb, committedMb, pinnedMb) = ReadGcBreakdown(
                        () => info.GenerationInfo[3].SizeAfterBytes,
                        () => info.GenerationInfo[2].SizeAfterBytes,
                        () => info.GenerationInfo[0].SizeAfterBytes + info.GenerationInfo[1].SizeAfterBytes,
                        () => info.TotalCommittedBytes,
                        () => info.PinnedObjectsCount);
                    gcPauseTotalMs = ReadGcPauseMs(() => GC.GetTotalPauseDuration());
                }
                catch (Exception ex) { Log.D("RAM", $"working set sample failed: {ex.Message}"); }
                var ringMb = (long)Math.Round(totalMb);
                var poolIdleMb = VideoPacketPool.MaxIdleBytes / (1024L * 1024L);
                var (nativeMb, retainedMb) = DeriveFootprint(workingSetMb, gcManagedMb, ringMb, poolIdleMb);
                var gcPauseDeltaMs = Math.Max(0, gcPauseTotalMs - _lastGcPauseTotalMs);
                _lastGcPauseTotalMs = gcPauseTotalMs;
                Log.I("RAM", $"video={d.videoCount}frames {videoMb:F1}MB | audio={d.audioCount}pkts {audioMb:F1}MB | total={totalMb:F1}MB | duracao={d.videoDuration.TotalSeconds:F1}s | proc={workingSetMb}MB | gcManaged={gcManagedMb}MB | allocated={allocatedMb}MB | native={nativeMb}MB | managedRetained={retainedMb}MB | loh={lohMb}MB | gen2={gen2Mb}MB | gen01={gen01Mb}MB | committed={committedMb}MB | pinned={pinnedMb}MB | gcPause={gcPauseTotalMs}ms (+{gcPauseDeltaMs}ms)");
            }

            try
            {
                int captureTimeout = ComputeCaptureTimeoutMs(_config.Config.Fps);
                using var frame = cap?.TryCaptureFrame(captureTimeout);
                if (frame is null)
                {
                    if (!loggedFirstNullFrame)
                    {
                        loggedFirstNullFrame = true;
                        Log.E("Pipeline", $"TryCaptureFrame retornou NULL — cap={cap?.GetType().Name ?? "null"} cap disposed={cap == null}. Isso significa que _capture é null no momento da chamada.");
                    }
                    _watchdog.ReportDroppedFrame(PipelineIssue.CaptureError);
                    continue;
                }
                if (++diagFrames % 60 == 1)
                {
                    var captureType = _capture?.GetType().Name ?? "null";
                    Log.I("PipelineDiag", $"frame.Success={frame.Success} texture={(frame.Texture != null ? "ok" : "null")} " +
                        $"capture={captureType} encoder={(_encoder?.GetType().Name ?? "null")}");
                }
                if (frame.Success)
                {
                    if (frame.Texture != null)
                    {
                        if (diagFrames == 1)
                            Log.I("Pipeline", $"Primeiro frame com textura! width={frame.Width} height={frame.Height} captureType={_capture?.GetType().Name ?? "null"}");
                        if (_gameBackgrounded && frame.Texture != null)
                        {
                            _fgGoodCount++;
                            if (_fgGoodCount >= FG_DEBOUNCE_FRAMES)
                            {
                                _gameBackgrounded = false;
                                _fgGoodCount = 0;
                                Log.I("Pipeline", "Jogo retornou ao foreground — frames retomados");
                            }
                        }
                        else
                        {
                            _fgGoodCount = 0;
                        }
                        _bgDropCount = 0;
                        _starvationStart = default;
                        _pendingTimeoutDrop = false;
                        // NOTA: NoGCRegion removido aqui. O orçamento fixo de 4MB era
                        // estourado por keyframes grandes, forçando um full GC bloqueante
                        // no EndNoGCRegion (padrão de serra no working set). Com o
                        // VideoPacketPool reutilizando os arrays evictados, o churn de
                        // LOH sumiu e GCs gen0/gen1 rápidos não causam frame drops.
                        var encoded = enc.EncodeFrame(frame.Texture!, capturePts);
                        if (encoded != null)
                        {
                            _buffer.AddVideo(encoded);
                            var afterTicks = Stopwatch.GetTimestamp();
                            var elapsedMs = (afterTicks - beforeCapture) * 1000.0 / Stopwatch.Frequency;
                            _watchdog.ReportGoodFrame(elapsedMs);
                            _hasEverBeenHealthy = true;
                            TraceFeedFrame(beforeCapture, frame, afterTicks);
                            LogRecoveryIfDropped();
                        }
                        else
                        {
                            _feed.AddEncodeNull();
                            _watchdog.ReportDroppedFrame(PipelineIssue.EncodeError);
                            var isBusy = (enc as FfmpegEncoder)?.LastFrameBusyDrop ?? false;
                            ReportDrop(FfmpegEncoder.BuildEncodeDropReason(isBusy));
                        }
                    }
                    else
                    {
                        if (_starvationStart == default)
                        {
                            _starvationStart = DateTime.UtcNow;
                            Log.W("Pipeline", "Frame sem textura detectado — possível GPU starvation ou WGC throttle. Monitorando...");
                        }
                    }
                }
                else
                {
                    if (!loggedFirstFailFrame)
                    {
                        loggedFirstFailFrame = true;
                        Log.D("Pipeline", $"Primeiro frame Success=false capturado — width={frame.Width} height={frame.Height} waitMs={(frame.WaitEndTicks - frame.CaptureStartTicks) * 1000.0 / Stopwatch.Frequency:F1}. Monitorando...");
                    }
                    // Opção C: frame timeout (width=0 height=0) ISOLADO = jitter do
                    // DWM (o frame chega no instante seguinte, fora da janela do cap).
                    // O 1º é DIFERIDO — não conta como drop, não inicia starvation nem
                    // toca o watchdog. Se o próximo frame recuperar, nunca é contado.
                    // Só timeouts CONSECUTIVOS (stall real do WGC/DWM) progridem.
                    // O branch alt-tab/reinit abaixo ainda roda — frames ausentes por
                    // background não são jitter e precisam da contagem de _bgDropCount.
                    bool deferred = frame.Width == 0 && frame.Height == 0 &&
                        ShouldDeferTimeoutDrop(ref _pendingTimeoutDrop);

                    if (!deferred)
                    {
                        _feed.AddFailFrame();
                        if (_starvationStart == default)
                        {
                            _starvationStart = DateTime.UtcNow;
                            Log.W("Pipeline", "Frame dropped (Success=false) — possível GPU overload ou device busy. Monitorando...");
                        }
                        _watchdog.ReportDroppedFrame(PipelineIssue.NoFrame);
                        ReportDrop("Success=false — GPU overload ou device busy.");
                    }
                }

                if (!_needsReinit)
                {
                    // Se o processo alvo ainda está vivo, usamos WGC per-window E o
                    // jogo NÃO está em foreground, não reinicia — o usuário só
                    // alt-tabou e vai voltar. WGC per-window retoma frames
                    // naturalmente quando o jogo voltar ao foreground. O watchdog
                    // é resetado para evitar que o acúmulo de frames dropped
                    // dispare ShouldReinit() quando o jogo retornar.
                    //
                    // Se o jogo ESTÁ em foreground mas os frames não chegam, não é
                    // alt-tab — é stall do WGC (ex: DWM parou de entregar frames).
                    // Nesse caso cai no else-if e o watchdog/starvation podem reiniciar.
                    // Se o foreground atual é um processo não-jogo conhecido
                    // (AnyDesk, explorer, navegador...), não reinicia — o usuário
                    // está fora do jogo e vai voltar. Aplica a TODOS os backends
                    // (WGC/DXGI/hybrid), não só WGC per-window.
                    bool fgIsNonGame = IsForegroundNonGame();

                    if ((_capture is WgcCaptureSource && _captureTargetGame.IsValid &&
                        IsTargetProcessAlive() &&
                        !IsTargetGameForeground())
                        || fgIsNonGame)
                    {
                        _bgDropCount++;
                        if (_bgDropCount >= BG_DEBOUNCE_DROPS)
                        {
                            if (!_gameBackgrounded)
                            {
                                _gameBackgrounded = true;
                                Log.I("Pipeline", "Jogo em background (alt-tab) — frames ausentes. Aguardando retorno...");
                                // Libera páginas nativas/DWM do working set enquanto o jogo
                                // está em background — evita que o proc retorne ao patamar
                                // alto quando o jogo voltar ao foreground.
                                WorkingSetTrimmer.Trim();
                            }
                            _starvationStart = default;
                            _watchdog.Reset();
                            _pendingTimeoutDrop = false;
                        }
                    }
                    else if (_watchdog.ShouldReinit()
                        || (_starvationStart != default && (DateTime.UtcNow - _starvationStart).TotalSeconds > 8))
                    {
                        // Se o processo alvo MORREU enquanto backgrounded, sai do loop
                        // (não chama StopCapture() aqui para evitar deadlock com _pipelineTask.Wait)
                        if (_gameBackgrounded && _captureTargetGame.IsValid &&
                                 !IsTargetProcessAlive())
                        {
                            Log.I("Pipeline", $"Jogo '{_captureTargetGame.ProcessName}' fechou enquanto backgrounded — encerrando pipeline");
                            _recording = false;
                            _captureActive = false;
                            _captureTargetGame = new GameInfo();
                            _captureTargetHwnd = IntPtr.Zero;
                            // Não chama StopCapture() aqui: PipelineLoop É a _pipelineTask,
                            // e StopCapture() faz _pipelineTask.Wait(2000) → deadlock.
                            // Agenda o teardown completo para rodar DEPOIS que o loop
                            // sair e a task completar (evita zumbi: ffmpeg/encoder/áudio
                            // continuam rodando com recording=false).
                            _ = Task.Run(() => StopCapture());
                            break;
                        }
                        else
                        {
                            var health = _watchdog.GetHealth();
                            var starvationSec = (_starvationStart != default ? (DateTime.UtcNow - _starvationStart).TotalSeconds : 0);
                            Log.E("Pipeline", $"Reinit acionado: watchdog={_watchdog.ShouldReinit()} starvation={_starvationStart != default} " +
                                $"consecutiveGood={health.ConsecutiveGoodFrames} dropped={health.DroppedFrames}/{health.TotalFrames} " +
                                $"lastIssue={health.LastIssue} reinitCount={_reinitCount} starvationTime={starvationSec:F1}s");
                            if (starvationSec > 8)
                            {
                                Log.E("Pipeline", $"GPU starvation sustentado ({starvationSec:F0}s) — considere reduzir qualidade (preset/resolução) ou fechar aplicações que usam GPU");
                            }
                            _needsReinit = true;
                            _reinitCount++;
                            _ = ReinitializePipelineAsync();
                        }
                    }
                }

                if (modeCheckDue <= DateTime.UtcNow)
                {
                    modeCheckDue = DateTime.UtcNow.AddSeconds(2);
                    // Mode switching (DXGI↔PrintWindow) é gerenciado internamente
                    // pelo HybridCaptureSource via PickDesiredMode().
                    // NOTA (A1, 2026-08-01): UpdateDxgiCropRect foi removido —
                    // crop de janela não é mais aplicado. Capturas per-window
                    // (WGC) já isolam a janela do jogo na origem; aplicar crop
                    // em fallback de desktop exigia Flush() (restart do ffmpeg),
                    // que causava flickering no caminho quente. Se crop fixo for
                    // desejado no futuro, deve ser aplicado UMA vez em StartCapture
                    // (não periodicamente no loop).
                }

                // Status update a cada ~30 frames (~2Hz a 60fps): o consumidor real é
                // o broadcast IPC de 2s (Ipc/NamedPipeServer). Atualizar por frame
                // rodava GetHealth() 2x (~120 sorts/lista de ~600 entradas por segundo)
                // na thread de captura sem nenhum consumidor — puro desperdício de CPU.
                if (diagFrames % 30 == 0)
                {
                    var health = _watchdog.GetHealth();
                    _status.Update(s =>
                    {
                        s.LastFrameMs = health.AvgFrameTimeMs;
                        s.WatchdogOk = health.Level != HealthLevel.Red;
                        // M11: snapshot único (StatsDetailed) em vez de Stats()+StatsDetailed()
                        // — cada chamada adquire o read lock do ReplayBuffer separadamente.
                        // Uma chamada = uma aquisição = snapshot consistente + menos lock
                        // contention no hot path do status update.
                        var d = _buffer.StatsDetailed();
                        s.ReplayBufferBytes = d.videoBytes + d.audioBytes;
                        s.ReplayBufferVideoFrames = d.videoCount;
                        s.ReplayBufferVideoBytes = d.videoBytes;
                        s.ReplayBufferAudioPackets = d.audioCount;
                        s.ReplayBufferAudioBytes = d.audioBytes;
                        s.DroppedFrames = _droppedFrames;
                        s.GpuBusyDrops = (_encoder as FfmpegEncoder)?.GpuBusyDrops ?? 0;
                    });
                    LogFeedSummary();
                }

                // Log de RAM a cada ~60 frames (~1s a 60fps) — movido para o topo do
                // loop (clock-based) para continuar rodando durante stall de vídeo.

                // DriftMonitor: a cada ~300 frames (~5s a 60fps), verifica se o PTS de
                // vídeo e áudio estão divergindo. Loga warning se drift > 150ms (ITU-R perceptível).
                if (diagFrames % 300 == 0)
                {
                    var (vPts, aPts) = _buffer.StatsPtsRange();
                    if (vPts > TimeSpan.Zero && aPts > TimeSpan.Zero)
                    {
                        var driftMs = (aPts - vPts).TotalMilliseconds;
                        if (Math.Abs(driftMs) > DRIFT_WARN_THRESHOLD_MS)
                            Log.W("DriftMonitor", $"A/V PTS drift: audio={aPts.TotalSeconds:F2}s video={vPts.TotalSeconds:F2}s drift={driftMs:F0}ms (threshold={DRIFT_WARN_THRESHOLD_MS}ms)");
                        else if (diagFrames % 600 == 0)
                            Log.D("DriftMonitor", $"A/V PTS drift OK: drift={driftMs:F0}ms video={vPts.TotalSeconds:F2}s audio={aPts.TotalSeconds:F2}s");
                    }
                }
            }
            catch (Exception ex)
            {
                if (ex is DeviceLostException || cap?.CheckDeviceLost() == true)
                {
                    _deviceLost = true;
                    _needsReinit = true;
                    Log.E("Pipeline", $"Device D3D11 perdido ({ex.GetType().Name})! Recriando...");
                }
                _watchdog.ReportDroppedFrame(PipelineIssue.CaptureError);
                Log.E("Pipeline", $"Erro: {ex}");
            }

            // Timing preciso (QPC-based): sleep para o bulk, spin para o residual
            var elapsedSinceCapture = Stopwatch.GetTimestamp() - beforeCapture;
            var elapsedUs = elapsedSinceCapture / freqPerUs;
            var remainingUs = frameIntervalUs - elapsedUs;
            if (remainingUs > 500)
            {
                var remainingMs = (int)(remainingUs / 1000);
                await Task.Delay(Math.Max(1, remainingMs - 1), ct);
                spinTargetTicks = beforeCapture + frameIntervalUs * freqPerUs;
            }
            else
            {
                spinTargetTicks = beforeCapture + frameIntervalUs * freqPerUs;
            }

            while (Stopwatch.GetTimestamp() < spinTargetTicks && !ct.IsCancellationRequested)
                Thread.SpinWait(8);
        }

        var reason = ct.IsCancellationRequested ? "cancelamento" :
                     _capture == null ? "captura nula" :
                     _encoder == null ? "encoder nulo" : "desconhecido";
        Log.E("Pipeline", $"Loop encerrado: {reason} diagFrames={diagFrames} loggedFirstNull={loggedFirstNullFrame} loggedFirstFail={loggedFirstFailFrame}");
        RevertMmThreadPriority();
    }

    /// <summary>
    /// Alimenta o <see cref="FeedTelemetry"/> com os tempos por estágio do frame que
    /// acaba de cruzar o pipeline (wait WGC / copy para o pool / convert+enqueue / total).
    /// <paramref name="afterTicks"/> é o timestamp logo após AddVideo (janela fecha no total).
    /// </summary>
    private void TraceFeedFrame(long beforeCapture, CapturedFrame frame, long afterTicks)
    {
        long wait = frame.WaitEndTicks - frame.CaptureStartTicks;
        long copy = frame.CopyEndTicks - frame.WaitEndTicks;
        long convert = afterTicks - (frame.CopyEndTicks > 0 ? frame.CopyEndTicks : frame.CaptureStartTicks);
        long total = afterTicks - beforeCapture;
        _feed.AddGoodFrame(wait, copy, convert, total);
        if (_encoder is FfmpegEncoder ff)
            _feed.AddQueueDepth(ff.QueueDepth);
    }

    /// <summary>
    /// Loga o resumo da janela corrente do feed (média wait/copy/convert/total e fps).
    /// Chamado no bloco de status (~30 frames): a janela do FeedTelemetry decide o cadence.
    /// </summary>
    private void LogFeedSummary()
    {
        if (!_feed.TryTakeSummary(Stopwatch.GetTimestamp(), out var s))
            return;
        Log.I("FeedTelemetry",
            $"fps={s.FeedFps:F1} good={s.GoodFrames} fail={s.FailFrames} enqNull={s.EncodeNulls} | " +
            $"wait={s.WaitMs:F1}ms copy={s.CopyMs:F1}ms convert={s.ConvertMs:F1}ms total={s.TotalMs:F1}ms | " +
            $"queue={s.QueueDepthAvg:F1} avg / {s.QueueDepthMax} max");
    }

    /// <summary>
    /// True se a janela alvo da captura ainda é a janela em foreground.
    /// Distingue alt-tab real (jogo NÃO em foreground → suppression de reinit)
    /// de stall do WGC (jogo EM foreground mas frames não chegam → watchdog pode reiniciar).
    /// </summary>
    private bool IsTargetGameForeground()
    {
        if (_captureTargetHwnd == IntPtr.Zero)
            return false;
        try
        {
            return PInvoke.GetForegroundWindow() == (HWND)_captureTargetHwnd;
        }
        catch (Exception ex)
        {
            Log.D("EngineCoordinator", $"IsTargetGameForeground failed: {ex.Message}");
            return false;
        }
    }

    /// True se o foreground atual é um processo não-jogo conhecido
    /// (explorer, navegadores, apps remotos como AnyDesk/rustdesk, etc.).
    /// Usado para suprimir reinit quando o usuário alt-tabou para fora do jogo.
    /// </summary>
    private bool IsForegroundNonGame()
    {
        try
        {
            var fg = _gameDetector.CurrentGame;
            return fg.IsValid && !string.IsNullOrEmpty(fg.ProcessName) &&
                   NonGameProcesses.Contains(fg.ProcessName);
        }
        catch (Exception ex)
        {
            Log.D("EngineCoordinator", $"IsForegroundNonGame failed: {ex.Message}");
            return false;
        }
    }

    private async Task ReinitializePipelineAsync()
    {
        var reinitGame = _gameDetector.CurrentGame;
        Log.I("EngineCoordinator", $"Reinicializando pipeline (watchdog)... foreground='{reinitGame.ProcessName}' hwnd=0x{reinitGame.Hwnd:X8} starvationSec={(_starvationStart != default ? (DateTime.UtcNow - _starvationStart).TotalSeconds.ToString("F1") : "N/A")}");

        if (!_captureActive)
        {
            _needsReinit = false;
            return;
        }

        // Capture CTS/task to locals BEFORE cancelling — StopCapture() may null them
        // concurrently under _pipelineLock. Using locals prevents NRE from TOCTOU.
        var cts = _pipelineCts;
        var task = _pipelineTask;

        // Cancel the running pipeline loop (thread-safe, no lock needed)
        cts?.Cancel();

        // Wait for the pipeline loop to exit (outside lock to avoid deadlock with PipelineLoop)
        if (task != null)
        {
            try { await task.WaitAsync(TimeSpan.FromSeconds(2)); }
            catch { }
        }

        lock (_pipelineLock)
        {
            // H2: StopCapture() pode ter rodado entre o check inicial e a aquisição do lock.
            // Se isso aconteceu, _captureActive é false e tudo já foi desligado — não re-crie
            // um pipeline zumbi. Só prossegue se a captura ainda está ativa.
            if (!_captureActive)
            {
                _needsReinit = false;
                _pipelineCts?.Dispose();
                _pipelineCts = null;
                _pipelineTask = null;
                return;
            }

            // Null the fields under lock — StopCapture() also nulls them under lock,
            // so only one thread will actually null them.
            _pipelineCts?.Dispose();
            _pipelineCts = null;
            _pipelineTask = null;
            try
            {
                if (_deviceLost)
            {
                _sharedDevice?.Dispose();
                _sharedDevice = null;
                _dxgiManager?.Dispose();
                _dxgiManager = null;

                var creationFlags = DeviceCreationFlags.BgraSupport;
                var result = Vortice.Direct3D11.D3D11.D3D11CreateDevice(
                    null, DriverType.Hardware, creationFlags,
                    new[] { FeatureLevel.Level_11_1, FeatureLevel.Level_11_0 },
                    out _sharedDevice, out _, out _);
                if (result.Success && _sharedDevice is not null)
                {
                    _dxgiManager = MediaFactory.MFCreateDXGIDeviceManager();
                    _dxgiManager.ResetDevice(_sharedDevice!).CheckError();
                    Log.E("EngineCoordinator", "Device D3D11 recriado após TDR/device lost.");
                }

                _deviceLost = false;
            }

            _capture?.Dispose();
            _capture = null;

            SelectCaptureSource();

            // Reinicia o encoder (ffmpeg pode ter travado ou atrasado)
            _encoder?.Dispose();
            _encoder = EncoderManager.CreateBestEncoder(_config.Config.ForceSoftware, _sharedDevice, _activeProfile.MaxrateKbps);
            if (_encoder is FfmpegEncoder fe)
            {
                fe.SetQualityParams(
                    cq: _activeProfile.Cq,
                    maxrateKbps: _activeProfile.MaxrateKbps,
                    bufsizeKbps: _activeProfile.BufsizeKbps,
                    bframes: _activeProfile.Bframes,
                    lookahead: _activeProfile.Lookahead,
                    preset: _config.Config.EncoderPreset,
                    codec: _config.Config.Codec,
                    multipass: _config.Config.Multipass);
                fe.SetOutputResolution(_outputWidth, _outputHeight);
            }
            _encoder.Initialize(_captureWidth, _captureHeight, _config.Config.Fps, _activeProfile.MaxrateKbps);
            _status.Update(s => s.Encoder = _encoder.GetType().Name.Replace("Encoder", ""));

            if (_capture != null)
            {
                _starvationStart = default;
                _watchdog.Reset();
                _pendingTimeoutDrop = false;
                _pipelineCts = new CancellationTokenSource();
                _pipelineTask = Task.Run(() => PipelineLoop(_pipelineCts.Token));
                _needsReinit = false;
                if (_hasEverBeenHealthy)
                    _status.Update(snap => snap.LastCrashRecovered = true);
                Log.I("EngineCoordinator", $"Pipeline reinicializado com sucesso ({_capture!.Name}, {_captureWidth}x{_captureHeight}).");
            }
        }
            catch (Exception ex)
            {
                Log.E("EngineCoordinator", $"Falha na reinicialização: {ex.Message}");
                _recording = false;
                _captureActive = false;
            }
        }
    }
}
