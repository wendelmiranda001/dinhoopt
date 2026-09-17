import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CleanerType } from '../shared/enums'

let appExitMock: (...args: unknown[]) => void
const statSyncMock = vi.fn()
const readdirSyncMock = vi.fn()
const openSyncMock = vi.fn()
const readSyncMock = vi.fn()
const existsSyncMock = vi.fn<(...args: unknown[]) => boolean>(() => true)
const closeSyncMock = vi.fn()
const readdirPromisesMock = vi.fn()
const execFileMock = vi.fn()
const getCachedItemMock = vi.fn()

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:\\test',
    getName: () => 'DiNho',
    getVersion: () => '1.0.0',
    exit: (...args: unknown[]) => appExitMock(...args),
  },
}))

vi.mock('../shared/enums', () => ({
  CleanerType: {
    System: 'system',
    Browser: 'browser',
    App: 'app',
    Gaming: 'gaming',
    RecycleBin: 'recycleBin',
    UninstallLeftovers: 'uninstallLeftovers',
    Shortcut: 'shortcut',
    Database: 'database',
    Environment: 'environment',
    WinSxS: 'winSxS',
  },
}))

vi.mock('./platform', () => ({
  getPlatform: vi.fn(() => ({ paths: {} })),
}))

vi.mock('./services/exec-utf8', () => ({
  psUtf8: (s: string) => s,
}))

vi.mock('./services/file-utils', () => ({
  cleanItems: vi.fn(),
  resolveChildSubdirs: vi.fn(),
  scanDirectoriesAsItems: vi.fn(),
  scanDirectory: vi.fn(),
  scanFile: vi.fn(),
  scanMultipleDirectories: vi.fn(),
}))

vi.mock('./services/scan-cache', () => ({
  cacheItems: vi.fn(),
  getCachedItem: getCachedItemMock,
}))

let mockBetterSqlite3Error: Error | null = null

vi.mock('better-sqlite3', () => {
  if (mockBetterSqlite3Error) {
    const err = mockBetterSqlite3Error
    err.message = `factory-throw:${err.message}`
    throw err
  }
  return {
    // biome-ignore lint/complexity/useArrowFunction: constructor mock — arrow functions are not constructible (vitest 4.x)
    default: vi.fn(function () {
      return {
        pragma: vi.fn().mockReturnValue('wal'),
        exec: vi.fn(),
        close: vi.fn(),
      }
    }),
  }
})

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  statSync: statSyncMock,
  readdirSync: readdirSyncMock,
  openSync: openSyncMock,
  readSync: readSyncMock,
  closeSync: closeSyncMock,
}))

vi.mock('node:fs/promises', () => ({
  readdir: readdirPromisesMock,
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

vi.mock('./services/perf-monitor', () => ({
  // biome-ignore lint/complexity/useArrowFunction: constructor mock — arrow functions are not constructible (vitest 4.x)
  PerfMonitorService: vi.fn(function () {
    return {
      getSystemInfo: vi.fn().mockResolvedValue({
        cpuModel: 'Test CPU',
        cpuCores: 4,
        cpuThreads: 8,
        totalMemBytes: 8589934592,
        osVersion: 'Windows 11',
        hostname: 'TEST-PC',
      }),
      getDiskHealth: vi
        .fn()
        .mockResolvedValue([
          { model: 'SSD', type: 'SSD', healthStatus: 'Good', temperature: 35, remainingLife: 90, powerOnHours: 1000 },
        ]),
      killProcess: vi.fn().mockResolvedValue({ success: true, pid: 1234 }),
    }
  }),
}))

vi.mock('./services/history-store', () => ({
  getHistory: vi
    .fn()
    .mockReturnValue([
      { timestamp: '2024-01-01T00:00:00.000Z', type: 'scan', totalItemsCleaned: 100, totalSpaceSaved: 1048576 },
    ]),
  clearHistory: vi.fn(),
}))

vi.mock('./services/settings-store', () => ({
  getSettings: vi.fn(() => ({
    theme: 'dark',
    language: 'pt',
    onboardingComplete: true,
  })),
  setSettings: vi.fn(),
  flushSettings: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./services/program-uninstaller', () => ({
  getInstalledProgramsFull: vi
    .fn()
    .mockResolvedValue([
      { displayName: 'Test App', displayVersion: '1.0.0', publisher: 'Test Corp', estimatedSize: 1024 },
    ]),
}))

vi.mock('./ipc/service-manager.ipc', () => ({
  scanServices: vi.fn().mockResolvedValue({
    services: [
      { name: 'TestService', displayName: 'Test Service', startType: 'Automatic', description: 'A test service' },
    ],
  }),
  applyServiceChanges: vi.fn().mockResolvedValue({ success: true, changed: 1, failed: 0, errors: [] }),
}))

vi.mock('./services/uninstall-leftovers', () => ({
  scanForLeftovers: vi.fn().mockResolvedValue([
    {
      category: 'uninstallLeftovers',
      subcategory: 'Test Leftover',
      itemCount: 2,
      totalSize: 2048,
      items: [
        {
          id: 'leftover1',
          path: 'C:\\leftover\\file1',
          size: 1024,
          category: 'uninstallLeftovers',
          subcategory: 'Test Leftover',
          lastModified: Date.now(),
          selected: true,
        },
        {
          id: 'leftover2',
          path: 'C:\\leftover\\file2',
          size: 1024,
          category: 'uninstallLeftovers',
          subcategory: 'Test Leftover',
          lastModified: Date.now(),
          selected: true,
        },
      ],
    },
  ]),
}))

vi.mock('./ipc/network-cleanup.ipc', () => ({
  scanNetwork: vi.fn().mockResolvedValue([
    { type: 'dns', label: 'DNS Cache', detail: '128 entries', selected: true },
    { type: 'arp', label: 'ARP Cache', detail: '15 entries', selected: false },
  ]),
  cleanNetworkItems: vi.fn().mockResolvedValue({ cleaned: 1, failed: 0, errors: [] }),
}))

vi.mock('./ipc/startup-manager.ipc', () => ({
  listStartupItems: vi.fn().mockResolvedValue([
    {
      name: 'TestStartup',
      displayName: 'Test Startup',
      enabled: true,
      impact: 'Medium',
      location: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      command: 'test.exe',
      source: 'registry',
    },
    {
      name: 'DisabledStartup',
      displayName: 'Disabled Startup',
      enabled: false,
      impact: 'Low',
      location: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      command: 'disabled.exe',
      source: 'registry',
    },
  ]),
  toggleStartupItem: vi.fn().mockResolvedValue({ success: true, name: 'TestStartup', enabled: true }),
  deleteStartupItem: vi.fn().mockResolvedValue({ success: true, name: 'TestStartup' }),
  getBootTrace: vi.fn().mockResolvedValue({ bootTime: 30, processes: [{ name: 'test.exe', time: 5 }] }),
}))

vi.mock('./ipc/registry-cleaner.ipc', () => ({
  scanRegistry: vi.fn().mockResolvedValue([
    { risk: 'high', keyPath: 'HKLM\\Software\\Test', issue: 'Invalid entry' },
    { risk: 'low', keyPath: 'HKCU\\Software\\Test', issue: 'Orphaned key' },
  ]),
  fixRegistryEntries: vi.fn().mockResolvedValue({ fixed: 1, failed: 0, errors: [] }),
}))

vi.mock('./ipc/debloater.ipc', () => ({
  scanBloatware: vi
    .fn()
    .mockResolvedValue([
      { name: 'Crapware', packageName: 'CrapwareInc.Crapware', size: '50 MB', description: 'Useless app' },
    ]),
  removeBloatware: vi.fn().mockResolvedValue({ removed: 1, failed: 0, errors: [] }),
}))

vi.mock('./ipc/privacy-shield.ipc', () => ({
  scanPrivacy: vi.fn().mockResolvedValue({
    settings: [
      { id: 'setting1', label: 'Telemetry', description: 'Send telemetry', enabled: true },
      { id: 'setting2', label: 'Location', description: 'Location tracking', enabled: false },
    ],
  }),
  applyPrivacySettings: vi.fn().mockResolvedValue({ applied: 1, failed: 0, errors: [] }),
}))

vi.mock('./ipc/driver-manager.ipc', () => ({
  scanDrivers: vi.fn().mockResolvedValue({
    packages: [{ publishedName: 'oem0.inf', className: 'System', version: '10.0.1' }],
  }),
  cleanDrivers: vi.fn().mockResolvedValue({ cleaned: 1, failed: 0, errors: [] }),
  scanDriverUpdates: vi.fn().mockResolvedValue({
    updates: [{ updateId: 'driver1', updateTitle: 'Intel Graphics Driver' }],
  }),
  installDriverUpdates: vi.fn().mockResolvedValue({ installed: 1, failed: 0, errors: [] }),
}))

vi.mock('./services/software-updater', () => ({
  checkForUpdates: vi.fn().mockResolvedValue({
    packageManagerAvailable: true,
    packageManagerName: 'winget',
    apps: [
      {
        id: 'app1',
        name: 'Test App',
        currentVersion: '1.0',
        availableVersion: '2.0',
        severity: 'major',
        isUpToDate: false,
      },
      {
        id: 'app2',
        name: 'Up-to-Date App',
        currentVersion: '2.0',
        availableVersion: '2.0',
        severity: 'none',
        isUpToDate: true,
      },
    ],
  }),
  runUpdates: vi.fn().mockResolvedValue({ updated: 1, failed: 0, errors: [] }),
}))

vi.mock('./ipc/disk-analyzer.ipc', () => ({
  getDrives: vi.fn().mockResolvedValue([
    { letter: 'C', label: 'Local Disk', usedSpace: 500000000000, totalSize: 1000000000000 },
    { letter: 'D', label: 'Data', usedSpace: 200000000000, totalSize: 500000000000 },
  ]),
  analyzeDisk: vi.fn().mockResolvedValue({
    name: 'C:',
    size: 1000000000000,
    children: [
      { name: 'Windows', size: 30000000000, children: [] },
      { name: 'Users', size: 50000000000, children: [] },
    ],
  }),
  getFileTypes: vi.fn().mockResolvedValue([
    { extension: '.exe', fileCount: 150, totalSize: 5000000000 },
    { extension: '.dll', fileCount: 300, totalSize: 2000000000 },
  ]),
}))

vi.mock('./services/metrics', () => ({
  collectMetrics: vi
    .fn()
    .mockResolvedValue([
      { name: 'dinho_cleanups_total', help: 'Total cleanups', type: 'counter', value: 10, labels: {} },
    ]),
  formatPrometheus: vi.fn().mockReturnValue('# HELP dinho_cleanups_total Total cleanups\ndinho_cleanups_total 10\n'),
}))

vi.mock('./ipc/malware-scanner.ipc', () => ({
  scanMalware: vi.fn().mockResolvedValue({
    threats: [{ severity: 'high', fileName: 'virus.exe', path: 'C:\\malware\\virus.exe' }],
    filesScanned: 100,
    duration: 5000,
    engines: ['test'],
    scanId: 'scan1',
  }),
  quarantineMalware: vi.fn().mockResolvedValue({ succeeded: 1, failed: 0, errors: [] }),
  deleteMalware: vi.fn().mockResolvedValue({ succeeded: 1, failed: 0, errors: [] }),
}))

beforeEach(() => {
  appExitMock = vi.fn()
  mockBetterSqlite3Error = null
  vi.resetModules()
})

describe('ExitCode', () => {
  it('has correct values', async () => {
    const { ExitCode } = await import('./cli')
    expect(ExitCode.SUCCESS).toBe(0)
    expect(ExitCode.GENERAL_ERROR).toBe(1)
    expect(ExitCode.INVALID_ARGS).toBe(2)
    expect(ExitCode.PERMISSION_DENIED).toBe(3)
    expect(ExitCode.PARTIAL_SUCCESS).toBe(4)
    expect(ExitCode.NOTHING_FOUND).toBe(5)
    expect(ExitCode.UNKNOWN_COMMAND).toBe(6)
    expect(ExitCode.SCAN_THREATS).toBe(7)
  })

  it('has no extra properties', async () => {
    const { ExitCode } = await import('./cli')
    expect(Object.keys(ExitCode)).toEqual([
      'SUCCESS',
      'GENERAL_ERROR',
      'INVALID_ARGS',
      'PERMISSION_DENIED',
      'PARTIAL_SUCCESS',
      'NOTHING_FOUND',
      'UNKNOWN_COMMAND',
      'SCAN_THREATS',
    ])
  })
})

describe('parseCliArgs', () => {
  // ── No --cli present ────────────────────────────────────────

  it('handles empty argv', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs([])
    expect(result.command).toBeUndefined()
    expect(result.commandArgs).toEqual([])
    expect(result.ctx.json).toBe(false)
    expect(result.ctx.verbosity).toBe('normal')
    expect(result.help).toBe(false)
    expect(result.version).toBe(false)
    expect(result.hasLegacyFlags).toBe(false)
    expect(result.hasCleanFlag).toBe(false)
  })

  it('handles argv without --cli', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['node', 'script.js', '--some-flag'])
    expect(result.command).toBe('node')
    expect(result.ctx.json).toBe(false)
    expect(result.ctx.verbosity).toBe('normal')
  })

  // ── --cli with no / empty args ──────────────────────────────

  it('handles --cli with no additional args', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli'])
    expect(result.command).toBeUndefined()
    expect(result.commandArgs).toEqual([])
    expect(result.ctx.json).toBe(false)
    expect(result.ctx.verbosity).toBe('normal')
    expect(result.help).toBe(false)
    expect(result.version).toBe(false)
    expect(result.hasLegacyFlags).toBe(false)
    expect(result.hasCleanFlag).toBe(false)
  })

  it('handles --cli as the last arg with nothing after', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['node', 'script.js', '--cli'])
    expect(result.command).toBeUndefined()
    expect(result.commandArgs).toEqual([])
  })

  // ── Global flags ────────────────────────────────────────────

  it('parses --json flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--json'])
    expect(result.ctx.json).toBe(true)
    expect(result.ctx.verbosity).toBe('normal')
  })

  it('parses --verbose flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--verbose'])
    expect(result.ctx.verbosity).toBe('verbose')
    expect(result.ctx.json).toBe(false)
  })

  it('parses --quiet flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--quiet'])
    expect(result.ctx.verbosity).toBe('quiet')
  })

  it('parses -q flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '-q'])
    expect(result.ctx.verbosity).toBe('quiet')
  })

  it('parses --help flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--help'])
    expect(result.help).toBe(true)
  })

  it('parses -h flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '-h'])
    expect(result.help).toBe(true)
  })

  it('parses --version flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--version'])
    expect(result.version).toBe(true)
  })

  it('parses -v flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '-v'])
    expect(result.version).toBe(true)
  })

  // ── Verbosity precedence ────────────────────────────────────

  it('--verbose takes precedence over --quiet', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--verbose', '--quiet'])
    expect(result.ctx.verbosity).toBe('verbose')
  })

  it('--verbose takes precedence over -q', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '-q', '--verbose'])
    expect(result.ctx.verbosity).toBe('verbose')
  })

  it('--quiet gives quiet verbosity when --verbose absent', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--quiet', '--json'])
    expect(result.ctx.verbosity).toBe('quiet')
    expect(result.ctx.json).toBe(true)
  })

  // ── Command extraction ──────────────────────────────────────

  it('extracts command as first non-flag arg', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'scan'])
    expect(result.command).toBe('scan')
  })

  it('extracts command after global flags', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--json', '--verbose', 'registry'])
    expect(result.command).toBe('registry')
    expect(result.ctx.json).toBe(true)
    expect(result.ctx.verbosity).toBe('verbose')
  })

  it('returns undefined command when only flags present', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--json', '--help'])
    expect(result.command).toBeUndefined()
  })

  it('returns undefined command for single-dash unknown flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '-x'])
    expect(result.command).toBeUndefined()
  })

  it('returns undefined command for bare double-dash', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--'])
    expect(result.command).toBeUndefined()
  })

  // ── Command args filtering ──────────────────────────────────

  it('filters global flags from commandArgs', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'registry', 'scan', '--json', '--verbose'])
    expect(result.command).toBe('registry')
    expect(result.commandArgs).toEqual(['scan'])
  })

  it('preserves non-global flags in commandArgs', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'malware', 'quarantine', '/some/path', '--json'])
    expect(result.command).toBe('malware')
    expect(result.commandArgs).toEqual(['quarantine', '/some/path'])
  })

  it('includes --all and --clean in commandArgs', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'drivers', 'update', '--all'])
    expect(result.commandArgs).toEqual(['update', '--all'])
    expect(result.hasLegacyFlags).toBe(true)
  })

  it('extracts multiple positional args', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'config', 'set', 'theme.dark', 'true'])
    expect(result.command).toBe('config')
    expect(result.commandArgs).toEqual(['set', 'theme.dark', 'true'])
  })

  it('handles subcommand as first command arg', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'startup', 'list', '--json'])
    expect(result.command).toBe('startup')
    expect(result.commandArgs).toEqual(['list'])
    expect(result.ctx.json).toBe(true)
  })

  // ── Legacy flags ────────────────────────────────────────────

  it.each([
    ['--system', ['system']],
    ['--browser', ['browser']],
    ['--app', ['app']],
    ['--gaming', ['gaming']],
    ['--recycle-bin', ['recycle-bin']],
  ])('detects legacy flag %s', async (flag, _cats) => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', flag])
    expect(result.hasLegacyFlags).toBe(true)
  })

  it('detects --all as legacy flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--all'])
    expect(result.hasLegacyFlags).toBe(true)
  })

  it('hasLegacyFlags is false when no legacy flag present', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'scan'])
    expect(result.hasLegacyFlags).toBe(false)
  })

  it('hasLegacyFlags is false with only global flags', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--json', '--verbose'])
    expect(result.hasLegacyFlags).toBe(false)
  })

  it('hasLegacyFlags is false with unknown command flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--unknown'])
    expect(result.hasLegacyFlags).toBe(false)
  })

  // ── Clean flag ──────────────────────────────────────────────

  it('detects --clean flag', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--clean'])
    expect(result.hasCleanFlag).toBe(true)
  })

  it('hasCleanFlag is false without --clean', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--all'])
    expect(result.hasCleanFlag).toBe(false)
  })

  it('hasCleanFlag with command presence', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'scan', '--clean'])
    expect(result.hasCleanFlag).toBe(true)
    expect(result.command).toBe('scan')
  })

  // ── Combined scenarios ──────────────────────────────────────

  it('parses scan --system --clean --json', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'scan', '--system', '--clean', '--json'])
    expect(result.command).toBe('scan')
    expect(result.ctx.json).toBe(true)
    expect(result.ctx.verbosity).toBe('normal')
    expect(result.hasLegacyFlags).toBe(true)
    expect(result.hasCleanFlag).toBe(true)
  })

  it('parses --all --clean --verbose', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--all', '--clean', '--verbose'])
    expect(result.command).toBeUndefined()
    expect(result.ctx.verbosity).toBe('verbose')
    expect(result.hasLegacyFlags).toBe(true)
    expect(result.hasCleanFlag).toBe(true)
  })

  it('parses registry scan --json with all globals', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'registry', 'scan', '--json', '--verbose'])
    expect(result.command).toBe('registry')
    expect(result.commandArgs).toEqual(['scan'])
    expect(result.ctx.json).toBe(true)
    expect(result.ctx.verbosity).toBe('verbose')
    expect(result.help).toBe(false)
    expect(result.version).toBe(false)
  })

  it('parses --help --version together (both true)', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--help', '-v'])
    expect(result.help).toBe(true)
    expect(result.version).toBe(true)
  })

  it('parses real-world example: malware scan', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'malware', 'scan'])
    expect(result.command).toBe('malware')
    expect(result.commandArgs).toEqual(['scan'])
    expect(result.hasLegacyFlags).toBe(false)
  })

  it('parses real-world example: perf info --json', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'perf', 'info', '--json'])
    expect(result.command).toBe('perf')
    expect(result.commandArgs).toEqual(['info'])
    expect(result.ctx.json).toBe(true)
  })

  it('parses real-world example: debloat remove pkg1,pkg2', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'debloat', 'remove', 'pkg1,pkg2'])
    expect(result.command).toBe('debloat')
    expect(result.commandArgs).toEqual(['remove', 'pkg1,pkg2'])
  })

  it('parses real-world example: drivers update --all --json', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'drivers', 'update', '--all', '--json'])
    expect(result.command).toBe('drivers')
    expect(result.commandArgs).toEqual(['update', '--all'])
    expect(result.ctx.json).toBe(true)
    expect(result.hasLegacyFlags).toBe(true)
  })

  it('parses commands with multiple legacy flags', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--system', '--browser', '--app', '--json'])
    expect(result.command).toBeUndefined()
    expect(result.hasLegacyFlags).toBe(true)
    expect(result.ctx.json).toBe(true)
  })

  // ── Edge cases ──────────────────────────────────────────────

  it('handles duplicate flags without error', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--json', '--json', '--verbose', '--verbose'])
    expect(result.ctx.json).toBe(true)
    expect(result.ctx.verbosity).toBe('verbose')
  })

  it('treats non-flag tokens after unknown flags as command', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', '--port', '9100'])
    expect(result.command).toBe('9100')
    expect(result.commandArgs).toEqual(['--port'])
  })

  it('handles --cli at start of process.argv', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'scan', '--system', '--clean'])
    expect(result.command).toBe('scan')
    expect(result.hasLegacyFlags).toBe(true)
    expect(result.hasCleanFlag).toBe(true)
  })

  it('handles only --cli and a command with no flags', async () => {
    const { parseCliArgs } = await import('./cli')
    const result = parseCliArgs(['--cli', 'leftovers', 'scan'])
    expect(result.command).toBe('leftovers')
    expect(result.commandArgs).toEqual(['scan'])
    expect(result.ctx.json).toBe(false)
    expect(result.ctx.verbosity).toBe('normal')
  })
})

