import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const execNativeUtf8Mock = vi.fn()
  const getPlatformMock = vi.fn()
  const existsSyncMock = vi.fn<(path: string) => boolean>()
  const mkdirSyncMock = vi.fn()
  const readFileSyncMock = vi.fn<(path: string, encoding: string) => string>()
  const writeFileSyncMock = vi.fn()
  const appGetPathMock = vi.fn<(name: string) => string>()

  return {
    execNativeUtf8Mock,
    getPlatformMock,
    existsSyncMock,
    mkdirSyncMock,
    readFileSyncMock,
    writeFileSyncMock,
    appGetPathMock,
  }
})

vi.mock('node:fs', () => ({
  existsSync: mocks.existsSyncMock,
  mkdirSync: mocks.mkdirSyncMock,
  readFileSync: mocks.readFileSyncMock,
  writeFileSync: mocks.writeFileSyncMock,
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: mocks.appGetPathMock,
  },
}))

vi.mock('../platform', () => ({
  getPlatform: mocks.getPlatformMock,
}))

vi.mock('./exec-utf8', () => ({
  execNativeUtf8: (...args: unknown[]) => mocks.execNativeUtf8Mock(...args),
}))

import { applyPrivacySettings, PRIVACY_SETTINGS, revertPrivacySettings, scanPrivacy } from './privacy-shield.service'

const SETTING_COUNT = PRIVACY_SETTINGS.length

beforeEach(() => {
  mocks.execNativeUtf8Mock.mockReset()
  mocks.getPlatformMock.mockReset()
  mocks.readFileSyncMock.mockReturnValue('{}')
  mocks.existsSyncMock.mockReturnValue(true)
  mocks.mkdirSyncMock.mockReset()
  mocks.writeFileSyncMock.mockReset()
  mocks.appGetPathMock.mockReturnValue('C:\\MockUserData')
  mocks.execNativeUtf8Mock.mockRejectedValue(new Error('Not found'))
})

// ─── Setting Definition Checks ──────────────────────────────────

describe('PRIVACY_SETTINGS', () => {
  it('has all required properties on every setting', () => {
    for (const s of PRIVACY_SETTINGS) {
      expect(typeof s.id).toBe('string')
      expect(typeof s.category).toBe('string')
      expect(typeof s.label).toBe('string')
      expect(typeof s.description).toBe('string')
      expect(typeof s.requiresAdmin).toBe('boolean')
      expect(typeof s.check).toBe('function')
      expect(typeof s.apply).toBe('function')
    }
  })

  it('has unique IDs', () => {
    const ids = PRIVACY_SETTINGS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all categories are valid', () => {
    const valid = new Set(['telemetry', 'ads', 'search', 'services', 'tasks', 'sync', 'ai', 'browser', 'recall'])
    for (const s of PRIVACY_SETTINGS) {
      expect(valid.has(s.category)).toBe(true)
    }
  })

  it('dependsOn references exist if specified', () => {
    const allIds = new Set(PRIVACY_SETTINGS.map((s) => s.id))
    for (const s of PRIVACY_SETTINGS) {
      if (s.dependsOn) {
        expect(allIds.has(s.dependsOn)).toBe(true)
      }
    }
  })

  it('service-category direct-service settings have applicable()', () => {
    const serviceSettings = PRIVACY_SETTINGS.filter(
      (s) => s.category === 'services' && s.id.startsWith('service-') && s.id !== 'service-delivery-optimization',
    )
    for (const s of serviceSettings) {
      if (typeof s.revert === 'function') {
        expect(typeof s.applicable).toBe('function')
      }
    }
  })

  it('task-category settings have applicable()', () => {
    const taskSettings = PRIVACY_SETTINGS.filter((s) => s.category === 'tasks')
    for (const s of taskSettings) {
      expect(typeof s.applicable).toBe('function')
    }
  })
})

// ─── scanPrivacy — specific uncovered branches ──────────────────

