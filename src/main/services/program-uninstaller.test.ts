import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks (must be before imports) ─────────────────────────

const mockSpawn = vi.fn()
const mockExecFile = vi.fn()
vi.mock('child_process', () => {
  const { promisify } = require('node:util')
  const execFileFn = (...args: unknown[]) =>
    (mockExecFile(...args)(
      // Add custom promisify so that promisify(execFile) returns {stdout, stderr}
      execFileFn as any,
    )[promisify.custom] = (...args: unknown[]) => {
      return new Promise((resolve, reject) => {
        mockExecFile(...args, (err: Error | null, stdout: string, stderr: string) => {
          if (err) {
            // Match Node's behavior: error object gets stdout/stderr properties
            ;(err as any).stdout = stdout
            ;(err as any).stderr = stderr
            reject(err)
          } else {
            resolve({ stdout, stderr })
          }
        })
      })
    })
  return {
    execFile: execFileFn,
    spawn: (...args: unknown[]) => mockSpawn(...args),
  }
})

vi.mock('./exec-utf8', () => ({
  execNativeUtf8: (tool: string, args: string[], opts?: any) => {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      mockExecFile(tool, args, opts, (err: Error | null, stdout: string, stderr: string) => {
        if (err) {
          ;(err as any).stdout = stdout
          ;(err as any).stderr = stderr
          reject(err)
        } else {
          resolve({ stdout, stderr })
        }
      })
    })
  },
  execFileAsync: (cmd: string, args: string[], opts?: any) => {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      mockExecFile(cmd, args, opts, (err: Error | null, stdout: string, stderr: string) => {
        if (err) {
          ;(err as any).stdout = stdout
          ;(err as any).stderr = stderr
          reject(err)
        } else {
          resolve({ stdout, stderr })
        }
      })
    })
  },
  psUtf8: (cmd: string) => cmd,
  trackChildProcess: () => () => {},
}))

