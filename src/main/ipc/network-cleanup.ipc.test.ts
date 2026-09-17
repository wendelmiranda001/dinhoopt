import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  randomUUID: vi.fn(() => 'mock-uuid'),
  ipcHandle: vi.fn(),
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },

  execFileAsync: vi.fn<(...args: unknown[]) => Promise<{ stdout: string; stderr: string }>>(() =>
    Promise.resolve({ stdout: '', stderr: '' }),
  ),
  execNativeUtf8: vi.fn<(...args: unknown[]) => Promise<{ stdout: string; stderr: string }>>(() =>
    Promise.resolve({ stdout: '', stderr: '' }),
  ),
  psUtf8: vi.fn<(...args: unknown[]) => string>(
    (...args: unknown[]) => `[Console]::OutputEncoding = ...; ${String(args[0] ?? '')}`,
  ),

  validateStringArray: vi.fn(),

  getDnsCacheEntries: vi.fn<(...args: unknown[]) => Promise<Array<{ domain: string; resolvedAddress: string }>>>(() =>
    Promise.resolve([]),
  ),
  flushDnsCache: vi.fn<(...args: unknown[]) => Promise<boolean>>(() => Promise.resolve(true)),
  getWifiProfiles: vi.fn<(...args: unknown[]) => Promise<Array<{ name: string; security: string }>>>(() =>
    Promise.resolve([]),
  ),
  deleteWifiProfile: vi.fn<(...args: unknown[]) => Promise<boolean>>(() => Promise.resolve(true)),
  clearArpCache: vi.fn<(...args: unknown[]) => Promise<boolean>>(() => Promise.resolve(true)),
}))

function buildPlatformMock() {
  return {
    platform: 'win32' as const,
    network: {
      getDnsCacheEntries: mocks.getDnsCacheEntries,
      flushDnsCache: mocks.flushDnsCache,
      getWifiProfiles: mocks.getWifiProfiles,
      deleteWifiProfile: mocks.deleteWifiProfile,
      clearArpCache: mocks.clearArpCache,
    },
  }
}

