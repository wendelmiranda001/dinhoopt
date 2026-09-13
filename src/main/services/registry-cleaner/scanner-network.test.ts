import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = {
  execReg: vi.fn(),
}

vi.mock('../logger.service', () => ({
  getLogger: () => ({ warning: vi.fn(), info: vi.fn(), error: vi.fn() }),
}))

vi.mock('./utils', () => ({
  execReg: (...a: unknown[]) => mocks.execReg(...a),
}))

import { scanNetwork } from './scanner-network'

describe('scanNetwork', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not flag LLMNR when EnableMulticast is 0 (parse as hex)', async () => {
    mocks.execReg.mockImplementation(async (args: string[]) => {
      if (args.includes('EnableMulticast')) return { stdout: 'EnableMulticast REG_DWORD 0x0', stderr: '' }
      return { stdout: 'WpadOverride REG_DWORD 0x0', stderr: '' }
    })
    const entries = await scanNetwork()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.valueName).toBe('WpadOverride')
  })

  it('emits a false-positive-free fallback entry when a query simply fails', async () => {
    mocks.execReg.mockImplementation(async (args: string[]) => {
      if (args.includes('Wpad')) throw new Error('network unreachable')
      return { stdout: 'EnableMulticast REG_DWORD 0x1', stderr: '' }
    })
    const entries = await scanNetwork()
    expect(entries).toHaveLength(2)
  })

  it('rethrows abort-style rejections instead of emitting a fabricated vulnerability', async () => {
    mocks.execReg.mockRejectedValue(new Error('operation aborted'))
    const signal = { aborted: true } as AbortSignal
    await expect(scanNetwork(signal)).rejects.toThrow('Operation cancelled')
  })

  it('uses hex 0x10 (=16, non-zero) to decide LLMNR enabled', async () => {
    mocks.execReg.mockImplementation(async (args: string[]) => {
      if (args.includes('EnableMulticast')) return { stdout: 'EnableMulticast REG_DWORD 0x10', stderr: '' }
      return { stdout: 'WpadOverride REG_DWORD 0x0', stderr: '' }
    })
    const entries = await scanNetwork()
    expect(entries).toHaveLength(2)
  })
})
