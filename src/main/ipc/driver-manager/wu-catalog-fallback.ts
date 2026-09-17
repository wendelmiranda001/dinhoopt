import type { DriverUpdate, DriverUpdateProgress } from '@shared/types'
import { execFileAsync, psArgs } from '../../services/exec-utf8'
import { getLogger } from '../../services/logger.service'
import { makeId } from './utils'

export interface StaleDriver {
  hardwareId: string
  deviceName: string
  currentVersion: string
  className: string
}

/**
 * Parse the Windows Update Catalog HTML response for a single driver search.
 * Extracts update rows from the HTML table and returns structured DriverUpdate[].
 *
 * The catalog v7 search API returns an HTML page with a results table.
 * Each row contains: checkbox, title (with version), products, classification, last updated, size.
 * The UpdateID is embedded in the row HTML in an onclick or data attribute.
 */
export function parseCatalogHtml(html: string, driver: StaleDriver): DriverUpdate[] {
  const results: DriverUpdate[] = []

  // Split HTML into table rows — match <tr> elements with their content
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch: RegExpExecArray | null

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const fullRow = rowMatch[0] // includes <tr> tag with attributes
    const rowHtml = rowMatch[1]! // content between <tr> and </tr>

    // Extract UpdateID from the <tr> tag attributes — patterns:
    //   data-updateid="{GUID}"
    //   updateid="{GUID}"
    //   onclick="...'{GUID}'..."
    let updateId = ''
    const idPatterns = [
      /data-updateid\s*=\s*["']?\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
      /updateid\s*[:=]\s*["']?\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    ]
    for (const pat of idPatterns) {
      const m = fullRow.match(pat)
      if (m) {
        updateId = m[1]!
        break
      }
    }
    if (!updateId) continue

    // Skip header/empty rows (no <a> tag means it's a header or spacer)
    if (!/<a\b/i.test(rowHtml)) continue

    // Extract all <td> cell contents (strip HTML tags)
    const cellRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi
    const cells: string[] = []
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      // Strip HTML tags, collapse whitespace, trim
      const text = cellMatch[1]!
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      cells.push(text)
    }

    // Typical column order: checkbox | title | products | classification | lastUpdated | size
    if (cells.length < 5) continue

    const title = cells[1] || cells[0] || ''
    if (!title || title.length < 3) continue

    const products = cells[2] || ''
    const lastUpdated = cells[4] || ''
    const size = cells[5] || ''

    // Extract version from title — common patterns:
    //   "NVIDIA GeForce - 31.0.15.5135"
    //   "Realtek Semiconductor - 6.0.1.8638"
    //   "Intel(R) Corporation - 10.1.2.19"
    let version = ''
    const versionPatterns = [/(?:-\s*|version\s+)(\d+\.\d+\.\d+[.\d]*)/i, /(\d+\.\d+\.\d+\.\d+)/]
    for (const pat of versionPatterns) {
      const vm = title.match(pat)
      if (vm) {
        version = vm[1]!
        break
      }
    }

    results.push({
      id: makeId(updateId, version || lastUpdated),
      updateId,
      deviceName: driver.deviceName,
      deviceId: driver.hardwareId,
      className: driver.className,
      currentVersion: driver.currentVersion,
      currentDate: '',
      availableVersion: version || lastUpdated,
      availableDate: lastUpdated,
      provider: products || 'Microsoft Update Catalog',
      updateTitle: title,
      downloadSize: size,
      selected: true,
    })
  }

  return results
}

/**
 * Search the Windows Update Catalog for driver updates by HardwareID.
 * Uses PowerShell Invoke-WebRequest to handle HTTPS, cookies, and proxy settings.
 * Returns DriverUpdate[] compatible with the WU COM API format.
 */
export async function searchCatalogForDrivers(
  staleDrivers: StaleDriver[],
  onProgress?: (data: DriverUpdateProgress) => void,
): Promise<DriverUpdate[]> {
  if (staleDrivers.length === 0) return []

  const updates: DriverUpdate[] = []
  const seen = new Set<string>()

  for (let i = 0; i < staleDrivers.length; i++) {
    const driver = staleDrivers[i]!
    if (!driver.hardwareId) continue

    onProgress?.({
      phase: 'checking',
      current: i + 1,
      total: staleDrivers.length,
      currentDevice: `Searching catalog: ${driver.deviceName}`,
      percent: Math.round(((i + 1) / staleDrivers.length) * 100),
    })

    try {
      const results = await searchCatalogSingle(driver)
      for (const r of results) {
        const key = `${r.updateId}::${r.availableVersion}`
        if (!seen.has(key)) {
          seen.add(key)
          updates.push(r)
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      getLogger().warning('driver-manager', `Catalog search failed for ${driver.hardwareId}: ${msg}`)
    }
  }

  return updates
}

async function searchCatalogSingle(driver: StaleDriver): Promise<DriverUpdate[]> {
  const query = driver.hardwareId.replace(/\\/g, '%5C').replace(/&/g, '%26')
  const searchUrl = `http://catalog.update.microsoft.com/v7/site/UpdateSearch?q=${query}&m=true&driversOnly=true`

  const script = `
    $ErrorActionPreference = 'Stop'
    try {
      $response = Invoke-WebRequest -Uri '${searchUrl}' -UseBasicParsing -TimeoutSec 30 -MaximumRedirection 3
      Write-Output "CATALOG_HTML_START"
      Write-Output $response.Content
      Write-Output "CATALOG_HTML_END"
    } catch {
      Write-Output "CATALOG_ERROR|$($_.Exception.Message)"
    }
  `

  const { stdout } = await execFileAsync('powershell', psArgs(script), {
    timeout: 45000,
    maxBuffer: 5 * 1024 * 1024,
    windowsHide: true,
  })

  const lines = String(stdout)
    .split('\n')
    .map((l) => l.trim())

  // Check for error
  const errorLine = lines.find((l) => l.startsWith('CATALOG_ERROR|'))
  if (errorLine) {
    throw new Error(errorLine.substring('CATALOG_ERROR|'.length))
  }

  // Extract HTML between markers
  const startIdx = lines.indexOf('CATALOG_HTML_START')
  const endIdx = lines.indexOf('CATALOG_HTML_END')
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error('Catalog response missing HTML markers')
  }

  const html = lines.slice(startIdx + 1, endIdx).join('\n')
  if (!html || html.length < 100) {
    throw new Error('Catalog response HTML too short')
  }

  return parseCatalogHtml(html, driver)
}

/**
 * Get installed drivers with HardwareIDs from WMI, used to identify stale drivers
 * for catalog fallback queries.
 */
export async function getStaleDriversForCatalog(): Promise<StaleDriver[]> {
  const script = `
    $ErrorActionPreference = 'SilentlyContinue'
    $drivers = Get-CimInstance Win32_PnPSignedDriver |
      Where-Object { $_.HardwareID -and $_.InfName -like 'oem*.inf' } |
      Select-Object HardwareID, DeviceName, DriverVersion, InfName

    # Group by HardwareID to find duplicates (older versions)
    $groups = @{}
    foreach ($d in $drivers) {
      $hwId = $d.HardwareID
      if (-not $groups.ContainsKey($hwId)) { $groups[$hwId] = @() }
      $groups[$hwId] += $d
    }

    # For each HardwareID with multiple versions, the oldest ones are stale
    foreach ($hwId in $groups.Keys) {
      $list = @($groups[$hwId] | Sort-Object DriverVersion -Descending)
      if ($list.Count -le 1) { continue }

      # All except the newest version are candidates for updates
      for ($i = 1; $i -lt $list.Count; $i++) {
        $d = $list[$i]
        $name = if ($d.DeviceName) { $d.DeviceName } else { 'Unknown Device' }
        $ver = if ($d.DriverVersion) { $d.DriverVersion } else { '' }
        Write-Output "STALE|$hwId|$name|$ver"
      }
    }
  `

  try {
    const { stdout } = await execFileAsync('powershell', psArgs(script), {
      timeout: 30000,
      windowsHide: true,
    })

    const stale: StaleDriver[] = []
    for (const line of String(stdout).split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('STALE|')) continue
      const parts = trimmed.split('|')
      if (parts.length < 4) continue

      stale.push({
        hardwareId: parts[1]!,
        deviceName: parts[2]!,
        currentVersion: parts[3]!,
        className: '',
      })
    }
    return stale
  } catch {
    getLogger().warning('driver-manager', 'Failed to enumerate stale drivers from WMI')
    return []
  }
}
