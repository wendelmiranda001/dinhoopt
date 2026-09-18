using DiNho.Capture.Poc.Audio;
using DiNho.Capture.Poc.Buffer;
using DiNho.Capture.Poc.Capture;
using DiNho.Capture.Poc.Config;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Export;
using DiNho.Capture.Poc.GameDetection;
using DiNho.Capture.Poc.Hotkeys;
using DiNho.Capture.Poc.Ipc;
using DiNho.Capture.Poc.Status;
using DiNho.Capture.Poc.Sync;
using DiNho.Capture.Poc.Watchdog;
using DiNho.Capture.Poc.Memory;
using DiNho.Capture.Poc.Logging;
using Windows.Win32;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

using Vortice.Direct3D11;
using Vortice.MediaFoundation;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator : IDisposable
{
    // Módulos
    private readonly ConfigManager _config;
    private readonly MasterClock _clock;
    private readonly GameDetector _gameDetector;
    private readonly HotkeyManager _hotkeys;
    private readonly PushToTalkManager _ptt;
    private readonly ReplayBuffer _buffer;
    private readonly ClipExporter _exporter;
    private readonly NamedPipeServer _pipeServer;
    private readonly EngineStatus _status;
    private readonly AudioSessionManager _audioSessions;

    // RamManager (RAM-aware capture profiles)
    private RamManager? _ramManager;
    private CaptureProfile _activeProfile = CreateDefaultProfile();

    // Create a default Full profile with sensible values (used until RamManager.ResolveProfile is called)
    private static CaptureProfile CreateDefaultProfile() => new()
    {
        Level = RamProfileLevel.Full,
        Cq = 20,
        MaxrateKbps = 40000,
        BufsizeKbps = 80000,
        Bframes = 0,
        Lookahead = 4,
        ReplaySeconds = 300,
        EncodeWidth = 1920,
        EncodeHeight = 1080,
        MaxBufferBytes = 512 * 1024 * 1024
    };

    // Pipeline (criados no Start)
    private ICaptureSource? _capture;
    private IEncoder? _encoder;
    private FfmpegAacEncoder? _aacEncoder;
    private int _aacEncoderRecoveryAttempts;
    private AudioMixer? _audioMixer;
    private IAudioSource? _loopbackSource;
    private IAudioSource? _micSource;

    // Estado
    private volatile bool _recording;
    private string? _capturedGameProcess;
    private int _capturedGameProcessId;
    private volatile bool _captureActive;
    private volatile bool _exportInProgress;
    private readonly Lock _exportLock = new();
    private readonly object _pipelineLock = new();
    private Timer? _cleanupTimer;
    private Timer? _pttDiagTimer;
    private Timer? _poolTrimTimer;
    private readonly Action<AppConfig>? _onConfigChangedHandler;
    private CancellationTokenSource? _pipelineCts;
    private Task? _pipelineTask;
    private readonly PipelineWatchdog _watchdog = new();
    private readonly FeedTelemetry _feed = new();
    private int _reinitCount;
    private volatile bool _needsReinit;
    private volatile bool _hasEverBeenHealthy;
    private volatile bool _deviceLost;
    private DateTime _starvationStart;

    // Agregação de frames dropped — evita inundar o log JSONL quando o pipeline
    // dropa frames em rajadas (ex.: RX 5700 XT com NVENC/AMF). _consecutiveDrops
    // zera na recuperação; _droppedFrames é o total acumulado da sessão (exposto
    // no status como "droppedFrames").
    private int _consecutiveDrops;
    private long _droppedFrames;

    // Opção C — timeout isolado do WaitOne (jitter do DWM vs cap do WGC): o frame
    // chega no instante seguinte, fora da janela do cap. O 1º timeout é diferido;
    // um frame bom (ou o retorno do alt-tab) zera o flag. Timeouts consecutivos
    // (stall real do WGC/DWM) contam normalmente.
    private bool _pendingTimeoutDrop;

    // ServerGC experiment: cumulative GC pause (ms) at the previous [RAM] tick,
    // so each tick logs the delta (+ms) of time spent paused in GC.
    private long _lastGcPauseTotalMs;

    // Recursos compartilhados (performance)
    private ID3D11Device? _sharedDevice;
    private IMFDXGIDeviceManager? _dxgiManager;
    private bool _mfStarted;

    // Cache getAudioSessions (~2s TTL)
    private string? _cachedAudioSessionsJson;
    private long _audioSessionsCacheTicks;

    // Jogo customizado (seleção manual pelo usuário)
    private volatile string _customGameProcess = "";

    // Jogo enviado no startCapture (nunca sobrescreve _customGameProcess)
    private volatile string _pendingGameProcess = "";

    // Último jogo válido detectado (usado como fallback quando Electron rouba o foco)
    private volatile GameInfo _lastDetectedGame = new();

    // Jogo alvo da captura atual — salvo em StartCapture, usado em reinit.
    // Persiste mesmo quando o usuário alt-tab, garantindo que a captura sempre
    // tente o mesmo jogo, não o foreground atual.
    private GameInfo _captureTargetGame = new();

    // HWND original da captura per-window. Mantido como fallback para quando
    // o jogo está minimizado e MainWindowHandle retorna Zero.
    private IntPtr _captureTargetHwnd = IntPtr.Zero;

    // True quando o jogo está em background (alt-tab) e a pipeline está
    // esperando o retorno em vez de fazer reinit.
    private volatile bool _gameBackgrounded;

    // Debounce de foreground/background — evitam oscilação quando WGC
    // tem drops transitórios com o jogo ainda em foreground.
    private const int BG_DEBOUNCE_DROPS = 30; // ~500ms a 60fps
    private const int FG_DEBOUNCE_FRAMES = 15; // ~250ms a 60fps
    private int _bgDropCount;
    private int _fgGoodCount;

    // Jogo que o usuário parou manualmente com ToggleCapture (Alt+1)
    // Enquanto este jogo estiver em foreground, auto-start não dispara.
    // Limpo quando o foreground muda para outro processo.
    private volatile string _userStoppedProcess = "";

    // Geração do mixer — incrementada cada vez que um novo mixer é criado.
    // Usada pelo fallback de áudio para ignorar checagens obsoletas após Stop/Start rápido.
    private int _audioMixerGeneration;

    // Evita restart concorrente da pipeline (ex: GameAudioOnly + OnGameChanged simultâneos)
    private bool _restartPending;
    private readonly Lock _restartLock = new();

    // DriftMonitor — acompanha continuamente a diferença entre PTS de vídeo e áudio
    // durante a captura, emitindo warning quando o drift acumulado excede limites perceptuais.
    internal const int DRIFT_WARN_THRESHOLD_MS = 150; // ITU-R BT.1359 detectável: 125ms áudio atrasado, 45ms liderando

    // Baseline do DriftMonitor: offset fixo de início (~170ms — audio hookup inicia depois do
    // vídeo). Sem baseline, uma sessão saudável dispara warning a cada ~5s porque o offset
    // constante já supera o threshold. Warning só deve disparar por DESVIO da linha de base.
    private double? _driftBaselineMs;

    /// <summary>
    /// Estabelece (primeira chamada) e retorna o drift RELATIVO à baseline. O offset de
    /// início do áudio (~170ms) vira a baseline; sessões saudáveis mantêm o relativo ~0.
    /// </summary>
    internal static double ComputeRelativeDriftMs(double rawDriftMs, ref double? baselineMs)
    {
        baselineMs ??= rawDriftMs;
        return rawDriftMs - baselineMs.Value;
    }

    // True quando o áudio caiu para loopback completo (WasapiLoopbackSource)
    // porque o per-process loopback (ActivateAudioInterfaceAsync) foi bloqueado por anti-cheat
    private volatile bool _audioFallback;

    // Dedicated STA thread with Windows message pump for WGC.
    // WGC FrameArrived needs a message pump on the thread that created the session
    // for the DWM to deliver frames. CreateFreeThreaded() alone is not sufficient
    // on some systems (e.g. RTX 5050 + FiveM).
    private Capture.WindowsMessagePump? _wgcPump;

    // High-res timer via timeBeginPeriod (ativado em StartAsync, desativado em StopAsync)
    private volatile bool _highResTimerEnabled;

    // Dimensões reais da captura (usadas no encoder e export)
    private int _captureWidth;
    private int _captureHeight;

    // Resolução de saída configurada pelo usuário (0 = mantém resolução nativa da captura)
    private int _outputWidth;
    private int _outputHeight;

    // Feedback sonoro de clip salvo (static seam — testes podem substituir).
    // Tanto o save pelo botão (IPC saveClip) quanto pelo atalho (hotkey) funilam
    // em SaveClipAsync, então um único disparo cobre os dois.
    internal static Action ClipSavedSound { get; set; } = NotificationSound.PlayClipSaved;

    // Eventos
    public event Action<EngineStatusValue>? OnStatusChanged;

    public EngineCoordinator(bool forceSoftware = false)
    {
        _config = new ConfigManager();

        if (forceSoftware)
            _config.Config.ForceSoftware = true;
        _clock = new MasterClock();
        _gameDetector = new GameDetector();
        _hotkeys = new HotkeyManager();
        _ptt = new PushToTalkManager(_hotkeys);
        _buffer = new ReplayBuffer(TimeSpan.FromSeconds(_config.Config.EffectiveReplaySeconds));
        _exporter = new ClipExporter();
        _pipeServer = new NamedPipeServer();
        _status = new EngineStatus();
        _audioSessions = new AudioSessionManager();

        // Configura PTT
        foreach (var vk in _config.Config.PushToTalkKeys)
            _ptt.AddPttKey((VirtualKey)vk);
        _ptt.Mode = PttModeHelper.Normalize(_config.Config.PttMode) switch
        {
            "Toggle" => PttMode.Toggle,
            "Hold" => PttMode.Hold,
            _ => PttMode.Off,
        };

        // Configura bindings dinâmicos
        ApplyHotkeyBindings();

        // Reage a mudanças no config (IPC setHotkeys etc.)
        _onConfigChangedHandler = _ =>
        {
            ApplyHotkeyBindings();
            // Reajusta buffer para maior duração necessária
            _buffer.MaxDuration = TimeSpan.FromSeconds(_config.Config.EffectiveReplaySeconds);
        };
        _config.OnConfigChanged += _onConfigChangedHandler;

        // Wire events
        _hotkeys.OnHotkeyPressed += OnHotkeyPressed;
        _gameDetector.OnGameChanged += OnGameChanged;
        _ptt.OnMicStateChanged += OnMicStateChanged;
        _pipeServer.OnMessage += OnIpcMessage;
        _pipeServer.GetStatus += GetStatusMessage;
        _pipeServer.OnStatusBroadcast += BroadcastStatus;
    }

    private void ApplyHotkeyBindings()
    {
        _hotkeys.UpdateBindings(_config.Config.HotkeyBindings);
    }

    public Task StartAsync()
    {
        Log.I("EngineCoordinator", "Iniciando...");

        // Remove spill temp files órfãos de sessões anteriores (crash não executa Dispose)
        var orphans = Buffer.DiskSpillBuffer.CleanupOrphans();
        if (orphans > 0)
            Log.I("EngineCoordinator", $"Spill cleanup: {orphans} orphan temp file(s) removed");

        // timeBeginPeriod(1) garante resolução de 1ms no scheduler,
        // reduzindo glitches de áudio e melhorando precisão de timestamps QPC
        var result = PInvoke.timeBeginPeriod(1);
        _highResTimerEnabled = result == 0;
        if (!_highResTimerEnabled)
            Log.W("EngineCoordinator", $"timeBeginPeriod(1) failed: {result}");

        // Load game database from games.json (falls back to hardcoded if not found)
        GameDetection.GameDatabase.Instance.Load();
        var gameCount = GameDetection.GameDatabase.Instance.GameCount;
        Log.I("EngineCoordinator", $"Game database: {(gameCount > 0 ? $"loaded {gameCount} games" : "using hardcoded fallback")}");

        // Scan Steam/Epic libraries for additional game detection
        GameDetection.LibraryScanner.Scan();

        // Fire-and-forget update check (doesn't block startup)
        _ = GameDetection.GameDatabaseUpdater.Instance.CheckForUpdateAsync();

        // MFStartup singleton (performance: evita restart do MF a cada encoder/export)
        MediaFactory.MFStartup(false);
        _mfStarted = true;

        if (_config.Config.AutoCleanupEnabled)
            _cleanupTimer = new Timer(_ => RunAutoCleanup(), null, TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(5));
        else
            Log.I("EngineCoordinator", "AutoCleanup disabled");

        if (_config.Config.GameDetection)
        {
            _gameDetector.SetElectronPid(_config.Config.ElectronPid);
            _gameDetector.Start();
        }
        else
            Log.I("EngineCoordinator", "GameDetection OFF — detector não iniciado");
        _hotkeys.Start();
        _pipeServer.Start();

        _status.Update(s => { s.UptimeSeconds = 0; });

        Log.I("EngineCoordinator", "Pronto. Aguardando hotkeys...");
        Log.I("EngineCoordinator", "  F8=Salvar clip  F9=Iniciar/Parar captura  F10=Mutar microfone");
        Log.I("EngineCoordinator", "  Pipe: \\\\.\\pipe\\dinho-clips-engine");

        return Task.CompletedTask;
    }

    public Task StopAsync()
    {
        Log.I("EngineCoordinator", "Parando...");
        _cleanupTimer?.Dispose();
        _cleanupTimer = null;
        _pttDiagTimer?.Dispose();
        _pttDiagTimer = null;
        StopCapture();
        _pipeServer.Stop();
        _hotkeys.Stop();
        _gameDetector.Stop();
        if (_highResTimerEnabled)
        {
            PInvoke.timeEndPeriod(1);
            _highResTimerEnabled = false;
        }
        if (_mfStarted)
        {
            MediaFactory.MFShutdown();
            _mfStarted = false;
        }

        return Task.CompletedTask;
    }

    private void OnHotkeyPressed(HotkeyPressedEventArgs e)
    {
        _status.Update(s => s.UptimeSeconds = (long)_clock.Now.TotalSeconds);

        switch (e.Action)
        {
            case HotkeyAction.SaveClip:
                // Notify Electron immediately for instant feedback (toast + sound)
                BroadcastClipSaved();
                _ = SaveClipAsync(e.ReplayDurationSeconds);
                break;
            case HotkeyAction.ToggleCapture:
                ToggleCapture();
                break;
            case HotkeyAction.ToggleMic:
                ToggleMic();
                break;
        }
    }

    private void BroadcastClipSaved()
    {
        try
        {
            var envelope = new IpcEnvelope
            {
                Version = 1,
                Command = "_event",
                Payload = System.Text.Json.JsonSerializer.SerializeToElement(new { type = "clipSaved" })
            };
            _pipeServer.BroadcastRaw(System.Text.Json.JsonSerializer.Serialize(envelope));
        }
        catch (Exception ex)
        {
            Log.W("EngineCoordinator", $"Falha ao broadcast clipSaved: {ex}");
        }
    }

    public void Dispose()
    {
        StopCapture();
        _cleanupTimer?.Dispose();
        _cleanupTimer = null;

        if (_config is not null)
        {
            if (_onConfigChangedHandler is not null)
                _config.OnConfigChanged -= _onConfigChangedHandler;
            _config.Dispose();
        }

        if (_hotkeys is not null)
        {
            _hotkeys.OnHotkeyPressed -= OnHotkeyPressed;
            _hotkeys.Dispose();
        }

        if (_ptt is not null)
        {
            _ptt.OnMicStateChanged -= OnMicStateChanged;
            _ptt.Dispose();
        }

        if (_gameDetector is not null)
        {
            _gameDetector.OnGameChanged -= OnGameChanged;
            _gameDetector.Dispose();
        }

        _buffer?.Dispose();
        _audioSessions?.Dispose();
        _exporter?.Dispose();

        if (_pipeServer is not null)
        {
            _pipeServer.OnMessage -= OnIpcMessage;
            _pipeServer.GetStatus -= GetStatusMessage;
            _pipeServer.OnStatusBroadcast -= BroadcastStatus;
            _pipeServer.Dispose();
        }

        _ramManager?.Dispose();
        _wgcPump?.Dispose();
        _status?.Dispose();
        _clock?.Dispose();
    }

    // timeBeginPeriod and timeEndPeriod — generated by CsWin32 (NativeMethods.txt)
}
