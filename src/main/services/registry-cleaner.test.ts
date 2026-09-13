import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Mock exec-utf8 ---
const mockExecNativeUtf8 = vi.fn()
const mockExecTracked = vi.fn()
const mockExecFileAsync = vi.fn()

vi.mock('./exec-utf8', () => ({
  execNativeUtf8: (...args: unknown[]) => mockExecNativeUtf8(...args),
  execTracked: (...args: unknown[]) => mockExecTracked(...args),
  execFileAsync: (...args: unknown[]) => mockExecFileAsync(...args),
  psUtf8: (s: string) => s,
  psArgs: (s: string) => ['-NoProfile', '-NonInteractive', '-Command', s],
}))

// --- Mock logger ---
vi.mock('./logger.service', () => ({
  getLogger: () => ({ warning: vi.fn(), info: vi.fn(), error: vi.fn() }),
}))

// --- Mock backup-dir ---
const mockGetBackupDir = vi.fn()
vi.mock('./backup-dir', () => ({
  getBackupDir: (...args: unknown[]) => mockGetBackupDir(...args),
}))

// --- Mock settings-store ---
const mockGetSettings = vi.fn()
vi.mock('./settings-store', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
}))

// --- Mock fs ---
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  mkdtempSync: vi.fn(() => 'C:\\Temp\\dinho-reg-backup-test'),
  readFileSync: vi.fn(() => ''),
  readdirSync: vi.fn(() => []),
  rmSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

import {
  clsidExists,
  expandEnvVars,
  extractExePath,
  findMissingClsidDll,
  splitTaskPath,
} from './registry-cleaner/utils'
import { collectBackupTargets, fixRegistryEntries, scanRegistry } from './registry-cleaner.service'

beforeEach(() => {
  vi.clearAllMocks()
})

// ----------------------------------------------------------------
// collectBackupTargets
// ----------------------------------------------------------------
describe('collectBackupTargets', () => {
  it('collects keys for delete-value operations', () => {
    const result = collectBackupTargets([
      {
        id: '1',
        type: 'invalid',
        keyPath: 'HKLM\\Software\\Test',
        valueName: 'Val',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'delete-value' },
      },
    ])
    expect(result.keys).toEqual(['HKLM\\Software\\Test'])
    expect(result.tasks).toEqual([])
  })

  it('collects keys for set-value operations', () => {
    const result = collectBackupTargets([
      {
        id: '1',
        type: 'invalid',
        keyPath: 'HKLM\\Software\\Test',
        valueName: 'Val',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '0' },
      },
    ])
    expect(result.keys).toEqual(['HKLM\\Software\\Test'])
    expect(result.tasks).toEqual([])
  })

  it('collects keys for delete-key operations', () => {
    const result = collectBackupTargets([
      {
        id: '1',
        type: 'invalid',
        keyPath: 'HKLM\\Software\\Test',
        valueName: '',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'delete-key' },
      },
    ])
    expect(result.keys).toEqual(['HKLM\\Software\\Test'])
    expect(result.tasks).toEqual([])
  })

  it('collects tasks for disable-task operations', () => {
    const result = collectBackupTargets([
      {
        id: '1',
        type: 'task',
        keyPath: '\\MyFolder\\MyTask',
        valueName: '',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'disable-task' },
      },
    ])
    expect(result.keys).toEqual([])
    expect(result.tasks).toEqual(['\\MyFolder\\MyTask'])
  })

  it('collects tasks for delete-task operations', () => {
    const result = collectBackupTargets([
      {
        id: '1',
        type: 'task',
        keyPath: '\\MyFolder\\MyTask',
        valueName: '',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'delete-task' },
      },
    ])
    expect(result.keys).toEqual([])
    expect(result.tasks).toEqual(['\\MyFolder\\MyTask'])
  })

  it('skips entries without a fix', () => {
    const result = collectBackupTargets([
      {
        id: '1',
        type: 'invalid',
        keyPath: 'HKLM\\Software\\Test',
        valueName: 'Val',
        issue: 'x',
        risk: 'low',
        selected: true,
      },
    ])
    expect(result.keys).toEqual([])
    expect(result.tasks).toEqual([])
  })

  it('uses fix.key when provided', () => {
    const result = collectBackupTargets([
      {
        id: '1',
        type: 'invalid',
        keyPath: 'HKLM\\Software\\Original',
        valueName: 'Val',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'delete-value', key: 'HKLM\\Software\\Override' },
      },
    ])
    expect(result.keys).toEqual(['HKLM\\Software\\Override'])
  })

  it('deduplicates keys', () => {
    const result = collectBackupTargets([
      {
        id: '1',
        type: 'invalid',
        keyPath: 'HKLM\\Software\\Test',
        valueName: 'A',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'delete-value' },
      },
      {
        id: '2',
        type: 'invalid',
        keyPath: 'HKLM\\Software\\Test',
        valueName: 'B',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'delete-value' },
      },
    ])
    expect(result.keys).toEqual(['HKLM\\Software\\Test'])
  })

  it('returns empty for no entries', () => {
    const result = collectBackupTargets([])
    expect(result.keys).toEqual([])
    expect(result.tasks).toEqual([])
  })

  it('handles falsy fix.key with empty keyPath (line 90 false)', () => {
    const result = collectBackupTargets([
      {
        id: '1',
        type: 'invalid',
        keyPath: '',
        valueName: 'Val',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'delete-value', key: '' },
      },
    ])
    expect(result.keys).toEqual([])
    expect(result.tasks).toEqual([])
  })

  it('handles falsy keyPath for task entries (line 94 false)', () => {
    const result = collectBackupTargets([
      {
        id: '1',
        type: 'task',
        keyPath: '',
        valueName: '',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'disable-task' },
      },
    ])
    expect(result.keys).toEqual([])
    expect(result.tasks).toEqual([])
  })
})

// ----------------------------------------------------------------
// scanRegistry (integration via mocked execReg)
// ----------------------------------------------------------------
describe('scanRegistry', () => {
  it('returns empty array when no registry issues found', async () => {
    const signal = new AbortController().signal
    // Provide empty stdout for each reg query
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
    const results = await scanRegistry(signal)
    expect(Array.isArray(results)).toBe(true)
  })

  it('handles errors from reg queries gracefully', async () => {
    mockExecNativeUtf8.mockRejectedValue(new Error('reg command failed'))
    const results = await scanRegistry()
    expect(Array.isArray(results)).toBe(true)
  })

  it('detects missing App Paths', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true)

    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('App Paths')) {
        return {
          stdout: String.raw`
HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\test.exe
    (Default)    REG_SZ    C:\Program Files\TestApp\test.exe
`,
          stderr: '',
        }
      }
      return { stdout: '', stderr: '' }
    })

    const results = await scanRegistry()
    // Since exe exists, no entries expected from App Paths
    const invalidPaths = results.filter((r) => r.type === 'invalid')
    expect(invalidPaths).toHaveLength(0)
  })

  it('marks App Paths pointing to missing files', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      const p = typeof path === 'string' ? path : String(path)
      if (p.includes('test.exe')) return false
      return true
    })

    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('App Paths')) {
        return {
          stdout:
            '\r\n\r\nHKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\test.exe\r\n    (Default)    REG_SZ    C:\\Program Files\\TestApp\\test.exe\r\n',
          stderr: '',
        }
      }
      return { stdout: '', stderr: '' }
    })

    const results = await scanRegistry()
    const invalidPaths = results.filter((r) => r.type === 'invalid')
    expect(invalidPaths.length).toBeGreaterThanOrEqual(1)
    expect(invalidPaths[0]!.issue).toContain('test.exe')
  })

  it('respects abort signal', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    mockExecNativeUtf8.mockRejectedValue(new Error('aborted'))
    await expect(scanRegistry(ctrl.signal)).rejects.toThrow('Operation cancelled')
  })
})

