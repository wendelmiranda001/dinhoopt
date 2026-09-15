using System.Diagnostics;
using System.Threading;

namespace DiNho.Capture.Poc.Watchdog;

/// <summary>
/// Agente de medição do feed de vídeo: agrega por janela (default 5s) os tempos por
/// estágio de cada frame que atravessa o pipeline loop→stdio, mais contagens de falha e
/// profundidade da fila do writer. Consumido pelo loop de captura (EngineCoordinator.Capture)
/// para logar o breakdown wait / copy / convert / total — o que separa o gargalo
/// WGC/DWM (wait dominante) do gargalo de conversão/GPU (convert dominante).
/// Thread-safe: o lock protege leituras cross-thread (status/UI) e o reset do summary.
/// </summary>
internal sealed class FeedTelemetry
{
    private readonly double _windowSeconds;
    private readonly long _freq;
    private readonly long _windowTicks;

    private readonly object _sync = new();
    private long _windowStartTicks;
    private int _goodFrames;
    private int _encodeNulls;
    private int _failFrames;
    private double _waitTicks;
    private double _copyTicks;
    private double _convertTicks;
    private double _totalTicks;
    private long _queueDepthSum;
    private long _queueDepthCount;
    private int _queueDepthMax;

    /// <param name="freq">Ticks por segundo (default: <see cref="Stopwatch.Frequency"/>).</param>
    internal FeedTelemetry(double windowSeconds = 5.0, long freq = 0)
    {
        _windowSeconds = Math.Max(0.1, windowSeconds);
        _freq = freq > 0 ? freq : Stopwatch.Frequency;
        _windowTicks = (long)(_freq * _windowSeconds);
    }

    internal int GoodFrames
    {
        get { lock (_sync) return _goodFrames; }
    }

    internal int EncodeNulls
    {
        get { lock (_sync) return _encodeNulls; }
    }

    internal int FailFrames
    {
        get { lock (_sync) return _failFrames; }
    }

    internal void AddGoodFrame(long waitTicks, long copyTicks, long convertTicks, long totalTicks)
    {
        lock (_sync)
        {
            _goodFrames++;
            _waitTicks += waitTicks;
            _copyTicks += copyTicks;
            _convertTicks += convertTicks;
            _totalTicks += totalTicks;
        }
    }

    internal void AddEncodeNull()
    {
        lock (_sync) _encodeNulls++;
    }

    internal void AddFailFrame()
    {
        lock (_sync) _failFrames++;
    }

    internal void AddQueueDepth(int depth)
    {
        lock (_sync)
        {
            _queueDepthSum += depth;
            _queueDepthCount++;
            if (depth > _queueDepthMax) _queueDepthMax = depth;
        }
    }

    /// <summary>
    /// Se a janela expirou desde o último summary, computa o resumo atual e zera os
    /// acumuladores. Retorna false (e <paramref name="summary"/> = default) dentro da janela.
    /// <paramref name="nowTicks"/> deve usar a mesma base de <see cref="Stopwatch"/>.
    /// </summary>
    internal bool TryTakeSummary(long nowTicks, out FeedSummary summary)
    {
        lock (_sync)
        {
            if (nowTicks - _windowStartTicks < _windowTicks)
            {
                summary = default;
                return false;
            }

            summary = new FeedSummary(
                GoodFrames: _goodFrames,
                EncodeNulls: _encodeNulls,
                FailFrames: _failFrames,
                WaitMs: Ms(TicksToMs(_waitTicks) / Math.Max(1, _goodFrames)),
                CopyMs: Ms(TicksToMs(_copyTicks) / Math.Max(1, _goodFrames)),
                ConvertMs: Ms(TicksToMs(_convertTicks) / Math.Max(1, _goodFrames)),
                TotalMs: Ms(TicksToMs(_totalTicks) / Math.Max(1, _goodFrames)),
                FeedFps: _goodFrames / _windowSeconds,
                QueueDepthAvg: _queueDepthCount > 0 ? _queueDepthSum / (double)_queueDepthCount : 0,
                QueueDepthMax: _queueDepthMax);

            _windowStartTicks = nowTicks;
            _goodFrames = 0;
            _encodeNulls = 0;
            _failFrames = 0;
            _waitTicks = 0;
            _copyTicks = 0;
            _convertTicks = 0;
            _totalTicks = 0;
            _queueDepthSum = 0;
            _queueDepthCount = 0;
            _queueDepthMax = 0;
            return true;
        }
    }

    private double TicksToMs(double ticks) => ticks * 1000.0 / _freq;
    private static double Ms(double ms) => Math.Round(ms, 2);
}

/// <summary>Snapshot de uma janela do feed. Tempos em ms (excl. faixas anômalas apenas na média).</summary>
internal readonly record struct FeedSummary(
    int GoodFrames,
    int EncodeNulls,
    int FailFrames,
    double WaitMs,
    double CopyMs,
    double ConvertMs,
    double TotalMs,
    double FeedFps,
    double QueueDepthAvg,
    int QueueDepthMax);