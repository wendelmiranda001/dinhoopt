import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Module-level mocks (hoisted) ─────────────────────────
const mockLogger = { info: vi.fn(), error: vi.fn(), warning: vi.fn() }
let dataHandlers: Array<(chunk: Buffer) => void> = []
let errorHandlers: Array<(err: Error) => void> = []
let closeHandlers: Array<() => void> = []
let timeoutHandlers: Array<() => void> = []
let _connectHandler: (() => void) | null = null

function resetMockSocket(): void {
  dataHandlers = []
  errorHandlers = []
  closeHandlers = []
  timeoutHandlers = []
  _connectHandler = null
}

const mockSocket = {
  on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    if (event === 'connect') {
      _connectHandler = cb as () => void
      cb()
    } else if (event === 'data') {
      dataHandlers.push(cb as (chunk: Buffer) => void)
    } else if (event === 'error') {
      errorHandlers.push(cb as (err: Error) => void)
    } else if (event === 'close') {
      closeHandlers.push(cb as () => void)
    } else if (event === 'timeout') {
      timeoutHandlers.push(cb as () => void)
    }
    return mockSocket
  }),
  destroy: vi.fn(),
  write: vi.fn().mockReturnValue(true),
  end: vi.fn(),
  setTimeout: vi.fn(),
  removeAllListeners: vi.fn(),
}

vi.mock('node:child_process', () => ({ execFile: vi.fn(), execFileSync: vi.fn(), spawn: vi.fn() }))
vi.mock('node:net', () => ({ connect: vi.fn(() => mockSocket) }))
vi.mock('node:fs', () => ({ existsSync: vi.fn(), mkdirSync: vi.fn() }))
vi.mock('node:fs/promises', () => ({ readdir: vi.fn(), stat: vi.fn() }))
vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))
vi.mock('../services/logger.service', () => ({ getLogger: () => mockLogger }))
vi.mock('../services/clips-config-manager', () => ({
  buildEngineConfig: vi.fn(() => ({
    Hotkeys: [{ vk: 49, modifiers: [18], action: 'ToggleCapture', replayDurationSeconds: 60, enabled: true }],
  })),
  config: {
    engineFps: 30,
    engineReplayTimeSeconds: 120,
    width: 1920,
    height: 1080,
    bitrateKbps: 40000,
    audioLoopback: false,
    gameVolume: 1.0,
    micVolume: 1.0,
    audioSampleRate: 48000,
    customGameProcess: '',
    outputDirectory: '',
    selectedAudioSessions: [] as number[],
  },
  getDefaultOutputDir: vi.fn(() => 'C:\\Users\\Test\\Desktop\\DiNhoClips'),
  persistClipsConfig: vi.fn(),
}))
vi.mock('../services/thumbnail-generator', () => ({ getCachedThumbnailPath: vi.fn(() => null) }))

import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { connect } from 'node:net'
import { app, BrowserWindow } from 'electron'
import { buildEngineConfig, config as C, persistClipsConfig } from '../services/clips-config-manager'
import {
  getCurrentStatus,
  getEnginePath,
  getEnginePid,
  getVideoDuration,
  isEngineCapturing,
  isEngineRunning,
  isPipeConnected,
  readClipsFromDisk,
  resetClipsCache,
  sendPipeCommand,
  sendPipeCommandLongRunning,
  sendWithFallback,
  setEngineCapturing,
  startClipCapture,
  startEngine,
  stopEngineProcess,
} from './clips-engine-connection'
import { connectPipe, disconnectPipe, getPipeSocket } from './clips-pipe'

const ORIG_ENV = { ...process.env }

// ─── Helpers ───────────────────────────────────────────────
function makeMockChild() {
  return {
    pid: 42,
    kill: vi.fn(),
    killed: false,
    stdout: { on: vi.fn(), removeAllListeners: vi.fn() },
    stderr: { on: vi.fn(), removeAllListeners: vi.fn() },
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  }
}

function makeFakeSocket() {
  return {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'connect') {
        _connectHandler = cb as () => void
        cb()
      } else if (event === 'data') {
        dataHandlers.push(cb as (chunk: Buffer) => void)
      } else if (event === 'error') {
        errorHandlers.push(cb as (err: Error) => void)
      } else if (event === 'close') {
        closeHandlers.push(cb as () => void)
      } else if (event === 'timeout') {
        timeoutHandlers.push(cb as () => void)
      }
      return undefined as never
    }),
    destroy: vi.fn(),
    write: vi.fn().mockReturnValue(true),
    end: vi.fn(),
    setTimeout: vi.fn(),
    removeAllListeners: vi.fn(),
  }
}

function mockFfmpegDuration(stderr: string) {
  vi.mocked(execFile).mockImplementation(
    (
      _cmd: string,
      _args: readonly string[],
      _opts: unknown,
      cb?: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      if (cb) cb(null, '', stderr)
      return undefined as never
    },
  )
}

function triggerPipeData(chunk: string): void {
  for (const h of dataHandlers) h(Buffer.from(chunk, 'utf-8'))
}

// ─── Tests ─────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks()
  resetClipsCache()
  resetMockSocket()
  vi.mocked(connect).mockReturnValue(mockSocket as never)
  C.customGameProcess = ''
  C.outputDirectory = ''
  C.selectedAudioSessions = []
  C.audioLoopback = false
  C.gameVolume = 1.0
  C.micVolume = 1.0
})

afterEach(() => {
  stopEngineProcess()
  process.env = { ...ORIG_ENV }
})

// ─── Getters ───────────────────────────────────────────────
describe('getters', () => {
  it('isEngineRunning returns false initially', () => {
    expect(isEngineRunning()).toBe(false)
  })

  it('isEngineCapturing returns false initially', () => {
    expect(isEngineCapturing()).toBe(false)
  })

  it('isPipeConnected returns false initially', () => {
    expect(isPipeConnected()).toBe(false)
  })

  it('getEnginePid returns undefined initially', () => {
    expect(getEnginePid()).toBeUndefined()
  })

  it('setEngineCapturing sets the flag', () => {
    setEngineCapturing(true)
    expect(isEngineCapturing()).toBe(true)
    setEngineCapturing(false)
    expect(isEngineCapturing()).toBe(false)
  })
})

