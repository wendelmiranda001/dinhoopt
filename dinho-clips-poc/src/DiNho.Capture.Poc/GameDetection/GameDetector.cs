using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Graphics.Gdi;
using Windows.Win32.UI.Accessibility;
using Windows.Win32.UI.WindowsAndMessaging;

namespace DiNho.Capture.Poc.GameDetection;

public static class KnownGames
{
    /// <summary>
    /// Returns known display name for a window class.
    /// Checks GameDatabase first (JSON), falls back to hardcoded map.
    /// </summary>
    public static string LookupWindowClass(string windowClass)
    {
        return GameDatabase.Instance.GetDisplayName(windowClass);
    }

    /// <summary>
    /// Returns known display name for a process name (via JSON database).
    /// </summary>
public static string? LookupProcessName(string processName)
    {
        var entry = GameDatabase.Instance.FindByProcessName(processName);
        return entry?.DisplayName;
    }

    static KnownGames()
    {
        // Try to load game database on first access
        GameDatabase.Instance.Load();
    }
}

// <summary>
// Modo de exibição do jogo - usado para decidir DXGI vs WGC (spec seção 4.1)
// </summary>
public enum DisplayMode
{
    Unknown,
    FullscreenExclusive,  // Janela ocupa monitor inteiro + sem bordas + sem título
    FullscreenOptimized,  // Borderless fullscreen (maioria dos jogos modernos)
    Windowed              // Janela com bordas / não maximizada
}

public sealed class GameDetector : IDisposable
{
    private HWINEVENTHOOK _winEventHook;
    private Thread? _hookThread;
    private volatile bool _running;
    private IntPtr _lastForegroundHwnd;
    private Timer? _fallbackTimer;
    private WINEVENTPROC? _winEventDelegate; // Mantido como field para evitar GC
    private int _electronPid;

    // Eventos
    public event Action<GameInfo>? OnGameChanged;

    private volatile GameInfo _currentGame = new();
    public GameInfo CurrentGame => _currentGame;
    private void SetCurrentGame(GameInfo value) => _currentGame = value;

    // Constantes WinEvent
    private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    private const uint WINEVENT_OUTOFCONTEXT = 0;
    private const uint WINEVENT_SKIPOWNPROCESS = 2;
    private const uint WS_CAPTION = 0x00C00000;

    public GameDetector()
    {
    }

    public void SetElectronPid(int pid)
    {
        _electronPid = pid;
    }

    public void Start()
    {
        if (_running) return;
        _running = true;

        // Tenta hook primeiro (SetWinEventHook precisa de thread STA com message pump)
        _hookThread = new Thread(HookThreadProc)
        {
            Name = "GameDetectorHook",
            IsBackground = true
        };
        _hookThread.SetApartmentState(ApartmentState.STA);
        _hookThread.Start();
    }

    public void Stop()
    {
        _running = false;

        if (!_winEventHook.IsNull)
        {
            PInvoke.UnhookWinEvent(_winEventHook);
            _winEventHook = default;
        }

        _hookThread?.Join(1000);
        _hookThread = null;

        _fallbackTimer?.Dispose();
        _fallbackTimer = null;
    }

    private void HookThreadProc()
    {
        // Salva como field para evitar GC do delegate nativo
        _winEventDelegate = OnForegroundChangedNative;

        _winEventHook = PInvoke.SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            (HMODULE)IntPtr.Zero,
            _winEventDelegate,
            0, 0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS
        );

        if (_winEventHook.IsNull)
        {
            // Hook falhou — fallback para polling
            Log.W("GameDetector", "SetWinEventHook falhou, usando polling fallback");
            _fallbackTimer = new Timer(PollForeground, null, 0, 1000);
            return;
        }

        Log.I("GameDetector", $"SetWinEventHook OK ({_winEventHook})");

        // Detecção inicial na hora
        var hwnd = PInvoke.GetForegroundWindow();
        if (!hwnd.IsNull)
            OnForegroundChanged((IntPtr)hwnd);

