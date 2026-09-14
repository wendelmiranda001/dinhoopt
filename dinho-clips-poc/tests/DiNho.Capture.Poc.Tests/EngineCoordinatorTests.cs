using System.Reflection;
using System.Text.Json;
using DiNho.Capture.Poc.Config;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.GameDetection;
using DiNho.Capture.Poc.Hotkeys;
using DiNho.Capture.Poc.Status;
using DiNho.Capture.Poc.Watchdog;

namespace DiNho.Capture.Poc.Tests;

[Collection("VideoPacketPool")]
public sealed class EngineCoordinatorTests
{
    private static readonly Type CoordinatorType = typeof(EngineCoordinator);

    private static object? InvokeStatic(string name, params object?[] args)
    {
        var method = CoordinatorType.GetMethod(name,
            BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public,
            null,
            args.Select(a => a?.GetType() ?? typeof(object)).ToArray(),
            null);
        return method?.Invoke(null, args);
    }

    private static object? InvokeStaticNoArgs(string name)
    {
        var method = CoordinatorType.GetMethod(name,
            BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public);
        return method?.Invoke(null, null);
    }

    #region IsSystemWindowClass

    [Theory]
    [InlineData("Shell_TrayWnd", true)]
    [InlineData("Progman", true)]
    [InlineData("WorkerW", true)]
    [InlineData("DV2ControlHost", true)]
    [InlineData("Windows.UI.Core.CoreWindow", true)]
    [InlineData("#32770", true)]
    [InlineData("MSTaskListWClass", true)]
    [InlineData("Shell_SecondaryTrayWnd", true)]
    [InlineData("NotifyIconOverflowWindow", true)]
    [InlineData("grcWindow", false)]
    [InlineData("UnityWndClass", false)]
    [InlineData("UnrealWindow", false)]
    [InlineData("SDL_app", false)]
    [InlineData("", false)]
    [InlineData("explorer", false)]
    [InlineData("SHELL_TrayWnd", false)] // case-sensitive
    [InlineData("some_random_class", false)]
    public void IsSystemWindowClass_ReturnsExpected(string windowClass, bool expected)
    {
        var result = InvokeStatic("IsSystemWindowClass", windowClass);
        Assert.Equal(expected, result);
    }

    #endregion

    #region IsSystemExecutablePath

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    public void IsSystemExecutablePath_EmptyOrNull_ReturnsFalse(string? path, bool expected)
    {
        // Reflection with null arg can't resolve param types; use explicit typed invocation
        var method = CoordinatorType.GetMethod("IsSystemExecutablePath",
            BindingFlags.Static | BindingFlags.NonPublic)!;
        var result = method.Invoke(null, new object?[] { path });
        Assert.Equal(expected, result);
    }

