using DiNho.Capture.Poc.Audio;
using DiNho.Capture.Poc.Config;
using Xunit;

namespace DiNho.Capture.Poc.Tests.Audio;

/// <summary>
/// Item 5: Multi-Track Audio (jogo + Discord + mic em tracks independentes).
/// Corte TDD vertical — política PURA (ranking, NÃO toca WASAPI/GPU/arquivos).
/// Ranking esperado (game > Discord > mic) quando todos disponíveis; default SEM
/// trilha de Discord (só se config explícita); erro claro se NENHUM disponível
/// (nunca grava sessão muda/falha silenciosamente).
/// </summary>
public sealed class MultiTrackAudioPolicyTests
{
    private static AudioInputConfig CreateClean() => new()
    {
        AllowMicCapture = true,
        AllowGameAudio = true,
        AllowDiscordAudio = false, // default NÃO inclui Discord
    };

    [Fact]
    public void ResolveTracks_AllAvailable_RankGameMicDiscord()
    {
        var cfg = CreateClean();
        cfg.AllowDiscordAudio = true;

        var tracks = MultiTrackAudioPolicy.ResolveTracks(cfg);

        Assert.Equal(3, tracks.Count);
        Assert.Equal(AudioTrackKind.Game, tracks[0].Kind);   // jogo SEMPRE rank 0
        Assert.Equal(AudioTrackKind.Discord, tracks[1].Kind);
        Assert.Equal(AudioTrackKind.Mic, tracks[2].Kind);
    }

    [Fact]
    public void ResolveTracks_Default_NoDiscordTrack()
    {
        var cfg = CreateClean(); // discord=false (default)

        var tracks = MultiTrackAudioPolicy.ResolveTracks(cfg);

        Assert.Equal(2, tracks.Count);
        Assert.DoesNotContain(tracks, t => t.Kind == AudioTrackKind.Discord);
    }

    [Fact]
    public void ResolveTracks_GameAvailable_MicOff_OnlyGame()
    {
        var cfg = CreateClean();
        cfg.AllowMicCapture = false;

        var tracks = MultiTrackAudioPolicy.ResolveTracks(cfg);

        Assert.Single(tracks);
        Assert.Equal(AudioTrackKind.Game, tracks[0].Kind);
    }

    [Fact]
    public void ResolveTracks_NothingAvailable_FailsWithClearError()
    {
        var cfg = CreateClean();
        cfg.AllowMicCapture = false;
        cfg.AllowGameAudio = false;

        var ex = Assert.Throws<InvalidOperationException>(
            () => MultiTrackAudioPolicy.ResolveTracks(cfg));

        Assert.Contains("NENHUMA trilha de audio disponivel", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ResolveTracks_DiscordExplicit_MicOff_RanksGameDiscord()
    {
        var cfg = CreateClean();
        cfg.AllowDiscordAudio = true;
        cfg.AllowMicCapture = false;

        var tracks = MultiTrackAudioPolicy.ResolveTracks(cfg);

        Assert.Equal(2, tracks.Count);
        Assert.Equal(AudioTrackKind.Game, tracks[0].Kind);
        Assert.Equal(AudioTrackKind.Discord, tracks[1].Kind);
    }
}
