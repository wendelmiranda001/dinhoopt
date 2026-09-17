import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExistsSync = vi.fn()
const mockReadFileSync = vi.fn()
const mockWriteFileSync = vi.fn()
const mockUnlinkSync = vi.fn()

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
}))

const mockGetPath = vi.fn()
const mockIsPackaged = false
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mockIsPackaged
    },
    getPath: (...args: unknown[]) => mockGetPath(...args),
  },
}))

import type { GameModeSnapshot } from '@shared/types'
import { deleteSnapshot, readSnapshot, validateSnapshot, writeSnapshot } from './snapshot'

function validSnapshot(): GameModeSnapshot {
  return {
    activatedAt: new Date().toISOString(),
    active: true,
    services: [{ name: 'WSearch', originalStartType: 'manual', wasRunning: true }],
    killedProcesses: [{ pid: 1234, name: 'notepad.exe' }],
    originalPowerPlanGuid: '12345678-1234-1234-1234-123456789abc',
    originalFocusAssistState: 1,
    powerSaveBlockerId: 42,
    originalTimerResolution: 156250,
    nagleInterfaces: [
      {
        path: 'Microsoft.PowerShell.Core\\Registry::HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{12345678-1234-1234-1234-123456789abc}',
        originalTcpNoDelay: 0,
        originalTcpAckFrequency: 2,
      },
    ],
    registryTweaks: [
      {
        path: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR',
        name: 'AppCaptureEnabled',
        originalValue: 1,
      },
    ],
    gameProcessPriorities: [{ name: 'game.exe', pid: 5678, originalPriority: 'Normal' }],
  }
}

