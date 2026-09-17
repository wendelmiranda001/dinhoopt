import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { IPC, RENDERER_LOG } from '@shared/channels'
import type { LogLevel } from '@shared/types'
import { app, type BrowserWindow, dialog, ipcMain, shell } from 'electron'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  installUpdate,
  setAutoDownload,
  updateCheckInterval,
} from '../services/auto-updater'
import { getBackupDir } from '../services/backup-dir'
import { isAdmin } from '../services/elevation'
import { psUtf8 } from '../services/exec-utf8'
import { addHistoryEntry, clearHistory, getHistory } from '../services/history-store'
import { validateHistoryEntry, validateSettingsPartial } from '../services/ipc-validation'
import { getLogger } from '../services/logger.service'
import type { MemoryOptimizeProgress } from '../services/memory-optimizer'
import { getMemoryInfo, getMemoryProcesses, optimizeMemory } from '../services/memory-optimizer'
import {
  flushSettings,
  getOnboardingComplete,
  getSettings,
  setOnboardingComplete,
  setSettings,
} from '../services/settings-store'
import { registerAppCleanerIpc } from './app-cleaner.ipc'
import { registerAppInstallerIpc } from './app-installer.ipc'
import { registerBenchmarkIpc } from './benchmark.ipc'
import { registerBrowserCleanerIpc } from './browser-cleaner.ipc'
import { registerClipsIpc } from './clips.ipc'
import { registerComplianceAuditorIpc } from './compliance-auditor.ipc'
import { registerContextMenuCleanerIpc } from './context-menu-cleaner.ipc'
import { registerDatabaseOptimizerIpc } from './database-optimizer.ipc'
import { registerDebloaterIpc } from './debloater.ipc'
import { registerDiskAnalyzerIpc } from './disk-analyzer.ipc'
import { registerDiskTrimIpc } from './disk-trim.ipc'
import { registerDriverAgentIpc } from './driver-agent.ipc'
import { registerDriverManagerIpc } from './driver-manager.ipc'
import { registerDuplicateFinderIpc } from './duplicate-finder.ipc'
import { registerEmptyFolderCleanerIpc } from './empty-folder-cleaner.ipc'
import { registerEnvironmentCleanerIpc } from './environment-cleaner.ipc'
import { registerFileShredderIpc } from './file-shredder.ipc'
import { registerFirewallAuditIpc } from './firewall-audit.ipc'
import { refreshGameDetector, registerGameModeIpc } from './game-mode.ipc'
import { registerGamingCleanerIpc } from './gaming-cleaner.ipc'
import { registerHostsEditorIpc } from './hosts-editor.ipc'
import { registerLargeFileFinderIpc } from './large-file-finder.ipc'
import { registerLicenseIpc } from './license.ipc'
import { registerLoggerIpc } from './logger.ipc'
import { registerMalwareScannerIpc } from './malware-scanner.ipc'
import { registerNetworkCleanupIpc } from './network-cleanup.ipc'
import { registerNetworkMonitorIpc } from './network-monitor.ipc'
import { registerPerfMonitorIpc } from './perf-monitor.ipc'
import { registerPowerPlansIpc } from './power-plans.ipc'
import { registerPrivacyShieldIpc } from './privacy-shield.ipc'
import { registerProgramSafetyIpc } from './program-safety.ipc'
import { registerProgramUninstallerIpc } from './program-uninstaller.ipc'
import { registerRecycleBinIpc } from './recycle-bin.ipc'
import { registerRegistryCleanerIpc } from './registry-cleaner.ipc'
import { registerServiceManagerIpc } from './service-manager.ipc'
import { registerShortcutCleanerIpc } from './shortcut-cleaner.ipc'
import { registerSoftwareUpdaterIpc } from './software-updater.ipc'
import { registerStartupManagerIpc } from './startup-manager.ipc'
import { registerStartupSafetyIpc } from './startup-safety.ipc'
import { registerSystemCleanerIpc } from './system-cleaner.ipc'
import { registerUninstallLeftoversIpc } from './uninstall-leftovers.ipc'
import { registerVulnerabilityScannerIpc } from './vulnerability-scanner.ipc'
import { registerWindowsTweaksIpc } from './windows-tweaks.ipc'
import { registerWinSxSCleanerIpc } from './winsxs-cleaner.ipc'

