using DiNho.Capture.Poc.Config;

namespace DiNho.Capture.Poc.Tests;

public sealed class ConfigManagerTests
{
    private static ConfigManager CreateClean()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"), "config.json");
        return new ConfigManager(tempFile);
    }

    [Fact]
    public void Default_Config_HasExpectedValues()
    {
        var cfg = CreateClean();
        Assert.Equal(30000, cfg.Config.BitrateKbps);
        Assert.Equal(60, cfg.Config.Fps);
        Assert.Equal(1280, cfg.Config.Width);
        Assert.Equal(720, cfg.Config.Height);
        Assert.Equal(120, cfg.Config.ReplayTimeSeconds);
        Assert.True(cfg.Config.Multipass);
    }

    [Fact]
    public void Default_Multipass_IsTrue()
    {
        var cfg = CreateClean();
        Assert.True(cfg.Config.Multipass);
    }

    [Fact]
    public void Default_EncoderPreset_IsP6()
    {
        var cfg = CreateClean();
        Assert.Equal("p5", cfg.Config.EncoderPreset);
    }

    // Item 2 (Step 3 RED): texture mode sempre ligado — sem fallback silencioso pra Hybrid.
    // AllowHybridFallback=false por padrão: se nenhum backend de textura for viável a captura
    // FALHA com erro claro (nunca "fundo branco e manchas" do caminho Hybrid).
    [Fact]
    public void AllowHybridFallback_DefaultsFalse()
    {
        var cfg = CreateClean();
        Assert.False(cfg.Config.AllowHybridFallback);
    }

    [Fact]
    public void OverrideBitrate_Persists()
    {
        var cfg = CreateClean();
        cfg.Config.BitrateKbps = 10000;
        Assert.Equal(10000, cfg.Config.BitrateKbps);
    }

    [Fact]
    public void OverrideFps_Persists()
    {
        var cfg = CreateClean();
        cfg.Config.Fps = 30;
        Assert.Equal(30, cfg.Config.Fps);
    }

    [Fact]
    public void OverrideResolution_Persists()
    {
        var cfg = CreateClean();
        cfg.Config.Width = 1920;
        cfg.Config.Height = 1080;
        Assert.Equal(1920, cfg.Config.Width);
        Assert.Equal(1080, cfg.Config.Height);
    }

    [Theory]
    [InlineData("p1", true)]
    [InlineData("p5", true)]
    [InlineData("p7", true)]
    [InlineData("P5", true)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData(null, false)]
    [InlineData("p8", false)]
    [InlineData("veryfast", false)]
    [InlineData("veryslow", false)]
    [InlineData("p5; shutdown /s", false)]
    [InlineData("--preset evil", false)]
    public void IsValidEncoderPreset_Validates(string? preset, bool expected)
    {
        Assert.Equal(expected, ConfigManager.IsValidEncoderPreset(preset));
    }

    [Fact]
    public void Load_InvalidEncoderPreset_FallsBackToDefault()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        var tempFile = Path.Combine(tempDir, "config.json");
        File.WriteAllText(tempFile, "{\"EncoderPreset\":\"p5; shutdown /s\"}");
        try
        {
            var cfg = new ConfigManager(tempFile);
            Assert.Equal("p5", cfg.Config.EncoderPreset);
        }
        finally
        {
            Directory.Delete(tempDir, true);
        }
    }

    [Fact]
    public void ValidateAndFix_ClampsInvalidNumericValues()
    {
        var cfg = CreateClean();
        var raw = new AppConfig
        {
            ReplayTimeSeconds = 5,
            Fps = 144,
            AudioSampleRate = 12345,
            Width = 100,
            Height = 100,
            BitrateKbps = 1,
            Cq = 99,
            MaxrateKbps = 0,
            BufsizeKbps = 0,
            Bframes = 99,
            Lookahead = -5,
            MicVolume = 9f,
        };

        cfg.ValidateAndFix(raw);

        Assert.Equal(120, raw.ReplayTimeSeconds);
        Assert.Equal(60, raw.Fps);
        Assert.Equal(48000, raw.AudioSampleRate);
        Assert.Equal(1280, raw.Width);
        Assert.Equal(720, raw.Height);
        Assert.Equal(30000, raw.BitrateKbps);
        Assert.Equal(20, raw.Cq);
        Assert.Equal(30000, raw.MaxrateKbps);
        Assert.Equal(60000, raw.BufsizeKbps);
        Assert.Equal(3, raw.Bframes);
        Assert.Equal(16, raw.Lookahead);
        Assert.Equal(1.0f, raw.MicVolume);
    }

    [Fact]
    public void ValidateAndFix_ValidValues_Unchanged()
    {
        var cfg = CreateClean();
        var raw = new AppConfig
        {
            ReplayTimeSeconds = 300,
            Fps = 60,
            AudioSampleRate = 48000,
            Width = 1280,
            Height = 720,
            BitrateKbps = 30000,
            Cq = 22,
            MaxrateKbps = 40000,
            BufsizeKbps = 80000,
            Bframes = 2,
            Lookahead = 16,
            MicVolume = 2.5f,
        };

        cfg.ValidateAndFix(raw);

        Assert.Equal(300, raw.ReplayTimeSeconds);
        Assert.Equal(22, raw.Cq);
        Assert.Equal(40000, raw.MaxrateKbps);
        Assert.Equal(80000, raw.BufsizeKbps);
        Assert.Equal(2, raw.Bframes);
        Assert.Equal(16, raw.Lookahead);
        Assert.Equal(2.5f, raw.MicVolume);
    }

    [Fact]
    public void ValidateAndFix_RejectsOutputDirectoryOutsideProfile()
    {
        var cfg = CreateClean();
        var raw = new AppConfig { OutputDirectory = "C:\\Windows\\System32" };

        cfg.ValidateAndFix(raw);

        Assert.Equal("", raw.OutputDirectory);
    }

    [Fact]
    public void ValidateAndFix_ClampsHotkeyReplayDurations()
    {
        var cfg = CreateClean();
        var raw = new AppConfig();
        raw.HotkeyBindings.Clear();
        raw.HotkeyBindings.Add(new HotkeyBinding { Vk = 0x77, Action = "SaveClip", ReplayDurationSeconds = 100000, Enabled = true });
        raw.HotkeyBindings.Add(new HotkeyBinding { Vk = 0x78, Action = "ToggleCapture", ReplayDurationSeconds = 60, Enabled = true });

        cfg.ValidateAndFix(raw);

        Assert.Null(raw.HotkeyBindings[0].ReplayDurationSeconds);
        Assert.Equal(60, raw.HotkeyBindings[1].ReplayDurationSeconds);
        Assert.Equal(120, raw.EffectiveReplaySeconds);
    }

    [Fact]
    public void Update_PipeStyleUnclampedValues_AreClamped()
    {
        var cfg = CreateClean();

        cfg.Update(c =>
        {
            c.Cq = 99;
            c.OutputDirectory = "C:\\Windows\\System32";
        });

        Assert.Equal(20, cfg.Config.Cq);
        Assert.Equal("", cfg.Config.OutputDirectory);
    }

    [Fact]
    public void Update_HotkeyBindingsNull_RestoresEmptyList()
    {
        var cfg = CreateClean();

        cfg.Update(c => c.HotkeyBindings = null!);

        Assert.NotNull(cfg.Config.HotkeyBindings);
        Assert.Empty(cfg.Config.HotkeyBindings);
        Assert.Equal(120, cfg.Config.EffectiveReplaySeconds);
    }

    [Fact]
    public void Update_PipeStyleHybridReplayBufferMode_PersistsNormalized()
    {
        var cfg = CreateClean();

        cfg.Update(c => c.ReplayBufferMode = "Hybrid");

        Assert.Equal("hybrid", cfg.Config.ReplayBufferMode);
    }

    [Fact]
    public void Update_PipeStyleInvalidReplayBufferMode_FallsBackToDefault()
    {
        var cfg = CreateClean();

        cfg.Update(c => c.ReplayBufferMode = "disk-only");

        Assert.Equal("disk", cfg.Config.ReplayBufferMode);
    }

    [Fact]
    public void Update_PipeStyleStretchToFit_Persist()
    {
        var cfg = CreateClean();

        cfg.Update(c => c.StretchToFit = true);

        Assert.True(cfg.Config.StretchToFit);
    }

    // ── 6.1: migração de config antiga (SaveClipVk/etc.) deve rodar mesmo quando
    //    os defaults iniciais do deserializador casam o gate do "novo formato" ──

    [Fact]
    public void Load_OldFormatWithCustomVks_MigratesBindings()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        var tempFile = Path.Combine(tempDir, "config.json");
        File.WriteAllText(tempFile, """
            {
              "SaveClipVk": 114,
              "ToggleCaptureVk": 115,
              "ToggleMicVk": 116,
              "ReplayTimeSeconds": 300
            }
            """);
        try
        {
            var cfg = new ConfigManager(tempFile);

            Assert.Equal(3, cfg.Config.HotkeyBindings.Count);
            Assert.Equal(114, cfg.Config.HotkeyBindings[0].Vk);
            Assert.Equal("SaveClip", cfg.Config.HotkeyBindings[0].Action);
            Assert.Equal(115, cfg.Config.HotkeyBindings[1].Vk);
            Assert.Equal("ToggleCapture", cfg.Config.HotkeyBindings[1].Action);
            Assert.Equal(116, cfg.Config.HotkeyBindings[2].Vk);
            Assert.Equal("ToggleMic", cfg.Config.HotkeyBindings[2].Action);
            Assert.Equal(300, cfg.Config.ReplayTimeSeconds);

            // A migração deve persistir o novo formato no disco
            var persisted = File.ReadAllText(tempFile);
            Assert.Contains("\"Hotkeys\"", persisted);
            Assert.DoesNotContain("SaveClipVk", persisted);
        }
        finally
        {
            Directory.Delete(tempDir, true);
        }
    }

    [Fact]
    public void Load_OldFormatSingleCustomSaveVk_MigratesWithDefaultsForOthers()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        var tempFile = Path.Combine(tempDir, "config.json");
        File.WriteAllText(tempFile, """{ "SaveClipVk": 16 }""");
        try
        {
            var cfg = new ConfigManager(tempFile);

            Assert.Equal(16, cfg.Config.HotkeyBindings[0].Vk);
            Assert.Equal("SaveClip", cfg.Config.HotkeyBindings[0].Action);
            Assert.Equal(3, cfg.Config.HotkeyBindings.Count);
        }
        finally
        {
            Directory.Delete(tempDir, true);
        }
    }

    // ── 6.2: config corrompida deve ser SOBRESCRITA por defaults no boot,
    //    não deixada corrompida para perpetuar o erro. ──

    [Fact]
    public void Load_CorruptedJson_OverwritesFileWithDefaults()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "DiNhoTest_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        var tempFile = Path.Combine(tempDir, "config.json");
        File.WriteAllText(tempFile, "{ not valid json !!!");
        try
        {
            var cfg = new ConfigManager(tempFile);

            Assert.Equal(60, cfg.Config.Fps);
            var persisted = File.ReadAllText(tempFile);
            Assert.Contains("\"Fps\"", persisted); // arquivo regravado com defaults
        }
        finally
        {
            Directory.Delete(tempDir, true);
        }
    }

    // ── 6.3: anti-path-traversal deve exigir o separador após o perfil ──

    [Fact]
    public void ValidateAndFix_RejectsSiblingDirectorySharingProfilePrefix()
    {
        var cfg = CreateClean();
        var profileDir = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        // Sem o separador, "C:\Users\Windows2" é prefixo de "C:\Users\Windows".
        var sibling = profileDir + "2";
        var raw = new AppConfig { OutputDirectory = sibling };

        cfg.ValidateAndFix(raw);

        Assert.Equal("", raw.OutputDirectory);
    }
}