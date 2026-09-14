using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Quality;

namespace DiNho.Capture.Poc.Tests;

public sealed class MachineCapabilitiesTests : IDisposable
{
    private const long Gb = 1024L * 1024 * 1024;

    private static EncoderManager.GpuAdapterInfo Adapter(int index, int vendor, long vramGb = 6) => new()
    {
        Index = index,
        Name = $"GPU{index}",
        VendorId = vendor,
        VideoMemoryBytes = vramGb * Gb,
    };

    private static readonly EncoderManager.GpuAdapterInfo NvidiaDiscrete = Adapter(0, 0x10DE, 8);
    private static readonly EncoderManager.GpuAdapterInfo AmdDiscrete = Adapter(1, 0x1002, 8);
    private static readonly EncoderManager.GpuAdapterInfo IntelIgpu = Adapter(2, 0x8086, 0);

    public MachineCapabilitiesTests()
    {
        // Salva os seams e injeta determinismo em todos os testes deste fixture.
        _oldAdapters = MachineCapabilities.DetectAdapters;
        _oldCores = MachineCapabilities.GetCpuCores;
        _oldRam = MachineCapabilities.GetTotalRamBytes;
        MachineCapabilities.GetCpuCores = () => 8;
        MachineCapabilities.GetTotalRamBytes = () => 16 * Gb;
    }

    private readonly object? _oldAdapters;
    private readonly object? _oldCores;
    private readonly object? _oldRam;

    public void Dispose()
    {
        MachineCapabilities.DetectAdapters = _oldAdapters as MachineCapabilities.AdapterDetector
            ?? EncoderManager.DetectAllGpuAdapters;
        MachineCapabilities.GetCpuCores = _oldCores as MachineCapabilities.CoreProvider
            ?? (() => Environment.ProcessorCount);
        MachineCapabilities.GetTotalRamBytes = _oldRam as MachineCapabilities.RamProvider
            ?? MachineCapabilities.DefaultRamProvider;
    }

    // ── PickEncodingAdapter ─────────────────────────────────────────

    [Fact]
    public void PickEncodingAdapter_Empty_ReturnsNull()
    {
        Assert.Null(MachineCapabilities.PickEncodingAdapter(Array.Empty<EncoderManager.GpuAdapterInfo>()));
    }

    [Fact]
    public void PickEncodingAdapter_PrefersNvidiaDiscrete()
    {
        var adapters = new[] { IntelIgpu, AmdDiscrete, NvidiaDiscrete };
        var picked = MachineCapabilities.PickEncodingAdapter(adapters);
        Assert.Equal(NvidiaDiscrete, picked);
    }

    [Fact]
    public void PickEncodingAdapter_PrefersDiscreteOverIgpu()
    {
        var adapters = new[] { IntelIgpu, AmdDiscrete };
        var picked = MachineCapabilities.PickEncodingAdapter(adapters);
        Assert.Equal(AmdDiscrete, picked);
    }

    [Fact]
    public void PickEncodingAdapter_IgpuOnly_ReturnsIgpu()
    {
        var adapters = new[] { IntelIgpu };
        Assert.Equal(IntelIgpu, MachineCapabilities.PickEncodingAdapter(adapters));
    }

    [Fact]
    public void PickEncodingAdapter_UnknownVendor_ReturnsNull()
    {
        // Só adapters sem vendor de encode → null (tratado como "não detectável").
        var weird = new EncoderManager.GpuAdapterInfo { Index = 0, Name = "Weird", VendorId = 0x1234, VideoMemoryBytes = 8 * Gb };
        Assert.Null(MachineCapabilities.PickEncodingAdapter(new[] { weird }));
    }

    // ── TryCollect ──────────────────────────────────────────────────

    [Fact]
    public void TryCollect_EmptyAdapters_ReturnsFalse()
    {
        MachineCapabilities.DetectAdapters = () => Array.Empty<EncoderManager.GpuAdapterInfo>();
        Assert.False(MachineCapabilities.TryCollect(out _));
    }

    [Fact]
    public void TryCollect_ZeroRam_ReturnsFalse()
    {
        MachineCapabilities.DetectAdapters = () => new[] { NvidiaDiscrete };
        MachineCapabilities.GetTotalRamBytes = () => 0;
        Assert.False(MachineCapabilities.TryCollect(out _));
    }

    [Fact]
    public void TryCollect_Valid_ReturnsTrueAndPicksEncodingAdapter()
    {
        MachineCapabilities.DetectAdapters = () => new[] { IntelIgpu, NvidiaDiscrete };
        MachineCapabilities.GetTotalRamBytes = () => 16 * Gb;
        MachineCapabilities.GetCpuCores = () => 12;

        Assert.True(MachineCapabilities.TryCollect(out var caps));
        Assert.Equal(NvidiaDiscrete, caps.EncodingAdapter);
        Assert.Equal(12, caps.CpuCores);
        Assert.Equal(16 * Gb, caps.RamBytes);
    }
}