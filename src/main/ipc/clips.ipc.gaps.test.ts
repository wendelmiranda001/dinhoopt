import { describe, expect, it, vi } from 'vitest'

const logger = vi.hoisted(() => ({ info: vi.fn(), warning: vi.fn(), error: vi.fn() }))
const execFileMock = vi.hoisted(() => vi.fn())
const fsMock = vi.hoisted(() => ({
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
const fspMock = vi.hoisted(() => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  rename: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
}))
const shellMock = vi.hoisted(() => ({ openPath: vi.fn(), openExternal: vi.fn() }))
const dialogMock = vi.hoisted(() => ({ showOpenDialog: vi.fn() }))
const browserMock = vi.hoisted(() => ({
  getFocusedWindow: vi.fn(),
  getAllWindows: vi.fn(() => [] as unknown[]),
}))
const ipcMainMock = vi.hoisted(() => ({ handle: vi.fn() }))
const trackChildProcess = vi.hoisted(() => vi.fn(() => () => {}))
const uploadMock = vi.hoisted(() => vi.fn())
const thumbnailMock = vi.hoisted(() => ({
  getCachedThumbnailPath: vi.fn(() => null as string | null),
  getThumbnailDataUrl: vi.fn(async () => null as string | null),
}))
const enhanceMock = vi.hoisted(() => ({
  AMD_VENDOR_ID: 4098,
  appendSharpnessFilter: vi.fn((vf: string | null, strength: number) => {
    if (strength <= 0) return vf
    return vf ? `${vf},cas=strength=${strength}` : `cas=strength=${strength}`
  }),
  buildAmfEnhanceVf: vi.fn(() => 'sr_amf'),
  normalizeSharpness: vi.fn((v: unknown) => (typeof v === 'number' ? Math.min(1, Math.max(0, v)) : 0)),
  parseEnhanceOption: vi.fn(() => 'none' as string),
  probeVideoResolution: vi.fn(async () => null as { w: number; h: number } | null),
}))
const engineConnMock = vi.hoisted(() => ({
  isPipeConnected: vi.fn(() => false),
  isEngineRunning: vi.fn(() => false),
  sendWithFallback: vi.fn(
    async (_cmd?: string, _payload?: unknown): Promise<{ success: boolean; error?: string }> => ({ success: true }),
  ),
  sendPipeCommand: vi.fn(async () => ({ cmd: 'x', payload: {} }) as Record<string, unknown>),
  sendPipeCommandLongRunning: vi.fn(async () => ({ cmd: 'x', payload: {} }) as Record<string, unknown>),
  setEngineCapturing: vi.fn(),
  invalidateDurationCache: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
  execFile: execFileMock,
  execFileSync: vi.fn(),
}))
vi.mock('node:fs', () => fsMock)
vi.mock('node:fs/promises', () => fspMock)
vi.mock('electron', () => ({
  ipcMain: ipcMainMock,
  shell: shellMock,
  dialog: dialogMock,
  BrowserWindow: browserMock,
  app: { isPackaged: false, getPath: vi.fn(() => '/mock/user-data') },
}))
vi.mock('../services/logger.service', () => ({ getLogger: () => logger }))
vi.mock('../services/thumbnail-generator', () => thumbnailMock)
vi.mock('../services/clips-enhance', () => enhanceMock)
vi.mock('../services/clips-publish', () => ({ uploadClipToGofile: uploadMock }))
vi.mock('../services/exec-utf8', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/exec-utf8')>()
  return { ...mod, trackChildProcess }
})
vi.mock('./clips-engine-connection', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./clips-engine-connection')>()
  return { ...mod, ...engineConnMock }
})

import { IPC } from '@shared/channels'
import type { ClipMergeResult, ClipTrimResult, MicDeviceInfo } from '@shared/types'
import { config as clipsConfig } from '../services/clips-config-manager'
import { registerClipsIpc } from './clips.ipc'

function enoentError(): Error {
  return Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
}

function captureHandlers(): Map<string, (...args: any[]) => any> {
  const handlers = new Map<string, (...args: any[]) => any>()
  ipcMainMock.handle.mockImplementation((channel: string, handler: (...args: any[]) => any) => {
    handlers.set(channel, handler)
    return undefined as never
  })
  registerClipsIpc()
  return handlers
}

function asyncHandler(handlers: Map<string, (...args: any[]) => any>, channel: string) {
  return handlers.get(channel)!
}

function syncHandler<T>(handlers: Map<string, (...args: any[]) => any>, channel: string): () => T {
  const handler = handlers.get(channel)!
  return () => handler() as T
}