describe('validateSnapshot', () => {
  it('returns null for null input', () => {
    expect(validateSnapshot(null)).toBeNull()
  })

  it('returns null for non-object input', () => {
    expect(validateSnapshot('string')).toBeNull()
  })

  it('returns null for array input', () => {
    expect(validateSnapshot([])).toBeNull()
  })

  it('returns null when activatedAt is not a string', () => {
    expect(validateSnapshot({ activatedAt: 123 })).toBeNull()
  })

  it('returns null when activatedAt is too long', () => {
    expect(validateSnapshot({ activatedAt: 'x'.repeat(51) })).toBeNull()
  })

  it('returns null when active is not boolean', () => {
    const snap = validSnapshot()
    snap.active = 'yes' as unknown as boolean
    expect(validateSnapshot(snap)).toBeNull()
  })

  it('sets active to true when missing', () => {
    const raw = JSON.parse(JSON.stringify(validSnapshot()))
    delete raw.active
    const result = validateSnapshot(raw)
    expect(result).not.toBeNull()
    expect(result!.active).toBe(true)
  })

  it('returns null when services is not an array', () => {
    const raw = JSON.parse(JSON.stringify(validSnapshot()))
    raw.services = 'not-an-array'
    expect(validateSnapshot(raw)).toBeNull()
  })

  it('returns null when a service entry is null', () => {
    const raw = JSON.parse(JSON.stringify(validSnapshot()))
    raw.services = [null]
    expect(validateSnapshot(raw)).toBeNull()
  })

  it('returns null when service name is invalid', () => {
    const raw = JSON.parse(JSON.stringify(validSnapshot()))
    raw.services = [{ name: 'InvalidService', originalStartType: 'manual', wasRunning: true }]
    expect(validateSnapshot(raw)).toBeNull()
  })

  it('returns null when service originalStartType fails regex', () => {
    const raw = JSON.parse(JSON.stringify(validSnapshot()))
    raw.services = [{ name: 'WSearch', originalStartType: 'a b c', wasRunning: true }]
    expect(validateSnapshot(raw)).toBeNull()
  })

  it('returns null when service wasRunning is not boolean', () => {
    const raw = JSON.parse(JSON.stringify(validSnapshot()))
    raw.services = [{ name: 'WSearch', originalStartType: 'manual', wasRunning: 1 }]
    expect(validateSnapshot(raw)).toBeNull()
  })

  it('accepts valid services', () => {
    const raw = JSON.parse(JSON.stringify(validSnapshot()))
    expect(validateSnapshot(raw)).not.toBeNull()
  })

  it('returns null when killedProcesses is not an array', () => {
    const raw = JSON.parse(JSON.stringify(validSnapshot()))
    raw.killedProcesses = 'not-array'
    expect(validateSnapshot(raw)).toBeNull()
  })

  it('returns null when a killedProcess entry is null', () => {
    const raw = JSON.parse(JSON.stringify(validSnapshot()))
    raw.killedProcesses = [null]
    expect(validateSnapshot(raw)).toBeNull()
  })

  it('returns null when killedProcess pid is not integer', () => {
    const raw = JSON.parse(JSON.stringify(validSnapshot()))
    raw.killedProcesses = [{ pid: 1.5, name: 'proc.exe' }]
    expect(validateSnapshot(raw)).toBeNull()
  })

  it('returns null when killedProcess name is too long', () => {
    const raw = JSON.parse(JSON.stringify(validSnapshot()))
    raw.killedProcesses = [{ pid: 1, name: 'x'.repeat(261) }]
    expect(validateSnapshot(raw)).toBeNull()
  })

  describe('originalPowerPlanGuid', () => {
    it('accepts null value', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.originalPowerPlanGuid = null
      expect(validateSnapshot(raw)).not.toBeNull()
    })

    it('returns null when not a string', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.originalPowerPlanGuid = 12345
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when not a valid GUID', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.originalPowerPlanGuid = 'not-a-guid'
      expect(validateSnapshot(raw)).toBeNull()
    })
  })

  describe('originalFocusAssistState', () => {
    it('accepts null value', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.originalFocusAssistState = null
      expect(validateSnapshot(raw)).not.toBeNull()
    })

    it('returns null when not a number', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.originalFocusAssistState = 'string'
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when not an integer', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.originalFocusAssistState = 1.5
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when less than 0', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.originalFocusAssistState = -1
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when greater than 1', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.originalFocusAssistState = 2
      expect(validateSnapshot(raw)).toBeNull()
    })
  })

  describe('powerSaveBlockerId', () => {
    it('accepts null value', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.powerSaveBlockerId = null
      expect(validateSnapshot(raw)).not.toBeNull()
    })

    it('returns null when not a number', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.powerSaveBlockerId = 'string'
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when not an integer', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.powerSaveBlockerId = 1.5
      expect(validateSnapshot(raw)).toBeNull()
    })
  })

  describe('originalTimerResolution', () => {
    it('accepts null value', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.originalTimerResolution = null
      expect(validateSnapshot(raw)).not.toBeNull()
    })

    it('returns null when not a number', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.originalTimerResolution = 'string'
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when not an integer', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.originalTimerResolution = 1.5
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when negative', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.originalTimerResolution = -1
      expect(validateSnapshot(raw)).toBeNull()
    })
  })

  describe('nagleInterfaces', () => {
    it('returns null when not an array', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.nagleInterfaces = 'not-array'
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when an entry is null', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.nagleInterfaces = [null]
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when path does not match registry pattern', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.nagleInterfaces = [
        {
          path: 'invalid-path',
          originalTcpNoDelay: 0,
          originalTcpAckFrequency: 2,
        },
      ]
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when originalTcpNoDelay is invalid (negative)', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.nagleInterfaces = [
        {
          path: 'Microsoft.PowerShell.Core\\Registry::HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{12345678-1234-1234-1234-123456789abc}',
          originalTcpNoDelay: -1,
          originalTcpAckFrequency: 2,
        },
      ]
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when originalTcpNoDelay is invalid (>1)', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.nagleInterfaces = [
        {
          path: 'Microsoft.PowerShell.Core\\Registry::HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{12345678-1234-1234-1234-123456789abc}',
          originalTcpNoDelay: 2,
          originalTcpAckFrequency: 2,
        },
      ]
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when originalTcpAckFrequency is invalid (negative)', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.nagleInterfaces = [
        {
          path: 'Microsoft.PowerShell.Core\\Registry::HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{12345678-1234-1234-1234-123456789abc}',
          originalTcpNoDelay: null,
          originalTcpAckFrequency: -1,
        },
      ]
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when originalTcpAckFrequency is invalid (>255)', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.nagleInterfaces = [
        {
          path: 'Microsoft.PowerShell.Core\\Registry::HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{12345678-1234-1234-1234-123456789abc}',
          originalTcpNoDelay: null,
          originalTcpAckFrequency: 256,
        },
      ]
      expect(validateSnapshot(raw)).toBeNull()
    })
  })

  describe('registryTweaks', () => {
    it('returns null when not an array', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.registryTweaks = 'not-array'
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when an entry is null', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.registryTweaks = [null]
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when path is not allowed', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.registryTweaks = [{ path: 'HKCU:\\Bad\\Path', name: 'AppCaptureEnabled', originalValue: 1 }]
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when name is not allowed', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.registryTweaks = [
        {
          path: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR',
          name: 'BadName',
          originalValue: 1,
        },
      ]
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when originalValue is not an integer', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.registryTweaks = [
        {
          path: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR',
          name: 'AppCaptureEnabled',
          originalValue: 1.5,
        },
      ]
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('accepts null originalValue', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.registryTweaks = [
        {
          path: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR',
          name: 'AppCaptureEnabled',
          originalValue: null,
        },
      ]
      expect(validateSnapshot(raw)).not.toBeNull()
    })
  })

  describe('gameProcessPriorities', () => {
    it('returns null when not an array', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.gameProcessPriorities = 'not-array'
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when an entry is null', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.gameProcessPriorities = [null]
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when name is too long', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.gameProcessPriorities = [{ name: 'x'.repeat(261), pid: 1, originalPriority: 'Normal' }]
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when pid is not an integer', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.gameProcessPriorities = [{ name: 'game.exe', pid: 1.5, originalPriority: 'Normal' }]
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when pid is negative', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.gameProcessPriorities = [{ name: 'game.exe', pid: -1, originalPriority: 'Normal' }]
      expect(validateSnapshot(raw)).toBeNull()
    })

    it('returns null when originalPriority fails regex', () => {
      const raw = JSON.parse(JSON.stringify(validSnapshot()))
      raw.gameProcessPriorities = [{ name: 'game.exe', pid: 1, originalPriority: 'High Priority' }]
      expect(validateSnapshot(raw)).toBeNull()
    })
  })
})

