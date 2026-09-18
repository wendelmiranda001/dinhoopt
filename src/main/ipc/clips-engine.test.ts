import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const logger = { info: vi.fn(), error: vi.fn(), warning: vi.fn() }
  const stdoutHandlers: Array<(chunk: Buffer) => void> = []
  const stderrHandlers: Array<(chunk: Buffer) => void> = []
  const child = {
    pid: 4242,
    killed: false,
    kill: vi.fn(),
    stdout: {
      on: (_event: string, cb: (chunk: Buffer) => void) => {
        stdoutHandlers.push(cb)
      },
    },
    stderr: {
      on: (_event: string, cb: (chunk: Buffer) => void) => {
        stderrHandlers.push(cb)
      },
    },
    on: vi.fn(),
  }
  return {
    logger,
    child,
    stdoutHandlers,
    stderrHandlers,
    statusCb: null as ((src: Record<string, unknown>) => void) | null,
    statusGet: null as (() => unknown) | null,
    reconnectCb: null as (() => Promise<void>) | null,
    onEngineRunningCb: null as (() => boolean) | null,
    waitForPipeConnection: vi.fn(),
    sendWithFallback: vi.fn(),
    sendPipeCommand: vi.fn(),
    execFile: vi.fn(),
    configObj: {
      selectedAudioSessions: [] as number[],
      outputDirectory: '',
    },
  }
})

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => h.execFile(...args),
  spawn: vi.fn(() => h.child),
}))
vi.mock('node:fs', () => ({ existsSync: vi.fn(() => true) }))
vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))
vi.mock('../services/logger.service', () => ({ getLogger: () => h.logger }))
vi.mock('../services/clips-config-manager', () => ({
  buildEngineConfig: vi.fn(() => ({ Hotkeys: [] })),
  config: h.configObj,
}))
vi.mock('./clips-pipe', () => ({
  connectPipe: vi.fn(),
  disconnectPipe: vi.fn(),
  isPipeConnected: vi.fn(() => false),
  sendPipeCommand: (...args: unknown[]) => h.sendPipeCommand(...args),
  sendWithFallback: (...args: unknown[]) => h.sendWithFallback(...args),
  setOnEngineRunning: vi.fn((cb: () => boolean) => {
    h.onEngineRunningCb = cb
  }),
  setOnReconnect: vi.fn((cb: () => Promise<void>) => {
    h.reconnectCb = cb
  }),
  setStatusCallbacks: vi.fn((cb: (src: Record<string, unknown>) => void, getter: () => unknown) => {
    h.statusCb = cb
    h.statusGet = getter
  }),
  waitForPipeConnection: (...args: unknown[]) => h.waitForPipeConnection(...args),
}))

import { existsSync } from 'node:fs'
import {
  getEnginePath,
  initEnginePipeIntegration,
  isEngineRunning,
  readEngineStatus,
  registerGetCurrentStatus,
  startEngine,
} from './clips-engine'

const ORIG_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  h.stdoutHandlers.length = 0
  h.stderrHandlers.length = 0
  h.statusCb = null
  h.statusGet = null
  h.reconnectCb = null
  h.onEngineRunningCb = null
  h.configObj.selectedAudioSessions = []
  h.configObj.outputDirectory = ''
  h.waitForPipeConnection.mockResolvedValue(true)
  h.sendWithFallback.mockResolvedValue(undefined)
  h.sendPipeCommand.mockResolvedValue(undefined)
})

afterEach(() => {
  process.env = { ...ORIG_ENV }
})

describe('getEnginePath', () => {
  it('falls back when USERPROFILE is unset and no candidate exists', () => {
    delete process.env.USERPROFILE
    delete process.env.DINHO_CLIPS_ENGINE_PATH
    vi.mocked(existsSync).mockReturnValue(false)

    const result = getEnginePath()

    expect(typeof result).toBe('string')
    expect(result.endsWith('DiNho.Capture.Poc.exe')).toBe(true)
  })

  it('classifies candidates with the desktop ternary when USERPROFILE is set', () => {
    process.env.USERPROFILE = 'C:\\Users\\Tester'
    delete process.env.DINHO_CLIPS_ENGINE_PATH
    vi.mocked(existsSync).mockImplementation((p) => p.toString().includes('clips-engine'))

    const result = getEnginePath()

    expect(result).toContain('clips-engine')
  })
})

describe('statusUpdater via initEnginePipeIntegration', () => {
  beforeEach(() => {
    initEnginePipeIntegration()
  })

  it('clears the current game for null and undefined payloads', () => {
    h.statusCb!({ game: 'FiveM' })
    expect(readEngineStatus().currentGame).toBe('FiveM')

    h.statusCb!({ game: null })
    expect(readEngineStatus().currentGame).toBe('')

    h.statusCb!({ game: 'FiveM' })
    h.statusCb!({ game: undefined })
    expect(readEngineStatus().currentGame).toBe('')

    h.statusCb!({ game: 123 })
    expect(readEngineStatus().currentGame).toBe('')
  })

  it('warns and adopts the engine output directory when it differs', () => {
    h.configObj.outputDirectory = 'C:\\frontend\\clips'
    h.statusCb!({ outputDirectory: 'C:\\engine\\clips' })

    expect(h.logger.warning).toHaveBeenCalledWith('clips', expect.stringContaining('Output directory mismatch'))
    expect(h.configObj.outputDirectory).toBe('C:\\engine\\clips')

    h.configObj.outputDirectory = 'C:\\engine\\clips'
    h.statusCb!({ outputDirectory: 'C:\\engine\\clips' })
    expect(h.logger.warning).toHaveBeenCalledTimes(1)
  })

  it('throws from the status getter until one is registered', () => {
    expect(() => h.statusGet!()).toThrow('getCurrentStatus not registered')

    registerGetCurrentStatus(() => ({ running: true }) as never)
    expect(h.statusGet!()).toEqual({ running: true })
  })

  it('exposes the engine running flag to the pipe layer', () => {
    expect(h.onEngineRunningCb!()).toBe(false)
  })
})

describe('startEngine', () => {
  it('logs engine output and warns when initial config sync fails', async () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    h.sendWithFallback.mockRejectedValue(new Error('pipe down'))
    h.sendPipeCommand.mockRejectedValue(new Error('audio down'))
    h.configObj.selectedAudioSessions = [111]

    await startEngine()

    expect(isEngineRunning()).toBe(true)
    expect(h.stdoutHandlers).toHaveLength(1)
    expect(h.stderrHandlers).toHaveLength(1)

    h.stdoutHandlers[0]!(Buffer.from('  engine up  '))
    h.stdoutHandlers[0]!(Buffer.from('   '))
    h.stderrHandlers[0]!(Buffer.from('warning text'))
    h.stderrHandlers[0]!(Buffer.from(''))

    expect(h.logger.info).toHaveBeenCalledWith('clips-engine', 'engine up')
    expect(h.logger.warning).toHaveBeenCalledWith('clips-engine', 'warning text')

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(h.logger.warning).toHaveBeenCalledWith('clips', 'Initial config sync to engine failed')
    expect(h.logger.warning).toHaveBeenCalledWith('clips', 'Initial audio session sync to engine failed')

    stdoutWrite.mockRestore()
  })
})