function resetMocks(): void {
  vi.clearAllMocks()
  clipsConfig.outputDirectory = 'C:\\clips'
  engineConnMock.isPipeConnected.mockReturnValue(false)
  engineConnMock.isEngineRunning.mockReturnValue(false)
  engineConnMock.sendWithFallback.mockResolvedValue({ success: true })
  engineConnMock.sendPipeCommand.mockResolvedValue({ cmd: 'x', payload: {} })
  engineConnMock.sendPipeCommandLongRunning.mockResolvedValue({ cmd: 'x', payload: {} })
  thumbnailMock.getCachedThumbnailPath.mockReturnValue(null)
  enhanceMock.parseEnhanceOption.mockReturnValue('none')
  enhanceMock.probeVideoResolution.mockResolvedValue(null)
  browserMock.getFocusedWindow.mockReturnValue(undefined)
  browserMock.getAllWindows.mockReturnValue([])
  fspMock.access.mockRejectedValue(enoentError())
  fspMock.mkdir.mockResolvedValue(undefined)
  fspMock.rename.mockResolvedValue(undefined)
  fspMock.unlink.mockResolvedValue(undefined)
  fspMock.writeFile.mockResolvedValue(undefined)
  fspMock.stat.mockRejectedValue(enoentError())
}

const emptyExec = () => undefined

describe('CLIPS_GET_MIC_DEVICES local enumeration gaps', () => {
  it('falls back to an empty list when powershell fails or returns nothing', async () => {
    resetMocks()
    engineConnMock.isPipeConnected.mockReturnValue(false)
    execFileMock.mockImplementation(((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null, out: string) => void
      cb(new Error('powershell missing'), '')
      return emptyExec()
    }) as never)

    const handlers = captureHandlers()
    const handler = asyncHandler(handlers, IPC.CLIPS_GET_MIC_DEVICES)
    expect((await handler()) as MicDeviceInfo[]).toEqual([])

    execFileMock.mockImplementation(((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: null, out: string) => void
      cb(null, '')
      return emptyExec()
    }) as never)
    expect((await handler()) as MicDeviceInfo[]).toEqual([])
  })

  it('survives a missing payload and a non-Error pipe rejection', async () => {
    resetMocks()
    engineConnMock.isPipeConnected.mockReturnValue(true)
    engineConnMock.sendPipeCommand.mockResolvedValue({ cmd: 'getMicDevices' })
    execFileMock.mockImplementation(((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: null, out: string) => void
      cb(null, '')
      return emptyExec()
    }) as never)

    const handlers = captureHandlers()
    const handler = asyncHandler(handlers, IPC.CLIPS_GET_MIC_DEVICES)
    expect((await handler()) as MicDeviceInfo[]).toEqual([])

    engineConnMock.sendPipeCommand.mockRejectedValue('oops')
    expect((await handler()) as MicDeviceInfo[]).toEqual([])
  })

  it('parses powershell output, filters invalid rows and serves the cache on the next call', async () => {
    resetMocks()
    engineConnMock.isPipeConnected.mockReturnValue(false)
    const stdout = ['id-1|Headset Microphone|1', 'id-2|Webcam|0', '||0', 'no-pipe-separator', ''].join('\r\n')
    execFileMock.mockImplementation(((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: null, out: string) => void
      cb(null, stdout)
      return emptyExec()
    }) as never)

    const handlers = captureHandlers()
    const handler = asyncHandler(handlers, IPC.CLIPS_GET_MIC_DEVICES)

    const first = (await handler()) as MicDeviceInfo[]
    expect(first).toHaveLength(2)
    expect(first[0]).toMatchObject({ id: 'id-1', name: 'Headset Microphone', isDefault: true })
    expect(first[1]).toMatchObject({ id: 'id-2', isDefault: false })

    const second = (await handler()) as MicDeviceInfo[]
    expect(second).toEqual(first)
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })
})

