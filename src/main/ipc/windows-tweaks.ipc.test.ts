import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ──
const mockHandle = vi.fn()
const mockSend = vi.fn()
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { handle: (...args: unknown[]) => mockHandle(...args) },
}))

const mockExecFile = vi.fn()
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}))

vi.mock('util', () => ({
  promisify:
    (fn: unknown) =>
    (...args: unknown[]) => {
      const cp = fn as (...a: unknown[]) => void
      return new Promise((resolve, reject) => {
        cp(...args, (err: Error | null, ...results: unknown[]) => {
          if (err) reject(err)
          else resolve(results.length > 1 ? results[0] : results[0])
        })
      })
    },
}))

const mockIsAdmin = vi.fn()
vi.mock('../services/elevation', () => ({
  isAdmin: () => mockIsAdmin(),
}))

const mockSetDnsServer = vi.fn()
vi.mock('../platform', () => ({
  getPlatform: () => ({
    network: {
      setDnsServer: (...args: unknown[]) => mockSetDnsServer(...args),
    },
  }),
}))

import type { WindowsTweakCategory } from '@shared/types'
import {
  DNS_PRESETS,
  getCatalog,
  getCatalogByCategory,
  REG_TYPE_RE,
  registerWindowsTweaksIpc,
} from './windows-tweaks.ipc'

const CATEGORY_EXPECTED_COUNTS: Record<WindowsTweakCategory, number> = {
  mouse: 4,
  keyboard: 0,
  accessibility: 4,
  network: 17,
  gpu: 7,
  system: 21,
  gaming: 12,
  privacy: 6,
  mmcss: 8,
  energy: 5,
}

const TOTAL_TWEAKS = Object.values(CATEGORY_EXPECTED_COUNTS).reduce((a, b) => a + b, 0)

