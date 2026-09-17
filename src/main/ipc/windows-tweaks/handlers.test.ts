import type { WindowsTweakState } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExecFileAsync = vi.fn()
const mockPsUtf8 = vi.fn((s: string) => s)
const mockLoggerInfo = vi.fn()
const mockLoggerWarning = vi.fn()
const mockLoggerError = vi.fn()
const mockLoggerSuccess = vi.fn()
const mockGetLogger = vi.fn(() => ({
  info: mockLoggerInfo,
  warning: mockLoggerWarning,
  error: mockLoggerError,
  success: mockLoggerSuccess,
}))
const mockIsAdmin = vi.fn()
const mockIpcMainHandle = vi.fn()

vi.mock('../../services/exec-utf8', () => ({
  execFileAsync: (...args: unknown[]) => mockExecFileAsync(...args),
  psUtf8: (s: string) => mockPsUtf8(s),
}))

vi.mock('../../services/logger.service', () => ({
  getLogger: () => mockGetLogger(),
}))

vi.mock('../../services/elevation', () => ({
  isAdmin: (...args: unknown[]) => mockIsAdmin(...args),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: unknown[]) => mockIpcMainHandle(...args),
  },
}))

vi.mock('./tweaks/visual', () => ({
  VISUAL_TWEAKS: [
    {
      id: 'sticky-keys-off',
      name: 'Sticky Keys OFF',
      description: 'd',
      category: 'accessibility',
      level: 'medio',
      hive: 'HKEY_CURRENT_USER' as const,
      path: 'Control Panel\\Accessibility\\StickyKeys',
      key: 'Flags',
      kind: 'String' as const,
      defaultValue: '510',
      optimizedValue: '506',
    },
    {
      id: 'test-interface',
      name: 'Test Interface',
      description: 'd',
      category: 'network',
      level: 'basico',
      hive: 'HKEY_LOCAL_MACHINE' as const,
      path: 'SYSTEM\\CurrentControlSet\\Control\\Class\\{4D36E972}\\Interfaces',
      key: '*IfType',
      kind: 'DWord' as const,
      defaultValue: 6,
      optimizedValue: 1,
    },
  ],
  registerVisualTweaks: vi.fn(),
}))

vi.mock('./tweaks/network', () => ({
  NETWORK_TWEAKS: [
    {
      id: 'tcp-no-delay',
      name: 'TCP No Delay',
      description: 'd',
      category: 'network',
      level: 'basico',
      hive: 'HKEY_LOCAL_MACHINE' as const,
      path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
      key: 'TcpNoDelay',
      kind: 'DWord' as const,
      defaultValue: 0,
      optimizedValue: 1,
    },
  ],
  registerNetworkTweaks: vi.fn(),
}))

vi.mock('./tweaks/performance', () => ({
  PERFORMANCE_TWEAKS: [
    {
      id: 'pcie-aspm-off',
      name: 'PCIe ASPM Off',
      description: 'd',
      category: 'energy',
      level: 'basico',
      hive: 'HKEY_LOCAL_MACHINE' as const,
      path: 'SYSTEM\\CurrentControlSet\\Control\\Power',
      key: 'CsEnabled',
      kind: 'DWord' as const,
      defaultValue: 0,
      optimizedValue: 0,
    },
    {
      id: 'ntfs-last-access-off',
      name: 'NTFS Last Access Off',
      description: 'd',
      category: 'system',
      level: 'medio',
      hive: 'HKEY_LOCAL_MACHINE' as const,
      path: 'SYSTEM\\CurrentControlSet\\Control\\FileSystem',
      key: 'NtfsDisableLastAccessUpdate',
      kind: 'DWord' as const,
      defaultValue: 0,
      optimizedValue: 80000001,
      needsReboot: true,
    },
    {
      id: 'processor-min-max',
      name: 'Proc Min Max',
      description: 'd',
      category: 'performance',
      level: 'basico',
      hive: 'HKEY_LOCAL_MACHINE' as const,
      path: 'SYSTEM\\ControlSet001\\Control\\Power',
      key: 'ProcessorPerformance',
      kind: 'DWord' as const,
      defaultValue: 5,
      optimizedValue: 100,
    },
  ],
  registerPerformanceTweaks: vi.fn(),
}))