const mockReaddir = vi.fn()
const mockStat = vi.fn()
vi.mock('fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}))

const mockGetDirectorySize = vi.fn().mockResolvedValue(0)
vi.mock('./file-utils', () => ({ getDirectorySize: (...args: unknown[]) => mockGetDirectorySize(...args) }))

const mockGetPlatform = vi.fn().mockReturnValue({
  paths: { uninstallLeftoverDirs: () => [] },
  commands: { getInstalledApps: vi.fn().mockResolvedValue([]) },
})
vi.mock('../platform', () => ({ getPlatform: () => mockGetPlatform() }))

vi.mock('../constants/uninstall-safelist', () => {
  const SAFE_FOLDER_NAMES = new Set(['windows', 'program files', 'system32', 'microsoft'])
  const SAFE_PREFIXES = ['microsoft.', 'windows.']
  const isSafeFolder = (folderName: string): boolean => {
    const lower = folderName.toLowerCase()
    if (SAFE_FOLDER_NAMES.has(lower)) return true
    for (const prefix of SAFE_PREFIXES) {
      if (lower.startsWith(prefix)) return true
    }
    if (lower.startsWith('.')) return true
    if (/^\{[0-9a-f-]+\}$/i.test(lower)) return true
    return false
  }
  return { SAFE_FOLDER_NAMES, SAFE_PREFIXES, isSafeFolder }
})

import type { InstalledProgram } from '@shared/types'
import {
  deleteRegistryKey,
  extractRegistryKey,
  folderMatchesProgram,
  getInstalledProgramsFull,
  isSafeFolder,
  parseRegDword,
  parseRegValue,
  parseUninstallCommand,
  runUninstaller,
  scanLeftoversForProgram,
  splitArgs,
  verifyUninstall,
} from './program-uninstaller'

function makeProgram(overrides: Partial<InstalledProgram> = {}): InstalledProgram {
  return {
    id: 'test',
    displayName: 'Test App',
    publisher: 'Test Publisher',
    displayVersion: '1.0.0',
    installDate: '',
    estimatedSize: 0,
    installLocation: '',
    uninstallString: '',
    quietUninstallString: '',
    displayIcon: '',
    registryKey: '',
    isSystemComponent: false,
    isWindowsInstaller: false,
    lastUsed: -1,
    ...overrides,
  }
}

// ─── parseRegValue ──────────────────────────────────────────

describe('parseRegValue', () => {
  it('extracts a REG_SZ value', () => {
    const block = '    DisplayName    REG_SZ    Google Chrome\r\n    Publisher    REG_SZ    Google LLC'
    expect(parseRegValue(block, 'DisplayName')).toBe('Google Chrome')
    expect(parseRegValue(block, 'Publisher')).toBe('Google LLC')
  })

  it('returns empty for missing key', () => {
    expect(parseRegValue('DisplayName    REG_SZ    Chrome', 'Publisher')).toBe('')
  })

  it('does not match substrings (UninstallString vs QuietUninstallString)', () => {
    const block =
      '    QuietUninstallString    REG_SZ    "C:\\quiet.exe"\r\n    UninstallString    REG_SZ    "C:\\uninstall.exe"'
    expect(parseRegValue(block, 'UninstallString')).toBe('"C:\\uninstall.exe"')
  })
})

// ─── parseRegDword ──────────────────────────────────────────

describe('parseRegDword', () => {
  it('extracts a DWORD value', () => {
    const block = '    SystemComponent    REG_DWORD    0x1'
    expect(parseRegDword(block, 'SystemComponent')).toBe(1)
  })

  it('returns 0 for missing key', () => {
    expect(parseRegDword('nothing here', 'SystemComponent')).toBe(0)
  })

  it('handles large hex values', () => {
    const block = '    EstimatedSize    REG_DWORD    0x1A2B3'
    expect(parseRegDword(block, 'EstimatedSize')).toBe(0x1a2b3)
  })
})

// ─── extractRegistryKey ─────────────────────────────────────

describe('extractRegistryKey', () => {
  it('extracts the registry key from a block', () => {
    const block =
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Chrome\r\n    DisplayName    REG_SZ    Chrome'
    expect(extractRegistryKey(block)).toBe('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Chrome')
  })

  it('returns empty for no HK line', () => {
    expect(extractRegistryKey('no key here')).toBe('')
  })
})

// ─── splitArgs ──────────────────────────────────────────────

describe('splitArgs', () => {
  it('splits simple whitespace-separated args', () => {
    expect(splitArgs('/silent /norestart')).toEqual(['/silent', '/norestart'])
  })

  it('preserves quoted strings with spaces', () => {
    expect(splitArgs('/DIR="C:\\Program Files\\App" /silent')).toEqual(['/DIR="C:\\Program Files\\App"', '/silent'])
  })

  it('handles empty string', () => {
    expect(splitArgs('')).toEqual([])
  })

  it('handles multiple spaces between args', () => {
    expect(splitArgs('a   b   c')).toEqual(['a', 'b', 'c'])
  })
})

// ─── parseUninstallCommand ──────────────────────────────────

describe('parseUninstallCommand', () => {
  it('parses MSI uninstall with GUID', () => {
    const p = makeProgram({
      isWindowsInstaller: true,
      uninstallString: 'MsiExec.exe /I{12345678-1234-1234-1234-123456789012}',
    })
    const result = parseUninstallCommand(p)
    expect(result.command).toBe('msiexec')
    expect(result.args).toEqual(['/x', '{12345678-1234-1234-1234-123456789012}'])
  })

  it('parses quoted path uninstaller', () => {
    const p = makeProgram({
      uninstallString: '"C:\\Program Files\\App\\uninstall.exe" /silent',
    })
    const result = parseUninstallCommand(p)
    expect(result.command).toBe('C:\\Program Files\\App\\uninstall.exe')
    expect(result.args).toEqual(['/silent'])
  })

  it('parses unquoted exe path', () => {
    const p = makeProgram({
      uninstallString: 'C:\\App\\uninstall.exe /quiet',
    })
    const result = parseUninstallCommand(p)
    expect(result.command).toBe('C:\\App\\uninstall.exe')
    expect(result.args).toEqual(['/quiet'])
  })

  it('falls back to whole string for no exe', () => {
    const p = makeProgram({ uninstallString: 'some-custom-command' })
    const result = parseUninstallCommand(p)
    expect(result.command).toBe('some-custom-command')
    expect(result.args).toEqual([])
  })
})

// ─── isSafeFolder ───────────────────────────────────────────

describe('isSafeFolder', () => {
  it('returns true for known safe folder names', () => {
    expect(isSafeFolder('Windows')).toBe(true)
    expect(isSafeFolder('System32')).toBe(true)
  })

  it('returns true for safe prefixes', () => {
    expect(isSafeFolder('Microsoft.Edge')).toBe(true)
    expect(isSafeFolder('Windows.Security')).toBe(true)
  })

  it('returns true for dot-prefixed (hidden) folders', () => {
    expect(isSafeFolder('.config')).toBe(true)
  })

  it('returns true for GUID folders', () => {
    expect(isSafeFolder('{12345678-1234-1234-1234-123456789012}')).toBe(true)
  })

  it('returns false for a regular app folder', () => {
    expect(isSafeFolder('SomeApp')).toBe(false)
  })
})

// ─── folderMatchesProgram ───────────────────────────────────

describe('folderMatchesProgram', () => {
  it('matches folder containing program name', () => {
    const p = makeProgram({ displayName: 'Visual Studio Code' })
    expect(folderMatchesProgram('visual studio code', p)).toBe(true)
  })

  it('matches folder that is a substring of program name', () => {
    const p = makeProgram({ displayName: 'Google Chrome Browser' })
    expect(folderMatchesProgram('chrome', p)).toBe(true)
  })

  it('matches by publisher name', () => {
    const p = makeProgram({ displayName: 'Some Tool', publisher: 'JetBrains' })
    expect(folderMatchesProgram('jetbrains', p)).toBe(true)
  })

  it('matches by install location basename', () => {
    const p = makeProgram({
      displayName: 'Some App',
      installLocation: 'C:\\Program Files\\discord',
    })
    expect(folderMatchesProgram('discord', p)).toBe(true)
  })

  it('does not match unrelated folder', () => {
    const p = makeProgram({ displayName: 'Google Chrome' })
    expect(folderMatchesProgram('firefox', p)).toBe(false)
  })

  it('does not match very short tokens (< 4 chars)', () => {
    const p = makeProgram({ displayName: 'AB' })
    expect(folderMatchesProgram('xy', p)).toBe(false)
  })
})

// ─── parseRegValue (extended) ───────────────────────────────

describe('parseRegValue (extended)', () => {
  it('handles case-insensitive matching', () => {
    const block = '    displayname    REG_SZ    MyApp'
    expect(parseRegValue(block, 'DisplayName')).toBe('MyApp')
  })

  it('trims whitespace from extracted value', () => {
    const block = '    Publisher    REG_SZ    Some Corp   '
    expect(parseRegValue(block, 'Publisher')).toBe('Some Corp')
  })

  it('handles values with special characters', () => {
    const block = '    InstallLocation    REG_SZ    C:\\Program Files (x86)\\App & Tools\\v2.0'
    expect(parseRegValue(block, 'InstallLocation')).toBe('C:\\Program Files (x86)\\App & Tools\\v2.0')
  })

  it('returns empty for empty block', () => {
    expect(parseRegValue('', 'DisplayName')).toBe('')
  })
})

// ─── parseRegDword (extended) ───────────────────────────────

describe('parseRegDword (extended)', () => {
  it('handles zero value', () => {
    const block = '    WindowsInstaller    REG_DWORD    0x0'
    expect(parseRegDword(block, 'WindowsInstaller')).toBe(0)
  })

  it('handles case-insensitive hex digits', () => {
    const block = '    EstimatedSize    REG_DWORD    0xABCDEF'
    expect(parseRegDword(block, 'EstimatedSize')).toBe(0xabcdef)
  })

  it('returns 0 for empty block', () => {
    expect(parseRegDword('', 'SystemComponent')).toBe(0)
  })
})

// ─── extractRegistryKey (extended) ──────────────────────────

describe('extractRegistryKey (extended)', () => {
  it('extracts HKCU key', () => {
    const block =
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MyApp\r\n    DisplayName    REG_SZ    MyApp'
    expect(extractRegistryKey(block)).toBe('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MyApp')
  })

  it('handles leading whitespace before HK line', () => {
    const block = '  HKLM\\SOFTWARE\\Uninstall\\App\r\n    DisplayName    REG_SZ    App'
    expect(extractRegistryKey(block)).toBe('HKLM\\SOFTWARE\\Uninstall\\App')
  })

  it('returns empty for block with no lines', () => {
    expect(extractRegistryKey('')).toBe('')
  })

  it('returns first HK line when multiple exist', () => {
    const block = 'HKLM\\First\\Key\r\nHKCU\\Second\\Key'
    expect(extractRegistryKey(block)).toBe('HKLM\\First\\Key')
  })
})

// ─── splitArgs (extended) ───────────────────────────────────

describe('splitArgs (extended)', () => {
  it('handles tab characters as whitespace', () => {
    expect(splitArgs('/a\t/b')).toEqual(['/a', '/b'])
  })

  it('handles quoted string without trailing args', () => {
    expect(splitArgs('"C:\\My Path\\app.exe"')).toEqual(['"C:\\My Path\\app.exe"'])
  })

  it('handles nested-looking quotes', () => {
    expect(splitArgs('/key="value with spaces"')).toEqual(['/key="value with spaces"'])
  })

  it('handles single arg with no spaces', () => {
    expect(splitArgs('/silent')).toEqual(['/silent'])
  })

  it('handles leading and trailing whitespace', () => {
    expect(splitArgs('  /a /b  ')).toEqual(['/a', '/b'])
  })
})

// ─── parseUninstallCommand (extended) ───────────────────────

describe('parseUninstallCommand (extended)', () => {
  it('detects msiexec in string even without isWindowsInstaller flag', () => {
    const p = makeProgram({
      isWindowsInstaller: false,
      uninstallString: 'msiexec /x{AABBCCDD-1122-3344-5566-778899AABBCC}',
    })
    const result = parseUninstallCommand(p)
    expect(result.command).toBe('msiexec')
    expect(result.args).toEqual(['/x', '{AABBCCDD-1122-3344-5566-778899AABBCC}'])
  })

  it('handles MsiExec.exe with /I flag (converts to /x)', () => {
    const p = makeProgram({
      isWindowsInstaller: true,
      uninstallString: 'MsiExec.exe /I{11111111-2222-3333-4444-555555555555}',
    })
    const result = parseUninstallCommand(p)
    expect(result.command).toBe('msiexec')
    expect(result.args[0]).toBe('/x')
  })

  it('handles quoted path with no args', () => {
    const p = makeProgram({
      uninstallString: '"C:\\Program Files\\App\\uninstall.exe"',
    })
    const result = parseUninstallCommand(p)
    expect(result.command).toBe('C:\\Program Files\\App\\uninstall.exe')
    expect(result.args).toEqual([])
  })

  it('handles quoted path with multiple args', () => {
    const p = makeProgram({
      uninstallString: '"C:\\App\\uninst.exe" /silent /norestart /log="C:\\temp\\log.txt"',
    })
    const result = parseUninstallCommand(p)
    expect(result.command).toBe('C:\\App\\uninst.exe')
    expect(result.args).toEqual(['/silent', '/norestart', '/log="C:\\temp\\log.txt"'])
  })

  it('handles unquoted exe path with no args', () => {
    const p = makeProgram({
      uninstallString: 'C:\\simple\\uninstall.exe',
    })
    const result = parseUninstallCommand(p)
    expect(result.command).toBe('C:\\simple\\uninstall.exe')
    expect(result.args).toEqual([])
  })

  it('trims whitespace from uninstall string', () => {
    const p = makeProgram({
      uninstallString: '  C:\\App\\uninstall.exe /quiet  ',
    })
    const result = parseUninstallCommand(p)
    expect(result.command).toBe('C:\\App\\uninstall.exe')
    expect(result.args).toEqual(['/quiet'])
  })

  it('handles special characters in paths', () => {
    const p = makeProgram({
      uninstallString: '"C:\\Program Files (x86)\\My App [v2]\\uninstall.exe" /S',
    })
    const result = parseUninstallCommand(p)
    expect(result.command).toBe('C:\\Program Files (x86)\\My App [v2]\\uninstall.exe')
    expect(result.args).toEqual(['/S'])
  })

  it('falls back for MSI without valid GUID', () => {
    const p = makeProgram({
      isWindowsInstaller: true,
      uninstallString: '"C:\\App\\uninstall.exe" /quiet',
    })
    // No GUID match, so falls through to quoted path parsing
    const result = parseUninstallCommand(p)
    expect(result.command).toBe('C:\\App\\uninstall.exe')
    expect(result.args).toEqual(['/quiet'])
  })
})

// ─── runUninstaller ─────────────────────────────────────────

describe('runUninstaller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with exit code 0 on successful uninstall', async () => {
    const child = new EventEmitter()
    mockSpawn.mockReturnValue(child)

    const promise = runUninstaller(
      makeProgram({
        uninstallString: 'C:\\App\\uninstall.exe /silent',
      }),
    )

    child.emit('close', 0)
    const result = await promise
    expect(result).toBe(0)
  })

  it('resolves with non-zero exit code on failure', async () => {
    const child = new EventEmitter()
    mockSpawn.mockReturnValue(child)

    const promise = runUninstaller(
      makeProgram({
        uninstallString: 'C:\\App\\uninstall.exe',
      }),
    )

    child.emit('close', 1)
    const result = await promise
    expect(result).toBe(1)
  })

  it('resolves with null on spawn error (e.g. command not found)', async () => {
    const child = new EventEmitter()
    mockSpawn.mockReturnValue(child)

    const promise = runUninstaller(
      makeProgram({
        uninstallString: 'C:\\nonexistent\\uninstall.exe',
      }),
    )

    child.emit('error', new Error('ENOENT'))
    const result = await promise
    expect(result).toBeNull()
  })

  it('resolves with null if spawn itself throws', async () => {
    mockSpawn.mockImplementation(() => {
      throw new Error('spawn failed')
    })

    const result = await runUninstaller(
      makeProgram({
        uninstallString: 'C:\\App\\uninstall.exe',
      }),
    )

    expect(result).toBeNull()
  })

  it('resolves with null and force-kills the process tree on timeout', async () => {
    const child = new EventEmitter()
    ;(child as any).pid = 123
    mockSpawn.mockReturnValue(child)

    const promise = runUninstaller(
      makeProgram({
        uninstallString: 'C:\\App\\uninstall.exe',
      }),
    )

    // Advance past the 10-minute timeout
    vi.advanceTimersByTime(10 * 60 * 1000)

    const result = await promise
    expect(result).toBeNull()
    expect(mockSpawn).toHaveBeenCalledWith(
      'taskkill',
      ['/T', '/F', '/PID', '123'],
      expect.objectContaining({ windowsHide: true }),
    )
  })

  it('falls back to child.kill() when the tree-kill spawn fails on timeout', async () => {
    const child = new EventEmitter()
    ;(child as any).kill = vi.fn()
    mockSpawn.mockReturnValueOnce(child).mockImplementation(() => {
      throw new Error('spawn failed')
    })

    const promise = runUninstaller(
      makeProgram({
        uninstallString: 'C:\\App\\uninstall.exe',
      }),
    )

    vi.advanceTimersByTime(10 * 60 * 1000)

    const result = await promise
    expect(result).toBeNull()
    expect((child as any).kill).toHaveBeenCalled()
  })

  it('clears timeout when process closes before timeout', async () => {
    const child = new EventEmitter()
    ;(child as any).kill = vi.fn()
    mockSpawn.mockReturnValue(child)

    const promise = runUninstaller(
      makeProgram({
        uninstallString: 'C:\\App\\uninstall.exe',
      }),
    )

    child.emit('close', 0)
    // Advance time — kill should NOT be called since process exited normally
    vi.advanceTimersByTime(10 * 60 * 1000)

    const result = await promise
    expect(result).toBe(0)
    expect((child as any).kill).not.toHaveBeenCalled()
  })

  it('passes correct spawn options', async () => {
    const child = new EventEmitter()
    mockSpawn.mockReturnValue(child)

    runUninstaller(
      makeProgram({
        uninstallString: '"C:\\App\\uninstall.exe" /S',
      }),
    )

    expect(mockSpawn).toHaveBeenCalledWith(
      'C:\\App\\uninstall.exe',
      ['/S'],
      expect.objectContaining({
        detached: false,
        stdio: 'ignore',
        windowsHide: false,
      }),
    )

    child.emit('close', 0)
  })

  it('handles MSI uninstaller command correctly', async () => {
    const child = new EventEmitter()
    mockSpawn.mockReturnValue(child)

    runUninstaller(
      makeProgram({
        isWindowsInstaller: true,
        uninstallString: 'MsiExec.exe /I{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}',
      }),
    )

    expect(mockSpawn).toHaveBeenCalledWith(
      'msiexec',
      ['/x', '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}'],
      expect.any(Object),
    )

    child.emit('close', 0)
  })

  it('handles kill failure gracefully on timeout', async () => {
    const child = new EventEmitter()
    ;(child as any).kill = vi.fn(() => {
      throw new Error('already dead')
    })
    mockSpawn.mockReturnValue(child)

    const promise = runUninstaller(
      makeProgram({
        uninstallString: 'C:\\App\\uninstall.exe',
      }),
    )

    vi.advanceTimersByTime(10 * 60 * 1000)

    const result = await promise
    expect(result).toBeNull() // Should not throw
  })
})

