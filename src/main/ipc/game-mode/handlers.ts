import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC } from '@shared/channels'
import type { DirectStorageStatus, GameModeAuditReport, GameModeConfig, GameModeProgress } from '@shared/types'
import { ipcMain } from 'electron'
import { loadClipsConfig } from '../../services/clips-config-store'
import type { GameAutoEvent } from '../../services/game-detector'
import {
  isDetectorRunning,
  startGameDetector,
  stopGameDetector,
  suppressCurrentGame,
} from '../../services/game-detector'
import { runGameModeAudit } from '../../services/game-mode-audit'
import { getLogger } from '../../services/logger.service'
import { getSettings } from '../../services/settings-store'
import { startClipCapture } from '../clips-engine-connection'
import type { WindowGetter } from '../index'
import { activateGameMode } from './activate'
import { deactivateGameMode } from './deactivate'
import { deleteSnapshot, readSnapshot } from './snapshot'
import { getGameModeStatus } from './status'
import { validateGameModeConfig } from './validation'

let autoActivated = false

export function registerGameModeIpc(getWindow: WindowGetter): void {
  const sendProgress = (data: GameModeProgress): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.GAME_MODE_PROGRESS, data)
  }

  const sendAutoEvent = (event: GameAutoEvent): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.GAME_MODE_AUTO_EVENT, event)
  }

  ipcMain.handle(IPC.GAME_MODE_ACTIVATE, async (_event, rawConfig: unknown) => {
    const config = validateGameModeConfig(rawConfig)
    if (!config) {
      getLogger().warning('game-mode', 'Invalid Game Mode config received')
      return {
        succeeded: 0,
        failed: 1,
        errors: [{ optimizationId: 'config', reason: 'Invalid config' }],
        snapshot: null,
      }
    }
    const existing = readSnapshot()
    if (existing?.active) {
      getLogger().warning('game-mode', 'Game Mode is already active — re-activation rejected')
      return {
        succeeded: 0,
        failed: 1,
        errors: [{ optimizationId: 'config', reason: 'Game Mode is already active' }],
        snapshot: null,
      }
    }
    if (existing) {
      getLogger().warning(
        'game-mode',
        'Previous deactivation left unrestored items — clearing stale snapshot and re-activating',
      )
      deleteSnapshot()
    }
    autoActivated = false
    return activateGameMode(config, sendProgress)
  })

  ipcMain.handle(IPC.GAME_MODE_DEACTIVATE, async () => {
    getLogger().info('game-mode', 'Deactivation requested via IPC')
    if (autoActivated || isDetectorRunning()) {
      suppressCurrentGame()
    }
    autoActivated = false
    return deactivateGameMode(sendProgress)
  })

  ipcMain.handle(IPC.GAME_MODE_STATUS, () => {
    getLogger().info('game-mode', 'Status requested via IPC')
    return getGameModeStatus()
  })

  ipcMain.handle(IPC.GAME_MODE_RUN_AUDIT, async (_event, phase: unknown) => {
    if (
      typeof phase !== 'string' ||
      !['pre-activation', 'post-activation', 'pre-deactivation', 'post-restore'].includes(phase)
    ) {
      getLogger().warning('game-mode', `Invalid audit phase: ${phase}`)
      throw new Error(`Invalid audit phase: ${phase}`)
    }
    const snapshot = readSnapshot()
    const settings = getSettings()
    return runGameModeAudit(phase as GameModeAuditReport['phase'], {
      config: settings.gameMode,
      snapshot,
    })
  })

  ipcMain.handle(IPC.GAME_MODE_DIRECTSTORAGE_CHECK, async (): Promise<DirectStorageStatus> => {
    getLogger().info('game-mode', 'DirectStorage check requested')
    return checkDirectStorage()
  })

  ipcMain.handle(IPC.GAME_MODE_DETECTOR_START, () => {
    initGameDetector(getWindow, sendProgress, sendAutoEvent)
  })

  ipcMain.handle(IPC.GAME_MODE_DETECTOR_STOP, () => {
    stopGameDetector()
  })
}