        // Message pump — necessário para o hook entregar callbacks
        while (_running)
        {
            while (PInvoke.PeekMessage(out var msg, HWND.Null, 0, 0, PEEK_MESSAGE_REMOVE_TYPE.PM_REMOVE))
            {
                PInvoke.TranslateMessage(in msg);
                PInvoke.DispatchMessage(in msg);
            }
            // Evita busy-wait
            if (_running)
                Thread.Sleep(50);
        }

        // Limpeza do hook
        if (!_winEventHook.IsNull)
        {
            PInvoke.UnhookWinEvent(_winEventHook);
            _winEventHook = default;
        }
    }

    // Callback nativo do SetWinEventHook — converte para managed call
    private void OnForegroundChangedNative(
        HWINEVENTHOOK hWinEventHook, uint eventType, HWND hwnd,
        int idObject, int idChild, uint dwEventThread, uint dwmsEventTime)
    {
        OnForegroundChanged((IntPtr)hwnd);
    }

    private unsafe void OnForegroundChanged(IntPtr hwnd)
    {
        if (hwnd == Interlocked.CompareExchange(ref _lastForegroundHwnd, IntPtr.Zero, IntPtr.Zero) && hwnd != IntPtr.Zero)
            return;

        Interlocked.Exchange(ref _lastForegroundHwnd, hwnd);
        if (hwnd == IntPtr.Zero)
        {
            SetCurrentGame(new GameInfo());
            OnGameChanged?.Invoke(CurrentGame);
            return;
        }

        // Ignora foreground changes do próprio Electron (que rouba foco indevidamente)
        if (_electronPid > 0)
        {
            uint foregroundPid;
            PInvoke.GetWindowThreadProcessId((HWND)hwnd, &foregroundPid);
            if (foregroundPid == _electronPid)
                return;
        }

        var gameInfo = DetectGame(hwnd);
        SetCurrentGame(gameInfo);
        OnGameChanged?.Invoke(gameInfo);
    }

    // Polling fallback (usado se SetWinEventHook falhar)
    private unsafe void PollForeground(object? state)
    {
        if (!_running) return;
        var hwnd = (IntPtr)PInvoke.GetForegroundWindow();
        if (hwnd == Interlocked.CompareExchange(ref _lastForegroundHwnd, IntPtr.Zero, IntPtr.Zero) && hwnd != IntPtr.Zero)
            return;

        Interlocked.Exchange(ref _lastForegroundHwnd, hwnd);
        if (hwnd == IntPtr.Zero)
        {
            SetCurrentGame(new GameInfo());
            OnGameChanged?.Invoke(CurrentGame);
            return;
        }

        if (_electronPid > 0)
        {
            uint foregroundPid;
            PInvoke.GetWindowThreadProcessId((HWND)hwnd, &foregroundPid);
            if (foregroundPid == _electronPid)
                return;
        }

        var gameInfo = DetectGame(hwnd);
        SetCurrentGame(gameInfo);
        OnGameChanged?.Invoke(gameInfo);
    }

    private static unsafe GameInfo DetectGame(IntPtr hwnd)
    {
        // 1. Pega o PID da janela
        uint pid;
        PInvoke.GetWindowThreadProcessId((HWND)hwnd, &pid);
        if (pid == 0)
            return new GameInfo();

        // 2. Pega nome do processo e executável
        string processName = "";
        string executablePath = "";
        try
        {
            using var proc = Process.GetProcessById((int)pid);
            processName = proc.ProcessName;
            executablePath = proc.MainModule?.FileName ?? "";
        }
        catch
        {
            processName = "unknown";
        }

        // 3. Window class (útil para detectar FiveM, Roblox, etc.)
        char* classNameBuf = stackalloc char[256];
        int classNameLen = PInvoke.GetClassName((HWND)hwnd, classNameBuf, 256);
        var windowClass = new string(classNameBuf, 0, classNameLen);

        // 4. Detecta modo de exibição
        var displayMode = DetectDisplayMode(hwnd);

        // 5. Título da janela
        int titleLen = PInvoke.GetWindowTextLength((HWND)hwnd);
        char* titleBuf = stackalloc char[titleLen + 1];
        int titleWritten = PInvoke.GetWindowText((HWND)hwnd, titleBuf, titleLen + 1);
        var windowTitle = new string(titleBuf, 0, titleWritten);

        return new GameInfo(
            processName: processName,
            executablePath: executablePath,
            windowTitle: windowTitle,
            windowClass: windowClass,
            displayMode: displayMode,
            processId: (int)pid,
            hwnd: hwnd
        );
    }

    // Detecta se é fullscreen exclusivo, borderless ou windowed
    // Lógica: compara rect da janela com rect do monitor
    // Se a janela cobre o monitor inteiro e não tem borda visível → fullscreen
    // Se cobre mas tem borda → borderless/otimizado
    // Senão → windowed
    private static DisplayMode DetectDisplayMode(IntPtr hwnd)
    {
        // Pega o monitor onde a janela está
        var monitor = PInvoke.MonitorFromWindow((HWND)hwnd, MONITOR_FROM_FLAGS.MONITOR_DEFAULTTONEAREST);
        var monitorInfo = new MONITORINFO();
        monitorInfo.cbSize = (uint)Marshal.SizeOf<MONITORINFO>();
        PInvoke.GetMonitorInfo(monitor, ref monitorInfo);

        // Pega rect da janela
        PInvoke.GetWindowRect((HWND)hwnd, out var windowRect);

        var monitorRect = monitorInfo.rcMonitor;
        var style = PInvoke.GetWindowLong((HWND)hwnd, WINDOW_LONG_PTR_INDEX.GWL_STYLE);

        bool hasBorder = (style & WS_CAPTION) != 0;
        bool coversMonitor =
            windowRect.left <= monitorRect.left &&
            windowRect.top <= monitorRect.top &&
            windowRect.right >= monitorRect.right &&
            windowRect.bottom >= monitorRect.bottom;

        if (coversMonitor && !hasBorder)
            return DisplayMode.FullscreenExclusive;
        if (coversMonitor && hasBorder)
            return DisplayMode.FullscreenOptimized;

        return DisplayMode.Windowed;
    }

    public void Dispose()
    {
        Stop();
    }
}