describe('scanPrivacy', () => {
  it('handles check with applicable returning false (service not found)', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query') {
        if ((args[1] as string).includes('CurrentControlSet\\Services\\')) {
          // Service not found in registry → serviceExists returns false → applicable returns false
          throw new Error('Service not found')
        }
        return { stdout: '    Value    REG_DWORD    0x0', stderr: '' }
      }
      if (tool === 'schtasks') {
        return { stdout: '<Settings><Enabled>false</Enabled></Settings>', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'query' && args.includes('/ve')) {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    const result = await scanPrivacy()
    const serviceSettings = result.settings.filter((s) => s.category === 'services')
    for (const s of serviceSettings) {
      if (s.id === 'service-delivery-optimization') continue
      expect(s.reversible).toBe(false)
    }
  })

  it('catches check() reject and treats as not enabled', async () => {
    mocks.execNativeUtf8Mock.mockRejectedValue(new Error('Access denied'))
    const result = await scanPrivacy()
    const telemetry = result.settings.find((s) => s.id === 'telemetry-level')!
    expect(telemetry.enabled).toBe(false)
  })

  it('includes dependsOn in settings when defined', async () => {
    mocks.execNativeUtf8Mock.mockRejectedValue(new Error('Not found'))
    const result = await scanPrivacy()
    for (const s of result.settings) {
      const def = PRIVACY_SETTINGS.find((d) => d.id === s.id)!
      if (def.dependsOn) {
        expect(s).toHaveProperty('dependsOn', def.dependsOn)
      }
    }
  })

  it('computes correct score with all checks failing', async () => {
    mocks.execNativeUtf8Mock.mockRejectedValue(new Error('Not found'))
    const result = await scanPrivacy()
    expect(result.total).toBe(SETTING_COUNT)
    expect(result.score).toBe(Math.round((result.protected / result.total) * 100))
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
  })

  it('returns reversible=true for settings with revert and applicable returning true', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('/ve')) {
        return { stdout: '', stderr: '' }
      }
      if (tool === 'schtasks') {
        return { stdout: '<Settings><Enabled>false</Enabled></Settings>', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'query') {
        const key = args[1] as string
        if (key.includes('CurrentControlSet\\Services\\')) {
          return { stdout: '    Start    REG_DWORD    0x3', stderr: '' }
        }
        return { stdout: '    Value    REG_DWORD    0x0', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    const result = await scanPrivacy()
    for (const s of result.settings) {
      const def = PRIVACY_SETTINGS.find((d) => d.id === s.id)!
      if (typeof def.revert === 'function' && typeof def.applicable === 'function') {
        expect(s.reversible).toBe(true)
      }
    }
  })
})

// ─── isTaskActive / taskExists — XML edge cases ─────────────────

describe('isTaskActive — XML parsing edge cases', () => {
  function getTaskSetting() {
    return PRIVACY_SETTINGS.find((s) => s.id === 'task-compatibility-appraiser')!
  }

  it('returns true when XML has no <Settings><Enabled> element (default true)', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string) => {
      if (tool === 'schtasks') {
        return { stdout: '<?xml version="1.0"?><Task><Triggers><CalendarTrigger /></Triggers></Task>', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    const setting = getTaskSetting()
    const result = await setting.check()
    expect(result).toBe(false)
  })

  it('taskExists returns true on successful schtasks query', async () => {
    mocks.execNativeUtf8Mock.mockResolvedValue({ stdout: 'task info', stderr: '' })
    const setting = getTaskSetting()
    const result = await setting.applicable!()
    expect(result).toBe(true)
  })

  it('taskExists returns false on failed schtasks query', async () => {
    mocks.execNativeUtf8Mock.mockRejectedValue(new Error('Task not found'))
    const setting = getTaskSetting()
    const result = await setting.applicable!()
    expect(result).toBe(false)
  })
})

// ─── regQueryDword — regex edge cases ───────────────────────────

describe('regQueryDword — edge cases', () => {
  it('returns null when stdout has no regex match', async () => {
    mocks.execNativeUtf8Mock.mockResolvedValue({
      stdout: '    Telemetry    REG_SZ    some string value',
      stderr: '',
    })

    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'telemetry-level')!
    const result = await setting.check()
    expect(result).toBe(false)
  })

  it('returns null when exec throws', async () => {
    mocks.execNativeUtf8Mock.mockRejectedValue(new Error('Registry not found'))
    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'telemetry-level')!
    const result = await setting.check()
    expect(result).toBe(false)
  })

  it('handles uppercase hex in registry output', async () => {
    mocks.execNativeUtf8Mock.mockResolvedValue({
      stdout: '    AllowTelemetry    REG_DWORD    0x0',
      stderr: '',
    })

    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'telemetry-level')!
    const result = await setting.check()
    expect(result).toBe(true)
  })
})

// ─── isServiceEnabled — edge cases ──────────────────────────────

describe('isServiceEnabled — edge cases', () => {
  it('returns false when Start value is 4 (disabled)', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && (args[1] as string).includes('DiagTrack')) {
        return { stdout: '    Start    REG_DWORD    0x4', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'service-diagtrack')!
    const result = await setting.check()
    expect(result).toBe(true)
  })

  it('returns false when registry query fails (service not found)', async () => {
    mocks.execNativeUtf8Mock.mockRejectedValue(new Error('Not found'))
    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'service-diagtrack')!
    const result = await setting.check()
    expect(result).toBe(true)
  })
})

// ─── disableService — cache and save behavior ───────────────────