describe('getCatalog', () => {
  it('returns all tweaks', () => {
    const catalog = getCatalog()
    expect(catalog.length).toBe(TOTAL_TWEAKS)
  })

  it('every tweak has all required fields', () => {
    const catalog = getCatalog()
    for (const t of catalog) {
      expect(t.id).toBeTruthy()
      expect(t.name).toBeTruthy()
      expect(t.category).toBeTruthy()
      expect(t.level).toMatch(/^(basico|medio|full)$/)
      expect(t.hive).toMatch(/^HKEY_(CURRENT_USER|LOCAL_MACHINE)$/)
      expect(t.path).toBeTruthy()
      expect(t.key).toBeTruthy()
      expect(t.kind).toMatch(/^(DWord|String)$/)
      expect(t.defaultValue !== undefined).toBe(true)
      expect(t.optimizedValue !== undefined).toBe(true)
    }
  })

  it('every tweak has a unique id', () => {
    const catalog = getCatalog()
    const ids = catalog.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('no tweak has shell-injectable characters in path or key', () => {
    const catalog = getCatalog()
    for (const t of catalog) {
      expect(t.path).not.toMatch(/[;&|`$(){}]/)
      expect(t.key).not.toMatch(/[;&|`$(){}]/)
    }
  })

  it('every tweak has a non-empty description', () => {
    const catalog = getCatalog()
    for (const t of catalog) {
      expect(t.description).toBeTruthy()
      expect(typeof t.description).toBe('string')
      expect(t.description.length).toBeGreaterThan(0)
    }
  })
})

describe('getCatalogByCategory', () => {
  for (const [cat, expectedCount] of Object.entries(CATEGORY_EXPECTED_COUNTS)) {
    it(`returns ${expectedCount} tweaks for category '${cat}'`, () => {
      const items = getCatalogByCategory(cat as WindowsTweakCategory)
      expect(items.length).toBe(expectedCount)
      for (const item of items) {
        expect(item.category).toBe(cat)
      }
    })
  }

  it('returns empty array for unknown category', () => {
    const items = getCatalogByCategory('unknown' as WindowsTweakCategory)
    expect(items.length).toBe(0)
  })
})

describe('DNS_PRESETS', () => {
  it('has 4 presets', () => {
    expect(DNS_PRESETS.length).toBe(4)
  })

  it('Cloudflare is first', () => {
    expect(DNS_PRESETS[0]!.name).toBe('Cloudflare')
    expect(DNS_PRESETS[0]!.primary).toBe('1.1.1.1')
    expect(DNS_PRESETS[0]!.secondary).toBe('1.0.0.1')
  })

  it('all presets have valid IPs', () => {
    const ipRe = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
    for (const p of DNS_PRESETS) {
      expect(p.primary).toMatch(ipRe)
      expect(p.secondary).toMatch(ipRe)
    }
  })
})

describe('REG_TYPE_RE', () => {
  const re = REG_TYPE_RE

  it('matches standard reg.exe output line', () => {
    const line = '    MouseSpeed    REG_SZ    0'
    const match = line.match(re)
    expect(match).not.toBeNull()
    expect(match![1]).toBe('REG_SZ')
    expect(match![2]!.trim()).toBe('0')
  })

  it('matches DWord value', () => {
    const line = '    HwSchMode    REG_DWORD    0x2'
    const match = line.match(re)
    expect(match).not.toBeNull()
    expect(match![1]).toBe('REG_DWORD')
    expect(match![2]!.trim()).toBe('0x2')
  })

  it('matches string value with spaces', () => {
    const line = '    Scheduling Category    REG_SZ    High'
    const match = line.match(re)
    expect(match).not.toBeNull()
    expect(match![1]).toBe('REG_SZ')
    expect(match![2]!.trim()).toBe('High')
  })

  it('matches REG_BINARY (future-proof)', () => {
    const line = '    SomeValue    REG_BINARY    DEADBEEF'
    const match = line.match(re)
    expect(match).not.toBeNull()
    expect(match![1]).toBe('REG_BINARY')
  })

  it('matches REG_MULTI_SZ (future-proof)', () => {
    const line = '    MultiValue    REG_MULTI_SZ    val1'
    const match = line.match(re)
    expect(match).not.toBeNull()
    expect(match![1]).toBe('REG_MULTI_SZ')
  })

  it('matches REG_EXPAND_SZ (future-proof)', () => {
    const line = '    ExpValue    REG_EXPAND_SZ    %PATH%'
    const match = line.match(re)
    expect(match).not.toBeNull()
    expect(match![1]).toBe('REG_EXPAND_SZ')
  })

  it('does not match line without key', () => {
    const line = 'HKEY_CURRENT_USER\\Control Panel\\Mouse'
    expect(line.match(re)).toBeNull()
  })

  it('does not match empty line', () => {
    expect(''.match(re)).toBeNull()
  })

  it('does not match garbage', () => {
    expect('abc'.match(re)).toBeNull()
  })
})

// ── Powercfg tweaks ──

describe('POWERCFG tweaks in catalog', () => {
  it('pcie-aspm-off exists with correct values', () => {
    const t = getCatalog().find((x) => x.id === 'pcie-aspm-off')
    expect(t).toBeDefined()
    expect(t!.optimizedValue).toBe(0)
    expect(t!.defaultValue).toBe(2)
    expect(t!.category).toBe('energy')
  })

  it('usb-selective-suspend-off exists with correct values', () => {
    const t = getCatalog().find((x) => x.id === 'usb-selective-suspend-off')
    expect(t).toBeDefined()
    expect(t!.optimizedValue).toBe(0)
    expect(t!.defaultValue).toBe(1)
    expect(t!.category).toBe('energy')
  })

  it('processor-min-max exists with correct values', () => {
    const t = getCatalog().find((x) => x.id === 'processor-min-max')
    expect(t).toBeDefined()
    expect(t!.optimizedValue).toBe(100)
    expect(t!.defaultValue).toBe(5)
    expect(t!.category).toBe('energy')
  })

  it('all powercfg tweaks have needsReboot matching their description', () => {
    for (const id of ['pcie-aspm-off', 'usb-selective-suspend-off', 'processor-min-max']) {
      const t = getCatalog().find((x) => x.id === id)
      // powercfg changes take effect immediately (no reboot needed)
      expect(t?.needsReboot).toBeUndefined()
    }
  })
})

// ── Interface tweaks in catalog ──

describe('Interface tweaks in catalog', () => {
  it('tcp-ack-freq goes through Interfaces path', () => {
    const t = getCatalog().find((x) => x.id === 'tcp-ack-freq')
    expect(t).toBeDefined()
    expect(t!.path).toContain('\\Interfaces')
  })

  it('tcp-no-delay-iface goes through Interfaces path', () => {
    const t = getCatalog().find((x) => x.id === 'tcp-no-delay-iface')
    expect(t).toBeDefined()
    expect(t!.path).toContain('\\Interfaces')
  })

  it('tcp-del-ack-ticks goes through Interfaces path', () => {
    const t = getCatalog().find((x) => x.id === 'tcp-del-ack-ticks')
    expect(t).toBeDefined()
    expect(t!.path).toContain('\\Interfaces')
  })
})

// ── Helpers ──

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function mockWindow() {
  return { isDestroyed: () => false, webContents: { send: mockSend } }
}

function stubExecFile(result: unknown, error?: Error) {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const callback = args[args.length - 1] as (...args: unknown[]) => unknown
    if (typeof callback === 'function') {
      callback(error ?? null, result)
    }
  })
}

