// @vitest-environment jsdom

import type { ClipInfo, ClipsConfig, ClipsEngineStatus } from '@shared/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useClipsState } from './useClipsState'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const captured = vi.hoisted(() => ({ deps: null as Record<string, unknown> | null }))

vi.mock('./useClipsActions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useClipsActions')>()
  return {
    ...actual,
    useClipsActions: (deps: Record<string, unknown>) => {
      captured.deps = deps
      return {
        handleStartRecording: vi.fn(),
        handleStopRecording: vi.fn(),
        handleSaveClip: vi.fn(),
        handleDeleteClip: vi.fn(),
        handleDeleteSelected: vi.fn(),
        handleOpenClip: vi.fn(),
        handleRenameClip: vi.fn(),
        handleConfigUpdate: vi.fn(),
        handleSelectOutputDir: vi.fn(),
        handlePublishClip: vi.fn(),
        handleCancelPublish: vi.fn(),
        toggleFavorite: vi.fn(),
        addHotkey: vi.fn(),
        removeHotkey: vi.fn(),
        updateHotkey: vi.fn(),
        setupRebindingListeners: vi.fn(() => vi.fn()),
      }
    },
  }
})

type MockFn = ReturnType<typeof vi.fn>

type RamData = { level?: 'normal' | 'critical'; usedPercent?: number }
type ProgressData = { clipPath: string; percent?: number }

const listeners: {
  engineStatus?: (s: ClipsEngineStatus) => void
  clipSaved?: () => void
  ramPressure?: (d: RamData) => void
  durationsReady?: () => void
  publishProgress?: (d: ProgressData) => void
} = {}

const runningStatus: ClipsEngineStatus = {
  running: true,
  capturing: true,
  uptime: 5,
  fps: 60,
  replayTimeSeconds: 120,
}

const makeClip = (overrides: Partial<ClipInfo> = {}): ClipInfo => ({
  name: 'a.mp4',
  path: 'C:\\Clips\\a.mp4',
  size: 1000,
  createdAt: new Date().toISOString(),
  duration: 10,
  ...overrides,
})

const makeConfig = (overrides: Partial<ClipsConfig> = {}): ClipsConfig =>
  ({
    replayTimeSeconds: 120,
    micEnabled: false,
    fps: 60,
    maxrateKbps: 50000,
    ...overrides,
  }) as unknown as ClipsConfig

function makeDinho(overrides: Record<string, MockFn> = {}): Record<string, MockFn> {
  const base: Record<string, MockFn> = {
    clipsGetStatus: vi.fn().mockResolvedValue({ ...runningStatus, running: false, capturing: false }),
    clipsGetConfig: vi.fn().mockResolvedValue(makeConfig()),
    clipsList: vi.fn().mockResolvedValue([]),
    clipsGetMicDevices: vi.fn().mockResolvedValue([]),
    clipsGetGpus: vi.fn().mockResolvedValue([]),
    clipsGetThumbnail: vi.fn().mockResolvedValue(null),
    gameModeDetectorStart: vi.fn(),
    gameModeDetectorStop: vi.fn(),
    clipsOnEngineStatus: vi.fn((cb: (s: ClipsEngineStatus) => void) => {
      listeners.engineStatus = cb
      return vi.fn()
    }),
    clipsOnClipSaved: vi.fn((cb: () => void) => {
      listeners.clipSaved = cb
      return vi.fn()
    }),
    clipsOnRamPressure: vi.fn((cb: (d: RamData) => void) => {
      listeners.ramPressure = cb
      return vi.fn()
    }),
    clipsOnDurationsReady: vi.fn((cb: () => void) => {
      listeners.durationsReady = cb
      return vi.fn()
    }),
    clipsOnPublishProgress: vi.fn((cb: (d: ProgressData) => void) => {
      listeners.publishProgress = cb
      return vi.fn()
    }),
    ...overrides,
  }
  window.dinho = base as never
  return base
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

const flushInitial = () =>
  act(async () => {
    await tick()
  })

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  captured.deps = null
  for (const key of Object.keys(listeners)) delete listeners[key as keyof typeof listeners]
})