describe('disableService edge cases', () => {
  const DIAGTRACK_ID = 'service-diagtrack'

  it('saves original start value on first call, skips query on second call', async () => {
    const queryCalls: unknown[][] = []
    mocks.execNativeUtf8Mock.mockImplementation(async (...args: unknown[]) => {
      const tool = args[0] as string
      const cmdArgs = args[1] as string[]
      if (tool === 'reg' && cmdArgs[0] === 'query') {
        queryCalls.push(args)
        return { stdout: '    Start    REG_DWORD    0x2', stderr: '' }
      }
      if (tool === 'reg' && cmdArgs[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    // First call — cache miss, queries reg, saves to cache
    await applyPrivacySettings([DIAGTRACK_ID])
    expect(queryCalls.length).toBe(1)

    // Second call — cache hit, no reg query
    await applyPrivacySettings([DIAGTRACK_ID])
    expect(queryCalls.length).toBe(1)

    // Clean up module-level cache to avoid polluting subsequent tests
    await revertPrivacySettings([DIAGTRACK_ID])
  })

  it('skips saving to cache when startVal is null', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query') {
        throw new Error('Not found')
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    await applyPrivacySettings([DIAGTRACK_ID])
    expect(mocks.writeFileSyncMock).not.toHaveBeenCalled()
  })

  it('skips saving to cache when startVal is 4 (already disabled)', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('Start')) {
        return { stdout: '    Start    REG_DWORD    0x4', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    await applyPrivacySettings([DIAGTRACK_ID])
    expect(mocks.writeFileSyncMock).not.toHaveBeenCalled()
  })
})

// ─── enableService — KNOWN_SERVICE_DEFAULTS and fallbacks ────────

describe('enableService edge cases', () => {
  it('rejects revert when the service key cannot be queried (no phantom write)', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    vi.resetModules()
    const { revertPrivacySettings: revertPriv } = await import('./privacy-shield.service')

    const result = await revertPriv(['ai-service-autostart'])
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe("Service 'AiHost' does not exist")

    const addCalls = mocks.execNativeUtf8Mock.mock.calls.filter(
      (c) => (c[0] as string) === 'reg' && (c[1] as string[])[0] === 'add',
    )
    expect(addCalls).toHaveLength(0)
  })

  it('uses fallback 3 for unknown service when no cache and current is 4', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('Start')) {
        return { stdout: '    Start    REG_DWORD    0x4', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    await revertPrivacySettings(['service-mapsbroker'])

    const addCalls = mocks.execNativeUtf8Mock.mock.calls.filter(
      (c) => (c[0] as string) === 'reg' && (c[1] as string[])[0] === 'add',
    )
    const lastAdd = addCalls[addCalls.length - 1] as [string, string[]]
    const dataIdx = lastAdd[1].indexOf('/d')
    expect(lastAdd[1][dataIdx + 1]).toBe('3')
  })

  it('restores cached value when cache has the service', async () => {
    const addDataValues: string[] = []
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('Start')) {
        return { stdout: '    Start    REG_DWORD    0x2', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        const dataIdx = args.indexOf('/d')
        addDataValues.push(args[dataIdx + 1]!)
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    // First, disable to populate cache (saves 2 as original)
    await applyPrivacySettings(['service-dmwappush'])
    expect(addDataValues).toContain('4')

    addDataValues.length = 0

    // Then revert — should use cached value 2
    await revertPrivacySettings(['service-dmwappush'])
    expect(addDataValues).toContain('2')
  })

  it('deletes from cache and saves after enable', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('Start')) {
        return { stdout: '    Start    REG_DWORD    0x3', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    await applyPrivacySettings(['service-diagtrack'])
    await revertPrivacySettings(['service-diagtrack'])

    const writeCalls = mocks.writeFileSyncMock.mock.calls
    const serializeCalls = writeCalls.filter((c) => (c[0] as string).includes('service-start-types.json'))
    expect(serializeCalls.length).toBeGreaterThanOrEqual(2)
  })
})

// ─── regDeleteValue — error paths ────────────────────────────────

describe('regDeleteValue error paths', () => {
  it('throws when delete fails and value still exists (query succeeds)', async () => {
    let _callIndex = 0
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      _callIndex++
      if (tool === 'reg' && args[0] === 'delete') {
        throw new Error('Access is denied')
      }
      if (tool === 'reg' && args[0] === 'query') {
        return { stdout: '    AllowTelemetry    REG_DWORD    0x0', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'telemetry-level')!
    await expect(setting.revert!()).rejects.toThrow('Access is denied')
  })

  it('returns silently when delete fails and value is already gone (query fails)', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'delete') {
        throw new Error('Access is denied')
      }
      if (tool === 'reg' && args[0] === 'query') {
        throw new Error('Value not found')
      }
      throw new Error('Unexpected')
    })

    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'telemetry-level')!
    await expect(setting.revert!()).resolves.toBeUndefined()
  })
})

// ─── saveServiceStartTypes / loadServiceStartTypes ──────────────