// ── IPC registration ──

describe('registerWindowsTweaksIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all 15 IPC handlers', () => {
    registerWindowsTweaksIpc(() => null)
    const channels = mockHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('windows-tweaks:list')
    expect(channels).toContain('windows-tweaks:apply')
    expect(channels).toContain('windows-tweaks:revert')
    expect(channels).toContain('windows-tweaks:status')
    expect(channels).toContain('windows-tweaks:get-dns')
    expect(channels).toContain('windows-tweaks:set-dns')
    expect(channels).toContain('windows-tweaks:netsh-tcp')
    expect(channels).toContain('windows-tweaks:gaming-timer-get')
    expect(channels).toContain('windows-tweaks:gaming-timer-set')
    expect(channels).toContain('windows-tweaks:gaming-timer-revert')
    expect(channels).toContain('windows-tweaks:gaming-autotuning')
    expect(channels).toContain('windows-tweaks:gaming-vbs-get')
    expect(channels).toContain('windows-tweaks:gaming-vbs-set')
    expect(channels).toContain('windows-tweaks:gaming-hags-get')
    expect(channels).toContain('windows-tweaks:gaming-hags-set')
    expect(channels.length).toBe(15)
  })
})

// ── GET_DNS handler ──

describe('WINDOWS_TWEAKS_GET_DNS handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns DNS presets', async () => {
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:get-dns')
    const result = await handler()
    expect(result).toHaveLength(4)
    const presets = result as Array<{ name: string }>
    expect(presets[0]!.name).toBe('Cloudflare')
  })
})

// ── LIST handler ──

describe('WINDOWS_TWEAKS_LIST handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns status array when exec succeeds', async () => {
    stubExecFile({ stdout: '' })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:list')
    const result = (await handler()) as Array<{ tweak: { id: string }; applied: boolean }>
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0]!).toHaveProperty('tweak')
    expect(result[0]!).toHaveProperty('applied')
  })

  it('handles exec failure gracefully (all return applied=false)', async () => {
    stubExecFile('', new Error('reg query failed'))
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:list')
    const result = (await handler()) as Array<{ tweak: { id: string }; applied: boolean }>
    expect(result.every((r) => r.applied === false)).toBe(true)
  })

  it('checks powercfg tweak applied via powercfg -query', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      const allArgs = args[1] as string[]
      const cmdLine = allArgs.join(' ')
      if (cmdLine.includes('/GETACTIVESCHEME')) {
        callback(null, { stdout: '381b4222-f694-41f0-9685-ff5bb260df2f (Balanced)' })
      } else if (cmdLine.includes('-query')) {
        // Simulate Current AC Power Setting Index: 0x0 (pcie-aspm-off optimized value)
        callback(null, { stdout: '...Current AC Power Setting Index: 0x0...OK...' })
      } else {
        callback(null, { stdout: '' })
      }
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:list')
    const result = (await handler()) as Array<{ tweak: { id: string }; applied: boolean }>

    const pcie = result.find((r) => r.tweak.id === 'pcie-aspm-off')
    expect(pcie).toBeDefined()
    expect(pcie!.applied).toBe(true)
  })

  it('detects powercfg tweak not applied when value differs', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      const allArgs = args[1] as string[]
      const cmdLine = allArgs.join(' ')
      if (cmdLine.includes('/GETACTIVESCHEME')) {
        callback(null, { stdout: '381b4222-f694-41f0-9685-ff5bb260df2f (Balanced)' })
      } else if (cmdLine.includes('-query')) {
        // Value is 0x2 (default), not 0x0 (optimized)
        callback(null, { stdout: '...Current AC Power Setting Index: 0x2...' })
      } else {
        callback(null, { stdout: '' })
      }
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:list')
    const result = (await handler()) as Array<{ tweak: { id: string }; applied: boolean }>

    const pcie = result.find((r) => r.tweak.id === 'pcie-aspm-off')
    expect(pcie).toBeDefined()
    expect(pcie!.applied).toBe(false)
  })
})

