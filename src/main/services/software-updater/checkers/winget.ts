import type { UpdatableApp, UpdateCheckResult, UpdateProgress, UpdateResult } from '@shared/types'
import { isAdmin } from '../../elevation'
import { execFileAsync, psUtf8 } from '../../exec-utf8'
import { cleanOutput, computeSeverity, emptyResult, stripTrailingVersion } from '../utils'

/**
 * Detect column positions from a winget header line.
 * Works with localized headers (EN "Version", PT "Versão", ES "Versión", etc.)
 * by matching substrings rather than exact names.
 */
export function findColumnPositions(header: string): {
  id: number
  version: number
  available: number
  source: number
} {
  const upperHeader = header.toUpperCase()
  const idStart = upperHeader.indexOf('ID')
  if (idStart < 0) return { id: -1, version: -1, available: -1, source: -1 }

  let versionStart = -1
  let availableStart = -1
  let sourceStart = -1

  // After "Id", find the next word (should be Version/Versão/Versión)
  const afterId = header.substring(idStart + 2)
  const versionMatch = afterId.match(/\S+/)
  if (versionMatch && /vers/i.test(versionMatch[0])) {
    versionStart = idStart + 2 + afterId.indexOf(versionMatch[0])
  }

  if (versionStart >= 0) {
    // Skip past the version word to find Available/Disponível/Disponible
    const afterVerWord = header.substring(versionStart + (versionMatch?.[0]?.length ?? 0))
    const availMatch = afterVerWord.match(/\S+/)
    if (availMatch && /ispo|vaila|ponível|ponible/i.test(availMatch[0])) {
      availableStart = versionStart + (versionMatch?.[0]?.length ?? 0) + afterVerWord.indexOf(availMatch[0])
    }
  }

  const tail = header.trimEnd()
  const lastWord = tail.match(/\S+$/)?.[0] ?? ''
  if (lastWord && /ource|igem|igen/i.test(lastWord)) {
    sourceStart = tail.length - lastWord.length
  }

  return { id: idStart, version: versionStart, available: availableStart, source: sourceStart }
}

const WINGET_HEADER_RE = /(Name|Nome|Nombre)\s+Id\s+(Version|Vers)/i

export function parseWingetUpgradeOutput(stdout: string): UpdatableApp[] {
  const lines = cleanOutput(stdout).split(/\r?\n/)

  let headerIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const headerLine = lines[i]
    if (!headerLine) continue
    if (WINGET_HEADER_RE.test(headerLine)) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) return []

  const separatorIdx = headerIdx + 1
  if (separatorIdx >= lines.length || !/^[-\s]+$/.test(lines[separatorIdx] ?? '')) return []

  const header = lines[headerIdx]
  if (!header) return []
  const col = findColumnPositions(header)
  if (col.id < 0 || col.version < 0) return []

  const apps: UpdatableApp[] = []
  for (let i = separatorIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    if (!line.trim()) continue
    if (/^\d+\s+upgrade/i.test(line.trim())) break

    const name = line.substring(0, col.id).trim()
    const id = col.version > 0 ? line.substring(col.id, col.version).trim() : line.substring(col.id).trim()
    let version =
      col.available > 0 ? line.substring(col.version, col.available).trim() : line.substring(col.version).trim()
    let available =
      col.source > 0
        ? line.substring(col.available, col.source).trim()
        : col.available > 0
          ? line.substring(col.available).trim()
          : ''
    if (version.startsWith('> ')) version = version.slice(2)
    if (version.startsWith('< ')) version = version.slice(2)
    if (available.startsWith('> ')) available = available.slice(2)
    if (available.startsWith('< ')) available = available.slice(2)
    const source = col.source > 0 ? line.substring(col.source).trim() : ''

    if (!id || !version || !available) continue
    if (version === available) continue

    apps.push({
      id,
      name: stripTrailingVersion(name) || id,
      currentVersion: version,
      availableVersion: available,
      source: source || 'winget',
      severity: computeSeverity(version, available),
      selected: true,
    })
  }
  return apps
}

export function parseWingetListOutput(stdout: string): UpdatableApp[] {
  const lines = cleanOutput(stdout).split(/\r?\n/)

  let headerIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const headerLine = lines[i]
    if (!headerLine) continue
    if (WINGET_HEADER_RE.test(headerLine)) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) return []

  const separatorIdx = headerIdx + 1
  if (separatorIdx >= lines.length || !/^[-\s]+$/.test(lines[separatorIdx] ?? '')) return []

  const header = lines[headerIdx]
  if (!header) return []
  const col = findColumnPositions(header)

  if (col.id < 0 || col.version < 0) return []

  const apps: UpdatableApp[] = []
  for (let i = separatorIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    if (!line.trim()) continue
    if (/^\d+\s+package/i.test(line.trim())) break

    const name = line.substring(0, col.id).trim()
    const id = col.version > 0 ? line.substring(col.id, col.version).trim() : line.substring(col.id).trim()
    let version =
      col.available > 0 ? line.substring(col.version, col.available).trim() : line.substring(col.version).trim()
    if (version.startsWith('> ')) version = version.slice(2)
    if (version.startsWith('< ')) version = version.slice(2)
    const source = col.source > 0 ? line.substring(col.source).trim() : ''

    if (!id || !version || version === 'Unknown') continue
    if (id.startsWith('ARP\\')) continue

    apps.push({
      id,
      name: stripTrailingVersion(name) || id,
      currentVersion: version,
      availableVersion: version,
      source: source || 'winget',
      severity: 'unknown',
      selected: false,
      isUpToDate: true,
    })
  }
  return apps
}

