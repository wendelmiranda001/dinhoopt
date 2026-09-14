namespace DiNho.Capture.Poc.Quality;

public enum CapabilityTier
{
    Weak,
    Medium,
    Strong,
}

/// <summary>Defaults calibrados por capacidade da máquina (imutável).</summary>
public sealed record MachineProfile
{
    public string EncoderPreset { get; init; } = "p5";
    public bool Multipass { get; init; } = true;
    public int Fps { get; init; } = 60;

    /// <summary>0 = sem cap de resolução.</summary>
    public int MaxWidth { get; init; }

    /// <summary>0 = sem cap de resolução.</summary>
    public int MaxHeight { get; init; }

    public int ReplaySeconds { get; init; } = 120;
}