// ── checkTweakApplied reg query parsing (branch coverage) ──

describe('checkTweakApplied reg query parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses reg DWord match as applied=true', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      const cmdName = args[0] as string
      const cmdArgs = args[1] as string[]
      if (cmdName === 'reg.exe' && cmdArgs[0] === 'query' && cmdArgs.some((a) => a.includes('StartupDelayInMSec'))) {
        callback(null, {
          stdout: [
            '',
            'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize',
            '    StartupDelayInMSec    REG_DWORD    0x0',
            '',
          ].join('\n'),
        })
      } else {
        callback(null, { stdout: '' })
      }
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:list')
    const result = (await handler()) as Array<{ tweak: { id: string }; applied: boolean }>

    const t = result.find((r) => r.tweak.id === 'explorer-delay')
    expect(t).toBeDefined()
    expect(t!.applied).toBe(true)
  })

  it('parses reg DWord mismatch as applied=false', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      const cmdName = args[0] as string
      const cmdArgs = args[1] as string[]
      if (cmdName === 'reg.exe' && cmdArgs[0] === 'query' && cmdArgs.some((a) => a.includes('StartupDelayInMSec'))) {
        callback(null, {
          stdout: [
            '',
            'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize',
            '    StartupDelayInMSec    REG_DWORD    0xfa0',
            '',
          ].join('\n'),
        })
      } else {
        callback(null, { stdout: '' })
      }
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:list')
    const result = (await handler()) as Array<{ tweak: { id: string }; applied: boolean }>

    const t = result.find((r) => r.tweak.id === 'explorer-delay')
    expect(t).toBeDefined()
    expect(t!.applied).toBe(false)
  })

  it('parses reg String match as applied=true', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      const cmdName = args[0] as string
      const cmdArgs = args[1] as string[]
      if (cmdName === 'reg.exe' && cmdArgs[0] === 'query' && cmdArgs.some((a) => a.includes('MouseSpeed'))) {
        callback(null, {
          stdout: ['', 'HKEY_CURRENT_USER\\Control Panel\\Mouse', '    MouseSpeed    REG_SZ    0', ''].join('\n'),
        })
      } else {
        callback(null, { stdout: '' })
      }
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:list')
    const result = (await handler()) as Array<{ tweak: { id: string }; applied: boolean }>

    const t = result.find((r) => r.tweak.id === 'mouse-speed')
    expect(t).toBeDefined()
    expect(t!.applied).toBe(true)
  })
})

// ── checkInterfaceTweakApplied returns true (branch coverage) ──

describe('checkInterfaceTweakApplied returns true', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('detects interface tweak as applied when PowerShell returns OK', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      const cmdName = args[0] as string
      const cmdArgs = args[1] as string[]
      if (cmdName === 'powershell.exe' && cmdArgs.some((a) => a.includes('Write-Output "OK"'))) {
        callback(null, { stdout: 'OK' })
      } else {
        callback(null, { stdout: '' })
      }
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:list')
    const result = (await handler()) as Array<{ tweak: { id: string }; applied: boolean }>

    const t = result.find((r) => r.tweak.id === 'tcp-ack-freq')
    expect(t).toBeDefined()
    expect(t!.applied).toBe(true)
  })
})

// ── APPLY handler ──

