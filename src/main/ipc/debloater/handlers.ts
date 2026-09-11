import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/channels'
import type { BloatwareApp } from '@shared/types'
import { ipcMain } from 'electron'
import { logAudit } from '../../services/audit-log'
import { execFileAsync, psArgs } from '../../services/exec-utf8'
import { validateStringArray } from '../../services/ipc-validation'
import { getLogger } from '../../services/logger.service'
import type { WindowGetter } from '../index'
import { validateSender } from '../sender-validation'
import { clearWin32Cache, win32UninstallCommands } from './bloatware/registry'
import { THIRD_PARTY_BLOATWARE } from './bloatware/third-party'
import { MS_BLOATWARE } from './bloatware/windows'

export { clearWin32Cache }

// Known bloatware packages with metadata
export const KNOWN_BLOATWARE: Omit<BloatwareApp, 'id' | 'size' | 'selected'>[] = [
  ...MS_BLOATWARE,
  ...THIRD_PARTY_BLOATWARE,
]

// ── Exported core logic ──

export async function scanBloatware(): Promise<BloatwareApp[]> {
  const logger = getLogger()
  const apps: BloatwareApp[] = []
  const foundBloatwareKeys = new Set<string>()
  win32UninstallCommands.clear()
  logger.info('debloater', 'Scanning for bloatware...')

  try {
    const appxScript = `Get-AppxPackage | ForEach-Object {
        $size = 0
        if ($_.InstallLocation -and (Test-Path $_.InstallLocation)) {
          $size = (Get-ChildItem -Path $_.InstallLocation -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
          if (-not $size) { $size = 0 }
        }
        [PSCustomObject]@{ Name = $_.Name; PackageFullName = $_.PackageFullName; InstallLocation = $_.InstallLocation; Size = $size }
      } | ConvertTo-Json -Compress`
    const { stdout } = await execFileAsync('powershell', psArgs(appxScript), { timeout: 60000, windowsHide: true })

    let installedPackages: { Name: string; PackageFullName: string; InstallLocation: string; Size: number }[] = []
    try {
      const parsed = JSON.parse(stdout)
      installedPackages = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      installedPackages = []
    }

    for (const bloatware of KNOWN_BLOATWARE) {
      const matchedPkg = installedPackages.find(
        (p) => p.Name === bloatware.packageName || p.Name.startsWith(`${bloatware.packageName}.`),
      )

      if (matchedPkg) {
        foundBloatwareKeys.add(bloatware.packageName)

        let sizeStr = 'Unknown'
        const bytes = matchedPkg.Size || 0
        if (bytes > 0) {
          if (bytes > 1024 * 1024 * 1024) sizeStr = `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
          else if (bytes > 1024 * 1024) sizeStr = `${(bytes / (1024 * 1024)).toFixed(1)} MB`
          else if (bytes > 1024) sizeStr = `${(bytes / 1024).toFixed(0)} KB`
          else sizeStr = `${bytes} B`
        }

        apps.push({
          id: randomUUID(),
          name: bloatware.name,
          packageName: matchedPkg.Name,
          publisher: bloatware.publisher,
          category: bloatware.category,
          description: bloatware.description,
          size: sizeStr,
          selected: false,
        })
      }
    }
  } catch (error) {
    getLogger().warning('debloater', `Phase 1 scan error: ${error}`)
  }

  // Phase 2: Scan provisioned AppX packages (staged for new users)
  try {
    const provScript = `Get-AppxProvisionedPackage -Online | Select-Object @{N='Name';E={$_.DisplayName}} | ConvertTo-Json -Compress`
    const { stdout: provStdout } = await execFileAsync('powershell', psArgs(provScript), {
      timeout: 30000,
      windowsHide: true,
    })

    let provisionedPackages: { Name: string }[] = []
    try {
      const parsed = JSON.parse(provStdout)
      provisionedPackages = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      provisionedPackages = []
    }

    for (const bloatware of KNOWN_BLOATWARE) {
      if (foundBloatwareKeys.has(bloatware.packageName)) continue

      const matchedPkg = provisionedPackages.find(
        (p) => p.Name === bloatware.packageName || p.Name.startsWith(`${bloatware.packageName}.`),
      )

      if (matchedPkg) {
        foundBloatwareKeys.add(bloatware.packageName)

        apps.push({
          id: randomUUID(),
          name: bloatware.name,
          packageName: matchedPkg.Name,
          publisher: bloatware.publisher,
          category: bloatware.category,
          description: bloatware.description,
          size: 'Provisioned',
          selected: false,
        })
      }
    }
  } catch (error) {
    getLogger().warning('debloater', `Phase 2 scan error: ${error}`)
  }

  // Phase 3: Scan Win32 classic programs via registry
  try {
    const win32Script = `$paths = @(
        'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
      ); $paths | ForEach-Object { Get-ItemProperty $_ -ErrorAction SilentlyContinue } | Where-Object { $_.DisplayName } | Select-Object DisplayName, Publisher, EstimatedSize, UninstallString, QuietUninstallString, ProductCode | ConvertTo-Json -Compress`
    const { stdout: win32Stdout } = await execFileAsync('powershell', psArgs(win32Script), {
      timeout: 30000,
      windowsHide: true,
    })

    let win32Apps: {
      DisplayName: string
      Publisher: string
      EstimatedSize: number
      UninstallString: string
      QuietUninstallString: string
      ProductCode: string
    }[] = []
    try {
      const parsed = JSON.parse(win32Stdout)
      win32Apps = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      win32Apps = []
    }

    for (const bloatware of KNOWN_BLOATWARE) {
      if (foundBloatwareKeys.has(bloatware.packageName)) continue

      const nameLower = bloatware.name.toLowerCase()
      const pkgNameLower = bloatware.packageName.toLowerCase()

      const matched = win32Apps.find((app) => {
        const dn = (app.DisplayName || '').toLowerCase()
        return dn.includes(nameLower) || dn.includes(pkgNameLower)
      })

      if (!matched) continue

      foundBloatwareKeys.add(bloatware.packageName)

      // Cache uninstall info for removal
      if (matched.QuietUninstallString) {
        win32UninstallCommands.set(bloatware.packageName, { type: 'exe', command: matched.QuietUninstallString })
      } else if (matched.UninstallString) {
        win32UninstallCommands.set(bloatware.packageName, { type: 'exe', command: matched.UninstallString })
      }
      if (matched.ProductCode) {
        win32UninstallCommands.set(bloatware.packageName, { type: 'msi', command: matched.ProductCode })
      }

      let sizeStr = 'Win32'
      const estKB = matched.EstimatedSize || 0
      if (estKB > 0) {
        const bytes = estKB * 1024
        if (bytes > 1024 * 1024 * 1024) sizeStr = `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
        else if (bytes > 1024 * 1024) sizeStr = `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        else if (bytes > 1024) sizeStr = `${(bytes / 1024).toFixed(0)} KB`
        else sizeStr = `${bytes} B`
      }

      apps.push({
        id: randomUUID(),
        name: bloatware.name,
        packageName: bloatware.packageName,
        publisher: bloatware.publisher,
        category: bloatware.category,
        description: bloatware.description,
        size: sizeStr,
        selected: false,
      })
    }
  } catch (error) {
    getLogger().warning('debloater', `Phase 3 scan error: ${error}`)
  }

  getLogger().success('debloater', `Scan complete — found ${apps.length} bloatware apps`)
  return apps
}

export async function removeBloatware(
  packageNames: string[],
  onProgress?: (current: number, total: number, currentApp: string, status: 'removing' | 'done' | 'failed') => void,
): Promise<{ removed: number; failed: number }> {
  const logger = getLogger()
  const knownNames = new Set(KNOWN_BLOATWARE.map((b) => b.packageName))
  logger.info('debloater', `Removing ${packageNames.length} bloatware app(s)...`)
  const validNames = packageNames.filter((name) => typeof name === 'string' && knownNames.has(name))

  let removed = 0
  let failed = 0

  for (let i = 0; i < validNames.length; i++) {
    const pkgName = validNames[i]!
    const safeName = pkgName.replace(/'/g, "''")
    onProgress?.(i + 1, validNames.length, pkgName, 'removing')

    const win32Cmd = win32UninstallCommands.get(pkgName)
    if (win32Cmd) {
      try {
        if (win32Cmd.type === 'msi') {
          await execFileAsync('msiexec', ['/x', win32Cmd.command, '/quiet', '/norestart'], {
            timeout: 60000,
            windowsHide: true,
          })
        } else {
          await execFileAsync('cmd.exe', ['/c', win32Cmd.command], { timeout: 60000, windowsHide: true })
        }
        removed++
        onProgress?.(i + 1, validNames.length, pkgName, 'done')
      } catch {
        failed++
        onProgress?.(i + 1, validNames.length, pkgName, 'failed')
        logger.warning('debloater', `uninstall failed for ${pkgName}`)
      }
      continue
    }

    // AppX removal path
    try {
      await execFileAsync(
        'powershell',
        psArgs(`Get-AppxPackage '${safeName}' | Remove-AppxPackage -ErrorAction Stop`),
        { timeout: 30000, windowsHide: true },
      )
      removed++
      onProgress?.(i + 1, validNames.length, pkgName, 'done')

      try {
        await execFileAsync(
          'powershell',
          psArgs(
            `Get-AppxProvisionedPackage -Online | Where-Object { $_.DisplayName -eq '${safeName}' } | Remove-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue`,
          ),
          { timeout: 15000, windowsHide: true },
        )
      } catch {
        // Deprovisioning failed (needs admin) — not critical
      }
    } catch {
      failed++
      onProgress?.(i + 1, validNames.length, pkgName, 'failed')
      logger.warning('debloater', `uninstall failed for ${pkgName}`)
    }
  }

  logger.info('debloater', `Removal finished — ${removed} succeeded, ${failed} failed`)
  return { removed, failed }
}

// ── IPC registration ──

export function registerDebloaterIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.DEBLOATER_SCAN, () => {
    if (process.platform !== 'win32') return []
    return scanBloatware()
  })

  ipcMain.handle(
    IPC.DEBLOATER_REMOVE,
    async (event, packageNames: string[]): Promise<{ removed: number; failed: number }> => {
      if (!validateSender(event, getWindow())) return { removed: 0, failed: 0 }
      if (process.platform !== 'win32') return { removed: 0, failed: 0 }
      const valid = validateStringArray(packageNames, 500)
      if (!valid) return { removed: 0, failed: 0 }
      const result = await removeBloatware(valid, (current, total, currentApp, status) => {
        const win = getWindow()
        if (win && !win.isDestroyed())
          win.webContents.send(IPC.DEBLOATER_REMOVE_PROGRESS, { current, total, currentApp, status })
      })
      logAudit('DEBLOATER_REMOVE', 'debloater', {
        packages: valid,
        removed: result.removed,
        failed: result.failed,
      })
      return result
    },
  )
}
