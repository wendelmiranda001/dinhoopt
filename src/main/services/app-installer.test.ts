import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APP_INSTALLER_ENTRIES,
  appNameMatches,
  cancelAppInstall,
  findAllowlistEntry,
  installApps,
  isAllowlisted,
  isValidAppInstallerId,
  listAvailableApps,
  normalizeAppName,
  resetAppInstallCancel,
  resolveAppId,
} from './app-installer'

const execFileAsyncMock = vi.hoisted(() => vi.fn())
const psUtf8Mock = vi.hoisted(() => vi.fn((s: string) => s))

vi.mock('./exec-utf8', () => ({
  execFileAsync: execFileAsyncMock,
  psUtf8: psUtf8Mock,
}))

const isAdminMock = vi.hoisted(() => vi.fn(() => false))
vi.mock('./elevation', () => ({
  isAdmin: isAdminMock,
}))

const isWingetAvailableMock = vi.hoisted(() => vi.fn(async () => true))
const parseWingetListOutputMock = vi.hoisted(() => vi.fn())
const parseWingetListInstalledNamesMock = vi.hoisted(() => vi.fn())

vi.mock('./software-updater/checkers/winget', () => ({
  isWingetAvailable: isWingetAvailableMock,
  parseWingetListOutput: parseWingetListOutputMock,
  parseWingetListInstalledNames: parseWingetListInstalledNamesMock,
}))

vi.mock('./software-updater/utils', () => ({
  cleanOutput: (s: string) => s,
}))

const resolveWebAppIconMock = vi.hoisted(() => vi.fn(async (_appId: string): Promise<string | null> => null))
vi.mock('./app-installer-icons', () => ({
  resolveWebAppIcon: resolveWebAppIconMock,
}))

const VALID_INSTALL_STDOUT = 'Successfully installed'

beforeEach(() => {
  vi.clearAllMocks()
  execFileAsyncMock.mockReset()
  isWingetAvailableMock.mockReset()
  isWingetAvailableMock.mockResolvedValue(true)
  parseWingetListOutputMock.mockReset()
  parseWingetListOutputMock.mockReturnValue([])
  parseWingetListInstalledNamesMock.mockReset()
  parseWingetListInstalledNamesMock.mockReturnValue([])
  isAdminMock.mockReset()
  isAdminMock.mockReturnValue(false)
  psUtf8Mock.mockImplementation((s: string) => s)
  resolveWebAppIconMock.mockReset()
  resolveWebAppIconMock.mockResolvedValue(null)
})

describe('isValidAppInstallerId', () => {
  it('accepts well-formed ids', () => {
    expect(isValidAppInstallerId('Mozilla.Firefox')).toBe(true)
    expect(isValidAppInstallerId('Google.Chrome')).toBe(true)
    expect(isValidAppInstallerId('A')).toBe(true)
    expect(isValidAppInstallerId('a_b-c.d_1')).toBe(true)
  })

  it('rejects empty, whitespace and malformed ids', () => {
    expect(isValidAppInstallerId('')).toBe(false)
    expect(isValidAppInstallerId(' ')).toBe(false)
    expect(isValidAppInstallerId('.LeadingDot')).toBe(false)
  })

  it('allows trailing dots and dashes within the body', () => {
    expect(isValidAppInstallerId('trailing.')).toBe(true)
    expect(isValidAppInstallerId('a-b-c.')).toBe(true)
  })

  it('rejects ids with injection-prone characters', () => {
    expect(isValidAppInstallerId('Foo; rm -rf /')).toBe(false)
    expect(isValidAppInstallerId('Foo&echo hacked')).toBe(false)
    expect(isValidAppInstallerId('Foo|whoami')).toBe(false)
    expect(isValidAppInstallerId("Foo'bar")).toBe(false)
    expect(isValidAppInstallerId('Foo`bar')).toBe(false)
    expect(isValidAppInstallerId('Foo bar')).toBe(false)
  })

  it('rejects overly long ids', () => {
    expect(isValidAppInstallerId('A'.repeat(202))).toBe(false)
    expect(isValidAppInstallerId('A'.repeat(201))).toBe(true)
  })
})