// ─── getEnginePath ─────────────────────────────────────────
describe('getEnginePath', () => {
  function engineSubpath(isDev: boolean): string {
    return join(
      'src',
      'DiNho.Capture.Poc',
      'bin',
      isDev ? 'Debug' : 'Release',
      'net10.0-windows10.0.26100.0',
      isDev ? 'DiNho.Capture.Poc.exe' : join('publish', 'DiNho.Capture.Poc.exe'),
    )
  }

  it('returns env var path when set and exists', () => {
    process.env.DINHO_CLIPS_ENGINE_PATH = 'D:\\custom\\engine.exe'
    vi.mocked(existsSync).mockImplementation((p: string) => p === 'D:\\custom\\engine.exe')
    expect(getEnginePath()).toBe('D:\\custom\\engine.exe')
  })

  it('skips env var when path does not exist', () => {
    process.env.DINHO_CLIPS_ENGINE_PATH = 'D:\\missing\\engine.exe'
    vi.mocked(existsSync).mockReturnValue(false)
    const result = getEnginePath()
    expect(result).not.toBe('D:\\missing\\engine.exe')
  })

  it('returns desktop dev path when USERPROFILE is set and path exists', () => {
    process.env.USERPROFILE = 'C:\\Users\\TestDev'
    vi.mocked(app).isPackaged = false
    const sub = engineSubpath(true)
    const desktopPath = join('C:\\Users\\TestDev', 'Desktop', 'dinho-clips-poc', sub)
    vi.mocked(existsSync).mockImplementation((p: string) => p === desktopPath)
    expect(getEnginePath()).toBe(desktopPath)
  })

  it('returns __dirname dev path when desktop candidate is empty and path exists', () => {
    delete process.env.USERPROFILE
    vi.mocked(app).isPackaged = false
    const sub = engineSubpath(true)
    const dirnamePath = join(__dirname, '..', '..', 'dinho-clips-poc', sub)
    vi.mocked(existsSync).mockImplementation((p: string) => p === dirnamePath)
    expect(getEnginePath()).toBe(dirnamePath)
  })

  it('returns clips-engine path (candidate 2)', () => {
    delete process.env.USERPROFILE
    vi.mocked(app).isPackaged = false
    const clipsPath = join(__dirname, '..', '..', 'clips-engine', 'DiNho.Capture.Poc.exe')
    vi.mocked(existsSync).mockImplementation((p: string) => p === clipsPath)
    expect(getEnginePath()).toBe(clipsPath)
  })

  it('returns resourcesPath path when packaged', () => {
    vi.mocked(app).isPackaged = true
    delete process.env.USERPROFILE
    const resourcesPath = join('', 'clips-engine', 'DiNho.Capture.Poc.exe')
    vi.mocked(existsSync).mockImplementation((p: string) => p === resourcesPath)
    expect(getEnginePath()).toBe(resourcesPath)
  })

  it('returns cwd fallback when no candidate exists and USERPROFILE cleared', () => {
    delete process.env.USERPROFILE
    vi.mocked(app).isPackaged = false
    vi.mocked(existsSync).mockReturnValue(false)
    const sub = engineSubpath(true)
    // Last candidate is cwd, fallback = candidates[1] when no desktop
    const fallback = join(__dirname, '..', '..', 'dinho-clips-poc', sub)
    expect(getEnginePath()).toBe(fallback)
  })

  it('returns desktop fallback when nothing matches and USERPROFILE is set', () => {
    process.env.USERPROFILE = 'C:\\Users\\TestDev'
    vi.mocked(app).isPackaged = false
    vi.mocked(existsSync).mockReturnValue(false)
    const sub = engineSubpath(true)
    const desktopPath = join('C:\\Users\\TestDev', 'Desktop', 'dinho-clips-poc', sub)
    expect(getEnginePath()).toBe(desktopPath)
  })

  it('returns fallback candidates[1] when desktop is empty and existsSync returns none', () => {
    delete process.env.USERPROFILE
    vi.mocked(app).isPackaged = false
    vi.mocked(existsSync).mockReturnValue(false)
    const sub = engineSubpath(true)
    const expected = join(__dirname, '..', '..', 'dinho-clips-poc', sub)
    expect(getEnginePath()).toBe(expected)
  })

  it('uses Release subpath when isPackaged is true', () => {
    vi.mocked(app).isPackaged = true
    process.env.USERPROFILE = 'C:\\Users\\TestDev'
    const sub = join(
      'src',
      'DiNho.Capture.Poc',
      'bin',
      'Release',
      'net10.0-windows10.0.26100.0',
      'publish',
      'DiNho.Capture.Poc.exe',
    )
    const desktopPath = join('C:\\Users\\TestDev', 'Desktop', 'dinho-clips-poc', sub)
    vi.mocked(existsSync).mockImplementation((p: string) => p === desktopPath)
    expect(getEnginePath()).toBe(desktopPath)
  })
})

// ─── getVideoDuration ──────────────────────────────────────
describe('getVideoDuration', () => {
  it('parses Duration line correctly', async () => {
    mockFfmpegDuration('Duration: 01:23:45.67, start: 0.000000, bitrate: 1000 kb/s\n')
    const dur = await getVideoDuration('/path/to/clip.mp4')
    // 1*3600 + 23*60 + 45 + 670/1000 = 3600 + 1380 + 45 + 0.67 = 5025.67 → Math.round = 5026
    expect(dur).toBe(5026)
  })

  it('returns 0 when Duration line is missing', async () => {
    mockFfmpegDuration('ffmpeg version 6.0 ...\n')
    const dur = await getVideoDuration('/path/to/clip.mp4')
    expect(dur).toBe(0)
  })

  it('returns 0 when ffmpeg errors without stderr', async () => {
    vi.mocked(execFile).mockImplementation(
      (
        _cmd: string,
        _args: readonly string[],
        _opts: unknown,
        cb?: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (cb) cb(new Error('ENOENT'), '', '')
        return undefined as never
      },
    )
    const dur = await getVideoDuration('/path/to/clip.mp4')
    expect(dur).toBe(0)
  })

  it('parses short durations correctly', async () => {
    mockFfmpegDuration('Duration: 00:00:05.00, start: 0.000000\n')
    const dur = await getVideoDuration('/path/to/clip.mp4')
    expect(dur).toBe(5)
  })

  it('handles single-digit centiseconds by padding', async () => {
    mockFfmpegDuration('Duration: 00:00:10.50, start: 0.000000\n')
    const dur = await getVideoDuration('/path/to/clip.mp4')
    expect(dur).toBe(11) // 10 + 0.5 = 10.5 → round = 11
  })

  it('handles consecutive padEnd for shorter centiseconds', async () => {
    mockFfmpegDuration('Duration: 00:00:01.05, start: 0.000000\n')
    const dur = await getVideoDuration('/path/to/clip.mp4')
    expect(dur).toBe(1) // 1 + 0.05 = 1.05 → Math.round = 1
  })

  it('returns 0 for empty stderr', async () => {
    mockFfmpegDuration('')
    const dur = await getVideoDuration('/path/to/clip.mp4')
    expect(dur).toBe(0)
  })

  it('calls execFile with correct args', async () => {
    mockFfmpegDuration('Duration: 00:01:00.00\n')
    await getVideoDuration('/my/clip.mp4')
    expect(vi.mocked(execFile)).toHaveBeenCalledWith(
      'ffmpeg',
      ['-i', '/my/clip.mp4'],
      expect.objectContaining({ encoding: 'utf-8', timeout: 5000, windowsHide: true }),
      expect.any(Function),
    )
  })
})