vi.mock('node:crypto', () => ({
  randomUUID: () => mocks.randomUUID(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

vi.mock('../services/exec-utf8', () => ({
  execFileAsync: (...args: unknown[]) => mocks.execFileAsync(...args),
  execNativeUtf8: (...args: unknown[]) => mocks.execNativeUtf8(...args),
  psUtf8: (...args: unknown[]) => mocks.psUtf8(...args),
}))

vi.mock('../services/ipc-validation', () => ({
  validateStringArray: (...args: unknown[]) => mocks.validateStringArray(...args),
}))

vi.mock('../platform', () => ({
  getPlatform: () => buildPlatformMock(),
}))

import { IPC } from '@shared/channels'
import type { NetworkItem } from '@shared/types'
import { cleanNetworkItems, registerNetworkCleanupIpc, scanNetwork } from './network-cleanup.ipc'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mocks.ipcHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

const REG_HISTORY_STDOUT = [
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\NetworkList\\Profiles\\{AABBCCDD-1122-3344-5566-778899AABBCC}',
  '    ProfileName    REG_SZ    My Home Network',
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\NetworkList\\Profiles\\{11223344-5566-7788-99AA-BBCCDDEEFF00}',
  '    ProfileName    REG_SZ    Office WiFi',
  '',
].join('\n')

beforeEach(() => {
  vi.clearAllMocks()
})

// ────────────────────────────────────────────
//  scanNetwork
// ────────────────────────────────────────────

describe('scanNetwork', () => {
  beforeEach(() => {
    mocks.getDnsCacheEntries.mockReset()
    mocks.flushDnsCache.mockReset()
    mocks.getWifiProfiles.mockReset()
    mocks.deleteWifiProfile.mockReset()
    mocks.clearArpCache.mockReset()
    mocks.execFileAsync.mockReset()
    mocks.execNativeUtf8.mockReset()
  })

  it('returns all item types when data is present', async () => {
    mocks.getDnsCacheEntries.mockResolvedValue([{ domain: 'example.com', resolvedAddress: '1.2.3.4' }])
    mocks.getWifiProfiles.mockResolvedValue([
      { name: 'HomeWiFi', security: 'WPA2' },
      { name: 'Office', security: 'WPA3' },
    ])
    mocks.execFileAsync.mockResolvedValue({ stdout: '192.168.1.1 aa-bb-cc-dd-ee-ff dynamic\n', stderr: '' })
    mocks.execNativeUtf8.mockResolvedValue({ stdout: REG_HISTORY_STDOUT, stderr: '' })

    const items = await scanNetwork()

    expect(items).toHaveLength(5)
    const types = items.map((i) => i.type)
    expect(types).toContain('dns-cache')
    expect(types).toContain('wifi-profile')
    expect(types).toContain('arp-cache')
    expect(types).toContain('network-history')

    const historyItem = items.find((i) => i.type === 'network-history')!
    expect(historyItem.detail).toBe('2 saved network profiles')
    expect(historyItem.selected).toBe(false)

    expect(mocks.logger.info).toHaveBeenCalledWith('network-cleanup', 'Starting network scan...')
    expect(mocks.logger.success).toHaveBeenCalledWith('network-cleanup', expect.stringContaining('5 item(s) found'))
  })

  it('returns only DNS item when no WiFi, ARP, or history', async () => {
    mocks.getDnsCacheEntries.mockResolvedValue([{ domain: 'test.com', resolvedAddress: '5.6.7.8' }])
    mocks.getWifiProfiles.mockResolvedValue([])
    mocks.execFileAsync.mockRejectedValue(new Error('no arp'))
    mocks.execNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })

    const items = await scanNetwork()

    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('dns-cache')
  })

  it('returns empty array when nothing found', async () => {
    mocks.getDnsCacheEntries.mockResolvedValue([])
    mocks.getWifiProfiles.mockResolvedValue([])
    mocks.execFileAsync.mockRejectedValue(new Error('no arp'))
    mocks.execNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })

    const items = await scanNetwork()

    expect(items).toHaveLength(0)
  })

  it('uses Windows DNS detail string on all platforms', async () => {
    mocks.getDnsCacheEntries.mockResolvedValue([{ domain: 'a.com', resolvedAddress: '1.1.1.1' }])
    mocks.getWifiProfiles.mockResolvedValue([])
    mocks.execFileAsync.mockRejectedValue(new Error('no arp'))
    mocks.execNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })

    const items = await scanNetwork()
    expect(items.find((i) => i.type === 'dns-cache')!.detail).toBe(
      '1 cached entries — flushing forces fresh DNS lookups',
    )
  })

  it('falls back to PowerShell for DNS count on Windows when getDnsCacheEntries is empty', async () => {
    mocks.getDnsCacheEntries.mockResolvedValue([])
    mocks.execFileAsync.mockResolvedValue({ stdout: '3', stderr: '' })
    mocks.getWifiProfiles.mockResolvedValue([])
    mocks.execNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })

    const items = await scanNetwork()

    expect(mocks.execFileAsync).toHaveBeenCalledWith(
      'powershell',
      expect.arrayContaining(['-NoProfile', '-Command', expect.any(String)]),
      expect.objectContaining({ timeout: 10000, windowsHide: true }),
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('dns-cache')
  })

  it('handles PowerShell DNS count failure gracefully', async () => {
    mocks.getDnsCacheEntries.mockResolvedValue([])
    mocks.execFileAsync.mockRejectedValue(new Error('PowerShell failed'))
    mocks.getWifiProfiles.mockResolvedValue([])
    mocks.execNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })

    const items = await scanNetwork()
    expect(items).toHaveLength(0)
  })

  it('handles getWifiProfiles being undefined (optional method)', async () => {
    mocks.getWifiProfiles.mockReset()
    mocks.getWifiProfiles = undefined as never
    mocks.getDnsCacheEntries.mockResolvedValue([{ domain: 'a.com', resolvedAddress: '1.1.1.1' }])
    mocks.execFileAsync.mockResolvedValue({ stdout: '192.168.1.1 aa-bb-cc-dd-ee-ff dynamic\n', stderr: '' })
    mocks.execNativeUtf8.mockResolvedValue({ stdout: REG_HISTORY_STDOUT, stderr: '' })

    const items = await scanNetwork()

    expect(items.filter((i) => i.type === 'wifi-profile')).toHaveLength(0)
    expect(items).toHaveLength(3)

    mocks.getWifiProfiles = vi.fn(() => Promise.resolve([]))
  })
})