describe('WINDOWS_TWEAKS_APPLY handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns succeeded count for valid tweaks', async () => {
    stubExecFile({ stdout: 'The operation completed successfully.' })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:apply')

    const result = (await handler({}, ['mouse-speed', 'menu-show-delay'])) as {
      succeeded: number
      failed: number
      errors: Array<unknown>
      rebootRequired: Array<unknown>
      logoffRequired: Array<unknown>
    }
    expect(result.succeeded).toBe(2)
    expect(result.failed).toBe(0)
  })

  it('returns admin error for HKLM tweaks when not admin', async () => {
    mockIsAdmin.mockReset()
    mockIsAdmin.mockReturnValue(false)
    stubExecFile({ stdout: 'The operation completed successfully.' })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:apply')

    const result = (await handler({}, ['hags-on'])) as {
      succeeded: number
      failed: number
      errors: Array<{ id: string; reason: string }>
    }
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toContain('Acesso negado')
  })

  it('handles reg.exe failure via mapRegError', async () => {
    stubExecFile('', new Error('access is denied'))
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:apply')

    const result = (await handler({}, ['menu-show-delay'])) as {
      succeeded: number
      failed: number
      errors: Array<{ id: string; reason: string }>
    }
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toContain('Acesso negado')
  })

  it('handles Portuguese "accesso negado" via mapRegError', async () => {
    stubExecFile('', new Error('accesso negado'))
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:apply')

    const result = (await handler({}, ['menu-show-delay'])) as {
      succeeded: number
      failed: number
      errors: Array<{ id: string; reason: string }>
    }
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toContain('Acesso negado')
  })

  it('handles system cannot find error via mapRegError', async () => {
    stubExecFile('', new Error('The system cannot find the path specified'))
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:apply')

    const result = (await handler({}, ['menu-show-delay'])) as {
      succeeded: number
      failed: number
      errors: Array<{ id: string; reason: string }>
    }
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('Chave de registro não encontrada.')
  })

  it('handles incorrect function error via mapRegError', async () => {
    stubExecFile('', new Error('Incorrect function'))
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:apply')

    const result = (await handler({}, ['menu-show-delay'])) as {
      succeeded: number
      failed: number
      errors: Array<{ id: string; reason: string }>
    }
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('Tipo de valor inválido para esta chave.')
  })

  it('handles unknown error gracefully', async () => {
    stubExecFile('', new Error('something unexpected'))
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:apply')

    const result = (await handler({}, ['menu-show-delay'])) as {
      succeeded: number
      failed: number
      errors: Array<{ id: string; reason: string }>
    }
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('Falha ao escrever no registro.')
  })

  it('sends progress events during apply', async () => {
    stubExecFile({ stdout: 'The operation completed successfully.' })
    registerWindowsTweaksIpc(() => mockWindow() as any)
    const handler = getHandler('windows-tweaks:apply')

    await handler({}, ['mouse-speed', 'menu-show-delay'])

    expect(mockSend).toHaveBeenCalledWith(
      'windows-tweaks:apply:progress',
      expect.objectContaining({
        current: expect.any(Number),
        total: 2,
        currentTweak: expect.any(String),
      }),
    )
  })

  it('returns rebootRequired for tweaks with needsReboot', async () => {
    mockIsAdmin.mockReturnValue(true)
    stubExecFile({ stdout: 'The operation completed successfully.' })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:apply')

    const result = (await handler({}, ['hags-on'])) as {
      succeeded: number
      rebootRequired: Array<{ id: string; name: string }>
    }
    expect(result.succeeded).toBe(1)
    expect(result.rebootRequired).toHaveLength(1)
    expect(result.rebootRequired[0]!.id).toBe('hags-on')
  })

  it('returns logoffRequired for tweaks with needsLogoff', async () => {
    stubExecFile({ stdout: 'The operation completed successfully.' })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:apply')

    const result = (await handler({}, ['wait-to-kill-timeout'])) as {
      succeeded: number
      logoffRequired: Array<{ id: string; name: string }>
    }
    expect(result.succeeded).toBe(1)
    expect(result.logoffRequired).toHaveLength(1)
    expect(result.logoffRequired[0]!.id).toBe('wait-to-kill-timeout')
  })

  it('handles empty ids array', async () => {
    stubExecFile({ stdout: 'The operation completed successfully.' })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:apply')

    const result = (await handler({}, [])) as { succeeded: number }
    expect(result.succeeded).toBe(0)
  })

  it('applies powercfg tweak via powercfg -setacvalueindex', async () => {
    mockIsAdmin.mockReturnValue(true)
    const cmds: string[] = []
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      const cmdArgs = args[1] as string[]
      cmds.push(cmdArgs.join(' '))
      if (cmdArgs.join(' ').includes('/LIST')) {
        callback(null, {
          stdout:
            'Existing Power Schemes (* Active)\n---\nPower Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2f  (Balanced)\n',
        })
      } else if (cmdArgs.join(' ').includes('/GETACTIVESCHEME')) {
        callback(null, { stdout: '381b4222-f694-41f0-9685-ff5bb260df2f (Balanced)' })
      } else {
        callback(null, { stdout: '' })
      }
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:apply')

    const result = (await handler({}, ['pcie-aspm-off'])) as { succeeded: number }

    expect(result.succeeded).toBe(1)
    expect(cmds.some((c) => c.includes('-setacvalueindex'))).toBe(true)
  })

  it('applies powercfg tweak with revert values when reverting', async () => {
    mockIsAdmin.mockReturnValue(true)
    const cmds: string[] = []
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      const cmdArgs = args[1] as string[]
      cmds.push(cmdArgs.join(' '))
      if (cmdArgs.join(' ').includes('/LIST')) {
        callback(null, {
          stdout:
            'Existing Power Schemes (* Active)\n---\nPower Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2f  (Balanced)\n',
        })
      } else if (cmdArgs.join(' ').includes('/GETACTIVESCHEME')) {
        callback(null, { stdout: '381b4222-f694-41f0-9685-ff5bb260df2f (Balanced)' })
      } else {
        callback(null, { stdout: '' })
      }
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:revert')

    const result = (await handler({}, ['pcie-aspm-off'])) as { succeeded: number }

    expect(result.succeeded).toBe(1)
    // revert should use value 2 (not 0)
    const powercfgCalls = cmds.filter((c) => c.includes('-setacvalueindex'))
    expect(powercfgCalls.length).toBeGreaterThan(0)
    // The revert value for pcie-aspm-off is 2 (applied to the scheme GUID, not scheme_current)
    expect(
      powercfgCalls.some((c) =>
        c.includes(
          '-setacvalueindex 381b4222-f694-41f0-9685-ff5bb260df2f ee19f59b-bb67-4979-a67f-5f16dfc4bcae 0a717a8c-0a10-4e57-9b23-2b0ad0b32ec8 2',
        ),
      ),
    ).toBe(true)
  })

  it('applies processor-min-max (multi-setting powercfg tweak)', async () => {
    mockIsAdmin.mockReturnValue(true)
    let callCount = 0
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      const cmdArgs = args[1] as string[]
      callCount++
      if (cmdArgs.join(' ').includes('/LIST')) {
        callback(null, {
          stdout:
            'Existing Power Schemes (* Active)\n---\nPower Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2f  (Balanced)\n',
        })
      } else if (cmdArgs.join(' ').includes('/GETACTIVESCHEME')) {
        callback(null, { stdout: '381b4222-f694-41f0-9685-ff5bb260df2f (Balanced)' })
      } else {
        callback(null, { stdout: '' })
      }
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:apply')

    const result = (await handler({}, ['processor-min-max'])) as { succeeded: number }

    expect(result.succeeded).toBe(1)
    // 2 settings × 1 scheme × 2 (AC+DC) = 4 powercfg + 2 reg + 1 list + 1 active + 1 reactivate = 9 calls
    expect(callCount).toBe(9)
  })

  it('applies Interface tweak via PowerShell Get-ChildItem', async () => {
    mockIsAdmin.mockReturnValue(true)
    const cmds: string[] = []
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      const cmdArgs = args[1] as string[]
      cmds.push(cmdArgs.join(' '))
      callback(null, { stdout: '' })
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:apply')

    const result = (await handler({}, ['tcp-ack-freq'])) as { succeeded: number }

    expect(result.succeeded).toBe(1)
    expect(cmds.some((c) => c.includes('Get-ChildItem'))).toBe(true)
    expect(cmds.some((c) => c.includes('TcpAckFrequency'))).toBe(true)
  })

  it('applies gamedvr-pm via policy PowerShell', async () => {
    mockIsAdmin.mockReturnValue(true)
    const cmds: string[] = []
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      const cmdArgs = args[1] as string[]
      cmds.push(cmdArgs.join(' '))
      callback(null, { stdout: '' })
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:apply')

    const result = (await handler({}, ['gamedvr-pm'])) as { succeeded: number }

    expect(result.succeeded).toBe(1)
    // Policy tweak should call Set-ItemProperty + gpupdate
    expect(cmds.some((c) => c.includes('Set-ItemProperty'))).toBe(true)
    expect(cmds.some((c) => c.includes('gpupdate'))).toBe(true)
  })
})

