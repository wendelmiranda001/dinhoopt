using DiNho.Capture.Poc.Config;
using DiNho.Capture.Poc.Quality;

namespace DiNho.Capture.Poc.Tests;

public sealed class CalibratedDefaultsTests
{
    private static readonly MachineProfile WeakProfile = new()
    {
        EncoderPreset = "p2",
        Multipass = false,
        Fps = 30,
        MaxWidth = 1280,
        MaxHeight = 720,
        ReplaySeconds = 60,
    };

    private static AppConfig Defaults() => new();

    private static AppConfig Apply(AppConfig current, MachineProfile? profile = null, AppConfig? defaults = null)
        => CalibratedDefaults.Apply(current, defaults ?? Defaults(), profile ?? WeakProfile);

    [Fact]
    public void Apply_AllFieldsAtDefault_AppliesCalibratedProfile()
    {
        var result = Apply(new AppConfig());

        Assert.Equal("p2", result.EncoderPreset);
        Assert.False(result.Multipass);
        Assert.Equal(30, result.Fps);
        Assert.Equal(1280, result.Width);
        Assert.Equal(720, result.Height);
        Assert.Equal(60, result.ReplayTimeSeconds);
    }

    [Fact]
    public void Apply_UserOverrodePreset_KeepsPresetAppliesOthers()
    {
        var current = new AppConfig { EncoderPreset = "p7" };
        var result = Apply(current);

        Assert.Equal("p7", result.EncoderPreset);
        Assert.False(result.Multipass);
        Assert.Equal(30, result.Fps);
    }

    [Fact]
    public void Apply_UserOverrodeMultipass_KeepsMultipass()
    {
        // Override explícito do usuário (false, default é true) é preservado mesmo
        // quando o perfil calibrado mandaria Multipass=true.
        var current = new AppConfig { Multipass = false };
        var strongProfile = new MachineProfile
        {
            EncoderPreset = "p6",
            Multipass = true,
            Fps = 60,
            ReplaySeconds = 120,
        };
        var result = Apply(current, strongProfile);

        Assert.False(result.Multipass);
        Assert.Equal("p6", result.EncoderPreset);
    }

    [Fact]
    public void Apply_UserOverrodeFps_KeepsFps()
    {
        var current = new AppConfig { Fps = 144 };
        var result = Apply(current);

        Assert.Equal(144, result.Fps);
        Assert.Equal("p2", result.EncoderPreset);
    }

    [Fact]
    public void Apply_UserOverrodeReplay_KeepsReplay()
    {
        var current = new AppConfig { ReplayTimeSeconds = 300 };
        var result = Apply(current);

        Assert.Equal(300, result.ReplayTimeSeconds);
        Assert.Equal("p2", result.EncoderPreset);
    }

    [Fact]
    public void Apply_UserOverrodeWidth_KeepsResolutionDespiteCap()
    {
        // Override de largura do usuário → resolução inteira preservada (cap só
        // quando largura E altura estão nos defaults; nunca meia-resolução).
        var current = new AppConfig { Width = 1920 };
        var result = Apply(current);

        Assert.Equal(1920, result.Width);
        Assert.Equal(720, result.Height);
    }

    [Fact]
    public void Apply_ProfileWithoutResolutionCap_KeepsDefaultResolution()
    {
        var strong = new MachineProfile
        {
            EncoderPreset = "p5",
            Multipass = true,
            Fps = 60,
            MaxWidth = 0,
            MaxHeight = 0,
            ReplaySeconds = 120,
        };
        var result = Apply(new AppConfig(), strong);

        Assert.Equal(1280, result.Width);
        Assert.Equal(720, result.Height);
    }

    [Fact]
    public void Apply_ReturnsNewInstance_DoesNotMutateInput()
    {
        var current = new AppConfig();
        var result = Apply(current);

        Assert.NotSame(current, result);
        Assert.Equal("p5", current.EncoderPreset);
        Assert.True(current.Multipass);
        Assert.Equal(60, current.Fps);
        Assert.Equal(120, current.ReplayTimeSeconds);
    }
}