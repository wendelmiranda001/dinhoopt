import type { RegistryEntry } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectBackupTargets, fixRegistryEntries, registerRegistryCleanerIpc, scanRegistry } from './handlers'

const mockState = {
  scanAbort: null as AbortController | null,
  fixAbort: null as AbortController | null,
  scanSessions: new Map<string, Map<string, RegistryEntry>>(),
}

vi.mock('./state', () => ({
  get state() {
    return mockState
  },
  cleanupScanSessions: vi.fn(),
}))

const {
  mockGetLogger,
  mockScanRegistry,
  mockFixRegistryEntries,
  mockCollectBackupTargets,
  mockValidateStringArray,
  mockGetSettings,
  mockUpdateRegistryIgnoredTweaks,
  mockApplyIgnoredTweaks,
} = vi.hoisted(() => {
  const loggerInstance = {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  }
  return {
    mockGetLogger: vi.fn(() => loggerInstance),
    loggerInstance,
    mockScanRegistry: vi.fn(),
    mockFixRegistryEntries: vi.fn(),
    mockCollectBackupTargets: vi.fn(),
    mockValidateStringArray: vi.fn(),
    mockGetSettings: vi.fn(),
    mockUpdateRegistryIgnoredTweaks: vi.fn(),
    mockApplyIgnoredTweaks: vi.fn(),
  }
})

const mockHandlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockHandlers.set(channel, handler)
    }),
  },
}))

vi.mock('../../services/ipc-validation', () => ({
  validateStringArray: (...args: unknown[]) => mockValidateStringArray(...args),
}))

vi.mock('../../services/logger.service', () => ({
  getLogger: () => mockGetLogger(),
}))

vi.mock('../../services/registry-cleaner.service', () => ({
  scanRegistry: (...args: unknown[]) => mockScanRegistry(...args),
  fixRegistryEntries: (...args: unknown[]) => mockFixRegistryEntries(...args),
  collectBackupTargets: (...args: unknown[]) => mockCollectBackupTargets(...args),
}))

vi.mock('../../services/settings-store', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  updateRegistryIgnoredTweaks: (...args: unknown[]) => mockUpdateRegistryIgnoredTweaks(...args),
}))

vi.mock('../sender-validation', () => ({
  validateSender: vi.fn(() => true),
}))

vi.mock('@shared/registry-tweaks', () => ({
  applyIgnoredTweaks: (...args: unknown[]) => mockApplyIgnoredTweaks(...args),
}))

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid'),
}))

const loggerInstance = (mockGetLogger as ReturnType<typeof vi.fn>).mock.results[0]?.value ?? mockGetLogger()

let savedPlatform: string

function callHandler<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = mockHandlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  return handler({}, ...args) as Promise<T>
}

const mockEntry: RegistryEntry = {
  id: 'test-entry-1',
  type: 'obsolete',
  keyPath: 'HKLM\\SOFTWARE\\Test',
  valueName: 'TestKey',
  issue: 'Test entry',
  risk: 'low',
  selected: false,
}