// ─── parseUninstallCommand (edge: unclosed quote) ─────────

describe('parseUninstallCommand (unclosed quote)', () => {
  it('handles opening quote without closing quote (endQuote <= 1)', () => {
    const p = makeProgram({
      uninstallString: '"C:\\Program Files\\App\\uninstall.exe',
    })
    const result = parseUninstallCommand(p)
    expect(result.command).toBe('"C:\\Program Files\\App\\uninstall.exe')
    expect(result.args).toEqual([])
  })

  it('handles empty quoted string (endQuote === 1)', () => {
    const p = makeProgram({
      uninstallString: '""',
    })
    const result = parseUninstallCommand(p)
    expect(result.command).toBe('""')
    expect(result.args).toEqual([])
  })
})

// ─── verifyUninstall ────────────────────────────────────────

describe('verifyUninstall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when registry key no longer exists', async () => {
    // execFile is used via promisify, so mock needs callback style
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(new Error('ERROR: The system was unable to find the specified registry key'), '', '')
      },
    )

    const result = await verifyUninstall('HKLM\\SOFTWARE\\Uninstall\\App')
    expect(result).toBe(true)
  })

  it('returns false when registry key still exists', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, 'HKLM\\SOFTWARE\\Uninstall\\App\r\n    DisplayName    REG_SZ    App', '')
      },
    )

    const result = await verifyUninstall('HKLM\\SOFTWARE\\Uninstall\\App')
    expect(result).toBe(false)
  })

  it('calls reg query with correct arguments', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(new Error('not found'), '', '')
      },
    )

    await verifyUninstall('HKCU\\SOFTWARE\\Uninstall\\TestApp')

    expect(mockExecFile).toHaveBeenCalledWith(
      'reg',
      ['query', 'HKCU\\SOFTWARE\\Uninstall\\TestApp'],
      expect.objectContaining({ timeout: 5000 }),
      expect.anything(),
    )
  })

  it('returns true on timeout (treats as uninstalled)', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(new Error('Command timed out'), '', '')
      },
    )

    const result = await verifyUninstall('HKLM\\SOFTWARE\\Uninstall\\App')
    expect(result).toBe(true)
  })
})

