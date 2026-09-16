using DiNho.Capture.Poc.Audio;

namespace DiNho.Capture.Poc.Tests;

public sealed class MaxineAfxFilterTests
{
    [Fact]
    public void IsMaxineSdkPresent_DirectoryWithSdkDll_ReturnsTrue()
    {
        using var dir = new TempDirectory();
        File.WriteAllText(Path.Combine(dir.Path, "nvaudiofx64.dll"), "fake");
        Assert.True(MaxineAfxFilter.IsMaxineSdkPresent(dir.Path));
    }

    [Fact]
    public void IsMaxineSdkPresent_DirectoryWithoutSdkDll_ReturnsFalse()
    {
        using var dir = new TempDirectory();
        Assert.False(MaxineAfxFilter.IsMaxineSdkPresent(dir.Path));
    }

    [Fact]
    public void IsMaxineSdkPresent_NullOrEmptyDirectory_ReturnsFalse()
    {
        Assert.False(MaxineAfxFilter.IsMaxineSdkPresent(""));
        Assert.False(MaxineAfxFilter.IsMaxineSdkPresent(null!));
    }

    [Fact]
    public void BuildMaxineFilter_WithoutRnnModel_UsesAnlmdn()
    {
        using var dir = new TempDirectory();
        var filter = MaxineAfxFilter.BuildMaxineFilter(enableDenoise: true, enableDereverb: false, dir.Path);
        Assert.Equal("anlmdn", filter);
    }

    [Fact]
    public void BuildMaxineFilter_WithRnnModel_UsesArnndnWithAbsolutePath()
    {
        using var dir = new TempDirectory();
        var modelDir = Path.Combine(dir.Path, "models", "rnnoise");
        Directory.CreateDirectory(modelDir);
        File.WriteAllText(Path.Combine(modelDir, "model.rnnn"), "fake");

        var filter = MaxineAfxFilter.BuildMaxineFilter(true, false, dir.Path);

        Assert.StartsWith("arnndn=m=", filter);
        Assert.Contains("model.rnnn", filter);
        Assert.Contains("models" + Path.DirectorySeparatorChar + "rnnoise", filter);
    }

    [Fact]
    public void BuildMaxineFilter_NoDenoiseNoDereverb_ReturnsAnlmdn()
    {
        using var dir = new TempDirectory();
        Assert.Equal("anlmdn", MaxineAfxFilter.BuildMaxineFilter(false, false, dir.Path));
    }

    [Fact]
    public void BuildMaxineFilter_DereverbOnly_FiltersAppended()
    {
        using var dir = new TempDirectory();
        var filter = MaxineAfxFilter.BuildMaxineFilter(false, true, dir.Path);
        Assert.Equal("afftdn=nf=-25", filter);
    }

    [Fact]
    public void BuildMaxineFilter_BothFilters_JoinedWithComma()
    {
        using var dir = new TempDirectory();
        var filter = MaxineAfxFilter.BuildMaxineFilter(true, true, dir.Path);
        Assert.Contains("afftdn=nf=-25", filter);
        // Without model, denoise = anlmdn
        Assert.StartsWith("anlmdn,", filter);
    }

    private sealed class TempDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(
            System.IO.Path.GetTempPath(), "maxine-test-" + Guid.NewGuid().ToString("N"));

        public TempDirectory() => Directory.CreateDirectory(Path);

        public void Dispose()
        {
            try { Directory.Delete(Path, recursive: true); }
            catch { /* best-effort cleanup */ }
        }
    }
}