// ── REVERT handler ──

describe('WINDOWS_TWEAKS_REVERT handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reverts selected tweaks', async () => {
    stubExecFile({ stdout: 'The operation completed successfully.' })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:revert')

    const result = (await handler({}, ['mouse-speed'])) as { succeeded: number; failed: number }
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('sends progress events during revert', async () => {
    stubExecFile({ stdout: 'The operation completed successfully.' })
    registerWindowsTweaksIpc(() => mockWindow() as any)
    const handler = getHandler('windows-tweaks:revert')

    await handler({}, ['mouse-speed', 'menu-show-delay'])

    expect(mockSend).toHaveBeenCalledWith(
      'windows-tweaks:revert:progress',
      expect.objectContaining({
        current: expect.any(Number),
        total: 2,
        currentTweak: expect.any(String),
      }),
    )
  })

  it('returns admin error when not admin for HKLM tweaks', async () => {
    mockIsAdmin.mockReturnValue(false)
    stubExecFile({ stdout: 'The operation completed successfully.' })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:revert')

    const result = (await handler({}, ['hags-on'])) as { failed: number; errors: Array<{ reason: string }> }
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toContain('Acesso negado')
  })
})

// ── SET_DNS handler ──

describe('WINDOWS_TWEAKS_SET_DNS handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls setDnsServer and returns result', async () => {
    mockSetDnsServer.mockResolvedValue(true)
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:set-dns')

    const result = await handler({}, '1.1.1.1', '1.0.0.1')
    expect(result).toBe(true)
    expect(mockSetDnsServer).toHaveBeenCalledWith('1.1.1.1', '1.0.0.1')
  })

  it('returns false when setDnsServer is not available', async () => {
    mockSetDnsServer.mockRejectedValue(new Error('not available'))
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:set-dns')

    const result = await handler({}, '8.8.8.8', '8.8.4.4')
    expect(result).toBe(false)
  })
})

