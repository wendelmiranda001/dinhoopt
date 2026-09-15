using DiNho.Capture.Poc.Capture;
using System.Diagnostics;

namespace DiNho.Capture.Poc.Tests;

public sealed class WindowsMessagePumpTests
{
    // ═══════════════════════════════════════════════════════════════
    //  WindowsMessagePump — G2 (audit 5.4): timeout de Invoke não pode
    //  ser engolido silenciosamente (antes: WgcCaptureSource não-inicializado
    //  era atribuído ao _capture quando o pump morria).
    // ═══════════════════════════════════════════════════════════════

    [Fact]
    public void Invoke_RunsAction()
    {
        using var pump = new WindowsMessagePump();
        var ran = false;
        pump.Invoke(() => ran = true);
        Assert.True(ran);
    }

    [Fact]
    public void Invoke_RethrowsActionException()
    {
        using var pump = new WindowsMessagePump();
        var ex = Assert.Throws<AggregateException>(() =>
            pump.Invoke(() => throw new InvalidOperationException("boom")));
        Assert.IsType<InvalidOperationException>(ex.InnerException);
    }

    [Fact]
    public void Invoke_WhenActionBlocksPastTimeout_ThrowsInvalidOperation()
    {
        using var pump = new WindowsMessagePump();
        pump.InvokeTimeout = TimeSpan.FromMilliseconds(150);
        using var gate = new ManualResetEventSlim(false);

        var sw = Stopwatch.StartNew();
        Assert.Throws<InvalidOperationException>(() =>
            pump.Invoke(() => gate.Wait(10_000)));
        sw.Stop();

        // Deve lançar perto do timeout — NUNCA esperar a ação terminar (que é o que
        // acontecia antes: Wait(10s) retornava e Invoke "succeedia" silenciosamente).
        Assert.True(sw.ElapsedMilliseconds < 2_000,
            $"Invoke só lançou depois de {sw.ElapsedMilliseconds}ms");
    }

    [Fact]
    public void Invoke_AfterDispose_ThrowsObjectDisposed()
    {
        var pump = new WindowsMessagePump();
        pump.Dispose();
        Assert.Throws<ObjectDisposedException>(() => pump.Invoke(() => { }));
    }
}