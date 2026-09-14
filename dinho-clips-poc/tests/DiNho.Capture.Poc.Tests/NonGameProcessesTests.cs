using System.Reflection;
using DiNho.Capture.Poc.GameDetection;

namespace DiNho.Capture.Poc.Tests;

public sealed class NonGameProcessesTests
{
    [Fact]
    public void NonGameProcesses_ContainsKnownNonGameProcesses()
    {
        // Use reflection to access the private static field
        var field = typeof(EngineCoordinator).GetField("NonGameProcesses",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.NotNull(field);

        var set = field.GetValue(null) as HashSet<string>;
        Assert.NotNull(set);

        // System processes
        Assert.Contains("explorer", set);
        Assert.Contains("SearchHost", set);
        Assert.Contains("Taskmgr", set);
        Assert.Contains("regedit", set);
        Assert.Contains("msconfig", set);
        Assert.Contains("resmon", set);
        Assert.Contains("perfmon", set);
        Assert.Contains("dxdiag", set);
        Assert.Contains("mstsc", set);

        // Browsers
        Assert.Contains("chrome", set);
        Assert.Contains("firefox", set);
        Assert.Contains("msedge", set);
        Assert.Contains("opera", set);
        Assert.Contains("brave", set);
        Assert.Contains("yandex", set);
        Assert.Contains("tor", set);
        Assert.Contains("waterfox", set);
        Assert.Contains("palemoon", set);
        Assert.Contains("arc", set);
        Assert.Contains("sidekick", set);
        Assert.Contains("iridium", set);
        Assert.Contains("vivaldi", set);
        Assert.Contains("maxthon", set);
        Assert.Contains("naver", set);

        // Dev tools
        Assert.Contains("Code", set);
        Assert.Contains("devenv", set);
        Assert.Contains("sublime_text", set);
        Assert.Contains("atom", set);
        Assert.Contains("notepad++", set);
        Assert.Contains("vim", set);
        Assert.Contains("emacs", set);
        Assert.Contains("eclipse", set);
        Assert.Contains("android-studio", set);
        Assert.Contains("netbeans", set);
        Assert.Contains("postman", set);
        Assert.Contains("insomnia", set);
        Assert.Contains("docker", set);
        Assert.Contains("phpstorm64", set);

        // Media
        Assert.Contains("vlc", set);
        Assert.Contains("spotify", set);
        Assert.Contains("stremio", set);
        Assert.Contains("kodi", set);
        Assert.Contains("plex", set);
        Assert.Contains("mpv", set);
        Assert.Contains("foobar2000", set);
        Assert.Contains("winamp", set);
        Assert.Contains("audacity", set);
        Assert.Contains("obs", set);
        Assert.Contains("blender", set);
        Assert.Contains("davinci-resolve", set);

        // Communication
        Assert.Contains("Discord", set);
        Assert.Contains("Slack", set);
        Assert.Contains("Teams", set);
        Assert.Contains("zoom", set);
        Assert.Contains("skype", set);
        Assert.Contains("signal", set);
        Assert.Contains("thunderbird", set);
        Assert.Contains("messenger", set);
        Assert.Contains("line", set);
        Assert.Contains("wechat", set);
        Assert.Contains("viber", set);
        Assert.Contains("telegram", set);
        Assert.Contains("whatsapp", set);
        Assert.Contains("mattermost", set);
        Assert.Contains("element", set);

        // Windows tools
        Assert.Contains("notepad", set);
        Assert.Contains("calc", set);
        Assert.Contains("cmd", set);
        Assert.Contains("powershell", set);
        Assert.Contains("wsl", set);
        Assert.Contains("bash", set);

        // Utilities
        Assert.Contains("everything", set);
        Assert.Contains("wox", set);
        Assert.Contains("7zfm", set);
        Assert.Contains("winrar", set);
        Assert.Contains("hwmonitor", set);

        // Office
        Assert.Contains("WINWORD", set);
        Assert.Contains("EXCEL", set);
        Assert.Contains("POWERPNT", set);
        Assert.Contains("OUTLOOK", set);
        Assert.Contains("ONENOTE", set);
        Assert.Contains("libreoffice", set);
        Assert.Contains("notion", set);
        Assert.Contains("evernote", set);

        // Antivirus
        Assert.Contains("avast", set);
        Assert.Contains("avg", set);
        Assert.Contains("bitdefender", set);
        Assert.Contains("kaspersky", set);
        Assert.Contains("norton", set);
        Assert.Contains("mcafee", set);

        // Game launchers
        Assert.Contains("steam", set);
        Assert.Contains("epicgames", set);
        Assert.Contains("gog", set);
        Assert.Contains("ubisoftconnect", set);
        Assert.Contains("origin", set);
        Assert.Contains("battlenet", set);
        Assert.Contains("riotclient", set);
    }

    [Fact]
    public void NonGameProcesses_ContainsAudioUtilities()
    {
        // FxSound and other system audio EQ/mixer utilities must never be
        // treated as games (false-positive triggered a GameAudioOnly restart
        // mid-recording, switching DXGI desktop -> WGC per-window of a tiny
        // utility window that then stalled).
        var field = typeof(EngineCoordinator).GetField("NonGameProcesses",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.NotNull(field);

        var set = field.GetValue(null) as HashSet<string>;
        Assert.NotNull(set);

        Assert.Contains("FxSound", set);
        Assert.Contains("voicemeeter", set);
        Assert.Contains("voicemeeter8x64", set);
        Assert.Contains("voicemeeterpro", set);
        Assert.Contains("equalizerapo", set);
        Assert.Contains("peace", set);
    }

    [Fact]
    public void IsSystemWindowClass_ReturnsTrueForKnownClasses()
    {
        var method = typeof(EngineCoordinator).GetMethod("IsSystemWindowClass",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.NotNull(method);

        static bool Call(object? obj, MethodInfo m, string arg)
            => (bool)m.Invoke(obj, [arg])!;

        Assert.True(Call(null, method, "Shell_TrayWnd"));
        Assert.True(Call(null, method, "Progman"));
        Assert.True(Call(null, method, "WorkerW"));
        Assert.True(Call(null, method, "DV2ControlHost"));
        Assert.True(Call(null, method, "#32770"));
    }

    [Fact]
    public void IsSystemWindowClass_ReturnsFalseForGameClasses()
    {
        var method = typeof(EngineCoordinator).GetMethod("IsSystemWindowClass",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.NotNull(method);

        static bool Call(object? obj, MethodInfo m, string arg)
            => (bool)m.Invoke(obj, [arg])!;

        Assert.False(Call(null, method, "grcWindow"));
        Assert.False(Call(null, method, "SDL_app"));
        Assert.False(Call(null, method, "UnrealWindow"));
        Assert.False(Call(null, method, ""));
        Assert.False(Call(null, method, ""));
    }

    [Fact]
    public void IsSystemExecutablePath_ReturnsTrueForWindowsDir()
    {
        var method = typeof(EngineCoordinator).GetMethod("IsSystemExecutablePath",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.NotNull(method);

        static bool Call(object? obj, MethodInfo m, string arg)
            => (bool)m.Invoke(obj, [arg])!;

        var windowsDir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        Assert.True(Call(null, method, $@"{windowsDir}\System32\notepad.exe"));
        Assert.True(Call(null, method, $@"{windowsDir}\explorer.exe"));
    }

    [Fact]
    public void IsSystemExecutablePath_ReturnsTrueForLocalAppDataPrograms()
    {
        var method = typeof(EngineCoordinator).GetMethod("IsSystemExecutablePath",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.NotNull(method);

        static bool Call(object? obj, MethodInfo m, string arg)
            => (bool)m.Invoke(obj, [arg])!;

        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        Assert.True(Call(null, method, $@"{localAppData}\Programs\dinho-optimizer\DiNho Optimizer.exe"));
        Assert.True(Call(null, method, $@"{localAppData}\Programs\SomeOtherApp\app.exe"));
    }

    [Fact]
    public void IsSystemExecutablePath_ReturnsFalseForEmptyOrNull()
    {
        var method = typeof(EngineCoordinator).GetMethod("IsSystemExecutablePath",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.NotNull(method);

        static bool Call(object? obj, MethodInfo m, string arg)
            => (bool)m.Invoke(obj, [arg])!;

        Assert.False(Call(null, method, ""));
        Assert.False(Call(null, method, (string)null!));
    }

    [Fact]
    public void IsSystemExecutablePath_ReturnsFalseForKnownGameDirectories()
    {
        var method = typeof(EngineCoordinator).GetMethod("IsSystemExecutablePath",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.NotNull(method);

        static bool Call(object? obj, MethodInfo m, string arg)
            => (bool)m.Invoke(obj, [arg])!;

        var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);

        // Game paths in Program Files should not be blocked
        var gamePaths = new[]
        {
            $@"{pf}\Steam\steamapps\common\FiveM\FiveM.exe",
            $@"{pf86}\Steam\steamapps\common\GTA5\GTA5.exe",
            $@"{pf}\Epic Games\Fortnite\FortniteGame.exe",
            $@"{pf86}\Ubisoft\Ubisoft Game Launcher\games\FarCry6\bin\FarCry6.exe",
            $@"{pf86}\Rockstar Games\Launcher\GTA5.exe",
            $@"{pf}\Electronic Arts\EA Games\Battlefield\BF2042.exe",
        };

        foreach (var path in gamePaths)
        {
            Assert.False(Call(null, method, path), $"Expected '{path}' to NOT be system");
        }
    }

    [Fact]
    public void NonGameProcesses_HasElectronAndCurrentProcess()
    {
        var field = typeof(EngineCoordinator).GetField("NonGameProcesses",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.NotNull(field);

        var set = field.GetValue(null) as HashSet<string>;
        Assert.NotNull(set);

        Assert.Contains("electron", set);
        Assert.Contains("DiNho Optimizer", set);
        Assert.Contains("dinho-optimizer", set);
    }

    [Fact]
    public void NonGameProcesses_ContainsRemoteDesktopApps()
    {
        var field = typeof(EngineCoordinator).GetField("NonGameProcesses",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.NotNull(field);

        var set = field.GetValue(null) as HashSet<string>;
        Assert.NotNull(set);

        Assert.Contains("AnyDesk", set);
        Assert.Contains("rustdesk", set);
        Assert.Contains("TeamViewer", set);
        Assert.Contains("Parsec", set);
        Assert.Contains("Moonlight", set);
        Assert.Contains("Sunshine", set);
        Assert.Contains("todesk", set);
        Assert.Contains("vnc", set);
        Assert.Contains("remotedesktop", set);
    }

    [Fact]
    public void NonGameProcesses_MergesCatalogNonGames()
    {
        var field = typeof(EngineCoordinator).GetField("NonGameProcesses",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.NotNull(field);

        var set = field.GetValue(null) as HashSet<string>;
        Assert.NotNull(set);

        // Entradas que existem APENAS no catálogo games.json ("nonGames"), não no literal C#.
        Assert.Contains("HandBrake", set);
        Assert.Contains("heroic", set);
        Assert.Contains("gamebarpresencewriter", set);
    }

    [Fact]
    public void NonGameProcesses_MergeDoesNotAddGames()
    {
        var field = typeof(EngineCoordinator).GetField("NonGameProcesses",
            BindingFlags.Static | BindingFlags.NonPublic);
        Assert.NotNull(field);

        var set = field.GetValue(null) as HashSet<string>;
        Assert.NotNull(set);

        Assert.DoesNotContain("FiveM", set);
        Assert.DoesNotContain("Fortnite", set);
        Assert.DoesNotContain("cs2", set);
        Assert.DoesNotContain("valorant", set);
        Assert.DoesNotContain("GTA5", set);
        Assert.DoesNotContain("Minecraft", set);
    }
}
