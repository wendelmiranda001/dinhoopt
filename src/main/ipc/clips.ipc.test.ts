import { describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}))

const mockSocket = {
  on: vi.fn((_event: string, cb: () => void) => {
    if (_event === 'connect') cb()
    return mockSocket
  }),
  destroy: vi.fn(),
  write: vi.fn(),
  end: vi.fn(),
  setTimeout: vi.fn(),
  removeAllListeners: vi.fn(),
}
vi.mock('node:net', () => ({
  connect: vi.fn(() => mockSocket),
}))

vi.mock('node:fs', () => ({
  copyFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  renameSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

function enoentError(): Error {
  return Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
}

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockRejectedValue(enoentError()),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  rename: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: {
    getFocusedWindow: vi.fn(),
    getAllWindows: vi.fn(() => []),
  },
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/mock/user-data'),
  },
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}))

const mockTrackChildProcess = vi.hoisted(() => vi.fn(() => () => {}))
vi.mock('../services/exec-utf8', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/exec-utf8')>()
  return {
    ...mod,
    trackChildProcess: mockTrackChildProcess,
  }
})

const mockUploadClipToGofile = vi.hoisted(() => vi.fn())
vi.mock('../services/clips-publish', () => ({
  uploadClipToGofile: mockUploadClipToGofile,
}))

const mockIsPipeConnected = vi.hoisted(() => vi.fn().mockReturnValue(false))
const mockIsEngineRunning = vi.hoisted(() => vi.fn().mockReturnValue(false))
const mockSendWithFallback = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }))
const mockSendPipeCommand = vi.hoisted(() => vi.fn().mockResolvedValue({ cmd: 'test', payload: {} }))
const mockSendPipeCommandLongRunning = vi.hoisted(() => vi.fn().mockResolvedValue({ cmd: 'test', payload: {} }))
const mockSetEngineCapturing = vi.hoisted(() => vi.fn())
const mockInvalidateDurationCache = vi.hoisted(() => vi.fn())

const realInvalidateDurationCache = vi.hoisted(() => {
  let fn: (() => void) | null = null
  return {
    set: (f: () => void) => {
      fn = f
    },
    call: () => fn?.(),
  }
})

vi.mock('./clips-engine-connection', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./clips-engine-connection')>()
  realInvalidateDurationCache.set(mod.invalidateDurationCache)
  return {
    ...mod,
    isPipeConnected: mockIsPipeConnected,
    isEngineRunning: mockIsEngineRunning,
    sendWithFallback: mockSendWithFallback,
    sendPipeCommand: mockSendPipeCommand,
    sendPipeCommandLongRunning: mockSendPipeCommandLongRunning,
    setEngineCapturing: mockSetEngineCapturing,
    invalidateDurationCache: mockInvalidateDurationCache,
  }
})

function resetEngineMocks(): void {
  mockIsPipeConnected.mockReturnValue(false)
  mockIsEngineRunning.mockReturnValue(false)
  mockSendWithFallback.mockResolvedValue({ success: true })
  mockSendPipeCommand.mockResolvedValue({ cmd: 'test', payload: {} })
  mockSendPipeCommandLongRunning.mockResolvedValue({ cmd: 'test', payload: {} })
  mockSetEngineCapturing.mockReset()
  mockInvalidateDurationCache.mockReset()
}

import type { NonSharedBuffer } from 'node:buffer'
import type { ExecFileException, ExecFileOptions } from 'node:child_process'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, stat as fsStat, mkdir, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { IPC } from '@shared/channels'
import type { AudioSessionInfo, ClipInfo, ClipMergeResult, ClipTrimResult, MicDeviceInfo } from '@shared/types'
import { ipcMain, shell } from 'electron'
import { config as clipsConfig } from '../services/clips-config-manager'
import { registerClipsIpc } from './clips.ipc'
import { resetClipsCache, stopEngineProcess } from './clips-engine-connection'

function captureHandlers(): Map<string, (...args: any[]) => any> {
  const handlers = new Map<string, (...args: any[]) => any>()
  vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
    handlers.set(channel, handler)
    return undefined as never
  })
  registerClipsIpc()
  return handlers
}

function getSyncHandler<T>(handlers: Map<string, (...args: any[]) => any>, channel: string): () => T {
  const handler = handlers.get(channel)!
  return () => handler() as T
}

function getAsyncHandler(handlers: Map<string, (...args: any[]) => any>, channel: string) {
  return handlers.get(channel)!
}

describe('registerClipsIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all 24 clip handlers', () => {
    const handlers = captureHandlers()
    const expectedChannels = [
      IPC.CLIPS_GET_STATUS,
      IPC.CLIPS_START_ENGINE,
      IPC.CLIPS_STOP_ENGINE,
      IPC.CLIPS_START_CAPTURE,
      IPC.CLIPS_STOP_CAPTURE,
      IPC.CLIPS_SAVE_CLIP,
      IPC.CLIPS_LIST_CLIPS,
      IPC.CLIPS_DELETE_CLIP,
      IPC.CLIPS_OPEN_CLIP,
      IPC.CLIPS_GET_CONFIG,
      IPC.CLIPS_SET_CONFIG,
      IPC.CLIPS_SELECT_OUTPUT_DIR,
      IPC.CLIPS_GET_AUDIO_SESSIONS,
      IPC.CLIPS_SET_AUDIO_SESSIONS,
      IPC.CLIPS_GET_THUMBNAIL,
      IPC.CLIPS_GET_RUNNING_PROCESSES,
      IPC.CLIPS_GET_MIC_DEVICES,
      IPC.CLIPS_SET_FAVORITE,
      IPC.CLIPS_GET_GPUS,
      IPC.CLIPS_GET_ENHANCE_SUPPORT,
      IPC.CLIPS_TRIM_CLIP,
      IPC.CLIPS_MERGE_CLIPS,
      IPC.CLIPS_RENAME_CLIP,
      IPC.CLIPS_PUBLISH,
      IPC.CLIPS_PUBLISH_CANCEL,
      IPC.CLIPS_OPEN_EXTERNAL,
    ]
    for (const ch of expectedChannels) {
      expect(handlers.has(ch)).toBe(true)
    }
    expect(handlers.size).toBe(26)
  })
})

describe('CLIPS_GET_STATUS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns initial engine status (not running, not capturing)', () => {
    const handlers = captureHandlers()
    const status = getSyncHandler<Record<string, unknown>>(handlers, IPC.CLIPS_GET_STATUS)()
    expect(status.running).toBe(false)
    expect(status.capturing).toBe(false)
    expect(status.uptime).toBe(0)
    expect(status.fps).toBe(60)
    expect(status.replayTimeSeconds).toBe(120)
    expect(status.captureBackend).toBeUndefined()
    expect(status.encoder).toBeUndefined()
    expect(status.estimatedRamMB).toBeUndefined()
    expect(status.diskSpaceOk).toBe(true)
    expect(status.currentGame).toBeUndefined()
    expect(status.lastCrashRecovered).toBeUndefined()
  })
})

