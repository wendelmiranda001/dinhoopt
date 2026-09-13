import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { handleDrivers } from './drivers'

vi.mock('../../ipc/driver-manager.ipc', () => ({
  scanDrivers: vi.fn(),
  cleanDrivers: vi.fn(),
  scanDriverUpdates: vi.fn(),
  installDriverUpdates: vi.fn(),
}))

const { cleanDrivers } = await import('../../ipc/driver-manager.ipc')

const ctx: CliContext = { json: false, verbosity: 'quiet' }

describe('handleDrivers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(cleanDrivers).mockResolvedValue({ succeeded: 1, failed: 0, errors: [] })
  })

  it('passes every positional name to cleanDrivers', async () => {
    const result = await handleDrivers(['clean', 'pkgA', 'pkgB'], ctx)
    expect(cleanDrivers).toHaveBeenCalledWith(['pkgA', 'pkgB'])
    expect(result).toBe(ExitCode.SUCCESS)
  })

  it('supports comma-separated names combined with positional args', async () => {
    const result = await handleDrivers(['clean', 'pkgA,pkgB', 'pkgC'], ctx)
    expect(cleanDrivers).toHaveBeenCalledWith(['pkgA', 'pkgB', 'pkgC'])
    expect(result).toBe(ExitCode.SUCCESS)
  })

  it('returns INVALID_ARGS without calling cleanDrivers when no name is given', async () => {
    const result = await handleDrivers(['clean'], ctx)
    expect(cleanDrivers).not.toHaveBeenCalled()
    expect(result).toBe(ExitCode.INVALID_ARGS)
  })

  it('ignores flags when collecting positional names', async () => {
    const result = await handleDrivers(['clean', 'pkgA', '--verbose'], ctx)
    expect(cleanDrivers).toHaveBeenCalledWith(['pkgA'])
    expect(result).toBe(ExitCode.SUCCESS)
  })
})
