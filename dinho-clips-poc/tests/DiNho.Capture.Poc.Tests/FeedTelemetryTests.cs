using DiNho.Capture.Poc.Watchdog;

namespace DiNho.Capture.Poc.Tests;

public sealed class FeedTelemetryTests
{
    private const long Freq = 1_000_000; // ticks = µs

    private static FeedTelemetry Create(double windowSeconds) => new(windowSeconds, Freq);

    // Janela não expirada → summary null, estado preservado.
    [Fact]
    public void TryTakeSummary_DentroDaJanela_RetornaNull()
    {
        var t = Create(5.0);
        t.AddGoodFrame(1_000, 500, 4_000, 20_000);
        Assert.False(t.TryTakeSummary(3_000_000, out var _));
        Assert.False(t.TryTakeSummary(4_999_999, out var _));
    }

    // Janela expirada → resume a janela e zera os acumuladores.
    [Fact]
    public void TryTakeSummary_JanelaExpirada_ResumeEZaera()
    {
        var t = Create(5.0);
        t.AddGoodFrame(2_000, 500, 4_000, 21_500);
        t.AddGoodFrame(2_000, 500, 3_000, 20_500);
        var s = t.TryTakeSummary(5_000_000, out var summary);
        Assert.True(s);
        Assert.Equal(2, summary.GoodFrames);
        Assert.Equal(2.0, summary.WaitMs, 3);
        Assert.Equal(0.5, summary.CopyMs, 3);
        Assert.Equal(3.5, summary.ConvertMs, 3);
        Assert.Equal(21.0, summary.TotalMs, 3);
        // 2 frames / 5s → 0.4fps neste tick de teste
        Assert.Equal(0.4, summary.FeedFps, 3);

        // Após o reset, janela nova começa vazia (mais 6s de relógio → expira de novo).
        var s2 = t.TryTakeSummary(11_000_000, out var summary2);
        Assert.True(s2);
        Assert.Equal(0, summary2.GoodFrames);
    }

    // FeedFps é frames bons / janela real de relógio, não / intervalo decorrido.
    [Fact]
    public void FeedFps_UsaJanelaCompleta()
    {
        var t = Create(2.0);
        for (int i = 0; i < 12; i++)
            t.AddGoodFrame(1_000, 200, 2_000, 16_000);
        var success = t.TryTakeSummary(4_000_000, out var s);
        Assert.True(success);
        Assert.Equal(12, s.GoodFrames);
        Assert.Equal(6.0, s.FeedFps, 3); // 12 / 2s
    }

    // Encodes nulos (EncodeFrame retornou null) e falhas de captura são contados separadamente.
    [Fact]
    public void Counts_EncodeNull_e_FailFrames_Separados()
    {
        var t = Create(5.0);
        t.AddGoodFrame(1_000, 200, 3_000, 16_000);
        t.AddEncodeNull();
        t.AddEncodeNull();
        t.AddFailFrame();
        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(1, s.GoodFrames);
        Assert.Equal(2, s.EncodeNulls);
        Assert.Equal(1, s.FailFrames);
        Assert.Equal(0.2, s.FeedFps, 3);
    }

    // Filas: média e pico de depth amostrados durante a janela.
    [Fact]
    public void QueueDepth_MediaEPico()
    {
        var t = Create(5.0);
        t.AddQueueDepth(0);
        t.AddQueueDepth(2);
        t.AddQueueDepth(4);
        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(2.0, s.QueueDepthAvg, 3);
        Assert.Equal(4, s.QueueDepthMax);
    }

    // Sem nenhuma amostra, o summary ainda sai com zeros (janela vazia não gera stall de log).
    [Fact]
    public void SummaryVazio_ZerosSemExcecao()
    {
        var t = Create(5.0);
        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(0, s.GoodFrames);
        Assert.Equal(0.0, s.WaitMs, 3);
        Assert.Equal(0.0, s.FeedFps, 3);
    }

    // Order de ticks anômalos (wait negativo por jitter de QPC) NÃO entra na média
    // — outlier > 100ms é excluído do cálculo, preservando a média dos frames saudáveis.
    [Fact]
    public void TicksAnomalos_SaoExcluidosDaMedia()
    {
        var t = Create(5.0);
        t.AddGoodFrame(-1_000, 500, 4_000, 20_000);
        var s = t.TryTakeSummary(5_000_000, out var summary);
        Assert.True(s);
        // 1 frame outlier → excluded, GoodFrames still 1 but mean = 0 (no good frames used)
        Assert.Equal(0.0, summary.WaitMs, 3);
        Assert.Equal(1, summary.GoodFrames);
    }

    // Spike de 500ms no wait não distorce a média dos demais frames.
    [Fact]
    public void SingleSpike_DoesNotSkewMean()
    {
        var t = Create(5.0);
        // 4 normais: wait=2ms (2000 ticks @1MHz)
        t.AddGoodFrame(2_000, 500, 4_000, 21_000);
        t.AddGoodFrame(2_000, 500, 4_000, 21_000);
        t.AddGoodFrame(2_000, 500, 4_000, 21_000);
        t.AddGoodFrame(2_000, 500, 4_000, 21_000);
        // 1 spike: wait=500ms (500_000 ticks) → excluded
        t.AddGoodFrame(500_000, 500, 4_000, 521_000);

        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(5, s.GoodFrames);
        Assert.Equal(2.0, s.WaitMs, 3);  // spike excluded → mean = 2.0
    }

    // Frames todos normais → média inalterada.
    [Fact]
    public void AllNormal_NoExclusion()
    {
        var t = Create(5.0);
        t.AddGoodFrame(1_000, 500, 4_000, 20_000);
        t.AddGoodFrame(3_000, 500, 4_000, 20_000);
        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(2.0, s.WaitMs, 3); // mean of 1ms and 3ms
        Assert.Equal(2, s.GoodFrames);
    }

    // Múltiplos outliers: só frames limpos contam na média.
    [Fact]
    public void MultipleOutliers_ExcludeAll()
    {
        var t = Create(5.0);
        // 1 outlier wait
        t.AddGoodFrame(500_000, 500, 4_000, 521_000);
        // 1 outlier convert
        t.AddGoodFrame(2_000, 500, 500_000, 521_000);
        // 1 normal
        t.AddGoodFrame(2_000, 500, 4_000, 21_000);

        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(3, s.GoodFrames);
        // Only the 1 normal frame used for mean
        Assert.Equal(2.0, s.WaitMs, 3);
        Assert.Equal(4.0, s.ConvertMs, 3);
    }
}