describe('isAllowlisted', () => {
  it('returns true for allowlisted ids', () => {
    expect(isAllowlisted('Mozilla.Firefox')).toBe(true)
    expect(isAllowlisted('Google.Chrome')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isAllowlisted('mozilla.firefox')).toBe(true)
    expect(isAllowlisted('MOZILLA.FIREFOX')).toBe(true)
  })

  it('returns false for unknown ids', () => {
    expect(isAllowlisted('Evil.Corp')).toBe(false)
    expect(isAllowlisted('')).toBe(false)
  })
})

describe('findAllowlistEntry', () => {
  it('returns the matching entry case-insensitively', () => {
    const entry = findAllowlistEntry('mozilla.firefox')
    expect(entry?.id).toBe('Mozilla.Firefox')
    expect(entry?.category).toBe('browser')
  })

  it('returns undefined for unknown ids', () => {
    expect(findAllowlistEntry('Unknown.App')).toBeUndefined()
  })
})

describe('resolveAppId', () => {
  it('returns the canonical allowlist id for a valid allowlisted id', () => {
    expect(resolveAppId('mozilla.firefox')).toBe('Mozilla.Firefox')
  })

  it('returns null for valid but non-allowlisted ids', () => {
    expect(resolveAppId('Some.ArbitraryApp')).toBeNull()
  })

  it('returns null for invalid ids', () => {
    expect(resolveAppId('')).toBeNull()
    expect(resolveAppId('bad id; rm -rf /')).toBeNull()
    expect(resolveAppId('A'.repeat(201))).toBeNull()
  })
})

describe('normalizeAppName / appNameMatches', () => {
  it('normalizes parenthesized suffixes and trailing versions', () => {
    expect(normalizeAppName('7-Zip 26.02 (x64)')).toBe('7-zip')
    expect(normalizeAppName('Google Chrome')).toBe('google chrome')
    expect(normalizeAppName('Python 3.12')).toBe('python')
    expect(normalizeAppName('  Discord  (x64) ')).toBe('discord')
    expect(normalizeAppName('')).toBe('')
  })

  it('matches exact names after normalization', () => {
    expect(appNameMatches('Google Chrome', 'Google Chrome')).toBe(true)
    expect(appNameMatches('7-Zip', '7-Zip 26.02 (x64)')).toBe(true)
    expect(appNameMatches('Python 3.12', 'Python 3.12.4 (64-bit)')).toBe(true)
  })

  it('matches word-boundary prefix/suffix for names at least 4 chars', () => {
    expect(appNameMatches('Zoom', 'Zoom Workplace')).toBe(true)
    expect(appNameMatches('Process Monitor', 'Microsoft Process Monitor')).toBe(true)
    expect(appNameMatches('Node.js LTS', 'Node.js')).toBe(true)
  })

  it('does not prefix-match short names or non-word-boundaries', () => {
    expect(appNameMatches('Go', 'Google Chrome')).toBe(false)
    expect(appNameMatches('Git', 'Git for Windows')).toBe(false)
    expect(appNameMatches('Signal', 'SignalRGB')).toBe(false)
    expect(appNameMatches('Everything', 'Everything1.5')).toBe(false)
  })

  it('handles empty inputs', () => {
    expect(appNameMatches('', 'Google Chrome')).toBe(false)
    expect(appNameMatches('Google Chrome', '')).toBe(false)
  })
})

