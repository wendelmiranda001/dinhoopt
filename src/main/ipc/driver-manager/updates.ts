import type {
  DriverUpdate,
  DriverUpdateInstallResult,
  DriverUpdateProgress,
  DriverUpdateScanResult,
} from '@shared/types'
import { execFileAsync, psArgs } from '../../services/exec-utf8'
import { getLogger } from '../../services/logger.service'
import { scanDriverStoreForUpdates } from './driverstore-fallback'
import { makeId } from './utils'
import { getStaleDriversForCatalog, searchCatalogForDrivers } from './wu-catalog-fallback'

// ── Fallback source enum ──
type FallbackSource = 'wu-com-api' | 'catalog-http' | 'driverstore-local'

/**
 * Driver update scan with automatic fallback chain:
 *   1. Windows Update COM API (primary — most reliable when available)
 *   2. Windows Update Catalog HTTP API (fallback — requires network)
 *   3. Local DriverStore scan (fallback — no network required)
 *
 * Each source is tried in order. If the current source throws OR returns 0 results,
 * the next source is attempted. The final result is the union of all sources.
 */
export async function scanDriverUpdates(
  onProgress?: (data: DriverUpdateProgress) => void,
): Promise<DriverUpdateScanResult> {
  const startTime = Date.now()

  getLogger().info('driver-manager', 'Starting driver update scan (with fallbacks)...')
  if (process.platform !== 'win32') {
    getLogger().warning('driver-manager', 'Driver update scan skipped — not on Windows')
    return { updates: [], allDrivers: [], totalAvailable: 0, scanDuration: Date.now() - startTime }
  }

  const allUpdates: DriverUpdate[] = []
  const usedSources: FallbackSource[] = []

  // ── Source 1: Windows Update COM API ──
  onProgress?.({
    phase: 'checking',
    current: 0,
    total: 0,
    currentDevice: 'Querying Windows Update for driver updates...',
    percent: 0,
  })

  try {
    const wuUpdates = await scanViaWuComApi(onProgress)
    if (wuUpdates.length > 0) {
      allUpdates.push(...wuUpdates)
      usedSources.push('wu-com-api')
      getLogger().info('driver-manager', `WU COM API returned ${wuUpdates.length} update(s)`)
    } else {
      getLogger().info('driver-manager', 'WU COM API returned 0 updates — trying catalog fallback')
    }
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string }
    getLogger().warning(
      'driver-manager',
      `WU COM API failed: ${e?.stderr || e?.message || 'Unknown error'} — trying catalog fallback`,
    )
  }

  // ── Source 2: Windows Update Catalog HTTP API ──
  if (allUpdates.length === 0) {
    onProgress?.({
      phase: 'checking',
      current: 0,
      total: 0,
      currentDevice: 'Searching Windows Update Catalog online...',
      percent: 0,
    })

    try {
      const staleDrivers = await getStaleDriversForCatalog()
      if (staleDrivers.length > 0) {
        const catalogUpdates = await searchCatalogForDrivers(staleDrivers, onProgress)
        if (catalogUpdates.length > 0) {
          allUpdates.push(...catalogUpdates)
          usedSources.push('catalog-http')
          getLogger().info(
            'driver-manager',
            `Catalog HTTP returned ${catalogUpdates.length} update(s) from ${staleDrivers.length} stale driver(s)`,
          )
        } else {
          getLogger().info('driver-manager', 'Catalog HTTP returned 0 updates — trying DriverStore scan')
        }
      } else {
        getLogger().info('driver-manager', 'No stale drivers found for catalog query — trying DriverStore scan')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      getLogger().warning('driver-manager', `Catalog HTTP failed: ${msg} — trying DriverStore scan`)
    }
  }

  // ── Source 3: Local DriverStore scan ──
  if (allUpdates.length === 0) {
    onProgress?.({
      phase: 'checking',
      current: 0,
      total: 0,
      currentDevice: 'Scanning local driver store...',
      percent: 0,
    })

    try {
      const storeUpdates = await scanDriverStoreForUpdates(onProgress)
      if (storeUpdates.length > 0) {
        allUpdates.push(...storeUpdates)
        usedSources.push('driverstore-local')
        getLogger().info('driver-manager', `DriverStore scan returned ${storeUpdates.length} local update(s)`)
      } else {
        getLogger().info('driver-manager', 'DriverStore scan returned 0 updates')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      getLogger().warning('driver-manager', `DriverStore scan failed: ${msg}`)
    }
  }

  // ── Query ALL installed drivers (for display) ──
  let allInstalled: DriverUpdate[] = []
  try {
    allInstalled = await queryAllInstalledDrivers()
    // Cross-reference: mark drivers that have available updates
    const updateIds = new Set(allUpdates.map((u) => u.deviceId))
    for (const drv of allInstalled) {
      if (updateIds.has(drv.deviceId)) {
        drv.isUpToDate = false
      }
    }
    getLogger().info(
      'driver-manager',
      `Listed ${allInstalled.length} installed driver(s) (${allUpdates.length} with updates available)`,
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    getLogger().warning('driver-manager', `Failed to list installed drivers: ${msg}`)
  }

  const duration = Date.now() - startTime
  getLogger().success(
    'driver-manager',
    `Driver update scan completed — ${allUpdates.length} update(s) from [${usedSources.join(', ') || 'none'}] in ${duration}ms`,
  )

  return {
    updates: allUpdates,
    allDrivers: allInstalled,
    totalAvailable: allUpdates.length,
    scanDuration: duration,
  }
}

/**
 * Scan via the Windows Update COM API (Microsoft.Update.Session).
 * This is the primary source — most reliable when the WU service is running.
 */
async function scanViaWuComApi(onProgress?: (data: DriverUpdateProgress) => void): Promise<DriverUpdate[]> {
  const script = `
        $ErrorActionPreference = 'Stop'
        $session = New-Object -ComObject Microsoft.Update.Session
        $searcher = $session.CreateUpdateSearcher()
        $criteria = "IsInstalled=0 AND Type='Driver'"
        $result = $searcher.Search($criteria)

        # Cache installed driver table once (expensive query)
        $wmiDrivers = @()
        try {
          $wmiDrivers = @(Get-CimInstance Win32_PnPSignedDriver | Select-Object HardWareID, DriverVersion, DriverDate)
        } catch {
          try {
            $wmiDrivers = @(Get-WmiObject Win32_PnPSignedDriver | Select-Object HardWareID, DriverVersion, DriverDate)
          } catch {}
        }

        foreach ($update in $result.Updates) {
          $driver = $update.DriverModel
          $ver = $update.DriverVerDate
          $hwId = ''
          if ($update.DriverHardwareID) { $hwId = $update.DriverHardwareID }
          $cls = $update.DriverClass
          $provider = $update.DriverProvider
          $title = $update.Title
          $size = ''
          if ($update.MaxDownloadSize -gt 0) {
            $mb = [math]::Round($update.MaxDownloadSize / 1MB, 1)
            $size = "$mb MB"
          }
          $verStr = ''
          if ($update.DriverVerDate) {
            $verStr = $update.DriverVerDate.ToString('yyyy-MM-dd')
          }

          # Look up current installed version from cached driver data
          $currentVer = ''
          $currentDate = ''
          if ($hwId -and $wmiDrivers.Count -gt 0) {
            $installed = $wmiDrivers | Where-Object { $_.HardWareID -eq $hwId } | Select-Object -First 1
            if ($installed) {
              $currentVer = $installed.DriverVersion
              if ($installed.DriverDate) {
                try {
                  if ($installed.DriverDate -is [datetime]) {
                    $currentDate = $installed.DriverDate.ToString('yyyy-MM-dd')
                  } else {
                    $currentDate = ([Management.ManagementDateTimeConverter]::ToDateTime($installed.DriverDate)).ToString('yyyy-MM-dd')
                  }
                } catch {}
              }
            }
          }

          $wuId = $update.Identity.UpdateID
          Write-Output "DRVUPD|$($driver)|$($hwId)|$($cls)|$($currentVer)|$($currentDate)|$($wuId)|$($verStr)|$($provider)|$($title)|$($size)"
        }

        if ($result.Updates.Count -eq 0) {
          Write-Output 'DRVUPD_NONE'
        }
      `

  const { stdout } = await execFileAsync('powershell', psArgs(script), {
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  })

  const updates: DriverUpdate[] = []
  const lines = String(stdout)
    .trim()
    .split('\n')
    .map((l: string) => l.trim())
    .filter(Boolean)

  const totalCount = lines.filter((l) => l.startsWith('DRVUPD|')).length
  let idx = 0

  for (const line of lines) {
    if (line === 'DRVUPD_NONE') break
    if (!line.startsWith('DRVUPD|')) continue

    const parts = line.split('|')
    if (parts.length < 11) continue

    const deviceName = parts[1] || 'Unknown Device'
    const deviceId = parts[2] || ''
    const className = parts[3] || 'Unknown'
    const currentVersion = parts[4] || ''
    const currentDate = parts[5] || ''
    const updateId = parts[6] || ''
    const availableDate = parts[7] || ''
    const provider = parts[8] || 'Unknown'
    const updateTitle = parts[9] || deviceName
    const downloadSize = parts[10] || ''

    const versionMatch = updateTitle.match(/(\d+\.\d+\.\d+[.\d]*)/)
    const availableVersion = versionMatch?.[1] || availableDate

    idx++
    onProgress?.({
      phase: 'checking',
      current: idx,
      total: totalCount,
      currentDevice: deviceName,
      percent: Math.round((idx / totalCount) * 100),
    })

    updates.push({
      id: makeId(updateId || deviceName, availableVersion),
      updateId,
      deviceName,
      deviceId,
      className,
      currentVersion,
      currentDate,
      availableVersion,
      availableDate,
      provider,
      updateTitle,
      downloadSize,
      selected: true,
    })
  }

  return updates
}

/**
 * Query ALL installed PnP signed drivers from the local system.
 * Returns a DriverUpdate[] with isUpToDate=true for drivers that have no available update.
 * The cross-reference with available updates is done in scanDriverUpdates().
 */
async function queryAllInstalledDrivers(): Promise<DriverUpdate[]> {
  const script = `
        $ErrorActionPreference = 'Stop'
        $drivers = @()
        try {
          $drivers = @(Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.HardWareID -and $_.DeviceName } |
            Select-Object DeviceName, HardWareID, DriverClassName, DriverVersion, DriverDate, DriverProviderName)
        } catch {
          try {
            $drivers = @(Get-WmiObject Win32_PnPSignedDriver | Where-Object { $_.HardWareID -and $_.DeviceName } |
              Select-Object DeviceName, HardWareID, DriverClassName, DriverVersion, DriverDate, DriverProviderName)
          } catch {}
        }

        foreach ($drv in $drivers) {
          $name = $drv.DeviceName
          $hwId = $drv.HardWareID
          $cls = $drv.DriverClassName
          if (-not $cls) { $cls = 'Unknown' }
          $ver = $drv.DriverVersion
          if (-not $ver) { $ver = '' }
          $date = ''
          if ($drv.DriverDate) {
            try {
              if ($drv.DriverDate -is [datetime]) {
                $date = $drv.DriverDate.ToString('yyyy-MM-dd')
              } else {
                $date = ([Management.ManagementDateTimeConverter]::ToDateTime($drv.DriverDate)).ToString('yyyy-MM-dd')
              }
            } catch {}
          }
          $provider = $drv.DriverProviderName
          if (-not $provider) { $provider = 'Unknown' }

          Write-Output "INSTDRV|$($name)|$($hwId)|$($cls)|$($ver)|$($date)|$($provider)"
        }
      `

  const { stdout } = await execFileAsync('powershell', psArgs(script), {
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  })

  const drivers: DriverUpdate[] = []
  const seen = new Set<string>()

  const lines = String(stdout)
    .trim()
    .split('\n')
    .map((l: string) => l.trim())
    .filter(Boolean)

  for (const line of lines) {
    if (!line.startsWith('INSTDRV|')) continue

    const parts = line.split('|')
    if (parts.length < 7) continue

    const deviceName = parts[1] || 'Unknown Device'
    const deviceId = parts[2] || ''
    const className = parts[3] || 'Unknown'
    const currentVersion = parts[4] || ''
    const currentDate = parts[5] || ''
    const provider = parts[6] || 'Unknown'

    // Deduplicate by hardware ID (WMI can return duplicates)
    const key = deviceId || deviceName
    if (seen.has(key)) continue
    seen.add(key)

    drivers.push({
      id: makeId(deviceId || deviceName, currentVersion),
      updateId: '',
      deviceName,
      deviceId,
      className,
      currentVersion,
      currentDate,
      availableVersion: '',
      availableDate: '',
      provider,
      updateTitle: deviceName,
      downloadSize: '',
      selected: false,
      isUpToDate: true, // default; cross-reference in scanDriverUpdates() may flip to false
    })
  }

  // Sort by class name, then device name
  drivers.sort((a, b) => {
    const clsCmp = a.className.localeCompare(b.className)
    return clsCmp !== 0 ? clsCmp : a.deviceName.localeCompare(b.deviceName)
  })

  return drivers
}

export async function installDriverUpdates(
  wuUpdateIds: string[],
  onProgress?: (data: DriverUpdateProgress) => void,
): Promise<DriverUpdateInstallResult> {
  getLogger().info('driver-manager', `Starting driver update install for ${wuUpdateIds.length} update(s)...`)
  if (process.platform !== 'win32') {
    getLogger().warning('driver-manager', 'Driver update install skipped — not on Windows')
    return { installed: 0, failed: 0, rebootRequired: false, errors: [] }
  }

  let installed = 0
  let failed = 0
  let rebootRequired = false
  const errors: { deviceName: string; reason: string }[] = []

  if (wuUpdateIds.length === 0) {
    getLogger().warning('driver-manager', 'No driver update IDs provided for install')
    return { installed: 0, failed: 0, rebootRequired: false, errors: [] }
  }

  onProgress?.({
    phase: 'downloading',
    current: 0,
    total: wuUpdateIds.length,
    currentDevice: 'Preparing driver updates...',
    percent: 0,
  })

  try {
    // Build a PS array literal of the WU UpdateIDs for exact matching
    const idsArray = wuUpdateIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',')

    const script = `
          $ErrorActionPreference = 'Stop'
          $selectedIds = @(${idsArray})

          $session = New-Object -ComObject Microsoft.Update.Session
          $searcher = $session.CreateUpdateSearcher()
          $result = $searcher.Search("IsInstalled=0 AND Type='Driver'")

          $toInstall = New-Object -ComObject Microsoft.Update.UpdateColl

          foreach ($update in $result.Updates) {
            if ($selectedIds -contains $update.Identity.UpdateID) {
              $update.AcceptEula()
              $toInstall.Add($update) | Out-Null
            }
          }

          if ($toInstall.Count -eq 0) {
            Write-Output 'RESULT|0|0|false'
            return
          }

          # Download
          $downloader = $session.CreateUpdateDownloader()
          $downloader.Updates = $toInstall
          Write-Output "STATUS|downloading|$($toInstall.Count)"
          $dlResult = $downloader.Download()

          # Install
          $installer = $session.CreateUpdateInstaller()
          $installer.Updates = $toInstall
          Write-Output "STATUS|installing|$($toInstall.Count)"
          $installResult = $installer.Install()

          $ok = 0
          $fail = 0
          $reboot = $installResult.RebootRequired

          for ($i = 0; $i -lt $toInstall.Count; $i++) {
            $r = $installResult.GetUpdateResult($i)
            $name = $toInstall.Item($i).Title
            if ($r.ResultCode -eq 2) {
              $ok++
              Write-Output "INSTALLED|$name"
            } else {
              $fail++
              Write-Output "FAILED|$name|ResultCode=$($r.ResultCode)"
            }
          }

          Write-Output "RESULT|$ok|$fail|$reboot"
        `

    const { stdout } = await execFileAsync('powershell', psArgs(script), {
      timeout: 600000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    })

    const lines = String(stdout)
      .trim()
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean)

    for (const line of lines) {
      if (line.startsWith('STATUS|')) {
        const parts = line.split('|')
        const phase = parts[1] === 'installing' ? ('installing' as const) : ('downloading' as const)
        const total = Number.parseInt(parts[2]!, 10) || wuUpdateIds.length
        onProgress?.({
          phase,
          current: 0,
          total,
          currentDevice: phase === 'installing' ? 'Installing drivers...' : 'Downloading drivers...',
          percent: phase === 'installing' ? 50 : 25,
        })
      } else if (line.startsWith('INSTALLED|')) {
        installed++
        const name = line.substring('INSTALLED|'.length)
        onProgress?.({
          phase: 'installing',
          current: installed + failed,
          total: wuUpdateIds.length,
          currentDevice: name,
          percent: Math.round(((installed + failed) / wuUpdateIds.length) * 100),
        })
      } else if (line.startsWith('FAILED|')) {
        failed++
        const parts = line.split('|')
        errors.push({ deviceName: parts[1] || 'Unknown', reason: parts[2] || 'Install failed' })
      } else if (line.startsWith('RESULT|')) {
        const parts = line.split('|')
        installed = Number.parseInt(parts[1]!, 10) || installed
        failed = Number.parseInt(parts[2]!, 10) || failed
        rebootRequired = parts[3] === 'True' || parts[3] === 'true'
      }
    }
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string }
    const msg = e?.stderr || e?.message || 'Unknown error'
    errors.push({ deviceName: 'Windows Update', reason: msg.slice(0, 300) })
    if (installed === 0) failed = wuUpdateIds.length
  }

  const result = { installed, failed, rebootRequired, errors }
  if (result.failed > 0) {
    getLogger().error(
      'driver-manager',
      `Driver update install completed with ${result.failed} failure(s) — ${result.installed} installed, reboot: ${result.rebootRequired}`,
    )
  } else {
    getLogger().success(
      'driver-manager',
      `Driver update install completed — ${result.installed} installed, reboot: ${result.rebootRequired}`,
    )
  }
  return result
}