describe('registry-cleaner/handlers.ts — registerRegistryCleanerIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandlers.clear()
    savedPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

    mockState.scanAbort = null
    mockState.fixAbort = null
    mockState.scanSessions.clear()

    registerRegistryCleanerIpc(vi.fn())
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: savedPlatform, configurable: true })
  })

  describe('REGISTRY_SCAN', () => {
    it('returns empty on non-win32', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      const result = await callHandler<RegistryEntry[]>('cleaner:registry:scan')
      expect(result).toEqual([])
      expect(loggerInstance.warning).toHaveBeenCalledWith('registry-cleaner', 'Registry scan skipped — not Windows')
    })

    it('returns entries on successful scan', async () => {
      mockScanRegistry.mockResolvedValue([mockEntry])
      mockGetSettings.mockReturnValue({ registryIgnoredTweaks: [] })
      const result = await callHandler<RegistryEntry[]>('cleaner:registry:scan')
      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe('test-entry-1')
    })

    it('applies ignored tweaks after scan', async () => {
      mockScanRegistry.mockResolvedValue([mockEntry])
      mockGetSettings.mockReturnValue({ registryIgnoredTweaks: ['sig1'] })
      await callHandler<RegistryEntry[]>('cleaner:registry:scan')
      expect(mockApplyIgnoredTweaks).toHaveBeenCalledWith([mockEntry], ['sig1'])
    })

    it('handles empty registryIgnoredTweaks', async () => {
      mockScanRegistry.mockResolvedValue([])
      mockGetSettings.mockReturnValue({})
      await callHandler<RegistryEntry[]>('cleaner:registry:scan')
      expect(mockApplyIgnoredTweaks).toHaveBeenCalledWith([], [])
    })

    it('stores scan results in session', async () => {
      mockScanRegistry.mockResolvedValue([mockEntry])
      mockGetSettings.mockReturnValue({ registryIgnoredTweaks: [] })
      await callHandler<RegistryEntry[]>('cleaner:registry:scan')
      expect(mockState.scanSessions.size).toBe(1)
    })

    it('cancels previous scan before starting new one', async () => {
      const abortCtrl = new AbortController()
      mockState.scanAbort = abortCtrl
      const abortSpy = vi.spyOn(abortCtrl, 'abort')

      mockScanRegistry.mockResolvedValue([])
      mockGetSettings.mockReturnValue({ registryIgnoredTweaks: [] })
      await callHandler<RegistryEntry[]>('cleaner:registry:scan')
      expect(abortSpy).toHaveBeenCalled()
    })

    it('returns empty on scan abort', async () => {
      mockScanRegistry.mockImplementation(async () => {
        mockState.scanAbort?.abort()
        throw new DOMException('The operation was aborted', 'AbortError')
      })

      const result = await callHandler<RegistryEntry[]>('cleaner:registry:scan')
      expect(result).toEqual([])
      expect(loggerInstance.info).toHaveBeenCalledWith('registry-cleaner', 'Registry scan cancelled')
    })

    it('throws non-abort errors', async () => {
      mockScanRegistry.mockRejectedValue(new Error('real error'))
      mockGetSettings.mockReturnValue({ registryIgnoredTweaks: [] })

      await expect(callHandler<RegistryEntry[]>('cleaner:registry:scan')).rejects.toThrow('real error')
      expect(loggerInstance.error).toHaveBeenCalledWith('registry-cleaner', 'Registry scan failed: real error')
    })

    it('handles non-Error thrown values', async () => {
      mockScanRegistry.mockRejectedValue('string error')
      mockGetSettings.mockReturnValue({ registryIgnoredTweaks: [] })

      await expect(callHandler<RegistryEntry[]>('cleaner:registry:scan')).rejects.toBe('string error')
      expect(loggerInstance.error).toHaveBeenCalledWith('registry-cleaner', 'Registry scan failed: Unknown error')
    })

    it('clears scanAbort in finally block', async () => {
      mockScanRegistry.mockResolvedValue([])
      mockGetSettings.mockReturnValue({ registryIgnoredTweaks: [] })
      await callHandler<RegistryEntry[]>('cleaner:registry:scan')
      expect(mockState.scanAbort).toBeNull()
    })

    it('clears scanAbort on error in finally', async () => {
      mockScanRegistry.mockRejectedValue(new Error('fail'))
      mockGetSettings.mockReturnValue({ registryIgnoredTweaks: [] })
      await expect(callHandler<RegistryEntry[]>('cleaner:registry:scan')).rejects.toThrow()
      expect(mockState.scanAbort).toBeNull()
    })

    it('limits scan sessions to max 4', async () => {
      mockScanRegistry.mockResolvedValue([])
      mockGetSettings.mockReturnValue({ registryIgnoredTweaks: [] })

      for (let i = 0; i < 6; i++) {
        await callHandler<RegistryEntry[]>('cleaner:registry:scan')
      }
      expect(mockState.scanSessions.size).toBeLessThanOrEqual(4)
    })
  })

  describe('REGISTRY_FIX', () => {
    it('returns zeros on non-win32', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      const result = await callHandler<{
        fixed: number
        failed: number
        failures: { issue: string; reason: string }[]
      }>('cleaner:registry:fix', ['id1'])
      expect(result).toEqual({ fixed: 0, failed: 0, failures: [] })
    })

    it('returns zeros when validation fails', async () => {
      mockValidateStringArray.mockReturnValue(null)
      const result = await callHandler<{
        fixed: number
        failed: number
        failures: { issue: string; reason: string }[]
      }>('cleaner:registry:fix', [123])
      expect(result).toEqual({ fixed: 0, failed: 0, failures: [] })
    })

    it('fixes entries successfully', async () => {
      mockValidateStringArray.mockReturnValue(['test-entry-1'])
      mockFixRegistryEntries.mockResolvedValue({ fixed: 1, failed: 0, failures: [] })

      const sessionMap = new Map<string, RegistryEntry>()
      sessionMap.set('test-entry-1', mockEntry)
      mockState.scanSessions.set('session-1', sessionMap)

      const result = await callHandler<{
        fixed: number
        failed: number
        failures: { issue: string; reason: string }[]
      }>('cleaner:registry:fix', ['test-entry-1'])
      expect(result.fixed).toBe(1)
      expect(result.failed).toBe(0)
    })

    it('reports fix failures', async () => {
      mockValidateStringArray.mockReturnValue(['test-entry-1'])
      mockFixRegistryEntries.mockResolvedValue({
        fixed: 0,
        failed: 1,
        failures: [{ issue: 'test-entry-1', reason: 'Access denied' }],
      })

      const sessionMap = new Map<string, RegistryEntry>()
      sessionMap.set('test-entry-1', mockEntry)
      mockState.scanSessions.set('session-1', sessionMap)

      const result = await callHandler<{
        fixed: number
        failed: number
        failures: { issue: string; reason: string }[]
      }>('cleaner:registry:fix', ['test-entry-1'])
      expect(result.failed).toBe(1)
    })

    it('returns empty results when entry IDs not found in any session', async () => {
      mockValidateStringArray.mockReturnValue(['nonexistent-id'])
      mockFixRegistryEntries.mockResolvedValue({ fixed: 0, failed: 0, failures: [] })

      const result = await callHandler<{
        fixed: number
        failed: number
        failures: { issue: string; reason: string }[]
      }>('cleaner:registry:fix', ['nonexistent-id'])
      expect(result).toEqual({ fixed: 0, failed: 0, failures: [] })
      expect(mockFixRegistryEntries).toHaveBeenCalledWith([], expect.any(Function), expect.anything())
    })

    it('sends progress to window during fix', async () => {
      mockValidateStringArray.mockReturnValue(['test-entry-1'])
      mockFixRegistryEntries.mockImplementation(
        async (_entries: unknown, onProgress: (c: number, t: number, e: string) => void) => {
          onProgress(1, 1, 'Test Entry')
          return { fixed: 1, failed: 0, failures: [] }
        },
      )

      const sessionMap = new Map<string, RegistryEntry>()
      sessionMap.set('test-entry-1', mockEntry)
      mockState.scanSessions.set('session-1', sessionMap)

      const mockWin = {
        webContents: { send: vi.fn() },
        isDestroyed: vi.fn().mockReturnValue(false),
      } as unknown as BrowserWindow
      mockHandlers.clear()
      registerRegistryCleanerIpc(() => mockWin)

      await callHandler<{ fixed: number; failed: number; failures: { issue: string; reason: string }[] }>(
        'cleaner:registry:fix',
        ['test-entry-1'],
      )
      expect(mockWin.webContents.send).toHaveBeenCalledWith(
        'registry:fix:progress',
        expect.objectContaining({ current: 1, total: 1 }),
      )
    })

    it('skips sending progress when window is destroyed', async () => {
      mockValidateStringArray.mockReturnValue(['test-entry-1'])
      mockFixRegistryEntries.mockImplementation(
        async (_entries: unknown, onProgress: (c: number, t: number, e: string) => void) => {
          onProgress(1, 1, 'Test')
          return { fixed: 1, failed: 0, failures: [] }
        },
      )

      const sessionMap = new Map<string, RegistryEntry>()
      sessionMap.set('test-entry-1', mockEntry)
      mockState.scanSessions.set('s', sessionMap)

      const mockWin = {
        webContents: { send: vi.fn() },
        isDestroyed: vi.fn().mockReturnValue(true),
      } as unknown as BrowserWindow
      mockHandlers.clear()
      registerRegistryCleanerIpc(() => mockWin)

      await callHandler<{ fixed: number; failed: number; failures: { issue: string; reason: string }[] }>(
        'cleaner:registry:fix',
        ['test-entry-1'],
      )
      expect(mockWin.webContents.send).not.toHaveBeenCalled()
    })

    it('cancels previous fix before starting new one', async () => {
      const abortCtrl = new AbortController()
      mockState.fixAbort = abortCtrl
      const abortSpy = vi.spyOn(abortCtrl, 'abort')

      mockValidateStringArray.mockReturnValue([])
      mockFixRegistryEntries.mockResolvedValue({ fixed: 0, failed: 0, failures: [] })

      await callHandler<{ fixed: number; failed: number; failures: { issue: string; reason: string }[] }>(
        'cleaner:registry:fix',
        [],
      )
      expect(abortSpy).toHaveBeenCalled()
    })

    it('returns cancelled result on abort during fix', async () => {
      mockValidateStringArray.mockReturnValue(['test-entry-1'])

      const sessionMap = new Map<string, RegistryEntry>()
      sessionMap.set('test-entry-1', mockEntry)
      mockState.scanSessions.set('s', sessionMap)

      mockFixRegistryEntries.mockImplementation(
        async (_entries: unknown, _onProgress: unknown, _signal: AbortSignal) => {
          mockState.fixAbort?.abort()
          throw new DOMException('aborted', 'AbortError')
        },
      )

      const result = await callHandler<{
        fixed: number
        failed: number
        failures: { issue: string; reason: string }[]
      }>('cleaner:registry:fix', ['test-entry-1'])
      expect(result.fixed).toBe(0)
      expect(result.failed).toBe(0)
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0]!.issue).toBe('Cancelled')
    })

    it('throws non-abort fix errors', async () => {
      mockValidateStringArray.mockReturnValue(['test-entry-1'])
      mockFixRegistryEntries.mockRejectedValue(new Error('fix error'))

      const sessionMap = new Map<string, RegistryEntry>()
      sessionMap.set('test-entry-1', mockEntry)
      mockState.scanSessions.set('s', sessionMap)

      await expect(
        callHandler<{ fixed: number; failed: number; failures: { issue: string; reason: string }[] }>(
          'cleaner:registry:fix',
          ['test-entry-1'],
        ),
      ).rejects.toThrow('fix error')
    })

    it('handles non-Error thrown values during fix', async () => {
      mockValidateStringArray.mockReturnValue(['test-entry-1'])
      mockFixRegistryEntries.mockRejectedValue(42)

      const sessionMap = new Map<string, RegistryEntry>()
      sessionMap.set('test-entry-1', mockEntry)
      mockState.scanSessions.set('s', sessionMap)

      await expect(
        callHandler<{ fixed: number; failed: number; failures: { issue: string; reason: string }[] }>(
          'cleaner:registry:fix',
          ['test-entry-1'],
        ),
      ).rejects.toBe(42)
    })

    it('clears fixAbort in finally block', async () => {
      mockValidateStringArray.mockReturnValue([])
      mockFixRegistryEntries.mockResolvedValue({ fixed: 0, failed: 0, failures: [] })
      await callHandler<{ fixed: number; failed: number; failures: { issue: string; reason: string }[] }>(
        'cleaner:registry:fix',
        [],
      )
      expect(mockState.fixAbort).toBeNull()
    })

    it('clears fixAbort on error in finally', async () => {
      mockValidateStringArray.mockReturnValue(['test-entry-1'])
      mockFixRegistryEntries.mockRejectedValue(new Error('fail'))

      const sessionMap = new Map<string, RegistryEntry>()
      sessionMap.set('test-entry-1', mockEntry)
      mockState.scanSessions.set('s', sessionMap)

      await expect(
        callHandler<{ fixed: number; failed: number; failures: { issue: string; reason: string }[] }>(
          'cleaner:registry:fix',
          ['test-entry-1'],
        ),
      ).rejects.toThrow()
      expect(mockState.fixAbort).toBeNull()
    })

    it('finds entries across multiple sessions', async () => {
      const entry2: RegistryEntry = { ...mockEntry, id: 'entry-2' }
      mockValidateStringArray.mockReturnValue(['test-entry-1', 'entry-2'])
      mockFixRegistryEntries.mockResolvedValue({ fixed: 2, failed: 0, failures: [] })

      const session1 = new Map<string, RegistryEntry>()
      session1.set('test-entry-1', mockEntry)
      const session2 = new Map<string, RegistryEntry>()
      session2.set('entry-2', entry2)
      mockState.scanSessions.set('s1', session1)
      mockState.scanSessions.set('s2', session2)

      const result = await callHandler<{
        fixed: number
        failed: number
        failures: { issue: string; reason: string }[]
      }>('cleaner:registry:fix', ['test-entry-1', 'entry-2'])
      expect(mockFixRegistryEntries).toHaveBeenCalledWith([mockEntry, entry2], expect.any(Function), expect.anything())
      expect(result.fixed).toBe(2)
    })

    it('skips duplicate entries from different sessions', async () => {
      mockValidateStringArray.mockReturnValue(['test-entry-1'])
      mockFixRegistryEntries.mockResolvedValue({ fixed: 1, failed: 0, failures: [] })

      const session1 = new Map<string, RegistryEntry>()
      session1.set('test-entry-1', mockEntry)
      const session2 = new Map<string, RegistryEntry>()
      session2.set('test-entry-1', mockEntry)
      mockState.scanSessions.set('s1', session1)
      mockState.scanSessions.set('s2', session2)

      await callHandler<{ fixed: number; failed: number; failures: { issue: string; reason: string }[] }>(
        'cleaner:registry:fix',
        ['test-entry-1'],
      )
      expect(mockFixRegistryEntries).toHaveBeenCalledWith([mockEntry], expect.any(Function), expect.anything())
    })

    it('passes signal to fixRegistryEntries', async () => {
      mockValidateStringArray.mockReturnValue(['test-entry-1'])
      mockFixRegistryEntries.mockResolvedValue({ fixed: 1, failed: 0, failures: [] })

      const sessionMap = new Map<string, RegistryEntry>()
      sessionMap.set('test-entry-1', mockEntry)
      mockState.scanSessions.set('s', sessionMap)

      await callHandler<{ fixed: number; failed: number; failures: { issue: string; reason: string }[] }>(
        'cleaner:registry:fix',
        ['test-entry-1'],
      )
      const callArgs = mockFixRegistryEntries.mock.calls[0]!
      expect(callArgs[2]).toBeInstanceOf(AbortSignal)
    })

    it('skips progress when getWindow returns null', async () => {
      mockValidateStringArray.mockReturnValue(['test-entry-1'])
      mockFixRegistryEntries.mockImplementation(
        async (_entries: unknown, onProgress: (c: number, t: number, e: string) => void) => {
          onProgress(1, 1, 'Test')
          return { fixed: 1, failed: 0, failures: [] }
        },
      )

      const sessionMap = new Map<string, RegistryEntry>()
      sessionMap.set('test-entry-1', mockEntry)
      mockState.scanSessions.set('s', sessionMap)

      mockHandlers.clear()
      registerRegistryCleanerIpc(() => null)

      const result = await callHandler<{
        fixed: number
        failed: number
        failures: { issue: string; reason: string }[]
      }>('cleaner:registry:fix', ['test-entry-1'])
      expect(result.fixed).toBe(1)
    })
  })

  describe('REGISTRY_SET_TWEAK_IGNORED', () => {
    it('calls updateRegistryIgnoredTweaks with valid args', async () => {
      mockValidateStringArray.mockReturnValue(['sig1', 'sig2'])
      callHandler('cleaner:registry:tweak:set-ignored', ['sig1', 'sig2'], true)
      expect(mockUpdateRegistryIgnoredTweaks).toHaveBeenCalledWith(['sig1', 'sig2'], true)
    })

    it('does nothing when validation fails', async () => {
      mockValidateStringArray.mockReturnValue(null)
      callHandler('cleaner:registry:tweak:set-ignored', [123], true)
      expect(mockUpdateRegistryIgnoredTweaks).not.toHaveBeenCalled()
    })

    it('does nothing when ignored is not boolean', async () => {
      mockValidateStringArray.mockReturnValue(['sig1'])
      callHandler('cleaner:registry:tweak:set-ignored', ['sig1'], 'not-a-bool')
      expect(mockUpdateRegistryIgnoredTweaks).not.toHaveBeenCalled()
    })

    it('passes ignored=false correctly', async () => {
      mockValidateStringArray.mockReturnValue(['sig1'])
      callHandler('cleaner:registry:tweak:set-ignored', ['sig1'], false)
      expect(mockUpdateRegistryIgnoredTweaks).toHaveBeenCalledWith(['sig1'], false)
    })
  })

  describe('REGISTRY_SCAN_CANCEL', () => {
    it('aborts the current scan', async () => {
      const abortCtrl = new AbortController()
      mockState.scanAbort = abortCtrl
      const abortSpy = vi.spyOn(abortCtrl, 'abort')

      callHandler('cleaner:registry:scan:cancel')
      expect(abortSpy).toHaveBeenCalled()
      expect(mockState.scanAbort).toBeNull()
    })

    it('handles no active scan gracefully', async () => {
      mockState.scanAbort = null
      callHandler('cleaner:registry:scan:cancel')
      expect(mockState.scanAbort).toBeNull()
    })
  })

  describe('REGISTRY_FIX_CANCEL', () => {
    it('aborts the current fix', async () => {
      const abortCtrl = new AbortController()
      mockState.fixAbort = abortCtrl
      const abortSpy = vi.spyOn(abortCtrl, 'abort')

      callHandler('cleaner:registry:fix:cancel')
      expect(abortSpy).toHaveBeenCalled()
      expect(mockState.fixAbort).toBeNull()
    })

    it('handles no active fix gracefully', async () => {
      mockState.fixAbort = null
      callHandler('cleaner:registry:fix:cancel')
      expect(mockState.fixAbort).toBeNull()
    })
  })

  describe('barrel exports', () => {
    it('exports scanRegistry', () => {
      expect(typeof scanRegistry).toBe('function')
    })

    it('exports collectBackupTargets', () => {
      expect(typeof collectBackupTargets).toBe('function')
    })

    it('exports fixRegistryEntries', () => {
      expect(typeof fixRegistryEntries).toBe('function')
    })
  })
})
