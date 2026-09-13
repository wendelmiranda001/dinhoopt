import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { buildEngineConfig, config as C } from '../services/clips-config-manager'
import { getLogger } from '../services/logger.service'
import {
  connectPipe,
  disconnectPipe,
  isPipeConnected,
  sendPipeCommand,
  sendWithFallback,
  setOnEngineRunning,
  setOnReconnect,
  setStatusCallbacks,
  waitForPipeConnection,
} from './clips-pipe'

const ENGINE_EXE = 'DiNho.Capture.Poc.exe'
const ENGINE_GRACE_PERIOD = 5_000

// ─── Engine state ─────────────────────────────────────────────

let _engineProcess: ChildProcess | null = null
let _stopEngineGraceTimer: ReturnType<typeof setTimeout> | null = null
let _engineRunning = false
let _engineCapturing = false
let _engineStartTime = 0
let _engineCaptureBackend = ''
let _engineEncoder = ''
let _engineReplayBufferBytes = 0
let _engineEstimatedRamMB = 0
let _engineDiskSpaceOk = true
let _engineCurrentGame = ''
let _engineLastCrashRecovered = false
let _engineAudioLoopback = false
let _engineAudioFallback = false
let _engineReplayBufferVideoFrames = 0
let _engineReplayBufferVideoBytes = 0
let _engineReplayBufferAudioPackets = 0
let _engineReplayBufferAudioBytes = 0
let _engineDroppedFrames = 0
let _engineGpuBusyDrops = 0

// ─── Lazy getter for getCurrentStatus (breaks circular dep) ───

let _getCurrentStatus: (() => import('@shared/types').ClipsEngineStatus) | null = null

export function registerGetCurrentStatus(fn: () => import('@shared/types').ClipsEngineStatus): void {
  _getCurrentStatus = fn
}

// ─── Status updater (called by clips-pipe handlePipeMessage) ──

function statusUpdater(src: Record<string, unknown>): void {
  _engineCapturing = src.recording === true
  if (typeof src.fps === 'number') C.engineFps = src.fps
  if (typeof src.replayTimeSeconds === 'number') C.engineReplayTimeSeconds = src.replayTimeSeconds
  if (typeof src.captureBackend === 'string') _engineCaptureBackend = src.captureBackend
  if (typeof src.encoder === 'string') _engineEncoder = src.encoder
  if (typeof src.estimatedRamMB === 'number') _engineEstimatedRamMB = src.estimatedRamMB
  if (typeof src.diskSpaceOk === 'boolean') _engineDiskSpaceOk = src.diskSpaceOk
  if (typeof src.game === 'string') _engineCurrentGame = src.game
  else if (src.game === null || src.game === undefined) _engineCurrentGame = ''
  if (typeof src.lastCrashRecovered === 'boolean') _engineLastCrashRecovered = src.lastCrashRecovered
  if (typeof src.audioLoopback === 'boolean') {
    _engineAudioLoopback = src.audioLoopback
    C.audioLoopback = src.audioLoopback
  }
  if (typeof src.audioFallback === 'boolean') {
    _engineAudioFallback = src.audioFallback
  }
  if (typeof src.gameVolume === 'number') C.gameVolume = Math.max(0, Math.min(4, src.gameVolume))
  if (typeof src.micVolume === 'number') C.micVolume = Math.max(0, Math.min(4, src.micVolume))
  if (typeof src.width === 'number') C.width = Math.max(640, Math.min(7680, src.width))
  if (typeof src.height === 'number') C.height = Math.max(480, Math.min(4320, src.height))
  if (typeof src.bitrateKbps === 'number') C.bitrateKbps = Math.max(1000, Math.min(200000, src.bitrateKbps))
  if (typeof src.audioSampleRate === 'number') C.audioSampleRate = src.audioSampleRate
  if (typeof src.replayBufferBytes === 'number') _engineReplayBufferBytes = src.replayBufferBytes
  if (typeof src.replayBufferVideoFrames === 'number') _engineReplayBufferVideoFrames = src.replayBufferVideoFrames
  if (typeof src.replayBufferVideoBytes === 'number') _engineReplayBufferVideoBytes = src.replayBufferVideoBytes
  if (typeof src.replayBufferAudioPackets === 'number') _engineReplayBufferAudioPackets = src.replayBufferAudioPackets
  if (typeof src.replayBufferAudioBytes === 'number') _engineReplayBufferAudioBytes = src.replayBufferAudioBytes
  if (typeof src.droppedFrames === 'number') _engineDroppedFrames = src.droppedFrames
  if (typeof src.gpuBusyDrops === 'number') _engineGpuBusyDrops = src.gpuBusyDrops
  if (typeof src.outputDirectory === 'string' && src.outputDirectory) {
    const engineDir = src.outputDirectory as string
    if (C.outputDirectory && C.outputDirectory !== engineDir) {
      getLogger().warning(
        'clips',
        `Output directory mismatch: frontend="${C.outputDirectory}" engine="${engineDir}" — adopting engine directory`,
      )
    }
    C.outputDirectory = engineDir
  }
}

