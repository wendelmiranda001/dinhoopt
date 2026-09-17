import { describe, expect, it, vi } from 'vitest'

const noopAsync = vi.fn().mockResolvedValue(undefined)
const checkFalse = vi.fn().mockResolvedValue(false)
const applicableTrue = vi.fn().mockResolvedValue(true)

vi.mock('./fixes/ads', () => ({
  applyAdvertisingId: noopAsync,
  applyLockScreenSpotlight: noopAsync,
  applyPreinstalledApps: noopAsync,
  applySilentlyInstalledApps: noopAsync,
  applyStartSuggestions: noopAsync,
  applySuggestedContent: noopAsync,
  applyTipsNotifications: noopAsync,
  revertAdvertisingId: noopAsync,
  revertLockScreenSpotlight: noopAsync,
  revertPreinstalledApps: noopAsync,
  revertSilentlyInstalledApps: noopAsync,
  revertStartSuggestions: noopAsync,
  revertSuggestedContent: noopAsync,
  revertTipsNotifications: noopAsync,
}))

vi.mock('./fixes/ai', () => ({
  applyAiServiceAutostart: noopAsync,
  applyClickToDo: noopAsync,
  applyCopilot: noopAsync,
  applyEdgeAiFeatures: noopAsync,
  applyNotepadAi: noopAsync,
  applyPaintAi: noopAsync,
  applyRecallBlocker: noopAsync,
  applyWindowsRecall: noopAsync,
  revertAiServiceAutostart: noopAsync,
  revertClickToDo: noopAsync,
  revertCopilot: noopAsync,
  revertEdgeAiFeatures: noopAsync,
  revertNotepadAi: noopAsync,
  revertPaintAi: noopAsync,
  revertRecallBlocker: noopAsync,
  revertWindowsRecall: noopAsync,
}))

vi.mock('./fixes/search', () => ({
  applyBingStartMenu: noopAsync,
  applyBingWebSearch: noopAsync,
  applyCortana: noopAsync,
  applySearchHighlights: noopAsync,
  applyStoreSearchSuggestions: noopAsync,
  revertBingStartMenu: noopAsync,
  revertBingWebSearch: noopAsync,
  revertCortana: noopAsync,
  revertSearchHighlights: noopAsync,
  revertStoreSearchSuggestions: noopAsync,
}))

vi.mock('./fixes/services', () => ({
  applyServiceDeliveryOptimization: noopAsync,
  applyServiceDiagtrack: noopAsync,
  applyServiceDmwappush: noopAsync,
  applyServiceMapsbroker: noopAsync,
  revertServiceDeliveryOptimization: noopAsync,
  revertServiceDiagtrack: noopAsync,
  revertServiceDmwappush: noopAsync,
  revertServiceMapsbroker: noopAsync,
}))

vi.mock('./fixes/sync', () => ({
  applyClipboardHistory: noopAsync,
  applyClipboardSync: noopAsync,
  applyFindMyDevice: noopAsync,
  applySettingsSync: noopAsync,
  revertClipboardHistory: noopAsync,
  revertClipboardSync: noopAsync,
  revertFindMyDevice: noopAsync,
  revertSettingsSync: noopAsync,
}))

vi.mock('./fixes/tasks', () => ({
  applyTaskAutochkProxy: noopAsync,
  applyTaskCeipConsolidator: noopAsync,
  applyTaskCompatibilityAppraiser: noopAsync,
  applyTaskDiskDiagnostic: noopAsync,
  applyTaskFeedbackDm: noopAsync,
  applyTaskMapsToast: noopAsync,
  applyTaskMapsUpdate: noopAsync,
  applyTaskProgramDataUpdater: noopAsync,
  applyTaskUsbCeip: noopAsync,
  revertTaskAutochkProxy: noopAsync,
  revertTaskCeipConsolidator: noopAsync,
  revertTaskCompatibilityAppraiser: noopAsync,
  revertTaskDiskDiagnostic: noopAsync,
  revertTaskFeedbackDm: noopAsync,
  revertTaskMapsToast: noopAsync,
  revertTaskMapsUpdate: noopAsync,
  revertTaskProgramDataUpdater: noopAsync,
  revertTaskUsbCeip: noopAsync,
}))

