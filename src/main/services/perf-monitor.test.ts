import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCpus, mockTotalmem, mockFreemem, mockUptime } = vi.hoisted(() => ({
  mockCpus: vi.fn(),
  mockTotalmem: vi.fn(),
  mockFreemem: vi.fn(),
  mockUptime: vi.fn(),
}))

vi.mock('node:os', () => ({
  cpus: mockCpus,
  totalmem: mockTotalmem,
  freemem: mockFreemem,
  uptime: mockUptime,
}))

vi.mock('systeminformation', () => ({
  cpu: vi.fn(),
  osInfo: vi.fn(),
  mem: vi.fn(),
  disksIO: vi.fn(),
  processes: vi.fn(),
  diskLayout: vi.fn(),
}))

vi.mock('./exec-utf8', () => ({
  execFileAsync: vi.fn(),
  psUtf8: (s: string) => s,
}))

import { IPC } from '@shared/channels'
import type { Systeminformation } from 'systeminformation'
import * as si from 'systeminformation'
import { execFileAsync } from './exec-utf8'
import { PerfMonitorService } from './perf-monitor'

const mockedCpu = vi.mocked(si.cpu)
const mockedOsInfo = vi.mocked(si.osInfo)
const mockedMem = vi.mocked(si.mem)
const mockedDisksIO = vi.mocked(si.disksIO)
const mockedProcesses = vi.mocked(si.processes)
const mockedDiskLayout = vi.mocked(si.diskLayout)
const mockedExecFileAsync = vi.mocked(execFileAsync)
function createMockSender(): any {
  return { send: vi.fn(), isDestroyed: vi.fn().mockReturnValue(false) }
}

