using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Windows.Win32;
using Windows.Win32.Graphics.Dwm;
using Windows.Win32.Foundation;
using RECT = Windows.Win32.Foundation.RECT;

namespace DiNho.Capture.Poc.Capture;

public sealed class HybridCaptureSource : ICaptureSource
{
    public string Name => _currentMode == CaptureMode.Dxgi
        ? _dxgi?.Name ?? "DXGI"
        : "PrintWindow";
    public int Width => _fullWidth;
    public int Height => _fullHeight;
    public ID3D11Device? Device => _sharedDevice;

    private enum CaptureMode { Dxgi, PrintWindow }

    // Internal sources
    private DxgiCaptureSource? _dxgi;
    private PrintWindowCaptureSource? _printWindow;

    private ID3D11Device? _sharedDevice;
    private ID3D11DeviceContext? _context;
    private bool _ownsDevice;
    private IntPtr _targetHwnd;

    // Monitor dimensions (full frame size, constant after init)
    private int _fullWidth;
    private int _fullHeight;

    // Current mode
    private CaptureMode _currentMode = CaptureMode.Dxgi;
    private DateTime _nextModeCheck = DateTime.MinValue;

    // Transition: keep last frame from previous mode to avoid black frames
    private CaptureMode _lastActiveMode = CaptureMode.Dxgi;
    private ID3D11Texture2D? _transitionFrame;
    private long _transitionFrameTicks;

    // Staleness threshold: beyond this age the frozen transition frame is no
    // longer "good" — returning it forever hides a dead capture path (1.5).
    private static readonly long TransitionFrameMaxAgeTicks =
        TimeSpan.FromSeconds(5).Ticks * Stopwatch.Frequency / TimeSpan.TicksPerSecond;

    // Window rect cache (relative to monitor, used for PrintWindow compositing)
    private int _winX, _winY, _winW, _winH;

    // Compositing resources
    private byte[]? _compositeBuffer;
    private ID3D11Texture2D? _compositeTexture;

    public void Initialize(ID3D11Device? sharedDevice = null) =>
        Initialize(sharedDevice, IntPtr.Zero);

    public void Initialize(ID3D11Device? sharedDevice, IntPtr targetHwnd)
    {
        _targetHwnd = targetHwnd;

        if (sharedDevice != null)
        {
            _sharedDevice = sharedDevice;
            _context = _sharedDevice.ImmediateContext;
            _ownsDevice = false;
        }
        else
        {
            var flags = DeviceCreationFlags.BgraSupport;
            var result = D3D11.D3D11CreateDevice(
                null, DriverType.Hardware, flags,
                [FeatureLevel.Level_11_1, FeatureLevel.Level_11_0],
                out _sharedDevice, out _, out _context);
            if (result.Failure || _sharedDevice is null || _context is null)
                throw new InvalidOperationException($"Falha ao criar D3D11 device: {result}");
            _ownsDevice = true;
        }

        // 1. Initialize DXGI source (always required — gives monitor dimensions)
        _dxgi = new DxgiCaptureSource();
        _dxgi.Initialize(_sharedDevice, targetHwnd);
        _fullWidth = _dxgi.Width;
        _fullHeight = _dxgi.Height;

        if (_fullWidth <= 0 || _fullHeight <= 0)
            throw new InvalidOperationException("DXGI não retornou dimensões de monitor válidas.");

        // 2. Initialize PrintWindow source (only if we have a valid HWND)
        if (targetHwnd != IntPtr.Zero)
        {
            try
            {
                _printWindow = new PrintWindowCaptureSource(targetFps: 10);
                _printWindow.Initialize(_sharedDevice, targetHwnd);
            }
            catch (Exception ex)
            {
                Log.W("Hybrid", $"PrintWindow init falhou: {ex.Message}");
                _printWindow = null;
            }
        }

        // Create composite output texture (full monitor size)
        AllocateCompositeTexture(_fullWidth, _fullHeight);

        // Choose initial mode
        _currentMode = PickDesiredMode();

        Log.I("Hybrid", $"Inicializado: DXGI({_fullWidth}x{_fullHeight}) + " +
            $"PrintWindow={(_printWindow != null ? "ok" : "n/a")} " +
            $"modo={_currentMode}");
    }

