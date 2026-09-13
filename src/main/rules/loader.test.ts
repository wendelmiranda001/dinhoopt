import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RulesJsonSet } from './loader'
import { buildCleanerPaths } from './loader'

const mocks = {
  logger: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

afterEach(() => {
  vi.clearAllMocks()
})

const mockRules: RulesJsonSet = {
  system: {
    type: 'system',
    cleanTargets: [
      { path: '${LOCALAPPDATA}\\cache', subcategory: 'cache', needsAdmin: true },
      { path: '${LOCALAPPDATA}\\Temp', subcategory: 'temp' },
    ],
    singleFileTargets: [{ path: '${WINDIR}\\Prefetch', subcategory: 'prefetch' }],
  },
  browsers: {
    type: 'browsers',
    chromiumCacheDirs: {
      cache: 'Cache',
      codeCache: 'Code Cache',
      gpuCache: 'GPU Cache',
      serviceWorker: 'Service Worker',
    },
    chromium: [
      { key: 'chrome', base: '${LOCALAPPDATA}\\Google\\Chrome\\User Data' },
      { key: 'edge', base: '${LOCALAPPDATA}\\Microsoft\\Edge\\User Data' },
      { key: 'brave', base: '${LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\User Data' },
      { key: 'opera', base: '${APPDATA}\\Opera Software\\Opera Stable' },
      { key: 'operaGX', base: '${APPDATA}\\Opera Software\\Opera GX Stable' },
      { key: 'vivaldi', base: '${LOCALAPPDATA}\\Vivaldi\\User Data' },
      { key: 'arc', base: '${LOCALAPPDATA}\\Arc\\User Data' },
      { key: 'chromium', base: '${LOCALAPPDATA}\\Chromium\\User Data' },
      { key: 'thorium', base: '${LOCALAPPDATA}\\Thorium\\User Data' },
      { key: 'supermium', base: '${LOCALAPPDATA}\\Supermium\\User Data' },
      { key: 'helium', base: '${LOCALAPPDATA}\\Helium\\User Data' },
      { key: 'cromite', base: '${LOCALAPPDATA}\\Cromite\\User Data' },
      { key: 'catsxp', base: '${LOCALAPPDATA}\\Catsxp\\User Data' },
    ],
    firefox: { base: '${APPDATA}\\Mozilla\\Firefox\\Profiles', cache: '${LOCALAPPDATA}\\Mozilla\\Firefox\\Profiles' },
    firefoxForks: [
      { key: 'librewolf', base: '${APPDATA}\\Librewolf', cache: '${LOCALAPPDATA}\\Librewolf' },
      { key: 'waterfox', base: '${APPDATA}\\Waterfox', cache: '${LOCALAPPDATA}\\Waterfox' },
      { key: 'floorp', base: '${APPDATA}\\Floorp', cache: '${LOCALAPPDATA}\\Floorp' },
      { key: 'zen', base: '${APPDATA}\\Zen', cache: '${LOCALAPPDATA}\\Zen' },
    ],
    safari: null,
  },
  apps: {
    type: 'apps',
    apps: [
      {
        id: 'discord',
        name: 'Discord',
        paths: ['${APPDATA}\\discord', '${LOCALAPPDATA}\\Discord'],
        childSubdir: 'Cache',
      },
      { id: 'slack', name: 'Slack', paths: ['${APPDATA}\\Slack'] },
    ],
  },
  gaming: {
    type: 'gaming',
    apps: [{ id: 'steam', name: 'Steam', paths: ['${PROGRAMFILES_x86}\\Steam'] }],
  },
  gpuCache: {
    type: 'gpu-cache',
    apps: [{ id: 'nvidia', name: 'NVIDIA', paths: ['${LOCALAPPDATA}\\NVIDIA'] }],
  },
  steam: {
    type: 'steam',
    libraries: ['${PROGRAMFILES_x86}\\Steam', 'D:\\SteamLibrary'],
    redistPatterns: ['vcredist_*.exe', 'dxwebsetup.exe'],
  },
  databases: {
    type: 'databases',
    sharedDbFileSets: {
      chromium: ['History', 'Favicons', 'Cookies'],
      firefox: ['places.sqlite', 'cookies.sqlite'],
    },
    targets: [
      {
        label: 'Chrome History',
        basePath: '${LOCALAPPDATA}\\Google\\Chrome\\User Data',
        dbFiles: '$chromium',
        multiProfile: true,
        profilePattern: ['Default', 'Profile *'],
      },
      { label: 'Firefox Places', basePath: '${APPDATA}\\Mozilla\\Firefox\\Profiles', dbFiles: '$firefox' },
      { label: 'Custom DB', basePath: '${PROGRAMDATA}\\App\\Data', dbFiles: 'custom.db' },
    ],
  },
  misc: {
    type: 'misc',
    protectedEventLogs: ['System', 'Application', 'Security'],
    trashPath: '$Recycle.Bin',
  },
}

describe('buildCleanerPaths', () => {
  it('systemCleanTargets resolves paths and includes needsAdmin', () => {
    const cleaners = buildCleanerPaths(mockRules, 'win32')
    const targets = cleaners.systemCleanTargets()
    expect(targets).toHaveLength(2)
    expect(targets[0].path).toContain('cache')
    expect(targets[0].needsAdmin).toBe(true)
    expect(targets[1].needsAdmin).toBeUndefined()
  })

  it('singleFileCleanTargets returns resolved paths', () => {
    const cleaners = buildCleanerPaths(mockRules, 'win32')
    const targets = cleaners.singleFileCleanTargets()
    expect(targets).toHaveLength(1)
    expect(targets[0].path).toContain('Prefetch')
  })

  it('protectedEventLogs returns event logs list', () => {
    const cleaners = buildCleanerPaths(mockRules, 'win32')
    expect(cleaners.protectedEventLogs()).toEqual(['System', 'Application', 'Security'])
  })

  it('browserPaths returns all browser paths', () => {
    const cleaners = buildCleanerPaths(mockRules, 'win32')
    const bp = cleaners.browserPaths()
    expect(bp.chrome.base).toContain('Chrome')
    expect(bp.edge.base).toContain('Edge')
    expect(bp.brave.base).toContain('Brave')
    expect(bp.firefox.base).toContain('Firefox')
    expect(bp.librewolf.base).toContain('Librewolf')
    expect(bp.waterfox.base).toContain('Waterfox')
    expect(bp.floorp.base).toContain('Floorp')
    expect(bp.zen.base).toContain('Zen')
    expect(bp.safari).toBeNull()
  })

  it('appPaths resolves paths and includes childSubdir', () => {
    const cleaners = buildCleanerPaths(mockRules, 'win32')
    const apps = cleaners.appPaths()
    const discord = apps.find((a) => a.id === 'discord')!
    expect(discord.childSubdir).toBe('Cache')
    expect(discord.paths).toHaveLength(2)
    const slack = apps.find((a) => a.id === 'slack')!
    expect(slack.childSubdir).toBeUndefined()
  })

  it('gamingPaths returns resolved paths', () => {
    const cleaners = buildCleanerPaths(mockRules, 'win32')
    const games = cleaners.gamingPaths()
    expect(games).toHaveLength(1)
    expect(games[0].id).toBe('steam')
  })

  it('gpuCachePaths returns resolved paths', () => {
    const cleaners = buildCleanerPaths(mockRules, 'win32')
    const caches = cleaners.gpuCachePaths()
    expect(caches).toHaveLength(1)
    expect(caches[0].id).toBe('nvidia')
  })

  it('steamLibraries returns resolved libraries', () => {
    const cleaners = buildCleanerPaths(mockRules, 'win32')
    const libs = cleaners.steamLibraries()
    expect(libs).toHaveLength(2)
    expect(libs[0]).toContain('Steam')
  })

  it('steamRedistPatterns returns redist patterns', () => {
    const cleaners = buildCleanerPaths(mockRules, 'win32')
    const patterns = cleaners.steamRedistPatterns()
    expect(patterns).toEqual(['vcredist_*.exe', 'dxwebsetup.exe'])
  })

  it('trashPath returns misc trash path', () => {
    const cleaners = buildCleanerPaths(mockRules, 'win32')
    expect(cleaners.trashPath()).toBe('$Recycle.Bin')
  })

  it('databaseOptimizeTargets resolves all target types', () => {
    const cleaners = buildCleanerPaths(mockRules, 'win32')
    const targets = cleaners.databaseOptimizeTargets()
    expect(targets).toHaveLength(3)
    expect(targets[0].label).toBe('Chrome History')
    expect(targets[0].dbFiles).toEqual(['History', 'Favicons', 'Cookies'])
    expect(targets[0].multiProfile).toBe(true)
    expect(targets[0].profilePattern).toEqual(['Default', 'Profile *'])
    expect(targets[1].label).toBe('Firefox Places')
    expect(targets[1].dbFiles).toEqual(['places.sqlite', 'cookies.sqlite'])
    expect(targets[2].label).toBe('Custom DB')
    expect(targets[2].dbFiles).toEqual(['custom.db'])
  })

  it('databaseOptimizeTargets resolves array dbFiles', () => {
    const rulesWithArrayDbFiles: RulesJsonSet = {
      ...mockRules,
      databases: {
        ...mockRules.databases,
        targets: [
          ...mockRules.databases.targets,
          {
            label: 'Array DB',
            basePath: '${PROGRAMDATA}\\App\\Data',
            dbFiles: ['extra1.db', 'extra2.db'],
          },
        ],
      },
    }
    const cleaners = buildCleanerPaths(rulesWithArrayDbFiles, 'win32')
    const targets = cleaners.databaseOptimizeTargets()
    const arrayTarget = targets.find((t) => t.label === 'Array DB')
    expect(arrayTarget?.dbFiles).toEqual(['extra1.db', 'extra2.db'])
    expect(arrayTarget?.multiProfile).toBeUndefined()
    expect(arrayTarget?.profilePattern).toBeUndefined()
  })
})

describe('getWinVars fallbacks', () => {
  const OLD_ENV = { ...process.env }

  afterEach(() => {
    process.env = { ...OLD_ENV }
  })

  it('falls back to defaults when env vars are missing', () => {
    delete process.env.LOCALAPPDATA
    delete process.env.APPDATA
    delete process.env.WINDIR
    delete process.env.ProgramData
    delete process.env.ProgramFiles
    delete process.env['ProgramFiles(x86)']

    const cleaners = buildCleanerPaths(mockRules, 'win32')
    const targets = cleaners.systemCleanTargets()
    expect(targets).toHaveLength(2)
    expect(targets[0].path).toBeDefined()
  })
})

describe('resolveVars', () => {
  it('replaces unknown variable with empty string', () => {
    const rulesWithUnknownVar: RulesJsonSet = {
      ...mockRules,
      system: {
        ...mockRules.system,
        cleanTargets: [{ path: '${UNKNOWN_VAR}\\cache', subcategory: 'cache' }],
      },
    }
    const cleaners = buildCleanerPaths(rulesWithUnknownVar, 'win32')
    const targets = cleaners.systemCleanTargets()
    expect(targets[0].path).not.toContain('UNKNOWN_VAR')
    expect(targets[0].path).toContain('cache')
  })

  it('logs a warning when a variable cannot be resolved', () => {
    const rulesWithUnknownVar: RulesJsonSet = {
      ...mockRules,
      system: {
        ...mockRules.system,
        cleanTargets: [{ path: '${UNKNOWN_VAR}\\cache', subcategory: 'cache' }],
      },
    }
    const cleaners = buildCleanerPaths(rulesWithUnknownVar, 'win32')
    cleaners.systemCleanTargets()
    expect(mocks.logger.warning).toHaveBeenCalledWith('rules-loader', expect.stringContaining('UNKNOWN_VAR'))
  })

  it('does not log a warning when every variable resolves', () => {
    const cleaners = buildCleanerPaths(mockRules, 'win32')
    cleaners.systemCleanTargets()
    expect(mocks.logger.warning).not.toHaveBeenCalled()
  })
})
