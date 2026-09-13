import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Module-level mocks ──────────────────────────────────────────
// These must be hoisted before any imports of the module under test.

const mockStat = vi.fn()
const mockReaddir = vi.fn()
const mockJoin = vi.fn((...parts: string[]) => parts.join('\\'))
const mockBasename = vi.fn((p: string) => {
  const sep = p.includes('/') ? '/' : '\\'
  return p.split(sep).filter(Boolean).pop() ?? ''
})
const mockGetDirectorySize = vi.fn()
const mockExecNativeUtf8 = vi.fn()
const mockExecFileAsync = vi.fn()
const mockPsUtf8 = vi.fn((cmd: string) => cmd)
const mockGetPlatform = vi.fn()

vi.mock('node:fs/promises', () => ({
  stat: (...args: unknown[]) => mockStat(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
}))

vi.mock('node:path', () => ({
  join: (...args: string[]) => mockJoin(...args),
  basename: (p: string) => mockBasename(p),
}))

vi.mock('node:crypto', () => ({
  randomUUID: () => 'mock-uuid-001',
}))

vi.mock('./exec-utf8', () => ({
  execFileAsync: (...args: unknown[]) => mockExecFileAsync(...args),
  execNativeUtf8: (...args: unknown[]) => mockExecNativeUtf8(...args),
  psUtf8: (cmd: string) => mockPsUtf8(cmd),
}))

vi.mock('./file-utils', () => ({
  getDirectorySize: (...args: unknown[]) => mockGetDirectorySize(...args),
}))

vi.mock('../platform', () => ({
  getPlatform: () => mockGetPlatform(),
}))

vi.mock('electron', () => ({
  BrowserWindow: class {},
}))

import { isSafeFolder } from '../constants/uninstall-safelist'
// ─── Import after mocks are set up ────────────────────────────────
import { scanForLeftovers } from './uninstall-leftovers'

// ─── Replicas of internal pure functions (not exported) ──────────
// These are safety-critical — they decide what gets flagged vs protected.

interface InstalledProgram {
  displayName: string
  publisher: string
  installLocation: string
}

function buildMatchTokens(programs: InstalledProgram[]): Set<string> {
  const tokens = new Set<string>()
  for (const prog of programs) {
    const name = prog.displayName.toLowerCase().trim()
    if (name.length >= 2) {
      tokens.add(name)
      const firstWord = name.split(/[\s\-_.()]+/)[0]
      if (firstWord && firstWord.length >= 3) tokens.add(firstWord)
      const withoutVersion = name.replace(/\s+[\d.]+\s*$/, '').trim()
      if (withoutVersion.length >= 3 && withoutVersion !== name) tokens.add(withoutVersion)
    }
    const publisher = prog.publisher.toLowerCase().trim()
    if (publisher.length >= 3) {
      tokens.add(publisher)
      const pubFirst = publisher.split(/[\s\-_.()]+/)[0]
      if (pubFirst && pubFirst.length >= 3) tokens.add(pubFirst)
    }
    if (prog.installLocation) {
      const folder = mockBasename(prog.installLocation).toLowerCase()
      if (folder.length >= 2) tokens.add(folder)
      const parent = mockBasename(mockJoin(prog.installLocation, '..'))?.toLowerCase()
      if (parent && parent.length >= 3) tokens.add(parent)
    }
  }
  return tokens
}

function matchesInstalledProgram(folderName: string, tokens: Set<string>): boolean {
  const lower = folderName.toLowerCase()
  if (tokens.has(lower)) return true
  for (const token of tokens) {
    if (token.length >= 4 && lower.length >= 4) {
      if (token.includes(lower) || lower.includes(token)) return true
    }
    if (token.length >= 4) {
      if (lower.startsWith(token) || lower.endsWith(token)) return true
    }
    if (lower.length >= 4) {
      if (token.startsWith(lower) || token.endsWith(lower)) return true
    }
  }
  return false
}

// ─── Helpers ─────────────────────────────────────────────────────

const mockWindow = {
  webContents: { send: vi.fn() },
  isDestroyed: vi.fn(() => false),
}

function makeWindowGetter(win: typeof mockWindow | null = mockWindow) {
  return () => win as unknown as Electron.BrowserWindow
}

const DEFAULT_LEFTOVER_DIRS = [
  { id: 'appdata-local', name: 'AppData Local', path: 'C:\\Users\\Test\\AppData\\Local' },
  { id: 'appdata-roaming', name: 'AppData Roaming', path: 'C:\\Users\\Test\\AppData\\Roaming' },
]

interface Dirent {
  name: string
  isDirectory: () => boolean
  isFile: () => boolean
}

function dir(name: string): Dirent {
  return { name, isDirectory: () => true, isFile: () => false }
}

function file(name: string): Dirent {
  return { name, isDirectory: () => false, isFile: () => true }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetPlatform.mockReturnValue({
    paths: { uninstallLeftoverDirs: () => DEFAULT_LEFTOVER_DIRS },
  })
  mockExecNativeUtf8.mockResolvedValue({ stdout: '', stderr: '' })
  mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
  mockPsUtf8.mockImplementation((cmd: string) => cmd)
  mockJoin.mockImplementation((...parts: string[]) => parts.join('\\'))
  mockBasename.mockImplementation((p: string) => {
    const sep = p.includes('/') ? '/' : '\\'
    return p.split(sep).filter(Boolean).pop() ?? ''
  })
  mockStat.mockRejectedValue(new Error('ENOENT'))
  mockReaddir.mockRejectedValue(new Error('ENOENT'))
  mockGetDirectorySize.mockRejectedValue(new Error('ENOENT'))
})

