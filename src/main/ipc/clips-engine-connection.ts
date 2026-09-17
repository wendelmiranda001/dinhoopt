import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC } from '@shared/channels'
import type { ClipInfo, ClipsEngineStatus } from '@shared/types'
import { app, BrowserWindow } from 'electron'
import { buildEngineConfig, config as C, getDefaultOutputDir } from '../services/clips-config-manager'
import { getFfmpegPath } from '../services/ffmpeg-path'
import { getLogger } from '../services/logger.service'
import {
  isEngineCapturing as _isEngineCapturing,
  isEngineRunning as _isEngineRunning,
  setEngineCapturing as _setEngineCapturing,
  initEnginePipeIntegration,
  readEngineStatus,
  registerGetCurrentStatus,
} from './clips-engine'
import {
  isPipeConnected as _isPipeConnected,
  sendWithFallback as _sendWithFallback,
  waitForPipeConnection as _waitForPipeConnection,
  connectPipe,
} from './clips-pipe'

// ─── Initialize pipe/engine integration (runs once) ───────────

initEnginePipeIntegration()

// Re-register with the real getCurrentStatus below
registerGetCurrentStatus(getCurrentStatus)

// ─── Re-exports ───────────────────────────────────────────────

export {
  getEnginePath,
  getEnginePid,
  isEngineCapturing,
  isEngineRunning,
  setEngineCapturing,
  startEngine,
  stopEngineProcess,
} from './clips-engine'
export { isPipeConnected, sendPipeCommand, sendPipeCommandLongRunning, sendWithFallback } from './clips-pipe'

// ─── Clips list cache ─────────────────────────────────────────

let _clipsCache: ClipInfo[] | null = null
let _cacheDirty = true
let _lastReadDir: string | null = null

export function invalidateClipsCache(): void {
  _cacheDirty = true
}

export function resetClipsCache(): void {
  _clipsCache = null
  _cacheDirty = true
  _lastReadDir = null
}

// ─── Duration cache (LRU, 500 entries) ───────────────────────

interface CacheEntry {
  duration: number
  mtimeMs: number
}

const MAX_CACHE_ENTRIES = 500
const _durationCache = new Map<string, CacheEntry>()

function cacheGet(filePath: string, currentMtimeMs: number): number | null {
  const entry = _durationCache.get(filePath)
  if (entry && entry.mtimeMs === currentMtimeMs) {
    _durationCache.delete(filePath)
    _durationCache.set(filePath, entry)
    return entry.duration
  }
  return null
}

function cacheSet(filePath: string, duration: number, mtimeMs: number): void {
  if (_durationCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = _durationCache.keys().next().value
    if (oldest !== undefined) _durationCache.delete(oldest)
  }
  _durationCache.set(filePath, { duration, mtimeMs })
  schedulePersist()
}

export function invalidateDurationCache(filePath?: string): void {
  if (filePath) {
    _durationCache.delete(filePath)
  } else {
    _durationCache.clear()
  }
  schedulePersist()
}

// ─── Persistent duration cache (JSON on disk, debounced) ─────

let _persistTimer: ReturnType<typeof setTimeout> | null = null

function cacheDir(): string {
  return app.isPackaged ? app.getPath('userData') : join(app.getPath('userData'), 'DiNho-Dev')
}

function cacheFilePath(): string {
  return join(cacheDir(), 'clips-duration-cache.json')
}

function loadPersistedCache(): void {
  try {
    const path = cacheFilePath()
    if (!existsSync(path)) return
    const raw = readFileSync(path, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    for (const entry of parsed) {
      const e = entry as Record<string, unknown> | null
      if (!e || typeof e.path !== 'string' || typeof e.duration !== 'number' || typeof e.mtimeMs !== 'number') continue
      if (_durationCache.size >= MAX_CACHE_ENTRIES) break
      _durationCache.set(e.path, { duration: e.duration, mtimeMs: e.mtimeMs })
    }
  } catch {
    /* corrupt cache file, ignore */
  }
}

function schedulePersist(): void {
  if (_persistTimer) clearTimeout(_persistTimer)
  _persistTimer = setTimeout(() => {
    _persistTimer = null
    try {
      const dir = cacheDir()
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const entries = Array.from(_durationCache.entries()).map(([p, e]) => ({
        path: p,
        duration: e.duration,
        mtimeMs: e.mtimeMs,
      }))
      writeFileSync(cacheFilePath(), JSON.stringify(entries), 'utf-8')
    } catch {
      /* silent */
    }
  }, 5000)
}

// Load persisted cache on module init
loadPersistedCache()

const DURATION_CONCURRENCY = 6

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let nextIdx = 0

  async function worker(): Promise<void> {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++
      results[idx] = await tasks[idx]!()
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()))
  return results
}

