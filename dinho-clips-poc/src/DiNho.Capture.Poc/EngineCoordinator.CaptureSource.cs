using DiNho.Capture.Poc.Capture;
using DiNho.Capture.Poc.Logging;
using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Graphics.Dwm;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    private void SelectCaptureSource()
    {
        var game = _captureTargetGame;
        var gameHwnd = game.IsValid ? game.Hwnd : IntPtr.Zero;

        // Salva o HWND original para usar como fallback em reinit
        // (quando o jogo está minimizado, MainWindowHandle pode ser Zero)
        if (gameHwnd != IntPtr.Zero)
            _captureTargetHwnd = gameHwnd;

        // WDA check — jogos que usam WDA_EXCLUDEFROMCAPTURE não podem ser capturados via WGC per-window
        if (game.IsValid && gameHwnd != IntPtr.Zero && WdaHelper.IsExcludedFromCapture(gameHwnd))
        {
            Log.I("EngineCoordinator", $"Jogo '{game.ProcessName}' usa WDA_EXCLUDEFROMCAPTURE — pulando WGC per-window, usando desktop/Hybrid");
        }

        // 1) WGC per-window (melhor qualidade) — tenta até 3x com 400ms entre tentativas
        if (game.IsValid && gameHwnd != IntPtr.Zero && IsWindowValidForWgc(gameHwnd)
            && !WdaHelper.IsExcludedFromCapture(gameHwnd))
        {
            const int maxRetries = 3;
            const int retryDelayMs = 400;

            // Ensure we have a dedicated STA thread with message pump for WGC.
            // WGC FrameArrived needs a message pump for DWM to deliver frames.
            _wgcPump ??= new WindowsMessagePump();

            for (var attempt = 1; attempt <= maxRetries; attempt++)
                {
                    // Capture device reference locally — StopCapture() may dispose it during retry delay
                    var device = _sharedDevice;
                    if (device == null || !_captureActive)
                    {
                        Log.W("EngineCoordinator", $"WGC retry aborted: device={device != null} active={_captureActive}");
                        break;
                    }
                    WgcCaptureSource? wgc = null;
                    try
                    {
                        wgc = new WgcCaptureSource();
                        // Marshal Initialize + StartFramePump to the pump thread.
                        // This ensures the WGC capture session is created on an STA thread
                        // with a message pump, which is required for FrameArrived to fire.
                        _wgcPump.Invoke(() =>
                        {
                            wgc.Initialize(device, gameHwnd);
                            wgc.SetCaptureFrameRate(_config.Config.Fps);
                            wgc.StartFramePump();
                        });
                        _capture = wgc;
                        _status.Update(s => s.CaptureBackend = $"WGC:{game.ProcessName}");
                        Log.I("EngineCoordinator", $"Captura: janela '{game.ProcessName}' ({gameHwnd})");
                        goto multiMonitor;
                    }
                    catch (Exception ex) when (attempt < maxRetries)
                    {
                        wgc.Dispose();
                        var innerMsg = ex.InnerException != null ? $" → {ex.InnerException.GetType().Name}: {ex.InnerException.Message}" : "";
                        Log.E("EngineCoordinator", $"WGC window tentativa {attempt}/{maxRetries} falhou: {ex.Message}{innerMsg}, retry em {retryDelayMs}ms...");
                        // Release lock during delay to avoid starving StopCapture, but re-check device on resume
                        bool heldLock = Monitor.IsEntered(_pipelineLock);
                        if (heldLock) Monitor.Exit(_pipelineLock);
                        try { WaitAbortable(retryDelayMs, () => _captureActive); }
                        finally { if (heldLock) Monitor.Enter(_pipelineLock); }
                    }
                    catch (Exception ex)
                    {
                        wgc.Dispose();
                        var innerMsg = ex.InnerException != null ? $" → {ex.InnerException.GetType().Name}: {ex.InnerException.Message}" : "";
                        Log.E("EngineCoordinator", $"WGC window tentativa {maxRetries}/{maxRetries} falhou: {ex.Message}{innerMsg}, fallback...");
                    }
                }
        }

        // 2) WGC desktop (full monitor via DWM) — funciona para qualquer janela
        //    No multi-monitor, captura o monitor onde o jogo está
        WgcCaptureSource? wgcDesktop = null;
        try
        {
            var gameMonitor = gameHwnd != IntPtr.Zero
                ? MonitorHelper.GetMonitorFromWindowHandle(gameHwnd)
                : IntPtr.Zero;

            _wgcPump ??= new WindowsMessagePump();

            wgcDesktop = new WgcCaptureSource();
            _wgcPump.Invoke(() =>
            {
                wgcDesktop.Initialize(_sharedDevice, IntPtr.Zero, gameMonitor);
                wgcDesktop.SetCaptureFrameRate(_config.Config.Fps);
                wgcDesktop.StartFramePump();
            });
            _capture = wgcDesktop;
            _status.Update(s => s.CaptureBackend = "WGC");
            Log.I("EngineCoordinator", "Captura: Windows Graphics Capture (desktop)");
            goto multiMonitor;
        }
        catch (Exception wgcEx)
        {
            wgcDesktop?.Dispose();
            var innerMsg = wgcEx.InnerException != null ? $" → {wgcEx.InnerException.GetType().Name}: {wgcEx.InnerException.Message}" : "";
            Log.E("EngineCoordinator", $"WGC desktop falhou: {wgcEx.GetType().Name}: {wgcEx.Message}{innerMsg}");
        }

        // 3) DXGI Desktop Duplication (full monitor, funciona sempre)
        try
        {
            var dxgi = new DxgiCaptureSource();
            dxgi.Initialize(_sharedDevice, gameHwnd);
            _capture = dxgi;
            _status.Update(s => s.CaptureBackend = "DXGI");
            Log.I("EngineCoordinator", "Captura: DXGI Desktop Duplication");
            goto multiMonitor;
        }
        catch (Exception dxgiEx)
        {
            Log.E("EngineCoordinator", $"DXGI falhou: {dxgiEx.GetType().Name}: {dxgiEx.Message}");
        }

        // 4) Hybrid (DXGI + PrintWindow) — fallback para janela em background
        try
        {
            var hybrid = new HybridCaptureSource();
            hybrid.Initialize(_sharedDevice, gameHwnd);
            _capture = hybrid;
            _status.Update(s => s.CaptureBackend = _capture.Name);
            Log.I("EngineCoordinator", $"Captura híbrida: HWND=0x{gameHwnd:X8}");
            goto multiMonitor;
        }
        catch (Exception hybridEx)
        {
            Log.E("EngineCoordinator", $"Hybrid falhou: {hybridEx.GetType().Name}: {hybridEx.Message}");
        }

        multiMonitor:
        // Detecta configuração multi-monitor
        var monitorCount = MonitorHelper.GetMonitorCount();
        if (monitorCount > 1 && game.IsValid)
        {
            var gameMonitor = MonitorHelper.GetMonitorFromWindow(game.Hwnd);
            Log.I("EngineCoordinator", $"Multi-monitor: {monitorCount} telas, jogo no monitor {gameMonitor}");
        }
    }

    private async Task SelectCaptureSourceAsync()
    {
        var game = _captureTargetGame;
        var gameHwnd = game.IsValid ? game.Hwnd : IntPtr.Zero;

        // Save hwnd fallback
        if (gameHwnd != IntPtr.Zero)
            _captureTargetHwnd = gameHwnd;

        // WDA exclusion check
        if (game.IsValid && gameHwnd != IntPtr.Zero && WdaHelper.IsExcludedFromCapture(gameHwnd))
        {
            Log.I("EngineCoordinator", $"Jogo '{game.ProcessName}' usa WDA_EXCLUDEFROMCAPTURE — pulando WGC per-window, usando desktop/Hybrid");
        }

        // 1) WGC per-window (best) — async retries with delay, do not block pipeline lock
        
        if (game.IsValid && gameHwnd != IntPtr.Zero && IsWindowValidForWgc(gameHwnd)
            && !WdaHelper.IsExcludedFromCapture(gameHwnd))
        {
            const int maxRetries = 3;
            const int retryDelayMs = 400;

            // Ensure pump exists
            _wgcPump ??= new WindowsMessagePump();

            for (var attempt = 1; attempt <= maxRetries; attempt++)
            {
                // Capture device reference locally — StopCapture() may dispose it during retry delay
                var device = _sharedDevice;
                if (device == null || !_captureActive)
                {
                    Log.W("EngineCoordinator", $"WGC retry aborted: device={device != null} active={_captureActive}");
                    break;
                }
                WgcCaptureSource? wgc = null;
                try
                {
                    wgc = new WgcCaptureSource();
                    // Marshal Initialize + StartFramePump to the pump thread.
                    _wgcPump.Invoke(() =>
                    {
                        wgc.Initialize(device, gameHwnd);
                        wgc.SetCaptureFrameRate(_config.Config.Fps);
                        wgc.StartFramePump();
                    });
                    _capture = wgc;
                    _status.Update(s => s.CaptureBackend = $"WGC:{game.ProcessName}");
                    Log.I("EngineCoordinator", $"Captura: janela '{game.ProcessName}' ({gameHwnd})");
                    return;
                }
                catch (Exception ex)
                {
                    wgc.Dispose();
                    var inner = ex.InnerException != null ? $" → {ex.InnerException.GetType().Name}: {ex.InnerException.Message}" : "";
                    if (attempt < maxRetries)
                    {
                        Log.W("EngineCoordinator", $"WGC per-window tentativa {attempt}/{maxRetries} falhou: {ex.Message}{inner} — retry em {retryDelayMs}ms (async)");
                        await WaitAbortableAsync(retryDelayMs, () => _captureActive, ct: _pipelineCts?.Token ?? CancellationToken.None);
                        continue;
                    }
                    else
                    {
                        Log.E("EngineCoordinator", $"WGC per-window tentativa {attempt}/{maxRetries} falhou: {ex.Message}{inner} — fallback");
                    }
                }
            }
        }

        // 2) WGC desktop (monitor)
        WgcCaptureSource? wgcDesktop = null;
        try
        {
            var gameMonitor = gameHwnd != IntPtr.Zero ? MonitorHelper.GetMonitorFromWindowHandle(gameHwnd) : IntPtr.Zero;
            _wgcPump ??= new WindowsMessagePump();
            wgcDesktop = new WgcCaptureSource();
            _wgcPump.Invoke(() =>
            {
                wgcDesktop.Initialize(_sharedDevice, IntPtr.Zero, gameMonitor);
                wgcDesktop.SetCaptureFrameRate(_config.Config.Fps);
                wgcDesktop.StartFramePump();
            });
            _capture = wgcDesktop;
            _status.Update(s => s.CaptureBackend = "WGC");
            Log.I("EngineCoordinator", "Captura: Windows Graphics Capture (desktop)");
            return;
        }
        catch (Exception wgcEx)
        {
            wgcDesktop?.Dispose();
            var inner = wgcEx.InnerException != null ? $" → {wgcEx.InnerException.GetType().Name}: {wgcEx.InnerException.Message}" : "";
            Log.E("EngineCoordinator", $"WGC desktop falhou: {wgcEx.GetType().Name}: {wgcEx.Message}{inner}");
        }

        // 3) DXGI Desktop Duplication (full monitor)
        try
        {
            var dxgi = new DxgiCaptureSource();
            dxgi.Initialize(_sharedDevice, gameHwnd);
            _capture = dxgi;
            _status.Update(s => s.CaptureBackend = "DXGI");
            Log.I("EngineCoordinator", "Captura: DXGI Desktop Duplication");
            return;
        }
        catch (Exception dxgiEx)
        {
            Log.E("EngineCoordinator", $"DXGI falhou: {dxgiEx.GetType().Name}: {dxgiEx.Message}");
        }

        // 4) Hybrid fallback
        try
        {
            var hybrid = new HybridCaptureSource();
            hybrid.Initialize(_sharedDevice, gameHwnd);
            _capture = hybrid;
            _status.Update(s => s.CaptureBackend = _capture.Name);
            Log.I("EngineCoordinator", $"Captura híbrida: HWND=0x{gameHwnd:X8}");
            return;
        }
        catch (Exception hybridEx)
        {
            Log.E("EngineCoordinator", $"Hybrid falhou: {hybridEx.GetType().Name}: {hybridEx.Message}");
        }

        // If all fail, leave _capture null and caller handles cleanup.
    }

    private AvRevertMmThreadCharacteristicsSafeHandle? _mmThreadHandle;

    private void SetMmThreadPriority()
    {
        uint index = 0;
        var ret = PInvoke.AvSetMmThreadCharacteristics("Capture", ref index);
        if (ret.IsInvalid)
            Log.D("EngineCoordinator", $"AvSetMmThreadCharacteristics('Capture') failed: {Marshal.GetLastWin32Error()}");
        else
            _mmThreadHandle = ret;
    }

    private void RevertMmThreadPriority()
    {
        if (_mmThreadHandle is { IsInvalid: false })
        {
            _mmThreadHandle.Dispose();
            _mmThreadHandle = null;
        }
    }

    // Espera abortável em fatias — retorna true quando o tempo total expira,
    // false se a condição falhar antes (ex.: StopCapture() durante o retry).
    // Slice em vez de Sleep único permite abortar rápido sem depender de Timer.
    internal static bool WaitAbortable(int totalMs, Func<bool> continueCondition, int sliceMs = 50)
    {
        if (totalMs <= 0) return true;
        if (sliceMs <= 0) sliceMs = 1;
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (true)
        {
            if (!continueCondition())
                return false;
            var remaining = totalMs - (int)sw.ElapsedMilliseconds;
            if (remaining <= 0)
                return true;
            Thread.Sleep(Math.Min(remaining, sliceMs));
        }
    }

    // Versão async com CancellationToken — equivalente ao WaitAbortable.
    internal static async Task WaitAbortableAsync(int totalMs, Func<bool> continueCondition, int sliceMs = 50, CancellationToken ct = default)
    {
        if (totalMs <= 0) return;
        if (sliceMs <= 0) sliceMs = 1;
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (true)
        {
            if (!continueCondition())
                return;
            var remaining = totalMs - (int)sw.ElapsedMilliseconds;
            if (remaining <= 0)
                return;
            await Task.Delay(Math.Min(remaining, sliceMs), ct);
        }
    }
}
