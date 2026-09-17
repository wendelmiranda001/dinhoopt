import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockHandle = vi.fn()
vi.mock('electron', () => {
  function MockNotification() {
    return { show: vi.fn() }
  }
  MockNotification.isSupported = vi.fn(() => false)
  return {
    ipcMain: { handle: (...args: unknown[]) => mockHandle(...args) },
    Notification: MockNotification,
  }
})

const mockScanDirectory = vi.fn()
const mockScanFile = vi.fn()
const mockScanMultipleDirectories = vi.fn()
const mockResolveChildSubdirs = vi.fn()
const mockCleanItems = vi.fn()
const mockScanWithFileMask = vi.fn()
vi.mock('../services/file-utils', () => ({
  scanDirectory: (...args: unknown[]) => mockScanDirectory(...args),
  scanFile: (...args: unknown[]) => mockScanFile(...args),
  scanMultipleDirectories: (...args: unknown[]) => mockScanMultipleDirectories(...args),
  resolveChildSubdirs: (...args: unknown[]) => mockResolveChildSubdirs(...args),
  cleanItems: (...args: unknown[]) => mockCleanItems(...args),
  scanWithFileMask: (...args: unknown[]) => mockScanWithFileMask(...args),
}))

const mockCacheItems = vi.fn()
vi.mock('../services/scan-cache', () => ({
  cacheItems: (...args: unknown[]) => mockCacheItems(...args),
}))

const mockIsAdmin = vi.fn()
vi.mock('../services/elevation', () => ({
  isAdmin: (...args: unknown[]) => mockIsAdmin(...args),
}))

const mockSystemCleanTargets = vi.fn()
const mockSingleFileCleanTargets = vi.fn()
const mockProtectedEventLogs = vi.fn()
vi.mock('../platform', () => ({
  getPlatform: () => ({
    paths: {
      systemCleanTargets: () => mockSystemCleanTargets(),
      singleFileCleanTargets: () => mockSingleFileCleanTargets(),
      protectedEventLogs: () => mockProtectedEventLogs(),
    },
  }),
}))

vi.mock('../services/ipc-validation', () => ({
  validateStringArray: (input: unknown) => {
    if (!Array.isArray(input)) return null
    if (!input.every((v: unknown) => typeof v === 'string')) return null
    return input as string[]
  },
}))

const mockGetImportedRules = vi.fn()
vi.mock('./winapp2-rules-store', () => ({
  getImportedRules: (...args: unknown[]) => mockGetImportedRules(...args),
}))

vi.mock('./sender-validation', () => ({
  validateSender: vi.fn(() => true),
}))

import { registerSystemCleanerIpc } from './system-cleaner.ipc'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

const mockSend = vi.fn()
function mockWindow() {
  return { isDestroyed: () => false, webContents: { send: mockSend } }
}

describe('registerSystemCleanerIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProtectedEventLogs.mockReturnValue([])
    mockGetImportedRules.mockReturnValue([])
    mockIsAdmin.mockReturnValue(true)
  })

  it('registers SYSTEM_SCAN and SYSTEM_CLEAN handlers', () => {
    registerSystemCleanerIpc(() => null)
    const channels = mockHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('cleaner:system:scan')
    expect(channels).toContain('cleaner:system:clean')
  })
})

