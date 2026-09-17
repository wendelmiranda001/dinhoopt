import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const callbacks: {
    onGameDetected: ((name: string) => Promise<void>) | null
    onGameExited: (() => Promise<void>) | null
  } = {
    onGameDetected: null,
    onGameExited: null,
  }
  const logger = { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn(), debug: vi.fn() }
  return { handlers, callbacks, logger }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      state.handlers.set(channel, handler)
      return handler
    }),
  },
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
}))

vi.mock('node:fs/promises', () => ({
  access: vi.fn(async () => {}),
  readdir: vi.fn(async () => []),
}))

vi.mock('../../services/exec-utf8', () => ({ execFileAsync: vi.fn(async () => ({ stdout: '[]', stderr: '' })) }))
vi.mock('../../services/logger.service', () => ({ getLogger: () => state.logger }))
vi.mock('../../services/game-detector', () => ({
  isDetectorRunning: vi.fn(() => false),
  startGameDetector: vi.fn(),
  stopGameDetector: vi.fn(),
  suppressCurrentGame: vi.fn(),
}))
vi.mock('../../services/game-mode-audit', () => ({ runGameModeAudit: vi.fn(async () => ({})) }))
vi.mock('../../services/settings-store', () => ({ getSettings: vi.fn() }))
vi.mock('../../services/clips-config-store', () => ({ loadClipsConfig: vi.fn() }))
vi.mock('../clips-engine-connection', () => ({ startClipCapture: vi.fn(async () => ({})) }))
vi.mock('./activate', () => ({
  activateGameMode: vi.fn(async (_cfg: unknown, sendProgress?: (d: unknown) => void) => {
    sendProgress?.({ phase: 'idle', progress: 0 })
    return { succeeded: 1, failed: 0, errors: [], snapshot: {} }
  }),
}))
vi.mock('./deactivate', () => ({ deactivateGameMode: vi.fn(async () => ({ restored: 0 })) }))
vi.mock('./snapshot', () => ({ readSnapshot: vi.fn(() => null), deleteSnapshot: vi.fn() }))
vi.mock('./status', () => ({ getGameModeStatus: vi.fn(() => ({ active: false })) }))
vi.mock('./validation', () => ({ validateGameModeConfig: vi.fn() }))

import { existsSync, readdirSync } from 'node:fs'
import { access, readdir } from 'node:fs/promises'
import { IPC } from '@shared/channels'
import type { GameModeConfig } from '@shared/types'
import { loadClipsConfig } from '../../services/clips-config-store'
import { execFileAsync } from '../../services/exec-utf8'
import {
  isDetectorRunning,
  startGameDetector,
  stopGameDetector,
  suppressCurrentGame,
} from '../../services/game-detector'
import { runGameModeAudit } from '../../services/game-mode-audit'
import { getSettings } from '../../services/settings-store'
import { startClipCapture } from '../clips-engine-connection'
import { activateGameMode } from './activate'
import { deactivateGameMode } from './deactivate'
import { initGameDetector, refreshGameDetector, registerGameModeIpc } from './handlers'
import { deleteSnapshot, readSnapshot } from './snapshot'
import { getGameModeStatus } from './status'
import { validateGameModeConfig } from './validation'

const BASE1 = 'C:\\Program Files (x86)\\Steam\\steamapps\\common'
const BASE4 = 'D:\\SteamLibrary\\steamapps\\common'
const fsTree = new Map<string, { dirs: string[]; files: string[] }>()
let getWindow: ReturnType<typeof vi.fn>

function liveWindow(): { isDestroyed: () => boolean; webContents: { send: ReturnType<typeof vi.fn> } } {
  const win = { isDestroyed: () => false, webContents: { send: vi.fn() } }
  getWindow.mockReturnValue(win)
  return win
}

function setGameMode(overrides: Record<string, unknown> = {}): void {
  vi.mocked(getSettings).mockReturnValue({
    gameMode: {
      autoDetect: false,
      autoDeactivate: true,
      enabledOptimizations: ['optimization-a'],
      gameProfiles: {},
      customGameProcesses: ['custom.exe'],
      ...overrides,
    },
  } as never)
}

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const h = state.handlers.get(channel)
  if (!h) throw new Error(`Handler not registered for ${channel}`)
  return h
}