describe('CLIPS_LIST_CLIPS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    realInvalidateDurationCache.call()
    resetClipsCache()
  })

  function mockDuration(stderr: string) {
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '', stderr)
        return undefined as never
      },
    )
  }

  it('returns empty array when output directory does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const handlers = captureHandlers()
    const list = (await getAsyncHandler(handlers, IPC.CLIPS_LIST_CLIPS)()) as ClipInfo[]
    expect(list).toEqual([])
  })

  it('returns sorted clips from disk', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdir).mockResolvedValue(['clip2.mp4', 'clip1.mp4'] as unknown as Awaited<ReturnType<typeof readdir>>)
    mockDuration('Duration: 00:01:30.50, start: 0.000000, bitrate: 1000 kb/s\n')

    const statMock = vi.mocked(stat)
    statMock.mockResolvedValueOnce({
      size: 100,
      birthtime: new Date('2026-06-20T10:00:00Z'),
      mtime: new Date('2026-06-20T10:00:00Z'),
    } as Awaited<ReturnType<typeof stat>>)
    statMock.mockResolvedValueOnce({
      size: 200,
      birthtime: new Date('2026-06-21T10:00:00Z'),
      mtime: new Date('2026-06-21T10:00:00Z'),
    } as Awaited<ReturnType<typeof stat>>)

    const handlers = captureHandlers()
    const list = (await getAsyncHandler(handlers, IPC.CLIPS_LIST_CLIPS)()) as ClipInfo[]
    expect(list).toHaveLength(2)
    expect(list[0]!.name).toBe('clip1.mp4')
    expect(list[0]!.size).toBe(200)
    expect(list[1]!.name).toBe('clip2.mp4')
    expect(list[1]!.size).toBe(100)
  })

  it('falls back to mtime when birthtime is epoch 0 (FAT32/exFAT)', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdir).mockResolvedValue(['clip.mp4'] as unknown as Awaited<ReturnType<typeof readdir>>)
    mockDuration('Duration: 00:01:00.00, start: 0.000000, bitrate: 1000 kb/s\n')
    vi.mocked(stat).mockResolvedValue({
      size: 100,
      birthtime: new Date(0),
      mtime: new Date('2026-06-21T10:00:00Z'),
    } as Awaited<ReturnType<typeof stat>>)

    const handlers = captureHandlers()
    const list = (await getAsyncHandler(handlers, IPC.CLIPS_LIST_CLIPS)()) as ClipInfo[]
    expect(list).toHaveLength(1)
    expect(list[0]!.createdAt).toBe('2026-06-21T10:00:00.000Z')
  })

  it('filters out non-mp4 files', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdir).mockResolvedValue(['clip.mp4', 'notes.txt', 'image.png'] as unknown as Awaited<
      ReturnType<typeof readdir>
    >)
    vi.mocked(stat).mockResolvedValue({ size: 50, birthtime: new Date(), mtime: new Date() } as Awaited<
      ReturnType<typeof stat>
    >)
    mockDuration('Duration: 00:01:00.00\n')

    const handlers = captureHandlers()
    const list = (await getAsyncHandler(handlers, IPC.CLIPS_LIST_CLIPS)()) as ClipInfo[]
    expect(list).toHaveLength(1)
    expect(list[0]!.name).toBe('clip.mp4')
  })

  it('skips files that fail to stat', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdir).mockResolvedValue(['good.mp4', 'bad.mp4'] as unknown as Awaited<ReturnType<typeof readdir>>)
    mockDuration('Duration: 00:00:30.00\n')
    vi.mocked(stat)
      .mockResolvedValueOnce({ size: 50, birthtime: new Date(), mtime: new Date() } as Awaited<ReturnType<typeof stat>>)
      .mockRejectedValueOnce(new Error('permission denied'))

    const handlers = captureHandlers()
    const list = (await getAsyncHandler(handlers, IPC.CLIPS_LIST_CLIPS)()) as ClipInfo[]
    expect(list).toHaveLength(1)
    expect(list[0]!.name).toBe('good.mp4')
  })

  it('populates duration from ffmpeg via background computation', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdir).mockResolvedValue(['clip.mp4'] as unknown as Awaited<ReturnType<typeof readdir>>)
    vi.mocked(stat).mockResolvedValue({ size: 100, birthtime: new Date(), mtime: new Date() } as Awaited<
      ReturnType<typeof stat>
    >)
    mockDuration('Duration: 00:01:30.50, start: 0.000000, bitrate: 1000 kb/s\n')

    const handlers = captureHandlers()
    const list = (await getAsyncHandler(handlers, IPC.CLIPS_LIST_CLIPS)()) as ClipInfo[]
    expect(list).toHaveLength(1)
    // First call returns 0 (background computation in progress)
    expect(list[0]!.duration).toBe(0)

    // Wait for microtasks to flush (mock execFile is synchronous)
    await new Promise((r) => setTimeout(r, 0))

    // Second call should have cached duration
    const list2 = (await getAsyncHandler(handlers, IPC.CLIPS_LIST_CLIPS)()) as ClipInfo[]
    expect(list2).toHaveLength(1)
    // 90.5s rounds to 91
    expect(list2[0]!.duration).toBe(91)
  })

  it('returns 0 duration when ffmpeg fails', async () => {
    realInvalidateDurationCache.call()
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdir).mockResolvedValue(['clip.mp4'] as unknown as Awaited<ReturnType<typeof readdir>>)
    vi.mocked(stat).mockResolvedValue({ size: 100, birthtime: new Date(), mtime: new Date() } as Awaited<
      ReturnType<typeof stat>
    >)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(new Error('ffmpeg not found'), '', '')
        return undefined as never
      },
    )

    const handlers = captureHandlers()
    const list = (await getAsyncHandler(handlers, IPC.CLIPS_LIST_CLIPS)()) as ClipInfo[]
    expect(list).toHaveLength(1)
    expect(list[0]!.duration).toBe(0)
  })

  it('recomputes duration after a failed probe cached a zero', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdir).mockResolvedValue(['clip.mp4'] as unknown as Awaited<ReturnType<typeof readdir>>)
    vi.mocked(stat).mockResolvedValue({ size: 100, birthtime: new Date(), mtime: new Date() } as Awaited<
      ReturnType<typeof stat>
    >)

    // Phase 1: ffmpeg probe fails — 0 must not poison the duration cache
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(new Error('ffmpeg not found'), '', '')
        return undefined as never
      },
    )
    const handler = getAsyncHandler(captureHandlers(), IPC.CLIPS_LIST_CLIPS)
    const first = (await handler()) as ClipInfo[]
    expect(first[0]!.duration).toBe(0)
    await new Promise((r) => setTimeout(r, 0))

    // Phase 2: ffmpeg works — the stale zero is refetched instead of stuck
    mockDuration('Duration: 00:01:30.50, start: 0.000000, bitrate: 1000 kb/s\n')
    await handler()
    await new Promise((r) => setTimeout(r, 0))
    const third = (await handler()) as ClipInfo[]
    expect(third[0]!.duration).toBe(91)
  })

  it('re-reads the disk on every call so manual refresh picks up new clips', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    mockDuration('Duration: 00:01:00.00\n')
    const readdirMock = vi.mocked(readdir)
    readdirMock.mockResolvedValueOnce(['clip1.mp4'] as unknown as Awaited<ReturnType<typeof readdir>>)
    vi.mocked(stat).mockResolvedValue({
      size: 100,
      birthtime: new Date(),
      mtime: new Date(),
    } as Awaited<ReturnType<typeof stat>>)

    const handler = getAsyncHandler(captureHandlers(), IPC.CLIPS_LIST_CLIPS)
    const first = (await handler()) as ClipInfo[]
    expect(first).toHaveLength(1)

    readdirMock.mockResolvedValueOnce(['clip1.mp4', 'clip2.mp4'] as unknown as Awaited<ReturnType<typeof readdir>>)
    const second = (await handler()) as ClipInfo[]
    expect(second).toHaveLength(2)
  })
})

describe('CLIPS_DELETE_CLIP', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes a clip with a valid name', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(unlink).mockResolvedValue(undefined)
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_DELETE_CLIP)
    const result = (await handler({}, 'myclip.mp4')) as { success: boolean }
    expect(result.success).toBe(true)
    expect(unlink).toHaveBeenCalled()
  })

  it('rejects non-string clipName', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_DELETE_CLIP)
    const result = (await handler({}, 123)) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid clip name')
    expect(unlink).not.toHaveBeenCalled()
  })

  it('catches unlink errors', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(unlink).mockRejectedValue(new Error('Access denied'))
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_DELETE_CLIP)
    const result = (await handler({}, 'myclip.mp4')) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Access denied')
  })

  it('rejects path traversal in clipName', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_DELETE_CLIP)
    const result = (await handler({}, '../../../Windows/system.ini')) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid path')
  })

  it('handles non-Error exception from unlink', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(unlink).mockRejectedValue('disk-error')
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_DELETE_CLIP)
    const result = (await handler({}, 'myclip.mp4')) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('disk-error')
  })
})

describe('CLIPS_OPEN_CLIP', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clipsConfig.outputDirectory = ''
  })

  it('opens a clip with a valid path', async () => {
    vi.mocked(shell.openPath).mockResolvedValue('')
    clipsConfig.outputDirectory = 'C:\\clips'
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_OPEN_CLIP)
    await handler({}, 'C:\\clips\\clip.mp4')
    expect(shell.openPath).toHaveBeenCalledWith('C:\\clips\\clip.mp4')
  })

  it('opens the output directory itself (open folder button)', async () => {
    vi.mocked(shell.openPath).mockResolvedValue('')
    clipsConfig.outputDirectory = 'C:\\clips'
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_OPEN_CLIP)
    await handler({}, 'C:\\clips')
    expect(shell.openPath).toHaveBeenCalledWith('C:\\clips')
  })

  it('ignores non-string path', async () => {
    clipsConfig.outputDirectory = 'C:\\clips'
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_OPEN_CLIP)
    await handler({}, null)
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('rejects path traversal outside output directory', async () => {
    clipsConfig.outputDirectory = 'C:\\clips'
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_OPEN_CLIP)
    await handler({}, 'C:\\clips\\..\\..\\Windows\\system.ini')
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('rejects Unix-style path traversal in CLIPS_OPEN_CLIP', async () => {
    clipsConfig.outputDirectory = 'C:\\clips'
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_OPEN_CLIP)
    await handler({}, '../../../etc/passwd')
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('handles shell error gracefully', async () => {
    vi.mocked(shell.openPath).mockRejectedValue(new Error('no app'))
    clipsConfig.outputDirectory = 'C:\\clips'
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_OPEN_CLIP)
    await handler({}, 'C:\\clips\\clip.mp4')
    // Should not throw; error is logged internally
    expect(shell.openPath).toHaveBeenCalled()
  })
})