    public CapturedFrame TryCaptureFrame(int timeoutMs)
    {
        var startTicks = Stopwatch.GetTimestamp();

        // Periodic mode check (~2s)
        if (DateTime.UtcNow >= _nextModeCheck)
        {
            _nextModeCheck = DateTime.UtcNow.AddSeconds(2);
            var desired = PickDesiredMode();
            if (desired != _currentMode)
            {
                SwitchMode(desired);
            }
        }

        // Delegate to active internal source
        CapturedFrame? frame = null;
        if (_currentMode == CaptureMode.Dxgi)
        {
            frame = CaptureViaDxgi(startTicks);
        }
        else
        {
            frame = CaptureViaPrintWindow(startTicks, timeoutMs);
        }

        if (frame != null)
            return frame;

        // Fallback: return transition frame (last good frame from previous mode)
        // Only while it is fresh — a stale frozen frame hides a dead capture path.
        if (_transitionFrame != null &&
            Stopwatch.GetTimestamp() - _transitionFrameTicks <= TransitionFrameMaxAgeTicks)
        {
            var desc = _transitionFrame.Description;
            var clone = _sharedDevice!.CreateTexture2D(desc);
            _context!.CopyResource(clone, _transitionFrame);
            return new CapturedFrame(startTicks, Stopwatch.GetTimestamp(),
                _fullWidth, _fullHeight, true, clone, _sharedDevice,
                Stopwatch.GetTimestamp(), Stopwatch.GetTimestamp());
        }

        // Emergency fallback: try DXGI directly
        return CaptureViaDxgi(startTicks) ??
            new CapturedFrame(startTicks, Stopwatch.GetTimestamp(), 0, 0, false);
    }

    private CapturedFrame? CaptureViaDxgi(long startTicks)
    {
        if (_dxgi == null) return null;

        var dxgiFrame = _dxgi.TryCaptureFrame(16);
        if (!dxgiFrame.Success || dxgiFrame.Texture == null)
        {
            dxgiFrame.Dispose();
            return null;
        }

        // Check dimension match (DXGI should always match)
        if (dxgiFrame.Width != _fullWidth || dxgiFrame.Height != _fullHeight)
        {
            // DXGI returned wrong size — fallback
            dxgiFrame.Dispose();
            return null;
        }

        return dxgiFrame;
    }

    private CapturedFrame? CaptureViaPrintWindow(long startTicks, int timeoutMs)
    {
        if (_printWindow == null || _dxgi == null)
            return null;

        var pwFrame = _printWindow.TryCaptureFrame(timeoutMs);
        if (!pwFrame.Success || pwFrame.Texture == null)
        {
            pwFrame?.Dispose();
            return null;
        }

        var copyEndTicks = Stopwatch.GetTimestamp();

        try
        {
            // Get window position relative to monitor
            UpdateWindowRect();

            int winW = pwFrame.Width;
            int winH = pwFrame.Height;

            // Clamp window rect to valid range
            int relX = Clamp(_winX, 0, _fullWidth - 1);
            int relY = Clamp(_winY, 0, _fullHeight - 1);
            int clampedW = Math.Min(winW, _fullWidth - relX);
            int clampedH = Math.Min(winH, _fullHeight - relY);

            if (clampedW <= 0 || clampedH <= 0)
            {
                pwFrame.Dispose();
                return null;
            }

            // Read PrintWindow texture to CPU via staging
            var staging = CreateStagingForTexture(pwFrame.Texture);
            _context!.CopyResource(staging, pwFrame.Texture);
            var mapped = _context.Map(staging, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None);

            try
            {
                // Allocate/resize composite buffer
                int fullStride = _fullWidth * 4;
                int bufSize = fullStride * _fullHeight;
                if (_compositeBuffer == null || _compositeBuffer.Length != bufSize)
                    _compositeBuffer = new byte[bufSize];

                // Clear buffer to black
                Array.Clear(_compositeBuffer, 0, bufSize);

                // Copy window pixels into position (handling pitch alignment)
                int srcRowPitch = (int)mapped.RowPitch;
                int winStride = winW * 4;
                for (int y = 0; y < clampedH; y++)
                {
                    int dstY = relY + y;
                    if (dstY < 0 || dstY >= _fullHeight) continue;
                    int dstOffset = dstY * fullStride + relX * 4;
                    int srcOffset = y * srcRowPitch;
                    Marshal.Copy(mapped.DataPointer + srcOffset,
                        _compositeBuffer, dstOffset, winStride);
                }

                // Upload composite buffer to GPU
                var gcHandle = GCHandle.Alloc(_compositeBuffer, GCHandleType.Pinned);
                try
                {
                    _context.UpdateSubresource(_compositeTexture!, 0u, null,
                        gcHandle.AddrOfPinnedObject(), (uint)fullStride, 0u);
                }
                finally
                {
                    gcHandle.Free();
                }

                // Clone for output
                var desc = _compositeTexture!.Description;
                var output = _sharedDevice!.CreateTexture2D(desc);
                _context.CopyResource(output, _compositeTexture);

                copyEndTicks = Stopwatch.GetTimestamp();
                return new CapturedFrame(startTicks, copyEndTicks,
                    _fullWidth, _fullHeight, true, output, _sharedDevice,
                    copyEndTicks, copyEndTicks);
            }
            finally
            {
                _context.Unmap(staging, 0);
                staging.Dispose();
            }
        }
        finally
        {
            pwFrame.Dispose();
        }
    }