// ─── scanLeftoversForProgram ────────────────────────────────

describe('scanLeftoversForProgram', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPlatform.mockReturnValue({
      paths: { uninstallLeftoverDirs: () => [] },
      commands: { getInstalledApps: vi.fn().mockResolvedValue([]) },
    })
    mockGetDirectorySize.mockResolvedValue(0)
  })

  it('returns empty array when no install location and no leftover dirs', async () => {
    const p = makeProgram({ installLocation: '' })
    const result = await scanLeftoversForProgram(p)
    expect(result).toEqual([])
  })

  it('detects leftover install location that still exists', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => true, mtimeMs: 1000 })
    mockGetDirectorySize.mockResolvedValue(2048)

    const p = makeProgram({
      displayName: 'TestApp',
      installLocation: 'C:\\Program Files\\TestApp',
    })

    const result = await scanLeftoversForProgram(p)
    expect(result).toHaveLength(1)
    expect(result[0]!.path).toBe('C:\\Program Files\\TestApp')
    expect(result[0]!.category).toBe('uninstall-leftovers')
    expect(result[0]!.subcategory).toBe('Install Location')
    expect(result[0]!.size).toBe(2048)
    expect(result[0]!.selected).toBe(true)
  })

  it('skips install location that no longer exists', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'))

    const p = makeProgram({
      installLocation: 'C:\\Program Files\\DeletedApp',
    })

    const result = await scanLeftoversForProgram(p)
    expect(result).toEqual([])
  })

  it('skips install location if it is a safe folder', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => true, mtimeMs: 1000 })
    mockGetDirectorySize.mockResolvedValue(5000)

    const p = makeProgram({
      installLocation: '/mnt/c/Windows',
    })

    const result = await scanLeftoversForProgram(p)
    expect(result).toEqual([])
  })

  it('skips install location if directory size is below 1024', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => true, mtimeMs: 1000 })
    mockGetDirectorySize.mockResolvedValue(512)

    const p = makeProgram({
      installLocation: 'C:\\Program Files\\SmallApp',
    })

    const result = await scanLeftoversForProgram(p)
    expect(result).toEqual([])
  })

  it('skips install location that is not a directory', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => false, mtimeMs: 1000 })

    const p = makeProgram({
      installLocation: 'C:\\somefile.txt',
    })

    const result = await scanLeftoversForProgram(p)
    expect(result).toEqual([])
  })

  it('scans leftover directories and finds matching folders', async () => {
    mockGetPlatform.mockReturnValue({
      paths: {
        uninstallLeftoverDirs: () => [
          { id: 'appdata', name: 'AppData Roaming', path: 'C:\\Users\\User\\AppData\\Roaming' },
        ],
      },
    })

    // readdir returns entries in the leftover dir
    mockReaddir.mockResolvedValue(['TestApp', 'OtherFolder'])

    // stat calls: first for the install location check, then for each candidate
    let _statCallCount = 0
    mockStat.mockImplementation(() => {
      _statCallCount++
      return Promise.resolve({ isDirectory: () => true, mtimeMs: 2000 })
    })

    mockGetDirectorySize.mockResolvedValue(4096)

    const p = makeProgram({
      displayName: 'TestApp',
      installLocation: '',
    })

    const result = await scanLeftoversForProgram(p)
    expect(result.length).toBeGreaterThanOrEqual(1)
    const testAppItem = result.find((r) => r.path.includes('TestApp'))
    expect(testAppItem).toBeDefined()
    expect(testAppItem!.category).toBe('uninstall-leftovers')
    expect(testAppItem!.subcategory).toBe('AppData Roaming')
  })

  it('skips folders that do not match the program', async () => {
    mockGetPlatform.mockReturnValue({
      paths: {
        uninstallLeftoverDirs: () => [{ id: 'appdata', name: 'AppData', path: 'C:\\Users\\User\\AppData' }],
      },
    })

    mockReaddir.mockResolvedValue(['UnrelatedFolder'])
    mockStat.mockResolvedValue({ isDirectory: () => true, mtimeMs: 2000 })
    mockGetDirectorySize.mockResolvedValue(4096)

    const p = makeProgram({ displayName: 'Chrome', installLocation: '' })

    const result = await scanLeftoversForProgram(p)
    expect(result).toEqual([])
  })

  it('skips safe folders in leftover directories', async () => {
    mockGetPlatform.mockReturnValue({
      paths: {
        uninstallLeftoverDirs: () => [{ id: 'appdata', name: 'AppData', path: 'C:\\Users\\User\\AppData' }],
      },
    })

    mockReaddir.mockResolvedValue(['Microsoft'])
    mockStat.mockResolvedValue({ isDirectory: () => true, mtimeMs: 2000 })
    mockGetDirectorySize.mockResolvedValue(4096)

    const p = makeProgram({ displayName: 'Microsoft', installLocation: '' })

    const result = await scanLeftoversForProgram(p)
    expect(result).toEqual([])
  })

  it('skips entries that fail stat', async () => {
    mockGetPlatform.mockReturnValue({
      paths: {
        uninstallLeftoverDirs: () => [{ id: 'appdata', name: 'AppData', path: 'C:\\Users\\User\\AppData' }],
      },
    })

    mockReaddir.mockResolvedValue(['TestApp'])
    mockStat.mockRejectedValue(new Error('Permission denied'))

    const p = makeProgram({ displayName: 'TestApp', installLocation: '' })

    const result = await scanLeftoversForProgram(p)
    expect(result).toEqual([])
  })

  it('skips non-directory entries in leftover dirs', async () => {
    mockGetPlatform.mockReturnValue({
      paths: {
        uninstallLeftoverDirs: () => [{ id: 'appdata', name: 'AppData', path: 'C:\\Users\\User\\AppData' }],
      },
    })

    mockReaddir.mockResolvedValue(['TestApp.log'])
    mockStat.mockResolvedValue({ isDirectory: () => false, mtimeMs: 1000 })

    const p = makeProgram({ displayName: 'TestApp', installLocation: '' })

    const result = await scanLeftoversForProgram(p)
    expect(result).toEqual([])
  })

  it('continues scanning when readdir fails for a directory', async () => {
    mockGetPlatform.mockReturnValue({
      paths: {
        uninstallLeftoverDirs: () => [
          { id: 'bad', name: 'Bad Dir', path: 'C:\\nonexistent' },
          { id: 'good', name: 'Good Dir', path: 'C:\\good' },
        ],
      },
    })

    mockReaddir.mockRejectedValueOnce(new Error('ENOENT')).mockResolvedValueOnce(['TestApp'])
    mockStat.mockResolvedValue({ isDirectory: () => true, mtimeMs: 1000 })
    mockGetDirectorySize.mockResolvedValue(2048)

    const p = makeProgram({ displayName: 'TestApp', installLocation: '' })

    const result = await scanLeftoversForProgram(p)
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it('skips candidate when getDirectorySize throws', async () => {
    mockGetPlatform.mockReturnValue({
      paths: {
        uninstallLeftoverDirs: () => [{ id: 'appdata', name: 'AppData', path: 'C:\\Users\\User\\AppData' }],
      },
    })

    mockReaddir.mockResolvedValue(['TestApp'])
    mockStat.mockResolvedValue({ isDirectory: () => true, mtimeMs: 1000 })
    mockGetDirectorySize.mockRejectedValue(new Error('Access denied'))

    const p = makeProgram({ displayName: 'TestApp', installLocation: '' })

    const result = await scanLeftoversForProgram(p)
    expect(result).toEqual([])
  })

  it('skips candidates smaller than 1024 bytes', async () => {
    mockGetPlatform.mockReturnValue({
      paths: {
        uninstallLeftoverDirs: () => [{ id: 'appdata', name: 'AppData', path: 'C:\\Users\\User\\AppData' }],
      },
    })

    mockReaddir.mockResolvedValue(['TestApp'])
    mockStat.mockResolvedValue({ isDirectory: () => true, mtimeMs: 1000 })
    mockGetDirectorySize.mockResolvedValue(100)

    const p = makeProgram({ displayName: 'TestApp', installLocation: '' })

    const result = await scanLeftoversForProgram(p)
    expect(result).toEqual([])
  })

  it('skips duplicate of install location in leftover dirs', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => true, mtimeMs: 1000 })
    mockGetDirectorySize.mockResolvedValue(4096)
    // Mock execFile for hasRunningProcesses (PowerShell call)
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, '', '')
      },
    )

    mockGetPlatform.mockReturnValue({
      paths: {
        uninstallLeftoverDirs: () => [{ id: 'programfiles', name: 'Program Files', path: '/opt/programs' }],
      },
    })

    mockReaddir.mockResolvedValue(['TestApp'])

    const p = makeProgram({
      displayName: 'TestApp',
      installLocation: join('/opt/programs', 'TestApp'),
    })

    const result = await scanLeftoversForProgram(p)
    // Should have the install location item, but the leftover dir entry
    // matching the same path should be skipped (dedup)
    const installLocationItems = result.filter((r) => r.subcategory === 'Install Location')
    const leftoverItems = result.filter((r) => r.subcategory === 'Program Files')
    expect(installLocationItems).toHaveLength(1)
    expect(leftoverItems).toHaveLength(0)
  })
})