async function setupDetector(overrides: Record<string, unknown> = {}): Promise<{
  onGameDetected: (name: string) => Promise<void>
  onGameExited: () => Promise<void>
}> {
  setGameMode({ autoDetect: true, ...overrides })
  await getHandler(IPC.GAME_MODE_DETECTOR_START)()
  return {
    onGameDetected: state.callbacks.onGameDetected!,
    onGameExited: state.callbacks.onGameExited!,
  }
}

beforeEach(() => {
  // Reset the module-level autoActivated flag by firing the previous test's
  // exit callback BEFORE clearing mocks, so its side effects are reset below.
  if (state.callbacks.onGameExited) void state.callbacks.onGameExited()

  state.handlers.clear()
  state.logger.info.mockReset()
  state.logger.warning.mockReset()
  state.logger.error.mockReset()
  state.logger.success.mockReset()
  state.logger.debug.mockReset()
  getWindow = vi.fn(() => null)
  fsTree.clear()

  vi.mocked(existsSync).mockReset()
  vi.mocked(readdirSync).mockReset()
  vi.mocked(access).mockReset()
  vi.mocked(readdir).mockReset()
  vi.mocked(execFileAsync).mockReset()
  vi.mocked(isDetectorRunning).mockReset().mockReturnValue(false)
  vi.mocked(startGameDetector).mockReset()
  vi.mocked(startGameDetector).mockImplementation((cbs) => {
    state.callbacks.onGameDetected = (name: string) => Promise.resolve(cbs.onGameDetected(name))
    state.callbacks.onGameExited = () => Promise.resolve(cbs.onGameExited())
  })
  vi.mocked(stopGameDetector).mockReset()
  vi.mocked(suppressCurrentGame).mockReset()
  vi.mocked(runGameModeAudit)
    .mockReset()
    .mockResolvedValue({
      timestamp: '',
      phase: 'pre-activation',
      checks: [],
      summary: { passed: 0, warnings: 0, errors: 0 },
    })
  vi.mocked(getSettings).mockReset()
  setGameMode()
  vi.mocked(loadClipsConfig)
    .mockReset()
    .mockReturnValue({ autoStartCapture: false } as never)
  vi.mocked(startClipCapture).mockReset().mockResolvedValue({ success: true })
  vi.mocked(activateGameMode)
    .mockReset()
    .mockImplementation(async (_cfg, sendProgress) => {
      sendProgress?.({ phase: 'idle', progress: 0 } as never)
      return { succeeded: 1, failed: 0, errors: [] as never[], snapshot: {} as never }
    })
  vi.mocked(deactivateGameMode).mockReset().mockResolvedValue({ restored: 0, failed: 0, errors: [] })
  vi.mocked(readSnapshot).mockReset().mockReturnValue(null)
  vi.mocked(deleteSnapshot).mockReset()
  vi.mocked(getGameModeStatus).mockReset().mockReturnValue({ active: false, activatedAt: null, pendingRestore: false })
  vi.mocked(validateGameModeConfig)
    .mockReset()
    .mockImplementation((c) => (c ?? null) as GameModeConfig | null)

  vi.mocked(existsSync).mockImplementation((p: unknown) => fsTree.has(String(p)))
  vi.mocked(readdirSync).mockImplementation(((p: string, opts?: { withFileTypes?: boolean }) => {
    const e = fsTree.get(p)
    if (!e) throw new Error('ENOENT')
    if (opts?.withFileTypes) return e.dirs.map((name) => ({ name, isDirectory: () => true }))
    return e.files
  }) as never)

  vi.mocked(access).mockImplementation(async (p: unknown) => {
    if (!fsTree.has(String(p))) throw new Error('ENOENT')
  })
  vi.mocked(readdir).mockImplementation((async (p: string, opts?: { withFileTypes?: boolean }) => {
    const e = fsTree.get(p)
    if (!e) throw new Error('ENOENT')
    if (opts?.withFileTypes)
      return e.dirs.map((name) => ({ name, isDirectory: () => true }) as import('node:fs').Dirent)
    return e.files
  }) as never)

  registerGameModeIpc(getWindow as never)
})