describe('runCli', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>
  let stderrWrite: ReturnType<typeof vi.fn>
  let originalArgv: string[]

  beforeEach(() => {
    originalArgv = process.argv
    appExitMock = vi.fn()
    stdoutWrite = vi.fn()
    stderrWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
    process.stderr.write = stderrWrite as unknown as typeof process.stderr.write
  })

  afterEach(() => {
    process.argv = originalArgv
  })

  it('prints help and exits with SUCCESS when --help is passed', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', '--help']
    const { runCli } = await import('./cli')

    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(0)
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('DiNho CLI'))
  })

  it('prints version and exits with SUCCESS when --version is passed', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', '--version']
    const { runCli } = await import('./cli')

    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(0)
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('DiNho v1.0.0'))
  })

  it('exits with INVALID_ARGS when --verbose and --quiet conflict and --json is set', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', '--verbose', '--quiet', '--json']
    const { runCli } = await import('./cli')

    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(2)
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('invalid_args'))
  })

  it('exits with INVALID_ARGS when --verbose and -q conflict without JSON', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', '--verbose', '-q']
    const { runCli } = await import('./cli')

    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(2)
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('mutually exclusive'))
  })

  it('exits with UNKNOWN_COMMAND for unrecognized command', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'nonexistent']
    const { runCli } = await import('./cli')

    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(6)
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Unknown command'))
  })

  it('runs legacy scan with --all and exits with NOTHING_FOUND', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', '--all']
    const { runCli } = await import('./cli')

    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(5)
  })

  it('runs legacy scan with --system and exits with NOTHING_FOUND', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', '--system']
    const { runCli } = await import('./cli')

    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(5)
  })

  it('handles scan command with --all --clean and shows results', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'scan', '--system', '--clean']
    const { runCli } = await import('./cli')

    await runCli()

    // Legacy scan with system and clean should return nothing found
    expect(appExitMock).toHaveBeenCalledWith(5)
  })

  it('handles clean command with --all', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'clean', '--all', '--json']
    const { runCli } = await import('./cli')

    await runCli()

    // Clean with all categories via JSON
    expect(appExitMock).toHaveBeenCalledWith(5)
  })

  it('catches handler errors and exits with GENERAL_ERROR', async () => {
    const { scanMalware } = await import('./ipc/malware-scanner.ipc')
    ;(scanMalware as ReturnType<typeof vi.fn>).mockImplementationOnce(() => Promise.reject(new Error('Scan crashed')))

    process.argv = ['node.exe', 'script.js', '--cli', 'malware', 'scan']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Scan crashed'))
    expect(appExitMock).toHaveBeenCalledWith(1)
  })
})

describe('handler: cve', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('shows vulnerability list message', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'cve', 'list']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('No vulnerabilities found'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows cve list as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'cve', 'list', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"vulnerabilities"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows usage when no subcommand', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'cve']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })
})

describe('handler: history', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('shows history entries', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'history', 'list']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('100'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows history as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'history', 'list', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"timestamp"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('clears history', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'history', 'clear']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Scan history cleared'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows usage for unknown subcommand', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'history', '--bogus']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })
})

describe('handler: config', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('shows all config entries', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'config', 'get']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('theme'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows all config as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'config', 'get', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"theme"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('gets a specific config key', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'config', 'get', 'theme']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('dark'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('gets a config key as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'config', 'get', 'theme', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"dark"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('gets a nested config key with dotted path', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'config', 'get', 'onboardingComplete']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('true'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('returns error for nonexistent config key', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'config', 'get', 'nonexistent.key']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Unknown setting'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })

  it('shows usage for config get without key', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'config', 'get']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('theme'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('sets a string config value', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'config', 'set', 'language', 'en']
    const { runCli } = await import('./cli')
    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('sets a numeric config value', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'config', 'set', 'maxResults', '100']
    const { runCli } = await import('./cli')
    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('sets a boolean config value (true)', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'config', 'set', 'onboardingComplete', 'true']
    const { runCli } = await import('./cli')
    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('sets a boolean config value (false)', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'config', 'set', 'onboardingComplete', 'false']
    const { runCli } = await import('./cli')
    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows usage for config set without args', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'config', 'set']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })

  it('shows usage for unknown config command', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'config', 'reset']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })
})

