import { connect as netConnect, type Socket } from 'node:net'
import { IPC } from '@shared/channels'
import type { ClipsEngineStatus } from '@shared/types'
import { BrowserWindow } from 'electron'
import { getLogger } from '../services/logger.service'

export const ENGINE_PIPE = '\\\\.\\pipe\\dinho-clips-engine'
const PIPE_CONNECT_TIMEOUT = 10_000
const PIPE_RECONNECT_DELAY = 3_000

// Protocol version shared with the C# engine handshake. Bump when the wire
// contract changes incompatibly (new required fields, envelope semantics, etc).
export const PROTO_VERSION = 1

// Set when the engine's handshake_ack reports failure or a protocol mismatch.
// While set, all commands except a re-handshake are rejected. Cleared on (re)connect.
let _handshakeError: string | null = null

export function getHandshakeError(): string | null {
  return _handshakeError
}

// ─── Pipe types ──────────────────────────────────────────────

export interface PipeEnvelope {
  v: number
  cmd: string
  payload?: Record<string, unknown>
}

export interface PipeMessage {
  cmd: string
  payload?: Record<string, unknown>
  // Raw JSON broadcasts from the engine (e.g. RamManager watchdog) carry no
  // v/cmd envelope — they arrive as { event: "ramPressure", ... }.
  event?: string
}

