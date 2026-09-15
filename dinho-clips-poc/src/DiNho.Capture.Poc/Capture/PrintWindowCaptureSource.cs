using System.Diagnostics;
using System.Runtime.InteropServices;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Graphics.Gdi;
using Windows.Win32.Storage.Xps;
using Windows.Win32.UI.WindowsAndMessaging;

namespace DiNho.Capture.Poc.Capture;

public sealed class PrintWindowCaptureSource : ICaptureSource
{
    public string Name => "PrintWindow";
    public int Width => _windowWidth;
    public int Height => _windowHeight;
    public ID3D11Device? Device => _device;

    /// <summary>
    /// G2: dimensão de captura SEMPRE par (NV12/NVENC exigem W/H par).
    /// 0 ou 1 → 0 (degenerado → branch de área-zero, evita fake "success" 1×1 que
    /// antes alocava textura ímpar e contava como frame bom no watchdog).
    /// 2+ → arredonda para baixo ao par (2→2, 3→2, 4→4…).
    /// </summary>
    internal static int ToEvenCaptureDimension(int value) => value <= 1 ? 0 : value & ~1;

    private ID3D11Device? _device;
    private ID3D11DeviceContext? _context;
    private bool _ownsDevice;
    private IntPtr _targetHwnd;

    private int _windowWidth;
    private int _windowHeight;
    private ID3D11Texture2D? _cachedTexture;
    private long _lastCaptureTicks;
    private readonly long _minFrameIntervalTicks;

    // Staging texture for CPU→GPU upload
    private ID3D11Texture2D? _stagingTexture;
    private int _stagingWidth;
    private int _stagingHeight;

    public PrintWindowCaptureSource(int targetFps = 10)
    {
        _minFrameIntervalTicks = Stopwatch.Frequency / Math.Clamp(targetFps, 1, 60);
    }

    public void Initialize(ID3D11Device? sharedDevice = null)
    {
        throw new NotSupportedException(
            "PrintWindowCaptureSource requires an HWND. Use Initialize(sharedDevice, hwnd) instead.");
    }

    public void Initialize(ID3D11Device? sharedDevice, IntPtr targetHwnd)
    {
        _targetHwnd = targetHwnd;

        if (sharedDevice != null)
        {
            _device = sharedDevice;
            _context = _device.ImmediateContext;
            _ownsDevice = false;
        }
        else
        {
            var flags = DeviceCreationFlags.BgraSupport;
            var result = D3D11.D3D11CreateDevice(
                null, DriverType.Hardware, flags,
                [FeatureLevel.Level_11_1, FeatureLevel.Level_11_0],
                out _device, out _, out _context);
            if (result.Failure || _device is null || _context is null)
                throw new InvalidOperationException($"Falha ao criar D3D11 device para PrintWindow: {result}");
            _ownsDevice = true;
        }

        RefreshWindowDimensions();
        if (_windowWidth > 0 && _windowHeight > 0)
            AllocateTextures(_windowWidth, _windowHeight);
    }

