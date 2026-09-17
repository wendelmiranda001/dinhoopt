import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
  copyFileSync: vi.fn(),
}))

vi.mock('./logger.service', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}))

vi.mock('./ffmpeg-path', () => ({
  resolveFfmpegOrNull: vi.fn(),
}))

import type { ChildProcess } from 'node:child_process'
import { execFile } from 'node:child_process'
import type { Stats } from 'node:fs'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { resolveFfmpegOrNull } from './ffmpeg-path'
import {
  generateThumbnail,
  getCachedThumbnailPath,
  getThumbnailDataUrl,
  hasFfmpeg,
  readThumbnailDataUrl,
} from './thumbnail-generator'

const execFileMock = vi.mocked(execFile)
const existsSyncMock = vi.mocked(existsSync)
const mkdirSyncMock = vi.mocked(mkdirSync)
const readFileSyncMock = vi.mocked(readFileSync)
const statSyncMock = vi.mocked(statSync)
const copyFileSyncMock = vi.mocked(copyFileSync)
const resolveFfmpegMock = vi.mocked(resolveFfmpegOrNull)

const FFMPEG_EXE = 'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe'
const VIDEO_PATH = 'C:\\DiNhoClips\\test.mp4'
const THUMB_PATH = 'C:\\DiNhoClips\\.thumbnails\\test.jpg'
const ENGINE_THUMB = 'C:\\DiNhoClips\\test.thumb.jpg'

function probeStderr(duration?: string): string {
  if (!duration) return ''
  return `Duration: ${duration}, start: 0.000000, bitrate: 1000 kb/s`
}

function successExecFile(duration?: string, onGen?: () => void): () => void {
  execFileMock.mockImplementation((_cmd, args, _options, cb) => {
    const callback = cb as (err: null, stdout: string, stderr: string) => void
    if ((args as string[])[0] === '-i') {
      const err = Object.assign(new Error('header-only probe exits non-zero'), {
        stderr: probeStderr(duration),
      })
      callback(err as never, '', '')
    } else {
      onGen?.()
      callback(null, '', '')
    }
    return {} as ChildProcess
  })
  return () => undefined
}

