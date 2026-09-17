// @vitest-environment jsdom
import type { ClipsConfig, HotkeyBinding } from '@shared/types'
import { act, renderHook } from '@testing-library/react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatClipsDate, formatClipsSeconds, formatClipsSize, useClipsActions } from './useClipsActions'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('./clips-utils', () => ({
  MODIFIER_KEYS: new Set([0x11, 0x10, 0x12]),
}))

type Dinho = {
  clipsSetConfig: ReturnType<typeof vi.fn>
  clipsStartEngine: ReturnType<typeof vi.fn>
  clipsStartCapture: ReturnType<typeof vi.fn>
  clipsStopCapture: ReturnType<typeof vi.fn>
  clipsStopEngine: ReturnType<typeof vi.fn>
  clipsSaveClip: ReturnType<typeof vi.fn>
  clipsDelete: ReturnType<typeof vi.fn>
  clipsRename: ReturnType<typeof vi.fn>
  clipsOpen: ReturnType<typeof vi.fn>
  clipsSelectOutputDir: ReturnType<typeof vi.fn>
  clipsSetFavorite: ReturnType<typeof vi.fn>
  clipsPublish: ReturnType<typeof vi.fn>
  clipsPublishCancel: ReturnType<typeof vi.fn>
}

function mockDinho(): Dinho {
  const base: Dinho = {
    clipsSetConfig: vi.fn(),
    clipsStartEngine: vi.fn(),
    clipsStartCapture: vi.fn(),
    clipsStopCapture: vi.fn(),
    clipsStopEngine: vi.fn(),
    clipsSaveClip: vi.fn(),
    clipsDelete: vi.fn(),
    clipsRename: vi.fn(),
    clipsOpen: vi.fn(),
    clipsSelectOutputDir: vi.fn(),
    clipsSetFavorite: vi.fn(),
    clipsPublish: vi.fn(),
    clipsPublishCancel: vi.fn(),
  }
  window.dinho = base as never
  return base
}

function makeConfig(overrides: Partial<ClipsConfig> = {}): ClipsConfig {
  return { hotkeys: [], pushToTalkKeys: [], ...overrides } as unknown as ClipsConfig
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    config: makeConfig(),
    status: { running: true, capturing: false },
    selectedClips: new Set<string>(),
    favorites: new Set<string>(),
    setStarting: vi.fn(),
    setStopping: vi.fn(),
    setLoading: vi.fn(),
    setConfig: vi.fn(),
    setFavorites: vi.fn(),
    setRebindingId: vi.fn(),
    setPublishingPath: vi.fn(),
    setPublishProgress: vi.fn(),
    setPublishResult: vi.fn(),
    setPublishedLink: vi.fn(),
    refreshClips: vi.fn().mockResolvedValue(undefined),
    refreshConfig: vi.fn().mockResolvedValue(undefined),
    refreshStatus: vi.fn().mockResolvedValue(undefined),
    setSelectedClips: vi.fn(),
    t: vi.fn((key: string) => key),
    ...overrides,
  }
}

function getDeps(deps: unknown) {
  return deps as ReturnType<typeof makeDeps>
}

beforeEach(() => {
  vi.clearAllMocks()
  window.confirm = vi.fn(() => true) as never
})

