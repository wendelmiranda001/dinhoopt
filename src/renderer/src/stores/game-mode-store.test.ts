import type { GameModeAuditReport, GameModeConfig, GameProfile } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initGameModeStore, useGameModeStore } from './game-mode-store'

const mockGameModeRunAudit = vi.fn()
const mockSettingsSet = vi.fn()
const mockSettingsGet = vi.fn()
const mockGameModeStatus = vi.fn()
const mockOnGameModeAutoEvent = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()

  useGameModeStore.setState({
    active: false,
    activatedAt: null,
    pendingRestore: false,
    status: 'idle',
    progress: null,
    lastResult: null,
    detectedGame: null,
    auditReport: null,
    auditPhase: 'idle',
    config: {
      enabledOptimizations: [],
      customProcessKillList: [],
      autoDetect: false,
      autoDeactivate: true,
      customGameProcesses: [],
      gameProfiles: {},
    },
    expandedCategories: new Set(),
  })

  mockSettingsSet.mockResolvedValue(undefined)
  ;(globalThis as any).window = {
    dinho: {
      gameModeRunAudit: mockGameModeRunAudit,
      settingsSet: mockSettingsSet,
      settingsGet: mockSettingsGet,
      gameModeStatus: mockGameModeStatus,
      onGameModeAutoEvent: mockOnGameModeAutoEvent,
    },
  }
})

describe('game-mode-store - audit', () => {
  it('starts with auditReport null and auditPhase idle', () => {
    const state = useGameModeStore.getState()
    expect(state.auditReport).toBeNull()
    expect(state.auditPhase).toBe('idle')
  })

  it('runAudit fetches report and updates state', async () => {
    const mockReport: GameModeAuditReport = {
      timestamp: '2025-01-01T00:00:00Z',
      phase: 'pre-activation',
      checks: [],
      summary: { passed: 1, warnings: 0, errors: 0 },
    }
    mockGameModeRunAudit.mockResolvedValue(mockReport)

    await useGameModeStore.getState().runAudit('pre-activation')

    const state = useGameModeStore.getState()
    expect(state.auditReport).toEqual(mockReport)
    expect(state.auditPhase).toBe('idle')
    expect(mockGameModeRunAudit).toHaveBeenCalledWith('pre-activation')
  })

  it('runAudit handles rejection gracefully', async () => {
    mockGameModeRunAudit.mockRejectedValue(new Error('audit failed'))

    await useGameModeStore.getState().runAudit('post-activation')

    const state = useGameModeStore.getState()
    expect(state.auditReport).toBeNull()
    expect(state.auditPhase).toBe('idle')
  })

  it('clearAuditReport resets report to null', () => {
    useGameModeStore.setState({
      auditReport: {
        timestamp: '2025-01-01T00:00:00Z',
        phase: 'pre-activation',
        checks: [],
        summary: { passed: 1, warnings: 0, errors: 0 },
      },
    })

    useGameModeStore.getState().clearAuditReport()
    expect(useGameModeStore.getState().auditReport).toBeNull()
  })

  it('runAudit sets auditPhase to running during fetch', async () => {
    let resolvePromise!: (v: any) => void
    mockGameModeRunAudit.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve
      }),
    )

    const promise = useGameModeStore.getState().runAudit('pre-activation')
    expect(useGameModeStore.getState().auditPhase).toBe('running')

    resolvePromise({
      timestamp: '2025-01-01T00:00:00Z',
      phase: 'pre-activation',
      checks: [],
      summary: { passed: 1, warnings: 0, errors: 0 },
    })

    await promise
    expect(useGameModeStore.getState().auditPhase).toBe('idle')
  })
})

describe('game-mode-store - simple setters', () => {
  it('setActive updates active and activatedAt', () => {
    useGameModeStore.getState().setActive(true, '2025-06-09T12:00:00Z')
    const state = useGameModeStore.getState()
    expect(state.active).toBe(true)
    expect(state.activatedAt).toBe('2025-06-09T12:00:00Z')
  })

  it('setPendingRestore updates pendingRestore', () => {
    useGameModeStore.getState().setPendingRestore(true)
    expect(useGameModeStore.getState().pendingRestore).toBe(true)
  })

  it('setStatus updates status', () => {
    useGameModeStore.getState().setStatus('activating')
    expect(useGameModeStore.getState().status).toBe('activating')
  })

  it('setProgress updates progress', () => {
    const progress = { phase: 'activating' as const, current: 1, total: 5, currentLabel: 'Stopping services' }
    useGameModeStore.getState().setProgress(progress)
    expect(useGameModeStore.getState().progress).toEqual(progress)
  })

  it('setLastResult updates lastResult', () => {
    const result = { type: 'activate' as const, succeeded: 3, failed: 0 }
    useGameModeStore.getState().setLastResult(result)
    expect(useGameModeStore.getState().lastResult).toEqual(result)
  })

  it('setDetectedGame updates detectedGame', () => {
    useGameModeStore.getState().setDetectedGame('Minecraft.exe')
    expect(useGameModeStore.getState().detectedGame).toBe('Minecraft.exe')
  })

  it('setConfig replaces config', () => {
    const newConfig: GameModeConfig = {
      enabledOptimizations: ['svc-wsearch'],
      customProcessKillList: ['notepad.exe'],
      autoDetect: true,
      autoDeactivate: false,
      customGameProcesses: ['Minecraft.exe'],
      gameProfiles: {},
    }
    useGameModeStore.getState().setConfig(newConfig)
    expect(useGameModeStore.getState().config).toEqual(newConfig)
  })
})