describe('PerfMonitorService', () => {
  let service: PerfMonitorService
  let mockSender: any
  let origPlatform: string

  beforeEach(() => {
    vi.clearAllMocks()
    origPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    service = new PerfMonitorService()
    mockSender = createMockSender()
    mockCpus.mockReturnValue([{ times: { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 } }])
    mockTotalmem.mockReturnValue(17_179_869_184)
    mockFreemem.mockReturnValue(8_589_934_592)
    mockUptime.mockReturnValue(3600)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true })
  })

  describe('getSystemInfo', () => {
    it('returns system info from si.cpu, si.osInfo, and si.mem', async () => {
      mockedCpu.mockResolvedValue({
        manufacturer: 'Intel',
        brand: 'Core i7-10700K',
        physicalCores: 8,
        cores: 16,
      } as any)
      mockedOsInfo.mockResolvedValue({
        distro: 'Windows',
        release: '10.0.19045',
        hostname: 'DESKTOP-ABC',
      } as any)
      mockedMem.mockResolvedValue({ total: 17179869184 } as any)

      const info = await service.getSystemInfo()

      expect(info).toEqual({
        cpuModel: 'Intel Core i7-10700K',
        cpuCores: 8,
        cpuThreads: 16,
        totalMemBytes: 17179869184,
        osVersion: 'Windows 10.0.19045',
        hostname: 'DESKTOP-ABC',
      })
    })

    it('caches the result and does not call si functions again', async () => {
      mockedCpu.mockResolvedValue({
        manufacturer: 'AMD',
        brand: 'Ryzen 9 7950X',
        physicalCores: 16,
        cores: 32,
      } as any)
      mockedOsInfo.mockResolvedValue({
        distro: 'Ubuntu',
        release: '24.04',
        hostname: 'devbox',
      } as any)
      mockedMem.mockResolvedValue({ total: 34359738368 } as any)

      const first = await service.getSystemInfo()
      const second = await service.getSystemInfo()

      expect(mockedCpu).toHaveBeenCalledTimes(1)
      expect(first).toBe(second)
      expect(second.cpuModel).toBe('AMD Ryzen 9 7950X')
    })
  })

  describe('startMonitoring', () => {
    it('collects initial snapshot immediately', async () => {
      const cpuData = [{ times: { user: 200, nice: 0, sys: 100, idle: 700, irq: 0 } }]
      mockCpus.mockReturnValue(cpuData as any)
      mockedDisksIO.mockResolvedValue({
        rIO_sec: 1024,
        wIO_sec: 2048,
      } as Systeminformation.DisksIoData)

      await service.startMonitoring(mockSender)

      // First call initializes baseline → CPU = 0
      await vi.waitFor(() => {
        expect(mockSender.send).toHaveBeenCalledWith(
          IPC.PERF_SNAPSHOT,
          expect.objectContaining({
            cpu: expect.objectContaining({ overall: 0 }),
            disk: expect.objectContaining({ readBytesPerSec: 1024, writeBytesPerSec: 2048 }),
          }),
        )
      })
    })

    it('collects process list when process polling is started', async () => {
      mockCpus.mockReturnValue([{ times: { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 } }] as any)
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 } as any)
      mockedProcesses.mockResolvedValue({
        all: 2,
        running: 2,
        blocked: 0,
        sleeping: 0,
        list: [
          { pid: 4, name: 'System', cpu: 0, memRss: 8192, user: 'SYSTEM', started: '' },
          { pid: 100, name: 'chrome.exe', cpu: 15, memRss: 300000000, user: 'user', started: '09:00' },
        ],
      } as any)

      await service.startMonitoring(mockSender)
      service.startProcessPolling()

      await vi.waitFor(() => {
        expect(mockSender.send).toHaveBeenCalledWith(IPC.PERF_PROCESS_LIST, expect.objectContaining({ totalCount: 2 }))
      })
    })

    it('updates sender without throwing when already running', async () => {
      mockCpus.mockReturnValue([{ times: { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 } }] as any)
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 } as any)

      await service.startMonitoring(mockSender)
      await vi.waitFor(() => {
        expect(mockSender.send).toHaveBeenCalled()
      })

      const newSender = createMockSender()
      await expect(service.startMonitoring(newSender)).resolves.toBeUndefined()
    })

    it('correlates startup items with process list', async () => {
      const getStartupItems = vi.fn().mockResolvedValue([
        {
          id: 'steam',
          name: 'Steam',
          displayName: 'Steam Client',
          command: 'C:\\Program Files\\Steam\\steam.exe',
          location: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
          source: 'registry-hklm',
          enabled: true,
          publisher: 'Valve',
          impact: 'medium',
        },
      ])

      mockedProcesses.mockResolvedValue({
        all: 2,
        running: 2,
        blocked: 0,
        sleeping: 0,
        list: [
          { pid: 100, name: 'steam.exe', cpu: 5, memRss: 150000000, user: 'user', started: '09:00' },
          { pid: 200, name: 'notepad.exe', cpu: 1, memRss: 10000000, user: 'user', started: '09:05' },
        ],
      } as any)

      await service.startMonitoring(mockSender, getStartupItems)
      service.startProcessPolling()

      await vi.waitFor(() => {
        expect(mockSender.send).toHaveBeenCalledWith(IPC.PERF_PROCESS_LIST, expect.any(Object))
      })

      const processListCall = mockSender.send.mock.calls.find(([ch]: unknown[]) => ch === IPC.PERF_PROCESS_LIST) as [
        string,
        { processes: Array<{ name: string; isStartupItem: boolean }> },
      ]

      const steam = processListCall[1].processes.find((p) => p.name === 'steam.exe')
      expect(steam?.isStartupItem).toBe(true)

      const notepad = processListCall[1].processes.find((p) => p.name === 'notepad.exe')
      expect(notepad?.isStartupItem).toBeFalsy()
    })

    it('does not fail when getStartupItems callback throws', async () => {
      const getStartupItems = vi.fn().mockRejectedValue(new Error('access denied'))
      mockCpus.mockReturnValue([{ times: { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 } }] as any)
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 } as any)

      await expect(service.startMonitoring(mockSender, getStartupItems)).resolves.toBeUndefined()

      await vi.waitFor(() => {
        expect(mockSender.send).toHaveBeenCalledWith(IPC.PERF_SNAPSHOT, expect.any(Object))
      })
    })
  })

  describe('stopMonitoring', () => {
    it('can be called when not running (no-op)', () => {
      expect(() => service.stopMonitoring()).not.toThrow()
    })

    it('stops sending data after stop', async () => {
      vi.useFakeTimers()
      mockCpus.mockReturnValue([{ times: { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 } }] as any)
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 } as any)

      await service.startMonitoring(mockSender)
      await vi.advanceTimersByTimeAsync(1)

      expect(mockSender.send).toHaveBeenCalled()
      mockSender.send.mockClear()

      service.stopMonitoring()
      await vi.advanceTimersByTimeAsync(30000)

      expect(mockSender.send).not.toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  describe('startProcessPolling / stopProcessPolling', () => {
    it('is no-op when called without startMonitoring (no sender)', () => {
      service.startProcessPolling()
      expect(mockedProcesses).not.toHaveBeenCalled()
    })

    it('stops process polling when stopProcessPolling is called', async () => {
      vi.useFakeTimers()
      mockCpus.mockReturnValue([{ times: { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 } }] as any)
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 } as Systeminformation.DisksIoData)
      mockedProcesses.mockResolvedValue({ all: 1, running: 1, blocked: 0, sleeping: 0, unknown: 0, list: [] })

      await service.startMonitoring(mockSender)
      service.startProcessPolling()
      await vi.advanceTimersByTimeAsync(1)

      expect(mockedProcesses).toHaveBeenCalled()
      mockedProcesses.mockClear()

      service.stopProcessPolling()
      await vi.advanceTimersByTimeAsync(30000)

      expect(mockedProcesses).not.toHaveBeenCalled()
      vi.useRealTimers()
    })
  })

  describe('getProcessName', () => {
    it('returns the process name for a valid PID', async () => {
      mockedProcesses.mockResolvedValue({
        all: 2,
        running: 2,
        blocked: 0,
        sleeping: 0,
        list: [
          { pid: 100, name: 'chrome.exe', cpu: 10, memRss: 200000000, user: 'user', started: '09:00' },
          { pid: 200, name: 'notepad.exe', cpu: 1, memRss: 8000000, user: 'user', started: '09:05' },
        ],
      } as any)

      const name = await service.getProcessName(100)
      expect(name).toBe('chrome.exe')
    })

    it('returns null for an unknown PID', async () => {
      mockedProcesses.mockResolvedValue({
        all: 1,
        running: 1,
        blocked: 0,
        sleeping: 0,
        list: [{ pid: 100, name: 'chrome.exe', cpu: 10, memRss: 200000000, user: 'user', started: '' }],
      } as any)

      const name = await service.getProcessName(999)
      expect(name).toBeNull()
    })

    it('returns null when si.processes() fails', async () => {
      mockedProcesses.mockRejectedValue(new Error('permission denied'))

      const name = await service.getProcessName(100)
      expect(name).toBeNull()
    })
  })

  describe('killProcess', () => {
    let killSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      killSpy = vi.spyOn(process, 'kill')
    })

    it('succeeds via process.kill', async () => {
      killSpy.mockImplementation(() => undefined)

      const result = await service.killProcess(1234)

      expect(result).toEqual({ success: true })
      expect(killSpy).toHaveBeenCalledWith(1234)
    })

    it('falls back to execFileAsync on Windows when process.kill fails', async () => {
      killSpy.mockImplementation(() => {
        throw new Error('EPERM')
      })
      mockedExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' } as any)

      const result = await service.killProcess(1234)

      expect(result).toEqual({ success: true })
      expect(mockedExecFileAsync).toHaveBeenCalledWith('taskkill', ['/F', '/PID', '1234'])
    })

    it('falls back to execFileAsync on non-Windows when process.kill fails', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      killSpy.mockImplementation(() => {
        throw new Error('ESRCH')
      })
      mockedExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' } as any)

      const result = await service.killProcess(1234)

      expect(result).toEqual({ success: true })
      expect(mockedExecFileAsync).toHaveBeenCalledWith('kill', ['-9', '1234'])
    })

    it('returns requiresAdmin error on access denied', async () => {
      killSpy.mockImplementation(() => {
        throw new Error('EPERM')
      })
      mockedExecFileAsync.mockRejectedValue(new Error('Access denied'))

      const result = await service.killProcess(1234)

      expect(result.success).toBe(false)
      expect(result.requiresAdmin).toBe(true)
      expect(result.error).toContain('Acesso negado')
    })

    it('returns generic error on other fallback failures', async () => {
      killSpy.mockImplementation(() => {
        throw new Error('EPERM')
      })
      mockedExecFileAsync.mockRejectedValue(new Error('Unknown error'))

      const result = await service.killProcess(1234)

      expect(result.success).toBe(false)
      expect(result.requiresAdmin).toBe(false)
      expect(result.error).toContain('Failed to end process')
    })

    it('handles non-Error throw from fallback', async () => {
      killSpy.mockImplementation(() => {
        throw new Error('EPERM')
      })
      mockedExecFileAsync.mockRejectedValue('string error')

      const result = await service.killProcess(1234)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Failed to end process')
    })
  })

  describe('getDiskHealth', () => {
    it('returns disk health info from si.diskLayout and powershell reliability', async () => {
      mockedDiskLayout.mockResolvedValue([
        {
          device: '\\\\.\\PHYSICALDRIVE0',
          name: 'Samsung SSD 970 EVO',
          type: 'SSD',
          interfaceType: 'NVMe',
          size: 512110190592,
          smartStatus: 'Ok',
          temperature: 35,
        },
        {
          device: '\\\\.\\PHYSICALDRIVE1',
          name: 'WD HDD 2TB',
          type: 'HD',
          interfaceType: 'SATA',
          size: 2000398934016,
          smartStatus: 'Caution',
          temperature: 42,
        },
      ] as any)
      mockedExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify([
          {
            DeviceId: 0,
            Temperature: 35,
            PowerOnHours: 12345,
            ReadErrorsTotal: 0,
            WriteErrorsTotal: 0,
            Wear: 5,
          },
        ]),
        stderr: '',
      })

      const result = await service.getDiskHealth()

      expect(result).toHaveLength(2)

      expect(result[0]).toEqual(
        expect.objectContaining({
          device: '\\\\.\\PHYSICALDRIVE0',
          model: 'Samsung SSD 970 EVO',
          type: 'NVMe',
          sizeBytes: 512110190592,
          healthStatus: 'Healthy',
          temperature: 35,
          powerOnHours: 12345,
          remainingLife: 95,
          readErrors: 0,
          writeErrors: 0,
        }),
      )

      expect(result[1]).toEqual(
        expect.objectContaining({
          device: '\\\\.\\PHYSICALDRIVE1',
          type: 'HDD',
          healthStatus: 'Caution',
          temperature: 42,
          powerOnHours: null,
          remainingLife: null,
        }),
      )
    })

    it('maps unknown smartStatus and interfaceType correctly', async () => {
      mockedDiskLayout.mockResolvedValue([
        {
          device: '\\\\.\\PHYSICALDRIVE0',
          name: 'Mystery Drive',
          type: 'Unknown',
          interfaceType: 'USB',
          size: 64023257088,
          smartStatus: 'Unknown',
          temperature: null,
        },
      ] as any)
      mockedExecFileAsync.mockResolvedValue({ stdout: '[]', stderr: '' })

      const result = await service.getDiskHealth()

      expect(result[0]!.type).toBe('Unknown')
      expect(result[0]!.healthStatus).toBe('Unknown')
    })

    it('returns empty array when si.diskLayout fails', async () => {
      mockedDiskLayout.mockRejectedValue(new Error('no disk info'))

      const result = await service.getDiskHealth()

      expect(result).toEqual([])
    })

    it('handles missing reliability data gracefully', async () => {
      mockedDiskLayout.mockResolvedValue([
        {
          device: '\\\\.\\PHYSICALDRIVE0',
          name: 'Generic SSD',
          type: 'SSD',
          interfaceType: 'SATA',
          size: 256060514304,
          smartStatus: 'Bad',
          temperature: null,
        },
      ] as any)
      mockedExecFileAsync.mockRejectedValue(new Error('access denied'))

      const result = await service.getDiskHealth()

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(
        expect.objectContaining({
          healthStatus: 'Bad',
          temperature: null,
          powerOnHours: null,
          remainingLife: null,
          readErrors: null,
          writeErrors: null,
        }),
      )
    })

    it('handles single-object PowerShell output (not array)', async () => {
      mockedDiskLayout.mockResolvedValue([
        {
          device: '\\\\.\\PHYSICALDRIVE0',
          name: 'Samsung SSD 970 EVO',
          type: 'SSD',
          interfaceType: 'NVMe',
          size: 512110190592,
          smartStatus: 'Ok',
          temperature: 35,
        } as Systeminformation.DiskLayoutData,
      ])
      mockedExecFileAsync.mockResolvedValue({
        stdout: JSON.stringify({
          DeviceId: 0,
          Temperature: 35,
          PowerOnHours: 12345,
          ReadErrorsTotal: 0,
          WriteErrorsTotal: 0,
          Wear: 5,
        }),
        stderr: '',
      })

      const result = await service.getDiskHealth()

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(
        expect.objectContaining({
          device: '\\\\.\\PHYSICALDRIVE0',
          temperature: 35,
          powerOnHours: 12345,
          remainingLife: 95,
        }),
      )
    })

    it('handles device path with no digits', async () => {
      mockedDiskLayout.mockResolvedValue([
        {
          device: '\\\\.\\C:',
          name: 'Local Disk',
          type: 'SSD',
          interfaceType: 'SATA',
          size: 512110190592,
          smartStatus: 'Ok',
          temperature: 35,
        } as Systeminformation.DiskLayoutData,
      ])
      mockedExecFileAsync.mockResolvedValue({ stdout: '[]', stderr: '' })

      const result = await service.getDiskHealth()

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(
        expect.objectContaining({
          device: '\\\\.\\C:',
          temperature: 35,
          powerOnHours: null,
          remainingLife: null,
        }),
      )
    })
  })

  describe('startMonitoring (startup item edge cases)', () => {
    it('handles startup item command without .exe path', async () => {
      const getStartupItems = vi.fn().mockResolvedValue([
        {
          id: 'custom',
          name: 'Custom Launcher',
          displayName: 'Custom Launcher',
          command: 'rundll32.exe shell32.dll,Control_RunDLL',
          location: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
          source: 'registry-hklm',
          enabled: true,
          publisher: '',
          impact: 'medium',
        },
      ])

      mockedProcesses.mockResolvedValue({
        all: 2,
        running: 2,
        blocked: 0,
        sleeping: 0,
        list: [{ pid: 100, name: 'rundll32.exe', cpu: 2, memRss: 5000000, user: 'user', started: '09:00' }],
      } as Systeminformation.ProcessesData)
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 } as Systeminformation.DisksIoData)

      await service.startMonitoring(mockSender, getStartupItems)
      service.startProcessPolling()

      await vi.waitFor(() => {
        expect(mockSender.send).toHaveBeenCalledWith(IPC.PERF_PROCESS_LIST, expect.any(Object))
      })

      const processListCall = mockSender.send.mock.calls.find(([ch]: unknown[]) => ch === IPC.PERF_PROCESS_LIST) as [
        string,
        { processes: Array<{ name: string; isStartupItem: boolean }> },
      ]

      const rundll32 = processListCall[1].processes.find((p) => p.name === 'rundll32.exe')
      // Command 'rundll32.exe shell32.dll,Control_RunDLL' matches regex → rundll32.exe should be found
      expect(rundll32?.isStartupItem).toBe(true)
    })

    it('handles startup item command with no exe match at all', async () => {
      const getStartupItems = vi.fn().mockResolvedValue([
        {
          id: 'nopath',
          name: 'No Path',
          displayName: 'No Path',
          command: '/usr/bin/env python',
          location: '',
          source: 'registry',
          enabled: true,
          publisher: '',
          impact: 'low',
        },
      ])

      mockedProcesses.mockResolvedValue({
        all: 1,
        running: 1,
        blocked: 0,
        sleeping: 0,
        list: [{ pid: 50, name: 'python.exe', cpu: 5, memRss: 10000000, user: 'user', started: '09:00' }],
      } as Systeminformation.ProcessesData)
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 } as Systeminformation.DisksIoData)

      await service.startMonitoring(mockSender, getStartupItems)
      service.startProcessPolling()

      await vi.waitFor(() => {
        expect(mockSender.send).toHaveBeenCalledWith(IPC.PERF_PROCESS_LIST, expect.any(Object))
      })

      const processListCall = mockSender.send.mock.calls.find(([ch]: unknown[]) => ch === IPC.PERF_PROCESS_LIST) as [
        string,
        { processes: Array<{ name: string; isStartupItem: boolean }> },
      ]

      const python = processListCall[1].processes.find((p) => p.name === 'python.exe')
      // '/usr/bin/env python' has no .exe match → startupExeMap won't have it
      expect(python?.isStartupItem).toBe(false)
    })
  })

  describe('collectSnapshot re-entrant guard and error handling', () => {
    it('does not collect when snapshotRunning is true', async () => {
      vi.useFakeTimers()

      mockCpus.mockReturnValue([{ times: { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 } }] as any)
      mockedDisksIO.mockResolvedValue({ rIO_sec: 512, wIO_sec: 1024 } as Systeminformation.DisksIoData)

      await service.startMonitoring(mockSender)
      await vi.advanceTimersByTimeAsync(1)

      mockSender.send.mockClear()
      mockedDisksIO.mockClear()

      // Make getDiskIO slow to trigger re-entrant scenario
      let resolveDisksIO: (v: Systeminformation.DisksIoData | PromiseLike<Systeminformation.DisksIoData>) => void
      mockedDisksIO.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveDisksIO = resolve
          }),
      )

      // Clear the 30s cache so getDiskIO actually calls si.disksIO
      // (the first call already filled the cache; force re-poll by clearing)
      await vi.advanceTimersByTimeAsync(30000)

      // Trigger another interval — should enter getDiskIO (diskIOPolling = true)
      await vi.advanceTimersByTimeAsync(1000)

      // Try triggering again (should be blocked by diskIOPolling guard)
      await vi.advanceTimersByTimeAsync(1000)

      // si.disksIO should have been called once (the second interval tick)
      expect(mockedDisksIO).toHaveBeenCalledTimes(1)

      // Resolve the hanging promise
      resolveDisksIO!({ rIO_sec: 0, wIO_sec: 0 } as Systeminformation.DisksIoData)

      await vi.advanceTimersByTimeAsync(100)

      vi.useRealTimers()
    })

    it('handles si.disksIO throwing an error', async () => {
      mockedDisksIO.mockRejectedValue(new Error('Disk IO failed'))

      await service.startMonitoring(mockSender)

      await vi.waitFor(() => {
        expect(mockedDisksIO).toHaveBeenCalled()
      })

      // Error is caught silently, snapshot sent with zero/default disk data
      expect(mockSender.send).toHaveBeenCalledWith(
        IPC.PERF_SNAPSHOT,
        expect.objectContaining({
          disk: expect.objectContaining({ readBytesPerSec: 0, writeBytesPerSec: 0 }),
        }),
      )
    })

    it('handles sender destroyed after snapshot capture', async () => {
      mockSender = createMockSender()
      mockSender.isDestroyed.mockReturnValue(true)

      mockCpus.mockReturnValue([{ times: { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 } }] as any)
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 } as Systeminformation.DisksIoData)

      // startMonitoring will call collectSnapshot immediately
      // Since sender.isDestroyed() returns true, the first check stops monitoring
      await service.startMonitoring(mockSender)

      // The sender is destroyed, so no IPC sends should happen
      // and stopMonitoring will be called (fastTimer = null)
      expect(mockSender.send).not.toHaveBeenCalled()
    })
  })

  describe('collectProcesses re-entrant guard and error handling', () => {
    it('does not collect when processesRunning is true', async () => {
      vi.useFakeTimers()

      mockCpus.mockReturnValue([{ times: { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 } }] as any)
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 } as Systeminformation.DisksIoData)

      let resolveProcesses: (v: Systeminformation.ProcessesData | PromiseLike<Systeminformation.ProcessesData>) => void
      mockedProcesses.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveProcesses = resolve
          }),
      )

      await service.startMonitoring(mockSender)
      service.startProcessPolling()
      await vi.advanceTimersByTimeAsync(1)

      // First collectProcesses is running (processesRunning = true)
      // Trigger another interval cycle
      await vi.advanceTimersByTimeAsync(10000)

      // The re-entrant guard should prevent a second call
      expect(mockedProcesses).toHaveBeenCalledTimes(1)

      // Resolve the hanging promise
      resolveProcesses!({
        all: 2,
        running: 2,
        blocked: 0,
        sleeping: 0,
        list: [{ pid: 100, name: 'test.exe', cpu: 10, memRss: 10000000, user: 'user', started: '' }],
      } as Systeminformation.ProcessesData)
      await vi.advanceTimersByTimeAsync(100)

      vi.useRealTimers()
    })

    it('handles si.processes throwing an error', async () => {
      mockCpus.mockReturnValue([{ times: { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 } }] as any)
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 } as Systeminformation.DisksIoData)
      mockedProcesses.mockRejectedValue(new Error('Process list failed'))

      await expect(service.startMonitoring(mockSender)).resolves.toBeUndefined()
      service.startProcessPolling()

      // Error is caught silently — no process list sent
      expect(mockSender.send).not.toHaveBeenCalledWith(IPC.PERF_PROCESS_LIST, expect.any(Object))
    })

    it('handles sender destroyed during process collection', async () => {
      mockSender.isDestroyed.mockReturnValue(true)

      mockCpus.mockReturnValue([{ times: { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 } }] as any)
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 } as Systeminformation.DisksIoData)
      mockedProcesses.mockResolvedValue({
        all: 2,
        running: 2,
        blocked: 0,
        sleeping: 0,
        list: [{ pid: 100, name: 'test.exe', cpu: 10, memRss: 10000000, user: 'user', started: '' }],
      } as Systeminformation.ProcessesData)

      await service.startMonitoring(mockSender)

      // startProcessPolling checks sender.isDestroyed() which returns true → stopMonitoring
      service.startProcessPolling()
      expect(mockSender.send).not.toHaveBeenCalledWith(IPC.PERF_PROCESS_LIST, expect.any(Object))
    })
  })

  describe('stopMonitoring with slowTimer cleanup', () => {
    it('cleans up both fast and slow timers', async () => {
      vi.useFakeTimers()

      mockCpus.mockReturnValue([{ times: { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 } }] as any)
      mockedDisksIO.mockResolvedValue({ rIO_sec: 0, wIO_sec: 0 } as Systeminformation.DisksIoData)

      await service.startMonitoring(mockSender)
      await vi.advanceTimersByTimeAsync(1)

      expect(mockSender.send).toHaveBeenCalled()
      mockSender.send.mockClear()

      service.stopMonitoring()
      await vi.advanceTimersByTimeAsync(30000)

      // After stop, no more sends
      expect(mockSender.send).not.toHaveBeenCalled()

      vi.useRealTimers()
    })
  })
})