vi.mock('./tweaks/security', () => ({
  SECURITY_TWEAKS: [
    {
      id: 'gamedvr-pm',
      name: 'GameDVR Policy',
      description: 'd',
      category: 'gaming',
      level: 'basico',
      hive: 'HKEY_LOCAL_MACHINE' as const,
      path: 'SOFTWARE\\Microsoft\\PolicyManager\\default\\ApplicationManagement\\AllowGameDVR',
      key: 'value',
      kind: 'DWord' as const,
      defaultValue: 1,
      optimizedValue: 0,
    },
  ],
  registerSecurityTweaks: vi.fn(),
}))

vi.mock('./tweaks/context-menu', () => ({
  CONTEXT_MENU_TWEAKS: [],
  registerContextMenuTweaks: vi.fn(),
}))

vi.mock('./tweaks/system', () => ({
  SYSTEM_TWEAKS: [],
  registerSystemTweaks: vi.fn(),
}))

vi.mock('./tweaks/gaming', () => ({
  registerGamingTweaks: vi.fn(),
}))

describe('handlers.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAdmin.mockReturnValue(true)
  })

  describe('getCatalog', () => {
    it('returns the merged tweak catalog', async () => {
      const { getCatalog } = await import('./handlers')
      const catalog = getCatalog()
      expect(catalog.length).toBeGreaterThanOrEqual(4)
      expect(catalog.map((t) => t.id)).toContain('sticky-keys-off')
      expect(catalog.map((t) => t.id)).toContain('tcp-no-delay')
      expect(catalog.map((t) => t.id)).toContain('pcie-aspm-off')
      expect(catalog.map((t) => t.id)).toContain('gamedvr-pm')
    })
  })

  describe('getCatalogByCategory', () => {
    it('filters by category', async () => {
      const { getCatalogByCategory } = await import('./handlers')
      const result = getCatalogByCategory('network')
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result.some((t) => t.id === 'tcp-no-delay')).toBe(true)
    })

    it('returns empty for unknown category', async () => {
      const { getCatalogByCategory } = await import('./handlers')
      const result = getCatalogByCategory('nonexistent' as never)
      expect(result).toHaveLength(0)
    })
  })

  describe('REG_TYPE_RE', () => {
    it('matches REG_DWORD lines', async () => {
      const { REG_TYPE_RE } = await import('./handlers')
      const match = '    TcpNoDelay    REG_DWORD    0x1'.match(REG_TYPE_RE)
      expect(match).toBeTruthy()
      expect(match![1]).toBe('REG_DWORD')
      expect(match![2]).toBe('0x1')
    })

    it('matches REG_SZ lines', async () => {
      const { REG_TYPE_RE } = await import('./handlers')
      const match = '    Flags    REG_SZ    506'.match(REG_TYPE_RE)
      expect(match).toBeTruthy()
      expect(match![1]).toBe('REG_SZ')
      expect(match![2]).toBe('506')
    })
  })

  describe('registerWindowsTweaksIpc', () => {
    it('registers 4 IPC handlers', async () => {
      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())
      const channels = mockIpcMainHandle.mock.calls.map((c) => c[0])
      expect(channels).toContain('windows-tweaks:list')
      expect(channels).toContain('windows-tweaks:apply')
      expect(channels).toContain('windows-tweaks:revert')
      expect(channels).toContain('windows-tweaks:status')
      expect(mockIpcMainHandle).toHaveBeenCalledTimes(4)
    })

    it('calls sub-register functions', async () => {
      const { registerWindowsTweaksIpc } = await import('./handlers')
      const visual = await import('./tweaks/visual')
      const network = await import('./tweaks/network')
      const perf = await import('./tweaks/performance')
      const sec = await import('./tweaks/security')
      const cm = await import('./tweaks/context-menu')
      const sys = await import('./tweaks/system')
      const gam = await import('./tweaks/gaming')
      registerWindowsTweaksIpc(vi.fn())
      expect(visual.registerVisualTweaks).toHaveBeenCalled()
      expect(network.registerNetworkTweaks).toHaveBeenCalled()
      expect(perf.registerPerformanceTweaks).toHaveBeenCalled()
      expect(sec.registerSecurityTweaks).toHaveBeenCalled()
      expect(cm.registerContextMenuTweaks).toHaveBeenCalled()
      expect(sys.registerSystemTweaks).toHaveBeenCalled()
      expect(gam.registerGamingTweaks).toHaveBeenCalled()
    })
  })

  describe('WINDOWS_TWEAKS_LIST handler', () => {
    it('lists tweak statuses (all false when reg query fails)', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('not found'))

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const listHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:list')![1]
      const result = await listHandler()
      expect(result).toBeInstanceOf(Array)
      expect(result.length).toBeGreaterThanOrEqual(4)
      for (const item of result) {
        expect(item).toHaveProperty('applied')
        expect(item).toHaveProperty('tweak')
        expect(typeof item.applied).toBe('boolean')
      }
    })
  })

  describe('WINDOWS_TWEAKS_APPLY handler', () => {
    it('applies HKCU DWord tweak successfully', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['sticky-keys-off'])
      expect(result.succeeded).toBe(1)
      expect(result.failed).toBe(0)
      expect(result.errors).toHaveLength(0)
    })

    it('applies HKLM DWord tweak successfully', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['tcp-no-delay'])
      expect(result.succeeded).toBe(1)
      expect(result.failed).toBe(0)
    })

    it('fails when not admin on HKLM tweak', async () => {
      mockIsAdmin.mockReturnValue(false)

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['tcp-no-delay'])
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(1)
      expect(result.errors[0].reason).toContain('administrador')
    })

    it('handles reg.exe command failure', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('Access is denied'))

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['sticky-keys-off'])
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(1)
      expect(result.errors[0].reason).toContain('administrador')
    })

    it('handles "system cannot find" reg error', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('The system cannot find the path specified'))

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['sticky-keys-off'])
      expect(result.failed).toBe(1)
      expect(result.errors[0].reason).toContain('registro')
    })

    it('handles "incorrect function" reg error', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('Incorrect function'))

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['sticky-keys-off'])
      expect(result.failed).toBe(1)
      expect(result.errors[0].reason).toContain('valor')
    })

    it('handles unknown error type', async () => {
      mockExecFileAsync.mockRejectedValue('some string error')

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['sticky-keys-off'])
      expect(result.failed).toBe(1)
      expect(result.errors[0].reason).toBe('Falha ao escrever no registro.')
    })

    it('handles Portuguese access denied error', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('accesso negado'))

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['sticky-keys-off'])
      expect(result.failed).toBe(1)
      expect(result.errors[0].reason).toContain('administrador')
    })

    it('skips unknown ids', async () => {
      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['nonexistent-tweak-id'])
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(0)
    })

    it('sends progress to window', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
      const mockWin = { webContents: { send: vi.fn() } }

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(() => mockWin as never)

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      await applyHandler(null, ['sticky-keys-off'])
      expect(mockWin.webContents.send).toHaveBeenCalledWith(
        'windows-tweaks:apply:progress',
        expect.objectContaining({ current: 1, total: 1 }),
      )
    })

    it('collects needsReboot and needsLogoff', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['ntfs-last-access-off'])
      expect(result.succeeded).toBe(1)
      expect(result.rebootRequired).toHaveLength(1)
      expect(result.rebootRequired[0].id).toBe('ntfs-last-access-off')
    })

    it('applies gamedvr-pm via policy tweak path', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['gamedvr-pm'])
      expect(result.succeeded).toBe(1)
    })

    it('applies pcie-aspm-off via powercfg path', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['pcie-aspm-off'])
      expect(result.succeeded).toBe(1)
    })

    it('runs fsutil for ntfs-last-access-off', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      await applyHandler(null, ['ntfs-last-access-off'])
      const fsutilCall = mockExecFileAsync.mock.calls.find((c) => c[0] === 'fsutil')
      expect(fsutilCall).toBeTruthy()
    })

    it('returns null window gracefully', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(() => null)

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['sticky-keys-off'])
      expect(result.succeeded).toBe(1)
    })
  })

  describe('WINDOWS_TWEAKS_REVERT handler', () => {
    it('reverts HKCU tweak successfully', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const revertHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:revert')![1]
      const result = await revertHandler(null, ['sticky-keys-off'])
      expect(result.succeeded).toBe(1)
      expect(result.failed).toBe(0)
    })

    it('reverts HKLM tweak successfully', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const revertHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:revert')![1]
      const result = await revertHandler(null, ['tcp-no-delay'])
      expect(result.succeeded).toBe(1)
    })

    it('fails when not admin on HKLM revert', async () => {
      mockIsAdmin.mockReturnValue(false)

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const revertHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:revert')![1]
      const result = await revertHandler(null, ['tcp-no-delay'])
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(1)
    })

    it('handles reg.exe revert failure', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('Access is denied'))

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const revertHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:revert')![1]
      const result = await revertHandler(null, ['sticky-keys-off'])
      expect(result.failed).toBe(1)
    })

    it('reverts gamedvr-pm via policy path', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const revertHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:revert')![1]
      const result = await revertHandler(null, ['gamedvr-pm'])
      expect(result.succeeded).toBe(1)
    })

    it('reverts pcie-aspm-off via powercfg path', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const revertHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:revert')![1]
      const result = await revertHandler(null, ['pcie-aspm-off'])
      expect(result.succeeded).toBe(1)
    })

    it('runs fsutil on ntfs-last-access-off revert', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const revertHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:revert')![1]
      await revertHandler(null, ['ntfs-last-access-off'])
      const fsutilCall = mockExecFileAsync.mock.calls.find((c) => c[0] === 'fsutil')
      expect(fsutilCall).toBeTruthy()
    })

    it('sends progress to window on revert', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
      const mockWin = { webContents: { send: vi.fn() } }

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(() => mockWin as never)

      const revertHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:revert')![1]
      await revertHandler(null, ['sticky-keys-off'])
      expect(mockWin.webContents.send).toHaveBeenCalledWith(
        'windows-tweaks:revert:progress',
        expect.objectContaining({ current: 1, total: 1 }),
      )
    })

    it('collects needsReboot on revert', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const revertHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:revert')![1]
      const result = await revertHandler(null, ['ntfs-last-access-off'])
      expect(result.rebootRequired).toHaveLength(1)
    })

    it('skips unknown ids on revert', async () => {
      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const revertHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:revert')![1]
      const result = await revertHandler(null, ['nonexistent-id'])
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(0)
    })

    it('returns null window gracefully on revert', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(() => null)

      const revertHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:revert')![1]
      const result = await revertHandler(null, ['sticky-keys-off'])
      expect(result.succeeded).toBe(1)
    })
  })

  describe('WINDOWS_TWEAKS_STATUS handler', () => {
    it('returns same structure as LIST', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('no'))

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const statusHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:status')![1]
      const result = await statusHandler()
      expect(result).toBeInstanceOf(Array)
      expect(result.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('checkTweakApplied — DWord query', () => {
    it('returns true when registry value matches (hex)', async () => {
      mockExecFileAsync.mockImplementation((cmd: string) => {
        if (cmd === 'reg.exe') {
          return Promise.resolve({
            stdout: '    TcpNoDelay    REG_DWORD    0x1',
            stderr: '',
          })
        }
        return Promise.reject(new Error('no'))
      })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const listHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:list')![1]
      const result = await listHandler()
      const tcpTweak = result.find((s: WindowsTweakState) => s.tweak.id === 'tcp-no-delay')
      expect(tcpTweak?.applied).toBe(true)
    })

    it('returns true when registry value matches (decimal)', async () => {
      mockExecFileAsync.mockImplementation((cmd: string) => {
        if (cmd === 'reg.exe') {
          return Promise.resolve({
            stdout: '    Flags    REG_SZ    506',
            stderr: '',
          })
        }
        return Promise.reject(new Error('no'))
      })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const listHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:list')![1]
      const result = await listHandler()
      const stickyTweak = result.find((s: WindowsTweakState) => s.tweak.id === 'sticky-keys-off')
      expect(stickyTweak?.applied).toBe(true)
    })

    it('returns false when value does not match', async () => {
      mockExecFileAsync.mockImplementation((cmd: string) => {
        if (cmd === 'reg.exe') {
          return Promise.resolve({
            stdout: '    TcpNoDelay    REG_DWORD    0x0',
            stderr: '',
          })
        }
        return Promise.reject(new Error('no'))
      })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const listHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:list')![1]
      const result = await listHandler()
      const tcpTweak = result.find((s: WindowsTweakState) => s.tweak.id === 'tcp-no-delay')
      expect(tcpTweak?.applied).toBe(false)
    })

    it('returns false when key not found in stdout', async () => {
      mockExecFileAsync.mockImplementation((cmd: string) => {
        if (cmd === 'reg.exe') {
          return Promise.resolve({ stdout: 'some other line\n', stderr: '' })
        }
        return Promise.reject(new Error('no'))
      })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const listHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:list')![1]
      const result = await listHandler()
      const tcpTweak = result.find((s: WindowsTweakState) => s.tweak.id === 'tcp-no-delay')
      expect(tcpTweak?.applied).toBe(false)
    })

    it('returns false when no REG match in data line', async () => {
      mockExecFileAsync.mockImplementation((cmd: string) => {
        if (cmd === 'reg.exe') {
          return Promise.resolve({ stdout: '    TcpNoDelay    something\n', stderr: '' })
        }
        return Promise.reject(new Error('no'))
      })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const listHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:list')![1]
      const result = await listHandler()
      const tcpTweak = result.find((s: WindowsTweakState) => s.tweak.id === 'tcp-no-delay')
      expect(tcpTweak?.applied).toBe(false)
    })

    it('returns false on command error', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('command failed'))

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const listHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:list')![1]
      const result = await listHandler()
      for (const item of result) {
        expect(item.applied).toBe(false)
      }
    })

    it('returns false silently when reg.exe exits with code 1 (value not found)', async () => {
      mockExecFileAsync.mockRejectedValue(Object.assign(new Error('reg query exited 1'), { code: 1 }))

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const listHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:list')![1]
      const result = await listHandler()
      for (const item of result) {
        expect(item.applied).toBe(false)
      }
      expect(mockLoggerWarning).not.toHaveBeenCalled()
      expect(mockLoggerError).not.toHaveBeenCalled()
    })

    it('returns false silently when stderr reports registry key not found', async () => {
      const err = new Error('Command failed: reg.exe query ...')
      Object.assign(err, {
        code: 1,
        stderr: 'ERROR: The system was unable to find the specified registry key or value.',
      })
      mockExecFileAsync.mockRejectedValue(err)

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const listHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:list')![1]
      const result = await listHandler()
      for (const item of result) {
        expect(item.applied).toBe(false)
      }
      expect(mockLoggerWarning).not.toHaveBeenCalled()
    })

    it('logs a warning on real command failures (no exit-code-1)', async () => {
      const err = new Error('Command failed: reg.exe query ...')
      Object.assign(err, { code: 5, stderr: 'ERROR: Access is denied.' })
      mockExecFileAsync.mockRejectedValue(err)

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const listHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:list')![1]
      const result = await listHandler()
      for (const item of result) {
        expect(item.applied).toBe(false)
      }
      expect(mockLoggerWarning).toHaveBeenCalled()
    })
  })

  describe('checkPowerCfgTweak (via LIST)', () => {
    const VALID_GUID = '12345678-abcd-1234-abcd-123456789abc'

    it('returns true when powercfg query matches', async () => {
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powercfg' && args[0] === '/GETACTIVESCHEME') {
          return Promise.resolve({ stdout: `Power Scheme GUID: ${VALID_GUID}`, stderr: '' })
        }
        if (cmd === 'powercfg' && args[0] === '-query') {
          return Promise.resolve({ stdout: '    Current AC Power Setting Index: 0x0', stderr: '' })
        }
        if (cmd === 'powercfg' && args[0] === '/LIST') {
          return Promise.resolve({ stdout: VALID_GUID, stderr: '' })
        }
        return Promise.reject(new Error('no'))
      })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const listHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:list')![1]
      const result = await listHandler()
      const aspmTweak = result.find((s: WindowsTweakState) => s.tweak.id === 'pcie-aspm-off')
      expect(aspmTweak?.applied).toBe(true)
    })

    it('returns false when powercfg query fails and registry also fails', async () => {
      mockExecFileAsync.mockImplementation((cmd: string) => {
        if (cmd === 'powercfg') return Promise.reject(new Error('failed'))
        if (cmd === 'reg.exe') return Promise.reject(new Error('failed'))
        return Promise.reject(new Error('no'))
      })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const listHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:list')![1]
      const result = await listHandler()
      const aspmTweak = result.find((s: WindowsTweakState) => s.tweak.id === 'pcie-aspm-off')
      expect(aspmTweak?.applied).toBe(false)
    })

    it('falls back to registry when powercfg query returns no GUID', async () => {
      mockExecFileAsync.mockImplementation((cmd: string) => {
        if (cmd === 'powercfg') return Promise.resolve({ stdout: 'no guid here', stderr: '' })
        if (cmd === 'reg.exe') {
          return Promise.resolve({ stdout: '    Default    REG_DWORD    0x0', stderr: '' })
        }
        return Promise.reject(new Error('no'))
      })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const listHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:list')![1]
      const result = await listHandler()
      const aspmTweak = result.find((s: WindowsTweakState) => s.tweak.id === 'pcie-aspm-off')
      expect(aspmTweak?.applied).toBe(false)
    })

    it('returns false when registry fallback value does not match', async () => {
      mockExecFileAsync.mockImplementation((cmd: string) => {
        if (cmd === 'powercfg') return Promise.resolve({ stdout: 'no guid here', stderr: '' })
        if (cmd === 'reg.exe') {
          return Promise.resolve({ stdout: '    Default    REG_DWORD    0xFF', stderr: '' })
        }
        return Promise.reject(new Error('no'))
      })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const listHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:list')![1]
      const result = await listHandler()
      const aspmTweak = result.find((s: WindowsTweakState) => s.tweak.id === 'pcie-aspm-off')
      expect(aspmTweak?.applied).toBe(false)
    })
  })

  describe('applyPowerCfgTweak (via APPLY)', () => {
    const VALID_GUID = '12345678-abcd-1234-abcd-123456789abc'

    it('handles powercfg setacvalueindex failure gracefully', async () => {
      let callCount = 0
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powercfg' && args[0] === '/LIST') {
          return Promise.resolve({ stdout: VALID_GUID, stderr: '' })
        }
        if (cmd === 'powercfg' && args[0] === '/GETACTIVESCHEME') {
          return Promise.resolve({ stdout: `Power Scheme GUID: ${VALID_GUID}`, stderr: '' })
        }
        if (cmd === 'powercfg' && args[0] === '-setacvalueindex') {
          callCount++
          return Promise.reject(new Error('set failed'))
        }
        return Promise.resolve({ stdout: '', stderr: '' })
      })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['pcie-aspm-off'])
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(1)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(callCount).toBeGreaterThan(0)
    })

    it('handles powercfg setdcvalueindex failure gracefully', async () => {
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powercfg' && args[0] === '/LIST') {
          return Promise.resolve({ stdout: VALID_GUID, stderr: '' })
        }
        if (cmd === 'powercfg' && args[0] === '/GETACTIVESCHEME') {
          return Promise.resolve({ stdout: `Power Scheme GUID: ${VALID_GUID}`, stderr: '' })
        }
        if (cmd === 'powercfg' && args[0] === '-setdcvalueindex') {
          return Promise.reject(new Error('dc failed'))
        }
        return Promise.resolve({ stdout: '', stderr: '' })
      })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['pcie-aspm-off'])
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(1)
    })

    it('handles reg.exe add Default failure gracefully', async () => {
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powercfg' && args[0] === '/LIST') {
          return Promise.resolve({ stdout: VALID_GUID, stderr: '' })
        }
        if (cmd === 'powercfg' && args[0] === '/GETACTIVESCHEME') {
          return Promise.resolve({ stdout: `Power Scheme GUID: ${VALID_GUID}`, stderr: '' })
        }
        if (cmd === 'reg' || cmd === 'reg.exe') {
          return Promise.reject(new Error('reg failed'))
        }
        return Promise.resolve({ stdout: '', stderr: '' })
      })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['pcie-aspm-off'])
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(1)
    })

    it('skips SETACTIVE when no active GUID found', async () => {
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powercfg' && args[0] === '/LIST') {
          return Promise.resolve({ stdout: VALID_GUID, stderr: '' })
        }
        if (cmd === 'powercfg' && args[0] === '/GETACTIVESCHEME') {
          return Promise.resolve({ stdout: 'no active scheme', stderr: '' })
        }
        return Promise.resolve({ stdout: '', stderr: '' })
      })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['pcie-aspm-off'])
      expect(result.succeeded).toBe(1)
      const setActiveCall = mockExecFileAsync.mock.calls.find((c) => c[0] === 'powercfg' && c[1][0] === '/SETACTIVE')
      expect(setActiveCall).toBeUndefined()
    })

    it('applies processor-min-max with 2 settings', async () => {
      mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'powercfg' && args[0] === '/LIST') {
          return Promise.resolve({ stdout: '12345678-abcd-1234-abcd-123456789abc', stderr: '' })
        }
        if (cmd === 'powercfg' && args[0] === '/GETACTIVESCHEME') {
          return Promise.resolve({ stdout: 'Power Scheme GUID: 12345678-abcd-1234-abcd-123456789abc', stderr: '' })
        }
        return Promise.resolve({ stdout: '', stderr: '' })
      })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['processor-min-max'])
      expect(result.succeeded).toBe(1)
      const setCalls = mockExecFileAsync.mock.calls.filter((c) => c[0] === 'powercfg' && c[1][0] === '-setacvalueindex')
      expect(setCalls.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('applyRegistryTweak — Interface path', () => {
    it('delegates to applyInterfaceTweak for Interface paths', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const applyHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:apply')![1]
      const result = await applyHandler(null, ['test-interface'])
      expect(result.succeeded).toBe(1)
      const psCall = mockExecFileAsync.mock.calls.find((c) => c[0] === 'powershell.exe')
      expect(psCall).toBeTruthy()
    })

    it('reverts Interface path via applyInterfaceTweak defaultValue', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const revertHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:revert')![1]
      const result = await revertHandler(null, ['test-interface'])
      expect(result.succeeded).toBe(1)
    })
  })

  describe('checkInterfaceTweakApplied (via LIST)', () => {
    it('returns true when all subkeys have OK', async () => {
      mockExecFileAsync.mockImplementation((cmd: string) => {
        if (cmd === 'powershell.exe') return Promise.resolve({ stdout: 'OK', stderr: '' })
        return Promise.reject(new Error('no'))
      })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const listHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:list')![1]
      const result = await listHandler()
      const found = result.find((s: WindowsTweakState) => s.tweak.id === 'test-interface')
      expect(found?.applied).toBe(true)
    })

    it('returns false when PS output does not contain OK', async () => {
      mockExecFileAsync.mockImplementation((cmd: string) => {
        if (cmd === 'powershell.exe') return Promise.resolve({ stdout: 'FAIL', stderr: '' })
        return Promise.reject(new Error('no'))
      })

      const { registerWindowsTweaksIpc } = await import('./handlers')
      registerWindowsTweaksIpc(vi.fn())

      const listHandler = mockIpcMainHandle.mock.calls.find((c) => c[0] === 'windows-tweaks:list')![1]
      const result = await listHandler()
      const found = result.find((s: WindowsTweakState) => s.tweak.id === 'test-interface')
      expect(found?.applied).toBe(false)
    })
  })
})
