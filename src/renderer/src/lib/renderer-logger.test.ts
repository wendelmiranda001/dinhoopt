// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { DiNhoAPI } from '../../../preload/index'

beforeEach(() => {
  window.dinho = undefined as never
})

function mockDinho(log: ReturnType<typeof vi.fn>): void {
  window.dinho = { log } as unknown as DiNhoAPI
}

describe('renderer-logger', () => {
  it('error logs message with Error detail', async () => {
    const log = vi.fn()
    mockDinho(log)
    const { default: logger } = await import('./renderer-logger')
    logger.error('TestCtx', 'something failed', new Error('disk full'))
    expect(log).toHaveBeenCalledWith('error', '[TestCtx] something failed — disk full')
  })

  it('error logs message with string detail', async () => {
    const log = vi.fn()
    mockDinho(log)
    const { default: logger } = await import('./renderer-logger')
    logger.error('TestCtx', 'oops', 'bad thing')
    expect(log).toHaveBeenCalledWith('error', '[TestCtx] oops — bad thing')
  })

  it('error logs componentStack for ErrorInfo objects', async () => {
    const log = vi.fn()
    mockDinho(log)
    const { default: logger } = await import('./renderer-logger')
    logger.error('TestCtx', 'Caught', { componentStack: '\n    at Card\n    at Page\n' })
    expect(log).toHaveBeenCalledWith('error', '[TestCtx] Caught — componentStack: | at Card | at Page |')
  })

  it('error logs message without detail when err is undefined', async () => {
    const log = vi.fn()
    mockDinho(log)
    const { default: logger } = await import('./renderer-logger')
    logger.error('TestCtx', 'just a message')
    expect(log).toHaveBeenCalledWith('error', '[TestCtx] just a message')
  })

  it('warn sends warn level', async () => {
    const log = vi.fn()
    mockDinho(log)
    const { default: logger } = await import('./renderer-logger')
    logger.warn('WarnCtx', 'a warning')
    expect(log).toHaveBeenCalledWith('warn', '[WarnCtx] a warning')
  })

  it('info sends info level', async () => {
    const log = vi.fn()
    mockDinho(log)
    const { default: logger } = await import('./renderer-logger')
    logger.info('InfoCtx', 'some info')
    expect(log).toHaveBeenCalledWith('info', '[InfoCtx] some info')
  })

  it('does not throw when window.dinho is undefined', async () => {
    window.dinho = undefined as never
    const { default: logger } = await import('./renderer-logger')
    expect(() => logger.info('Ctx', 'msg')).not.toThrow()
  })

  it('does not throw when window.dinho.log is undefined', async () => {
    window.dinho = {} as never
    const { default: logger } = await import('./renderer-logger')
    expect(() => logger.info('Ctx', 'msg')).not.toThrow()
  })
})