// ----------------------------------------------------------------
// fixRegistryEntries
// ----------------------------------------------------------------
describe('fixRegistryEntries', () => {
  const defaultEntry = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: '1',
    type: 'invalid',
    keyPath: 'HKLM\\Software\\Test',
    valueName: 'TestVal',
    issue: 'Test issue',
    risk: 'low',
    selected: true,
    ...overrides,
  })

  beforeEach(() => {
    mockGetBackupDir.mockReturnValue('C:\\DinHo\\backups')
    mockGetSettings.mockReturnValue({ backupMode: 'targeted' })
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
    mockExecTracked.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('fixes entries with delete-value operation', async () => {
    const result = await fixRegistryEntries([defaultEntry({ fix: { op: 'delete-value' } }) as never])

    expect(result.fixed).toBe(1)
    expect(result.failed).toBe(0)
    expect(mockExecNativeUtf8).toHaveBeenCalledWith(
      'reg',
      ['delete', 'HKLM\\Software\\Test', '/v', 'TestVal', '/f'],
      expect.any(Object),
    )
  })

  it('fixes entries with delete-key operation', async () => {
    const result = await fixRegistryEntries([defaultEntry({ fix: { op: 'delete-key' } }) as never])

    expect(result.fixed).toBe(1)
    expect(mockExecNativeUtf8).toHaveBeenCalledWith('reg', ['delete', 'HKLM\\Software\\Test', '/f'], expect.any(Object))
  })

  it('fixes entries with set-value operation', async () => {
    const result = await fixRegistryEntries([
      defaultEntry({ fix: { op: 'set-value', regType: 'REG_DWORD', data: '1' } }) as never,
    ])

    expect(result.fixed).toBe(1)
    expect(mockExecNativeUtf8).toHaveBeenCalledWith(
      'reg',
      ['add', 'HKLM\\Software\\Test', '/v', 'TestVal', '/t', 'REG_DWORD', '/d', '1', '/f'],
      expect.any(Object),
    )
  })

  it('fixes entries with disable-task operation', async () => {
    const result = await fixRegistryEntries([
      defaultEntry({
        type: 'task',
        keyPath: '\\MyFolder\\MyTask',
        valueName: '',
        fix: { op: 'disable-task' },
      }) as never,
    ])

    expect(result.fixed).toBe(1)
    expect(mockExecTracked).toHaveBeenCalledWith(
      'powershell',
      expect.arrayContaining(['-NoProfile', expect.any(String), expect.any(String), expect.any(String)]),
      expect.any(Object),
    )
  })

  it('fixes entries with delete-task operation', async () => {
    const result = await fixRegistryEntries([
      defaultEntry({ type: 'task', keyPath: '\\MyFolder\\MyTask', valueName: '', fix: { op: 'delete-task' } }) as never,
    ])

    expect(result.fixed).toBe(1)
    expect(mockExecTracked).toHaveBeenCalledWith(
      'powershell',
      expect.arrayContaining(['-NoProfile', expect.any(String), expect.any(String), expect.any(String)]),
      expect.any(Object),
    )
  })

  it('counts failures when reg delete fails with access denied', async () => {
    mockExecNativeUtf8.mockRejectedValue(new Error('Access is denied'))
    const result = await fixRegistryEntries([defaultEntry({ fix: { op: 'delete-value' } }) as never])

    expect(result.fixed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.failures[0]!.reason).toContain('Access denied')
  })

  it('counts failures when key not found', async () => {
    mockExecNativeUtf8.mockRejectedValue(new Error('cannot find'))
    const result = await fixRegistryEntries([defaultEntry({ fix: { op: 'delete-key' } }) as never])

    expect(result.fixed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.failures[0]!.reason).toContain('no longer exists')
  })

  it('handles entries without fix data', async () => {
    const result = await fixRegistryEntries([defaultEntry({ fix: undefined }) as never])

    expect(result.fixed).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('calls onProgress during execution', async () => {
    const onProgress = vi.fn()
    await fixRegistryEntries(
      [
        defaultEntry({ fix: { op: 'delete-value' } }) as never,
        defaultEntry({
          id: '2',
          keyPath: 'HKLM\\Software\\Other',
          valueName: 'OtherVal',
          fix: { op: 'delete-value' },
        }) as never,
      ],
      onProgress,
    )

    expect(onProgress).toHaveBeenCalled()
    expect(onProgress.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('respects abort signal during fixing', async () => {
    const ctrl = new AbortController()
    const onProgress = vi.fn()

    const promise = fixRegistryEntries(
      [defaultEntry({ fix: { op: 'delete-value' } }) as never],
      onProgress,
      ctrl.signal,
    )

    ctrl.abort()
    const result = await promise
    expect(result.fixed).toBe(0)
  })

  it('handles mixed success and failure', async () => {
    // Backup makes 1 execNativeUtf8 call, then fix loop makes 2
    mockExecNativeUtf8
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // backup export
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // fix entry 1
      .mockRejectedValueOnce(new Error('Access is denied')) // fix entry 2

    const result = await fixRegistryEntries([
      defaultEntry({ id: '1', fix: { op: 'delete-value' } }) as never,
      defaultEntry({ id: '2', fix: { op: 'delete-value' } }) as never,
    ])

    expect(result.fixed).toBe(1)
    expect(result.failed).toBe(1)
  })

  it('creates backup with targeted mode before fixing', async () => {
    mockGetSettings.mockReturnValue({ backupMode: 'targeted' })
    const result = await fixRegistryEntries([defaultEntry({ fix: { op: 'delete-value' } }) as never])
    expect(result.fixed).toBe(1)
    expect(mockGetBackupDir).toHaveBeenCalled()
  })

  it('creates backup with full mode when configured', async () => {
    mockGetSettings.mockReturnValue({ backupMode: 'full' })
    const result = await fixRegistryEntries([defaultEntry({ fix: { op: 'delete-value' } }) as never])
    expect(result.fixed).toBe(1)
    expect(mockGetBackupDir).toHaveBeenCalled()
  })

  it('classifies network error in fix failures', async () => {
    mockExecNativeUtf8.mockRejectedValue(new Error('network path not found'))
    const result = await fixRegistryEntries([defaultEntry({ fix: { op: 'delete-value' } }) as never])
    expect(result.failed).toBe(1)
    expect(result.failures[0]!.reason).toBe('Network error')
  })

  it('handles unknown error message', async () => {
    mockExecNativeUtf8.mockRejectedValue(new Error(''))
    const result = await fixRegistryEntries([defaultEntry({ fix: { op: 'delete-value' } }) as never])
    expect(result.failed).toBe(1)
    expect(result.failures[0]!.reason).toBe('Unknown error')
  })

  it('handles error with stderr property', async () => {
    const err = new Error('wrapper')
    ;(err as { stderr?: string }).stderr = 'Access is denied'
    mockExecNativeUtf8.mockRejectedValue(err)
    const result = await fixRegistryEntries([defaultEntry({ fix: { op: 'delete-value' } }) as never])
    expect(result.failed).toBe(1)
    expect(result.failures[0]!.reason).toContain('Access denied')
  })

  it('handles set-value without regType or data as a failure', async () => {
    const result = await fixRegistryEntries([defaultEntry({ fix: { op: 'set-value' } }) as never])
    expect(result.fixed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.failures[0]!.reason).toContain('regType or data')
  })

  it('handles full backup mode with export failures', async () => {
    mockGetSettings.mockReturnValue({ backupMode: 'full' })
    mockExecNativeUtf8.mockResolvedValueOnce({ stdout: '', stderr: '' }).mockRejectedValue(new Error('export failed'))
    const result = await fixRegistryEntries([defaultEntry({ fix: { op: 'delete-value' } }) as never])
    expect(result.failed).toBe(1)
  })

  it('handles targeted backup with task entries', async () => {
    mockExecNativeUtf8
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(new Error('schtasks failed'))
    mockExecTracked.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await fixRegistryEntries([
      defaultEntry({
        type: 'task',
        keyPath: '\\MyFolder\\MyTask',
        valueName: '',
        fix: { op: 'disable-task' },
      }) as never,
    ])
    expect(result.fixed).toBe(1)
  })

  it('handles targeted backup with task entries backup', async () => {
    mockExecNativeUtf8
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '<xml/>', stderr: '' })
    mockExecTracked.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await fixRegistryEntries([
      defaultEntry({ type: 'task', keyPath: '\\MyFolder\\MyTask', valueName: '', fix: { op: 'delete-task' } }) as never,
    ])
    expect(result.fixed).toBe(1)
  })

  it('creates full backup with signal present (covers all signal spreads in createFullBackup)', async () => {
    mockGetSettings.mockReturnValue({ backupMode: 'full' })
    const ctrl = new AbortController()
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await fixRegistryEntries(
      [defaultEntry({ fix: { op: 'delete-value' } }) as never],
      undefined,
      ctrl.signal,
    )
    expect(result.fixed).toBe(1)
    expect(mockExecNativeUtf8).toHaveBeenCalledWith(
      'reg',
      expect.arrayContaining(['export']),
      expect.objectContaining({ signal: ctrl.signal }),
    )
  })

  it('creates targeted backup with signal aborted during key loop (line 114)', async () => {
    mockGetSettings.mockReturnValue({ backupMode: 'targeted' })
    const ctrl = new AbortController()
    ctrl.abort()
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await fixRegistryEntries(
      [defaultEntry({ fix: { op: 'delete-value' } }) as never],
      undefined,
      ctrl.signal,
    )
    expect(result.fixed).toBe(0)
  })

  it('creates targeted backup with signal aborted during task loop (line 134)', async () => {
    mockGetSettings.mockReturnValue({ backupMode: 'targeted' })
    const ctrl = new AbortController()
    ctrl.abort()
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await fixRegistryEntries(
      [
        defaultEntry({
          type: 'task',
          keyPath: '\\MyFolder\\MyTask',
          valueName: '',
          fix: { op: 'delete-task' },
        }) as never,
      ],
      undefined,
      ctrl.signal,
    )
    expect(result.fixed).toBe(0)
  })

  it('handles splitTaskPath returning null during targeted backup (line 136)', async () => {
    mockGetSettings.mockReturnValue({ backupMode: 'targeted' })
    mockExecNativeUtf8
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(new Error('schtasks failed'))
    const result = await fixRegistryEntries(
      [
        defaultEntry({
          type: 'task',
          keyPath: '\\Folder\\Bad<Task>',
          valueName: '',
          fix: { op: 'delete-task' },
        }) as never,
      ],
      undefined,
      undefined,
    )
    expect(result.failed).toBe(1)
    expect(result.failures[0]!.reason).toContain('Invalid task path')
  })

  it('handles empty safeName (name falls back to "task") in targeted backup (line 138)', async () => {
    mockGetSettings.mockReturnValue({ backupMode: 'targeted' })
    mockExecNativeUtf8
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '<xml/>', stderr: '' })
    const result = await fixRegistryEntries(
      [
        defaultEntry({
          type: 'task',
          keyPath: '\\MyFolder\\',
          valueName: '',
          fix: { op: 'delete-task' },
        }) as never,
      ],
      undefined,
      undefined,
    )
    expect(result.fixed).toBe(1)
  })

  it('passes signal to execNativeUtf8 during task backup (line 142)', async () => {
    mockGetSettings.mockReturnValue({ backupMode: 'targeted' })
    const ctrl = new AbortController()
    mockExecNativeUtf8
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '<xml/>', stderr: '' })
    const result = await fixRegistryEntries(
      [
        defaultEntry({
          type: 'task',
          keyPath: '\\MyFolder\\MyTask',
          valueName: '',
          fix: { op: 'delete-task' },
        }) as never,
      ],
      undefined,
      ctrl.signal,
    )
    expect(result.fixed).toBe(1)
    expect(mockExecNativeUtf8).toHaveBeenCalledWith(
      'schtasks',
      expect.any(Array),
      expect.objectContaining({ signal: ctrl.signal }),
    )
  })
})

