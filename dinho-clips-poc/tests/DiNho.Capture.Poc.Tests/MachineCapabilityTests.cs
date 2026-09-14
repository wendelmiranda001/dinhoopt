using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Quality;

namespace DiNho.Capture.Poc.Tests;

public sealed class MachineCapabilityTests
{
    private const long Gb = 1024L * 1024 * 1024;

    private static EncoderManager.GpuAdapterInfo Adapter(long vramGb) => new()
    {
        Index = 0,
        Name = "Test GPU",
        VendorId = 0x10DE,
        VideoMemoryBytes = vramGb * Gb,
    };

    // ── Weak ─────────────────────────────────────────────────────────

    [Fact]
    public void Classify_RamBelow8Gb_IsWeak()
    {
        Assert.Equal(CapabilityTier.Weak, CapabilityClassifier.Classify(Adapter(8), 8, 7 * Gb));
    }

    [Fact]
    public void Classify_FourCoresOrLess_IsWeak()
    {
        Assert.Equal(CapabilityTier.Weak, CapabilityClassifier.Classify(Adapter(8), 4, 32 * Gb));
        Assert.Equal(CapabilityTier.Weak, CapabilityClassifier.Classify(Adapter(8), 2, 32 * Gb));
    }

    [Fact]
    public void Classify_VramBelow3Gb_IsWeak()
    {
        Assert.Equal(CapabilityTier.Weak, CapabilityClassifier.Classify(Adapter(2), 12, 32 * Gb));
    }

    [Fact]
    public void Classify_NoEncodingAdapter_IsWeak()
    {
        Assert.Equal(CapabilityTier.Weak, CapabilityClassifier.Classify(null, 16, 32 * Gb));
    }

    // ── Medium ───────────────────────────────────────────────────────

    [Fact]
    public void Classify_RamBelow16Gb_IsMedium()
    {
        Assert.Equal(CapabilityTier.Medium, CapabilityClassifier.Classify(Adapter(8), 16, 12 * Gb));
    }

    [Fact]
    public void Classify_UpToEightCores_IsMedium()
    {
        Assert.Equal(CapabilityTier.Medium, CapabilityClassifier.Classify(Adapter(8), 8, 32 * Gb));
    }

    [Fact]
    public void Classify_VramBelow6Gb_IsMedium()
    {
        Assert.Equal(CapabilityTier.Medium, CapabilityClassifier.Classify(Adapter(4), 16, 32 * Gb));
    }

    // ── Strong ───────────────────────────────────────────────────────

    [Fact]
    public void Classify_AllStrong_IsStrong()
    {
        Assert.Equal(CapabilityTier.Strong, CapabilityClassifier.Classify(Adapter(16), 16, 32 * Gb));
    }

    // ── Boundaries ───────────────────────────────────────────────────

    [Fact]
    public void Classify_RamExactly8Gb_IsNotWeak()
    {
        Assert.NotEqual(CapabilityTier.Weak, CapabilityClassifier.Classify(Adapter(8), 8, 8 * Gb));
        Assert.Equal(CapabilityTier.Medium, CapabilityClassifier.Classify(Adapter(8), 8, 8 * Gb));
    }

    [Fact]
    public void Classify_CoresExactly4_IsWeak()
    {
        Assert.Equal(CapabilityTier.Weak, CapabilityClassifier.Classify(Adapter(8), 4, 32 * Gb));
    }

    [Fact]
    public void Classify_VramExactly3Gb_IsNotWeakIsMedium()
    {
        Assert.Equal(CapabilityTier.Medium, CapabilityClassifier.Classify(Adapter(3), 16, 32 * Gb));
    }

    // ── MachineProfile ───────────────────────────────────────────────

    [Fact]
    public void BuildProfile_Weak_DowngradesEverything()
    {
        var p = CapabilityClassifier.BuildProfile(CapabilityTier.Weak);
        Assert.Equal("p2", p.EncoderPreset);
        Assert.False(p.Multipass);
        Assert.Equal(30, p.Fps);
        Assert.Equal(1280, p.MaxWidth);
        Assert.Equal(720, p.MaxHeight);
        Assert.Equal(60, p.ReplaySeconds);
    }

    [Fact]
    public void BuildProfile_Medium_LightAdjustment()
    {
        var p = CapabilityClassifier.BuildProfile(CapabilityTier.Medium);
        Assert.Equal("p3", p.EncoderPreset);
        Assert.True(p.Multipass);
        Assert.Equal(60, p.Fps);
        Assert.Equal(0, p.MaxWidth);
        Assert.Equal(0, p.MaxHeight);
        Assert.Equal(120, p.ReplaySeconds);
    }

    [Fact]
    public void BuildProfile_Strong_KeepsDefaults()
    {
        var p = CapabilityClassifier.BuildProfile(CapabilityTier.Strong);
        Assert.Equal("p5", p.EncoderPreset);
        Assert.True(p.Multipass);
        Assert.Equal(60, p.Fps);
        Assert.Equal(0, p.MaxWidth);
        Assert.Equal(0, p.MaxHeight);
        Assert.Equal(120, p.ReplaySeconds);
    }
}