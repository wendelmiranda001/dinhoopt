using System.Diagnostics;
using DiNho.Capture.Poc.Logging;
using Vortice;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace DiNho.Capture.Poc.Capture;

public sealed class DxgiCaptureSource : ICaptureSource
{
    public string Name => "DXGI Desktop Duplication";
    public int Width => _outputWidth;
    public int Height => _outputHeight;
    public ID3D11Device? Device => _device;

    private ID3D11Device? _device;
    private bool _ownsDevice;
    private ID3D11DeviceContext? _context;
    private IDXGIOutputDuplication? _duplication;
    private int _outputWidth;
    private int _outputHeight;

    private TexturePool? _texturePool;
    private ID3D11Texture2D? _cachedTexture;
    private int _cachedWidth;
    private int _cachedHeight;

    public bool CheckDeviceLost() => _device?.DeviceRemovedReason is { Failure: true };

    public void Initialize(ID3D11Device? sharedDevice = null) =>
        Initialize(sharedDevice, IntPtr.Zero);

    public void Initialize(ID3D11Device? sharedDevice, IntPtr targetHwnd)
    {
        if (sharedDevice != null)
        {
            _device = sharedDevice;
            _context = _device.ImmediateContext;
            _ownsDevice = false;
        }
        else
        {
            var creationFlags = DeviceCreationFlags.BgraSupport;

            var result = D3D11.D3D11CreateDevice(
                null,
                DriverType.Hardware,
                creationFlags,
                new[]
                {
                    FeatureLevel.Level_11_1,
                    FeatureLevel.Level_11_0,
                },
                out _device,
                out _,
                out _context);

            if (result.Failure || _device is null || _context is null)
            {
                throw new InvalidOperationException(
                    $"Falha ao criar D3D11 device para DXGI: {result}. " +
                    "Verifique se o driver da GPU está atualizado.");
            }

            _ownsDevice = true;
        }

        using var dxgiDevice = _device.QueryInterface<IDXGIDevice>();
        using var adapter = dxgiDevice.GetAdapter();

        // Enumerar todas as saídas e escolher a que contém a janela alvo
        var monitorHwnd = targetHwnd != IntPtr.Zero
            ? MonitorHelper.GetMonitorFromWindowHandle(targetHwnd)
            : MonitorHelper.GetPrimaryMonitorHandle();

        IDXGIOutput1? selectedOutput = null;
        OutputDescription selectedDesc = default;

        for (uint i = 0; adapter.EnumOutputs(i, out var output).Success; i++)
        {
            using (output)
            {
                IDXGIOutput1? output1 = null;
                try
                {
                    // Tentar IDXGIOutput5.DuplicateOutput1() primeiro (Win10 1703+)
                    // Suporta formatos modernos (BGRA1010102, RGBA16Float)
                    var output5 = output.QueryInterface<IDXGIOutput5>();
                    if (output5 != null)
                    {
                        try
                        {
                            var formats = new[] { Format.B8G8R8A8_UNorm };
                            var duplication = output5.DuplicateOutput1(_device, formats);
                            var desc = output5.Description;
                            var outputBounds = desc.DesktopCoordinates;
                            var outputMidX = (outputBounds.Left + outputBounds.Right) / 2;
                            var outputMidY = (outputBounds.Top + outputBounds.Bottom) / 2;
                            var outputMonitor = MonitorHelper.MonitorFromPoint(outputMidX, outputMidY);

                            if (outputMonitor == monitorHwnd)
                            {
                                selectedOutput?.Dispose();
                                selectedOutput = null;
                                _duplication?.Dispose();
                                selectedDesc = desc;
                                _duplication = duplication;
                                _outputWidth = selectedDesc.DesktopCoordinates.Right - selectedDesc.DesktopCoordinates.Left;
                                _outputHeight = selectedDesc.DesktopCoordinates.Bottom - selectedDesc.DesktopCoordinates.Top;
                                _texturePool = new TexturePool(_device, poolSize: 3);
                                output5.Dispose();
                                return;
                            }

                            if (selectedOutput is null)
                            {
                                selectedOutput = output5;
                                selectedDesc = desc;
                                _duplication = duplication;
                            }
                            else
                            {
                                duplication.Dispose();
                                output5.Dispose();
                            }
                            continue;
                        }
                        catch (Exception ex)
                        {
                            Log.D("DxgiCaptureSource", $"DuplicateOutput1 not supported on output {i}: {ex.Message}");
                        }
                        output5.Dispose();
                    }
                }
                catch (Exception ex) { Log.D("DxgiCaptureSource", $"IDXGIOutput5 QI failed on output {i}: {ex.Message}"); }

                // Fallback: IDXGIOutput1.DuplicateOutput() (Win8+)
                output1 = output.QueryInterface<IDXGIOutput1>();
                var desc1 = output1.Description;

                var outputBounds1 = desc1.DesktopCoordinates;
                var outputMidX1 = (outputBounds1.Left + outputBounds1.Right) / 2;
                var outputMidY1 = (outputBounds1.Top + outputBounds1.Bottom) / 2;
                var outputMonitor1 = MonitorHelper.MonitorFromPoint(outputMidX1, outputMidY1);

                if (outputMonitor1 == monitorHwnd)
                {
                    selectedOutput?.Dispose();
                    selectedOutput = null;
                    _duplication?.Dispose();
                    selectedDesc = desc1;
                    _duplication = output1.DuplicateOutput(_device);
                    _outputWidth = selectedDesc.DesktopCoordinates.Right - selectedDesc.DesktopCoordinates.Left;
                    _outputHeight = selectedDesc.DesktopCoordinates.Bottom - selectedDesc.DesktopCoordinates.Top;
                    output1.Dispose();
                    _texturePool = new TexturePool(_device, poolSize: 3);
                    return;
                }

                // Fallback: first output if no match
                if (selectedOutput is null)
                {
                    selectedOutput = output1;
                    selectedDesc = desc1;
                }
                else
                {
                    output1.Dispose();
                }
            }
        }

        if (selectedOutput is null)
            throw new InvalidOperationException("Nenhum output DXGI disponível para captura.");

        _outputWidth = selectedDesc.DesktopCoordinates.Right - selectedDesc.DesktopCoordinates.Left;
        _outputHeight = selectedDesc.DesktopCoordinates.Bottom - selectedDesc.DesktopCoordinates.Top;
        _duplication ??= selectedOutput.DuplicateOutput(_device);
        selectedOutput.Dispose();
        _texturePool = new TexturePool(_device, poolSize: 3);
    }

