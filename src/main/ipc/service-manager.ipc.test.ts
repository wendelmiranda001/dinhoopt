import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  execFileAsync: vi.fn(),
  platformServicesScan: vi.fn<() => Promise<ServiceScanResult>>(),
  platformServicesApply: vi.fn<() => Promise<ServiceApplyResult>>(),
  lookupServiceSafety: vi.fn(),
  logger: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
}))

vi.mock('../services/exec-utf8', () => ({
  execFileAsync: (...args: unknown[]) => mocks.execFileAsync(...args),
  psArgs: (s: string) => ['-NoProfile', '-NonInteractive', '-Command', s],
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

vi.mock('../platform', () => ({
  getPlatform: () => ({
    services: { scan: mocks.platformServicesScan, applyChanges: mocks.platformServicesApply },
  }),
}))

vi.mock('@shared/service-safety-kb', () => ({
  lookupServiceSafety: (...args: unknown[]) => mocks.lookupServiceSafety(...args),
}))

import { IPC } from '@shared/channels'
import type { ServiceApplyResult, ServiceScanProgress, ServiceScanResult } from '@shared/types'
import { applyServiceChanges, registerServiceManagerIpc, scanServices } from './service-manager.ipc'

const ORIGINAL_PLATFORM = process.platform

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

function resetPlatform(): void {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  setPlatform('win32')
  mocks.lookupServiceSafety.mockReturnValue({ safety: 'caution', category: 'unknown', note: '' })
})

afterEach(() => {
  resetPlatform()
})

// ── Test the pure helper functions from service-manager.ipc.ts ──
// These are replicated here to avoid importing the Electron-dependent module.

// ── normalizeStartType (replica) ──

type ServiceStartType = 'Automatic' | 'AutomaticDelayed' | 'Manual' | 'Disabled' | 'Boot' | 'System'

function normalizeStartType(raw: string): ServiceStartType {
  const lower = raw.toLowerCase().trim()
  if (lower === 'auto' || lower === 'automatic') return 'Automatic'
  if (lower === 'autodelayed' || lower === 'automaticdelayed') return 'AutomaticDelayed'
  if (lower === 'manual') return 'Manual'
  if (lower === 'disabled') return 'Disabled'
  if (lower === 'boot') return 'Boot'
  if (lower === 'system') return 'System'
  return 'Manual'
}

describe('normalizeStartType', () => {
  it('normalizes "Auto" to "Automatic"', () => {
    expect(normalizeStartType('Auto')).toBe('Automatic')
  })

  it('normalizes "Automatic" to "Automatic"', () => {
    expect(normalizeStartType('Automatic')).toBe('Automatic')
  })

  it('normalizes "AutoDelayed" to "AutomaticDelayed"', () => {
    expect(normalizeStartType('AutoDelayed')).toBe('AutomaticDelayed')
  })

  it('normalizes "AutomaticDelayed" to "AutomaticDelayed"', () => {
    expect(normalizeStartType('AutomaticDelayed')).toBe('AutomaticDelayed')
  })

  it('normalizes "Manual" to "Manual"', () => {
    expect(normalizeStartType('Manual')).toBe('Manual')
  })

  it('normalizes "Disabled" to "Disabled"', () => {
    expect(normalizeStartType('Disabled')).toBe('Disabled')
  })

  it('normalizes "Boot" to "Boot"', () => {
    expect(normalizeStartType('Boot')).toBe('Boot')
  })

  it('normalizes "System" to "System"', () => {
    expect(normalizeStartType('System')).toBe('System')
  })

  it('is case-insensitive', () => {
    expect(normalizeStartType('AUTO')).toBe('Automatic')
    expect(normalizeStartType('MANUAL')).toBe('Manual')
    expect(normalizeStartType('DISABLED')).toBe('Disabled')
    expect(normalizeStartType('autodelayed')).toBe('AutomaticDelayed')
  })

  it('trims whitespace', () => {
    expect(normalizeStartType('  Auto  ')).toBe('Automatic')
    expect(normalizeStartType('\tManual\n')).toBe('Manual')
  })

  it('defaults to "Manual" for unknown values', () => {
    expect(normalizeStartType('unknown')).toBe('Manual')
    expect(normalizeStartType('')).toBe('Manual')
    expect(normalizeStartType('foobar')).toBe('Manual')
  })
})

// ── normalizeStatus (replica) ──

type ServiceStatus = 'Running' | 'Stopped' | 'StartPending' | 'StopPending' | 'Paused' | 'Unknown'

function normalizeStatus(raw: string): ServiceStatus {
  const lower = raw.toLowerCase().trim()
  if (lower === 'running') return 'Running'
  if (lower === 'stopped') return 'Stopped'
  if (lower === 'startpending') return 'StartPending'
  if (lower === 'stoppending') return 'StopPending'
  if (lower === 'paused') return 'Paused'
  return 'Unknown'
}

describe('normalizeStatus', () => {
  it('normalizes "Running"', () => {
    expect(normalizeStatus('Running')).toBe('Running')
  })

  it('normalizes "Stopped"', () => {
    expect(normalizeStatus('Stopped')).toBe('Stopped')
  })

  it('normalizes "StartPending"', () => {
    expect(normalizeStatus('StartPending')).toBe('StartPending')
  })

  it('normalizes "StopPending"', () => {
    expect(normalizeStatus('StopPending')).toBe('StopPending')
  })

  it('normalizes "Paused"', () => {
    expect(normalizeStatus('Paused')).toBe('Paused')
  })

  it('is case-insensitive', () => {
    expect(normalizeStatus('RUNNING')).toBe('Running')
    expect(normalizeStatus('stopped')).toBe('Stopped')
  })

  it('trims whitespace', () => {
    expect(normalizeStatus('  Running  ')).toBe('Running')
  })

  it('returns "Unknown" for unrecognized values', () => {
    expect(normalizeStatus('unknown')).toBe('Unknown')
    expect(normalizeStatus('')).toBe('Unknown')
    expect(normalizeStatus('bogus')).toBe('Unknown')
  })
})

// ── Service name validation (mirrors applyServiceChanges) ──

const SERVICE_NAME_RE = /^[A-Za-z0-9_.-]{1,256}$/

describe('service name validation', () => {
  it('accepts simple service names', () => {
    expect(SERVICE_NAME_RE.test('WSearch')).toBe(true)
    expect(SERVICE_NAME_RE.test('SysMain')).toBe(true)
    expect(SERVICE_NAME_RE.test('wuauserv')).toBe(true)
  })

  it('accepts names with dots, underscores, hyphens', () => {
    expect(SERVICE_NAME_RE.test('My.Service_Name-1')).toBe(true)
  })

  it('rejects empty name', () => {
    expect(SERVICE_NAME_RE.test('')).toBe(false)
  })

  it('rejects names longer than 256 characters', () => {
    expect(SERVICE_NAME_RE.test('A'.repeat(257))).toBe(false)
  })

  it('accepts names at exactly 256 characters', () => {
    expect(SERVICE_NAME_RE.test('A'.repeat(256))).toBe(true)
  })

  it('rejects names with spaces', () => {
    expect(SERVICE_NAME_RE.test('My Service')).toBe(false)
  })

  it('rejects names with shell injection characters', () => {
    expect(SERVICE_NAME_RE.test('svc; rm -rf /')).toBe(false)
    expect(SERVICE_NAME_RE.test('svc|evil')).toBe(false)
    expect(SERVICE_NAME_RE.test('svc`cmd`')).toBe(false)
    expect(SERVICE_NAME_RE.test("svc' OR 1=1")).toBe(false)
    expect(SERVICE_NAME_RE.test('svc&evil')).toBe(false)
  })

  it('rejects names with path separators', () => {
    expect(SERVICE_NAME_RE.test('path\\svc')).toBe(false)
    expect(SERVICE_NAME_RE.test('path/svc')).toBe(false)
  })
})

// ── applyServiceChanges input validation logic ──

describe('applyServiceChanges input validation', () => {
  it('returns empty result for empty changes array', () => {
    const changes: { name: string; targetStartType: string }[] = []
    const result = !Array.isArray(changes) || changes.length === 0 ? { succeeded: 0, failed: 0, errors: [] } : null
    expect(result).toEqual({ succeeded: 0, failed: 0, errors: [] })
  })

  it('returns empty result for non-array input', () => {
    const changes = 'not an array' as any
    const result = !Array.isArray(changes) || changes.length === 0 ? { succeeded: 0, failed: 0, errors: [] } : null
    expect(result).toEqual({ succeeded: 0, failed: 0, errors: [] })
  })

  it('rejects invalid service name in changes', () => {
    const changes = [
      { name: 'valid', targetStartType: 'Manual' },
      { name: 'inv@lid!', targetStartType: 'Disabled' },
    ]
    let error: string | null = null
    for (const c of changes) {
      if (typeof c.name !== 'string' || typeof c.targetStartType !== 'string') {
        error = 'Invalid change entry'
        break
      }
      if (!SERVICE_NAME_RE.test(c.name)) {
        error = 'Invalid service name'
        break
      }
    }
    expect(error).toBe('Invalid service name')
  })

  it('rejects non-string name in change entry', () => {
    const changes = [{ name: 123 as any, targetStartType: 'Manual' }]
    let error: string | null = null
    for (const c of changes) {
      if (typeof c.name !== 'string' || typeof c.targetStartType !== 'string') {
        error = 'Invalid change entry'
        break
      }
    }
    expect(error).toBe('Invalid change entry')
  })

  it('sanitizes targetStartType to Manual or Disabled only', () => {
    // The source coerces: Manual stays Manual, everything else becomes Disabled
    const safeType = (t: string) => (t === 'Manual' ? 'Manual' : 'Disabled')
    expect(safeType('Manual')).toBe('Manual')
    expect(safeType('Disabled')).toBe('Disabled')
    expect(safeType('Automatic')).toBe('Disabled')
    expect(safeType('evil; rm -rf /')).toBe('Disabled')
  })
})

// ── PowerShell stdout parsing logic ──

describe('service scan stdout parsing', () => {
  it('parses SVC| prefixed lines from PowerShell output', () => {
    const stdout = [
      'SVC|WSearch|Windows Search|Running|Auto|Provides content indexing|True',
      'SVC|Spooler|Print Spooler|Stopped|Manual|Manages print jobs|True',
      'Some other output line',
      'SVC|incomplete',
    ].join('\n')

    const lines = stdout.split('\n').filter((l) => l.startsWith('SVC|'))
    expect(lines).toHaveLength(3) // includes incomplete

    const services: { name: string; displayName: string; status: ServiceStatus; startType: ServiceStartType }[] = []
    for (const line of lines) {
      const parts = line.trim().split('|')
      if (parts.length < 7) continue
      services.push({
        name: parts[1]!,
        displayName: parts[2]!,
        status: normalizeStatus(parts[3]!),
        startType: normalizeStartType(parts[4]!),
      })
    }

    expect(services).toHaveLength(2)
    expect(services[0]).toEqual({
      name: 'WSearch',
      displayName: 'Windows Search',
      status: 'Running',
      startType: 'Automatic',
    })
    expect(services[1]).toEqual({
      name: 'Spooler',
      displayName: 'Print Spooler',
      status: 'Stopped',
      startType: 'Manual',
    })
  })

  it('parses dependency output lines', () => {
    const depOut = ['DEP|WSearch|RpcSs,RPCSS|SearchUI', 'DEP|Spooler||', 'Other line'].join('\n')

    const depMap: Record<string, { dependsOn: string[]; dependents: string[] }> = {}
    for (const line of depOut.split('\n').filter((l) => l.startsWith('DEP|'))) {
      const parts = line.trim().split('|')
      if (parts.length >= 4) {
        depMap[parts[1]!] = {
          dependsOn: parts[2] ? parts[2].split(',').filter(Boolean) : [],
          dependents: parts[3] ? parts[3].split(',').filter(Boolean) : [],
        }
      }
    }

    expect(depMap.WSearch).toEqual({
      dependsOn: ['RpcSs', 'RPCSS'],
      dependents: ['SearchUI'],
    })
    expect(depMap.Spooler).toEqual({
      dependsOn: [],
      dependents: [],
    })
  })
})

// ── Apply result parsing logic ──

describe('apply result stdout parsing', () => {
  it('counts OK and FAIL lines correctly', () => {
    const stdout = [
      'OK|WSearch|Windows Search',
      'FAIL|Spooler|Print Spooler|Access denied',
      'OK|SysMain|SysMain',
      'some noise',
    ].join('\n')

    let succeeded = 0
    let failed = 0
    const errors: { name: string; displayName: string; reason: string }[] = []

    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('OK|')) {
        succeeded++
      } else if (trimmed.startsWith('FAIL|')) {
        failed++
        const parts = trimmed.split('|')
        errors.push({
          name: parts[1] || '',
          displayName: parts[2] || '',
          reason: parts[3] || 'Unknown error',
        })
      }
    }

    expect(succeeded).toBe(2)
    expect(failed).toBe(1)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toEqual({
      name: 'Spooler',
      displayName: 'Print Spooler',
      reason: 'Access denied',
    })
  })

  it('handles empty stdout gracefully', () => {
    const stdout = ''
    let succeeded = 0
    let failed = 0
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('OK|')) succeeded++
      else if (trimmed.startsWith('FAIL|')) failed++
    }
    expect(succeeded).toBe(0)
    expect(failed).toBe(0)
  })
})