describe('SYSTEM_SCAN handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProtectedEventLogs.mockReturnValue([])
    mockGetImportedRules.mockReturnValue([])
    mockIsAdmin.mockReturnValue(true)
  })

  it('returns empty results when no targets defined', async () => {
    mockSystemCleanTargets.mockReturnValue([])
    mockSingleFileCleanTargets.mockReturnValue([])
    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:scan')
    const results = await handler()
    expect(results).toEqual([])
  })

  it('scans each system target and caches items', async () => {
    mockSystemCleanTargets.mockReturnValue([
      { path: '/tmp/cache', subcategory: 'Temp Cache', needsAdmin: false, childSubdir: undefined },
      { path: '/tmp/logs', subcategory: 'Logs', needsAdmin: false, childSubdir: undefined },
    ])
    mockSingleFileCleanTargets.mockReturnValue([])
    mockScanDirectory.mockImplementation((_path: string, _cat: string, sub: string) =>
      Promise.resolve({
        category: 'system',
        subcategory: sub,
        items: sub === 'Logs' ? [] : [{ id: '1', path: '/tmp/cache/file', size: 500 }],
        totalSize: 500,
        itemCount: 1,
      }),
    )

    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:scan')
    const results = await handler()
    expect(results).toHaveLength(1)
    expect(mockCacheItems).toHaveBeenCalledTimes(1)
  })

  it('skips targets that require admin when not elevated', async () => {
    mockIsAdmin.mockReturnValue(false)
    mockSystemCleanTargets.mockReturnValue([
      { path: '/admin-only', subcategory: 'Admin Target', needsAdmin: true, childSubdir: undefined },
    ])
    mockSingleFileCleanTargets.mockReturnValue([])

    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:scan')
    const results = (await handler()) as Array<{ subcategory: string }>
    expect(results).toHaveLength(1)
    expect(results[0]!.subcategory).toBe('__elevation_required')
  })

  it('filters protected event log files', async () => {
    mockProtectedEventLogs.mockReturnValue(['protected.evtx'])
    mockSystemCleanTargets.mockReturnValue([
      { path: '/logs/event', subcategory: 'Event Log Archives', needsAdmin: false, childSubdir: undefined },
    ])
    mockSingleFileCleanTargets.mockReturnValue([])
    mockScanDirectory.mockResolvedValue({
      category: 'system',
      subcategory: 'Event Log Archives',
      items: [
        { id: '1', path: '/logs/event/protected.evtx', size: 1000 },
        { id: '2', path: '/logs/event/normal.evtx', size: 500 },
      ],
      totalSize: 1500,
      itemCount: 2,
    })

    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:scan')
    const results = (await handler()) as Array<{ items: Array<{ path: string }>; totalSize: number; itemCount: number }>
    expect(results).toHaveLength(1)
    expect(results[0]!.items).toHaveLength(1)
    expect(results[0]!.items[0]!.path).toContain('normal.evtx')
    expect(results[0]!.totalSize).toBe(500)
  })

  it('sends progress during scan', async () => {
    mockSystemCleanTargets.mockReturnValue([
      { path: '/tmp/test', subcategory: 'Test', needsAdmin: false, childSubdir: undefined },
    ])
    mockSingleFileCleanTargets.mockReturnValue([])
    mockScanDirectory.mockResolvedValue({
      category: 'system',
      subcategory: 'Test',
      items: [],
      totalSize: 0,
      itemCount: 0,
    })
    registerSystemCleanerIpc(() => mockWindow() as any)
    const handler = getHandler('cleaner:system:scan')
    await handler()
    expect(mockSend).toHaveBeenCalledWith(
      'scan:progress',
      expect.objectContaining({
        phase: 'scanning',
        category: 'system',
      }),
    )
  })

  it('scans single file targets', async () => {
    mockSystemCleanTargets.mockReturnValue([])
    mockSingleFileCleanTargets.mockReturnValue([
      { path: '/tmp/dump.dmp', subcategory: 'Memory Dumps', needsAdmin: false },
      { path: '/tmp/missing.dmp', subcategory: 'Missing Dumps', needsAdmin: false },
    ])
    mockScanFile
      .mockResolvedValueOnce({
        category: 'system',
        subcategory: 'Memory Dumps',
        items: [{ id: '1', path: '/tmp/dump.dmp', size: 100 }],
        totalSize: 100,
        itemCount: 1,
      })
      .mockRejectedValueOnce(new Error('Not found'))

    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:scan')
    const results = await handler()
    expect(results).toHaveLength(1)
  })

  it('skips single file target with empty items', async () => {
    mockSystemCleanTargets.mockReturnValue([])
    mockSingleFileCleanTargets.mockReturnValue([{ path: '/tmp/empty.dmp', subcategory: 'Empty', needsAdmin: false }])
    mockScanFile.mockResolvedValue({
      category: 'system',
      subcategory: 'Empty',
      items: [],
      totalSize: 0,
      itemCount: 0,
    })

    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:scan')
    const results = await handler()
    expect(results).toHaveLength(0)
  })

  it('scans target with childSubdir path', async () => {
    mockSystemCleanTargets.mockReturnValue([
      { path: '/tmp/parent', subcategory: 'Child Subdirs', needsAdmin: false, childSubdir: 'child' },
    ])
    mockSingleFileCleanTargets.mockReturnValue([])
    mockResolveChildSubdirs.mockResolvedValue(['/tmp/parent/child/a', '/tmp/parent/child/b'])
    mockScanMultipleDirectories.mockResolvedValue({
      category: 'system',
      subcategory: 'Child Subdirs',
      items: [{ id: '1', path: '/tmp/parent/child/a/file', size: 200 }],
      totalSize: 200,
      itemCount: 1,
    })

    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:scan')
    const results = await handler()
    expect(results).toHaveLength(1)
    expect(mockResolveChildSubdirs).toHaveBeenCalledWith(['/tmp/parent'], 'child')
    expect(mockScanMultipleDirectories).toHaveBeenCalled()
  })

  it('filters event log with empty filename after pop', async () => {
    mockProtectedEventLogs.mockReturnValue(['protected.evtx'])
    mockSystemCleanTargets.mockReturnValue([
      { path: '/logs/event', subcategory: 'Event Log Archives', needsAdmin: false, childSubdir: undefined },
    ])
    mockSingleFileCleanTargets.mockReturnValue([])
    mockScanDirectory.mockResolvedValue({
      category: 'system',
      subcategory: 'Event Log Archives',
      items: [
        { id: '1', path: '', size: 100 },
        { id: '2', path: '/logs/event/normal.evtx', size: 500 },
      ],
      totalSize: 600,
      itemCount: 2,
    })

    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:scan')
    const results = (await handler()) as Array<{ items: Array<{ path: string }>; totalSize: number; itemCount: number }>
    expect(results).toHaveLength(1)
    expect(results[0]!.items).toHaveLength(2)
    expect(results[0]!.items.some((i) => i.path.includes('normal.evtx'))).toBe(true)
  })

  it('scans winapp2 imported rules', async () => {
    mockSystemCleanTargets.mockReturnValue([])
    mockSingleFileCleanTargets.mockReturnValue([])
    mockGetImportedRules.mockReturnValue([
      { path: '${LOCALAPPDATA}\\Temp', fileMask: '*', recurse: true, subcategory: 'Winapp2 Temp' },
    ])
    mockScanWithFileMask.mockResolvedValue({
      category: 'system',
      subcategory: 'Winapp2 Temp',
      items: [{ id: 'w1', path: '/tmp/winapp2/file', size: 200 }],
      totalSize: 200,
      itemCount: 1,
    })

    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:scan')
    const results = await handler()
    expect(results).toHaveLength(1)
    expect(mockScanWithFileMask).toHaveBeenCalled()
  })

  it('skips winapp2 rule with empty items', async () => {
    mockSystemCleanTargets.mockReturnValue([])
    mockSingleFileCleanTargets.mockReturnValue([])
    mockGetImportedRules.mockReturnValue([
      { path: '${LOCALAPPDATA}\\Temp', fileMask: '*', recurse: true, subcategory: 'Winapp2 Empty' },
    ])
    mockScanWithFileMask.mockResolvedValue({
      category: 'system',
      subcategory: 'Winapp2 Empty',
      items: [],
      totalSize: 0,
      itemCount: 0,
    })

    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:scan')
    const results = await handler()
    expect(results).toHaveLength(0)
  })

  it('forwards removeSelf to scanWithFileMask', async () => {
    mockSystemCleanTargets.mockReturnValue([])
    mockSingleFileCleanTargets.mockReturnValue([])
    mockGetImportedRules.mockReturnValue([
      { path: '${APPDATA}\\Foo', fileMask: '*.*', recurse: false, subcategory: 'Foo', removeSelf: true },
    ])
    mockScanWithFileMask.mockResolvedValue({
      category: 'system',
      subcategory: 'Foo',
      items: [{ id: 'f1', path: '/tmp/foo', size: 50 }],
      totalSize: 50,
      itemCount: 1,
    })

    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:scan')
    await handler()
    expect(mockScanWithFileMask).toHaveBeenCalledWith(expect.any(String), '*.*', false, expect.any(String), 'Foo', true)
  })

  it('unselects items from rules with default=false', async () => {
    mockSystemCleanTargets.mockReturnValue([])
    mockSingleFileCleanTargets.mockReturnValue([])
    mockGetImportedRules.mockReturnValue([
      { path: '${LOCALAPPDATA}\\Temp', fileMask: '*', recurse: false, subcategory: 'Optional', default: false },
    ])
    mockScanWithFileMask.mockResolvedValue({
      category: 'system',
      subcategory: 'Optional',
      items: [
        { id: 'o1', path: '/tmp/optional/a', size: 100, selected: true },
        { id: 'o2', path: '/tmp/optional/b', size: 100, selected: true },
      ],
      totalSize: 200,
      itemCount: 2,
    })

    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:scan')
    const results = (await handler()) as Array<{ items: Array<{ selected: boolean }>; itemCount: number }>
    expect(results).toHaveLength(1)
    expect(results[0]!.items.every((i) => i.selected === false)).toBe(true)
    expect(results[0]!.itemCount).toBe(2)
  })
})

