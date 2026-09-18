import { IPC } from '@shared/channels'
import type { ClipsConfig, ClipsEngineStatus } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnValue(1),
    removeListener: vi.fn(),
  },
}))

import { ipcRenderer } from 'electron'
import { clipsMethods } from './clips'

const mockIpc = ipcRenderer as unknown as {
  invoke: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('clipsMethods invoke wrappers', () => {
  const invokeCases: Array<{
    name: keyof typeof clipsMethods
    args: unknown[]
    channel: string
  }> = [
    { name: 'clipsGetStatus', args: [], channel: IPC.CLIPS_GET_STATUS },
    { name: 'clipsStartEngine', args: [], channel: IPC.CLIPS_START_ENGINE },
    { name: 'clipsStopEngine', args: [], channel: IPC.CLIPS_STOP_ENGINE },
    { name: 'clipsStartCapture', args: [], channel: IPC.CLIPS_START_CAPTURE },
    { name: 'clipsStopCapture', args: [], channel: IPC.CLIPS_STOP_CAPTURE },
    { name: 'clipsSaveClip', args: [], channel: IPC.CLIPS_SAVE_CLIP },
    { name: 'clipsList', args: [], channel: IPC.CLIPS_LIST_CLIPS },
    { name: 'clipsDelete', args: ['clip.mp4'], channel: IPC.CLIPS_DELETE_CLIP },
    { name: 'clipsRename', args: ['old.mp4', 'new.mp4'], channel: IPC.CLIPS_RENAME_CLIP },
    { name: 'clipsOpen', args: ['C:\\clips\\clip.mp4'], channel: IPC.CLIPS_OPEN_CLIP },
    { name: 'clipsGetConfig', args: [], channel: IPC.CLIPS_GET_CONFIG },
    {
      name: 'clipsSetConfig',
      args: [{ replayTimeSeconds: 120 } as Partial<ClipsConfig>],
      channel: IPC.CLIPS_SET_CONFIG,
    },
    { name: 'clipsSelectOutputDir', args: [], channel: IPC.CLIPS_SELECT_OUTPUT_DIR },
    { name: 'clipsGetThumbnail', args: ['clip.mp4'], channel: IPC.CLIPS_GET_THUMBNAIL },
    { name: 'clipsGetAudioSessions', args: [], channel: IPC.CLIPS_GET_AUDIO_SESSIONS },
    { name: 'clipsSetAudioSessions', args: [[1234, 5678]], channel: IPC.CLIPS_SET_AUDIO_SESSIONS },
    { name: 'clipsGetMicDevices', args: [], channel: IPC.CLIPS_GET_MIC_DEVICES },
    { name: 'clipsGetGpus', args: [], channel: IPC.CLIPS_GET_GPUS },
    { name: 'clipsGetEnhanceSupport', args: [], channel: IPC.CLIPS_GET_ENHANCE_SUPPORT },
    { name: 'clipsGetRunningProcesses', args: [], channel: IPC.CLIPS_GET_RUNNING_PROCESSES },
    { name: 'clipsSetFavorite', args: ['clip.mp4', true], channel: IPC.CLIPS_SET_FAVORITE },
    { name: 'clipsTrimClip', args: ['clip.mp4', 10, 20, true, 'none', 0.5], channel: IPC.CLIPS_TRIM_CLIP },
    { name: 'clipsMergeClips', args: [['a.mp4', 'b.mp4'], 'none', 0.5], channel: IPC.CLIPS_MERGE_CLIPS },
    { name: 'clipsPublish', args: ['C:\\clips\\clip.mp4'], channel: IPC.CLIPS_PUBLISH },
    { name: 'clipsPublishCancel', args: ['C:\\clips\\clip.mp4'], channel: IPC.CLIPS_PUBLISH_CANCEL },
    { name: 'clipsOpenExternal', args: ['https://dinho.dev/clip'], channel: IPC.CLIPS_OPEN_EXTERNAL },
  ]

  for (const { name, args, channel } of invokeCases) {
    it(`${name} invokes ${channel} with correct args`, async () => {
      const fn = clipsMethods[name] as (...a: unknown[]) => unknown
      await fn(...args)
      expect(mockIpc.invoke).toHaveBeenCalledWith(channel, ...args)
    })
  }

  it('clipsTrimClip passes undefined for omitted reEncode/enhance/sharpness', async () => {
    const fn = clipsMethods.clipsTrimClip as (...a: unknown[]) => unknown
    await fn('clip.mp4', 0, 5)
    expect(mockIpc.invoke).toHaveBeenCalledWith(IPC.CLIPS_TRIM_CLIP, 'clip.mp4', 0, 5, undefined, undefined, undefined)
  })

  it('clipsMergeClips passes undefined enhance/sharpness when omitted', async () => {
    const fn = clipsMethods.clipsMergeClips as (...a: unknown[]) => unknown
    await fn(['a.mp4', 'b.mp4'])
    expect(mockIpc.invoke).toHaveBeenCalledWith(IPC.CLIPS_MERGE_CLIPS, ['a.mp4', 'b.mp4'], undefined, undefined)
  })

  it('clipsGetVideoUrl builds a clip-video URL without invoking IPC', () => {
    const url = clipsMethods.clipsGetVideoUrl('C:\\My Clips\\my clip.mp4')
    expect(url).toBe(`clip-video://file?path=${encodeURIComponent('C:\\My Clips\\my clip.mp4')}`)
    expect(mockIpc.invoke).not.toHaveBeenCalled()
  })
})

describe('clipsMethods listener wrappers', () => {
  it('clipsOnEngineStatus registers and unregisters a callback', () => {
    const cb = vi.fn()
    const unsubscribe = clipsMethods.clipsOnEngineStatus(cb)

    expect(mockIpc.on).toHaveBeenCalledWith(IPC.CLIPS_ENGINE_STATUS, expect.any(Function))
    const handler = mockIpc.on.mock.calls[0]?.[1] as (_event: unknown, status: ClipsEngineStatus) => void

    const status = {
      currentGame: 'cs2.exe',
      running: false,
      capturing: false,
      uptime: 0,
      fps: 0,
      replayTimeSeconds: 0,
    } as ClipsEngineStatus
    handler({}, status)
    expect(cb).toHaveBeenCalledWith(status)

    unsubscribe()
    expect(mockIpc.removeListener).toHaveBeenCalledWith(IPC.CLIPS_ENGINE_STATUS, handler)
  })

  it('clipsOnClipSaved registers and unregisters a callback', () => {
    const cb = vi.fn()
    const unsubscribe = clipsMethods.clipsOnClipSaved(cb)

    expect(mockIpc.on).toHaveBeenCalledWith(IPC.CLIPS_CLIP_SAVED, expect.any(Function))
    const handler = mockIpc.on.mock.calls[0]?.[1] as (_event: unknown, data: { path?: string }) => void

    handler({}, { path: 'C:\\clips\\clip.mp4' })
    expect(cb).toHaveBeenCalledWith({ path: 'C:\\clips\\clip.mp4' })

    unsubscribe()
    expect(mockIpc.removeListener).toHaveBeenCalledWith(IPC.CLIPS_CLIP_SAVED, handler)
  })

  it('clipsOnRamPressure registers and unregisters a callback', () => {
    const cb = vi.fn()
    const unsubscribe = clipsMethods.clipsOnRamPressure(cb)

    expect(mockIpc.on).toHaveBeenCalledWith(IPC.CLIPS_RAM_PRESSURE, expect.any(Function))
    const handler = mockIpc.on.mock.calls[0]?.[1] as (
      _event: unknown,
      data: { level?: string; usedPercent?: number; reducedReplay?: number | null },
    ) => void

    handler({}, { level: 'critical', usedPercent: 95, reducedReplay: 60 })
    expect(cb).toHaveBeenCalledWith({ level: 'critical', usedPercent: 95, reducedReplay: 60 })

    unsubscribe()
    expect(mockIpc.removeListener).toHaveBeenCalledWith(IPC.CLIPS_RAM_PRESSURE, handler)
  })

  it('clipsOnDurationsReady registers and unregisters a callback', () => {
    const cb = vi.fn()
    const unsubscribe = clipsMethods.clipsOnDurationsReady(cb)

    expect(mockIpc.on).toHaveBeenCalledWith(IPC.CLIPS_DURATIONS_READY, expect.any(Function))
    const handler = mockIpc.on.mock.calls[0]?.[1] as () => void

    handler()
    expect(cb).toHaveBeenCalledWith()

    unsubscribe()
    expect(mockIpc.removeListener).toHaveBeenCalledWith(IPC.CLIPS_DURATIONS_READY, handler)
  })

  it('clipsOnPublishProgress forwards progress and can be unsubscribed', () => {
    const cb = vi.fn()
    const unsubscribe = clipsMethods.clipsOnPublishProgress(cb)

    expect(mockIpc.on).toHaveBeenCalledWith(IPC.CLIPS_PUBLISH_PROGRESS, expect.any(Function))
    const handler = mockIpc.on.mock.calls[0]?.[1] as (
      _event: unknown,
      data: { clipPath?: string; loaded?: number; total?: number; percent?: number },
    ) => void

    handler({}, { clipPath: 'C:\\clips\\clip.mp4', loaded: 2, total: 4, percent: 50 })
    expect(cb).toHaveBeenCalledWith({ clipPath: 'C:\\clips\\clip.mp4', loaded: 2, total: 4, percent: 50 })

    unsubscribe()
    expect(mockIpc.removeListener).toHaveBeenCalledWith(IPC.CLIPS_PUBLISH_PROGRESS, handler)
  })
})