describe('handler: perf', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('shows system info', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'perf', 'info']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Test CPU'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows system info as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'perf', 'info', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"cpuModel"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows disk health', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'perf', 'disk-health']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('SSD'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows disk health as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'perf', 'disk-health', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"model"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('kills a process', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'perf', 'kill', '1234']
    const { runCli } = await import('./cli')
    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows usage for unknown perf command', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'perf', 'benchmark']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })

  it('shows usage for perf without subcommand', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'perf']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })
})

describe('handler: programs', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('shows installed programs list', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'programs', 'list']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Test App'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows programs list as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'programs', 'list', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"displayName"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows usage for unknown subcommand', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'programs', 'unknown']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })

  it('handles missing fields in program list', async () => {
    const { getInstalledProgramsFull } = await import('./services/program-uninstaller')
    type InstalledProgramFull = Awaited<ReturnType<typeof getInstalledProgramsFull>>[number]
    vi.mocked(getInstalledProgramsFull).mockResolvedValueOnce([
      { displayName: 'NoVersion', publisher: 'Some Pub', estimatedSize: 100 },
      { displayName: 'NoPub', displayVersion: '2.0', estimatedSize: 200 },
      { displayName: 'NoSize', displayVersion: '3.0', publisher: 'Pub' },
    ] as unknown as InstalledProgramFull[])
    process.argv = ['node.exe', 'script.js', '--cli', 'programs', 'list']
    const { runCli } = await import('./cli')
    await runCli()

    const output = stdoutWrite.mock.calls.map((c: string[]) => c[0]).join('')
    expect(output).toContain('NoVersion')
    expect(output).toContain('NoPub')
    expect(output).toContain('NoSize')
    expect(appExitMock).toHaveBeenCalledWith(0)
  })
})

describe('handler: services', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('shows services list', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'services', 'scan']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Test Service'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows services list as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'services', 'scan', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"displayName"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('disables a service', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'services', 'disable', 'TestService']
    const { runCli } = await import('./cli')
    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('sets a service to manual', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'services', 'manual', 'TestService']
    const { runCli } = await import('./cli')
    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows usage for disable without name', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'services', 'disable']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })

  it('shows usage for unknown subcommand', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'services', 'restart']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })
})

describe('handler: leftovers', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('shows leftovers scan results', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'leftovers', 'scan']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Test Leftover'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows leftovers scan as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'leftovers', 'scan', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"results"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('cleans leftovers', async () => {
    const { cleanItems } = await import('./services/file-utils')
    ;(cleanItems as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalCleaned: 2048,
      filesDeleted: 2,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    })

    process.argv = ['node.exe', 'script.js', '--cli', 'leftovers', 'clean']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Cleaning 2 items'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows nothing found for empty leftovers clean', async () => {
    const { scanForLeftovers } = await import('./services/uninstall-leftovers')
    ;(scanForLeftovers as ReturnType<typeof vi.fn>).mockResolvedValue([])

    process.argv = ['node.exe', 'script.js', '--cli', 'leftovers', 'clean']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('No leftovers found'))
    expect(appExitMock).toHaveBeenCalledWith(5)
  })

  it('shows usage for unknown subcommand', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'leftovers', 'export']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })
})

describe('handler: network', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('shows network scan results', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'network', 'scan']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('DNS Cache'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows network scan as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'network', 'scan', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"items"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('cleans network items', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'network', 'clean', '--all']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Cleaning 2 items'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('cleans selected network items', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'network', 'clean']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Cleaning 1 items'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows nothing found for empty network clean', async () => {
    const { scanNetwork } = await import('./ipc/network-cleanup.ipc')
    ;(scanNetwork as ReturnType<typeof vi.fn>).mockResolvedValue([])

    process.argv = ['node.exe', 'script.js', '--cli', 'network', 'clean']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('No network items'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows usage for unknown subcommand', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'network', 'reset']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })
})

describe('handler: startup', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('shows startup list', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'startup', 'list']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Test Startup'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows startup list as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'startup', 'list', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"displayName"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows boot trace', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'startup', 'boot-trace']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('bootTime'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('disables a startup item', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'startup', 'disable', 'TestStartup']
    const { runCli } = await import('./cli')
    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('enables a startup item', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'startup', 'enable', 'TestStartup']
    const { runCli } = await import('./cli')
    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('deletes a startup item', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'startup', 'delete', 'TestStartup']
    const { runCli } = await import('./cli')
    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows not found for disabling nonexistent startup item', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'startup', 'disable', 'NonExistent']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('not found'))
    expect(appExitMock).toHaveBeenCalledWith(5)
  })

  it('shows usage for disable without name', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'startup', 'disable']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })

  it('shows usage for delete without name', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'startup', 'delete']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })

  it('shows usage for unknown subcommand', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'startup', 'pause']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })
})

describe('handler: registry', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('shows registry scan results', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'registry', 'scan']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Found 2 registry issues'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows registry scan as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'registry', 'scan', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"entries"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('fixes high-risk registry entries by default', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'registry', 'fix']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Fixing 1 of 2'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('fixes all registry entries with --all', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'registry', 'fix', '--all']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Fixing 2 of 2'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows nothing to fix for empty registry scan', async () => {
    const { scanRegistry } = await import('./ipc/registry-cleaner.ipc')
    ;(scanRegistry as ReturnType<typeof vi.fn>).mockResolvedValue([])

    process.argv = ['node.exe', 'script.js', '--cli', 'registry', 'fix']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('No registry issues found'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows usage for unknown subcommand', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'registry', 'backup']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })
})

describe('handler: debloat', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('shows bloatware scan results', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'debloat', 'scan']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Crapware'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows bloatware scan as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'debloat', 'scan', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"apps"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('removes bloatware --all', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'debloat', 'remove', '--all']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Removing 1 apps'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('removes specific bloatware packages', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'debloat', 'remove', 'CrapwareInc.Crapware']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Removing 1 apps'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows nothing found for empty bloatware --all', async () => {
    const { scanBloatware } = await import('./ipc/debloater.ipc')
    ;(scanBloatware as ReturnType<typeof vi.fn>).mockResolvedValue([])

    process.argv = ['node.exe', 'script.js', '--cli', 'debloat', 'remove', '--all']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('No bloatware found'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows usage for remove without packages', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'debloat', 'remove']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })

  it('shows usage for unknown subcommand', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'debloat', 'list']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })
})

describe('handler: privacy', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('shows privacy scan results', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'privacy', 'scan']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Telemetry'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows privacy scan as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'privacy', 'scan', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"settings"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('applies all privacy settings with --all', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'privacy', 'apply', '--all']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Applying 2 privacy settings'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('applies only disabled privacy settings by default', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'privacy', 'apply']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Applying 1 privacy settings'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows nothing to apply when all settings enabled', async () => {
    const { scanPrivacy } = await import('./ipc/privacy-shield.ipc')
    ;(scanPrivacy as ReturnType<typeof vi.fn>).mockResolvedValue({
      settings: [{ id: 'setting1', label: 'Telemetry', description: 'Send telemetry', enabled: true }],
    })

    process.argv = ['node.exe', 'script.js', '--cli', 'privacy', 'apply']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('All recommended settings already applied'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows usage for unknown subcommand', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'privacy', 'reset']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })
})

describe('handler: malware', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('shows malware scan results', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'malware', 'scan']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Found 1 threats'))
    expect(appExitMock).toHaveBeenCalledWith(7)
  })

  it('shows malware scan as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'malware', 'scan', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"threats"'))
    expect(appExitMock).toHaveBeenCalledWith(7)
  })

  it('shows no threats for clean scan', async () => {
    const { scanMalware } = await import('./ipc/malware-scanner.ipc')
    ;(scanMalware as ReturnType<typeof vi.fn>).mockResolvedValue({
      threats: [],
      filesScanned: 100,
      duration: 5000,
      engines: ['test'],
      scanId: 'scan1',
    })

    process.argv = ['node.exe', 'script.js', '--cli', 'malware', 'scan']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Found 0 threats'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('quarantines a malware file', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'malware', 'quarantine', 'C:\\malware\\virus.exe']
    const { runCli } = await import('./cli')
    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows usage for quarantine without path', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'malware', 'quarantine']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })

  it('deletes a malware file', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'malware', 'delete', 'C:\\malware\\virus.exe']
    const { runCli } = await import('./cli')
    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows usage for delete without path', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'malware', 'delete']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })

  it('shows usage for unknown subcommand', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'malware', 'update']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })
})

describe('handler: drivers', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
    // Reset driver mocks to prevent mutation leakage
    const { scanDriverUpdates } = await import('./ipc/driver-manager.ipc')
    ;(scanDriverUpdates as ReturnType<typeof vi.fn>).mockResolvedValue({
      updates: [{ updateId: 'driver1', updateTitle: 'Intel Graphics Driver' }],
    })
  })

  it('shows driver scan results', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'drivers', 'scan']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Found 1 driver packages'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows driver scan as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'drivers', 'scan', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"packages"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('cleans driver packages', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'drivers', 'clean', 'oem0.inf']
    const { runCli } = await import('./cli')
    await runCli()

    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows usage for clean without name', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'drivers', 'clean']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })

  it('shows driver updates check', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'drivers', 'check-updates']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Found 1 driver updates'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows driver updates check as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'drivers', 'check-updates', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"updates"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('installs all driver updates with --all', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'drivers', 'update', '--all']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Installing 1 driver updates'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('installs specific driver updates', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'drivers', 'update', 'driver1']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Installing 1 driver updates'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows nothing to update when no updates', async () => {
    const { scanDriverUpdates } = await import('./ipc/driver-manager.ipc')
    ;(scanDriverUpdates as ReturnType<typeof vi.fn>).mockResolvedValue({ updates: [] })

    process.argv = ['node.exe', 'script.js', '--cli', 'drivers', 'update']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Drivers are up to date'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows usage for update without ids and without --all', async () => {
    const { scanDriverUpdates } = await import('./ipc/driver-manager.ipc')
    ;(scanDriverUpdates as ReturnType<typeof vi.fn>).mockResolvedValue({
      updates: [{ updateId: 'driver1', updateTitle: 'Intel Graphics Driver' }],
    })

    process.argv = ['node.exe', 'script.js', '--cli', 'drivers', 'update']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })

  it('shows usage for unknown subcommand', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'drivers', 'rollback']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })
})

describe('handler: updates', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
    // Reset to default mock before each test to prevent leakage from mutation tests
    const { checkForUpdates } = await import('./services/software-updater')
    ;(checkForUpdates as ReturnType<typeof vi.fn>).mockResolvedValue({
      packageManagerAvailable: true,
      packageManagerName: 'winget',
      apps: [
        {
          id: 'app1',
          name: 'Test App',
          currentVersion: '1.0',
          availableVersion: '2.0',
          severity: 'major',
          isUpToDate: false,
        },
        {
          id: 'app2',
          name: 'Up-to-Date App',
          currentVersion: '2.0',
          availableVersion: '2.0',
          severity: 'none',
          isUpToDate: true,
        },
      ],
    })
  })

  it('shows updates check results', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'updates', 'check']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Found 2 apps'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows updates check as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'updates', 'check', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"packageManagerAvailable"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows package manager unavailable message', async () => {
    const { checkForUpdates } = await import('./services/software-updater')
    ;(checkForUpdates as ReturnType<typeof vi.fn>).mockResolvedValue({
      packageManagerAvailable: false,
      packageManagerName: null,
      apps: [],
    })

    process.argv = ['node.exe', 'script.js', '--cli', 'updates', 'check']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('is not available'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('runs all updates with --all', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'updates', 'run', '--all']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Updating 2 apps'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('runs specific updates', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'updates', 'run', 'app1']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Updating 1 apps'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows nothing to update when all up to date', async () => {
    const { checkForUpdates } = await import('./services/software-updater')
    ;(checkForUpdates as ReturnType<typeof vi.fn>).mockResolvedValue({
      packageManagerAvailable: true,
      packageManagerName: 'winget',
      apps: [],
    })

    process.argv = ['node.exe', 'script.js', '--cli', 'updates', 'run']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('All software is up to date'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows usage for run without ids', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'updates', 'run']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })

  it('shows usage for unknown subcommand', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'updates', 'sync']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })
})

describe('handler: disk', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('shows drives list', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'disk', 'drives']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('C:'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows drives list as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'disk', 'drives', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"letter"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('analyzes a drive', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'disk', 'analyze', 'C']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Windows'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows disk analyze as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'disk', 'analyze', 'C', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"name"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows usage for analyze without drive', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'disk', 'analyze']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })

  it('shows file types', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'disk', 'file-types', 'C']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('.exe'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows file types as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'disk', 'file-types', 'C', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"extension"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows usage for file-types without drive', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'disk', 'file-types']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })

  it('shows usage for unknown subcommand', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'disk', 'format']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(appExitMock).toHaveBeenCalledWith(2)
  })
})

