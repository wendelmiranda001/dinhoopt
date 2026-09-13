import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { handleHistory } from './history'

vi.mock('../../services/history-store', () => ({
  getHistory: vi.fn(),
  clearHistory: vi.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getHistory, clearHistory } = await import('../../services/history-store')

const ctx: CliContext = { json: false, verbosity: 'quiet' }

describe('handleHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getHistory).mockReturnValue([])
  })

  it('returns NOTHING_FOUND for an empty history list', async () => {
    vi.mocked(getHistory).mockReturnValue([])
    const result = await handleHistory(['list'], ctx)
    expect(result).toBe(ExitCode.NOTHING_FOUND)
  })

  it('returns SUCCESS for a list with entries', async () => {
    vi.mocked(getHistory).mockReturnValue([
      { timestamp: '2026-01-01T00:00:00', type: 'system', totalItemsCleaned: 12, totalSpaceSaved: 4096 },
    ])
    const result = await handleHistory(['list'], ctx)
    expect(result).toBe(ExitCode.SUCCESS)
  })

  it('clears history for the clear subcommand', async () => {
    const result = await handleHistory(['clear'], ctx)
    expect(clearHistory).toHaveBeenCalledTimes(1)
    expect(result).toBe(ExitCode.SUCCESS)
  })

  it('returns INVALID_ARGS for an unknown subcommand', async () => {
    const result = await handleHistory(['export'], ctx)
    expect(result).toBe(ExitCode.INVALID_ARGS)
  })
})
