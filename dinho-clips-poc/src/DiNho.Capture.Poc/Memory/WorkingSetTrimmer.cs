using System.Runtime;
using System.Runtime.InteropServices;
using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Memory;

/// <summary>
/// Trim do working set pós-save: força compactação LOH + coleta gen2 e devolve
/// as páginas ao SO via SetProcessWorkingSetSize(-1, -1). Probes estáticas
/// internas (Action) para testes determinísticos sem GC real. Fail-closed:
/// qualquer exceção é logada e não propaga — nunca derruba o pipeline.
/// </summary>
public static class WorkingSetTrimmer
{
    internal static Action CollectGen2Probe = () =>
        GC.Collect(2, GCCollectionMode.Forced, true, true);

    internal static Action SetProcessWorkingSetSizeProbe = TrimWorkingSet;

    // 6.9: fonte de tempo injetável p/ tests determinísticos (mesmo padrão das probes).
    internal static Func<DateTime> NowProbe = () => DateTime.UtcNow;

    /// <summary>Intervalo mínimo entre trims — evita gen2+trim consecutivos
    /// quando um save é seguido de perto por outro save/trim de fundo.</summary>
    internal static TimeSpan MinimumInterval { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>Último trim bem-sucedido (UTC). Reesetável em teste.</summary>
    internal static DateTime? LastTrimUtc { get; set; }

    private static readonly Lock Sync = new();

    public static bool Trim()
    {
        lock (Sync)
        {
            var now = NowProbe();
            if (LastTrimUtc is { } last && now - last < MinimumInterval)
                return false; // throttle: trim recente, pulando gen2/working-set redundante

            try
            {
                GCSettings.LargeObjectHeapCompactionMode =
                    GCLargeObjectHeapCompactionMode.CompactOnce;
                CollectGen2Probe();
                GC.WaitForPendingFinalizers();
                SetProcessWorkingSetSizeProbe();
                LastTrimUtc = now;
                return true;
            }
            catch (Exception ex)
            {
                Log.W("WorkingSetTrimmer", $"Trim falhou — fail-closed: {ex.Message}");
                return false; // não registra tempo: próximo Trim reaproveita o retry
            }
        }
    }

    private static void TrimWorkingSet()
    {
        IntPtr process = GetCurrentProcess();
        // (-1, -1) = trim das páginas de trabalho do processo ao working set mínimo.
        SetProcessWorkingSetSize(process, new UIntPtr(uint.MaxValue), new UIntPtr(uint.MaxValue));
    }

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "GetCurrentProcess")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "SetProcessWorkingSetSize")]
    private static extern bool SetProcessWorkingSetSize(
        IntPtr hProcess, UIntPtr dwMinimumWorkingSetSize, UIntPtr dwMaximumWorkingSetSize);
}
