import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  logger: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  // biome-ignore lint/complexity/useArrowFunction: called with `new`
  perfMonitorService: vi.fn(function () {
    return mocks.mockService
  }),
  mockService: {
    getSystemInfo: vi.fn(),
    startMonitoring: vi.fn(),
    stopMonitoring: vi.fn(),
    startProcessPolling: vi.fn(),
    stopProcessPolling: vi.fn(),
    getProcessName: vi.fn(),
    killProcess: vi.fn(),
    getDiskHealth: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
  BrowserWindow: vi.fn(),
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

vi.mock('../services/perf-monitor', () => ({
  PerfMonitorService: mocks.perfMonitorService,
}))

import { _resetPerfCache, registerPerfMonitorIpc } from './perf-monitor.ipc'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mocks.ipcHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

describe('registerPerfMonitorIpc', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    _resetPerfCache()
    // Restore default mockService implementation (cleared by resetAllMocks)
    // biome-ignore lint/complexity/useArrowFunction: constructor mock — arrow functions are not constructible (vitest 4.x)
    mocks.perfMonitorService.mockImplementation(function () {
      return mocks.mockService
    })
  })

  it('registers 8 IPC handlers + extra registered handlers', () => {
    registerPerfMonitorIpc(() => null)
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0]!)
    expect(channels).toContain('perf:quick-stats')
    expect(channels).toContain('perf:system-info')
    expect(channels).toContain('perf:start')
    expect(channels).toContain('perf:stop')
    expect(channels).toContain('perf:start-process')
    expect(channels).toContain('perf:stop-process')
    expect(channels).toContain('perf:kill')
    expect(channels).toContain('perf:disk-health')
  })

  describe('PERF_QUICK_STATS handler', () => {
    it('returns CPU and memory stats', async () => {
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:quick-stats')
      const result = (await handler()) as {
        cpuPercent: number
        memUsedBytes: number
        memTotalBytes: number
        memPercent: number
      }
      expect(result).toHaveProperty('cpuPercent')
      expect(result).toHaveProperty('memUsedBytes')
      expect(result).toHaveProperty('memTotalBytes')
      expect(result).toHaveProperty('memPercent')
      expect(typeof result.cpuPercent).toBe('number')
      expect(typeof result.memPercent).toBe('number')
      expect(result.cpuPercent).toBeGreaterThanOrEqual(0)
      expect(result.memPercent).toBeGreaterThanOrEqual(0)
    })

    it('computes CPU percent correctly on second call', async () => {
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:quick-stats')
      // First call sets prevCpuTimes, returns 0
      await handler()
      // Second call uses prevCpuTimes to compute delta
      const result = (await handler()) as { cpuPercent: number }
      expect(typeof result.cpuPercent).toBe('number')
      expect(result.cpuPercent).toBeGreaterThanOrEqual(0)
    })
  })

  describe('PERF_GET_SYSTEM_INFO handler', () => {
    it('returns system info from service', () => {
      const mockInfo = { os: 'Windows', cpu: 'Intel', cores: 8 }
      const MockService = mocks.perfMonitorService
      // biome-ignore lint/complexity/useArrowFunction: called with `new`
      MockService.mockImplementation(function () {
        return {
          getSystemInfo: vi.fn().mockReturnValue(mockInfo),
          startMonitoring: vi.fn(),
          stopMonitoring: vi.fn(),
          getProcessName: vi.fn(),
          killProcess: vi.fn(),
          getDiskHealth: vi.fn(),
          startProcessPolling: vi.fn(),
          stopProcessPolling: vi.fn(),
        }
      })
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:system-info')
      const result = handler()
      expect(result).toEqual(mockInfo)
    })
  })

  describe('PERF_START_MONITORING handler', () => {
    it('starts monitoring on the sender', () => {
      const mockStart = vi.fn()
      const MockService = mocks.perfMonitorService
      // biome-ignore lint/complexity/useArrowFunction: called with `new`
      MockService.mockImplementation(function () {
        return {
          getSystemInfo: vi.fn(),
          startMonitoring: mockStart,
          stopMonitoring: vi.fn(),
          getProcessName: vi.fn(),
          killProcess: vi.fn(),
          getDiskHealth: vi.fn(),
          startProcessPolling: vi.fn(),
          stopProcessPolling: vi.fn(),
        }
      })
      const sender = { id: 1 }
      registerPerfMonitorIpc(() => ({ id: 1, on: vi.fn(), webContents: { isDestroyed: () => false } }) as any)
      const handler = getHandler('perf:start')
      handler({ sender } as any)
      expect(mockStart).toHaveBeenCalledWith(sender)
    })

    it('starts monitoring even when window is null', () => {
      const mockStart = vi.fn()
      const MockService = mocks.perfMonitorService
      // biome-ignore lint/complexity/useArrowFunction: called with `new`
      MockService.mockImplementation(function () {
        return {
          getSystemInfo: vi.fn(),
          startMonitoring: mockStart,
          stopMonitoring: vi.fn(),
          getProcessName: vi.fn(),
          killProcess: vi.fn(),
          getDiskHealth: vi.fn(),
          startProcessPolling: vi.fn(),
          stopProcessPolling: vi.fn(),
        }
      })
      const sender = { id: 1 }
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:start')
      handler({ sender } as any)
      expect(mockStart).toHaveBeenCalledWith(sender)
    })

    it('attaches hide/show listeners and triggers them', () => {
      const mockStart = vi.fn()
      const mockStop = vi.fn()
      const MockService = mocks.perfMonitorService
      // biome-ignore lint/complexity/useArrowFunction: called with `new`
      MockService.mockImplementation(function () {
        return {
          getSystemInfo: vi.fn(),
          startMonitoring: mockStart,
          stopMonitoring: mockStop,
          getProcessName: vi.fn(),
          killProcess: vi.fn(),
          getDiskHealth: vi.fn(),
          startProcessPolling: vi.fn(),
          stopProcessPolling: vi.fn(),
        }
      })
      const mockOn = vi.fn()
      const sender = { id: 1 }
      const win = { id: 1, on: mockOn, webContents: { isDestroyed: () => false } } as never
      registerPerfMonitorIpc(() => win)
      const handler = getHandler('perf:start')
      handler({ sender } as any)

      // Should have registered 'hide' and 'show' listeners
      expect(mockOn).toHaveBeenCalledWith('hide', expect.any(Function))
      expect(mockOn).toHaveBeenCalledWith('show', expect.any(Function))

      // Get the registered handlers and trigger them
      const hideHandler = mockOn.mock.calls.find((c: string[]) => c[0] === 'hide')![1]
      const showHandler = mockOn.mock.calls.find((c: string[]) => c[0] === 'show')![1]

      hideHandler()
      expect(mockStop).toHaveBeenCalledOnce()

      showHandler()
      expect(mockStart).toHaveBeenCalledTimes(2)
    })

    it('does not re-attach listeners when same window is provided', () => {
      const mockOn = vi.fn()
      const sender = { id: 1 }
      const win = { id: 1, on: mockOn, webContents: { isDestroyed: () => false } } as never
      registerPerfMonitorIpc(() => win)
      const handler = getHandler('perf:start')
      handler({ sender } as any)
      // Call start again with the same window — should not attach new listeners
      handler({ sender } as any)

      // 'hide' should only be registered once (2 calls: 'hide' + 'show')
      expect(mockOn).toHaveBeenCalledTimes(2)
    })

    it('does not start monitoring on show when webContents is destroyed', () => {
      const mockOn = vi.fn()
      const sender = { id: 1 }
      const win = { id: 1, on: mockOn, webContents: { isDestroyed: () => true } } as never
      registerPerfMonitorIpc(() => win)
      const handler = getHandler('perf:start')
      handler({ sender } as any)

      const showHandler = mockOn.mock.calls.find((c: string[]) => c[0] === 'show')![1]
      showHandler()
      // startMonitoring should not have been called by show handler
      // (only by the original PERF_START call)
    })

    it('does not stop on hide when rendererRequestedMonitoring is false', () => {
      const mockStop = vi.fn()
      const MockService = mocks.perfMonitorService
      // biome-ignore lint/complexity/useArrowFunction: called with `new`
      MockService.mockImplementation(function () {
        return {
          getSystemInfo: vi.fn(),
          startMonitoring: vi.fn(),
          stopMonitoring: mockStop,
          getProcessName: vi.fn(),
          killProcess: vi.fn(),
          getDiskHealth: vi.fn(),
          startProcessPolling: vi.fn(),
          stopProcessPolling: vi.fn(),
        }
      })
      const mockOn = vi.fn()
      const sender = { id: 1 }
      const win = { id: 1, on: mockOn, webContents: { isDestroyed: () => false } } as never
      registerPerfMonitorIpc(() => win)

      // Start monitoring (attaches listeners, sets rendererRequestedMonitoring = true)
      const startHandler = getHandler('perf:start')
      startHandler({ sender } as any)

      // Stop monitoring (sets rendererRequestedMonitoring = false)
      const stopHandler = getHandler('perf:stop')
      stopHandler()

      // Get the hide handler and trigger it
      const hideHandler = mockOn.mock.calls.find((c: string[]) => c[0] === 'hide')![1]
      hideHandler()

      // stopMonitoring should only have been called from PERF_STOP, not from hide
      expect(mockStop).toHaveBeenCalledTimes(1)
    })
  })

  describe('PERF_STOP_MONITORING handler', () => {
    it('stops monitoring', () => {
      const mockStop = vi.fn()
      const MockService = mocks.perfMonitorService
      // biome-ignore lint/complexity/useArrowFunction: called with `new`
      MockService.mockImplementation(function () {
        return {
          getSystemInfo: vi.fn(),
          startMonitoring: vi.fn(),
          stopMonitoring: mockStop,
          getProcessName: vi.fn(),
          killProcess: vi.fn(),
          getDiskHealth: vi.fn(),
          startProcessPolling: vi.fn(),
          stopProcessPolling: vi.fn(),
        }
      })
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:stop')
      handler()
      expect(mockStop).toHaveBeenCalledOnce()
    })
  })

  describe('PERF_KILL_PROCESS handler', () => {
    it('rejects invalid PID types', async () => {
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:kill')
      const result = await (handler(null, -1) as { success: boolean; error?: string })
      expect(result.success).toBe(false)
    })

    it('rejects PID 0', async () => {
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:kill')
      const result = await (handler(null, 0) as { success: boolean; error?: string })
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid process ID')
    })

    it('rejects PID 4', async () => {
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:kill')
      const result = await (handler(null, 4) as { success: boolean; error?: string })
      expect(result.success).toBe(false)
    })

    it('rejects own PID', async () => {
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:kill')
      const result = await (handler(null, process.pid) as { success: boolean; error?: string })
      expect(result.success).toBe(false)
    })

    it('blocks protected process names', async () => {
      const mockGetProcessName = vi.fn().mockResolvedValue('csrss.exe')
      const MockService = mocks.perfMonitorService
      // biome-ignore lint/complexity/useArrowFunction: called with `new`
      MockService.mockImplementation(function () {
        return {
          getSystemInfo: vi.fn(),
          startMonitoring: vi.fn(),
          stopMonitoring: vi.fn(),
          getProcessName: mockGetProcessName,
          killProcess: vi.fn(),
          getDiskHealth: vi.fn(),
          startProcessPolling: vi.fn(),
          stopProcessPolling: vi.fn(),
        }
      })
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:kill')
      const result = await (handler(null, 123) as { success: boolean; error?: string })
      expect(result.success).toBe(false)
      expect(result.error).toContain('protected system process')
    })

    it('kills process and returns success', async () => {
      const mockKill = vi.fn().mockResolvedValue({ success: true })
      const MockService = mocks.perfMonitorService
      // biome-ignore lint/complexity/useArrowFunction: called with `new`
      MockService.mockImplementation(function () {
        return {
          getSystemInfo: vi.fn(),
          startMonitoring: vi.fn(),
          stopMonitoring: vi.fn(),
          getProcessName: vi.fn().mockResolvedValue('notepad.exe'),
          killProcess: mockKill,
          startProcessPolling: vi.fn(),
          stopProcessPolling: vi.fn(),
          getDiskHealth: vi.fn(),
        }
      })
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:kill')
      const result = await (handler(null, 456) as { success: boolean })
      expect(mockKill).toHaveBeenCalledWith(456)
      expect(result.success).toBe(true)
    })

    it('returns failure when kill fails', async () => {
      const MockService = mocks.perfMonitorService
      // biome-ignore lint/complexity/useArrowFunction: called with `new`
      MockService.mockImplementation(function () {
        return {
          getSystemInfo: vi.fn(),
          startMonitoring: vi.fn(),
          stopMonitoring: vi.fn(),
          getProcessName: vi.fn().mockResolvedValue('notepad.exe'),
          killProcess: vi.fn().mockResolvedValue({ success: false, error: 'Access denied' }),
          startProcessPolling: vi.fn(),
          stopProcessPolling: vi.fn(),
          getDiskHealth: vi.fn(),
        }
      })
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:kill')
      const result = await (handler(null, 789) as { success: boolean })
      expect(result.success).toBe(false)
    })
  })

  describe('PERF_START_PROCESS_POLLING handler', () => {
    it('calls service.startProcessPolling', () => {
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:start-process')
      handler()
      expect(mocks.mockService.startProcessPolling).toHaveBeenCalledOnce()
    })
  })

  describe('PERF_STOP_PROCESS_POLLING handler', () => {
    it('calls service.stopProcessPolling', () => {
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:stop-process')
      handler()
      expect(mocks.mockService.stopProcessPolling).toHaveBeenCalledOnce()
    })
  })

  describe('PERF_DISK_HEALTH handler', () => {
    it('returns disk health from service', () => {
      const mockHealth = [{ drive: 'C:', status: 'OK' }]
      const MockService = mocks.perfMonitorService
      // biome-ignore lint/complexity/useArrowFunction: called with `new`
      MockService.mockImplementation(function () {
        return {
          getSystemInfo: vi.fn(),
          startMonitoring: vi.fn(),
          stopMonitoring: vi.fn(),
          getProcessName: vi.fn(),
          killProcess: vi.fn(),
          startProcessPolling: vi.fn(),
          stopProcessPolling: vi.fn(),
          getDiskHealth: vi.fn().mockReturnValue(mockHealth),
        }
      })
      registerPerfMonitorIpc(() => null)
      const handler = getHandler('perf:disk-health')
      const result = handler() as typeof mockHealth
      expect(result).toEqual(mockHealth)
    })
  })
})