// ─── readClipsFromDisk ─────────────────────────────────────
describe('readClipsFromDisk', () => {
  it('returns empty array when output directory does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const clips = await readClipsFromDisk()
    expect(clips).toEqual([])
  })

  it('returns sorted clips from disk', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdir).mockResolvedValue(['b.mp4', 'a.mp4'] as unknown as Awaited<ReturnType<typeof readdir>>)
    mockFfmpegDuration('Duration: 00:01:00.00\n')
    vi.mocked(stat)
      .mockResolvedValueOnce({
        size: 100,
        birthtime: new Date('2026-06-20T10:00:00Z'),
        mtime: new Date('2026-06-20T10:00:00Z'),
      } as Awaited<ReturnType<typeof stat>>)
      .mockResolvedValueOnce({
        size: 200,
        birthtime: new Date('2026-06-21T10:00:00Z'),
        mtime: new Date('2026-06-21T10:00:00Z'),
      } as Awaited<ReturnType<typeof stat>>)

    const clips = await readClipsFromDisk()
    expect(clips).toHaveLength(2)
    expect(clips[0]!.name).toBe('a.mp4') // newest first (June 21)
    expect(clips[0]!.size).toBe(200)
    expect(clips[1]!.name).toBe('b.mp4')
    expect(clips[1]!.size).toBe(100)
  })

  it('falls back to mtime when birthtime is epoch 0', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdir).mockResolvedValue(['clip.mp4'] as unknown as Awaited<ReturnType<typeof readdir>>)
    mockFfmpegDuration('Duration: 00:01:00.00\n')
    vi.mocked(stat).mockResolvedValue({
      size: 100,
      birthtime: new Date(0),
      mtime: new Date('2026-06-21T10:00:00Z'),
    } as Awaited<ReturnType<typeof stat>>)

    const clips = await readClipsFromDisk()
    expect(clips).toHaveLength(1)
    expect(clips[0]!.createdAt).toBe('2026-06-21T10:00:00.000Z')
  })

  it('filters non-mp4 files', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdir).mockResolvedValue(['clip.mp4', 'notes.txt', 'image.png'] as unknown as Awaited<
      ReturnType<typeof readdir>
    >)
    vi.mocked(stat).mockResolvedValue({ size: 50, birthtime: new Date(), mtime: new Date() } as Awaited<
      ReturnType<typeof stat>
    >)
    mockFfmpegDuration('Duration: 00:01:00.00\n')

    const clips = await readClipsFromDisk()
    expect(clips).toHaveLength(1)
    expect(clips[0]!.name).toBe('clip.mp4')
  })

  it('skips files that fail to stat', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdir).mockResolvedValue(['good.mp4', 'bad.mp4'] as unknown as Awaited<ReturnType<typeof readdir>>)
    mockFfmpegDuration('Duration: 00:00:30.00\n')
    vi.mocked(stat)
      .mockResolvedValueOnce({ size: 50, birthtime: new Date(), mtime: new Date() } as Awaited<ReturnType<typeof stat>>)
      .mockRejectedValueOnce(new Error('permission denied'))

    const clips = await readClipsFromDisk()
    expect(clips).toHaveLength(1)
    expect(clips[0]!.name).toBe('good.mp4')
  })

  it('handles readdir error gracefully', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdir).mockRejectedValue(new Error('disk error'))

    const clips = await readClipsFromDisk()
    expect(clips).toEqual([])
    expect(mockLogger.error).toHaveBeenCalled()
  })
})

// ─── getCurrentStatus ──────────────────────────────────────
describe('getCurrentStatus', () => {
  it('returns default state when engine not running', () => {
    const s = getCurrentStatus()
    expect(s.running).toBe(false)
    expect(s.capturing).toBe(false)
    expect(s.uptime).toBe(0)
    expect(s.fps).toBe(30)
    expect(s.replayTimeSeconds).toBe(120)
    expect(s.captureBackend).toBeUndefined()
    expect(s.encoder).toBeUndefined()
    expect(s.estimatedRamMB).toBeUndefined()
    expect(s.diskSpaceOk).toBe(true)
    expect(s.customGameProcess).toBeUndefined()
    expect(s.audioLoopback).toBeUndefined()
    expect(s.audioFallback).toBeUndefined()
    expect(s.replayBufferBytes).toBeUndefined()
  })

  it('reflects engine state when running', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)

    await startEngine()

    const s = getCurrentStatus()
    expect(s.running).toBe(true)
    expect(s.uptime).toBeGreaterThanOrEqual(0)
  })

  it('reflects capturing flag', () => {
    setEngineCapturing(true)
    expect(getCurrentStatus().capturing).toBe(true)
  })

  it('includes customGameProcess when set', () => {
    C.customGameProcess = 'game.exe'
    const s = getCurrentStatus()
    expect(s.currentGame).toBe('game.exe')
    expect(s.customGameProcess).toBe('game.exe')
  })

  it('includes replay buffer fields when non-zero', async () => {
    // Start engine to get pipe handlers set up
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    triggerPipeData(
      `${JSON.stringify({
        cmd: '_event',
        payload: {
          type: 'engineStatus',
          replayBufferBytes: 1048576,
          replayBufferVideoFrames: 600,
          replayBufferVideoBytes: 900000,
          replayBufferAudioPackets: 1200,
          replayBufferAudioBytes: 148576,
        },
      })}\n`,
    )
    const s = getCurrentStatus()
    expect(s.replayBufferBytes).toBe(1048576)
    expect(s.replayBufferVideoFrames).toBe(600)
    expect(s.replayBufferVideoBytes).toBe(900000)
    expect(s.replayBufferAudioPackets).toBe(1200)
    expect(s.replayBufferAudioBytes).toBe(148576)
  })

  it('includes drop counters when non-zero', async () => {
    // Start engine to get pipe handlers set up
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    triggerPipeData(
      `${JSON.stringify({
        cmd: '_event',
        payload: {
          type: 'engineStatus',
          droppedFrames: 7,
          gpuBusyDrops: 3,
        },
      })}\n`,
    )
    const s = getCurrentStatus()
    expect(s.droppedFrames).toBe(7)
    expect(s.gpuBusyDrops).toBe(3)
  })
})

