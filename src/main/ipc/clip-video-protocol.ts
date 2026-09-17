import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { buildClipVideoUrl, CLIP_VIDEO_SCHEME, decodeClipVideoPath } from '@shared/clip-video-url'
import { clipPathInOutputDir } from '../services/clips-config-manager'

export { buildClipVideoUrl, CLIP_VIDEO_SCHEME, decodeClipVideoPath }

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
}

function toWebStream(stream: import('node:stream').Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>
}

/**
 * Wrap a bounded file stream in a Web stream that is torn down when the
 * request's AbortSignal fires (seek scrubbing, tab close, etc). Without this,
 * an abandoned range request keeps its file descriptor open until EOF.
 */
function toAbortableWebStream(
  filePath: string,
  signal: AbortSignal,
  options?: { start?: number; end?: number },
): ReadableStream<Uint8Array> {
  const stream = createReadStream(filePath, options)
  const onAbort = () => stream.destroy()
  if (!signal.aborted) {
    signal.addEventListener('abort', onAbort, { once: true })
    stream.once('close', () => signal.removeEventListener('abort', onAbort))
  } else {
    stream.destroy()
  }
  return toWebStream(stream)
}

function baseHeaders(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
  }
}

/**
 * Serve clip video files with manual HTTP Range support.
 *
 * net.fetch(file://...) cannot be used here: Chromium's file loader ignores
 * the Range header, so media elements report seekable.end() === 0 and every
 * seek jumps back to the start (see electron/electron#38749 and #51442). The
 * confirmed working pattern is to parse the Range header ourselves and return
 * 206 Partial Content with Content-Range/Accept-Ranges using a bounded
 * fs.createReadStream. The clip-video:// scheme is registered as `standard`,
 * which is required for media elements to issue follow-up range requests.
 */
export async function handleClipVideoRequest(request: Request): Promise<Response> {
  const rawPath = decodeClipVideoPath(request.url)
  if (!rawPath) return new Response('bad request', { status: 400 })

  // Confine reads to the clips output directory — never stream arbitrary
  // files requested via ?path=.
  const filePath = clipPathInOutputDir(rawPath)
  if (!filePath) return new Response('forbidden', { status: 403 })

  let size: number
  try {
    size = statSync(filePath).size
  } catch {
    return new Response('not found', { status: 404 })
  }

  const contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const isHead = request.method === 'HEAD'

  const range = request.headers.get('range')
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (m) {
    const start = m[1] !== '' ? Number(m[1]) : 0
    const end = m[2] !== '' ? Number(m[2]) : size - 1
    if (start >= size || start > end) {
      return new Response(null, {
        status: 416,
        headers: { ...baseHeaders(contentType), 'Content-Range': `bytes */${size}` },
      })
    }
    const clampedEnd = Math.min(end, size - 1)
    const chunk = clampedEnd - start + 1
    const headers = {
      ...baseHeaders(contentType),
      'Content-Range': `bytes ${start}-${clampedEnd}/${size}`,
      'Content-Length': String(chunk),
    }
    if (isHead) return new Response(null, { status: 206, headers })
    return new Response(toAbortableWebStream(filePath, request.signal, { start, end: clampedEnd }), {
      status: 206,
      headers,
    })
  }

  const headers = { ...baseHeaders(contentType), 'Content-Length': String(size) }
  if (isHead) return new Response(null, { status: 200, headers })
  return new Response(toAbortableWebStream(filePath, request.signal), { status: 200, headers })
}