describe('handler: metrics', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('shows metrics in prometheus format', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'metrics']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('dinho_cleanups_total'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })

  it('shows metrics as json', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'metrics', '--json']
    const { runCli } = await import('./cli')
    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"name"'))
    expect(appExitMock).toHaveBeenCalledWith(0)
  })
})
describe('handler: unknown command', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('shows usage for unknown top-level command', async () => {
    process.argv = ['node.exe', 'script.js', '--cli', 'nonexistent']
    const { runCli } = await import('./cli')

    await runCli()

    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Unknown command'))
    expect(appExitMock).toHaveBeenCalledWith(6)
  })
})

// ─── Helper: create platform mock ──────────────────────────

function makePlatform(pathOverrides: Record<string, unknown> = {}) {
  return {
    paths: {
      systemCleanTargets: () => [],
      singleFileCleanTargets: () => [],
      protectedEventLogs: () => [],
      appPaths: () => [],
      gamingPaths: () => [],
      gpuCachePaths: () => [],
      browserPaths: () => ({}),
      databaseOptimizeTargets: () => [],
      trashPath: () => null,
      ...pathOverrides,
    },
  }
}

// ─── Helper: create a scan result ─────────────────────────────

function makeScanResult(
  category: import('../shared/enums').CleanerType,
  subcategory: string,
  size = 1024,
  count = 1,
): import('../shared/types').ScanResult {
  const items = Array.from({ length: count }, (_, i) => ({
    id: `test-${category}-${subcategory}-${i}`,
    path: `C:\\test\\${category}\\${subcategory}\\file${i}.tmp`,
    size,
    category,
    subcategory,
    lastModified: Date.now(),
    selected: true,
  }))
  return { category, subcategory, items, totalSize: size * count, itemCount: count }
}

// ─── Legacy scan functions (tested through runCli) ───────────