// ─── sendPipeCommand ───────────────────────────────────────
describe('sendPipeCommand', () => {
  it('rejects when pipe not connected', async () => {
    await expect(sendPipeCommand('test')).rejects.toThrow('Pipe not connected')
  })

  it('sends JSON envelope over pipe when connected', async () => {
    // Set up pipe connected state via startEngine
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    const promise = sendPipeCommand('hello', { key: 'val' })
    expect(mockSocket.write).toHaveBeenCalledWith('{"v":1,"cmd":"hello","payload":{"key":"val"}}\n')

    // Resolve the pending request
    triggerPipeData(`{"cmd":"hello","payload":{"ok":true}}\n`)
    const result = await promise
    expect(result.payload).toEqual({ ok: true })
  })

  it('sends command without payload', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    const promise = sendPipeCommand('noop')
    expect(mockSocket.write).toHaveBeenCalledWith('{"v":1,"cmd":"noop"}\n')
    triggerPipeData(`{"cmd":"noop"}\n`)
    await promise
  })

  it('rejects on write error', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    mockSocket.write.mockImplementationOnce(() => {
      throw new Error('Broken pipe')
    })

    await expect(sendPipeCommand('test')).rejects.toThrow('Broken pipe')
  })

  it('rejects on write error with non-Error throw', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    mockSocket.write.mockImplementationOnce(() => {
      throw 'string error'
    })

    await expect(sendPipeCommand('test')).rejects.toThrow('string error')
  })

  it('replaces existing pending request for same command', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    // First pending for 'test'
    sendPipeCommand('test').catch(() => {})
    // Second pending replaces the first
    const p2 = sendPipeCommand('test')

    triggerPipeData(`{"cmd":"test","payload":"final"}\n`)
    const result = await p2
    expect(result.payload).toBe('final')
    // p1 was orphaned (timer cleared, removed from map) — expected behavior
  })
})

// ─── handlePipeMessage (via pipe data) ─────────────────────
describe('handlePipeMessage (via pipe data)', () => {
  beforeEach(async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()
  })

  it('updates engine state from engineStatus event with data wrapper', () => {
    triggerPipeData(
      `${JSON.stringify({
        cmd: '_event',
        payload: { type: 'engineStatus', data: { recording: true, fps: 120, game: 'FiveM' } },
      })}\n`,
    )

    expect(isEngineCapturing()).toBe(true)
    expect(C.engineFps).toBe(120)
  })

  it('updates engine state from engineStatus without data wrapper', () => {
    triggerPipeData(
      `${JSON.stringify({
        cmd: '_event',
        payload: { type: 'engineStatus', recording: true, fps: 60, game: 'Fortnite' },
      })}\n`,
    )

    expect(isEngineCapturing()).toBe(true)
    expect(C.engineFps).toBe(60)
  })

  it('updates all field types from engineStatus', () => {
    triggerPipeData(
      `${JSON.stringify({
        cmd: '_event',
        payload: {
          type: 'engineStatus',
          recording: true,
          fps: 90,
          replayTimeSeconds: 180,
          captureBackend: 'WGC',
          encoder: 'NVENC',
          estimatedRamMB: 2048,
          diskSpaceOk: false,
          game: 'Cyberpunk',
          lastCrashRecovered: true,
          audioLoopback: true,
          audioFallback: true,
          gameVolume: 1.5,
          micVolume: 0.8,
          width: 2560,
          height: 1440,
          bitrateKbps: 50000,
          audioSampleRate: 48000,
          replayBufferBytes: 1048576,
          replayBufferVideoFrames: 300,
          replayBufferVideoBytes: 524288,
          replayBufferAudioPackets: 1500,
          replayBufferAudioBytes: 65536,
          outputDirectory: 'D:\\Clips',
        },
      })}\n`,
    )

    expect(C.engineFps).toBe(90)
    expect(C.engineReplayTimeSeconds).toBe(180)
    expect(C.audioLoopback).toBe(true)
    expect(C.gameVolume).toBe(1.5)
    expect(C.micVolume).toBe(0.8)
    expect(C.width).toBe(2560)
    expect(C.height).toBe(1440)
    expect(C.bitrateKbps).toBe(50000)
    expect(C.audioSampleRate).toBe(48000)
    expect(C.outputDirectory).toBe('D:\\Clips')
  })

  it('clamps volume values to [0, 4]', () => {
    triggerPipeData(
      `${JSON.stringify({
        cmd: '_event',
        payload: { type: 'engineStatus', gameVolume: 5, micVolume: -1 },
      })}\n`,
    )
    expect(C.gameVolume).toBe(4)
    expect(C.micVolume).toBe(0)
  })

  it('ignores non-matching types for number fields', () => {
    C.engineFps = 30
    triggerPipeData(
      `${JSON.stringify({
        cmd: '_event',
        payload: { type: 'engineStatus', fps: 'not-a-number', game: 'Test' },
      })}\n`,
    )
    // Should NOT have changed to NaN
    expect(C.engineFps).toBe(30)
  })

  it('ignores non-matching types for boolean fields', async () => {
    // Start engine to get pipe handlers set up
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    // Set known initial values via valid pipe messages (use truthy values to test against || undefined)
    triggerPipeData(
      `${JSON.stringify({
        cmd: '_event',
        payload: {
          type: 'engineStatus',
          diskSpaceOk: true,
          audioLoopback: true,
          audioFallback: true,
        },
      })}\n`,
    )
    expect(C.audioLoopback).toBe(true)

    // Now send non-matching types — these should be IGNORED by the statusUpdater typeof guards
    triggerPipeData(
      `${JSON.stringify({
        cmd: '_event',
        payload: {
          type: 'engineStatus',
          diskSpaceOk: 'yes',
          lastCrashRecovered: 1,
          audioLoopback: 'true',
          audioFallback: null,
        },
      })}\n`,
    )
    // audioLoopback should NOT be changed to a string — it stays boolean true
    expect(C.audioLoopback).toBe(true)
    // getCurrentStatus reads from readEngineStatus — verify booleans were not overwritten
    const s = getCurrentStatus()
    // diskSpaceOk was set to true above, non-boolean 'yes' should be ignored → stays true
    expect(s.diskSpaceOk).toBe(true)
    // audioFallback was set to true above, null should be ignored → stays true
    // (if the guard was broken, null || undefined would give undefined)
    expect(s.audioFallback).toBe(true)
  })

  it('logs warning on outputDirectory mismatch', () => {
    C.outputDirectory = 'E:\\OldClips'
    triggerPipeData(
      `${JSON.stringify({
        cmd: '_event',
        payload: { type: 'engineStatus', outputDirectory: 'F:\\NewClips' },
      })}\n`,
    )
    expect(mockLogger.warning).toHaveBeenCalledWith('clips', expect.stringContaining('Output directory mismatch'))
    expect(C.outputDirectory).toBe('F:\\NewClips')
  })

  it('adopts engine outputDirectory when frontend is empty', () => {
    C.outputDirectory = ''
    triggerPipeData(
      `${JSON.stringify({
        cmd: '_event',
        payload: { type: 'engineStatus', outputDirectory: 'G:\\EngineClips' },
      })}\n`,
    )
    expect(C.outputDirectory).toBe('G:\\EngineClips')
  })

  it('sends status to BrowserWindow', () => {
    const mockWin = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn() },
    }
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWin as never])

    triggerPipeData(
      `${JSON.stringify({
        cmd: '_event',
        payload: { type: 'engineStatus', recording: true },
      })}\n`,
    )

    expect(mockWin.webContents.send).toHaveBeenCalledWith(
      'clips:engine-status',
      expect.objectContaining({ running: true, capturing: true }),
    )
  })

  it('skips BrowserWindow send when no valid window', () => {
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
    triggerPipeData(
      `${JSON.stringify({
        cmd: '_event',
        payload: { type: 'engineStatus', recording: false },
      })}\n`,
    )
    // Should not throw
  })

  it('does NOT call persistClipsConfig on engineStatus (over-polling fix)', () => {
    triggerPipeData(
      `${JSON.stringify({
        cmd: '_event',
        payload: { type: 'engineStatus' },
      })}\n`,
    )
    expect(persistClipsConfig).not.toHaveBeenCalled()
  })

  it('resolves pending request with matching cmd', async () => {
    const promise = sendPipeCommand('myCmd')
    triggerPipeData(`{"cmd":"myCmd","payload":{"result":"ok"}}\n`)
    const result = await promise
    expect(result.payload).toEqual({ result: 'ok' })
  })

  it('logs info when no pending request exists', () => {
    triggerPipeData(`{"cmd":"unknownCmd","payload":null}\n`)
    expect(mockLogger.info).toHaveBeenCalledWith(
      'clips-pipe',
      expect.stringContaining('No pending request for cmd="unknownCmd"'),
    )
  })
})

