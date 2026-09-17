import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DriverCleanResult, DriverPackage, DriverScanProgress, DriverScanResult } from '@shared/types'
import { execFileAsync, execNativeUtf8, psArgs } from '../../services/exec-utf8'
import { getLogger } from '../../services/logger.service'
import { compareVersions, makeId } from './utils'

const DRIVER_STORE = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'DriverStore', 'FileRepository')

/**
 * Measure total size of a directory recursively.
 */
function dirSize(dirPath: string): number {
  let total = 0
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      try {
        if (entry.isFile()) {
          total += statSync(join(dirPath, entry.name)).size
        } else if (entry.isDirectory()) {
          total += dirSize(join(dirPath, entry.name))
        }
      } catch {
        /* skip inaccessible files */
      }
    }
  } catch {
    /* skip inaccessible dirs */
  }
  return total
}

interface RawDriver {
  publishedName: string
  originalName: string
  provider: string
  className: string
  version: string
  date: string
  signer: string
}

/**
 * Parse installed driver packages from the Windows Driver Database registry.
 * Registry values are not localized, making this locale-independent.
 * Falls back to pnputil -e with multi-lingual label matching if registry fails.
 */
async function parseEnumDrivers(): Promise<RawDriver[]> {
  try {
    const script = `
      Get-ChildItem 'HKLM:\\SYSTEM\\DriverDatabase\\DriverInfFiles\\oem*.inf' -ErrorAction SilentlyContinue |
        ForEach-Object {
          [PSCustomObject]@{
            PublishedName = $_.PSChildName
            OriginalName = if ($_.GetValue('OriginalInfName')) { $_.GetValue('OriginalInfName') } else { '' }
            ProviderName = if ($_.GetValue('Provider')) { $_.GetValue('Provider') } else { '' }
            ClassName = if ($_.GetValue('Class')) { $_.GetValue('Class') } else { '' }
            DriverVersion = if ($_.GetValue('DriverVersion')) { $_.GetValue('DriverVersion') } else { '' }
            DriverDate = if ($_.GetValue('DriverDate')) { $_.GetValue('DriverDate') } else { '' }
            SignerName = if ($_.GetValue('SignerName')) { $_.GetValue('SignerName') } else { '' }
          }
        } | ConvertTo-Json -Compress
    `
    const { stdout } = await execFileAsync('powershell', psArgs(script), { timeout: 30000, windowsHide: true })
    const parsed = JSON.parse(String(stdout).trim())
    const items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
    const drivers: RawDriver[] = []

    for (const item of items) {
      if (!item.PublishedName?.toString().toLowerCase().startsWith('oem')) continue
      drivers.push({
        publishedName: item.PublishedName,
        originalName: item.OriginalName || item.PublishedName,
        provider: item.ProviderName || 'Unknown',
        className: item.ClassName || 'Unknown',
        version: item.DriverVersion || '',
        date: item.DriverDate || '',
        signer: item.SignerName || '',
      })
    }

    if (drivers.length > 0) return drivers
  } catch {
    /* fall through to pnputil fallback */
  }

  // Fallback: parse pnputil -e output with multi-lingual label patterns
  return parseEnumDriversPnpUtil()
}

/**
 * Multi-language label map: canonical English → list of localized equivalents.
 * pnputil localizes its output labels based on the OS UI language.
 */