// Batch duration lookup — computes all missing durations synchronously
export async function getDurationsForClips(
  clips: Array<{ path: string; mtimeMs: number }>,
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const missing: Array<{ path: string; mtimeMs: number }> = []

  for (const clip of clips) {
    const cached = cacheGet(clip.path, clip.mtimeMs)
    if (cached !== null) {
      result.set(clip.path, cached)
    } else {
      missing.push(clip)
    }
  }

  if (missing.length > 0) {
    const computed = await runWithConcurrency(
      missing.map((clip) => async () => {
        const duration = await getVideoDuration(clip.path)
        cacheSet(clip.path, duration, clip.mtimeMs)
        return { path: clip.path, duration }
      }),
      DURATION_CONCURRENCY,
    )
    for (const c of computed) {
      result.set(c.path, c.duration)
    }
  }

  return result
}

// Compute missing durations in background, update cache, and notify renderer
function computeMissingDurations(missing: Array<{ path: string; mtimeMs: number }>): void {
  runWithConcurrency(
    missing.map((clip) => async () => {
      const duration = await getVideoDuration(clip.path)
      cacheSet(clip.path, duration, clip.mtimeMs)
      return { path: clip.path, duration }
    }),
    DURATION_CONCURRENCY,
  )
    .then((computed) => {
      // Update clips cache entries in-place so next read hits warm cache
      if (_clipsCache) {
        const map = new Map(computed.map((c) => [c.path, c.duration]))
        _clipsCache = _clipsCache.map((clip) => {
          const dur = map.get(clip.path)
          return dur !== undefined ? { ...clip, duration: dur } : clip
        })
      }
      // Notify renderer that durations are ready
      notifyDurationsReady()
    })
    .catch(() => {
      /* silent */
    })
}

// Notify renderer that background durations are ready
function notifyDurationsReady(): void {
  try {
    const wins = BrowserWindow.getAllWindows()
    for (const win of wins) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.CLIPS_DURATIONS_READY)
      }
    }
  } catch {
    /* silent */
  }
}

// ─── Public API ───────────────────────────────────────────────

export async function getVideoDuration(filePath: string): Promise<number> {
  try {
    const stderr = await new Promise<string>((resolve, reject) => {
      execFile(
        getFfmpegPath(),
        ['-i', filePath],
        {
          encoding: 'utf-8',
          timeout: 5000,
          windowsHide: true,
        },
        (err, _stdout, stderrOut) => {
          if (err && !stderrOut) {
            reject(err)
            return
          }
          resolve(stderrOut ?? '')
        },
      )
    })
    const match = stderr.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d+)/)
    if (!match) return 0
    const h = Number.parseInt(match[1]!, 10)
    const m = Number.parseInt(match[2]!, 10)
    const s = Number.parseInt(match[3]!, 10)
    const cs = Number.parseInt(match[4]!.padEnd(3, '0'), 10)
    const dur = h * 3600 + m * 60 + s + cs / 1000
    return Number.isFinite(dur) ? Math.round(dur) : 0
  } catch {
    return 0
  }
}

export async function readClipsFromDisk(): Promise<ClipInfo[]> {
  const dir = getDefaultOutputDir()
  if (!_cacheDirty && _clipsCache && _lastReadDir === dir) return _clipsCache
  _lastReadDir = dir

  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      _clipsCache = []
      _cacheDirty = false
      return []
    }
  }
  try {
    const allFiles = await readdir(dir)
    const files = allFiles.filter((f) => f.endsWith('.mp4'))

    const entries = await runWithConcurrency(
      files.map((f) => async () => {
        const fullPath = join(dir, f)
        try {
          const s = await stat(fullPath)
          const mtimeMs = s.mtime.getTime()
          const createdAt = s.birthtime.getTime() > 0 ? s.birthtime.toISOString() : s.mtime.toISOString()
          return { name: f, path: fullPath, size: s.size, createdAt, mtimeMs }
        } catch {
          return null
        }
      }),
      12,
    )

    const valid = entries.filter(
      (e): e is { name: string; path: string; size: number; createdAt: string; mtimeMs: number } => e !== null,
    )

    valid.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    // Compute missing durations in background to avoid blocking the renderer
    const durations: Array<{ path: string; duration: number }> = []
    const missing: Array<{ path: string; mtimeMs: number }> = []
    for (const e of valid) {
      const cached = cacheGet(e.path, e.mtimeMs)
      if (cached !== null) {
        durations.push({ path: e.path, duration: cached })
      } else {
        durations.push({ path: e.path, duration: 0 })
        missing.push({ path: e.path, mtimeMs: e.mtimeMs })
      }
    }

    if (missing.length > 0) {
      computeMissingDurations(missing)
    }

    _clipsCache = valid.map((e) => {
      const dur = durations.find((d) => d.path === e.path)
      return {
        name: e.name,
        path: e.path,
        size: e.size,
        createdAt: e.createdAt,
        duration: dur?.duration ?? 0,
      }
    })
    _cacheDirty = false
    return _clipsCache
  } catch (err) {
    getLogger().error('clips', `Failed to list clips: ${err}`)
    _clipsCache = []
    _cacheDirty = false
    return []
  }
}