// ─── State getters/setters ────────────────────────────────────

export function isEngineRunning(): boolean {
  return _engineRunning
}

export function isEngineCapturing(): boolean {
  return _engineCapturing
}

export function getEnginePid(): number | undefined {
  return _engineProcess?.pid
}

export function setEngineCapturing(v: boolean): void {
  _engineCapturing = v
}

// ─── Status reader (called by getCurrentStatus in clips-engine-connection) ──

export function readEngineStatus(): {
  capturing: boolean
  startTime: number
  captureBackend: string
  encoder: string
  replayBufferBytes: number
  estimatedRamMB: number
  diskSpaceOk: boolean
  currentGame: string
  lastCrashRecovered: boolean
  audioLoopback: boolean
  audioFallback: boolean
  replayBufferVideoFrames: number
  replayBufferVideoBytes: number
  replayBufferAudioPackets: number
  replayBufferAudioBytes: number
  droppedFrames: number
  gpuBusyDrops: number
} {
  return {
    capturing: _engineCapturing,
    startTime: _engineStartTime,
    captureBackend: _engineCaptureBackend,
    encoder: _engineEncoder,
    replayBufferBytes: _engineReplayBufferBytes,
    estimatedRamMB: _engineEstimatedRamMB,
    diskSpaceOk: _engineDiskSpaceOk,
    currentGame: _engineCurrentGame,
    lastCrashRecovered: _engineLastCrashRecovered,
    audioLoopback: _engineAudioLoopback,
    audioFallback: _engineAudioFallback,
    replayBufferVideoFrames: _engineReplayBufferVideoFrames,
    replayBufferVideoBytes: _engineReplayBufferVideoBytes,
    replayBufferAudioPackets: _engineReplayBufferAudioPackets,
    replayBufferAudioBytes: _engineReplayBufferAudioBytes,
    droppedFrames: _engineDroppedFrames,
    gpuBusyDrops: _engineGpuBusyDrops,
  }
}

// ─── Engine path ──────────────────────────────────────────────

export function getEnginePath(): string {
  if (process.env.DINHO_CLIPS_ENGINE_PATH && existsSync(process.env.DINHO_CLIPS_ENGINE_PATH)) {
    return process.env.DINHO_CLIPS_ENGINE_PATH
  }
  const desktop = process.env.USERPROFILE ? join(process.env.USERPROFILE, 'Desktop') : ''
  const isDev = !app.isPackaged
  const engineSubpath = join(
    'src',
    'DiNho.Capture.Poc',
    'bin',
    isDev ? 'Debug' : 'Release',
    'net10.0-windows10.0.26100.0',
    isDev ? ENGINE_EXE : join('publish', ENGINE_EXE),
  )
  const candidates = [
    desktop ? join(desktop, 'dinho-clips-poc', engineSubpath) : '',
    join(__dirname, '..', '..', 'dinho-clips-poc', engineSubpath),
    join(__dirname, '..', '..', 'clips-engine', ENGINE_EXE),
    join(process.resourcesPath || '', 'clips-engine', ENGINE_EXE),
    join(process.cwd(), 'dinho-clips-poc', engineSubpath),
  ]
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  const fallback = desktop ? join(desktop, 'dinho-clips-poc', engineSubpath) : (candidates[1] ?? ENGINE_EXE)
  return fallback
}

// ─── Engine lifecycle ─────────────────────────────────────────

