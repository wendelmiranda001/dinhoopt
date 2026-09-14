using DiNho.Capture.Poc.Capture;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Logging;
using Vortice.DXGI;

namespace DiNho.Capture.Poc.Graphics;

/// <summary>Retângulo de um monitor na área de trabalho (coordenadas virtuais).</summary>
public readonly record struct MonitorRect(int Left, int Top, int Right, int Bottom)
{
    public bool IsEmpty => Right <= Left || Bottom <= Top;
    public int CenterX => Left + (Right - Left) / 2;
    public int CenterY => Top + (Bottom - Top) / 2;
    public bool Contains(int x, int y) => x >= Left && x < Right && y >= Top && y < Bottom;
}

/// <summary>Adapter DXGI com os rects dos outputs (monitores) que ele cobre.</summary>
public sealed record AdapterMonitor(
    int AdapterIndex,
    int VendorId,
    long VideoMemoryBytes,
    IReadOnlyList<MonitorRect> Monitors)
{
    /// <summary>True se algum output do adapter contém o CENTRO do monitor do jogo.</summary>
    public bool Covers(MonitorRect game) => !game.IsEmpty && Monitors.Any(r => r.Contains(game.CenterX, game.CenterY));
}

/// <summary>
/// Resolução do adapter de render para o jogo alvo. Função pura no núcleo
/// (<see cref="Resolve"/>), com coleta thin sobre DXGI + user32.
/// Regras: override explícito (<c>AdapterIndex</c>) do config vence; senão o adapter
/// cujo output cobre o monitor do jogo; empate → discreta NVIDIA &gt; AMD &gt; iGPU,
/// depois maior VRAM. Falha de detecção → -1 (null adapter, comportamento atual).
/// </summary>
public static class MonitorAdapterResolver
{
    public const int NoAdapter = -1;

    internal static Func<IReadOnlyList<EncoderManager.GpuAdapterInfo>> DetectAdapters = EncoderManager.DetectAllGpuAdapters;
    internal static Func<int, IReadOnlyList<MonitorRect>> EnumerateOutputRects = EnumerateOutputRectsDefault;

    public static int VendorPriority(int vendorId) => vendorId switch
    {
        0x10DE => 3,
        0x1002 => 2,
        0x8086 => 1,
        _ => 0,
    };

    /// <summary>Decisão pura: índice do adapter a usar, ou <see cref="NoAdapter"/>.</summary>
    public static int Resolve(int configuredIndex, IReadOnlyList<AdapterMonitor> adapters, MonitorRect gameMonitor)
    {
        if (configuredIndex >= 0)
        {
            foreach (var adapter in adapters)
                if (adapter.AdapterIndex == configuredIndex)
                    return configuredIndex;
        }

        if (gameMonitor.IsEmpty)
            return NoAdapter;

        var candidates = adapters.Where(a => a.Covers(gameMonitor)).ToList();
        if (candidates.Count == 0)
            return NoAdapter;

        return candidates
            .OrderByDescending(a => VendorPriority(a.VendorId))
            .ThenByDescending(a => a.VideoMemoryBytes)
            .First()
            .AdapterIndex;
    }

    /// <summary>Mapeia adapters + enumerador de outputs para a visão pura de decisão.</summary>
    public static List<AdapterMonitor> EnumerateAdapterMonitors(
        IReadOnlyList<EncoderManager.GpuAdapterInfo> adapters,
        Func<int, IReadOnlyList<MonitorRect>> getOutputRects)
    {
        var list = new List<AdapterMonitor>(adapters.Count);
        foreach (var adapter in adapters)
        {
            IReadOnlyList<MonitorRect> rects;
            try
            {
                rects = getOutputRects(adapter.Index) ?? Array.Empty<MonitorRect>();
            }
            catch
            {
                rects = Array.Empty<MonitorRect>();
            }
            list.Add(new AdapterMonitor(adapter.Index, adapter.VendorId, adapter.VideoMemoryBytes, rects));
        }
        return list;
    }

    /// <summary>
    /// Pipeline completo de produção: resolve o adapter para o hwnd do jogo e retorna
    /// a <see cref="IDXGIAdapter"/> correspondente (null = deixar o Windows decidir).
    /// </summary>
    public static IDXGIAdapter? TryResolveGameAdapter(IntPtr gameHwnd, int configuredIndex)
    {
        if (gameHwnd == IntPtr.Zero)
            return null;

        var (left, top, right, bottom) = MonitorHelper.GetMonitorRect(MonitorHelper.GetMonitorFromWindowHandle(gameHwnd));
        var gameMonitor = new MonitorRect(left, top, right, bottom);

        var adapters = DetectAdapters();
        if (adapters.Count == 0)
            return null;

        var monitors = EnumerateAdapterMonitors(adapters, EnumerateOutputRects);
        var index = Resolve(configuredIndex, monitors, gameMonitor);
        if (index < 0)
            return null;

        try
        {
            using var factory = DXGI.CreateDXGIFactory1<IDXGIFactory1>();
            return factory.EnumAdapters1((uint)index, out var adapter).Success ? adapter : null;
        }
        catch (Exception ex)
        {
            Logging.Log.W("MonitorAdapterResolver", $"Resolve adapter fail: {ex.Message}");
            return null;
        }
    }

    private static IReadOnlyList<MonitorRect> EnumerateOutputRectsDefault(int adapterIndex)
    {
        try
        {
            using var factory = DXGI.CreateDXGIFactory1<IDXGIFactory1>();
            if (!factory.EnumAdapters1((uint)adapterIndex, out var adapter).Success)
                return Array.Empty<MonitorRect>();

            using (adapter)
            {
                var rects = new List<MonitorRect>();
                for (uint output = 0; adapter.EnumOutputs(output, out var dxgiOutput).Success; output++)
                {
                    using (dxgiOutput)
                    {
                        var desc = dxgiOutput.Description;
                        rects.Add(new MonitorRect(
                            desc.DesktopCoordinates.Left,
                            desc.DesktopCoordinates.Top,
                            desc.DesktopCoordinates.Right,
                            desc.DesktopCoordinates.Bottom));
                    }
                }
                return rects;
            }
        }
        catch (Exception ex)
        {
            Logging.Log.W("MonitorAdapterResolver", $"EnumOutputs adapter {adapterIndex}: {ex.Message}");
            return Array.Empty<MonitorRect>();
        }
    }
}