describe('CLIPS_GET_CONFIG', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clipsConfig.outputDirectory = ''
  })

  it('returns default config with all fields', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    const handlers = captureHandlers()
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.replayTimeSeconds).toBe(120)
    expect(cfg.micEnabled).toBe(true)
    expect(cfg.audioLoopback).toBe(false)
    expect(cfg.fps).toBe(60)
    expect(cfg.width).toBe(1280)
    expect(cfg.height).toBe(720)
    expect(cfg.bitrateKbps).toBe(30000)

    expect(cfg.maxrateKbps).toBe(30000)
    expect(cfg.bufsizeKbps).toBe(60000)
    expect(cfg.bframes).toBe(3)
    expect(cfg.lookahead).toBe(16)
    expect(cfg.encoderPreset).toBe('p5')
    expect(cfg.outputDirectory).toContain('DiNho Clips')
    expect(cfg.forceSoftware).toBe(false)
    expect(cfg.pushToTalk).toBe('hold')
    expect(cfg.pushToTalkKeys).toEqual([5, 20])
    expect(cfg.gameDetection).toBe(true)
    expect(cfg.gameAudioOnly).toBe(true)
    const hk = cfg.hotkeys as Array<Record<string, unknown>>
    expect(hk).toHaveLength(3)
    expect(hk[0]).toMatchObject({
      vk: 123,
      action: 'saveClip',
      modifiers: [],
      enabled: true,
      replayDurationSeconds: 300,
    })
    expect(hk[1]).toMatchObject({
      vk: 122,
      action: 'saveClip',
      modifiers: [],
      enabled: true,
      replayDurationSeconds: 120,
    })
    expect(hk[2]).toMatchObject({
      vk: 49,
      modifiers: ['Alt'],
      action: 'toggleCapture',
      enabled: true,
      replayDurationSeconds: 60,
    })
  })
})

describe('CLIPS_START_ENGINE', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when engine executable not found', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_START_ENGINE)
    const result = (await handler()) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('CLIPS_START_ENGINE success + stopEngineProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function startEngine() {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_START_ENGINE)
    return { handlers, handler }
  }

  function makeMockChild() {
    return {
      pid: 42,
      kill: vi.fn(),
      killed: false,
      removeAllListeners: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
    }
  }

  function startEngineAndVerifySuccess() {
    vi.mocked(existsSync).mockReturnValue(true)
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    return child
  }

  it('starts engine successfully', async () => {
    const child = startEngineAndVerifySuccess()
    const { handler } = startEngine()
    const result = (await handler()) as { success: boolean }
    expect(result.success).toBe(true)
    expect(spawn).toHaveBeenCalled()
    // cleanup so next test has fresh state
    stopEngineProcess()
    expect(child.kill).toHaveBeenCalled()
  })

  it('stopEngineProcess kills the engine process', async () => {
    const child = startEngineAndVerifySuccess()
    const { handler } = startEngine()
    await handler()

    stopEngineProcess()

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('stopEngineProcess is no-op when engine not running', () => {
    expect(() => stopEngineProcess()).not.toThrow()
  })

  it('CLIPS_STOP_ENGINE handler delegates to stopEngineProcess', async () => {
    const child = startEngineAndVerifySuccess()
    const { handlers, handler } = startEngine()
    await handler()

    const stopHandler = getAsyncHandler(handlers, IPC.CLIPS_STOP_ENGINE)
    const result = (await stopHandler()) as { success: boolean }
    expect(result.success).toBe(true)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })
})

describe('CLIPS_SET_CONFIG', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns success when pipe is not connected and clamps fps to 60', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    const result = (await handler({}, { fps: 120 })) as { success: boolean; error?: string }
    expect(result.success).toBe(true)
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.fps).toBe(60)
  })

  it('updates outputDirectory when set via config', async () => {
    vi.mocked(fsStat).mockResolvedValue({ isDirectory: () => true } as Awaited<ReturnType<typeof fsStat>>)
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    await handler({}, { outputDirectory: 'D:\\MeusClipes' })
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.outputDirectory).toBe('D:\\MeusClipes')
  })

  it('accepts pushToTalkKeys array', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    await handler({}, { pushToTalkKeys: [0x7a, 0x7b] })
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.pushToTalkKeys).toEqual([0x7a, 0x7b])
  })

  it('accepts backward-compat pushToTalkKey number', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    await handler({}, { pushToTalkKey: 0x78 })
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.pushToTalkKeys).toEqual([0x78])
  })

  it('updates gameAudioOnly', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    await handler({}, { gameAudioOnly: true })
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.gameAudioOnly).toBe(true)
  })

  it('updates pushToTalkKeys to default when filter yields empty', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    await handler({}, { pushToTalkKeys: ['not-a-number', null] })
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.pushToTalkKeys).toEqual([0x7a])
  })

  it('handles falsy config gracefully', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    const result = (await handler({}, null)) as { success: boolean; error?: string }
    expect(result.success).toBe(true)
  })

  it('updates all typed config fields', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    await handler(
      {},
      {
        replayTimeSeconds: 120,
        fps: 60,
        width: 1920,
        height: 1080,
        bitrateKbps: 15000,
        cq: 22,
        maxrateKbps: 30000,
        bufsizeKbps: 60000,
        bframes: 2,
        lookahead: 4,
        encoderPreset: 'p4',
        codec: 'h264',
        adapterIndex: 0,
        micEnabled: true,
        audioLoopback: true,
        forceSoftware: true,
        gameDetection: true,
        autoStartCapture: false,
        useExcludeMode: true,
        excludeProcessId: 1234,
        gameVolume: 0.8,
        micVolume: 1.2,
        noiseSuppression: true,
        audioSampleRate: 48000,
        autoCleanupEnabled: true,
        autoCleanupThresholdGB: 100,
      },
    )
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.fps).toBe(60)
    expect(cfg.width).toBe(1920)
    expect(cfg.cq).toBe(22)
    expect(cfg.adapterIndex).toBe(0)
    expect(cfg.micEnabled).toBe(true)
    expect(cfg.forceSoftware).toBe(false)
    expect(cfg.gameVolume).toBe(0.8)
    expect(cfg.micVolume).toBe(1.2)
    expect(cfg.encoderPreset).toBe('p4')
    expect(cfg.codec).toBe('auto')
    expect(cfg.autoCleanupThresholdGB).toBe(100)
  })

  it('updates stretchToFit flag', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    await handler({}, { stretchToFit: true })
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.stretchToFit).toBe(true)
  })

  it('ignores non-boolean stretchToFit', async () => {
    clipsConfig.stretchToFit = false
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    await handler({}, { stretchToFit: 'yes' })
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.stretchToFit).toBe(false)
  })

  it('updates replayBufferMode to hybrid', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    await handler({}, { replayBufferMode: 'hybrid' })
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.replayBufferMode).toBe('hybrid')
  })

  it('updates replayBufferMode to disk', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    await handler({}, { replayBufferMode: 'disk' })
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.replayBufferMode).toBe('disk')
  })

  it('ignores invalid replayBufferMode', async () => {
    clipsConfig.replayBufferMode = 'ram'
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    await handler({}, { replayBufferMode: 'disk-only' })
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.replayBufferMode).toBe('ram')
  })

  it('rejects unknown encoderPreset values', async () => {
    clipsConfig.encoderPreset = 'p5'
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    await handler({}, { encoderPreset: 'p5; shutdown /s' })
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.encoderPreset).toBe('p5')
  })

  it('syncs customGameProcess and micDeviceId when pipe is connected', async () => {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendWithFallback.mockResolvedValue({ success: true })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    const result = (await handler(
      {},
      {
        customGameProcess: 'FiveM.exe',
        micDeviceId: 'mic-1',
      },
    )) as { success: boolean; error?: string }
    expect(result.success).toBe(true)
  })
})

describe('CLIPS_SELECT_OUTPUT_DIR', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns selected path when dialog is not canceled', async () => {
    const { dialog } = await import('electron')
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: ['D:\\Clipes'],
    })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SELECT_OUTPUT_DIR)
    const result = (await handler()) as string | null
    expect(result).toBe('D:\\Clipes')
  })

  it('returns null when dialog is canceled', async () => {
    const { dialog } = await import('electron')
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SELECT_OUTPUT_DIR)
    const result = (await handler()) as string | null
    expect(result).toBeNull()
  })

  it('uses dialog without focused window', async () => {
    const { dialog, BrowserWindow } = await import('electron')
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null)
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: ['D:\\Clipes'],
    })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SELECT_OUTPUT_DIR)
    const result = (await handler()) as string | null
    expect(result).toBe('D:\\Clipes')
  })
})

