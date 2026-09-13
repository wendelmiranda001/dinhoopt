import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { handleUpdates } from './updates'

vi.mock('../../services/software-updater', () => ({
  checkForUpdates: vi.fn(),
  runUpdates: vi.fn(),
}))

const { checkForUpdates, runUpdates } = await import('../../services/software-updater')

const ctx: CliContext = { json: false, verbosity: 'quiet' }

describe('handleUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkForUpdates).mockResolvedValue({
      apps: [
        { id: 'appA', name: 'AppA', severity: 'low' },
        { id: 'appB', name: 'AppB', severity: 'high' },
      ],
      packageManagerAvailable: true,
      packageManagerName: 'winget',
      currentVersion: '',
      availableVersion: '',
    } as never)
    vi.mocked(runUpdates).mockResolvedValue({ succeeded: 2, failed: 0 })
  })

  it('passes every positional id to runUpdates', async () => {
    const result = await handleUpdates(['run', 'appA', 'appB'], ctx)
    expect(runUpdates).toHaveBeenCalledWith(['appA', 'appB'], expect.any(Function))
    expect(result).toBe(ExitCode.SUCCESS)
  })

  it('supports comma-separated ids combined with positional args', async () => {
    const result = await handleUpdates(['run', 'appA,appB', 'appC'], ctx)
    expect(runUpdates).toHaveBeenCalledWith(['appA', 'appB', 'appC'], expect.any(Function))
    expect(result).toBe(ExitCode.SUCCESS)
  })

  it('returns INVALID_ARGS without calling runUpdates when no id is given', async () => {
    const result = await handleUpdates(['run'], ctx)
    expect(runUpdates).not.toHaveBeenCalled()
    expect(result).toBe(ExitCode.INVALID_ARGS)
  })

  it('ignores flags when collecting positional ids', async () => {
    const result = await handleUpdates(['run', 'appA', '--verbose'], ctx)
    expect(runUpdates).toHaveBeenCalledWith(['appA'], expect.any(Function))
    expect(result).toBe(ExitCode.SUCCESS)
  })
})