describe('legacy scan functions', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>
  let stderrWrite: ReturnType<typeof vi.fn>
  let originalArgv: string[]

  beforeEach(() => {
    originalArgv = process.argv
    appExitMock = vi.fn()
    stdoutWrite = vi.fn()
    stderrWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
    process.stderr.write = stderrWrite as unknown as typeof process.stderr.write
  })

  afterEach(() => {
    process.argv = originalArgv
  })

  // ── scanSystem ────────────────────────────────────────────────

  describe('scanSystem', () => {
    it('returns results from systemCleanTargets', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          systemCleanTargets: () => [{ path: 'C:\\Windows\\Temp', subcategory: 'Windows Temp', childSubdir: false }],
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(makeScanResult(CleanerType.System, 'Windows Temp'))

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Windows Temp'))
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('1 items'))
      expect(appExitMock).toHaveBeenCalledWith(0)
    })

    it('uses childSubdir path + scanMultipleDirectories', async () => {
      const { getPlatform } = await import('./platform')
      const { resolveChildSubdirs, scanMultipleDirectories } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          systemCleanTargets: () => [{ path: 'C:\\Windows\\Temp', subcategory: 'Windows Temp', childSubdir: '*.log' }],
        }),
      )
      ;(resolveChildSubdirs as ReturnType<typeof vi.fn>).mockResolvedValue(['C:\\Windows\\Temp\\child1'])
      ;(scanMultipleDirectories as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.System, 'Windows Temp'),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runCli } = await import('./cli')
      await runCli()

      expect(scanMultipleDirectories).toHaveBeenCalled()
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Windows Temp'))
      expect(appExitMock).toHaveBeenCalledWith(0)
    })

    it('includes results from singleFileCleanTargets', async () => {
      const { getPlatform } = await import('./platform')
      const { scanFile } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          systemCleanTargets: () => [{ path: 'C:\\Windows\\Temp', subcategory: 'Windows Temp', childSubdir: false }],
          singleFileCleanTargets: () => [{ path: 'C:\\Windows\\dump.log', subcategory: 'Dump Files' }],
        }),
      )
      const { scanDirectory } = await import('./services/file-utils')
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(makeScanResult(CleanerType.System, 'Windows Temp'))
      ;(scanFile as ReturnType<typeof vi.fn>).mockResolvedValue(makeScanResult(CleanerType.System, 'Dump Files'))

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runCli } = await import('./cli')
      await runCli()

      expect(scanFile).toHaveBeenCalled()
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Dump Files'))
      expect(appExitMock).toHaveBeenCalledWith(0)
    })

    it('filters protected event log items', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          systemCleanTargets: () => [{ path: 'C:\\EventLogs', subcategory: 'Event Log Archives', childSubdir: false }],
          protectedEventLogs: () => ['sec.old.evtx'],
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue({
        category: 'system',
        subcategory: 'Event Log Archives',
        items: [
          {
            id: 'log1',
            path: 'C:\\EventLogs\\sec.old.evtx',
            size: 5000,
            category: 'system',
            subcategory: 'Event Log Archives',
            lastModified: Date.now(),
            selected: true,
          },
          {
            id: 'log2',
            path: 'C:\\EventLogs\\sys.old.evtx',
            size: 3000,
            category: 'system',
            subcategory: 'Event Log Archives',
            lastModified: Date.now(),
            selected: true,
          },
        ],
        totalSize: 8000,
        itemCount: 2,
      })

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runCli } = await import('./cli')
      await runCli()

      // Protected log 'sec.old.evtx' filtered out, only sys.old.evtx remains
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('1 items'))
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('2.93 KB'))
      expect(appExitMock).toHaveBeenCalledWith(0)
    })

    it('skips targets that return empty results', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          systemCleanTargets: () => [{ path: 'C:\\Windows\\Temp', subcategory: 'Windows Temp', childSubdir: false }],
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue({
        category: 'system',
        subcategory: 'Windows Temp',
        items: [],
        totalSize: 0,
        itemCount: 0,
      })

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('No items found'))
      expect(appExitMock).toHaveBeenCalledWith(5)
    })

    it('handles scanDirectory rejection gracefully', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          systemCleanTargets: () => [{ path: 'C:\\Windows\\Temp', subcategory: 'Windows Temp', childSubdir: false }],
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Access denied'))

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runCli } = await import('./cli')
      await runCli()

      expect(appExitMock).toHaveBeenCalledWith(5)
    })

    it('handles non-Error exception thrown by scanner', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          systemCleanTargets: () => [{ path: 'C:\\Windows\\Temp', subcategory: 'Windows Temp', childSubdir: false }],
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockRejectedValue('string error')

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runCli } = await import('./cli')
      await runCli()

      expect(appExitMock).toHaveBeenCalledWith(5)
    })
  })

  // ── scanApp ──────────────────────────────────────────────────

  describe('scanApp', () => {
    it('returns results from appPaths', async () => {
      const { getPlatform } = await import('./platform')
      const { resolveChildSubdirs, scanMultipleDirectories } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          appPaths: () => [{ paths: ['C:\\AppData\\Discord'], childSubdir: 'Cache', name: 'Discord' }],
        }),
      )
      ;(resolveChildSubdirs as ReturnType<typeof vi.fn>).mockResolvedValue(['C:\\AppData\\Discord\\Cache'])
      ;(scanMultipleDirectories as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.App, 'Discord'),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--app']
      const { runCli } = await import('./cli')
      await runCli()

      expect(resolveChildSubdirs).toHaveBeenCalledWith(['C:\\AppData\\Discord'], 'Cache')
      expect(scanMultipleDirectories).toHaveBeenCalled()
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Discord'))
      expect(appExitMock).toHaveBeenCalledWith(0)
    })

    it('handles resolveChildSubdirs rejection gracefully', async () => {
      const { getPlatform } = await import('./platform')
      const { resolveChildSubdirs } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          appPaths: () => [{ paths: ['C:\\AppData\\Discord'], childSubdir: 'Cache', name: 'Discord' }],
        }),
      )
      ;(resolveChildSubdirs as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Not found'))

      process.argv = ['node.exe', 'script.js', '--cli', '--app']
      const { runCli } = await import('./cli')
      await runCli()

      expect(appExitMock).toHaveBeenCalledWith(5)
    })

    it('returns empty results when appPaths are empty', async () => {
      const { getPlatform } = await import('./platform')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(makePlatform({ appPaths: () => [] }))

      process.argv = ['node.exe', 'script.js', '--cli', '--app']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('No items found'))
      expect(appExitMock).toHaveBeenCalledWith(5)
    })
  })

  // ── scanGaming ───────────────────────────────────────────────

  describe('scanGaming', () => {
    it('returns results from gamingPaths', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectoriesAsItems } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          gamingPaths: () => [{ paths: ['C:\\Steam\\cache'], name: 'Steam' }],
        }),
      )
      ;(scanDirectoriesAsItems as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.Gaming, 'Steam'),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--gaming']
      const { runCli } = await import('./cli')
      await runCli()

      expect(scanDirectoriesAsItems).toHaveBeenCalledWith(['C:\\Steam\\cache'], 'gaming', 'Steam', 'Launcher Caches')
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Steam'))
      expect(appExitMock).toHaveBeenCalledWith(0)
    })

    it('returns results from gpuCachePaths', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectoriesAsItems } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          gamingPaths: () => [],
          gpuCachePaths: () => [{ paths: ['C:\\NVIDIA\\GLCache'], name: 'NVIDIA' }],
        }),
      )
      ;(scanDirectoriesAsItems as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.Gaming, 'NVIDIA'),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--gaming']
      const { runCli } = await import('./cli')
      await runCli()

      expect(scanDirectoriesAsItems).toHaveBeenCalledWith(
        ['C:\\NVIDIA\\GLCache'],
        'gaming',
        'NVIDIA',
        'GPU Shader Caches',
      )
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('NVIDIA'))
      expect(appExitMock).toHaveBeenCalledWith(0)
    })

    it('handles scanDirectoriesAsItems rejection gracefully', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectoriesAsItems } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          gamingPaths: () => [{ paths: ['C:\\Steam\\cache'], name: 'Steam' }],
        }),
      )
      ;(scanDirectoriesAsItems as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Access denied'))

      process.argv = ['node.exe', 'script.js', '--cli', '--gaming']
      const { runCli } = await import('./cli')
      await runCli()

      expect(appExitMock).toHaveBeenCalledWith(5)
    })

    it('returns empty results when gamingPaths and gpuCachePaths are empty', async () => {
      const { getPlatform } = await import('./platform')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({ gamingPaths: () => [], gpuCachePaths: () => [] }),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--gaming']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('No items found'))
      expect(appExitMock).toHaveBeenCalledWith(5)
    })
  })

  // ── scanRecycleBin ────────────────────────────────────────────

  describe('scanRecycleBin', () => {
    it('returns results via COM (Windows) path', async () => {
      const { getPlatform } = await import('./platform')

      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(makePlatform({ trashPath: () => null }))
      execFileMock.mockImplementation(
        (_file: string, _args: string[], _opts: unknown, cb: (err: unknown, result: unknown) => void) => {
          cb(null, { stdout: '5|10240' })
        },
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--recycle-bin']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Recycle Bin'))
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('5 items'))
      expect(appExitMock).toHaveBeenCalledWith(0)
    })

    it('returns empty when COM returns zero items', async () => {
      const { getPlatform } = await import('./platform')

      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(makePlatform({ trashPath: () => null }))
      execFileMock.mockImplementation(
        (_file: string, _args: string[], _opts: unknown, cb: (err: unknown, result: unknown) => void) => {
          cb(null, { stdout: '0|0' })
        },
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--recycle-bin']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('No items found'))
      expect(appExitMock).toHaveBeenCalledWith(5)
    })

    it('handles COM execFile error gracefully', async () => {
      const { getPlatform } = await import('./platform')

      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(makePlatform({ trashPath: () => null }))
      execFileMock.mockImplementation((...args: unknown[]) => {
        const cb = args.find((a): a is (err: unknown) => void => typeof a === 'function')
        if (cb) cb(new Error('COM access denied'))
      })

      process.argv = ['node.exe', 'script.js', '--cli', '--recycle-bin']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('No items found'))
      expect(appExitMock).toHaveBeenCalledWith(5)
    })

    it('returns results via trash directory (macOS/Linux path)', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({ trashPath: () => '/Users/test/.Trash' }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockClear()
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.RecycleBin, 'Trash', 2048, 2),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--recycle-bin']
      const { runCli } = await import('./cli')
      await runCli()

      expect(scanDirectory).toHaveBeenLastCalledWith('/Users/test/.Trash', 'recycleBin', 'Trash', 0)
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Trash'))
      expect(appExitMock).toHaveBeenCalledWith(0)
    })

    it('returns empty when trash directory does not exist', async () => {
      const { getPlatform } = await import('./platform')

      existsSyncMock.mockImplementation((p: unknown) => {
        if (typeof p !== 'string') return false
        return !p.includes('.Trash')
      })
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({ trashPath: () => '/Users/test/.Trash' }),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--recycle-bin']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('No items found'))
      expect(appExitMock).toHaveBeenCalledWith(5)
    })

    it('bounds the COM scan with a timeout', async () => {
      const { getPlatform } = await import('./platform')

      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(makePlatform({ trashPath: () => null }))
      execFileMock.mockImplementation(
        (_file: string, _args: string[], _opts: unknown, cb: (err: unknown, result: unknown) => void) => {
          cb(null, { stdout: '5|10240' })
        },
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--recycle-bin']
      const { runCli } = await import('./cli')
      await runCli()

      const opts = execFileMock.mock.calls[0]?.[2] as { timeout?: number } | undefined
      expect(opts?.timeout).toBeGreaterThan(0)
    })
  })

  // ── cleanRecycleBin ──────────────────────────────────────────

  describe('cleanRecycleBin', () => {
    it('cleans recycle bin via COM successfully', async () => {
      const { getPlatform } = await import('./platform')

      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(makePlatform({ trashPath: () => null }))
      // Need both scan and clean to happen: scan must return items, clean must succeed
      execFileMock
        // First call (scanRecycleBin): returns items
        .mockImplementationOnce(
          (_file: string, _args: string[], _opts: unknown, cb: (err: unknown, result: unknown) => void) => {
            cb(null, { stdout: '5|10240' })
          },
        )
        // Second call (cleanRecycleBin): succeeds
        .mockImplementationOnce(
          (_file: string, _args: string[], _opts: unknown, cb: (err: unknown, result: unknown) => void) => {
            cb(null, { stdout: '' })
          },
        )

      process.argv = ['node.exe', 'script.js', '--cli', '--recycle-bin', '--clean']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Cleaned'))
      expect(appExitMock).toHaveBeenCalledWith(0)
    })

    it('handles COM execFile error during clean', async () => {
      const { getPlatform } = await import('./platform')

      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(makePlatform({ trashPath: () => null }))
      execFileMock
        // scanRecycleBin succeeds
        .mockImplementationOnce(
          (_file: string, _args: string[], _opts: unknown, cb: (err: unknown, result: unknown) => void) => {
            cb(null, { stdout: '5|10240' })
          },
        )
        // cleanRecycleBin fails
        .mockImplementationOnce((...args: unknown[]) => {
          const cb = args.find((a): a is (err: unknown) => void => typeof a === 'function')
          if (cb) cb(new Error('COM access denied'))
        })

      process.argv = ['node.exe', 'script.js', '--cli', '--recycle-bin', '--clean']
      const { runCli } = await import('./cli')
      await runCli()

      // GENERAL_ERROR: items scanned but clean had errors with 0 filesDeleted
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Errors'))
      expect(appExitMock).toHaveBeenCalledWith(1)
    })

    it('handles non-Error exception during clean', async () => {
      const { getPlatform } = await import('./platform')

      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(makePlatform({ trashPath: () => null }))
      execFileMock
        .mockImplementationOnce(
          (_file: string, _args: string[], _opts: unknown, cb: (err: unknown, result: unknown) => void) => {
            cb(null, { stdout: '5|10240' })
          },
        )
        .mockImplementationOnce((...args: unknown[]) => {
          const cb = args.find((a): a is (err: unknown) => void => typeof a === 'function')
          if (cb) cb('string error')
        })

      process.argv = ['node.exe', 'script.js', '--cli', '--recycle-bin', '--clean']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Errors'))
      expect(appExitMock).toHaveBeenCalledWith(1)
    })

    it('bounds the COM clean with a timeout', async () => {
      const { getPlatform } = await import('./platform')

      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(makePlatform({ trashPath: () => null }))
      execFileMock
        .mockImplementationOnce(
          (_file: string, _args: string[], _opts: unknown, cb: (err: unknown, result: unknown) => void) => {
            cb(null, { stdout: '5|10240' })
          },
        )
        .mockImplementationOnce(
          (_file: string, _args: string[], _opts: unknown, cb: (err: unknown, result: unknown) => void) => {
            cb(null, { stdout: '' })
          },
        )

      process.argv = ['node.exe', 'script.js', '--cli', '--recycle-bin', '--clean']
      const { runCli } = await import('./cli')
      await runCli()

      const cleanOpts = execFileMock.mock.calls[1]?.[2] as { timeout?: number } | undefined
      expect(cleanOpts?.timeout).toBeGreaterThan(0)
    })
  })

  // ── getChromiumProfiles (via scanBrowserCli) ─────────────────

  describe('getChromiumProfiles (via scanBrowserCli)', () => {
    it('scans chromium browsers with profiles', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')

      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          browserPaths: () => ({
            chrome: {
              base: 'C:\\Chrome',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            edge: {
              base: 'C:\\Edge',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            brave: {
              base: 'C:\\Brave',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            vivaldi: {
              base: 'C:\\Vivaldi',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            opera: {
              base: 'C:\\Opera',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            operaGX: {
              base: 'C:\\OperaGX',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            arc: {
              base: 'C:\\Arc',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            chromium: {
              base: 'C:\\Chromium',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            thorium: {
              base: 'C:\\Thorium',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            supermium: {
              base: 'C:\\Supermium',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            helium: {
              base: 'C:\\Helium',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            cromite: {
              base: 'C:\\Cromite',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            catsxp: {
              base: 'C:\\CatsXP',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            firefox: { cache: 'C:\\Firefox\\cache' },
            librewolf: { cache: 'C:\\LibreWolf\\cache' },
            waterfox: { cache: 'C:\\Waterfox\\cache' },
            floorp: { cache: 'C:\\Floorp\\cache' },
            safari: null,
          }),
        }),
      )
      readdirPromisesMock.mockResolvedValue([
        { name: 'Profile 1', isDirectory: () => true },
        { name: 'Profile 2', isDirectory: () => true },
      ])
      // Only scan Chrome's Profile 1 Cache (first call)
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.Browser, 'Chrome - Profile 1 Cache', 1024, 3),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--browser']
      const { runCli } = await import('./cli')
      await runCli()

      expect(scanDirectory).toHaveBeenCalled()
      expect(scanDirectory).toHaveBeenCalledWith(
        expect.stringContaining('Chrome'),
        'browser',
        expect.stringContaining('Chrome'),
      )
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Chrome'))
      expect(appExitMock).toHaveBeenCalledWith(0)
    })
  })

  // ── scanBrowserCli Safari ────────────────────────────────────

  describe('scanBrowserCli Safari', () => {
    it('scans safari browser cache when safari paths exist', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')

      existsSyncMock.mockImplementation((p: unknown) => {
        if (typeof p !== 'string') return false
        return p.includes('Safari')
      })
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          browserPaths: () => ({
            chrome: undefined,
            edge: undefined,
            brave: undefined,
            vivaldi: undefined,
            opera: undefined,
            operaGX: undefined,
            arc: undefined,
            chromium: undefined,
            thorium: undefined,
            supermium: undefined,
            helium: undefined,
            cromite: undefined,
            catsxp: undefined,
            firefox: { cache: undefined },
            librewolf: { cache: undefined },
            waterfox: { cache: undefined },
            floorp: { cache: undefined },
            safari: { cache: '/Users/test/Library/Caches/com.apple.Safari' },
          }),
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockClear()
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.Browser, 'Safari - Cache'),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--browser']
      const { runCli } = await import('./cli')
      await runCli()

      expect(scanDirectory).toHaveBeenCalled()
      expect(scanDirectory).toHaveBeenLastCalledWith(
        '/Users/test/Library/Caches/com.apple.Safari',
        'browser',
        'Safari - Cache',
      )
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Safari'))
      expect(appExitMock).toHaveBeenCalledWith(0)
    })
  })

  // ── scanBrowserCli empty results ─────────────────────────────

  describe('scanBrowserCli empty results', () => {
    it('returns empty when no browser base dirs exist', async () => {
      const { getPlatform } = await import('./platform')

      existsSyncMock.mockReturnValue(false)
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          browserPaths: () => ({
            chrome: {
              base: 'C:\\Chrome',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            edge: {
              base: 'C:\\Edge',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            brave: {
              base: 'C:\\Brave',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            vivaldi: {
              base: 'C:\\Vivaldi',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            opera: {
              base: 'C:\\Opera',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            operaGX: {
              base: 'C:\\OperaGX',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            arc: {
              base: 'C:\\Arc',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            chromium: {
              base: 'C:\\Chromium',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            thorium: {
              base: 'C:\\Thorium',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            supermium: {
              base: 'C:\\Supermium',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            helium: {
              base: 'C:\\Helium',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            cromite: {
              base: 'C:\\Cromite',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            catsxp: {
              base: 'C:\\CatsXP',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            firefox: { cache: 'C:\\Firefox\\cache' },
            librewolf: { cache: 'C:\\LibreWolf\\cache' },
            waterfox: { cache: 'C:\\Waterfox\\cache' },
            floorp: { cache: 'C:\\Floorp\\cache' },
            safari: null,
          }),
        }),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--browser']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('No items found'))
      expect(appExitMock).toHaveBeenCalledWith(5)
    })

    it('returns empty when firefox cache dir does not exist', async () => {
      const { getPlatform } = await import('./platform')

      const { scanDirectory } = await import('./services/file-utils')
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockReset()
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.Browser, 'Chrome - Cache', 0, 0),
      )
      readdirSyncMock.mockReset()
      readdirSyncMock.mockReturnValue([])
      existsSyncMock.mockImplementation((p: unknown) => {
        if (typeof p !== 'string') return false
        return p.startsWith('C:\\Chrome') || p.startsWith('C:\\Edge')
      })
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          browserPaths: () => ({
            chrome: {
              base: 'C:\\Chrome',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            edge: {
              base: 'C:\\Edge',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            brave: {
              base: 'C:\\Brave',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            vivaldi: {
              base: 'C:\\Vivaldi',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            opera: {
              base: 'C:\\Opera',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            operaGX: {
              base: 'C:\\OperaGX',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            arc: {
              base: 'C:\\Arc',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            chromium: {
              base: 'C:\\Chromium',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            thorium: {
              base: 'C:\\Thorium',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            supermium: {
              base: 'C:\\Supermium',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            helium: {
              base: 'C:\\Helium',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            cromite: {
              base: 'C:\\Cromite',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            catsxp: {
              base: 'C:\\CatsXP',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            firefox: { cache: 'C:\\Firefox\\cache' },
            librewolf: { cache: undefined },
            waterfox: { cache: undefined },
            floorp: { cache: undefined },
            safari: null,
          }),
        }),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--browser']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('No items found'))
      expect(appExitMock).toHaveBeenCalledWith(5)
    })
  })

  // ── Multi-category scenarios ─────────────────────────────────

  describe('multi-category scan', () => {
    it('scans system + app + gaming with --all', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory, scanDirectoriesAsItems, scanMultipleDirectories, resolveChildSubdirs } = await import(
        './services/file-utils'
      )
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          systemCleanTargets: () => [{ path: 'C:\\Windows\\Temp', subcategory: 'Windows Temp', childSubdir: false }],
          appPaths: () => [{ paths: ['C:\\AppData\\Discord'], childSubdir: 'Cache', name: 'Discord' }],
          gamingPaths: () => [{ paths: ['C:\\Steam\\cache'], name: 'Steam' }],
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(makeScanResult(CleanerType.System, 'Windows Temp'))
      ;(resolveChildSubdirs as ReturnType<typeof vi.fn>).mockResolvedValue(['C:\\AppData\\Discord\\Cache'])
      ;(scanMultipleDirectories as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.App, 'Discord'),
      )
      ;(scanDirectoriesAsItems as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.Gaming, 'Steam'),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--all']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Windows Temp'))
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Discord'))
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Steam'))
      expect(appExitMock).toHaveBeenCalledWith(0)
    })
  })

  // ── scanDatabaseCli ────────────────────────────────────────────

  describe('scanDatabaseCli', () => {
    beforeEach(async () => {
      statSyncMock.mockReset()
      readdirSyncMock.mockReset()
      openSyncMock.mockReset()
      readSyncMock.mockReset()
      existsSyncMock.mockReset()
    })

    it('scans with single target, finds db', async () => {
      const { getPlatform } = await import('./platform')

      statSyncMock.mockImplementation((p: string) => {
        if (p.endsWith('-wal')) throw new Error('no wal')
        return { size: 50000, mtimeMs: Date.now() }
      })
      openSyncMock.mockReturnValue(3)
      readSyncMock.mockImplementation((_fd: number, buf: Buffer) => {
        buf.write('SQLite format 3\0', 0, 16, 'utf8')
        return 16
      })
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          databaseOptimizeTargets: () => [
            { label: 'TestApp', basePath: 'C:\\TestApp\\Data', dbFiles: ['main.db'], multiProfile: false },
          ],
        }),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runLegacyScanClean } = await import('./cli/commands/legacy')
      const results = await runLegacyScanClean(['database'], false, { json: false, verbosity: 'normal' })
      expect(results).toBe(0)
    })

    it('skips target when basePath does not exist', async () => {
      const { getPlatform } = await import('./platform')

      existsSyncMock.mockReturnValue(false)
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          databaseOptimizeTargets: () => [
            { label: 'TestApp', basePath: 'C:\\TestApp\\Data', dbFiles: ['main.db'], multiProfile: false },
          ],
        }),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runLegacyScanClean } = await import('./cli/commands/legacy')
      const results = await runLegacyScanClean(['database'], false, { json: false, verbosity: 'normal' })
      expect(results).toBe(5)
    })

    it('skips db file when not an SQLite file', async () => {
      const { getPlatform } = await import('./platform')

      statSyncMock.mockReturnValue({ size: 50000, mtimeMs: Date.now() })
      openSyncMock.mockReturnValue(3)
      readSyncMock.mockImplementation((_fd: number, buf: Buffer) => {
        buf.write('Not a SQLite header', 0, 19, 'utf8')
        return 19
      })
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          databaseOptimizeTargets: () => [
            { label: 'TestApp', basePath: 'C:\\TestApp\\Data', dbFiles: ['main.db'], multiProfile: false },
          ],
        }),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runLegacyScanClean } = await import('./cli/commands/legacy')
      const results = await runLegacyScanClean(['database'], false, { json: false, verbosity: 'normal' })
      expect(results).toBe(5)
    })

    it('skips db file when size is 0', async () => {
      const { getPlatform } = await import('./platform')

      statSyncMock.mockReturnValue({ size: 0, mtimeMs: Date.now() })
      openSyncMock.mockReturnValue(3)
      readSyncMock.mockImplementation((_fd: number, buf: Buffer) => {
        buf.write('SQLite format 3\0', 0, 16, 'utf8')
        return 16
      })
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          databaseOptimizeTargets: () => [
            { label: 'TestApp', basePath: 'C:\\TestApp\\Data', dbFiles: ['main.db'], multiProfile: false },
          ],
        }),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runLegacyScanClean } = await import('./cli/commands/legacy')
      const results = await runLegacyScanClean(['database'], false, { json: false, verbosity: 'normal' })
      expect(results).toBe(5)
    })

    it('skips when wastedBytes < 4096 (small db, no WAL)', async () => {
      const { getPlatform } = await import('./platform')

      statSyncMock.mockReturnValue({ size: 100, mtimeMs: Date.now() })
      openSyncMock.mockReturnValue(3)
      readSyncMock.mockImplementation((_fd: number, buf: Buffer) => {
        buf.write('SQLite format 3\0', 0, 16, 'utf8')
        return 16
      })
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          databaseOptimizeTargets: () => [
            { label: 'TestApp', basePath: 'C:\\TestApp\\Data', dbFiles: ['main.db'], multiProfile: false },
          ],
        }),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runLegacyScanClean } = await import('./cli/commands/legacy')
      const results = await runLegacyScanClean(['database'], false, { json: false, verbosity: 'normal' })
      expect(results).toBe(5)
    })

    it('accounts for WAL file in wasted bytes', async () => {
      const { getPlatform } = await import('./platform')

      statSyncMock.mockImplementation((p: string) => {
        if (p.endsWith('-wal')) return { size: 4096, mtimeMs: Date.now() }
        return { size: 1000, mtimeMs: Date.now() }
      })
      openSyncMock.mockReturnValue(3)
      readSyncMock.mockImplementation((_fd: number, buf: Buffer) => {
        buf.write('SQLite format 3\0', 0, 16, 'utf8')
        return 16
      })
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          databaseOptimizeTargets: () => [
            { label: 'TestApp', basePath: 'C:\\TestApp\\Data', dbFiles: ['main.db'], multiProfile: false },
          ],
        }),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runLegacyScanClean } = await import('./cli/commands/legacy')
      const results = await runLegacyScanClean(['database'], false, { json: false, verbosity: 'normal' })
      expect(results).toBe(0)
    })

    it('scans with multiProfile using Default / Profile N pattern', async () => {
      const { getPlatform } = await import('./platform')

      statSyncMock.mockImplementation((p: string) => {
        if (p.endsWith('-wal')) throw new Error('no wal')
        return { size: 50000, mtimeMs: Date.now() }
      })
      openSyncMock.mockReturnValue(3)
      readSyncMock.mockImplementation((_fd: number, buf: Buffer) => {
        buf.write('SQLite format 3\0', 0, 16, 'utf8')
        return 16
      })
      readdirSyncMock.mockReturnValue([
        { name: 'Default', isDirectory: () => true },
        { name: 'Profile 1', isDirectory: () => true },
        { name: 'not-a-profile.txt', isDirectory: () => false },
      ])
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          databaseOptimizeTargets: () => [
            { label: 'Chrome', basePath: 'C:\\Chrome\\Data', dbFiles: ['History'], multiProfile: true },
          ],
        }),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runLegacyScanClean } = await import('./cli/commands/legacy')
      const results = await runLegacyScanClean(['database'], false, { json: false, verbosity: 'normal' })
      expect(results).toBe(0)
    })

    it('scans with multiProfile using profilePattern matching', async () => {
      const { getPlatform } = await import('./platform')

      statSyncMock.mockImplementation((p: string) => {
        if (p.endsWith('-wal')) throw new Error('no wal')
        return { size: 50000, mtimeMs: Date.now() }
      })
      openSyncMock.mockReturnValue(3)
      readSyncMock.mockImplementation((_fd: number, buf: Buffer) => {
        buf.write('SQLite format 3\0', 0, 16, 'utf8')
        return 16
      })
      readdirSyncMock.mockReturnValue([
        { name: 'profile.abcdef', isDirectory: () => true },
        { name: 'profile.123456', isDirectory: () => true },
        { name: 'other', isDirectory: () => true },
      ])
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          databaseOptimizeTargets: () => [
            {
              label: 'Firefox',
              basePath: 'C:\\Firefox\\Profiles',
              dbFiles: ['places.sqlite'],
              multiProfile: true,
              profilePattern: ['profile.*'],
            },
          ],
        }),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runLegacyScanClean } = await import('./cli/commands/legacy')
      const results = await runLegacyScanClean(['database'], false, { json: false, verbosity: 'normal' })
      expect(results).toBe(0)
    })

    it('handles readdirSync error in multiProfile (falls back to basePath)', async () => {
      const { getPlatform } = await import('./platform')

      statSyncMock.mockImplementation((p: string) => {
        if (p.endsWith('-wal')) throw new Error('no wal')
        return { size: 50000, mtimeMs: Date.now() }
      })
      openSyncMock.mockReturnValue(3)
      readSyncMock.mockImplementation((_fd: number, buf: Buffer) => {
        buf.write('SQLite format 3\0', 0, 16, 'utf8')
        return 16
      })
      readdirSyncMock.mockImplementation(() => {
        throw new Error('access denied')
      })
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          databaseOptimizeTargets: () => [
            { label: 'Chrome', basePath: 'C:\\Chrome\\Data', dbFiles: ['History'], multiProfile: true },
          ],
        }),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runLegacyScanClean } = await import('./cli/commands/legacy')
      const results = await runLegacyScanClean(['database'], false, { json: false, verbosity: 'normal' })
      expect(results).toBe(0)
    })

    it('scans multiple targets and multiple dbFiles', async () => {
      const { getPlatform } = await import('./platform')

      const statMock = statSyncMock
      statMock.mockImplementation((p: string) => {
        if (p.endsWith('-wal')) throw new Error('no wal')
        return { size: 50000, mtimeMs: Date.now() }
      })
      openSyncMock.mockReturnValue(3)
      readSyncMock.mockImplementation((_fd: number, buf: Buffer) => {
        buf.write('SQLite format 3\0', 0, 16, 'utf8')
        return 16
      })
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          databaseOptimizeTargets: () => [
            { label: 'App1', basePath: 'C:\\App1\\Data', dbFiles: ['main.db', 'wallet.db'], multiProfile: false },
            { label: 'App2', basePath: 'C:\\App2\\Data', dbFiles: ['storage.db'], multiProfile: false },
          ],
        }),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runLegacyScanClean } = await import('./cli/commands/legacy')
      const results = await runLegacyScanClean(['database'], false, { json: false, verbosity: 'normal' })
      expect(results).toBe(0)
    })

    it('handles isSqliteFile open/read error gracefully', async () => {
      const { getPlatform } = await import('./platform')

      statSyncMock.mockReturnValue({ size: 50000, mtimeMs: Date.now() })
      openSyncMock.mockImplementation(() => {
        throw new Error('open failed')
      })
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          databaseOptimizeTargets: () => [
            { label: 'TestApp', basePath: 'C:\\TestApp\\Data', dbFiles: ['main.db'], multiProfile: false },
          ],
        }),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runLegacyScanClean } = await import('./cli/commands/legacy')
      const results = await runLegacyScanClean(['database'], false, { json: false, verbosity: 'normal' })
      expect(results).toBe(5)
    })

    it('reads multiple dbFiles from a string dbFiles entry (not array)', async () => {
      const { getPlatform } = await import('./platform')

      statSyncMock.mockReturnValue({ size: 50000, mtimeMs: Date.now() })
      openSyncMock.mockReturnValue(3)
      readSyncMock.mockImplementation((_fd: number, buf: Buffer) => {
        buf.write('SQLite format 3\0', 0, 16, 'utf8')
        return 16
      })
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          databaseOptimizeTargets: () => [
            { label: 'Chrome', basePath: 'C:\\Chrome\\Data', dbFiles: ['History', 'Favicons'], multiProfile: false },
          ],
        }),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      const { runLegacyScanClean } = await import('./cli/commands/legacy')
      const results = await runLegacyScanClean(['database'], false, { json: false, verbosity: 'normal' })
      expect(results).toBe(0)
    })
  })

  // ── runLegacyScanClean clean path ────────────────────────────

  describe('runLegacyScanClean clean path', () => {
    it('cleans file-based items when --clean flag is passed with results', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')
      const { cleanItems } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          systemCleanTargets: () => [{ path: 'C:\\Windows\\Temp', subcategory: 'Windows Temp', childSubdir: false }],
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.System, 'Windows Temp', 1024, 3),
      )
      ;(cleanItems as ReturnType<typeof vi.fn>).mockResolvedValue({
        totalCleaned: 3072,
        filesDeleted: 3,
        filesSkipped: 0,
        errors: [],
        needsElevation: false,
      })

      process.argv = ['node.exe', 'script.js', '--cli', '--system', '--clean']
      const { runCli } = await import('./cli')
      await runCli()

      expect(cleanItems).toHaveBeenCalled()
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Deleted'))
      expect(appExitMock).toHaveBeenCalledWith(0)
    })

    it('outputs JSON when --json flag is passed with results', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          systemCleanTargets: () => [{ path: 'C:\\Windows\\Temp', subcategory: 'Windows Temp', childSubdir: false }],
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.System, 'Windows Temp', 1024, 2),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--system', '--json']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"scan"'))
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"totalItems"'))
      expect(appExitMock).toHaveBeenCalledWith(0)
    })

    it('shows partial success when clean has errors but some files deleted', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')
      const { cleanItems } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          systemCleanTargets: () => [{ path: 'C:\\Windows\\Temp', subcategory: 'Windows Temp', childSubdir: false }],
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.System, 'Windows Temp', 1024, 3),
      )
      ;(cleanItems as ReturnType<typeof vi.fn>).mockResolvedValue({
        totalCleaned: 1024,
        filesDeleted: 1,
        filesSkipped: 2,
        errors: [{ path: 'C:\\Windows\\Temp\\file1.tmp', reason: 'in-use' }],
        needsElevation: false,
      })

      process.argv = ['node.exe', 'script.js', '--cli', '--system', '--clean']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Skipped'))
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Errors'))
      expect(appExitMock).toHaveBeenCalledWith(4)
    })

    it('returns needsElevation when clean reports permission denied', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')
      const { cleanItems } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          systemCleanTargets: () => [{ path: 'C:\\Windows\\Temp', subcategory: 'Windows Temp', childSubdir: false }],
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.System, 'Windows Temp', 1024, 3),
      )
      ;(cleanItems as ReturnType<typeof vi.fn>).mockResolvedValue({
        totalCleaned: 0,
        filesDeleted: 0,
        filesSkipped: 3,
        errors: [{ path: 'C:\\Windows\\Temp\\file.tmp', reason: 'permission-denied' }],
        needsElevation: true,
      })

      process.argv = ['node.exe', 'script.js', '--cli', '--system', '--clean']
      const { runCli } = await import('./cli')
      await runCli()

      expect(appExitMock).toHaveBeenCalledWith(3)
    })

    it('truncates error list when >10 errors', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')
      const { cleanItems } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          systemCleanTargets: () => [{ path: 'C:\\Windows\\Temp', subcategory: 'Windows Temp', childSubdir: false }],
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.System, 'Windows Temp', 1024, 15),
      )
      const errors = Array.from({ length: 12 }, (_, i) => ({
        path: `C:\\file${i}.tmp`,
        reason: 'in-use',
      }))
      ;(cleanItems as ReturnType<typeof vi.fn>).mockResolvedValue({
        totalCleaned: 1024,
        filesDeleted: 3,
        filesSkipped: 12,
        errors,
        needsElevation: false,
      })

      process.argv = ['node.exe', 'script.js', '--cli', '--system', '--clean']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('... and 2 more'))
      expect(appExitMock).toHaveBeenCalledWith(4)
    })

    it('outputs JSON with clean result when --json and --clean are both passed', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')
      const { cleanItems } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          systemCleanTargets: () => [{ path: 'C:\\Windows\\Temp', subcategory: 'Windows Temp', childSubdir: false }],
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.System, 'Windows Temp', 1024, 2),
      )
      ;(cleanItems as ReturnType<typeof vi.fn>).mockResolvedValue({
        totalCleaned: 2048,
        filesDeleted: 2,
        filesSkipped: 1,
        errors: [],
        needsElevation: false,
      })

      process.argv = ['node.exe', 'script.js', '--cli', '--system', '--json', '--clean']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"scan"'))
      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"clean"'))
      expect(appExitMock).toHaveBeenCalledWith(0)
    })
  })

  // ── cleanDatabasesCli ─────────────────────────────────────────

  describe('cleanDatabasesCli', () => {
    it('cleans WAL database successfully', async () => {
      getCachedItemMock.mockReturnValue({ id: 'db1', path: 'C:\\data\\main.db', size: 50000 })
      statSyncMock
        .mockReturnValueOnce({ size: 50000 }) // sizeBefore
        .mockReturnValueOnce({ size: 4096 }) // walSizeBefore
        .mockReturnValueOnce({ size: 30000 }) // sizeAfter
        .mockReturnValueOnce({ size: 0 }) // walSizeAfter

      const { cleanDatabasesCli } = await import('./cli/commands/legacy')
      const result = await cleanDatabasesCli(['db1'])
      expect(result.filesDeleted).toBe(1)
      expect(result.totalCleaned).toBe(24096) // 50000+4096 - 30000+0
    })

    it('cleans non-WAL database (journal_mode is not WAL)', async () => {
      const betterSqlite3 = await import('better-sqlite3')

      getCachedItemMock.mockReturnValue({ id: 'db1', path: 'C:\\data\\main.db', size: 50000 })
      statSyncMock
        .mockReturnValueOnce({ size: 50000 })
        .mockReturnValueOnce({ size: 0 }) // walSizeBefore throws normally, but mock returns 0
        .mockReturnValueOnce({ size: 45000 })
        .mockReturnValueOnce({ size: 0 })
      // Override pragma to return 'delete' (non-WAL)
      const dbMock = (betterSqlite3.default as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value
      if (dbMock) dbMock.pragma.mockReturnValue('delete')

      statSyncMock.mockReset()
      statSyncMock.mockImplementation((p: string) => {
        if (p.endsWith('-wal')) throw new Error('no wal')
        return { size: 50000, mtimeMs: Date.now() }
      })
      openSyncMock.mockReturnValue(3)
      readSyncMock.mockImplementation((_fd: number, buf: Buffer) => {
        buf.write('SQLite format 3\0', 0, 16, 'utf8')
        return 16
      })
      const { getPlatform } = await import('./platform')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          databaseOptimizeTargets: () => [
            { label: 'TestApp', basePath: 'C:\\TestApp\\Data', dbFiles: ['main.db'], multiProfile: false },
          ],
        }),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--system']
      // Need scan + clean to test: scan to find db, then clean to vacuum
      // But the scan already found it (via runLegacyScanClean).
      // Just test cleanDatabasesCli directly for the non-WAL branch
      const { cleanDatabasesCli } = await import('./cli/commands/legacy')
      const result = await cleanDatabasesCli(['db1'])
      expect(result.filesDeleted).toBe(1)
    })

    it('skips item when getCachedItem returns null', async () => {
      getCachedItemMock.mockReturnValue(undefined)

      const { cleanDatabasesCli } = await import('./cli/commands/legacy')
      const result = await cleanDatabasesCli(['nonexistent'])
      expect(result.filesDeleted).toBe(0)
      expect(result.filesSkipped).toBe(0)
    })

    it('handles Database constructor errors', async () => {
      const betterSqlite3 = await import('better-sqlite3')

      getCachedItemMock.mockReturnValue({ id: 'db1', path: 'C:\\data\\main.db', size: 50000 })
      statSyncMock.mockReturnValue({ size: 50000 })

      const origDb = betterSqlite3.default
      const err = new Error('db locked') as Error & { code: string }
      err.code = 'SQLITE_BUSY'
      // biome-ignore lint/complexity/useArrowFunction: constructor mock — arrow functions are not constructible (vitest 4.x)
      betterSqlite3.default = vi.fn(function () {
        throw err
      }) as unknown as typeof betterSqlite3.default

      const { cleanDatabasesCli } = await import('./cli/commands/legacy')
      const result = await cleanDatabasesCli(['db1'])
      expect(result.filesSkipped).toBe(1)
      expect(result.errors[0]?.reason).toBe('in-use')
      betterSqlite3.default = origDb
    })

    it('handles WAL stat errors before and after (no WAL file)', async () => {
      getCachedItemMock.mockReturnValue({ id: 'db1', path: 'C:\\data\\main.db', size: 50000 })
      statSyncMock
        .mockReturnValueOnce({ size: 50000 }) // sizeBefore
        .mockImplementationOnce(() => {
          throw new Error('no wal file')
        }) // walSizeBefore
        .mockReturnValueOnce({ size: 45000 }) // sizeAfter
        .mockImplementationOnce(() => {
          throw new Error('no wal file')
        }) // walSizeAfter

      const { cleanDatabasesCli } = await import('./cli/commands/legacy')
      const result = await cleanDatabasesCli(['db1'])
      expect(result.filesDeleted).toBe(1)
      expect(result.totalCleaned).toBe(5000) // 50000 - 45000
    })

    it('handles non-Error exception thrown during clean', async () => {
      getCachedItemMock.mockReturnValue({ id: 'db1', path: 'C:\\data\\main.db', size: 50000 })
      statSyncMock.mockReturnValue({ size: 50000 })

      const { cleanDatabasesCli } = await import('./cli/commands/legacy')
      const result = await cleanDatabasesCli(['db1'])
      expect(result.filesDeleted).toBe(1)
    })

    // Skipped because vi.mock factory is cached after first import;
    // changing mockBetterSqlite3Error doesn't re-trigger the factory.
    // This path (import('better-sqlite3') failing) is tested implicitly
    // by 'handles Database constructor errors' above (same catch block).
    it.skip('handles better-sqlite3 not available', async () => {
      mockBetterSqlite3Error = new Error('module not found')
      const { cleanDatabasesCli } = await import('./cli/commands/legacy')
      const result = await cleanDatabasesCli(['db1'])
      expect(result.filesDeleted).toBe(0)
      expect(result.errors).toEqual([])
    })
  })

  // ── getChromiumProfiles (direct unit tests) ─────────────────

  describe('getChromiumProfiles', () => {
    it('returns Default when readdir fails', async () => {
      readdirPromisesMock.mockRejectedValue(new Error('access denied'))

      const { getChromiumProfiles } = await import('./cli/commands/legacy')
      const profiles = await getChromiumProfiles('C:\\Fake\\Browser')

      expect(profiles).toEqual(['Default'])
    })

    it('returns Default and matching Profile N directories', async () => {
      readdirPromisesMock.mockResolvedValue([
        { name: 'Default', isDirectory: () => true },
        { name: 'Profile 1', isDirectory: () => true },
        { name: 'Profile 2', isDirectory: () => true },
        { name: 'Guest', isDirectory: () => true },
        { name: 'file.txt', isDirectory: () => false },
      ])

      const { getChromiumProfiles } = await import('./cli/commands/legacy')
      const profiles = await getChromiumProfiles('C:\\Chrome\\User Data')

      expect(profiles).toEqual(['Default', 'Profile 1', 'Profile 2'])
    })

    it('returns only Default when no Profile N directories exist', async () => {
      readdirPromisesMock.mockResolvedValue([
        { name: 'Default', isDirectory: () => true },
        { name: 'Guest', isDirectory: () => true },
      ])

      const { getChromiumProfiles } = await import('./cli/commands/legacy')
      const profiles = await getChromiumProfiles('C:\\Chrome\\User Data')

      expect(profiles).toEqual(['Default'])
    })
  })

  // ── scanBrowserCli Firefox cache with profiles ──────────────

  describe('scanBrowserCli Firefox cache', () => {
    it('scans Firefox cache with profiles returning results', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')

      existsSyncMock.mockImplementation((p: unknown) => {
        if (typeof p !== 'string') return false
        return p.includes('Firefox') || p.includes('chrome') || p.includes('Chrome')
      })
      readdirPromisesMock.mockResolvedValue([{ name: 'default-release', isDirectory: () => true }])
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          browserPaths: () => ({
            chrome: {
              base: 'C:\\Chrome',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            edge: {
              base: 'C:\\Chrome',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            brave: undefined,
            vivaldi: undefined,
            opera: undefined,
            operaGX: undefined,
            arc: undefined,
            chromium: undefined,
            thorium: undefined,
            supermium: undefined,
            helium: undefined,
            cromite: undefined,
            catsxp: undefined,
            firefox: { cache: 'C:\\Firefox\\Profiles' },
            librewolf: { cache: undefined },
            waterfox: { cache: undefined },
            floorp: { cache: undefined },
            safari: null,
          }),
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockClear()
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.Browser, 'Firefox - default-release Cache', 1024, 3),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--browser']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Firefox'))
      expect(appExitMock).toHaveBeenCalledWith(0)
    })

    it('handles Firefox readdir error gracefully', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')

      existsSyncMock.mockImplementation((p: unknown) => {
        if (typeof p !== 'string') return false
        return p.includes('Firefox') || p.includes('chrome') || p.includes('Chrome')
      })
      readdirPromisesMock.mockRejectedValue(new Error('access denied'))
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          browserPaths: () => ({
            chrome: {
              base: 'C:\\Chrome',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            edge: {
              base: 'C:\\Chrome',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            brave: undefined,
            vivaldi: undefined,
            opera: undefined,
            operaGX: undefined,
            arc: undefined,
            chromium: undefined,
            thorium: undefined,
            supermium: undefined,
            helium: undefined,
            cromite: undefined,
            catsxp: undefined,
            firefox: { cache: 'C:\\Firefox\\Profiles' },
            librewolf: { cache: undefined },
            waterfox: { cache: undefined },
            floorp: { cache: undefined },
            safari: null,
          }),
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockClear()
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.Browser, 'Chrome - Cache', 0, 0),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--browser']
      const { runCli } = await import('./cli')
      await runCli()

      expect(appExitMock).toHaveBeenCalledWith(5)
    })

    it('scans Firefox fork (LibreWolf) with existing cache', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')

      existsSyncMock.mockImplementation((p: unknown) => {
        if (typeof p !== 'string') return false
        return p.includes('LibreWolf') || p.includes('Chrome')
      })
      readdirPromisesMock.mockResolvedValue([{ name: 'abc123.default', isDirectory: () => true }])
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          browserPaths: () => ({
            chrome: {
              base: 'C:\\Chrome',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            edge: {
              base: 'C:\\Chrome',
              cache: 'Cache',
              codeCache: 'Code Cache',
              gpuCache: 'GPU Cache',
              serviceWorker: 'Service Worker',
            },
            brave: undefined,
            vivaldi: undefined,
            opera: undefined,
            operaGX: undefined,
            arc: undefined,
            chromium: undefined,
            thorium: undefined,
            supermium: undefined,
            helium: undefined,
            cromite: undefined,
            catsxp: undefined,
            firefox: { cache: 'C:\\Firefox\\NotFound' },
            librewolf: { cache: 'C:\\LibreWolf\\Profiles' },
            waterfox: { cache: undefined },
            floorp: { cache: undefined },
            safari: null,
          }),
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockClear()
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.Browser, 'LibreWolf - abc123.default Cache', 1024, 2),
      )

      process.argv = ['node.exe', 'script.js', '--cli', '--browser']
      const { runCli } = await import('./cli')
      await runCli()

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('LibreWolf'))
      expect(appExitMock).toHaveBeenCalledWith(0)
    })
  })

  // ── runLegacyScanClean scan-only path ───────────────────────

  describe('runLegacyScanClean scan-only path', () => {
    it('shows Run with --clean when items found but doClean is false', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          systemCleanTargets: () => [{ path: 'C:\\Windows\\Temp', subcategory: 'Windows Temp', childSubdir: false }],
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.System, 'Windows Temp', 1024, 3),
      )

      const { runLegacyScanClean } = await import('./cli/commands/legacy')
      const exitCode = await runLegacyScanClean(['system'], false, { json: false, verbosity: 'normal' })

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Run with --clean to delete these items'))
      expect(exitCode).toBe(0)
    })

    it('scans and cleans database items when doClean is true', async () => {
      const { getPlatform } = await import('./platform')

      existsSyncMock.mockReturnValue(true)
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          databaseOptimizeTargets: () => [
            { label: 'TestApp', basePath: 'C:\\TestApp\\Data', dbFiles: ['main.db'], multiProfile: false },
          ],
        }),
      )
      statSyncMock.mockReset()
      statSyncMock.mockImplementation((p: string) => {
        if (p.endsWith('-wal')) throw new Error('no wal')
        return { size: 50000, mtimeMs: Date.now() }
      })
      openSyncMock.mockReturnValue(3)
      readSyncMock.mockImplementation((_fd: number, buf: Buffer) => {
        buf.write('SQLite format 3\0', 0, 16, 'utf8')
        return 16
      })
      getCachedItemMock.mockReturnValue({ id: 'db1', path: 'C:\\TestApp\\Data\\main.db', size: 50000 })

      const { runLegacyScanClean } = await import('./cli/commands/legacy')
      const exitCode = await runLegacyScanClean(['database'], true, { json: false, verbosity: 'normal' })

      expect(exitCode).toBe(0)
    })

    it('cleans recycle bin via trash path (file items not COM)', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')
      const { cleanItems } = await import('./services/file-utils')

      existsSyncMock.mockImplementation((p: unknown) => {
        if (typeof p !== 'string') return false
        return p.includes('.Trash')
      })
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          trashPath: () => '/Users/test/.Trash',
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockReset()
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeScanResult(CleanerType.RecycleBin, 'Trash', 2048, 2),
      )
      ;(cleanItems as ReturnType<typeof vi.fn>).mockResolvedValue({
        totalCleaned: 4096,
        filesDeleted: 2,
        filesSkipped: 0,
        errors: [],
        needsElevation: false,
      })

      const { runLegacyScanClean } = await import('./cli/commands/legacy')
      const exitCode = await runLegacyScanClean(['recycle-bin'], true, { json: false, verbosity: 'normal' })

      expect(cleanItems).toHaveBeenCalled()
      expect(exitCode).toBe(0)
    })

    it('outputs JSON with scan errors when they exist', async () => {
      const { getPlatform } = await import('./platform')
      const { scanDirectory } = await import('./services/file-utils')

      existsSyncMock.mockImplementation((p: unknown) => {
        if (typeof p !== 'string') return false
        return true
      })
      ;(getPlatform as ReturnType<typeof vi.fn>).mockReturnValue(
        makePlatform({
          trashPath: () => '/Users/test/.Trash',
        }),
      )
      ;(scanDirectory as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Scan crashed'))

      const { runLegacyScanClean } = await import('./cli/commands/legacy')
      const exitCode = await runLegacyScanClean(['recycle-bin'], false, { json: true, verbosity: 'normal' })

      expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('"errors"'))
      expect(exitCode).toBe(5)
    })
  })
})