describe('listAvailableApps', () => {
  it('returns all allowlist entries as not installed when winget is unavailable', async () => {
    isWingetAvailableMock.mockResolvedValue(false)
    const result = await listAvailableApps()
    expect(result.wingetAvailable).toBe(false)
    expect(result.apps).toHaveLength(APP_INSTALLER_ENTRIES.length)
    expect(result.apps.every((a) => !a.isInstalled)).toBe(true)
    expect(execFileAsyncMock).not.toHaveBeenCalled()
  })

  it('marks installed apps from the winget list output', async () => {
    parseWingetListOutputMock.mockReturnValue([
      {
        id: 'Mozilla.Firefox',
        currentVersion: '135.0',
        name: 'Mozilla Firefox',
        availableVersion: '135.0',
        source: 'winget',
        severity: 'unknown',
        selected: false,
        isUpToDate: true,
      },
    ])
    execFileAsyncMock.mockResolvedValue({ stdout: 'fake list output', stderr: '' })
    const result = await listAvailableApps()
    expect(result.wingetAvailable).toBe(true)
    const firefox = result.apps.find((a) => a.id === 'Mozilla.Firefox')
    expect(firefox?.isInstalled).toBe(true)
    expect(firefox?.installedVersion).toBe('135.0')
    const chrome = result.apps.find((a) => a.id === 'Google.Chrome')
    expect(chrome?.isInstalled).toBe(false)
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      'winget',
      ['list', '--accept-source-agreements', '--disable-interactivity'],
      expect.objectContaining({ timeout: 30_000 }),
    )
  })

  it('is best-effort when the winget list command fails', async () => {
    execFileAsyncMock.mockRejectedValue(new Error('boom'))
    const result = await listAvailableApps()
    expect(result.wingetAvailable).toBe(true)
    expect(result.apps.every((a) => !a.isInstalled)).toBe(true)
  })

  it('marks apps installed via the ARP/display-name fallback', async () => {
    parseWingetListOutputMock.mockReturnValue([])
    parseWingetListInstalledNamesMock.mockReturnValue(['Google Chrome', 'Discord', '7-Zip 26.02 (x64)'])
    execFileAsyncMock.mockResolvedValue({ stdout: 'fake list output', stderr: '' })
    const result = await listAvailableApps()
    const chrome = result.apps.find((a) => a.id === 'Google.Chrome')
    expect(chrome?.isInstalled).toBe(true)
    expect(chrome?.installedVersion).toBeUndefined()
    expect(result.apps.find((a) => a.id === 'Discord.Discord')?.isInstalled).toBe(true)
    expect(result.apps.find((a) => a.id === '7zip.7zip')?.isInstalled).toBe(true)
    expect(result.apps.find((a) => a.id === 'Mozilla.Firefox')?.isInstalled).toBe(false)
    expect(parseWingetListInstalledNamesMock).toHaveBeenCalledWith('fake list output')
  })

  it('keeps ID-match primary and does not double-flag by name', async () => {
    parseWingetListOutputMock.mockReturnValue([
      {
        id: 'Mozilla.Firefox',
        currentVersion: '135.0',
        name: 'Mozilla Firefox',
        availableVersion: '135.0',
        source: 'winget',
        severity: 'unknown',
        selected: false,
        isUpToDate: true,
      },
    ])
    parseWingetListInstalledNamesMock.mockReturnValue(['Google Chrome'])
    execFileAsyncMock.mockResolvedValue({ stdout: 'fake list output', stderr: '' })
    const result = await listAvailableApps()
    const firefox = result.apps.find((a) => a.id === 'Mozilla.Firefox')
    expect(firefox?.isInstalled).toBe(true)
    expect(firefox?.installedVersion).toBe('135.0')
    expect(result.apps.find((a) => a.id === 'Google.Chrome')?.isInstalled).toBe(true)
  })

  it('propagates the curated popular flag from the allowlist', async () => {
    isWingetAvailableMock.mockResolvedValue(false)
    const result = await listAvailableApps()
    const popular = result.apps.filter((a) => a.popular)
    const expected = APP_INSTALLER_ENTRIES.filter((e) => e.popular).map((e) => e.id.toLowerCase())
    expect(popular).toHaveLength(expected.length)
    expect(popular.map((a) => a.id.toLowerCase()).sort()).toEqual(expected.sort())
    expect(result.apps.find((a) => a.id === 'Mozilla.Firefox')?.popular).toBe(true)
    expect(result.apps.find((a) => a.id === 'WinDirStat.WinDirStat')?.popular).toBeUndefined()
  })
})