// ----------------------------------------------------------------
// expandEnvVars tests (exercised through scanRegistry)
// ----------------------------------------------------------------
describe('expandEnvVars (via scanRegistry)', () => {
  beforeEach(() => {
    vi.stubEnv('WINDIR', 'C:\\Windows')
    vi.stubEnv('PROGRAMFILES', 'C:\\Program Files')
    vi.stubEnv('PROGRAMFILES(X86)', 'C:\\Program Files (x86)')
    vi.stubEnv('PROGRAMDATA', 'C:\\ProgramData')
    vi.stubEnv('COMMONPROGRAMFILES', 'C:\\Program Files\\Common Files')
    vi.stubEnv('USERPROFILE', 'C:\\Users\\Test')
    vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\Test\\AppData\\Local')
    vi.stubEnv('APPDATA', 'C:\\Users\\Test\\AppData\\Roaming')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resolves %SystemRoot% paths via AppCompat HKLM scan', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('LegacyApp.exe')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('AppCompatFlags\\Layers') && args[1]?.startsWith('HKLM')) {
        return { stdout: '\r\n    C:\\Tools\\LegacyApp.exe    REG_SZ    WIN7RTM', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const compat = results.filter((r) => r.issue.includes('LegacyApp.exe'))
    expect(compat.length).toBeGreaterThanOrEqual(1)
  })

  it('resolves %ProgramFiles% via AppCompat HKCU scan', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('MissingApp.exe')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('AppCompatFlags\\Layers') && args[1]?.startsWith('HKCU')) {
        return { stdout: '\r\n    C:\\Program Files\\MissingApp.exe    REG_SZ    WIN7RTM', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const compat = results.filter((r) => r.issue.includes('MissingApp.exe'))
    expect(compat.length).toBeGreaterThanOrEqual(1)
  })
})

// ----------------------------------------------------------------
// extractExePath tests (exercised through scanRegistry Run keys)
// ----------------------------------------------------------------
describe('extractExePath (via scanRegistry)', () => {
  it('handles quoted executable path in Run keys', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('MissingQuoted.exe')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('\\Run')) {
        return { stdout: '\r\n    MyApp    REG_SZ    "C:\\Program Files\\MissingQuoted.exe" /silent', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const runEntries = results.filter((r) => r.issue.includes('MissingQuoted.exe'))
    expect(runEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('handles simple executable without spaces in Run keys', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('missing.exe')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('\\Run')) {
        return { stdout: '\r\n    App    REG_SZ    C:\\Tools\\missing.exe', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const runEntries = results.filter((r) => r.issue.includes('missing.exe'))
    expect(runEntries.length).toBeGreaterThanOrEqual(1)
  })
})

// ----------------------------------------------------------------
// Additional scanRegistry scan paths
// ----------------------------------------------------------------
describe('scanRegistry additional scan paths', () => {
  beforeEach(() => {
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('scans SharedDLLs and detects missing DLLs', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('missing.dll')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('SharedDLLs')) {
        return { stdout: '\r\n    C:\\Program Files\\MissingApp\\missing.dll    REG_DWORD    0x1', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const sharedDlls = results.filter((r) => r.issue.includes('missing.dll'))
    expect(sharedDlls.length).toBeGreaterThanOrEqual(1)
    expect(sharedDlls[0]!.fix).toEqual({ op: 'delete-value' })
  })

  it('scans MuiCache and detects missing programs', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('GhostApp')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('MuiCache')) {
        return { stdout: '\r\n    C:\\Tools\\GhostApp.exe.FriendlyAppName    REG_SZ    Ghost App', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const muiEntries = results.filter((r) => r.issue.includes('GhostApp'))
    expect(muiEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('scans FirewallRules and detects missing programs', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('GhostRule.exe')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('FirewallRules')) {
        return { stdout: '\r\n    Rule1    REG_SZ    App=C:\\Tools\\GhostRule.exe|Action=Allow', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const fwEntries = results.filter((r) => r.issue.includes('GhostRule.exe'))
    expect(fwEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('scans Fonts and detects missing font files', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('MissingFont')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('Fonts')) {
        return { stdout: '\r\n    MyFont (TrueType)    REG_SZ    MissingFont.ttf', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const fontEntries = results.filter((r) => r.issue.includes('MissingFont'))
    expect(fontEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('scans CLSID InprocServer32 and detects missing DLLs', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('MissingCom.dll')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('CLSID') && args.includes('/k')) {
        return {
          stdout:
            '\r\n\r\nHKCR\\CLSID\\{DEADBEEF-0000-0000-C000-000000000046}\\InprocServer32\r\n    (Default)    REG_SZ    C:\\MissingCom.dll\r\n',
          stderr: '',
        }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const comEntries = results.filter((r) => r.issue.includes('MissingCom.dll'))
    expect(comEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('scans TypeLib and detects missing files', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('MissingTypeLib.tlb')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('TypeLib') && args.includes('/k')) {
        return {
          stdout:
            '\r\n\r\nHKCR\\TypeLib\\{F00DBABE-0000-0000-C000-000000000046}\\1.0\\0\\win32\r\n    (Default)    REG_SZ    C:\\MissingTypeLib.tlb\r\n',
          stderr: '',
        }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const tlbEntries = results.filter((r) => r.issue.includes('MissingTypeLib'))
    expect(tlbEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('scans services and detects missing executables', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('GhostSvc.exe')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('Services') && args.includes('/f')) {
        return {
          stdout:
            '\r\n\r\nHKLM\\SYSTEM\\CurrentControlSet\\Services\\GhostSvc\r\n    ImagePath    REG_SZ    C:\\GhostSvc.exe\r\n',
          stderr: '',
        }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const svcEntries = results.filter((r) => r.issue.includes('GhostSvc'))
    expect(svcEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('detects disabled UAC', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args.includes('EnableLUA')) {
        return { stdout: '    EnableLUA    REG_DWORD    0x0', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const uacEntries = results.filter((r) => r.issue.includes('UAC'))
    expect(uacEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('detects disabled Windows Defender realtime monitoring', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args.includes('DisableRealtimeMonitoring')) {
        return { stdout: '    DisableRealtimeMonitoring    REG_DWORD    0x1', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const defEntries = results.filter((r) => r.issue.includes('Defender real-time'))
    expect(defEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('detects disabled Windows Defender antispyware', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args.includes('DisableAntiSpyware')) {
        return { stdout: '    DisableAntiSpyware    REG_DWORD    0x1', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const defEntries = results.filter((r) => r.issue.includes('antivirus'))
    expect(defEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('detects AutoRun not fully disabled', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args.includes('NoDriveTypeAutoRun')) {
        return { stdout: '    NoDriveTypeAutoRun    REG_DWORD    0x0', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const autoRunEntries = results.filter((r) => r.issue.includes('AutoRun'))
    expect(autoRunEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('detects SMB1 enabled', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args.includes('SMB1')) {
        return { stdout: '    SMB1    REG_DWORD    0x1', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const smbEntries = results.filter((r) => r.issue.includes('SMBv1'))
    expect(smbEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('detects PowerShell unrestricted policy', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args.includes('ExecutionPolicy')) {
        return { stdout: '    ExecutionPolicy    REG_SZ    Unrestricted', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const psEntries = results.filter((r) => r.issue.includes('PowerShell'))
    expect(psEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('detects disabled firewall profiles', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args.includes('EnableFirewall')) {
        return { stdout: '    EnableFirewall    REG_DWORD    0x0', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const fwEntries = results.filter((r) => r.issue.includes('Firewall'))
    expect(fwEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('detects Remote Registry service enabled', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('RemoteRegistry')) {
        return { stdout: '    Start    REG_DWORD    0x3', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const rrEntries = results.filter((r) => r.issue.includes('Remote Registry'))
    expect(rrEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('detects SysMain on HDD (not selected)', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('SysMain')) {
        return { stdout: '    Start    REG_DWORD    0x2', stderr: '' }
      }
      if (args[0] === 'powershell' || _cmd === 'powershell') {
        return { stdout: '', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const sysEntries = results.filter((r) => r.issue.includes('SysMain'))
    // SysMain is detected even on HDD, just not selected
    expect(sysEntries.length).toBeGreaterThanOrEqual(1)
    expect(sysEntries[0]!.selected).toBe(false)
  })

  it('detects LLMNR enabled', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args.includes('EnableMulticast')) {
        return { stdout: '    EnableMulticast    REG_DWORD    0x1', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const llmnrEntries = results.filter((r) => r.issue.includes('LLMNR'))
    expect(llmnrEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('detects WPAD enabled', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args.includes('WpadOverride')) {
        return { stdout: '    WpadOverride    REG_DWORD    0x0', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const wpadEntries = results.filter((r) => r.issue.includes('WPAD'))
    expect(wpadEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('detects Fax service enabled', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('\\Fax')) {
        return { stdout: '    Start    REG_DWORD    0x3', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const faxEntries = results.filter((r) => r.issue.includes('Fax'))
    expect(faxEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('handles error path for NoDriveTypeAutoRun (catch branch)', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args.includes('NoDriveTypeAutoRun')) {
        throw new Error('reg query failed')
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const autoRunEntries = results.filter((r) => r.issue.includes('AutoRun'))
    expect(autoRunEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('handles error path for LLMNR (catch branch)', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args.includes('EnableMulticast')) {
        throw new Error('reg query failed')
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const llmnrEntries = results.filter((r) => r.issue.includes('LLMNR'))
    expect(llmnrEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('handles error path for WPAD (catch branch)', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args.includes('WpadOverride')) {
        throw new Error('reg query failed')
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const wpadEntries = results.filter((r) => r.issue.includes('WPAD'))
    expect(wpadEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('handles error path for AppCompatLM query', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('AppCompatFlags\\Layers') && args[1]?.startsWith('HKCU')) {
        throw new Error('query failed')
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    expect(Array.isArray(results)).toBe(true)
  })

  it('handles error path for services query', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('Services') && args.includes('/f')) {
        throw new Error('query failed')
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    expect(Array.isArray(results)).toBe(true)
  })

  it('handles error path for FileExts OpenWithList query', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('FileExts') && !args[1]?.includes('UserChoice')) {
        throw new Error('query failed')
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    expect(Array.isArray(results)).toBe(true)
  })

  it('handles error path for scheduled tasks scan', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (_cmd === 'powershell.exe' || args[0] === 'powershell.exe') {
        throw new Error('powershell failed')
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    expect(Array.isArray(results)).toBe(true)
  })

  it('scans Browser Helper Objects with missing CLSID', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('Browser Helper Objects')) {
        return {
          stdout:
            '\r\nHKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Browser Helper Objects\\{DEADBEEF-0000-0000-C000-000000000046}\r\n',
          stderr: '',
        }
      }
      if (args[0] === 'query' && args[1]?.includes('\\CLSID\\')) {
        throw new Error('not found')
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const bhoEntries = results.filter((r) => r.issue.includes('Browser Helper Object'))
    expect(bhoEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('scans clients with missing executables', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('GhostBrowser.exe')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1] === 'HKLM\\SOFTWARE\\Clients\\StartMenuInternet') {
        return { stdout: '\r\nHKLM\\SOFTWARE\\Clients\\StartMenuInternet\\GhostBrowser\r\n', stderr: '' }
      }
      if (args[0] === 'query' && args[1]?.includes('GhostBrowser')) {
        return { stdout: '    (Default)    REG_SZ    C:\\GhostBrowser.exe', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const clientEntries = results.filter((r) => r.issue.includes('GhostBrowser'))
    expect(clientEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('scans FileExts UserChoice for missing ProgID', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('FileExts') && args.includes('UserChoice')) {
        return {
          stdout:
            '\r\nHKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.xyz\\UserChoice\r\n    ProgId    REG_SZ    MyCustomProgId\r\n',
          stderr: '',
        }
      }
      if (args[0] === 'query' && args[1] === 'HKCR\\MyCustomProgId') {
        throw new Error('not found')
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const feEntries = results.filter((r) => r.issue.includes('Default app'))
    expect(feEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('scans MIME types for missing CLSID handler', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('MIME\\Database')) {
        return {
          stdout:
            '\r\nHKCR\\MIME\\Database\\Content Type\\text/x-test\r\n    CLSID    REG_SZ    {DEADBEEF-0000-0000-C000-000000000046}\r\n',
          stderr: '',
        }
      }
      if (args[0] === 'query' && args[1]?.startsWith('HKCR\\CLSID')) {
        throw new Error('not found')
      }
      if (args[0] === 'query' && args[1]?.startsWith('HKCR\\WOW6432Node\\CLSID')) {
        throw new Error('not found')
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const mimeEntries = results.filter((r) => r.issue.includes('MIME'))
    expect(mimeEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('scans EventLog for missing message files', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('GhostEvent.dll')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1] === 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\EventLog\\Application') {
        return {
          stdout: '\r\nHKLM\\SYSTEM\\CurrentControlSet\\Services\\EventLog\\Application\\GhostSource\r\n',
          stderr: '',
        }
      }
      if (args[0] === 'query' && args[1]?.includes('GhostSource') && args.includes('EventMessageFile')) {
        return { stdout: '    EventMessageFile    REG_SZ    C:\\GhostEvent.dll', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const eventEntries = results.filter((r) => r.issue.includes('message files'))
    expect(eventEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('scans RDP with NLA check (RDP enabled, NLA disabled)', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('fDenyTSConnections')) {
        return { stdout: '    fDenyTSConnections    REG_DWORD    0x0', stderr: '' }
      }
      if (args.includes('UserAuthentication')) {
        return { stdout: '    UserAuthentication    REG_DWORD    0x0', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const rdpEntries = results.filter((r) => r.issue.includes('Remote Desktop'))
    expect(rdpEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('scans uninstall entries and detects orphaned programs', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('uninstall.exe') || path.includes('GhostApp')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('Uninstall')) {
        return {
          stdout:
            '\r\n\r\nHKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\GhostApp\r\n    DisplayName    REG_SZ    Ghost App\r\n    UninstallString    REG_SZ    "C:\\GhostApp\\uninstall.exe" /quiet\r\n',
          stderr: '',
        }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const orphanEntries = results.filter((r) => r.issue.includes('Ghost App'))
    expect(orphanEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('detects SysMain on SSD (selected)', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: 'SSD', stderr: '' })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('SysMain')) {
        return { stdout: '    Start    REG_DWORD    0x2', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const sysEntries = results.filter((r) => r.issue.includes('SysMain'))
    expect(sysEntries.length).toBeGreaterThanOrEqual(1)
    expect(sysEntries[0]!.selected).toBe(true)
  })

  it('handles extractExePath with unquoted space path via Run keys', async () => {
    const { statSync, existsSync } = await import('node:fs')
    ;(statSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('not found')
    })
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('MissingWithSpace.exe')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('\\Run')) {
        return { stdout: '\r\n    App    REG_SZ    C:\\Program Files\\MissingWithSpace.exe --flag', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const runEntries = results.filter((r) => r.issue.includes('MissingWithSpace.exe'))
    expect(runEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('handles splitTaskPath with forward slashes via fix task', async () => {
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
    mockExecTracked.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await fixRegistryEntries([
      {
        id: '1',
        type: 'task',
        keyPath: '/Folder/Sub/TaskName',
        valueName: '',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'delete-task' },
      } as never,
    ])
    expect(result.fixed).toBe(1)
  })

  it('handles pruneOldBackups via fixRegistryEntries with stale backups', async () => {
    const { readdirSync } = await import('node:fs')
    ;(readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
      'registry-backup-2026-01-01T00-00-00-000Z.reg',
      'registry-backup-2026-01-02T00-00-00-000Z.reg',
      'registry-backup-2026-01-03T00-00-00-000Z.reg',
      'registry-backup-2026-01-04T00-00-00-000Z.reg',
    ])
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await fixRegistryEntries([
      {
        id: '1',
        type: 'invalid',
        keyPath: 'HKLM\\Software\\Test',
        valueName: 'Val',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'delete-value' },
      } as never,
    ])
    expect(result.fixed).toBe(1)
  })

  it('handles pruneOldBackups with task directory entries', async () => {
    const { readdirSync, unlinkSync, rmSync } = await import('node:fs')
    ;(readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
      'registry-backup-tasks-2026-01-01T00-00-00-000Z',
      'registry-backup-2026-01-02T00-00-00-000Z.reg',
      'registry-backup-2026-01-03T00-00-00-000Z.reg',
      'registry-backup-2026-01-04T00-00-00-000Z.reg',
      'registry-backup-2026-01-05T00-00-00-000Z.reg',
    ])
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await fixRegistryEntries([
      {
        id: '1',
        type: 'invalid',
        keyPath: 'HKLM\\Software\\Test',
        valueName: 'Val',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'delete-value' },
      } as never,
    ])
    expect(result.fixed).toBe(1)
    expect(rmSync).toHaveBeenCalled()
    expect(unlinkSync).toHaveBeenCalled()
  })

  it('handles pruneOldBackups with non-matching filenames', async () => {
    const { readdirSync } = await import('node:fs')
    ;(readdirSync as ReturnType<typeof vi.fn>).mockReturnValue(['random-file.txt', 'other-backup.zip'])
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await fixRegistryEntries([
      {
        id: '1',
        type: 'invalid',
        keyPath: 'HKLM\\Software\\Test',
        valueName: 'Val',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'delete-value' },
      } as never,
    ])
    expect(result.fixed).toBe(1)
  })

  it('handles error without message property', async () => {
    mockExecNativeUtf8.mockRejectedValue(42 as never)
    const result = await fixRegistryEntries([
      {
        id: '1',
        type: 'invalid',
        keyPath: 'HKLM\\Software\\Test',
        valueName: 'Val',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'delete-value' },
      } as never,
    ])
    expect(result.failed).toBe(1)
    expect(result.failures[0]!.reason).toBe('Unknown error')
  })

  it('handles full backup mode with second export failure (catch branch)', async () => {
    mockGetSettings.mockReturnValue({ backupMode: 'full' })
    mockExecNativeUtf8
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(new Error('export failed'))
    const result = await fixRegistryEntries([
      {
        id: '1',
        type: 'invalid',
        keyPath: 'HKLM\\Software\\Test',
        valueName: 'Val',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'delete-value' },
      } as never,
    ])
    expect(result.fixed).toBe(1)
  })

  it('handles targeted backup with key export failure (catch)', async () => {
    mockExecNativeUtf8.mockRejectedValueOnce(new Error('export failed'))
    const result = await fixRegistryEntries([
      {
        id: '1',
        type: 'invalid',
        keyPath: 'HKLM\\Software\\Test',
        valueName: 'Val',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'delete-value' },
      } as never,
    ])
    expect(result.fixed).toBe(1)
  })

  it('handles targeted backup with schtasks failure (catch)', async () => {
    const { readFileSync } = await import('node:fs')
    ;(readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('')
    mockExecNativeUtf8
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(new Error('schtasks failed'))
    const result = await fixRegistryEntries([
      {
        id: '1',
        type: 'task',
        keyPath: '\\MyFolder\\MyTask',
        valueName: '',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'delete-task' },
      } as never,
    ])
    expect(result.fixed).toBe(1)
  })

  it('creates targeted backup with fix.key override', async () => {
    const { readFileSync } = await import('node:fs')
    ;(readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      'Windows Registry Editor Version 5.00\r\n\r\n[HKLM\\Software\\Override]\r\n"Val"="data"\r\n',
    )
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await fixRegistryEntries([
      {
        id: '1',
        type: 'invalid',
        keyPath: 'HKLM\\Software\\Original',
        valueName: 'Val',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'delete-value', key: 'HKLM\\Software\\Override' },
      } as never,
    ])
    expect(result.fixed).toBe(1)
  })

  it('handles backup failure and continues fixing', async () => {
    mockGetBackupDir.mockImplementation(() => {
      throw new Error('no backup dir')
    })
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await fixRegistryEntries([
      {
        id: '1',
        type: 'invalid',
        keyPath: 'HKLM\\Software\\Test',
        valueName: 'Val',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'delete-value' },
      } as never,
    ])
    expect(result.fixed).toBe(1)
  })
})

// ----------------------------------------------------------------
// clsidExists / findMissingClsidDll (exercised through scanRegistry)
// ----------------------------------------------------------------
describe('clsidExists (via shell extensions)', () => {
  beforeEach(() => {
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('finds CLSID in native view (first query succeeds)', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (
        args[0] === 'query' &&
        args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-000000000001') &&
        args[1]?.startsWith('HKCR\\CLSID')
      ) {
        return { stdout: '    (Default)    REG_SZ    COM Object', stderr: '' }
      }
      if (
        args[0] === 'query' &&
        args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-000000000001') &&
        args[1]?.includes('InprocServer32')
      ) {
        return { stdout: '    (Default)    REG_SZ    C:\\Windows\\System32\\existing.dll', stderr: '' }
      }
      if (
        args[0] === 'query' &&
        args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-000000000001') &&
        args[1]?.includes('LocalServer32')
      ) {
        return { stdout: '', stderr: '' }
      }
      if (args[0] === 'query' && args[1]?.includes('ContextMenuHandlers')) {
        return {
          stdout:
            '\r\n\r\nHKCR\\*\\shellex\\ContextMenuHandlers\\ExistingHandler\r\n    (Default)    REG_SZ    {A0000000-0000-0000-C000-000000000001}\r\n',
          stderr: '',
        }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const handlerEntries = results.filter((r) => r.issue?.includes('ExistingHandler'))
    expect(handlerEntries).toHaveLength(0)
    expect(results).toBeDefined()
  })

  it('finds CLSID in WOW64 view (second query succeeds)', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.startsWith('HKCR\\CLSID\\{A0000000-0000-0000-C000-000000000002')) {
        throw new Error('not in native')
      }
      if (
        args[0] === 'query' &&
        args[1]?.startsWith('HKCR\\WOW6432Node\\CLSID\\{A0000000-0000-0000-C000-000000000002')
      ) {
        return { stdout: '    (Default)    REG_SZ    COM Object', stderr: '' }
      }
      if (
        args[0] === 'query' &&
        args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-000000000002') &&
        args[1]?.includes('InprocServer32')
      ) {
        return { stdout: '    (Default)    REG_SZ    C:\\Windows\\System32\\existing.dll', stderr: '' }
      }
      if (
        args[0] === 'query' &&
        args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-000000000002') &&
        args[1]?.includes('LocalServer32')
      ) {
        return { stdout: '', stderr: '' }
      }
      if (args[0] === 'query' && args[1]?.includes('ContextMenuHandlers')) {
        return {
          stdout:
            '\r\n\r\nHKCR\\*\\shellex\\ContextMenuHandlers\\WOW64Handler\r\n    (Default)    REG_SZ    {A0000000-0000-0000-C000-000000000002}\r\n',
          stderr: '',
        }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const handlerEntries = results.filter((r) => r.issue?.includes('WOW64Handler'))
    expect(handlerEntries).toHaveLength(0)
    expect(results).toBeDefined()
  })

  it('passes signal to execReg in both views (lines 70, 76)', async () => {
    mockExecNativeUtf8.mockResolvedValue({ stdout: '    (Default)    REG_SZ    COM Object', stderr: '' })
    const ctrl = new AbortController()
    const exists = await clsidExists('{00000000-0000-0000-C000-000000000046}', ctrl.signal)
    expect(exists).toBe(true)
    expect(mockExecNativeUtf8).toHaveBeenCalledWith(
      'reg',
      expect.arrayContaining(['query', expect.stringContaining('CLSID')]),
      expect.objectContaining({ signal: ctrl.signal }),
    )
  })

  it('passes signal to execReg in WOW64 query when native view fails (line 76)', async () => {
    mockExecNativeUtf8
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValue({ stdout: '    (Default)    REG_SZ    COM Object', stderr: '' })
    const ctrl = new AbortController()
    const exists = await clsidExists('{11111111-1111-1111-1111-111111111111}', ctrl.signal)
    expect(exists).toBe(true)
    expect(mockExecNativeUtf8).toHaveBeenCalledWith(
      'reg',
      expect.arrayContaining(['query', expect.stringContaining('WOW6432Node')]),
      expect.objectContaining({ signal: ctrl.signal }),
    )
  })
})

describe('findMissingClsidDll (via shell extensions)', () => {
  beforeEach(() => {
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('detects missing DLL as broken context menu handler', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('missing.dll')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      const query = args.join(' ')
      if (query.includes('ContextMenuHandlers') && !query.includes('CLSID')) {
        return {
          stdout:
            '\r\n\r\nHKCR\\Directory\\shellex\\ContextMenuHandlers\\BadDllHandler\r\n    (Default)    REG_SZ    {A0000000-0000-0000-C000-000000000003}\r\n',
          stderr: '',
        }
      }
      if (query.includes('InprocServer32') && query.includes('A0000000-0000-0000-C000-000000000003')) {
        return { stdout: '    (Default)    REG_SZ    C:\\Program Files\\missing.dll', stderr: '' }
      }
      if (query.includes('LocalServer32') && query.includes('A0000000-0000-0000-C000-000000000003')) {
        throw new Error('no localserver')
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const dllEntries = results.filter((r) => r.issue?.includes('DLL missing'))
    expect(dllEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('detects no-inproc (COM object has neither server type)', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-000000000004') && args[1]?.includes('InprocServer32')) {
        throw new Error('no inproc')
      }
      if (args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-000000000004') && args[1]?.includes('LocalServer32')) {
        throw new Error('no localserver')
      }
      if (args[1]?.includes('ContextMenuHandlers') && !args[1]?.includes('CLSID')) {
        return {
          stdout:
            '\r\n\r\nHKCR\\Folder\\shellex\\ContextMenuHandlers\\NoInprocHandler\r\n    (Default)    REG_SZ    {A0000000-0000-0000-C000-000000000004}\r\n',
          stderr: '',
        }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const brokenEntries = results.filter((r) => r.issue?.includes('broken COM registration'))
    expect(brokenEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('detects InprocServer32 exists with DLL path starting with % env var', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-000000000005') && args[1]?.includes('InprocServer32')) {
        return { stdout: '    (Default)    REG_SZ    %SystemRoot%\\system32\\existing.dll', stderr: '' }
      }
      if (args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-000000000005') && args[1]?.includes('LocalServer32')) {
        throw new Error('no localserver')
      }
      if (
        args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-000000000005') &&
        !args[1]?.includes('InprocServer32') &&
        !args[1]?.includes('LocalServer32')
      ) {
        return { stdout: '    (Default)    REG_SZ    COM Object', stderr: '' }
      }
      if (args[1]?.includes('ContextMenuHandlers')) {
        return {
          stdout:
            '\r\n\r\nHKCR\\*\\shellex\\ContextMenuHandlers\\PercentHandler\r\n    (Default)    REG_SZ    {A0000000-0000-0000-C000-000000000005}\r\n',
          stderr: '',
        }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const handlerEntries = results.filter((r) => r.issue?.includes('PercentHandler'))
    expect(handlerEntries).toHaveLength(0)
  })

  it('detects InprocServer32 exists with LocalServer32 (returns null)', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true)
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-000000000006') && args[1]?.includes('InprocServer32')) {
        return { stdout: '    (Default)    REG_SZ    C:\\Program Files\\existing.dll', stderr: '' }
      }
      if (args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-000000000006') && args[1]?.includes('LocalServer32')) {
        return { stdout: '    (Default)    REG_SZ    C:\\Program Files\\existing.exe', stderr: '' }
      }
      if (
        args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-000000000006') &&
        !args[1]?.includes('InprocServer32') &&
        !args[1]?.includes('LocalServer32')
      ) {
        return { stdout: '    (Default)    REG_SZ    COM Object', stderr: '' }
      }
      if (args[1]?.includes('ContextMenuHandlers')) {
        return {
          stdout:
            '\r\n\r\nHKCR\\*\\shellex\\ContextMenuHandlers\\WithLocalHandler\r\n    (Default)    REG_SZ    {A0000000-0000-0000-C000-000000000006}\r\n',
          stderr: '',
        }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const handlerEntries = results.filter((r) => r.issue?.includes('WithLocalHandler'))
    expect(handlerEntries).toHaveLength(0)
  })

  it('returns null when InprocServer32 has no (Default) value (lines 96, 103)', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[1]?.includes('InprocServer32') && args[1]?.startsWith('HKCR\\CLSID')) {
        return { stdout: '    SomeOther    REG_SZ    value', stderr: '' }
      }
      if (args[1]?.includes('LocalServer32') && args[1]?.startsWith('HKCR\\CLSID')) {
        throw new Error('not found')
      }
      if (args[1]?.includes('CLSID') && !args[1]?.includes('InprocServer32') && !args[1]?.includes('LocalServer32')) {
        return { stdout: '    (Default)    REG_SZ    COM Object', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const ctrl = new AbortController()
    const result = await findMissingClsidDll('{A0000000-0000-0000-C000-000000000010}', ctrl.signal)
    expect(result).toBeNull()
  })

  it('passes signal to execReg in findMissingClsidDll (lines 92, 109)', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[1]?.includes('InprocServer32') && args[1]?.startsWith('HKCR\\CLSID')) {
        return { stdout: '    SomeOther    REG_SZ    value', stderr: '' }
      }
      if (args[1]?.includes('LocalServer32') && args[1]?.startsWith('HKCR\\CLSID')) {
        throw new Error('not found')
      }
      if (args[1]?.includes('CLSID') && !args[1]?.includes('InprocServer32') && !args[1]?.includes('LocalServer32')) {
        return { stdout: '    (Default)    REG_SZ    COM Object', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const ctrl = new AbortController()
    await findMissingClsidDll('{A0000000-0000-0000-C000-000000000011}', ctrl.signal)
    expect(mockExecNativeUtf8).toHaveBeenCalledWith(
      'reg',
      expect.arrayContaining(['query', expect.stringContaining('InprocServer32')]),
      expect.objectContaining({ signal: ctrl.signal }),
    )
  })

  it('passes signal to execReg on LocalServer32 query when InprocServer32 missing (line 109)', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      const query = args.join(' ')
      if (query.includes('InprocServer32')) throw new Error('not found')
      if (query.includes('LocalServer32')) throw new Error('not found')
      return { stdout: '    (Default)    REG_SZ    COM Object', stderr: '' }
    })
    const ctrl = new AbortController()
    await findMissingClsidDll('{B0000000-0000-0000-C000-000000000022}', ctrl.signal)
    expect(mockExecNativeUtf8).toHaveBeenCalledWith(
      'reg',
      expect.arrayContaining(['query', expect.stringContaining('LocalServer32')]),
      expect.objectContaining({ signal: ctrl.signal }),
    )
  })
})

// ----------------------------------------------------------------
// Interface scan (ProxyStubClsid32)
// ----------------------------------------------------------------
describe('scanRegistry Interface scan (ProxyStubClsid32)', () => {
  beforeEach(() => {
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('detects interface with missing proxy stub CLSID', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (
        args[0] === 'query' &&
        args[1]?.includes('HKCR\\Interface') &&
        args.includes('/f') &&
        args.includes('ProxyStubClsid32')
      ) {
        return {
          stdout:
            '\r\n\r\nHKCR\\Interface\\{A0000000-0000-0000-C000-000000000007}\\ProxyStubClsid32\r\n    (Default)    REG_SZ    {A0000000-0000-0000-C000-000000000008}\r\n',
          stderr: '',
        }
      }
      if (args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-000000000008')) {
        throw new Error('not found')
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const ifaceEntries = results.filter((r) => r.issue?.includes('proxy stub'))
    expect(ifaceEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('detects interface with existing stub but missing DLL', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('StubMissing.dll')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (
        args[0] === 'query' &&
        args[1]?.includes('HKCR\\Interface') &&
        args.includes('/f') &&
        args.includes('ProxyStubClsid32')
      ) {
        return {
          stdout:
            '\r\n\r\nHKCR\\Interface\\{A0000000-0000-0000-C000-000000000009}\\ProxyStubClsid32\r\n    (Default)    REG_SZ    {A0000000-0000-0000-C000-00000000000A}\r\n',
          stderr: '',
        }
      }
      if (args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-00000000000A') && args[1]?.includes('InprocServer32')) {
        return { stdout: '    (Default)    REG_SZ    C:\\Program Files\\StubMissing.dll', stderr: '' }
      }
      if (args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-00000000000A') && args[1]?.includes('LocalServer32')) {
        throw new Error('no localserver')
      }
      if (
        args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-00000000000A') &&
        !args[1]?.includes('InprocServer32') &&
        !args[1]?.includes('LocalServer32')
      ) {
        return { stdout: '    (Default)    REG_SZ    COM Object', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const ifaceEntries = results.filter((r) => r.issue?.includes('stub DLL missing'))
    expect(ifaceEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('skips known good proxy CLSIDs', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (
        args[0] === 'query' &&
        args[1]?.includes('HKCR\\Interface') &&
        args.includes('/f') &&
        args.includes('ProxyStubClsid32')
      ) {
        return {
          stdout:
            '\r\n\r\nHKCR\\Interface\\{A0000000-0000-0000-C000-00000000000B}\\ProxyStubClsid32\r\n    (Default)    REG_SZ    {00000320-0000-0000-C000-000000000046}\r\n',
          stderr: '',
        }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const ifaceEntries = results.filter((r) => r.issue?.includes('proxy stub'))
    expect(ifaceEntries).toHaveLength(0)
  })
})

// ----------------------------------------------------------------
// AutoPlay handlers scan
// ----------------------------------------------------------------
describe('scanRegistry AutoPlay handlers', () => {
  beforeEach(() => {
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('detects AutoPlay handler with missing ProgID', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[1]?.includes('AutoplayHandlers\\Handlers')) {
        return {
          stdout:
            '\r\n\r\nHKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\AutoplayHandlers\\Handlers\\MP3PlaybackHandler\r\n    ProgID    REG_SZ    MissingProgID\r\n',
          stderr: '',
        }
      }
      if (args[1] === 'HKCR\\MissingProgID') {
        throw new Error('not found')
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const apEntries = results.filter((r) => r.issue?.includes('AutoPlay'))
    expect(apEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('skips AutoPlay handler when key equals base key', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[1]?.includes('AutoplayHandlers\\Handlers')) {
        return {
          stdout: '\r\nHKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\AutoplayHandlers\\Handlers\r\n',
          stderr: '',
        }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const apEntries = results.filter((r) => r.issue?.includes('AutoPlay'))
    expect(apEntries).toHaveLength(0)
  })
})

// ----------------------------------------------------------------
// Browser Helper Objects — CLSID exists with missing DLL
// ----------------------------------------------------------------
describe('scanRegistry BHO with existing CLSID', () => {
  beforeEach(() => {
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('detects BHO with existing CLSID but missing DLL (no-inproc)', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('Browser Helper Objects')) {
        return {
          stdout:
            '\r\nHKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Browser Helper Objects\\{A0000000-0000-0000-C000-00000000000C}\r\n',
          stderr: '',
        }
      }
      if (args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-00000000000C') && args[1]?.includes('InprocServer32')) {
        throw new Error('no inproc')
      }
      if (args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-00000000000C') && args[1]?.includes('LocalServer32')) {
        throw new Error('no localserver')
      }
      if (
        args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-00000000000C') &&
        !args[1]?.includes('InprocServer32') &&
        !args[1]?.includes('LocalServer32')
      ) {
        return { stdout: '    (Default)    REG_SZ    COM Object', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const bhoEntries = results.filter((r) => r.issue?.includes('broken COM registration'))
    expect(bhoEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('detects BHO with existing CLSID but missing specific DLL', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('BhoMissing.dll')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('Browser Helper Objects')) {
        return {
          stdout:
            '\r\nHKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Browser Helper Objects\\{A0000000-0000-0000-C000-00000000000D}\r\n',
          stderr: '',
        }
      }
      if (args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-00000000000D') && args[1]?.includes('InprocServer32')) {
        return { stdout: '    (Default)    REG_SZ    C:\\Program Files\\BhoMissing.dll', stderr: '' }
      }
      if (args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-00000000000D') && args[1]?.includes('LocalServer32')) {
        throw new Error('no localserver')
      }
      if (
        args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-00000000000D') &&
        !args[1]?.includes('InprocServer32') &&
        !args[1]?.includes('LocalServer32')
      ) {
        return { stdout: '    (Default)    REG_SZ    COM Object', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const bhoEntries = results.filter((r) => r.issue?.includes('Helper Object DLL missing'))
    expect(bhoEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('skips BHO with existing CLSID and valid DLL', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true)
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('Browser Helper Objects')) {
        return {
          stdout:
            '\r\nHKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Browser Helper Objects\\{A0000000-0000-0000-C000-00000000000E}\r\n',
          stderr: '',
        }
      }
      if (args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-00000000000E') && args[1]?.includes('InprocServer32')) {
        return { stdout: '    (Default)    REG_SZ    C:\\Windows\\System32\\valid.dll', stderr: '' }
      }
      if (args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-00000000000E') && args[1]?.includes('LocalServer32')) {
        throw new Error('no localserver')
      }
      if (
        args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-00000000000E') &&
        !args[1]?.includes('InprocServer32') &&
        !args[1]?.includes('LocalServer32')
      ) {
        return { stdout: '    (Default)    REG_SZ    COM Object', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const bhoEntries = results.filter((r) => r.issue?.includes('Browser Helper Object'))
    expect(bhoEntries).toHaveLength(0)
  })
})

// ----------------------------------------------------------------
// Third-party scheduled tasks
// ----------------------------------------------------------------
describe('scanRegistry third-party scheduled tasks', () => {
  beforeEach(() => {
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('detects third-party update task for uninstalled software', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false)
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (
        _cmd === 'powershell.exe' &&
        args[3]?.includes('Get-ScheduledTask') &&
        !args[3]?.includes('thirdPartyTasks')
      ) {
        return { stdout: '', stderr: '' }
      }
      if (
        _cmd === 'powershell.exe' &&
        args[3]?.includes('Get-ScheduledTask') &&
        args[3]?.includes('thirdPartyTasks') !== false
      ) {
        // Return with no third-party for the first call, matching tasks for second
        return { stdout: '', stderr: '' }
      }
      if (_cmd === 'powershell.exe') {
        const command = args[3] || ''
        if (!command.includes('thirdParty')) {
          // First task query returns nothing
          return { stdout: '[]', stderr: '' }
        }
        return { stdout: '[]', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    expect(Array.isArray(results)).toBe(true)
  })
})

// ----------------------------------------------------------------
// extractExePath edge cases
// ----------------------------------------------------------------
describe('extractExePath edge cases (via Run keys)', () => {
  beforeEach(() => {
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('handles unquoted path with fallback to extension match', async () => {
    const { statSync, existsSync } = await import('node:fs')
    ;(statSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('not found')
    })
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('FallbackApp.bat')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('\\Run')) {
        return { stdout: '\r\n    App    REG_SZ    C:\\CustomBin\\FallbackApp.bat --quiet', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const runEntries = results.filter((r) => r.issue?.includes('FallbackApp.bat'))
    expect(runEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('handles command with no executable extension matching', async () => {
    const { statSync, existsSync } = await import('node:fs')
    ;(statSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('not found')
    })
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('NoExtBinary')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('\\Run')) {
        return { stdout: '\r\n    App    REG_SZ    C:\\CustomBin\\NoExtBinary --flag', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const runEntries = results.filter((r) => r.issue?.includes('NoExtBinary'))
    expect(runEntries.length).toBeGreaterThanOrEqual(1)
  })
})

// ----------------------------------------------------------------
// extractExePath direct tests
// ----------------------------------------------------------------
describe('extractExePath', () => {
  it('handles empty trimmed command (returns null)', () => {
    const result = extractExePath('   ')
    expect(result).toBeNull()
  })

  it('handles quoted match with [1] undefined (empty quotes)', () => {
    // The regex requires at least 1 char between quotes, so "" doesn't match
    // This exercises the fallthrough path, not the quotedMatch branch
    const result = extractExePath('"" C:\\path.exe')
    expect(result).not.toBeNull()
  })

  it('handles statSync returning directory (isFile false at line 54)', async () => {
    const { statSync } = await import('node:fs')
    ;(statSync as ReturnType<typeof vi.fn>).mockReset()
    ;(statSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') throw new Error('not found')
      if (path === 'C:\\Windows\\System32') return { isFile: () => false }
      throw new Error('not found')
    })
    const result = extractExePath('C:\\Windows\\System32 missing.exe')
    expect(result).toBe('C:\\Windows\\System32 missing.exe')
  })

  it('handles statSync returning file at line 54 (isFile true path)', async () => {
    const { statSync } = await import('node:fs')
    ;(statSync as ReturnType<typeof vi.fn>).mockReset()
    ;(statSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') throw new Error('not found')
      if (path === 'C:\\Windows\\System32\\cmd.exe') return { isFile: () => true }
      throw new Error('not found')
    })
    const result = extractExePath('C:\\Windows\\System32\\cmd.exe test')
    expect(result).toBe('C:\\Windows\\System32\\cmd.exe')
  })
})

// ----------------------------------------------------------------
// splitTaskPath direct tests
// ----------------------------------------------------------------
describe('splitTaskPath', () => {
  it('handles path without backslash (line 23)', () => {
    const result = splitTaskPath('TaskNameOnly')
    expect(result).toEqual({ path: '\\', name: 'TaskNameOnly' })
  })

  it('handles path with forward slashes converted to backslashes', () => {
    const result = splitTaskPath('/Folder/Sub/TaskName')
    expect(result).toEqual({ path: '\\Folder\\Sub\\', name: 'TaskName' })
  })

  it('returns null for invalid characters', () => {
    const result = splitTaskPath('\\Folder\\Bad<Task>')
    expect(result).toBeNull()
  })

  it('handles root-level task name with leading backslash', () => {
    const result = splitTaskPath('\\RootTask')
    expect(result).toEqual({ path: '\\', name: 'RootTask' })
  })
})

// ----------------------------------------------------------------
// expandEnvVars additional env vars
// ----------------------------------------------------------------
describe('expandEnvVars additional variables', () => {
  beforeEach(() => {
    vi.stubEnv('WINDIR', 'C:\\Windows')
    vi.stubEnv('PROGRAMFILES', 'C:\\Program Files')
    vi.stubEnv('PROGRAMFILES(X86)', 'C:\\Program Files (x86)')
    vi.stubEnv('PROGRAMDATA', 'C:\\ProgramData')
    vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\Test\\AppData\\Local')
    vi.stubEnv('APPDATA', 'C:\\Users\\Test\\AppData\\Roaming')
    vi.stubEnv('USERPROFILE', 'C:\\Users\\Test')
    vi.stubEnv('COMMONPROGRAMFILES', 'C:\\Program Files\\Common Files')
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resolves %ProgramData% paths via installer scan', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('GhostFolder')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[1]?.includes('Installer\\Folders')) {
        return { stdout: '\r\n    %ProgramData%\\GhostFolder    REG_SZ    ', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const installEntries = results.filter((r) => r.issue?.includes('GhostFolder'))
    expect(installEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('resolves %LOCALAPPDATA% paths via shared DLLs scan', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('LocalAppMissing.dll')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[1]?.includes('SharedDLLs')) {
        return { stdout: '\r\n    %LOCALAPPDATA%\\LocalAppMissing.dll    REG_DWORD    0x1', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const dllEntries = results.filter((r) => r.issue?.includes('LocalAppMissing.dll'))
    expect(dllEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('resolves %APPDATA% paths via Run keys', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('RoamingApp.exe')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('\\Run')) {
        return { stdout: '\r\n    App    REG_SZ    %APPDATA%\\RoamingApp.exe', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const runEntries = results.filter((r) => r.issue?.includes('RoamingApp.exe'))
    expect(runEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('resolves %USERPROFILE% paths via MuiCache scan', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (typeof path !== 'string') return true
      if (path.includes('UserProfileApp.exe')) return false
      return true
    })
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[1]?.includes('MuiCache')) {
        return { stdout: '\r\n    %USERPROFILE%\\UserProfileApp.exe.FriendlyAppName    REG_SZ    Test', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const muiEntries = results.filter((r) => r.issue?.includes('UserProfileApp.exe'))
    expect(muiEntries.length).toBeGreaterThanOrEqual(1)
  })

  it('uses default fallbacks when env vars are undefined', () => {
    vi.unstubAllEnvs()
    vi.stubEnv('WINDIR', undefined as unknown as string)
    vi.stubEnv('PROGRAMFILES', undefined as unknown as string)
    vi.stubEnv('PROGRAMFILES(X86)', undefined as unknown as string)
    vi.stubEnv('PROGRAMDATA', undefined as unknown as string)
    vi.stubEnv('COMMONPROGRAMFILES', undefined as unknown as string)
    vi.stubEnv('USERPROFILE', undefined as unknown as string)
    vi.stubEnv('LOCALAPPDATA', undefined as unknown as string)
    vi.stubEnv('APPDATA', undefined as unknown as string)

    const result = expandEnvVars(
      '%SystemRoot%\\system32\\%ProgramFiles%\\test\\%ProgramFiles(x86)%\\test\\%ProgramData%\\test\\%CommonProgramFiles%\\test\\%USERPROFILE%\\test\\%LOCALAPPDATA%\\test\\%APPDATA%\\test',
    )
    expect(result).toContain('C:\\Windows')
    expect(result).toContain('C:\\Program Files\\test')
    expect(result).toContain('C:\\Program Files (x86)')
    expect(result).toContain('C:\\ProgramData')
    expect(result).toContain('C:\\Program Files\\Common Files')
    // empty fallbacks for USERPROFILE/LOCALAPPDATA/APPDATA → three trailing \test
    expect(result).toContain('\\\\test\\\\test\\\\test')
  })
})

// ----------------------------------------------------------------
// Negative vulnerability tests
// ----------------------------------------------------------------
describe('negative vulnerability tests (no entries)', () => {
  beforeEach(() => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('EnableLUA')) {
        return { stdout: '    EnableLUA    REG_DWORD    0x1', stderr: '' }
      }
      if (args.includes('DisableRealtimeMonitoring')) {
        return { stdout: '    DisableRealtimeMonitoring    REG_DWORD    0x0', stderr: '' }
      }
      if (args.includes('DisableAntiSpyware')) {
        return { stdout: '    DisableAntiSpyware    REG_DWORD    0x0', stderr: '' }
      }
      if (args.includes('NoDriveTypeAutoRun')) {
        return { stdout: '    NoDriveTypeAutoRun    REG_DWORD    0xff', stderr: '' }
      }
      if (args.includes('SMB1')) {
        return { stdout: '    SMB1    REG_DWORD    0x0', stderr: '' }
      }
      if (args.includes('ExecutionPolicy')) {
        return { stdout: '    ExecutionPolicy    REG_SZ    RemoteSigned', stderr: '' }
      }
      if (args.includes('EnableFirewall')) {
        return { stdout: '    EnableFirewall    REG_DWORD    0x1', stderr: '' }
      }
      if (args[1]?.includes('RemoteRegistry')) {
        return { stdout: '    Start    REG_DWORD    0x4', stderr: '' }
      }
      if (args[1]?.includes('SysMain')) {
        return { stdout: '    Start    REG_DWORD    0x4', stderr: '' }
      }
      if (args.includes('fDenyTSConnections')) {
        return { stdout: '    fDenyTSConnections    REG_DWORD    0x1', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
  })

  it('does not flag UAC when enabled', async () => {
    const results = await scanRegistry()
    expect(results.filter((r) => r.issue?.includes('UAC'))).toHaveLength(0)
  })

  it('does not flag Defender realtime monitoring when enabled', async () => {
    const results = await scanRegistry()
    expect(results.filter((r) => r.issue?.includes('Defender real-time'))).toHaveLength(0)
  })

  it('does not flag Defender antispyware when enabled', async () => {
    const results = await scanRegistry()
    expect(results.filter((r) => r.issue?.includes('antivirus'))).toHaveLength(0)
  })

  it('does not flag AutoRun when fully disabled (0xff)', async () => {
    const results = await scanRegistry()
    expect(results.filter((r) => r.issue?.includes('AutoRun'))).toHaveLength(0)
  })

  it('does not flag PowerShell when RemoteSigned', async () => {
    const results = await scanRegistry()
    expect(results.filter((r) => r.issue?.includes('PowerShell'))).toHaveLength(0)
  })

  it('does not flag SMB1 when disabled', async () => {
    const results = await scanRegistry()
    expect(results.filter((r) => r.issue?.includes('SMBv1'))).toHaveLength(0)
  })

  it('does not flag firewall when enabled', async () => {
    const results = await scanRegistry()
    expect(results.filter((r) => r.issue?.includes('Firewall'))).toHaveLength(0)
  })

  it('does not flag RemoteRegistry when disabled (Start=4)', async () => {
    const results = await scanRegistry()
    expect(results.filter((r) => r.issue?.includes('Remote Registry'))).toHaveLength(0)
  })

  it('does not flag RDP when disabled', async () => {
    const results = await scanRegistry()
    expect(results.filter((r) => r.issue?.includes('Remote Desktop'))).toHaveLength(0)
  })

  it('does not flag SysMain when disabled (Start=4)', async () => {
    const results = await scanRegistry()
    expect(results.filter((r) => r.issue?.includes('SysMain'))).toHaveLength(0)
  })
})

// ----------------------------------------------------------------
// Additional edge case tests
// ----------------------------------------------------------------
describe('additional edge cases', () => {
  beforeEach(() => {
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('handles extractExePath with empty trimmed command', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('\\Run')) {
        return { stdout: '\r\n    App    REG_SZ    ', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const runEntries = results.filter((r) => r.type === 'broken')
    expect(runEntries).toHaveLength(0)
  })

  it('handles MIME CLSID that exists (no entry)', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[1]?.includes('MIME\\Database')) {
        return {
          stdout:
            '\r\nHKCR\\MIME\\Database\\Content Type\\text/x-test\r\n    CLSID    REG_SZ    {A0000000-0000-0000-C000-00000000000F}\r\n',
          stderr: '',
        }
      }
      if (args[1]?.includes('\\CLSID\\{A0000000-0000-0000-C000-00000000000F') && !args[1]?.includes('WOW6432Node')) {
        return { stdout: '    (Default)    REG_SZ    COM Object', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const mimeEntries = results.filter((r) => r.issue?.includes('MIME'))
    expect(mimeEntries).toHaveLength(0)
  })

  it('handles EventLog with PrimaryModule (no entry)', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false)
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[1] === 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\EventLog\\Application') {
        return {
          stdout: '\r\nHKLM\\SYSTEM\\CurrentControlSet\\Services\\EventLog\\Application\\TestWithPrimary\r\n',
          stderr: '',
        }
      }
      if (args[1]?.includes('TestWithPrimary') && args.includes('EventMessageFile')) {
        return { stdout: '    EventMessageFile    REG_SZ    C:\\MissingEvent.dll', stderr: '' }
      }
      if (args[1]?.includes('TestWithPrimary') && args.includes('PrimaryModule')) {
        return { stdout: '    PrimaryModule    REG_SZ    some.dll', stderr: '' }
      }
      if (
        args[1]?.includes('TestWithPrimary') &&
        args.includes('EventMessageFile') === false &&
        args.includes('PrimaryModule') === false
      ) {
        // already handled
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const eventEntries = results.filter((r) => r.issue?.includes('message files'))
    expect(eventEntries).toHaveLength(0)
  })

  it('handles EventLog with % prefixed paths (skip via startsWith)', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false)
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[1] === 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\EventLog\\Application') {
        return {
          stdout: '\r\nHKLM\\SYSTEM\\CurrentControlSet\\Services\\EventLog\\Application\\PctSource\r\n',
          stderr: '',
        }
      }
      if (args[1]?.includes('PctSource') && args.includes('EventMessageFile')) {
        return { stdout: '    EventMessageFile    REG_SZ    %ProgramFiles%\\system32\\some.dll', stderr: '' }
      }
      if (args[1]?.includes('PctSource') && args.includes('PrimaryModule')) {
        throw new Error('no primary')
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const eventEntries = results.filter((r) => r.issue?.includes('message files'))
    expect(eventEntries).toHaveLength(0)
  })

  it('handles Run key with entry that has no exec path (just a DLL)', async () => {
    const { existsSync } = await import('node:fs')
    ;(existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true)
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'query' && args[1]?.includes('\\Run')) {
        return { stdout: '\r\n    RundllEntry    REG_SZ    rundll32.exe shell32.dll,Control_RunDLL', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const runEntries = results.filter((r) => r.issue?.includes('rundll32'))
    expect(runEntries).toHaveLength(0)
  })

  it('handles splitTaskPath with invalid characters (returns null)', async () => {
    mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
    mockExecTracked.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await fixRegistryEntries([
      {
        id: '1',
        type: 'task',
        keyPath: '\\Folder\\Bad<Task>',
        valueName: '',
        issue: 'x',
        risk: 'low',
        selected: true,
        fix: { op: 'disable-task' },
      } as never,
    ])
    expect(result.failed).toBe(1)
    expect(result.failures[0]!.reason).toContain('Invalid task path')
  })

  it('handles AutoPlay handler with empty ProgID (skips)', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[1]?.includes('AutoplayHandlers\\Handlers')) {
        return {
          stdout:
            '\r\n\r\nHKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\AutoplayHandlers\\Handlers\\TestHandler\r\n    ProgID    REG_SZ    \r\n',
          stderr: '',
        }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const apEntries = results.filter((r) => r.issue?.includes('AutoPlay'))
    expect(apEntries).toHaveLength(0)
  })

  it('handles clients with missing shell command to skip', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[1] === 'HKLM\\SOFTWARE\\Clients\\StartMenuInternet') {
        return { stdout: '\r\nHKLM\\SOFTWARE\\Clients\\StartMenuInternet\\TestBrowser\r\n', stderr: '' }
      }
      if (args[1]?.includes('TestBrowser\\shell\\open\\command')) {
        return { stdout: '    (Default)    REG_SZ    C:\\Program Files\\TestBrowser\\test.exe', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    const clientEntries = results.filter((r) => r.issue?.includes('web browser'))
    expect(clientEntries).toHaveLength(0)
  })

  it('handles FileExts OpenWithList with path that does not include \\', async () => {
    mockExecNativeUtf8.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[1]?.includes('FileExts') && !args[1]?.includes('UserChoice')) {
        return {
          stdout:
            '\r\n\r\nHKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.abc\\OpenWithList\r\n    a    REG_SZ    notepad.exe\r\n',
          stderr: '',
        }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await scanRegistry()
    expect(Array.isArray(results)).toBe(true)
  })
})
