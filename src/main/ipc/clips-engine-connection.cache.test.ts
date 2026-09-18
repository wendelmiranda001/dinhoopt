import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

const execFileMock = vi.hoisted(() => vi.fn())
const readdirMock = vi.hoisted(() => vi.fn())
const statMock = vi.hoisted(() => vi.fn())
const getAllWindowsMock = vi.hoisted(() => vi.fn(() => [] as unknown[]))

const engineMock = vi.hoisted(() => ({
  isEngineRunning: vi.fn(() => false),
  isEngineCapturing: vi.fn(() => false),
  setEngineCapturing: vi.fn(),
  readEngineStatus: vi.fn(() => ({}) as Record<string, unknown>),
  initEnginePipeIntegration: vi.fn(),
  registerGetCurrentStatus: vi.fn(),
  getEnginePath: vi.fn(() => 'engine.exe'),
  getEnginePid: vi.fn(() => null),
  startEngine: vi.fn(),
  stopEngineProcess: vi.fn(),
}))

const pipeMock = vi.hoisted(() => ({
  isPipeConnected: vi.fn(() => true),
  sendWithFallback: vi.fn(async (): Promise<{ success: boolean; error?: string }> => ({ success: true })),
  sendPipeCommand: vi.fn(),
  sendPipeCommandLongRunning: vi.fn(),
  waitForPipeConnection: vi.fn(async () => true),
  connectPipe: vi.fn(),
}))

const configMock = vi.hoisted(() => ({
  buildEngineConfig: vi.fn(() => ({})),
  getDefaultOutputDir: vi.fn(() => 'C:\\Users\\Test\\Desktop\\DiNhoClips'),
  config: {
    engineFps: 60,
    engineReplayTimeSeconds: 120,
    audioSampleRate: 48000,
    customGameProcess: '',
    width: 1920,
    height: 1080,
    bitrateKbps: 40000,
    audioLoopback: false,
    gameVolume: 1,
    micVolume: 1,
    outputDirectory: '',
    selectedAudioSessions: [] as number[],
  },
}))

