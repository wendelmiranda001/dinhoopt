import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  handler: null as ((req: unknown, res: unknown) => void) | null,
  instance: null as {
    on: ReturnType<typeof vi.fn>
    listen: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    closeAllConnections: ReturnType<typeof vi.fn>
  } | null,
}))

vi.mock('node:http', () => ({
  createServer: vi.fn((handler: (req: unknown, res: unknown) => void) => {
    const instance = {
      on: vi.fn(),
      listen: vi.fn((_port: number, cb: () => void) => {
        queueMicrotask(() => cb())
      }),
      close: vi.fn(),
      closeAllConnections: vi.fn(),
    }
    mockState.handler = handler
    mockState.instance = instance
    return instance
  }),
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:\\test',
    getName: () => 'DiNho',
    getVersion: () => '1.0.0',
    exit: vi.fn(),
  },
}))

vi.mock('../../services/metrics', () => ({
  collectMetrics: vi.fn().mockResolvedValue({ cpu: 45, mem: 60 }),
  formatPrometheus: vi.fn().mockReturnValue('# HELP cpu_usage\n# TYPE cpu_usage gauge\ncpu_usage 45\n'),
}))

function buildRes() {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  }
}

describe('handleMetricsServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.handler = null
    mockState.instance = null
  })

  it('drains active connections on shutdown', async () => {
    const { handleMetricsServer } = await import('./metrics')
    const p = handleMetricsServer([], { json: false, verbosity: 'normal' })

    await vi.waitFor(() => expect(mockState.handler).not.toBeNull())

    process.emit('SIGTERM')

    expect(mockState.instance?.closeAllConnections).toHaveBeenCalled()
    expect(mockState.instance?.close).toHaveBeenCalled()

    p.catch(() => {})
  })

  it('responds to /metrics with prometheus text', async () => {
    const { handleMetricsServer } = await import('./metrics')
    const p = handleMetricsServer([], { json: false, verbosity: 'normal' })

    await vi.waitFor(() => expect(mockState.handler).not.toBeNull())

    const res = buildRes()
    await mockState.handler!({ url: '/metrics' }, res)

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining('cpu_usage'))

    p.catch(() => {})
  })

  it('responds to /health with ok status', async () => {
    const { handleMetricsServer } = await import('./metrics')
    const p = handleMetricsServer([], { json: false, verbosity: 'normal' })

    await vi.waitFor(() => expect(mockState.handler).not.toBeNull())

    const res = buildRes()
    await mockState.handler!({ url: '/health' }, res)

    expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' })
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ status: 'ok' }))

    p.catch(() => {})
  })

  it('responds with 404 for unknown routes', async () => {
    const { handleMetricsServer } = await import('./metrics')
    const p = handleMetricsServer([], { json: false, verbosity: 'normal' })

    await vi.waitFor(() => expect(mockState.handler).not.toBeNull())

    const res = buildRes()
    await mockState.handler!({ url: '/unknown' }, res)

    expect(res.writeHead).toHaveBeenCalledWith(404)
    expect(res.end).toHaveBeenCalledWith('Not Found\n')

    p.catch(() => {})
  })

  it('handles Error thrown in collectMetrics with 500', async () => {
    const { collectMetrics } = await import('../../services/metrics')
    vi.mocked(collectMetrics).mockRejectedValueOnce(new Error('db down'))

    const { handleMetricsServer } = await import('./metrics')
    const p = handleMetricsServer([], { json: false, verbosity: 'normal' })

    await vi.waitFor(() => expect(mockState.handler).not.toBeNull())

    const res = buildRes()
    await mockState.handler!({ url: '/metrics' }, res)

    expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'text/plain' })
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining('db down'))

    p.catch(() => {})
  })

  it('handles non-Error thrown in collectMetrics with 500', async () => {
    const { collectMetrics } = await import('../../services/metrics')
    vi.mocked(collectMetrics).mockRejectedValueOnce('string crash')

    const { handleMetricsServer } = await import('./metrics')
    const p = handleMetricsServer([], { json: false, verbosity: 'normal' })

    await vi.waitFor(() => expect(mockState.handler).not.toBeNull())

    const res = buildRes()
    await mockState.handler!({ url: '/metrics' }, res)

    expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'text/plain' })
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining('Unknown error'))

    p.catch(() => {})
  })
})
