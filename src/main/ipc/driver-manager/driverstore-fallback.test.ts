import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scanDriverStoreForUpdates } from './driverstore-fallback'

vi.mock('../../services/exec-utf8', () => ({
  execFileAsync: vi.fn(),
  psArgs: vi.fn((script: string) => ['-NoProfile', '-Command', script]),
}))

vi.mock('../../services/logger.service', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  }),
}))

// Mock fs modules
const mockReaddirSync = vi.fn()
const mockReadFileSync = vi.fn()
const mockStatSync = vi.fn()

vi.mock('node:fs', () => ({
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
}))

function makeWmiDriver(hardwareId: string, version: string, _infName = ''): string {
  return `${hardwareId}|${version}`
}

function makeDirEntry(name: string): { name: string; isFile: () => boolean; isDirectory: () => boolean } {
  return {
    name,
    isFile: () => false,
    isDirectory: () => true,
  }
}

describe('scanDriverStoreForUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: statSync succeeds
    mockStatSync.mockReturnValue({ isDirectory: () => true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty on non-win32', async () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' })
    const result = await scanDriverStoreForUpdates()
    expect(result).toHaveLength(0)
    vi.stubGlobal('process', { ...process, platform: 'win32' })
  })

  it('returns empty when FileRepository is unreadable', async () => {
    mockReaddirSync.mockImplementation(() => {
      throw new Error('EACCES')
    })
    const result = await scanDriverStoreForUpdates()
    expect(result).toHaveLength(0)
  })

  it('returns empty when WMI query fails', async () => {
    // FileRepository has drivers but WMI fails → getActiveDriverMap returns empty
    mockReaddirSync
      .mockReturnValueOnce([makeDirEntry('nvidia_31.0.15.5135')]) // folder listing
      .mockReturnValueOnce(['nvidia.inf']) // INF files in folder
    mockReadFileSync.mockReturnValue(
      '[Version]\nDriverVer=10/25/2024,31.0.15.5135\nProvider=%%provider%%\nClass=DISPLAY\n',
    )
    const { execFileAsync } = await import('../../services/exec-utf8')
    vi.mocked(execFileAsync).mockRejectedValue(new Error('WMI failed'))

    const result = await scanDriverStoreForUpdates()
    // Without active drivers map, no updates can be detected
    expect(result).toHaveLength(0)
  })

  it('detects local update when FileRepository has newer version', async () => {
    // Folder listing
    mockReaddirSync.mockReturnValueOnce([makeDirEntry('nvidia_31.0.15.5135')]).mockReturnValueOnce(['nvidia.inf'])

    // INF file content — must include a HardwareID pattern (PCI\, USB\, or %string%)
    mockReadFileSync.mockReturnValue(
      '[Version]\nDriverVer=10/25/2024,31.0.15.5135\nProvider=NVIDIA\nClass=DISPLAY\n[Manufacturer]\n%NVIDIA% = NVIDIA, PCI\\VEN_10DE&DEV_2484\n',
    )

    // WMI returns active driver with OLDER version
    const { execFileAsync } = await import('../../services/exec-utf8')
    vi.mocked(execFileAsync).mockResolvedValueOnce({
      stdout: makeWmiDriver('PCI\\VEN_10DE&DEV_2484', '31.0.14.7239'),
      stderr: '',
    })

    const result = await scanDriverStoreForUpdates()

    expect(result).toHaveLength(1)
    expect(result[0]!.availableVersion).toBe('31.0.15.5135')
    expect(result[0]!.currentVersion).toBe('31.0.14.7239')
    expect(result[0]!.updateId).toContain('local-store://')
    expect(result[0]!.selected).toBe(true)
  })

  it('ignores when active driver is already latest', async () => {
    mockReaddirSync.mockReturnValueOnce([makeDirEntry('nvidia_31.0.15.5135')]).mockReturnValueOnce(['nvidia.inf'])

    mockReadFileSync.mockReturnValue(
      '[Version]\nDriverVer=10/25/2024,31.0.15.5135\nProvider=NVIDIA\nClass=DISPLAY\n[Manufacturer]\n%NVIDIA% = NVIDIA, PCI\\VEN_10DE&DEV_2484\n',
    )

    // WMI returns SAME version → no update
    const { execFileAsync } = await import('../../services/exec-utf8')
    vi.mocked(execFileAsync).mockResolvedValueOnce({
      stdout: makeWmiDriver('PCI\\VEN_10DE&DEV_2484', '31.0.15.5135'),
      stderr: '',
    })

    const result = await scanDriverStoreForUpdates()
    expect(result).toHaveLength(0)
  })

  it('skips folders without INF files', async () => {
    mockReaddirSync.mockReturnValueOnce([makeDirEntry('driver_no_inf')]).mockReturnValueOnce([]) // no .inf files

    const { execFileAsync } = await import('../../services/exec-utf8')
    vi.mocked(execFileAsync).mockResolvedValueOnce({
      stdout: 'PCI\\VEN_8086&DEV_1502|15.0.0.0',
      stderr: '',
    })

    const result = await scanDriverStoreForUpdates()
    expect(result).toHaveLength(0)
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })

  it('skips folders where statSync fails (broken symlink)', async () => {
    mockReaddirSync.mockReturnValueOnce([makeDirEntry('broken_link')]).mockReturnValueOnce([])

    mockStatSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const { execFileAsync } = await import('../../services/exec-utf8')
    vi.mocked(execFileAsync).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
    })

    const result = await scanDriverStoreForUpdates()
    expect(result).toHaveLength(0)
  })
})