vi.mock('node:child_process', () => ({ execFile: execFileMock, execFileSync: vi.fn(), spawn: vi.fn() }))
vi.mock('node:fs', () => fsMock)
vi.mock('node:fs/promises', () => ({ readdir: readdirMock, stat: statMock }))
vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: vi.fn(() => 'C:\\Users\\Test\\AppData') },
  BrowserWindow: { getAllWindows: getAllWindowsMock },
}))
vi.mock('../services/logger.service', () => ({
  getLogger: () => ({ info: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}))
vi.mock('../services/clips-config-manager', () => configMock)
vi.mock('../services/ffmpeg-path', () => ({ getFfmpegPath: () => 'ffmpeg.exe' }))
vi.mock('./clips-engine', () => engineMock)
vi.mock('./clips-pipe', () => pipeMock)

import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { IPC } from '@shared/channels'

const CACHE_FILE = 'C:\\Users\\Test\\AppData\\clips-duration-cache.json'

async function importFresh() {
  vi.resetModules()
  return await import('./clips-engine-connection')
}

function mockExecFileDuration(seconds: number): void {
  vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error | null, stdout: string, stderr: string) => void
    const hh = String(Math.floor(seconds / 3600)).padStart(2, '0')
    const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
    const ss = String(seconds % 60).padStart(2, '0')
    cb(null, '', `Duration: ${hh}:${mm}:${ss}.000\n`)
    return undefined
  }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  fsMock.existsSync.mockReturnValue(false)
  fsMock.mkdirSync.mockReturnValue(undefined)
  fsMock.readFileSync.mockReturnValue('[]')
  fsMock.writeFileSync.mockReturnValue(undefined)
  engineMock.isEngineRunning.mockReturnValue(false)
  engineMock.isEngineCapturing.mockReturnValue(false)
  engineMock.readEngineStatus.mockReturnValue({})
  pipeMock.isPipeConnected.mockReturnValue(true)
  pipeMock.waitForPipeConnection.mockResolvedValue(true)
  pipeMock.sendWithFallback.mockResolvedValue({ success: true })
  getAllWindowsMock.mockReturnValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('persisted duration cache hydration', () => {
  it('loads valid entries and skips malformed or zero-duration ones', async () => {
    fsMock.existsSync.mockReturnValue(true)
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify([
        { path: 'C:\\Clips\\good.mp4', duration: 42, mtimeMs: 111 },
        { path: 'C:\\Clips\\zero.mp4', duration: 0, mtimeMs: 111 },
        { path: 'C:\\Clips\\noMtime.mp4', duration: 5 },
        { duration: 9, mtimeMs: 1 },
        null,
        'junk',
      ]),
    )

    const mod = await importFresh()
    const map = await mod.getDurationsForClips([{ path: 'C:\\Clips\\good.mp4', mtimeMs: 111 }])

    expect(map.get('C:\\Clips\\good.mp4')).toBe(42)
    expect(execFile).not.toHaveBeenCalled()
  })

  it('ignores a payload that is not an array', async () => {
    fsMock.existsSync.mockReturnValue(true)
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ path: 'C:\\Clips\\a.mp4' }))
    mockExecFileDuration(7)

    const mod = await importFresh()
    const map = await mod.getDurationsForClips([{ path: 'C:\\Clips\\a.mp4', mtimeMs: 1 }])

    expect(execFile).toHaveBeenCalledTimes(1)
    expect(map.get('C:\\Clips\\a.mp4')).toBe(7)
  })

  it('ignores an unreadable cache file', async () => {
    fsMock.existsSync.mockReturnValue(true)
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error('EACCES')
    })
    mockExecFileDuration(2)

    const mod = await importFresh()
    const map = await mod.getDurationsForClips([{ path: 'C:\\Clips\\b.mp4', mtimeMs: 1 }])

    expect(map.get('C:\\Clips\\b.mp4')).toBe(2)
  })

  it('caps the hydrated cache at 500 entries', async () => {
    const entries = Array.from({ length: 600 }, (_, i) => ({
      path: `C:\\Clips\\c${i}.mp4`,
      duration: i + 1,
      mtimeMs: 1,
    }))
    fsMock.existsSync.mockReturnValue(true)
    fsMock.readFileSync.mockReturnValue(JSON.stringify(entries))
    mockExecFileDuration(3)

    const mod = await importFresh()

    const insideCap = await mod.getDurationsForClips([{ path: 'C:\\Clips\\c100.mp4', mtimeMs: 1 }])
    expect(execFile).not.toHaveBeenCalled()
    expect(insideCap.get('C:\\Clips\\c100.mp4')).toBe(101)

    const droppedByCap = await mod.getDurationsForClips([{ path: 'C:\\Clips\\c550.mp4', mtimeMs: 1 }])
    expect(execFile).toHaveBeenCalledTimes(1)
    expect(droppedByCap.get('C:\\Clips\\c550.mp4')).toBe(3)
  })
})

describe('duration cache eviction and invalidation', () => {
  it('evicts the oldest entry once 500 clips are cached', async () => {
    mockExecFileDuration(1)
    const mod = await importFresh()

    const batch = Array.from({ length: 501 }, (_, i) => ({ path: `C:\\Clips\\e${i}.mp4`, mtimeMs: 1 }))
    await mod.getDurationsForClips(batch)
    expect(execFile).toHaveBeenCalledTimes(501)

    await mod.getDurationsForClips([{ path: 'C:\\Clips\\e1.mp4', mtimeMs: 1 }])
    expect(execFile).toHaveBeenCalledTimes(501)

    await mod.getDurationsForClips([{ path: 'C:\\Clips\\e0.mp4', mtimeMs: 1 }])
    expect(execFile).toHaveBeenCalledTimes(502)
  })

  it('invalidates a single entry and then the whole cache', async () => {
    mockExecFileDuration(11)
    const mod = await importFresh()

    await mod.getDurationsForClips([{ path: 'C:\\Clips\\i.mp4', mtimeMs: 1 }])
    expect(execFile).toHaveBeenCalledTimes(1)

    mod.invalidateDurationCache('C:\\Clips\\i.mp4')
    await mod.getDurationsForClips([{ path: 'C:\\Clips\\i.mp4', mtimeMs: 1 }])
    expect(execFile).toHaveBeenCalledTimes(2)

    mod.invalidateDurationCache()
    await mod.getDurationsForClips([{ path: 'C:\\Clips\\i.mp4', mtimeMs: 1 }])
    expect(execFile).toHaveBeenCalledTimes(3)
  })

  it('recomputes expired entries when the mtime changes', async () => {
    mockExecFileDuration(4)
    const mod = await importFresh()

    await mod.getDurationsForClips([{ path: 'C:\\Clips\\m.mp4', mtimeMs: 10 }])
    await mod.getDurationsForClips([{ path: 'C:\\Clips\\m.mp4', mtimeMs: 20 }])

    expect(execFile).toHaveBeenCalledTimes(2)
  })
})

