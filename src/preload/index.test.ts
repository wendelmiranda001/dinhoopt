import { IPC } from '@shared/channels'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn().mockResolvedValue(undefined),
    send: vi.fn(),
    on: vi.fn().mockReturnValue(1),
    removeListener: vi.fn(),
  },
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
}))

import { contextBridge, ipcRenderer } from 'electron'
import './index'

function getApi(): Record<string, unknown> {
  const call = (
    contextBridge as unknown as { exposeInMainWorld: ReturnType<typeof vi.fn> }
  ).exposeInMainWorld.mock.calls.find((c) => c[0] === 'dinho')
  return call ? (call[1] as Record<string, unknown>) : {}
}

const api = getApi()
const mockIpc = ipcRenderer as unknown as {
  invoke: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('preload API bridge', () => {
  it('should expose api via contextBridge', () => {
    expect(api).toBeDefined()
    expect(Object.keys(api).length).toBeGreaterThan(100)
  })

  it('platformInfo calls ipcRenderer.invoke', async () => {
    mockIpc.invoke.mockResolvedValueOnce({ platform: 'win32' })
    const result = await (api.platformInfo as () => Promise<unknown>)()
    expect(mockIpc.invoke).toHaveBeenCalled()
    expect(result).toEqual({ platform: 'win32' })
  })

  it('windowMinimize sends', () => {
    ;(api.windowMinimize as () => void)()
    expect(mockIpc.send).toHaveBeenCalled()
  })

  it('windowMaximize sends', () => {
    ;(api.windowMaximize as () => void)()
    expect(mockIpc.send).toHaveBeenCalled()
  })

  it('windowClose sends', () => {
    ;(api.windowClose as () => void)()
    expect(mockIpc.send).toHaveBeenCalled()
  })

  describe('cleaner methods call ipcRenderer.invoke', () => {
    const cleanerMethods = [
      'systemScan',
      'systemClean',
      'browserScan',
      'browserClean',
      'appScan',
      'appClean',
      'gamingScan',
      'gamingClean',
      'databaseScan',
      'databaseClean',
      'uninstallLeftoversScan',
      'uninstallLeftoversClean',
      'recycleBinScan',
      'recycleBinClean',
      'shortcutScan',
      'shortcutClean',
      'cleanerOpenLocation',
      'environmentScan',
      'environmentClean',
    ]
    for (const method of cleanerMethods) {
      it(`${method} calls ipcRenderer.invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[method] as (...args: unknown[]) => Promise<unknown>)('test')
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('event listener methods register via ipcRenderer.on', () => {
    const listenerMethods = [
      'onContextMenuApplyProgress',
      'onDebloaterRemoveProgress',
      'onHistoryChanged',
      'onDiskRepairProgress',
      'onDiskTrimProgress',
      'onScanProgress',
      'onRegistryFixProgress',
      'onPrivacyProgress',
      'onComplianceProgress',
      'onVulnerabilityProgress',
      'onMalwareProgress',
      'onDriverProgress',
      'onDriverUpdateProgress',
      'onServiceProgress',
      'onPerfSnapshot',
      'onPerfProcessList',
      'onUpdaterStatus',
      'onUninstallerProgress',
      'onSoftwareUpdateProgress',
      'onDuplicatesProgress',
      'onLargeFilesProgress',
      'onEmptyFoldersProgress',
      'onShredderProgress',
      'onGameModeProgress',
      'onGameModeAutoEvent',
      'onWindowsTweaksApplyProgress',
      'onWindowsTweaksRevertProgress',
      'onBenchmarkProgress',
      'onMemoryProgress',
      'onScheduleRunTrigger',
      'onYaraCompileProgress',
    ]
    for (const method of listenerMethods) {
      it(`${method} registers listener and returns cleanup`, () => {
        mockIpc.on.mockClear()
        mockIpc.removeListener.mockClear()
        const callback = vi.fn()
        const cleanup = (api[method] as (cb: typeof callback) => () => void)(callback)
        expect(mockIpc.on).toHaveBeenCalled()
        expect(cleanup).toBeInstanceOf(Function)
        cleanup()
        expect(mockIpc.removeListener).toHaveBeenCalled()
      })
    }
  })

  describe('registry', () => {
    const methods = ['registryScan', 'registryScanCancel', 'registryFixCancel']
    for (const m of methods) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as () => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
    it('registryFix calls invoke', async () => {
      mockIpc.invoke.mockResolvedValueOnce({ fixed: 0, failed: 0, failures: [] })
      await (api.registryFix as (ids: string[]) => Promise<unknown>)(['id1'])
      expect(mockIpc.invoke).toHaveBeenCalled()
    })
    it('registrySetTweakIgnored calls invoke', async () => {
      mockIpc.invoke.mockResolvedValueOnce(undefined)
      await (api.registrySetTweakIgnored as (sigs: string[], ignored: boolean) => Promise<unknown>)(['sig1'], true)
      expect(mockIpc.invoke).toHaveBeenCalled()
    })
  })

  describe('context menu', () => {
    const methods = ['contextMenuScan', 'contextMenuScanCancel']
    for (const m of methods) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as () => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
    it('contextMenuApply calls invoke', async () => {
      mockIpc.invoke.mockResolvedValueOnce({ success: true })
      await (api.contextMenuApply as (req: unknown[]) => Promise<unknown>)([])
      expect(mockIpc.invoke).toHaveBeenCalled()
    })
  })

  describe('startup', () => {
    for (const m of ['startupList', 'startupBootTrace', 'startupSafetyFetch']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as () => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
    it('startupToggle calls invoke', async () => {
      mockIpc.invoke.mockResolvedValueOnce(true)
      await (api.startupToggle as (...a: unknown[]) => Promise<unknown>)('n', 'l', 'c', 's', true)
      expect(mockIpc.invoke).toHaveBeenCalled()
    })
    it('startupDelete calls invoke', async () => {
      mockIpc.invoke.mockResolvedValueOnce(true)
      await (api.startupDelete as (...a: unknown[]) => Promise<unknown>)('n', 'l', 's')
      expect(mockIpc.invoke).toHaveBeenCalled()
    })
  })

  describe('debloat', () => {
    it('debloaterScan calls invoke', async () => {
      mockIpc.invoke.mockResolvedValueOnce([])
      await (api.debloaterScan as () => Promise<unknown>)()
      expect(mockIpc.invoke).toHaveBeenCalled()
    })
    it('debloaterRemove calls invoke', async () => {
      mockIpc.invoke.mockResolvedValueOnce({ removed: 0, failed: 0 })
      await (api.debloaterRemove as (pkgs: string[]) => Promise<unknown>)([])
      expect(mockIpc.invoke).toHaveBeenCalled()
    })
  })

  describe('disk', () => {
    for (const m of [
      'diskAnalyze',
      'diskDrives',
      'diskFileTypes',
      'diskRepairSfc',
      'diskRepairDism',
      'diskRepairChkdsk',
      'diskTrimList',
      'diskTrimRun',
    ]) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)('C')
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('network', () => {
    for (const m of ['networkScan', 'networkClean']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)([])
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('settings', () => {
    for (const m of ['settingsGet', 'settingsSelectBackupDir', 'settingsOpenBackupDir']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as () => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
    it('settingsSet calls invoke', async () => {
      mockIpc.invoke.mockResolvedValueOnce(undefined)
      await (api.settingsSet as (s: Record<string, unknown>) => Promise<unknown>)({})
      expect(mockIpc.invoke).toHaveBeenCalled()
    })
  })

  describe('elevation', () => {
    for (const m of ['elevationCheck', 'elevationRelaunch']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as () => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('onboarding', () => {
    for (const m of ['onboardingGet', 'onboardingSet']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)(true)
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('schedule', () => {
    it('applyStartup calls invoke', async () => {
      mockIpc.invoke.mockResolvedValueOnce(undefined)
      await (api.applyStartup as (e: boolean) => Promise<unknown>)(true)
      expect(mockIpc.invoke).toHaveBeenCalled()
    })
    it('applyTray sends', () => {
      ;(api.applyTray as (e: boolean) => void)(true)
      expect(mockIpc.send).toHaveBeenCalled()
    })
    it('notifyScheduledScanComplete sends', () => {
      ;(api.notifyScheduledScanComplete as (s: number, c: number) => void)(100, 5)
      expect(mockIpc.send).toHaveBeenCalled()
    })
    it('scheduleRunComplete sends', () => {
      ;(api.scheduleRunComplete as (id: string, status: string) => void)('s1', 'done')
      expect(mockIpc.send).toHaveBeenCalled()
    })
  })

  describe('history', () => {
    for (const m of ['historyGet', 'historyAdd', 'historyClear']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('privacy', () => {
    for (const m of ['privacyScan', 'privacyApply', 'privacyRevert']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)([])
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('compliance', () => {
    for (const m of ['complianceScan', 'complianceApply', 'complianceRevert']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)([])
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('vulnerability', () => {
    for (const m of ['vulnerabilityScan', 'vulnerabilityApply', 'vulnerabilityRevert']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)([])
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('malware', () => {
    for (const m of [
      'malwareScan',
      'malwareCancelScan',
      'malwareQuarantine',
      'malwareDelete',
      'malwareQuarantineList',
      'malwareAllowlistList',
      'malwareYaraInfo',
      'malwareYaraUpdate',
    ]) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
    it('malwareRestore calls invoke', async () => {
      mockIpc.invoke.mockResolvedValueOnce(true)
      await (api.malwareRestore as (q: string, o: string) => Promise<unknown>)('q', 'o')
      expect(mockIpc.invoke).toHaveBeenCalled()
    })
    it('malwareIgnore calls invoke', async () => {
      mockIpc.invoke.mockResolvedValueOnce(null)
      await (api.malwareIgnore as (p: string) => Promise<unknown>)('/path')
      expect(mockIpc.invoke).toHaveBeenCalled()
    })
    it('malwareAllowlistRemove calls invoke', async () => {
      mockIpc.invoke.mockResolvedValueOnce(true)
      await (api.malwareAllowlistRemove as (s: string) => Promise<unknown>)('sha256')
      expect(mockIpc.invoke).toHaveBeenCalled()
    })
  })

  describe('drivers', () => {
    for (const m of [
      'driverScan',
      'driverClean',
      'driverUpdateScan',
      'driverUpdateInstall',
      'driverAgentEvaluate',
      'driverAgentApprove',
    ]) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)([])
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('perf', () => {
    for (const m of [
      'perfQuickStats',
      'perfGetSystemInfo',
      'perfStartMonitoring',
      'perfStopMonitoring',
      'perfStartProcessPolling',
      'perfStopProcessPolling',
      'perfKillProcess',
      'perfGetDiskHealth',
    ]) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)(123)
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('updater', () => {
    for (const m of ['updaterCheck', 'updaterDownload', 'updaterInstall', 'updaterGetStatus']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as () => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('service', () => {
    for (const m of ['serviceScan', 'serviceApply']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)([])
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('firewall', () => {
    for (const m of ['firewallScan', 'firewallApply']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)([])
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('uninstaller', () => {
    for (const m of ['uninstallerList', 'uninstallerUninstall', 'uninstallerForceRemove', 'programSafetyFetch']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)('id')
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('software updates', () => {
    for (const m of ['softwareUpdateCheck', 'softwareUpdateRun']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)([])
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('app installer', () => {
    for (const m of ['appInstallerListAvailable', 'appInstallerInstall', 'appInstallerCancel']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)([])
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('duplicates', () => {
    for (const m of [
      'duplicatesSelectDir',
      'duplicatesScan',
      'duplicatesCancel',
      'duplicatesDelete',
      'duplicatesOpenLocation',
    ]) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('large files', () => {
    for (const m of [
      'largeFilesSelectDir',
      'largeFilesScan',
      'largeFilesCancel',
      'largeFilesDelete',
      'largeFilesOpenLocation',
    ]) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('empty folders', () => {
    for (const m of [
      'emptyFoldersSelectDir',
      'emptyFoldersScan',
      'emptyFoldersCancel',
      'emptyFoldersDelete',
      'emptyFoldersOpenLocation',
    ]) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('shredder', () => {
    for (const m of [
      'shredderSelectFiles',
      'shredderSelectFolders',
      'shredderShred',
      'shredderCancel',
      'shredderOpenLocation',
    ]) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('game mode', () => {
    for (const m of ['gameModeActivate', 'gameModeDeactivate', 'gameModeStatus', 'gameModeRunAudit']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('winSxS', () => {
    for (const m of ['winSxSScan', 'winSxSClean']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as () => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }

    it('winSxSScan returns empty array when invoke returns falsy', async () => {
      mockIpc.invoke.mockResolvedValueOnce(null)
      const result = (await (api.winSxSScan as () => Promise<unknown>)()) as Array<{ id: string }>
      expect(result).toEqual([])
    })

    it('winSxSScan wraps truthy result in array', async () => {
      mockIpc.invoke.mockResolvedValueOnce({ id: 'test', category: 'winsxs', path: 'C:\\test', size: 1024 })
      const result = (await (api.winSxSScan as () => Promise<unknown>)()) as Array<{ id: string }>
      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe('test')
    })
  })

  describe('power plans', () => {
    for (const m of ['powerPlansList', 'powerPlansActivate', 'powerPlansCreate', 'powerPlansDelete']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)('guid')
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('hosts', () => {
    for (const m of ['hostsRead', 'hostsWrite', 'hostsFlushDns']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('windows tweaks', () => {
    for (const m of [
      'windowsTweaksList',
      'windowsTweaksApply',
      'windowsTweaksRevert',
      'windowsTweaksStatus',
      'windowsTweaksGetDnsPresets',
      'windowsTweaksSetDns',
      'windowsTweaksNetshTcp',
    ]) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('benchmark', () => {
    for (const m of ['benchmarkRun', 'benchmarkCancel']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as () => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('license', () => {
    for (const m of ['licenseActivate', 'licenseStatus', 'licenseGetHwid']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('memory', () => {
    for (const m of ['memoryInfo', 'memoryOptimize']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as () => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('watcher', () => {
    for (const m of ['watcherStart', 'watcherStop', 'watcherStatus']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)([])
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('scan profiles', () => {
    it('getScanProfiles calls invoke', async () => {
      mockIpc.invoke.mockResolvedValueOnce([])
      await (api.getScanProfiles as () => Promise<unknown>)()
      expect(mockIpc.invoke).toHaveBeenCalled()
    })
  })

  describe('custom rules', () => {
    for (const m of ['customRulesList', 'customRulesAdd', 'customRulesRemove']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('export', () => {
    it('exportReport calls invoke', async () => {
      mockIpc.invoke.mockResolvedValueOnce(true)
      await (api.exportReport as (...a: unknown[]) => Promise<unknown>)({}, 'json', '/tmp')
      expect(mockIpc.invoke).toHaveBeenCalled()
    })
  })

  describe('logs', () => {
    for (const m of ['logsList', 'logsClear', 'logsExport', 'logsConfigGet', 'logsConfigSet']) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('scan profiles', () => {
    it('setScanProfile calls invoke', async () => {
      mockIpc.invoke.mockResolvedValueOnce(true)
      await (api.setScanProfile as (id: string) => Promise<boolean>)('full')
      expect(mockIpc.invoke).toHaveBeenCalled()
    })
  })

  describe('features A-F', () => {
    const methods = [
      'memoryScan',
      'getTimeline',
      'clearTimeline',
      'getTimelineStats',
      'intelCheckHash',
      'intelCheckDomain',
      'intelCheckIp',
      'intelStats',
      'intelFeeds',
      'intelToggleFeed',
      'intelClear',
      'exploitScan',
      'backupConfigGet',
      'backupConfigSet',
      'backupNow',
      'backupList',
      'backupRestore',
      'backupStorage',
      'sandboxAnalyze',
    ]
    for (const m of methods) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }
  })

  describe('clips', () => {
    const methods = [
      'clipsGetStatus',
      'clipsStartEngine',
      'clipsStopEngine',
      'clipsStartCapture',
      'clipsStopCapture',
      'clipsSaveClip',
      'clipsList',
      'clipsDelete',
      'clipsRename',
      'clipsOpen',
      'clipsGetConfig',
      'clipsSetConfig',
      'clipsSelectOutputDir',
      'clipsGetThumbnail',
      'clipsGetAudioSessions',
      'clipsSetAudioSessions',
      'clipsSetFavorite',
      'clipsGetMicDevices',
      'clipsSetMicDevice',
      'clipsGetGpus',
      'clipsGetRunningProcesses',
      'clipsTrimClip',
      'clipsMergeClips',
    ]
    for (const m of methods) {
      it(`${m} calls invoke`, async () => {
        mockIpc.invoke.mockResolvedValueOnce(null)
        await (api[m] as (...a: unknown[]) => Promise<unknown>)()
        expect(mockIpc.invoke).toHaveBeenCalled()
      })
    }

    it('clipsOnEngineStatus registers listener and returns unsubscribe', () => {
      const cb = vi.fn()
      const unsub = (api.clipsOnEngineStatus as (cb: (...args: unknown[]) => unknown) => () => void)(cb)
      expect(mockIpc.on).toHaveBeenCalledWith(IPC.CLIPS_ENGINE_STATUS, expect.any(Function))
      unsub()
      expect(mockIpc.removeListener).toHaveBeenCalledWith(IPC.CLIPS_ENGINE_STATUS, expect.any(Function))
    })

    it('clipsGetVideoUrl returns clip-video:// URL for Windows path', () => {
      const expected = `clip-video://file?path=${encodeURIComponent('C:\\Users\\test\\clip.mp4')}`
      expect((api.clipsGetVideoUrl as (path: string) => string)('C:\\Users\\test\\clip.mp4')).toBe(expected)
    })

    it('clipsGetVideoUrl handles already normalized path', () => {
      const expected = `clip-video://file?path=${encodeURIComponent('D:/games/clip.mp4')}`
      expect((api.clipsGetVideoUrl as (path: string) => string)('D:/games/clip.mp4')).toBe(expected)
    })

    it('clipsGetVideoUrl handles spaces in path', () => {
      const expected = `clip-video://file?path=${encodeURIComponent('C:\\Users\\test\\my clip.mp4')}`
      expect((api.clipsGetVideoUrl as (path: string) => string)('C:\\Users\\test\\my clip.mp4')).toBe(expected)
    })
  })
})
