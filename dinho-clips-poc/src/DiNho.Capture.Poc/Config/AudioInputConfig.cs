namespace DiNho.Capture.Poc.Config;

/// <summary>
/// Item 5: configuração de captura de áudio (multi-track).
/// Contrato puro — NÃO toca WASAPI/GPU/arquivos.
/// Default: jogo + mic ligados; <see cref="AllowDiscordAudio"/> = false (trilha de
/// Discord SÓ entra com config explícita — nunca implicitamente).
/// </summary>
public sealed class AudioInputConfig
{
    /// <summary>Captura o som do jogo (rank 0). Default true.</summary>
    public bool AllowGameAudio { get; set; } = true;

    /// <summary>Captura o microfone do usuário (rank 2). Default true.</summary>
    public bool AllowMicCapture { get; set; } = true;

    /// <summary>Captura áudio de app de voz (Discord, rank 1). Default FALSE — só se
    /// o usuário declarar explicitamente (nunca regressa silenciosamente a incluir Discord).</summary>
    public bool AllowDiscordAudio { get; set; } = false;
}