// ────────────────────────────────────────────
//  cleanNetworkItems
// ────────────────────────────────────────────

describe('cleanNetworkItems', () => {
  beforeEach(() => {
    if (mocks.flushDnsCache && typeof mocks.flushDnsCache.mockReset === 'function') mocks.flushDnsCache.mockReset()
    if (mocks.clearArpCache && typeof mocks.clearArpCache.mockReset === 'function') mocks.clearArpCache.mockReset()
    if (mocks.getWifiProfiles && typeof mocks.getWifiProfiles.mockReset === 'function')
      mocks.getWifiProfiles.mockReset()
    if (mocks.deleteWifiProfile && typeof mocks.deleteWifiProfile.mockReset === 'function')
      mocks.deleteWifiProfile.mockReset()
    if (mocks.getDnsCacheEntries && typeof mocks.getDnsCacheEntries.mockReset === 'function')
      mocks.getDnsCacheEntries.mockReset()
    mocks.execFileAsync.mockReset()
    mocks.execNativeUtf8.mockReset()
  })

  it('returns zeros when given no items', async () => {
    const result = await cleanNetworkItems([])
    expect(result).toEqual({ cleaned: 0, failed: 0, details: [] })
  })

  it('cleans DNS cache successfully', async () => {
    mocks.flushDnsCache.mockResolvedValue(true)
    const items: NetworkItem[] = [
      { id: '1', type: 'dns-cache', label: 'DNS Resolver Cache', detail: '5 cached entries', selected: true },
    ]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.details).toContain('Flushed DNS resolver cache')
    expect(mocks.flushDnsCache).toHaveBeenCalledTimes(1)
  })

  it('handles DNS cache flush failure', async () => {
    mocks.flushDnsCache.mockResolvedValue(false)
    const items: NetworkItem[] = [
      { id: '1', type: 'dns-cache', label: 'DNS Resolver Cache', detail: '5 cached entries', selected: true },
    ]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.details).toContain('Failed to flush DNS cache')
  })

  it('handles flushDnsCache being undefined', async () => {
    mocks.flushDnsCache = undefined as never
    const items: NetworkItem[] = [
      { id: '1', type: 'dns-cache', label: 'DNS Resolver Cache', detail: '5 cached entries', selected: true },
    ]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.details).toContain('Failed to flush DNS cache')

    mocks.flushDnsCache = vi.fn(() => Promise.resolve(true))
  })

  it('cleans ARP cache successfully', async () => {
    mocks.clearArpCache.mockResolvedValue(true)
    const items: NetworkItem[] = [
      { id: '1', type: 'arp-cache', label: 'ARP Cache', detail: '3 entries', selected: true },
    ]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.details).toContain('Cleared ARP cache')
  })

  it('handles ARP cache clear failure', async () => {
    mocks.clearArpCache.mockResolvedValue(false)
    const items: NetworkItem[] = [
      { id: '1', type: 'arp-cache', label: 'ARP Cache', detail: '3 entries', selected: true },
    ]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.details).toContain('Failed to clear ARP cache')
  })

  it('handles clearArpCache being undefined', async () => {
    mocks.clearArpCache = undefined as never
    const items: NetworkItem[] = [
      { id: '1', type: 'arp-cache', label: 'ARP Cache', detail: '3 entries', selected: true },
    ]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(0)
    expect(result.failed).toBe(1)

    mocks.clearArpCache = vi.fn(() => Promise.resolve(true))
  })

  it('cleans network history on Windows', async () => {
    mocks.execNativeUtf8
      .mockResolvedValueOnce({ stdout: REG_HISTORY_STDOUT, stderr: '' })
      .mockResolvedValue({ stdout: '', stderr: '' })

    const items: NetworkItem[] = [
      {
        id: '1',
        type: 'network-history',
        label: 'Network History',
        detail: '2 saved network profiles',
        selected: false,
      },
    ]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(2)
    expect(result.details).toContain('Removed 2 network histories')
  })

  it('skips network history clean on non-Windows', async () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'darwin' })

    const items: NetworkItem[] = [
      {
        id: '1',
        type: 'network-history',
        label: 'Network History',
        detail: '2 saved network profiles',
        selected: false,
      },
    ]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(0)
    expect(result.failed).toBe(0)

    Object.defineProperty(process, 'platform', origPlatform!)
  })

  it('handles empty network history', async () => {
    mocks.execNativeUtf8
      .mockResolvedValueOnce({ stdout: REG_HISTORY_STDOUT, stderr: '' })
      .mockResolvedValue({ stdout: '', stderr: '' })

    const items: NetworkItem[] = [
      { id: '1', type: 'network-history', label: 'Network History', detail: '0 profiles', selected: false },
    ]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(2)
    expect(result.failed).toBe(0)
  })

  it('handles partial network history deletion failures', async () => {
    mocks.execNativeUtf8
      .mockResolvedValueOnce({ stdout: REG_HISTORY_STDOUT, stderr: '' })
      .mockResolvedValueOnce({ stdout: '...', stderr: '' })
      .mockRejectedValueOnce(new Error('access denied'))

    const items: NetworkItem[] = [
      {
        id: '1',
        type: 'network-history',
        label: 'Network History',
        detail: '2 saved network profiles',
        selected: false,
      },
    ]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.details).toContain('Removed 1 network history')
  })

  it('cleans WiFi profiles successfully', async () => {
    mocks.deleteWifiProfile.mockResolvedValue(true)
    const items: NetworkItem[] = [
      { id: '1', type: 'wifi-profile', label: 'HomeWiFi', detail: 'WPA2', selected: false },
      { id: '2', type: 'wifi-profile', label: 'Office', detail: 'WPA3', selected: false },
    ]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(2)
    expect(result.failed).toBe(0)
    expect(result.details).toContain('Removed Wi-Fi profile: HomeWiFi')
    expect(result.details).toContain('Removed Wi-Fi profile: Office')
    expect(mocks.deleteWifiProfile).toHaveBeenCalledTimes(2)
  })

  it('handles WiFi profile deletion failure', async () => {
    mocks.deleteWifiProfile.mockResolvedValue(false)
    const items: NetworkItem[] = [{ id: '1', type: 'wifi-profile', label: 'BadWiFi', detail: 'WEP', selected: false }]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.details).toContain('Failed to remove Wi-Fi profile: BadWiFi')
  })

  it('skips WiFi profiles with invalid labels (control chars)', async () => {
    const items: NetworkItem[] = [
      { id: '1', type: 'wifi-profile', label: 'evil\x00network', detail: 'WPA2', selected: false },
    ]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.details[0]).toContain('evil')
    expect(mocks.deleteWifiProfile).not.toHaveBeenCalled()
  })

  it('skips WiFi profiles with empty label', async () => {
    const items: NetworkItem[] = [{ id: '1', type: 'wifi-profile', label: '', detail: 'WPA2', selected: false }]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(0)
    expect(result.failed).toBe(1)
    expect(mocks.deleteWifiProfile).not.toHaveBeenCalled()
  })

  it('skips WiFi profiles with double-quote injection', async () => {
    const items: NetworkItem[] = [
      { id: '1', type: 'wifi-profile', label: 'evil"network', detail: 'WPA2', selected: false },
    ]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(0)
    expect(result.failed).toBe(1)
    expect(mocks.deleteWifiProfile).not.toHaveBeenCalled()
  })

  it('handles deleteWifiProfile being undefined', async () => {
    mocks.deleteWifiProfile = undefined as never
    const items: NetworkItem[] = [{ id: '1', type: 'wifi-profile', label: 'HomeWiFi', detail: 'WPA2', selected: false }]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(0)
    expect(result.failed).toBe(1)

    mocks.deleteWifiProfile = vi.fn(() => Promise.resolve(true))
  })

  it('handles rejected promise from WiFi profile deletion', async () => {
    mocks.deleteWifiProfile.mockRejectedValue(new Error('unexpected error'))
    const items: NetworkItem[] = [{ id: '1', type: 'wifi-profile', label: 'HomeWiFi', detail: 'WPA2', selected: false }]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('handles unexpected exception from platform method in non-WiFi items', async () => {
    mocks.flushDnsCache.mockRejectedValue(new Error('unexpected crash'))
    const items: NetworkItem[] = [
      { id: '1', type: 'dns-cache', label: 'DNS Resolver Cache', detail: '5 entries', selected: true },
    ]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.details).toContain('Failed to clean: DNS Resolver Cache')
  })

  it('logs error when some items fail', async () => {
    mocks.flushDnsCache.mockResolvedValue(true)
    mocks.clearArpCache.mockResolvedValue(false)
    const items: NetworkItem[] = [
      { id: '1', type: 'dns-cache', label: 'DNS', detail: '5 entries', selected: true },
      { id: '2', type: 'arp-cache', label: 'ARP', detail: '3 entries', selected: true },
    ]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(1)
    expect(result.failed).toBe(1)
    expect(mocks.logger.error).toHaveBeenCalled()
  })

  it('logs success when all items clean without failures', async () => {
    mocks.flushDnsCache.mockResolvedValue(true)
    const items: NetworkItem[] = [{ id: '1', type: 'dns-cache', label: 'DNS', detail: '5 entries', selected: true }]

    await cleanNetworkItems(items)
    expect(mocks.logger.success).toHaveBeenCalledWith('network-cleanup', expect.stringContaining('1 cleaned'))
  })

  it('processes mixed item types: DNS + WiFi + ARP + history', async () => {
    const singleHistoryStdout = [
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\NetworkList\\Profiles\\{AABBCCDD-1122-3344-5566-778899AABBCC}',
      '    ProfileName    REG_SZ    My Home Network',
      '',
    ].join('\n')

    mocks.flushDnsCache.mockResolvedValue(true)
    mocks.clearArpCache.mockResolvedValue(true)
    mocks.deleteWifiProfile.mockResolvedValue(true)
    mocks.execNativeUtf8
      .mockResolvedValueOnce({ stdout: singleHistoryStdout, stderr: '' })
      .mockResolvedValue({ stdout: '', stderr: '' })

    const items: NetworkItem[] = [
      { id: '1', type: 'dns-cache', label: 'DNS', detail: '', selected: true },
      { id: '2', type: 'arp-cache', label: 'ARP', detail: '', selected: true },
      { id: '3', type: 'wifi-profile', label: 'WiFi', detail: '', selected: false },
      { id: '4', type: 'network-history', label: 'History', detail: '', selected: false },
    ]

    const result = await cleanNetworkItems(items)
    expect(result.cleaned).toBe(4)
    expect(result.failed).toBe(0)
  })
})