describe('CLIPS_SET_CONFIG branch gaps', () => {
  it('swallows a failed setCustomGameProcess send', async () => {
    resetMocks()
    engineConnMock.isPipeConnected.mockReturnValue(true)
    engineConnMock.sendWithFallback.mockImplementation(async (cmd?: string) => {
      if (cmd === 'setCustomGameProcess') throw new Error('send failed')
      return { success: true }
    })
    const handlers = captureHandlers()
    await asyncHandler(handlers, IPC.CLIPS_SET_CONFIG)({}, { customGameProcess: 'game.exe' })

    await vi.waitFor(() =>
      expect(logger.warning).toHaveBeenCalledWith('clips', 'setCustomGameProcess send failed (caught)'),
    )
  })

  it('skips setCustomGameProcess when the process name is empty', async () => {
    resetMocks()
    engineConnMock.isPipeConnected.mockReturnValue(true)
    const handlers = captureHandlers()
    await asyncHandler(handlers, IPC.CLIPS_SET_CONFIG)({}, { customGameProcess: '' })
    expect(engineConnMock.sendWithFallback).not.toHaveBeenCalledWith('setCustomGameProcess', expect.anything())
  })

  it('does not push mic device id when the pipe is disconnected', async () => {
    resetMocks()
    engineConnMock.isPipeConnected.mockReturnValue(false)
    const handlers = captureHandlers()
    await asyncHandler(handlers, IPC.CLIPS_SET_CONFIG)({}, { micDeviceId: 'mic-1' })
    expect(engineConnMock.sendWithFallback).not.toHaveBeenCalledWith('setMicDevice', expect.anything())
    expect(clipsConfig.micDeviceId).toBe('mic-1')
  })

  it('sanitizes the hotkeys array', async () => {
    resetMocks()
    const handlers = captureHandlers()
    await asyncHandler(handlers, IPC.CLIPS_SET_CONFIG)(
      {},
      {
        hotkeys: [{ vk: 65, action: 'SaveClip', modifiers: [18] }, { vk: 'bad' }, null, 'nope'],
      },
    )
    expect(clipsConfig.hotkeys).toEqual([{ vk: 65, action: 'SaveClip', modifiers: [18] }])
  })

  it('rejects an output directory that is not a directory', async () => {
    resetMocks()
    fspMock.stat.mockResolvedValue({ isDirectory: () => false } as never)
    const handlers = captureHandlers()
    await asyncHandler(handlers, IPC.CLIPS_SET_CONFIG)({}, { outputDirectory: 'D:\\NotADir' })
    const cfg = syncHandler<Record<string, unknown>>(handlers, IPC.CLIPS_GET_CONFIG)()
    expect(cfg.outputDirectory).not.toBe('D:\\NotADir')
  })

  it('applies the adaptiveQuality flag and warns when the engine sync fails', async () => {
    resetMocks()
    engineConnMock.isPipeConnected.mockReturnValue(true)
    engineConnMock.sendWithFallback.mockResolvedValue({ success: false, error: 'sync down' })
    const handlers = captureHandlers()
    await asyncHandler(handlers, IPC.CLIPS_SET_CONFIG)({}, { adaptiveQuality: true })

    expect(clipsConfig.adaptiveQuality).toBe(true)
    expect(logger.warning).toHaveBeenCalledWith('clips', 'Config sync to engine failed: sync down')
  })
})