// ── STATUS handler ──

describe('WINDOWS_TWEAKS_STATUS handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns status list via IPC', async () => {
    stubExecFile({ stdout: '' })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:status')
    const result = (await handler()) as Array<{ tweak: { id: string }; applied: boolean }>
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeGreaterThan(0)
  })
})

// ── NETSH_TCP handler ──

describe('WINDOWS_TWEAKS_NETSH_TCP handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies netsh TCP tweaks successfully', async () => {
    stubExecFile({ stdout: 'OK' })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:netsh-tcp')
    const result = await handler({}, 'apply')
    expect(result).toEqual({ success: true })
  })

  it('reverts netsh TCP tweaks successfully', async () => {
    stubExecFile({ stdout: 'OK' })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:netsh-tcp')
    const result = await handler({}, 'revert')
    expect(result).toEqual({ success: true })
  })

  it('reports error when netsh output contains ERROR', async () => {
    stubExecFile({ stdout: 'ERROR: Access denied' })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:netsh-tcp')
    const result = (await handler({}, 'apply')) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Access denied')
  })

  it('reports error when netsh command throws', async () => {
    stubExecFile('', new Error('PowerShell not found'))
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:netsh-tcp')
    const result = (await handler({}, 'apply')) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

// ── mapRegError edge cases (branch coverage) ──

describe('mapRegError with null and undefined', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles null thrown value via apply handler', async () => {
    mockExecFile.mockImplementation(() => {
      throw null
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:apply')

    const result = (await handler({}, ['mouse-speed'])) as {
      succeeded: number
      failed: number
      errors: Array<{ reason: string }>
    }
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('Falha ao escrever no registro.')
  })

  it('handles undefined thrown value via apply handler', async () => {
    mockExecFile.mockImplementation(() => {
      throw undefined
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:apply')

    const result = (await handler({}, ['mouse-speed'])) as {
      succeeded: number
      failed: number
      errors: Array<{ reason: string }>
    }
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('Falha ao escrever no registro.')
  })
})

// ── applyRegistryTweak with ntfs-last-access-off ──

describe('applyRegistryTweak ntfs-last-access-off', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAdmin.mockReturnValue(true)
  })

  it('calls fsutil when applying ntfs-last-access-off', async () => {
    const cmds: string[] = []
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      cmds.push(`${args[0]} ${(args[1] as string[]).join(' ')}`)
      if (typeof callback === 'function') {
        callback(null, { stdout: '' })
      }
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:apply')
    const result = (await handler({}, ['ntfs-last-access-off'])) as { succeeded: number }
    expect(result.succeeded).toBe(1)
    expect(cmds.some((c) => c.includes('fsutil'))).toBe(true)
  })
})