vi.mock('./fixes/telemetry', () => ({
  applyActivityHistory: noopAsync,
  applyAppLaunchTracking: noopAsync,
  applyFeedbackFrequency: noopAsync,
  applyHandwritingTelemetry: noopAsync,
  applyInputPersonalization: noopAsync,
  applyPublishActivity: noopAsync,
  applyTailoredExperiences: noopAsync,
  applyTelemetryLevel: noopAsync,
  revertActivityHistory: noopAsync,
  revertAppLaunchTracking: noopAsync,
  revertFeedbackFrequency: noopAsync,
  revertHandwritingTelemetry: noopAsync,
  revertInputPersonalization: noopAsync,
  revertPublishActivity: noopAsync,
  revertTailoredExperiences: noopAsync,
  revertTelemetryLevel: noopAsync,
}))

vi.mock('./scanners/ads', () => ({
  checkAdvertisingId: checkFalse,
  checkLockScreenSpotlight: checkFalse,
  checkPreinstalledApps: checkFalse,
  checkSilentlyInstalledApps: checkFalse,
  checkStartSuggestions: checkFalse,
  checkSuggestedContent: checkFalse,
  checkTipsNotifications: checkFalse,
}))

vi.mock('./scanners/ai', () => ({
  applicableAiServiceAutostart: applicableTrue,
  checkAiServiceAutostart: checkFalse,
  checkClickToDo: checkFalse,
  checkCopilot: checkFalse,
  checkEdgeAiFeatures: checkFalse,
  checkNotepadAi: checkFalse,
  checkPaintAi: checkFalse,
  checkRecallBlocker: checkFalse,
  checkWindowsRecall: checkFalse,
}))

vi.mock('./scanners/search', () => ({
  checkBingStartMenu: checkFalse,
  checkBingWebSearch: checkFalse,
  checkCortana: checkFalse,
  checkSearchHighlights: checkFalse,
  checkStoreSearchSuggestions: checkFalse,
}))

vi.mock('./scanners/services', () => ({
  applicableServiceDiagtrack: applicableTrue,
  applicableServiceDmwappush: applicableTrue,
  applicableServiceMapsbroker: applicableTrue,
  checkServiceDeliveryOptimization: checkFalse,
  checkServiceDiagtrack: checkFalse,
  checkServiceDmwappush: checkFalse,
  checkServiceMapsbroker: checkFalse,
}))

vi.mock('./scanners/sync', () => ({
  checkClipboardHistory: checkFalse,
  checkClipboardSync: checkFalse,
  checkFindMyDevice: checkFalse,
  checkSettingsSync: checkFalse,
}))

vi.mock('./scanners/tasks', () => ({
  applicableTaskAutochkProxy: applicableTrue,
  applicableTaskCeipConsolidator: applicableTrue,
  applicableTaskCompatibilityAppraiser: applicableTrue,
  applicableTaskDiskDiagnostic: applicableTrue,
  applicableTaskFeedbackDm: applicableTrue,
  applicableTaskMapsToast: applicableTrue,
  applicableTaskMapsUpdate: applicableTrue,
  applicableTaskProgramDataUpdater: applicableTrue,
  applicableTaskUsbCeip: applicableTrue,
  checkTaskAutochkProxy: checkFalse,
  checkTaskCeipConsolidator: checkFalse,
  checkTaskCompatibilityAppraiser: checkFalse,
  checkTaskDiskDiagnostic: checkFalse,
  checkTaskFeedbackDm: checkFalse,
  checkTaskMapsToast: checkFalse,
  checkTaskMapsUpdate: checkFalse,
  checkTaskProgramDataUpdater: checkFalse,
  checkTaskUsbCeip: checkFalse,
}))

vi.mock('./scanners/telemetry', () => ({
  checkActivityHistory: checkFalse,
  checkAppLaunchTracking: checkFalse,
  checkFeedbackFrequency: checkFalse,
  checkHandwritingTelemetry: checkFalse,
  checkInputPersonalization: checkFalse,
  checkPublishActivity: checkFalse,
  checkTailoredExperiences: checkFalse,
  checkTelemetryLevel: checkFalse,
}))

vi.mock('./browser-settings', () => ({
  BROWSER_SETTINGS: [
    {
      id: 'browser-chrome-metrics',
      category: 'browser',
      label: 'Chrome Metrics',
      description: 'Disable Chrome metrics',
      requiresAdmin: false,
      check: checkFalse,
      apply: noopAsync,
      revert: noopAsync,
    },
  ],
}))

