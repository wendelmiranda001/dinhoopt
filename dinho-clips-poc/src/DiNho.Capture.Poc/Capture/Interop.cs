using DiNho.Capture.Poc.Logging;
using System.Runtime.InteropServices;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX.Direct3D11;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using WinRT;

namespace DiNho.Capture.Poc.Capture
{
    internal static class GraphicsCaptureItemHelper
    {
        // PreserveSig=false: last native out param (void**) becomes the C# return value.
        // Declared as IntPtr return (no out param) — matches Direct3D11Helper below.
        [DllImport("combase.dll", PreserveSig = false)]
        private static extern IntPtr RoGetActivationFactory(IntPtr activatableClassId, ref Guid iid);

        [DllImport("combase.dll", PreserveSig = true)]
        private static extern int WindowsCreateString([MarshalAs(UnmanagedType.LPWStr)] string sourceString, int length, out IntPtr hstring);

        [DllImport("combase.dll", PreserveSig = true)]
        private static extern int WindowsDeleteString(IntPtr hstring);

        private const string RuntimeClassName = "Windows.Graphics.Capture.GraphicsCaptureItem";

        // IInspectable GUID — every WinRT activation factory implements this
        private static readonly Guid IInspectableGuid = new("AF86E2E0-B12D-4C6A-9C5A-D7AA65101E90");

        // IGraphicsCaptureItemInterop — COM interface on the activation factory for monitor/window capture
        private static readonly Guid IGraphicsCaptureItemInteropGuid = new("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356");

        // GraphicsCaptureItem default interface IID — passed to CreateForWindow/CreateForMonitor as riid.
        // typeof(GraphicsCaptureItem).GUID is the runtime-class GUID (E79F1DD1-...) — NOT the interface IID.
        private static readonly Guid GraphicsCaptureItemGuid = new("79C3F95B-31F7-4EC2-A464-632EF5D30760");

        // Raw vtable delegates — bypass COM interop marshaling entirely.
        // COM vtable methods use stdcall convention on Windows.
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int CreateForMonitorDelegate(IntPtr thisPtr, IntPtr hMonitor, ref Guid iid, out IntPtr result);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int CreateForWindowDelegate(IntPtr thisPtr, IntPtr hwnd, ref Guid iid, out IntPtr result);

        private static IntPtr CreateHString(string s)
        {
            var hr = WindowsCreateString(s, s.Length, out var hstr);
            if (hr != 0)
                throw new InvalidOperationException($"WindowsCreateString falhou: HRESULT=0x{hr:X8}");
            return hstr;
        }

        /// <summary>
        /// Gets the activation factory as IInspectable via RoGetActivationFactory.
        /// Caller must Marshal.Release() when done.
        /// </summary>
        private static IntPtr GetActivationFactoryAsInspectable()
        {
            var hstr = CreateHString(RuntimeClassName);
            try
            {
                var iid = IInspectableGuid;
                var factoryPtr = RoGetActivationFactory(hstr, ref iid);
                return factoryPtr;
            }
            finally
            {
                WindowsDeleteString(hstr);
            }
        }

