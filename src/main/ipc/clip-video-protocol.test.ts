import { createReadStream, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildClipVideoUrl,
  CLIP_VIDEO_SCHEME,
  decodeClipVideoPath,
  handleClipVideoRequest,
} from './clip-video-protocol'

const tempDir = mkdtempSync(join(tmpdir(), 'clip-video-protocol-'))

// Wrap the real createReadStream so we can observe stream teardown.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) }
})

vi.mock('../services/clips-config-manager', () => ({
  clipPathInOutputDir: (inputPath: string) => {
    const resolved = resolve(inputPath)
    return resolved.toLowerCase().startsWith(tempDir.toLowerCase()) ? resolved : null
  },
}))

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

// 1000 bytes of 0x41 ('A' repeated)
const sample = join(tempDir, 'sample.mp4')
writeFileSync(sample, Buffer.alloc(1000, 0x41))

// 500 bytes of 0x42, then 500 bytes of 0x43 — lets us verify byte ranges
const twoTone = join(tempDir, 'two-tone.mp4')
writeFileSync(twoTone, Buffer.concat([Buffer.alloc(500, 0x42), Buffer.alloc(500, 0x43)]))

function makeRequest(url: string, init: { range?: string; method?: string } = {}): Request {
  const headers: Record<string, string> = {}
  if (init.range) headers.range = init.range
  return new Request(url, { method: init.method ?? 'GET', headers })
}

async function bodyBytes(res: Response): Promise<Buffer> {
  const buf = Buffer.from(await res.arrayBuffer())
  return buf
}

describe('clip-video-protocol', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('buildClipVideoUrl round-trips through decodeClipVideoPath', () => {
    const url = buildClipVideoUrl('C:\\Users\\test\\my clip.mp4')
    expect(url.startsWith(`${CLIP_VIDEO_SCHEME}://file?path=`)).toBe(true)
    expect(decodeClipVideoPath(url)).toBe('C:\\Users\\test\\my clip.mp4')
  })

  it('decodeClipVideoPath returns null for wrong protocol', () => {
    expect(decodeClipVideoPath('file:///C:/test/clip.mp4')).toBeNull()
  })

  it('decodeClipVideoPath returns null for malformed URL', () => {
    expect(decodeClipVideoPath('not a url')).toBeNull()
  })

  it('decodeClipVideoPath returns null when path param is missing', () => {
    expect(decodeClipVideoPath('clip-video://file')).toBeNull()
  })

  it('returns 400 when path param is missing', async () => {
    const res = await handleClipVideoRequest(makeRequest(`${CLIP_VIDEO_SCHEME}://file`))
    expect(res.status).toBe(400)
  })

  it('returns 403 for a path outside the clips output directory', async () => {
    const outside = join(tmpdir(), 'outside-clips', 'secret.mp4')
    const res = await handleClipVideoRequest(makeRequest(buildClipVideoUrl(outside)))
    expect(res.status).toBe(403)
  })

  it('returns 404 when the file does not exist', async () => {
    const missing = join(tempDir, 'missing.mp4')
    const res = await handleClipVideoRequest(makeRequest(buildClipVideoUrl(missing)))
    expect(res.status).toBe(404)
  })

  it('serves a full file with 200, Content-Length and Accept-Ranges', async () => {
    const res = await handleClipVideoRequest(makeRequest(buildClipVideoUrl(sample)))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('video/mp4')
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    expect(res.headers.get('Content-Length')).toBe('1000')
    const body = await bodyBytes(res)
    expect(body.length).toBe(1000)
    expect(body[0]).toBe(0x41)
  })

  it('serves an explicit byte range with 206 and Content-Range', async () => {
    const res = await handleClipVideoRequest(makeRequest(buildClipVideoUrl(twoTone), { range: 'bytes=100-199' }))
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 100-199/1000')
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    expect(res.headers.get('Content-Length')).toBe('100')
    const body = await bodyBytes(res)
    expect(body.length).toBe(100)
    expect(body.every((b) => b === 0x42)).toBe(true)
  })

  it('serves an open-ended range (no end) with 206', async () => {
    const res = await handleClipVideoRequest(makeRequest(buildClipVideoUrl(twoTone), { range: 'bytes=500-' }))
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 500-999/1000')
    expect(res.headers.get('Content-Length')).toBe('500')
    const body = await bodyBytes(res)
    expect(body.length).toBe(500)
    expect(body.every((b) => b === 0x43)).toBe(true)
  })

  it('clamps an end beyond the file size', async () => {
    const res = await handleClipVideoRequest(makeRequest(buildClipVideoUrl(sample), { range: 'bytes=900-5000' }))
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 900-999/1000')
    const body = await bodyBytes(res)
    expect(body.length).toBe(100)
  })

  it('returns 416 with Content-Range */size for an unsatisfiable range', async () => {
    const res = await handleClipVideoRequest(makeRequest(buildClipVideoUrl(sample), { range: 'bytes=5000-6000' }))
    expect(res.status).toBe(416)
    expect(res.headers.get('Content-Range')).toBe('bytes */1000')
  })

  it('returns 416 for a reversed range (start after end)', async () => {
    const res = await handleClipVideoRequest(makeRequest(buildClipVideoUrl(sample), { range: 'bytes=200-100' }))
    expect(res.status).toBe(416)
  })

  it('ignores malformed Range headers and serves the full file', async () => {
    const res = await handleClipVideoRequest(makeRequest(buildClipVideoUrl(sample), { range: 'bytes=oops' }))
    expect(res.status).toBe(200)
    const body = await bodyBytes(res)
    expect(body.length).toBe(1000)
  })

  it('answers HEAD requests with headers and an empty body', async () => {
    const res = await handleClipVideoRequest(makeRequest(buildClipVideoUrl(sample), { method: 'HEAD' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Length')).toBe('1000')
    const body = await bodyBytes(res)
    expect(body.length).toBe(0)
  })

  it('answers a HEAD request for a byte range with 206 and empty body', async () => {
    const res = await handleClipVideoRequest(
      makeRequest(buildClipVideoUrl(twoTone), { method: 'HEAD', range: 'bytes=100-199' }),
    )
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 100-199/1000')
    const body = await bodyBytes(res)
    expect(body.length).toBe(0)
  })

  it('uses application/octet-stream for unknown extensions', async () => {
    const unknown = join(tempDir, 'sample.xyz')
    writeFileSync(unknown, Buffer.alloc(10, 0x41))
    const res = await handleClipVideoRequest(makeRequest(buildClipVideoUrl(unknown)))
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
  })

  it('destroys the file stream when the request is aborted mid-body', async () => {
    vi.mocked(createReadStream).mockClear()
    const controller = new AbortController()
    const req = new Request(buildClipVideoUrl(sample), { signal: controller.signal })
    const res = await handleClipVideoRequest(req)
    expect(res.status).toBe(200)

    controller.abort()

    const created = vi.mocked(createReadStream).mock.results[0]?.value as { destroyed: boolean } | undefined
    expect(created).toBeDefined()
    expect(created!.destroyed).toBe(true)
  })
})