// ─── isSafeFolder (extended) ────────────────────────────────

describe('isSafeFolder (extended)', () => {
  it('is case-insensitive for safe folder names', () => {
    expect(isSafeFolder('WINDOWS')).toBe(true)
    expect(isSafeFolder('Program Files')).toBe(true)
  })

  it('is case-insensitive for safe prefixes', () => {
    expect(isSafeFolder('MICROSOFT.NET')).toBe(true)
    expect(isSafeFolder('WINDOWS.APPS')).toBe(true)
  })

  it('returns true for hidden folders with various names', () => {
    expect(isSafeFolder('.git')).toBe(true)
    expect(isSafeFolder('.vscode')).toBe(true)
    expect(isSafeFolder('.npm')).toBe(true)
  })

  it('returns true for GUID-like folders with varying case', () => {
    expect(isSafeFolder('{abcdef01-2345-6789-abcd-ef0123456789}')).toBe(true)
    expect(isSafeFolder('{ABCDEF01-2345-6789-ABCD-EF0123456789}')).toBe(true)
  })

  it('returns false for non-GUID braced strings with invalid chars', () => {
    expect(isSafeFolder('{not-a-hex-guid}')).toBe(false)
    expect(isSafeFolder('not-a-guid')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isSafeFolder('')).toBe(false)
  })
})

// ─── folderMatchesProgram (extended) ────────────────────────

describe('folderMatchesProgram (extended)', () => {
  it('matches when program name contains version suffix', () => {
    const p = makeProgram({ displayName: 'NodeJS 18.0.0' })
    // Version is stripped, so "nodejs" should match
    expect(folderMatchesProgram('nodejs', p)).toBe(true)
  })

  it('matches by first word of publisher', () => {
    const p = makeProgram({ displayName: 'Some App', publisher: 'Adobe Systems' })
    expect(folderMatchesProgram('adobe', p)).toBe(true)
  })

  it('does not match when all tokens are too short', () => {
    const p = makeProgram({ displayName: 'AB', publisher: 'CD' })
    expect(folderMatchesProgram('something', p)).toBe(false)
  })

  it('matches folder that starts with program token', () => {
    const p = makeProgram({ displayName: 'Discord' })
    expect(folderMatchesProgram('discordptb', p)).toBe(true)
  })

  it('matches folder that ends with program token', () => {
    const p = makeProgram({ displayName: 'Slack' })
    expect(folderMatchesProgram('teamslack', p)).toBe(true)
  })

  it('matches when folder name contains full program name', () => {
    const p = makeProgram({ displayName: 'Notepad Plus' })
    expect(folderMatchesProgram('notepadplus-data', p)).toBe(true)
  })

  it('matches case-insensitively', () => {
    const p = makeProgram({ displayName: 'Visual Studio Code' })
    expect(folderMatchesProgram('VISUAL STUDIO CODE', p)).toBe(true)
  })

  it('uses install location basename for matching', () => {
    const p = makeProgram({
      displayName: 'Some App',
      installLocation: '/opt/programs/vscode',
    })
    // installLocation basename "vscode" should match
    expect(folderMatchesProgram('vscode-data', p)).toBe(true)
  })
})

// ─── getInstalledProgramsFull ───────────────────────────────

