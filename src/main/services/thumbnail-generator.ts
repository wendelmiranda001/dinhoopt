import type { ExecFileException } from 'node:child_process'
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join, parse } from 'node:path'
import { resolveFfmpegOrNull } from './ffmpeg-path'
import { getLogger } from './logger.service'

function execFileAsync(
  cmd: string,
  args: readonly string[],
  options: { timeout: number; encoding: BufferEncoding },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, options, (err: ExecFileException | null, stdout: string, stderr: string) => {
      if (err) reject(err)
      else resolve({ stdout, stderr })
    })
  })
}

const THUMB_DIR = '.thumbnails'
const THUMB_WIDTH = 320
const DEFAULT_SEEK_SEC = 5
const FFMPEG_TIMEOUT = 30_000

export async function hasFfmpeg(): Promise<boolean> {
  return resolveFfmpegOrNull() !== null
}

function getCacheDir(outputDir: string): string {
  return join(outputDir, THUMB_DIR)
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function thumbPathFor(outputDir: string, clipName: string): string {
  return join(getCacheDir(outputDir), `${parse(clipName).name}.jpg`)
}

function engineThumbPath(outputDir: string, clipName: string): string {
  return join(outputDir, `${parse(clipName).name}.thumb.jpg`)
}

export function getCachedThumbnailPath(outputDir: string, clipName: string): string | null {
  const p = thumbPathFor(outputDir, clipName)
  return existsSync(p) ? p : null
}

export async function generateThumbnail(outputDir: string, clipName: string): Promise<string | null> {
  const ffmpeg = resolveFfmpegOrNull()

  const videoPath = join(outputDir, clipName)
  if (!existsSync(videoPath)) return null

  const cached = getCachedThumbnailPath(outputDir, clipName)
  if (cached) return cached

  ensureDir(getCacheDir(outputDir))
  const thumbPath = thumbPathFor(outputDir, clipName)

  const engineThumb = engineThumbPath(outputDir, clipName)
  if (existsSync(engineThumb)) {
    try {
      copyFileSync(engineThumb, thumbPath)
      if (existsSync(thumbPath) && statSync(thumbPath).size > 0) return thumbPath
    } catch {
      /* fall through to ffmpeg generation */
    }
  }

  if (!ffmpeg) return null

  try {
    let seekSec = DEFAULT_SEEK_SEC

    let stderr = ''
    try {
      await execFileAsync(ffmpeg, ['-i', videoPath], {
        timeout: 10_000,
        encoding: 'utf-8',
      })
    } catch (err) {
      // header-only probe exits non-zero; stderr with stream info arrives on the error
      stderr = String((err as { stderr?: string }).stderr ?? '')
    }
    const match = stderr.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d+)/)
    if (match) {
      const h = Number.parseInt(match[1]!, 10)
      const m = Number.parseInt(match[2]!, 10)
      const s = Number.parseInt(match[3]!, 10)
      const cs = Number.parseInt(match[4]!.padEnd(3, '0'), 10)
      const dur = h * 3600 + m * 60 + s + cs / 1000
      if (dur > 0) seekSec = Math.min(dur * 0.25, 60)
    }

    await execFileAsync(
      ffmpeg,
      [
        '-ss',
        String(seekSec),
        '-i',
        videoPath,
        '-vframes',
        '1',
        '-q:v',
        '3',
        '-vf',
        `scale=${THUMB_WIDTH}:-1`,
        '-y',
        thumbPath,
      ],
      { timeout: FFMPEG_TIMEOUT, encoding: 'utf-8' },
    )

    if (existsSync(thumbPath) && statSync(thumbPath).size > 0) return thumbPath
    return null
  } catch (err) {
    getLogger().warning('thumbnail', `Failed to generate thumbnail for ${clipName}: ${err}`)
    return null
  }
}

export function readThumbnailDataUrl(thumbPath: string): string | null {
  try {
    const data = readFileSync(thumbPath)
    return `data:image/jpeg;base64,${data.toString('base64')}`
  } catch {
    return null
  }
}

export async function getThumbnailDataUrl(outputDir: string, clipName: string): Promise<string | null> {
  const cached = getCachedThumbnailPath(outputDir, clipName)
  if (cached) {
    const url = readThumbnailDataUrl(cached)
    if (url) return url
  }
  const thumbPath = await generateThumbnail(outputDir, clipName)
  if (!thumbPath) return null
  return readThumbnailDataUrl(thumbPath)
}
