import { connect } from 'node:net'
import { IPC } from '@shared/channels'
import { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = { info: vi.fn(), error: vi.fn(), warning: vi.fn() }

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: vi.fn(() => []) } }))
vi.mock('../services/logger.service', () => ({ getLogger: () => mockLogger }))
vi.mock('node:net', () => ({ connect: vi.fn() }))

import {
  connectPipe,
  disconnectPipe,
  onPipeData,
  sendPipeCommand,
  sendWithFallback,
  setOnEngineRunning,
  setStatusCallbacks,
} from './clips-pipe'

type SocketHandler = (...args: unknown[]) => void

function makeSocket() {
  const h: Record<string, SocketHandler[]> = {}
  const sock = {
    h,
    on: vi.fn(),
    write: vi.fn().mockReturnValue(true),
    destroy: vi.fn(),
    removeAllListeners: vi.fn(),
    setTimeout: vi.fn(),
  }
  sock.on.mockImplementation((event: string, cb: SocketHandler) => {
    ;(h[event] ??= []).push(cb)
    return sock
  })
  return sock
}

function emit(sock: ReturnType<typeof makeSocket>, event: string, ...args: unknown[]): void {
  for (const cb of sock.h[event] ?? []) cb(...args)
}

function connectFakeSocket() {
  const sock = makeSocket()
  vi.mocked(connect).mockReturnValue(sock as never)
  connectPipe()
  emit(sock, 'connect')
  return sock
}

function makeWindow() {
  return { isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() } }
}

const line = (msg: unknown) => Buffer.from(`${JSON.stringify(msg)}\n`, 'utf-8')

beforeEach(() => {
  vi.clearAllMocks()
  disconnectPipe()
  setOnEngineRunning(() => false)
  setStatusCallbacks(
    () => {},
    () => ({}) as never,
  )
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
  vi.mocked(connect).mockReturnValue(makeSocket() as never)
})

describe('clips-pipe buffer guard', () => {
  it('discards the buffer when it exceeds 2MB', () => {
    onPipeData(Buffer.alloc(2 * 1024 * 1024 + 16, 0x61))

    expect(mockLogger.warning).toHaveBeenCalledWith('clips-pipe', 'Pipe buffer exceeded 2MB, discarding')
  })
})

describe('clips-pipe broadcast events', () => {
  it('forwards clipSaved to the renderer', () => {
    const win = makeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([win as never])

    onPipeData(line({ cmd: '_event', payload: { type: 'clipSaved', path: 'C:\\Clips\\a.mp4' } }))

    expect(mockLogger.info).toHaveBeenCalledWith('clips-pipe', 'Clip saved: C:\\Clips\\a.mp4')
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.CLIPS_CLIP_SAVED, { path: 'C:\\Clips\\a.mp4' })
  })

  it('logs an unknown path and skips the send when there is no window', () => {
    onPipeData(line({ cmd: '_event', payload: { type: 'clipSaved' } }))

    expect(mockLogger.info).toHaveBeenCalledWith('clips-pipe', 'Clip saved: unknown')
  })

  it('forwards ramPressure with the reduced replay detail', () => {
    const win = makeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([win as never])

    onPipeData(line({ event: 'ramPressure', level: 'critical', usedPercent: 0.9, reducedReplay: 30 }))

    expect(mockLogger.warning).toHaveBeenCalledWith(
      'clips-pipe',
      'RAM pressure: level=critical used=90.0% replayReducedTo=30s',
    )
    expect(win.webContents.send).toHaveBeenCalledWith(
      IPC.CLIPS_RAM_PRESSURE,
      expect.objectContaining({ level: 'critical' }),
    )
  })

  it('logs non-critical ramPressure at info level without the replay detail', () => {
    onPipeData(line({ event: 'ramPressure', level: 'normal' }))

    expect(mockLogger.info).toHaveBeenCalledWith('clips-pipe', 'RAM pressure: level=normal used=0.0%')
    expect(mockLogger.warning).not.toHaveBeenCalled()
  })

  it('defaults a missing ramPressure level to unknown', () => {
    onPipeData(line({ event: 'ramPressure' }))

    expect(mockLogger.info).toHaveBeenCalledWith('clips-pipe', 'RAM pressure: level=unknown used=0.0%')
  })

  it('warns when a long-running command result has no pending request', () => {
    onPipeData(line({ cmd: '_event', payload: { type: 'commandResult', originalCmd: 'trim', error: 'boom' } }))

    expect(mockLogger.warning).toHaveBeenCalledWith('clips-pipe', 'No pending long-running request for cmd="trim"')
  })
})

describe('clips-pipe handshake and commands', () => {
  it('warns when the handshake write fails', () => {
    const sock = makeSocket()
    sock.write.mockImplementationOnce(() => {
      throw new Error('EPIPE')
    })
    vi.mocked(connect).mockReturnValue(sock as never)

    connectPipe()
    emit(sock, 'connect')

    expect(mockLogger.warning).toHaveBeenCalledWith('clips-pipe', expect.stringContaining('Handshake write failed'))
  })

  it('rejects a command that is never answered', async () => {
    const sock = makeSocket()
    vi.mocked(connect).mockReturnValue(sock as never)

    vi.useFakeTimers()
    try {
      connectPipe()
      emit(sock, 'connect')

      const promise = sendPipeCommand('slow')
      const assertion = expect(promise).rejects.toThrow('Command "slow" timed out')
      vi.advanceTimersByTime(5000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('maps engine Action envelopes to results', async () => {
    connectFakeSocket()

    const failed = sendWithFallback('doIt')
    onPipeData(line({ cmd: 'doIt', payload: { Action: 'error', Value: { error: 'denied' } } }))
    expect(await failed).toEqual({ success: false, error: 'denied' })

    const genericFailure = sendWithFallback('doIt')
    onPipeData(line({ cmd: 'doIt', payload: { Action: 'error' } }))
    expect(await genericFailure).toEqual({ success: false, error: 'Command failed' })

    const accepted = sendWithFallback('doIt')
    onPipeData(line({ cmd: 'doIt', payload: { Action: 'ok' } }))
    expect(await accepted).toEqual({ success: true })
  })
})

describe('clips-pipe reconnect', () => {
  it('reconnects after close while the engine is running', () => {
    const sock = makeSocket()
    vi.mocked(connect)
      .mockReturnValueOnce(sock as never)
      .mockReturnValueOnce(makeSocket() as never)
    setOnEngineRunning(() => true)

    vi.useFakeTimers()
    try {
      connectPipe()
      emit(sock, 'connect')
      emit(sock, 'close')

      vi.advanceTimersByTime(3000)
      expect(connect).toHaveBeenCalledTimes(2)
      expect(mockLogger.info).toHaveBeenCalledWith('clips-pipe', expect.stringContaining('Connecting to'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not reconnect after close while the engine is stopped', () => {
    const sock = makeSocket()
    vi.mocked(connect).mockReturnValue(sock as never)
    setOnEngineRunning(() => false)

    vi.useFakeTimers()
    try {
      connectPipe()
      emit(sock, 'connect')
      emit(sock, 'close')

      vi.advanceTimersByTime(3000)
      expect(connect).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
