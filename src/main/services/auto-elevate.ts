import { type ExecFileException, execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { psUtf8 } from './exec-utf8'

export type ElevationMethod = 'elevate.exe' | 'powershell'

export interface RelaunchElevatedOptions {
  /** The packaged app executable to relaunch elevated. */
  childExecutable: string
  /** process.resourcesPath — where electron-builder ships elevate.exe. */
  resourcesPath: string
  /** Extra argv forwarded to the elevated child (e.g. --dinho-data-dir=...). */
  childArgs?: string[]
  /** Called when the relaunch fails to launch (spawn/execFile error). */
  onError?: (error: Error) => void
}

export interface RelaunchElevatedResult {
  method: ElevationMethod
}

/**
 * Relaunch `childExecutable` elevated, preferring electron-builder's elevate.exe
 * (shipped under resources/) over a PowerShell `Start-Process -Verb RunAs`.
 *
 * The PowerShell + RunAs pattern inside the packaged main bundle is a classic
 * heuristic trigger for AV ML false positives (e.g. Defender
 * Trojan:Script/Wacatac.B!ml), which quarantine the bundle → first launch dies
 * with "Cannot find module .../out/main/index.js". Production installs ship
 * elevate.exe, so the PowerShell path should never run there; it stays as a
 * fallback for layouts where elevate.exe is absent.
 *
 * The caller must exit the un-elevated instance immediately after this returns
 * — the child is detached and unref'd so it survives the parent.
 */
export function relaunchElevated(opts: RelaunchElevatedOptions): RelaunchElevatedResult {
  const childArgs = opts.childArgs ?? []

  const elevateExe = join(opts.resourcesPath, 'elevate.exe')
  if (existsSync(elevateExe)) {
    const child = spawn(elevateExe, [opts.childExecutable, ...childArgs], { detached: true, stdio: 'ignore' })
    child.on('error', (err) => opts.onError?.(err))
    child.unref()
    return { method: 'elevate.exe' }
  }

  relaunchViaPowerShell(opts)
  return { method: 'powershell' }
}

function relaunchViaPowerShell(opts: RelaunchElevatedOptions): void {
  const escapedExe = opts.childExecutable.replace(/'/g, "''")
  const quotedArgs = (opts.childArgs ?? []).map((a) => `'${a.replace(/'/g, "''")}'`)
  const argList = quotedArgs.length > 0 ? ` -ArgumentList ${quotedArgs.join(',')}` : ''
  const psScript = `Start-Process -FilePath '${escapedExe}'${argList} -Verb RunAs`

  execFile('powershell.exe', ['-NoProfile', '-Command', psUtf8(psScript)], { windowsHide: true }, (err) => {
    if (err) opts.onError?.(err as ExecFileException)
  })
}
