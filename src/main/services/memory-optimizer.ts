import { execFile } from 'node:child_process'
import * as si from 'systeminformation'
import { psUtf8 } from './exec-utf8'
import { getLogger } from './logger.service'

export interface MemoryInfo {
  totalBytes: number
  availableBytes: number
  usedBytes: number
  usedPercent: number
  cachedBytes: number
}

export interface MemoryProcess {
  pid: number
  name: string
  workingSetBytes: number
}

export interface MemoryOptimizeStep {
  name: string
  success: boolean
  freedBytes: number
  error?: string
}

export interface MemoryOptimizeProgress {
  step: number
  totalSteps: number
  label: string
  detail: string
}

export type ProgressCallback = (progress: MemoryOptimizeProgress) => void

const GC_COLLECT_TIMEOUT_MS = 15_000
const WORKINGSET_TIMEOUT_MS = 30_000

function runPs(script: string, timeout = WORKINGSET_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psUtf8(script)],
      { timeout, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const msg = stderr ? `${err.message} (stderr: ${stderr.trimEnd()})` : err.message
          reject(new Error(msg))
        } else {
          resolve(stdout)
        }
      },
    )
  })
}

function calcFreed(before: number, after: number): number {
  return Math.max(0, before - after)
}

export async function getMemoryInfo(): Promise<MemoryInfo> {
  const mem = await si.mem()
  return {
    totalBytes: mem.total,
    availableBytes: mem.available,
    usedBytes: mem.total - mem.available,
    usedPercent: Math.round(((mem.total - mem.available) / mem.total) * 100),
    cachedBytes: mem.cached || 0,
  }
}

export async function getMemoryProcesses(top = 20): Promise<MemoryProcess[]> {
  const processes = await si.processes()
  return processes.list
    .filter((p) => p.memRss > 0)
    .sort((a, b) => b.memRss - a.memRss)
    .slice(0, top)
    .map((p) => ({
      pid: p.pid,
      name: p.name,
      workingSetBytes: p.memRss,
    }))
}

export async function optimizeMemory(
  onProgress?: ProgressCallback,
): Promise<{ success: boolean; freedBytes: number; steps: MemoryOptimizeStep[]; error?: string }> {
  const steps: MemoryOptimizeStep[] = []
  let totalFreed = 0

  const notify = (step: number, totalSteps: number, label: string, detail: string) => {
    onProgress?.({ step, totalSteps, label, detail })
  }

  const TOTAL_STEPS = 2

  // Step 1: Force .NET garbage collection
  notify(1, TOTAL_STEPS, 'gc', 'Collecting .NET garbage...')
  try {
    const before = (await si.mem()).used
    await runPs(
      '[System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers(); [System.GC]::Collect()',
      GC_COLLECT_TIMEOUT_MS,
    )
    const after = (await si.mem()).used
    const freed = calcFreed(before, after)
    totalFreed += freed
    steps.push({ name: 'gc', success: true, freedBytes: freed })
  } catch (err) {
    steps.push({ name: 'gc', success: false, freedBytes: 0, error: String(err) })
  }

  // Step 2: Empty working sets via multiple approaches
  // Tries .NET reflection first (avoids Add-Type), then falls back to
  // EmptyWorkingSet via Add-Type if reflection is unavailable.
  notify(2, TOTAL_STEPS, 'workingset', 'Emptying working sets...')
  try {
    const before = (await si.mem()).used
    await runPs(
      `$ErrorActionPreference = 'Stop'
$method = $null
try { $method = [System.Diagnostics.Process].GetMethod('SetWorkingSetSize', [System.Reflection.BindingFlags]'NonPublic,Instance') } catch {}
if ($method) {
  Get-Process | Where-Object { $_.Id -ne $pid } | ForEach-Object {
    try { $method.Invoke($_, @([IntPtr](-1), [IntPtr](-1))) } catch {}
  }
} else {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MemUtil {
  [DllImport("kernel32.dll")]
  public static extern bool EmptyWorkingSet(IntPtr hProcess);
}
'@ -ErrorAction Stop
  Get-Process | Where-Object { $_.Id -ne $pid } | ForEach-Object {
    try { [MemUtil]::EmptyWorkingSet($_.Handle) } catch {}
  }
}`,
      WORKINGSET_TIMEOUT_MS,
    )
    const after = (await si.mem()).used
    const freed = calcFreed(before, after)
    totalFreed += freed
    steps.push({ name: 'workingset', success: true, freedBytes: freed })
  } catch (err) {
    getLogger().error('memory', `Working set trimming failed: ${String(err)}`)
    steps.push({ name: 'workingset', success: false, freedBytes: 0, error: String(err) })
  }

  return {
    success: steps.some((s) => s.success),
    freedBytes: totalFreed,
    steps,
  }
}
