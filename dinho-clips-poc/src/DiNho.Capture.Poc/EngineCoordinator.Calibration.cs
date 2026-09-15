using DiNho.Capture.Poc.Config;
using DiNho.Capture.Poc.Logging;
using DiNho.Capture.Poc.Quality;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    /// <summary>
    /// Passo de calibração por capacidade da máquina, chamado uma vez por StartCapture
    /// antes do RamManager. Aplica defaults calibrados no Config EM MEMÓRIA somente onde
    /// o campo está no default original; override do usuário nunca é sobrescrito.
    /// Retorna false (e não toca nada) se AdaptiveQuality está desligado ou a coleta
    /// de capacidades falhou por completo.
    /// </summary>
    internal static bool TryApplyMachineCalibration(ConfigManager config, out CapabilityTier tier)
    {
        tier = default;

        if (!config.Config.AdaptiveQualityEnabled)
            return false;

        if (!MachineCapabilities.TryCollect(out var caps))
            return false;

        tier = CapabilityClassifier.Classify(caps.EncodingAdapter, caps.CpuCores, caps.RamBytes);
        var profile = CapabilityClassifier.BuildProfile(tier, caps.EncodingAdapter?.VendorId ?? 0);

        // Defaults de referência = novos AppConfig (idênticos aos `_defaults` do ConfigManager).
        var calibrated = CalibratedDefaults.Apply(config.Config, new AppConfig(), profile);
        config.ApplyCalibrated(calibrated);

        var adapterName = caps.EncodingAdapter == null ? "?" : caps.EncodingAdapter.Name;
        Log.I("EngineCoordinator",
            $"MachineCapabilities: tier={tier} adapter='{adapterName}' cores={caps.CpuCores} ram={caps.RamBytes / (1024 * 1024)}MB → preset={calibrated.EncoderPreset} multipass={calibrated.Multipass} fps={calibrated.Fps} replay={calibrated.ReplayTimeSeconds}s");
        return true;
    }
}