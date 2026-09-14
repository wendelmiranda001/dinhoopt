using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Quality;

/// <summary>
/// Classifica a capacidade da máquina a partir do adapter de encode escolhido,
/// núcleos de CPU e RAM total. Função pura (testável sem GPU).
/// </summary>
public static class CapabilityClassifier
{
    public const long WeakRamBytes = 8L * 1024 * 1024 * 1024;
    public const long MediumRamBytes = 16L * 1024 * 1024 * 1024;
    public const int WeakCoreCount = 4;
    public const int MediumCoreCount = 8;
    public const long WeakVramBytes = 3L * 1024 * 1024 * 1024;
    public const long MediumVramBytes = 6L * 1024 * 1024 * 1024;

    public static CapabilityTier Classify(EncoderManager.GpuAdapterInfo? encodingAdapter, int cpuCores, long ramBytes)
    {
        if (encodingAdapter is null)
            return CapabilityTier.Weak;

        if (ramBytes < WeakRamBytes || cpuCores <= WeakCoreCount || encodingAdapter.VideoMemoryBytes < WeakVramBytes)
            return CapabilityTier.Weak;

        if (ramBytes < MediumRamBytes || cpuCores <= MediumCoreCount || encodingAdapter.VideoMemoryBytes < MediumVramBytes)
            return CapabilityTier.Medium;

        return CapabilityTier.Strong;
    }

    public static MachineProfile BuildProfile(CapabilityTier tier) => tier switch
    {
        CapabilityTier.Weak => new MachineProfile
        {
            EncoderPreset = "p2",
            Multipass = false,
            Fps = 30,
            MaxWidth = 1280,
            MaxHeight = 720,
            ReplaySeconds = 60,
        },
        CapabilityTier.Medium => new MachineProfile
        {
            EncoderPreset = "p3",
            Multipass = true,
            Fps = 60,
            ReplaySeconds = 120,
        },
        _ => new MachineProfile(),
    };
}