const PNPUTIL_LABELS: Record<string, string[]> = {
  'published name': [
    'published name',
    'nome publicado',
    'veröffentlichter name',
    'nom publié',
    'nombre publicado',
    'publicado',
    'publicerat namn',
  ],
  'original name': [
    'original name',
    'nome original',
    'ursprünglicher name',
    'nom original',
    'nombre original',
    'originalt namn',
  ],
  'original inf': ['original inf', 'inf original'],
  'driver package provider': [
    'driver package provider',
    'provider name',
    'provider',
    'nome do provedor',
    'provedor',
    'anbieter',
    'fournisseur',
    'proveedor',
    'provider för drivrutinen',
  ],
  'class name': ['class name', 'class', 'device class', 'nome da classe', 'classe', 'klasse', 'deviceklasse'],
  'driver version': [
    'driver version',
    'version',
    'versão do driver',
    'treiberversion',
    'version du pilote',
    'versión del controlador',
    'versionsinformation för drivrutin',
  ],
  'driver date': [
    'driver date',
    'date',
    'data do driver',
    'treiberdatum',
    'date du pilote',
    'fecha del controlador',
    'datum för drivrutin',
  ],
  'driver date and version': [
    'driver date and version',
    'data e versão do driver',
    'treiberdatum und version',
    'date et version du pilote',
    'fecha y versión del controlador',
  ],
  'signer name': [
    'signer name',
    'signer',
    'nome do signatário',
    'signaturname',
    'nom du signataire',
    'nombre del firmante',
    'signatärnamn',
  ],
  attributes: ['attributes', 'atributos', 'attribute', 'attributter'],
}

/**
 * Resolve a localized pnputil label to its canonical English key.
 * Returns null if no known label matches.
 */
export function resolveLabel(localizedKey: string): string | null {
  const lower = localizedKey.toLowerCase()
  for (const [canonical, variants] of Object.entries(PNPUTIL_LABELS)) {
    if (variants.some((v) => lower === v.toLowerCase())) {
      return canonical
    }
  }
  return null
}

/**
 * Fallback: parse pnputil -e output with multi-lingual label patterns.
 * pnputil localizes its output labels, so we resolve them via PNPUTIL_LABELS.
 */
async function parseEnumDriversPnpUtil(): Promise<RawDriver[]> {
  const drivers: RawDriver[] = []
  let stdout = ''
  try {
    const res = await execNativeUtf8('pnputil', ['-e'], { timeout: 30000 })
    stdout = res.stdout
  } catch {
    try {
      const res = await execNativeUtf8('pnputil', ['/enum-drivers'], { timeout: 30000 })
      stdout = res.stdout
    } catch {
      return drivers
    }
  }

  const blocks = stdout.split(/\n\s*\n/)

  for (const block of blocks) {
    const rawFields: Record<string, string> = {}
    for (const line of block.trim().split('\n')) {
      const match = line.match(/^\s*(.+?)\s*:\s+(.+)$/)
      if (match) {
        rawFields[match[1]!.trim()] = match[2]!.trim()
      }
    }

    // Resolve localized labels to canonical English keys
    const fields: Record<string, string> = {}
    for (const [key, value] of Object.entries(rawFields)) {
      const canonical = resolveLabel(key)
      if (canonical && !fields[canonical]) {
        fields[canonical] = value
      }
    }

    const publishedName = fields['published name'] || fields['original inf'] || ''
    if (!publishedName.toLowerCase().startsWith('oem')) continue

    let version = fields['driver version'] || ''
    let date = fields['driver date'] || ''

    // Some locales combine date + version in a single field (e.g. PT: "Versão do Driver: 01/26/2016 10.1.2.19")
    // or expose it as a separate "Driver Date and Version" key.
    const dateAndVersion = fields['driver date and version'] || ''
    const combined = dateAndVersion || version
    if (combined && (!version || !date)) {
      const dvMatch = combined.match(/^(\d{4}[-/]\d{2}[-/]\d{2}|\d{2}\/\d{2}\/\d{4})\s+(\S+)$/)
      if (dvMatch) {
        if (!date) date = dvMatch[1]!
        if (!version || version === combined) version = dvMatch[2]!
      }
    }

    drivers.push({
      publishedName,
      originalName:
        fields['original name'] || fields['original inf'] || fields['driver package provider'] || publishedName,
      provider: fields['driver package provider'] || 'Unknown',
      className: fields['class name'] || 'Unknown',
      version,
      date,
      signer: fields['signer name'] || '',
    })
  }

  return drivers
}

/**
 * Build a mapping from OEM published name (e.g. "oem7.inf") to FileRepository
 * folder names by reading the DriverDatabase registry. Each oem*.inf maps to
 * one or more package folders (the default value lists all, Active shows the current one).
 */
