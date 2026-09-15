using DiNho.Capture.Poc.Logging;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using System.Collections.Concurrent;

namespace DiNho.Capture.Poc.Audio;

/// <summary>
/// NAudio's WasapiRecorder.StopRecording()/Dispose() Join the capture thread. On endpoints that
/// stop producing data (dead loopback, removed mic) that Join can block forever, hanging app
/// shutdown. All recorder teardown is run on an IsBackground thread with a bounded Join; when the
/// bound is hit the work is re-queued for a periodic best-effort retry so the recorder is
/// eventually disposed once the underlying thread unblocks (instead of leaking it forever).
/// </summary>
internal static class WasapiStopGuard
{
    private static readonly ConcurrentQueue<Action> _retryQueue = new();
    private static int _sweeperStarted;
    private const int RetryIntervalMs = 5_000;

    /// <summary>Disable the auto background sweeper so tests can drive <see cref="SweepOnce"/> deterministically.</summary>
    internal static bool AutoSweepEnabled { get; set; } = true;

    /// <summary>
    /// Executa work numa thread IsBackground, esperando no máximo <paramref name="timeout"/>.
    /// Devolve true quando o trabalho terminou dentro do tempo; false quando foi abandonado.
    /// Nunca lança.
    /// </summary>
    internal static bool RunBounded(Action work, TimeSpan timeout, string who)
    {
        var thread = new Thread(() =>
        {
            try { work(); }
            catch (Exception ex) { Log.W(who, $"teardown work failed: {ex.Message}"); }
        })
        { IsBackground = true };
        thread.Start();
        return thread.Join(timeout);
    }

    internal static void StopInBackground(WasapiRecorder capture, string who)
    {
        if (!RunBounded(() => CaptureSafe(capture, release: false), TimeSpan.FromSeconds(2), who))
            DeferRetry(() => CaptureSafe(capture, release: false), who);
    }

    internal static void DisposeInBackground(WasapiRecorder capture, string who)
    {
        if (!RunBounded(() => CaptureSafe(capture, release: true), TimeSpan.FromSeconds(4), who))
            DeferRetry(() => CaptureSafe(capture, release: true), who);
    }

    private static void CaptureSafe(WasapiRecorder capture, bool release)
    {
        try
        {
            // NAudio 3.1 race: StopRecording applied before the capture thread reaches its
            // `captureState = Capturing` assignment is swallowed and never re-applied, leaving the
            // thread looping forever and Dispose's Join blocked. Wait until capturing before stop.
            var sw = System.Diagnostics.Stopwatch.StartNew();
            while (capture.CaptureState == CaptureState.Starting && sw.ElapsedMilliseconds < 3000)
                Thread.Sleep(5);
        }
        catch { }
        try { capture.StopRecording(); } catch { }
        if (release)
        {
            try { capture.Dispose(); } catch { }
        }
    }

    internal static int PendingRetryCount => _retryQueue.Count;

    internal static void DeferRetry(Action work, string who)
    {
        Log.W(who, "teardown did not finish in time — recorder queued for background retry");
        _retryQueue.Enqueue(work);
        if (AutoSweepEnabled)
            EnsureSweeper();
    }

    private static void EnsureSweeper()
    {
        if (Interlocked.Exchange(ref _sweeperStarted, 1) != 0)
            return;
        var t = new Thread(SweepLoop)
        {
            IsBackground = true,
            Name = "WasapiStopGuard-Sweeper",
        };
        t.Start();
    }

    private static void SweepLoop()
    {
        while (true)
        {
            if (_retryQueue.IsEmpty)
            {
                Thread.Sleep(RetryIntervalMs);
                continue;
            }
            SweepOnce();
            Thread.Sleep(RetryIntervalMs);
        }
    }

    /// <summary>
    /// Tenta processar pendências sem bloquear a caller além de alíquota por item.
    /// Devolve true quando a fila esvaziou; pendências que voltam a estourar o tempo
    /// são reenfileiradas na cauda (próxima varredura).
    /// </summary>
    internal static bool SweepOnce()
    {
        bool drained = true;
        while (_retryQueue.TryDequeue(out var work))
        {
            if (!RunBounded(work, TimeSpan.FromSeconds(4), "WasapiStopGuard"))
            {
                drained = false;
                _retryQueue.Enqueue(work);
                break;
            }
        }
        return drained;
    }
}