describe('registerGameModeIpc', () => {
  it('registers all 7 game mode channels', () => {
    expect(state.handlers.has(IPC.GAME_MODE_ACTIVATE)).toBe(true)
    expect(state.handlers.has(IPC.GAME_MODE_DEACTIVATE)).toBe(true)
    expect(state.handlers.has(IPC.GAME_MODE_STATUS)).toBe(true)
    expect(state.handlers.has(IPC.GAME_MODE_RUN_AUDIT)).toBe(true)
    expect(state.handlers.has(IPC.GAME_MODE_DIRECTSTORAGE_CHECK)).toBe(true)
    expect(state.handlers.has(IPC.GAME_MODE_DETECTOR_START)).toBe(true)
    expect(state.handlers.has(IPC.GAME_MODE_DETECTOR_STOP)).toBe(true)
  })

  it('rejects an invalid config', async () => {
    vi.mocked(validateGameModeConfig).mockReturnValue(null)
    const res = (await getHandler(IPC.GAME_MODE_ACTIVATE)(null, { bad: true })) as {
      succeeded: number
      failed: number
      errors: { optimizationId: string; reason: string }[]
      snapshot: null
    }
    expect(res).toEqual({
      succeeded: 0,
      failed: 1,
      errors: [{ optimizationId: 'config', reason: 'Invalid config' }],
      snapshot: null,
    })
    expect(state.logger.warning).toHaveBeenCalledWith('game-mode', 'Invalid Game Mode config received')
    expect(activateGameMode).not.toHaveBeenCalled()
  })

  it('rejects activation when a snapshot is already active', async () => {
    vi.mocked(readSnapshot).mockReturnValue({ active: true } as never)
    const res = (await getHandler(IPC.GAME_MODE_ACTIVATE)(null, {})) as {
      errors: { reason: string }[]
    }
    expect(res.errors[0]!.reason).toBe('Game Mode is already active')
    expect(state.logger.warning).toHaveBeenCalledWith(
      'game-mode',
      'Game Mode is already active — re-activation rejected',
    )
    expect(activateGameMode).not.toHaveBeenCalled()
  })

  it('clears a stale inactive snapshot before activating', async () => {
    vi.mocked(readSnapshot).mockReturnValue({ active: false } as never)
    const res = (await getHandler(IPC.GAME_MODE_ACTIVATE)(null, {})) as { succeeded: number }
    expect(deleteSnapshot).toHaveBeenCalled()
    expect(state.logger.warning).toHaveBeenCalledWith(
      'game-mode',
      'Previous deactivation left unrestored items — clearing stale snapshot and re-activating',
    )
    expect(activateGameMode).toHaveBeenCalled()
    expect(res.succeeded).toBe(1)
  })

  it('activates on a clean state and forwards progress to the window', async () => {
    const win = liveWindow()
    const res = (await getHandler(IPC.GAME_MODE_ACTIVATE)(null, {})) as { succeeded: number }
    expect(activateGameMode).toHaveBeenCalledWith({}, expect.any(Function))
    expect(res.succeeded).toBe(1)
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.GAME_MODE_PROGRESS, { phase: 'idle', progress: 0 })
  })

  it('deactivates without suppressing when not auto-activated and detector is not running', async () => {
    const res = (await getHandler(IPC.GAME_MODE_DEACTIVATE)()) as { restored: number }
    expect(res.restored).toBe(0)
    expect(deactivateGameMode).toHaveBeenCalledWith(expect.any(Function))
    expect(suppressCurrentGame).not.toHaveBeenCalled()
  })

  it('suppresses the current game when the detector is running', async () => {
    vi.mocked(isDetectorRunning).mockReturnValue(true)
    await getHandler(IPC.GAME_MODE_DEACTIVATE)()
    expect(suppressCurrentGame).toHaveBeenCalled()
  })

  it('suppresses the current game when auto-activated', async () => {
    const { onGameDetected } = await setupDetector()
    await onGameDetected('game.exe')
    await getHandler(IPC.GAME_MODE_DEACTIVATE)()
    expect(suppressCurrentGame).toHaveBeenCalled()
  })

  it('returns the current status', async () => {
    vi.mocked(getGameModeStatus).mockReturnValue({ active: true, snapshot: { active: true } } as never)
    const res = await getHandler(IPC.GAME_MODE_STATUS)()
    expect(res).toEqual({ active: true, snapshot: { active: true } })
    expect(state.logger.info).toHaveBeenCalledWith('game-mode', 'Status requested via IPC')
  })

  it('throws on an invalid audit phase', async () => {
    await expect(getHandler(IPC.GAME_MODE_RUN_AUDIT)(null, 'bogus')).rejects.toThrow('Invalid audit phase: bogus')
    expect(state.logger.warning).toHaveBeenCalledWith('game-mode', 'Invalid audit phase: bogus')
    expect(runGameModeAudit).not.toHaveBeenCalled()
  })

  it('runs an audit with the current config and snapshot for a valid phase', async () => {
    vi.mocked(readSnapshot).mockReturnValue({ active: true } as never)
    vi.mocked(runGameModeAudit).mockResolvedValue({ phase: 'pre-activation' } as never)
    const res = (await getHandler(IPC.GAME_MODE_RUN_AUDIT)(null, 'pre-activation')) as { phase: string }
    expect(res.phase).toBe('pre-activation')
    expect(runGameModeAudit).toHaveBeenCalledWith('pre-activation', {
      config: getSettings().gameMode,
      snapshot: { active: true },
    })
  })
})