describe('getInstalledProgramsFull', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.clearAllMocks()
    mockReaddir.mockResolvedValue([])
    mockStat.mockRejectedValue(new Error('ENOENT'))
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('queries all three registry keys on win32', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, '', '')
      },
    )

    await getInstalledProgramsFull()

    // Should call reg query for each of the 3 registry keys
    const regCalls = mockExecFile.mock.calls.filter(
      (call: unknown[]) => call[0] === 'reg' && (call[1] as string[])?.[0] === 'query',
    )
    expect(regCalls).toHaveLength(3)
  })

  it('parses registry output into InstalledProgram objects', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    const registryBlock =
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\TestApp\r\n' +
      '    DisplayName    REG_SZ    Test Application\r\n' +
      '    Publisher    REG_SZ    Test Corp\r\n' +
      '    DisplayVersion    REG_SZ    2.1.0\r\n' +
      '    UninstallString    REG_SZ    C:\\App\\uninstall.exe\r\n' +
      '    InstallDate    REG_SZ    20240101\r\n' +
      '    EstimatedSize    REG_DWORD    0x400\r\n' +
      '    InstallLocation    REG_SZ    C:\\App\\\r\n' +
      '\r\n'

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, registryBlock, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(1)
    expect(programs[0]!.displayName).toBe('Test Application')
    expect(programs[0]!.publisher).toBe('Test Corp')
    expect(programs[0]!.displayVersion).toBe('2.1.0')
    expect(programs[0]!.uninstallString).toBe('C:\\App\\uninstall.exe')
    expect(programs[0]!.estimatedSize).toBe(0x400 * 1024)
    expect(programs[0]!.installLocation).toBe('C:\\App') // trailing backslash stripped
    expect(programs[0]!.isWindowsInstaller).toBe(false)
    expect(programs[0]!.isSystemComponent).toBe(false)
  })

  it('skips entries without DisplayName', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    const block =
      'HKLM\\SOFTWARE\\Uninstall\\NoName\r\n' + '    UninstallString    REG_SZ    C:\\uninstall.exe\r\n' + '\r\n'

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, block, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(0)
  })

  it('skips entries without UninstallString', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    const block = 'HKLM\\SOFTWARE\\Uninstall\\NoUninstall\r\n' + '    DisplayName    REG_SZ    Some App\r\n' + '\r\n'

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, block, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(0)
  })

  it('skips SystemComponent entries', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    const block =
      'HKLM\\SOFTWARE\\Uninstall\\SysComp\r\n' +
      '    DisplayName    REG_SZ    System Component\r\n' +
      '    UninstallString    REG_SZ    C:\\uninstall.exe\r\n' +
      '    SystemComponent    REG_DWORD    0x1\r\n' +
      '\r\n'

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, block, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(0)
  })

  it('deduplicates by displayName+publisher', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    const block1 =
      'HKLM\\SOFTWARE\\Uninstall\\App1\r\n' +
      '    DisplayName    REG_SZ    My App\r\n' +
      '    Publisher    REG_SZ    Publisher Co\r\n' +
      '    UninstallString    REG_SZ    C:\\uninstall1.exe\r\n' +
      '\r\n'

    const block2 =
      'HKLM\\SOFTWARE\\WOW6432Node\\Uninstall\\App1\r\n' +
      '    DisplayName    REG_SZ    My App\r\n' +
      '    Publisher    REG_SZ    Publisher Co\r\n' +
      '    UninstallString    REG_SZ    C:\\uninstall2.exe\r\n' +
      '\r\n'

    let callNum = 0
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        callNum++
        if (callNum === 1) cb(null, block1, '')
        else if (callNum === 2) cb(null, block2, '')
        else cb(null, '', '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(1)
  })

  it('continues when a registry key query fails', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    const validBlock =
      'HKCU\\SOFTWARE\\Uninstall\\App\r\n' +
      '    DisplayName    REG_SZ    User App\r\n' +
      '    Publisher    REG_SZ    User Pub\r\n' +
      '    UninstallString    REG_SZ    C:\\uninstall.exe\r\n' +
      '\r\n'

    let callNum = 0
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        callNum++
        if (callNum <= 2) cb(new Error('Access denied'), '', '')
        else cb(null, validBlock, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(1)
    expect(programs[0]!.displayName).toBe('User App')
  })

  it('returns sorted results by displayName', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    const blocks =
      'HKLM\\SOFTWARE\\Uninstall\\Zebra\r\n' +
      '    DisplayName    REG_SZ    Zebra App\r\n' +
      '    Publisher    REG_SZ    Z Corp\r\n' +
      '    UninstallString    REG_SZ    C:\\z.exe\r\n' +
      '\r\n' +
      'HKLM\\SOFTWARE\\Uninstall\\Apple\r\n' +
      '    DisplayName    REG_SZ    Apple App\r\n' +
      '    Publisher    REG_SZ    A Corp\r\n' +
      '    UninstallString    REG_SZ    C:\\a.exe\r\n' +
      '\r\n'

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, blocks, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs[0]!.displayName).toBe('Apple App')
    expect(programs[1]!.displayName).toBe('Zebra App')
  })

  it('detects WindowsInstaller flag', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    const block =
      'HKLM\\SOFTWARE\\Uninstall\\MSIApp\r\n' +
      '    DisplayName    REG_SZ    MSI App\r\n' +
      '    Publisher    REG_SZ    MSI Corp\r\n' +
      '    UninstallString    REG_SZ    MsiExec.exe /I{11111111-1111-1111-1111-111111111111}\r\n' +
      '    WindowsInstaller    REG_DWORD    0x1\r\n' +
      '\r\n'

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, block, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(1)
    expect(programs[0]!.isWindowsInstaller).toBe(true)
  })

  it('delegates to platform commands on non-win32', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })

    const mockApps = [
      { name: 'Firefox', publisher: 'Mozilla', version: '120.0', installDate: '2024-01-01', sizeKb: 500 },
      { name: 'Chrome', publisher: 'Google', version: '119.0', installDate: '', sizeKb: 0 },
    ]

    mockGetPlatform.mockReturnValue({
      commands: { getInstalledApps: vi.fn().mockResolvedValue(mockApps) },
      paths: { uninstallLeftoverDirs: () => [] },
    })

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(2)
    // Should be sorted
    expect(programs[0]!.displayName).toBe('Chrome')
    expect(programs[1]!.displayName).toBe('Firefox')
    expect(programs[1]!.estimatedSize).toBe(500 * 1024)
    expect(programs[1]!.lastUsed).toBe(-1)
  })

  it('skips entries where registry key cannot be extracted', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    mockReaddir.mockResolvedValue([])

    // Block with DisplayName and UninstallString but no HK line
    const block =
      '    DisplayName    REG_SZ    NoKeyApp\r\n' + '    UninstallString    REG_SZ    C:\\uninstall.exe\r\n' + '\r\n'

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, block, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(0)
  })

  it('enriches programs with prefetch exact-match timestamps', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    mockReaddir.mockResolvedValue(['CHROME-ABC123.pf'])

    let statCallCount = 0
    mockStat.mockImplementation(() => {
      statCallCount++
      if (statCallCount === 1) return Promise.resolve({ mtimeMs: 5000 })
      return Promise.reject(new Error('ENOENT'))
    })

    const block =
      'HKLM\\SOFTWARE\\Uninstall\\Chrome\r\n' +
      '    DisplayName    REG_SZ    Chrome\r\n' +
      '    Publisher    REG_SZ    Google\r\n' +
      '    UninstallString    REG_SZ    C:\\Chrome\\uninstall.exe\r\n' +
      '\r\n'

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, block, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(1)
    expect(programs[0]!.lastUsed).toBe(5000)
  })

  it('enriches programs with prefetch prefix-match timestamps', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    mockReaddir.mockResolvedValue(['CHROME-ABC.pf', 'DISCORDPTB-DEF.pf'])

    let statCallCount = 0
    mockStat.mockImplementation(() => {
      statCallCount++
      if (statCallCount === 1) return Promise.resolve({ mtimeMs: 4000 })
      if (statCallCount === 2) return Promise.resolve({ mtimeMs: 6000 })
      return Promise.reject(new Error('ENOENT'))
    })

    const blocks =
      'HKLM\\SOFTWARE\\Uninstall\\ChromeBeta\r\n' +
      '    DisplayName    REG_SZ    Chrome Beta\r\n' +
      '    Publisher    REG_SZ    Google\r\n' +
      '    UninstallString    REG_SZ    C:\\ChromeBeta\\uninstall.exe\r\n' +
      '\r\n' +
      'HKLM\\SOFTWARE\\Uninstall\\Discord\r\n' +
      '    DisplayName    REG_SZ    Discord\r\n' +
      '    Publisher    REG_SZ    Discord Inc\r\n' +
      '    UninstallString    REG_SZ    C:\\Discord\\uninstall.exe\r\n' +
      '\r\n'

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, blocks, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(2)

    // Chrome Beta → exeNames=['chromebeta','chrome'] → 'chromebeta'.startsWith('chrome') → matches prefetch 'chrome'
    const chromeBeta = programs.find((p) => p.displayName === 'Chrome Beta')
    expect(chromeBeta!.lastUsed).toBe(4000)

    // Discord → exeNames=['discord','discordinc'] → 'discordptb'.startsWith('discord') → matches prefetch 'discordptb'
    const discord = programs.find((p) => p.displayName === 'Discord')
    expect(discord!.lastUsed).toBe(6000)
  })

  it('enriches using exe name from DisplayIcon', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    mockReaddir.mockResolvedValue(['CHROME-ABC.pf'])

    let statCallCount = 0
    mockStat.mockImplementation(() => {
      statCallCount++
      if (statCallCount === 1) return Promise.resolve({ mtimeMs: 7000 })
      return Promise.reject(new Error('ENOENT'))
    })

    const block =
      'HKLM\\SOFTWARE\\Uninstall\\Chrome\r\n' +
      '    DisplayName    REG_SZ    Chrome\r\n' +
      '    Publisher    REG_SZ    Google\r\n' +
      '    UninstallString    REG_SZ    C:\\Chrome\\uninstall.exe\r\n' +
      '    DisplayIcon    REG_SZ    C:\\Program\\CHROME.EXE\r\n' +
      '\r\n'

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, block, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(1)
    // getExeNames extracts "chrome" from DisplayIcon → matches prefetch "CHROME" → lastUsed = 7000
    expect(programs[0]!.lastUsed).toBe(7000)
  })

  it('enriches using exe name from InstallLocation folder', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    mockReaddir.mockResolvedValue(['FIREFOX-ABC.pf'])

    let statCallCount = 0
    mockStat.mockImplementation(() => {
      statCallCount++
      if (statCallCount === 1) return Promise.resolve({ mtimeMs: 8000 })
      return Promise.reject(new Error('ENOENT'))
    })

    const block =
      'HKLM\\SOFTWARE\\Uninstall\\Firefox\r\n' +
      '    DisplayName    REG_SZ    Mozilla Firefox\r\n' +
      '    Publisher    REG_SZ    Mozilla\r\n' +
      '    UninstallString    REG_SZ    C:\\Firefox\\uninstall.exe\r\n' +
      '    InstallLocation    REG_SZ    C:\\Program Files\\Firefox\r\n' +
      '\r\n'

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, block, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(1)
    // getExeNames extracts "firefox" from InstallLocation basename → matches prefetch "FIREFOX" → lastUsed = 8000
    expect(programs[0]!.lastUsed).toBe(8000)
  })
})