export async function startEngine(): Promise<{ success: boolean; error?: string }> {
  if (_engineRunning) return { success: true }

  const exePath = getEnginePath()
  if (!existsSync(exePath)) {
    const err = `Engine executable not found at: ${exePath}`
    getLogger().error('clips', err)
    return { success: false, error: err }
  }

  try {
    execFile('taskkill', ['/F', '/IM', 'DiNho.Capture.Poc.exe'], { timeout: 3000, windowsHide: true }, () => {})
    await new Promise((resolve) => setTimeout(resolve, 500))
  } catch {
    /* ok */
  }

  try {
    _engineProcess = spawn(exePath, [], {
      cwd: join(exePath, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    _engineRunning = true
    _engineStartTime = Date.now()

    const logStdout = (data: Buffer) => {
      const text = data.toString('utf-8').trim()
      if (text) {
        getLogger().info('clips-engine', text)
        process.stdout.write(`[ENGINE] ${text}\n`)
      }
    }
    const logStderr = (data: Buffer) => {
      const text = data.toString('utf-8').trim()
      if (text) {
        getLogger().warning('clips-engine', text)
        process.stdout.write(`[ENGINE:ERR] ${text}\n`)
      }
    }

    _engineProcess.stdout?.on('data', logStdout)
    _engineProcess.stderr?.on('data', logStderr)

    const cleanup = () => {
      if (_stopEngineGraceTimer) {
        clearTimeout(_stopEngineGraceTimer)
        _stopEngineGraceTimer = null
      }
      _engineRunning = false
      _engineCapturing = false
      _engineProcess = null
      disconnectPipe()
    }

    _engineProcess.on('exit', (code) => {
      getLogger().info('clips', `Engine exited with code ${code}`)
      cleanup()
    })

    _engineProcess.on('error', (err) => {
      getLogger().error('clips', `Engine process error: ${err.message}`)
      cleanup()
    })

    getLogger().info('clips', `Engine started from: ${exePath}, PID: ${_engineProcess.pid}`)

    if (!app.isPackaged) {
      try {
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
        if (win) win.webContents.openDevTools()
      } catch {
        /* OK */
      }
    }

    connectPipe()

    const connected = await waitForPipeConnection(8000)
    if (!connected) {
      const msg = `Engine pipe not connected after timeout (engineRunning=${_engineRunning}, pid=${_engineProcess?.pid})`
      getLogger().error('clips', msg)
      // Do not leave the engine orphaned waiting on a pipe that never came up —
      // kill it so a later startEngine can spawn a fresh instance.
      try {
        _engineProcess?.kill()
      } catch {
        /* already exited */
      }
      cleanup()
      return { success: false, error: msg }
    }

    const initialConfig = buildEngineConfig()
    const hkInfo = (initialConfig.Hotkeys as Record<string, unknown>[]).map(
      (h) => `vk=0x${(h.vk as number).toString(16)} mods=[${(h.modifiers as number[]).join(',')}] act=${h.action}`,
    )
    getLogger().info('clips', `Initial config sync: pipeConnected=true hotkeys=${JSON.stringify(hkInfo)}`)
    sendWithFallback('config', initialConfig).catch(() => {
      getLogger().warning('clips', 'Initial config sync to engine failed')
    })

    if (C.selectedAudioSessions.length > 0) {
      sendPipeCommand('setAudioSessions', { pids: C.selectedAudioSessions }).catch(() => {
        getLogger().warning('clips', 'Initial audio session sync to engine failed')
      })
    }

    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    getLogger().error('clips', `Failed to start engine: ${msg}`)
    _engineRunning = false
    return { success: false, error: msg }
  }
}

export function stopEngineProcess(): void {
  const proc = _engineProcess
  if (!proc) return
  try {
    if (isPipeConnected()) {
      sendPipeCommand('stopEngine').catch(() => {})
    }
  } catch {
    /* ignore pipe errors during shutdown */
  }
  disconnectPipe()
  try {
    if (_stopEngineGraceTimer) {
      clearTimeout(_stopEngineGraceTimer)
    }
    proc.kill('SIGTERM')
    _stopEngineGraceTimer = setTimeout(() => {
      _stopEngineGraceTimer = null
      if (!proc.killed) {
        proc.kill('SIGKILL')
      }
    }, ENGINE_GRACE_PERIOD)
  } finally {
    _engineRunning = false
    _engineCapturing = false
    _engineProcess = null
  }
}

// ─── Register pipe callbacks (called once at module init) ─────

export function initEnginePipeIntegration(): void {
  setStatusCallbacks(statusUpdater, () => {
    if (_getCurrentStatus) return _getCurrentStatus()
    throw new Error('getCurrentStatus not registered')
  })
  setOnReconnect(async () => {
    try {
      const engineConfig = buildEngineConfig()
      await sendWithFallback('config', engineConfig)
      if (C.selectedAudioSessions.length > 0) {
        await sendPipeCommand('setAudioSessions', { pids: C.selectedAudioSessions })
      }
      getLogger().info('clips-pipe', 'Full config synced to engine on connect')
    } catch {
      getLogger().warning('clips-pipe', 'Config sync on connect failed (will retry on next config update)')
    }
  })
  setOnEngineRunning(() => _engineRunning)
}
