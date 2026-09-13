import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  httpsGet: vi.fn(),
  logger: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock('fs', () => ({
  readFileSync: (...args: unknown[]) => mocks.readFileSync(...args),
  writeFileSync: (...args: unknown[]) => mocks.writeFileSync(...args),
  existsSync: (...args: unknown[]) => mocks.existsSync(...args),
  mkdirSync: (...args: unknown[]) => mocks.mkdirSync(...args),
}))

vi.mock('https', () => ({
  get: (...args: unknown[]) => mocks.httpsGet(...args),
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

const TEST_CACHE_DIR = 'C:\\tmp\\dinho-test'

import {
  clearImportedRules,
  downloadAndCacheRules,
  ensureRulesLoaded,
  getCachedRulesCount,
  getImportedRules,
  initRulesStore,
  loadCachedRules,
  setImportedRules,
} from './winapp2-rules-store'

describe('winapp2-rules-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.existsSync.mockReturnValue(true)
    initRulesStore(TEST_CACHE_DIR)
    clearImportedRules()
  })

  it('starts empty after clear', () => {
    expect(getImportedRules()).toEqual([])
  })

  it('stores rules in memory', () => {
    setImportedRules([{ subcategory: 'Test', path: 'C:\\temp', fileMask: '*.log', recurse: true, removeSelf: false }])
    expect(getImportedRules()).toHaveLength(1)
    expect(getImportedRules()[0]!.subcategory).toBe('Test')
  })

  it('persists rules to disk on set', () => {
    setImportedRules([{ subcategory: 'A', path: 'C:\\a', fileMask: '*.*', recurse: false, removeSelf: false }])
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      `${TEST_CACHE_DIR}\\winapp2-rules.json`,
      expect.any(String),
      'utf-8',
    )
    const lastCall = mocks.writeFileSync.mock.calls.at(-1) as [string, string, string]
    const written = JSON.parse(lastCall[1])
    expect(written).toHaveLength(1)
    expect(written[0]!.subcategory).toBe('A')
  })

  it('replaces rules on second set', () => {
    setImportedRules([{ subcategory: 'A', path: 'C:\\a', fileMask: '*.*', recurse: false, removeSelf: false }])
    setImportedRules([{ subcategory: 'B', path: 'C:\\b', fileMask: '*.tmp', recurse: true, removeSelf: true }])
    expect(getImportedRules()).toHaveLength(1)
    expect(getImportedRules()[0]!.subcategory).toBe('B')
  })

  it('clear resets to empty and clears disk cache', () => {
    setImportedRules([{ subcategory: 'Test', path: 'C:\\test', fileMask: '*.*', recurse: false, removeSelf: false }])
    clearImportedRules()
    expect(getImportedRules()).toEqual([])
    expect(mocks.writeFileSync).toHaveBeenCalledWith(`${TEST_CACHE_DIR}\\winapp2-rules.json`, '[]', 'utf-8')
  })

  it('loadCachedRules loads rules from disk', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue(
      JSON.stringify([{ subcategory: 'Disk', path: 'C:\\disk', fileMask: '*.tmp', recurse: false, removeSelf: false }]),
    )
    const loaded = loadCachedRules()
    expect(loaded).toBe(true)
    expect(getImportedRules()).toHaveLength(1)
    expect(getImportedRules()[0]!.subcategory).toBe('Disk')
  })

  it('loadCachedRules returns false when no cache file', () => {
    mocks.existsSync.mockReturnValue(false)
    const loaded = loadCachedRules()
    expect(loaded).toBe(false)
  })

  it('returns count via getCachedRulesCount', () => {
    expect(getCachedRulesCount()).toBe(0)
    setImportedRules([{ subcategory: 'X', path: 'C:\\x', fileMask: '*.log', recurse: false, removeSelf: false }])
    expect(getCachedRulesCount()).toBe(1)
  })

  describe('downloadAndCacheRules', () => {
    it('downloads, parses, caches rules', async () => {
      const content =
        '[Section1]\r\nFileKey1=%Temp%\\a|*.*|RECURSE\r\nFileKey2=%AppData%\\b|*.log\r\n\r\n[Section2]\r\nFileKey1=%WinDir%\\c|*.tmp\r\n'
      const dataListeners: Record<string, (chunk?: Buffer) => void> = {}
      mocks.httpsGet.mockImplementation((_url: string, cb: (res: unknown) => void) => {
        cb({
          statusCode: 200,
          on: (ev: string, fn: (chunk?: Buffer) => void) => {
            dataListeners[ev] = fn
          },
        })
        return { on: vi.fn() }
      })

      const promise = downloadAndCacheRules()
      dataListeners.data?.(Buffer.from(content))
      dataListeners.end?.()
      const count = await promise

      expect(count).toBe(3)
      expect(getImportedRules()).toHaveLength(3)
      expect(getImportedRules()[0]!.subcategory).toBe('Section1')
      expect(mocks.writeFileSync).toHaveBeenCalled()
    })

    it('throws on HTTP error', async () => {
      mocks.httpsGet.mockImplementation((_url: string, cb: (res: unknown) => void) => {
        cb({ statusCode: 500, on: vi.fn() })
        return { on: vi.fn() }
      })
      await expect(downloadAndCacheRules()).rejects.toThrow('HTTP 500')
    })

    it('rejects and destroys the response when the stream errors mid-body', async () => {
      const resDestroy = vi.fn()
      mocks.httpsGet.mockImplementation((_url: string, cb: (res: unknown) => void) => {
        cb({
          statusCode: 200,
          on: (ev: string, fn: (err: Error) => void) => {
            if (ev === 'error') fn(new Error('stream reset'))
          },
          destroy: resDestroy,
        })
        return { on: vi.fn() }
      })
      await expect(downloadAndCacheRules()).rejects.toThrow('stream reset')
      expect(resDestroy).toHaveBeenCalled()
    })

    it('rejects and destroys the request when the download exceeds the timeout', async () => {
      const reqDestroy = vi.fn()
      vi.useFakeTimers()
      try {
        mocks.httpsGet.mockImplementation((_url: string, cb: (res: unknown) => void) => {
          cb({ statusCode: 200, on: vi.fn() })
          return { on: vi.fn(), destroy: reqDestroy }
        })
        const promise = downloadAndCacheRules()
        const assertion = expect(promise).rejects.toThrow('download timeout')
        vi.advanceTimersByTime(31_000)
        await assertion
        expect(reqDestroy).toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('propagates section warning/default flags to rules', async () => {
      const content =
        '[WarningSection]\r\nWarn=True\r\nFileKey1=%Temp%\\a|*.*|RECURSE\r\n\r\n[OptOutSection]\r\nDefault=False\r\nFileKey1=%Temp%\\b|*.log\r\n'
      const dataListeners: Record<string, (chunk?: Buffer) => void> = {}
      mocks.httpsGet.mockImplementation((_url: string, cb: (res: unknown) => void) => {
        cb({
          statusCode: 200,
          on: (ev: string, fn: (chunk?: Buffer) => void) => {
            dataListeners[ev] = fn
          },
        })
        return { on: vi.fn() }
      })

      const promise = downloadAndCacheRules()
      dataListeners.data?.(Buffer.from(content))
      dataListeners.end?.()
      await promise

      const all = getImportedRules()
      expect(all).toHaveLength(2)
      expect(all[0]!.subcategory).toBe('WarningSection')
      expect(all[0]!.warning).toBe(true)
      expect(all[1]!.subcategory).toBe('OptOutSection')
      expect(all[1]!.default).toBe(false)
    })
  })

  describe('ensureRulesLoaded', () => {
    it('loads cached rules when valid', async () => {
      mocks.existsSync.mockReturnValue(true)
      mocks.readFileSync.mockReturnValue(
        JSON.stringify([{ subcategory: 'Cached', path: 'C:\\x', fileMask: '*.*', recurse: false, removeSelf: false }]),
      )
      await ensureRulesLoaded(TEST_CACHE_DIR)
      expect(getImportedRules()).toHaveLength(1)
      expect(getImportedRules()[0]!.subcategory).toBe('Cached')
      expect(mocks.httpsGet).not.toHaveBeenCalled()
    })

    it('downloads when cache is empty', async () => {
      mocks.existsSync.mockReturnValue(false)
      const content = '[Test]\r\nFileKey1=%Temp%\\a|*.*\r\n'
      const dataListeners: Record<string, (chunk?: Buffer) => void> = {}
      mocks.httpsGet.mockImplementation((_url: string, cb: (res: unknown) => void) => {
        cb({
          statusCode: 200,
          on: (ev: string, fn: (chunk?: Buffer) => void) => {
            dataListeners[ev] = fn
          },
        })
        return { on: vi.fn() }
      })

      const promise = ensureRulesLoaded(TEST_CACHE_DIR)
      dataListeners.data?.(Buffer.from(content))
      dataListeners.end?.()
      await promise

      expect(getImportedRules()).toHaveLength(1)
      expect(getImportedRules()[0]!.subcategory).toBe('Test')
    })
  })
})