describe('CLIPS_GET_AUDIO_SESSIONS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEngineMocks()
  })

  it('returns empty array when pipe is not connected', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_AUDIO_SESSIONS)
    const result = (await handler()) as unknown[]
    expect(result).toEqual([])
  })

  it('returns sessions when pipe is connected and session array is present', async () => {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommand.mockResolvedValue({
      cmd: 'getAudioSessions',
      payload: { sessions: [{ id: 1, name: 'Game', pid: 1234 }] },
    })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_AUDIO_SESSIONS)
    const result = (await handler()) as AudioSessionInfo[]
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 1, name: 'Game', pid: 1234 })
  })

  it('returns empty array when sessions payload is not an array', async () => {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommand.mockResolvedValue({
      cmd: 'getAudioSessions',
      payload: { sessions: 'not-an-array' },
    })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_AUDIO_SESSIONS)
    const result = (await handler()) as AudioSessionInfo[]
    expect(result).toEqual([])
  })

  it('returns empty array when sendPipeCommand throws', async () => {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommand.mockRejectedValue(new Error('pipe error'))
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_AUDIO_SESSIONS)
    const result = (await handler()) as AudioSessionInfo[]
    expect(result).toEqual([])
  })
})

describe('CLIPS_SET_AUDIO_SESSIONS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEngineMocks()
  })

  it('rejects non-array sessionPids', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_AUDIO_SESSIONS)
    const result = (await handler({}, 'not-an-array')) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('sessionPids must be an array')
  })

  it('returns pipe-not-connected error when pipe is not connected', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_AUDIO_SESSIONS)
    const result = (await handler({}, [1234])) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Engine pipe not connected')
  })

  it('sets audio sessions successfully when pipe is connected', async () => {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommand.mockResolvedValue({ cmd: 'setAudioSessions', payload: { success: true } })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_AUDIO_SESSIONS)
    const result = (await handler({}, [1234, 5678])) as { success: boolean; error?: string }
    expect(result.success).toBe(true)
    expect(mockSendPipeCommand).toHaveBeenCalledWith('setAudioSessions', { pids: [1234, 5678] })
  })

  it('returns error when engine responds with success:false', async () => {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommand.mockResolvedValue({
      cmd: 'setAudioSessions',
      payload: { success: false, error: 'Session not found' },
    })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_AUDIO_SESSIONS)
    const result = (await handler({}, [9999])) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Session not found')
  })

  it('returns error when sendPipeCommand throws', async () => {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommand.mockRejectedValue(new Error('connection lost'))
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_AUDIO_SESSIONS)
    const result = (await handler({}, [1234])) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('connection lost')
  })
})

describe('CLIPS_STOP_CAPTURE', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEngineMocks()
  })

  it('returns success when engine is not running', async () => {
    mockIsEngineRunning.mockReturnValue(false)
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_STOP_CAPTURE)
    const result = (await handler()) as { success: boolean }
    expect(result.success).toBe(true)
    expect(mockSetEngineCapturing).toHaveBeenCalledWith(false)
    expect(mockSendWithFallback).not.toHaveBeenCalled()
  })

  it('stops capture when engine is running and pipe responds', async () => {
    mockIsEngineRunning.mockReturnValue(true)
    mockSendWithFallback.mockResolvedValue({ success: true })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_STOP_CAPTURE)
    const result = (await handler()) as { success: boolean }
    expect(result.success).toBe(true)
    expect(mockSendWithFallback).toHaveBeenCalledWith('stopCapture')
    expect(mockSetEngineCapturing).toHaveBeenCalledWith(false)
  })

  it('returns error when engine is running but pipe fails', async () => {
    mockIsEngineRunning.mockReturnValue(true)
    mockSendWithFallback.mockResolvedValue({ success: false, error: 'pipe error' })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_STOP_CAPTURE)
    const result = (await handler()) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('pipe error')
    expect(mockSetEngineCapturing).not.toHaveBeenCalled()
  })
})

describe('CLIPS_SAVE_CLIP', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEngineMocks()
  })

  it('returns error when engine is not running', async () => {
    mockIsEngineRunning.mockReturnValue(false)
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SAVE_CLIP)
    const result = (await handler()) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Engine not running')
    expect(mockSendWithFallback).not.toHaveBeenCalled()
  })

  it('saves clip when pipe is connected directly', async () => {
    mockIsEngineRunning.mockReturnValue(true)
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommandLongRunning.mockResolvedValue({ cmd: 'saveClip', payload: { success: true } })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SAVE_CLIP)
    const result = (await handler()) as { success: boolean }
    expect(result.success).toBe(true)
    expect(mockSendWithFallback).toHaveBeenCalledWith('config', expect.any(Object))
    expect(mockSendPipeCommandLongRunning).toHaveBeenCalledWith('saveClip')
  })

  it('waits for pipe reconnection and returns saveClip result', async () => {
    mockIsEngineRunning.mockReturnValue(true)
    mockIsPipeConnected
      .mockReturnValueOnce(false) // first check → enters wait loop
      .mockReturnValueOnce(false) // iteration 1
    mockIsPipeConnected.mockReturnValue(true) // iteration 2 → connected, stays true for post-loop check
    mockSendPipeCommandLongRunning.mockResolvedValue({
      cmd: 'saveClip',
      payload: { success: true, path: '/clips/test.mp4' },
    })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SAVE_CLIP)
    const result = (await handler()) as { success: boolean }
    expect(result.success).toBe(true)
    expect(mockSendWithFallback).toHaveBeenCalledWith('config', expect.any(Object))
  })

  it('returns error if engine dies during wait loop', async () => {
    mockIsEngineRunning
      .mockReturnValueOnce(true) // first check passes
      .mockReturnValueOnce(false) // engine dies during loop
    mockIsPipeConnected.mockReturnValue(false)
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SAVE_CLIP)
    const result = (await handler()) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Engine not running')
  })
})

describe('CLIPS_GET_THUMBNAIL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEngineMocks()
  })

  it('processes thumbnail request for valid clip name', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_THUMBNAIL)
    const result = (await handler({}, 'myclip.mp4')) as string | null
    expect(typeof result).toBe('object') // null because no cached/generated thumbnails exist
    expect(result).toBeNull()
  })

  it('returns null for non-string clipName', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_THUMBNAIL)
    const result = (await handler({}, 123)) as string | null
    expect(result).toBeNull()
  })
})

describe('CLIPS_GET_RUNNING_PROCESSES', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEngineMocks()
  })

  it('parses CSV output from tasklist', async () => {
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '"chrome.exe","1234"\n"explorer.exe","5678"\n', '')
        return undefined as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_RUNNING_PROCESSES)
    const result = (await handler()) as Array<{ name: string; pid: number }>
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ name: 'chrome.exe', pid: 1234 })
    expect(result[1]).toEqual({ name: 'explorer.exe', pid: 5678 })
  })

  it('skips lines that do not match CSV pattern', async () => {
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '"chrome.exe","1234"\ninvalid line\n"good.exe","9999"\n', '')
        return undefined as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_RUNNING_PROCESSES)
    const result = (await handler()) as Array<{ name: string; pid: number }>
    expect(result).toHaveLength(2)
  })

  it('returns empty array when execFile fails', async () => {
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(new Error('tasklist not found'), '', '')
        return undefined as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_RUNNING_PROCESSES)
    const result = (await handler()) as Array<{ name: string; pid: number }>
    expect(result).toEqual([])
  })

  it('returns empty array from empty stdout', async () => {
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '', '')
        return undefined as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_RUNNING_PROCESSES)
    const result = (await handler()) as Array<{ name: string; pid: number }>
    expect(result).toEqual([])
  })
})

describe('CLIPS_GET_MIC_DEVICES', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEngineMocks()
  })

  it('returns empty array when pipe is not connected', async () => {
    mockIsPipeConnected.mockReturnValue(false)
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_MIC_DEVICES)
    const result = (await handler()) as MicDeviceInfo[]
    expect(result).toEqual([])
  })

  it('returns devices when pipe is connected and devices array is present', async () => {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommand.mockResolvedValue({
      cmd: 'getMicDevices',
      payload: { devices: [{ id: 'mic1', name: 'Microphone' }] },
    })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_MIC_DEVICES)
    const result = (await handler()) as MicDeviceInfo[]
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'mic1', name: 'Microphone' })
  })

  it('returns empty array when devices payload is not an array', async () => {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommand.mockResolvedValue({
      cmd: 'getMicDevices',
      payload: { devices: 'not-an-array' },
    })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_MIC_DEVICES)
    const result = (await handler()) as MicDeviceInfo[]
    expect(result).toEqual([])
  })

  it('returns empty array when sendPipeCommand throws', async () => {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommand.mockRejectedValue(new Error('connection failed'))
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_MIC_DEVICES)
    const result = (await handler()) as MicDeviceInfo[]
    expect(result).toEqual([])
  })
})