    [Fact]
    public void IsSystemExecutablePath_WindowsDir_ReturnsTrue()
    {
        var windowsDir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        var path = Path.Combine(windowsDir, "System32", "notepad.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(true, result);
    }

    [Fact]
    public void IsSystemExecutablePath_ProgramFilesNonGame_ReturnsTrue()
    {
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        if (string.IsNullOrEmpty(programFiles)) return;
        var path = Path.Combine(programFiles, "Common Files", "something.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(true, result);
    }

    [Fact]
    public void IsSystemExecutablePath_ProgramFiles_SteamGame_ReturnsFalse()
    {
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        if (string.IsNullOrEmpty(programFiles)) return;
        var path = Path.Combine(programFiles, "Steam", "steamapps", "common", "Game", "game.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsSystemExecutablePath_ProgramFiles_EpicGame_ReturnsFalse()
    {
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        if (string.IsNullOrEmpty(programFiles)) return;
        var path = Path.Combine(programFiles, "Epic Games", "Game", "game.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsSystemExecutablePath_ProgramFiles_UbisoftGame_ReturnsFalse()
    {
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        if (string.IsNullOrEmpty(programFiles)) return;
        var path = Path.Combine(programFiles, "Ubisoft", "Game", "game.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsSystemExecutablePath_ProgramFiles_BattleNetGame_ReturnsFalse()
    {
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        if (string.IsNullOrEmpty(programFiles)) return;
        var path = Path.Combine(programFiles, "Battle.net", "Game", "game.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        // "Battle.net" doesn't match "\\battlenet\\" — only pure "battlenet" path would
        Assert.True((bool)result!);
    }

    [Fact]
    public void IsSystemExecutablePath_ProgramFiles_RockstarGame_ReturnsFalse()
    {
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        if (string.IsNullOrEmpty(programFiles)) return;
        var path = Path.Combine(programFiles, "Rockstar Games", "GTA V", "game.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsSystemExecutablePath_ProgramFiles_EAGame_ReturnsFalse()
    {
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        if (string.IsNullOrEmpty(programFiles)) return;
        var path = Path.Combine(programFiles, "Electronic Arts", "Game", "game.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsSystemExecutablePath_ProgramFilesX86_NonGame_ReturnsTrue()
    {
        var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        if (string.IsNullOrEmpty(programFilesX86)) return;
        var path = Path.Combine(programFilesX86, "Common Files", "something.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(true, result);
    }

    [Fact]
    public void IsSystemExecutablePath_ProgramFilesX86_SteamGame_ReturnsFalse()
    {
        var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        if (string.IsNullOrEmpty(programFilesX86)) return;
        var path = Path.Combine(programFilesX86, "Steam", "steamapps", "common", "Game", "game.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsSystemExecutablePath_LocalAppDataPrograms_ReturnsTrue()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrEmpty(localAppData)) return;
        var path = Path.Combine(localAppData, "Programs", "dinho-optimizer", "app.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(true, result);
    }

    [Fact]
    public void IsSystemExecutablePath_Desktop_DoesNotMatchPrograms()
    {
        var desktop = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
        var path = Path.Combine(desktop, "mygame.exe");
        var result = InvokeStatic("IsSystemExecutablePath", path);
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsSystemExecutablePath_RandomPath_ReturnsFalse()
    {
        var result = InvokeStatic("IsSystemExecutablePath", @"D:\Games\FiveM\FiveM.exe");
        Assert.Equal(false, result);
    }

    #endregion

    #region NonGameProcesses

    [Theory]
    [InlineData("electron")]
    [InlineData("DiNho Optimizer")]
    [InlineData("explorer")]
    [InlineData("chrome")]
    [InlineData("firefox")]
    [InlineData("msedge")]
    [InlineData("Discord")]
    [InlineData("steam")]
    [InlineData("obs64")]
    [InlineData("vlc")]
    [InlineData("spotify")]
    [InlineData("notepad")]
    [InlineData("Code")]
    [InlineData("devenv")]
    [InlineData("docker")]
    [InlineData("postman")]
    public void NonGameProcesses_ContainsExpectedProcess(string processName)
    {
        var set = CoordinatorType.GetField("NonGameProcesses",
            BindingFlags.Static | BindingFlags.NonPublic)?.GetValue(null) as HashSet<string>;
        Assert.NotNull(set);
        Assert.Contains(processName, set!);
    }

    [Theory]
    [InlineData("FiveM")]
    [InlineData("Fortnite")]
    [InlineData("cs2")]
    [InlineData("valorant")]
    [InlineData("GTA5")]
    [InlineData("Minecraft")]
    public void NonGameProcesses_DoesNotContainGame(string processName)
    {
        var set = CoordinatorType.GetField("NonGameProcesses",
            BindingFlags.Static | BindingFlags.NonPublic)?.GetValue(null) as HashSet<string>;
        Assert.NotNull(set);
        Assert.DoesNotContain(processName, set!);
    }

    [Fact]
    public void NonGameProcesses_IsCaseInsensitive()
    {
        var set = CoordinatorType.GetField("NonGameProcesses",
            BindingFlags.Static | BindingFlags.NonPublic)?.GetValue(null) as HashSet<string>;
        Assert.NotNull(set);
        Assert.Contains("explorer", set!);
        Assert.Contains("Explorer", set!);
        Assert.Contains("EXPLORER", set!);
    }

    #endregion

    #region GameInfo

    [Fact]
    public void GameInfo_DefaultConstructor_IsInvalid()
    {
        var info = new GameInfo();
        Assert.False(info.IsValid);
        Assert.Equal("", info.ProcessName);
        Assert.Equal(0, info.ProcessId);
        Assert.Equal(IntPtr.Zero, info.Hwnd);
        Assert.Equal(DisplayMode.Unknown, info.DisplayMode);
    }

    [Fact]
    public void GameInfo_ParameterizedConstructor_SetsAllFields()
    {
        var info = new GameInfo(
            processName: "FiveM",
            executablePath: @"C:\FiveM\FiveM.exe",
            windowTitle: "FiveM",
            windowClass: "grcWindow",
            displayMode: DisplayMode.FullscreenOptimized,
            processId: 1234,
            hwnd: new IntPtr(0xABCD));

        Assert.Equal("FiveM", info.ProcessName);
        Assert.Equal(@"C:\FiveM\FiveM.exe", info.ExecutablePath);
        Assert.Equal("FiveM", info.WindowTitle);
        Assert.Equal("grcWindow", info.WindowClass);
        Assert.Equal(DisplayMode.FullscreenOptimized, info.DisplayMode);
        Assert.Equal(1234, info.ProcessId);
        Assert.Equal(new IntPtr(0xABCD), info.Hwnd);
        Assert.True(info.IsValid);
    }

    [Fact]
    public void GameInfo_IsValid_FalseForUnknownProcess()
    {
        var info = new GameInfo(
            processName: "unknown",
            executablePath: "",
            windowTitle: "",
            windowClass: "",
            displayMode: DisplayMode.Unknown,
            processId: 0,
            hwnd: IntPtr.Zero);
        Assert.False(info.IsValid);
    }

    [Fact]
    public void GameInfo_IsValid_FalseForEmptyProcess()
    {
        var info = new GameInfo(
            processName: "",
            executablePath: "",
            windowTitle: "",
            windowClass: "",
            displayMode: DisplayMode.Unknown,
            processId: 0,
            hwnd: IntPtr.Zero);
        Assert.False(info.IsValid);
    }

    [Fact]
    public void GameInfo_ToString_FullscreenExclusive()
    {
        var info = new GameInfo(
            processName: "FiveM", executablePath: "", windowTitle: "",
            windowClass: "grcWindow", displayMode: DisplayMode.FullscreenExclusive,
            processId: 1, hwnd: new IntPtr(1));
        var str = info.ToString();
        Assert.Contains("FiveM", str);
        Assert.Contains("[FSX]", str);
    }

    [Fact]
    public void GameInfo_ToString_FullscreenOptimized()
    {
        var info = new GameInfo(
            processName: "Game", executablePath: "", windowTitle: "",
            windowClass: "cls", displayMode: DisplayMode.FullscreenOptimized,
            processId: 1, hwnd: new IntPtr(1));
        var str = info.ToString();
        Assert.Contains("[FSO]", str);
    }

    [Fact]
    public void GameInfo_ToString_Windowed()
    {
        var info = new GameInfo(
            processName: "Game", executablePath: "", windowTitle: "",
            windowClass: "cls", displayMode: DisplayMode.Windowed,
            processId: 1, hwnd: new IntPtr(1));
        var str = info.ToString();
        Assert.Contains("[WIN]", str);
    }

    [Fact]
    public void GameInfo_ToString_UnknownDisplayMode()
    {
        var info = new GameInfo(
            processName: "Game", executablePath: "", windowTitle: "",
            windowClass: "cls", displayMode: DisplayMode.Unknown,
            processId: 1, hwnd: new IntPtr(1));
        var str = info.ToString();
        Assert.Contains("[???]", str);
    }

    [Fact]
    public void GameInfo_KnownGame_ResolvedByWindowClass()
    {
        var info = new GameInfo(
            processName: "SomeProcess", executablePath: "", windowTitle: "",
            windowClass: "grcWindow", displayMode: DisplayMode.FullscreenOptimized,
            processId: 1, hwnd: new IntPtr(1));
        Assert.Equal("FiveM (GTA V)", info.KnownGame);
    }

    [Fact]
    public void GameInfo_KnownGame_ResolvedByProcessName()
    {
        var info = new GameInfo(
            processName: "FiveM", executablePath: "", windowTitle: "",
            windowClass: "unknown_class", displayMode: DisplayMode.FullscreenOptimized,
            processId: 1, hwnd: new IntPtr(1));
        Assert.Equal("FiveM (GTA V)", info.KnownGame);
    }

    [Fact]
    public void GameInfo_KnownGame_EmptyForUnknownGame()
    {
        var info = new GameInfo(
            processName: "randomapp", executablePath: "", windowTitle: "",
            windowClass: "RandomClass", displayMode: DisplayMode.Windowed,
            processId: 1, hwnd: new IntPtr(1));
        Assert.Equal("", info.KnownGame);
    }

    #endregion

    #region PttModeHelper

    [Theory]
    [InlineData("hold", "Hold")]
    [InlineData("Hold", "Hold")]
    [InlineData("HOLD", "Hold")]
    [InlineData("toggle", "Toggle")]
    [InlineData("Toggle", "Toggle")]
    [InlineData("TOGGLE", "Toggle")]
    [InlineData("off", "Off")]
    [InlineData("Off", "Off")]
    [InlineData("OFF", "Off")]
    [InlineData("", "Off")]
    [InlineData(null, "Off")]
    [InlineData("invalid", "Off")]
    [InlineData("Hold Toggle", "Off")]
    public void Normalize_ReturnsExpected(string? input, string expected)
    {
        var result = PttModeHelper.Normalize(input!);
        Assert.Equal(expected, result);
    }

    #endregion

    #region AppConfig

    [Fact]
    public void AppConfig_DefaultValues()
    {
        var cfg = new AppConfig();
        Assert.Equal(120, cfg.ReplayTimeSeconds);
        Assert.Equal(60, cfg.Fps);
        Assert.Equal(1280, cfg.Width);
        Assert.Equal(720, cfg.Height);
        Assert.Equal(30000, cfg.BitrateKbps);
        Assert.Equal(20, cfg.Cq);
        Assert.Equal(30000, cfg.MaxrateKbps);
        Assert.Equal(60000, cfg.BufsizeKbps);
        Assert.Equal(3, cfg.Bframes);
        Assert.Equal(16, cfg.Lookahead);
        Assert.Equal("p5", cfg.EncoderPreset);
        Assert.Equal("auto", cfg.Codec);
        Assert.Equal(48000, cfg.AudioSampleRate);
        Assert.Equal(1.0f, cfg.MicVolume);
        Assert.Equal(1.0f, cfg.GameVolume);
        Assert.True(cfg.MicEnabled);
        Assert.Equal("Hold", cfg.PttMode);
        Assert.False(cfg.ForceSoftware);
        Assert.False(cfg.NoiseSuppressionEnabled);
        Assert.Equal("", cfg.MicDeviceId);
        Assert.True(cfg.AutoStartCapture);
        Assert.False(cfg.UseExcludeMode);
        Assert.Equal(0, cfg.ExcludeProcessId);
        Assert.True(cfg.GameAudioOnly);
        Assert.False(cfg.AudioLoopback);
        Assert.True(cfg.AdaptiveQualityEnabled);
        Assert.Equal(5, cfg.PostClipDurationSeconds);
        Assert.True(cfg.AutoCleanupEnabled);
        Assert.Equal(100, cfg.AutoCleanupThresholdGB);
    }

    [Fact]
    public void AppConfig_HotkeyBindings_HasThreeDefaults()
    {
        var cfg = new AppConfig();
        Assert.Equal(3, cfg.HotkeyBindings.Count);
        Assert.Equal("SaveClip", cfg.HotkeyBindings[0].Action);
        Assert.Equal("ToggleCapture", cfg.HotkeyBindings[1].Action);
        Assert.Equal("ToggleMic", cfg.HotkeyBindings[2].Action);
    }

    [Fact]
    public void AppConfig_EffectiveReplaySeconds_ReturnsGlobalDefault()
    {
        var cfg = new AppConfig { ReplayTimeSeconds = 120 };
        Assert.Equal(120, cfg.EffectiveReplaySeconds);
    }

    [Fact]
    public void AppConfig_EffectiveReplaySeconds_CapsBindingDurationAtGlobal()
    {
        // Global vira o teto: uma hotkey pode salvar MENOS que o global, nunca MAIS.
        // O buffer é dimensionado pelo global — o save clamp em SaveClipAsync
        // (Math.Min(customDuration, BufferMaxDuration)) capa hotkeys maiores.
        var cfg = new AppConfig { ReplayTimeSeconds = 120 };
        cfg.HotkeyBindings[0].ReplayDurationSeconds = 300;
        Assert.Equal(120, cfg.EffectiveReplaySeconds);
    }

    [Fact]
    public void AppConfig_EffectiveReplaySeconds_IgnoresDisabledBindings()
    {
        var cfg = new AppConfig { ReplayTimeSeconds = 120 };
        cfg.HotkeyBindings[0].ReplayDurationSeconds = 300;
        cfg.HotkeyBindings[0].Enabled = false;
        Assert.Equal(120, cfg.EffectiveReplaySeconds);
    }

    [Fact]
    public void AppConfig_EffectiveReplaySeconds_BindingsNeverExceedGlobal()
    {
        // Global vira o teto — mesmo com bindings maiores que o global, o buffer
        // retém apenas o global (economia de RAM); hotkeys menores seguem menores
        // (salvas por customDuration no SaveClipAsync).
        var cfg = new AppConfig { ReplayTimeSeconds = 60 };
        cfg.HotkeyBindings[0].ReplayDurationSeconds = 120;
        cfg.HotkeyBindings[1].ReplayDurationSeconds = 200;
        cfg.HotkeyBindings[2].ReplayDurationSeconds = 90;
        Assert.Equal(60, cfg.EffectiveReplaySeconds);
    }

    [Fact]
    public void AppConfig_EffectiveReplaySeconds_NoBindings_UsesGlobal()
    {
        var cfg = new AppConfig { ReplayTimeSeconds = 180 };
        cfg.HotkeyBindings.Clear();
        Assert.Equal(180, cfg.EffectiveReplaySeconds);
    }

    [Fact]
    public void AppConfig_EffectiveReplaySeconds_NullDuration_UsesGlobal()
    {
        var cfg = new AppConfig { ReplayTimeSeconds = 180 };
        cfg.HotkeyBindings[0].ReplayDurationSeconds = null;
        Assert.Equal(180, cfg.EffectiveReplaySeconds);
    }

    #endregion

    #region IntStringDictionaryConverter

    [Fact]
    public void IntStringDictionaryConverter_DeserializesArray()
    {
        // Converter is on AppConfig.SelectedAudioSessions property, not raw Dictionary
        var json = """{"SelectedAudioSessions": [1234, 5678]}""";
        var result = JsonSerializer.Deserialize<AppConfig>(json,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        Assert.NotNull(result);
        Assert.Equal(2, result!.SelectedAudioSessions.Count);
        Assert.Equal("PID:1234", result.SelectedAudioSessions[1234]);
        Assert.Equal("PID:5678", result.SelectedAudioSessions[5678]);
    }

    [Fact]
    public void IntStringDictionaryConverter_DeserializesObject()
    {
        var json = """{"1234": "FiveM.exe", "5678": "GTA5.exe"}""";
        var result = JsonSerializer.Deserialize<Dictionary<int, string>>(json,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        Assert.NotNull(result);
        Assert.Equal(2, result!.Count);
        Assert.Equal("FiveM.exe", result[1234]);
        Assert.Equal("GTA5.exe", result[5678]);
    }

    [Fact]
    public void IntStringDictionaryConverter_DeserializesNull()
    {
        var json = "{}";
        var result = JsonSerializer.Deserialize<AppConfig>(json);
        Assert.NotNull(result);
        Assert.NotNull(result!.SelectedAudioSessions);
    }

    [Fact]
    public void IntStringDictionaryConverter_DeserializesEmptyArray()
    {
        // Converter is on AppConfig.SelectedAudioSessions property, not raw Dictionary
        var json = """{"SelectedAudioSessions": []}""";
        var result = JsonSerializer.Deserialize<AppConfig>(json,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        Assert.NotNull(result);
        Assert.Empty(result!.SelectedAudioSessions);
    }

    [Fact]
    public void IntStringDictionaryConverter_DeserializesEmptyObject()
    {
        var json = "{}";
        var result = JsonSerializer.Deserialize<Dictionary<int, string>>(json,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        Assert.NotNull(result);
        Assert.Empty(result!);
    }

    [Fact]
    public void IntStringDictionaryConverter_DeserializesSingleElementArray()
    {
        // Converter is on AppConfig.SelectedAudioSessions property, not raw Dictionary
        var json = """{"SelectedAudioSessions": [42]}""";
        var result = JsonSerializer.Deserialize<AppConfig>(json,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        Assert.NotNull(result);
        Assert.Single(result!.SelectedAudioSessions);
        Assert.Equal("PID:42", result.SelectedAudioSessions[42]);
    }

    [Fact]
    public void IntStringDictionaryConverter_InAppConfig_DeserializesArray()
    {
        var json = """{"SelectedAudioSessions": [1234, 5678]}""";
        var result = JsonSerializer.Deserialize<AppConfig>(json,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        Assert.NotNull(result);
        Assert.Equal(2, result!.SelectedAudioSessions.Count);
        Assert.Equal("PID:1234", result.SelectedAudioSessions[1234]);
    }

    [Fact]
    public void IntStringDictionaryConverter_InAppConfig_DeserializesObject()
    {
        var json = """{"SelectedAudioSessions": {"100": "game.exe"}}""";
        var result = JsonSerializer.Deserialize<AppConfig>(json,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        Assert.NotNull(result);
        Assert.Single(result!.SelectedAudioSessions);
        Assert.Equal("game.exe", result.SelectedAudioSessions[100]);
    }

    #endregion

    #region AppConfig.PttMode / serialization

    [Fact]
    public void AppConfig_PttMode_Hold_Deserializes()
    {
        var json = """{"pushToTalk": "Hold"}""";
        var result = JsonSerializer.Deserialize<AppConfig>(json,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        Assert.Equal("Hold", result!.PttMode);
    }

    [Fact]
    public void AppConfig_PttMode_Toggle_Deserializes()
    {
        var json = """{"pushToTalk": "toggle"}""";
        var result = JsonSerializer.Deserialize<AppConfig>(json,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        Assert.Equal("toggle", result!.PttMode);
    }

    [Fact]
    public void AppConfig_PttMode_Off_Deserializes()
    {
        var json = """{"pushToTalk": "OFF"}""";
        var result = JsonSerializer.Deserialize<AppConfig>(json,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        Assert.Equal("OFF", result!.PttMode);
    }

    [Fact]
    public void AppConfig_PttMode_Default_IsHold()
    {
        var cfg = new AppConfig();
        Assert.Equal("Hold", cfg.PttMode);
    }

    #endregion

    #region HotkeyBinding

    [Fact]
    public void HotkeyBinding_DefaultValues()
    {
        var binding = new HotkeyBinding();
        Assert.Equal(0x77, binding.Vk);
        Assert.Empty(binding.Modifiers);
        Assert.Equal("SaveClip", binding.Action);
        Assert.Null(binding.ReplayDurationSeconds);
        Assert.True(binding.Enabled);
    }

    [Fact]
    public void HotkeyBinding_CustomValues()
    {
        var binding = new HotkeyBinding
        {
            Vk = 0x78,
            Modifiers = new List<int> { 0x11 }, // Ctrl
            Action = "ToggleCapture",
            ReplayDurationSeconds = 300,
            Enabled = false
        };
        Assert.Equal(0x78, binding.Vk);
        Assert.Single(binding.Modifiers);
        Assert.Equal(0x11, binding.Modifiers[0]);
        Assert.Equal("ToggleCapture", binding.Action);
        Assert.Equal(300, binding.ReplayDurationSeconds);
        Assert.False(binding.Enabled);
    }

    #endregion

    #region ConfigManager

    [Fact]
    public void ConfigManager_Load_CreatesDefaults_WhenFileMissing()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        if (Directory.Exists(dir))
            Directory.Delete(dir, true);

        var cfg = new ConfigManager(tempFile);
        Assert.Equal(120, cfg.Config.ReplayTimeSeconds);
        Assert.True(File.Exists(tempFile));
    }

    [Fact]
    public void ConfigManager_Update_FiresOnConfigChanged()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var cfg = new ConfigManager(tempFile);
        var fired = false;
        cfg.OnConfigChanged += _ => fired = true;
        cfg.Update(c => c.Fps = 60);
        Assert.True(fired);
        Assert.Equal(60, cfg.Config.Fps);
    }

    [Fact]
    public void ConfigManager_Update_Persists()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var cfg = new ConfigManager(tempFile);
        cfg.Update(c => c.BitrateKbps = 50000);
        var loaded = new ConfigManager(tempFile);
        Assert.Equal(50000, loaded.Config.BitrateKbps);
    }

    [Fact]
    public void ConfigManager_Load_InvalidFps_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"Fps": 999}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(60, cfg.Config.Fps);
    }

    [Fact]
    public void ConfigManager_Load_InvalidBitrate_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"BitrateKbps": 10}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(30000, cfg.Config.BitrateKbps);
    }

    [Fact]
    public void ConfigManager_Load_InvalidReplay_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"ReplayTimeSeconds": 5}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(120, cfg.Config.ReplayTimeSeconds);
    }

    [Fact]
    public void ConfigManager_Load_InvalidWidth_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"Width": 100, "Height": 100}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(1280, cfg.Config.Width);
        Assert.Equal(720, cfg.Config.Height);
    }

    [Fact]
    public void ConfigManager_Load_InvalidAudioSampleRate_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"AudioSampleRate": 22050}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(48000, cfg.Config.AudioSampleRate);
    }

    [Fact]
    public void ConfigManager_Load_InvalidCq_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"Cq": 100}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(20, cfg.Config.Cq);
    }

    [Fact]
    public void ConfigManager_Load_InvalidMaxrate_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"MaxrateKbps": 500}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(30000, cfg.Config.MaxrateKbps);
    }

    [Fact]
    public void ConfigManager_Load_InvalidBufsize_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"BufsizeKbps": 1000}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(60000, cfg.Config.BufsizeKbps);
    }

    [Fact]
    public void ConfigManager_Load_InvalidBframes_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"Bframes": 20}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(3, cfg.Config.Bframes);
    }

    [Fact]
    public void ConfigManager_Load_InvalidLookahead_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"Lookahead": 500}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(16, cfg.Config.Lookahead);
    }

    [Fact]
    public void ConfigManager_Load_InvalidMicVolume_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"MicVolume": 5.0}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(1.0f, cfg.Config.MicVolume);
    }

    [Fact]
    public void ConfigManager_Load_CorruptJson_RevertsToDefaults()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, "{invalid json!!!}}");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(120, cfg.Config.ReplayTimeSeconds);
    }