describe('CLIPS_SAVE_CLIP failure paths', () => {
  it('reports the engine error payload', async () => {
    resetMocks()
    engineConnMock.isEngineRunning.mockReturnValue(true)
    engineConnMock.isPipeConnected.mockReturnValue(true)
    engineConnMock.sendPipeCommandLongRunning.mockResolvedValue({
      cmd: 'saveClip',
      payload: { success: false, error: 'disk full' },
    })
    const handlers = captureHandlers()
    const result = (await asyncHandler(handlers, IPC.CLIPS_SAVE_CLIP)()) as { success: boolean; error?: string }
    expect(result).toEqual({ success: false, error: 'disk full' })
  })

  it('uses a default message when the payload has only an error field', async () => {
    resetMocks()
    engineConnMock.isEngineRunning.mockReturnValue(true)
    engineConnMock.isPipeConnected.mockReturnValue(true)
    engineConnMock.sendPipeCommandLongRunning.mockResolvedValue({ cmd: 'saveClip', payload: { error: 'boom' } })
    const handlers = captureHandlers()
    const result = (await asyncHandler(handlers, IPC.CLIPS_SAVE_CLIP)()) as { success: boolean; error?: string }
    expect(result).toEqual({ success: false, error: 'boom' })
  })

  it('handles a non-Error rejection from the engine', async () => {
    resetMocks()
    engineConnMock.isEngineRunning.mockReturnValue(true)
    engineConnMock.isPipeConnected.mockReturnValue(true)
    engineConnMock.sendPipeCommandLongRunning.mockRejectedValue('kaboom')
    const handlers = captureHandlers()
    const result = (await asyncHandler(handlers, IPC.CLIPS_SAVE_CLIP)()) as { success: boolean; error?: string }
    expect(result).toEqual({ success: false, error: 'kaboom' })
  })

  it('skips config sync when the pipe never reconnects', async () => {
    vi.useFakeTimers()
    try {
      resetMocks()
      engineConnMock.isEngineRunning.mockReturnValue(true)
      engineConnMock.isPipeConnected.mockReturnValue(false)
      engineConnMock.sendPipeCommandLongRunning.mockResolvedValue({ cmd: 'saveClip', payload: { success: true } })
      const handlers = captureHandlers()
      const pending = asyncHandler(handlers, IPC.CLIPS_SAVE_CLIP)()
      await vi.advanceTimersByTimeAsync(5200)
      const result = (await pending) as { success: boolean }
      expect(result.success).toBe(true)
      expect(engineConnMock.sendWithFallback).not.toHaveBeenCalledWith('config', expect.anything())
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('CLIPS_STOP_CAPTURE default error', () => {
  it('falls back to a generic message when the engine omits the error', async () => {
    resetMocks()
    engineConnMock.isEngineRunning.mockReturnValue(true)
    engineConnMock.sendWithFallback.mockResolvedValue({ success: false })
    const handlers = captureHandlers()
    const result = (await asyncHandler(handlers, IPC.CLIPS_STOP_CAPTURE)()) as { success: boolean; error?: string }
    expect(result).toEqual({ success: false, error: 'Failed to stop capture' })
  })
})

describe('CLIPS_SET_AUDIO_SESSIONS branch gaps', () => {
  it('uses a default message when the payload has no error', async () => {
    resetMocks()
    engineConnMock.isPipeConnected.mockReturnValue(true)
    engineConnMock.sendPipeCommand.mockResolvedValue({ cmd: 'setAudioSessions', payload: { success: false } })
    const handlers = captureHandlers()
    const result = (await asyncHandler(handlers, IPC.CLIPS_SET_AUDIO_SESSIONS)({}, [1234])) as {
      success: boolean
      error?: string
    }
    expect(result).toEqual({ success: false, error: 'Command failed' })
  })

  it('handles a non-Error rejection', async () => {
    resetMocks()
    engineConnMock.isPipeConnected.mockReturnValue(true)
    engineConnMock.sendPipeCommand.mockRejectedValue('broken')
    const handlers = captureHandlers()
    const result = (await asyncHandler(handlers, IPC.CLIPS_SET_AUDIO_SESSIONS)({}, [1234])) as {
      success: boolean
      error?: string
    }
    expect(result).toEqual({ success: false, error: 'broken' })
  })
})

describe('CLIPS_DELETE_CLIP thumbnail cleanup', () => {
  it('removes the cached and engine thumbnails alongside the clip', async () => {
    resetMocks()
    thumbnailMock.getCachedThumbnailPath.mockReturnValue('C:\\clips\\.thumbnails\\clip.jpg')
    fspMock.access.mockImplementation((p: unknown) =>
      String(p).endsWith('.thumb.jpg') ? Promise.resolve() : Promise.reject(enoentError()),
    )
    const handlers = captureHandlers()
    const result = (await asyncHandler(handlers, IPC.CLIPS_DELETE_CLIP)({}, 'clip.mp4')) as { success: boolean }
    expect(result.success).toBe(true)
    expect(fspMock.unlink).toHaveBeenCalledTimes(3)
  })
})

describe('CLIPS_RENAME_CLIP engine thumbnail', () => {
  it('renames the engine .thumb.jpg marker', async () => {
    resetMocks()
    fspMock.access.mockImplementation((p: unknown) => {
      const s = String(p)
      if (s.endsWith('oldclip.mp4')) return Promise.resolve()
      if (s.endsWith('newclip.mp4')) return Promise.reject(enoentError())
      if (s.includes('oldclip.thumb.jpg')) return Promise.resolve()
      return Promise.reject(enoentError())
    })
    const handlers = captureHandlers()
    const result = (await asyncHandler(handlers, IPC.CLIPS_RENAME_CLIP)({}, 'oldclip.mp4', 'newclip')) as {
      success: boolean
    }
    expect(result.success).toBe(true)
    expect(fspMock.rename).toHaveBeenCalledWith('C:\\clips\\oldclip.thumb.jpg', 'C:\\clips\\newclip.thumb.jpg')
  })

  it('handles a non-Error rename failure', async () => {
    resetMocks()
    fspMock.access.mockResolvedValueOnce(undefined).mockRejectedValueOnce(enoentError())
    fspMock.rename.mockRejectedValueOnce('cross-volume')
    const handlers = captureHandlers()
    const result = (await asyncHandler(handlers, IPC.CLIPS_RENAME_CLIP)({}, 'oldclip.mp4', 'newclip')) as {
      success: boolean
      error?: string
    }
    expect(result).toEqual({ success: false, error: 'cross-volume' })
  })
})

describe('CLIPS_GET_THUMBNAIL traversal', () => {
  it('returns null when the clip name escapes the output directory', async () => {
    resetMocks()
    const handlers = captureHandlers()
    const result = await asyncHandler(handlers, IPC.CLIPS_GET_THUMBNAIL)({}, '../escape')
    expect(result).toBeNull()
    expect(thumbnailMock.getThumbnailDataUrl).not.toHaveBeenCalled()
  })
})

describe('CLIPS_SELECT_OUTPUT_DIR focused window', () => {
  it('passes the focused window to the dialog', async () => {
    resetMocks()
    const win = { id: 1 }
    browserMock.getFocusedWindow.mockReturnValue(win)
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:\\Clips'] })
    const handlers = captureHandlers()
    const result = await asyncHandler(handlers, IPC.CLIPS_SELECT_OUTPUT_DIR)()
    expect(result).toBe('D:\\Clips')
    expect(dialogMock.showOpenDialog).toHaveBeenCalledWith(
      win,
      expect.objectContaining({ properties: expect.any(Array) }),
    )
  })
})

describe('CLIPS_MERGE_CLIPS enhance probing', () => {
  it('rejects a non-array clip list', async () => {
    resetMocks()
    const handlers = captureHandlers()
    const result = (await asyncHandler(handlers, IPC.CLIPS_MERGE_CLIPS)({}, 'not-an-array')) as ClipMergeResult
    expect(result.success).toBe(false)
    expect(result.error).toBe('At least 2 clips required')
  })

  it('ignores enhance when the source resolution cannot be probed', async () => {
    resetMocks()
    enhanceMock.parseEnhanceOption.mockReturnValue('sr')
    fspMock.access.mockResolvedValue(undefined)
    execFileMock.mockImplementation(((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: null) => void
      cb(null)
      return { on: vi.fn() }
    }) as never)

    const handlers = captureHandlers()
    const gpus = asyncHandler(handlers, IPC.CLIPS_GET_GPUS)
    engineConnMock.isPipeConnected.mockReturnValue(true)
    engineConnMock.sendPipeCommand.mockResolvedValue({
      cmd: 'getGpus',
      payload: [{ index: 0, name: 'AMD', vendorId: 4098 }],
    })
    await gpus()

    const result = (await asyncHandler(handlers, IPC.CLIPS_MERGE_CLIPS)(
      {},
      ['C:\\clips\\a.mp4', 'C:\\clips\\b.mp4'],
      'sr',
    )) as ClipMergeResult
    expect(result.success).toBe(true)
    expect(logger.warning).toHaveBeenCalledWith(
      'clips',
      'MergeClips enhance ignored: could not probe source resolution',
    )
  })
})

describe('CLIPS_TRIM_CLIP focused branch', () => {
  it('uses copy args when sharpness is set without re-encode', async () => {
    resetMocks()
    fspMock.access.mockResolvedValue(undefined)
    execFileMock.mockImplementation(((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: null) => void
      cb(null)
      return { on: vi.fn() }
    }) as never)
    const handlers = captureHandlers()
    const result = (await asyncHandler(handlers, IPC.CLIPS_TRIM_CLIP)(
      {},
      'clip.mp4',
      1,
      2,
      false,
      'none',
      0.5,
    )) as ClipTrimResult
    expect(result.success).toBe(true)
    expect(logger.warning).toHaveBeenCalledWith('clips', 'TrimClip sharpness ignored: sharpening requires re-encode')
  })
})

describe('CLIPS_PUBLISH progress fan-out', () => {
  it('forwards progress to every window', async () => {
    resetMocks()
    fspMock.access.mockResolvedValue(undefined)
    const live = { webContents: { send: vi.fn() } }
    const dead = { webContents: { send: vi.fn() } }
    browserMock.getAllWindows.mockReturnValue([live, dead])
    uploadMock.mockImplementation(async (_path: string, onProgress?: (p: { percent: number }) => void) => {
      onProgress?.({ percent: 42 })
      return { success: true, link: 'https://gofile.io/d/abc' }
    })

    const handlers = captureHandlers()
    const result = (await asyncHandler(handlers, IPC.CLIPS_PUBLISH)({}, 'C:\\clips\\clip.mp4')) as {
      success: boolean
    }
    expect(result.success).toBe(true)
    expect(live.webContents.send).toHaveBeenCalledWith(IPC.CLIPS_PUBLISH_PROGRESS, {
      clipPath: 'C:\\clips\\clip.mp4',
      percent: 42,
    })
    expect(dead.webContents.send).toHaveBeenCalledWith(IPC.CLIPS_PUBLISH_PROGRESS, {
      clipPath: 'C:\\clips\\clip.mp4',
      percent: 42,
    })
  })
})