export type PendingRequest = {
  resolve: (value: PipeMessage) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

// ─── State (owned by clips-engine-connection, accessed via getters/setters) ──

let _pipeSocket: Socket | null = null
let _pipeConnected = false
let _pipeBuffer = ''

export function getPipeSocket(): Socket | null {
  return _pipeSocket
}

export function isPipeConnected(): boolean {
  return _pipeConnected
}

export function setPipeConnected(v: boolean): void {
  _pipeConnected = v
}

export function getPipeBuffer(): string {
  return _pipeBuffer
}

export function setPipeBuffer(v: string): void {
  _pipeBuffer = v
}

// ─── Request maps ────────────────────────────────────────────

export const pendingRequests = new Map<string, PendingRequest>()
export const longRunningPending = new Map<string, PendingRequest>()

let reconnectTimer: ReturnType<typeof setTimeout> | null = null

// ─── Status getters (called from handlePipeMessage) ──────────

// These are mutable references from clips-engine-connection
type StatusUpdater = (src: Record<string, unknown>) => void

let _statusUpdater: StatusUpdater | null = null
let _getCurrentStatus: (() => ClipsEngineStatus) | null = null

export function setStatusCallbacks(updater: StatusUpdater, getter: () => ClipsEngineStatus): void {
  _statusUpdater = updater
  _getCurrentStatus = getter
}

// ─── Pipe commands ───────────────────────────────────────────

function sendHandshake(): void {
  const envelope: PipeEnvelope = { v: 1, cmd: 'handshake', payload: { protoVersion: PROTO_VERSION } }
  const line = `${JSON.stringify(envelope)}\n`
  getLogger().info('clips-pipe', `Sending: cmd=handshake payload=${JSON.stringify(envelope.payload)}`)
  const timer = setTimeout(() => {
    pendingRequests.delete('handshake')
    getLogger().warning(
      'clips-pipe',
      'Handshake timed out — engine did not reply (old engine? commands proceed unverified)',
    )
  }, 5000)
  pendingRequests.set('handshake', { resolve: () => {}, reject: () => {}, timer })
  try {
    _pipeSocket?.write(line)
  } catch (err) {
    pendingRequests.delete('handshake')
    clearTimeout(timer)
    getLogger().warning('clips-pipe', `Handshake write failed: ${String(err)}`)
  }
}

export function sendPipeCommand(cmd: string, payload?: Record<string, unknown>): Promise<PipeMessage> {
  return new Promise((resolve, reject) => {
    if (!_pipeSocket || !_pipeConnected) {
      reject(new Error('Pipe not connected'))
      return
    }
    if (_handshakeError && cmd !== 'handshake') {
      reject(new Error(_handshakeError))
      return
    }
    const existing = pendingRequests.get(cmd)
    if (existing) {
      clearTimeout(existing.timer)
      existing.reject(new Error(`Command "${cmd}" superseded`))
      pendingRequests.delete(cmd)
    }

    const envelope: PipeEnvelope = { v: 1, cmd, ...(payload !== undefined ? { payload } : {}) }
    const line = `${JSON.stringify(envelope)}\n`
    getLogger().info('clips-pipe', `Sending: cmd=${cmd} payload=${JSON.stringify(payload ?? null)}`)

    const timer = setTimeout(() => {
      pendingRequests.delete(cmd)
      reject(new Error(`Command "${cmd}" timed out`))
    }, 5000)

    pendingRequests.set(cmd, { resolve, reject, timer })

    try {
      _pipeSocket.write(line)
    } catch (err) {
      pendingRequests.delete(cmd)
      clearTimeout(timer)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

export function sendPipeCommandLongRunning(
  cmd: string,
  payload?: Record<string, unknown>,
  timeoutMs = 120_000,
): Promise<PipeMessage> {
  return new Promise((resolve, reject) => {
    sendPipeCommand(cmd, payload)
      .then((accepted) => {
        if (accepted.payload?.status === 'accepted') {
          const timer = setTimeout(() => {
            longRunningPending.delete(cmd)
            reject(new Error(`Long-running command "${cmd}" timed out after ${timeoutMs}ms`))
          }, timeoutMs)
          longRunningPending.set(cmd, { resolve, reject, timer })
        } else {
          resolve(accepted)
        }
      })
      .catch(reject)
  })
}

export async function sendWithFallback(
  cmd: string,
  payload?: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  if (!_pipeConnected) {
    return { success: false, error: 'Engine pipe not connected' }
  }
  try {
    const resp = await sendPipeCommand(cmd, payload)
    const p = resp.payload as Record<string, unknown> | undefined
    if (p && typeof p === 'object' && 'Action' in p) {
      if (p.Action === 'error') {
        const val = p.Value as Record<string, unknown> | undefined
        const errMsg = typeof val?.error === 'string' ? val.error : 'Command failed'
        getLogger().warning('clips-pipe', `sendWithFallback cmd="${cmd}" engine error: ${errMsg}`)
        return { success: false, error: errMsg }
      }
      return { success: true }
    }
    if (p?.success === false || p?.error) {
      return { success: false, error: (p.error as string) || 'Command failed' }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Data handling ───────────────────────────────────────────

export function onPipeData(chunk: Buffer): void {
  _pipeBuffer += chunk.toString('utf-8')
  if (_pipeBuffer.length > 2 * 1024 * 1024) {
    getLogger().warning('clips-pipe', 'Pipe buffer exceeded 2MB, discarding')
    _pipeBuffer = ''
    return
  }
  const lines = _pipeBuffer.split('\n')
  _pipeBuffer = lines.pop() || ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const msg: PipeMessage = JSON.parse(trimmed)
      handlePipeMessage(msg)
    } catch {
      getLogger().warning('clips-pipe', `Unparseable line: ${trimmed.slice(0, 200)}`)
    }
  }
}

function handlePipeMessage(msg: PipeMessage): void {
  if (msg.cmd === '_event' && msg.payload?.type === 'commandResult') {
    const originalCmd = String(msg.payload.originalCmd ?? '')
    const pending = longRunningPending.get(originalCmd)
    if (pending) {
      longRunningPending.delete(originalCmd)
      clearTimeout(pending.timer)
      if (msg.payload.error) {
        getLogger().warning('clips-pipe', `Long-running command "${originalCmd}" failed: ${msg.payload.error}`)
        pending.reject(new Error(String(msg.payload.error)))
      } else {
        pending.resolve({ cmd: originalCmd, payload: msg.payload.value as Record<string, unknown> | undefined })
      }
    } else {
      getLogger().warning('clips-pipe', `No pending long-running request for cmd="${originalCmd}"`)
    }
    return
  }

  if (msg.cmd === '_event' && msg.payload?.type === 'engineStatus') {
    const p = msg.payload as Record<string, unknown>
    const d = p.data as Record<string, unknown> | undefined
    const src = d ?? p
    getLogger().info(
      'clips-pipe',
      `Engine status: game="${src.game}" recording=${src.recording} fps=${src.fps} backend=${src.captureBackend}`,
    )

    _statusUpdater?.(src)
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (win && _getCurrentStatus) {
      win.webContents.send(IPC.CLIPS_ENGINE_STATUS, _getCurrentStatus())
    }
    return
  }

  if (msg.cmd === '_event' && msg.payload?.type === 'clipSaved') {
    const p = msg.payload as Record<string, unknown>
    getLogger().info('clips-pipe', `Clip saved: ${String(p.path ?? 'unknown')}`)
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (win) {
      win.webContents.send(IPC.CLIPS_CLIP_SAVED, { path: p.path })
    }
    return
  }

  // ramPressure broadcasts from RamManager watchdog (raw JSON, no envelope)
  if (msg.event === 'ramPressure') {
    const p = msg as unknown as Record<string, unknown>
    const level = String(p.level ?? 'unknown')
    const usedPct = Number(p.usedPercent ?? 0)
    const reducedReplay = p.reducedReplay
    const baseMsg = `RAM pressure: level=${level} used=${(usedPct * 100).toFixed(1)}%`
    const detail = typeof reducedReplay === 'number' ? ` replayReducedTo=${reducedReplay}s` : ''
    if (level === 'critical') {
      getLogger().warning('clips-pipe', `${baseMsg}${detail}`)
    } else {
      getLogger().info('clips-pipe', `${baseMsg}${detail}`)
    }
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (win) {
      win.webContents.send(IPC.CLIPS_RAM_PRESSURE, p)
    }
    return
  }

  if (msg.cmd === 'handshake_ack') {
    handleHandshakeAck(msg)
    return
  }

  const pending = pendingRequests.get(msg.cmd)
  if (pending) {
    pendingRequests.delete(msg.cmd)
    clearTimeout(pending.timer)
    getLogger().info(
      'clips-pipe',
      `Received response for cmd="${msg.cmd}" payload=${JSON.stringify(msg.payload ?? null)}`,
    )
    pending.resolve(msg)
  } else {
    getLogger().info('clips-pipe', `No pending request for cmd="${msg.cmd}" (maybe late response)`)
  }
}

function handleHandshakeAck(msg: PipeMessage): void {
  const pending = pendingRequests.get('handshake')
  if (pending) {
    pendingRequests.delete('handshake')
    clearTimeout(pending.timer)
  }
  const p = (msg.payload ?? {}) as Record<string, unknown>
  const status = String(p.status ?? 'ok')
  const engineProto = p.protoVersion === undefined ? undefined : Number(p.protoVersion)
  if (engineProto !== undefined && engineProto !== PROTO_VERSION) {
    _handshakeError = `Engine protocol mismatch: client=${PROTO_VERSION} engine=${engineProto}`
    getLogger().warning('clips-pipe', _handshakeError)
  } else if (status !== 'ok') {
    _handshakeError = `Engine handshake failed: ${String(p.error ?? status)}`
    getLogger().warning('clips-pipe', _handshakeError)
  } else {
    _handshakeError = null
    getLogger().info(
      'clips-pipe',
      `Handshake OK: engineVersion=${String(p.engineVersion ?? '?')} protoVersion=${String(engineProto ?? PROTO_VERSION)}`,
    )
  }
  pending?.resolve(msg)
}

// ─── Connection management ───────────────────────────────────

let _onReconnect: (() => void) | null = null
let _isEngineRunning: (() => boolean) | null = null

export function setOnReconnect(cb: () => void): void {
  _onReconnect = cb
}

export function setOnEngineRunning(cb: () => boolean): void {
  _isEngineRunning = cb
}

export function connectPipe(): void {
  if (_pipeSocket) {
    // A superseded socket may still emit close/error/timeout events queued
    // before destroy(). Detach its handlers and destroy it so a stale event
    // cannot clobber the newly created socket below.
    _pipeSocket.removeAllListeners()
    _pipeSocket.destroy()
    _pipeSocket = null
  }
  _pipeConnected = false

  getLogger().info('clips-pipe', `Connecting to ${ENGINE_PIPE}...`)
  const sock = netConnect(ENGINE_PIPE)
  _pipeSocket = sock

  sock.setTimeout(PIPE_CONNECT_TIMEOUT)

  sock.on('connect', () => {
    if (_pipeSocket !== sock) return
    // setTimeout value only guards the *connect* phase — disable it so an idle
    // but healthy pipe does not churn with destroy/reconnect every ~10s.
    sock.setTimeout(0)
    _pipeConnected = true
    _handshakeError = null
    getLogger().info('clips-pipe', 'Connected to engine pipe')
    sendHandshake()
    _onReconnect?.()
  })

  sock.on('data', (chunk: Buffer) => {
    if (_pipeSocket === sock) onPipeData(chunk)
  })

  sock.on('error', (err) => {
    if (_pipeSocket !== sock) return
    getLogger().warning('clips-pipe', `Pipe error: ${err.message}`)
    _pipeConnected = false
  })

  sock.on('close', () => {
    if (_pipeSocket !== sock) return
    _pipeConnected = false
    _pipeSocket = null
    scheduleReconnect()
  })

  sock.on('timeout', () => {
    if (_pipeSocket !== sock) return
    getLogger().warning('clips-pipe', 'Pipe connect timeout')
    sock.destroy()
    _pipeConnected = false
    scheduleReconnect()
  })
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (_isEngineRunning?.()) {
      connectPipe()
    }
  }, PIPE_RECONNECT_DELAY)
}

export function disconnectPipe(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  for (const [, pending] of pendingRequests) {
    clearTimeout(pending.timer)
    pending.reject(new Error('Pipe disconnected'))
  }
  pendingRequests.clear()
  for (const [, pending] of longRunningPending) {
    clearTimeout(pending.timer)
    pending.reject(new Error('Pipe disconnected'))
  }
  longRunningPending.clear()
  if (_pipeSocket) {
    _pipeSocket.destroy()
    _pipeSocket = null
  }
  _pipeConnected = false
}

export async function waitForPipeConnection(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  let attempts = 0
  while (Date.now() < deadline) {
    if (_pipeConnected) {
      getLogger().info('clips-pipe', `Pipe connected after ${attempts * 200}ms`)
      return true
    }
    attempts++
    if (attempts % 10 === 0) {
      getLogger().info('clips-pipe', `Waiting for pipe... attempt ${attempts}/${Math.floor(timeoutMs / 200)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  getLogger().error(
    'clips-pipe',
    `Pipe wait timeout after ${attempts * 200}ms (pipeSocket=${!!_pipeSocket}, pipeConnected=${_pipeConnected})`,
  )
  return _pipeConnected
}