describe('thumbnail-generator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execFileMock.mockReset()
    execFileMock.mockImplementation((_cmd, _args, _options, cb) => {
      const callback = cb as (err: Error, stdout: string, stderr: string) => void
      if (callback) callback(new Error('not found'), '', '')
      return {} as ChildProcess
    })
    existsSyncMock.mockReset()
    existsSyncMock.mockReturnValue(false)
    mkdirSyncMock.mockReset()
    readFileSyncMock.mockReset()
    statSyncMock.mockReset()
    copyFileSyncMock.mockReset()
    resolveFfmpegMock.mockReset()
    resolveFfmpegMock.mockReturnValue(null)
  })

  describe('hasFfmpeg', () => {
    it('returns false when ffmpeg is not found', async () => {
      await expect(hasFfmpeg()).resolves.toBe(false)
      expect(resolveFfmpegMock).toHaveBeenCalled()
    })

    it('returns true when ffmpeg is found', async () => {
      resolveFfmpegMock.mockReturnValue(FFMPEG_EXE)
      await expect(hasFfmpeg()).resolves.toBe(true)
    })
  })

  describe('getCachedThumbnailPath', () => {
    it('returns null when no cached thumbnail exists', () => {
      expect(getCachedThumbnailPath('C:\\DiNhoClips', 'test.mp4')).toBeNull()
    })

    it('returns the cached path when it exists', () => {
      existsSyncMock.mockReturnValue(true)
      expect(getCachedThumbnailPath('C:\\DiNhoClips', 'test.mp4')).toBe(THUMB_PATH)
    })
  })

  describe('generateThumbnail', () => {
    it('returns null when ffmpeg is not available', async () => {
      existsSyncMock.mockImplementation((p: unknown) => p === VIDEO_PATH)
      await expect(generateThumbnail('C:\\DiNhoClips', 'test.mp4')).resolves.toBeNull()
    })

    it('returns null when video file does not exist', async () => {
      resolveFfmpegMock.mockReturnValue(FFMPEG_EXE)
      await expect(generateThumbnail('C:\\DiNhoClips', 'test.mp4')).resolves.toBeNull()
    })
  })

  describe('readThumbnailDataUrl', () => {
    it('returns a data url when the thumb file exists', () => {
      readFileSyncMock.mockReturnValue(Buffer.from('jpegdata'))
      const url = readThumbnailDataUrl(THUMB_PATH)
      expect(url).toBe(`data:image/jpeg;base64,${Buffer.from('jpegdata').toString('base64')}`)
      expect(readFileSyncMock).toHaveBeenCalledWith(THUMB_PATH)
    })

    it('returns null when the thumb file is missing', () => {
      readFileSyncMock.mockImplementation(() => {
        throw new Error('ENOENT')
      })
      expect(readThumbnailDataUrl(THUMB_PATH)).toBeNull()
    })
  })

  describe('getThumbnailDataUrl', () => {
    it('returns cached data url when the thumbnail is already cached', async () => {
      existsSyncMock.mockReturnValue(true)
      readFileSyncMock.mockReturnValue(Buffer.from('cached'))
      const url = await getThumbnailDataUrl('C:\\DiNhoClips', 'test.mp4')
      expect(url).toBe(`data:image/jpeg;base64,${Buffer.from('cached').toString('base64')}`)
      expect(execFileMock).not.toHaveBeenCalled()
    })
  })

  describe('generateThumbnail full flow', () => {
    beforeEach(() => {
      resolveFfmpegMock.mockReturnValue(FFMPEG_EXE)
      statSyncMock.mockReturnValue({ size: 100 } as Stats)
    })

    it('generates a thumbnail when ffmpeg and video exist', async () => {
      let thumbReady = false
      existsSyncMock.mockImplementation((p: unknown) => {
        if (p === VIDEO_PATH) return true
        if (p === THUMB_PATH) return thumbReady
        return false
      })
      successExecFile('00:00:30.00', () => {
        thumbReady = true
      })

      const result = await generateThumbnail('C:\\DiNhoClips', 'test.mp4')
      expect(result).toBe(THUMB_PATH)
      expect(execFileMock).toHaveBeenCalledTimes(2)
      expect(mkdirSyncMock).toHaveBeenCalled()
      expect(statSyncMock).toHaveBeenCalledWith(THUMB_PATH)
    })

    it('seeks to 25% of the video duration', async () => {
      let thumbReady = false
      existsSyncMock.mockImplementation((p: unknown) => {
        if (p === VIDEO_PATH) return true
        if (p === THUMB_PATH) return thumbReady
        return false
      })
      successExecFile('00:01:40.00', () => {
        thumbReady = true
      })

      await generateThumbnail('C:\\DiNhoClips', 'test.mp4')
      const genArgs = execFileMock.mock.calls[1]?.[1] as string[]
      expect(genArgs[0]).toBe('-ss')
      expect(genArgs[1]).toBe('25')
    })

    it('caps the seek at 60 seconds', async () => {
      let thumbReady = false
      existsSyncMock.mockImplementation((p: unknown) => {
        if (p === VIDEO_PATH) return true
        if (p === THUMB_PATH) return thumbReady
        return false
      })
      successExecFile('01:00:00.00', () => {
        thumbReady = true
      })

      await generateThumbnail('C:\\DiNhoClips', 'test.mp4')
      const genArgs = execFileMock.mock.calls[1]?.[1] as string[]
      expect(genArgs[1]).toBe('60')
    })

    it('uses default seek when duration is not found', async () => {
      let thumbReady = false
      existsSyncMock.mockImplementation((p: unknown) => {
        if (p === VIDEO_PATH) return true
        if (p === THUMB_PATH) return thumbReady
        return false
      })
      successExecFile(undefined, () => {
        thumbReady = true
      })

      await generateThumbnail('C:\\DiNhoClips', 'test.mp4')
      const genArgs = execFileMock.mock.calls[1]?.[1] as string[]
      expect(genArgs[1]).toBe('5')
    })

    it('uses default seek when duration is zero', async () => {
      let thumbReady = false
      existsSyncMock.mockImplementation((p: unknown) => {
        if (p === VIDEO_PATH) return true
        if (p === THUMB_PATH) return thumbReady
        return false
      })
      successExecFile('00:00:00.00', () => {
        thumbReady = true
      })

      await generateThumbnail('C:\\DiNhoClips', 'test.mp4')
      const genArgs = execFileMock.mock.calls[1]?.[1] as string[]
      expect(genArgs[1]).toBe('5')
    })

    it('returns null when the thumb file is not written', async () => {
      existsSyncMock.mockImplementation((p: unknown) => p === VIDEO_PATH)
      successExecFile('00:00:30.00')

      await expect(generateThumbnail('C:\\DiNhoClips', 'test.mp4')).resolves.toBeNull()
    })

    it('returns null when ffmpeg execFile fails', async () => {
      existsSyncMock.mockImplementation((p: unknown) => p === VIDEO_PATH)
      await expect(generateThumbnail('C:\\DiNhoClips', 'test.mp4')).resolves.toBeNull()
    })
  })

  describe('getThumbnailDataUrl full flow', () => {
    beforeEach(() => {
      resolveFfmpegMock.mockReturnValue(FFMPEG_EXE)
      statSyncMock.mockReturnValue({ size: 100 } as Stats)
    })

    it('generates the thumbnail then returns its data url', async () => {
      let thumbReady = false
      existsSyncMock.mockImplementation((p: unknown) => {
        if (p === VIDEO_PATH) return true
        if (p === THUMB_PATH) return thumbReady
        return false
      })
      successExecFile(undefined, () => {
        thumbReady = true
      })
      readFileSyncMock.mockReturnValue(Buffer.from('jpegdata'))

      const url = await getThumbnailDataUrl('C:\\DiNhoClips', 'test.mp4')
      expect(url).toBe(`data:image/jpeg;base64,${Buffer.from('jpegdata').toString('base64')}`)
      expect(execFileMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('engine thumbnail fallback', () => {
    beforeEach(() => {
      resolveFfmpegMock.mockReturnValue(FFMPEG_EXE)
      statSyncMock.mockReturnValue({ size: 100 } as Stats)
    })

    it('returns the cached thumbnail without running ffmpeg', async () => {
      existsSyncMock.mockImplementation((p: unknown) => p === THUMB_PATH || p === VIDEO_PATH)

      const result = await generateThumbnail('C:\\DiNhoClips', 'test.mp4')
      expect(result).toBe(THUMB_PATH)
      expect(execFileMock).not.toHaveBeenCalled()
    })

    it('falls back to ffmpeg when the engine thumb does not exist', async () => {
      let thumbReady = false
      existsSyncMock.mockImplementation((p: unknown) => {
        if (p === VIDEO_PATH) return true
        if (p === THUMB_PATH) return thumbReady
        return false
      })
      successExecFile('00:00:30.00', () => {
        thumbReady = true
      })

      const result = await generateThumbnail('C:\\DiNhoClips', 'test.mp4')
      expect(result).toBe(THUMB_PATH)
      expect(execFileMock).toHaveBeenCalledTimes(2)
      expect(execFileMock.mock.calls[1]?.[0]).toContain('ffmpeg')
    })

    it('copies the engine thumb to the cache when ffmpeg is not available', async () => {
      let thumbExists = false
      existsSyncMock.mockImplementation((p: unknown) => {
        if (p === VIDEO_PATH) return true
        if (p === ENGINE_THUMB) return true
        if (p === THUMB_PATH) return thumbExists
        return false
      })
      copyFileSyncMock.mockImplementation(() => {
        thumbExists = true
      })

      const result = await generateThumbnail('C:\\DiNhoClips', 'test.mp4')
      expect(result).toBe(THUMB_PATH)
      expect(copyFileSyncMock).toHaveBeenCalledWith(ENGINE_THUMB, THUMB_PATH)
      expect(execFileMock).not.toHaveBeenCalled()
    })
  })
})
