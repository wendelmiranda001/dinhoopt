using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Graphics;

namespace DiNho.Capture.Poc.Tests;

public sealed class MonitorAdapterResolverTests
{
    private const long Mb = 1024 * 1024;

    private static MonitorRect Rect(int l, int t, int r, int b) => new(l, t, r, b);

    private static AdapterMonitor Mon(int index, int vendor, long vramMb = 4096, params MonitorRect[] rects) =>
        new(index, vendor, vramMb * Mb, rects);

    private static EncoderManager.GpuAdapterInfo Gpu(int index, int vendor, long vramMb = 4096) => new()
    {
        Index = index,
        Name = $"GPU{index}",
        VendorId = vendor,
        VideoMemoryBytes = vramMb * Mb,
    };

    private static readonly MonitorRect GameOnSecond = Rect(150, 150, 1900, 1010);

    // ── Override (AdapterIndex do config) ────────────────────────────

    [Fact]
    public void Resolve_ConfiguredValid_ReturnsConfiguredIndex()
    {
        var adapters = new[]
        {
            Mon(0, 0x8086, 0, Rect(0, 0, 1920, 1080)),
            Mon(1, 0x10DE, 8000, Rect(0, 0, 1920, 1080)),
        };
        Assert.Equal(1, MonitorAdapterResolver.Resolve(1, adapters, GameOnSecond));
    }

    [Fact]
    public void Resolve_ConfiguredOutOfRange_FallsBackToAuto()
    {
        var adapters = new[]
        {
            Mon(0, 0x8086, 0, Rect(0, 0, 1920, 1080)),
            Mon(1, 0x10DE, 8000, Rect(150, 150, 1900, 1010)),
        };
        Assert.Equal(1, MonitorAdapterResolver.Resolve(9, adapters, GameOnSecond));
    }

    // ── Auto (match por monitor do jogo) ─────────────────────────────

    [Fact]
    public void Resolve_ConfiguredNegative_AutoMatchesOwningAdapter()
    {
        var adapters = new[]
        {
            Mon(0, 0x8086, 0, Rect(0, 0, 1920, 1080)),
            Mon(1, 0x10DE, 8000, Rect(150, 150, 1900, 1010)),
        };
        Assert.Equal(1, MonitorAdapterResolver.Resolve(-1, adapters, GameOnSecond));
    }

    [Fact]
    public void Resolve_PartialOverlapNotOwning_CenterMustBeInside()
    {
        // Retângulo 0..100 vs game monitor no retângulo 90..200 x 90..200:
        // centro do game (145, 95?) — usa um caso claro: adapter cobre só uma borda.
        var adapters = new[]
        {
            Mon(0, 0x10DE, 8000, Rect(0, 100, 100, 200)), // borda, não contém o centro
            Mon(1, 0x10DE, 8000, Rect(150, 150, 1900, 1010)),
        };
        Assert.Equal(1, MonitorAdapterResolver.Resolve(-1, adapters, GameOnSecond));
    }

    [Fact]
    public void Resolve_NoAdapterCoversMonitor_ReturnsMinusOne()
    {
        // Nenhum output contém o centro do monitor do jogo (rects longe dele).
        var adapters = new[]
        {
            Mon(0, 0x10DE, 8000, Rect(0, 0, 100, 100)),
            Mon(1, 0x10DE, 8000, Rect(0, 0, 100, 100)),
        };
        Assert.Equal(-1, MonitorAdapterResolver.Resolve(-1, adapters, GameOnSecond));
    }

    [Fact]
    public void Resolve_EmptyGameMonitor_ReturnsMinusOne()
    {
        var adapters = new[] { Mon(0, 0x10DE, 8000, Rect(0, 0, 100, 100)) };
        Assert.Equal(-1, MonitorAdapterResolver.Resolve(-1, adapters, Rect(0, 0, 0, 0)));
    }

    // ── Preferência de vendedor no empate ────────────────────────────

    [Fact]
    public void Resolve_TwoAdaptersCover_PrefersDiscreteNvidiaOverIgpu()
    {
        // iGPU tem 16GB "shared" > dGPU 1GB dedicada — ainda assim dGPU NVIDIA vence.
        var adapters = new[]
        {
            Mon(0, 0x8086, 16384, Rect(150, 150, 1900, 1010)),
            Mon(1, 0x10DE, 1024, Rect(150, 150, 1900, 1010)),
        };
        Assert.Equal(1, MonitorAdapterResolver.Resolve(-1, adapters, GameOnSecond));
    }

    [Fact]
    public void Resolve_TwoAdaptersCover_PrefersDiscreteAmdOverIgpu()
    {
        var adapters = new[]
        {
            Mon(0, 0x8086, 16384, Rect(150, 150, 1900, 1010)),
            Mon(1, 0x1002, 4096, Rect(150, 150, 1900, 1010)),
        };
        Assert.Equal(1, MonitorAdapterResolver.Resolve(-1, adapters, GameOnSecond));
    }

    [Fact]
    public void Resolve_TwoAdaptersCover_SameVendor_UsesBiggerVram()
    {
        var adapters = new[]
        {
            Mon(0, 0x10DE, 2048, Rect(150, 150, 1900, 1010)),
            Mon(1, 0x10DE, 8192, Rect(150, 150, 1900, 1010)),
        };
        Assert.Equal(1, MonitorAdapterResolver.Resolve(-1, adapters, GameOnSecond));
    }

    // ── EnumerateAdapterMonitors ─────────────────────────────────────

    [Fact]
    public void EnumerateAdapterMonitors_EmptyOutputs_YieldsEmptyMonitors()
    {
        var adapters = new[] { Gpu(0, 0x10DE, 8000) };
        var monitors = MonitorAdapterResolver.EnumerateAdapterMonitors(adapters, _ => Array.Empty<MonitorRect>());
        Assert.Empty(monitors[0].Monitors);
    }

    [Fact]
    public void EnumerateAdapterMonitors_CollectsAllOutputRects()
    {
        var adapters = new[] { Gpu(0, 0x10DE, 8000) };
        var monitors = MonitorAdapterResolver.EnumerateAdapterMonitors(
            adapters, idx => new[] { Rect(0, 0, 100, 100), Rect(100, 0, 200, 100) });
        Assert.Equal(2, monitors[0].Monitors.Count);
        Assert.Equal(100, monitors[0].Monitors[0].Right);
    }

    [Fact]
    public void EnumerateAdapterMonitors_ThrowingEnumerator_DoesNotCrash()
    {
        var adapters = new[] { Gpu(0, 0x10DE, 8000), Gpu(1, 0x1002, 4096) };
        var monitors = MonitorAdapterResolver.EnumerateAdapterMonitors(
            adapters, idx => idx == 0 ? throw new InvalidOperationException("DXGI failed") : Array.Empty<MonitorRect>());
        Assert.Empty(monitors[0].Monitors);
        Assert.Empty(monitors[1].Monitors);
    }

    // ── VendorPriority ───────────────────────────────────────────────

    [Theory]
    [InlineData(0x10DE, 3)]
    [InlineData(0x1002, 2)]
    [InlineData(0x8086, 1)]
    [InlineData(0x1234, 0)]
    public void VendorPriority_OrdersByDiscreteVendor(int vendor, int expected)
    {
        Assert.Equal(expected, MonitorAdapterResolver.VendorPriority(vendor));
    }
}