describe('checkDirectStorage (via DIRECTSTORAGE_CHECK)', () => {
  it('reports unsupported with healthy NVMe when no steam dirs exist and drives are healthy', async () => {
    vi.mocked(execFileAsync).mockResolvedValue({
      stdout: JSON.stringify([{ FriendlyName: 'NVMe SSD', HealthStatus: 'Healthy' }]),
      stderr: '',
    })
    const res = (await getHandler(IPC.GAME_MODE_DIRECTSTORAGE_CHECK)()) as {
      supported: boolean
      nvmeHealthy: boolean
      nvmeDrives: { model: string; health: string; type: string }[]
    }
    expect(res.supported).toBe(false)
    expect(res.nvmeHealthy).toBe(true)
    expect(res.nvmeDrives).toEqual([{ model: 'NVMe SSD', health: 'Healthy', type: 'NVMe' }])
  })

  it('detects directstorage.dll case-insensitively and maps a single-drive object', async () => {
    fsTree.set(BASE1, { dirs: ['GameA', 'GameB'], files: [] })
    fsTree.set(join(BASE1, 'GameA'), { dirs: [], files: ['DirectStorage.DLL'] })
    vi.mocked(execFileAsync).mockResolvedValue({
      stdout: JSON.stringify({ FriendlyName: 'Slow Disk', HealthStatus: 'Caution' }),
      stderr: '',
    })
    const res = (await getHandler(IPC.GAME_MODE_DIRECTSTORAGE_CHECK)()) as {
      supported: boolean
      nvmeHealthy: boolean
      nvmeDrives: { model: string; health: string; type: string }[]
    }
    expect(res.supported).toBe(true)
    expect(res.nvmeHealthy).toBe(false)
    expect(res.nvmeDrives).toEqual([{ model: 'Slow Disk', health: 'Caution', type: 'NVMe' }])
  })

  it('skips inaccessible game dirs and falls back to nvmeHealthy false on unparsable output', async () => {
    fsTree.set(BASE1, { dirs: ['GameA'], files: [] })
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: 'not-json', stderr: '' })
    const res = (await getHandler(IPC.GAME_MODE_DIRECTSTORAGE_CHECK)()) as {
      supported: boolean
      nvmeHealthy: boolean
      nvmeDrives: unknown[]
    }
    expect(res.supported).toBe(false)
    expect(res.nvmeHealthy).toBe(false)
    expect(res.nvmeDrives).toEqual([])
  })

  it('skips inaccessible base dirs', async () => {
    fsTree.set(BASE1, { dirs: ['GameA'], files: [] })
    fsTree.set(join(BASE1, 'GameA'), { dirs: [], files: ['directstorage.dll'] })
    fsTree.set(BASE4, { dirs: ['GameA'], files: [] })
    vi.mocked(readdir).mockImplementation((async (p: string, opts?: { withFileTypes?: boolean }) => {
      const path = String(p)
      if (path === BASE4) throw new Error('denied')
      const e = fsTree.get(path)
      if (!e) throw new Error('ENOENT')
      if (opts?.withFileTypes)
        return e.dirs.map((name) => ({ name, isDirectory: () => true }) as import('node:fs').Dirent)
      return e.files
    }) as never)
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: '[]', stderr: '' })
    const res = (await getHandler(IPC.GAME_MODE_DIRECTSTORAGE_CHECK)()) as {
      supported: boolean
      nvmeHealthy: boolean
    }
    expect(res.supported).toBe(true)
    expect(res.nvmeHealthy).toBe(true)
  })

  it('maps every NVMe health status to its label', async () => {
    const drives = [
      { FriendlyName: 'A', HealthStatus: 'Healthy' },
      { FriendlyName: 'B', HealthStatus: 'Caution' },
      { FriendlyName: 'C', HealthStatus: 'Unhealthy' },
      {},
    ]
    vi.mocked(execFileAsync).mockResolvedValue({ stdout: JSON.stringify(drives), stderr: '' })
    const res = (await getHandler(IPC.GAME_MODE_DIRECTSTORAGE_CHECK)()) as {
      nvmeHealthy: boolean
      nvmeDrives: { model: string; health: string }[]
    }
    expect(res.nvmeHealthy).toBe(false)
    expect(res.nvmeDrives.map((d) => d.health)).toEqual(['Healthy', 'Caution', 'Bad', 'Unknown'])
    expect(res.nvmeDrives[3]!.model).toBe('Unknown')
  })
})