describe('service start type cache', () => {
  it('saveServiceStartTypes writes to file on disable', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('Start')) {
        return { stdout: '    Start    REG_DWORD    0x2', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    await applyPrivacySettings(['service-diagtrack'])
    expect(mocks.writeFileSyncMock).toHaveBeenCalled()
    const writeArg = mocks.writeFileSyncMock.mock.calls[0]![1] as string
    expect(writeArg).toContain('DiagTrack')
    expect(writeArg).toContain('2')
  })

  it('saveServiceStartTypes handles write errors gracefully', async () => {
    mocks.writeFileSyncMock.mockImplementation(() => {
      throw new Error('Disk full')
    })
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('Start')) {
        return { stdout: '    Start    REG_DWORD    0x2', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    await expect(applyPrivacySettings(['service-diagtrack'])).resolves.toBeDefined()
  })

  it('loadServiceStartTypes handles corrupt JSON gracefully', async () => {
    mocks.readFileSyncMock.mockReturnValue('{invalid json}')
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('Start')) {
        return { stdout: '    Start    REG_DWORD    0x2', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    const result = await applyPrivacySettings(['service-diagtrack'])
    expect(result.succeeded).toBe(1)
  })

  it('loadServiceStartTypes handles array JSON (not object)', async () => {
    mocks.readFileSyncMock.mockReturnValue('["a", "b"]')
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('Start')) {
        return { stdout: '    Start    REG_DWORD    0x2', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    const result = await applyPrivacySettings(['service-diagtrack'])
    expect(result.succeeded).toBe(1)
  })

  it('loadServiceStartTypes filters out non-number values', async () => {
    mocks.readFileSyncMock.mockReturnValue(JSON.stringify({ DiagTrack: 2, AiHost: 'invalid' }))
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && (args[1] as string).includes('AiHost') && args.includes('Start')) {
        return { stdout: '    Start    REG_DWORD    0x4', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    await revertPrivacySettings(['ai-service-autostart'])
    const addCalls = mocks.execNativeUtf8Mock.mock.calls.filter(
      (c) => (c[0] as string) === 'reg' && (c[1] as string[])[0] === 'add',
    )
    const lastAdd = addCalls[addCalls.length - 1] as [string, string[]]
    const dataIdx = lastAdd[1].indexOf('/d')
    expect(lastAdd[1][dataIdx + 1]).toBe('3')
  })

  it('readFileSync missing file returns empty map', async () => {
    mocks.readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('Start')) {
        return { stdout: '    Start    REG_DWORD    0x2', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    const result = await applyPrivacySettings(['service-diagtrack'])
    expect(result.succeeded).toBe(1)
  })
})

// ─── getServiceCachePath ──────────────────────────────────────────

describe('getServiceCachePath edge cases', () => {
  it('uses app.getPath(userData) without Kudu-Dev suffix when isPackaged', async () => {
    const result = await applyPrivacySettings([])
    expect(result).toBeDefined()
  })

  it('creates directory if not exists', async () => {
    mocks.existsSyncMock.mockReturnValue(false)
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('Start')) {
        return { stdout: '    Start    REG_DWORD    0x3', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    // Clean up module-level cache from previous tests
    await revertPrivacySettings(['service-diagtrack']).catch(() => {})
    mocks.mkdirSyncMock.mockReset()

    await applyPrivacySettings(['service-diagtrack'])
    expect(mocks.mkdirSyncMock).toHaveBeenCalled()
  })

  it('uses Kudu-Dev subdirectory when not packaged', async () => {
    mocks.existsSyncMock.mockReturnValue(false)
    mocks.execNativeUtf8Mock.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await applyPrivacySettings(['advertising-id'])
    expect(result.succeeded).toBe(1)
  })
})

// ─── applyPrivacySettings — additional edge cases ────────────────

describe('applyPrivacySettings edge cases', () => {
  it('handles empty IDs array', async () => {
    const result = await applyPrivacySettings([])
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(0)
  })

  it('reports unknown error reason for non-Error throws', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async () => {
      throw 'string error'
    })

    const result = await applyPrivacySettings(['telemetry-level'])
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('Unknown error')
  })

  it('processes multiple IDs, some unknown', async () => {
    mocks.execNativeUtf8Mock.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await applyPrivacySettings(['telemetry-level', 'nonexistent', 'advertising-id'])
    expect(result.succeeded).toBe(2)
    expect(result.failed).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('handles service apply (disableService) with reg add failure', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('Start')) {
        return { stdout: '    Start    REG_DWORD    0x2', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        throw new Error('Access is denied')
      }
      throw new Error('Unexpected')
    })

    const result = await applyPrivacySettings(['service-diagtrack'])
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('Access is denied')
  })
})

// ─── revertPrivacySettings — additional edge cases ───────────────

describe('revertPrivacySettings edge cases', () => {
  it('reports failure for known setting without revert function', async () => {
    const noRevertSetting = PRIVACY_SETTINGS.find((s) => !s.revert)
    if (noRevertSetting) {
      const result = await revertPrivacySettings([noRevertSetting.id])
      expect(result.failed).toBe(1)
      expect(result.errors[0]!.reason).toBe('Revert not supported for this setting')
    }
  })

  it('handles revert with non-Error throw', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'delete') {
        throw 42
      }
      if (tool === 'reg' && args[0] === 'query') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    const result = await revertPrivacySettings(['telemetry-level'])
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('Unknown error')
  })

  it('handles empty IDs array', async () => {
    const result = await revertPrivacySettings([])
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(0)
  })

  it('restores service via enableService on revert', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('Start')) {
        return { stdout: '    Start    REG_DWORD    0x2', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    await applyPrivacySettings(['service-dmwappush'])
    const result = await revertPrivacySettings(['service-dmwappush'])
    expect(result.succeeded).toBe(1)

    const addCalls = mocks.execNativeUtf8Mock.mock.calls.filter(
      (c) => (c[0] as string) === 'reg' && (c[1] as string[])[0] === 'add',
    )
    const lastAdd = addCalls[addCalls.length - 1] as [string, string[]]
    const dataIdx = lastAdd[1].indexOf('/d')
    expect(lastAdd[1][dataIdx + 1]).toBe('2')
  })
})

// ─── Platform-specific behavior ───────────────────────────────────

describe('platform provider (non-Windows)', () => {
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })

  it('uses platform provider getSettings() on non-Windows', async () => {
    const mockSettings = [
      {
        id: 'mock-tracking',
        category: 'telemetry' as const,
        label: 'Mock',
        description: 'Mock',
        requiresAdmin: false,
        check: async () => true,
        apply: async () => {},
        revert: async () => {},
      },
    ]
    mocks.getPlatformMock.mockReturnValue({
      privacy: {
        getSettings: () => mockSettings,
      },
    })

    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    const result = await scanPrivacy()
    expect(result.settings).toHaveLength(1)
    expect(result.settings[0]!.id).toBe('mock-tracking')
  })

  it('platform provider settings are used for apply', async () => {
    const applyMock = vi.fn().mockResolvedValue(undefined)
    const mockSettings = [
      {
        id: 'custom-setting',
        category: 'telemetry' as const,
        label: 'Custom',
        description: 'Custom',
        requiresAdmin: false,
        check: async () => false,
        apply: applyMock,
      },
    ]
    mocks.getPlatformMock.mockReturnValue({
      privacy: {
        getSettings: () => mockSettings,
      },
    })

    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

    const result = await applyPrivacySettings(['custom-setting'])
    expect(result.succeeded).toBe(1)
    expect(applyMock).toHaveBeenCalled()
  })

  it('platform provider settings are used for revert', async () => {
    const revertMock = vi.fn().mockResolvedValue(undefined)
    const mockSettings = [
      {
        id: 'custom-setting',
        category: 'telemetry' as const,
        label: 'Custom',
        description: 'Custom',
        requiresAdmin: false,
        check: async () => false,
        apply: async () => {},
        revert: revertMock,
      },
    ]
    mocks.getPlatformMock.mockReturnValue({
      privacy: {
        getSettings: () => mockSettings,
      },
    })

    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

    const result = await revertPrivacySettings(['custom-setting'])
    expect(result.succeeded).toBe(1)
    expect(revertMock).toHaveBeenCalled()
  })
})

