using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using WinRT;

namespace DiNho.Capture.Poc.Capture;

public sealed class WgcCaptureSource : ICaptureSource
{
    public string Name => "Windows Graphics Capture";
    public int Width => _captureItem?.Size.Width ?? 0;
    public int Height => _captureItem?.Size.Height ?? 0;
    public ID3D11Device? Device => _device;

    private ID3D11Device? _device;
    private bool _ownsDevice;
    private IDirect3DDevice? _winrtDevice;
    private GraphicsCaptureItem? _captureItem;
    private Direct3D11CaptureFramePool? _framePool;
    private GraphicsCaptureSession? _session;
    private IntPtr _targetHwnd;
    private IntPtr _desktopMonitor; // non-zero when desktop capture should target a specific monitor

    private Direct3D11CaptureFrame? _latestFrame;
    private long _latestFrameTicks;
    private readonly AutoResetEvent _frameSignal = new(false);
    private volatile bool _disposed;
    private volatile bool _hasReceivedFrame;
    private TexturePool? _texturePool;
    private int _frameArrivedCount;

    // Cap de captura (padrão OBS reset_frame_interval): só converte/codifica 1 frame
    // a cada intervalo do fps alvo. Frames excedentes do DWM são descartados antes da
    // cópia D3D11. 0 = sem cap (taxa DWM, comportamento original).
    private long _capIntervalTicks;
    private long _lastAcceptedTicks;

    // Disposition (IGraphicsCaptureItem7) — captura é de Monitor, Window, ou Other.
    // -1 = não lido ainda; 0=Other, 1=Monitor, 2=Window.
    private int _disposition = -1;

    /// <summary>
    /// Intervalo de captura (ticks de Stopwatch) para o fps alvo.
    /// fps &lt;= 0 desliga o cap (aceita todos os frames). Divisão truncada:
    /// 30→333.333, 60→166.666, 75→133.333, 120→83.333, 144→69.444.
    /// </summary>
    public static long ComputeCapIntervalTicks(int fps) => fps <= 0 ? 0 : 10_000_000L / fps;

    /// <summary>
    /// Decide se um frame com timestamp <paramref name="nowTicks"/> deve ser aceito dado o
    /// último aceito (<paramref name="lastTicks"/>). Boundary inclusiva: aceita quando
    /// <c>now - last &gt;= interval</c>. <paramref name="capIntervalTicks"/> &lt;= 0 = sem cap
    /// (sempre aceita). <paramref name="lastTicks"/> == 0 = primeiro frame (aceita).
    /// </summary>
    public static bool ShouldAcceptFrame(long nowTicks, long lastTicks, long capIntervalTicks) =>
        capIntervalTicks <= 0 || lastTicks == 0 || nowTicks - lastTicks >= capIntervalTicks;

    /// <summary>Define o fps alvo do cap de captura (0 = sem cap).</summary>
    public void SetCaptureFrameRate(int fps) => _capIntervalTicks = ComputeCapIntervalTicks(fps);

    public void Initialize(ID3D11Device? sharedDevice = null) =>
        Initialize(sharedDevice, IntPtr.Zero, IntPtr.Zero);

    public void Initialize(ID3D11Device? sharedDevice, IntPtr targetHwnd) =>
        Initialize(sharedDevice, targetHwnd, IntPtr.Zero);

    public void Initialize(ID3D11Device? sharedDevice, IntPtr targetHwnd, IntPtr desktopMonitor)
    {
        _targetHwnd = targetHwnd;
        _desktopMonitor = desktopMonitor;

        if (sharedDevice != null)
        {
            _device = sharedDevice;
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
                out _);

            if (result.Failure || _device is null)
            {
                throw new InvalidOperationException(
                    $"Falha ao criar D3D11 device para WGC: {result}. " +
                    "Verifique se o driver da GPU está atualizado.");
            }

            _ownsDevice = true;
        }