// ─── onPipeData ────────────────────────────────────────────
describe('onPipeData (partial chunks / malformed)', () => {
  beforeEach(async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()
  })

  it('buffers partial lines across multiple data events', async () => {
    const promise = sendPipeCommand('test')
    // Send first half of the response
    triggerPipeData('{"cmd":"test","payl')
    // Send second half
    triggerPipeData(`oad":{"ok":true}}\n`)
    const result = await promise
    expect(result.payload).toEqual({ ok: true })
  })

  it('handles multiple complete lines in one chunk', async () => {
    const p1 = sendPipeCommand('cmd1').catch(() => {})
    const p2 = sendPipeCommand('cmd2').catch(() => {})
    triggerPipeData(`{"cmd":"cmd1","payload":1}\n{"cmd":"cmd2","payload":2}\n`)

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toEqual(expect.objectContaining({ payload: 1 }))
    expect(r2).toEqual(expect.objectContaining({ payload: 2 }))
  })

  it('skips empty lines', async () => {
    triggerPipeData('\n\n\n')
    // No error should occur
  })

  it('logs warning for unparseable lines', () => {
    triggerPipeData('not-json\n')
    expect(mockLogger.warning).toHaveBeenCalledWith('clips-pipe', expect.stringContaining('Unparseable line: not-json'))
  })

  it('truncates long unparseable lines to 200 chars', () => {
    const long = 'x'.repeat(500)
    triggerPipeData(`${long}\n`)
    expect(mockLogger.warning).toHaveBeenCalledWith('clips-pipe', expect.stringContaining('x'.repeat(200)))
  })
})

// ─── connectPipe (event handlers) ──────────────────────────
describe('connectPipe event handlers', () => {
  beforeEach(() => {
    // Reset socket handlers before each test
    resetMockSocket()
    vi.mocked(connect).mockReturnValue(mockSocket as never)
  })

  it('sets pipeConnected on error event', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()
    expect(isPipeConnected()).toBe(true)

    // Trigger error on the socket
    for (const h of errorHandlers) h(new Error('Connection reset'))

    expect(isPipeConnected()).toBe(false)
  })

  it('schedules reconnect on close when engine is running', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    // Trigger close
    for (const h of closeHandlers) h()

    // It should have scheduled a reconnect
    expect(mockLogger.info).toHaveBeenCalledWith('clips-pipe', expect.stringContaining('Connecting'))
  })

  it('does NOT schedule reconnect on close when engine is stopped', async () => {
    // Engine never started — engineRunning = false
    // Trigger close event on socket (simulates pipe close after connectPipe was called)
    // Since engineRunning is false, scheduleReconnect should NOT call connectPipe again
    const before = vi.mocked(connect).mock.calls.length
    for (const h of closeHandlers) h()

    // Wait for the reconnect delay (3s) + some buffer
    await new Promise((r) => setTimeout(r, 3500))

    // No new connect call should have been made since engineRunning is false
    expect(vi.mocked(connect).mock.calls.length).toBe(before)
  })

  it('calls syncConfigOnConnect on connect event', async () => {
    // syncConfigOnConnect calls sendWithFallback which checks pipeConnected.
    // Since connect fires synchronously, this should work.
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    expect(mockLogger.info).toHaveBeenCalledWith('clips-pipe', expect.stringContaining('Connected'))
  })

  it('destroys socket on timeout and reconnects when engine running', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()
    expect(isPipeConnected()).toBe(true)

    // Trigger timeout event
    for (const h of timeoutHandlers) h()

    // Socket should be destroyed
    expect(mockSocket.destroy).toHaveBeenCalled()
    expect(isPipeConnected()).toBe(false)
  })

  it('logs on error and sets pipeConnected false', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()
    expect(isPipeConnected()).toBe(true)

    const errMsg = 'ECONNREFUSED'
    for (const h of errorHandlers) h(new Error(errMsg))

    expect(isPipeConnected()).toBe(false)
    expect(mockLogger.warning).toHaveBeenCalledWith('clips-pipe', expect.stringContaining(errMsg))
  })
})

// ─── connectPipe socket lifetime guards ───────────────────
describe('connectPipe socket lifetime guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMockSocket()
    vi.mocked(connect).mockReturnValue(mockSocket as never)
  })

  it('removes listeners and destroys the superseded socket on reconnect', () => {
    const sockA = makeFakeSocket()
    const sockB = makeFakeSocket()
    vi.mocked(connect)
      .mockReturnValueOnce(sockA as never)
      .mockReturnValueOnce(sockB as never)

    connectPipe()
    expect(getPipeSocket()).toBe(sockA)

    connectPipe()
    expect(sockA.removeAllListeners).toHaveBeenCalled()
    expect(sockA.destroy).toHaveBeenCalled()
    expect(connect).toHaveBeenCalledTimes(2)
    expect(getPipeSocket()).toBe(sockB)
  })

  it('ignores close events from a superseded socket', () => {
    const sockA = makeFakeSocket()
    const sockB = makeFakeSocket()
    vi.mocked(connect)
      .mockReturnValueOnce(sockA as never)
      .mockReturnValueOnce(sockB as never)

    connectPipe()
    connectPipe()
    expect(getPipeSocket()).toBe(sockB)

    // sockA's close fires late (already queued before being superseded) — must
    // not clobber the active socket nor schedule a spurious reconnect.
    const staleClose = closeHandlers[0]!
    staleClose()

    expect(getPipeSocket()).toBe(sockB)
    expect(isPipeConnected()).toBe(true)
  })

  it('ignores timeout events from a superseded socket', () => {
    const sockA = makeFakeSocket()
    const sockB = makeFakeSocket()
    vi.mocked(connect)
      .mockReturnValueOnce(sockA as never)
      .mockReturnValueOnce(sockB as never)

    connectPipe()
    connectPipe()
    const staleTimeout = timeoutHandlers[0]!
    staleTimeout()

    expect(getPipeSocket()).toBe(sockB)
    expect(isPipeConnected()).toBe(true)
  })

  it('disables the socket idle timeout once connected', () => {
    connectPipe()
    // Initial connect timeout is armed, then disabled on connect
    expect(mockSocket.setTimeout).toHaveBeenCalledWith(10_000)
    expect(mockSocket.setTimeout).toHaveBeenCalledWith(0)
  })

  it('does not schedule a reconnect from a close event after disconnectPipe', () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    disconnectPipe()
    connectPipe()

    const activeClose = closeHandlers[closeHandlers.length - 1]!
    activeClose()

    expect(getPipeSocket()).toBeNull()
  })
})