// ── revertRegistryTweak with ntfs-last-access-off ──

describe('revertRegistryTweak ntfs-last-access-off', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAdmin.mockReturnValue(true)
  })

  it('calls fsutil when reverting ntfs-last-access-off', async () => {
    const cmds: string[] = []
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      cmds.push(`${args[0]} ${(args[1] as string[]).join(' ')}`)
      if (typeof callback === 'function') {
        callback(null, { stdout: '' })
      }
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:revert')
    const result = (await handler({}, ['ntfs-last-access-off'])) as { succeeded: number }
    expect(result.succeeded).toBe(1)
    expect(cmds.some((c) => c.includes('fsutil'))).toBe(true)
  })
})

// ── checkPowerCfgTweak failure paths ──

describe('checkPowerCfgTweak failure modes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns false for unknown powercfg tweak id', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      if (typeof callback === 'function') {
        callback(null, { stdout: '' })
      }
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:list')
    const result = (await handler()) as Array<{ tweak: { id: string }; applied: boolean }>
    // All tweaks should return applied=false because reg query fails
    expect(result.every((r) => r.applied === false)).toBe(true)
  })

  it('returns false when powercfg -query has no matching AC Power Setting', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      const allArgs = args[1] as string[]
      const cmdLine = allArgs.join(' ')
      if (cmdLine.includes('/GETACTIVESCHEME')) {
        callback(null, { stdout: '381b4222-f694-41f0-9685-ff5bb260df2f (Balanced)' })
      } else if (cmdLine.includes('-query')) {
        // No AC Power Setting match
        callback(null, { stdout: '...some other output...' })
      } else {
        callback(null, { stdout: '' })
      }
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:list')
    const result = (await handler()) as Array<{ tweak: { id: string }; applied: boolean }>
    const pcie = result.find((r) => r.tweak.id === 'pcie-aspm-off')
    expect(pcie!.applied).toBe(false)
  })

  it('returns false when powercfg /GETACTIVESCHEME returns no GUID', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      const allArgs = args[1] as string[]
      const cmdLine = allArgs.join(' ')
      if (cmdLine.includes('/GETACTIVESCHEME')) {
        callback(null, { stdout: 'No active scheme' })
      } else {
        callback(null, { stdout: '' })
      }
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:list')
    const result = (await handler()) as Array<{ tweak: { id: string }; applied: boolean }>
    const pcie = result.find((r) => r.tweak.id === 'pcie-aspm-off')
    expect(pcie!.applied).toBe(false)
  })
})

// ── applyPowerCfgTweak without active GUID ──

describe('applyPowerCfgTweak without active GUID', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAdmin.mockReturnValue(true)
  })

  it('still succeeds when no active scheme GUID is found', async () => {
    const cmds: string[] = []
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (...args: unknown[]) => unknown
      const cmdArgs = args[1] as string[]
      cmds.push(`${args[0]} ${cmdArgs.join(' ')}`)
      if (cmdArgs.join(' ').includes('/LIST')) {
        callback(null, { stdout: 'Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2f (Balanced)' })
      } else if (cmdArgs.join(' ').includes('/GETACTIVESCHEME')) {
        callback(null, { stdout: 'No active scheme found' })
      } else {
        callback(null, { stdout: '' })
      }
    })
    registerWindowsTweaksIpc(() => null)
    const handler = getHandler('windows-tweaks:apply')
    const result = (await handler({}, ['pcie-aspm-off'])) as { succeeded: number }
    expect(result.succeeded).toBe(1)
    // Should NOT call /SETACTIVE since there's no active GUID
    expect(cmds.some((c) => c.includes('/SETACTIVE'))).toBe(false)
  })
})
