using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Quality;

/// <summary>
/// Coleta a capacidade real da máquina no runtime (adapter de encode, núcleos, RAM).
/// A coleta é seam-injetável para testes; a lógica de decisão fica no
/// <see cref="CapabilityClassifier"/> (puro).
/// </summary>
public static class MachineCapabilities
{
    public delegate IReadOnlyList<EncoderManager.GpuAdapterInfo> AdapterDetector();
    public delegate int CoreProvider();
    public delegate long RamProvider();

    internal static AdapterDetector DetectAdapters = EncoderManager.DetectAllGpuAdapters;
    internal static CoreProvider GetCpuCores = () => Environment.ProcessorCount;
    internal static RamProvider GetTotalRamBytes = DefaultRamProvider;

    /// <summary>Total de RAM disponível (≈ memória física). Usa GC info para evitar P/Invoke.</summary>
    public static long DefaultRamProvider() => GC.GetGCMemoryInfo().TotalAvailableMemoryBytes;

    /// <summary>
    /// Escolhe o adapter de encode: discreta NVIDIA > AMD (por VRAM); senão qualquer
    /// suportado (iGPU). Mesma preferência de <c>EncoderManager.DetectEncodingVendorId</c>,
    /// retornando o objeto completo (VRAM) em vez de só o vendor.
    /// </summary>
    public static EncoderManager.GpuAdapterInfo? PickEncodingAdapter(IReadOnlyList<EncoderManager.GpuAdapterInfo> adapters)
    {
        var discrete = adapters
            .Where(a => a.VendorId is 0x10DE or 0x1002)
            .OrderByDescending(a => a.VendorId == 0x10DE ? 2 : 1)
            .ThenByDescending(a => a.VideoMemoryBytes)
            .FirstOrDefault();
        if (discrete != null)
            return discrete;

        return adapters.FirstOrDefault(a => a.VendorId is 0x10DE or 0x1002 or 0x8086);
    }

    /// <summary>
    /// Coleta as capacidades. Retorna false quando a detecção falhou por completo
    /// (sem adapters / RAM 0 / cores 0) — nesse caso o chamador NÃO deve calibrar.
    /// </summary>
    public static bool TryCollect(out (EncoderManager.GpuAdapterInfo? EncodingAdapter, int CpuCores, long RamBytes) caps)
    {
        caps = default;

        var adapters = DetectAdapters();
        if (adapters.Count == 0)
            return false;

        long ram = GetTotalRamBytes();
        int cores = GetCpuCores();
        if (ram <= 0 || cores <= 0)
            return false;

        caps = (PickEncodingAdapter(adapters), cores, ram);
        return true;
    }
}