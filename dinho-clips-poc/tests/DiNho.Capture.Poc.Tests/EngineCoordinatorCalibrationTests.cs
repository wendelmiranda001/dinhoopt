using System.Text.Json;
using DiNho.Capture.Poc.Config;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Quality;

namespace DiNho.Capture.Poc.Tests;

public sealed class EngineCoordinatorCalibrationTests : IDisposable
{
    private const long Gb = 1024L * 1024 * 1024;

    private readonly string _tempDir;
    private readonly string _tempPath;
    private readonly List<ConfigManager> _disposables = new();

    private static EncoderManager.GpuAdapterInfo Adapter(int vendor, long vramGb = 6) => new()
    {
        Name = "TestGPU",
        VendorId = vendor,
        VideoMemoryBytes = vramGb * Gb,
    };

    public EngineCoordinatorCalibrationTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "DiNhoCalib_" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(_tempDir);
        _tempPath = Path.Combine(_tempDir, "config.json");
    }

    public void Dispose()
    {
        MachineCapabilities.DetectAdapters = EncoderManager.DetectAllGpuAdapters;
        MachineCapabilities.GetCpuCores = () => Environment.ProcessorCount;
        MachineCapabilities.GetTotalRamBytes = MachineCapabilities.DefaultRamProvider;
        foreach (var cfg in _disposables) cfg.Dispose();
        try { Directory.Delete(_tempDir, recursive: true); } catch { }
    }

    private ConfigManager CreateConfig(Action<AppConfig>? configure = null)
    {
        // Primeira criação persiste os defaults no arquivo; as demais re-leem.
        var cfg = new ConfigManager(_tempPath);
        _disposables.Add(cfg);
        configure?.Invoke(cfg.Config);
        return cfg;
    }

    private AppConfig ReadPersisted()
    {
        var json = File.ReadAllText(_tempPath);
        return JsonSerializer.Deserialize<AppConfig>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? new AppConfig();
    }

    [Fact]
    public void TryApply_AdaptiveDisabled_ReturnsFalseAndDoesNotChange()
    {
        var cfg = CreateConfig(c => c.AdaptiveQualityEnabled = false);
        MachineCapabilities.DetectAdapters = () => new[] { Adapter(0x10DE, 2) };
        MachineCapabilities.GetCpuCores = () => 4;
        MachineCapabilities.GetTotalRamBytes = () => 6 * Gb;

        var applied = EngineCoordinator.TryApplyMachineCalibration(cfg, out _);

        Assert.False(applied);
        Assert.Equal(60, cfg.Config.Fps);
        Assert.Equal("p5", cfg.Config.EncoderPreset);
    }

    [Fact]
    public void TryApply_CollectionFails_ReturnsFalseAndDoesNotChange()
    {
        var cfg = CreateConfig();
        MachineCapabilities.DetectAdapters = () => Array.Empty<EncoderManager.GpuAdapterInfo>();

        var applied = EngineCoordinator.TryApplyMachineCalibration(cfg, out _);

        Assert.False(applied);
        Assert.Equal(60, cfg.Config.Fps);
    }

    [Fact]
    public void TryApply_WeakMachine_AppliesCalibratedDefaults()
    {
        var cfg = CreateConfig();
        MachineCapabilities.DetectAdapters = () => new[] { Adapter(0x10DE, 2) };
        MachineCapabilities.GetCpuCores = () => 4;
        MachineCapabilities.GetTotalRamBytes = () => 6 * Gb;

        var applied = EngineCoordinator.TryApplyMachineCalibration(cfg, out var tier);

        Assert.True(applied);
        Assert.Equal(CapabilityTier.Weak, tier);
        Assert.Equal("p2", cfg.Config.EncoderPreset);
        Assert.False(cfg.Config.Multipass);
        Assert.Equal(30, cfg.Config.Fps);
        Assert.Equal(1280, cfg.Config.Width);
        Assert.Equal(720, cfg.Config.Height);
        Assert.Equal(60, cfg.Config.ReplayTimeSeconds);
    }

    [Fact]
    public void TryApply_WeakMachine_DoesNotPersistToDisk()
    {
        var cfg = CreateConfig(); // cria o arquivo com os defaults
        var persistedBefore = ReadPersisted();
        MachineCapabilities.DetectAdapters = () => new[] { Adapter(0x10DE, 2) };
        MachineCapabilities.GetCpuCores = () => 4;
        MachineCapabilities.GetTotalRamBytes = () => 6 * Gb;

        EngineCoordinator.TryApplyMachineCalibration(cfg, out _);

        // O arquivo continua com os defaults originais — calibração é só em memória.
        var persistedAfter = ReadPersisted();
        Assert.Equal(persistedBefore.Fps, persistedAfter.Fps);
        Assert.Equal("p5", persistedAfter.EncoderPreset);
        Assert.Equal(1280, persistedAfter.Width);
    }

    [Fact]
    public void TryApply_WeakMachine_UserOverridePresetIsKept()
    {
        var cfg = CreateConfig(c => c.EncoderPreset = "p7");
        MachineCapabilities.DetectAdapters = () => new[] { Adapter(0x10DE, 2) };
        MachineCapabilities.GetCpuCores = () => 4;
        MachineCapabilities.GetTotalRamBytes = () => 6 * Gb;

        var applied = EngineCoordinator.TryApplyMachineCalibration(cfg, out _);

        Assert.True(applied);
        Assert.Equal("p7", cfg.Config.EncoderPreset);
        Assert.Equal(30, cfg.Config.Fps);
    }

    [Fact]
    public void TryApply_StrongMachine_NoBehavioralChange()
    {
        var cfg = CreateConfig();
        MachineCapabilities.DetectAdapters = () => new[] { Adapter(0x10DE, 16) };
        MachineCapabilities.GetCpuCores = () => 16;
        MachineCapabilities.GetTotalRamBytes = () => 32 * Gb;

        var applied = EngineCoordinator.TryApplyMachineCalibration(cfg, out var tier);

        Assert.True(applied);
        Assert.Equal(CapabilityTier.Strong, tier);
        Assert.Equal(60, cfg.Config.Fps);
        Assert.Equal("p5", cfg.Config.EncoderPreset);
        Assert.True(cfg.Config.Multipass);
    }
}