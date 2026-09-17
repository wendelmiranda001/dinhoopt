import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileWatcherService } from './file-watcher.service'

vi.mock('node:fs', () => ({
  watch: vi.fn(),
}))

import type { FSWatcher, PathLike } from 'node:fs'
import { watch } from 'node:fs'

const mockWatch = vi.mocked(watch)

describe('FileWatcherService', () => {
  let service: FileWatcherService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new FileWatcherService()
  })

  it('starts watching directories and emits events', () => {
    const listener = vi.fn()
    service.on('file-changed', listener)

    const cbCallback = vi.fn<(event: 'rename' | 'change', filename: string | null) => void>()
    mockWatch.mockImplementation(
      (_dir: PathLike, cb: (event: 'rename' | 'change', filename: string | null) => void) => {
        cbCallback.mockImplementation(cb)
        return { close: vi.fn() } as unknown as FSWatcher
      },
    )

    service.start(['C:\\test'])
    expect(mockWatch).toHaveBeenCalledWith('C:\\test', expect.any(Function))

    cbCallback('rename', 'test.txt')
    expect(listener).toHaveBeenCalledWith({
      filePath: 'C:\\test\\test.txt',
      eventType: 'rename',
      timestamp: expect.any(Number),
    })
  })

  it('skips already watched directories', () => {
    mockWatch.mockReturnValue({ close: vi.fn() } as unknown as FSWatcher)
    service.start(['C:\\test'])
    service.start(['C:\\test'])
    expect(mockWatch).toHaveBeenCalledTimes(1)
  })

  it('start with non-Error thrown by watch logs warning with String(err)', () => {
    mockWatch.mockImplementation(() => {
      throw 'watch-failed-string'
    })
    service.start(['C:\\broken-dir'])
    expect(service.getWatchedCount()).toBe(0)
  })

  it('start with Error thrown by watch logs warning with err.message', () => {
    mockWatch.mockImplementation(() => {
      throw new Error('EPERM: operation not permitted')
    })
    service.start(['C:\\restricted'])
    expect(service.getWatchedCount()).toBe(0)
  })

  it('reports isActive correctly', () => {
    mockWatch.mockReturnValue({ close: vi.fn() } as unknown as FSWatcher)
    expect(service.isActive()).toBe(false)
    service.start(['C:\\test'])
    expect(service.isActive()).toBe(true)
    service.stop()
    expect(service.isActive()).toBe(false)
  })

  it('stop clears all watchers', () => {
    const close1 = vi.fn()
    const close2 = vi.fn()
    mockWatch.mockReturnValue({ close: close1 } as unknown as FSWatcher)
    service.start(['C:\\dir1'])
    mockWatch.mockReturnValue({ close: close2 } as unknown as FSWatcher)
    service.start(['C:\\dir2'])
    service.stop()
    expect(close1).toHaveBeenCalled()
    expect(close2).toHaveBeenCalled()
    expect(service.getWatchedCount()).toBe(0)
  })

  it('getWatchedCount returns number of active watchers', () => {
    mockWatch.mockReturnValue({ close: vi.fn() } as unknown as FSWatcher)
    expect(service.getWatchedCount()).toBe(0)
    service.start(['C:\\a', 'C:\\b'])
    expect(service.getWatchedCount()).toBe(2)
  })

  it('does not emit when filename is null', () => {
    const listener = vi.fn()
    service.on('file-changed', listener)

    mockWatch.mockImplementation(
      (_dir: PathLike, cb: (event: 'rename' | 'change', filename: string | null) => void) => {
        cb('change', null)
        return { close: vi.fn() } as unknown as FSWatcher
      },
    )

    service.start(['C:\\test'])
    expect(listener).not.toHaveBeenCalled()
  })
})
