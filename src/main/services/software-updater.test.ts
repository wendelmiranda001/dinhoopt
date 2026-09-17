import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkForUpdates,
  cleanOutput,
  clearUpdateCache,
  computeSeverity,
  isValidAppId,
  parseWingetListOutput,
  parseWingetUpgradeOutput,
  runUpdates,
  stripTrailingVersion,
} from './software-updater'

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

function setPlatform(p: string) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  clearUpdateCache()
})

afterEach(() => {
  setPlatform('win32')
})

describe('cleanOutput', () => {
  it('strips ANSI escape sequences', () => {
    const input = '\x1B[31mHello\x1B[0m World'
    expect(cleanOutput(input)).toBe('Hello World')
  })

  it('handles \r overwrites (spinners)', () => {
    const input = 'Scanning...\rDone!\nNext line'
    expect(cleanOutput(input)).toBe('Done!\nNext line')
  })

  it('handles multiple \r in same line', () => {
    const input = 'aaa\rbbb\rccc\nnext'
    expect(cleanOutput(input)).toBe('ccc\nnext')
  })

  it('preserves normal strings', () => {
    expect(cleanOutput('Hello World')).toBe('Hello World')
  })

  it('handles empty string', () => {
    expect(cleanOutput('')).toBe('')
  })
})

describe('computeSeverity', () => {
  it('returns major for major version bump', () => {
    expect(computeSeverity('1.0.0', '2.0.0')).toBe('major')
  })

  it('returns minor for minor version bump', () => {
    expect(computeSeverity('1.0.0', '1.1.0')).toBe('minor')
  })

  it('returns patch for patch version bump', () => {
    expect(computeSeverity('1.0.0', '1.0.1')).toBe('patch')
  })

  it('returns unknown when versions are equal', () => {
    expect(computeSeverity('1.0.0', '1.0.0')).toBe('unknown')
  })

  it('returns unknown when version cannot be parsed', () => {
    expect(computeSeverity('abc', '1.0.0')).toBe('unknown')
    expect(computeSeverity('1.0.0', 'abc')).toBe('unknown')
  })

  it('handles two-part versions (major.minor)', () => {
    expect(computeSeverity('1.0', '2.0')).toBe('major')
    expect(computeSeverity('1.0', '1.1')).toBe('minor')
  })

  it('does not handle leading v (returns unknown)', () => {
    expect(computeSeverity('v1.0.0', 'v2.0.0')).toBe('unknown')
  })
})

describe('stripTrailingVersion', () => {
  it('strips trailing version from name', () => {
    expect(stripTrailingVersion('HandBrake 1.11.0')).toBe('HandBrake')
  })

  it('strips v-prefixed version', () => {
    expect(stripTrailingVersion('My App v2.3.1')).toBe('My App')
  })

  it('preserves name without version', () => {
    expect(stripTrailingVersion('Google Chrome')).toBe('Google Chrome')
  })

  it('handles empty string', () => {
    expect(stripTrailingVersion('')).toBe('')
  })
})

describe('parseWingetUpgradeOutput', () => {
  // winget uses fixed-width columns; align test data to header positions
  // Name(0-18, 19) + Id(19-39, 21) + Version(40-57, 18) + Available(58-74, 17) + Source(75+)
  const header = 'Name               Id                   Version           Available        Source'
  const separator = '--------------------------------------------------'

  function padCols(name: string, id: string, version: string, available: string, source: string): string {
    return `${name.padEnd(19)}${id.padEnd(21)}${version.padEnd(18)}${available.padEnd(17)}${source}`
  }

  it('parses winget upgrade output', () => {
    const output = [
      header,
      separator,
      padCols('7-Zip', '7zip.7zip', '24.01', '24.03', 'winget'),
      padCols('Google Chrome', 'Google.Chrome', '122.0.6261.95', '123.0.6312.59', 'winget'),
      '',
      '42 upgrades available.',
    ].join('\r\n')
    const result = parseWingetUpgradeOutput(output)
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('7zip.7zip')
    expect(result[0]?.currentVersion).toBe('24.01')
    expect(result[0]?.availableVersion).toBe('24.03')
    expect(result[0]?.severity).toBe('minor')
    expect(result[1]?.id).toBe('Google.Chrome')
  })

  it('strips > and < prefixes from version', () => {
    const output = [header, separator, padCols('MyApp', 'MyApp.MyApp', '> 1.0.0', '< 2.0.0', 'winget')].join('\r\n')
    const result = parseWingetUpgradeOutput(output)
    expect(result[0]?.currentVersion).toBe('1.0.0')
    expect(result[0]?.availableVersion).toBe('2.0.0')
  })

  it('skips apps where installed version equals available', () => {
    const output = [header, separator, padCols('SameApp', 'Same.Id', '1.0.0', '1.0.0', 'winget')].join('\r\n')
    expect(parseWingetUpgradeOutput(output)).toHaveLength(0)
  })

  it('returns empty array when no header found', () => {
    expect(parseWingetUpgradeOutput('no header here')).toEqual([])
  })

  it('returns empty array for empty output', () => {
    expect(parseWingetUpgradeOutput('')).toEqual([])
  })
})