describe('CLIPS_GET_GPUS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEngineMocks()
  })

  it('returns empty array when pipe is not connected', async () => {
    mockIsPipeConnected.mockReturnValue(false)
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_GPUS)
    const result = (await handler()) as Array<{ index: number; name: string; vendorId: number }>
    expect(result).toEqual([])
  })

  it('returns GPU list when pipe is connected and payload is array', async () => {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommand.mockResolvedValue({
      cmd: 'getGpus',
      payload: [{ index: 0, name: 'NVIDIA RTX 5050', vendorId: 4318 }],
    })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_GPUS)
    const result = (await handler()) as Array<{ index: number; name: string; vendorId: number }>
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ index: 0, vendorId: 4318 })
  })

  it('returns empty array when payload is not an array', async () => {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommand.mockResolvedValue({
      cmd: 'getGpus',
      payload: { error: 'no gpus' },
    })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_GPUS)
    const result = (await handler()) as Array<{ index: number; name: string; vendorId: number }>
    expect(result).toEqual([])
  })

  it('filters out Microsoft Basic Render Driver (vendorId 0x1414)', async () => {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommand.mockResolvedValue({
      cmd: 'getGpus',
      payload: [
        { index: 0, name: 'NVIDIA RTX 5050', vendorId: 4318 },
        { index: 1, name: 'Microsoft Basic Render Driver', vendorId: 5140 },
      ],
    })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_GPUS)
    const result = (await handler()) as Array<{ index: number; name: string; vendorId: number }>
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ index: 0, vendorId: 4318 })
  })

  it('returns empty array when sendPipeCommand throws', async () => {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommand.mockRejectedValue(new Error('timeout'))
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_GPUS)
    const result = (await handler()) as Array<{ index: number; name: string; vendorId: number }>
    expect(result).toEqual([])
  })
})

describe('CLIPS_GET_ENHANCE_SUPPORT', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEngineMocks()
  })

  it('returns amd=false when no GPU scan has run', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_ENHANCE_SUPPORT)
    const result = (await handler()) as { amd: boolean }
    expect(result.amd).toBe(false)
  })

  it('returns amd=true after GET_GPUS detects an AMD GPU', async () => {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommand.mockResolvedValue({
      cmd: 'getGpus',
      payload: [{ index: 0, name: 'AMD Radeon RX 9070', vendorId: 0x1002 }],
    })
    let handlers = captureHandlers()
    await getAsyncHandler(handlers, IPC.CLIPS_GET_GPUS)()
    handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_ENHANCE_SUPPORT)
    const result = (await handler()) as { amd: boolean }
    expect(result.amd).toBe(true)
  })

  it('returns amd=false when only NVIDIA GPUs are present', async () => {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommand.mockResolvedValue({
      cmd: 'getGpus',
      payload: [{ index: 0, name: 'NVIDIA RTX 5050', vendorId: 4318 }],
    })
    let handlers = captureHandlers()
    await getAsyncHandler(handlers, IPC.CLIPS_GET_GPUS)()
    handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_ENHANCE_SUPPORT)
    const result = (await handler()) as { amd: boolean }
    expect(result.amd).toBe(false)
  })
})

describe('CLIPS_SET_FAVORITE', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(access).mockRejectedValue(enoentError())
    resetEngineMocks()
    clipsConfig.outputDirectory = ''
  })

  it('rejects non-string clipName', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_FAVORITE)
    const result = (await handler({}, 123, true)) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid clip name')
  })

  it('rejects empty string clipName', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_FAVORITE)
    const result = (await handler({}, '', true)) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid clip name')
  })

  it('rejects non-boolean favorite value', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_FAVORITE)
    const result = (await handler({}, 'clip.mp4', 'yes')) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid favorite value')
  })

  it('rejects when clipPathInOutputDir returns null', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_FAVORITE)
    // Handler wraps clipName as `.${clipName}.favorite` → `.a/../../../tmp/outside.mp4.favorite`
    // which resolves outside the default output dir → clipPathInOutputDir returns null
    const result = (await handler({}, 'a/../../../tmp/outside.mp4', true)) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid clip name')
  })

  it('writes favorite marker when favorite is true', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_FAVORITE)
    const result = (await handler({}, 'clip.mp4', true)) as { success: boolean; error?: string }
    expect(result.success).toBe(true)
    expect(writeFile).toHaveBeenCalled()
  })

  it('removes favorite marker when favorite is false and file exists', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_FAVORITE)
    const result = (await handler({}, 'clip.mp4', false)) as { success: boolean; error?: string }
    expect(result.success).toBe(true)
    expect(unlink).toHaveBeenCalled()
  })

  it('does nothing when favorite is false and marker file does not exist', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_FAVORITE)
    // No access mock → default rejects (ENOENT) → fileExists false
    const result = (await handler({}, 'clip.mp4', false)) as { success: boolean; error?: string }
    expect(result.success).toBe(true)
    expect(unlink).not.toHaveBeenCalled()
  })

  it('returns error when writeFile fails', async () => {
    vi.mocked(writeFile).mockRejectedValue(new Error('disk full'))
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_FAVORITE)
    const result = (await handler({}, 'clip.mp4', true)) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('disk full')
  })

  it('handles non-Error exception from writeFile', async () => {
    vi.mocked(writeFile).mockRejectedValue('unknown-error')
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_FAVORITE)
    const result = (await handler({}, 'clip.mp4', true)) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('unknown-error')
  })
})

