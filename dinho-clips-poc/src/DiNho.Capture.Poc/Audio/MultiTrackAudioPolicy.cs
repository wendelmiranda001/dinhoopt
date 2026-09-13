using DiNho.Capture.Poc.Config;

namespace DiNho.Capture.Poc.Audio;

/// <summary>
/// Item 5: política PURA de trilhas de áudio multi-track.
/// Ranking SEMPRE explícito e determinístico (NUNCA depende de ordem de enumeração
/// WASAPI/GPU): game &gt; discord &gt; mic quando todos disponíveis.
/// Discord SÓ entra se config explícita (AllowDiscordAudio=true — VER contraparte.
/// default false, igual AllowHybridFallback do Item 2: nunca inclui silenciosamente).
/// Se NENHUMA trilha disponível → falha com erro claro (nunca grava sessão muda).
/// </summary>
public static class MultiTrackAudioPolicy
{
    /// <summary>Resolve a ordem das trilhas pro clip.** Sempre game primeiro (rank 0),
    /// depois discord se configurado, depois mic.</summary>
    public static IReadOnlyList<AudioTrackDecision> ResolveTracks(AudioInputConfig cfg)
    {
        if (cfg is null)
        {
            throw new ArgumentNullException(nameof(cfg));
        }

        var tracks = new List<AudioTrackDecision>();
        if (cfg.AllowGameAudio)
        {
            tracks.Add(new AudioTrackDecision(AudioTrackKind.Game, 0));
        }

        if (cfg.AllowDiscordAudio)
        {
            tracks.Add(new AudioTrackDecision(AudioTrackKind.Discord, 1));
        }

        if (cfg.AllowMicCapture)
        {
            tracks.Add(new AudioTrackDecision(AudioTrackKind.Mic, 2));
        }

        if (tracks.Count == 0)
        {
            throw new InvalidOperationException(
                "NENHUMA trilha de audio disponivel: AllowMicCapture, AllowGameAudio e " +
                "AllowDiscordAudio estao todos false (ou o app de jogo/audio nao esta rodando). " +
                "Nunca grava uma sessao muda silenciosamente.");
        }

        return tracks;
    }
}

/// <summary>Uma trilha resolvida: kind + rank fixo.</summary>
public sealed record AudioTrackDecision(AudioTrackKind Kind, int Rank);