    public CapturedFrame TryCaptureFrame(int timeoutMs)
    {
        var startTicks = Stopwatch.GetTimestamp();

        // Throttle to configured fps
        var now = Stopwatch.GetTimestamp();
        if (now - _lastCaptureTicks < _minFrameIntervalTicks)
        {
            // Return cached frame if available
            if (_cachedTexture != null)
            {
                var desc = _cachedTexture.Description;
                var clone = _device!.CreateTexture2D(desc);
                _context!.CopyResource(clone, _cachedTexture);
                // G2: dims reais da textura (não _windowWidth/Height stale) — mesmo princípio do WGC
                return new CapturedFrame(startTicks, now, (int)desc.Width, (int)desc.Height,
                    success: true, clone, _device, now, now);
            }
            return new CapturedFrame(startTicks, now, 0, 0, success: false);
        }

        // Window still valid?
        if (!PInvoke.IsWindow((HWND)_targetHwnd))
            return new CapturedFrame(startTicks, Stopwatch.GetTimestamp(), 0, 0, success: false);

        // Check for dimension change
        var oldW = _windowWidth;
        var oldH = _windowHeight;
        RefreshWindowDimensions();
        bool sizeChanged = _windowWidth != oldW || _windowHeight != oldH;
        if (sizeChanged && _windowWidth > 0 && _windowHeight > 0)
            AllocateTextures(_windowWidth, _windowHeight);

        var waitEndTicks = Stopwatch.GetTimestamp();

        // If window has zero area (minimized during capture), keep cached
        if (_windowWidth <= 0 || _windowHeight <= 0)
        {
            if (_cachedTexture != null)
            {
                var desc = _cachedTexture.Description;
                var clone = _device!.CreateTexture2D(desc);
                _context!.CopyResource(clone, _cachedTexture);
                // G2: dims reais da textura — antes reportava success:true com dims 0x0
                // (mesma classe de bug do stall invisível ao watchdog)
                return new CapturedFrame(startTicks, waitEndTicks, (int)desc.Width, (int)desc.Height,
                    success: true, clone, _device, waitEndTicks, Stopwatch.GetTimestamp());
            }
            return new CapturedFrame(startTicks, waitEndTicks, 0, 0, success: false);
        }

        // Capture via PrintWindow
        var capResult = CaptureBitmap();
        if (capResult == null || capResult.Length == 0)
        {
            // PrintWindow returned blank — use cached
            if (_cachedTexture != null)
            {
                var desc = _cachedTexture.Description;
                var clone = _device!.CreateTexture2D(desc);
                _context!.CopyResource(clone, _cachedTexture);
                return new CapturedFrame(startTicks, waitEndTicks, (int)desc.Width, (int)desc.Height,
                    success: true, clone, _device, waitEndTicks, Stopwatch.GetTimestamp());
            }
            return new CapturedFrame(startTicks, waitEndTicks, 0, 0, success: false);
        }

        _lastCaptureTicks = now;

        try
        {
            // Upload bitmap data to staging texture
            if (_stagingTexture == null)
                return new CapturedFrame(startTicks, waitEndTicks, 0, 0, success: false);

            var mapped = _context!.Map(_stagingTexture, 0, MapMode.Write, Vortice.Direct3D11.MapFlags.None);
            try
            {
                int srcRowPitch = _windowWidth * 4;
                int dstRowPitch = (int)mapped.RowPitch;

                // Copy row-by-row handling pitch differences
                for (int y = 0; y < _windowHeight; y++)
                {
                    Marshal.Copy(capResult, y * srcRowPitch,
                        mapped.DataPointer + y * dstRowPitch, srcRowPitch);
                }
            }
            finally
            {
                _context.Unmap(_stagingTexture, 0);
            }

            // Copy staging → device cache texture
            _context.CopyResource(_cachedTexture!, _stagingTexture);

            // Clone for output
            var desc = _cachedTexture!.Description;
            var clone2 = _device!.CreateTexture2D(desc);
            _context.CopyResource(clone2, _cachedTexture);

            var copyEndTicks = Stopwatch.GetTimestamp();
            return new CapturedFrame(startTicks, copyEndTicks, _windowWidth, _windowHeight,
                success: true, clone2, _device, waitEndTicks, copyEndTicks);
        }
        catch
        {
            return new CapturedFrame(startTicks, waitEndTicks, 0, 0, success: false);
        }
    }

    private unsafe byte[]? CaptureBitmap()
    {
        if (_windowWidth <= 0 || _windowHeight <= 0)
            return null;

        var hdcScreen = PInvoke.GetDC(default);
        if (hdcScreen.Value == null)
            return null;

        var hdcMem = PInvoke.CreateCompatibleDC(hdcScreen);
        var hBitmap = PInvoke.CreateCompatibleBitmap(hdcScreen, _windowWidth, _windowHeight);
        if (hBitmap.Value == null)
        {
            PInvoke.DeleteDC(hdcMem);
            PInvoke.ReleaseDC(default, hdcScreen);
            return null;
        }

        var hOld = PInvoke.SelectObject(hdcMem, new HGDIOBJ((IntPtr)hBitmap.Value));

        try
        {
            bool printed = PInvoke.PrintWindow((HWND)_targetHwnd, hdcMem, (PRINT_WINDOW_FLAGS)0x80000000u);
            if (!printed)
                return null;

            // Extract pixel data via GetDIBits
            int rowPitch = _windowWidth * 4;
            int pixelSize = rowPitch * _windowHeight;
            var buffer = new byte[pixelSize];
            var gcHandle = GCHandle.Alloc(buffer, GCHandleType.Pinned);

            try
            {
                unsafe
                {
                    var bmi = new BITMAPINFO
                    {
                        bmiHeader = new BITMAPINFOHEADER
                        {
                            biSize = (uint)sizeof(BITMAPINFOHEADER),
                            biWidth = _windowWidth,
                            biHeight = -_windowHeight, // top-down
                            biPlanes = 1,
                            biBitCount = 32,
                            biCompression = 0, // BI_RGB
                            biSizeImage = (uint)pixelSize,
                        }
                    };

                    int lines = RawGetDIBits((IntPtr)hdcMem.Value, (IntPtr)hBitmap.Value, 0, (uint)_windowHeight,
                        (void*)gcHandle.AddrOfPinnedObject(), &bmi, 0);
                    if (lines == 0)
                        return null;
                }
            }
            finally
            {
                gcHandle.Free();
            }

            return buffer;
        }
        finally
        {
            PInvoke.SelectObject(hdcMem, hOld);
            PInvoke.DeleteObject(new HGDIOBJ((IntPtr)hBitmap.Value));
            PInvoke.DeleteDC(hdcMem);
            PInvoke.ReleaseDC(default, hdcScreen);
        }
    }

