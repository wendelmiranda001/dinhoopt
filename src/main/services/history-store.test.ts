import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  send: vi.fn(),
  getAllWindows: vi.fn(),
  storeLoad: vi.fn(),
  storeSave: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mocks.existsSync(...args),
  readFileSync: (...args: unknown[]) => mocks.readFileSync(...args),
  writeFileSync: (...args: unknown[]) => mocks.writeFileSync(...args),
  mkdirSync: (...args: unknown[]) => mocks.mkdirSync(...args),
}))

vi.mock('node:path', () => ({
  join: (...args: string[]) => args.join('/'),
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/fake/userdata',
  },
  BrowserWindow: {
    getAllWindows: (...args: unknown[]) => mocks.getAllWindows(...args),
  },
}))

vi.mock('./store-base', () => ({
  createJsonStore: () => ({
    load: (...args: unknown[]) => mocks.storeLoad(...args),
    save: (...args: unknown[]) => mocks.storeSave(...args),
    update: vi.fn(),
    path: '/fake/store.json',
    resetCache: vi.fn(),
  }),
}))

import type { ScanHistoryEntry } from '@shared/types'
import { addHistoryEntry, clearHistory, getHistory } from './history-store'

const SAMPLE_ENTRY: ScanHistoryEntry = {
  id: 'test-1',
  type: 'cleaner',
  timestamp: new Date().toISOString(),
  duration: 1500,
  totalItemsFound: 12,
  totalItemsCleaned: 10,
  totalItemsSkipped: 2,
  totalSpaceSaved: 100 * 1024 * 1024,
  categories: [],
  errorCount: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: store file doesn't exist yet
  mocks.existsSync.mockReturnValue(false)
  mocks.getAllWindows.mockReturnValue([])
  mocks.storeLoad.mockReturnValue([])
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('getHistory', () => {
  it('returns empty array when file does not exist', () => {
    const history = getHistory()
    expect(history).toEqual([])
  })

  it('returns parsed history when file exists', () => {
    mocks.storeLoad.mockReturnValue([SAMPLE_ENTRY])
    const history = getHistory()
    expect(history).toHaveLength(1)
    expect(history[0]!.id).toBe('test-1')
  })

  it('returns empty array on parse error', () => {
    mocks.storeLoad.mockImplementation(() => {
      throw new Error('parse error')
    })
    const history = getHistory()
    expect(history).toEqual([])
  })

  it('returns empty array for non-array data', () => {
    mocks.storeLoad.mockReturnValue({ some: 'object' })
    const history = getHistory()
    expect(history).toEqual([])
  })
})

describe('addHistoryEntry', () => {
  it('prepends entry to history and sends IPC', async () => {
    mocks.storeLoad.mockReturnValue([])
    mocks.getAllWindows.mockReturnValue([{ isDestroyed: () => false, webContents: { send: mocks.send } }])

    addHistoryEntry(SAMPLE_ENTRY)

    // Wait for the write lock chain to resolve
    await vi.waitFor(
      () => {
        expect(mocks.storeSave).toHaveBeenCalled()
      },
      { timeout: 3000, interval: 50 },
    )

    // Verify the written data
    const saveCall = mocks.storeSave.mock.calls[0]
    expect(saveCall).toBeDefined()
    const written = saveCall![0] as ScanHistoryEntry[]
    expect(written).toHaveLength(1)
    expect(written[0]!.id).toBe('test-1')

    // Verify IPC sent
    expect(mocks.send).toHaveBeenCalledWith('history:changed')
  })

  it('limits history to 100 entries', async () => {
    const existing = Array.from({ length: 100 }, (_, i) => ({
      ...SAMPLE_ENTRY,
      id: `old-${i}`,
    }))
    mocks.storeLoad.mockReturnValue(existing)
    mocks.getAllWindows.mockReturnValue([{ isDestroyed: () => false, webContents: { send: mocks.send } }])

    addHistoryEntry(SAMPLE_ENTRY)

    await vi.waitFor(
      () => {
        expect(mocks.storeSave).toHaveBeenCalled()
      },
      { timeout: 3000, interval: 50 },
    )

    const saveCall = mocks.storeSave.mock.calls[0]
    const written = saveCall![0] as ScanHistoryEntry[]
    expect(written).toHaveLength(100)
    expect(written[0]!.id).toBe('test-1')
  })

  it('handles missing window gracefully', async () => {
    mocks.storeLoad.mockReturnValue([])
    mocks.getAllWindows.mockReturnValue([])

    addHistoryEntry(SAMPLE_ENTRY)

    // Should still write, even without windows
    await vi.waitFor(
      () => {
        expect(mocks.storeSave).toHaveBeenCalled()
      },
      { timeout: 3000, interval: 50 },
    )
  })
})

describe('clearHistory', () => {
  it('writes empty array', async () => {
    clearHistory()
    await vi.waitFor(
      () => {
        expect(mocks.storeSave).toHaveBeenCalledWith([])
      },
      { timeout: 3000, interval: 50 },
    )
  })
})