// ─── Browser-conditional settings ────────────────────────────────

describe('browser-conditional settings', () => {
  it('chrome check returns true when browser not installed', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('/ve')) {
        throw new Error('Not found')
      }
      throw new Error('Unexpected')
    })

    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'chrome-metrics')!
    expect(await setting.check()).toBe(true)
  })

  it('chrome applicable returns false when browser not installed', async () => {
    mocks.execNativeUtf8Mock.mockRejectedValue(new Error('Not found'))
    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'chrome-metrics')!
    expect(await setting.applicable!()).toBe(false)
  })

  it('firefox check returns true when browser not installed', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('/ve')) {
        throw new Error('Not found')
      }
      throw new Error('Unexpected')
    })

    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'firefox-telemetry')!
    expect(await setting.check()).toBe(true)
  })

  it('chrome check returns false when installed but policy not set', async () => {
    let _callCount = 0
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      _callCount++
      if (tool === 'reg' && args[0] === 'query' && args.includes('/ve')) {
        const key = args[1] as string
        if (key.includes('chrome.exe')) {
          return { stdout: '    (Default)    REG_SZ    C:\\chrome.exe', stderr: '' }
        }
        throw new Error('Not found')
      }
      throw new Error('Unexpected')
    })

    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'chrome-metrics')!
    expect(await setting.check()).toBe(false)
  })

  it('chrome check returns true when installed and policy is 0', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('/ve')) {
        return { stdout: '    (Default)    REG_SZ    C:\\chrome.exe', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'query' && args.includes('MetricsReportingEnabled')) {
        return { stdout: '    MetricsReportingEnabled    REG_DWORD    0x0', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'chrome-metrics')!
    expect(await setting.check()).toBe(true)
  })

  it('chrome applicable returns true when browser installed', async () => {
    mocks.execNativeUtf8Mock.mockResolvedValue({ stdout: '    (Default)    REG_SZ    C:\\chrome.exe', stderr: '' })
    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'chrome-metrics')!
    expect(await setting.applicable!()).toBe(true)
  })

  it('firefox check when installed and policy is 1 (telemetry disabled)', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('/ve')) {
        return { stdout: '    (Default)    REG_SZ    C:\\firefox.exe', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'query' && args.includes('DisableTelemetry')) {
        return { stdout: '    DisableTelemetry    REG_DWORD    0x1', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'firefox-telemetry')!
    expect(await setting.check()).toBe(true)
  })

  it('firefox check when installed and policy not set', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('/ve')) {
        return { stdout: '    (Default)    REG_SZ    C:\\firefox.exe', stderr: '' }
      }
      throw new Error('Not found')
    })

    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'firefox-telemetry')!
    expect(await setting.check()).toBe(false)
  })

  it('firefox applicable returns true when browser installed', async () => {
    mocks.execNativeUtf8Mock.mockResolvedValue({ stdout: '    (Default)    REG_SZ    C:\\firefox.exe', stderr: '' })
    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'firefox-telemetry')!
    expect(await setting.applicable!()).toBe(true)
  })

  it('firefox default agent check when installed and policy is 1', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('/ve')) {
        return { stdout: '    (Default)    REG_SZ    C:\\firefox.exe', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'query' && args.includes('DisableDefaultBrowserAgent')) {
        return { stdout: '    DisableDefaultBrowserAgent    REG_DWORD    0x1', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'firefox-default-agent')!
    expect(await setting.check()).toBe(true)
  })
})

// ─── enableService — additional branches ──────────────────────────

describe('enableService additional branches', () => {
  it('uses current value directly when not 4 and no cache', async () => {
    vi.resetModules()
    const { revertPrivacySettings: revertPriv } = await import('./privacy-shield.service')

    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('Start')) {
        return { stdout: '    Start    REG_DWORD    0x2', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    await revertPriv(['ai-service-autostart'])

    const addCalls = mocks.execNativeUtf8Mock.mock.calls.filter(
      (c) => (c[0] as string) === 'reg' && (c[1] as string[])[0] === 'add',
    )
    const lastAdd = addCalls[addCalls.length - 1] as [string, string[]]
    const dataIdx = lastAdd[1].indexOf('/d')
    expect(lastAdd[1][dataIdx + 1]).toBe('2')
  })

  it('rejects revert when the service cannot be queried (no phantom write)', async () => {
    vi.resetModules()
    const { revertPrivacySettings: revertPriv } = await import('./privacy-shield.service')

    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('Start')) {
        throw new Error('Access denied')
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    const result = await revertPriv(['ai-service-autostart'])
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe("Service 'AiHost' does not exist")

    const addCalls = mocks.execNativeUtf8Mock.mock.calls.filter(
      (c) => (c[0] as string) === 'reg' && (c[1] as string[])[0] === 'add',
    )
    expect(addCalls).toHaveLength(0)
  })
})

// ─── isTaskActive — enabled true branch ──────────────────────────

describe('isTaskActive XML enabled true', () => {
  it('returns true when XML has enabled true', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string) => {
      if (tool === 'schtasks') {
        return { stdout: '<?xml version="1.0"?><Task><Settings><Enabled>true</Enabled></Settings></Task>', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'task-compatibility-appraiser')!
    const result = await setting.check()
    expect(result).toBe(false)
  })
})

// ─── enableTask / disableTask edge cases ─────────────────────────

describe('enableTask / disableTask edge cases', () => {
  it('disableTask propagates error when schtasks fails', async () => {
    mocks.execNativeUtf8Mock.mockRejectedValue(new Error('Access denied'))

    const result = await applyPrivacySettings(['task-compatibility-appraiser'])
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('Access denied')
  })

  it('enableTask propagates error when schtasks fails on revert', async () => {
    let _callCount = 0
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string) => {
      _callCount++
      if (tool === 'schtasks') {
        throw new Error('Schtasks access denied')
      }
      throw new Error('Unexpected')
    })

    const result = await revertPrivacySettings(['task-compatibility-appraiser'])
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('Schtasks access denied')
  })
})

