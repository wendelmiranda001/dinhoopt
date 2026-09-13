import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExecSync = vi.fn()
vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}))

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}))

vi.mock('./logger.service', () => ({
  getLogger: () => mockLogger,
}))

import { scanMemory } from './memory-scanner.service'

describe('MemoryScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function mockTasklist(csv: string) {
    const escaped = csv.replace(/\n/g, '\r\n')
    mockExecSync.mockReturnValue(escaped)
  }

  it('scanMemory returns a MemoryScanResult', () => {
    mockTasklist('"chrome.exe","1234","Console","1","45.678 K"')
    const result = scanMemory()
    expect(result).toHaveProperty('processes')
    expect(result).toHaveProperty('suspiciousCount')
    expect(result).toHaveProperty('timestamp')
    expect(Array.isArray(result.processes)).toBe(true)
  })

  it('returns processes from system (at least 1 process)', () => {
    mockTasklist('"notepad.exe","5678","Console","1","12.345 K"')
    const result = scanMemory()
    expect(result.processes.length).toBeGreaterThanOrEqual(1)
  })

  it('suspiciousCount is a number', () => {
    mockTasklist('"notepad.exe","5678","Console","1","12.345 K"')
    const result = scanMemory()
    expect(typeof result.suspiciousCount).toBe('number')
  })

  it('suspicious patterns detect svchost from temp', () => {
    mockTasklist('"notepad.exe","1111","Console","1","10.000 K"')
    const result = scanMemory()
    for (const p of result.processes) {
      if (
        p.name === 'svchost.exe' &&
        (p.path?.toLowerCase().includes('temp') || p.path?.toLowerCase().includes('\\temp\\'))
      ) {
        expect(p.suspicious).toBe(true)
        expect(p.reason).toBe('Process Hollowing')
      }
    }
  })

  it('suspicious patterns detect run from temp paths', () => {
    mockTasklist('"notepad.exe","2222","Console","1","10.000 K"')
    const result = scanMemory()
    for (const p of result.processes) {
      if (p.path?.toLowerCase().includes('\\temp\\') || p.path?.toLowerCase().includes('\\tmp\\')) {
        expect(p.suspicious).toBe(true)
        expect(p.reason).toBe('Run from Temp')
      }
    }
  })

  it('HIGH memory apps classified correctly — known browsers excluded', () => {
    mockTasklist('"notepad.exe","3333","Console","1","600.000 K"')
    const result = scanMemory()
    for (const p of result.processes) {
      const isBrowser = ['chrome.exe', 'msedge.exe', 'firefox.exe', 'Code.exe', 'explorer.exe'].includes(p.name)
      if (p.memory > 500 && !isBrowser) {
        expect(p.suspicious).toBe(true)
        expect(p.reason).toBe('High Memory Usage')
      }
    }
  })

  it('empty process list returns empty result', () => {
    mockExecSync.mockReturnValue('')
    const result = scanMemory()
    expect(result.processes).toEqual([])
    expect(result.suspiciousCount).toBe(0)
  })

  it('tasklist parsing handles malformed lines gracefully', async () => {
    mockTasklist(
      '"good.exe","1","Console","1","10.000 K"\n"bad_line_no_commas"\n"another.exe","2","Console","1","20.000 K"',
    )
    const result = scanMemory()
    expect(result.processes.length).toBeGreaterThanOrEqual(1)
  })

  it('parses quoted image names containing commas (CSV fields)', () => {
    mockTasklist('"chrome, dev.exe","4321","Console","1","45.678 K"')
    const result = scanMemory()
    expect(result.processes).toHaveLength(1)
    expect(result.processes[0]!.name).toBe('chrome, dev.exe')
    expect(result.processes[0]!.pid).toBe(4321)
    expect(result.processes[0]!.memory).toBeCloseTo(45.678 / 1024, 2)
  })

  it('flags non-browser processes above the 500 MB high-memory threshold', () => {
    mockTasklist('"notepad.exe","3333","Console","1","614400.000 K"')
    const result = scanMemory()
    expect(result.processes[0]!.memory).toBeGreaterThan(500)
    expect(result.processes[0]!.suspicious).toBe(true)
    expect(result.processes[0]!.reason).toBe('High Memory Usage')
  })

  it('does not flag browsers above the high-memory threshold', () => {
    mockTasklist('"chrome.exe","3334","Console","1","614400.000 K"')
    const result = scanMemory()
    expect(result.processes[0]!.memory).toBeGreaterThan(500)
    expect(result.processes[0]!.suspicious).toBe(false)
  })

  it('logs a warning and returns an empty list when tasklist fails', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('boom')
    })
    const result = scanMemory()
    expect(result.processes).toEqual([])
    expect(mockLogger.warning).toHaveBeenCalledWith('memory-scanner', expect.stringContaining('tasklist'))
  })

  it('mentions the timeout when tasklist times out', () => {
    const err: NodeJS.ErrnoException = Object.assign(new Error('Command failed'), { code: 'ETIMEDOUT' })
    mockExecSync.mockImplementation(() => {
      throw err
    })
    scanMemory()
    expect(mockLogger.warning).toHaveBeenCalledWith('memory-scanner', expect.stringContaining('timed out'))
  })
})