describe('useClipsActions', () => {
  describe('handleConfigUpdate', () => {
    it('merges the partial into config, pushes via IPC, and refreshes config', async () => {
      const dinho = mockDinho()
      dinho.clipsSetConfig.mockResolvedValue(true)
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleConfigUpdate({ replayTimeSeconds: 300 })
      })

      const updater = deps.setConfig.mock.calls[0]![0]
      expect(updater({ replayTimeSeconds: 60 })).toEqual({ replayTimeSeconds: 300 })
      expect(dinho.clipsSetConfig).toHaveBeenCalledWith({ replayTimeSeconds: 300 })
      expect(deps.refreshConfig).toHaveBeenCalled()
    })

    it('leaves config unchanged when it is null', async () => {
      mockDinho()
      const deps = getDeps(makeDeps({ config: null }))
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleConfigUpdate({ replayTimeSeconds: 300 })
      })

      const updater = deps.setConfig.mock.calls[0]![0]
      expect(updater(null)).toBeNull()
    })
  })

  describe('handleStartRecording', () => {
    it('starts engine and capture, then reports success', async () => {
      const dinho = mockDinho()
      dinho.clipsStartEngine.mockResolvedValue({ success: true })
      dinho.clipsStartCapture.mockResolvedValue({ success: true })
      const deps = getDeps(makeDeps({ status: { running: false, capturing: false } }))
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleStartRecording()
      })

      expect(dinho.clipsStartEngine).toHaveBeenCalled()
      expect(dinho.clipsStartCapture).toHaveBeenCalled()
      expect(toast.success).toHaveBeenCalledWith('recordingStarted')
      expect(deps.refreshStatus).toHaveBeenCalled()
      expect(deps.setStarting).toHaveBeenCalledWith(true)
      expect(deps.setStarting).toHaveBeenLastCalledWith(false)
    })

    it('skips starting the engine when already running', async () => {
      const dinho = mockDinho()
      dinho.clipsStartCapture.mockResolvedValue({ success: true })
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleStartRecording()
      })

      expect(dinho.clipsStartEngine).not.toHaveBeenCalled()
    })

    it('reports engine start failure without attempting capture', async () => {
      const dinho = mockDinho()
      dinho.clipsStartEngine.mockResolvedValue({ success: false, error: 'engine down' })
      const deps = getDeps(makeDeps({ status: { running: false, capturing: false } }))
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleStartRecording()
      })

      expect(toast.error).toHaveBeenCalledWith('engine down')
      expect(dinho.clipsStartCapture).not.toHaveBeenCalled()
      expect(deps.setStarting).toHaveBeenLastCalledWith(false)
    })

    it('retries capture up to 3 times and reports failure', async () => {
      const dinho = mockDinho()
      dinho.clipsStartCapture.mockResolvedValue({ success: false })
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      vi.useFakeTimers()
      try {
        await act(async () => {
          const p = result.current.handleStartRecording()
          await vi.advanceTimersByTimeAsync(2000)
          await vi.advanceTimersByTimeAsync(2000)
          await p
        })
      } finally {
        vi.useRealTimers()
      }

      expect(dinho.clipsStartCapture).toHaveBeenCalledTimes(3)
      expect(toast.error).toHaveBeenCalledWith('failedToStart')
    })

    it('succeeds on the second capture attempt', async () => {
      const dinho = mockDinho()
      dinho.clipsStartCapture.mockResolvedValueOnce({ success: false }).mockResolvedValueOnce({ success: true })
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      vi.useFakeTimers()
      try {
        await act(async () => {
          const p = result.current.handleStartRecording()
          await vi.advanceTimersByTimeAsync(2000)
          await p
        })
      } finally {
        vi.useRealTimers()
      }

      expect(toast.success).toHaveBeenCalledWith('recordingStarted')
    })

    it('surfaces unexpected errors', async () => {
      const dinho = mockDinho()
      dinho.clipsStartCapture.mockRejectedValue(new Error('capture exploded'))
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleStartRecording()
      })

      expect(toast.error).toHaveBeenCalledWith('Error: capture exploded')
      expect(deps.setStarting).toHaveBeenLastCalledWith(false)
    })
  })

  describe('handleStopRecording', () => {
    it('stops capture and engine and reports success', async () => {
      const dinho = mockDinho()
      dinho.clipsStopCapture.mockResolvedValue(true)
      dinho.clipsStopEngine.mockResolvedValue(true)
      const deps = getDeps(makeDeps({ status: { running: true, capturing: true } }))
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleStopRecording()
      })

      expect(dinho.clipsStopCapture).toHaveBeenCalled()
      expect(dinho.clipsStopEngine).toHaveBeenCalled()
      expect(toast.success).toHaveBeenCalledWith('recordingStopped')
      expect(deps.refreshStatus).toHaveBeenCalled()
      expect(deps.setStopping).toHaveBeenLastCalledWith(false)
    })

    it('only stops the engine when not capturing', async () => {
      const dinho = mockDinho()
      dinho.clipsStopEngine.mockResolvedValue(true)
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleStopRecording()
      })

      expect(dinho.clipsStopCapture).not.toHaveBeenCalled()
      expect(dinho.clipsStopEngine).toHaveBeenCalled()
    })

    it('surfaces unexpected errors', async () => {
      const dinho = mockDinho()
      dinho.clipsStopEngine.mockRejectedValue(new Error('stop failed'))
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleStopRecording()
      })

      expect(toast.error).toHaveBeenCalledWith('Error: stop failed')
    })
  })

  describe('handleSaveClip', () => {
    it('reports success and refreshes the clip list', async () => {
      const dinho = mockDinho()
      dinho.clipsSaveClip.mockResolvedValue({ success: true })
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleSaveClip()
      })

      expect(toast.success).toHaveBeenCalledWith('clipSaved')
      expect(deps.refreshClips).toHaveBeenCalled()
      expect(deps.setLoading).toHaveBeenLastCalledWith(false)
    })

    it('shows the engine error when save fails', async () => {
      const dinho = mockDinho()
      dinho.clipsSaveClip.mockResolvedValue({ success: false, error: 'no space' })
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleSaveClip()
      })

      expect(toast.error).toHaveBeenCalledWith('no space')
    })

    it('surfaces unexpected errors', async () => {
      const dinho = mockDinho()
      dinho.clipsSaveClip.mockRejectedValue(new Error('boom'))
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleSaveClip()
      })

      expect(toast.error).toHaveBeenCalledWith('Error: boom')
    })
  })

  describe('handleDeleteClip', () => {
    it('deletes the clip after confirmation and refreshes', async () => {
      const dinho = mockDinho()
      dinho.clipsDelete.mockResolvedValue({ success: true })
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleDeleteClip('clip1.mp4')
      })

      expect(window.confirm).toHaveBeenCalledWith('deleteConfirm')
      expect(dinho.clipsDelete).toHaveBeenCalledWith('clip1.mp4')
      expect(deps.refreshClips).toHaveBeenCalled()
    })

    it('does nothing when confirmation is declined', async () => {
      const dinho = mockDinho()
      window.confirm = vi.fn(() => false) as never
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleDeleteClip('clip1.mp4')
      })

      expect(dinho.clipsDelete).not.toHaveBeenCalled()
    })

    it('shows the engine error when delete fails', async () => {
      const dinho = mockDinho()
      dinho.clipsDelete.mockResolvedValue({ success: false, error: 'locked' })
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleDeleteClip('clip1.mp4')
      })

      expect(toast.error).toHaveBeenCalledWith('locked')
    })
  })

  describe('handleDeleteSelected', () => {
    it('deletes every selected clip, clears selection, and refreshes', async () => {
      const dinho = mockDinho()
      dinho.clipsDelete.mockResolvedValue({ success: true })
      const deps = getDeps(makeDeps({ selectedClips: new Set(['a.mp4', 'b.mp4']) }))
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleDeleteSelected()
      })

      expect(window.confirm).toHaveBeenCalledWith('deleteMultipleConfirm')
      expect(dinho.clipsDelete).toHaveBeenCalledTimes(2)
      expect(deps.setSelectedClips).toHaveBeenCalledWith(new Set())
      expect(deps.refreshClips).toHaveBeenCalled()
    })

    it('ignores per-clip delete failures', async () => {
      const dinho = mockDinho()
      dinho.clipsDelete.mockRejectedValue(new Error('locked'))
      const deps = getDeps(makeDeps({ selectedClips: new Set(['a.mp4']) }))
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleDeleteSelected()
      })

      expect(toast.error).not.toHaveBeenCalled()
      expect(deps.refreshClips).toHaveBeenCalled()
    })

    it('returns early when nothing is selected', async () => {
      const dinho = mockDinho()
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleDeleteSelected()
      })

      expect(window.confirm).not.toHaveBeenCalled()
      expect(dinho.clipsDelete).not.toHaveBeenCalled()
    })
  })

  describe('handleRenameClip', () => {
    it('renames the clip when a new name is given', async () => {
      const dinho = mockDinho()
      dinho.clipsRename.mockResolvedValue({ success: true })
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleRenameClip('old.mp4', 'new.mp4')
      })

      expect(dinho.clipsRename).toHaveBeenCalledWith('old.mp4', 'new.mp4')
      expect(deps.refreshClips).toHaveBeenCalled()
    })

    it('returns early when the name is unchanged', async () => {
      const dinho = mockDinho()
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleRenameClip('old.mp4', 'old.mp4')
      })

      expect(dinho.clipsRename).not.toHaveBeenCalled()
    })

    it('returns early when the name is blank', async () => {
      const dinho = mockDinho()
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleRenameClip('old.mp4', '   ')
      })

      expect(dinho.clipsRename).not.toHaveBeenCalled()
    })

    it('shows the engine error when rename fails', async () => {
      const dinho = mockDinho()
      dinho.clipsRename.mockResolvedValue({ success: false, error: 'exists' })
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleRenameClip('old.mp4', 'new.mp4')
      })

      expect(toast.error).toHaveBeenCalledWith('exists')
    })
  })

  describe('handleOpenClip', () => {
    it('opens the clip path', async () => {
      const dinho = mockDinho()
      dinho.clipsOpen.mockResolvedValue(true)
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleOpenClip('C:\\clips\\x.mp4')
      })

      expect(dinho.clipsOpen).toHaveBeenCalledWith('C:\\clips\\x.mp4')
    })

    it('ignores open errors', async () => {
      const dinho = mockDinho()
      dinho.clipsOpen.mockRejectedValue(new Error('denied'))
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleOpenClip('x.mp4')
      })

      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  describe('handlePublishClip', () => {
    function publishDeps(overrides: Record<string, unknown> = {}) {
      return getDeps(
        makeDeps({
          setPublishingPath: vi.fn(),
          setPublishProgress: vi.fn(),
          setPublishResult: vi.fn(),
          setPublishedLink: vi.fn(),
          ...overrides,
        }),
      )
    }

    it('sets the publish result from data.link on success', async () => {
      const dinho = mockDinho()
      dinho.clipsPublish.mockResolvedValue({ success: true, data: { link: 'https://gofile.io/d/abc' } })
      const deps = publishDeps()
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handlePublishClip('x.mp4', 'C:\\clips\\x.mp4')
      })

      expect(dinho.clipsPublish).toHaveBeenCalledWith('C:\\clips\\x.mp4')
      expect(deps.setPublishResult).toHaveBeenCalledWith({ link: 'https://gofile.io/d/abc' })
      expect(deps.setPublishedLink).toHaveBeenCalledWith('C:\\clips\\x.mp4', 'https://gofile.io/d/abc')
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('does not cache the link when the publish response has no link', async () => {
      const dinho = mockDinho()
      dinho.clipsPublish.mockResolvedValue({ success: true })
      const deps = publishDeps()
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handlePublishClip('x.mp4', 'C:\\clips\\x.mp4')
      })

      expect(deps.setPublishedLink).not.toHaveBeenCalled()
    })

    it('shows engine error when upload fails', async () => {
      const dinho = mockDinho()
      dinho.clipsPublish.mockResolvedValue({ success: false, error: 'Connection lost during upload' })
      const deps = publishDeps()
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handlePublishClip('x.mp4', 'C:\\clips\\x.mp4')
      })

      expect(toast.error).toHaveBeenCalledWith('Connection lost during upload')
      expect(deps.setPublishResult).not.toHaveBeenCalled()
    })

    it('falls back to generic toast when neither success link nor error is present', async () => {
      const dinho = mockDinho()
      dinho.clipsPublish.mockResolvedValue({ success: false })
      const deps = publishDeps()
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handlePublishClip('x.mp4', 'C:\\clips\\x.mp4')
      })

      expect(toast.error).toHaveBeenCalledWith('publishFailed')
    })

    it('surfaces unexpected errors', async () => {
      const dinho = mockDinho()
      dinho.clipsPublish.mockRejectedValue(new Error('boom'))
      const deps = publishDeps()
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handlePublishClip('x.mp4', 'C:\\clips\\x.mp4')
      })

      expect(toast.error).toHaveBeenCalledWith('publishFailed: boom')
      expect(deps.setPublishingPath).toHaveBeenLastCalledWith(null)
      expect(deps.setPublishProgress).toHaveBeenLastCalledWith(0)
    })

    it('shows an info toast when the upload is cancelled', async () => {
      const dinho = mockDinho()
      dinho.clipsPublish.mockResolvedValue({ success: false, code: 'ABORTED' })
      const deps = publishDeps()
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handlePublishClip('x.mp4', 'C:\\clips\\x.mp4')
      })

      expect(toast.info).toHaveBeenCalledWith('publishCancelled')
      expect(toast.error).not.toHaveBeenCalled()
      expect(deps.setPublishResult).not.toHaveBeenCalled()
    })

    it('resets publishing state after cancellation', async () => {
      const dinho = mockDinho()
      dinho.clipsPublish.mockResolvedValue({ success: false, code: 'ABORTED' })
      const deps = publishDeps()
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handlePublishClip('x.mp4', 'C:\\clips\\x.mp4')
      })

      expect(deps.setPublishingPath).toHaveBeenLastCalledWith(null)
      expect(deps.setPublishProgress).toHaveBeenLastCalledWith(0)
    })
  })

  describe('handleCancelPublish', () => {
    function cancelDeps(overrides: Record<string, unknown> = {}) {
      return getDeps(makeDeps(overrides))
    }

    it('requests cancellation for the given clip path', async () => {
      const dinho = mockDinho()
      dinho.clipsPublishCancel.mockResolvedValue({ success: true })
      const deps = cancelDeps()
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleCancelPublish('C:\\clips\\x.mp4')
      })

      expect(dinho.clipsPublishCancel).toHaveBeenCalledWith('C:\\clips\\x.mp4')
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('shows an error toast when cancellation fails', async () => {
      const dinho = mockDinho()
      dinho.clipsPublishCancel.mockResolvedValue({ success: false, error: 'No upload in progress' })
      const deps = cancelDeps()
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleCancelPublish('C:\\clips\\x.mp4')
      })

      expect(toast.error).toHaveBeenCalledWith('No upload in progress')
    })

    it('falls back to generic toast when cancellation fails without an error', async () => {
      const dinho = mockDinho()
      dinho.clipsPublishCancel.mockResolvedValue({ success: false })
      const deps = cancelDeps()
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleCancelPublish('C:\\clips\\x.mp4')
      })

      expect(toast.error).toHaveBeenCalledWith('publishCancelFailed')
    })
  })

  describe('handleSelectOutputDir', () => {
    it('updates the output directory when one is chosen', async () => {
      const dinho = mockDinho()
      dinho.clipsSelectOutputDir.mockResolvedValue('C:\\Clips')
      dinho.clipsSetConfig.mockResolvedValue(true)
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleSelectOutputDir()
      })

      expect(dinho.clipsSetConfig).toHaveBeenCalledWith({ outputDirectory: 'C:\\Clips' })
      expect(toast.success).toHaveBeenCalledWith('outputDirSelected')
    })

    it('does nothing when the dialog is cancelled', async () => {
      const dinho = mockDinho()
      dinho.clipsSelectOutputDir.mockResolvedValue(null)
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        await result.current.handleSelectOutputDir()
      })

      expect(dinho.clipsSetConfig).not.toHaveBeenCalled()
    })
  })

  describe('toggleFavorite', () => {
    it('adds a favorite and notifies the engine', async () => {
      const dinho = mockDinho()
      dinho.clipsSetFavorite.mockResolvedValue(true)
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        result.current.toggleFavorite('clip1.mp4')
      })

      expect(dinho.clipsSetFavorite).toHaveBeenCalledWith('clip1.mp4', true)
      const updater = deps.setFavorites.mock.calls[0]![0]
      expect(updater(new Set(['other.mp4']))).toEqual(new Set(['other.mp4', 'clip1.mp4']))
    })

    it('removes an existing favorite', async () => {
      const dinho = mockDinho()
      dinho.clipsSetFavorite.mockRejectedValue(new Error('offline'))
      const deps = getDeps(makeDeps({ favorites: new Set(['clip1.mp4']) }))
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        result.current.toggleFavorite('clip1.mp4')
      })

      expect(dinho.clipsSetFavorite).toHaveBeenCalledWith('clip1.mp4', false)
      const updater = deps.setFavorites.mock.calls[0]![0]
      expect(updater(new Set(['clip1.mp4']))).toEqual(new Set())
    })
  })

  describe('hotkey management', () => {
    it('adds a hotkey with the next free vk', async () => {
      const dinho = mockDinho()
      dinho.clipsSetConfig.mockResolvedValue(true)
      const existing: HotkeyBinding = {
        id: 'hk-1',
        vk: 0x7c,
        modifiers: [],
        action: 'saveClip',
        replayDurationSeconds: 60,
        enabled: true,
      }
      const deps = getDeps(makeDeps({ config: makeConfig({ hotkeys: [existing] }) }))
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        result.current.addHotkey()
      })

      const [patch] = dinho.clipsSetConfig.mock.calls[0]!
      const hotkeys = (patch as { hotkeys: HotkeyBinding[] }).hotkeys
      expect(hotkeys).toHaveLength(2)
      expect(hotkeys[1]!.vk).toBe(0x7d)
      expect(hotkeys[1]!.action).toBe('saveClip')
      expect(hotkeys[1]!.enabled).toBe(true)
    })

    it('does nothing when there is no config', async () => {
      const dinho = mockDinho()
      const deps = getDeps(makeDeps({ config: null }))
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        result.current.addHotkey()
        result.current.removeHotkey('hk-1')
        result.current.updateHotkey('hk-1', { vk: 0x50 })
      })

      expect(dinho.clipsSetConfig).not.toHaveBeenCalled()
    })

    it('removes the matching hotkey', async () => {
      const dinho = mockDinho()
      dinho.clipsSetConfig.mockResolvedValue(true)
      const hk: HotkeyBinding = {
        id: 'hk-1',
        vk: 0x50,
        modifiers: [],
        action: 'saveClip',
        replayDurationSeconds: 60,
        enabled: true,
      }
      const deps = getDeps(makeDeps({ config: makeConfig({ hotkeys: [hk] }) }))
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        result.current.removeHotkey('hk-1')
      })

      const [patch] = dinho.clipsSetConfig.mock.calls[0]!
      expect((patch as { hotkeys: HotkeyBinding[] }).hotkeys).toEqual([])
    })

    it('patches the matching hotkey', async () => {
      const dinho = mockDinho()
      dinho.clipsSetConfig.mockResolvedValue(true)
      const hk: HotkeyBinding = {
        id: 'hk-1',
        vk: 0x50,
        modifiers: [],
        action: 'saveClip',
        replayDurationSeconds: 60,
        enabled: true,
      }
      const deps = getDeps(makeDeps({ config: makeConfig({ hotkeys: [hk] }) }))
      const { result } = renderHook(() => useClipsActions(deps))

      await act(async () => {
        result.current.updateHotkey('hk-1', { vk: 0x51 })
      })

      const [patch] = dinho.clipsSetConfig.mock.calls[0]!
      const hotkeys = (patch as { hotkeys: HotkeyBinding[] }).hotkeys
      expect(hotkeys[0]!.vk).toBe(0x51)
      expect(hotkeys[0]!.id).toBe('hk-1')
    })
  })

  describe('setupRebindingListeners', () => {
    function dispatchKey(opts: KeyboardEventInit) {
      window.dispatchEvent(new KeyboardEvent('keydown', opts))
    }
    function dispatchMouse(button: number) {
      window.dispatchEvent(new MouseEvent('mousedown', { button }))
    }

    it('returns a no-op cleanup when there is no rebinding id', () => {
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))
      const cleanup = result.current.setupRebindingListeners(null)
      expect(cleanup).toBeInstanceOf(Function)
    })

    it('returns a no-op cleanup when config is null', () => {
      const deps = getDeps(makeDeps({ config: null }))
      const { result } = renderHook(() => useClipsActions(deps))
      const cleanup = result.current.setupRebindingListeners('hk-1')
      expect(cleanup).toBeInstanceOf(Function)
    })

    it('ignores modifier-only keys', async () => {
      const dinho = mockDinho()
      dinho.clipsSetConfig.mockResolvedValue(true)
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))
      const cleanup = result.current.setupRebindingListeners('hk-1')

      dispatchKey({ keyCode: 0x11, ctrlKey: true })

      expect(dinho.clipsSetConfig).not.toHaveBeenCalled()
      expect(deps.setRebindingId).not.toHaveBeenCalled()
      cleanup()
    })

    it('rebinds a hotkey with captured modifiers', async () => {
      const dinho = mockDinho()
      dinho.clipsSetConfig.mockResolvedValue(true)
      const hk: HotkeyBinding = {
        id: 'hk-1',
        vk: 0x50,
        modifiers: [],
        action: 'saveClip',
        replayDurationSeconds: 60,
        enabled: true,
      }
      const deps = getDeps(makeDeps({ config: makeConfig({ hotkeys: [hk] }) }))
      const { result } = renderHook(() => useClipsActions(deps))
      const cleanup = result.current.setupRebindingListeners('hk-1')

      dispatchKey({ keyCode: 0x41, ctrlKey: true, shiftKey: false, altKey: true })

      const [patch] = dinho.clipsSetConfig.mock.calls[0]!
      const hotkeys = (patch as { hotkeys: HotkeyBinding[] }).hotkeys
      expect(hotkeys[0]!.vk).toBe(0x41)
      expect(hotkeys[0]!.modifiers).toEqual(['Ctrl', 'Alt'])
      expect(deps.setRebindingId).toHaveBeenCalledWith(null)
      cleanup()
    })

    it('adds a push-to-talk key without duplicates', async () => {
      const dinho = mockDinho()
      dinho.clipsSetConfig.mockResolvedValue(true)
      const deps = getDeps(makeDeps({ config: makeConfig({ pushToTalkKeys: [0x14] }) }))
      const { result } = renderHook(() => useClipsActions(deps))
      const cleanup = result.current.setupRebindingListeners('hk-ptt')

      dispatchKey({ keyCode: 0x14 })
      expect(dinho.clipsSetConfig).not.toHaveBeenCalled()

      dispatchKey({ keyCode: 0x15 })
      const [patch] = dinho.clipsSetConfig.mock.calls[0]!
      expect((patch as { pushToTalkKeys: number[] }).pushToTalkKeys).toEqual([0x14, 0x15])
      expect(deps.setRebindingId).toHaveBeenCalledWith(null)
      cleanup()
    })

    it('rebinds from a mouse button press', async () => {
      const dinho = mockDinho()
      dinho.clipsSetConfig.mockResolvedValue(true)
      const hk: HotkeyBinding = {
        id: 'hk-1',
        vk: 0x50,
        modifiers: [],
        action: 'saveClip',
        replayDurationSeconds: 60,
        enabled: true,
      }
      const deps = getDeps(makeDeps({ config: makeConfig({ hotkeys: [hk] }) }))
      const { result } = renderHook(() => useClipsActions(deps))
      const cleanup = result.current.setupRebindingListeners('hk-1')

      dispatchMouse(3)
      let [patch] = dinho.clipsSetConfig.mock.calls[0]!
      expect((patch as { hotkeys: HotkeyBinding[] }).hotkeys[0]!.vk).toBe(0x05)

      dispatchMouse(4)
      patch = dinho.clipsSetConfig.mock.calls[1]![0]
      expect((patch as { hotkeys: HotkeyBinding[] }).hotkeys[0]!.vk).toBe(0x06)
      cleanup()
    })

    it('ignores non-mapped mouse buttons', async () => {
      const dinho = mockDinho()
      dinho.clipsSetConfig.mockResolvedValue(true)
      const deps = getDeps(makeDeps())
      const { result } = renderHook(() => useClipsActions(deps))
      const cleanup = result.current.setupRebindingListeners('hk-1')

      dispatchMouse(0)
      expect(dinho.clipsSetConfig).not.toHaveBeenCalled()
      cleanup()
    })

    it('removes listeners on cleanup', async () => {
      const dinho = mockDinho()
      dinho.clipsSetConfig.mockResolvedValue(true)
      const hk: HotkeyBinding = {
        id: 'hk-1',
        vk: 0x50,
        modifiers: [],
        action: 'saveClip',
        replayDurationSeconds: 60,
        enabled: true,
      }
      const deps = getDeps(makeDeps({ config: makeConfig({ hotkeys: [hk] }) }))
      const { result } = renderHook(() => useClipsActions(deps))
      const cleanup = result.current.setupRebindingListeners('hk-1')

      cleanup()
      dispatchKey({ keyCode: 0x41 })
      expect(dinho.clipsSetConfig).not.toHaveBeenCalled()
    })
  })
})

