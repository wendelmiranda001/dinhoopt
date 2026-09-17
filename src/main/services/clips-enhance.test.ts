import { execFile } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  AMD_VENDOR_ID,
  appendSharpnessFilter,
  buildAmfEnhanceVf,
  normalizeSharpness,
  parseEnhanceOption,
  probeVideoResolution,
} from './clips-enhance'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

const execFileMock = execFile as unknown as ReturnType<typeof vi.fn>

describe('parseEnhanceOption', () => {
  it('returns the valid option as-is', () => {
    expect(parseEnhanceOption('none')).toBe('none')
    expect(parseEnhanceOption('sr')).toBe('sr')
    expect(parseEnhanceOption('frc')).toBe('frc')
    expect(parseEnhanceOption('sr+frc')).toBe('sr+frc')
  })

  it('falls back to none for invalid values', () => {
    expect(parseEnhanceOption(undefined)).toBe('none')
    expect(parseEnhanceOption('upscale')).toBe('none')
    expect(parseEnhanceOption(42)).toBe('none')
    expect(parseEnhanceOption({})).toBe('none')
  })
})

describe('buildAmfEnhanceVf', () => {
  it('returns null for none', () => {
    expect(buildAmfEnhanceVf('none', 1920, 1080)).toBeNull()
  })

  it('returns null for invalid dimensions', () => {
    expect(buildAmfEnhanceVf('sr', 0, 1080)).toBeNull()
    expect(buildAmfEnhanceVf('frc', 1920, -5)).toBeNull()
  })

  it('builds sr upscale capped at SR_MAX', () => {
    expect(buildAmfEnhanceVf('sr', 1280, 720)).toBe('sr_amf=w=1920:h=1080:format=nv12:algorithm=sr1-1')
  })

  it('caps output at SR_MAX when 2x overflows', () => {
    expect(buildAmfEnhanceVf('sr', 1920, 1080)).toBe('sr_amf=w=1920:h=1080:format=nv12:algorithm=sr1-1')
  })

  it('builds frc alone', () => {
    expect(buildAmfEnhanceVf('frc', 1280, 720)).toBe('frc_amf=profile=high:fallback_mode=blend')
  })

  it('chains sr+frc in order', () => {
    expect(buildAmfEnhanceVf('sr+frc', 960, 540)).toBe(
      'sr_amf=w=1920:h=1080:format=nv12:algorithm=sr1-1,frc_amf=profile=high:fallback_mode=blend',
    )
  })
})