// ─── getInstalledProgramsFull (edge: prefetch branches) ──────

describe('getInstalledProgramsFull (prefetch edge cases)', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.clearAllMocks()
    mockReaddir.mockResolvedValue([])
    mockStat.mockRejectedValue(new Error('ENOENT'))
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('skips prefetch files without dash (dashIdx <= 0)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    // A .pf file with no dash → dashIdx = -1 → skipped
    mockReaddir.mockResolvedValue(['readme.pf', 'CHROME-ABC.pf'])

    let statCallCount = 0
    mockStat.mockImplementation(() => {
      statCallCount++
      if (statCallCount === 1) return Promise.resolve({ mtimeMs: 7000 }) // CHROME-ABC.pf (readme.pf skipped by dashIdx)
      return Promise.reject(new Error('ENOENT'))
    })

    const block =
      'HKLM\\SOFTWARE\\Uninstall\\Chrome\r\n' +
      '    DisplayName    REG_SZ    Chrome\r\n' +
      '    Publisher    REG_SZ    Google\r\n' +
      '    UninstallString    REG_SZ    C:\\Chrome\\uninstall.exe\r\n' +
      '\r\n'

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, block, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(1)
    // Only CHROME should match → lastUsed = 7000
    expect(programs[0]!.lastUsed).toBe(7000)
  })

  it('handles stat failure for a single prefetch entry', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    mockReaddir.mockResolvedValue(['CHROME-ABC.pf', 'FIREFOX-DEF.pf'])

    let statCallCount = 0
    mockStat.mockImplementation(() => {
      statCallCount++
      if (statCallCount === 1) return Promise.reject(new Error('Access denied')) // CHROME stat fails
      if (statCallCount === 2) return Promise.resolve({ mtimeMs: 8000 }) // FIREFOX succeeds
      return Promise.reject(new Error('ENOENT'))
    })

    const block =
      'HKLM\\SOFTWARE\\Uninstall\\Chrome\r\n' +
      '    DisplayName    REG_SZ    Chrome\r\n' +
      '    Publisher    REG_SZ    Google\r\n' +
      '    UninstallString    REG_SZ    C:\\Chrome\\uninstall.exe\r\n' +
      '\r\n'

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, block, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(1)
    // Chrome stat failed, no prefetch match → lastUsed = 0
    expect(programs[0]!.lastUsed).toBe(0)
  })

  it('sets lastUsed to -1 when prefetch map is empty (size === 0)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    mockReaddir.mockResolvedValue([])

    const block =
      'HKLM\\SOFTWARE\\Uninstall\\App\r\n' +
      '    DisplayName    REG_SZ    Test App\r\n' +
      '    Publisher    REG_SZ    Corp\r\n' +
      '    UninstallString    REG_SZ    C:\\App\\uninstall.exe\r\n' +
      '\r\n'

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, block, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(1)
    // prefetchMap is empty → lastUsed stays -1 (unknown)
    expect(programs[0]!.lastUsed).toBe(-1)
  })

  it('handles DisplayIcon without .exe extension', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    mockReaddir.mockResolvedValue(['SOMEAPP-ABC.pf'])
    mockStat.mockResolvedValue({ mtimeMs: 5000 })

    const block =
      'HKLM\\SOFTWARE\\Uninstall\\App\r\n' +
      '    DisplayName    REG_SZ    Some\r\n' +
      '    Publisher    REG_SZ    Corp\r\n' +
      '    UninstallString    REG_SZ    C:\\App\\uninstall.exe\r\n' +
      '    DisplayIcon    REG_SZ    C:\\App\\icon.ico\r\n' +
      '\r\n'

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, block, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(1)
    // icon.ico is not .exe, so no exe name from icon
    // DisplayName 'Some' -> exeNames 'some' -> prefix match 'someapp' (from SOMEAPP-ABC.pf)
    expect(programs[0]!.lastUsed).toBe(5000)
  })

  it('handles DisplayIcon with comma suffix stripped', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    mockReaddir.mockResolvedValue(['FIREFOX-ABC.pf'])
    mockStat.mockResolvedValue({ mtimeMs: 9000 })

    const block =
      'HKLM\\SOFTWARE\\Uninstall\\Firefox\r\n' +
      '    DisplayName    REG_SZ    Mozilla Firefox\r\n' +
      '    Publisher    REG_SZ    Mozilla\r\n' +
      '    UninstallString    REG_SZ    C:\\Firefox\\uninstall.exe\r\n' +
      '    DisplayIcon    REG_SZ    C:\\Program\\FIREFOX.EXE,0\r\n' +
      '\r\n'

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, block, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(1)
    // DisplayIcon with comma suffix stripped → FIREFOX.EXE → 'firefox' → matches prefetch
    expect(programs[0]!.lastUsed).toBe(9000)
  })

  it('handles install location basename too short (< 2 chars)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    mockReaddir.mockResolvedValue(['X-ABC.pf'])
    mockStat.mockResolvedValue({ mtimeMs: 3000 })

    const block =
      'HKLM\\SOFTWARE\\Uninstall\\App\r\n' +
      '    DisplayName    REG_SZ    YZ\r\n' +
      '    Publisher    REG_SZ    X Corp\r\n' +
      '    UninstallString    REG_SZ    C:\\App\\uninstall.exe\r\n' +
      '    InstallLocation    REG_SZ    C:\\a\r\n' +
      '\r\n'

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, block, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(1)
    // InstallLocation basename 'a' (< 2) not pushed
    // DisplayName 'yz' (< 3) not pushed
    // Publisher 'x corp' → 'x corp', 'x' (first word < 3) → just 'x corp'
    // Prefetch 'X-ABC' → 'x' → no exact/prefix/suffix match with 'x corp'
    expect(programs[0]!.lastUsed).toBe(0)
  })

  it('extracts exe name from DisplayName first word when >= 3 chars', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    mockReaddir.mockResolvedValue(['NOTEPAD-ABC.pf'])
    mockStat.mockResolvedValue({ mtimeMs: 6000 })

    const block =
      'HKLM\\SOFTWARE\\Uninstall\\Notepad\r\n' +
      '    DisplayName    REG_SZ    Notepad Plus Plus\r\n' +
      '    Publisher    REG_SZ    NP\r\n' +
      '    UninstallString    REG_SZ    C:\\Notepad\\uninstall.exe\r\n' +
      '\r\n'

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, block, '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(1)
    // DisplayName 'Notepad Plus Plus' → names: 'notepadplusplus', 'notepad'
    // 'notepad' matches prefetch 'notepad' → lastUsed = 6000
    expect(programs[0]!.lastUsed).toBe(6000)
  })

  it('hasRunningProcesses catches PowerShell failure silently', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        // For registry queries - succeed
        if (_cmd === 'reg') {
          cb(null, '', '')
          return
        }
        // For PowerShell in hasRunningProcesses - fail
        cb(new Error('PowerShell failed'), '', '')
      },
    )

    const programs = await getInstalledProgramsFull()
    expect(programs).toHaveLength(0)
  })
})