    public CapturedFrame TryCaptureFrame(int timeoutMs)
    {
        if (_duplication is null)
            throw new InvalidOperationException("Chame Initialize() antes de capturar.");

        var startTicks = Stopwatch.GetTimestamp();

        var hr = _duplication.AcquireNextFrame(
            (uint)timeoutMs,
            out var frameInfo,
            out var desktopResource);

        var waitEndTicks = Stopwatch.GetTimestamp();

        if (hr == Vortice.DXGI.ResultCode.WaitTimeout)
        {
            if (_cachedTexture != null && _texturePool != null)
            {
                try
                {
                    var poolTex = _texturePool.Rent(_cachedWidth, _cachedHeight, _cachedTexture.Description.Format);
                    _context!.CopyResource(poolTex, _cachedTexture);
                    return new CapturedFrame(startTicks, waitEndTicks, _cachedWidth, _cachedHeight, success: true, poolTex, _device,
                        waitEndTicks, waitEndTicks, ownsTexture: false);
                }
                catch (System.Runtime.InteropServices.COMException)
                {
                    // Texture was disposed by dimension change in TexturePool.Rent() — invalidate cache
                    _cachedTexture = null;
                }
                catch (ObjectDisposedException)
                {
                    _cachedTexture = null;
                }
            }
            return new CapturedFrame(startTicks, waitEndTicks, 0, 0, success: false);
        }

        if (hr.Failure || desktopResource is null)
        {
            return new CapturedFrame(startTicks, waitEndTicks, 0, 0, success: false);
        }

        try
        {
            using var texture = desktopResource.QueryInterface<ID3D11Texture2D>();
            var desc = texture.Description;

            var poolTex = _texturePool!.Rent((int)desc.Width, (int)desc.Height, desc.Format);
            _context!.CopyResource(poolTex, texture);

            _cachedTexture = poolTex;
            _cachedWidth = (int)desc.Width;
            _cachedHeight = (int)desc.Height;

            var copyEndTicks = Stopwatch.GetTimestamp();
            return new CapturedFrame(startTicks, copyEndTicks, (int)desc.Width, (int)desc.Height, success: true, poolTex, _device,
                waitEndTicks, copyEndTicks, ownsTexture: false);
        }
        catch (Exception ex)
        {
            Log.D("DxgiCaptureSource", $"CopyResource failed: {ex.Message}");
            return new CapturedFrame(startTicks, waitEndTicks, 0, 0, success: false);
        }
        finally
        {
            try
            {
                // Release the frame back to the duplication API before disposing the resource.
                // ReleaseFrame may throw if duplication is in a bad state; swallow to avoid crashing capture loop.
                _duplication?.ReleaseFrame();
            }
            catch (Exception ex)
            {
                Log.D("DxgiCaptureSource", $"ReleaseFrame failed: {ex.Message}");
            }
            finally
            {
                desktopResource?.Dispose();
            }
        }
    }

    public void Dispose()
    {
        _texturePool?.Dispose();
        _cachedTexture = null;
        _duplication?.Dispose();
        if (_ownsDevice)
        {
            _context?.Dispose();
            _device?.Dispose();
        }
    }
}