describe('game-mode-store - toggleOptimization', () => {
  it('adds an optimization to enabledOptimizations', () => {
    useGameModeStore.getState().toggleOptimization('svc-wsearch')
    const state = useGameModeStore.getState()
    expect(state.config.enabledOptimizations).toContain('svc-wsearch')
    expect(mockSettingsSet).toHaveBeenCalled()
  })

  it('removes an optimization from enabledOptimizations', () => {
    useGameModeStore.setState({
      config: {
        enabledOptimizations: ['svc-wsearch', 'sys-focus-assist'],
        customProcessKillList: [],
        autoDetect: false,
        autoDeactivate: true,
        customGameProcesses: [],
        gameProfiles: {},
      },
    })
    useGameModeStore.getState().toggleOptimization('svc-wsearch')
    const state = useGameModeStore.getState()
    expect(state.config.enabledOptimizations).not.toContain('svc-wsearch')
    expect(state.config.enabledOptimizations).toContain('sys-focus-assist')
  })
})

describe('game-mode-store - toggleCategory', () => {
  it('adds a category to expandedCategories', () => {
    useGameModeStore.getState().toggleCategory('services')
    expect(useGameModeStore.getState().expandedCategories.has('services')).toBe(true)
  })

  it('removes a category from expandedCategories', () => {
    useGameModeStore.setState({ expandedCategories: new Set(['services', 'memory']) })
    useGameModeStore.getState().toggleCategory('services')
    expect(useGameModeStore.getState().expandedCategories.has('services')).toBe(false)
    expect(useGameModeStore.getState().expandedCategories.has('memory')).toBe(true)
  })
})

describe('game-mode-store - config actions that persist', () => {
  it('setCustomProcessKillList updates the list and persists', () => {
    useGameModeStore.getState().setCustomProcessKillList(['notepad.exe', 'calc.exe'])
    expect(useGameModeStore.getState().config.customProcessKillList).toEqual(['notepad.exe', 'calc.exe'])
    expect(mockSettingsSet).toHaveBeenCalledWith({
      gameMode: expect.objectContaining({ customProcessKillList: ['notepad.exe', 'calc.exe'] }),
    })
  })

  it('setAutoDetect enables auto-detect and persists', () => {
    useGameModeStore.getState().setAutoDetect(true)
    expect(useGameModeStore.getState().config.autoDetect).toBe(true)
    expect(mockSettingsSet).toHaveBeenCalledWith({
      gameMode: expect.objectContaining({ autoDetect: true }),
    })
  })

  it('setAutoDeactivate disables auto-deactivate and persists', () => {
    useGameModeStore.getState().setAutoDeactivate(false)
    expect(useGameModeStore.getState().config.autoDeactivate).toBe(false)
    expect(mockSettingsSet).toHaveBeenCalledWith({
      gameMode: expect.objectContaining({ autoDeactivate: false }),
    })
  })

  it('setCustomGameProcesses updates the list and persists', () => {
    useGameModeStore.getState().setCustomGameProcesses(['Minecraft.exe', 'Cyberpunk2077.exe'])
    expect(useGameModeStore.getState().config.customGameProcesses).toEqual(['Minecraft.exe', 'Cyberpunk2077.exe'])
    expect(mockSettingsSet).toHaveBeenCalledWith({
      gameMode: expect.objectContaining({ customGameProcesses: ['Minecraft.exe', 'Cyberpunk2077.exe'] }),
    })
  })
})

