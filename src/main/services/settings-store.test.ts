import type { MalwareAllowlistEntry, ScheduleEntry } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/test-kudu',
  },
}))

const { mockData, mockLoad, mockSave } = vi.hoisted(() => {
  const mockData: { current: Record<string, unknown> | null } = { current: null }
  return {
    mockData,
    mockLoad: vi.fn(() => mockData.current),
    mockSave: vi.fn(),
  }
})

vi.mock('./store-base', () => ({
  createJsonStore: () => ({
    load: mockLoad,
    save: mockSave,
    update: vi.fn(),
    resetCache: vi.fn(),
    get path() {
      return '/tmp/test.json'
    },
  }),
}))

import {
  addMalwareAllowlistEntry,
  deepMerge,
  flushSettings,
  getMachineId,
  getMalwareAllowlist,
  getOnboardingComplete,
  getSettings,
  removeMalwareAllowlistEntry,
  setOnboardingComplete,
  setSettings,
  updateRegistryIgnoredTweaks,
} from './settings-store'

const defaults: Record<string, unknown> = {
  machineId: '',
  onboardingComplete: false,
  settings: {
    theme: 'dark',
    language: 'en',
    minimizeToTray: false,
    showNotificationOnComplete: true,
    showThreatNotifications: true,
    runAtStartup: false,
    autoUpdate: true,
    autoRestart: true,
    updateCheckIntervalHours: 4,
    cleaner: {
      skipRecentMinutes: 60,
      secureDelete: false,
      closeBrowsersBeforeClean: false,
      protectRecycleBin: true,
    },
    exclusions: [],
    ignoredSoftwareUpdates: [],
    backupPath: '',
    backupMode: 'targeted',
    schedule: { enabled: false, frequency: 'weekly', day: 1, hour: 9 },
    schedules: [],
    gameMode: {
      enabledOptimizations: [],
      customProcessKillList: [],
      autoDetect: false,
      autoDeactivate: true,
      customGameProcesses: [],
      gameProfiles: {},
    },
    registryIgnoredTweaks: [],
    malwareAllowlist: [],
  },
  stats: {
    totalSpaceSaved: 0,
    totalFilesCleaned: 0,
    totalScans: 0,
    lastScanDate: null,
    recentActivity: [],
  },
}