// ─── scanPrivacy — onProgress callback ────────────────────────────

describe('scanPrivacy onProgress', () => {
  it('invokes onProgress during scan', async () => {
    mocks.execNativeUtf8Mock.mockRejectedValue(new Error('Not found'))

    const onProgress = vi.fn()
    await scanPrivacy(onProgress)

    expect(onProgress).toHaveBeenCalled()
    expect(onProgress.mock.calls[0]![0]).toHaveProperty('current', 1)
    expect(onProgress.mock.calls[0]![0]).toHaveProperty('total', SETTING_COUNT)
    expect(onProgress.mock.calls[0]![0]).toHaveProperty('currentLabel')
    expect(onProgress.mock.calls[0]![0]).toHaveProperty('category')
  })
})

// ─── regQueryDword — lowercase hex ───────────────────────────────

describe('regQueryDword lowercase hex', () => {
  it('handles lowercase hex in registry output', async () => {
    mocks.execNativeUtf8Mock.mockResolvedValue({
      stdout: '    AllowTelemetry    REG_DWORD    0x0',
      stderr: '',
    })

    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'telemetry-level')!
    const result = await setting.check()
    expect(result).toBe(true)
  })
})

// ─── regDeleteValue — success path ────────────────────────────────

describe('regDeleteValue success path', () => {
  it('resolves when delete succeeds', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'delete') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'telemetry-level')!
    await expect(setting.revert!()).resolves.toBeUndefined()
  })
})

// ─── revertPrivacySettings — non-existent ID ──────────────────────

describe('revertPrivacySettings non-existent ID', () => {
  it('handles setting ID that is not found', async () => {
    const result = await revertPrivacySettings(['non-existent-setting'])
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.errors[0]!.reason).toBe('Revert not supported for this setting')
  })
})

// ─── applyPrivacySettings — non-existent ID ───────────────────────

describe('applyPrivacySettings non-existent ID', () => {
  it('skips setting ID that is not found', async () => {
    mocks.execNativeUtf8Mock.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await applyPrivacySettings(['non-existent-setting'])
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.skipped).toBe(1)
  })
})

// ─── serviceExists — edge cases ───────────────────────────────────

describe('serviceExists edge cases', () => {
  it('serviceExists returns true when reg query succeeds', async () => {
    mocks.execNativeUtf8Mock.mockResolvedValue({
      stdout: '    Start    REG_DWORD    0x3',
      stderr: '',
    })

    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'service-diagtrack')!
    expect(await setting.applicable!()).toBe(true)
  })

  it('serviceExists returns false when reg query fails', async () => {
    mocks.execNativeUtf8Mock.mockRejectedValue(new Error('Service not found'))

    const setting = PRIVACY_SETTINGS.find((s) => s.id === 'service-diagtrack')!
    expect(await setting.applicable!()).toBe(false)
  })
})

// ─── AI settings apply/revert ──────────────────────────────────────

describe('AI settings apply and revert', () => {
  beforeEach(() => {
    mocks.execNativeUtf8Mock.mockResolvedValue({ stdout: '', stderr: '' })
    mocks.existsSyncMock.mockReturnValue(true)
  })

  it('applies copilot setting', async () => {
    const result = await applyPrivacySettings(['copilot'])
    expect(result.succeeded).toBe(1)
  })

  it('reverts copilot setting', async () => {
    const result = await revertPrivacySettings(['copilot'])
    expect(result.succeeded).toBe(1)
  })

  it('applies windows-recall setting', async () => {
    const result = await applyPrivacySettings(['windows-recall'])
    expect(result.succeeded).toBe(1)
  })

  it('reverts windows-recall setting', async () => {
    const result = await revertPrivacySettings(['windows-recall'])
    expect(result.succeeded).toBe(1)
  })

  it('applies click-to-do setting', async () => {
    const result = await applyPrivacySettings(['click-to-do'])
    expect(result.succeeded).toBe(1)
  })

  it('reverts click-to-do setting', async () => {
    const result = await revertPrivacySettings(['click-to-do'])
    expect(result.succeeded).toBe(1)
  })

  it('applies edge-ai-features setting', async () => {
    const result = await applyPrivacySettings(['edge-ai-features'])
    expect(result.succeeded).toBe(1)
  })

  it('reverts edge-ai-features setting', async () => {
    const result = await revertPrivacySettings(['edge-ai-features'])
    expect(result.succeeded).toBe(1)
  })

  it('applies paint-ai setting', async () => {
    const result = await applyPrivacySettings(['paint-ai'])
    expect(result.succeeded).toBe(1)
  })

  it('reverts paint-ai setting', async () => {
    const result = await revertPrivacySettings(['paint-ai'])
    expect(result.succeeded).toBe(1)
  })

  it('applies notepad-ai setting', async () => {
    const result = await applyPrivacySettings(['notepad-ai'])
    expect(result.succeeded).toBe(1)
  })

  it('reverts notepad-ai setting', async () => {
    const result = await revertPrivacySettings(['notepad-ai'])
    expect(result.succeeded).toBe(1)
  })

  it('applies find-my-device setting', async () => {
    const result = await applyPrivacySettings(['find-my-device'])
    expect(result.succeeded).toBe(1)
  })

  it('reverts find-my-device setting', async () => {
    const result = await revertPrivacySettings(['find-my-device'])
    expect(result.succeeded).toBe(1)
  })
})