// ─── sendWithFallback ──────────────────────────────────────
describe('sendWithFallback', () => {
  it('returns not-connected when pipe is not connected', async () => {
    const result = await sendWithFallback('test')
    expect(result).toEqual({ success: false, error: 'Engine pipe not connected' })
  })

  it('returns success when command succeeds', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    const promise = sendWithFallback('test', { x: 1 })
    triggerPipeData(`{"cmd":"test","payload":{"success":true}}\n`)
    const result = await promise
    expect(result).toEqual({ success: true })
  })

  it('returns error when response has error field', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    const promise = sendWithFallback('test')
    triggerPipeData(`{"cmd":"test","payload":{"error":"access denied"}}\n`)
    const result = await promise
    expect(result).toEqual({ success: false, error: 'access denied' })
  })

  it('returns error when success is false', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    const promise = sendWithFallback('test')
    triggerPipeData(`{"cmd":"test","payload":{"success":false}}\n`)
    const result = await promise
    expect(result).toEqual({ success: false, error: 'Command failed' })
  })

  it('catches and returns error message', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    mockSocket.write.mockImplementationOnce(() => {
      throw new Error('write fail')
    })

    const result = await sendWithFallback('test')
    expect(result).toEqual({ success: false, error: 'write fail' })
  })
})

// ─── startClipCapture ──────────────────────────────────────
describe('startClipCapture', () => {
  it('returns error when engine not running', async () => {
    const result = await startClipCapture()
    expect(result).toEqual({ success: false, error: 'Engine not running' })
  })

  it('returns success when already capturing', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()
    setEngineCapturing(true)

    const result = await startClipCapture()
    expect(result).toEqual({ success: true })
  })

  it('sends startCapture with game process when engineCurrentGame is set', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    // Set engineCurrentGame via pipe status
    triggerPipeData(
      `${JSON.stringify({
        cmd: '_event',
        payload: { type: 'engineStatus', game: 'FiveM_GTAProcess.exe' },
      })}\n`,
    )

    const promise = startClipCapture()
    // startClipCapture syncs config first — respond to that
    triggerPipeData(`{"cmd":"config","payload":{"success":true}}\n`)
    // Flush microtasks so startClipCapture proceeds past the config await
    await new Promise((r) => setTimeout(r, 0))
    // Now startCapture is sent
    expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('startCapture'))
    triggerPipeData(`{"cmd":"startCapture","payload":{"success":true}}\n`)
    const result = await promise
    expect(result).toEqual({ success: true })
  })

  it('sends startCapture without gameProcess when no game detected', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    const promise = startClipCapture()
    triggerPipeData(`{"cmd":"config","payload":{"success":true}}\n`)
    await new Promise((r) => setTimeout(r, 0))
    triggerPipeData(`{"cmd":"startCapture","payload":{"success":true}}\n`)
    const result = await promise
    expect(result).toEqual({ success: true })
  })

  it('does not set engineCapturing when startCapture fails', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    const promise = startClipCapture()
    triggerPipeData(`{"cmd":"config","payload":{"success":true}}\n`)
    await new Promise((r) => setTimeout(r, 0))
    triggerPipeData(`{"cmd":"startCapture","payload":{"success":false,"error":"denied"}}\n`)
    const result = await promise
    expect(result).toEqual({ success: false, error: 'denied' })
    expect(isEngineCapturing()).toBe(false)
  })

  it('strips parenthetical and bracket annotations from game name', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    triggerPipeData(
      `${JSON.stringify({
        cmd: '_event',
        payload: { type: 'engineStatus', game: 'FiveM (Build 1234) [b1234]' },
      })}\n`,
    )

    const promise = startClipCapture()
    triggerPipeData(`{"cmd":"config","payload":{"success":true}}\n`)
    await new Promise((r) => setTimeout(r, 0))
    expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('startCapture'))
    triggerPipeData(`{"cmd":"startCapture","payload":{"success":true}}\n`)
    const result = await promise
    expect(result).toEqual({ success: true })
  })
})

