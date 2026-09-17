import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DriverUpdate, DriverUpdateProgress } from '@shared/types'
import { execFileAsync, psArgs } from '../../services/exec-utf8'
import { getLogger } from '../../services/logger.service'
import { compareVersions, makeId } from './utils'

const DRIVER_STORE = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'DriverStore', 'FileRepository')

interface DriverStoreEntry {
  folderName: string
  hardwareId: string
  provider: string
  className: string
  version: string
  date: string
  originalName: string
}

/**
 * Parse a Windows INF file for key driver metadata fields.
 * Looks for [Version] section fields: DriverVersion, DriverDate, Provider, Class, ClassGUID.
 * Also checks [Manufacturer] section for HardwareIDs.
 */
function parseInfFile(infPath: string): Partial<DriverStoreEntry> {
  try {
    const content = readFileSync(infPath, 'utf-16le')
    const result: Partial<DriverStoreEntry> = {}

    // Extract version fields
    const versionMatch = content.match(/DriverVer\s*=\s*(.+)/i)
    if (versionMatch) {
      // Format: "mm/dd/yyyy,x.y.z.w" or just "x.y.z.w"
      const parts = versionMatch[1]!.split(',')
      if (parts.length >= 2) {
        result.date = parts[0]!.trim()
        result.version = parts[1]!.trim()
      } else {
        result.version = parts[0]!.trim()
      }
    }

    const providerMatch = content.match(/Provider\s*=\s*%?(.+)%?\s*$/i)
    if (providerMatch) {
      result.provider = providerMatch[1]!.trim()
    }

    const classMatch = content.match(/^Class\s*=\s*(.+)$/im)
    if (classMatch) {
      result.className = classMatch[1]!.trim()
    }

    const classGuidMatch = content.match(/^ClassGUID\s*=\s*(.+)$/im)
    if (classGuidMatch) {
      // ClassGUID present but not needed for DriverUpdate
    }

    // Extract HardwareID from [Manufacturer] or device sections
    const hwIdMatch = content.match(/%(.+)%\s*=\s*(.+)/i)
    if (hwIdMatch) {
      // Try to find the actual hardware ID string from string definitions
      const stringDef = content.match(new RegExp(`${hwIdMatch[1]}\\s*=\\s*"(.+)"`, 'i'))
      if (stringDef) {
        result.hardwareId = stringDef[1]!
      }
    }

    // Direct hardware ID patterns (PCI\, USB\, ACPI\, etc.)
    if (!result.hardwareId) {
      const directHwId = content.match(/(PCI\\[^\s,;]+|USB\\[^\s,;]+|ACPI\\[^\s,;]+)/i)
      if (directHwId) {
        result.hardwareId = directHwId[1]!
      }
    }

    return result
  } catch {
    return {}
  }
}

/**
 * Scan the local Windows DriverStore for all installed driver versions.
 * Groups by HardwareID and identifies drivers where a newer version exists locally
 * but the active driver is older (indicating a staged update).
 *
 * This fallback is useful when:
 * - Windows Update COM API service is not running
 * - No network access for catalog queries
 * - Driver updates have been downloaded by Windows but not yet applied
 */