    private void RefreshWindowDimensions()
    {
        if (!PInvoke.IsWindow((HWND)_targetHwnd))
        {
            _windowWidth = 0;
            _windowHeight = 0;
            return;
        }

        if (PInvoke.IsIconic((HWND)_targetHwnd))
        {
            // Minimized: use normal-position dimensions from WINDOWPLACEMENT
            var placement = new WINDOWPLACEMENT();
            placement.length = (uint)Marshal.SizeOf<WINDOWPLACEMENT>();
            if (PInvoke.GetWindowPlacement((HWND)_targetHwnd, ref placement))
            {
                var rc = placement.rcNormalPosition;
                int w = rc.right - rc.left;
                int h = rc.bottom - rc.top;
                _windowWidth = ToEvenCaptureDimension(w);
                _windowHeight = ToEvenCaptureDimension(h);
                return;
            }
            // G2: janela minimizada mas placement não disponível — não guardar dims stale
            _windowWidth = 0;
            _windowHeight = 0;
        }

        var rect = new RECT();
        if (!PInvoke.GetClientRect((HWND)_targetHwnd, out rect))
        {
            _windowWidth = 0;
            _windowHeight = 0;
            return;
        }

        // G2: always even (NV12/NVENC); 0 → zero-area (cached/failure branch)
        _windowWidth = ToEvenCaptureDimension(rect.right);
        _windowHeight = ToEvenCaptureDimension(rect.bottom);
    }

    private void AllocateTextures(int width, int height)
    {
        _cachedTexture?.Dispose();
        _stagingTexture?.Dispose();

        var desc = new Texture2DDescription
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
        };

        _cachedTexture = _device!.CreateTexture2D(desc);

        var stagingDesc = new Texture2DDescription
        {
            Width = (uint)width,
            Height = (uint)height,
            MipLevels = 1,
            ArraySize = 1,
            Format = Format.B8G8R8A8_UNorm,
            SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Staging,
            CPUAccessFlags = CpuAccessFlags.Write,
        };
        _stagingTexture = _device!.CreateTexture2D(stagingDesc);

        _stagingWidth = width;
        _stagingHeight = height;
    }

    public bool CheckDeviceLost() => _device?.DeviceRemovedReason is { Failure: true };

    public void Dispose()
    {
        _cachedTexture?.Dispose();
        _stagingTexture?.Dispose();
        if (_ownsDevice)
        {
            _context?.Dispose();
            _device?.Dispose();
        }
    }

    // --- Public helpers for window state ---

    public static bool IsWindowForeground(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        return PInvoke.GetForegroundWindow() == (HWND)hwnd;
    }

    public static bool IsWindowMinimized(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        return PInvoke.IsIconic((HWND)hwnd);
    }

    // CsWin32 GetDIBits SafeHandle overload has [OverloadResolutionPriority(1)]
    // which prevents calling the raw HBITMAP overload. Keep manual DllImport.
    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern unsafe int RawGetDIBits(IntPtr hdc, IntPtr hbmp, uint uStartScan,
        uint cScanLines, void* lpvBits, BITMAPINFO* lpbmi, uint uUsage);
}