// ─── stopEngineProcess ─────────────────────────────────────
describe('stopEngineProcess', () => {
  it('is a no-op when engine process is null', () => {
    expect(() => stopEngineProcess()).not.toThrow()
  })

  it('kills the engine process with SIGTERM', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    stopEngineProcess()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('sends stopEngine command when pipe is connected', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    stopEngineProcess()
    // Should have tried to send stopEngine (fire-and-forget)
    // Since pipeConnected is true, it tries sendPipeCommand
    // The catch handler swallows the error since no response resolves
  })

  it('ignores pipe errors during shutdown', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    // Make sendPipeCommand throw synchronously
    mockSocket.write.mockImplementationOnce(() => {
      throw new Error('shutdown error')
    })

    expect(() => stopEngineProcess()).not.toThrow()
  })

  it('cleans up state after killing', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    stopEngineProcess()
    expect(isEngineRunning()).toBe(false)
    expect(isEngineCapturing()).toBe(false)
    expect(getEnginePid()).toBeUndefined()
    expect(isPipeConnected()).toBe(false)
  })

  it('sends SIGKILL after grace period if process not killed', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    try {
      vi.useFakeTimers()
      stopEngineProcess()
      expect(child.kill).toHaveBeenCalledWith('SIGTERM')

      vi.advanceTimersByTime(6000)
      expect(child.kill).toHaveBeenCalledTimes(2)
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does NOT send SIGKILL if process already killed', async () => {
    const child = makeMockChild()
    child.killed = true
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    try {
      vi.useFakeTimers()
      stopEngineProcess()
      vi.advanceTimersByTime(6000)
      // The finally block nulls engineProcess before timer fires
      expect(child.kill).toHaveBeenCalledTimes(1)
      expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the SIGKILL grace timer when the engine exits early', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    try {
      vi.useFakeTimers()
      stopEngineProcess()
      expect(child.kill).toHaveBeenCalledWith('SIGTERM')

      const exitHandler = (child.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === 'exit',
      )?.[1] as ((code: number) => void) | undefined
      exitHandler?.(0)

      vi.advanceTimersByTime(6000)
      expect(child.kill).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

// ─── startEngine ───────────────────────────────────────────
describe('startEngine', () => {
  beforeEach(() => {
    vi.mocked(app).isPackaged = false
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
  })

  it('returns already-running when engine is running', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    const result = await startEngine()
    expect(result).toEqual({ success: true })
  })

  it('returns error when engine executable not found', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const result = await startEngine()
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('starts engine successfully', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)

    const result = await startEngine()
    expect(result).toEqual({ success: true })
    expect(spawn).toHaveBeenCalled()
    expect(isEngineRunning()).toBe(true)
    expect(isPipeConnected()).toBe(true)
  })

  it('kills existing engine instances before starting', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)
    await startEngine()

    expect(vi.mocked(execFile)).toHaveBeenCalledWith(
      'taskkill',
      ['/F', '/IM', 'DiNho.Capture.Poc.exe'],
      expect.any(Object),
      expect.any(Function),
    )
  })

  it('sets up stdout and stderr handlers on child process', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)

    await startEngine()
    expect(child.stdout.on).toHaveBeenCalledWith('data', expect.any(Function))
    expect(child.stderr.on).toHaveBeenCalledWith('data', expect.any(Function))
  })

  it('sets up exit and error handlers on child process', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)

    await startEngine()
    expect(child.on).toHaveBeenCalledWith('exit', expect.any(Function))
    expect(child.on).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('calls cleanup on child process exit', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)

    await startEngine()
    // Find the exit handler and call it
    const exitCall = vi.mocked(child.on).mock.calls.find((c) => c[0] === 'exit')
    const exitHandler = exitCall![1] as (code: number) => void
    exitHandler(0)

    expect(isEngineRunning()).toBe(false)
  })

  it('calls cleanup on child process error', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)

    await startEngine()
    const errorCall = vi.mocked(child.on).mock.calls.find((c) => c[0] === 'error')
    const errorHandler = errorCall![1] as (err: Error) => void
    errorHandler(new Error('process crashed'))

    expect(isEngineRunning()).toBe(false)
  })

  it('opens devtools when not packaged and window is available', async () => {
    const mockWin = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn(), openDevTools: vi.fn() },
    }
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWin as never])

    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)

    await startEngine()
    expect(mockWin.webContents.openDevTools).toHaveBeenCalled()
  })

  it('skips devtools when packaged', async () => {
    vi.mocked(app).isPackaged = true
    const mockWin = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn(), openDevTools: vi.fn() },
    }
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWin as never])

    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)

    await startEngine()
    expect(mockWin.webContents.openDevTools).not.toHaveBeenCalled()
  })

  it('sends initial config after pipe connection', async () => {
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)

    await startEngine()
    expect(buildEngineConfig).toHaveBeenCalled()
  })

  it('sends selectedAudioSessions when configured', async () => {
    C.selectedAudioSessions = [1234, 5678]
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    vi.mocked(existsSync).mockReturnValue(true)

    await startEngine()
    expect(mockSocket.write).toHaveBeenCalledWith(expect.stringContaining('setAudioSessions'))
  })

  it('handles spawn errors', async () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('spawn failed')
    })
    vi.mocked(existsSync).mockReturnValue(true)

    const result = await startEngine()
    expect(result).toEqual({ success: false, error: 'spawn failed' })
  })

  it('handles non-Error spawn rejection', async () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw 'string rejection'
    })
    vi.mocked(existsSync).mockReturnValue(true)

    const result = await startEngine()
    expect(result).toEqual({ success: false, error: 'string rejection' })
  })

  it('handles pipe connection timeout', async () => {
    let dateNowSpy: ReturnType<typeof vi.spyOn> | null = null
    try {
      vi.useFakeTimers()
      const child = makeMockChild()
      vi.mocked(spawn).mockReturnValue(child as never)
      vi.mocked(existsSync).mockReturnValue(true)
      // Custom connect mock that never fires 'connect' — pipeConnected stays false
      const customSocket = {
        on: vi.fn(() => customSocket),
        destroy: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        setTimeout: vi.fn(),
        removeAllListeners: vi.fn(),
      }
      vi.mocked(connect).mockReturnValue(customSocket as never)

      // Spy on Date.now so it advances alongside fake timers
      const origDateNow = Date.now.bind(Date)
      let fakeNow = origDateNow()
      dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => fakeNow)

      const enginePromise = startEngine()
      // Advance 500ms past the initial delay so spawn/connectPipe run
      fakeNow += 500
      vi.advanceTimersByTime(500)
      // Flush microtasks so startEngine continues past its first await
      await Promise.resolve()
      await Promise.resolve()

      // waitForPipeConnection now loops at 200ms intervals
      // deadline = fakeNow(500) + 8000 = 8500, needs 40 iterations
      for (let i = 0; i < 45; i++) {
        fakeNow += 200
        vi.advanceTimersByTime(200)
        await Promise.resolve()
        await Promise.resolve()
      }

      const result = await enginePromise
      expect(result.success).toBe(false)
      expect(result.error).toContain('pipe not connected')
      expect(child.kill).toHaveBeenCalled()
    } finally {
      dateNowSpy?.mockRestore()
      vi.useRealTimers()
    }
  })
})