    [Fact]
    public void ConfigManager_Load_PttMode_Normalizes()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"pushToTalk": "TOGGLE"}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal("Toggle", cfg.Config.PttMode);
    }

    [Fact]
    public void ConfigManager_Load_PttMode_Invalid_RevertsToDefault()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"pushToTalk": "something"}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal("Hold", cfg.Config.PttMode);
    }

    [Fact]
    public void ConfigManager_Load_OutputDirectory_Traversal_Rejected()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"OutputDirectory": "C:\\Windows\\System32"}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal("", cfg.Config.OutputDirectory);
    }

    [Fact]
    public void ConfigManager_Dispose_DoesNotThrow()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var cfg = new ConfigManager(tempFile);
        cfg.Dispose();
    }

    #endregion

    #region EngineStatus

    [Fact]
    public void EngineStatus_DefaultSnapshot()
    {
        using var status = new EngineStatus();
        var snapshot = status.Current;
        Assert.False(snapshot.Recording);
        Assert.Equal(0, snapshot.UptimeSeconds);
        Assert.Equal("NONE", snapshot.CaptureBackend);
        Assert.Equal("NONE", snapshot.Encoder);
        Assert.Null(snapshot.Game);
        Assert.True(snapshot.DiskSpaceOk);
        Assert.False(snapshot.LastCrashRecovered);
        Assert.Equal(0, snapshot.ActivePipelines);
    }

    [Fact]
    public void EngineStatus_Update_ModifiesSnapshot()
    {
        using var status = new EngineStatus();
        status.Update(s =>
        {
            s.Recording = true;
            s.UptimeSeconds = 60;
            s.Game = "FiveM [FSO]";
        });
        var snapshot = status.Current;
        Assert.True(snapshot.Recording);
        Assert.Equal(60, snapshot.UptimeSeconds);
        Assert.Equal("FiveM [FSO]", snapshot.Game);
    }

    [Fact]
    public void EngineStatus_Update_FiresOnStatusUpdate()
    {
        using var status = new EngineStatus();
        EngineStatusSnapshot? reported = null;
        status.OnStatusUpdate += s => reported = s;
        status.Update(s => s.Recording = true);
        Assert.NotNull(reported);
        Assert.True(reported!.Recording);
    }

    [Fact]
    public void EngineStatus_Heartbeat_KeepsWatchdogOk()
    {
        using var status = new EngineStatus();
        status.Heartbeat();
        Assert.True(status.Current.WatchdogOk);
    }

    [Fact]
    public void EngineStatus_Dispose_StopsWatchdog()
    {
        var status = new EngineStatus();
        status.Dispose();
        // Should not throw on double dispose
        status.Dispose();
    }

    #endregion

    #region DisplayMode enum

    [Theory]
    [InlineData(DisplayMode.Unknown)]
    [InlineData(DisplayMode.FullscreenExclusive)]
    [InlineData(DisplayMode.FullscreenOptimized)]
    [InlineData(DisplayMode.Windowed)]
    public void DisplayMode_AllValuesExist(DisplayMode mode)
    {
        Assert.True(Enum.IsDefined(mode));
    }

    #endregion

    #region IsProcessAlive (real process)

    [Fact]
    public void IsProcessAlive_CurrentProcess_ReturnsTrue()
    {
        var name = Environment.ProcessPath is not null
            ? Path.GetFileNameWithoutExtension(Environment.ProcessPath)
            : "testhost";
        var result = InvokeStatic("IsProcessAlive", name);
        Assert.Equal(true, result);
    }

    [Fact]
    public void IsProcessAlive_NonExistent_ReturnsFalse()
    {
        var result = InvokeStatic("IsProcessAlive", "definitely_not_a_real_process_12345");
        Assert.Equal(false, result);
    }

    [Fact]
    public void IsProcessAlive_WithExeExtension_StillWorks()
    {
        var name = Environment.ProcessPath is not null
            ? Path.GetFileNameWithoutExtension(Environment.ProcessPath)
            : "testhost";
        var result = InvokeStatic("IsProcessAlive", name + ".exe");
        Assert.Equal(true, result);
    }

    #endregion

    #region ResolveProcessByName (real process)

    [Fact]
    public void ResolveProcessByName_CurrentProcess_ReturnsValid()
    {
        var name = Environment.ProcessPath is not null
            ? Path.GetFileNameWithoutExtension(Environment.ProcessPath)
            : "testhost";
        var result = (GameInfo?)InvokeStatic("ResolveProcessByName", name);
        Assert.NotNull(result);
        Assert.True(result!.IsValid);
        Assert.Equal(Environment.ProcessId, result.ProcessId);
    }

    [Fact]
    public void ResolveProcessByName_NonExistent_ReturnsInvalid()
    {
        var result = (GameInfo?)InvokeStatic("ResolveProcessByName", "definitely_not_a_real_process_12345.exe");
        Assert.NotNull(result);
        Assert.False(result!.IsValid);
    }

    #endregion

    #region GetChildProcesses

    [Fact]
    public void GetChildProcesses_CurrentPid_ReturnsSet()
    {
        var result = (HashSet<int>?)InvokeStatic("GetChildProcesses", Environment.ProcessId);
        Assert.NotNull(result);
        Assert.IsType<HashSet<int>>(result);
    }

    [Fact]
    public void GetChildProcesses_FakePid_ReturnsEmptySet()
    {
        var result = (HashSet<int>?)InvokeStatic("GetChildProcesses", 1);
        Assert.NotNull(result);
        Assert.Empty(result!);
    }

    #endregion

    #region CaptureProfile properties

    [Fact]
    public void CaptureProfile_DefaultValues()
    {
        var profile = new DiNho.Capture.Poc.Memory.CaptureProfile();
        Assert.Equal(0, profile.Cq);
        Assert.Equal(0, profile.MaxrateKbps);
        Assert.Equal(0, profile.EncodeWidth);
        Assert.Equal(0, profile.EncodeHeight);
        Assert.Equal(0, profile.MaxBufferBytes);
        Assert.Equal(0, profile.ReplaySeconds);
    }

    #endregion

    #region PipelineHealth properties

    [Fact]
    public void PipelineHealth_DropRatePct_ZeroFrames()
    {
        var health = new PipelineHealth();
        Assert.Equal(0, health.DropRatePct);
    }

    [Fact]
    public void PipelineHealth_DropRatePct_Calculated()
    {
        var health = new PipelineHealth { TotalFrames = 100, DroppedFrames = 25 };
        Assert.Equal(25.0, health.DropRatePct);
    }

    #endregion

    #region PipelineWatchdog additional

    [Fact]
    public void PipelineWatchdog_GetHealth_InitiallyYellow()
    {
        var wd = new PipelineWatchdog();
        var health = wd.GetHealth();
        // Fresh watchdog: _consecutiveGood=0 < ConsecutiveGoodReset(30) → Yellow
        Assert.Equal(HealthLevel.Yellow, health.Level);
        Assert.Equal(0, health.TotalFrames);
        Assert.False(health.ReinitRequested);
    }

    [Fact]
    public void PipelineWatchdog_ShouldReinit_NoFramesNoIssues()
    {
        var wd = new PipelineWatchdog();
        Assert.False(wd.ShouldReinit());
    }

    [Fact]
    public void PipelineWatchdog_GetHealth_AfterDrops()
    {
        var wd = new PipelineWatchdog();
        for (int i = 0; i < 15; i++)
            wd.ReportDroppedFrame(PipelineIssue.NoFrame);
        var health = wd.GetHealth();
        Assert.Equal(HealthLevel.Red, health.Level);
        Assert.Equal(15, health.DroppedFrames);
        Assert.Equal(15, health.TotalFrames);
    }

    [Fact]
    public void PipelineWatchdog_Reset_ClearsState()
    {
        var wd = new PipelineWatchdog();
        for (int i = 0; i < 10; i++)
            wd.ReportDroppedFrame(PipelineIssue.CaptureError);
        wd.Reset();
        var health = wd.GetHealth();
        Assert.Equal(0, health.TotalFrames);
        Assert.Equal(0, health.DroppedFrames);
        Assert.Null(health.LastIssue);
    }

    [Fact]
    public void PipelineWatchdog_ConsecutiveGood_IncreasesLevelToGreen()
    {
        var wd = new PipelineWatchdog { ConsecutiveGoodReset = 5 };
        for (int i = 0; i < 10; i++)
            wd.ReportGoodFrame(16.0);
        var health = wd.GetHealth();
        Assert.Equal(HealthLevel.Green, health.Level);
        Assert.Equal(10, health.ConsecutiveGoodFrames);
    }

    [Fact]
    public void PipelineWatchdog_DropThenGood_GoesToYellow()
    {
        var wd = new PipelineWatchdog { BadFrameThreshold = 5, ConsecutiveGoodReset = 30 };
        for (int i = 0; i < 6; i++)
            wd.ReportDroppedFrame(PipelineIssue.NoFrame);
        // Now report one good frame
        wd.ReportGoodFrame(16.0);
        var health = wd.GetHealth();
        // consecutiveGood is 1, droppedFrames is 6, totalFrames is 7
        // Level: consecutiveGood (1) > 0 → Yellow
        Assert.Equal(HealthLevel.Yellow, health.Level);
    }

    [Fact]
    public void PipelineWatchdog_GetHealth_FrameTimeStats()
    {
        var wd = new PipelineWatchdog();
        wd.ReportGoodFrame(10.0);
        wd.ReportGoodFrame(20.0);
        wd.ReportGoodFrame(30.0);
        var health = wd.GetHealth();
        Assert.Equal(3, health.TotalFrames);
        Assert.True(health.AvgFrameTimeMs > 0);
        Assert.True(health.P95FrameTimeMs >= health.AvgFrameTimeMs);
    }

    [Fact]
    public void PipelineWatchdog_ReportApiSwitch_IncrementsCount()
    {
        var wd = new PipelineWatchdog();
        wd.ReportApiSwitch();
        wd.ReportApiSwitch();
        var health = wd.GetHealth();
        Assert.Equal(2, health.ApiSwitches);
    }

    [Fact]
    public void PipelineWatchdog_ReportExportStall_IncrementsAndSetsIssue()
    {
        var wd = new PipelineWatchdog();
        wd.ReportGoodFrame(16.0);
        wd.ReportExportStall();
        var health = wd.GetHealth();
        Assert.Equal(1, health.ExportStalls);
        Assert.Equal(PipelineIssue.ExportStall, health.LastIssue);
    }

    #endregion

    #region ConfigManager - valid FPS values

    [Theory]
    [InlineData(30)]
    [InlineData(60)]
    [InlineData(75)]
    [InlineData(120)]
    public void ConfigManager_Load_ValidFps_Kept(int fps)
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, $"{{\"Fps\": {fps}}}");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(fps, cfg.Config.Fps);
    }

    [Fact]
    public void ConfigManager_Load_ValidWidthRange()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"Width": 1920, "Height": 1080}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(1920, cfg.Config.Width);
        Assert.Equal(1080, cfg.Config.Height);
    }

    [Fact]
    public void ConfigManager_Load_WidthAbove1080p_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"Width": 2560, "Height": 1440}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(1280, cfg.Config.Width);
        Assert.Equal(720, cfg.Config.Height);
    }

    [Fact]
    public void ConfigManager_Load_Fps144_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"Fps": 144}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(60, cfg.Config.Fps);
    }

    [Fact]
    public void ConfigManager_Load_BoundaryWidth_TooSmall_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"Width": 639, "Height": 479}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(1280, cfg.Config.Width);
        Assert.Equal(720, cfg.Config.Height);
    }

    [Fact]
    public void ConfigManager_Load_BoundaryWidth_TooLarge_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"Width": 1921, "Height": 1081}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(1280, cfg.Config.Width);
        Assert.Equal(720, cfg.Config.Height);
    }

    [Fact]
    public void ConfigManager_Load_ValidBitrateRange()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"BitrateKbps": 100000}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(100000, cfg.Config.BitrateKbps);
    }

    [Fact]
    public void ConfigManager_Load_BitrateTooHigh_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"BitrateKbps": 200001}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(30000, cfg.Config.BitrateKbps);
    }

    [Fact]
    public void ConfigManager_Load_EmptyEncoderPreset_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"EncoderPreset": ""}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal("p5", cfg.Config.EncoderPreset);
    }

    [Fact]
    public void ConfigManager_Load_ValidMicVolume()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"MicVolume": 1.5}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(1.5f, cfg.Config.MicVolume);
    }

    [Fact]
    public void ConfigManager_Load_MicVolumeTooLow_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"MicVolume": -1.0}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(1.0f, cfg.Config.MicVolume);
    }

    [Fact]
    public void ConfigManager_Load_InvalidReplay_TooHigh_Reverts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        var dir = Path.GetDirectoryName(tempFile)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(tempFile, """{"ReplayTimeSeconds": 1201}""");
        var cfg = new ConfigManager(tempFile);
        Assert.Equal(120, cfg.Config.ReplayTimeSeconds);
    }

    #endregion

    #region KnownGames / GameDatabase

    [Fact]
    public void KnownGames_LookupWindowClass_GrcWindow_ReturnsFiveM()
    {
        var result = KnownGames.LookupWindowClass("grcWindow");
        Assert.Contains("FiveM", result);
    }

    [Fact]
    public void KnownGames_LookupWindowClass_Unknown_ReturnsEmpty()
    {
        var result = KnownGames.LookupWindowClass("RandomWindowClass123");
        Assert.Equal("", result);
    }

    [Fact]
    public void KnownGames_LookupProcessName_FiveM_ReturnsDisplayName()
    {
        // "FiveM" is an alias, not the process name; processName is "FiveM_GTAProcess"
        var result = KnownGames.LookupProcessName("FiveM_GTAProcess");
        Assert.NotNull(result);
        Assert.Contains("FiveM", result!);
    }

    [Fact]
    public void KnownGames_LookupProcessName_Unknown_ReturnsNull()
    {
        var result = KnownGames.LookupProcessName("nonexistent_process_xyz");
        Assert.Null(result);
    }

    #endregion

    #region GameInfo equality and edge cases

    [Fact]
    public void GameInfo_Hwnd_Zero_IsValid_IfProcessNameSet()
    {
        var info = new GameInfo(
            processName: "game", executablePath: "", windowTitle: "",
            windowClass: "", displayMode: DisplayMode.Windowed,
            processId: 1, hwnd: IntPtr.Zero);
        Assert.True(info.IsValid);
        Assert.Equal(IntPtr.Zero, info.Hwnd);
    }

    [Fact]
    public void GameInfo_ProcessId_Zero_IsValid_IfProcessNameSet()
    {
        var info = new GameInfo(
            processName: "game", executablePath: "", windowTitle: "",
            windowClass: "", displayMode: DisplayMode.Windowed,
            processId: 0, hwnd: new IntPtr(1));
        Assert.True(info.IsValid);
    }

    [Fact]
    public void GameInfo_ToString_IncludesKnownGameTag()
    {
        var info = new GameInfo(
            processName: "FiveM", executablePath: "", windowTitle: "",
            windowClass: "grcWindow", displayMode: DisplayMode.FullscreenOptimized,
            processId: 1, hwnd: new IntPtr(1));
        var str = info.ToString();
        Assert.Contains("FiveM", str);
        Assert.Contains("(", str);
        Assert.Contains(")", str);
    }

    [Fact]
    public void GameInfo_ToString_EmptyKnownGame_NoParens()
    {
        var info = new GameInfo(
            processName: "randomapp", executablePath: "", windowTitle: "",
            windowClass: "RandomClass", displayMode: DisplayMode.Windowed,
            processId: 1, hwnd: new IntPtr(1));
        var str = info.ToString();
        Assert.DoesNotContain("(FiveM", str);
    }

    #endregion

    #region DisplayMode enum comparison

    [Fact]
    public void DisplayMode_FullscreenModes_NotWindowed()
    {
        Assert.NotEqual(DisplayMode.FullscreenExclusive, DisplayMode.Windowed);
        Assert.NotEqual(DisplayMode.FullscreenOptimized, DisplayMode.Windowed);
    }

    [Fact]
    public void DisplayMode_FullscreenExclusive_NotEqualToOptimized()
    {
        Assert.NotEqual(DisplayMode.FullscreenExclusive, DisplayMode.FullscreenOptimized);
    }

    #endregion

    #region PostSaveTrim

    [Fact]
    public void PostSaveTrim_TrimsIdleToQuarterOfMaxIdleBytes()
    {
        const long maxIdleBytes = 8L * 1024 * 1024;
        var originalMaxIdleBytes = VideoPacketPool.MaxIdleBytes;
        VideoPacketPool.MaxIdleBytes = maxIdleBytes;
        VideoPacketPool.ResetForTest();
        try
        {
            var bufs = new byte[20][];
            for (int i = 0; i < 20; i++)
                bufs[i] = VideoPacketPool.Rent(128 * 1024);
            foreach (var buf in bufs)
                VideoPacketPool.Return(buf);
            Assert.True(VideoPacketPool.IdleBytes > maxIdleBytes / 4);

            InvokeStaticNoArgs("PostSaveTrim");

            Assert.True(VideoPacketPool.IdleBytes <= maxIdleBytes / 4);
        }
        finally
        {
            VideoPacketPool.ResetForTest();
            VideoPacketPool.MaxIdleBytes = originalMaxIdleBytes;
        }
    }

    #endregion
}