describe('CLIPS_TRIM_CLIP', () => {
  const mockFFProc = { on: vi.fn() }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(access).mockRejectedValue(enoentError())
    vi.mocked(unlink).mockResolvedValue(undefined)
    resetEngineMocks()
    mockFFProc.on.mockReset()
    clipsConfig.outputDirectory = ''
  })

  it('rejects non-string clipPath', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    const result = (await handler({}, '', 10, 20)) as ClipTrimResult
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid clip path')
  })

  it('rejects when clipPathInOutputDir returns null', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    // '../outside.mp4' resolves outside the default output dir → clipPathInOutputDir returns null
    const result = (await handler({}, '../outside.mp4', 10, 20)) as ClipTrimResult
    expect(result.success).toBe(false)
    expect(result.error).toBe('Clip file not found')
  })

  it('rejects invalid trim range when endSeconds <= startSeconds', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    const result = (await handler({}, 'clip.mp4', 20, 10)) as ClipTrimResult
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid trim range')
  })

  it('rejects startSeconds < 0', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    const result = (await handler({}, 'clip.mp4', -1, 10)) as ClipTrimResult
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid trim range')
  })

  it('returns success when ffmpeg trim succeeds', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '', '')
        return mockFFProc as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    const result = (await handler({}, 'clip.mp4', 10, 20)) as ClipTrimResult
    expect(result.success).toBe(true)
    expect(result.path).toBeDefined()
    expect(typeof result.path).toBe('string')
  })

  it('registers the ffmpeg trim process in the app-exit sweep', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '', '')
        return mockFFProc as never
      },
    )
    expect(mockTrackChildProcess).not.toHaveBeenCalled()
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    const result = (await handler({}, 'clip.mp4', 10, 20)) as ClipTrimResult
    expect(result.success).toBe(true)
    expect(mockTrackChildProcess).toHaveBeenCalledWith(mockFFProc)
  })

  it('creates output directory when trimmed dir does not exist', async () => {
    vi.mocked(access).mockResolvedValueOnce(undefined) // safePath exists
    // mkdir is unconditional now; outDir existence no longer checked
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '', '')
        return mockFFProc as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    const result = (await handler({}, 'clip.mp4', 10, 20)) as ClipTrimResult
    expect(result.success).toBe(true)
    expect(mkdir).toHaveBeenCalled()
  })

  it('uses -c copy args when reEncode is not set', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '', '')
        return mockFFProc as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    const result = (await handler({}, 'clip.mp4', 10, 20)) as ClipTrimResult
    expect(result.success).toBe(true)
    const args = vi.mocked(execFile).mock.calls[0]?.[1] as string[]
    expect(args).toContain('-c')
    expect(args).toContain('copy')
    expect(args).not.toContain('libx264')
  })

  it('uses libx264 re-encode args when reEncode is true', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '', '')
        return mockFFProc as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    const result = (await handler({}, 'clip.mp4', 10, 20, true)) as ClipTrimResult
    expect(result.success).toBe(true)
    const args = vi.mocked(execFile).mock.calls[0]?.[1] as string[]
    expect(args).toContain('libx264')
    expect(args).toContain('-c:v')
    expect(args).toContain('-crf')
    expect(args).not.toContain('-c')
  })

  it('returns error when ffmpeg trim fails', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(new Error('ffmpeg error'), '', '')
        return mockFFProc as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    const result = (await handler({}, 'clip.mp4', 10, 20)) as ClipTrimResult
    expect(result.success).toBe(false)
    expect(result.error).toBe('ffmpeg error')
  })

  it('handles process spawn error', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(execFile).mockReturnValue(mockFFProc as never)
    mockFFProc.on.mockImplementation((_event: string, cb: (e: Error) => void) => {
      if (_event === 'error') {
        setTimeout(() => cb(new Error('spawn failed')), 10)
      }
      return mockFFProc
    })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    const result = (await handler({}, 'clip.mp4', 10, 20)) as ClipTrimResult
    expect(result.success).toBe(false)
    expect(result.error).toBe('spawn failed')
  })

  async function setAmdDetected(amd: boolean) {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommand.mockResolvedValue({
      cmd: 'getGpus',
      payload: amd
        ? [{ index: 0, name: 'AMD Radeon', vendorId: 0x1002 }]
        : [{ index: 0, name: 'NVIDIA', vendorId: 4318 }],
    })
    const handlers = captureHandlers()
    await getAsyncHandler(handlers, IPC.CLIPS_GET_GPUS)()
  }

  function mockProbeThenTrim() {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        args: readonly string[] | null | undefined,
        _opts: unknown,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (!cb) return mockFFProc as never
        if (args?.includes('-hide_banner')) {
          cb(null, '', '  Stream #0:0: Video: h264 (High), yuv420p, 1280x720, 60 fps, 60 tbr')
        } else {
          cb(null, '', '')
        }
        return mockFFProc as never
      },
    )
  }

  it('applies sr_amf vf when AMD detected and re-encode enabled', async () => {
    await setAmdDetected(true)
    mockProbeThenTrim()
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    const result = (await handler({}, 'clip.mp4', 10, 20, true, 'sr')) as ClipTrimResult
    expect(result.success).toBe(true)
    const trimArgs = vi.mocked(execFile).mock.calls.find((c) => (c[1] as string[]).includes('-ss'))?.[1] as string[]
    expect(trimArgs).toContain('-vf')
    expect(trimArgs.join(' ')).toContain('sr_amf=w=1920:h=1080')
  })

  it('chains frc_amf when enhance is sr+frc', async () => {
    await setAmdDetected(true)
    mockProbeThenTrim()
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    const result = (await handler({}, 'clip.mp4', 10, 20, true, 'sr+frc')) as ClipTrimResult
    expect(result.success).toBe(true)
    const trimArgs = vi.mocked(execFile).mock.calls.find((c) => (c[1] as string[]).includes('-ss'))?.[1] as string[]
    const vf = (trimArgs.join(' ').match(/-vf ([^ ]+)/)?.[1] ?? '') as string
    expect(vf).toContain('sr_amf=')
    expect(vf).toContain('frc_amf=')
  })

  it('ignores enhance when re-encode is not enabled', async () => {
    await setAmdDetected(true)
    mockProbeThenTrim()
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    const result = (await handler({}, 'clip.mp4', 10, 20, false, 'sr')) as ClipTrimResult
    expect(result.success).toBe(true)
    const trimArgs = vi.mocked(execFile).mock.calls.find((c) => (c[1] as string[]).includes('-ss'))?.[1] as string[]
    expect(trimArgs).not.toContain('-vf')
  })

  it('ignores enhance when no AMD GPU detected', async () => {
    await setAmdDetected(false)
    mockProbeThenTrim()
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    const result = (await handler({}, 'clip.mp4', 10, 20, true, 'sr')) as ClipTrimResult
    expect(result.success).toBe(true)
    const trimArgs = vi.mocked(execFile).mock.calls.find((c) => (c[1] as string[]).includes('-ss'))?.[1] as string[]
    expect(trimArgs).not.toContain('-vf')
  })

  it('ignores enhance when source resolution cannot be probed', async () => {
    await setAmdDetected(true)
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '', '')
        return mockFFProc as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    const result = (await handler({}, 'clip.mp4', 10, 20, true, 'sr')) as ClipTrimResult
    expect(result.success).toBe(true)
    const trimArgs = vi.mocked(execFile).mock.calls.find((c) => (c[1] as string[]).includes('-ss'))?.[1] as string[]
    expect(trimArgs).not.toContain('-vf')
  })

  it('appends cas=strength to the vf chain when sharpness is set with re-encode', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '', '')
        return mockFFProc as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    const result = (await handler({}, 'clip.mp4', 10, 20, true, 'none', 0.6)) as ClipTrimResult
    expect(result.success).toBe(true)
    const trimArgs = vi.mocked(execFile).mock.calls.find((c) => (c[1] as string[]).includes('-ss'))?.[1] as string[]
    expect(trimArgs).toContain('-vf')
    expect(trimArgs.join(' ')).toContain('cas=strength=0.6')
  })

  it('clamps sharpness above 1 to cas=strength=1', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '', '')
        return mockFFProc as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    const result = (await handler({}, 'clip.mp4', 10, 20, true, 'none', 2.5)) as ClipTrimResult
    expect(result.success).toBe(true)
    const trimArgs = vi.mocked(execFile).mock.calls.find((c) => (c[1] as string[]).includes('-ss'))?.[1] as string[]
    expect(trimArgs.join(' ')).toContain('cas=strength=1')
  })

  it('ignores sharpness when re-encode is not enabled', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '', '')
        return mockFFProc as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)
    const result = (await handler({}, 'clip.mp4', 10, 20, false, 'none', 0.6)) as ClipTrimResult
    expect(result.success).toBe(true)
    const trimArgs = vi.mocked(execFile).mock.calls.find((c) => (c[1] as string[]).includes('-ss'))?.[1] as string[]
    expect(trimArgs).not.toContain('-vf')
  })
})

