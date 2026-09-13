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

    public static void Trim()
    {
        try
        {
            GCSettings.LargeObjectHeapCompactionMode =
                GCLargeObjectHeapCompactionMode.CompactOnce;
            CollectGen2Probe();
            GC.WaitForPendingFinalizers();
            SetProcessWorkingSetSizeProbe();
        }
        catch (Exception ex)
        {
            Log.W("WorkingSetTrimmer", $"Trim falhou — fail-closed: {ex.Message}");
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