// ─── deleteRegistryKey ─────────────────────────────────────────

describe('deleteRegistryKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true on successful deletion', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, 'The operation completed successfully.', '')
      },
    )

    const result = await deleteRegistryKey('HKLM\\SOFTWARE\\Uninstall\\App')
    expect(result).toBe(true)
  })

  it('returns false when deletion fails', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(new Error('Access denied'), '', '')
      },
    )

    const result = await deleteRegistryKey('HKLM\\SOFTWARE\\Uninstall\\App')
    expect(result).toBe(false)
  })

  it('calls reg delete with correct arguments', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, '', '')
      },
    )

    await deleteRegistryKey('HKCU\\SOFTWARE\\Uninstall\\TestApp')
    expect(mockExecFile).toHaveBeenCalledWith(
      'reg',
      ['delete', 'HKCU\\SOFTWARE\\Uninstall\\TestApp', '/f'],
      expect.objectContaining({ timeout: 10000 }),
      expect.anything(),
    )
  })
})

// ─── scanLeftoversForProgram (extended coverage) ──────────────

describe('scanLeftoversForProgram (extended)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPlatform.mockReturnValue({
      paths: { uninstallLeftoverDirs: () => [] },
      commands: { getInstalledApps: vi.fn().mockResolvedValue([]) },
    })
    mockGetDirectorySize.mockResolvedValue(0)
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, '', '')
      },
    )
  })

  it('continues scanning other dirs when leftover dir has no matching candidates', async () => {
    mockGetPlatform.mockReturnValue({
      paths: {
        uninstallLeftoverDirs: () => [
          { id: 'dir1', name: 'Dir1', path: 'C:\\Data1' },
          { id: 'dir2', name: 'Dir2', path: 'C:\\Data2' },
        ],
      },
    })

    // First dir: entries don't match program → candidates.length === 0 → continue
    // Second dir: has match → should be found
    mockReaddir.mockResolvedValueOnce(['NoMatch']).mockResolvedValueOnce(['TestApp'])

    mockStat.mockResolvedValue({ isDirectory: () => true, mtimeMs: 1000 })
    mockGetDirectorySize.mockResolvedValue(4096)

    const p = makeProgram({ displayName: 'TestApp', installLocation: '' })
    const result = await scanLeftoversForProgram(p)

    expect(result).toHaveLength(1)
    expect(result[0]!.path).toContain('TestApp')
  })

  it('skips folders with running processes', async () => {
    mockGetPlatform.mockReturnValue({
      paths: {
        uninstallLeftoverDirs: () => [{ id: 'appdata', name: 'AppData', path: 'C:\\Users\\User\\AppData' }],
      },
    })

    mockReaddir.mockResolvedValue(['TestApp'])
    mockStat.mockResolvedValue({ isDirectory: () => true, mtimeMs: 1000 })
    mockGetDirectorySize.mockResolvedValue(4096)

    // PowerShell returns a process path inside the candidate folder
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: unknown[]) => unknown) => {
        cb(null, 'C:\\Users\\User\\AppData\\TestApp\\subprocess.exe', '')
      },
    )

    const p = makeProgram({ displayName: 'TestApp', installLocation: '' })
    const result = await scanLeftoversForProgram(p)

    // Folder has a running process → skipped
    expect(result).toEqual([])
  })

  it('skips candidate when stat fails after size check', async () => {
    mockGetPlatform.mockReturnValue({
      paths: {
        uninstallLeftoverDirs: () => [{ id: 'appdata', name: 'AppData', path: 'C:\\Users\\User\\AppData' }],
      },
    })

    mockReaddir.mockResolvedValue(['TestApp'])

    // First stat call (isDirectory check) succeeds
    // getDirectorySize succeeds
    // Second stat call (mtime check after size) fails
    let statCallCount = 0
    mockStat.mockImplementation(() => {
      statCallCount++
      if (statCallCount === 1) return Promise.resolve({ isDirectory: () => true, mtimeMs: 1000 })
      return Promise.reject(new Error('Access denied'))
    })

    mockGetDirectorySize.mockResolvedValue(4096)

    const p = makeProgram({ displayName: 'TestApp', installLocation: '' })
    const result = await scanLeftoversForProgram(p)

    expect(result).toEqual([])
  })
})