// ─── C8: sendPipeCommandLongRunning ─────────────────────────
describe('sendPipeCommandLongRunning', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetMockSocket()
    vi.mocked(connect).mockReturnValue(mockSocket as never)
    await startEngine()
  })

  it('resolves immediately when engine response status is not accepted', async () => {
    const p = sendPipeCommandLongRunning('quickCmd')
    // Simulate engine responding with non-accepted status
    triggerPipeData(`${JSON.stringify({ cmd: 'quickCmd', payload: { status: 'done', result: 42 } })}\n`)
    const result = await p
    expect(result.cmd).toBe('quickCmd')
    expect(result.payload?.status).toBe('done')
  })

  it('waits for commandResult event after accepted status', async () => {
    vi.useFakeTimers()
    try {
      const p = sendPipeCommandLongRunning('saveClip', undefined, 5000)
      // Engine accepts the command
      triggerPipeData(`${JSON.stringify({ cmd: 'saveClip', payload: { status: 'accepted' } })}\n`)
      // Flush microtasks so .then() runs and registers longRunningPending
      await vi.advanceTimersByTimeAsync(0)
      // Not resolved yet — still waiting for commandResult
      let resolved = false
      p.then(() => {
        resolved = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(resolved).toBe(false)
      // Engine sends the final result
      triggerPipeData(
        `${JSON.stringify({
          cmd: '_event',
          payload: { type: 'commandResult', originalCmd: 'saveClip', value: { path: '/clips/test.mp4' } },
        })}\n`,
      )
      const result = await p
      expect(result.cmd).toBe('saveClip')
      expect(result.payload?.path).toBe('/clips/test.mp4')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects on timeout', async () => {
    vi.useFakeTimers()
    let dateNowSpy: ReturnType<typeof vi.spyOn> | null = null
    try {
      const origDateNow = Date.now.bind(Date)
      let fakeNow = origDateNow()
      dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => fakeNow)

      const p = sendPipeCommandLongRunning('slowCmd', undefined, 1000)
      // Prevent unhandled rejection — advanceTimersByTimeAsync fires the reject()
      // before the expect() assertion below can catch it
      p.catch(() => {})
      // Engine accepts
      triggerPipeData(`${JSON.stringify({ cmd: 'slowCmd', payload: { status: 'accepted' } })}\n`)
      // Flush microtasks so .then() runs and registers longRunningPending with 1000ms timer
      await vi.advanceTimersByTimeAsync(0)
      // Advance past timeout
      fakeNow += 1500
      await vi.advanceTimersByTimeAsync(1500)
      await expect(p).rejects.toThrow('timed out after 1000ms')
    } finally {
      dateNowSpy?.mockRestore()
      vi.useRealTimers()
    }
  })

  it('rejects when commandResult contains error', async () => {
    vi.useFakeTimers()
    try {
      const p = sendPipeCommandLongRunning('failingCmd', undefined, 5000)
      triggerPipeData(`${JSON.stringify({ cmd: 'failingCmd', payload: { status: 'accepted' } })}\n`)
      // Flush microtasks so .then() registers longRunningPending
      await vi.advanceTimersByTimeAsync(0)
      triggerPipeData(
        `${JSON.stringify({
          cmd: '_event',
          payload: { type: 'commandResult', originalCmd: 'failingCmd', error: 'disk full' },
        })}\n`,
      )
      await expect(p).rejects.toThrow('disk full')
    } finally {
      vi.useRealTimers()
    }
  })
})

// ─── C9: disconnectPipe ─────────────────────────────────────
describe('disconnectPipe', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetMockSocket()
    vi.mocked(connect).mockReturnValue(mockSocket as never)
    await startEngine()
  })

  it('destroys socket and sets pipeConnected false', () => {
    expect(isPipeConnected()).toBe(true)
    disconnectPipe()
    expect(isPipeConnected()).toBe(false)
    expect(mockSocket.destroy).toHaveBeenCalled()
  })

  it('rejects pending requests with Pipe disconnected', async () => {
    // Send a command that will create a pending request
    const p = sendPipeCommand('testCmd')
    // Disconnect before response arrives
    disconnectPipe()
    await expect(p).rejects.toThrow('Pipe disconnected')
  })

  it('rejects long-running pending requests', async () => {
    vi.useFakeTimers()
    try {
      const p = sendPipeCommandLongRunning('longCmd', undefined, 10000)
      // Accept the command (creates longRunningPending entry)
      triggerPipeData(`${JSON.stringify({ cmd: 'longCmd', payload: { status: 'accepted' } })}\n`)
      // Flush microtasks so .then() registers longRunningPending
      await vi.advanceTimersByTimeAsync(0)
      // Disconnect
      disconnectPipe()
      await expect(p).rejects.toThrow('Pipe disconnected')
    } finally {
      vi.useRealTimers()
    }
  })

  it('is safe to call when pipe is not connected', () => {
    disconnectPipe() // already disconnected from previous test
    expect(isPipeConnected()).toBe(false)
    // Should not throw
    disconnectPipe()
  })
})

// ─── Handshake (P2) ─────────────────────────────────────────
describe('handshake', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReturnValue(makeMockChild() as never)
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(app).isPackaged = false
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
  })

  it('sends handshake with protoVersion on connect', async () => {
    await startEngine()
    expect(mockSocket.write).toHaveBeenCalledWith(
      `${JSON.stringify({ v: 1, cmd: 'handshake', payload: { protoVersion: 1 } })}\n`,
    )
  })

  it('ok ack unlocks subsequent commands', async () => {
    await startEngine()
    triggerPipeData(
      `${JSON.stringify({ cmd: 'handshake_ack', payload: { engineVersion: '1.0.0', protoVersion: 1, status: 'ok' } })}\n`,
    )
    const p = sendPipeCommand('hello')
    triggerPipeData(`${JSON.stringify({ cmd: 'hello', payload: { ok: true } })}\n`)
    await expect(p).resolves.toMatchObject({ cmd: 'hello' })
  })

  it('incompatible ack blocks subsequent commands', async () => {
    await startEngine()
    triggerPipeData(
      `${JSON.stringify({ cmd: 'handshake_ack', payload: { engineVersion: '1.0.0', protoVersion: 99, status: 'incompatible', requestedProtoVersion: 99 } })}\n`,
    )
    await expect(sendPipeCommand('hello')).rejects.toThrow(/protocol mismatch/)
  })

  it('failed ack blocks subsequent commands', async () => {
    await startEngine()
    triggerPipeData(
      `${JSON.stringify({ cmd: 'handshake_ack', payload: { engineVersion: '1.0.0', status: 'error', error: 'engine failed to init' } })}\n`,
    )
    await expect(sendPipeCommand('hello')).rejects.toThrow(/engine failed to init/)
  })

  it('handshake itself is not blocked by its own gate', async () => {
    await startEngine()
    triggerPipeData(`${JSON.stringify({ cmd: 'handshake_ack', payload: { status: 'ok' } })}\n`)
    const p = sendPipeCommand('handshake')
    triggerPipeData(`${JSON.stringify({ cmd: 'handshake_ack', payload: { status: 'ok' } })}\n`)
    await expect(p).resolves.toMatchObject({ cmd: 'handshake_ack' })
  })

  it('reconnect resets a handshake error', async () => {
    await startEngine()
    triggerPipeData(
      `${JSON.stringify({ cmd: 'handshake_ack', payload: { engineVersion: '1.0.0', protoVersion: 99, status: 'incompatible' } })}\n`,
    )
    await expect(sendPipeCommand('hello')).rejects.toThrow(/protocol mismatch/)
    // Simulate reconnect: destroy + new connect (same path as scheduleReconnect)
    for (const h of closeHandlers) h()
    disconnectPipe()
    connectPipe()
    triggerPipeData(`${JSON.stringify({ cmd: 'handshake_ack', payload: { status: 'ok' } })}\n`)
    const p = sendPipeCommand('hello')
    triggerPipeData(`${JSON.stringify({ cmd: 'hello', payload: { ok: true } })}\n`)
    await expect(p).resolves.toMatchObject({ cmd: 'hello' })
  })
})