describe('listAvailableApps icons', () => {
  it('resolves web icons for every app regardless of installed status', async () => {
    parseWingetListOutputMock.mockReturnValue([
      {
        id: 'Mozilla.Firefox',
        currentVersion: '135.0',
        name: 'Mozilla Firefox',
        availableVersion: '135.0',
        source: 'winget',
        severity: 'unknown',
        selected: false,
        isUpToDate: true,
      },
    ])
    execFileAsyncMock.mockResolvedValue({ stdout: 'fake list output', stderr: '' })
    resolveWebAppIconMock.mockResolvedValue('data:image/png;base64,web-icon')

    const result = await listAvailableApps()
    const firefox = result.apps.find((a) => a.id === 'Mozilla.Firefox')
    const chrome = result.apps.find((a) => a.id === 'Google.Chrome')
    expect(firefox?.isInstalled).toBe(true)
    expect(firefox?.icon).toBe('data:image/png;base64,web-icon')
    expect(chrome?.isInstalled).toBe(false)
    expect(chrome?.icon).toBe('data:image/png;base64,web-icon')
    expect(result.apps.every((a) => a.icon === 'data:image/png;base64,web-icon')).toBe(true)
    expect(resolveWebAppIconMock).toHaveBeenCalledTimes(result.apps.length)
  })

  it('keeps apps icon-free when web icon resolution returns null', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: 'fake list output', stderr: '' })
    const result = await listAvailableApps()
    expect(result.apps.every((a) => a.icon === undefined)).toBe(true)
  })

  it('keeps apps icon-free when web icon resolution throws', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: 'fake list output', stderr: '' })
    resolveWebAppIconMock.mockRejectedValue(new Error('boom'))
    const result = await listAvailableApps()
    expect(result.apps.every((a) => a.icon === undefined)).toBe(true)
  })
})