describe('game-mode-store - initGameModeStore', () => {
  it('loads config from settings and checks status', async () => {
    mockSettingsGet.mockResolvedValue({
      gameMode: {
        enabledOptimizations: ['svc-wsearch'],
        customProcessKillList: [],
        autoDetect: false,
        autoDeactivate: false,
        customGameProcesses: [],
      },
    })
    mockGameModeStatus.mockResolvedValue({ active: true, activatedAt: '2025-06-09T12:00:00Z', pendingRestore: false })

    initGameModeStore()
    await vi.waitFor(() => {
      const state = useGameModeStore.getState()
      expect(state.config.enabledOptimizations).toContain('svc-wsearch')
      expect(state.active).toBe(true)
      expect(state.activatedAt).toBe('2025-06-09T12:00:00Z')
    })
  })

  it('registers auto-detect event listener', () => {
    mockSettingsGet.mockResolvedValue({})
    mockGameModeStatus.mockResolvedValue({ active: false, activatedAt: null, pendingRestore: false })

    initGameModeStore()
    expect(mockOnGameModeAutoEvent).toHaveBeenCalled()
  })

  it('handles settingsGet rejection gracefully', async () => {
    mockSettingsGet.mockRejectedValue(new Error('storage error'))
    mockGameModeStatus.mockResolvedValue({ active: false, activatedAt: null, pendingRestore: false })

    initGameModeStore()

    await vi.waitFor(() => {
      expect(useGameModeStore.getState().active).toBe(false)
    })
  })

  it('handles gameModeStatus rejection gracefully', async () => {
    mockSettingsGet.mockResolvedValue({})
    mockGameModeStatus.mockRejectedValue(new Error('status error'))

    initGameModeStore()

    await vi.waitFor(() => {
      expect(useGameModeStore.getState().active).toBe(false)
    })
  })

  it('auto-detect event updates detectedGame', async () => {
    mockSettingsGet.mockResolvedValue({})
    mockGameModeStatus.mockResolvedValue({ active: false, activatedAt: null, pendingRestore: false })
    initGameModeStore()

    const handler = mockOnGameModeAutoEvent.mock.calls[0]![0]
    handler({ type: 'game-detected', processName: 'Minecraft.exe' })

    await vi.waitFor(() => {
      expect(useGameModeStore.getState().detectedGame).toBe('Minecraft.exe')
    })
  })

  it('auto-detect event clears detectedGame on game-ended', async () => {
    mockSettingsGet.mockResolvedValue({})
    mockGameModeStatus.mockResolvedValue({ active: false, activatedAt: null, pendingRestore: false })
    useGameModeStore.setState({ detectedGame: 'Minecraft.exe' })

    initGameModeStore()

    const handler = mockOnGameModeAutoEvent.mock.calls[0]![0]
    handler({ type: 'game-ended' })

    await vi.waitFor(() => {
      expect(useGameModeStore.getState().detectedGame).toBeNull()
    })
  })

  it('does not throw when kudu is undefined', () => {
    ;(globalThis as any).window = {}
    expect(() => initGameModeStore()).not.toThrow()
  })

  it('auto-event pendingRestore defaults to false when status returns undefined', async () => {
    mockSettingsGet.mockResolvedValue({})
    mockGameModeStatus.mockResolvedValue({ active: false, activatedAt: null, pendingRestore: false })
    initGameModeStore()

    const handler = mockOnGameModeAutoEvent.mock.calls[0]![0]
    mockGameModeStatus.mockResolvedValue({ active: true, activatedAt: 'x', pendingRestore: undefined })
    handler({ type: 'game-detected', processName: 'Game.exe' })

    await vi.waitFor(() => {
      expect(useGameModeStore.getState().pendingRestore).toBe(false)
    })
  })

  it('pendingRestore defaults to false when status returns undefined', async () => {
    mockSettingsGet.mockResolvedValue({})
    mockGameModeStatus.mockResolvedValue({ active: false, activatedAt: null, pendingRestore: undefined })

    initGameModeStore()

    await vi.waitFor(() => {
      expect(useGameModeStore.getState().pendingRestore).toBe(false)
    })
  })
})

describe('game-mode-store - setGameProfile', () => {
  it('sets a game profile and persists', () => {
    const profile: GameProfile = {
      gameName: 'Minecraft.exe',
      enabledOptimizations: ['svc-wsearch'],
    }
    useGameModeStore.getState().setGameProfile('Minecraft.exe', profile)
    const state = useGameModeStore.getState()
    expect(state.config.gameProfiles['Minecraft.exe']).toEqual(profile)
    expect(mockSettingsSet).toHaveBeenCalledWith({
      gameMode: expect.objectContaining({
        gameProfiles: { 'Minecraft.exe': profile },
      }),
    })
  })

  it('removes a game profile when profile is null', () => {
    useGameModeStore.setState({
      config: {
        enabledOptimizations: [],
        customProcessKillList: [],
        autoDetect: false,
        autoDeactivate: true,
        customGameProcesses: [],
        gameProfiles: {
          'Minecraft.exe': {
            gameName: 'Minecraft.exe',
            enabledOptimizations: [],
          },
        },
      },
    })
    useGameModeStore.getState().setGameProfile('Minecraft.exe', null)
    const state = useGameModeStore.getState()
    expect(state.config.gameProfiles['Minecraft.exe']).toBeUndefined()
    expect(mockSettingsSet).toHaveBeenCalled()
  })
})