describe('parseWingetListOutput', () => {
  // Same header as upgrade; list parser reads version up to sourceStart(75)
  // Name(0-18, 19) + Id(19-39, 21) + Version(40-74, 35) + Source(75+)
  const header = 'Name               Id                   Version           Available        Source'
  const separator = '--------------------------------------------------'

  function padCols(name: string, id: string, version: string, source: string): string {
    return `${name.padEnd(19)}${id.padEnd(21)}${version.padEnd(35)}${source}`
  }

  it('parses winget list output', () => {
    const output = [
      header,
      separator,
      padCols('7-Zip', '7zip.7zip', '24.03', 'winget'),
      padCols('Google Chrome', 'Google.Chrome', '123.0.6312.59', 'winget'),
      '',
      '42 packages.',
    ].join('\r\n')
    const result = parseWingetListOutput(output)
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('7zip.7zip')
    expect(result[0]?.isUpToDate).toBe(true)
  })

  it('skips ARP entries', () => {
    const output = [header, separator, padCols('OldApp', 'ARP\\OldApp', '1.0.0', 'winget')].join('\r\n')
    expect(parseWingetListOutput(output)).toHaveLength(0)
  })

  it('skips unknown version', () => {
    const output = [header, separator, padCols('Unknown', 'Unknown.Id', 'Unknown', 'winget')].join('\r\n')
    expect(parseWingetListOutput(output)).toHaveLength(0)
  })
})

// ─── isValidAppId ────────────────────────────────────────────

describe('isValidAppId', () => {
  it('accepts valid winget-style IDs on win32', () => {
    expect(isValidAppId('Google.Chrome')).toBe(true)
    expect(isValidAppId('7zip.7zip')).toBe(true)
    expect(isValidAppId('Microsoft.DotNet.Runtime.6')).toBe(true)
    expect(isValidAppId('a')).toBe(true)
  })

  it('rejects invalid winget-style IDs on win32', () => {
    expect(isValidAppId('')).toBe(false)
    expect(isValidAppId('.starts.with.dot')).toBe(false)
    expect(isValidAppId('a'.repeat(250))).toBe(false)
    expect(isValidAppId('has spaces')).toBe(false)
  })
})

// ─── checkForUpdates — win32 ─────────────────────────────────

describe('checkForUpdates (win32)', () => {
  beforeEach(() => setPlatform('win32'))

  it('returns winget result when winget is available', async () => {
    const upgradeOutput = [
      'Name    Id          Version     Available   Source',
      '-----------------------------------------------',
      'App     Some.App    1.0.0       2.0.0       winget',
    ].join('\n')

    execFileAsyncMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'winget' && args?.[0] === '--version') return { stdout: 'v1.4', stderr: '' }
      if (cmd === 'winget' && args?.[0] === 'upgrade') return { stdout: upgradeOutput, stderr: '' }
      throw new Error('unexpected')
    })

    const result = await checkForUpdates()
    expect(result.packageManagerName).toBe('winget')
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.apps).toHaveLength(1)
    expect(result.apps[0]?.id).toBe('Some.App')
  })

  it('returns no manager when all unavailable', async () => {
    execFileAsyncMock.mockRejectedValue(new Error('not found'))

    const result = await checkForUpdates()
    expect(result.packageManagerAvailable).toBe(false)
    expect(result.packageManagerName).toBeNull()
  })

  it('handles winget upgrade non-zero exit with stdout', async () => {
    const upgradeOutput = [
      'Name    Id          Version     Available   Source',
      '-----------------------------------------------',
      'App     Some.App    1.0.0       2.0.0       winget',
    ].join('\n')

    execFileAsyncMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'winget' && args?.[0] === '--version') return { stdout: 'v1.4', stderr: '' }
      if (cmd === 'winget' && args?.[0] === 'upgrade') throw { stdout: upgradeOutput, message: 'exit 1', code: '1' }
      throw new Error('not found')
    })

    const result = await checkForUpdates()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.apps).toHaveLength(1)
  })

  it('handles winget upgrade non-zero exit without stdout', async () => {
    execFileAsyncMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'winget' && args?.[0] === '--version') return { stdout: 'v1.4', stderr: '' }
      if (cmd === 'winget' && args?.[0] === 'upgrade') throw new Error('no output')
      throw new Error('not found')
    })

    const result = await checkForUpdates()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.apps).toHaveLength(0)
  })

  it('handles winget list non-zero exit gracefully', async () => {
    execFileAsyncMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'winget' && args?.[0] === '--version') return { stdout: 'v1.4', stderr: '' }
      if (cmd === 'winget' && args?.[0] === 'upgrade') return { stdout: '', stderr: '' }
      if (cmd === 'winget' && args?.[0] === 'list') throw new Error('list failed')
      throw new Error('not found')
    })

    const result = await checkForUpdates()
    // Should still succeed with upgrade result, just not up-to-date list
    expect(result.packageManagerAvailable).toBe(true)
  })
})