describe('installApps', () => {
  it('installs all valid allowlisted apps serially', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: VALID_INSTALL_STDOUT, stderr: '' })
    const progress: unknown[] = []
    const result = await installApps(['Mozilla.Firefox', 'Google.Chrome'], (p) => progress.push(p))
    expect(result).toEqual({ succeeded: 2, failed: 0, errors: [] })
    expect(execFileAsyncMock).toHaveBeenCalledTimes(2)
    expect(execFileAsyncMock.mock.calls[0]?.[0]).toBe('winget')
    expect(execFileAsyncMock.mock.calls[0]?.[1]).toEqual([
      'install',
      'Mozilla.Firefox',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    ])
    expect(progress).toHaveLength(4)
  })

  it('filters out invalid and non-allowlisted ids', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: VALID_INSTALL_STDOUT, stderr: '' })
    const result = await installApps(['Mozilla.Firefox', 'bad id', 'Unknown.App', 'evil;cmd'], vi.fn())
    expect(result.succeeded).toBe(1)
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1)
  })

  it('counts failures with last output line as reason', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: 'Something failed miserably', stderr: '' })
    execFileAsyncMock.mockRejectedValue({ stdout: 'Installer failed\nNo package found', code: '1', message: 'x' })
    const result = await installApps(['Mozilla.Firefox', 'Google.Chrome'], vi.fn())
    expect(result).toEqual({
      succeeded: 0,
      failed: 2,
      errors: expect.arrayContaining([expect.objectContaining({ appId: 'Google.Chrome' })]),
    })
  })

  it('classifies exitCode 0 with failure pattern as failure', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: 'No package found matching input criteria', stderr: '' })
    const result = await installApps(['Mozilla.Firefox'], vi.fn())
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('classifies exitCode 1 with success pattern as success', async () => {
    execFileAsyncMock.mockRejectedValue({ stdout: 'Successfully installed', code: '1', message: 'x' })
    const result = await installApps(['Mozilla.Firefox'], vi.fn())
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('retries elevated when non-admin and output hints at elevation', async () => {
    isAdminMock.mockReturnValue(false)
    execFileAsyncMock
      .mockRejectedValueOnce({ stdout: 'Access is denied. Try running as administrator.', code: '1', message: 'x' })
      .mockResolvedValueOnce({ stdout: VALID_INSTALL_STDOUT, stderr: '' })
    const result = await installApps(['Mozilla.Firefox'], vi.fn())
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
    expect(execFileAsyncMock).toHaveBeenCalledTimes(2)
    expect(execFileAsyncMock.mock.calls[1]?.[0]).toBe('powershell.exe')
    expect(psUtf8Mock).toHaveBeenCalled()
  })

  it('does not retry elevated when the user is already admin', async () => {
    isAdminMock.mockReturnValue(true)
    execFileAsyncMock.mockRejectedValue({
      stdout: 'Access is denied. Try running as administrator.',
      code: '1',
      message: 'x',
    })
    const result = await installApps(['Mozilla.Firefox'], vi.fn())
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry elevated on non-elevation failures', async () => {
    execFileAsyncMock.mockRejectedValue({ stdout: 'Installer failed unexpectedly', code: '1', message: 'x' })
    const result = await installApps(['Mozilla.Firefox'], vi.fn())
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1)
  })

  it('reports a failed elevated retry as failure', async () => {
    isAdminMock.mockReturnValue(false)
    execFileAsyncMock.mockRejectedValue({
      stdout: 'Access is denied. Try running as administrator.',
      code: '1',
      message: 'x',
    })
    const result = await installApps(['Mozilla.Firefox'], vi.fn())
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toMatch(/x|Install failed/)
  })

  it('uses the error message when a failure has no stdout', async () => {
    execFileAsyncMock.mockRejectedValue({ message: 'spawn winget ENOENT', code: 'ENOENT' })
    const result = await installApps(['Mozilla.Firefox'], vi.fn())
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toMatch(/ENOENT/)
  })

  it('falls back to Unknown error when a failure has neither stdout nor message', async () => {
    execFileAsyncMock.mockRejectedValue(new Error(''))
    const result = await installApps(['Mozilla.Firefox'], vi.fn())
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toMatch(/Unknown error/)
  })

  it('stops early when cancelled between apps', async () => {
    execFileAsyncMock.mockImplementation(async () => {
      cancelAppInstall()
      return { stdout: VALID_INSTALL_STDOUT, stderr: '' }
    })
    const result = await installApps(['Mozilla.Firefox', 'Google.Chrome', 'Brave.Brave'], vi.fn())
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1)
  })

  it('a subsequent install resets the cancel flag', async () => {
    cancelAppInstall()
    execFileAsyncMock.mockResolvedValue({ stdout: VALID_INSTALL_STDOUT, stderr: '' })
    const result = await installApps(['Mozilla.Firefox', 'Google.Chrome'], vi.fn())
    expect(result.succeeded).toBe(2)
    expect(execFileAsyncMock).toHaveBeenCalledTimes(2)
  })

  it('resetAppInstallCancel clears the cancel flag for a new install', async () => {
    cancelAppInstall()
    resetAppInstallCancel()
    execFileAsyncMock.mockResolvedValue({ stdout: VALID_INSTALL_STDOUT, stderr: '' })
    const result = await installApps(['Mozilla.Firefox', 'Google.Chrome'], vi.fn())
    expect(result.succeeded).toBe(2)
    expect(execFileAsyncMock).toHaveBeenCalledTimes(2)
  })

  it('emits progress events with monotonic percent', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: VALID_INSTALL_STDOUT, stderr: '' })
    const progress: Array<{ current: number; total: number; percent: number; status: string }> = []
    await installApps(['Mozilla.Firefox', 'Google.Chrome'], (p) =>
      progress.push({ current: p.current, total: p.total, percent: p.percent, status: p.status }),
    )
    expect(progress[0]).toEqual({ current: 1, total: 2, percent: 0, status: 'in-progress' })
    expect(progress[1]).toEqual({ current: 1, total: 2, percent: 50, status: 'done' })
    expect(progress[2]).toEqual({ current: 2, total: 2, percent: 50, status: 'in-progress' })
    expect(progress[3]).toEqual({ current: 2, total: 2, percent: 100, status: 'done' })
  })

  it('reports a failed progress event with reason for failing apps', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: 'Installer failed', stderr: '' })
    const progress: Array<{ status: string; error?: string }> = []
    const result = await installApps(['Mozilla.Firefox'], (p) => progress.push(p))
    expect(result.failed).toBe(1)
    expect(progress[1]).toMatchObject({ status: 'failed', currentApp: 'Mozilla.Firefox' })
    expect(progress[1]?.error).toMatch(/Installer failed/)
  })
})