describe('DETECTOR_START / DETECTOR_STOP', () => {
  it('starts the detector with custom processes when autoDetect is enabled', async () => {
    setGameMode({ autoDetect: true })
    await getHandler(IPC.GAME_MODE_DETECTOR_START)()
    expect(startGameDetector).toHaveBeenCalledWith(
      expect.objectContaining({ onGameDetected: expect.any(Function), onGameExited: expect.any(Function) }),
      ['custom.exe'],
    )
  })

  it('stops the detector without starting it when autoDetect is disabled', async () => {
    await getHandler(IPC.GAME_MODE_DETECTOR_START)()
    expect(stopGameDetector).toHaveBeenCalled()
    expect(startGameDetector).not.toHaveBeenCalled()
  })

  it('uses an empty custom process list when none are configured', async () => {
    setGameMode({ autoDetect: true, customGameProcesses: null })
    await getHandler(IPC.GAME_MODE_DETECTOR_START)()
    expect(startGameDetector).toHaveBeenCalledWith(
      expect.objectContaining({ onGameDetected: expect.any(Function), onGameExited: expect.any(Function) }),
      [],
    )
  })

  it('stops the detector on DETECTOR_STOP', async () => {
    await getHandler(IPC.GAME_MODE_DETECTOR_STOP)()
    expect(stopGameDetector).toHaveBeenCalled()
  })
})

describe('initGameDetector', () => {
  it('returns early on non-Windows platforms', () => {
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true, writable: true })
    try {
      initGameDetector(
        getWindow as never,
        () => {},
        () => {},
      )
      expect(startGameDetector).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true, writable: true })
    }
  })
})