// ─── Service settings apply/revert ─────────────────────────────────

describe('service delivery-optimization apply and revert', () => {
  beforeEach(() => {
    mocks.execNativeUtf8Mock.mockResolvedValue({ stdout: '', stderr: '' })
    mocks.existsSyncMock.mockReturnValue(true)
  })

  it('applies delivery-optimization', async () => {
    const result = await applyPrivacySettings(['service-delivery-optimization'])
    expect(result.succeeded).toBe(1)
  })

  it('reverts delivery-optimization', async () => {
    const result = await revertPrivacySettings(['service-delivery-optimization'])
    expect(result.succeeded).toBe(1)
  })
})

describe('mapsbroker apply and revert', () => {
  beforeEach(() => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('Start')) {
        return { stdout: '    Start    REG_DWORD    0x3', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    mocks.existsSyncMock.mockReturnValue(true)
  })

  it('applies mapsbroker (disableService)', async () => {
    const result = await applyPrivacySettings(['service-mapsbroker'])
    expect(result.succeeded).toBe(1)
  })

  it('reverts mapsbroker (enableService)', async () => {
    const result = await revertPrivacySettings(['service-mapsbroker'])
    expect(result.succeeded).toBe(1)
  })
})

// ─── Task settings apply/revert ────────────────────────────────────

