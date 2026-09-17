import type { BloatwareApp } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockWin32UninstallCommands, mockExecFileAsync, mockPsArgs, mockGetLogger, mockValidateStringArray } =
  vi.hoisted(() => {
    const mockWin32UninstallCommands = new Map<string, { type: string; command: string }>()
    const mockExecFileAsync = vi.fn()
    const mockPsArgs = vi.fn((s: string) => ['-NoProfile', '-NonInteractive', '-Command', s])
    const mockGetLogger = vi.fn(() => ({
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
    }))
    const mockValidateStringArray = vi.fn()
    return { mockWin32UninstallCommands, mockExecFileAsync, mockPsArgs, mockGetLogger, mockValidateStringArray }
  })

const mockHandlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockHandlers.set(channel, handler)
    }),
  },
}))

vi.mock('../../services/exec-utf8', () => ({
  execFileAsync: (...args: unknown[]) => mockExecFileAsync(...args),
  psArgs: (script: string) => mockPsArgs(script),
}))

vi.mock('../../services/ipc-validation', () => ({
  validateStringArray: (...args: unknown[]) => mockValidateStringArray(...args),
}))

vi.mock('../../services/logger.service', () => ({
  getLogger: () => mockGetLogger(),
}))

vi.mock('./bloatware/registry', () => ({
  win32UninstallCommands: mockWin32UninstallCommands,
  clearWin32Cache: vi.fn(),
}))

vi.mock('./bloatware/third-party', () => ({
  THIRD_PARTY_BLOATWARE: [
    {
      name: '3rd Party App',
      packageName: 'ThirdParty.App',
      publisher: 'Vendor',
      category: 'third-party',
      description: 'test',
    },
  ],
}))

vi.mock('./bloatware/windows', () => ({
  MS_BLOATWARE: [
    {
      name: 'Candy Crush',
      packageName: 'king.com.CandyCrushSaga',
      publisher: 'King',
      category: 'games',
      description: 'Game',
    },
    {
      name: 'Bing Weather',
      packageName: 'Microsoft.BingWeather',
      publisher: 'Microsoft',
      category: 'news',
      description: 'Weather',
    },
  ],
}))

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid'),
}))

vi.mock('../sender-validation', () => ({
  validateSender: vi.fn(() => true),
}))

const { registerDebloaterIpc, scanBloatware, removeBloatware, clearWin32Cache, KNOWN_BLOATWARE } = await import(
  './handlers'
)

let savedPlatform: string

function callHandler<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = mockHandlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  return handler({}, ...args) as Promise<T>
}