// ═══════════════════════════════════════════════════════════════
// isSafeFolder
// ═══════════════════════════════════════════════════════════════

describe('isSafeFolder', () => {
  it('protects Windows core folders', () => {
    expect(isSafeFolder('Microsoft')).toBe(true)
    expect(isSafeFolder('Windows')).toBe(true)
    expect(isSafeFolder('Common Files')).toBe(true)
  })

  it('protects user profile folders', () => {
    expect(isSafeFolder('Desktop')).toBe(true)
    expect(isSafeFolder('Documents')).toBe(true)
    expect(isSafeFolder('Downloads')).toBe(true)
  })

  it('protects runtime/language folders', () => {
    expect(isSafeFolder('Python')).toBe(true)
    expect(isSafeFolder('node.js')).toBe(true)
    expect(isSafeFolder('Java')).toBe(true)
    expect(isSafeFolder('Go')).toBe(true)
  })

  it('protects GPU vendor folders', () => {
    expect(isSafeFolder('NVIDIA')).toBe(true)
    expect(isSafeFolder('AMD')).toBe(true)
    expect(isSafeFolder('Intel')).toBe(true)
  })

  it('protects security software folders', () => {
    expect(isSafeFolder('Malwarebytes')).toBe(true)
    expect(isSafeFolder('CrowdStrike')).toBe(true)
    expect(isSafeFolder('Bitdefender')).toBe(true)
  })

  it('protects hidden folders (starting with dot)', () => {
    expect(isSafeFolder('.config')).toBe(true)
    expect(isSafeFolder('.local')).toBe(true)
    expect(isSafeFolder('.vscode')).toBe(true)
  })

  it('protects GUID-style folders', () => {
    expect(isSafeFolder('{12345678-1234-1234-1234-123456789abc}')).toBe(true)
  })

  it('protects prefix-matched folders', () => {
    expect(isSafeFolder('Microsoft.NET')).toBe(true)
    expect(isSafeFolder('Microsoft VisualCpp')).toBe(true)
    expect(isSafeFolder('Windows.old')).toBe(true)
    expect(isSafeFolder('Python312')).toBe(true)
    expect(isSafeFolder('jdk-21')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isSafeFolder('MICROSOFT')).toBe(true)
    expect(isSafeFolder('discord')).toBe(true)
    expect(isSafeFolder('STEAM')).toBe(true)
  })

  it('does NOT protect arbitrary unknown folders', () => {
    expect(isSafeFolder('MyOldApp')).toBe(false)
    expect(isSafeFolder('RandomSoftware2023')).toBe(false)
    expect(isSafeFolder('TotallyLegit')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════
// buildMatchTokens
// ═══════════════════════════════════════════════════════════════

describe('buildMatchTokens', () => {
  it('extracts display name as a token', () => {
    const tokens = buildMatchTokens([
      { displayName: 'Discord', publisher: 'Discord Inc', installLocation: 'C:\\Users\\Test\\AppData\\Local\\Discord' },
    ])
    expect(tokens.has('discord')).toBe(true)
  })

  it('extracts first word of display name', () => {
    const tokens = buildMatchTokens([
      { displayName: 'Visual Studio Code 1.85', publisher: 'Microsoft', installLocation: '' },
    ])
    expect(tokens.has('visual')).toBe(true)
  })

  it('strips trailing version numbers', () => {
    const tokens = buildMatchTokens([{ displayName: 'Visual Studio Code 1.85', publisher: '', installLocation: '' }])
    expect(tokens.has('visual studio code')).toBe(true)
  })

  it('does not add version-stripped token when name unchanged', () => {
    const tokens = buildMatchTokens([{ displayName: 'Discord', publisher: '', installLocation: '' }])
    // 'discord' has no version to strip, so no extra token
    expect(tokens.has('discord')).toBe(true)
    expect(tokens.size).toBe(1)
  })

  it('extracts publisher tokens', () => {
    const tokens = buildMatchTokens([{ displayName: 'Foo', publisher: 'Acme Corporation', installLocation: '' }])
    expect(tokens.has('acme corporation')).toBe(true)
    expect(tokens.has('acme')).toBe(true)
  })

  it('skips short publisher names', () => {
    const tokens = buildMatchTokens([{ displayName: 'Foo', publisher: 'AB', installLocation: '' }])
    expect(tokens.has('ab')).toBe(false)
  })

  it('extracts install folder name', () => {
    const tokens = buildMatchTokens([
      { displayName: 'Foo', publisher: '', installLocation: 'C:\\Program Files\\SuperApp' },
    ])
    expect(tokens.has('superapp')).toBe(true)
  })

  it('handles empty install location', () => {
    const tokens = buildMatchTokens([{ displayName: 'Foo', publisher: '', installLocation: '' }])
    // No crash, tokens from display name only
    expect(tokens.has('foo')).toBe(true)
  })

  it('handles displayName shorter than 2 characters', () => {
    const tokens = buildMatchTokens([{ displayName: 'X', publisher: 'Corp', installLocation: '' }])
    expect(tokens.has('x')).toBe(false)
    expect(tokens.has('corp')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
// matchesInstalledProgram
// ═══════════════════════════════════════════════════════════════

describe('matchesInstalledProgram', () => {
  const programs: InstalledProgram[] = [
    { displayName: 'Discord', publisher: 'Discord Inc', installLocation: 'C:\\Users\\Test\\AppData\\Local\\Discord' },
    {
      displayName: 'Visual Studio Code 1.85',
      publisher: 'Microsoft Corporation',
      installLocation: 'C:\\Program Files\\Microsoft VS Code',
    },
    { displayName: 'Steam', publisher: 'Valve Corporation', installLocation: 'C:\\Program Files (x86)\\Steam' },
  ]
  const tokens = buildMatchTokens(programs)

  it('exact matches installed program names', () => {
    expect(matchesInstalledProgram('Discord', tokens)).toBe(true)
  })

  it('matches folder name that contains a token', () => {
    expect(matchesInstalledProgram('DiscordPTB', tokens)).toBe(true)
  })

  it('matches when token is prefix of folder', () => {
    expect(matchesInstalledProgram('steamcmd', tokens)).toBe(true)
  })

  it('does NOT match short unrelated folders', () => {
    expect(matchesInstalledProgram('abc', tokens)).toBe(false)
  })

  it('does NOT match completely unrelated folders', () => {
    expect(matchesInstalledProgram('TotallyUnknownApp', tokens)).toBe(false)
  })

  it('matches publisher names', () => {
    expect(matchesInstalledProgram('Valve Corporation', tokens)).toBe(true)
  })

  it('matches folder that ends with a token', () => {
    expect(matchesInstalledProgram('x86 Steam', tokens)).toBe(true)
  })

  it('matches when token is short and folder is long', () => {
    const singleTokens = new Set(['discord'])
    expect(matchesInstalledProgram('discord canary', singleTokens)).toBe(true)
  })

  it('returns false for empty token set', () => {
    expect(matchesInstalledProgram('Anything', new Set())).toBe(false)
  })

  it('case insensitive matching', () => {
    expect(matchesInstalledProgram('DISCORD', tokens)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
// scanForLeftovers — Integration-level tests
// ═══════════════════════════════════════════════════════════════

describe('scanForLeftovers', () => {
  beforeEach(() => {
    // Default: registry returns no installed programs, directories exist with
    // a handful of candidate folders that pass all safety layers.
    mockReaddir.mockImplementation((_path: string, _opts?: object) => {
      const p = typeof _path === 'string' ? _path : ''
      if (p.includes('AppData\\Local')) {
        return Promise.resolve([dir('OldApp'), dir('AnotherGone'), file('some.log')] as Dirent[])
      }
      if (p.includes('AppData\\Roaming')) {
        return Promise.resolve([dir('GoneRoaming'), dir('Windows'), file('data.db')] as Dirent[])
      }
      return Promise.resolve([] as Dirent[])
    })

    // All candidate folders pass recency check (not recently modified)
    mockStat.mockImplementation((_path: string) => {
      const p = typeof _path === 'string' ? _path : ''
      // dir stat returns old timestamp
      if (p.includes('OldApp'))
        return Promise.resolve({
          mtimeMs: Date.now() - 60 * 24 * 60 * 60 * 1000,
          isDirectory: () => true,
        } as ReturnType<typeof Object>)
      if (p.includes('AnotherGone'))
        return Promise.resolve({
          mtimeMs: Date.now() - 90 * 24 * 60 * 60 * 1000,
          isDirectory: () => true,
        } as ReturnType<typeof Object>)
      if (p.includes('GoneRoaming'))
        return Promise.resolve({
          mtimeMs: Date.now() - 45 * 24 * 60 * 60 * 1000,
          isDirectory: () => true,
        } as ReturnType<typeof Object>)
      // 'Windows' is safe so it's never checked, but be safe
      return Promise.reject(new Error('ENOENT'))
    })

    // All candidates are ≥ 1 KB
    mockGetDirectorySize.mockResolvedValue(1024 * 50) // 50 KB

    // No running processes
    mockExecFileAsync.mockResolvedValue({ stdout: '' })
  })

  // ── Happy path ───────────────────────────────────────────────

  it('returns leftovers found across multiple directories', async () => {
    const results = await scanForLeftovers(makeWindowGetter())

    expect(results).toHaveLength(2)

    expect(results[0]!.category).toBe('uninstallLeftovers')
    expect(results[0]!.subcategory).toBe('AppData Local')
    expect(results[0]!.items).toHaveLength(2)
    expect(results[0]!.items[0]!.path).toContain('OldApp')
    expect(results[0]!.items[1]!.path).toContain('AnotherGone')

    expect(results[1]!.subcategory).toBe('AppData Roaming')
    expect(results[1]!.items).toHaveLength(1)
    expect(results[1]!.items[0]!.path).toContain('GoneRoaming')
  })

  it('sets selected=false on all leftover items', async () => {
    const results = await scanForLeftovers(makeWindowGetter())
    for (const result of results) {
      for (const item of result.items) {
        expect(item.selected).toBe(false)
      }
    }
  })

  it('includes size and lastModified on each item', async () => {
    const results = await scanForLeftovers(makeWindowGetter())
    const item = results[0]!.items[0]!
    expect(item.size).toBe(1024 * 50)
    expect(item.lastModified).toBeGreaterThan(0)
  })

  it('assigns a UUID to each item', async () => {
    const results = await scanForLeftovers(makeWindowGetter())
    for (const result of results) {
      for (const item of result.items) {
        expect(item.id).toBeTruthy()
      }
    }
  })

  // ── Progress events ──────────────────────────────────────────

  it('sends progress events during scan', async () => {
    const send = vi.fn()
    const win = { webContents: { send }, isDestroyed: () => false }
    await scanForLeftovers(() => win as unknown as Electron.BrowserWindow)

    // 1 initial + 2 per-directory (Local, Roaming) + 1 final = 4
    expect(send).toHaveBeenCalledTimes(4)
    expect(send).toHaveBeenNthCalledWith(1, 'scan:progress', expect.objectContaining({ progress: 5 }))
    expect(send).toHaveBeenNthCalledWith(2, 'scan:progress', expect.objectContaining({ progress: 10 }))
    expect(send).toHaveBeenNthCalledWith(4, 'scan:progress', expect.objectContaining({ progress: 100 }))
  })

  it('handles window being null (no crash)', async () => {
    await expect(scanForLeftovers(() => null as unknown as Electron.BrowserWindow)).resolves.toBeTruthy()
  })

  it('handles window being destroyed (no send)', async () => {
    const send = vi.fn()
    const win = { webContents: { send }, isDestroyed: () => true }
    const results = await scanForLeftovers(() => win as unknown as Electron.BrowserWindow)
    expect(send).not.toHaveBeenCalled()
    expect(results).toHaveLength(2)
  })

  // ── Empty / no-op scenarios ─────────────────────────────────

  it('returns empty when leftover dirs list is empty', async () => {
    mockGetPlatform.mockReturnValue({
      paths: { uninstallLeftoverDirs: () => [] },
    })
    const results = await scanForLeftovers(makeWindowGetter())
    expect(results).toHaveLength(0)
  })

  it('returns empty when every folder is safe', async () => {
    mockReaddir.mockResolvedValue([dir('Microsoft'), dir('Windows'), dir('Common Files')] as Dirent[])

    const results = await scanForLeftovers(makeWindowGetter())
    expect(results).toHaveLength(0)
  })

  it('returns empty when every folder matches an installed program', async () => {
    // Return installed programs from registry
    mockExecNativeUtf8.mockResolvedValue({
      stdout:
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\...\r\n' +
        '  DisplayName    REG_SZ    FooApp\r\n' +
        '  Publisher      REG_SZ    Foo Corp\r\n' +
        '  InstallLocation REG_SZ    C:\\Foo\r\n',
    })

    mockReaddir.mockResolvedValue([dir('FooApp'), dir('Foo')] as Dirent[])

    const results = await scanForLeftovers(makeWindowGetter())
    expect(results).toHaveLength(0)
  })

  it('skips items that are recently modified', async () => {
    // All folders are recently modified (within 30 days)
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 1 * 24 * 60 * 60 * 1000 } as ReturnType<typeof Object>)

    mockReaddir.mockResolvedValue([dir('OldApp')] as Dirent[])

    const results = await scanForLeftovers(makeWindowGetter())
    expect(results).toHaveLength(0)
  })

  it('skips items with running processes', async () => {
    // Powershell returns process path that matches the candidate
    mockExecFileAsync.mockResolvedValue({
      stdout: 'C:\\Users\\Test\\AppData\\Local\\OldApp\\some.exe',
    })

    const results = await scanForLeftovers(makeWindowGetter())
    // OldApp should be skipped due to running process
    const localResult = results.find((r) => r.subcategory === 'AppData Local')
    const oldAppItem = localResult?.items.find((i) => i.path.includes('OldApp'))
    expect(oldAppItem).toBeUndefined()
  })

  it('skips items below minimum size threshold (1 KB)', async () => {
    mockGetDirectorySize.mockResolvedValue(512) // 512 bytes — below 1024

    const results = await scanForLeftovers(makeWindowGetter())
    expect(results).toHaveLength(0)
  })

  it('skips items when getDirectorySize throws', async () => {
    mockGetDirectorySize.mockRejectedValue(new Error('Access denied'))

    const results = await scanForLeftovers(makeWindowGetter())
    expect(results).toHaveLength(0)
  })

  it('skips items when stat fails after size check', async () => {
    // Mock isRecentlyModified to return false (not recent), then fail on final stat
    let callCount = 0
    mockStat.mockImplementation((_path: string) => {
      callCount++
      const p = typeof _path === 'string' ? _path : ''
      // For recency check: return old mtime so the item proceeds
      if (p.includes('OldApp') && callCount <= 3)
        return Promise.resolve({
          mtimeMs: Date.now() - 60 * 24 * 60 * 60 * 1000,
          isDirectory: () => true,
        } as ReturnType<typeof Object>)
      // For final stat: fail
      return Promise.reject(new Error('ENOENT'))
    })

    const results = await scanForLeftovers(makeWindowGetter())
    expect(results).toHaveLength(0)
  })

  // ── Directory-level error handling ──────────────────────────

  it('skips target directory when readdir fails', async () => {
    mockReaddir.mockRejectedValue(new Error('Access denied'))
    const results = await scanForLeftovers(makeWindowGetter())
    expect(results).toHaveLength(0)
  })

  it('skips a directory if readdir succeeds but has no directories', async () => {
    mockReaddir.mockResolvedValue([file('readme.txt'), file('data.log')] as Dirent[])

    const results = await scanForLeftovers(makeWindowGetter())
    expect(results).toHaveLength(0)
  })

  it('handles registry query failure gracefully', async () => {
    mockExecNativeUtf8.mockRejectedValue(new Error('Registry access denied'))
    mockGetPlatform.mockReturnValue({
      paths: { uninstallLeftoverDirs: () => [DEFAULT_LEFTOVER_DIRS[0]!] },
    })

    mockReaddir.mockResolvedValue([dir('SomeApp'), dir('GameApp')] as Dirent[])
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 60 * 24 * 60 * 60 * 1000 } as ReturnType<typeof Object>)
    mockGetDirectorySize.mockResolvedValue(1024 * 100)

    const results = await scanForLeftovers(makeWindowGetter())
    expect(results).toHaveLength(1)
    expect(results[0]!.items).toHaveLength(2)
  })

  // ── PowerShell failure ──────────────────────────────────────

  it('handles PowerShell call failure gracefully', async () => {
    mockExecFileAsync.mockRejectedValue(new Error('PowerShell not available'))
    mockGetPlatform.mockReturnValue({
      paths: { uninstallLeftoverDirs: () => [DEFAULT_LEFTOVER_DIRS[0]!] },
    })

    mockReaddir.mockResolvedValue([dir('OldApp')] as Dirent[])
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 60 * 24 * 60 * 60 * 1000 } as ReturnType<typeof Object>)
    mockGetDirectorySize.mockResolvedValue(1024 * 100)

    const results = await scanForLeftovers(makeWindowGetter())
    // Should still find the folder (process check is best-effort)
    expect(results).toHaveLength(1)
    expect(results[0]!.items).toHaveLength(1)
  })

  // ── Recency check errors (stat fails) ──────────────────────

  it('assumes recent modification if stat fails during recency check', async () => {
    // isRecentlyModified catches stat error and returns true (assume recent)
    mockStat.mockRejectedValue(new Error('Access denied'))

    const results = await scanForLeftovers(makeWindowGetter())
    // All candidates should be skipped because isRecentlyModified() returns true on error
    expect(results).toHaveLength(0)
  })

  // ── Capping at 100 items per directory ─────────────────────

  it('caps results at 100 items per directory', async () => {
    const manyDirs = Array.from({ length: 150 }, (_, i) => dir(`LeftoverApp${i}`))
    mockReaddir.mockResolvedValue(manyDirs as Dirent[])
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 60 * 24 * 60 * 60 * 1000 } as ReturnType<typeof Object>)
    mockGetDirectorySize.mockResolvedValue(1024 * 50)

    const results = await scanForLeftovers(makeWindowGetter())
    const localResult = results.find((r) => r.subcategory === 'AppData Local')
    expect(localResult).toBeDefined()
    expect(localResult!.items.length).toBe(100)
  })

  // ─── All five safety layers ────────────────────────────────

  it('applies safety layer 1: safelist', async () => {
    mockGetPlatform.mockReturnValue({
      paths: { uninstallLeftoverDirs: () => [DEFAULT_LEFTOVER_DIRS[0]!] },
    })
    mockReaddir.mockResolvedValue([dir('Windows'), dir('OldApp')] as Dirent[])
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 60 * 24 * 60 * 60 * 1000 } as ReturnType<typeof Object>)
    mockGetDirectorySize.mockResolvedValue(1024 * 50)

    const results = await scanForLeftovers(makeWindowGetter())
    expect(results).toHaveLength(1)
    expect(results[0]!.items).toHaveLength(1)
    expect(results[0]!.items[0]!.path).toContain('OldApp')
  })

  it('applies safety layer 2: registry cross-reference', async () => {
    mockExecNativeUtf8.mockResolvedValue({
      stdout:
        '  DisplayName    REG_SZ    OldApp\r\n' +
        '  Publisher      REG_SZ    Some Corp\r\n' +
        '  InstallLocation REG_SZ    C:\\Some\\OldApp\r\n',
    })

    mockReaddir.mockResolvedValue([dir('OldApp')] as Dirent[])

    const results = await scanForLeftovers(makeWindowGetter())
    expect(results).toHaveLength(0)
  })

  it('applies safety layer 3: recency check', async () => {
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 5 * 24 * 60 * 60 * 1000 } as ReturnType<typeof Object>)

    const results = await scanForLeftovers(makeWindowGetter())
    expect(results).toHaveLength(0)
  })

  it('applies safety layer 4: running process check', async () => {
    mockExecFileAsync.mockResolvedValue({
      stdout: 'C:\\Users\\Test\\AppData\\Local\\OldApp\\bin\\app.exe',
    })

    const results = await scanForLeftovers(makeWindowGetter())
    // OldApp should be excluded
    const localResult = results.find((r) => r.subcategory === 'AppData Local')
    expect(localResult?.items.find((i) => i.path.includes('OldApp'))).toBeUndefined()
    // AnotherGone has no process matching, should still be found
    expect(localResult?.items.find((i) => i.path.includes('AnotherGone'))).toBeDefined()
  })

  it('applies safety layer 5: minimum size threshold', async () => {
    mockGetDirectorySize.mockResolvedValue(512) // Below 1 KB

    const results = await scanForLeftovers(makeWindowGetter())
    expect(results).toHaveLength(0)
  })

  // ── Edge cases ─────────────────────────────────────────────

  it('skips hidden folders (dot prefixed)', async () => {
    mockGetPlatform.mockReturnValue({
      paths: { uninstallLeftoverDirs: () => [DEFAULT_LEFTOVER_DIRS[0]!] },
    })
    mockReaddir.mockResolvedValue([dir('.cache'), dir('MyApp')] as Dirent[])
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 60 * 24 * 60 * 60 * 1000 } as ReturnType<typeof Object>)
    mockGetDirectorySize.mockResolvedValue(1024 * 50)

    const results = await scanForLeftovers(makeWindowGetter())
    expect(results).toHaveLength(1)
    expect(results[0]!.items).toHaveLength(1)
    expect(results[0]!.items[0]!.path).toContain('MyApp')
  })

  it('skips GUID-style folders', async () => {
    mockGetPlatform.mockReturnValue({
      paths: { uninstallLeftoverDirs: () => [DEFAULT_LEFTOVER_DIRS[0]!] },
    })
    mockReaddir.mockResolvedValue([dir('{7B849F69-2F1A-4C8F-9C1A-5E7B3E2A8D1F}'), dir('RealApp')] as Dirent[])
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 60 * 24 * 60 * 60 * 1000 } as ReturnType<typeof Object>)
    mockGetDirectorySize.mockResolvedValue(1024 * 50)

    const results = await scanForLeftovers(makeWindowGetter())
    expect(results).toHaveLength(1)
    expect(results[0]!.items).toHaveLength(1)
    expect(results[0]!.items[0]!.path).toContain('RealApp')
  })

  it('handles single target directory', async () => {
    mockGetPlatform.mockReturnValue({
      paths: {
        uninstallLeftoverDirs: () => [{ id: 'only-dir', name: 'Only Dir', path: 'C:\\Only' }],
      },
    })

    mockReaddir.mockResolvedValue([dir('OrphanApp')] as Dirent[])
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 60 * 24 * 60 * 60 * 1000 } as ReturnType<typeof Object>)
    mockGetDirectorySize.mockResolvedValue(1024 * 100)

    const results = await scanForLeftovers(makeWindowGetter())
    expect(results).toHaveLength(1)
    expect(results[0]!.items).toHaveLength(1)
  })

  it('handles case where all candidates are filtered by multiple layers', async () => {
    // Safe folder + matched installed program + recently modified + running + tiny
    mockExecNativeUtf8.mockResolvedValue({
      stdout: '  DisplayName    REG_SZ    MyOldApp\r\n',
    })

    mockReaddir.mockResolvedValue([
      dir('Microsoft'), // Layer 1: safe
      dir('MyOldApp'), // Layer 2: matched in registry
      dir('RecentApp'), // Layer 3: recently modified
      dir('RunningApp'), // Layer 4: running process (and recently modified)
      dir('Tiny'), // Layer 5: too small
    ] as Dirent[])

    mockStat.mockImplementation((_path: string) => {
      const p = typeof _path === 'string' ? _path : ''
      if (p.includes('RecentApp') || p.includes('RunningApp')) {
        return Promise.resolve({ mtimeMs: Date.now() - 1 * 24 * 60 * 60 * 1000 } as ReturnType<typeof Object>)
      }
      return Promise.resolve({ mtimeMs: Date.now() - 90 * 24 * 60 * 60 * 1000 } as ReturnType<typeof Object>)
    })

    mockExecFileAsync.mockResolvedValue({
      stdout: 'C:\\Path\\To\\RunningApp\\bin\\app.exe',
    })

    mockGetDirectorySize.mockImplementation((_path: string) => {
      const p = typeof _path === 'string' ? _path : ''
      if (p.includes('Tiny')) return Promise.resolve(100)
      return Promise.resolve(1024 * 50)
    })

    const results = await scanForLeftovers(makeWindowGetter())
    expect(results).toHaveLength(0)
  })
})