describe('CLIPS_MERGE_CLIPS', () => {
  const mockFFProc = { on: vi.fn() }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(access).mockRejectedValue(enoentError())
    vi.mocked(unlink).mockResolvedValue(undefined)
    resetEngineMocks()
    mockFFProc.on.mockReset()
    clipsConfig.outputDirectory = ''
  })

  it('rejects non-array or less than 2 clips', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_MERGE_CLIPS)
    const result = (await handler({}, ['onlyone.mp4'])) as ClipMergeResult
    expect(result.success).toBe(false)
    expect(result.error).toBe('At least 2 clips required')
  })

  it('rejects non-string path in array', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_MERGE_CLIPS)
    const result = (await handler({}, [123, 'clip2.mp4'])) as ClipMergeResult
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid clip path')
  })

  it('rejects when a clip path is not found', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_MERGE_CLIPS)
    const result = (await handler({}, ['clip1.mp4', 'clip2.mp4'])) as ClipMergeResult
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('returns success when ffmpeg merge succeeds', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '', '')
        return mockFFProc as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_MERGE_CLIPS)
    const result = (await handler({}, ['clip1.mp4', 'clip2.mp4'])) as ClipMergeResult
    expect(result.success).toBe(true)
    expect(result.path).toBeDefined()
    expect(typeof result.path).toBe('string')
    expect(writeFile).toHaveBeenCalled() // concat file written
  })

  it('returns error when ffmpeg merge fails', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(new Error('merge failed'), '', '')
        return mockFFProc as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_MERGE_CLIPS)
    const result = (await handler({}, ['clip1.mp4', 'clip2.mp4'])) as ClipMergeResult
    expect(result.success).toBe(false)
    expect(result.error).toBe('merge failed')
  })

  it('handles process spawn error during merge', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(execFile).mockReturnValue(mockFFProc as never)
    mockFFProc.on.mockImplementation((_event: string, cb: (e: Error) => void) => {
      if (_event === 'error') {
        setTimeout(() => cb(new Error('spawn error')), 10)
      }
      return mockFFProc
    })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_MERGE_CLIPS)
    const result = (await handler({}, ['clip1.mp4', 'clip2.mp4'])) as ClipMergeResult
    expect(result.success).toBe(false)
    expect(result.error).toBe('spawn error')
  })

  it('handles writeFile failure for concat file', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockReset().mockRejectedValue(new Error('permission denied'))
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_MERGE_CLIPS)
    const result = (await handler({}, ['clip1.mp4', 'clip2.mp4'])) as ClipMergeResult
    expect(result.success).toBe(false)
    expect(result.error).toBe('permission denied')
  })

  it('creates output directory when merged dir does not exist', async () => {
    vi.mocked(access).mockResolvedValue(undefined) // clip files exist
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '', '')
        return mockFFProc as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_MERGE_CLIPS)
    const result = (await handler({}, ['clip1.mp4', 'clip2.mp4'])) as ClipMergeResult
    expect(result.success).toBe(true)
    expect(mkdir).toHaveBeenCalled()
  })

  it('handles non-Error exception during merge', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockReset().mockRejectedValue('write-error')
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_MERGE_CLIPS)
    const result = (await handler({}, ['clip1.mp4', 'clip2.mp4'])) as ClipMergeResult
    expect(result.success).toBe(false)
    expect(result.error).toBe('write-error')
  })

  it('uses -c copy stream args when enhance is not set', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '', '')
        return mockFFProc as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_MERGE_CLIPS)
    const result = (await handler({}, ['clip1.mp4', 'clip2.mp4'])) as ClipMergeResult
    expect(result.success).toBe(true)
    const args = vi.mocked(execFile).mock.calls[0]?.[1] as string[]
    expect(args).toContain('copy')
    expect(args).not.toContain('libx264')
    expect(args).not.toContain('-vf')
  })

  it('registers the ffmpeg merge process in the app-exit sweep', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '', '')
        return mockFFProc as never
      },
    )
    expect(mockTrackChildProcess).not.toHaveBeenCalled()
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_MERGE_CLIPS)
    const result = (await handler({}, ['clip1.mp4', 'clip2.mp4'])) as ClipMergeResult
    expect(result.success).toBe(true)
    expect(mockTrackChildProcess).toHaveBeenCalledWith(mockFFProc)
  })

  it('re-encodes with sr_amf vf when AMD detected and enhance set', async () => {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommand.mockResolvedValue({
      cmd: 'getGpus',
      payload: [{ index: 0, name: 'AMD Radeon', vendorId: 0x1002 }],
    })
    let handlers = captureHandlers()
    await getAsyncHandler(handlers, IPC.CLIPS_GET_GPUS)()
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        args: readonly string[] | null | undefined,
        _opts: unknown,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (!cb) return mockFFProc as never
        if (args?.includes('-hide_banner')) {
          cb(null, '', '  Stream #0:0: Video: h264 (High), yuv420p, 1280x720, 60 fps, 60 tbr')
        } else {
          cb(null, '', '')
        }
        return mockFFProc as never
      },
    )
    handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_MERGE_CLIPS)
    const result = (await handler({}, ['clip1.mp4', 'clip2.mp4'], 'sr')) as ClipMergeResult
    expect(result.success).toBe(true)
    const mergeCall = vi.mocked(execFile).mock.calls.find((c) => (c[1] as string[]).includes('concat'))?.[1] as string[]
    expect(mergeCall).toContain('libx264')
    expect(mergeCall).toContain('-vf')
    expect(mergeCall.join(' ')).toContain('sr_amf=w=1920:h=1080')
  })

  it('keeps -c copy when AMD not detected despite enhance set', async () => {
    mockIsPipeConnected.mockReturnValue(true)
    mockSendPipeCommand.mockResolvedValue({
      cmd: 'getGpus',
      payload: [{ index: 0, name: 'NVIDIA', vendorId: 4318 }],
    })
    let handlers = captureHandlers()
    await getAsyncHandler(handlers, IPC.CLIPS_GET_GPUS)()
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '', '')
        return mockFFProc as never
      },
    )
    handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_MERGE_CLIPS)
    const result = (await handler({}, ['clip1.mp4', 'clip2.mp4'], 'sr')) as ClipMergeResult
    expect(result.success).toBe(true)
    const args = vi.mocked(execFile).mock.calls[0]?.[1] as string[]
    expect(args).toContain('copy')
    expect(args).not.toContain('libx264')
    expect(args).not.toContain('-vf')
  })

  it('re-encodes with cas vf when sharpness is set', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '', '')
        return mockFFProc as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_MERGE_CLIPS)
    const result = (await handler({}, ['clip1.mp4', 'clip2.mp4'], 'none', 0.6)) as ClipMergeResult
    expect(result.success).toBe(true)
    const mergeCall = vi.mocked(execFile).mock.calls.find((c) => (c[1] as string[]).includes('concat'))?.[1] as string[]
    expect(mergeCall).toContain('libx264')
    expect(mergeCall).toContain('-vf')
    expect(mergeCall.join(' ')).toContain('cas=strength=0.6')
  })

  it('keeps -c copy when sharpness is zero', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[] | null | undefined,
        _opts: ExecFileOptions | null | undefined,
        cb?:
          | ((
              error: ExecFileException | null,
              stdout: string | NonSharedBuffer,
              stderr: string | NonSharedBuffer,
            ) => void)
          | null,
      ) => {
        if (cb) cb(null, '', '')
        return mockFFProc as never
      },
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_MERGE_CLIPS)
    const result = (await handler({}, ['clip1.mp4', 'clip2.mp4'], 'none', 0)) as ClipMergeResult
    expect(result.success).toBe(true)
    const mergeCall = vi.mocked(execFile).mock.calls.find((c) => (c[1] as string[]).includes('concat'))?.[1] as string[]
    expect(mergeCall).toContain('copy')
    expect(mergeCall).not.toContain('libx264')
    expect(mergeCall).not.toContain('-vf')
  })
})

describe('CLIPS_RENAME_CLIP', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(access).mockRejectedValue(enoentError())
    resetEngineMocks()
  })

  it('rejects non-string clipName', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_RENAME_CLIP)
    const result = (await handler({}, 123, 'newclip')) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid clip name')
    expect(rename).not.toHaveBeenCalled()
  })

  it('rejects non-string newName', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_RENAME_CLIP)
    const result = (await handler({}, 'oldclip.mp4', 456)) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid new name')
    expect(rename).not.toHaveBeenCalled()
  })

  it('rejects newName that is just .mp4 extension', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_RENAME_CLIP)
    const result = (await handler({}, 'oldclip.mp4', '.mp4')) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid new name')
    expect(rename).not.toHaveBeenCalled()
  })

  it('rejects old name that escapes output directory', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_RENAME_CLIP)
    const result = (await handler({}, '../../../Windows/system.ini', 'newclip')) as {
      success: boolean
      error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid old clip name')
  })

  it('rejects new name that escapes output directory', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_RENAME_CLIP)
    const result = (await handler({}, 'oldclip.mp4', '../outside')) as {
      success: boolean
      error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid new clip name')
  })

  it('returns error when old clip does not exist', async () => {
    vi.mocked(access).mockRejectedValue(enoentError())
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_RENAME_CLIP)
    const result = (await handler({}, 'oldclip.mp4', 'newclip')) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Clip not found')
    expect(rename).not.toHaveBeenCalled()
  })

  it('returns error when new clip already exists', async () => {
    vi.mocked(access).mockResolvedValue(undefined) // old + new both exist
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_RENAME_CLIP)
    const result = (await handler({}, 'oldclip.mp4', 'newclip')) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('A clip with that name already exists')
    expect(rename).not.toHaveBeenCalled()
  })

  it('renames the .mp4 file successfully', async () => {
    vi.mocked(access)
      .mockResolvedValueOnce(undefined) // old clip exists
      .mockRejectedValueOnce(enoentError()) // new clip doesn't exist
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_RENAME_CLIP)
    const result = (await handler({}, 'oldclip.mp4', 'newclip')) as { success: boolean; error?: string }
    expect(result.success).toBe(true)
    expect(rename).toHaveBeenCalledTimes(1)
  })

  it('returns error when rename fails (e.g. cross-volume)', async () => {
    vi.mocked(access)
      .mockResolvedValueOnce(undefined) // old clip exists
      .mockRejectedValueOnce(enoentError()) // new clip doesn't exist
    vi.mocked(rename).mockRejectedValueOnce(new Error('EXDEV: cross-device link not permitted'))
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_RENAME_CLIP)
    const result = (await handler({}, 'oldclip.mp4', 'newclip')) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('EXDEV')
  })

  it('renames the cached thumbnail when present', async () => {
    vi.mocked(existsSync).mockImplementation(
      (p) => typeof p === 'string' && p.includes('.thumbnails') && p.includes('oldclip.jpg'),
    )
    vi.mocked(access).mockImplementation((p) => {
      if (typeof p !== 'string') return Promise.reject(enoentError())
      if (p.endsWith('oldclip.mp4')) return Promise.resolve() // old clip exists
      if (p.endsWith('newclip.mp4')) return Promise.reject(enoentError()) // new clip doesn't exist
      if (p.includes('.thumbnails') && p.includes('oldclip.jpg')) return Promise.resolve() // cached thumbnail
      return Promise.reject(enoentError())
    })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_RENAME_CLIP)
    const result = (await handler({}, 'oldclip.mp4', 'newclip')) as { success: boolean; error?: string }
    expect(result.success).toBe(true)
    // rename called twice: once for .mp4, once for thumbnail
    expect(rename).toHaveBeenCalledTimes(2)
  })

  it('renames the .favorite marker when present', async () => {
    vi.mocked(access).mockImplementation((p) => {
      if (typeof p !== 'string') return Promise.reject(enoentError())
      if (p.endsWith('oldclip.mp4')) return Promise.resolve() // old clip exists
      if (p.endsWith('newclip.mp4')) return Promise.reject(enoentError()) // new clip doesn't exist
      if (p.includes('.oldclip.mp4.favorite')) return Promise.resolve() // favorite marker
      return Promise.reject(enoentError())
    })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_RENAME_CLIP)
    const result = (await handler({}, 'oldclip.mp4', 'newclip')) as { success: boolean; error?: string }
    expect(result.success).toBe(true)
    // rename called twice: once for .mp4, once for .favorite
    expect(rename).toHaveBeenCalledTimes(2)
  })

  it('strips .mp4 suffix from newName if user included it', async () => {
    vi.mocked(access)
      .mockResolvedValueOnce(undefined) // old clip exists
      .mockRejectedValueOnce(enoentError()) // new clip doesn't exist (after .mp4 stripped and re-added)
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_RENAME_CLIP)
    const result = (await handler({}, 'oldclip.mp4', 'newclip.mp4')) as { success: boolean; error?: string }
    expect(result.success).toBe(true)
    expect(rename).toHaveBeenCalledTimes(1)
  })

  it('invalidates duration cache for old path after successful rename', async () => {
    vi.mocked(access)
      .mockResolvedValueOnce(undefined) // old clip exists
      .mockRejectedValueOnce(enoentError()) // new clip doesn't exist
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_RENAME_CLIP)
    await handler({}, 'oldclip.mp4', 'newclip')
    expect(mockInvalidateDurationCache).toHaveBeenCalled()
  })
})