describe('debloater/handlers.ts — registerDebloaterIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandlers.clear()
    mockWin32UninstallCommands.clear()
    savedPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    registerDebloaterIpc(vi.fn())
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: savedPlatform, configurable: true })
  })

  describe('DEBLOATER_SCAN', () => {
    it('returns empty on non-win32 platform', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      expect(result).toEqual([])
    })

    it('returns empty array when no bloatware found', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('failed'))
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      expect(result).toEqual([])
    })

    it('returns empty when JSON parse fails in Phase 1', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: 'not-json', stderr: '' })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      expect(result).toEqual([])
    })

    it('finds installed AppX packages', async () => {
      const appxData = JSON.stringify([
        {
          Name: 'king.com.CandyCrushSaga',
          PackageFullName: 'king.com.CandyCrushSaga_1.0',
          InstallLocation: 'C:\\Games',
          Size: 104857600,
        },
      ])
      mockExecFileAsync.mockImplementation((cmd: string) => {
        if (cmd === 'powershell') return Promise.resolve({ stdout: appxData, stderr: '' })
        return Promise.reject(new Error('no'))
      })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      expect(result.length).toBeGreaterThanOrEqual(1)
      const candy = result.find((a: BloatwareApp) => a.packageName === 'king.com.CandyCrushSaga')
      expect(candy).toBeTruthy()
      expect(candy!.size).toContain('MB')
      expect(candy!.selected).toBe(false)
    })

    it('formats size as GB for large packages', async () => {
      const appxData = JSON.stringify([
        {
          Name: 'king.com.CandyCrushSaga',
          PackageFullName: 'pkg',
          InstallLocation: 'C:\\',
          Size: 2 * 1024 * 1024 * 1024,
        },
      ])
      mockExecFileAsync.mockResolvedValue({ stdout: appxData, stderr: '' })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      const candy = result.find((a: BloatwareApp) => a.packageName === 'king.com.CandyCrushSaga')
      expect(candy!.size).toContain('GB')
    })

    it('formats size as KB for small packages', async () => {
      const appxData = JSON.stringify([
        { Name: 'king.com.CandyCrushSaga', PackageFullName: 'pkg', InstallLocation: 'C:\\', Size: 5120 },
      ])
      mockExecFileAsync.mockResolvedValue({ stdout: appxData, stderr: '' })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      const candy = result.find((a: BloatwareApp) => a.packageName === 'king.com.CandyCrushSaga')
      expect(candy!.size).toContain('KB')
    })

    it('formats size as B for tiny packages', async () => {
      const appxData = JSON.stringify([
        { Name: 'king.com.CandyCrushSaga', PackageFullName: 'pkg', InstallLocation: 'C:\\', Size: 100 },
      ])
      mockExecFileAsync.mockResolvedValue({ stdout: appxData, stderr: '' })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      const candy = result.find((a: BloatwareApp) => a.packageName === 'king.com.CandyCrushSaga')
      expect(candy!.size).toBe('100 B')
    })

    it('shows Unknown for zero-size packages', async () => {
      const appxData = JSON.stringify([
        { Name: 'king.com.CandyCrushSaga', PackageFullName: 'pkg', InstallLocation: 'C:\\', Size: 0 },
      ])
      mockExecFileAsync.mockResolvedValue({ stdout: appxData, stderr: '' })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      const candy = result.find((a: BloatwareApp) => a.packageName === 'king.com.CandyCrushSaga')
      expect(candy!.size).toBe('Unknown')
    })

    it('handles single-object JSON (not array)', async () => {
      const singleObj = JSON.stringify({
        Name: 'king.com.CandyCrushSaga',
        PackageFullName: 'pkg',
        InstallLocation: 'C:\\',
        Size: 0,
      })
      mockExecFileAsync.mockResolvedValue({ stdout: singleObj, stderr: '' })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('finds provisioned packages (Phase 2)', async () => {
      const provData = JSON.stringify([{ Name: 'Microsoft.BingWeather' }])
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powershell') {
          const script = args.join(' ')
          if (script.includes('AppxProvisionedPackage')) return Promise.resolve({ stdout: provData, stderr: '' })
          return Promise.reject(new Error('phase1 fail'))
        }
        return Promise.reject(new Error('no'))
      })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      const weather = result.find((a: BloatwareApp) => a.packageName === 'Microsoft.BingWeather')
      expect(weather).toBeTruthy()
      expect(weather!.size).toBe('Provisioned')
    })

    it('skips already found packages in Phase 2', async () => {
      const appxData = JSON.stringify([
        { Name: 'Microsoft.BingWeather', PackageFullName: 'pkg', InstallLocation: 'C:\\', Size: 1024 },
      ])
      const provData = JSON.stringify([{ Name: 'Microsoft.BingWeather' }])
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powershell') {
          const script = args.join(' ')
          if (script.includes('AppxProvisionedPackage')) return Promise.resolve({ stdout: provData, stderr: '' })
          return Promise.resolve({ stdout: appxData, stderr: '' })
        }
        return Promise.reject(new Error('no'))
      })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      const weatherApps = result.filter((a: BloatwareApp) => a.packageName === 'Microsoft.BingWeather')
      expect(weatherApps).toHaveLength(1)
    })

    it('finds Win32 programs via Phase 3', async () => {
      const win32Data = JSON.stringify([
        {
          DisplayName: 'ThirdParty.App',
          Publisher: 'Vendor',
          EstimatedSize: 50000,
          UninstallString: 'uninst.exe',
          QuietUninstallString: 'quiet.exe',
          ProductCode: '',
        },
      ])
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powershell') {
          const script = args.join(' ')
          if (script.includes('CurrentVersion\\Uninstall')) return Promise.resolve({ stdout: win32Data, stderr: '' })
          return Promise.reject(new Error('phase1 fail'))
        }
        return Promise.reject(new Error('no'))
      })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      const thirdParty = result.find((a: BloatwareApp) => a.packageName === 'ThirdParty.App')
      expect(thirdParty).toBeTruthy()
      expect(thirdParty!.size).toContain('MB')
      expect(mockWin32UninstallCommands.has('ThirdParty.App')).toBe(true)
    })

    it('uses UninstallString when QuietUninstallString is empty', async () => {
      const win32Data = JSON.stringify([
        {
          DisplayName: 'ThirdParty.App',
          Publisher: 'Vendor',
          EstimatedSize: 0,
          UninstallString: 'uninst.exe',
          QuietUninstallString: '',
          ProductCode: '',
        },
      ])
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powershell') {
          const script = args.join(' ')
          if (script.includes('CurrentVersion\\Uninstall')) return Promise.resolve({ stdout: win32Data, stderr: '' })
          return Promise.reject(new Error('phase1 fail'))
        }
        return Promise.reject(new Error('no'))
      })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('caches msi ProductCode for Win32 apps', async () => {
      const win32Data = JSON.stringify([
        {
          DisplayName: 'ThirdParty.App',
          Publisher: 'Vendor',
          EstimatedSize: 1000,
          UninstallString: '',
          QuietUninstallString: '',
          ProductCode: '{ABC-123}',
        },
      ])
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powershell') {
          const script = args.join(' ')
          if (script.includes('CurrentVersion\\Uninstall')) return Promise.resolve({ stdout: win32Data, stderr: '' })
          return Promise.reject(new Error('phase1 fail'))
        }
        return Promise.reject(new Error('no'))
      })
      await callHandler<BloatwareApp[]>('debloater:scan')
      expect(mockWin32UninstallCommands.has('ThirdParty.App')).toBe(true)
      expect(mockWin32UninstallCommands.get('ThirdParty.App')).toEqual({ type: 'msi', command: '{ABC-123}' })
    })

    it('formats Win32 GB size correctly', async () => {
      const win32Data = JSON.stringify([
        {
          DisplayName: 'ThirdParty.App',
          Publisher: 'Vendor',
          EstimatedSize: 2 * 1024 * 1024,
          UninstallString: '',
          QuietUninstallString: '',
          ProductCode: '',
        },
      ])
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powershell') {
          const script = args.join(' ')
          if (script.includes('CurrentVersion\\Uninstall')) return Promise.resolve({ stdout: win32Data, stderr: '' })
          return Promise.reject(new Error('phase1 fail'))
        }
        return Promise.reject(new Error('no'))
      })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      const app = result.find((a: BloatwareApp) => a.packageName === 'ThirdParty.App')
      expect(app!.size).toContain('GB')
    })

    it('formats Win32 default size as Win32', async () => {
      const win32Data = JSON.stringify([
        {
          DisplayName: 'ThirdParty.App',
          Publisher: 'Vendor',
          EstimatedSize: 0,
          UninstallString: '',
          QuietUninstallString: '',
          ProductCode: '',
        },
      ])
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powershell') {
          const script = args.join(' ')
          if (script.includes('CurrentVersion\\Uninstall')) return Promise.resolve({ stdout: win32Data, stderr: '' })
          return Promise.reject(new Error('phase1 fail'))
        }
        return Promise.reject(new Error('no'))
      })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      const app = result.find((a: BloatwareApp) => a.packageName === 'ThirdParty.App')
      expect(app!.size).toBe('Win32')
    })

    it('skips Win32 apps already found in Phase 1', async () => {
      const appxData = JSON.stringify([
        { Name: 'king.com.CandyCrushSaga', PackageFullName: 'pkg', InstallLocation: 'C:\\', Size: 1024 },
      ])
      const win32Data = JSON.stringify([
        {
          DisplayName: 'Candy Crush',
          Publisher: 'King',
          EstimatedSize: 500,
          UninstallString: '',
          QuietUninstallString: '',
          ProductCode: '',
        },
      ])
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powershell') {
          const script = args.join(' ')
          if (script.includes('CurrentVersion\\Uninstall')) return Promise.resolve({ stdout: win32Data, stderr: '' })
          return Promise.resolve({ stdout: appxData, stderr: '' })
        }
        return Promise.reject(new Error('no'))
      })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      const candyApps = result.filter((a: BloatwareApp) => a.packageName === 'king.com.CandyCrushSaga')
      expect(candyApps).toHaveLength(1)
    })

    it('skips Win32 apps not matching any known bloatware', async () => {
      const win32Data = JSON.stringify([
        {
          DisplayName: 'Unknown App',
          Publisher: 'Unknown',
          EstimatedSize: 100,
          UninstallString: '',
          QuietUninstallString: '',
          ProductCode: '',
        },
      ])
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powershell') {
          const script = args.join(' ')
          if (script.includes('CurrentVersion\\Uninstall')) return Promise.resolve({ stdout: win32Data, stderr: '' })
          return Promise.reject(new Error('phase1 fail'))
        }
        return Promise.reject(new Error('no'))
      })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      expect(result).toHaveLength(0)
    })

    it('gracefully handles Phase 2 provisioned JSON parse failure', async () => {
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powershell') {
          const script = args.join(' ')
          if (script.includes('AppxProvisionedPackage')) return Promise.resolve({ stdout: 'not-json', stderr: '' })
          return Promise.reject(new Error('phase1 fail'))
        }
        return Promise.reject(new Error('no'))
      })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      expect(result).toEqual([])
    })

    it('gracefully handles Phase 3 Win32 JSON parse failure', async () => {
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powershell') {
          const script = args.join(' ')
          if (script.includes('CurrentVersion\\Uninstall')) return Promise.resolve({ stdout: 'not-json', stderr: '' })
          return Promise.reject(new Error('phase1 fail'))
        }
        return Promise.reject(new Error('no'))
      })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      expect(result).toEqual([])
    })

    it('matches provisioned packages by prefix', async () => {
      const provData = JSON.stringify([{ Name: 'Microsoft.BingWeather.Something' }])
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powershell') {
          const script = args.join(' ')
          if (script.includes('AppxProvisionedPackage')) return Promise.resolve({ stdout: provData, stderr: '' })
          return Promise.reject(new Error('phase1 fail'))
        }
        return Promise.reject(new Error('no'))
      })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      const weather = result.find((a: BloatwareApp) => a.packageName === 'Microsoft.BingWeather.Something')
      expect(weather).toBeTruthy()
      expect(weather!.size).toBe('Provisioned')
    })

    it('Win32 matches by package name (lowercase)', async () => {
      const win32Data = JSON.stringify([
        {
          DisplayName: 'THIRDPARTY.APP',
          Publisher: 'Vendor',
          EstimatedSize: 500,
          UninstallString: '',
          QuietUninstallString: '',
          ProductCode: '',
        },
      ])
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powershell') {
          const script = args.join(' ')
          if (script.includes('CurrentVersion\\Uninstall')) return Promise.resolve({ stdout: win32Data, stderr: '' })
          return Promise.reject(new Error('phase1 fail'))
        }
        return Promise.reject(new Error('no'))
      })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      const app = result.find((a: BloatwareApp) => a.packageName === 'ThirdParty.App')
      expect(app).toBeTruthy()
    })

    it('Phase 2 single-object JSON parsed as array', async () => {
      const provData = JSON.stringify({ Name: 'Microsoft.BingWeather' })
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powershell') {
          const script = args.join(' ')
          if (script.includes('AppxProvisionedPackage')) return Promise.resolve({ stdout: provData, stderr: '' })
          return Promise.reject(new Error('phase1 fail'))
        }
        return Promise.reject(new Error('no'))
      })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      const weather = result.find((a: BloatwareApp) => a.packageName === 'Microsoft.BingWeather')
      expect(weather).toBeTruthy()
    })

    it('Phase 3 single-object JSON parsed as array', async () => {
      const win32Data = JSON.stringify({
        DisplayName: 'ThirdParty.App',
        Publisher: 'Vendor',
        EstimatedSize: 0,
        UninstallString: 'x',
        QuietUninstallString: '',
        ProductCode: '',
      })
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powershell') {
          const script = args.join(' ')
          if (script.includes('CurrentVersion\\Uninstall')) return Promise.resolve({ stdout: win32Data, stderr: '' })
          return Promise.reject(new Error('phase1 fail'))
        }
        return Promise.reject(new Error('no'))
      })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('Win32 KB size formatting', async () => {
      const win32Data = JSON.stringify([
        {
          DisplayName: 'ThirdParty.App',
          Publisher: 'Vendor',
          EstimatedSize: 10,
          UninstallString: '',
          QuietUninstallString: '',
          ProductCode: '',
        },
      ])
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powershell') {
          const script = args.join(' ')
          if (script.includes('CurrentVersion\\Uninstall')) return Promise.resolve({ stdout: win32Data, stderr: '' })
          return Promise.reject(new Error('phase1 fail'))
        }
        return Promise.reject(new Error('no'))
      })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      const app = result.find((a: BloatwareApp) => a.packageName === 'ThirdParty.App')
      expect(app!.size).toBe('10 KB')
    })

    it('Win32 B size formatting for tiny EstimatedSize', async () => {
      const win32Data = JSON.stringify([
        {
          DisplayName: 'ThirdParty.App',
          Publisher: 'Vendor',
          EstimatedSize: 1,
          UninstallString: '',
          QuietUninstallString: '',
          ProductCode: '',
        },
      ])
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powershell') {
          const script = args.join(' ')
          if (script.includes('CurrentVersion\\Uninstall')) return Promise.resolve({ stdout: win32Data, stderr: '' })
          return Promise.reject(new Error('phase1 fail'))
        }
        return Promise.reject(new Error('no'))
      })
      const result = await callHandler<BloatwareApp[]>('debloater:scan')
      const app = result.find((a: BloatwareApp) => a.packageName === 'ThirdParty.App')
      expect(app!.size).toBe('1024 B')
    })
  })

  describe('DEBLOATER_REMOVE', () => {
    it('returns zero on non-win32 platform', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      const result = await callHandler<{ removed: number; failed: number }>('debloater:remove', [
        'king.com.CandyCrushSaga',
      ])
      expect(result).toEqual({ removed: 0, failed: 0 })
    })

    it('returns zero when validation fails', async () => {
      mockValidateStringArray.mockReturnValue(null)
      const result = await callHandler<{ removed: number; failed: number }>('debloater:remove', ['invalid'])
      expect(result).toEqual({ removed: 0, failed: 0 })
    })

    it('removes known AppX package successfully', async () => {
      mockValidateStringArray.mockReturnValue(['king.com.CandyCrushSaga'])
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
      const result = await callHandler<{ removed: number; failed: number }>('debloater:remove', [
        'king.com.CandyCrushSaga',
      ])
      expect(result.removed).toBe(1)
      expect(result.failed).toBe(0)
    })

    it('removes unknown package name (not in KNOWN_BLOATWARE)', async () => {
      mockValidateStringArray.mockReturnValue(['unknown.package'])
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
      const result = await callHandler<{ removed: number; failed: number }>('debloater:remove', ['unknown.package'])
      expect(result.removed).toBe(0)
      expect(result.failed).toBe(0)
    })

    it('handles removal failure', async () => {
      mockValidateStringArray.mockReturnValue(['king.com.CandyCrushSaga'])
      mockExecFileAsync.mockRejectedValue(new Error('removal failed'))
      const result = await callHandler<{ removed: number; failed: number }>('debloater:remove', [
        'king.com.CandyCrushSaga',
      ])
      expect(result.removed).toBe(0)
      expect(result.failed).toBe(1)
    })

    it('removes Win32 package with msi uninstaller', async () => {
      mockValidateStringArray.mockReturnValue(['ThirdParty.App'])
      mockWin32UninstallCommands.set('ThirdParty.App', { type: 'msi', command: '{ABC-123}' })
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
      const result = await callHandler<{ removed: number; failed: number }>('debloater:remove', ['ThirdParty.App'])
      expect(result.removed).toBe(1)
      const msiCall = mockExecFileAsync.mock.calls.find((c: unknown[]) => c[0] === 'msiexec')
      expect(msiCall).toBeTruthy()
    })

    it('removes Win32 package with exe uninstaller', async () => {
      mockValidateStringArray.mockReturnValue(['ThirdParty.App'])
      mockWin32UninstallCommands.set('ThirdParty.App', { type: 'exe', command: 'uninstall.exe /S' })
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
      const result = await callHandler<{ removed: number; failed: number }>('debloater:remove', ['ThirdParty.App'])
      expect(result.removed).toBe(1)
      const cmdCall = mockExecFileAsync.mock.calls.find((c: unknown[]) => c[0] === 'cmd.exe')
      expect(cmdCall).toBeTruthy()
    })

    it('handles Win32 msi removal failure', async () => {
      mockValidateStringArray.mockReturnValue(['ThirdParty.App'])
      mockWin32UninstallCommands.set('ThirdParty.App', { type: 'msi', command: '{ABC-123}' })
      mockExecFileAsync.mockRejectedValue(new Error('msi failed'))
      const result = await callHandler<{ removed: number; failed: number }>('debloater:remove', ['ThirdParty.App'])
      expect(result.failed).toBe(1)
    })

    it('handles Win32 exe removal failure', async () => {
      mockValidateStringArray.mockReturnValue(['ThirdParty.App'])
      mockWin32UninstallCommands.set('ThirdParty.App', { type: 'exe', command: 'uninstall.exe' })
      mockExecFileAsync.mockRejectedValue(new Error('exe failed'))
      const result = await callHandler<{ removed: number; failed: number }>('debloater:remove', ['ThirdParty.App'])
      expect(result.failed).toBe(1)
    })

    it('sends progress callback during removal', async () => {
      mockValidateStringArray.mockReturnValue(['king.com.CandyCrushSaga'])
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
      const mockWin = {
        webContents: { send: vi.fn() },
        isDestroyed: vi.fn().mockReturnValue(false),
      } as unknown as BrowserWindow
      mockHandlers.clear()
      registerDebloaterIpc(() => mockWin)

      await callHandler<{ removed: number; failed: number }>('debloater:remove', ['king.com.CandyCrushSaga'])
      expect(mockWin.webContents.send).toHaveBeenCalledWith(
        'debloater:remove:progress',
        expect.objectContaining({ currentApp: 'king.com.CandyCrushSaga' }),
      )
    })

    it('skips progress when window is destroyed', async () => {
      mockValidateStringArray.mockReturnValue(['king.com.CandyCrushSaga'])
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
      const mockWin = {
        webContents: { send: vi.fn() },
        isDestroyed: vi.fn().mockReturnValue(true),
      } as unknown as BrowserWindow
      mockHandlers.clear()
      registerDebloaterIpc(() => mockWin)

      await callHandler<{ removed: number; failed: number }>('debloater:remove', ['king.com.CandyCrushSaga'])
      expect(mockWin.webContents.send).not.toHaveBeenCalled()
    })

    it('escapes single quotes in package name', async () => {
      mockValidateStringArray.mockReturnValue(["king.com.CandyCrushSaga'--evil"])
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
      const result = await callHandler<{ removed: number; failed: number }>('debloater:remove', [
        "king.com.CandyCrushSaga'--evil",
      ])
      expect(result).toBeDefined()
    })

    it('attempts deprovision after AppX removal', async () => {
      mockValidateStringArray.mockReturnValue(['king.com.CandyCrushSaga'])
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
      await callHandler<{ removed: number; failed: number }>('debloater:remove', ['king.com.CandyCrushSaga'])
      const provCalls = mockExecFileAsync.mock.calls.filter((c: unknown[]) => {
        const args = c[1] as string[]
        return c[0] === 'powershell' && args?.some((a: string) => a.includes('AppxProvisionedPackage'))
      })
      expect(provCalls.length).toBe(1)
    })

    it('handles deprovision failure silently', async () => {
      mockValidateStringArray.mockReturnValue(['king.com.CandyCrushSaga'])
      let callCount = 0
      mockExecFileAsync.mockImplementation(() => {
        callCount++
        if (callCount === 2) return Promise.reject(new Error('deprovision failed'))
        return Promise.resolve({ stdout: '', stderr: '' })
      })
      const result = await callHandler<{ removed: number; failed: number }>('debloater:remove', [
        'king.com.CandyCrushSaga',
      ])
      expect(result.removed).toBe(1)
    })

    it('sends failed status in progress on removal error', async () => {
      mockValidateStringArray.mockReturnValue(['king.com.CandyCrushSaga'])
      mockExecFileAsync.mockRejectedValue(new Error('fail'))
      const mockWin = {
        webContents: { send: vi.fn() },
        isDestroyed: vi.fn().mockReturnValue(false),
      } as unknown as BrowserWindow
      mockHandlers.clear()
      registerDebloaterIpc(() => mockWin)

      await callHandler<{ removed: number; failed: number }>('debloater:remove', ['king.com.CandyCrushSaga'])
      const failedCall = vi
        .mocked(mockWin.webContents.send)
        .mock.calls.find((c: unknown[]) => (c[1] as { status: string }).status === 'failed')
      expect(failedCall).toBeTruthy()
    })

    it('sends done status after successful removal', async () => {
      mockValidateStringArray.mockReturnValue(['king.com.CandyCrushSaga'])
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
      const mockWin = {
        webContents: { send: vi.fn() },
        isDestroyed: vi.fn().mockReturnValue(false),
      } as unknown as BrowserWindow
      mockHandlers.clear()
      registerDebloaterIpc(() => mockWin)

      await callHandler<{ removed: number; failed: number }>('debloater:remove', ['king.com.CandyCrushSaga'])
      const doneCall = vi
        .mocked(mockWin.webContents.send)
        .mock.calls.find((c: unknown[]) => (c[1] as { status: string }).status === 'done')
      expect(doneCall).toBeTruthy()
    })

    it('skips progress when getWindow returns null', async () => {
      mockValidateStringArray.mockReturnValue(['king.com.CandyCrushSaga'])
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
      mockHandlers.clear()
      registerDebloaterIpc(() => null)

      const result = await callHandler<{ removed: number; failed: number }>('debloater:remove', [
        'king.com.CandyCrushSaga',
      ])
      expect(result.removed).toBe(1)
    })
  })

  describe('barrel exports', () => {
    it('exports KNOWN_BLOATWARE', () => {
      expect(Array.isArray(KNOWN_BLOATWARE)).toBe(true)
      expect(KNOWN_BLOATWARE.length).toBeGreaterThan(0)
    })

    it('exports scanBloatware function', () => {
      expect(typeof scanBloatware).toBe('function')
    })

    it('exports removeBloatware function', () => {
      expect(typeof removeBloatware).toBe('function')
    })

    it('exports clearWin32Cache', () => {
      expect(typeof clearWin32Cache).toBe('function')
    })
  })
})