    private CaptureMode PickDesiredMode()
    {
        // No target → always use DXGI
        if (_targetHwnd == IntPtr.Zero)
            return CaptureMode.Dxgi;

        // Check window state
        bool isMinimized = PrintWindowCaptureSource.IsWindowMinimized(_targetHwnd);
        bool isForeground = PrintWindowCaptureSource.IsWindowForeground(_targetHwnd);

        // DXGI preferred when foreground and not minimized
        if (isForeground && !isMinimized)
            return CaptureMode.Dxgi;

        // PrintWindow for background/minimized (if available)
        if (_printWindow != null)
            return CaptureMode.PrintWindow;

        // Fallback to DXGI if PrintWindow unavailable
        return CaptureMode.Dxgi;
    }

    private void SwitchMode(CaptureMode newMode)
    {
        if (newMode == _currentMode) return;

        // Save transition frame from current mode before switching
        SaveTransitionFrame();

        var oldMode = _currentMode;
        _currentMode = newMode;
        _lastActiveMode = oldMode;

        Log.I("Hybrid", $"Modo: {oldMode} → {newMode}");
    }

    private void SaveTransitionFrame()
    {
        _transitionFrame?.Dispose();
        _transitionFrame = null;

        // Capture one last frame from current mode for smooth transition
        if (_currentMode == CaptureMode.Dxgi && _dxgi != null)
        {
            var frame = _dxgi.TryCaptureFrame(16);
            if (frame.Success && frame.Texture != null)
            {
                var desc = frame.Texture.Description;
                _transitionFrame = _sharedDevice!.CreateTexture2D(desc);
                _context!.CopyResource(_transitionFrame, frame.Texture);
                _transitionFrameTicks = Stopwatch.GetTimestamp();
            }
            frame.Dispose();
        }
    }

    private unsafe void UpdateWindowRect()
    {
        if (_targetHwnd == IntPtr.Zero) return;

        // Get window bounds (DWM extended frame bounds, excludes shadow)
        var rect = new RECT();
        int hr = PInvoke.DwmGetWindowAttribute(
            (HWND)_targetHwnd,
            DWMWINDOWATTRIBUTE.DWMWA_EXTENDED_FRAME_BOUNDS,
            &rect,
            (uint)sizeof(RECT));

        if (hr != 0 || rect.right <= rect.left || rect.bottom <= rect.top)
        {
            // Fallback: GetWindowRect
            if (!PInvoke.GetWindowRect((HWND)_targetHwnd, out rect))
                return;
        }

        // Get monitor origin
        var hMon = MonitorHelper.GetMonitorFromWindowHandle(_targetHwnd);
        var (mLeft, mTop, _, _) = MonitorHelper.GetMonitorRect(hMon);

        _winX = rect.left - mLeft;
        _winY = rect.top - mTop;
        _winW = rect.right - rect.left;
        _winH = rect.bottom - rect.top;
    }

    private void AllocateCompositeTexture(int width, int height)
    {
        _compositeTexture?.Dispose();
        _compositeTexture = _sharedDevice!.CreateTexture2D(new Texture2DDescription
        {
            Width = (uint)width,
            Height = (uint)height,
            MipLevels = 1,
            ArraySize = 1,
            Format = Format.B8G8R8A8_UNorm,
            SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Default,
            BindFlags = BindFlags.None,
            CPUAccessFlags = CpuAccessFlags.None,
        });
    }

    private static ID3D11Texture2D CreateStagingForTexture(ID3D11Texture2D source)
    {
        var desc = source.Description;
        desc.Usage = ResourceUsage.Staging;
        desc.CPUAccessFlags = CpuAccessFlags.Read;
        desc.BindFlags = BindFlags.None;
        return source.Device!.CreateTexture2D(desc);
    }

    private static int Clamp(int value, int min, int max) =>
        value < min ? min : value > max ? max : value;

    public bool CheckDeviceLost() =>
        _dxgi?.CheckDeviceLost() ?? _sharedDevice?.DeviceRemovedReason is { Failure: true };

    public void Dispose()
    {
        _transitionFrame?.Dispose();
        _compositeTexture?.Dispose();
        _printWindow?.Dispose();
        _dxgi?.Dispose();
        if (_ownsDevice)
        {
            _context?.Dispose();
            _sharedDevice?.Dispose();
        }
    }

    // DwmGetWindowAttribute and GetWindowRect — generated by CsWin32 (NativeMethods.txt)
}