describe('debounced persistence', () => {
  it('creates the cache directory and writes the JSON after the debounce', async () => {
    vi.useFakeTimers()
    mockExecFileDuration(9)
    fsMock.existsSync.mockReturnValue(false)

    const mod = await importFresh()
    await mod.getDurationsForClips([{ path: 'C:\\Clips\\p.mp4', mtimeMs: 2 }])

    expect(fsMock.writeFileSync).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000)

    expect(fsMock.mkdirSync).toHaveBeenCalledWith('C:\\Users\\Test\\AppData', { recursive: true })
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(CACHE_FILE, expect.stringContaining('p.mp4'), 'utf-8')
  })

  it('persists into an existing directory without recreating it', async () => {
    vi.useFakeTimers()
    mockExecFileDuration(9)
    fsMock.existsSync.mockReturnValue(true)
    fsMock.readFileSync.mockReturnValue('[]')

    const mod = await importFresh()
    await mod.getDurationsForClips([{ path: 'C:\\Clips\\q.mp4', mtimeMs: 2 }])
    await vi.advanceTimersByTimeAsync(5000)

    expect(fsMock.mkdirSync).not.toHaveBeenCalled()
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1)
  })
})

describe('readClipsFromDisk', () => {
  it('returns the warm cache on a repeated read', async () => {
    fsMock.existsSync.mockReturnValue(true)
    readdirMock.mockResolvedValue([] as never)

    const mod = await importFresh()
    const first = await mod.readClipsFromDisk()
    const second = await mod.readClipsFromDisk()

    expect(first).toEqual([])
    expect(second).toEqual([])
    expect(readdir).toHaveBeenCalledTimes(1)
  })

  it('returns an empty list when the output directory cannot be created', async () => {
    fsMock.existsSync.mockReturnValue(false)
    fsMock.mkdirSync.mockImplementation(() => {
      throw new Error('EPERM')
    })

    const mod = await importFresh()
    await expect(mod.readClipsFromDisk()).resolves.toEqual([])
  })

  it('lists clips, computes background durations and notifies the renderer', async () => {
    const live = { isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() } }
    const dead = { isDestroyed: vi.fn(() => true), webContents: { send: vi.fn() } }
    getAllWindowsMock.mockReturnValue([dead, live])
    fsMock.existsSync.mockReturnValue(true)
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify([{ path: 'C:\\Users\\Test\\Desktop\\DiNhoClips\\cached.mp4', duration: 12, mtimeMs: 1000 }]),
    )
    readdirMock.mockResolvedValue(['cached.mp4', 'fresh.mp4', 'broken.mp4', 'notes.txt'] as never)
    statMock.mockImplementation((async (p: string) => {
      if (String(p).endsWith('broken.mp4')) throw new Error('ENOENT')
      const mtimeMs = String(p).endsWith('fresh.mp4') ? 5000 : 1000
      return {
        size: 2048,
        mtime: new Date(mtimeMs),
        birthtime: mtimeMs === 1000 ? new Date(0) : new Date(mtimeMs),
      }
    }) as never)
    mockExecFileDuration(5)

    const mod = await importFresh()
    const clips = await mod.readClipsFromDisk()

    expect(clips).toHaveLength(2)
    expect(clips.find((c) => c.name === 'cached.mp4')?.duration).toBe(12)
    expect(clips.find((c) => c.name === 'fresh.mp4')?.duration).toBe(0)
    expect(clips.find((c) => c.name === 'fresh.mp4')?.createdAt).toBe(new Date(5000).toISOString())

    await vi.waitFor(() => expect(live.webContents.send).toHaveBeenCalledWith(IPC.CLIPS_DURATIONS_READY))
    expect(dead.webContents.send).not.toHaveBeenCalled()
    expect(execFile).toHaveBeenCalledTimes(1)
  })

  it('returns an empty list when listing the directory fails', async () => {
    fsMock.existsSync.mockReturnValue(true)
    readdirMock.mockRejectedValue(new Error('disk error'))

    const mod = await importFresh()
    await expect(mod.readClipsFromDisk()).resolves.toEqual([])
  })
})