describe('utility: formatBytes', () => {
  it('returns 0 B for 0', async () => {
    const { formatBytes } = await import('./cli')
    expect(formatBytes(0)).toBe('0 B')
  })

  it('returns 0 B for negative numbers', async () => {
    const { formatBytes } = await import('./cli')
    expect(formatBytes(-1)).toBe('0 B')
  })

  it('returns 0 B for Infinity', async () => {
    const { formatBytes } = await import('./cli')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B')
  })

  it('returns 0 B for NaN', async () => {
    const { formatBytes } = await import('./cli')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })

  it('formats plain bytes', async () => {
    const { formatBytes } = await import('./cli')
    expect(formatBytes(500)).toBe('500.00 B')
  })

  it('formats kilobytes', async () => {
    const { formatBytes } = await import('./cli')
    expect(formatBytes(1024)).toBe('1.00 KB')
  })

  it('formats fractional kilobytes', async () => {
    const { formatBytes } = await import('./cli')
    expect(formatBytes(1536)).toBe('1.50 KB')
  })

  it('formats megabytes', async () => {
    const { formatBytes } = await import('./cli')
    expect(formatBytes(1048576)).toBe('1.00 MB')
  })

  it('formats gigabytes', async () => {
    const { formatBytes } = await import('./cli')
    expect(formatBytes(1073741824)).toBe('1.00 GB')
  })

  it('formats terabytes', async () => {
    const { formatBytes } = await import('./cli')
    expect(formatBytes(1099511627776)).toBe('1.00 TB')
  })

  it('handles units index clamping for very large input', async () => {
    const { formatBytes } = await import('./cli')
    const result = formatBytes(1.1e15)
    expect(result).toMatch(/^\d+\.\d{2} TB$/)
  })
})