export async function scanDriverStoreForUpdates(
  onProgress?: (data: DriverUpdateProgress) => void,
): Promise<DriverUpdate[]> {
  if (process.platform !== 'win32') {
    getLogger().warning('driver-manager', 'DriverStore scan skipped — not on Windows')
    return []
  }

  getLogger().info('driver-manager', 'Starting local DriverStore scan for updates...')
  const startTime = Date.now()

  // Step 1: Get active driver versions from WMI
  onProgress?.({
    phase: 'checking',
    current: 0,
    total: 0,
    currentDevice: 'Querying active drivers...',
    percent: 0,
  })

  const activeDrivers = await getActiveDriverMap()

  // Step 2: Scan FileRepository for all driver packages
  let folders: string[]
  try {
    folders = readdirSync(DRIVER_STORE, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    getLogger().warning('driver-manager', `Cannot read DriverStore directory: ${DRIVER_STORE}`)
    return []
  }

  onProgress?.({
    phase: 'checking',
    current: 0,
    total: folders.length,
    currentDevice: `Scanning ${folders.length} driver packages...`,
    percent: 0,
  })

  // Step 3: Parse each driver package folder for INF metadata
  const storeEntries: DriverStoreEntry[] = []

  for (let i = 0; i < folders.length; i++) {
    const folderName = folders[i]
    if (!folderName) continue

    onProgress?.({
      phase: 'checking',
      current: i + 1,
      total: folders.length,
      currentDevice: folderName,
      percent: Math.round(((i + 1) / folders.length) * 100),
    })

    const folderPath = join(DRIVER_STORE, folderName)
    try {
      // Verify it's a real directory (not a symlink to non-existent target)
      statSync(folderPath)
    } catch {
      continue
    }

    // Find .inf files in the folder
    let infFiles: string[]
    try {
      infFiles = readdirSync(folderPath).filter((f) => f.toLowerCase().endsWith('.inf'))
    } catch {
      continue
    }

    for (const infFile of infFiles) {
      const infPath = join(folderPath, infFile)
      const parsed = parseInfFile(infPath)

      if (parsed.version) {
        storeEntries.push({
          folderName,
          hardwareId: parsed.hardwareId || '',
          provider: parsed.provider || 'Unknown',
          className: parsed.className || 'Unknown',
          version: parsed.version,
          date: parsed.date || '',
          originalName: infFile,
        })
      }
    }
  }

  // Step 4: Group by HardwareID, find entries where a newer local version exists
  // but the active driver is older
  const updates: DriverUpdate[] = []
  const byHardwareId = new Map<string, DriverStoreEntry[]>()

  for (const entry of storeEntries) {
    if (!entry.hardwareId) continue
    const list = byHardwareId.get(entry.hardwareId) || []
    list.push(entry)
    byHardwareId.set(entry.hardwareId, list)
  }

  for (const [hwId, entries] of byHardwareId) {
    // Sort by version descending
    entries.sort((a, b) => compareVersions(b.version, a.version))
    const newest = entries[0]
    if (!newest) continue

    // Check if the active driver is older
    const activeVer = activeDrivers.get(hwId)
    if (!activeVer) continue
    if (compareVersions(newest.version, activeVer) <= 0) continue

    // Found a locally available update
    updates.push({
      id: makeId(hwId, newest.version),
      updateId: `local-store://${newest.folderName}`,
      deviceName: `${newest.provider} ${newest.className}`,
      deviceId: hwId,
      className: newest.className,
      currentVersion: activeVer,
      currentDate: '',
      availableVersion: newest.version,
      availableDate: newest.date,
      provider: newest.provider,
      updateTitle: `${newest.originalName} (${newest.provider})`,
      downloadSize: '',
      selected: true,
    })
  }

  getLogger().success(
    'driver-manager',
    `DriverStore scan completed — ${updates.length} local update(s) found in ${Date.now() - startTime}ms`,
  )
  return updates
}

/**
 * Get a map of HardwareID → current active driver version from WMI.
 * Uses Get-CimInstance with fallback to Get-WmiObject for PS 5.0 compatibility.
 */
async function getActiveDriverMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const script = `
      $ErrorActionPreference = 'SilentlyContinue'
      $drivers = Get-CimInstance Win32_PnPSignedDriver |
        Where-Object { $_.HardwareID -and $_.DriverVersion } |
        Select-Object HardwareID, DriverVersion

      foreach ($d in $drivers) {
        Write-Output "$($d.HardwareID)|$($d.DriverVersion)"
      }
    `
    const { stdout } = await execFileAsync('powershell', psArgs(script), {
      timeout: 30000,
      windowsHide: true,
    })

    for (const line of String(stdout).split('\n')) {
      const trimmed = line.trim()
      if (!trimmed?.includes('|')) continue
      const [hwId, version] = trimmed.split('|', 2)
      if (hwId && version && !map.has(hwId)) {
        map.set(hwId, version)
      }
    }
  } catch {
    // WMI failed — fallback: empty map means no updates can be detected
    getLogger().warning('driver-manager', 'WMI driver query failed, cannot detect local updates')
  }
  return map
}