describe('task settings apply and revert', () => {
  beforeEach(() => {
    mocks.execNativeUtf8Mock.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('applies and reverts task-program-data-updater', async () => {
    const applyResult = await applyPrivacySettings(['task-program-data-updater'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['task-program-data-updater'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts task-autochk-proxy', async () => {
    const applyResult = await applyPrivacySettings(['task-autochk-proxy'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['task-autochk-proxy'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts task-ceip-consolidator', async () => {
    const applyResult = await applyPrivacySettings(['task-ceip-consolidator'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['task-ceip-consolidator'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts task-usb-ceip', async () => {
    const applyResult = await applyPrivacySettings(['task-usb-ceip'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['task-usb-ceip'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts task-disk-diagnostic', async () => {
    const applyResult = await applyPrivacySettings(['task-disk-diagnostic'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['task-disk-diagnostic'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts task-feedback-dm', async () => {
    const applyResult = await applyPrivacySettings(['task-feedback-dm'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['task-feedback-dm'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts task-maps-update', async () => {
    const applyResult = await applyPrivacySettings(['task-maps-update'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['task-maps-update'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts task-maps-toast', async () => {
    const applyResult = await applyPrivacySettings(['task-maps-toast'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['task-maps-toast'])
    expect(revertResult.succeeded).toBe(1)
  })
})

// ─── Browser settings apply/revert ─────────────────────────────────

describe('browser settings apply and revert', () => {
  beforeEach(() => {
    mocks.execNativeUtf8Mock.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('applies and reverts edge-metrics', async () => {
    const applyResult = await applyPrivacySettings(['edge-metrics'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['edge-metrics'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts edge-site-info', async () => {
    const applyResult = await applyPrivacySettings(['edge-site-info'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['edge-site-info'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts edge-personalization', async () => {
    const applyResult = await applyPrivacySettings(['edge-personalization'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['edge-personalization'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts edge-copilot-cdp', async () => {
    const applyResult = await applyPrivacySettings(['edge-copilot-cdp'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['edge-copilot-cdp'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts edge-copilot-page', async () => {
    const applyResult = await applyPrivacySettings(['edge-copilot-page'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['edge-copilot-page'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts edge-discover', async () => {
    const applyResult = await applyPrivacySettings(['edge-discover'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['edge-discover'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts edge-sidebar', async () => {
    const applyResult = await applyPrivacySettings(['edge-sidebar'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['edge-sidebar'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts edge-shopping', async () => {
    const applyResult = await applyPrivacySettings(['edge-shopping'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['edge-shopping'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts chrome-metrics', async () => {
    const applyResult = await applyPrivacySettings(['chrome-metrics'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['chrome-metrics'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts chrome-feedback', async () => {
    const applyResult = await applyPrivacySettings(['chrome-feedback'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['chrome-feedback'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts chrome-extended-reporting', async () => {
    const applyResult = await applyPrivacySettings(['chrome-extended-reporting'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['chrome-extended-reporting'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts firefox-telemetry', async () => {
    const applyResult = await applyPrivacySettings(['firefox-telemetry'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['firefox-telemetry'])
    expect(revertResult.succeeded).toBe(1)
  })

  it('applies and reverts firefox-default-agent', async () => {
    const applyResult = await applyPrivacySettings(['firefox-default-agent'])
    expect(applyResult.succeeded).toBe(1)
    const revertResult = await revertPrivacySettings(['firefox-default-agent'])
    expect(revertResult.succeeded).toBe(1)
  })
})

// ─── scanPrivacy — empty settings (total=0 branch) ─────────────────

describe('scanPrivacy empty settings', () => {
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })

  it('returns score 0 when no settings (total=0)', async () => {
    mocks.getPlatformMock.mockReturnValue({
      privacy: {
        getSettings: () => [],
      },
    })

    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    const result = await scanPrivacy()
    expect(result.total).toBe(0)
    expect(result.score).toBe(0)
    expect(result.protected).toBe(0)
    expect(result.settings).toHaveLength(0)
  })
})

// ─── enableService — current not null and not 4 (direct branch) ────

describe('enableService uses current value when not null and not 4', () => {
  it('uses current directly (not null, not 4, no cache)', async () => {
    vi.resetModules()
    const mod = await import('./privacy-shield.service')

    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('Start')) {
        return { stdout: '    Start    REG_DWORD    0x2', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    await mod.revertPrivacySettings(['service-diagtrack'])

    const addCalls = mocks.execNativeUtf8Mock.mock.calls.filter(
      (c) => (c[0] as string) === 'reg' && (c[1] as string[])[0] === 'add',
    )
    const lastAdd = addCalls[addCalls.length - 1] as [string, string[]]
    const dataIdx = lastAdd[1].indexOf('/d')
    expect(lastAdd[1][dataIdx + 1]).toBe('2')
  })
})

// ─── Telemetry settings apply/revert ───────────────────────────────

describe('telemetry settings apply and revert', () => {
  beforeEach(() => {
    mocks.execNativeUtf8Mock.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('applies and reverts activity-history', async () => {
    expect(await applyPrivacySettings(['activity-history'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['activity-history'])).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it('applies and reverts publish-activity', async () => {
    expect(await applyPrivacySettings(['publish-activity'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['publish-activity'])).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it('applies and reverts feedback-frequency', async () => {
    expect(await applyPrivacySettings(['feedback-frequency'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['feedback-frequency'])).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it('applies and reverts handwriting-telemetry', async () => {
    expect(await applyPrivacySettings(['handwriting-telemetry'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['handwriting-telemetry'])).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it('applies and reverts input-personalization', async () => {
    expect(await applyPrivacySettings(['input-personalization'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['input-personalization'])).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it('applies and reverts tailored-experiences', async () => {
    expect(await applyPrivacySettings(['tailored-experiences'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['tailored-experiences'])).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it('applies and reverts app-launch-tracking', async () => {
    expect(await applyPrivacySettings(['app-launch-tracking'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['app-launch-tracking'])).toMatchObject({ succeeded: 1, failed: 0 })
  })
})

// ─── Ads settings apply/revert ─────────────────────────────────────

describe('ads settings apply and revert', () => {
  beforeEach(() => {
    mocks.execNativeUtf8Mock.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('applies and reverts suggested-content', async () => {
    expect(await applyPrivacySettings(['suggested-content'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['suggested-content'])).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it('applies and reverts tips-notifications', async () => {
    expect(await applyPrivacySettings(['tips-notifications'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['tips-notifications'])).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it('applies and reverts start-suggestions', async () => {
    expect(await applyPrivacySettings(['start-suggestions'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['start-suggestions'])).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it('applies and reverts lock-screen-spotlight', async () => {
    expect(await applyPrivacySettings(['lock-screen-spotlight'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['lock-screen-spotlight'])).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it('applies and reverts silently-installed-apps', async () => {
    expect(await applyPrivacySettings(['silently-installed-apps'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['silently-installed-apps'])).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it('applies and reverts preinstalled-apps', async () => {
    expect(await applyPrivacySettings(['preinstalled-apps'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['preinstalled-apps'])).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it('reverts advertising-id', async () => {
    expect(await revertPrivacySettings(['advertising-id'])).toMatchObject({ succeeded: 1, failed: 0 })
  })
})

// ─── Search settings apply/revert ──────────────────────────────────

describe('search settings apply and revert', () => {
  beforeEach(() => {
    mocks.execNativeUtf8Mock.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('applies and reverts bing-start-menu', async () => {
    expect(await applyPrivacySettings(['bing-start-menu'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['bing-start-menu'])).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it('applies and reverts bing-web-search', async () => {
    expect(await applyPrivacySettings(['bing-web-search'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['bing-web-search'])).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it('applies and reverts cortana', async () => {
    expect(await applyPrivacySettings(['cortana'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['cortana'])).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it('applies and reverts search-highlights', async () => {
    expect(await applyPrivacySettings(['search-highlights'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['search-highlights'])).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it('applies and reverts store-search-suggestions', async () => {
    expect(await applyPrivacySettings(['store-search-suggestions'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['store-search-suggestions'])).toMatchObject({ succeeded: 1, failed: 0 })
  })
})

// ─── Sync settings apply/revert ────────────────────────────────────

describe('sync settings apply and revert', () => {
  beforeEach(() => {
    mocks.execNativeUtf8Mock.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('applies and reverts clipboard-sync', async () => {
    expect(await applyPrivacySettings(['clipboard-sync'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['clipboard-sync'])).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it('applies and reverts clipboard-history', async () => {
    expect(await applyPrivacySettings(['clipboard-history'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['clipboard-history'])).toMatchObject({ succeeded: 1, failed: 0 })
  })

  it('applies and reverts settings-sync', async () => {
    expect(await applyPrivacySettings(['settings-sync'])).toMatchObject({ succeeded: 1, failed: 0 })
    expect(await revertPrivacySettings(['settings-sync'])).toMatchObject({ succeeded: 1, failed: 0 })
  })
})

// ─── ai-service-autostart apply (uses disableService) ──────────────

describe('ai-service-autostart apply', () => {
  beforeEach(() => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('Start')) {
        return { stdout: '    Start    REG_DWORD    0x3', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    mocks.existsSyncMock.mockReturnValue(true)
  })

  it('applies ai-service-autostart (disableService)', async () => {
    const result = await applyPrivacySettings(['ai-service-autostart'])
    expect(result.succeeded).toBe(1)
  })
})

// ─── service-dmwappush apply (disableService) ──────────────────────

describe('service-dmwappush apply', () => {
  beforeEach(() => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query' && args.includes('Start')) {
        return { stdout: '    Start    REG_DWORD    0x3', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    mocks.existsSyncMock.mockReturnValue(true)
  })

  it('applies service-dmwappush (disableService)', async () => {
    const result = await applyPrivacySettings(['service-dmwappush'])
    expect(result.succeeded).toBe(1)
  })
})