describe('settings-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoad.mockImplementation(() => mockData.current)
    mockSave.mockImplementation(() => {})
    mockData.current = null
  })

  describe('deepMerge', () => {
    it('merges flat properties', () => {
      const target = { a: 1, b: 2 }
      expect(deepMerge(target, { b: 3 })).toEqual({ a: 1, b: 3 })
    })

    it('does not mutate target', () => {
      const target = { a: 1, b: 2 }
      deepMerge(target, { b: 3 })
      expect(target).toEqual({ a: 1, b: 2 })
    })

    it('deep merges nested objects', () => {
      const target = { cleaner: { secureDelete: false, skipRecentMinutes: 60 } }
      const result = deepMerge(target, { cleaner: { secureDelete: true } } as Record<string, unknown>)
      expect(result.cleaner.secureDelete).toBe(true)
      expect(result.cleaner.skipRecentMinutes).toBe(60)
    })

    it('replaces arrays instead of merging', () => {
      expect(deepMerge({ exclusions: ['a', 'b'] }, { exclusions: ['c'] })).toEqual({ exclusions: ['c'] })
    })

    it('handles null source values by replacing', () => {
      const result = deepMerge({ a: { nested: 1 } }, { a: null } as Record<string, unknown>)
      expect(result.a).toBeNull()
    })

    it('ignores undefined source values', () => {
      expect(deepMerge({ a: 1, b: 2 }, { a: undefined } as Record<string, unknown>)).toEqual({ a: 1, b: 2 })
    })

    it('skips prototype pollution keys', () => {
      const result = deepMerge(
        { a: 1 } as Record<string, unknown>,
        {
          __proto__: { b: 2 },
          constructor: { c: 3 },
          prototype: { d: 4 },
        } as unknown as Record<string, unknown>,
      )
      expect(result.a).toBe(1)
      expect(Object.hasOwn(result, '__proto__')).toBe(false)
      expect(Object.hasOwn(result, 'constructor')).toBe(false)
      expect(Object.hasOwn(result, 'prototype')).toBe(false)
    })
  })

  describe('getSettings', () => {
    it('returns merged settings from store', () => {
      mockData.current = {
        ...defaults,
        settings: { ...(defaults.settings as Record<string, unknown>), minimizeToTray: true },
      }
      mockLoad.mockReturnValue(mockData.current)

      const result = getSettings()

      expect(result.minimizeToTray).toBe(true)
      expect(result.language).toBe('en')
    })

    it('returns defaults when store.load throws', () => {
      mockLoad.mockImplementation(() => {
        throw new Error('load failed')
      })

      const result = getSettings()

      expect(result.language).toBe('en')
      expect(result.minimizeToTray).toBe(false)
    })

    it('returns defaults when store.load returns null', () => {
      mockLoad.mockReturnValue(null)

      const result = getSettings()

      expect(result.language).toBe('en')
    })

    it('migrates old schedule format to schedules array', () => {
      const oldScheduleSettings = {
        ...(defaults.settings as Record<string, unknown>),
        schedule: { enabled: true, frequency: 'daily', day: 0, hour: 10 },
        schedules: [],
      }
      mockData.current = { ...defaults, settings: oldScheduleSettings }
      mockLoad.mockReturnValue(mockData.current)

      getSettings()

      expect(mockSave).toHaveBeenCalledTimes(1)
      const saved = mockSave.mock.calls[0]![0] as Record<string, unknown>
      const settings = saved.settings as Record<string, unknown>
      expect((settings.schedule as Record<string, unknown>).enabled).toBe(false)
      const schedules = settings.schedules as ScheduleEntry[]
      expect(schedules).toHaveLength(1)
      expect(schedules[0]!.frequency).toBe('daily')
      expect(schedules[0]!.hour).toBe(10)
    })

    it('does not migrate when schedules already exist', () => {
      mockData.current = {
        ...defaults,
        settings: {
          ...(defaults.settings as Record<string, unknown>),
          schedule: { enabled: true, frequency: 'weekly', day: 1, hour: 9 },
          schedules: [{ id: 'existing', name: 'Existing' }],
        },
      }
      mockLoad.mockReturnValue(mockData.current)

      getSettings()

      expect(mockSave).not.toHaveBeenCalled()
    })

    it('does not migrate when schedule is not enabled', () => {
      mockData.current = {
        ...defaults,
        settings: {
          ...(defaults.settings as Record<string, unknown>),
          schedule: { enabled: false, frequency: 'weekly', day: 1, hour: 9 },
          schedules: [],
        },
      }
      mockLoad.mockReturnValue(mockData.current)

      getSettings()

      expect(mockSave).not.toHaveBeenCalled()
    })

    it('save migration silently on save error', () => {
      mockData.current = {
        ...defaults,
        settings: {
          ...(defaults.settings as Record<string, unknown>),
          schedule: { enabled: true, frequency: 'weekly', day: 1, hour: 9 },
          schedules: [],
        },
      }
      mockLoad.mockReturnValue(mockData.current)
      mockSave.mockImplementationOnce(() => {
        throw new Error('save failed')
      })

      expect(() => getSettings()).not.toThrow()
    })
  })

  describe('setSettings', () => {
    it('deep merges partial and saves', async () => {
      mockData.current = { ...defaults }
      mockLoad.mockReturnValue(mockData.current)

      setSettings({ minimizeToTray: true, cleaner: { skipRecentMinutes: 30 } } as Record<string, unknown>)
      await flushSettings()

      expect(mockSave).toHaveBeenCalledTimes(1)
      const saved = mockSave.mock.calls[0]![0] as Record<string, unknown>
      const settings = saved.settings as Record<string, unknown>
      expect(settings.minimizeToTray).toBe(true)
      expect((settings.cleaner as Record<string, unknown>).skipRecentMinutes).toBe(30)
      expect((settings.cleaner as Record<string, unknown>).protectRecycleBin).toBe(true)
    })
  })

  describe('updateRegistryIgnoredTweaks', () => {
    it('adds signatures to ignored set', async () => {
      mockData.current = { ...defaults }
      mockLoad.mockReturnValue(mockData.current)

      updateRegistryIgnoredTweaks(['sig1', 'sig2'], true)
      await flushSettings()

      const saved = mockSave.mock.calls[0]![0] as Record<string, unknown>
      const settings = saved.settings as Record<string, unknown>
      expect(settings.registryIgnoredTweaks).toEqual(['sig1', 'sig2'])
    })

    it('removes signatures from ignored set', async () => {
      mockData.current = {
        ...defaults,
        settings: {
          ...(defaults.settings as Record<string, unknown>),
          registryIgnoredTweaks: ['sig1', 'sig2', 'sig3'],
        },
      }
      mockLoad.mockReturnValue(mockData.current)

      updateRegistryIgnoredTweaks(['sig2'], false)
      await flushSettings()

      const saved = mockSave.mock.calls[0]![0] as Record<string, unknown>
      const settings = saved.settings as Record<string, unknown>
      expect(settings.registryIgnoredTweaks).toEqual(['sig1', 'sig3'])
    })

    it('skips empty signatures', async () => {
      mockData.current = { ...defaults }
      mockLoad.mockReturnValue(mockData.current)

      updateRegistryIgnoredTweaks(['', 'valid'], true)
      await flushSettings()

      const saved = mockSave.mock.calls[0]![0] as Record<string, unknown>
      const settings = saved.settings as Record<string, unknown>
      expect(settings.registryIgnoredTweaks).toEqual(['valid'])
    })

    it('caps ignored tweaks at 200 entries', async () => {
      const manySigs = Array.from({ length: 250 }, (_, i) => `sig${i}`)
      mockData.current = { ...defaults }
      mockLoad.mockReturnValue(mockData.current)

      updateRegistryIgnoredTweaks(manySigs, true)
      await flushSettings()

      const saved = mockSave.mock.calls[0]![0] as Record<string, unknown>
      const settings = saved.settings as Record<string, unknown>
      expect(settings.registryIgnoredTweaks).toHaveLength(200)
    })
  })

  describe('malware allowlist', () => {
    it('getMalwareAllowlist returns list from store', () => {
      mockData.current = {
        ...defaults,
        settings: { ...(defaults.settings as Record<string, unknown>), malwareAllowlist: [{ sha256: 'abc' }] },
      }
      mockLoad.mockReturnValue(mockData.current)

      const result = getMalwareAllowlist()

      expect(result).toEqual([{ sha256: 'abc' }])
    })

    it('getMalwareAllowlist returns empty array when null', () => {
      mockData.current = {
        ...defaults,
        settings: { ...(defaults.settings as Record<string, unknown>), malwareAllowlist: null },
      }
      mockLoad.mockReturnValue(mockData.current)

      const result = getMalwareAllowlist()

      expect(result).toEqual([])
    })

    it('addMalwareAllowlistEntry adds entry and deduplicates by sha256', async () => {
      mockData.current = {
        ...defaults,
        settings: {
          ...(defaults.settings as Record<string, unknown>),
          malwareAllowlist: [{ sha256: 'abc', path: 'C:/old.exe', fileName: 'old.exe', addedAt: 1 }],
        },
      }
      mockLoad.mockReturnValue(mockData.current)

      await addMalwareAllowlistEntry({ sha256: 'abc', path: 'C:/new.exe', fileName: 'new.exe', addedAt: 2 })
      await flushSettings()

      const saved = mockSave.mock.calls[0]![0] as Record<string, unknown>
      const list = (saved.settings as Record<string, unknown>).malwareAllowlist as MalwareAllowlistEntry[]
      expect(list).toHaveLength(1)
      expect(list[0]!.path).toBe('C:/new.exe')
    })

    it('addMalwareAllowlistEntry caps at 500 entries', async () => {
      const existing = Array.from({ length: 500 }, (_, i) => ({
        sha256: `existing${i}`,
        path: `C:/existing${i}.exe`,
        fileName: `existing${i}.exe`,
        addedAt: 1,
      }))
      mockData.current = {
        ...defaults,
        settings: { ...(defaults.settings as Record<string, unknown>), malwareAllowlist: existing },
      }
      mockLoad.mockReturnValue(mockData.current)

      await addMalwareAllowlistEntry({ sha256: 'new-entry', path: 'C:/x.exe', fileName: 'x.exe', addedAt: 1 })
      await flushSettings()

      const saved = mockSave.mock.calls[0]![0] as Record<string, unknown>
      const list = (saved.settings as Record<string, unknown>).malwareAllowlist as MalwareAllowlistEntry[]
      expect(list).toHaveLength(500)
      expect(list[499]!.sha256).toBe('new-entry')
    })

    it('removeMalwareAllowlistEntry removes by sha256', async () => {
      mockData.current = {
        ...defaults,
        settings: {
          ...(defaults.settings as Record<string, unknown>),
          malwareAllowlist: [
            { sha256: 'abc', path: 'C:/a.exe', fileName: 'a.exe', addedAt: 1 },
            { sha256: 'def', path: 'C:/d.exe', fileName: 'd.exe', addedAt: 2 },
          ],
        },
      }
      mockLoad.mockReturnValue(mockData.current)

      await removeMalwareAllowlistEntry('abc')
      await flushSettings()

      const saved = mockSave.mock.calls[0]![0] as Record<string, unknown>
      const list = (saved.settings as Record<string, unknown>).malwareAllowlist as MalwareAllowlistEntry[]
      expect(list).toHaveLength(1)
      expect(list[0]!.sha256).toBe('def')
    })
  })

  describe('flushSettings', () => {
    it('returns a promise that resolves when writes complete', async () => {
      mockData.current = { ...defaults }
      mockLoad.mockReturnValue(mockData.current)

      setSettings({ minimizeToTray: true } as Record<string, unknown>)
      await expect(flushSettings()).resolves.toBeUndefined()
      expect(mockSave).toHaveBeenCalledTimes(1)
    })
  })

  describe('onboarding', () => {
    it('getOnboardingComplete returns value from store', () => {
      mockData.current = { ...defaults, onboardingComplete: true }
      mockLoad.mockReturnValue(mockData.current)

      expect(getOnboardingComplete()).toBe(true)
    })

    it('getOnboardingComplete returns false when store has false', () => {
      mockData.current = { ...defaults, onboardingComplete: false }
      mockLoad.mockReturnValue(mockData.current)

      expect(getOnboardingComplete()).toBe(false)
    })

    it('setOnboardingComplete sets value and saves', async () => {
      mockData.current = { ...defaults, onboardingComplete: false }
      mockLoad.mockReturnValue(mockData.current)

      await setOnboardingComplete(true)
      await flushSettings()

      const saved = mockSave.mock.calls[0]![0] as Record<string, unknown>
      expect(saved.onboardingComplete).toBe(true)
    })
  })

  describe('getMachineId', () => {
    it('returns existing machineId', () => {
      mockData.current = { ...defaults, machineId: 'existing-id' }
      mockLoad.mockReturnValue(mockData.current)

      expect(getMachineId()).toBe('existing-id')
    })

    it('generates new machineId when empty', () => {
      mockData.current = { ...defaults, machineId: '' }
      mockLoad.mockReturnValue(mockData.current)

      const id = getMachineId()

      expect(id).toBeTruthy()
      expect(typeof id).toBe('string')
    })

    it('persists newly generated machineId', async () => {
      mockData.current = { ...defaults, machineId: '' }
      mockLoad.mockReturnValue(mockData.current)

      const id = getMachineId()
      await flushSettings()

      const saved = mockSave.mock.calls[0]![0] as Record<string, unknown>
      expect(saved.machineId).toBe(id)
    })

    it('does not overwrite existing machineId in race condition', async () => {
      let callCount = 0
      mockLoad.mockImplementation(() => {
        callCount++
        if (callCount === 1) return { ...defaults, machineId: '' }
        return { ...defaults, machineId: 'already-set' }
      })

      const id = getMachineId()
      await flushSettings()

      expect(mockSave).not.toHaveBeenCalled()
      expect(id).toBeTruthy()
    })
  })
})