        IDXGIDevice dxgiDevice = null!;
        try
        {
            try
            {
                dxgiDevice = _device.QueryInterface<IDXGIDevice>();
            }
            catch (Exception ex)
            {
                Log.E("WGC-DIAG", $"QueryInterface<IDXGIDevice> falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }

            _winrtDevice = Direct3D11Helper.CreateDirect3DDeviceFromDxgiDevice(dxgiDevice);
        }
        catch (Exception ex)
        {
            Log.E("WGC-DIAG", $"CreateDirect3DDeviceFromDxgiDevice falhou: {ex.GetType().Name}: {ex.Message}");
            throw;
        }
        finally
        {
            dxgiDevice?.Dispose();
        }

        if (_targetHwnd != IntPtr.Zero)
        {
            GraphicsCaptureItem? item;
            try
            {
                item = GraphicsCaptureItemHelper.CreateForWindow(_targetHwnd);
            }
            catch (Exception ex)
            {
                Log.E("WGC-DIAG", $"CreateForWindow falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }
            if (item is null)
                throw new InvalidOperationException("WGC CreateForWindow: TryCreateFromWindowId retornou null.");
            DisposeCaptureItem();
            _captureItem = item;
        }
        else
        {
            GraphicsCaptureItem? item;
            try
            {
                item = _desktopMonitor != IntPtr.Zero
                    ? GraphicsCaptureItemHelper.CreateForMonitor(_desktopMonitor)
                    : GraphicsCaptureItemHelper.CreateForPrimaryMonitor();
            }
            catch (Exception ex)
            {
                Log.E("WGC-DIAG", $"CreateForMonitor falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }
            if (item is null)
                throw new InvalidOperationException("WGC CreateForMonitor retornou null — WGC pode não estar disponível.");
            DisposeCaptureItem();
            _captureItem = item;
            _disposition = TryGetItemDisposition(item);
        }

        // HDR detection — choose optimal pixel format
        var pixelFormat = DirectXPixelFormat.B8G8R8A8UIntNormalized;
        if (HdrHelper.IsHdrActive())
        {
            Log.I("WGC", "HDR detectado no monitor — usando BGRA8 (DWM tone-maps automaticamente)");
        }

        _framePool = Direct3D11CaptureFramePool.CreateFreeThreaded(
            _winrtDevice,
            pixelFormat,
            numberOfBuffers: 5,
            _captureItem.Size);

        _session = _framePool.CreateCaptureSession(_captureItem);

        // Win11 24H2+ session settings — fail silently on older Windows
        ConfigureSession3();

        _texturePool = new TexturePool(_device, poolSize: 2);

        // NOTA: FrameArrived NÃO é registrado aqui — precisa ser na pump thread.
        // StartCapture() também não é chamado aqui — será via StartFramePump().
    }

    /// <summary>
    /// Registra o FrameArrived event handler e inicia a captura.
    /// CreateFreeThreaded() permite chamar de qualquer thread —
    /// FrameArrived dispara em worker thread interno do WinRT.
    /// </summary>
    public void StartFramePump()
    {
        _framePool.FrameArrived += OnFrameArrived;
        _session.StartCapture();
    }

    private void OnFrameArrived(Direct3D11CaptureFramePool sender, object args)
    {
        var frame = sender.TryGetNextFrame();
        if (frame is null) return;

        var ticks = Stopwatch.GetTimestamp();
        var count = Interlocked.Increment(ref _frameArrivedCount);

        // Cap de captura (OBS reset_frame_interval): descarta frames que chegaram antes
        // do intervalo do fps alvo. O skip acontece AQUI — antes da extração/cópia D3D11
        // e do VideoProcessorBlt — então o custo GPU roda na taxa alvo, não na taxa DWM.
        if (!ShouldAcceptFrame(ticks, _lastAcceptedTicks, _capIntervalTicks))
        {
            frame.Dispose();
            return;
        }
        _lastAcceptedTicks = ticks;

        if (count == 1)
            Log.I("WGC", $"OnFrameArrived: first frame! size={frame.ContentSize.Width}x{frame.ContentSize.Height} pool={_framePool?.GetType().Name ?? "null"}");
        else if (count % 300 == 0)
            Log.D("WGC", $"OnFrameArrived: frame #{count} size={frame.ContentSize.Width}x{frame.ContentSize.Height}");

        // IDirect3D11CaptureFrame2 dirty regions — diagnostic (Win11 22H2+)
        if (count <= 5 || count % 300 == 0)
        {
            var dirtyCount = TryGetDirtyRegionCount(frame);
            if (dirtyCount >= 0)
                Log.D("WGC", $"Frame #{count} dirtyRegions={dirtyCount}");
        }

        var old = Interlocked.Exchange(ref _latestFrame, frame);
        old?.Dispose();
        Interlocked.Exchange(ref _latestFrameTicks, ticks);
        _hasReceivedFrame = true;
        _frameSignal.Set();
    }

    /// <summary>
    /// QI frame for IDirect3D11CaptureFrame2 and return DirtyRegions count.
    /// Returns -1 if interface not available (pre-Win11 22H2) or on error.
    /// </summary>
    private static int TryGetDirtyRegionCount(Direct3D11CaptureFrame frame)
    {
        if (frame is not IWinRTObject winrtObj) return -1;
        try
        {
            var nativePtr = winrtObj.NativeObject.GetRef();
            try
            {
                var iid = typeof(IDirect3D11CaptureFrame2).GUID;
                var hr = Marshal.QueryInterface(nativePtr, ref iid, out var ptr);
                if (hr != 0 || ptr == IntPtr.Zero) return -1;
                try
                {
                    // IDirect3D11CaptureFrame2 vtable:
                    //   IInspectable(3) + IPropertyAccessor methods(4) = 7 slots before DirtyRegions
                    //   DirtyRegions is slot 7 (index 7 from IUnknown)
                    var vtable = Marshal.ReadIntPtr(ptr);
                    var getDirtyRegionsPtr = Marshal.ReadIntPtr(vtable, 7 * IntPtr.Size);
                    var getDirtyRegions = Marshal.GetDelegateForFunctionPointer<GetDirtyRegionsDelegate>(getDirtyRegionsPtr);

                    hr = getDirtyRegions(ptr, out var vectorPtr);
                    if (hr != 0 || vectorPtr == IntPtr.Zero) return -1;
                    try
                    {
                        // IVectorView<DirtyRegion> — IInspectable(3) + IIterable(1) + IVectorView(3) = 7
                        // Size is slot 7
                        var vectorVtable = Marshal.ReadIntPtr(vectorPtr);
                        var getSizePtr = Marshal.ReadIntPtr(vectorVtable, 7 * IntPtr.Size);
                        var getSize = Marshal.GetDelegateForFunctionPointer<GetSizeDelegate>(getSizePtr);
                        hr = getSize(vectorPtr, out var size);
                        if (hr == 0) return (int)size;
                        return -1;
                    }
                    finally
                    {
                        Marshal.Release(vectorPtr);
                    }
                }
                finally
                {
                    Marshal.Release(ptr);
                }
            }
            finally
            {
                Marshal.Release(nativePtr);
            }
        }
        catch
        {
            return -1;
        }
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetDirtyRegionsDelegate(IntPtr thisPtr, out IntPtr vectorPtr);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetSizeDelegate(IntPtr thisPtr, out uint size);

    /// <summary>
    /// Extrai a textura D3D11 de uma superfície WGC, gerenciando o ciclo de vida
    /// do ponteiro nativo retornado por GetRef() (que faz AddRef). O Release é
    /// garantido em finally — antes, o ponteiro nunca era liberado a 60fps,
    /// retendo o IDirect3DSurface nativo e a textura D3D11 subjacente.
    /// </summary>
    internal static ID3D11Texture2D? TryExtractTexture(IWinRTObject surface, Action<string, string> log)
    {
        var nativePtr = surface.NativeObject.GetRef();
        try
        {
            return TryExtractTextureFromNativePtr(nativePtr, log);
        }
        finally
        {
            Marshal.Release(nativePtr);
        }
    }

    /// <summary>
    /// Estratégias de extração sobre o ponteiro nativo de um IDirect3DSurface WGC.
    /// NÃO é dono do ponteiro — o caller gerencia GetRef()/Release.
    /// </summary>
    internal static ID3D11Texture2D? TryExtractTextureFromNativePtr(IntPtr nativePtr, Action<string, string> log)
    {
        if (nativePtr == IntPtr.Zero)
            return null;

        int hr1 = -1, hr2 = -1;
        ID3D11Texture2D? sourceTexture = null;

        // Estratégia 1: IDirect3DDxgiInterfaceAccess (abordagem oficial)
        var dxgiAccessGuid = typeof(IDirect3DDxgiInterfaceAccess).GUID;
        hr1 = Marshal.QueryInterface(nativePtr, ref dxgiAccessGuid, out var dxgiAccessPtr);
        if (hr1 == 0 && dxgiAccessPtr != IntPtr.Zero)
        {
            try
            {
                var dxgiAccess = (IDirect3DDxgiInterfaceAccess)Marshal.GetTypedObjectForIUnknown(dxgiAccessPtr, typeof(IDirect3DDxgiInterfaceAccess));
                var d3d11Guid = typeof(ID3D11Texture2D).GUID;
                var hrGet = dxgiAccess.GetInterface(ref d3d11Guid, out var d3dPtr);
                if (hrGet == 0 && d3dPtr != IntPtr.Zero)
                    sourceTexture = new ID3D11Texture2D(d3dPtr);
                else
                    log("WGC", $"GetInterface falhou: hr={hrGet}");
            }
            finally
            {
                Marshal.Release(dxgiAccessPtr);
            }
        }

        // Estratégia 2: QI direto para IDXGISurface → depois OpenResource
        if (sourceTexture is null)
        {
            var dxgiSurfaceGuid = typeof(IDXGISurface).GUID;
            hr2 = Marshal.QueryInterface(nativePtr, ref dxgiSurfaceGuid, out var dxgiSurfacePtr);
            if (hr2 == 0 && dxgiSurfacePtr != IntPtr.Zero)
            {
                try
                {
                    var dxgiSurface = new IDXGISurface(dxgiSurfacePtr);
                    using var resource = dxgiSurface.QueryInterface<ID3D11Resource>();
                    sourceTexture = resource.QueryInterface<ID3D11Texture2D>();
                }
                finally
                {
                    Marshal.Release(dxgiSurfacePtr);
                }
            }
        }

        if (sourceTexture is null)
            log("WGC", $"Ambas estratégias falharam — IDirect3DDxgiInterfaceAccess={hr1}, IDXGISurface={hr2}");

        return sourceTexture;
    }

    /// <summary>
    /// Frame WGC onde a extração de textura D3D11 falhou (ambas estratégias).
    /// Historicamente reportava success:true com textura nula — o consumidor
    /// (EngineCoordinator.Capture) só monitora starvation nesse branch, nunca
    /// reporta NoFrame ao watchdog. Stall de vídeo silencioso. Deve ser uma
    /// FALHA (success:false) para o watchdog contar drop real e reinitar.
    /// </summary>
    internal static CapturedFrame CreateNullTextureFrame(long startTicks, long endTicks, int width, int height, long waitEndTicks, long copyEndTicks)
    {
        return new CapturedFrame(startTicks, endTicks, width, height, success: false, waitEndTicks: waitEndTicks, copyEndTicks: copyEndTicks);
    }

    public CapturedFrame TryCaptureFrame(int timeoutMs)
    {
        var startTicks = Stopwatch.GetTimestamp();

        if (_disposed || _frameSignal is null || _device is null)
            return new CapturedFrame(startTicks, Stopwatch.GetTimestamp(), 0, 0, success: false);

        try
        {
            var effectiveTimeout = !_hasReceivedFrame ? Math.Max(timeoutMs, 500) : timeoutMs;

            try
            {
                if (!_frameSignal.WaitOne(effectiveTimeout))
                {
                    var timeoutTicks = Stopwatch.GetTimestamp();
                    return new CapturedFrame(startTicks, timeoutTicks, 0, 0, success: false, waitEndTicks: timeoutTicks);
                }
            }
            catch (ObjectDisposedException)
            {
                var disposedTicks = Stopwatch.GetTimestamp();
                return new CapturedFrame(startTicks, disposedTicks, 0, 0, success: false, waitEndTicks: disposedTicks);
            }

            var waitEndTicks = Stopwatch.GetTimestamp();

            var frameTicks = Interlocked.Read(ref _latestFrameTicks);
            var frame = Interlocked.Exchange(ref _latestFrame, (Direct3D11CaptureFrame?)null);

            if (frame is null)
            {
                var failTicks = Stopwatch.GetTimestamp();
                return new CapturedFrame(startTicks, failTicks, 0, 0, success: false, waitEndTicks: failTicks);
            }

            var size = frame.ContentSize;
            var endTicks = frameTicks;

            ID3D11Texture2D? sourceTexture = null;
            IDirect3DSurface? surface = null;
            try
            {
                surface = frame.Surface;
                if (surface == null)
                    return new CapturedFrame(startTicks, endTicks, 0, 0, success: false, waitEndTicks: waitEndTicks);

                try
                {
                    if (surface is IWinRTObject winrtObj)
                    {
                        sourceTexture = TryExtractTexture(winrtObj, (source, message) => Log.E(source, message));
                    }
                }
                catch (Exception ex)
                {
                    Log.E("WGC", $"Falha ao extrair textura: {ex.GetType().Name}: {ex.Message}");
                }

                var extractEndTicks = Stopwatch.GetTimestamp();

                if (sourceTexture is null)
                {
                    return CreateNullTextureFrame(startTicks, endTicks, size.Width, size.Height, waitEndTicks, extractEndTicks);
                }

                var desc = sourceTexture.Description;

                // WGC per-window pode retornar ContentSize != textura D3D (bug conhecido).
                // A textura D3D é o dado real — confiar nela para dimensões do encoder.
                if (desc.Width != size.Width || desc.Height != size.Height)
                {
                    Log.D("WGC", $"DIM MISMATCH: tex={desc.Width}x{desc.Height} fmt={desc.Format} vs content={size.Width}x{size.Height} — usando textura");
                }

                var frameW = desc.Width;
                var frameH = desc.Height;

                var poolTex = _texturePool!.Rent((int)frameW, (int)frameH, desc.Format);
                var ctx = _device.ImmediateContext;
                ctx.CopyResource(poolTex, sourceTexture);

                var copyEndTicks = Stopwatch.GetTimestamp();
                return new CapturedFrame(startTicks, copyEndTicks, (int)frameW, (int)frameH, success: true, poolTex, _device,
                    waitEndTicks, copyEndTicks, ownsTexture: false);
            }
            finally
            {
                sourceTexture?.Dispose();
                surface?.Dispose();
                frame.Dispose();
            }
        }
        catch
        {
            var failTicks = Stopwatch.GetTimestamp();
            return new CapturedFrame(startTicks, failTicks, 0, 0, success: false, waitEndTicks: failTicks);
        }
    }

    public bool CheckDeviceLost() => _device?.DeviceRemovedReason is { Failure: true };

    /// <summary>
    /// Win11+ — configurações avançadas da sessão WGC.
    /// Session2 (Win10 1903+): IsCursorCaptureEnabled=false — evita overhead de software cursor.
    /// Session3 (Win11 21H2+): IsBorderRequired=false — remove indicador amarelo de captura.
    /// Session5 (Win11 24H2+): MinUpdateInterval=0 — força frame rate máximo, impede throttling do DWM.
    ///                         IncludeSecondaryWindows=true — captura janelas filhas (popups, tooltips).
    /// </summary>
    private void ConfigureSession3()
    {
        // Acesso às interfaces derivadas IGraphicsCaptureSession2/3/4/5/6 via QI bruto.
        // Por que não cast dinâmico nem AsInterface<T>():
        //   - `((object)_session) is IX` retorna FALSE em runtime: GraphicsCaptureSession
        //     implementa IDynamicInterfaceCastable, que só resolve interfaces declaradas
        //     na projeção (Microsoft.Windows.SDK.NET). Interfaces [ComImport] escritas à
        //     mão não estão nesse registry — IsInterfaceImplemented responde false sem
        //     sequer tentar QI na instância COM.
        //   - AsInterface<T>() lança PlatformNotSupportedException: não há Marshaler<T>
        //     gerado para as interfaces manuais ("Marshalling as IInspectable is not
        //     supported").
        // QI por IID é o mecanismo base do COM: a interface derivada é só outro IID no
        // mesmo objeto; independe de marshaller WinRT ou do registry da projeção.
        // Layout vtable (interfaces flat, confirmado por reflexão no SDK 26100 — cada
        // SessionN deriva direto de IInspectable, sem herança entre si):
        //   IUnknown (0-2) + IInspectable (3-5) + get_prop (6) + set_prop (7)
        // ABI: bool = 4 bytes; enum = 4 bytes; Windows.Foundation.TimeSpan = long 8 bytes.
        if (_session is not IWinRTObject winrt) return;

        var nativePtr = winrt.NativeObject.GetRef();
        try
        {
            TrySetSessionBool(nativePtr, S2_CURSOR_ENABLED, "Session2: IsCursorCaptureEnabled=false", value: false);
            TrySetSessionBool(nativePtr, S3_BORDER_REQUIRED, "Session3: IsBorderRequired=false", value: false);
            TrySetSessionEnum(nativePtr, S4_DIRTY_REGION_MODE, "Session4: DirtyRegionMode=ReportAndRender", value: 1);
            TrySetSessionTimeSpan(nativePtr, S5_MIN_UPDATE_INTERVAL, $"Session5: MinUpdateInterval={_capIntervalTicks} (cap de captura)", durationTicks: _capIntervalTicks);
            TrySetSessionBool(nativePtr, S6_INCLUDE_SECONDARY, "Session6: IncludeSecondaryWindows=true", value: true);
        }
        finally
        {
            Marshal.Release(nativePtr);
        }
    }

    private static readonly Guid S2_CURSOR_ENABLED = new("2C39AE40-7D2E-5044-804E-8B6799D4CF9E");
    private static readonly Guid S3_BORDER_REQUIRED = new("F2CDD966-22AE-5EA1-9596-3A289344C3BE");
    private static readonly Guid S4_DIRTY_REGION_MODE = new("AE99813C-C257-5759-8ED0-668C9B557ED4");
    private static readonly Guid S5_MIN_UPDATE_INTERVAL = new("67C0EA62-1F85-5061-925A-239BE0AC09CB");
    private static readonly Guid S6_INCLUDE_SECONDARY = new("D7419236-BE20-5E9F-BCD6-C4E98FD6AFDC");

    // IGraphicsCaptureItem7 — expõe Disposition (getter-only: 0=Other, 1=Monitor, 2=Window).
    // GUID NÃO confirmado via WinMD/netsdk/Wine — calculado a partir de padrão de offsets
    // das interfaces derivadas de IGraphicsCaptureItem.  Se QI falhar, logamos e seguimos.
    private static readonly Guid IID_ITEM7_DISPOSITION = new("9B89E4A4-5105-5244-9BB8-2D7B56A25945");

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int SetBoolDelegate(IntPtr thisPtr, int value);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int SetEnumDelegate(IntPtr thisPtr, int value);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int SetTimeSpanDelegate(IntPtr thisPtr, long durationTicks);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int ReadEnumDelegate(IntPtr thisPtr, out int value);

    /// <summary>QI por IID na sessão e invoca o setter (vtable slot 7). Loga em Debug quando a interface não está disponível.</summary>
    private static void TrySetSessionBool(IntPtr nativePtr, Guid iid, string name, bool value)
    {
        var hr = Marshal.QueryInterface(nativePtr, ref iid, out var ifacePtr);
        if (hr != 0 || ifacePtr == IntPtr.Zero)
        {
            Log.D("WGC", $"{name}: interface não disponível (hr=0x{hr:X8})");
            return;
        }
        try
        {
            var vtable = Marshal.ReadIntPtr(ifacePtr);
            var setterFn = Marshal.ReadIntPtr(vtable, 7 * IntPtr.Size);
            var setter = Marshal.GetDelegateForFunctionPointer<SetBoolDelegate>(setterFn);
            var setHr = setter(ifacePtr, value ? 1 : 0);
            if (setHr == 0) Log.I("WGC", $"{name}: OK");
            else Log.W("WGC", $"{name}: setter falhou (hr=0x{setHr:X8})");
        }
        finally
        {
            Marshal.Release(ifacePtr);
        }
    }

    /// <summary>Idem para propriedade enum (DirtyRegionMode).</summary>
    private static void TrySetSessionEnum(IntPtr nativePtr, Guid iid, string name, int value)
    {
        var hr = Marshal.QueryInterface(nativePtr, ref iid, out var ifacePtr);
        if (hr != 0 || ifacePtr == IntPtr.Zero)
        {
            Log.D("WGC", $"{name}: interface não disponível (hr=0x{hr:X8})");
            return;
        }
        try
        {
            var vtable = Marshal.ReadIntPtr(ifacePtr);
            var setterFn = Marshal.ReadIntPtr(vtable, 7 * IntPtr.Size);
            var setter = Marshal.GetDelegateForFunctionPointer<SetEnumDelegate>(setterFn);
            var setHr = setter(ifacePtr, value);
            if (setHr == 0) Log.I("WGC", $"{name}: OK");
            else Log.W("WGC", $"{name}: setter falhou (hr=0x{setHr:X8})");
        }
        finally
        {
            Marshal.Release(ifacePtr);
        }
    }

    /// <summary>Idem para propriedade TimeSpan (Windows.Foundation.TimeSpan = long 8 bytes).</summary>
    private static void TrySetSessionTimeSpan(IntPtr nativePtr, Guid iid, string name, long durationTicks)
    {
        var hr = Marshal.QueryInterface(nativePtr, ref iid, out var ifacePtr);
        if (hr != 0 || ifacePtr == IntPtr.Zero)
        {
            Log.D("WGC", $"{name}: interface não disponível (hr=0x{hr:X8})");
            return;
        }
        try
        {
            var vtable = Marshal.ReadIntPtr(ifacePtr);
            var setterFn = Marshal.ReadIntPtr(vtable, 7 * IntPtr.Size);
            var setter = Marshal.GetDelegateForFunctionPointer<SetTimeSpanDelegate>(setterFn);
            var setHr = setter(ifacePtr, durationTicks);
            if (setHr == 0) Log.I("WGC", $"{name}: OK");
            else Log.W("WGC", $"{name}: setter falhou (hr=0x{setHr:X8})");
        }
        finally
        {
            Marshal.Release(ifacePtr);
        }
    }

    /// <summary>
    /// QI IGraphicsCaptureItem7 no capture item para ler Disposition (0=Other, 1=Monitor, 2=Window).
    /// GUID e slot vtable NÃO confirmados — probing slot 12..24 com fallback.
    /// Retorna -1 se a interface não estiver disponível ou nenhum slot retornar S_OK.
    /// </summary>
    private static int TryGetItemDisposition(GraphicsCaptureItem item)
    {
        var itemIid = typeof(GraphicsCaptureItem).GUID;
        var hr = Marshal.QueryInterface(Marshal.GetIUnknownForObject(item), ref itemIid, out var itemPtr);
        if (hr != 0 || itemPtr == IntPtr.Zero)
        {
            Log.D("WGC", "Disposition: QI do capture item falhou (hr=0x{hr:X8})");
            return -1;
        }
        try
        {
            // QI por IGraphicsCaptureItem7
            var iid7 = IID_ITEM7_DISPOSITION;
            hr = Marshal.QueryInterface(itemPtr, ref iid7, out var iface7);
            if (hr != 0 || iface7 == IntPtr.Zero)
            {
                Log.D("WGC", $"Disposition: IGraphicsCaptureItem7 não disponível (hr=0x{hr:X8})");
                return -1;
            }
            try
            {
                var vtable = Marshal.ReadIntPtr(iface7);
                // Probing slots 12..24 — IGraphicsCaptureItem base tem 6 props (12 slots),
                // Item2..Item7 adicionam mais. O getter de Disposition pode estar em qualquer slot
                // além do último setter do base (slot 17).
                for (int slot = 12; slot <= 24; slot++)
                {
                    try
                    {
                        var fnPtr = Marshal.ReadIntPtr(vtable, slot * IntPtr.Size);
                        if (fnPtr == IntPtr.Zero) continue;
                        var getter = Marshal.GetDelegateForFunctionPointer<ReadEnumDelegate>(fnPtr);
                        var getHr = getter(iface7, out var value);
                        if (getHr == 0)
                        {
                            Log.I("WGC", $"Disposition={value} via slot {slot}");
                            return value;
                        }
                    }
                    catch (Exception)
                    {
                        // Slot não é o getter — continua probing
                    }
                }
                Log.D("WGC", "Disposition: nenhum slot retornou S_OK (interface existe mas getter não encontrado)");
                return -1;
            }
            finally
            {
                Marshal.Release(iface7);
            }
        }
        finally
        {
            Marshal.Release(itemPtr);
        }
    }

    private void DisposeCaptureItem()
    {
        if (_captureItem is not IWinRTObject winrtObj) return;
        (winrtObj.NativeObject as IDisposable)?.Dispose();
        _captureItem = null;
    }

    public void Dispose()
    {
        _disposed = true;
        // 1. Stop session first — prevents new frames from arriving
        _session?.Dispose();
        // 2. Unsubscribe BEFORE disposing pool — prevents callback on disposed signal
        if (_framePool is not null)
        {
            _framePool.FrameArrived -= OnFrameArrived;
            _framePool.Dispose();
        }
        // 3. Now safe to dispose signal (no more callbacks possible)
        _frameSignal.Dispose();
        _latestFrame?.Dispose();
        DisposeCaptureItem();
        _texturePool?.Dispose();
        _winrtDevice?.Dispose();
        if (_ownsDevice) _device?.Dispose();
    }
}

[ComImport]
[Guid("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IDirect3DDxgiInterfaceAccess
{
    int GetInterface(ref Guid iid, out IntPtr device);
}

/// <summary>
/// WinRT IDirect3D11CaptureFrame2 — Win11 22H2+ (SDK 22621).
/// DirtyRegions: list of rectangles that changed since last frame.
/// Enables selective GPU copy — only copy dirty regions instead of full texture.
/// </summary>
[ComImport]
[Guid("37869CFA-2B48-5EBF-9AFB-DFFD805DEFDB")]
[InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
internal interface IDirect3D11CaptureFrame2
{
    IntPtr DirtyRegions { get; } // IVectorView<Direct3D11CaptureFrameDirtyRegion>
}

/// <summary>
/// WinRT IDirect3D11CaptureFrameDirtyRegion — represents a dirty rect.
/// </summary>
[ComImport]
[Guid("a8b17203-5d85-5f86-b2c2-3c883b70c4d1")]
[InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
internal interface IDirect3D11CaptureFrameDirtyRegion
{
    // Default property: Rect DirtyRect
    // Accessed via IPropertyValue since COM interface layout is tricky for WinRT structs
}

// Nota: IGraphicsCaptureSession2/3/4/5/6 NÃO são declaradas aqui.
// A projeção do SDK 26100 expõe essas interfaces derivadas, mas o acesso via
// cast dinâmico retorna false em runtime (IDynamicInterfaceCastable só resolve
// interfaces declaradas na projeção) e AsInterface<T>() lança
// PlatformNotSupportedException (sem Marshaler<T>). O acesso real usa QI bruto
// por IID + setter via vtable (slot 7) — ver ConfigureSession3() e os GUIDs
// S2_CURSOR_ENABLED / S3_BORDER_REQUIRED / S4_DIRTY_REGION_MODE /
// S5_MIN_UPDATE_INTERVAL / S6_INCLUDE_SECONDARY.
