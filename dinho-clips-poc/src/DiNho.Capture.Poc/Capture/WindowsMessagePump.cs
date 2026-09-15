using System;
using System.Collections.Concurrent;
using System.Threading;
using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Capture;

/// <summary>
/// Dedicated STA thread with a Windows message pump.
/// WGC FrameArrived needs a message pump on the thread that created the capture session
/// for the DWM to deliver frames. CreateFreeThreaded() alone is not sufficient on some
/// systems (e.g. RTX 5050 + FiveM).
/// </summary>
internal sealed class WindowsMessagePump : IDisposable
{
    private readonly Thread _thread;
    private readonly ConcurrentQueue<Action> _queue = new();
    private readonly ManualResetEventSlim _workAvailable = new(false);
    private readonly ManualResetEventSlim _ready = new(false);
    private volatile bool _disposed;

    // G2 (audit 5.4): timeout configurável (mutable para testes) — antes o timeout de
    // 10s era engolido silenciosamente pelo Done.Wait(); se o pump morresse (catch no
    // Run() sai do loop), Invokes subsequentes aguardavam 10s e retornavam como se tudo
    // estivesse OK, atribuindo um WgcCaptureSource NÃO inicializado ao _capture.
    internal TimeSpan InvokeTimeout { get; set; } = TimeSpan.FromSeconds(10);

    public WindowsMessagePump()
    {
        _thread = new Thread(Run)
        {
            IsBackground = true,
            Name = "WGC-MsgPump"
        };
        _thread.TrySetApartmentState(ApartmentState.STA);
        _thread.Start();
        _ready.Wait(TimeSpan.FromSeconds(5));
    }

    /// <summary>Marshal an action to the pump thread and wait for completion.</summary>
    public void Invoke(Action action)
    {
        if (_disposed) throw new ObjectDisposedException(nameof(WindowsMessagePump));
        var done = new ManualResetEventSlim(false);
        Exception? error = null;
        _queue.Enqueue(() =>
        {
            try { action(); }
            catch (Exception ex) { error = ex; }
            finally
            {
                // G2: done pode já ter sido disposed pelo timeout — ignora (evita crash do pump thread)
                try { done.Set(); }
                catch (ObjectDisposedException) { }
            }
        });
        _workAvailable.Set();
        var completed = done.Wait(InvokeTimeout);
        done.Dispose();
        // G2: se o pump morreu (Run() saiu do loop) ou a ação travou, o caller (coordinator)
        // depende de exceção para cair para o próximo backend de captura.
        if (!completed)
        {
            Log.E("WGC-Pump", $"Invoke timed out after {InvokeTimeout.TotalMilliseconds}ms — pump thread pode ter morrido ou a ação travou");
            throw new InvalidOperationException($"WindowsMessagePump.Invoke timed out after {InvokeTimeout.TotalMilliseconds}ms");
        }
        if (error != null)
            throw new AggregateException(error);
    }

    private void Run()
    {
        try
        {
            _ready.Set();
            int loopCount = 0;
            int msgCount = 0;

            while (!_disposed)
            {
                // Drain queued actions (Invoke calls from other threads)
                while (_queue.TryDequeue(out var action))
                    action();

                // Pump ALL pending Windows messages (DWM delivers FrameArrived via COM → PostMessage)
                while (PeekMessage(out var msg, IntPtr.Zero, 0, 0, PM_REMOVE))
                {
                    TranslateMessage(ref msg);
                    DispatchMessage(ref msg);
                    msgCount++;
                }

                loopCount++;
                if (loopCount % 500 == 0)
                    Log.D("WGC-Pump", $"Pump alive: loops={loopCount} msgs={msgCount} queueLen={_queue.Count}");

                // Wait ≤4ms: fast enough for 60fps (16.67ms/frame), minimal CPU waste.
                // Previous 100ms sleep caused ~6 frames lost per cycle because DWM
                // frame delivery via COM was stuck in the queue while pump slept.
                _workAvailable.Wait(TimeSpan.FromMilliseconds(4));
                _workAvailable.Reset();
            }

            Log.I("WGC-Pump", $"Pump exiting: loops={loopCount} msgs={msgCount}");
        }
        catch (Exception ex)
        {
            Log.E("WGC-Pump", $"Message pump crashed: {ex.GetType().Name}: {ex.Message}\n{ex.StackTrace}");
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _workAvailable.Set();
        _thread.Join(2000);
        _workAvailable.Dispose();
        _ready.Dispose();
    }

    private const uint PM_REMOVE = 0x0001;

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct POINT
    {
        public int x;
        public int y;
    }

    [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
    private static extern bool PeekMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG lpMsg);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG lpMsg);
}