async function getOemFolderMap(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  try {
    const script = `
      Get-ChildItem 'HKLM:\\SYSTEM\\DriverDatabase\\DriverInfFiles\\oem*.inf' -ErrorAction SilentlyContinue |
        ForEach-Object {
          $name = $_.PSChildName
          $folders = @($_.GetValue(''))
          if ($folders.Count -gt 0) {
            Write-Output "$name|$($folders -join ',')"
          }
        }
    `
    const { stdout } = await execFileAsync('powershell', psArgs(script), { timeout: 15000, windowsHide: true })

    for (const line of String(stdout).trim().split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const [oemName, foldersStr] = trimmed.split('|', 2)
      if (oemName && foldersStr) {
        map.set(
          oemName.toLowerCase(),
          foldersStr
            .split(',')
            .map((f) => f.trim())
            .filter(Boolean),
        )
      }
    }
  } catch {
    /* registry read failed, folder sizes will be 0 */
  }
  return map
}

/**
 * Get the list of driver published names that are currently in use
 * by actual hardware devices.
 */
async function getActiveDriverNames(): Promise<Set<string>> {
  const active = new Set<string>()
  try {
    const script = `
      Get-CimInstance Win32_PnPSignedDriver |
        Where-Object { $_.InfName -like 'oem*.inf' } |
        Select-Object -ExpandProperty InfName |
        Sort-Object -Unique
    `
    const { stdout } = await execFileAsync('powershell', psArgs(script), { timeout: 30000, windowsHide: true })

    for (const line of String(stdout).trim().split('\n')) {
      const name = line.trim().toLowerCase()
      if (name) active.add(name)
    }
  } catch {
    // Fallback: if WMI fails, try pnputil /enum-devices
    try {
      const { stdout } = await execNativeUtf8('pnputil', ['/enum-devices', '/connected'], {
        timeout: 30000,
      })
      const matches = stdout.matchAll(/Driver Name:\s*(oem\d+\.inf)/gi)
      for (const m of matches) {
        active.add(m[1]!.toLowerCase())
      }
    } catch {
      /* can't determine active drivers */
    }
  }
  return active
}

// ── Exported core logic ──

