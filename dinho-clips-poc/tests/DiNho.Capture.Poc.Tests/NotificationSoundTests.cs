using System.Diagnostics;
using DiNho.Capture.Poc.Audio;

namespace DiNho.Capture.Poc.Tests;

// 4.10: PlayClipSaved não pode travar quem chamou (~700ms de Sleep síncrono antigo).
// A reprodução real roda numa thread de fundo; os testes só verificam o retorno
// rápido e o cálculo puro de duração.
public sealed class NotificationSoundTests
{
    // 33600 amostras @48k = 700ms → +50ms de margem
    [Fact]
    public void GetDurationMs_AddsSleepPad()
    {
        Assert.Equal(750, NotificationSound.GetDurationMs(33600));
        Assert.Equal(50, NotificationSound.GetDurationMs(0));
    }

    [Fact]
    public void PlayClipSaved_ReturnsQuicklyDespiteBackgroundPlayback()
    {
        var sw = Stopwatch.StartNew();
        NotificationSound.PlayClipSaved();
        sw.Stop();

        Assert.True(sw.ElapsedMilliseconds < 1000, $"PlayClipSaved levou {sw.ElapsedMilliseconds}ms");
    }

    [Fact]
    public void PlayClipSaved_TwoRapidCalls_ReturnFast()
    {
        var sw = Stopwatch.StartNew();
        NotificationSound.PlayClipSaved();
        NotificationSound.PlayClipSaved();
        sw.Stop();

        Assert.True(sw.ElapsedMilliseconds < 1200, $"duplo PlayClipSaved levou {sw.ElapsedMilliseconds}ms");
    }
}