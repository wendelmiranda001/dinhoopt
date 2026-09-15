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
    /// Escolhe o adapter de encode: delega ao ranking canônico (6.4) de
    /// <c>EncoderManager.PickBestAdapter</c> — NVIDIA > AMD por VRAM, senão qualquer
    /// suportada (iGPU). Evita divergência com <c>DetectEncodingVendorId</c>.
    /// </summary>
    public static EncoderManager.GpuAdapterInfo? PickEncodingAdapter(IReadOnlyList<EncoderManager.GpuAdapterInfo> adapters)
        => EncoderManager.PickBestAdapter(adapters);

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