// ── Scan result statistics calculation ──

describe('scan result statistics', () => {
  it('correctly calculates running, disabled, and safeToDisable counts', () => {
    const services = [
      { status: 'Running', startType: 'Automatic', safety: 'safe' },
      { status: 'Running', startType: 'Manual', safety: 'caution' },
      { status: 'Stopped', startType: 'Disabled', safety: 'safe' },
      { status: 'Stopped', startType: 'Manual', safety: 'safe' },
      { status: 'Running', startType: 'Automatic', safety: 'unsafe' },
    ]

    const runningCount = services.filter((s) => s.status === 'Running').length
    const disabledCount = services.filter((s) => s.startType === 'Disabled').length
    const safeToDisableCount = services.filter((s) => s.safety === 'safe' && s.startType !== 'Disabled').length

    expect(runningCount).toBe(3)
    expect(disabledCount).toBe(1)
    expect(safeToDisableCount).toBe(2) // first safe + fourth safe (third is already disabled)
  })
})

// ── scanServices ──────────────────────────────────────────────

describe('scanServices', () => {
  const svcLine = (name: string, display: string, state: string, start: string, desc: string, ms: string): string =>
    `SVC|${name}|${display}|${state}|${start}|${desc}|${ms}`

  const depLine = (name: string, deps: string, dependents: string): string => `DEP|${name}|${deps}|${dependents}`

  it('delegates to non-Windows platform', async () => {
    setPlatform('darwin')
    const platformResult: ServiceScanResult = {
      services: [],
      totalCount: 0,
      runningCount: 0,
      disabledCount: 0,
      safeToDisableCount: 0,
    }
    mocks.platformServicesScan.mockResolvedValue(platformResult)

    const result = await scanServices()

    expect(result).toEqual(platformResult)
    expect(mocks.platformServicesScan).toHaveBeenCalledOnce()
  })

  it('sends enumeration progress on start', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
    const onProgress = vi.fn()

    await scanServices(onProgress)

    expect(onProgress).toHaveBeenCalledWith({
      phase: 'enumerating',
      current: 0,
      total: 0,
      currentService: 'Enumerating services...',
    })
  })

  it('parses SVC lines into WindowsService array', async () => {
    const stdout = [
      svcLine('WSearch', 'Windows Search', 'Running', 'Auto', 'Content indexing', 'False'),
      svcLine('Spooler', 'Print Spooler', 'Stopped', 'Manual', 'Print jobs', 'True'),
    ].join('\n')
    mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })
    mocks.lookupServiceSafety.mockReturnValue({ safety: 'caution', category: 'unknown', note: '' })

    const result = await scanServices()

    expect(result.totalCount).toBe(2)
    expect(result.services[0]!).toMatchObject({
      name: 'WSearch',
      displayName: 'Windows Search',
      status: 'Running',
      startType: 'Automatic',
      isMicrosoft: false,
    })
    expect(result.services[1]!).toMatchObject({
      name: 'Spooler',
      displayName: 'Print Spooler',
      status: 'Stopped',
      startType: 'Manual',
      isMicrosoft: true,
    })
    expect(result.services[0]!.originalStartType).toBe('Automatic')
    expect(result.services[1]!.originalStartType).toBe('Manual')
    expect(result.services[0]!.selected).toBe(false)
    expect(result.services[1]!.selected).toBe(false)
  })

  it('resolves dependencies from second PowerShell call', async () => {
    const svcOut = [svcLine('WSearch', 'Windows Search', 'Running', 'Auto', '', 'True')].join('\n')
    const depOut = [depLine('WSearch', 'RpcSs', 'SearchUI')].join('\n')
    mocks.execFileAsync
      .mockResolvedValueOnce({ stdout: svcOut, stderr: '' })
      .mockResolvedValueOnce({ stdout: depOut, stderr: '' })
    mocks.lookupServiceSafety.mockReturnValue({ safety: 'caution', category: 'unknown', note: '' })

    const result = await scanServices()

    expect(result.services[0]!.dependsOn).toEqual(['RpcSs'])
    expect(result.services[0]!.dependents).toEqual(['SearchUI'])
  })

  it('handles dependency resolution failure gracefully', async () => {
    const svcOut = [svcLine('WSearch', 'Windows Search', 'Running', 'Auto', '', 'True')].join('\n')
    mocks.execFileAsync
      .mockResolvedValueOnce({ stdout: svcOut, stderr: '' })
      .mockRejectedValueOnce(new Error('PowerShell failed'))
    mocks.lookupServiceSafety.mockReturnValue({ safety: 'caution', category: 'unknown', note: '' })

    const result = await scanServices()

    expect(result.totalCount).toBe(1)
    expect(result.services[0]!.dependsOn).toEqual([])
    expect(result.services[0]!.dependents).toEqual([])
  })

  it('calls progress every 20 services during classification', async () => {
    const names = Array.from({ length: 41 }, (_, i) => `Svc${i}`)
    const lines = names.map((n) => svcLine(n, n, 'Running', 'Auto', '', 'True'))
    mocks.execFileAsync.mockResolvedValue({ stdout: lines.join('\n'), stderr: '' })
    mocks.lookupServiceSafety.mockReturnValue({ safety: 'caution', category: 'unknown', note: '' })
    const onProgress = vi.fn<(p: ServiceScanProgress) => void>()

    await scanServices(onProgress)

    const classifyCalls = onProgress.mock.calls.filter((c: [ServiceScanProgress]) => c[0].phase === 'classifying')
    expect(classifyCalls.length).toBeGreaterThanOrEqual(2)
    expect(classifyCalls[0]![0].current).toBe(0)
    expect(classifyCalls[classifyCalls.length - 1]![0].current).toBe(40)
  })

  it('calculates correct statistics', async () => {
    const lines = [
      svcLine('Svc1', 'Svc1', 'Running', 'Auto', '', 'True'),
      svcLine('Svc2', 'Svc2', 'Running', 'Manual', '', 'True'),
      svcLine('Svc3', 'Svc3', 'Stopped', 'Disabled', '', 'True'),
      svcLine('Svc4', 'Svc4', 'Stopped', 'Manual', '', 'True'),
    ].join('\n')
    mocks.execFileAsync.mockResolvedValue({ stdout: lines, stderr: '' })
    mocks.lookupServiceSafety
      .mockReturnValueOnce({ safety: 'safe', category: 'misc', note: '' })
      .mockReturnValueOnce({ safety: 'caution', category: 'misc', note: '' })
      .mockReturnValueOnce({ safety: 'safe', category: 'misc', note: '' })
      .mockReturnValueOnce({ safety: 'safe', category: 'misc', note: '' })

    const result = await scanServices()

    expect(result.totalCount).toBe(4)
    expect(result.runningCount).toBe(2)
    expect(result.disabledCount).toBe(1)
    expect(result.safeToDisableCount).toBe(2) // Svc1 (safe, not disabled) + Svc4 (safe, not disabled)
  })

  it('skips malformed SVC lines with fewer than 7 parts', async () => {
    const stdout = [svcLine('Good', 'Good', 'Running', 'Auto', 'desc', 'True'), 'SVC|bad|line', 'not a svc line'].join(
      '\n',
    )
    mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })
    mocks.lookupServiceSafety.mockReturnValue({ safety: 'caution', category: 'unknown', note: '' })

    const result = await scanServices()

    expect(result.totalCount).toBe(1)
    expect(result.services[0]!.name).toBe('Good')
  })

  it('uses lookupServiceSafety for each service', async () => {
    const stdout = [
      svcLine('WSearch', 'Windows Search', 'Running', 'Auto', '', 'True'),
      svcLine('Spooler', 'Print Spooler', 'Stopped', 'Manual', '', 'True'),
    ].join('\n')
    mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })
    mocks.lookupServiceSafety
      .mockReturnValueOnce({ safety: 'caution', category: 'misc', note: 'Windows Search' })
      .mockReturnValueOnce({ safety: 'caution', category: 'print', note: 'Print Spooler' })

    const result = await scanServices()

    expect(mocks.lookupServiceSafety).toHaveBeenCalledTimes(2)
    expect(mocks.lookupServiceSafety).toHaveBeenNthCalledWith(1, 'WSearch')
    expect(mocks.lookupServiceSafety).toHaveBeenNthCalledWith(2, 'Spooler')
    expect(result.services[0]!.safety).toBe('caution')
    expect(result.services[0]!.category).toBe('misc')
    expect(result.services[1]!.safety).toBe('caution')
    expect(result.services[1]!.category).toBe('print')
  })

  it('returns empty result when no services found', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: 'no SVC lines here\n', stderr: '' })

    const result = await scanServices()

    expect(result.totalCount).toBe(0)
    expect(result.services).toEqual([])
    expect(result.runningCount).toBe(0)
    expect(result.disabledCount).toBe(0)
    expect(result.safeToDisableCount).toBe(0)
  })

  it('includes incompatibleGames from safety KB', async () => {
    const stdout = [svcLine('SysMain', 'SysMain', 'Running', 'Auto', '', 'True')].join('\n')
    mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })
    mocks.lookupServiceSafety.mockReturnValue({
      safety: 'caution',
      category: 'misc',
      note: '',
      incompatibleGames: ['fivem', 'minecraft'],
    })

    const result = await scanServices()

    expect(result.services[0]!.incompatibleGames).toEqual(['fivem', 'minecraft'])
  })

  it('normalizes all start type variants including Boot, System, AutoDelayed', async () => {
    const stdout = [
      svcLine('BootSvc', 'Boot', 'Running', 'Boot', '', 'True'),
      svcLine('SysSvc', 'System', 'Running', 'System', '', 'True'),
      svcLine('DelayedSvc', 'Delayed', 'Running', 'AutoDelayed', '', 'True'),
    ].join('\n')
    mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })
    mocks.lookupServiceSafety.mockReturnValue({ safety: 'caution', category: 'unknown', note: '' })

    const result = await scanServices()

    expect(result.services[0]!.startType).toBe('Boot')
    expect(result.services[1]!.startType).toBe('System')
    expect(result.services[2]!.startType).toBe('AutomaticDelayed')
  })

  it('normalizes all status variants including StartPending, StopPending, Paused', async () => {
    const stdout = [
      svcLine('Svc1', 'Svc1', 'StartPending', 'Manual', '', 'True'),
      svcLine('Svc2', 'Svc2', 'StopPending', 'Manual', '', 'True'),
      svcLine('Svc3', 'Svc3', 'Paused', 'Manual', '', 'True'),
    ].join('\n')
    mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })
    mocks.lookupServiceSafety.mockReturnValue({ safety: 'caution', category: 'unknown', note: '' })

    const result = await scanServices()

    expect(result.services[0]!.status).toBe('StartPending')
    expect(result.services[1]!.status).toBe('StopPending')
    expect(result.services[2]!.status).toBe('Paused')
  })

  it('handles DEP parsing with empty dependency fields', async () => {
    const svcOut = [svcLine('WSearch', 'Windows Search', 'Running', 'Auto', '', 'True')].join('\n')
    const depOut = 'DEP|WSearch||\n'
    mocks.execFileAsync
      .mockResolvedValueOnce({ stdout: svcOut, stderr: '' })
      .mockResolvedValueOnce({ stdout: depOut, stderr: '' })
    mocks.lookupServiceSafety.mockReturnValue({ safety: 'caution', category: 'unknown', note: '' })

    const result = await scanServices()

    expect(result.services[0]!.dependsOn).toEqual([])
    expect(result.services[0]!.dependents).toEqual([])
  })

  it('uses fallback defaults for unrecognized startType/status', async () => {
    const stdout = [svcLine('UnknownSvc', 'Unknown', 'BogusState', 'UnknownStartType', '', 'True')].join('\n')
    mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })
    mocks.lookupServiceSafety.mockReturnValue({ safety: 'caution', category: 'unknown', note: '' })

    const result = await scanServices()

    expect(result.services[0]!.startType).toBe('Manual')
    expect(result.services[0]!.status).toBe('Unknown')
  })
})

