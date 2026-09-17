import { describe, expect, it, vi } from 'vitest'

const mockHandlers = new Map<string, (...args: unknown[]) => unknown>()
const mockRegisterVisual = vi.fn()
const mockRegisterNetwork = vi.fn()
const mockRegisterPerformance = vi.fn()
const mockRegisterSecurity = vi.fn()
const mockRegisterContextMenu = vi.fn()
const mockRegisterSystem = vi.fn()
const mockRegisterGaming = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: unknown) => {
      mockHandlers.set(channel, handler as (...args: unknown[]) => unknown)
    }),
  },
}))

vi.mock('../../services/exec-utf8', () => ({
  execFileAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  psUtf8: vi.fn((s: string) => s),
}))

vi.mock('../../services/logger.service', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  })),
}))

vi.mock('../../services/elevation', () => ({
  isAdmin: vi.fn().mockReturnValue(true),
}))

vi.mock('./tweaks/visual', () => ({
  VISUAL_TWEAKS: [],
  registerVisualTweaks: mockRegisterVisual,
}))

vi.mock('./tweaks/network', () => ({
  NETWORK_TWEAKS: [],
  DNS_PRESETS: [{ name: 'Cloudflare', servers: ['1.1.1.1', '1.0.0.1'] }],
  registerNetworkTweaks: mockRegisterNetwork,
}))

vi.mock('./tweaks/performance', () => ({
  PERFORMANCE_TWEAKS: [],
  registerPerformanceTweaks: mockRegisterPerformance,
}))

vi.mock('./tweaks/security', () => ({
  SECURITY_TWEAKS: [],
  registerSecurityTweaks: mockRegisterSecurity,
}))

vi.mock('./tweaks/context-menu', () => ({
  CONTEXT_MENU_TWEAKS: [],
  registerContextMenuTweaks: mockRegisterContextMenu,
}))

vi.mock('./tweaks/system', () => ({
  SYSTEM_TWEAKS: [],
  registerSystemTweaks: mockRegisterSystem,
}))

vi.mock('./tweaks/gaming', () => ({
  registerGamingTweaks: mockRegisterGaming,
}))

describe('windows-tweaks/index.ts — barrel exports', () => {
  it('re-exports DNS_PRESETS from network', async () => {
    const mod = await import('./index')
    expect(mod.DNS_PRESETS).toBeDefined()
    expect(Array.isArray(mod.DNS_PRESETS)).toBe(true)
    expect(mod.DNS_PRESETS.length).toBeGreaterThan(0)
  })

  it('re-exports REG_TYPE_RE from handlers', async () => {
    const mod = await import('./index')
    expect(mod.REG_TYPE_RE).toBeInstanceOf(RegExp)
    const m = '    TcpNoDelay    REG_DWORD    0x1'.match(mod.REG_TYPE_RE)
    expect(m).toBeTruthy()
    expect(m![1]).toBe('REG_DWORD')
  })

  it('re-exports getCatalog from handlers', async () => {
    const mod = await import('./index')
    expect(typeof mod.getCatalog).toBe('function')
    const catalog = mod.getCatalog()
    expect(Array.isArray(catalog)).toBe(true)
  })

  it('re-exports getCatalogByCategory from handlers', async () => {
    const mod = await import('./index')
    expect(typeof mod.getCatalogByCategory).toBe('function')
    const result = mod.getCatalogByCategory('network')
    expect(Array.isArray(result)).toBe(true)
  })

  it('re-exports registerWindowsTweaksIpc from handlers', async () => {
    const mod = await import('./index')
    expect(typeof mod.registerWindowsTweaksIpc).toBe('function')
  })
})

describe('windows-tweaks/index.ts — registerWindowsTweaksIpc', () => {
  it('registers the expected IPC channels', async () => {
    mockHandlers.clear()
    mockRegisterVisual.mockClear()
    mockRegisterNetwork.mockClear()
    mockRegisterPerformance.mockClear()
    mockRegisterSecurity.mockClear()
    mockRegisterContextMenu.mockClear()
    mockRegisterSystem.mockClear()
    mockRegisterGaming.mockClear()

    const mod = await import('./index')
    mod.registerWindowsTweaksIpc(vi.fn())

    expect(mockHandlers.has('windows-tweaks:list')).toBe(true)
    expect(mockHandlers.has('windows-tweaks:apply')).toBe(true)
    expect(mockHandlers.has('windows-tweaks:revert')).toBe(true)
    expect(mockHandlers.has('windows-tweaks:status')).toBe(true)
  })

  it('calls all sub-register functions', async () => {
    mockRegisterVisual.mockClear()
    mockRegisterNetwork.mockClear()
    mockRegisterPerformance.mockClear()
    mockRegisterSecurity.mockClear()
    mockRegisterContextMenu.mockClear()
    mockRegisterSystem.mockClear()
    mockRegisterGaming.mockClear()

    const mod = await import('./index')
    mod.registerWindowsTweaksIpc(vi.fn())

    expect(mockRegisterVisual).toHaveBeenCalledOnce()
    expect(mockRegisterNetwork).toHaveBeenCalledOnce()
    expect(mockRegisterPerformance).toHaveBeenCalledOnce()
    expect(mockRegisterSecurity).toHaveBeenCalledOnce()
    expect(mockRegisterContextMenu).toHaveBeenCalledOnce()
    expect(mockRegisterSystem).toHaveBeenCalledOnce()
    expect(mockRegisterGaming).toHaveBeenCalledOnce()
  })

  it('passes the getWindow callback to sub-registrars', async () => {
    mockRegisterVisual.mockClear()
    const getWindow = vi.fn()

    const mod = await import('./index')
    mod.registerWindowsTweaksIpc(getWindow)

    expect(mockRegisterVisual).toHaveBeenCalledWith(getWindow)
    expect(mockRegisterNetwork).toHaveBeenCalledWith(getWindow)
  })
})