describe('startClipCapture pipe recovery', () => {
  it('fails when the engine is not running', async () => {
    engineMock.isEngineRunning.mockReturnValue(false)
    const mod = await importFresh()

    await expect(mod.startClipCapture()).resolves.toEqual({ success: false, error: 'Engine not running' })
  })

  it('short-circuits when capture is already active', async () => {
    engineMock.isEngineRunning.mockReturnValue(true)
    engineMock.isEngineCapturing.mockReturnValue(true)
    const mod = await importFresh()

    await expect(mod.startClipCapture()).resolves.toEqual({ success: true })
    expect(pipeMock.sendWithFallback).not.toHaveBeenCalled()
  })

  it('reconnects the pipe and reports failure when it never connects', async () => {
    engineMock.isEngineRunning.mockReturnValue(true)
    engineMock.isEngineCapturing.mockReturnValue(false)
    pipeMock.isPipeConnected.mockReturnValue(false)
    pipeMock.waitForPipeConnection.mockResolvedValue(false)
    const mod = await importFresh()

    await expect(mod.startClipCapture()).resolves.toEqual({ success: false, error: 'Engine pipe not connected' })
    expect(pipeMock.connectPipe).toHaveBeenCalledTimes(1)
    expect(pipeMock.sendWithFallback).not.toHaveBeenCalled()
  })

  it('reconnects, syncs config and starts capture against the target game', async () => {
    engineMock.isEngineRunning.mockReturnValue(true)
    engineMock.isEngineCapturing.mockReturnValue(false)
    engineMock.readEngineStatus.mockReturnValue({ currentGame: 'game.exe (pid 42) [x]' })
    pipeMock.isPipeConnected.mockReturnValue(false)
    pipeMock.waitForPipeConnection.mockResolvedValue(true)
    const mod = await importFresh()

    await expect(mod.startClipCapture()).resolves.toEqual({ success: true })

    expect(pipeMock.connectPipe).toHaveBeenCalledTimes(1)
    expect(pipeMock.sendWithFallback).toHaveBeenNthCalledWith(1, 'config', expect.anything())
    expect(pipeMock.sendWithFallback).toHaveBeenNthCalledWith(2, 'startCapture', { gameProcess: 'game.exe' })
    expect(engineMock.setEngineCapturing).toHaveBeenCalledWith(true)
  })

  it('does not mark capture active when the engine rejects the command', async () => {
    engineMock.isEngineRunning.mockReturnValue(true)
    engineMock.isEngineCapturing.mockReturnValue(false)
    engineMock.readEngineStatus.mockReturnValue({})
    pipeMock.sendWithFallback.mockResolvedValue({ success: false, error: 'denied' })
    const mod = await importFresh()

    await expect(mod.startClipCapture()).resolves.toEqual({ success: false, error: 'denied' })
    expect(engineMock.setEngineCapturing).not.toHaveBeenCalled()
  })
})

describe('getVideoDuration', () => {
  it('parses the ffmpeg duration output', async () => {
    mockExecFileDuration(75)
    const mod = await importFresh()

    await expect(mod.getVideoDuration('C:\\Clips\\x.mp4')).resolves.toBe(75)
  })

  it('returns 0 when ffmpeg reports no duration', async () => {
    vi.mocked(execFile).mockImplementation(((_c: string, _a: string[], _o: unknown, cb: never) => {
      ;(cb as unknown as (e: null, s: string, w: string) => void)(null, '', 'no metadata here\n')
      return undefined
    }) as never)
    const mod = await importFresh()

    await expect(mod.getVideoDuration('C:\\Clips\\x.mp4')).resolves.toBe(0)
  })
})