describe('useClipsState', () => {
  it('loads status, config and clips on mount', async () => {
    const dinho = makeDinho({ clipsList: vi.fn().mockResolvedValue([makeClip()]) })
    const { result } = renderHook(() => useClipsState())

    await waitFor(() => expect(result.current.clipsLoaded).toBe(true))

    expect(dinho.clipsGetStatus).toHaveBeenCalled()
    expect(dinho.clipsGetConfig).toHaveBeenCalled()
    expect(dinho.clipsList).toHaveBeenCalled()
    expect(result.current.statusLoaded).toBe(true)
    expect(result.current.clips).toHaveLength(1)
    expect(result.current.refreshing).toBe(false)
    expect(dinho.gameModeDetectorStart).toHaveBeenCalled()
  })

  it('stops the game mode detector on unmount', async () => {
    const dinho = makeDinho()
    const { unmount } = renderHook(() => useClipsState())

    await waitFor(() => expect(dinho.gameModeDetectorStart).toHaveBeenCalled())
    unmount()

    expect(dinho.gameModeDetectorStop).toHaveBeenCalled()
  })

  it('restores favorites and published links from localStorage', async () => {
    localStorage.setItem('clips-favorites', JSON.stringify(['a.mp4']))
    localStorage.setItem('clips-published', JSON.stringify({ 'C:\\Clips\\a.mp4': 'https://x' }))
    makeDinho()

    const { result } = renderHook(() => useClipsState())
    await flushInitial()

    expect(result.current.favorites.has('a.mp4')).toBe(true)
    expect(result.current.publishedLinks['C:\\Clips\\a.mp4']).toBe('https://x')
  })

  it('falls back to empty collections when persisted data is corrupt', async () => {
    localStorage.setItem('clips-favorites', '{not json')
    localStorage.setItem('clips-published', '{not json')
    makeDinho()

    const { result } = renderHook(() => useClipsState())
    await flushInitial()

    expect(result.current.favorites.size).toBe(0)
    expect(result.current.publishedLinks).toEqual({})
  })

  it('closes the active tooltip on Escape and ignores other keys', async () => {
    makeDinho()
    const { result } = renderHook(() => useClipsState())
    await flushInitial()

    act(() => result.current.setActiveTip('quality'))
    expect(result.current.activeTip).toBe('quality')

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })
    expect(result.current.activeTip).toBe('quality')

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(result.current.activeTip).toBeNull()
  })

  it('opens the editor in normal mode and the player in fullscreen mode', async () => {
    makeDinho()
    const { result } = renderHook(() => useClipsState())
    await flushInitial()
    const clip = makeClip()

    act(() => result.current.openClipEditor(clip))
    expect(result.current.editingClip).toEqual(clip)
    expect(result.current.editingClipFullscreen).toBe(false)

    act(() => result.current.openClipPlayer(clip))
    expect(result.current.editingClip).toEqual(clip)
    expect(result.current.editingClipFullscreen).toBe(true)
  })

  it('keeps the current clips when the list request returns nothing', async () => {
    makeDinho({ clipsList: vi.fn().mockResolvedValue(undefined) })
    const { result } = renderHook(() => useClipsState())

    await waitFor(() => expect(result.current.clipsLoaded).toBe(true))
    expect(result.current.clips).toEqual([])
  })

  it('logs an error and clears the refreshing flag when the list request rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    makeDinho({ clipsList: vi.fn().mockRejectedValue(new Error('boom')) })

    const { result } = renderHook(() => useClipsState())
    await waitFor(() => expect(errorSpy).toHaveBeenCalled())
    expect(result.current.refreshing).toBe(false)
    errorSpy.mockRestore()
  })

  it('ignores an empty status response', async () => {
    makeDinho({ clipsGetStatus: vi.fn().mockResolvedValue(null) })
    const { result } = renderHook(() => useClipsState())

    await waitFor(() => expect(result.current.statusLoaded).toBe(true))
    expect(result.current.status.running).toBe(false)
  })

  it('ignores status and config request failures', async () => {
    makeDinho({
      clipsGetStatus: vi.fn().mockRejectedValue(new Error('status')),
      clipsGetConfig: vi.fn().mockRejectedValue(new Error('config')),
    })
    const { result } = renderHook(() => useClipsState())

    await waitFor(() => expect(result.current.clipsLoaded).toBe(true))
    expect(result.current.config).toBeNull()
    expect(result.current.status.running).toBe(false)
  })

  it('loads mic devices once the status has loaded', async () => {
    const dinho = makeDinho({
      clipsGetMicDevices: vi
        .fn()
        .mockResolvedValue([{ id: 'm1', name: 'Mic', isDefault: true, channels: 2, sampleRate: 48000 }]),
    })
    const { result } = renderHook(() => useClipsState())

    await waitFor(() => expect(result.current.micDevices).toHaveLength(1))
    expect(dinho.clipsGetMicDevices).toHaveBeenCalled()
    expect(result.current.loadingMicDevices).toBe(false)
  })

  it('keeps the mic list empty when the engine returns null', async () => {
    makeDinho({ clipsGetMicDevices: vi.fn().mockResolvedValue(null) })
    const { result } = renderHook(() => useClipsState())

    await waitFor(() => expect(result.current.statusLoaded).toBe(true))
    await waitFor(() => expect(result.current.loadingMicDevices).toBe(false))
    expect(result.current.micDevices).toEqual([])
  })

  it('keeps the mic list empty when the engine returns no devices', async () => {
    makeDinho({ clipsGetMicDevices: vi.fn().mockResolvedValue([]) })
    const { result } = renderHook(() => useClipsState())

    await waitFor(() => expect(result.current.statusLoaded).toBe(true))
    await waitFor(() => expect(result.current.loadingMicDevices).toBe(false))
    expect(result.current.micDevices).toEqual([])
  })

  it('ignores mic device request failures', async () => {
    makeDinho({ clipsGetMicDevices: vi.fn().mockRejectedValue(new Error('mic')) })
    const { result } = renderHook(() => useClipsState())

    await waitFor(() => expect(result.current.statusLoaded).toBe(true))
    await waitFor(() => expect(result.current.loadingMicDevices).toBe(false))
    expect(result.current.micDevices).toEqual([])
  })

  it('reloads mic devices when the engine starts running', async () => {
    const dinho = makeDinho({ clipsGetMicDevices: vi.fn().mockResolvedValue([]) })
    renderHook(() => useClipsState())

    await waitFor(() => expect(dinho.clipsGetMicDevices).toHaveBeenCalledTimes(1))
    act(() => listeners.engineStatus?.(runningStatus))

    await waitFor(() => expect(dinho.clipsGetMicDevices).toHaveBeenCalledTimes(2))
  })

  it('loads the GPU list once', async () => {
    const dinho = makeDinho({
      clipsGetGpus: vi.fn().mockResolvedValue([{ index: 0, name: 'RX 7900', vendorId: 0x1002 }]),
    })
    const { result } = renderHook(() => useClipsState())

    await waitFor(() => expect(result.current.gpuList).toHaveLength(1))
    expect(dinho.clipsGetGpus).toHaveBeenCalledTimes(1)
  })

  it('keeps the GPU list empty when the engine reports none', async () => {
    makeDinho({ clipsGetGpus: vi.fn().mockResolvedValue([]) })
    const { result } = renderHook(() => useClipsState())

    await waitFor(() => expect(result.current.statusLoaded).toBe(true))
    await waitFor(() => expect(result.current.loadingMicDevices).toBe(false))
    expect(result.current.gpuList).toEqual([])
  })

  it('ignores GPU request failures', async () => {
    makeDinho({ clipsGetGpus: vi.fn().mockRejectedValue(new Error('gpu')) })
    const { result } = renderHook(() => useClipsState())

    await waitFor(() => expect(result.current.statusLoaded).toBe(true))
    await waitFor(() => expect(result.current.loadingMicDevices).toBe(false))
    expect(result.current.gpuList).toEqual([])
  })

  it('loads thumbnails for the listed clips', async () => {
    makeDinho({
      clipsList: vi.fn().mockResolvedValue([makeClip({ name: 'a.mp4' }), makeClip({ name: 'b.mp4' })]),
      clipsGetThumbnail: vi.fn().mockResolvedValue('data:image/png;base64,AA'),
    })
    const { result } = renderHook(() => useClipsState())

    await waitFor(() => expect(result.current.thumbnails['a.mp4']).toBe('data:image/png;base64,AA'))
    expect(result.current.thumbnails['b.mp4']).toBe('data:image/png;base64,AA')
  })

  it('skips thumbnails the engine cannot produce', async () => {
    makeDinho({
      clipsList: vi.fn().mockResolvedValue([makeClip()]),
      clipsGetThumbnail: vi.fn().mockResolvedValue(null),
    })
    const { result } = renderHook(() => useClipsState())

    await waitFor(() => expect(result.current.clipsLoaded).toBe(true))
    await act(async () => {
      await tick()
    })
    expect(result.current.thumbnails).toEqual({})
  })

  it('ignores thumbnail request failures', async () => {
    makeDinho({
      clipsList: vi.fn().mockResolvedValue([makeClip()]),
      clipsGetThumbnail: vi.fn().mockRejectedValue(new Error('thumb')),
    })
    const { result } = renderHook(() => useClipsState())

    await waitFor(() => expect(result.current.clipsLoaded).toBe(true))
    await act(async () => {
      await tick()
    })
    expect(result.current.thumbnails).toEqual({})
  })

  it('stops loading thumbnail batches after unmount', async () => {
    let resolveThumb: ((value: string) => void) | undefined
    const thumbPromise = new Promise<string>((resolve) => {
      resolveThumb = resolve
    })
    const clips = Array.from({ length: 7 }, (_, i) => makeClip({ name: `c${i}.mp4` }))
    const dinho = makeDinho({
      clipsList: vi.fn().mockResolvedValue(clips),
      clipsGetThumbnail: vi.fn(() => thumbPromise),
    })

    const { unmount } = renderHook(() => useClipsState())
    await waitFor(() => expect(dinho.clipsGetThumbnail).toHaveBeenCalled())
    await act(async () => {
      await tick()
    })
    expect(dinho.clipsGetThumbnail).toHaveBeenCalledTimes(6)

    unmount()
    resolveThumb?.('data:x')
    await act(async () => {
      await Promise.resolve()
    })
    expect(dinho.clipsGetThumbnail).toHaveBeenCalledTimes(6)
  })

  it('toasts and refreshes clips when the engine saves a clip', async () => {
    const dinho = makeDinho()
    renderHook(() => useClipsState())

    await waitFor(() => expect(dinho.clipsList).toHaveBeenCalledTimes(1))
    act(() => listeners.clipSaved?.())

    await waitFor(() => expect(dinho.clipsList).toHaveBeenCalledTimes(2))
    expect(toast.success).toHaveBeenCalledWith('clipSaved')
  })

  it('refreshes clips when durations are ready', async () => {
    const dinho = makeDinho()
    renderHook(() => useClipsState())

    await waitFor(() => expect(dinho.clipsList).toHaveBeenCalledTimes(1))
    act(() => listeners.durationsReady?.())

    await waitFor(() => expect(dinho.clipsList).toHaveBeenCalledTimes(2))
  })

  it('warns on critical RAM pressure, dedupes levels and notifies recovery', async () => {
    makeDinho()
    renderHook(() => useClipsState())
    await flushInitial()

    act(() => listeners.ramPressure?.({ level: 'critical', usedPercent: 0.9 }))
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(toast.warning).toHaveBeenCalledWith('ramPressureCritical', {
      description: 'ramPressureCriticalDesc',
    })

    act(() => listeners.ramPressure?.({ level: 'critical', usedPercent: 0.9 }))
    expect(toast.warning).toHaveBeenCalledTimes(1)

    act(() => listeners.ramPressure?.({ level: 'normal' }))
    expect(toast.success).toHaveBeenCalledWith('ramPressureNormal')
  })

  it('defaults missing RAM pressure fields', async () => {
    makeDinho()
    renderHook(() => useClipsState())
    await flushInitial()

    act(() => listeners.ramPressure?.({}))
    expect(toast.warning).not.toHaveBeenCalled()

    act(() => listeners.ramPressure?.({ level: 'critical' }))
    expect(toast.warning).toHaveBeenCalledTimes(1)

    act(() => listeners.ramPressure?.({}))
    expect(toast.success).toHaveBeenCalledWith('ramPressureNormal')
  })

  it('tracks publish progress only for the clip being published', async () => {
    makeDinho()
    const { result } = renderHook(() => useClipsState())
    await flushInitial()
    const setPublishingPath = captured.deps?.setPublishingPath as (path: string | null) => void

    act(() => setPublishingPath('C:\\Clips\\a.mp4'))

    act(() => listeners.publishProgress?.({ clipPath: 'C:\\Clips\\b.mp4', percent: 10 }))
    expect(result.current.publishProgress).toBe(0)

    act(() => listeners.publishProgress?.({ clipPath: 'C:\\Clips\\a.mp4', percent: 42 }))
    expect(result.current.publishProgress).toBe(42)

    act(() => listeners.publishProgress?.({ clipPath: 'C:\\Clips\\a.mp4' }))
    expect(result.current.publishProgress).toBe(0)
  })

  it('updates published links and tolerates identical writes', async () => {
    makeDinho()
    const { result } = renderHook(() => useClipsState())
    await flushInitial()

    act(() => result.current.setPublishedLink('C:\\Clips\\a.mp4', 'https://x'))
    expect(result.current.publishedLinks['C:\\Clips\\a.mp4']).toBe('https://x')

    act(() => result.current.setPublishedLink('C:\\Clips\\a.mp4', 'https://x'))
    expect(result.current.publishedLinks['C:\\Clips\\a.mp4']).toBe('https://x')

    act(() => result.current.setPublishedLink('C:\\Clips\\a.mp4', 'https://y'))
    expect(result.current.publishedLinks['C:\\Clips\\a.mp4']).toBe('https://y')
  })

  it('filters clips by tab, favorites and search', async () => {
    localStorage.setItem('clips-favorites', JSON.stringify(['today.mp4']))
    const now = Date.now()
    const clips = [
      makeClip({ name: 'today.mp4', createdAt: new Date(now).toISOString() }),
      makeClip({ name: 'week.mp4', createdAt: new Date(now - 3 * 86_400_000).toISOString() }),
      makeClip({ name: 'old.mp4', createdAt: new Date(now - 40 * 86_400_000).toISOString() }),
      makeClip({ name: 'epoch.mp4', createdAt: '1970-01-01T00:00:00.000Z' }),
    ]
    makeDinho({ clipsList: vi.fn().mockResolvedValue(clips) })
    const { result } = renderHook(() => useClipsState())

    await waitFor(() => expect(result.current.clips).toHaveLength(4))
    expect(result.current.filteredClips).toHaveLength(4)

    act(() => result.current.setFilterTab('today'))
    expect(result.current.filteredClips.map((c) => c.name).sort()).toEqual(['epoch.mp4', 'today.mp4'])

    act(() => result.current.setFilterTab('week'))
    expect(result.current.filteredClips.map((c) => c.name).sort()).toEqual(['epoch.mp4', 'today.mp4', 'week.mp4'])

    act(() => result.current.setFilterTab('favorites'))
    expect(result.current.filteredClips.map((c) => c.name).sort()).toEqual(['epoch.mp4', 'today.mp4'])

    act(() => result.current.setFilterTab('all'))
    act(() => result.current.setSearchQuery('WEEK'))
    expect(result.current.filteredClips.map((c) => c.name)).toEqual(['week.mp4', 'epoch.mp4'])
  })

  it('estimates RAM from config and falls back to defaults', async () => {
    makeDinho({ clipsGetConfig: vi.fn().mockResolvedValue(null) })
    const { result } = renderHook(() => useClipsState())
    await flushInitial()
    const setConfig = captured.deps?.setConfig as (value: ClipsConfig) => void

    expect(result.current.estimatedRamMB).toBe(0)

    act(() => setConfig(makeConfig({ maxrateKbps: 0, replayTimeSeconds: 0 })))
    expect(result.current.estimatedRamMB).toBe(769)

    act(() => setConfig(makeConfig({ maxrateKbps: 100_000, replayTimeSeconds: 30 })))
    expect(result.current.estimatedRamMB).toBe(385)
  })

  it('applies engine status events and refreshes clips when capture starts', async () => {
    const dinho = makeDinho()
    const { result } = renderHook(() => useClipsState())

    await waitFor(() => expect(result.current.clipsLoaded).toBe(true))
    const before = dinho.clipsList!.mock.calls.length

    act(() => listeners.engineStatus?.(runningStatus))

    await waitFor(() => expect(result.current.status.running).toBe(true))
    await waitFor(() => expect(dinho.clipsList!.mock.calls.length).toBeGreaterThan(before))
  })

  it('exposes the save trigger for e2e and clears it on unmount', async () => {
    makeDinho()
    const { unmount } = renderHook(() => useClipsState())
    await flushInitial()
    const win = window as unknown as Record<string, unknown>

    expect(win.__clipsSaveClip).toBeDefined()
    unmount()
    expect(win.__clipsSaveClip).toBeUndefined()
  })
})