describe('formatClipsSize', () => {
  const unitMap: Record<string, string> = {
    bytes: 'B',
    kilobytes: 'KB',
    megabytes: 'MB',
    gigabytes: 'GB',
  }
  const t = (key: string) => unitMap[key] ?? key

  it('formats bytes, KB, MB, and GB', () => {
    expect(formatClipsSize(0, t)).toBe('0 B')
    expect(formatClipsSize(1023, t)).toBe('1023 B')
    expect(formatClipsSize(1024, t)).toBe('1.0 KB')
    expect(formatClipsSize(1536, t)).toBe('1.5 KB')
    expect(formatClipsSize(1024 * 1024, t)).toBe('1.0 MB')
    expect(formatClipsSize(1024 * 1024 * 1024, t)).toBe('1.0 GB')
  })
})

describe('formatClipsDate', () => {
  it('formats a valid ISO date', () => {
    const iso = '2026-07-28T10:00:00.000Z'
    expect(formatClipsDate(iso)).toBe(new Date(iso).toLocaleString())
  })

  it('does not throw for invalid input (renders Invalid Date)', () => {
    expect(formatClipsDate('not-a-date')).toBe('Invalid Date')
  })
})

describe('formatClipsSeconds', () => {
  it('formats seconds as m:ss', () => {
    expect(formatClipsSeconds(0)).toBe('0:00')
    expect(formatClipsSeconds(59)).toBe('0:59')
    expect(formatClipsSeconds(60)).toBe('1:00')
    expect(formatClipsSeconds(125)).toBe('2:05')
  })
})
