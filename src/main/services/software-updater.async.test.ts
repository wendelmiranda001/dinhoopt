import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./exec-utf8', () => ({
  execFileAsync: vi.fn(),
  psUtf8: vi.fn((s: string) => s),
}))

vi.mock('./elevation', () => ({
  isAdmin: () => false,
}))

function setPlatform(p: string) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

async function freshMod() {
  vi.resetModules()
  const mod = await import('./software-updater')
  return mod
}

// ─── checkForUpdates — win32 ────────────────────────────────

describe('checkForUpdates (win32)', () => {
  beforeEach(() => {
    setPlatform('win32')
  })

  it('returns winget updates when winget is available', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    const upgradeOutput = [
      'Name                     Id                              Version     Available   Source',
      '----------------------------------------------------------------------------------------',
      'Google Chrome            Google.Chrome                   120.0.1     121.0.0     winget',
      '2 upgrades available.',
    ].join('\n')

    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockResolvedValueOnce({ stdout: upgradeOutput, stderr: '' })

    const result = await mod.checkForUpdates()
    expect(result.packageManagerName).toBe('winget')
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.apps).toHaveLength(1)
    expect(result.apps[0]!.id).toBe('Google.Chrome')
    expect(result.totalCount).toBe(1)
    expect(result.majorCount).toBe(1)
  })

  it('returns empty when winget not available', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync).mockRejectedValue(new Error('not found'))
    const result = await mod.checkForUpdates()
    expect(result.packageManagerAvailable).toBe(false)
    expect(result.apps).toEqual([])
  })

  it('handles winget non-zero exit with stdout', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    const upgradeOutput = [
      'Name    Id          Version     Available   Source',
      '----------------------------------------------------',
      'App     Some.App    1.0.0       2.0.0       winget',
    ].join('\n')

    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce({ stdout: upgradeOutput, message: 'exit code 1' })

    const result = await mod.checkForUpdates()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.apps).toHaveLength(1)
  })

  it('returns empty apps when winget has no stdout on error', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce(new Error('no output'))

    const result = await mod.checkForUpdates()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.apps).toEqual([])
  })
})

// ─── runUpdates — win32 ─────────────────────────────────────

describe('runUpdates (win32)', () => {
  beforeEach(() => setPlatform('win32'))

  it('upgrades apps via winget', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'successfully upgraded Google.Chrome', stderr: '' })

    const result = await mod.runUpdates(['Google.Chrome'], vi.fn())
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('collects errors for failed upgrades', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce({ stdout: 'installer failed', message: 'installer failed', code: 1 } as any)
      .mockRejectedValueOnce(new Error('elevation failed'))
      .mockRejectedValueOnce({ stdout: 'installer failed', message: 'installer failed', code: 1 } as any)

    const result = await mod.runUpdates(['Google.Chrome'], vi.fn())
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
  })

  it('truncates error messages longer than 200 chars', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    const longLine = `E:${'x'.repeat(300)}`
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockRejectedValueOnce({ stdout: longLine, message: 'exit code 1' })

    const result = await mod.runUpdates(['Google.Chrome'], vi.fn())
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toMatch(/\.\.\.$/)
    expect(result.errors[0]!.reason!.length).toBeLessThanOrEqual(203)
  })

  it('routes to winget when source is specified', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync)
      .mockResolvedValueOnce({ stdout: 'v1.4', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'successfully upgraded', stderr: '' })
    const result = await mod.runUpdates(['Google.Chrome'], vi.fn(), 'winget')
    expect(result.succeeded).toBe(1)
  })

  it('returns all failed when no manager available', async () => {
    const mod = await freshMod()
    const { execFileAsync } = await import('./exec-utf8')
    vi.mocked(execFileAsync).mockRejectedValue(new Error('not found'))
    const result = await mod.runUpdates(['Google.Chrome'], vi.fn())
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('No package manager available')
  })
})

// ─── unknown platform ─────────────────────────────────────

describe('checkForUpdates (unknown)', () => {
  beforeEach(() => setPlatform('android' as any))

  it('returns empty result', async () => {
    const mod = await freshMod()
    const result = await mod.checkForUpdates()
    expect(result.packageManagerAvailable).toBe(false)
    expect(result.packageManagerName).toBeNull()
  })
})

describe('runUpdates (unknown)', () => {
  beforeEach(() => setPlatform('android' as any))

  it('returns empty result', async () => {
    const mod = await freshMod()
    const result = await mod.runUpdates([], vi.fn())
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(0)
  })
})