// ────────────────────────────────────────────
//  registerNetworkCleanupIpc
// ────────────────────────────────────────────

const mockGetWindow = () => null

describe('registerNetworkCleanupIpc', () => {
  beforeEach(() => {
    mocks.getDnsCacheEntries.mockReset()
    mocks.flushDnsCache.mockReset()
    mocks.getWifiProfiles.mockReset()
    mocks.deleteWifiProfile.mockReset()
    mocks.clearArpCache.mockReset()
    mocks.execFileAsync.mockReset()
    mocks.execNativeUtf8.mockReset()
    vi.clearAllMocks()
  })

  it('registers NETWORK_SCAN and NETWORK_CLEAN handlers', () => {
    registerNetworkCleanupIpc(mockGetWindow)
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain(IPC.NETWORK_SCAN)
    expect(channels).toContain(IPC.NETWORK_CLEAN)
    expect(channels).toHaveLength(2)
  })

  describe('NETWORK_SCAN handler', () => {
    it('returns scan results from scanNetwork', async () => {
      mocks.getDnsCacheEntries.mockResolvedValue([{ domain: 'example.com', resolvedAddress: '1.2.3.4' }])
      mocks.getWifiProfiles.mockResolvedValue([])
      mocks.execFileAsync.mockRejectedValue(new Error('no arp'))
      mocks.execNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })

      registerNetworkCleanupIpc(mockGetWindow)
      const handler = getHandler(IPC.NETWORK_SCAN) as () => Promise<NetworkItem[]>
      const items = await handler()

      expect(items).toHaveLength(1)
      expect(items[0]!.type).toBe('dns-cache')
    })
  })

  describe('NETWORK_CLEAN handler', () => {
    it('rejects invalid item IDs and returns empty result', async () => {
      mocks.validateStringArray.mockReturnValue(null)

      registerNetworkCleanupIpc(mockGetWindow)
      const handler = getHandler(IPC.NETWORK_CLEAN) as (
        _event: unknown,
        itemIds: string[],
      ) => Promise<{ cleaned: number; failed: number; details: string[] }>
      const result = await handler({}, ['invalid'])

      expect(result).toEqual({ cleaned: 0, failed: 0, details: [] })
      expect(mocks.logger.warning).toHaveBeenCalledWith(
        'network-cleanup',
        'Invalid item IDs received for network clean',
      )
    })

    it('returns empty result when item IDs not found in any session', async () => {
      mocks.validateStringArray.mockReturnValue(['nonexistent-id'])
      mocks.getDnsCacheEntries.mockResolvedValue([])
      mocks.getWifiProfiles.mockResolvedValue([])
      mocks.execFileAsync.mockRejectedValue(new Error('no arp'))
      mocks.execNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })

      registerNetworkCleanupIpc(mockGetWindow)
      const scanHandler = getHandler(IPC.NETWORK_SCAN) as () => Promise<NetworkItem[]>
      await scanHandler()

      const cleanHandler = getHandler(IPC.NETWORK_CLEAN) as (
        _event: unknown,
        itemIds: string[],
      ) => Promise<{ cleaned: number; failed: number; details: string[] }>
      const result = await cleanHandler({}, ['nonexistent-id'])

      expect(result.cleaned).toBe(0)
      expect(result.failed).toBe(0)
    })

    it('cleans items from scan sessions', async () => {
      mocks.validateStringArray.mockReturnValue(['mock-uuid'])
      mocks.getDnsCacheEntries.mockResolvedValue([{ domain: 'example.com', resolvedAddress: '1.2.3.4' }])
      mocks.getWifiProfiles.mockResolvedValue([])
      mocks.execFileAsync.mockRejectedValue(new Error('no arp'))
      mocks.execNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
      mocks.flushDnsCache.mockResolvedValue(true)

      registerNetworkCleanupIpc(mockGetWindow)
      const scanHandler = getHandler(IPC.NETWORK_SCAN) as () => Promise<NetworkItem[]>
      await scanHandler()

      const cleanHandler = getHandler(IPC.NETWORK_CLEAN) as (
        _event: unknown,
        itemIds: string[],
      ) => Promise<{ cleaned: number; failed: number; details: string[] }>
      const result = await cleanHandler({}, ['mock-uuid'])

      expect(result.cleaned).toBe(1)
      expect(result.failed).toBe(0)
      expect(mocks.logger.success).toHaveBeenCalledWith('network-cleanup', expect.stringContaining('1 cleaned'))
    })
  })
})