/**
 * Extract installed app NAMES from `winget list` output — including registry/MSI
 * rows whose ID is `ARP\Machine\X86|X64|User\...` (and `MSIX\...`), which
 * `parseWingetListOutput` deliberately drops. Used as a fuzzy fallback to detect
 * classic MSI/EXE installs that never match a curated winget ID. Names are
 * deduplicated case-insensitively.
 */
export function parseWingetListInstalledNames(stdout: string): string[] {
  const lines = cleanOutput(stdout).split(/\r?\n/)

  let headerIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const headerLine = lines[i]
    if (!headerLine) continue
    if (WINGET_HEADER_RE.test(headerLine)) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) return []

  const separatorIdx = headerIdx + 1
  if (separatorIdx >= lines.length || !/^[-\s]+$/.test(lines[separatorIdx] ?? '')) return []

  const header = lines[headerIdx]
  if (!header) return []
  const col = findColumnPositions(header)
  if (col.id < 0) return []

  const names: string[] = []
  for (let i = separatorIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    if (!line.trim()) continue
    if (/^\d+\s+package/i.test(line.trim())) break

    const name = line.substring(0, col.id).trim()
    if (!name) continue
    if (names.some((n) => n.toLowerCase() === name.toLowerCase())) continue
    names.push(name)
  }
  return names
}

