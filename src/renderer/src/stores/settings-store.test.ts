import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Stub window.dinho to prevent eager hydration side-effect
vi.stubGlobal('window', { dinho: undefined })

import { refreshSettings, useSettingsStore } from './settings-store'

describe('settings-store', () => {
  beforeEach(() => {
    useSettingsStore.setState({
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
        autoInstallUpdates: false,
        autoInstallSchedule: null,
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
        schedule: {
          enabled: false,
          frequency: 'weekly',
          day: 1,
          hour: 9,
        },
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
      loaded: false,
    })
  })

  it('starts with loaded = false', () => {
    expect(useSettingsStore.getState().loaded).toBe(false)
  })

  it('setSettings replaces all settings and sets loaded', () => {
    const newSettings = {
      ...useSettingsStore.getState().settings,
      minimizeToTray: true,
      runAtStartup: true,
    }
    useSettingsStore.getState().setSettings(newSettings)

    const state = useSettingsStore.getState()
    expect(state.loaded).toBe(true)
    expect(state.settings.minimizeToTray).toBe(true)
    expect(state.settings.runAtStartup).toBe(true)
  })

  it('updateSettings merges top-level properties', () => {
    useSettingsStore.getState().updateSettings({ minimizeToTray: true })
    expect(useSettingsStore.getState().settings.minimizeToTray).toBe(true)
    // Other settings remain unchanged
    expect(useSettingsStore.getState().settings.autoUpdate).toBe(true)
  })

  it('updateSettings deep-merges cleaner settings', () => {
    useSettingsStore.getState().updateSettings({
      cleaner: { secureDelete: true },
    } as any)

    const { cleaner } = useSettingsStore.getState().settings
    expect(cleaner.secureDelete).toBe(true)
    // Other cleaner settings remain
    expect(cleaner.skipRecentMinutes).toBe(60)
    expect(cleaner.closeBrowsersBeforeClean).toBe(false)
  })

  it('updateSettings deep-merges schedule settings', () => {
    useSettingsStore.getState().updateSettings({
      schedule: { enabled: true, hour: 22 },
    } as any)

    const { schedule } = useSettingsStore.getState().settings
    expect(schedule.enabled).toBe(true)
    expect(schedule.hour).toBe(22)
    // Preserved
    expect(schedule.frequency).toBe('weekly')
    expect(schedule.day).toBe(1)
  })

  it('updateSettings does not clobber nested objects when only top-level changes', () => {
    useSettingsStore.getState().updateSettings({ autoRestart: false })
    const { cleaner, schedule } = useSettingsStore.getState().settings
    expect(cleaner.skipRecentMinutes).toBe(60)
    expect(schedule.frequency).toBe('weekly')
  })

  it('default settings have sensible values', () => {
    const { settings } = useSettingsStore.getState()
    expect(settings.updateCheckIntervalHours).toBe(4)
    expect(settings.cleaner.skipRecentMinutes).toBe(60)
    expect(settings.schedule.enabled).toBe(false)
    expect(settings.exclusions).toEqual([])
  })
})

describe('refreshSettings', () => {
  afterAll(() => {
    vi.stubGlobal('window', { dinho: undefined })
  })

  it('fetches settings from main process via window.dinho', async () => {
    const setSettingsSpy = vi.spyOn(useSettingsStore.getState(), 'setSettings')
    const mockSettings = { theme: 'light', language: 'pt' }
    vi.stubGlobal('window', {
      dinho: {
        settingsGet: vi.fn().mockResolvedValue(mockSettings),
      },
    })
    refreshSettings()
    // Wait for promise to settle
    await new Promise((r) => setTimeout(r, 0))
    expect(window.dinho.settingsGet).toHaveBeenCalled()
    expect(setSettingsSpy).toHaveBeenCalledWith(mockSettings)
  })

  it('handles settingsGet rejection gracefully', async () => {
    vi.stubGlobal('window', {
      dinho: {
        settingsGet: vi.fn().mockRejectedValue(new Error('no main process')),
      },
    })
    expect(() => refreshSettings()).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
  })

  it('handles missing kudu gracefully', () => {
    vi.stubGlobal('window', { dinho: undefined })
    expect(() => refreshSettings()).not.toThrow()
  })
})

describe('eager hydration', () => {
  it('calls refreshSettings when window.dinho is defined', async () => {
    vi.resetModules()
    const settingsGet = vi.fn().mockResolvedValue({})
    vi.stubGlobal('window', {
      dinho: { settingsGet },
    })
    await import('./settings-store')
    await new Promise((r) => setTimeout(r, 0))
    expect(settingsGet).toHaveBeenCalled()
  })
})