describe('readSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPath.mockReturnValue('/mock/userData')
  })

  it('returns null when file does not exist', () => {
    mockExistsSync.mockReturnValue(false)
    expect(readSnapshot()).toBeNull()
  })

  it('returns parsed snapshot when file exists with valid JSON', () => {
    mockExistsSync.mockReturnValue(true)
    const snap = validSnapshot()
    mockReadFileSync.mockReturnValue(JSON.stringify(snap))
    const result = readSnapshot()
    expect(result).not.toBeNull()
    expect(result!.activatedAt).toBe(snap.activatedAt)
  })

  it('returns null when JSON parse fails', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('{ invalid json }')
    expect(readSnapshot()).toBeNull()
  })

  it('returns null when validation fails', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ activatedAt: '2024-01-01' }))
    expect(readSnapshot()).toBeNull()
  })
})

describe('writeSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPath.mockReturnValue('/mock/userData')
  })

  it('writes the snapshot as JSON', () => {
    const snap = validSnapshot()
    writeSnapshot(snap)
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1)
    const [path, content] = mockWriteFileSync.mock.calls[0]!
    expect(path).toContain('game-mode-snapshot.json')
    const parsed = JSON.parse(content)
    expect(parsed.activatedAt).toBe(snap.activatedAt)
  })
})

describe('deleteSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPath.mockReturnValue('/mock/userData')
  })

  it('deletes the snapshot file when it exists', () => {
    mockUnlinkSync.mockImplementation(() => {})
    deleteSnapshot()
    expect(mockUnlinkSync).toHaveBeenCalledTimes(1)
    expect(mockUnlinkSync.mock.calls[0]![0]).toContain('game-mode-snapshot.json')
  })

  it('silently handles deletion error (file already gone)', () => {
    mockUnlinkSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    expect(() => deleteSnapshot()).not.toThrow()
  })
})