describe('SYSTEM_CLEAN handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects invalid input', async () => {
    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:clean')
    const result = (await handler({}, null)) as {
      totalCleaned: number
      filesDeleted: number
      filesSkipped: number
      errors: unknown[]
      needsElevation: boolean
    }
    expect(result).toEqual({
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    })
  })

  it('calls cleanItems with valid IDs and progress callback', async () => {
    mockCleanItems.mockResolvedValue({
      totalCleaned: 5000,
      filesDeleted: 10,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    })
    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:clean')
    const result = await handler({}, ['id-1', 'id-2'])
    expect(mockCleanItems).toHaveBeenCalledWith(['id-1', 'id-2'], expect.any(Function))
    expect((result as { filesDeleted: number }).filesDeleted).toBe(10)
  })

  it('does not send clean progress when window is null', async () => {
    mockCleanItems.mockImplementation(
      async (
        _ids: string[],
        onProgress: (processed: number, total: number, currentPath: string, cleanedSize: number) => void,
      ) => {
        onProgress(1, 2, '/path', 1024)
        return { totalCleaned: 1024, filesDeleted: 1, filesSkipped: 0, errors: [], needsElevation: false }
      },
    )

    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:clean')
    const result = await handler({}, ['id-1'])
    expect(result).toHaveProperty('filesDeleted', 1)
  })

  it('does not send clean progress when window is destroyed', async () => {
    const destroyedWindow = { isDestroyed: () => true, webContents: { send: vi.fn() } }
    mockCleanItems.mockImplementation(
      async (
        _ids: string[],
        onProgress: (processed: number, total: number, currentPath: string, cleanedSize: number) => void,
      ) => {
        onProgress(1, 2, '/path', 1024)
        return { totalCleaned: 1024, filesDeleted: 1, filesSkipped: 0, errors: [], needsElevation: false }
      },
    )

    registerSystemCleanerIpc(() => destroyedWindow as never)
    const handler = getHandler('cleaner:system:clean')
    const result = await handler({}, ['id-1'])
    expect(result).toHaveProperty('filesDeleted', 1)
  })
})
