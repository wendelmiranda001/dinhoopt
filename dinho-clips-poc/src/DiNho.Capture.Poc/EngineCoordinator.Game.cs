using DiNho.Capture.Poc.GameDetection;
using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.System.Diagnostics.ToolHelp;
using Windows.Win32.UI.WindowsAndMessaging;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    private GameInfo ResolveTargetGame()
    {
        // Se já temos um alvo salvo (captura ativa), resolve seu HWND atual.
        // Isso garante que reinit ou crop sempre usem o MESMO jogo,
        // mesmo que o usuário tenha alt-tabado para outra janela.
        if (_captureTargetGame.IsValid && !string.IsNullOrEmpty(_captureTargetGame.ProcessName))
        {
            var resolved = ResolveProcessByName(_captureTargetGame.ProcessName);
            if (resolved.IsValid)
            {
                // Processo vivo com HWND válido — retorna
                Log.I("EngineCoordinator", $"Target game '{_captureTargetGame.ProcessName}' → HWND 0x{resolved.Hwnd:X8}");
                return resolved;
            }

            // Processo vivo mas sem MainWindowHandle (ex: minimizado)
            // Usa o HWND salvo original como fallback
            if (_captureTargetHwnd != IntPtr.Zero && IsTargetProcessAlive())
            {
                Log.I("EngineCoordinator", $"Target game '{_captureTargetGame.ProcessName}' vivo mas sem HWND — usando HWND salvo 0x{_captureTargetHwnd:X8}");
                return new GameInfo(
                    processName: _captureTargetGame.ProcessName,
                    executablePath: "",
                    windowTitle: "",
                    windowClass: "",
                    displayMode: DisplayMode.Unknown,
                    processId: 0,
                    hwnd: _captureTargetHwnd
                );
            }

            // Processo morreu — limpa e cai na lógica normal
            Log.I("EngineCoordinator", $"Target game '{_captureTargetGame.ProcessName}' morreu — resolvendo novo alvo");
            _captureTargetGame = new GameInfo();
            _captureTargetHwnd = IntPtr.Zero;
        }

        // Pending game process (do startCapture, usado uma vez e descartado)
        if (!string.IsNullOrEmpty(_pendingGameProcess))
        {
            var result = ResolveProcessByName(_pendingGameProcess);
            _pendingGameProcess = ""; // descarta após tentativa
            if (result.IsValid)
            {
                Log.I("EngineCoordinator", $"Pending game '{result.ProcessName}' → HWND 0x{result.Hwnd:X8}");
                return result;
            }
        }

        // Custom game process (seleção manual) tem prioridade
        if (!string.IsNullOrEmpty(_customGameProcess))
        {
            var result = ResolveProcessByName(_customGameProcess);
            if (result.IsValid)
            {
                Log.I("EngineCoordinator", $"Custom game '{_customGameProcess}' → HWND 0x{result.Hwnd:X8}");
                return result;
            }
        }

        // Jogo atual em foreground
        var current = _gameDetector.CurrentGame;
        if (current.IsValid)
            return current;

        // Fallback: último jogo válido detectado (ex: Electron roubou o foco)
        if (_lastDetectedGame.IsValid)
        {
            var fallback = ResolveProcessByName(_lastDetectedGame.ProcessName);
            if (fallback.IsValid)
            {
                Log.I("EngineCoordinator", $"Fallback para último jogo '{_lastDetectedGame.ProcessName}' → HWND 0x{fallback.Hwnd:X8}");
                return fallback;
            }
        }

        return current;
    }

    // ---------------------------------------------------------------------------
    // Alive-check por PID via OpenProcess (Opção A — fix do falso-negativo FiveM).
    // O nome do processo do FiveM inclui o build number (FiveM_b3258_GTAProcess),
    // que muda a cada atualização — Process.GetProcessesByName faz match exato e
    // o jogo parecia "morto" estando vivo. OpenProcess por PID é robusto a isso.
    // Seam estático para testes determinísticos (default = P/Invoke real).
    // ---------------------------------------------------------------------------

    internal const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    internal const uint ERROR_ACCESS_DENIED = 5;
    internal const uint STILL_ACTIVE = 259;

    // Campos (não auto-properties) para reflexão por nome nos testes.
    internal static Func<uint, bool> IsProcessAliveProbe = IsProcessAliveCore;
    internal static Func<uint, IntPtr> OpenProcessProbe = pid =>
        OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true, EntryPoint = "OpenProcess")]
    private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true, EntryPoint = "GetExitCodeProcess")]
    private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true, EntryPoint = "CloseHandle")]
    private static extern bool CloseHandle(IntPtr hObject);

    // Retorna true se o processo ainda está vivo. Fail-closed: em caso de dúvida
    // (exceção, sem acesso de leitura), assume vivo — nunca derruba captura por engano.
    private static bool IsProcessAlive(int pid)
    {
        if (pid <= 0)
            return false;
        try
        {
            return IsProcessAliveProbe((uint)pid);
        }
        catch (Exception ex)
        {
            Log.W("EngineCoordinator", $"IsProcessAlive(pid={pid}) falhou — assumindo vivo: {ex.Message}");
            return true;
        }
    }

    private static bool IsProcessAliveCore(uint pid)
    {
        IntPtr handle = OpenProcessProbe(pid);
        if (handle == IntPtr.Zero)
        {
            // Sem acesso de query (ex: processo de outro usuário) ainda é "vivo".
            var err = System.Runtime.InteropServices.Marshal.GetLastWin32Error();
            if (err == ERROR_ACCESS_DENIED)
                return true;
            return false;
        }

        try
        {
            // Handle aberto: o processo existe no momento. GetExitCodeProcess com
            // STILL_ACTIVE (259) confirma que ainda está rodando; qualquer outra
            // leitura não-confiável assume vivo (fail-closed).
            if (GetExitCodeProcess(handle, out uint code))
                return code == STILL_ACTIVE;
            return true;
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    // Normaliza nome de processo: remove sufixo .exe e o build number do FiveM
    // ("FiveM_b3258_GTAProcess" → "FiveM_GTAProcess"). Vazio/whitespace → "".
    internal static string NormalizeProcessName(string? processName)
    {
        var name = processName?.Trim();
        if (string.IsNullOrEmpty(name))
            return "";
        if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            name = name[..^4];
        return System.Text.RegularExpressions.Regex.Replace(name, @"_b\d+_", "_", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    }

    private static bool IsProcessAlive(string processName)
    {
        try
        {
            var name = NormalizeProcessName(processName);
            if (name.Length == 0)
                return false;
            var procs = Process.GetProcessesByName(name);
            bool alive = procs.Length > 0;
            foreach (var p in procs) p.Dispose();
            return alive;
        }
        catch (Exception ex)
        {
            // Fail-closed: exceção na checagem nunca derruba captura por engano.
            Log.W("EngineCoordinator", $"IsProcessAlive('{processName}') falhou — assumindo vivo: {ex.Message}");
            return true;
        }
    }

    // Check de vida do jogo alvo da captura: usa PID quando disponível
    // (robusto ao build number do FiveM), senão cai no fallback por nome (fuzzy).
    private bool IsTargetProcessAlive()
    {
        if (_captureTargetGame.ProcessId > 0)
            return IsProcessAlive(_captureTargetGame.ProcessId);
        return IsProcessAlive(_captureTargetGame.ProcessName);
    }

    private static GameInfo ResolveProcessByName(string processName)
    {
        var procName = processName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
            ? processName
            : processName + ".exe";

        var baseName = System.IO.Path.GetFileNameWithoutExtension(procName);

        try
        {
            // 1) Exact match first
            var procs = System.Diagnostics.Process.GetProcessesByName(baseName);
            if (procs.Length > 0)
            {
                var info = BuildGameInfoFromProcess(procs[0]);
                for (int i = 0; i < procs.Length; i++) procs[i].Dispose();
                return info;
            }

            // 2) Fuzzy match: strip build-number segments (e.g. _b3258_) then compare
            //    "FiveM_b3258_GTAProcess" → "FiveM_GTAProcess" after normalization
            var normalizedBase = System.Text.RegularExpressions.Regex.Replace(baseName, @"_b\d+_", "_", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            var allProcesses = System.Diagnostics.Process.GetProcesses();
            try
            {
                foreach (var proc in allProcesses)
                {
                    try
                    {
                        var normalizedProc = System.Text.RegularExpressions.Regex.Replace(proc.ProcessName, @"_b\d+_", "_", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                        if (normalizedProc.Contains(normalizedBase, StringComparison.OrdinalIgnoreCase))
                        {
                            var info = BuildGameInfoFromProcess(proc);
                            return info;
                        }
                    }
                    catch (Exception ex) { Log.D("EngineCoordinator", $"ResolveProcessByName: error inspecting process '{proc.ProcessName}': {ex.Message}"); }
                }
            }
            finally
            {
                foreach (var proc in allProcesses) proc.Dispose();
            }
        }
        catch (Exception ex) { Log.D("EngineCoordinator", $"ResolveProcessByName failed for '{processName}': {ex.Message}"); }

        return new GameInfo();
    }

    private static GameInfo BuildGameInfoFromProcess(System.Diagnostics.Process proc)
    {
        var hwnd = proc.MainWindowHandle;

        // Se MainWindowHandle é Zero (ex: jogo minimizado),
        // tenta EnumWindows para encontrar a janela pelo PID
        if (hwnd == IntPtr.Zero)
            hwnd = FindWindowByProcessId(proc.Id);

        return new GameDetection.GameInfo(
            processName: proc.ProcessName,
            executablePath: proc.MainModule?.FileName ?? "",
            windowTitle: hwnd != IntPtr.Zero ? proc.MainWindowTitle : "",
            windowClass: "",
            displayMode: GameDetection.DisplayMode.Unknown,
            processId: proc.Id,
            hwnd: hwnd
        );
    }

    private static unsafe IntPtr FindWindowByProcessId(int processId)
    {
        IntPtr foundVisible = IntPtr.Zero;
        IntPtr foundAny = IntPtr.Zero;
        PInvoke.EnumWindows((hwnd, _) =>
        {
            uint pid;
            PInvoke.GetWindowThreadProcessId(hwnd, &pid);
            if (pid == (uint)processId)
            {
                if (PInvoke.IsWindowVisible(hwnd))
                {
                    foundVisible = (IntPtr)hwnd;
                    return false;
                }
                if (foundAny == IntPtr.Zero)
                    foundAny = (IntPtr)hwnd;
            }
            return true;
        }, default);
        return foundVisible != IntPtr.Zero ? foundVisible : foundAny;
    }

    private static bool IsSystemWindowClass(string windowClass)
    {
        return windowClass switch
        {
            "Shell_TrayWnd" => true,           // Barra de tarefas
            "Progman" => true,                 // Área de trabalho (Desktop)
            "WorkerW" => true,                 // Desktop icons
            "DV2ControlHost" => true,          // Search charm / Cortana
            "Windows.UI.Core.CoreWindow" => true, // UWP genérico (exceto jogos conhecidos)
            "#32770" => true,                  // Dialog boxes
            "MSTaskListWClass" => true,        // Taskbar thumbnails
            "Shell_SecondaryTrayWnd" => true,  // Secondary monitor taskbar
            "NotifyIconOverflowWindow" => true,// System tray overflow
            _ => false,
        };
    }

    private static bool IsSystemExecutablePath(string executablePath)
    {
        if (string.IsNullOrEmpty(executablePath))
            return false;

        try
        {
            var windowsDir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);

            // Verifica se está em C:\Windows\ ou subdiretórios (System32, SysWOW64, etc.)
            if (executablePath.StartsWith(windowsDir, StringComparison.OrdinalIgnoreCase))
                return true;

            // Verifica se está em C:\Program Files\ (não-jogos conhecidos)
            // NOTA: Isso pode bloquear alguns jogos legítimos instalados em Program Files.
            // Por segurança, só bloqueamos subdiretórios comuns não-jogo.
            if (programFiles != null &&
                executablePath.StartsWith(programFiles, StringComparison.OrdinalIgnoreCase))
            {
                // Exceções: jogos conhecidos em Program Files
                if (executablePath.Contains("\\steam\\steamapps\\common\\", StringComparison.OrdinalIgnoreCase) ||
                    executablePath.Contains("\\epic games\\", StringComparison.OrdinalIgnoreCase) ||
                    executablePath.Contains("\\ubisoft\\", StringComparison.OrdinalIgnoreCase) ||
                    executablePath.Contains("\\battlenet\\", StringComparison.OrdinalIgnoreCase) ||
                    executablePath.Contains("\\rockstar games\\", StringComparison.OrdinalIgnoreCase) ||
                    executablePath.Contains("\\electronic arts\\", StringComparison.OrdinalIgnoreCase))
                    return false;

                return true;
            }

            if (programFilesX86 != null &&
                executablePath.StartsWith(programFilesX86, StringComparison.OrdinalIgnoreCase))
            {
                if (executablePath.Contains("\\steam\\steamapps\\common\\", StringComparison.OrdinalIgnoreCase) ||
                    executablePath.Contains("\\epic games\\", StringComparison.OrdinalIgnoreCase) ||
                    executablePath.Contains("\\ubisoft\\", StringComparison.OrdinalIgnoreCase) ||
                    executablePath.Contains("\\battlenet\\", StringComparison.OrdinalIgnoreCase) ||
                    executablePath.Contains("\\rockstar games\\", StringComparison.OrdinalIgnoreCase) ||
                    executablePath.Contains("\\electronic arts\\", StringComparison.OrdinalIgnoreCase))
                    return false;

                return true;
            }

            // Bloqueia executáveis em %LocalAppData%\Programs\ (instaladores NSIS/não-MSIX)
            // — é onde electron-builder/NSIS instala apps como o DiNho Optimizer
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (localAppData != null &&
                executablePath.StartsWith(Path.Combine(localAppData, "Programs"), StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }
        catch (Exception ex) { Log.D("EngineCoordinator", $"IsSystemExecutablePath failed: {ex.Message}"); }

        return false;
    }

    private static IntPtr GetDesktopWindow()
    {
        return (IntPtr)PInvoke.GetDesktopWindow();
    }

    private static bool IsWindowValidForWgc(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        if (hwnd == (IntPtr)PInvoke.GetDesktopWindow())
        {
            Log.I("EngineCoordinator", "Desktop window — WGC per-window não funcionará, pulando para desktop capture");
            return false;
        }
        if (!PInvoke.IsWindowVisible((HWND)hwnd)) return false;
        if (PInvoke.IsIconic((HWND)hwnd)) return false;
        var exStyle = PInvoke.GetWindowLong((HWND)hwnd, WINDOW_LONG_PTR_INDEX.GWL_EXSTYLE);
        if ((exStyle & WS_EX_NOREDIRECTIONBITMAP) != 0)
        {
            Log.I("EngineCoordinator", $"Janela 0x{hwnd:X8} tem WS_EX_NOREDIRECTIONBITMAP — WGC per-window não funcionará");
            return false;
        }
        return true;
    }

    private void OnGameChanged(GameInfo game)
    {
        if (game.IsValid && !string.IsNullOrEmpty(game.ProcessName))
        {
            // Só atualiza _lastDetectedGame para jogos de verdade (não Electron, etc.)
            if (!NonGameProcesses.Contains(game.ProcessName))
                _lastDetectedGame = game;
        }

        // Se o foreground mudou para algo diferente do jogo que o usuário parou,
        // libera auto-start para qualquer jogo da próxima vez
        if (!string.IsNullOrEmpty(_userStoppedProcess) &&
            game.ProcessName != _userStoppedProcess)
        {
            _userStoppedProcess = "";
        }

        _status.Update(s =>
        {
            s.Game = game.IsValid && !NonGameProcesses.Contains(game.ProcessName) ? game.ToString() : null;
        });

        // GameAudioOnly: quando um jogo REAL muda durante gravação, atualiza filtro de áudio
        if (_config.Config.GameAudioOnly && _recording && game.IsValid && game.ProcessId > 0)
        {
            // Ignora processos não-jogo (explorer, navegadores, etc.)
            if (NonGameProcesses.Contains(game.ProcessName))
                return;

            // Ignora janelas/processos do sistema (PickerHost, dialogs, etc.)
            // — mesmo guard do auto-start, evita que o PickerHost sequestre o filtro de áudio
            if (IsSystemWindowClass(game.WindowClass))
                return;
            if (IsSystemExecutablePath(game.ExecutablePath))
                return;

            // Evita restart se o filtro já estiver aplicado para este PID
            if (_appliedGameAudioOnly && _appliedGameAudioPid == game.ProcessId)
                return;

            // Cooldown: evita churn de restarts quando o foreground oscila entre
            // o jogo e outras janelas do mesmo processo (ex: popup, launcher interno).
            var nowMs = Environment.TickCount64;
            var sinceLast = nowMs - _lastGameAudioOnlyRestartUtc;
            if (_lastGameAudioOnlyRestartUtc != 0 && sinceLast < 10_000)
            {
                Log.D("EngineCoordinator", $"GameAudioOnly: restart para '{game.ProcessName}' ignorado por cooldown ({sinceLast}ms < 10s)");
                return;
            }

            Log.I("EngineCoordinator", $"GameAudioOnly: jogo mudou para '{game.ProcessName}' PID={game.ProcessId} — atualizando filtro");
            _appliedGameAudioOnly = true;
            _appliedGameAudioPid = game.ProcessId;
            _lastGameAudioOnlyRestartUtc = nowMs;
            ApplyAudioSessionsInternal([game.ProcessId]);
        }

        // Auto-stop: quando o jogo que iniciamos a captura fecha, para a gravação
        if (_recording && _capturedGameProcess != null &&
            game.ProcessName != _capturedGameProcess)
        {
            try
            {
                // Verifica se o processo do jogo ainda existe.
                // Usa PID primeiro (robusto ao build number do FiveM), senão o nome.
                bool alive = _capturedGameProcessId > 0
                    ? IsProcessAlive(_capturedGameProcessId)
                    : IsProcessAlive(_capturedGameProcess);
                if (!alive)
                {
                    Log.I("EngineCoordinator", $"Jogo '{_capturedGameProcess}' fechou — parando captura");
                    _capturedGameProcess = null;
                    _capturedGameProcessId = 0;
                    StopCapture();
                }
            }
            catch (Exception ex) { Log.D("EngineCoordinator", $"auto-stop check failed for '{_capturedGameProcess}': {ex.Message}"); }        }

        // Auto-start apenas quando um jogo REAL entra em foreground
        // e a captura ainda não está ativa. Enquanto captura estiver rodando
        // (DXGI desktop), alt-tab não interrompe — o monitor inteiro já está sendo gravado.
        if (game.IsValid && _config.Config.AutoStartCapture && !_captureActive)
        {
            if (NonGameProcesses.Contains(game.ProcessName))
                return;

            // Só auto-start para janelas em modo fullscreen (FSX ou FSO).
            // Janelas em modo Windowed (explorer, Code, VLC, etc.) NÃO disparam auto-start.
            if (game.DisplayMode != DisplayMode.FullscreenExclusive &&
                game.DisplayMode != DisplayMode.FullscreenOptimized)
            {
                return;
            }

            // Ignora classes de janela do sistema
            if (IsSystemWindowClass(game.WindowClass))
                return;

            // Ignora executáveis em diretórios do sistema (C:\Windows\, C:\Program Files\ não-jogo)
            if (IsSystemExecutablePath(game.ExecutablePath))
                return;

            // Se o usuário parou manualmente este mesmo jogo, não auto-start
            if (_userStoppedProcess == game.ProcessName)
                return;

            Log.I("EngineCoordinator", $"Auto-start capture for game '{game}' (autoStartCapture=true)");
            _capturedGameProcess = game.ProcessName;
            _capturedGameProcessId = game.ProcessId;
            StartCapture();
        }
    }

    // Find all direct child processes of a given PID using CreateToolhelp32Snapshot
    private static unsafe HashSet<int> GetChildProcesses(int parentPid)
    {
        var children = new HashSet<int>();
        HANDLE snapshot = PInvoke.CreateToolhelp32Snapshot(CREATE_TOOLHELP_SNAPSHOT_FLAGS.TH32CS_SNAPPROCESS, 0);
        if (snapshot == (HANDLE)(nint)(-1))
            return children;

        try
        {
            var entry = new PROCESSENTRY32W();
            entry.dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32W>();

            if (PInvoke.Process32FirstW(snapshot, &entry))
            {
                do
                {
                    if (entry.th32ParentProcessID == parentPid && entry.th32ProcessID != parentPid)
                        children.Add((int)entry.th32ProcessID);
                } while (PInvoke.Process32NextW(snapshot, &entry));
            }
        }
        finally
        {
            PInvoke.CloseHandle(snapshot);
        }

        return children;
    }

    private static readonly HashSet<string> NonGameProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "electron",
        "DiNho Optimizer",
        "dinho-optimizer",
        System.Diagnostics.Process.GetCurrentProcess().ProcessName,
        // === Sistema ===
        "explorer", "SearchHost", "ShellExperienceHost", "StartMenuExperienceHost",
        "Taskmgr", "TaskManager", "RuntimeBroker", "ApplicationFrameHost",
        "sihost", "svchost", "ctfmon", "smartscreen",
        "SystemSettings", "Calculator", "calc", "Photos", "LockApp",
        "PeopleExperienceHost", "ScreenClippingHost", "TextInputHost",
        "WindowsTerminal", "conhost", "cmd", "powershell", "pwsh",
        "regedit", "gpedit", "msconfig", "resmon", "perfmon",
        "diskmgmt", "compmgmt", "taskschd", "eventvwr",
        "dxdiag", "winver", "mstsc", "powershell_ise", "wsl", "bash",
        "msra", "migwiz", "control", "mmc",
        "tasklist", "systeminfo", "msinfo32", "msinfo",
        "cleanmgr", "dfrgui", "sdclt", "wmic",
        "taskkill", "taskkill.exe", "sc", "net", "netstat",
        "ipconfig", "ping", "tracert", "nslookup",
        "notepad", "wordpad", "mspaint", "SnippingTool", "SnippingToolPreview",
        "Magnify", "osk", "Narrator", "StikyNot", "StickyNotes",
        "msedgewebview2", "WebView2", "msedge_proxy", "MicrosoftEdge",
        "MpCmdRun", "MpSigStub", "SecurityHealthService", "SecurityHealthSystray",
        "WMIADAP", "WmiPrvSE", "wininit", "winlogon", "services",
        "rundll32", "dllhost", "msiexec", "msi", "msiinst",
        "spoolsv", "printisolationhost", "PrintNotify",
        "WaaSMedicSvc", "WaaSAssessment",
        "MoUSO", "MusNotification",
        "Widgets", "WidgetsPlatformRuntime",
        "PhoneExperienceHost", "YourPhone",
        "Cortana", "SearchUI", "SearchApp",
        "GameInputSvc", "GameInputRedist",
        "wsa", "WSAClient",
        "WerFault", "WerFaultSecure", "WerMgr",
        "DismHost", "TiWorker",
        "WUDFHost", "WUDFRd",
        "sppsvc",
        // === Navegadores ===
        "chrome", "firefox", "msedge", "brave", "opera", "vivaldi",
        "yandex", "tor", "waterfox", "palemoon",
        "maxthon", "arc", "sidekick", "opera_gx",
        "iridium", "centbrowser", "slimjet", "comodo_dragon",
        "epic", "naver",
        "chromium", "chrome_proxy",
        "firefox_proxy", "firefox-esr",
        "torbrowser", "TorBrowser", "firefox-tor",
        "brave_proxy",
        "msedge_proxy", "msedge_proxy", "MicrosoftEdge",
        "iexplore", "IEXPLORE",
        "duckduckgo", "librewolf", "floorp", "mercury",
        "wavebox", "rambox", "station",
        // === Dev Tools ===
        "Code", "devenv", "clion64", "rider64", "idea64", "pycharm64",
        "webstorm64", "phpstorm64", "rubymine64", "goland64",
        "datagrip", "dataspell", "aqua", "appcode",
        "sublime_text", "subl", "atom", "notepad++", "notepadpp",
        "vim", "gvim", "nvim", "emacs",
        "eclipse", "android-studio", "studio64", "studio",
        "netbeans", "jetbrains-toolbox",
        "git-bash", "git-cmd", "gitgui", "gitk",
        "cmder", "mintty", "windbg",
        "obsidian", "logseq", "typora",
        "postman", "insomnia", "docker", "kubectl",
        "sql-server", "ssms", "mysql-workbench", "sqldeveloper",
        "dbeaver", "navicat", "heidisql", "pgadmin",
        "filezilla", "winscp", "putty", "kitty",
        "nm-applet", "wireshark", "fiddler",
        "brackets", "lighttable", "kate", "kdevelop", "codeblocks",
        "notepad3", "notepad2", "micro", "ultraedit", "uedit32",
        "notepadnext", "geany",
        "Rider", "GoLand", "CLion", "PyCharm",
        "Anaconda", "JupyterLab", "spyder", "rstudio",
        "tabby", "warp", "terminus", "alacritty",
        "WindowsSandbox",
        "powershell_ise", "ise",
        "vswhere", "msbuild", "devenv",
        "xcode", "vscode", "vscodium",
        "lldb", "lldb-server",
        "sourcetree", "github_desktop", "GitHubDesktop",
        "fork", "smartgit", "tower",
        "tower3", "smartsvn", "tortoisegitproc",
        "TortoiseSVN", "TortoiseGit",
        "RabbitMQ",
        "redis-cli", "mongo", "mongosh", "psql",
        "Docker Desktop", "DockerDesktop",
        "rancher", "podman", "lima",
        "virtualbox", "vmware", "qemu-system-x86_64", "qemu-img",
        "VBoxSVC", "VBoxHeadless", "vmware-hostd",
        "dotnet", "msbuild", "nuget",
        "npm", "node", "yarn", "pnpm",
        "python", "python3", "ipython",
        "ruby", "rails",
        "rustc", "cargo", "rustup",
        "go", "gopls",
        "java", "javac", "jshell", "jdeps", "jlink",
        // === Mídia / Design ===
        "vlc", "mpc-hc", "mpc-be", "spotify", "wmplayer", "mplayerc",
        "PotPlayerMini64", "PotPlayerMini",
        "stremio", "kodi", "plex", "plexmediaplayer",
        "mpv", "mpv.net", "foobar2000", "winamp",
        "audacity", "obs64", "obs",
        "streamlabs", "xsplit",
        "aimp", "aimp3", "aimp4",
        "itunes", "AppleMobileDeviceProcess",
        "musicbee", "mediamonkey", "media-monkey",
        "clementine", "strawberry", "tomahawk",
        "deezer", "tidal", "amazonmusic", "AppleMusic",
        "TIDAL", "Deezer", "AmazonMusic",
        "NativeAccess", "PluginAlliance",
        "iZotope", "waves", "fabfilter",
        "ReaWire", "reaconsole", "reaper",
        "FL Studio", "FLStudio", "fl64",
        "Ableton Live 12 Intro", "Ableton Live 12 Standard", "Ableton Live 12 Suite",
        "Ableton Live 11 Intro", "Ableton Live 11 Standard", "Ableton Live 11 Suite",
        "Logic Pro", "LogicPro",
        "Cubase", "Studio One", "Bitwig", "Reason",
        "LMMS", "Ardour", "Qtractor",
        "OBS Studio",
        "Soundux", "DeaDBeeF",
        "AimpHelper", "Aimp",
        "fxsound", "Fxsound",
        "davinci-resolve", "resolve",
        "premiere", "afterfx", "photoshop", "illustrator", "lightroom",
        "gimp", "inkscape", "blender",
        "krita", "paint.net", "pdn",
        "handbrake-handbrake", "handbrake",
        "Autodesk", "Maya", "3dsmax", "MotionBuilder",
        "Cinema 4D", "cinema4d", "Houdini",
        "ZBrush", "Pixologic", "Maxon", "CorelDRAW",
        "Affinity Designer", "Affinity Photo", "Affinity Publisher",
        "Sketchbook", "SketchUp",
        "Aseprite", "Pixelorama",
        // === Áudio (EQ / Mixer de sistema — NUNCA são jogos) ===
        "fxsound", "voicemeeter", "voicemeeter8x64", "voicemeeterpro",
        "equalizerapo", "peace",
        "asio4all", "asioProxy", "AsioProxy",
        "Realtek Audio", "RealtekAudio",
        "Nahimic", "NahimicSvc",
        "DT Audio", "DTSAudio",
        "MaxxAudio", "WavesSvc",
        "SteelSeriesGG", "GG",
        // === Escritório / PDF ===
        "outlook", "winword", "excel", "powerpnt", "onenote",
        "access", "visio", "project", "publisher",
        "SumatraPDF", "FoxitReader", "Acrobat", "AcrobatReader",
        "libreoffice", "openoffice", "wps",
        "wordpad", "notion", "evernote",
        "WINWORD", "EXCEL", "POWERPNT", "OUTLOOK", "ONENOTE",
        "MSACCESS", "VISIO", "PROJECT", "PUBLISHER",
        "OfficeClickToRun", "OfficeBackgroundTaskHandler",
        "AdobeARM", "AcroRd32",
        "Adobe Reader", "Adobe Acrobat", "Adobe Update",
        "GoogleDriveFS", "googledrivesync", "Drive",
        "OneDrive", "OneDriveStandaloneUpdater",
        "Dropbox", "DropboxUpdate",
        "ownCloud", "Nextcloud",
        "SyncTrayApp", "SyncConsole",
        "SlackSetup", "Slack", "slack",
        "Bear", "Craft", "Agenda", "Quip",
        "Zoho Mail", "Thunderbird", "thunderbird",
        "Mailspring", "Mailbird", "Spicebird",
        "pdfcreator", "PDFCreator", "pdfsam",
        "pdf24", "pdf-xchange", "pdfxchange",
        // === Comunicação ===
        "Teams", "Slack", "Discord", "WhatsApp", "Telegram",
        "zoom", "skype", "signal", "mattermost",
        "element", "thunderbird", "messenger",
        "line", "wechat", "viber",
        "discordcanary", "discordptb",
        "mumble", "teampeak", "teamspeak3",
        "discord-development", "discord-ptb",
        "MicrosoftTeams", "ms-teams",
        "Zoom", "ZoomIt", "ZoomMeetings",
        "Signal", "Viber", "Line", "WeChat",
        "WhatsAppDesktop", "TelegramDesktop",
        "Wire", "Keybase", "Briar",
        "Pidgin", "Psi", "Psi+",
        "Trillian", "Adium",
        "ICQ", "QIP", "Miranda", "Jitsi Meet",
        "Jami", "Ring", "Tox",
        "icq", "qip",
        "GoogleChat", "Google Hangouts",
        "RocketChat", "RevoltChat",
        "Proton Mail", "ProtonMail", "ProtonMailBridge",
        "Tutanota", "TutanotaDesktop",
        "Hey", "Spike",
        // === Ferramentas Windows ===
        "mspaint", "SnippingTool", "SnippingToolPreview",
        "Magnify", "osk", "Narrator", "StikyNot", "StickyNotes",
        "Taskmgr", "TaskManager", "Taskmgr", "resource-monitor",
        "Magnification", "osk", "EaseOfAccess",
        "snip", "Snip & Sketch", "SnipSketch",
        "Windows Fax and Scan", "WindowsCamera",
        "Camera", "WindowsCamera",
        "Voice Recorder", "SoundRec",
        // === Utilidades ===
        "everything", "wox", "flowlauncher",
        "7zfm", "winrar", "winzip",
        "ccleaner", "revo",
        "hwmonitor", "cpuid", "gpuz",
        "corsair-icue", "icue", "lghub", "ghub", "steelseries",
        "logitech", "synapse",
        "HWiNFO", "hwinfo64", "HWiNFO64",
        "AIDA64", "aida64",
        "CPU-Z", "cpuz", "cpuz_x64",
        "GPU-Z", "gpuz",
        "MSI Afterburner", "MSIAfterburner", "Afterburner",
        "RivaTuner", "RTSS", "RivaTunerStatisticsServer",
        "ProcessExplorer", "procexp", "procexp64",
        "ProcessHacker", "ProcessHacker2", "processhacker",
        "ProcessMonitor", "procmon", "procmon64",
        "Autoruns", "autoruns", "autoruns64",
        "TCPView", "tcpview", "tcpview64",
        "RAMMap", "rammap",
        "vmmap", "VMMap",
        "disk2vhd", "sigcheck",
        "Sysinternals", "systeminformer",
        "Total Commander", "totalcmd64", "totalcmd",
        "Directory Opus", "dopus", "dopusrt",
        "Files", "Double Commander", "doublecmd",
        "Clover", "Q-Dir", "q-dir", "OneCommander",
        "FreeFileSync", "SyncBack", "GoodSync",
        "Beyond Compare", "BeyondCompare",
        "WinMerge", "Meld",
        "Notepad3", "Notepad2", "AkelPad",
        "AutoHotkey", "AutoIt", "AutoIt3",
        "ShareX", "Greenshot", "Lightshot", "PicPick", "Snagit",
        "Screenpresso", "FastStone Capture",
        "LightShot", "ScreenToGif",
        "OBS Studio", "OBS Studio (64bit, windows)",
        "Streamlabs Desktop", "StreamlabsOBS",
        "StreamDeck", "Elgato StreamDeck", "StreamDeckService",
        "ElgatoCamera", "ElgatoLightController",
        "BlueJeans", "LogiCamera",
        "LogiTune", "LogiOptions",
        "LogiOptionsPlus", "LogiPluginService",
        "LogiJoystick", "logi_app",
        "Nahimic", "Nahimic UI", "NahimicSvc",
        "SteelSeriesEngine", "SteelSeriesGG",
        "RazerCentral", "Razer Synapse", "RazerCortex",
        "CortexLauncher", "CortexServer",
        "iCUE", "CorsairService",
        "Corsair iCUE", "CorsairUtilityEngine",
        "Aorus", "Gigabyte", "AORUS",
        "MSI Center", "MSICenter", "MSI_Update",
        "DragonCenter", "MSI Dragon Center",
        "ArmouryCrate", "ASUSArmouryCrate",
        "AsusFanControlService", "ASUSSystemAnalysis",
        "AsusHotkeyService", "AsusKeyboardService",
        "AsusSwitch", "AsusKeyboardRGB",
        "AsusGPUFanCurveService",
        "PredatorSense", "PredatorSenseService",
        "NitroSense", "AcerNitroSense",
        "LenovoVantage", "LenovoVantageService",
        "LegionZone", "LenovoLegionZone",
        "OMEN", "OMENCommandCenter",
        "OMEN Hub", "OMENHub",
        "Alienware", "AlienwareFX",
        "Alienware Command Center", "AWCC",
        "CommandCenter",
        "Nahimic",
        // === Antivírus / Segurança ===
        "msmpeng", "defender",
        "mbam", "mbamtray",
        "avast", "avg", "bitdefender", "kaspersky",
        "norton", "mcafee", "eset", "sophos",
        "AvastUI", "AvastSvc",
        "AVGUI", "AVG",
        "Kaspersky", "KasperskyLab", "KasperskyUISvc",
        "NortonSecurity", "Norton",
        "McAfee", "McAfeeService",
        "ESET", "ESETService",
        "Sophos", "SophosUI",
        "Trend Micro", "TrendMicro",
        "G Data", "GData", "GDatasmart",
        "Avira", "AviraSystemSpeedup",
        "Panda", "PandaSecurity",
        "Comodo", "Comodo Internet Security",
        "Cylance", "CylanceProtect",
        "CrowdStrike", "CSAgent",
        "Carbon Black", "CbDefense",
        "SentinelOne", "SentinelAgent",
        "Cortex XDR", "Traps",
        "WindowsDefender", "WdNisDrv",
        "MsSecSvc",
        // === Remote Desktop (janela em si, nao o jogo) ===
        "AnyDesk", "rustdesk", "RustDesk", "TeamViewer", "Parsec",
        "Moonlight", "Sunshine", "todesk", "vnc", "RealVNC", "TightVNC",
        "remotedesktop", "msrdc", "MSRDC",
        "mstsc", "mstsc_admin",
        "AnyDeskHelp", "AnyDeskDesk",
        "rustdesk_host", "rustdesk_client",
        "TeamViewerQS", "TeamViewer_desktop",
        "Parsec", "Parsec.App",
        "Sunshine", "Sunshine Console",
        "Moonlight", "Moonlight Internet Hosting Tool",
        "todeskg", "todesk-g",
        "RealVNC", "vncviewer", "vncserver", "WinVNC",
        "TightVNC", "TightVNCServer",
        "TigerVNC", "TurboVNC",
        "Chrome Remote Desktop", "chromoting",
        "Ammyy Admin", "ammyy",
        "LiteManager", "Litemanager",
        "Supremo", "SupremoRemoteDesktop",
        "Splashtop", "SplashtopStreamer",
        "NoMachine", "nxplayer",
        "X2Go", "x2goclient",
        "Apache Guacamole", "guacd",
        "MeshAgent", "meshagent",
        "MeshCentral", "meshcentral",
        "Jump Desktop", "JumpDesktop",
        "ISL Light", "ISLLight",
        "ISL Online", "ISLAlwaysOn",
        "Aeroadmin", "aeroadmin",
        "ShowMyPC", "showmypc",
        // === Launchers (janela em si, não o jogo) ===
        "steam", "steamwebhelper",
        "epicgameslauncher", "epicgames",
        "gog", "goggalaxy",
        "ubisoftconnect", "upc",
        "origin", "eadesktop",
        "battlenet", "agent",
        "leagueclientux", "riotclient",
        "minecraft launcher",
        "EA App", "EAapp", "EADesktop",
        "EADesktopUpdater", "OriginWebHelper",
        "UbisoftConnect", "UbisoftGameLauncher",
        "Uplay", "UplayWebCore",
        "Blizzard Launcher", "BlizzardBattle",
        "BlizzardUpdateAgent",
        "GOG Galaxy", "GOGGalaxyClient",
        "GalaxyClient", "GalaxyCommunication",
        "GalaxyUpdater",
        "Bethesda", "BethesdaLauncher", "BethesdaNetUpdater",
        "EpicGamesLauncher", "EpicGamesLauncherHelper",
        "EpicWebHelper", "EpicLogin",
        "Rockstar", "RockstarService",
        "Rockstar Games Launcher", "RockstarGames",
        "SocialClubHelper",
        "Steam Web Helper", "steamwebhelper",
        "Steam Helper", "steam",
        "SteamStub",
        "Heroic Games Launcher", "Heroic",
        "Lutris", "lutris",
        "Minigalaxy", "minigalaxy",
        "Pegasus", "pegasus-frontend",
        "Itch", "itch",
        "Citra", "yuzu", "yuzu_main",
        "Ryujinx", "Ryujinx-AVS",
        "Cemu", "Cemu.exe",
        "Dolphin", "Dolphin.exe",
        "PCSX2", "pcsx2",
        "PPSSPP", "PPSSPPWindows",
        "DeSmuME", "DeSmuME_x64",
        "Project64", "mupen64plus",
        "RPCS3", "rpcs3",
        "Xenia", "xenia",
        "Xenia-Canary", "xenia-canary",
        "DuckStation", "duckstation",
        "mesen", "Mesen",
        "melonDS", "melonds",
        "bsnes", "bsneshq",
        "DOSBox", "DOSBox-X",
        "ScummVM", "scummvm",
        "LaunchBox", "launchbox",
        "Playnite", "playnite",
        "Big Picture", "BigPicture",
        "SteamVR", "vrmonitor", "vrcompositor", "vrserver",
        "Oculus", "oculus-runtime", "OVRServer",
        "OculusDash", "OculusMirror",
        "OculusClient", "OVRServiceLauncher",
        "VRC", "VRChat",
        "NeosVR",
        "Rec Room", "RecRoom",
        "VRChat",
        // === Torrent / P2P ===
        "qbittorrent", "qbt",
        "utorrent", "utorrentie",
        "transmission", "transmission-qt",
        "deluge", "deluge-web",
        "Vuze", "VuzeBittorrent",
        "BitTorrent", "bittorrent",
        "Popcorn Time",
        "PopcornTime",
        // === Banco / Fintech (não jogos) ===
        "BancoDoBrasil", "itau", "bradesco",
        "Santander", "santander",
        "Caixa", "caixa",
        "Nubank", "nubank",
        "Inter", "inter",
        "C6Bank", "c6bank",
        "PicPay", "picpay",
        "MercadoPago", "mercadopago",
        "PayPal", "paypal",
        "Stripe", "stripe",
        // === VPN / Proxy ===
        "NordVPN", "nordvpn",
        "ExpressVPN", "expressvpn",
        "ProtonVPN", "protonvpn",
        "Surfshark", "surfshark",
        "CyberGhost", "cyberghost",
        "Mullvad", "mullvad",
        "Windscribe", "windscribe",
        "PIA", "PrivateInternetAccess",
        "Tailscale", "tailscale",
        "ZeroTier", "zerotier",
        "WireGuard", "wireguard",
        "OpenVPN", "openvpn-gui",
        "Cloudflare WARP", "warp",
        // === Cloud / Sync / Backup ===
        "DropboxUpdate",
        "GoogleDriveFS",
        "OneDrive",
        "OneDriveStandaloneUpdater",
        "BackupAndSync",
        "Nextcloud",
        "ownCloud",
        "Acronis", "acronis",
        "Macrium", "macrium",
        "Veeam", "veeam",
        "Backblaze", "backblaze",
        // === Emuladores retro (cobrindo o que NAO é jogo) ===
        // (Emuladores de jogos retro SÃO utilitários, não jogos alvo)
        // Já em Launchers/Emuladores acima
        "PCSX2", "pcsx2",
        "Xenia", "xenia",
        "Dolphin", "Dolphin.exe",
        // === Ferramentas de benchmark / monitor (NÃO jogos) ===
        "3DMark", "3DMarkBasic", "3DMarkPro",
        "FurMark", "FurMark.exe",
        "Cinebench", "CinebenchR23", "CinebenchR24",
        "Geekbench", "Geekbench5", "Geekbench6",
        "CPUIDHWMonitor", "HWMONITOR",
        "MSI Kombustor", "Kombustor",
        "OCCT", "OCCT.exe",
        "AIDA64", "aida64",
        "RealBench", "RealBench.exe",
        "UserBenchmark", "UserBench",
        "Unigine", "Superposition",
        "Valley", "Heaven", "Superposition Benchmark",
        "UnigineBenchmark",
        // === Launchers de console/retro - ja acima ===
        // === SmartHome / IoT ===
        "Mi Home", "MiHome",
        "MiControllerService",
        "PhilipsHueSync",
        "HueSync",
        "TuyaSmart",
        "SmartThings",
        "Alexa",
        "Google Home",
        "Home Assistant", "hass",
        // === Crypto / Blockchain (não-jogo, mas às vezes parecem) ===
        "Metamask", "MetaMask",
        "TrustWallet", "Trust Wallet",
        "Exodus", "exodus",
        "Electrum", "electrum",
        "Bitcoin Core", "bitcoin-qt",
        "Monero GUI", "monero-wallet-gui",
        "Ethereum", "Geth", "Besu",
        "Phantom", "phantom",
        "Solflare", "solflare",
        "Keplr", "keplr",
        "Ronin", "ronin",
        // === Runtimes / Update Agents ===
        "GoogleUpdate", "GoogleCrashHandler",
        "AdobeARM", "AdobeUpdateService",
        "JetBrains Toolbox", "jetbrains-toolbox",
        "Microsoft OneDrive",
        "MicrosoftEdgeUpdate",
        "OfficeClickToRun",
        "DropboxUpdate",
        "Notion Update", "Notion Update Helper",
        "Spotify Helper", "Spotify",
        "SpotifyWebHelper",
        "spotify",
        // === Web Apps (Electron-based apps que não são jogos) ===
        "code", "Code", "code.exe",
        "Discord",
        "Slack",
        "Skype",
        "WhatsApp",
        "Spotify",
        "Telegram",
        "Signal",
        "Element",
        "Keybase",
        "GitHub Desktop",
        "Figma",
        "Notion",
        "Obsidian",
        "Logseq",
        "Mastodon",
        "Tweeten",
        // === Outros utilitários conhecidos ===
        "rclone", "rsync",
        "fzf", "ripgrep",
        "bat", "eza",
        "lazygit", "delta",
        "gh", "glab",
        "node-gyp",
        "MSYS2", "msys2",
        "Cygwin", "cygwin",
        "WSL", "wsl",
        "Hyper-V", "vmconnect",
        "Docker Desktop", "DockerDesktop",
        "Podman", "Podman Desktop",
        "LXD", "lxd",
        "Rancher Desktop", "RancherDesktop",
        "Lens", "Lens",
        "k9s", "lazydocker",
        "HTTPie", "httpie",
        "Postman",
        "Insomnia",
        "Bruno",
        "Hoppscotch",
        "RapidAPI",
        "SoapUI",
        "ReadyAPI",
        "JMeter", "ApacheJMeter",
        "Gatling",
        "k6", "k6cloud",
        "Locust",
        "Wrk", "wrk",
        "Vegeta",
        "ab", "ApacheBench",
        "iozone", "fio",
        "CrystalDiskMark", "CrystalDiskInfo",
        "ATTO Disk Benchmark", "ATTO",
        "AS SSD Benchmark", "AS SSD",
        "HD Tune", "HDTune",
        "UserBenchmark", "UserBench",
        // === Screen Recorder / Streaming helpers ===
        "Streamlabs", "Streamlabs OBS",
        "OBS Studio", "obs64", "obs32", "obs",
        "Lightstream", "XSplit", "xsplit",
        "StreamElements", "StreamElements OBS.Live",
        "Medal.tv", "MedalEncoder",
        "Plarium Play", "PlariumPlay",
        "Nvidia ShadowPlay", "nvcontainer",
        "GeForce Experience", "GeForceExperience",
        "NVIDIA Share", "nvsphelper64",
        "AMD ReLive", "AMDRSServ",
        "AMD Software", "AMDAgents",
        "AMDRSServerExt",
        "Nahimic",
        // === Math / Science / Engineering (não jogos) ===
        "MATLAB", "matlab",
        "Mathematica", "Wolfram",
        "Maple", "maple",
        "SPSS", "spss",
        "Stata", "stata",
        "SAS", "sas",
        "RGui", "RStudio",
        "JMP", "jmp",
        "Minitab", "minitab",
        "EViews", "eviews",
        "StataMP",
        "COMSOL", "comsol",
        "ANSYS", "ansys",
        "Abaqus", "abaqus",
        "SolidWorks", "solidworks",
        "AutoCAD", "acad",
        "Revit", "revit",
        "Inventor", "Inventor",
        "Civil 3D", "civil3d",
        "Navisworks", "navisworks",
        "MicroStation", "ucrt",
        "Tekla", "tekla",
        "CATIA", "catia",
        "Siemens NX", "nx",
        "Fusion 360", "fusion360",
        "Onshape", "onshape",
        "FreeCAD", "FreeCAD",
        "LibreCAD", "librecad",
        "OpenSCAD", "openscad",
        "KiCad", "kicad",
        "Eagle", "eagle",
        "Altium", "altium",
        "LTSpice", "ltspice",
        "PSpice", "pspice",
        "Multisim", "multisim",
        "LabVIEW", "labview",
        "MATLAB Runtime", "MATLABCompiler",
        "Simulink",
        "R2023a", "R2024a", "R2024b",
        "Anaconda Navigator", "Anaconda-Navigator",
        "Spyder", "spyder",
        "PyCharm", "pycharm",
        "JupyterLab", "jupyterlab",
        // === Torrent e Download managers ===
        "qbittorrent",
        "utorrent", "utorrentie",
        "transmission", "transmission-qt",
        "FreeDownloadManager", "FDM",
        "JDownloader", "JDownloader2",
        "Internet Download Manager", "IDMan",
        "EagleGet", "EagleGet",
        "BitComet", "bitcomet",
        // === Drive imaging / Ghost ===
        "AcronisTrueImage", "Acronis",
        "MacriumReflect",
        "Clonezilla", "clonezilla",
        "EaseUS Todo Backup",
        "Paragon", "ParagonBackup",
        // === Password managers ===
        "Bitwarden", "bitwarden",
        "1Password", "1password",
        "KeePass", "keepass",
        "LastPass", "lastpass",
        "Dashlane", "dashlane",
        "Roboform", "roboform",
        "NordPass", "nordpass",
        "Enpass", "enpass",
        "Keeper", "keeper",
        // === Note-taking / PKM ===
        "Obsidian",
        "Notion",
        "Logseq",
        "Roam Research", "Roam",
        "Tana",
        "Craft",
        "Bear",
        "Evernote",
        "OneNote",
        "Simplenote",
        "Standard Notes", "StandardNotes",
        "Notesnook",
        "Joplin",
        "QOwnNotes",
        "Trilium Notes", "TriliumNotes",
        "Zettlr",
        "Mastodon", "MastodonDesktop",
        // === CD/DVD/Blu-ray tools ===
        "ImgBurn",
        "CDBurnerXP",
        "Nero", "NeroExpress",
        "Alcohol 120%", "Alcohol120",
        "Daemon Tools", "daemon", "DAEMON Tools",
        "PowerISO", "PowerISO",
        "UltraISO", "UltraISO",
        "AnyBurn",
        // === Fax / Scan ===
        "Windows Fax and Scan", "WFS",
        "ScanSnap",
        "VueScan", "vuescan",
        "NAPS2", "naps2",
        "ABBYY FineReader", "FineReader",
        "OmniPage", "OmniPageSE",
        // === Stock / Investing ===
        "MetaTrader", "metatrader4", "metatrader5",
        "TradingView", "tradingview",
        "Thinkorswim", "thinkorswim",
        "E*TRADE", "etrade",
        "TDAmeritrade",
        "Wealthfront",
        "Betterment",
        "Robinhood", "robinhood",
        "Acorns",
        "Stash",
        // === NAS / File servers ===
        "SynologyAssistant",
        "SynologyDrive",
        "QNAP", "QfinderPro",
        "TrueNAS",
        "Unraid",
        // === Configuradores de impressora 3D ===
        "Cura", "Ultimaker-Cura",
        "PrusaSlicer",
        "SuperSlicer",
        "OrcaSlicer",
        "BambuStudio",
        "IdeaMaker",
        "Simplify3D",
        "3DPrinterOS",
        "OctoPrint",
        // === Karaoke ===
        "KaraFun",
        "Karaoke",
        "Kanto",
        "Smule",
        "VanBasco",
        // === Screen savers / Ambilight ===
        "Ambilight",
        "Hyperion",
        "Lightpack",
        "Prismatik",
        "Adalight",
        "DreamScreen",
        // === Hardware vendor tools ===
        "Razer Central", "RazerCortex",
        "SteelSeriesGG", "SteelSeriesEngine",
        "Logitech G Hub", "lghub",
        "Corsair iCUE", "icue",
        "MSI Center", "MSICenter",
        "Armoury Crate", "ArmouryCrate",
        "PredatorSense",
        "Lenovo Vantage", "LenovoVantage",
        "OMEN Hub", "OMENHub",
        "Dragon Center", "DragonCenter",
        "Norton", "NortonSecurity",
        "HP Support Assistant", "HPSA",
        "Dell SupportAssist", "SupportAssist",
        "ASUS Keyboard Hotkeys", "AsusHotkeyService",
        "Aorus", "AORUS",
        "GIGABYTE", "Gigabyte",
        "Colorful", "ColorfulCenter",
        "Galax", "XtremeTuner",
        "ZOTAC", "ZOTACFirestorm",
        "Palit", "ThunderMaster",
        "MSI Afterburner",
        // === Astronomy / Earth ===
        "Stellarium",
        "Celestia", "celestia",
        "WorldWideTelescope", "WWT",
        "Starry Night",
        "SkyChart", "Cartes du Ciel",
        "KStars", "kstars",
        "PHD2",
        "NINA",
        "SequenceGeneratorPro", "SGP",
        "GoogleEarth", "GoogleEarthPro",
        "NASA WorldWind",
        "Marble", "MarbleVirtualGlobe",
        // === Backup / Recovery ===
        "Recuva",
        "EaseUS Data Recovery",
        "Stellar Data Recovery",
        "R-Studio", "rstudio",
        "TestDisk", "testdisk",
        "PhotoRec", "photorec",
        // === OCR / PDF ===
        "Adobe Acrobat",
        "Adobe Reader",
        "Foxit Reader",
        "SumatraPDF",
        "PDF-XChange",
        "PDFsam",
        "PDFCreator",
        "PDF24",
        // === Barcode / QR ===
        "ZBar",
        "ZXing",
        "QR Code Generator",
        "Barcode Generator",
        // === Home automation ===
        "HomeSeer",
        "Hubitat",
        // === Dictation / Speech ===
        "Dragon", "Dragon NaturallySpeaking",
        "speechrecognition",
        // === Test automation ===
        "WinAppDriver",
        "Appium",
        "Selenium",
        "Cypress",
        "Playwright",
        "Puppeteer",
        "Winium",
        "Ranorex",
        "TestComplete",
        "Katalon",
        "Eggplant",
        "Squish",
        // === Audio production (já em Mídia) ===
        // (Mantido duplicado para garantir; case-insensitive já cobre)
        // === Web crawler / Scraping ===
        "Scrapy",
        "BeautifulSoup",
        // === DNS / Network tools ===
        "Wireshark",
        "tcpdump",
        "Fiddler",
        "Charles",
        "Postman",
        "Insomnia",
        "Advanced IP Scanner",
        "Angry IP Scanner",
        "Nmap",
        "Zenmap",
        // === OSINT / Forensics ===
        "Autopsy", "Autopsy64",
        "FTK", "FTK Imager",
        "X-Ways",
        "WinHex",
        "HxD",
        "Bulk Extractor",
        // === Quantum / Misc tech ===
        "IBM Quantum",
        "Cirq",
        "Qiskit",
        // === GIS / Mapping ===
        "ArcGIS", "ArcMap",
        "QGIS", "qgis",
        "MapInfo",
        "GRASS GIS",
        "SAGA GIS",
        "WhiteboxTools",
        "Global Mapper",
        // === EDA / PCB (já em Math/Science) ===
        // === IPMI / BMC ===
        "IPMIView",
        // === Misc monitoring / stats ===
        "Grafana",
        "Prometheus",
        "Zabbix",
        "Nagios",
        "Icinga",
        "Datadog",
        "New Relic",
        "Dynatrace",
        "AppDynamics",
        // === Cloud CLI tools ===
        "aws",
        "az",
        "gcloud",
        "kubectl",
        "helm",
        "terraform",
        "ansible",
        "pulumi",
        // === OCR training ===
        "Tesseract",
        // === Benchmarks / Stress / Monitoramento HW ===
        "Prime95", "prime95",
        "OCCT", "occt",
        "FurMark", "furmark",
        "3DMark", "3DMark",
        "Cinebench", "cinebench",
        "Geekbench", "geekbench",
        "AIDA64", "aida64", "AIDA64Extreme", "AIDA64Engineer",
        "Core Temp", "CoreTemp",
        "RealTemp", "realtemp",
        "HWiNFO", "HWiNFO64", "HWiNFO32",
        "CPU-Z", "cpuz",
        "GPU-Z", "gpuz",
        "OpenHardwareMonitor", "OpenHardwareMonitor",
        "FanControl", "fancontrol",
        "Argus Monitor", "ArgusMonitor",
        "Speccy", "speccy",
        "CrystalDiskInfo", "DiskInfo",
        "CrystalDiskMark", "DiskMark",
        "WinDirStat", "windirstat",
        "WizTree", "wiztree",
        "SpaceSniffer", "spacesniffer",
        "TreeSize", "TreeSizeFree",
        "CCleaner", "ccleaner",
        "BleachBit", "bleachbit",
        "Defraggler", "defraggler",
        "Everything", "everything",
        "WinMerge", "winmerge",
        "Beyond Compare", "BeyondCompare", "BCompare",
        "Meld", "meld",
        "Kdiff3", "kdiff3",
        "AutoHotkey", "autohotkey", "AutoHotkeyUX",
        "PowerToys", "PowerToys",
        "Files", "FilesApp",
        // === VPN / Proxies ===
        "OpenVPN", "openvpn", "OpenVPN GUI",
        "WireGuard", "wireguard",
        "NordVPN", "nordvpn",
        "ExpressVPN", "expressvpn",
        "Surfshark", "surfshark",
        "ProtonVPN", "protonvpn",
        "Tailscale", "tailscale",
        "ZeroTier", "zerotier",
        "Mullvad", "mullvad",
        "Windscribe", "windscribe",
        "Private Internet Access", "pia",
        "CyberGhost", "cyberghost",
        "Hotspot Shield", "HotspotShield",
        "Clash", "clash",
        "v2rayN", "v2rayn",
        "Shadowsocks", "shadowsocks",
        // === Produtividade / Anotações / Gestão ===
        "Todoist", "todoist",
        "TickTick", "ticktick",
        "Things", "things3",
        "Microsoft To Do", "Todo",
        "Forest", "forest",
        "Focus To-Do", "FocusToDo",
        "Any.do", "AnyDo",
        "Habitica", "habitica",
        "Trello", "trello",
        "Asana", "asana",
        "Monday.com", "Monday",
        "ClickUp", "clickup",
        "Jira", "jira", "JiraSoftware",
        "Linear", "linear",
        "Basecamp", "basecamp",
        "Wrike", "wrike",
        "Airtable", "airtable",
        "Focalboard", "focalboard",
        "RemNote", "remnote",
        "Dynalist", "dynalist",
        "WorkFlowy", "workflowy",
        "Supernotes", "supernotes",
        "Google Keep", "GoogleKeep",
        "Notepad++", "notepad++",
        "Sublime Text", "sublime_text", "subl",
        "VSCodium", "vscodium", "codium",
        "Cursor", "cursor",
        "Windsurf", "windsurf",
        "JetBrains Toolbox", "JetBrainsToolbox",
        "GoLand", "goland64",
        "WebStorm", "webstorm64",
        "Android Studio", "studio64",
        // === Banco de dados / SQL ===
        "HeidiSQL", "heidisql",
        "DBeaver", "dbeaver",
        "DataGrip", "datagrip",
        "TablePlus", "tableplus",
        "SQLiteStudio", "sqlitestudio",
        "DB Browser for SQLite", "sqlitebrowser",
        "MongoDB Compass", "mongodb-compass",
        "RedisInsight", "redisinsight",
        "pgAdmin", "pgadmin4",
        "SQL Server Management Studio", "Ssms", "ssms",
        "Azure Data Studio", "azuredatastudio",
        "Navicat", "navicat",
        // === Mídia / Players / Edição ===
        "Clementine", "clementine",
        "Strawberry", "strawberry",
        "AIMP", "aimp",
        "MusicBee", "musicbee",
        "DeaDBeeF", "deadbeef",
        "Audacious", "audacious",
        "Rhythmbox", "rhythmbox",
        "Qmmp", "qmmp",
        "GOM Player", "GOMPlayer",
        "KMPlayer", "KMPlayer64",
        "SMPlayer", "smplayer",
        "Dopamine", "dopamine",
        "XnView", "xnview", "XnViewMP",
        "IrfanView", "irfanview",
        "Honeyview", "honeyview",
        "Nomacs", "nomacs",
        "FastStone Image Viewer", "FastStoneImageViewer",
        "DigiKam", "digikam",
        "Darktable", "darktable",
        "RawTherapee", "rawtherapee",
        "Affinity Photo", "AffinityPhoto",
        "Affinity Designer", "AffinityDesigner",
        "Affinity Publisher", "AffinityPublisher",
        "CorelDRAW", "coreldraw",
        "Clip Studio Paint", "ClipStudioPaint",
        "PaintTool SAI", "PaintToolSAI",
        "MediBang Paint Pro", "MediBangPaintPro",
        "FireAlpaca", "firealpaca",
        "MyPaint", "mypaint",
        "Pencil2D", "pencil2d",
        "Aseprite", "aseprite",
        "LibreOffice", "libreoffice", "soffice",
        "WPS Office", "wps", "wpsoffice",
        "OnlyOffice", "onlyoffice", "DesktopEditors",
        "Kdenlive", "kdenlive",
        "Shotcut", "shotcut",
        "Camtasia", "camtasia",
        "Clipchamp", "clipchamp",
        "Loom", "loom",
        "XSplit", "xsplit", "XSplitVCam",
        "Streamlabs", "streamlabs", "Streamlabs OBS",
        "Bandicam", "bandicam",
        "Fraps", "fraps",
        "Dxtory", "dxtory",
        "Mirillis Action", "MirillisAction",
        "Vokoscreen", "vokoscreen",
        "SimpleScreenRecorder", "ssr",
        // === Chat / Streaming adicionais ===
        "Skype for Business", "lync",
        "Slack Update", "SlackUpdater",
        "Rocket.Chat", "RocketChat",
        "Wire", "wire-desktop",
        "Session", "session-desktop",
        "qTox", "qtox",
        "Gajim", "gajim",
        "Zulip", "zulip",
        "Ferdium", "ferdium", "Ferdi", "Franz",
        "Twitch", "twitch",
        "YouTube Music", "ytmusic",
        "Amazon Music", "AmazonMusic",
        "Deezer", "deezer",
        "Tidal", "tidal",
        "SoundCloud", "soundcloud",
        "Pandora", "pandora",
        "Apple Music",
        // === Overlays / Captura de tela / Game Bar ===
        "Xbox Game Bar", "GameBar",
        "XboxApp", "XboxPcApp", "GamingApp",
        "NVIDIA GeForce Experience", "GeForceExperience",
        "NVIDIA Broadcast", "NvBroadcast",
        "AMD Software", "radeonsoftware", "RadeonSoftware",
        "Steam Big Picture", "BigPicture",
        "SteamLink", "steamlink",
        // === Terminais modernos ===
        "Alacritty", "alacritty",
        "WezTerm", "wezterm",
        "Hyper", "hyper",
        "Tabby", "tabby",
        "Fluent Terminal", "FluentTerminal",
        "Cmder", "cmder",
        "MobaXterm", "MobaXterm",
        "Termius", "termius",
        // === IA Local / LLM / Stable Diffusion (janelas de app, nunca jogos) ===
        "ollama", "Ollama", "OllamaApp", "ollama_app",
        "LM Studio", "LMStudio",
        "GPT4All", "gpt4all",
        "Jan", "JanApp",
        "KoboldCpp", "koboldcpp", "llamacpp", "llama.cpp", "llama-server",
        "text-generation-webui", "textgen",
        "ComfyUI", "comfyui",
        "Automatic1111", "A1111", "sd-webui",
        "Fooocus", "fooocus",
        "InvokeAI", "InvokeAIServer",
        "Msty", "Chatterbox", "PrivateGPT", "AnythingLLM", "Open WebUI", "open-webui",
        "Copilot", "WindowsCopilot",
        "DevHome", "DevHomeHost",
        // === Emuladores Android (janela do emulador, nao o jogo que roda nele) ===
        "BlueStacks", "bluestacks", "HD-Player", "HDPlayer",
        "LDPlayer", "ldplayer", "ld9player",
        "MEmu", "memu", "MEmuHeadless",
        "NoxPlayer", "nox", "nox64",
        "MuMuPlayer", "MuMuPlayer12", "mumuplayer",
        "Genymotion", "GenymotionPlayer", "gvm",
        // === Impressoras / Scanner / Perifericos de marca ===
        "Brother", "BrotherControlCenter", "BrStMonW",
        "EPSON", "Epson", "EpsonEventAgent", "EpsonStatusMonitor",
        "CanonIJ", "canonij", "CNM", "MPMON", "Canon Print",
        "hpqstbw", "HPStatusBluetooth", "HPCustomerExperience",
        "SamsungEasyPrinterManager", "SLSCAN",
        // === VDI / Citrix / Terminal services ===
        "Citrix", "CitrixReceiver", "CitrixWorkspace", "wfica", "wfcmgr", "CDViewer",
        "VMware Horizon", "VmwareView", "vmware-view", "HorizonClient",
        "WorkspaceONE", "AirWatch",
        // === Video conferencia adicional ===
        "Webex", "webex", "CiscoWebexStart", "ptone",
        "GoToMeeting", "GoTo", "GoToAssist",
        "Join.Me", "JoinMe",
        "RingCentral", "RingCentralApp", "8x8", "8x8Work",
        "TrueConf", "trueconf", "Pexip", "Whereby",
        "Zoho Meeting", "ZohoMeeting", "Meetdesktop", "GoogleMeet",
        "Cisco Jabber", "CiscoJabber", "jabber",
        // === Email adicional ===
        "eM Client", "emClient", "Airmail", "Canary Mail", "CanaryMail",
        "Newton", "NewtonMail", "Superhuman", "BlueMail", "Postbox",
        "Edison Mail", "Mimestream", "Inky", "Spark", "Spark Mail",
        // === DAW / Producao musical adicional ===
        "Cakewalk", "cakewalk", "SONAR", "Pro Tools", "ProTools", "PTCC",
        "Nuendo", "Mixxx", "VirtualDJ", "virtualdj", "Serato", "Traktor", "TraktorPro",
        "Tracktion", "Waveform", "Zrythm", "Carla", "Mixbus", "BandLab", "BandLab Assistant",
        // === Editores de video adicional ===
        "VEGAS", "Vegas Pro", "VegasPro", "Magix", "MagixVegas",
        "Lightworks", "AvidMediaComposer", "MediaComposer",
        "OpenShot", "openshot", "Avidemux", "avidemux", "VirtualDub", "virtualdub",
        "LosslessCut", "losslesscut", "Hitfilm", "HitFilmExpress",
        // === Arduino / EDA / FPGA / Microcontroladores ===
        "Arduino", "arduino", "ArduinoIDE", "arduino-cli",
        "PlatformIO", "platformio", "PlatformIO IDE",
        "Proteus", "Proteus8", "OrCAD", "orcad", "Quartus", "quartus",
        "Vivado", "vivado", "STM32CubeIDE", "STM32CubeProgrammer",
        "Keil", "UV4", "uVision", "MPLAB", "MPLABX", "IarIdePm",
        // === Emulacao de rede / firewalls / routers ===
        "GNS3", "gns3", "EVE-NG", "eveng", "Packet Tracer", "CiscoPacketTracer",
        "pfSense", "OPNsense", "Untangle",
        // === Educacao / Estudo ===
        "Kahoot", "Google Classroom", "classroom", "Moodle", "Blackboard",
        "GeoGebra", "geogebra", "Anki", "anki", "Quizlet", "Duolingo", "duolingo",
        "Rosetta Stone", "Khan Academy", "Photomath",
        // === Saude / Fitness ===
        "Strava", "Fitbit", "Garmin Express", "GarminExpress", "Garmin",
        "MyFitnessPal", "WHOOP", "Polar Flow", "Withings",
        // === E-books / Leitura ===
        "Calibre", "calibre", "ebook-convert",
        "Kindle", "kindle", "Kindle Previewer", "Adobe Digital Editions", "ADE",
        "FBReader", "fbreader", "Moon+ Reader", "MoonReader",
        // === Traducao ===
        "DeepL", "deepl", "DeepLTranslator", "DeepL Translate", "Google Translate",
        // === Filtro de luz azul ===
        "f.lux", "flux", "Iris", "LightBulb", "SunsetScreen", "Redshift", "Twilight",
        // === RSS / Leitor de noticias ===
        "Feedly", "Inoreader", "RSS Guard", "RSSGuard", "RSSOwl", "Fluent Reader", "FluentReader", "Raven Reader",
        // === Rideshare / Delivery / Compras ===
        "iFood", "ifood", "Rappi", "rappi", "99Taxi", "99Taxis", "Uber", "uber",
        "UberEats", "DoorDash", "Mercado Livre", "MercadoLivre", "Magalu", "Magazine Luiza", "Amazon Shopping",
        // === Exchanges / Carteiras crypto adicionais ===
        "Coinbase", "coinbase", "CoinbaseWallet", "Binance", "binance", "Binance App",
        "Kraken", "kraken", "KuCoin", "kucoin", "OKX", "Bitfinex", "Gemini",
        "Crypto.com", "CryptoCom", "Ledger Live", "LedgerLive", "Trezor Suite", "TrezorSuite",
        // === Expansao 2026-08: apps comuns ausentes ===
        // Wallpapers / customizacao desktop
        "WallpaperEngine", "wallpaper32", "wallpaper64",
        "LivelyWallpaper", "Rainmeter", "Rainmeter.exe",
        "StartAllBack", "StartAllBackCfg",
        "TranslucentTB", "ExplorerPatcher",
        // Cloud / sync adicionais
        "iCloud", "iCloudServices", "iCloudDrive", "iCloudPhotos",
        // Adobe Creative Cloud (background)
        "Creative Cloud", "CreativeCloud", "CCXProcess",
        "Adobe Desktop Service", "AdobeIPCBroker", "AdobeCollabSync",
        // GPU vendor apps modernos
        "NVIDIA App", "NVApp",
        "IntelGraphicsSoftware", "IntelGraphicsControlPanel", "IGCC", "IGFXTrayModule",
        "RadeonSoftware", "AMDSoftware", "AMDLink", "AMDInstallLauncher",
        "RyzenMaster", "AMDRyzenMasterSDK",
        // Launchers / clients
        "RiotClientServices",
        "GeForceNOW",
        "Unity Hub", "UnityHub",
        // Audio console vendors
        "RtkAudUService64", "RtkAudioUniversalService", "RealtekAudioConsole",
        // Navegadores novos / minoritarios
        "zen", "zen-beta", "Thorium", "thorium",
        // Utilidades de captura/print
        "Flameshot", "Gyazo", "Monosnap",
    };

    static EngineCoordinator()
    {
        MergeCatalogNonGames();
    }

    private static void MergeCatalogNonGames()
    {
        foreach (var process in GameDatabase.ReadCatalogNonGames())
            NonGameProcesses.Add(process);
    }

    private const uint WS_EX_NOREDIRECTIONBITMAP = 0x00200000;
}