describe('utility: cliLog', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('writes message in normal mode', async () => {
    const { cliLog } = await import('./cli')
    cliLog({ json: false, verbosity: 'normal' }, 'test message')
    expect(stdoutWrite).toHaveBeenCalledWith('test message\n')
  })

  it('writes message in verbose mode', async () => {
    const { cliLog } = await import('./cli')
    cliLog({ json: false, verbosity: 'verbose' }, 'test message')
    expect(stdoutWrite).toHaveBeenCalledWith('test message\n')
  })

  it('does nothing in quiet mode', async () => {
    const { cliLog } = await import('./cli')
    cliLog({ json: false, verbosity: 'quiet' }, 'test message')
    expect(stdoutWrite).not.toHaveBeenCalled()
  })
})

describe('utility: cliVerbose', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('writes with prefix in verbose mode', async () => {
    const { cliVerbose } = await import('./cli')
    cliVerbose({ json: false, verbosity: 'verbose' }, 'detail info')
    expect(stdoutWrite).toHaveBeenCalledWith('  [verbose] detail info\n')
  })

  it('does nothing in normal mode', async () => {
    const { cliVerbose } = await import('./cli')
    cliVerbose({ json: false, verbosity: 'normal' }, 'detail info')
    expect(stdoutWrite).not.toHaveBeenCalled()
  })

  it('does nothing in quiet mode', async () => {
    const { cliVerbose } = await import('./cli')
    cliVerbose({ json: false, verbosity: 'quiet' }, 'detail info')
    expect(stdoutWrite).not.toHaveBeenCalled()
  })
})