describe('onGameDetected callback', () => {
  it('returns early when a snapshot already exists', async () => {
    vi.mocked(readSnapshot).mockReturnValue({ active: true } as never)
    const { onGameDetected } = await setupDetector()
    await onGameDetected('game.exe')
    expect(activateGameMode).not.toHaveBeenCalled()
  })

  it('returns early when no optimizations are enabled', async () => {
    const { onGameDetected } = await setupDetector({ enabledOptimizations: [] })
    await onGameDetected('game.exe')
    expect(activateGameMode).not.toHaveBeenCalled()
  })

  it('activates with the profile merge and starts clip capture when configured', async () => {
    vi.mocked(loadClipsConfig).mockReturnValue({ autoStartCapture: true } as never)
    const win = liveWindow()
    const { onGameDetected } = await setupDetector({
      gameProfiles: { 'game.exe': { enabledOptimizations: ['p1'] } },
    })
    await onGameDetected('game.exe')
    expect(activateGameMode).toHaveBeenCalledWith(
      expect.objectContaining({ enabledOptimizations: ['p1'] }),
      expect.any(Function),
    )
    expect(startClipCapture).toHaveBeenCalled()
    expect(state.logger.info).toHaveBeenCalledWith('game-mode', 'autoStartCapture enabled — starting clip capture')
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.GAME_MODE_AUTO_EVENT, {
      type: 'game-detected',
      processName: 'game.exe',
    })
  })

  it('activates with the base config and skips clip capture when not configured', async () => {
    const { onGameDetected } = await setupDetector()
    await onGameDetected('game.exe')
    expect(activateGameMode).toHaveBeenCalledWith(
      expect.objectContaining({ enabledOptimizations: ['optimization-a'] }),
      expect.any(Function),
    )
    expect(startClipCapture).not.toHaveBeenCalled()
  })
})

describe('onGameExited callback', () => {
  it('returns early when not auto-activated', async () => {
    const { onGameExited } = await setupDetector()
    await onGameExited()
    expect(deactivateGameMode).not.toHaveBeenCalled()
  })

  it('deactivates and emits the exit event when auto-deactivation is enabled', async () => {
    const win = liveWindow()
    const { onGameDetected, onGameExited } = await setupDetector()
    await onGameDetected('game.exe')
    await onGameExited()
    expect(deactivateGameMode).toHaveBeenCalledWith(expect.any(Function))
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.GAME_MODE_AUTO_EVENT, {
      type: 'game-exited',
      processName: null,
    })
  })

  it('emits the exit event without deactivating when auto-deactivation is disabled', async () => {
    const win = liveWindow()
    const { onGameDetected, onGameExited } = await setupDetector({ autoDeactivate: false })
    await onGameDetected('game.exe')
    await onGameExited()
    expect(deactivateGameMode).not.toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.GAME_MODE_AUTO_EVENT, {
      type: 'game-exited',
      processName: null,
    })
  })
})

describe('refreshGameDetector', () => {
  it('forwards the window to initGameDetector and starts the detector', () => {
    setGameMode({ autoDetect: true })
    refreshGameDetector(getWindow as never)
    expect(startGameDetector).toHaveBeenCalled()
  })

  it('sends progress and auto events when a live window is present', async () => {
    setGameMode({ autoDetect: true })
    const win = liveWindow()
    refreshGameDetector(getWindow as never)
    await state.callbacks.onGameDetected!('game.exe')
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.GAME_MODE_PROGRESS, { phase: 'idle', progress: 0 })
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.GAME_MODE_AUTO_EVENT, {
      type: 'game-detected',
      processName: 'game.exe',
    })
    await state.callbacks.onGameExited!()
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.GAME_MODE_AUTO_EVENT, {
      type: 'game-exited',
      processName: null,
    })
  })

  it('skips sending when no window is present', async () => {
    setGameMode({ autoDetect: true })
    refreshGameDetector(getWindow as never)
    await state.callbacks.onGameDetected!('game.exe')
    await state.callbacks.onGameExited!()
    expect(deactivateGameMode).toHaveBeenCalled()
  })

  it('skips sending when the window is destroyed', async () => {
    setGameMode({ autoDetect: true })
    const win = { isDestroyed: () => true, webContents: { send: vi.fn() } }
    getWindow.mockReturnValue(win)
    refreshGameDetector(getWindow as never)
    await state.callbacks.onGameDetected!('game.exe')
    expect(win.webContents.send).not.toHaveBeenCalled()
  })
})
