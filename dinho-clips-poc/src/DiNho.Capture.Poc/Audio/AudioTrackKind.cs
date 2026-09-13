namespace DiNho.Capture.Poc.Audio;

/// <summary>
/// Item 5: tipo de trilha de áudio num clip multi-track.
/// Ranking de aplicabilidade (SEMPRE esta ordem quando o recurso está disponível):
///   Game (rank 0) &gt; Discord (rank 1) &gt; Mic (rank 2).
/// O ranking é estável/determinístico — nunca depende de ordem de enumeração hw (WASAPI/GPU).
/// </summary>
public enum AudioTrackKind
{
    /// <summary>Som do jogo (origem de captura principal). Sempre rank 0 quando disponível.</summary>
    Game = 0,

    /// <summary>Som de app de voz (ex: Discord). Só se config explícita (default NÃO inclui).</summary>
    Discord = 1,

    /// <summary>Microfone do usuário.</summary>
    Mic = 2,
}