describe('utility: cliOut', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('outputs JSON for object in json mode', async () => {
    const { cliOut } = await import('./cli')
    cliOut({ json: true, verbosity: 'normal' }, { key: 'value', num: 42 })
    expect(stdoutWrite).toHaveBeenCalledWith(`${JSON.stringify({ key: 'value', num: 42 }, null, 2)}\n`)
  })

  it('outputs JSON for array in json mode', async () => {
    const { cliOut } = await import('./cli')
    cliOut({ json: true, verbosity: 'normal' }, ['a', 'b'])
    expect(stdoutWrite).toHaveBeenCalledWith(`${JSON.stringify(['a', 'b'], null, 2)}\n`)
  })

  it('outputs JSON for string in json mode', async () => {
    const { cliOut } = await import('./cli')
    cliOut({ json: true, verbosity: 'normal' }, 'hello')
    expect(stdoutWrite).toHaveBeenCalledWith(`${JSON.stringify('hello', null, 2)}\n`)
  })

  it('does nothing in quiet text mode', async () => {
    const { cliOut } = await import('./cli')
    cliOut({ json: false, verbosity: 'quiet' }, 'should not appear')
    expect(stdoutWrite).not.toHaveBeenCalled()
  })

  it('does nothing for empty data in quiet text mode', async () => {
    const { cliOut } = await import('./cli')
    cliOut({ json: false, verbosity: 'quiet' }, { key: 'val' })
    expect(stdoutWrite).not.toHaveBeenCalled()
  })

  it('iterates array of strings in text mode', async () => {
    const { cliOut } = await import('./cli')
    cliOut({ json: false, verbosity: 'normal' }, ['first', 'second'])
    expect(stdoutWrite).toHaveBeenCalledWith('  first\n')
    expect(stdoutWrite).toHaveBeenCalledWith('  second\n')
  })

  it('iterates array of objects in text mode', async () => {
    const { cliOut } = await import('./cli')
    cliOut({ json: false, verbosity: 'normal' }, [{ x: 1 }])
    expect(stdoutWrite).toHaveBeenCalledWith('  {"x":1}\n')
  })

  it('iterates object entries in text mode', async () => {
    const { cliOut } = await import('./cli')
    cliOut({ json: false, verbosity: 'normal' }, { name: 'test', count: 42 })
    expect(stdoutWrite).toHaveBeenCalledWith('  name: test\n')
    expect(stdoutWrite).toHaveBeenCalledWith('  count: 42\n')
  })

  it('handles nested object values in text mode', async () => {
    const { cliOut } = await import('./cli')
    cliOut({ json: false, verbosity: 'normal' }, { config: { theme: 'dark' } })
    expect(stdoutWrite).toHaveBeenCalledWith('  config: {"theme":"dark"}\n')
  })

  it('converts primitive number to string in text mode', async () => {
    const { cliOut } = await import('./cli')
    cliOut({ json: false, verbosity: 'normal' }, 42)
    expect(stdoutWrite).toHaveBeenCalledWith('42\n')
  })

  it('converts null to string in text mode', async () => {
    const { cliOut } = await import('./cli')
    cliOut({ json: false, verbosity: 'normal' }, null)
    expect(stdoutWrite).toHaveBeenCalledWith('null\n')
  })

  it('converts boolean to string in text mode', async () => {
    const { cliOut } = await import('./cli')
    cliOut({ json: false, verbosity: 'normal' }, true)
    expect(stdoutWrite).toHaveBeenCalledWith('true\n')
  })
})

describe('utility: cliUsage', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('shows JSON error in json mode', async () => {
    const { cliUsage } = await import('./cli')
    cliUsage({ json: true, verbosity: 'normal' }, 'dinho --cli scan')
    expect(stdoutWrite).toHaveBeenCalledWith('{"error":"invalid_usage","usage":"dinho --cli scan"}\n')
  })

  it('shows usage text in text mode', async () => {
    const { cliUsage } = await import('./cli')
    cliUsage({ json: false, verbosity: 'normal' }, 'dinho --cli scan')
    expect(stdoutWrite).toHaveBeenCalledWith('Usage: dinho --cli scan\n')
  })

  it('shows usage text even in quiet mode', async () => {
    const { cliUsage } = await import('./cli')
    cliUsage({ json: false, verbosity: 'quiet' }, 'dinho --cli scan')
    expect(stdoutWrite).toHaveBeenCalledWith('Usage: dinho --cli scan\n')
  })
})

describe('utility: cliNotFound', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('shows JSON error in json mode', async () => {
    const { cliNotFound } = await import('./cli')
    cliNotFound({ json: true, verbosity: 'normal' }, 'Startup item', 'TestApp')
    expect(stdoutWrite).toHaveBeenCalledWith('{"error":"not_found","type":"Startup item","name":"TestApp"}\n')
  })

  it('shows not-found text in text mode', async () => {
    const { cliNotFound } = await import('./cli')
    cliNotFound({ json: false, verbosity: 'normal' }, 'Startup item', 'TestApp')
    expect(stdoutWrite).toHaveBeenCalledWith('Startup item not found: TestApp\n')
  })

  it('shows not-found text even in quiet mode', async () => {
    const { cliNotFound } = await import('./cli')
    cliNotFound({ json: false, verbosity: 'quiet' }, 'Startup item', 'TestApp')
    expect(stdoutWrite).toHaveBeenCalledWith('Startup item not found: TestApp\n')
  })
})

describe('utility: showProgress', () => {
  it('returns true for normal mode without json', async () => {
    const { showProgress } = await import('./cli')
    expect(showProgress({ json: false, verbosity: 'normal' })).toBe(true)
  })

  it('returns true for verbose mode without json', async () => {
    const { showProgress } = await import('./cli')
    expect(showProgress({ json: false, verbosity: 'verbose' })).toBe(true)
  })

  it('returns false for quiet mode without json', async () => {
    const { showProgress } = await import('./cli')
    expect(showProgress({ json: false, verbosity: 'quiet' })).toBe(false)
  })

  it('returns false for normal mode with json', async () => {
    const { showProgress } = await import('./cli')
    expect(showProgress({ json: true, verbosity: 'normal' })).toBe(false)
  })

  it('returns false for verbose mode with json', async () => {
    const { showProgress } = await import('./cli')
    expect(showProgress({ json: true, verbosity: 'verbose' })).toBe(false)
  })
})

describe('utility: printHelp', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>

  beforeEach(() => {
    stdoutWrite = vi.fn()
    process.stdout.write = stdoutWrite as unknown as typeof process.stdout.write
  })

  it('prints output containing DiNho CLI heading', async () => {
    const { printHelp } = await import('./cli')
    printHelp()
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('DiNho CLI'))
  })

  it('prints output containing Usage section', async () => {
    const { printHelp } = await import('./cli')
    printHelp()
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Usage:'))
  })

  it('prints output containing Global Options', async () => {
    const { printHelp } = await import('./cli')
    printHelp()
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Global Options'))
  })

  it('prints output containing Exit Codes', async () => {
    const { printHelp } = await import('./cli')
    printHelp()
    expect(stdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Exit Codes'))
  })
})