export type WindowGetter = () => BrowserWindow | null

export function registerCleanerIpc(getWindow: WindowGetter): void {
  registerSystemCleanerIpc(getWindow)
  registerBrowserCleanerIpc(getWindow)
  registerAppCleanerIpc(getWindow)
  registerGamingCleanerIpc(getWindow)
  registerRecycleBinIpc()
  registerShortcutCleanerIpc(getWindow)
  registerEnvironmentCleanerIpc(getWindow)
  registerDatabaseOptimizerIpc(getWindow)
  registerRegistryCleanerIpc(getWindow)
  registerContextMenuCleanerIpc(getWindow)
  registerStartupManagerIpc(getWindow)
  registerDebloaterIpc(getWindow)
  registerDiskAnalyzerIpc(getWindow)
  registerDiskTrimIpc(getWindow)
  registerDuplicateFinderIpc(getWindow)
  registerLargeFileFinderIpc(getWindow)
  registerEmptyFolderCleanerIpc(getWindow)
  registerNetworkCleanupIpc(getWindow)
  registerNetworkMonitorIpc(getWindow)
  registerMalwareScannerIpc(getWindow)
  registerUninstallLeftoversIpc(getWindow)
  registerComplianceAuditorIpc(getWindow)
  registerVulnerabilityScannerIpc(getWindow)
  registerPrivacyShieldIpc(getWindow)
  registerDriverManagerIpc(getWindow)
  registerDriverAgentIpc(getWindow)
  registerPerfMonitorIpc(getWindow)
  registerProgramUninstallerIpc(getWindow)
  registerServiceManagerIpc(getWindow)
  registerFirewallAuditIpc(getWindow)
  registerSoftwareUpdaterIpc(getWindow)
  registerAppInstallerIpc(getWindow)
  registerStartupSafetyIpc()
  registerProgramSafetyIpc()
  registerFileShredderIpc(getWindow)
  registerGameModeIpc(getWindow)
  registerWindowsTweaksIpc(getWindow)
  registerLicenseIpc()
  registerBenchmarkIpc(getWindow)
  registerPowerPlansIpc()
  registerLoggerIpc()
  registerHostsEditorIpc(getWindow)
  registerWinSxSCleanerIpc(getWindow)
  registerClipsIpc()

  // Renderer-side log relay
  ipcMain.on(RENDERER_LOG, (_event, level: string, message: string) => {
    getLogger().log(level as LogLevel, 'Renderer', message)
  })

  ipcMain.handle(IPC.CLEANER_OPEN_LOCATION, (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') return
    if (!isAbsolute(filePath)) return
    shell.showItemInFolder(filePath)
  })

  // Platform info
  const isWin = process.platform === 'win32'
  ipcMain.handle(IPC.PLATFORM_INFO, () => ({
    platform: process.platform as 'win32',
    features: {
      registry: isWin,
      debloater: isWin,
      drivers: isWin,
      bootTrace: isWin,
      gameMode: isWin,
      compliance: isWin,
      vulnerability: isWin,
      firewallAudit: isWin,
      contextMenu: isWin,
      windowsTweaks: isWin,
      benchmark: isWin,
      clips: isWin,
    },
  }))

  // Settings — validate shape before persisting
  ipcMain.handle(IPC.SETTINGS_GET, () => getSettings())
  ipcMain.handle(IPC.SETTINGS_SET, async (_event, settings) => {
    const validated = validateSettingsPartial(settings)
    if (!validated) return { success: false, error: 'Invalid settings' }
    setSettings(validated)
    if (typeof validated.autoUpdate === 'boolean') {
      setAutoDownload(validated.autoUpdate)
    }
    if (typeof validated.updateCheckIntervalHours === 'number') {
      updateCheckInterval(validated.updateCheckIntervalHours)
    }
    if (typeof validated.language === 'string') {
      await flushSettings()
      app.emit('dinho:language-changed')
    }
    // Restart game detector when gameMode settings change
    if ('gameMode' in validated) {
      await flushSettings()
      refreshGameDetector(getWindow)
    }
    return { success: true }
  })

  // Settings — pick a backup folder via the OS folder picker
  ipcMain.handle(IPC.SETTINGS_SELECT_BACKUP_DIR, async () => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Escolher pasta de backup do DiNho Optimizer',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: getBackupDir(),
    }
    const result = !win ? await dialog.showOpenDialog(opts) : await dialog.showOpenDialog(win, opts)
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  // Settings — reveal the active backup folder in the OS file manager
  ipcMain.handle(IPC.SETTINGS_OPEN_BACKUP_DIR, async () => {
    const dir = getBackupDir()
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      /* skip */
    }
    await shell.openPath(dir)
    return dir
  })

  // Onboarding
  ipcMain.handle(IPC.ONBOARDING_GET, () => getOnboardingComplete())
  ipcMain.handle(IPC.ONBOARDING_SET, async (_event, value: boolean) => {
    if (typeof value !== 'boolean') return
    await setOnboardingComplete(value)
  })

  // Elevation
  ipcMain.handle(IPC.ELEVATION_CHECK, () => isAdmin())
  ipcMain.handle(IPC.ELEVATION_RELAUNCH, () => {
    const exePath = app.getPath('exe')

    if (process.platform === 'win32') {
      // Use execFile so we wait for PowerShell to finish (including the UAC
      // prompt).  Start-Process -Verb RunAs blocks until the user accepts or
      // declines UAC, then returns.  If the user declines, PowerShell exits
      // with an error and we don't quit.
      const psScript = `Start-Process -FilePath '${exePath.replace(/'/g, "''")}' -Verb RunAs`
      execFile('powershell.exe', ['-NoProfile', '-Command', psUtf8(psScript)], { windowsHide: true }, (err) => {
        if (!err) {
          app.releaseSingleInstanceLock()
          app.exit(0)
        }
      })
    }
  })

  // Memory Optimizer
  ipcMain.handle(IPC.MEMORY_INFO, async () => {
    const [info, processes] = await Promise.all([getMemoryInfo(), getMemoryProcesses()])
    return { info, processes }
  })

  ipcMain.handle(IPC.MEMORY_OPTIMIZE, async () => {
    const win = getWindow()
    const result = await optimizeMemory((progress: MemoryOptimizeProgress) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.MEMORY_PROGRESS, progress)
      }
    })
    return result
  })

  // Scan history — validate entry shape before persisting
  ipcMain.handle(IPC.HISTORY_GET, () => getHistory())
  ipcMain.handle(IPC.HISTORY_ADD, (_event, entry) => {
    const validated = validateHistoryEntry(entry)
    if (validated) addHistoryEntry(validated)
  })
  ipcMain.handle(IPC.HISTORY_CLEAR, () => clearHistory())

  // Auto-updater
  ipcMain.handle(IPC.UPDATER_CHECK, () => checkForUpdates())
  ipcMain.handle(IPC.UPDATER_DOWNLOAD, () => downloadUpdate())
  ipcMain.handle(IPC.UPDATER_INSTALL, async (): Promise<boolean> => {
    try {
      await installUpdate()
      return true
    } catch (err) {
      getLogger().error('updater', `Update install failed: ${String(err)}`)
      return false
    }
  })
  ipcMain.handle(IPC.UPDATER_GET_STATUS, () => getUpdateStatus())
}