export async function isWingetAvailable(): Promise<boolean> {
  try {
    await execFileAsync('winget', ['--version'], {
      timeout: 10_000,
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}

export async function checkForUpdatesWinget(): Promise<UpdateCheckResult> {
  const available = await isWingetAvailable()
  if (!available) {
    return emptyResult(false, 'winget')
  }

  try {
    let stdout = ''
    try {
      const result = await execFileAsync(
        'winget',
        ['upgrade', '--accept-source-agreements', '--disable-interactivity'],
        { timeout: 15_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      )
      stdout = String(result.stdout)
    } catch (err: unknown) {
      const e = err as { stdout?: string; message?: string; stderr?: string; code?: string }
      if (e?.stdout) {
        stdout = e.stdout
      } else {
        return emptyResult(true, 'winget')
      }
    }

    const apps = parseWingetUpgradeOutput(stdout).filter((a) => a.currentVersion !== a.availableVersion)

    return {
      apps: apps,
      totalCount: apps.length,
      majorCount: apps.filter((a) => a.severity === 'major').length,
      minorCount: apps.filter((a) => a.severity === 'minor').length,
      patchCount: apps.filter((a) => a.severity === 'patch').length,
      packageManagerAvailable: true,
      packageManagerName: 'winget',
    }
  } catch {
    return emptyResult(true, 'winget')
  }
}

const WINGET_UPGRADE_ARGS = [
  '--accept-source-agreements',
  '--accept-package-agreements',
  '--disable-interactivity',
  '--silent',
  '--include-unknown',
]

const SUCCESS_PATTERNS = [
  'successfully installed',
  'successfully upgraded',
  'installer succeeded',
  'no available upgrade',
]

const FAILURE_PATTERNS = [
  'installer failed',
  'no package found',
  'no applicable update',
  'another version of this application',
  'installer aborted',
  'install technology is different',
]

const ELEVATION_HINTS = [
  'access is denied',
  'administrator',
  'elevation',
  'requires admin',
  'run as admin',
  '0x80070005',
  '0x80070422',
  '0x80070643',
  'negado',
  'permiss',
  'acesso',
]

async function attemptWingetUpgrade(
  appId: string,
  extraArgs: string[] = [],
): Promise<{ success: boolean; output: string; errorType?: string }> {
  if (!/^[\w][\w.-]{0,200}$/.test(appId)) {
    return { success: false, output: 'Invalid app ID format' }
  }
  let upgradeStdout = ''
  let exitCode = 0
  try {
    const result = await execFileAsync('winget', ['upgrade', appId, ...WINGET_UPGRADE_ARGS, ...extraArgs], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    })
    upgradeStdout = String(result.stdout)
    exitCode = 0
  } catch (err: unknown) {
    const e = err as { stdout?: string; message?: string; stderr?: string; code?: string }
    if (e?.stdout) {
      upgradeStdout = e.stdout
    } else {
      return { success: false, output: e?.message || 'Unknown error' }
    }
    exitCode = Number(e?.code ?? -1)
  }

  if (exitCode === 0) {
    const output = cleanOutput(upgradeStdout).toLowerCase()
    if (FAILURE_PATTERNS.some((p) => output.includes(p))) {
      return { success: false, output: upgradeStdout }
    }
    return { success: true, output: upgradeStdout }
  }

  const output = cleanOutput(upgradeStdout).toLowerCase()

  if (exitCode === 1) {
    if (SUCCESS_PATTERNS.some((p) => output.includes(p))) {
      return { success: true, output: upgradeStdout }
    }
    return { success: false, output: upgradeStdout }
  }

  const wasSuccessful = SUCCESS_PATTERNS.some((p) => output.includes(p))
  const hasClearFailure = FAILURE_PATTERNS.some((p) => output.includes(p))

  if (wasSuccessful && !hasClearFailure) {
    return { success: true, output: upgradeStdout }
  }
  return { success: false, output: upgradeStdout }
}

async function attemptElevatedUpgrade(appId: string): Promise<{ success: boolean; output: string }> {
  if (!/^[\w][\w.-]{0,200}$/.test(appId)) {
    return { success: false, output: 'Invalid app ID format' }
  }

  try {
    const args = ['upgrade', appId, ...WINGET_UPGRADE_ARGS, '--force'].join(' ')
    const safeArgs = args.replace(/'/g, "''")
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        psUtf8(
          `$p = Start-Process winget -ArgumentList '${safeArgs}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode`,
        ),
      ],
      { timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
    )
    const checkResult = await execFileAsync(
      'winget',
      ['upgrade', '--accept-source-agreements', '--disable-interactivity', '--include-unknown'],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
    )
    const stillNeedsUpgrade = checkResult.stdout.includes(appId)
    return {
      success: !stillNeedsUpgrade,
      output: stillNeedsUpgrade ? 'App still needs upgrade after elevated attempt' : String(stdout),
    }
  } catch (err: unknown) {
    const e = err as { stdout?: string; message?: string; stderr?: string; code?: string }
    return { success: false, output: e?.message || 'Elevated upgrade failed' }
  }
}

const WINGET_UPDATE_CONCURRENCY = 1

async function upgradeAppWinget(appId: string, alreadyAdmin: boolean): Promise<{ success: boolean; error?: string }> {
  let result = await attemptWingetUpgrade(appId)

  if (!result.success && !alreadyAdmin) {
    const lowerOutput = cleanOutput(result.output).toLowerCase()
    const looksLikeElevationIssue =
      ELEVATION_HINTS.some((h) => lowerOutput.includes(h)) || FAILURE_PATTERNS.some((p) => lowerOutput.includes(p))

    if (looksLikeElevationIssue) {
      result = await attemptElevatedUpgrade(appId)
    }
  }

  if (!result.success) {
    const lowerOutput = cleanOutput(result.output).toLowerCase()
    if (lowerOutput.includes('install technology is different')) {
      return {
        success: false,
        error: 'Installer type changed — uninstall this app manually then install the new version',
      }
    }
  }

  if (!result.success) {
    const retryResult = await attemptWingetUpgrade(appId, ['--force'])
    if (retryResult.success) result = retryResult
  }

  if (result.success) return { success: true }

  const lastLine = cleanOutput(result.output).trim().split('\n').pop() || 'Upgrade failed'
  return { success: false, error: lastLine.length > 200 ? `${lastLine.slice(0, 200)}...` : lastLine }
}

export async function runUpdatesWinget(
  appIds: string[],
  onProgress: (progress: UpdateProgress) => void,
): Promise<UpdateResult> {
  let succeeded = 0
  let failed = 0
  let completed = 0
  const errors: UpdateResult['errors'] = []
  const alreadyAdmin = isAdmin()
  const total = appIds.length

  for (let batchStart = 0; batchStart < total; batchStart += WINGET_UPDATE_CONCURRENCY) {
    const batch = appIds.slice(batchStart, batchStart + WINGET_UPDATE_CONCURRENCY)

    for (const appId of batch) {
      onProgress({
        phase: 'updating',
        current: completed + 1,
        total,
        currentApp: appId,
        percent: Math.round((completed / total) * 100),
        status: 'in-progress',
      })
    }

    const results = await Promise.allSettled(
      batch.map((appId) => upgradeAppWinget(appId, alreadyAdmin).then((r) => ({ appId, ...r }))),
    )

    for (const settled of results) {
      completed++
      if (settled.status === 'fulfilled' && settled.value.success) {
        succeeded++
        onProgress({
          phase: 'updating',
          current: completed,
          total,
          currentApp: settled.value.appId,
          percent: Math.round((completed / total) * 100),
          status: 'done',
        })
      } else {
        failed++
        const batchIdx = results.indexOf(settled)
        const appId = settled.status === 'fulfilled' ? settled.value.appId : (batch[batchIdx] ?? 'unknown')
        const reason =
          settled.status === 'fulfilled'
            ? settled.value.error || 'Upgrade failed'
            : settled.reason?.message || 'Unknown error'
        errors.push({ appId, name: appId ?? 'unknown', reason })
        onProgress({
          phase: 'updating',
          current: completed,
          total,
          currentApp: appId,
          percent: Math.round((completed / total) * 100),
          status: 'failed',
        })
      }
    }
  }

  return { succeeded, failed, errors }
}