async function checkDirectStorage(): Promise<DirectStorageStatus> {
  const steamPaths = [
    'C:\\Program Files (x86)\\Steam\\steamapps\\common',
    'C:\\Program Files\\Steam\\steamapps\\common',
    'D:\\SteamLibrary\\steamapps\\common',
    'E:\\SteamLibrary\\steamapps\\common',
    'F:\\SteamLibrary\\steamapps\\common',
  ]

  let supported = false
  for (const basePath of steamPaths) {
    if (supported) break
    try {
      await access(basePath)
      const entries = await readdir(basePath, { withFileTypes: true })
      const games = entries.filter((d) => d.isDirectory())
      for (const game of games) {
        const gameDir = join(basePath, game.name)
        try {
          const files = await readdir(gameDir)
          if (files.some((f) => f.toLowerCase() === 'directstorage.dll')) {
            supported = true
            break
          }
        } catch {
          /* skip inaccessible game dirs */
        }
      }
    } catch {
      /* skip inaccessible base dirs */
    }
  }

  let nvmeHealthy = true
  const nvmeDrives: DirectStorageStatus['nvmeDrives'] = []
  try {
    const { execFileAsync } = await import('../../services/exec-utf8')
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-PhysicalDisk | Where-Object { $_.BusType -eq "NVMe" } | Select-Object FriendlyName,HealthStatus | ConvertTo-Json -Compress',
      ],
      { timeout: 15000, windowsHide: true },
    )
    const parsed = JSON.parse(String(stdout))
    const drives = Array.isArray(parsed) ? parsed : [parsed]
    for (const d of drives) {
      const health = String(d.HealthStatus ?? 'Unknown')
      const mapped =
        health === 'Healthy'
          ? ('Healthy' as const)
          : health === 'Caution'
            ? ('Caution' as const)
            : health === 'Unhealthy'
              ? ('Bad' as const)
              : ('Unknown' as const)
      nvmeDrives.push({ model: String(d.FriendlyName ?? 'Unknown'), health: mapped, type: 'NVMe' })
      if (mapped !== 'Healthy') nvmeHealthy = false
    }
  } catch {
    nvmeHealthy = false
  }

  return { supported, nvmeHealthy, nvmeDrives }
}

export function initGameDetector(
  _getWindow: WindowGetter,
  sendProgress: (data: GameModeProgress) => void,
  sendAutoEvent: (event: GameAutoEvent) => void,
): void {
  if (process.platform !== 'win32') return

  const settings = getSettings()
  if (!settings.gameMode.autoDetect) {
    stopGameDetector()
    return
  }

  startGameDetector(
    {
      onGameDetected: async (processName) => {
        if (readSnapshot() !== null) return

        const cfg = getSettings().gameMode
        if (cfg.enabledOptimizations.length === 0) return

        const profile = cfg.gameProfiles?.[processName]
        const activeCfg: GameModeConfig = profile ? { ...cfg, enabledOptimizations: profile.enabledOptimizations } : cfg

        autoActivated = true
        await activateGameMode(activeCfg, sendProgress)
        const clipsCfg = loadClipsConfig()
        if (clipsCfg.autoStartCapture) {
          getLogger().info('game-mode', 'autoStartCapture enabled — starting clip capture')
          await startClipCapture()
        }
        sendAutoEvent({ type: 'game-detected', processName })
      },
      onGameExited: async () => {
        if (!autoActivated) return

        const wasAutoActivated = autoActivated
        autoActivated = false

        const cfg = getSettings().gameMode
        if (cfg.autoDeactivate !== false && wasAutoActivated) {
          await deactivateGameMode(sendProgress)
        }

        sendAutoEvent({ type: 'game-exited', processName: null })
      },
    },
    settings.gameMode.customGameProcesses ?? [],
  )
}

export function refreshGameDetector(getWindow: WindowGetter): void {
  const sendProgress = (data: GameModeProgress): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.GAME_MODE_PROGRESS, data)
  }
  const sendAutoEvent = (event: GameAutoEvent): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.GAME_MODE_AUTO_EVENT, event)
  }
  initGameDetector(getWindow, sendProgress, sendAutoEvent)
}