// <summary>
// Informações sobre o jogo atual em foreground
// </summary>
public sealed class GameInfo
{
    public string ProcessName { get; }
    public string ExecutablePath { get; }
    public string WindowTitle { get; }
    public string WindowClass { get; }
    public string KnownGame { get; }
    public DisplayMode DisplayMode { get; }
    public int ProcessId { get; }
    public IntPtr Hwnd { get; }
    public bool IsValid => !string.IsNullOrEmpty(ProcessName) && ProcessName != "unknown";

    public GameInfo()
    {
        ProcessName = "";
        ExecutablePath = "";
        WindowTitle = "";
        WindowClass = "";
        KnownGame = "";
        DisplayMode = DisplayMode.Unknown;
        ProcessId = 0;
        Hwnd = IntPtr.Zero;
    }

    public GameInfo(string processName, string executablePath, string windowTitle,
        string windowClass, DisplayMode displayMode, int processId, IntPtr hwnd)
    {
        ProcessName = processName;
        ExecutablePath = executablePath;
        WindowTitle = windowTitle;
        WindowClass = windowClass;
        KnownGame = KnownGames.LookupWindowClass(windowClass);
        if (string.IsNullOrEmpty(KnownGame))
        {
            var byProcess = KnownGames.LookupProcessName(processName);
            if (byProcess != null)
                KnownGame = byProcess;
            else
            {
                var entry = GameDatabase.Instance.FindByAlias(processName);
                if (entry != null)
                    KnownGame = entry.DisplayName;
            }
        }
        if (string.IsNullOrEmpty(KnownGame))
        {
            KnownGame = "";
        }
        DisplayMode = displayMode;
        ProcessId = processId;
        Hwnd = hwnd;
    }

    public override string ToString()
    {
        var mode = DisplayMode switch
        {
            DisplayMode.FullscreenExclusive => "FSX",
            DisplayMode.FullscreenOptimized => "FSO",
            DisplayMode.Windowed => "WIN",
            _ => "???"
        };
        var tag = !string.IsNullOrEmpty(KnownGame) ? $" ({KnownGame})" : "";
        return $"{ProcessName}{tag} [{mode}]";
    }
}