// ─── runUpdates — win32: winget pipeline ────────────────────

describe('runUpdates (win32) — winget', () => {
  beforeEach(() => {
    setPlatform('win32')
    isAdminMock.mockReturnValue(true)
  })

  it('upgrades app via winget successfully', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'successfully upgraded', stderr: '' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('returns failure when exit code 0 with failure pattern', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'installer failed: Some.App', stderr: '' })
      .mockRejectedValueOnce({ stdout: 'still failed', code: '1' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('returns success when exit code 1 with success pattern', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce({ stdout: 'successfully upgraded Some.App', code: '1' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('returns failure when exit code 1 without success pattern', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce({ stdout: 'no applicable update', code: '1' })
      .mockRejectedValueOnce({ stdout: 'still failed', code: '1' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('returns success when other exit code but output shows success', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce({ stdout: 'installer succeeded Some.App', code: '42' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('returns failure when other exit code and output shows failure', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce({ stdout: 'installer failed Some.App', code: '42' })
      .mockRejectedValueOnce({ stdout: 'still failed', code: '1' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('handles invalid app ID format', async () => {
    const result = await runUpdates(['  '], vi.fn(), 'winget')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('handles execFileAsync error without stdout', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce(new Error('winget crashed'))
      .mockRejectedValueOnce(new Error('winget crashed'))

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toContain('winget crashed')
  })

  it('retries with elevation when output indicates admin needed', async () => {
    isAdminMock.mockReturnValue(false)
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce({ stdout: 'access is denied: Some.App', code: '1' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'No updates available', stderr: '' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('handles elevation failure when UAC denied', async () => {
    isAdminMock.mockReturnValue(false)
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce({ stdout: 'access is denied: Some.App', code: '1' })
      .mockRejectedValueOnce(new Error('UAC denied'))
      .mockRejectedValueOnce({ stdout: 'installer failed', code: '1' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('handles elevation check when app still needs upgrade', async () => {
    isAdminMock.mockReturnValue(false)
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce({ stdout: 'access is denied', code: '1' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'Some.App 1.0.0 2.0.0 ready', stderr: '' })
      .mockRejectedValueOnce({ stdout: 'installer failed', code: '1' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('returns specific error when install technology changed', async () => {
    isAdminMock.mockReturnValue(true)
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce({ stdout: 'install technology is different', code: '1' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toContain('Installer type changed')
  })

  it('retries with --force on second failure', async () => {
    isAdminMock.mockReturnValue(true)
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce({ stdout: 'installer failed: version mismatch', code: '1' })
      .mockResolvedValueOnce({ stdout: 'successfully upgraded Some.App', stderr: '' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('truncates error messages longer than 200 chars', async () => {
    const longLine = `E:${'x'.repeat(300)}`
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce({ stdout: longLine, code: '1' })
      .mockRejectedValueOnce({ stdout: longLine, code: '1' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toMatch(/\.\.\.$/)
    expect(result.errors[0]?.reason?.length).toBeLessThanOrEqual(203)
  })

  it('skips elevation when already admin', async () => {
    isAdminMock.mockReturnValue(true)
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce({ stdout: 'access is denied', code: '1' })
      .mockResolvedValueOnce({ stdout: 'successfully upgraded', stderr: '' })

    const result = await runUpdates(['Some.App'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(1)
  })

  it('handles empty appIds array', async () => {
    const result = await runUpdates([], vi.fn(), 'winget')
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(0)
  })
})

// ─── runUpdates — win32: fallback order ─────────────────────

describe('runUpdates (win32) — fallback', () => {
  beforeEach(() => setPlatform('win32'))

  it('tries winget first when no source specified and winget available', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'successfully upgraded', stderr: '' })

    const result = await runUpdates(['Some.App'], vi.fn())
    expect(result.succeeded).toBe(1)
  })

  it('returns all failed when no package manager available', async () => {
    execFileAsyncMock.mockRejectedValue(new Error('not found'))

    const result = await runUpdates(['Some.App'], vi.fn())
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toBe('No package manager available')
  })
})