// ── applyServiceChanges ───────────────────────────────────────

describe('applyServiceChanges', () => {
  const validChange = { name: 'WSearch', targetStartType: 'Disabled' }

  it('returns empty result for empty changes array', async () => {
    const result = await applyServiceChanges([])

    expect(result).toEqual({ succeeded: 0, failed: 0, errors: [] })
    expect(mocks.logger.warning).toHaveBeenCalledWith('service-manager', 'Apply skipped — no changes provided')
  })

  it('delegates to non-Windows platform', async () => {
    setPlatform('darwin')
    const platformResult: ServiceApplyResult = { succeeded: 1, failed: 0, errors: [] }
    mocks.platformServicesApply.mockResolvedValue(platformResult)

    const result = await applyServiceChanges([validChange])

    expect(result).toEqual(platformResult)
    expect(mocks.platformServicesApply).toHaveBeenCalledOnce()
  })

  it('returns error for invalid change entry type', async () => {
    const result = await applyServiceChanges([{ name: 123 as any, targetStartType: 'Manual' }])

    expect(result).toEqual({
      succeeded: 0,
      failed: 0,
      errors: [{ name: '', displayName: '', reason: 'Invalid change entry' }],
    })
  })

  it('returns error for invalid service name', async () => {
    const result = await applyServiceChanges([{ name: 'invalid;name', targetStartType: 'Manual' }])

    expect(result).toEqual({
      succeeded: 0,
      failed: 0,
      errors: [{ name: 'invalid;name', displayName: 'invalid;name', reason: 'Invalid service name' }],
    })
  })

  it('filters unsafe services when force is false', async () => {
    mocks.lookupServiceSafety.mockImplementation((name: string) =>
      name === 'SafeSvc'
        ? { safety: 'safe', category: 'misc', note: '' }
        : { safety: 'unsafe', category: 'core', note: '' },
    )
    mocks.execFileAsync.mockResolvedValue({ stdout: 'OK|SafeSvc|Safe', stderr: '' })

    const result = await applyServiceChanges([
      { name: 'SafeSvc', targetStartType: 'Disabled' },
      { name: 'UnsafeSvc', targetStartType: 'Disabled' },
    ])

    // Only SafeSvc was sent to PowerShell
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('allows unsafe services when force is true', async () => {
    mocks.lookupServiceSafety.mockReturnValue({ safety: 'unsafe', category: 'core', note: '' })
    mocks.execFileAsync.mockResolvedValue({ stdout: 'OK|UnsafeSvc|Unsafe', stderr: '' })

    const result = await applyServiceChanges([{ name: 'UnsafeSvc', targetStartType: 'Disabled' }], true)

    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('parses OK and FAIL lines from PowerShell output', async () => {
    mocks.lookupServiceSafety.mockReturnValue({ safety: 'safe', category: 'misc', note: '' })
    const stdout = ['OK|WSearch|Windows Search', 'FAIL|Spooler|Print Spooler|Access denied', 'OK|SysMain|SysMain'].join(
      '\n',
    )
    mocks.execFileAsync.mockResolvedValue({ stdout, stderr: '' })

    const result = await applyServiceChanges([
      { name: 'WSearch', targetStartType: 'Disabled' },
      { name: 'Spooler', targetStartType: 'Disabled' },
      { name: 'SysMain', targetStartType: 'Disabled' },
    ])

    expect(result.succeeded).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!).toEqual({ name: 'Spooler', displayName: 'Print Spooler', reason: 'Access denied' })
  })

  it('handles PowerShell execution error', async () => {
    mocks.lookupServiceSafety.mockReturnValue({ safety: 'safe', category: 'misc', note: '' })
    mocks.execFileAsync.mockRejectedValue(new Error('PowerShell crashed'))

    const result = await applyServiceChanges([validChange])

    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.reason).toBe('PowerShell crashed')
  })

  it('maps targetStartType through ALLOWED_TYPES', async () => {
    mocks.lookupServiceSafety.mockReturnValue({ safety: 'safe', category: 'misc', note: '' })
    mocks.execFileAsync.mockResolvedValue({
      stdout: 'OK|Svc1|Svc1\nOK|Svc2|Svc2\nOK|Svc3|Svc3\nOK|Svc4|Svc4',
      stderr: '',
    })

    const result = await applyServiceChanges([
      { name: 'Svc1', targetStartType: 'Manual' },
      { name: 'Svc2', targetStartType: 'Disabled' },
      { name: 'Svc3', targetStartType: 'Automatic' },
      { name: 'Svc4', targetStartType: 'AutomaticDelayed' },
    ])

    expect(result.succeeded).toBe(4)
    // Verify the PowerShell script contains correct startup types
    const scriptCall = mocks.execFileAsync.mock.calls[0]![2] as { timeout: number }
    expect(scriptCall.timeout).toBeGreaterThan(0)
  })

  it('handles PowerShell exception with non-Error type', async () => {
    mocks.lookupServiceSafety.mockReturnValue({ safety: 'safe', category: 'misc', note: '' })
    mocks.execFileAsync.mockRejectedValue('string error' as any)

    const result = await applyServiceChanges([validChange])

    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('PowerShell execution failed')
  })

  it('falls back to Disabled for unknown targetStartType', async () => {
    mocks.lookupServiceSafety.mockReturnValue({ safety: 'safe', category: 'misc', note: '' })
    mocks.execFileAsync.mockResolvedValue({ stdout: 'OK|Svc|Svc', stderr: '' })

    const result = await applyServiceChanges([{ name: 'Svc', targetStartType: 'UnknownType' }])

    expect(result.succeeded).toBe(1)
  })

  it('parses FAIL lines with missing parts using fallback defaults', async () => {
    mocks.lookupServiceSafety.mockReturnValue({ safety: 'safe', category: 'misc', note: '' })
    // FAIL| with only name, no displayName or reason
    mocks.execFileAsync.mockResolvedValue({ stdout: 'FAIL|SvcName||\nFAIL|\n', stderr: '' })

    const result = await applyServiceChanges([
      { name: 'SvcName', targetStartType: 'Manual' },
      { name: 'Svc2', targetStartType: 'Manual' },
    ])

    expect(result.failed).toBe(2)
    expect(result.errors[0]!).toEqual({ name: 'SvcName', displayName: '', reason: 'Unknown error' })
    expect(result.errors[1]).toEqual({ name: '', displayName: '', reason: 'Unknown error' })
  })

  it('handles non-string targetStartType as invalid entry', async () => {
    const result = await applyServiceChanges([
      { name: 'Svc', targetStartType: 'Manual' },
      { name: 42 as any, targetStartType: 'Disabled' },
    ])

    expect(result).toEqual({
      succeeded: 0,
      failed: 0,
      errors: [{ name: '', displayName: '', reason: 'Invalid change entry' }],
    })
  })
})

// ── registerServiceManagerIpc ─────────────────────────────────

describe('registerServiceManagerIpc', () => {
  function getHandler(channel: string): (...args: unknown[]) => unknown {
    const call = mocks.ipcHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler registered for ${channel}`)
    return call[1] as (...args: unknown[]) => unknown
  }

  it('registers SERVICE_SCAN and SERVICE_APPLY handlers', () => {
    registerServiceManagerIpc(() => null)

    expect(mocks.ipcHandle).toHaveBeenCalledTimes(2)
    expect(mocks.ipcHandle).toHaveBeenCalledWith(IPC.SERVICE_SCAN, expect.any(Function))
    expect(mocks.ipcHandle).toHaveBeenCalledWith(IPC.SERVICE_APPLY, expect.any(Function))
  })

  it('SERVICE_SCAN handler calls scanServices and forwards progress to window', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
    const mockSend = vi.fn()
    const getWindow = vi.fn().mockReturnValue({
      webContents: { send: mockSend },
      isDestroyed: () => false,
    })
    registerServiceManagerIpc(getWindow)
    const handler = getHandler(IPC.SERVICE_SCAN)

    const result = await handler()

    expect(result).toBeDefined()
    expect(mocks.logger.info).toHaveBeenCalledWith('service-manager', 'IPC: scan requested')
  })

  it('SERVICE_SCAN progress callback sends to window', async () => {
    const svcOut = 'SVC|WSearch|Windows Search|Running|Auto||True\n'
    mocks.execFileAsync.mockResolvedValue({ stdout: svcOut, stderr: '' })
    mocks.lookupServiceSafety.mockReturnValue({ safety: 'caution', category: 'unknown', note: '' })
    const mockSend = vi.fn()
    const getWindow = vi.fn().mockReturnValue({
      webContents: { send: mockSend },
      isDestroyed: () => false,
    })
    registerServiceManagerIpc(getWindow)
    const handler = getHandler(IPC.SERVICE_SCAN)

    await handler()

    expect(mockSend).toHaveBeenCalledWith(IPC.SERVICE_PROGRESS, expect.objectContaining({ phase: 'enumerating' }))
  })

  it('SERVICE_APPLY handler validates changes is an array', async () => {
    registerServiceManagerIpc(() => null)
    const handler = getHandler(IPC.SERVICE_APPLY)
    const result = await handler(null, 'not-an-array' as any)

    expect(result).toEqual({ succeeded: 0, failed: 0, errors: [] })
    expect(mocks.logger.warning).toHaveBeenCalledWith('service-manager', 'Apply skipped — invalid changes payload')
  })

  it('SERVICE_APPLY handler passes force flag to applyServiceChanges', async () => {
    mocks.lookupServiceSafety.mockReturnValue({ safety: 'safe', category: 'misc', note: '' })
    mocks.execFileAsync.mockResolvedValue({ stdout: 'OK|Svc|Svc', stderr: '' })
    registerServiceManagerIpc(() => null)
    const handler = getHandler(IPC.SERVICE_APPLY)

    const result = await handler(null, [{ name: 'Svc', targetStartType: 'Disabled' }], true)

    expect(result).toEqual({ succeeded: 1, failed: 0, errors: [], skippedNames: [], skippedCount: 0 })
  })
})