describe('CLIPS_OPEN_EXTERNAL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens a valid https URL', async () => {
    vi.mocked(shell.openExternal).mockResolvedValue()
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_OPEN_EXTERNAL)
    const result = (await handler({}, 'https://gofile.io/d/abc')) as { success: boolean; data: { opened: boolean } }
    expect(shell.openExternal).toHaveBeenCalledWith('https://gofile.io/d/abc')
    expect(result.success).toBe(true)
  })

  it('rejects non-string URL', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_OPEN_EXTERNAL)
    const result = (await handler({}, null)) as { success: boolean; error: string }
    expect(shell.openExternal).not.toHaveBeenCalled()
    expect(result).toEqual({ success: false, error: 'Invalid URL' })
  })

  it('rejects non-https protocol', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_OPEN_EXTERNAL)
    const result = (await handler({}, 'http://gofile.io/d/abc')) as { success: boolean; error: string }
    expect(shell.openExternal).not.toHaveBeenCalled()
    expect(result).toEqual({ success: false, error: 'Only https URLs are allowed' })
  })

  it('rejects malformed URL', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_OPEN_EXTERNAL)
    const result = (await handler({}, 'not a url')) as { success: boolean; error: string }
    expect(shell.openExternal).not.toHaveBeenCalled()
    expect(result).toEqual({ success: false, error: 'Invalid URL' })
  })
})

describe('CLIPS_PUBLISH', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clipsConfig.outputDirectory = 'C:\\clips'
  })

  it('rejects non-string clip path', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_PUBLISH)
    const result = (await handler({}, 123)) as { success: boolean; error: string }
    expect(result).toEqual({ success: false, error: 'Invalid clip path' })
    expect(mockUploadClipToGofile).not.toHaveBeenCalled()
  })

  it('rejects clip outside output directory', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_PUBLISH)
    const result = (await handler({}, 'C:\\Windows\\evil.mp4')) as { success: boolean; error: string }
    expect(result).toEqual({ success: false, error: 'Clip file not found' })
    expect(mockUploadClipToGofile).not.toHaveBeenCalled()
  })

  it('rejects nonexistent clip file', async () => {
    vi.mocked(access).mockRejectedValue(enoentError())
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_PUBLISH)
    const result = (await handler({}, 'C:\\clips\\missing.mp4')) as { success: boolean; error: string }
    expect(result).toEqual({ success: false, error: 'Clip file not found' })
    expect(mockUploadClipToGofile).not.toHaveBeenCalled()
  })

  it('returns link on successful upload', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    mockUploadClipToGofile.mockResolvedValue({ success: true, link: 'https://gofile.io/d/abc' })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_PUBLISH)
    const result = (await handler({}, 'C:\\clips\\clip.mp4')) as { success: boolean; data: { link: string } }
    expect(mockUploadClipToGofile).toHaveBeenCalledWith(
      'C:\\clips\\clip.mp4',
      expect.any(Function),
      expect.any(AbortSignal),
    )
    expect(result).toEqual({ success: true, data: { link: 'https://gofile.io/d/abc' } })
  })

  it('returns error when upload fails', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    mockUploadClipToGofile.mockResolvedValue({ success: false, error: 'Connection lost during upload' })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_PUBLISH)
    const result = (await handler({}, 'C:\\clips\\clip.mp4')) as { success: boolean; error: string }
    expect(result).toEqual({ success: false, error: 'Connection lost during upload' })
  })

  it('blocks concurrent upload of the same clip', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    let resolveUpload: (v: { success: boolean }) => void = () => {}
    mockUploadClipToGofile.mockImplementation(
      () =>
        new Promise<{ success: boolean }>((resolve) => {
          resolveUpload = resolve
        }),
    )
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_PUBLISH)
    const first = handler({}, 'C:\\clips\\clip.mp4')
    const second = (await handler({}, 'C:\\clips\\clip.mp4')) as { success: boolean; error: string }
    expect(second).toEqual({ success: false, error: 'Upload already in progress' })
    resolveUpload({ success: true })
    await first
  })

  it('returns ABORTED code when upload is cancelled', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    mockUploadClipToGofile.mockResolvedValue({ success: false, cancelled: true, error: 'Upload cancelled' })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_PUBLISH)
    const result = (await handler({}, 'C:\\clips\\clip.mp4')) as { success: boolean; error: string; code?: string }
    expect(result).toEqual({ success: false, error: 'Upload cancelled', code: 'ABORTED' })
  })
})

describe('CLIPS_PUBLISH_CANCEL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clipsConfig.outputDirectory = 'C:\\clips'
  })

  it('rejects non-string clip path', () => {
    const handlers = captureHandlers()
    const handler = handlers.get(IPC.CLIPS_PUBLISH_CANCEL)!
    expect(handler({})).toEqual({ success: false, error: 'Invalid clip path' })
  })

  it('rejects clip outside output directory', () => {
    const handlers = captureHandlers()
    const handler = handlers.get(IPC.CLIPS_PUBLISH_CANCEL)!
    expect(handler({}, 'C:\\Windows\\evil.mp4')).toEqual({ success: false, error: 'No upload in progress' })
  })

  it('reports no upload in progress', () => {
    const handlers = captureHandlers()
    const handler = handlers.get(IPC.CLIPS_PUBLISH_CANCEL)!
    expect(handler({}, 'C:\\clips\\clip.mp4')).toEqual({ success: false, error: 'No upload in progress' })
  })

  it('aborts an in-flight upload for the clip path', async () => {
    vi.mocked(access).mockResolvedValue(undefined)
    let signal: AbortSignal | undefined
    mockUploadClipToGofile.mockImplementation(
      (_path: string, _onProgress?: unknown, sig?: AbortSignal) =>
        new Promise<{ success: boolean }>((resolve) => {
          signal = sig
          if (sig) {
            sig.addEventListener('abort', () => resolve({ success: false }))
          }
        }),
    )
    const handlers = captureHandlers()
    const publish = getAsyncHandler(handlers, IPC.CLIPS_PUBLISH)
    const inFlight = publish({}, 'C:\\clips\\clip.mp4')
    await vi.waitFor(() => expect(signal).toBeDefined())
    expect(signal?.aborted).toBe(false)
    const cancel = handlers.get(IPC.CLIPS_PUBLISH_CANCEL)! as (_e: unknown, p: string) => { success: boolean }
    expect(cancel({}, 'C:\\clips\\clip.mp4')).toEqual({ success: true })
    expect(signal?.aborted).toBe(true)
    await inFlight
  })
})
