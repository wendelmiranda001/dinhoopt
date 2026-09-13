import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = {
  execReg: vi.fn(),
  execNativeUtf8: vi.fn(),
  warning: vi.fn(),
}

vi.mock('../logger.service', () => ({
  getLogger: () => ({ warning: (...a: unknown[]) => mocks.warning(...a) }),
}))

vi.mock('../exec-utf8', () => ({
  execNativeUtf8: (...a: unknown[]) => mocks.execNativeUtf8(...a),
}))

vi.mock('./utils', () => ({
  execReg: (...a: unknown[]) => mocks.execReg(...a),
  splitTaskPath: () => null,
  stripRegHeader: () => '',
}))

import { createFullBackup } from './backup'

describe('createFullBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.execReg.mockResolvedValue({ stdout: '', stderr: '' })
    mocks.execNativeUtf8.mockResolvedValue({ stdout: '<xml/>', stderr: '' })
  })

  it('completes all 9 hive exports even when the first HKLM export fails', async () => {
    mocks.execReg.mockRejectedValueOnce(new Error('Access is denied'))
    await expect(createFullBackup('C:\\backups', 't1')).resolves.toBeUndefined()
    expect(mocks.execReg).toHaveBeenCalledTimes(9)
    expect(mocks.warning).toHaveBeenCalledWith('registry-backup', expect.stringContaining('HKLM\\SOFTWARE'))
  })

  it('attempts every hive in order', async () => {
    await createFullBackup('C:\\backups', 't1')
    const hives = mocks.execReg.mock.calls.map((c) => c[0]![1]).filter((x: unknown) => typeof x === 'string')
    expect(hives).toEqual([
      'HKLM\\SOFTWARE',
      'HKCU\\SOFTWARE',
      'HKLM\\SYSTEM\\CurrentControlSet\\Services',
      'HKCR\\CLSID',
      'HKCR\\Interface',
      'HKCR\\MIME',
      'HKCR\\*\\shellex',
      'HKCR\\Directory\\shellex',
      'HKCR\\Folder\\shellex',
    ])
  })
})