export function getCurrentStatus(): ClipsEngineStatus {
  const e = readEngineStatus()
  const captureBackend = e.captureBackend || undefined
  const encoder = e.encoder || undefined
  const estimatedRamMB = e.estimatedRamMB || undefined
  const diskSpaceOk = e.diskSpaceOk
  const currentGame = C.customGameProcess || e.currentGame || undefined
  const customGameProcess = C.customGameProcess || undefined
  const lastCrashRecovered = e.lastCrashRecovered || undefined
  const audioLoopback = e.audioLoopback || undefined
  const audioFallback = e.audioFallback || undefined
  const replayBufferBytes = e.replayBufferBytes || undefined
  const replayBufferVideoFrames = e.replayBufferVideoFrames || undefined
  const replayBufferVideoBytes = e.replayBufferVideoBytes || undefined
  const replayBufferAudioPackets = e.replayBufferAudioPackets || undefined
  const replayBufferAudioBytes = e.replayBufferAudioBytes || undefined
  const droppedFrames = e.droppedFrames || undefined
  const gpuBusyDrops = e.gpuBusyDrops || undefined
  const calibrationTier = e.calibrationTier || undefined
  const micLevel = e.micLevel
  const watchdogOk = e.watchdogOk
  const memoryMB = e.memoryMB
  return {
    running: _isEngineRunning(),
    capturing: e.capturing,
    uptime: _isEngineRunning() ? Math.floor((Date.now() - e.startTime) / 1000) : 0,
    fps: C.engineFps,
    replayTimeSeconds: C.engineReplayTimeSeconds,
    audioSampleRate: C.audioSampleRate,
    ...(captureBackend ? { captureBackend } : {}),
    ...(encoder ? { encoder } : {}),
    ...(estimatedRamMB ? { estimatedRamMB } : {}),
    ...(diskSpaceOk != null ? { diskSpaceOk } : {}),
    ...(currentGame ? { currentGame } : {}),
    ...(customGameProcess ? { customGameProcess } : {}),
    ...(lastCrashRecovered ? { lastCrashRecovered } : {}),
    ...(audioLoopback ? { audioLoopback } : {}),
    ...(audioFallback ? { audioFallback } : {}),
    ...(replayBufferBytes ? { replayBufferBytes } : {}),
    ...(replayBufferVideoFrames ? { replayBufferVideoFrames } : {}),
    ...(replayBufferVideoBytes ? { replayBufferVideoBytes } : {}),
    ...(replayBufferAudioPackets ? { replayBufferAudioPackets } : {}),
    ...(replayBufferAudioBytes ? { replayBufferAudioBytes } : {}),
    ...(droppedFrames ? { droppedFrames } : {}),
    ...(gpuBusyDrops ? { gpuBusyDrops } : {}),
    ...(calibrationTier ? { calibrationTier } : {}),
    ...(micLevel != null ? { micLevel } : {}),
    ...(watchdogOk != null ? { watchdogOk } : {}),
    ...(memoryMB != null ? { memoryMB } : {}),
  }
}

export async function startClipCapture(): Promise<{ success: boolean; error?: string }> {
  if (!_isEngineRunning()) {
    return { success: false, error: 'Engine not running' }
  }
  if (_isEngineCapturing()) {
    return { success: true }
  }

  if (!_isPipeConnected()) {
    getLogger().info('clips', 'startClipCapture: pipe not connected, attempting reconnect...')
    connectPipe()
    const connected = await _waitForPipeConnection(5000)
    if (!connected) {
      return { success: false, error: 'Engine pipe not connected' }
    }
  }

  const configPayload = buildEngineConfig()
  await _sendWithFallback('config', configPayload).catch(() => {
    getLogger().warning('clips', 'startClipCapture: config sync failed')
  })

  const e = readEngineStatus()
  const rawProcessName = (e.currentGame || '').replace(/ \(.*?\) \[.*?\]$/, '').trim()
  const targetGame = C.customGameProcess || rawProcessName || ''
  getLogger().info(
    'clips',
    `startClipCapture: targetGame="${targetGame}" configCustomGameProcess="${C.customGameProcess}" engineCurrentGame="${e.currentGame}"`,
  )
  const payload = targetGame ? { gameProcess: targetGame } : undefined
  const result = await _sendWithFallback('startCapture', payload)
  if (result.success) {
    _setEngineCapturing(true)
  }
  return result
}