describe('normalizeSharpness', () => {
  it('clamps a valid number into [0, 1]', () => {
    expect(normalizeSharpness(0.5)).toBe(0.5)
    expect(normalizeSharpness(0)).toBe(0)
    expect(normalizeSharpness(1)).toBe(1)
  })

  it('clamps values above 1 to 1 and below 0 to 0', () => {
    expect(normalizeSharpness(2.5)).toBe(1)
    expect(normalizeSharpness(-1)).toBe(0)
  })

  it('returns 0 for non-numbers and non-finite numbers', () => {
    expect(normalizeSharpness(undefined)).toBe(0)
    expect(normalizeSharpness('high')).toBe(0)
    expect(normalizeSharpness(true)).toBe(0)
    expect(normalizeSharpness(Number.NaN)).toBe(0)
    expect(normalizeSharpness(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('appendSharpnessFilter', () => {
  it('appends cas to an existing chain', () => {
    expect(appendSharpnessFilter('scale=1280:720', 0.5)).toBe('scale=1280:720,cas=strength=0.5')
  })

  it('returns just the cas filter for an empty chain', () => {
    expect(appendSharpnessFilter('', 0.4)).toBe('cas=strength=0.4')
  })

  it('returns just the cas filter for a null chain', () => {
    expect(appendSharpnessFilter(null, 0.4)).toBe('cas=strength=0.4')
  })

  it('clamps strength above 1 to 1', () => {
    expect(appendSharpnessFilter(null, 3)).toBe('cas=strength=1')
  })

  it('returns the chain unchanged for strength 0 (off)', () => {
    expect(appendSharpnessFilter('scale=1280:720', 0)).toBe('scale=1280:720')
    expect(appendSharpnessFilter(null, 0)).toBeNull()
  })

  it('returns the chain unchanged for negative strength', () => {
    expect(appendSharpnessFilter('scale=1280:720', -1)).toBe('scale=1280:720')
  })

  it('returns the chain unchanged for NaN', () => {
    expect(appendSharpnessFilter('scale=1280:720', Number.NaN)).toBe('scale=1280:720')
    expect(appendSharpnessFilter(null, Number.NaN)).toBeNull()
  })

  it('formats the strength with a decimal point regardless of locale', () => {
    expect(appendSharpnessFilter(null, 0.1)).toBe('cas=strength=0.1')
    expect(appendSharpnessFilter(null, 0.9)).toBe('cas=strength=0.9')
  })
})

describe('probeVideoResolution', () => {
  afterEach(() => {
    execFileMock.mockReset()
  })

  it('resolves the resolution from ffmpeg stderr', async () => {
    execFileMock.mockImplementation(
      (_bin: unknown, _args: unknown, _opts: unknown, cb: (err: unknown, _o: unknown, stderr: string) => void) => {
        cb(
          { code: 1 },
          '',
          'ffmpeg version 9.0 ...\n  Stream #0:0: Video: h264 (High), yuv420p(progressive), 1280x720 [SAR 1:1 DAR 16:9], 60 fps, 60 tbr',
        )
      },
    )
    await expect(probeVideoResolution('ffmpeg', 'clip.mp4')).resolves.toEqual({ w: 1280, h: 720 })
  })

  it('matches streams with a language tag', async () => {
    execFileMock.mockImplementation(
      (_bin: unknown, _args: unknown, _opts: unknown, cb: (err: unknown, _o: unknown, stderr: string) => void) => {
        cb(null, '', 'Stream #0:1(eng): Video: hevc (Main), yuv420p, 1920x1080')
      },
    )
    await expect(probeVideoResolution('ffmpeg', 'clip.mkv')).resolves.toEqual({ w: 1920, h: 1080 })
  })

  it('returns null when no video stream exists', async () => {
    execFileMock.mockImplementation(
      (_bin: unknown, _args: unknown, _opts: unknown, cb: (err: unknown, _o: unknown, stderr: string) => void) => {
        cb({ code: 1 }, '', '  Stream #0:0: Audio: aac, 48000 Hz, stereo')
      },
    )
    await expect(probeVideoResolution('ffmpeg', 'clip.mp4')).resolves.toBeNull()
  })

  it('returns null when stderr is empty', async () => {
    execFileMock.mockImplementation(
      (_bin: unknown, _args: unknown, _opts: unknown, cb: (err: unknown, _o: unknown, stderr: string) => void) => {
        cb(null, '', '')
      },
    )
    await expect(probeVideoResolution('ffmpeg', 'clip.mp4')).resolves.toBeNull()
  })

  it('returns null when ffmpeg does not exist', async () => {
    execFileMock.mockImplementation(
      (_bin: unknown, _args: unknown, _opts: unknown, cb: (err: Error, _o: unknown, stderr: string) => void) => {
        cb(new Error('spawn ffmpeg ENOENT'), '', '')
      },
    )
    await expect(probeVideoResolution('ffmpeg', 'clip.mp4')).resolves.toBeNull()
  })

  it('returns null on timeout', async () => {
    execFileMock.mockImplementation(
      (_bin: unknown, _args: unknown, _opts: unknown, cb: (err: { code: string | null; killed: boolean }) => void) => {
        cb({ code: null, killed: true })
      },
    )
    await expect(probeVideoResolution('ffmpeg', 'clip.mp4')).resolves.toBeNull()
  })
})

describe('AMD_VENDOR_ID', () => {
  it('is 0x1002 (AMD)', () => {
    expect(AMD_VENDOR_ID).toBe(0x1002)
  })
})