describe('privacy-shield/settings.ts', () => {
  it('exports SETTINGS as a non-empty array', async () => {
    const { SETTINGS } = await import('./settings')
    expect(Array.isArray(SETTINGS)).toBe(true)
    expect(SETTINGS.length).toBeGreaterThan(0)
  })

  it('every setting has required string fields', async () => {
    const { SETTINGS } = await import('./settings')
    for (const s of SETTINGS) {
      expect(typeof s.id).toBe('string')
      expect(s.id.length).toBeGreaterThan(0)
      expect(typeof s.category).toBe('string')
      expect(typeof s.label).toBe('string')
      expect(typeof s.description).toBe('string')
      expect(typeof s.requiresAdmin).toBe('boolean')
    }
  })

  it('every setting has check/apply functions', async () => {
    const { SETTINGS } = await import('./settings')
    for (const s of SETTINGS) {
      expect(typeof s.check).toBe('function')
      expect(typeof s.apply).toBe('function')
    }
  })

  it('every setting has a unique id', async () => {
    const { SETTINGS } = await import('./settings')
    const ids = SETTINGS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all required categories are present', async () => {
    const { SETTINGS } = await import('./settings')
    const categories = new Set(SETTINGS.map((s) => s.category))
    expect(categories.has('telemetry')).toBe(true)
    expect(categories.has('ads')).toBe(true)
    expect(categories.has('search')).toBe(true)
    expect(categories.has('sync')).toBe(true)
    expect(categories.has('ai')).toBe(true)
    expect(categories.has('services')).toBe(true)
    expect(categories.has('tasks')).toBe(true)
    expect(categories.has('browser')).toBe(true)
  })

  it('telemetry settings are all requiresAdmin=true or false', async () => {
    const { SETTINGS } = await import('./settings')
    const telemetry = SETTINGS.filter((s) => s.category === 'telemetry')
    expect(telemetry.length).toBeGreaterThanOrEqual(7)
    for (const s of telemetry) {
      expect(typeof s.requiresAdmin).toBe('boolean')
    }
  })

  it('ads settings exist', async () => {
    const { SETTINGS } = await import('./settings')
    const ads = SETTINGS.filter((s) => s.category === 'ads')
    expect(ads.length).toBeGreaterThanOrEqual(6)
  })

  it('search settings exist', async () => {
    const { SETTINGS } = await import('./settings')
    const search = SETTINGS.filter((s) => s.category === 'search')
    expect(search.length).toBeGreaterThanOrEqual(4)
  })

  it('sync settings exist', async () => {
    const { SETTINGS } = await import('./settings')
    const sync = SETTINGS.filter((s) => s.category === 'sync')
    expect(sync.length).toBeGreaterThanOrEqual(3)
  })

  it('ai settings exist', async () => {
    const { SETTINGS } = await import('./settings')
    const ai = SETTINGS.filter((s) => s.category === 'ai')
    expect(ai.length).toBeGreaterThanOrEqual(6)
  })

  it('services settings exist', async () => {
    const { SETTINGS } = await import('./settings')
    const services = SETTINGS.filter((s) => s.category === 'services')
    expect(services.length).toBeGreaterThanOrEqual(3)
  })

  it('tasks settings exist', async () => {
    const { SETTINGS } = await import('./settings')
    const tasks = SETTINGS.filter((s) => s.category === 'tasks')
    expect(tasks.length).toBeGreaterThanOrEqual(8)
  })

  it('browser settings are included from BROWSER_SETTINGS', async () => {
    const { SETTINGS } = await import('./settings')
    const browser = SETTINGS.filter((s) => s.category === 'browser')
    expect(browser.length).toBeGreaterThanOrEqual(1)
    expect(browser[0]!.id).toBe('browser-chrome-metrics')
  })

  it('settings with applicable function have it as optional', async () => {
    const { SETTINGS } = await import('./settings')
    const withApplicable = SETTINGS.filter((s) => s.applicable !== undefined)
    expect(withApplicable.length).toBeGreaterThanOrEqual(1)
    for (const s of withApplicable) {
      expect(typeof s.applicable).toBe('function')
    }
  })

  it('specific known telemetry settings exist', async () => {
    const { SETTINGS } = await import('./settings')
    const ids = SETTINGS.map((s) => s.id)
    expect(ids).toContain('telemetry-level')
    expect(ids).toContain('activity-history')
    expect(ids).toContain('publish-activity')
    expect(ids).toContain('feedback-frequency')
    expect(ids).toContain('handwriting-telemetry')
    expect(ids).toContain('input-personalization')
    expect(ids).toContain('tailored-experiences')
    expect(ids).toContain('app-launch-tracking')
  })

  it('specific known AI settings exist', async () => {
    const { SETTINGS } = await import('./settings')
    const ids = SETTINGS.map((s) => s.id)
    expect(ids).toContain('copilot')
    expect(ids).toContain('windows-recall')
    expect(ids).toContain('click-to-do')
    expect(ids).toContain('ai-service-autostart')
    expect(ids).toContain('edge-ai-features')
    expect(ids).toContain('paint-ai')
    expect(ids).toContain('notepad-ai')
  })

  it('specific known task settings exist', async () => {
    const { SETTINGS } = await import('./settings')
    const ids = SETTINGS.map((s) => s.id)
    expect(ids).toContain('task-compatibility-appraiser')
    expect(ids).toContain('task-program-data-updater')
    expect(ids).toContain('task-autochk-proxy')
    expect(ids).toContain('task-ceip-consolidator')
    expect(ids).toContain('task-usb-ceip')
    expect(ids).toContain('task-disk-diagnostic')
    expect(ids).toContain('task-feedback-dm')
    expect(ids).toContain('task-maps-update')
    expect(ids).toContain('task-maps-toast')
  })

  it('specific known service settings exist', async () => {
    const { SETTINGS } = await import('./settings')
    const ids = SETTINGS.map((s) => s.id)
    expect(ids).toContain('service-diagtrack')
    expect(ids).toContain('service-dmwappush')
    expect(ids).toContain('service-delivery-optimization')
    expect(ids).toContain('service-mapsbroker')
  })

  it('specific known sync settings exist', async () => {
    const { SETTINGS } = await import('./settings')
    const ids = SETTINGS.map((s) => s.id)
    expect(ids).toContain('clipboard-sync')
    expect(ids).toContain('clipboard-history')
    expect(ids).toContain('settings-sync')
    expect(ids).toContain('find-my-device')
  })

  it('specific known ads settings exist', async () => {
    const { SETTINGS } = await import('./settings')
    const ids = SETTINGS.map((s) => s.id)
    expect(ids).toContain('advertising-id')
    expect(ids).toContain('suggested-content')
    expect(ids).toContain('tips-notifications')
    expect(ids).toContain('start-suggestions')
    expect(ids).toContain('lock-screen-spotlight')
    expect(ids).toContain('silently-installed-apps')
    expect(ids).toContain('preinstalled-apps')
  })

  it('specific known search settings exist', async () => {
    const { SETTINGS } = await import('./settings')
    const ids = SETTINGS.map((s) => s.id)
    expect(ids).toContain('bing-start-menu')
    expect(ids).toContain('bing-web-search')
    expect(ids).toContain('cortana')
    expect(ids).toContain('search-highlights')
    expect(ids).toContain('store-search-suggestions')
  })

  it('every setting check function is callable', async () => {
    const { SETTINGS } = await import('./settings')
    for (const s of SETTINGS) {
      const result = await s.check()
      expect(typeof result).toBe('boolean')
    }
  })

  it('every setting with applicable function can be called', async () => {
    const { SETTINGS } = await import('./settings')
    for (const s of SETTINGS) {
      if (s.applicable) {
        const result = await s.applicable()
        expect(typeof result).toBe('boolean')
      }
    }
  })

  it('every setting apply function is callable', async () => {
    const { SETTINGS } = await import('./settings')
    for (const s of SETTINGS) {
      await expect(s.apply()).resolves.toBeUndefined()
    }
  })

  it('every setting with revert function is callable', async () => {
    const { SETTINGS } = await import('./settings')
    for (const s of SETTINGS) {
      if (s.revert) {
        await expect(s.revert()).resolves.toBeUndefined()
      }
    }
  })

  it('total count is at least 45 settings', async () => {
    const { SETTINGS } = await import('./settings')
    expect(SETTINGS.length).toBeGreaterThanOrEqual(45)
  })

  it('no setting has duplicate id with another', async () => {
    const { SETTINGS } = await import('./settings')
    const seen = new Set<string>()
    for (const s of SETTINGS) {
      expect(seen.has(s.id)).toBe(false)
      seen.add(s.id)
    }
  })

  it('revert function is optional but all settings have it', async () => {
    const { SETTINGS } = await import('./settings')
    for (const s of SETTINGS) {
      expect(s.revert).toBeDefined()
      expect(typeof s.revert).toBe('function')
    }
  })
})