        /// <summary>
        /// Creates a GraphicsCaptureItem for a monitor using raw vtable calls.
        /// Two-step approach:
        ///   1) Get activation factory as IInspectable (always works for WinRT classes)
        ///   2) Marshal.QueryInterface for IGraphicsCaptureItemInterop (standard COM QI)
        /// Then call CreateForMonitor via raw vtable (slot 4 — IUnknown(3) + method(1)).
        /// </summary>
        public static GraphicsCaptureItem CreateForMonitor(IntPtr hMonitor)
        {
            IntPtr factoryPtr;
            try
            {
                factoryPtr = GetActivationFactoryAsInspectable();
            }
            catch (Exception ex)
            {
                Log.E("WGC-DIAG", $"GetActivationFactoryAsInspectable() falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }

            IntPtr interopPtr = IntPtr.Zero;
            try
            {
                // QI the activation factory for IGraphicsCaptureItemInterop
                var interopGuid = IGraphicsCaptureItemInteropGuid;
                var qiHr = Marshal.QueryInterface(factoryPtr, in interopGuid, out interopPtr);
                if (qiHr != 0 || interopPtr == IntPtr.Zero)
                    throw new COMException($"QI for IGraphicsCaptureItemInterop failed: HRESULT=0x{qiHr:X8}", qiHr);

                Log.D("WGC-DIAG", $"QI IGraphicsCaptureItemInterop OK: interopPtr=0x{interopPtr:X8}");

                // IGraphicsCaptureItemInterop vtable (inherits IUnknown):
                //   [0] QueryInterface, [1] AddRef, [2] Release
                //   [3] CreateForWindow, [4] CreateForMonitor
                var vtable = Marshal.ReadIntPtr(interopPtr);
                var createForMonitorPtr = Marshal.ReadIntPtr(vtable, 4 * IntPtr.Size);
                var createForMonitor = Marshal.GetDelegateForFunctionPointer<CreateForMonitorDelegate>(createForMonitorPtr);

                var itemGuid = GraphicsCaptureItemGuid;
                var hr = createForMonitor(interopPtr, hMonitor, ref itemGuid, out var itemPtr);

                if (hr != 0)
                    throw new COMException($"CreateForMonitor failed: HRESULT=0x{hr:X8}", hr);

                return MarshalInterface<GraphicsCaptureItem>.FromAbi(itemPtr);
            }
            catch (COMException)
            {
                throw;
            }
            catch (Exception ex)
            {
                Log.E("WGC-DIAG", $"CreateForMonitor raw vtable call failed: {ex.GetType().Name}: {ex.Message}");
                throw;
            }
            finally
            {
                if (interopPtr != IntPtr.Zero) Marshal.Release(interopPtr);
                Marshal.Release(factoryPtr);
            }
        }

        public static GraphicsCaptureItem CreateForPrimaryMonitor()
        {
            var hMonitor = MonitorHelper.GetPrimaryMonitorHandle();
            Log.D("WGC-DIAG", $"CreateForPrimaryMonitor: hMonitor=0x{hMonitor:X8}");
            return CreateForMonitor(hMonitor);
        }

        public static GraphicsCaptureItem? CreateForWindow(IntPtr hwnd)
        {
            try
            {
                var windowId = new global::Windows.UI.WindowId { Value = (ulong)hwnd };
                return GraphicsCaptureItem.TryCreateFromWindowId(windowId);
            }
            catch (Exception ex)
            {
                Log.E("WGC", $"TryCreateFromWindowId falhou: {ex.Message}");
                return null;
            }
        }
    }

    internal static class Direct3D11Helper
    {
        [DllImport("d3d11.dll", EntryPoint = "CreateDirect3D11DeviceFromDXGIDevice", PreserveSig = false)]
        private static extern IntPtr CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice);

        public static IDirect3DDevice CreateDirect3DDeviceFromDxgiDevice(IDXGIDevice dxgiDevice)
        {
            IntPtr dxgiPtr;
            try
            {
                dxgiPtr = dxgiDevice.NativePointer;
            }
            catch (Exception ex)
            {
                Log.E("WGC-DIAG", $"dxgiDevice.NativePointer falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }

            IntPtr winrtPtr;
            try
            {
                winrtPtr = CreateDirect3D11DeviceFromDXGIDevice(dxgiPtr);
            }
            catch (Exception ex)
            {
                Log.E("WGC-DIAG", $"d3d11!CreateDirect3D11DeviceFromDXGIDevice falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }

            try
            {
                return MarshalInterface<IDirect3DDevice>.FromAbi(winrtPtr);
            }
            catch (Exception ex)
            {
                Log.E("WGC-DIAG", $"MarshalInterface<IDirect3DDevice>.FromAbi falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }
        }
    }

    internal static class MonitorHelper
    {
        public static IntPtr GetPrimaryMonitorHandle()
        {
            return (IntPtr)Windows.Win32.PInvoke.MonitorFromPoint(
                new System.Drawing.Point(0, 0),
                Windows.Win32.Graphics.Gdi.MONITOR_FROM_FLAGS.MONITOR_DEFAULTTOPRIMARY);
        }

        public static int GetMonitorCount()
        {
            var count = 0;
            unsafe
            {
                Windows.Win32.PInvoke.EnumDisplayMonitors(
                    default,
                    (Windows.Win32.Foundation.RECT?)null,
                    (_, _, _, _) => { count++; return (Windows.Win32.Foundation.BOOL)true; },
                    default);
            }
            return count;
        }

        public static int GetMonitorFromWindow(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return 0;
            var hMonitor = Windows.Win32.PInvoke.MonitorFromWindow(
                (Windows.Win32.Foundation.HWND)hwnd,
                Windows.Win32.Graphics.Gdi.MONITOR_FROM_FLAGS.MONITOR_DEFAULTTONEAREST);
            unsafe
            {
                var mi = new Windows.Win32.Graphics.Gdi.MONITORINFO { cbSize = (uint)sizeof(Windows.Win32.Graphics.Gdi.MONITORINFO) };
                if (!Windows.Win32.PInvoke.GetMonitorInfo(hMonitor, ref mi))
                    return 0;
                return ((nint)hMonitor.Value).GetHashCode();
            }
        }

        public static IntPtr GetMonitorFromWindowHandle(IntPtr hwnd)
        {
            return (IntPtr)Windows.Win32.PInvoke.MonitorFromWindow(
                (Windows.Win32.Foundation.HWND)hwnd,
                Windows.Win32.Graphics.Gdi.MONITOR_FROM_FLAGS.MONITOR_DEFAULTTONEAREST);
        }

        public static IntPtr MonitorFromPoint(int x, int y)
        {
            return (IntPtr)Windows.Win32.PInvoke.MonitorFromPoint(
                new System.Drawing.Point(x, y),
                Windows.Win32.Graphics.Gdi.MONITOR_FROM_FLAGS.MONITOR_DEFAULTTONEAREST);
        }

        public static (int left, int top, int right, int bottom) GetMonitorRect(IntPtr hMonitor)
        {
            unsafe
            {
                var mi = new Windows.Win32.Graphics.Gdi.MONITORINFO { cbSize = (uint)sizeof(Windows.Win32.Graphics.Gdi.MONITORINFO) };
                if (!Windows.Win32.PInvoke.GetMonitorInfo((Windows.Win32.Graphics.Gdi.HMONITOR)hMonitor, ref mi))
                    return (0, 0, 0, 0);
                return (mi.rcMonitor.left, mi.rcMonitor.top, mi.rcMonitor.right, mi.rcMonitor.bottom);
            }
        }
    }

    /// <summary>
    /// Seleciona o melhor adaptador DXGI (preferência: GPU dedicada > integrada).
    /// Em notebooks com iGPU + dGPU, evita capturar na GPU errada.
    /// </summary>
    internal static class AdapterHelper
    {
        public static bool TryCreateDevice(out ID3D11Device? device, out ID3D11DeviceContext? context)
        {
            device = null;
            context = null;

            try
            {
                using var factory = DXGI.CreateDXGIFactory1<IDXGIFactory6>();
                if (factory == null) return false;

                // Preferência: GPU dedicada (dGPU) > integrada (iGPU)
                for (uint i = 0; ; i++)
                {
                    var hr = factory.EnumAdapterByGpuPreference<IDXGIAdapter>(i, GpuPreference.HighPerformance, out var adapter);
                    if (hr.Failure || adapter == null) break;

                    var desc = adapter.Description;
                    // Pular adaptadores de software (WARP, etc.)
                    if (adapter is IDXGIAdapter1 adapter1)
                    {
                        var desc1 = adapter1.Description1;
                        if (desc1.Flags.HasFlag(AdapterFlags.Software))
                        {
                            adapter.Dispose();
                            continue;
                        }
                    }

                    var flags = DeviceCreationFlags.BgraSupport;
                    var result = D3D11.D3D11CreateDevice(
                        adapter, DriverType.Unknown, flags,
                        [FeatureLevel.Level_11_1, FeatureLevel.Level_11_0],
                        out device, out _, out context);
                    adapter.Dispose();

                    if (result.Success && device != null) return true;
                    break;
                }
            }
            catch { }
            return false;
        }
    }

    /// <summary>
    /// Detecção HDR via DisplayConfigGetDeviceInfo (Win10 1703+).
    /// Retorna true se o monitor alvo estiver em modo HDR.
    /// </summary>
    internal static class HdrHelper
    {
        public static bool IsHdrActive()
        {
            try
            {
                unsafe
                {
                    var request = new Windows.Win32.Devices.Display.DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO();
                    request.header.type = Windows.Win32.Devices.Display.DISPLAYCONFIG_DEVICE_INFO_TYPE.DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO;
                    request.header.size = (uint)sizeof(Windows.Win32.Devices.Display.DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO);
                    var hr = Windows.Win32.PInvoke.DisplayConfigGetDeviceInfo(
                        (Windows.Win32.Devices.Display.DISPLAYCONFIG_DEVICE_INFO_HEADER*)&request);
                    if (hr != 0) return false;
                    return request.Anonymous.Anonymous.advancedColorEnabled;
                }
            }
            catch (Exception ex)
            {
                Log.D("HdrHelper", $"IsHdrActive failed: {ex.Message}");
                return false;
            }
        }
    }

    /// <summary>
    /// Detecção e configuração WDA (Window Display Affinity).
    /// Jogos que usam SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) não podem ser capturados.
    /// Usamos WDA_EXCLUDEFROMCAPTURE para esconder a janela DnHo do próprio recording.
    /// </summary>
    internal static class WdaHelper
    {
        public const uint WDA_NONE = 0x00;
        public const uint WDA_EXCLUDEFROMCAPTURE = 0x01;
        public const uint WDA_EXCLUEFROMCAPTURE_WIN11 = 0x11;
        public const uint WDA_EXCLUDEFROMCAPTURE_MODERN = 0x11;

        public static bool IsExcludedFromCapture(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return false;
            try
            {
                if (!Windows.Win32.PInvoke.GetWindowDisplayAffinity((Windows.Win32.Foundation.HWND)hwnd, out var affinity))
                    return false;
                return affinity == WDA_EXCLUDEFROMCAPTURE || affinity == WDA_EXCLUEFROMCAPTURE_WIN11;
            }
            catch (Exception ex)
            {
                Log.D("WdaHelper", $"IsExcludedFromCapture failed: {ex.Message}");
                return false;
            }
        }

        public static bool ExcludeWindowFromCapture(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return false;
            try
            {
                var ok = Windows.Win32.PInvoke.SetWindowDisplayAffinity(
                    (Windows.Win32.Foundation.HWND)hwnd,
                    (Windows.Win32.UI.WindowsAndMessaging.WINDOW_DISPLAY_AFFINITY)WDA_EXCLUDEFROMCAPTURE);
                if (!ok)
                {
                    ok = Windows.Win32.PInvoke.SetWindowDisplayAffinity(
                        (Windows.Win32.Foundation.HWND)hwnd,
                        (Windows.Win32.UI.WindowsAndMessaging.WINDOW_DISPLAY_AFFINITY)WDA_EXCLUDEFROMCAPTURE_MODERN);
                    if (ok)
                        Log.I("WDA", $"SetWindowDisplayAffinity(0x{WDA_EXCLUDEFROMCAPTURE_MODERN:X}) OK (Win11 variant) on hwnd=0x{hwnd:X}");
                }
                else
                {
                    Log.I("WDA", $"SetWindowDisplayAffinity(0x{WDA_EXCLUDEFROMCAPTURE:X}) OK on hwnd=0x{hwnd:X}");
                }
                if (!ok)
                    Log.D("WDA", $"SetWindowDisplayAffinity failed on hwnd=0x{hwnd:X}");
                return ok;
            }
            catch (Exception ex)
            {
                Log.W("WDA", $"SetWindowDisplayAffinity exception: {ex.Message}");
                return false;
            }
        }

        public static bool RestoreWindowCapture(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return false;
            try
            {
                var ok = Windows.Win32.PInvoke.SetWindowDisplayAffinity(
                    (Windows.Win32.Foundation.HWND)hwnd,
                    Windows.Win32.UI.WindowsAndMessaging.WINDOW_DISPLAY_AFFINITY.WDA_NONE);
                if (ok)
                    Log.I("WDA", "SetWindowDisplayAffinity(WDA_NONE) OK — window visible in capture again");
                return ok;
            }
            catch (Exception ex)
            {
                Log.W("WDA", $"RestoreWindowCapture exception: {ex.Message}");
                return false;
            }
        }
    }
}