export async function scanDrivers(onProgress?: (data: DriverScanProgress) => void): Promise<DriverScanResult> {
  getLogger().info('driver-manager', 'Starting driver scan...')
  if (process.platform !== 'win32') {
    getLogger().warning('driver-manager', 'Driver scan skipped — not on Windows')
    return { packages: [], totalStaleSize: 0, totalStaleCount: 0, totalCurrentCount: 0 }
  }

  onProgress?.({
    phase: 'enumerating',
    current: 0,
    total: 0,
    currentDriver: 'Enumerating installed driver packages...',
  })

  // Step 1: Enumerate all OEM driver packages (locale-independent)
  let rawDrivers: RawDriver[] = []
  try {
    rawDrivers = await parseEnumDrivers()
  } catch {
    return { packages: [], totalStaleSize: 0, totalStaleCount: 0, totalCurrentCount: 0 }
  }

  onProgress?.({
    phase: 'analyzing',
    current: 0,
    total: rawDrivers.length,
    currentDriver: 'Identifying active drivers...',
  })

  // Step 2: Determine which drivers are currently active + get folder mapping
  // Run both queries in parallel for speed
  const [activeNames, oemFolderMap] = await Promise.all([getActiveDriverNames(), getOemFolderMap()])

  // Step 3: Group by provider + class to find duplicates (since legacy pnputil
  // doesn't expose the original inf name, we use provider+class as the grouping key)
  const groups = new Map<string, RawDriver[]>()
  for (const d of rawDrivers) {
    const key = `${d.provider.toLowerCase()}::${d.className.toLowerCase()}`
    const group = groups.get(key) || []
    group.push(d)
    groups.set(key, group)
  }

  // Within each group, mark the newest as current; the rest are stale
  // Also mark any driver actively bound to hardware as current
  const packages: DriverPackage[] = []
  let idx = 0

  for (const [, group] of groups) {
    // Sort by version descending using numeric comparison
    group.sort((a, b) => compareVersions(b.version, a.version))

    for (let i = 0; i < group.length; i++) {
      const d = group[i]!
      const isActive = activeNames.has(d.publishedName.toLowerCase())
      const isNewest = i === 0

      onProgress?.({
        phase: 'measuring',
        current: ++idx,
        total: rawDrivers.length,
        currentDriver: `${d.provider} - ${d.className} (${d.version})`,
      })

      // Find folder in FileRepository using registry-based OEM→folder mapping
      let folderPath = ''
      let size = 0
      try {
        const folders = oemFolderMap.get(d.publishedName.toLowerCase()) || []
        if (folders.length > 0) {
          // Use the first (and usually only) matching folder
          folderPath = join(DRIVER_STORE, folders[0]!)
          size = dirSize(folderPath)
        }
      } catch {
        /* skip */
      }

      packages.push({
        id: makeId(d.publishedName, d.version),
        publishedName: d.publishedName,
        originalName: d.originalName,
        provider: d.provider,
        className: d.className,
        version: d.version,
        date: d.date,
        signer: d.signer,
        folderPath,
        size,
        isCurrent: isActive || isNewest,
        selected: false,
      })
    }
  }

  // Pre-select stale (non-current) drivers
  for (const pkg of packages) {
    if (!pkg.isCurrent) pkg.selected = true
  }
  const stale = packages.filter((p) => !p.isCurrent)
  const result = {
    packages,
    totalStaleSize: stale.reduce((sum, p) => sum + p.size, 0),
    totalStaleCount: stale.length,
    totalCurrentCount: packages.length - stale.length,
  }
  getLogger().success(
    'driver-manager',
    `Driver scan completed — ${result.totalStaleCount} stale drivers (${result.totalStaleSize} bytes), ${result.totalCurrentCount} current`,
  )
  return result
}

export async function cleanDrivers(publishedNames: string[]): Promise<DriverCleanResult> {
  getLogger().info('driver-manager', `Starting driver clean for ${publishedNames.length} driver(s)...`)
  if (process.platform !== 'win32') {
    getLogger().warning('driver-manager', 'Driver clean skipped — not on Windows')
    return { removed: 0, failed: 0, spaceRecovered: 0, errors: [] }
  }

  let removed = 0
  let failed = 0
  let spaceRecovered = 0
  const errors: { publishedName: string; reason: string }[] = []

  // Get OEM→folder mapping for size calculation before removal
  const oemFolderMap = await getOemFolderMap()

  for (const name of publishedNames) {
    // Validate: only allow oem*.inf names
    if (!/^oem\d+\.inf$/i.test(name)) {
      errors.push({ publishedName: name, reason: 'Invalid driver package name' })
      failed++
      continue
    }

    try {
      // Get size before removal using registry-based folder mapping
      let preSize = 0
      const folders = oemFolderMap.get(name.toLowerCase()) || []
      if (folders.length > 0) {
        preSize = dirSize(join(DRIVER_STORE, folders[0]!))
      }

      await execNativeUtf8('pnputil', ['/delete-driver', name], {
        timeout: 15000,
      })
      removed++
      spaceRecovered += preSize
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string }
      const msg = e?.stderr || e?.message || 'Unknown error'
      if (msg.includes('currently in use') || msg.includes('in use')) {
        errors.push({ publishedName: name, reason: 'Driver is currently in use by a device' })
      } else {
        errors.push({ publishedName: name, reason: msg.slice(0, 200) })
      }
      failed++
    }
  }

  const result = { removed, failed, spaceRecovered, errors }
  if (result.failed > 0) {
    getLogger().error(
      'driver-manager',
      `Driver clean completed with ${result.failed} failure(s) — ${result.removed} removed, ${result.spaceRecovered} bytes recovered`,
    )
  } else {
    getLogger().success(
      'driver-manager',
      `Driver clean completed — ${result.removed} removed, ${result.spaceRecovered} bytes recovered`,
    )
  }
  return result
}
