import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = {
  execReg: vi.fn(),
  execTracked: vi.fn(),
  mkdirSync: vi.fn(),
  getBackupDir: vi.fn(),
  getSettings: vi.fn(),
  createFullBackup: vi.fn(),
  createTargetedBackup: vi.fn(),
  pruneOldBackups: vi.fn(),
}

vi.mock('node:fs', () => ({
  mkdirSync: (...a: unknown[]) => mocks.mkdirSync(...a),
}))

vi.mock('../backup-dir', () => ({
  getBackupDir: () => mocks.getBackupDir(),
}))

vi.mock('../settings-store', () => ({
  getSettings: () => mocks.getSettings(),
}))

vi.mock('./backup', () => ({
  createFullBackup: (...a: unknown[]) => mocks.createFullBackup(...a),
  createTargetedBackup: (...a: unknown[]) => mocks.createTargetedBackup(...a),
  pruneOldBackups: (...a: unknown[]) => mocks.pruneOldBackups(...a),
}))

vi.mock('../exec-utf8', () => ({
  execTracked: (...a: unknown[]) => mocks.execTracked(...a),
  psUtf8: (s: string) => s,
}))

vi.mock('./utils', () => ({
  execReg: (...a: unknown[]) => mocks.execReg(...a),
  splitTaskPath: () => null,
}))

import { fixRegistryEntries } from './fixer'

describe('fixRegistryEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getBackupDir.mockReturnValue('C:\\backups')
    mocks.getSettings.mockReturnValue({ backupMode: 'targeted' })
    mocks.createTargetedBackup.mockResolvedValue(undefined)
    mocks.pruneOldBackups.mockImplementation(() => {})
  })

  it('counts a set-value entry without regType/data as a failure instead of silent success', async () => {
    const result = await fixRegistryEntries([
      {
        id: 'missing-fields',
        type: 'obsolete',
        issue: 'missing fields',
        keyPath: 'K',
        valueName: 'V',
        risk: 'low',
        selected: true,
        fix: { op: 'set-value' },
      },
    ])
    expect(result.fixed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.failures[0]?.issue).toBe('missing fields')
    expect(mocks.execReg).not.toHaveBeenCalled()
  })

  it('applies a valid set-value entry and counts it as fixed', async () => {
    mocks.execReg.mockResolvedValue({ stdout: '', stderr: '' })
    const result = await fixRegistryEntries([
      {
        id: 'valid-set-value',
        type: 'obsolete',
        issue: 'y',
        keyPath: 'K',
        valueName: 'V',
        risk: 'low',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '1' },
      },
    ])
    expect(result.fixed).toBe(1)
    expect(result.failed).toBe(0)
    expect(mocks.execReg).toHaveBeenCalledWith(
      expect.arrayContaining(['add', 'K', '/v', 'V', '/t', 'REG_DWORD', '/d', '1', '/f']),
      expect.anything(),
    )
  })

  it('routes reg failures to failures with a reason instead of throwing', async () => {
    mocks.execReg.mockRejectedValue({ stderr: 'Access is denied' })
    const result = await fixRegistryEntries([
      {
        id: 'delete-value',
        type: 'obsolete',
        issue: 'z',
        keyPath: 'K',
        valueName: 'V',
        risk: 'low',
        selected: true,
        fix: { op: 'delete-value' },
      },
    ])
    expect(result.fixed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.failures[0]?.reason).toContain('Access denied')
  })
})
