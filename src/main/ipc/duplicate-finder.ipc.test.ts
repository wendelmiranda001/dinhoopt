import { EventEmitter } from 'node:events'
import { IPC } from '@shared/channels'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ──

const mockHandle = vi.fn()
const mockShowOpenDialog = vi.fn()
const mockTrashItem = vi.fn()
const mockShowItemInFolder = vi.fn()
const mockCreateReadStream = vi.fn()
const mockReaddir = vi.fn()
const mockStat = vi.fn()
const mockRm = vi.fn()
const mockCreateHash = vi.fn()
const mockLogger = { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() }

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { handle: (...args: unknown[]) => mockHandle(...args) },
  dialog: { showOpenDialog: (...args: unknown[]) => mockShowOpenDialog(...args) },
  shell: {
    trashItem: (...args: unknown[]) => mockTrashItem(...args),
    showItemInFolder: (...args: unknown[]) => mockShowItemInFolder(...args),
  },
}))

vi.mock('node:fs', () => ({
  createReadStream: (...args: unknown[]) => mockCreateReadStream(...args),
}))

vi.mock('node:fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  rm: (...args: unknown[]) => mockRm(...args),
}))

vi.mock('node:crypto', () => ({
  createHash: (...args: unknown[]) => mockCreateHash(...args),
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mockLogger,
}))

import { registerDuplicateFinderIpc } from './duplicate-finder.ipc'

// ── Helpers ──

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`Handler for channel "${channel}" not registered`)
  return call[1] as (...args: unknown[]) => unknown
}

function makeBrowserWindowMock() {
  const send = vi.fn()
  return {
    isDestroyed: vi.fn(() => false),
    webContents: { send },
  }
}

function makeDirent(name: string, type: 'file' | 'dir' | 'symlink' = 'file') {
  return {
    name,
    isFile: () => type === 'file',
    isDirectory: () => type === 'dir',
    isSymbolicLink: () => type === 'symlink',
  }
}

function makeHashStream() {
  const stream = new EventEmitter()
  process.nextTick(() => {
    stream.emit('data', Buffer.from('test'))
    stream.emit('end')
  })
  return stream
}

function makeHashObj(digestValue: string) {
  return { update: vi.fn(), digest: vi.fn(() => digestValue) }
}

function defaultScanOptions() {
  return {
    directory: '/test',
    minFileSize: 0,
    maxFileSize: null,
    excludePatterns: [],
    extensionFilter: [],
    maxDepth: 20,
  }
}

// ── Tests ──

describe('registerDuplicateFinderIpc', () => {
  let win: ReturnType<typeof makeBrowserWindowMock>
  let getWindow: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetAllMocks()
    win = makeBrowserWindowMock()
    getWindow = vi.fn(() => win as unknown as Electron.BrowserWindow)

    // Sensible defaults so mocks return valid values unless overridden    mockReaddir.mockResolvedValue([])
    mockStat.mockResolvedValue({ size: 0, mtimeMs: 0 })
    mockCreateHash.mockReturnValue(makeHashObj('default'))
    mockCreateReadStream.mockReturnValue(makeHashStream())
    mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    mockTrashItem.mockResolvedValue(undefined)
    mockRm.mockResolvedValue(undefined)

    registerDuplicateFinderIpc(getWindow as never)
  })

  afterEach(() => {
    const cancelHandler = getHandler(IPC.DUPLICATES_CANCEL) as () => void
    cancelHandler()
  })

  // ── Handler registration ──

  describe('handler registration', () => {
    it('registers all 5 IPC handlers', () => {
      const channels = mockHandle.mock.calls.map((c) => c[0])
      expect(channels).toContain(IPC.DUPLICATES_SELECT_DIR)
      expect(channels).toContain(IPC.DUPLICATES_CANCEL)
      expect(channels).toContain(IPC.DUPLICATES_SCAN)
      expect(channels).toContain(IPC.DUPLICATES_DELETE)
      expect(channels).toContain(IPC.DUPLICATES_OPEN_LOCATION)
      expect(channels).toHaveLength(5)
    })
  })

  // ── Select Dir ──

  describe('IPC.DUPLICATES_SELECT_DIR', () => {
    it('returns selected directory path', async () => {
      mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/selected/dir'] })
      const handler = getHandler(IPC.DUPLICATES_SELECT_DIR) as () => Promise<string | null>
      expect(await handler()).toBe('/selected/dir')
    })

    it('returns null when dialog is cancelled', async () => {
      const handler = getHandler(IPC.DUPLICATES_SELECT_DIR) as () => Promise<string | null>
      expect(await handler()).toBeNull()
    })

    it('returns null when no window available', async () => {
      getWindow.mockReturnValueOnce(null)
      const handler = getHandler(IPC.DUPLICATES_SELECT_DIR) as () => Promise<string | null>
      expect(await handler()).toBeNull()
    })
  })

  // ── Cancel ──

  describe('IPC.DUPLICATES_CANCEL', () => {
    it('sets the cancelled flag and logs', () => {
      const handler = getHandler(IPC.DUPLICATES_CANCEL) as () => void
      handler()
      expect(mockLogger.info).toHaveBeenCalledWith('duplicate-finder', 'Scan cancelled by user')
    })
  })

  // ── Scan ──

  describe('IPC.DUPLICATES_SCAN', () => {
    it('returns empty result for null options', async () => {
      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, null)) as Record<string, unknown>
      expect(result).toMatchObject({ groups: [], totalDuplicates: 0, totalReclaimable: 0 })
    })

    it('returns empty result for non-object options', async () => {
      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, 'invalid')) as Record<string, unknown>
      expect(result).toMatchObject({ groups: [], totalDuplicates: 0, totalReclaimable: 0 })
    })

    it('returns empty result when no directory specified', async () => {
      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, {})) as Record<string, unknown>
      expect(result).toMatchObject({ groups: [], totalDuplicates: 0, totalReclaimable: 0 })
    })

    it('performs full scan and finds duplicate groups', async () => {
      mockReaddir.mockImplementation((path: string) => {
        if (path.includes('subdir')) return [makeDirent('file3.txt', 'file')]
        return [
          makeDirent('file1.txt', 'file'),
          makeDirent('file2.txt', 'file'),
          makeDirent('unique.txt', 'file'),
          makeDirent('subdir', 'dir'),
          makeDirent('small.txt', 'file'),
        ]
      })
      mockStat.mockImplementation((path: string) => {
        if (path.includes('small.txt')) return { size: 10, mtimeMs: 1000 }
        return { size: 2_000_000, mtimeMs: 1000 }
      })

      let digestCalls = 0
      mockCreateHash.mockReturnValue({
        update: vi.fn(),
        digest: vi.fn(() => {
          digestCalls++
          if (digestCalls === 3) return 'b'.repeat(64)
          if (digestCalls <= 4) return 'a'.repeat(64)
          return 'a'.repeat(64)
        }),
      })
      mockCreateReadStream.mockImplementation(() => makeHashStream())

      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, defaultScanOptions())) as Record<string, unknown>

      expect(result).toMatchObject({
        totalDuplicates: 2,
        totalReclaimable: 4_000_000,
        totalFilesScanned: 5,
        cancelled: false,
      })
      const groups = result.groups as Array<Record<string, unknown>>
      expect(groups).toHaveLength(1)
      expect(groups[0]!).toMatchObject({
        fileSize: 2_000_000,
        reclaimableSpace: 4_000_000,
      })
      const files = groups[0]!.files as Array<Record<string, unknown>>
      expect(files).toHaveLength(3)

      expect(win.webContents.send).toHaveBeenCalledWith(
        IPC.DUPLICATES_PROGRESS,
        expect.objectContaining({ phase: 'grouping' }),
      )
      expect(win.webContents.send).toHaveBeenCalledWith(
        IPC.DUPLICATES_PROGRESS,
        expect.objectContaining({ phase: 'partial-hash' }),
      )
      expect(win.webContents.send).toHaveBeenCalledWith(
        IPC.DUPLICATES_PROGRESS,
        expect.objectContaining({ phase: 'full-hash' }),
      )
      expect(win.webContents.send).toHaveBeenCalledWith(
        IPC.DUPLICATES_PROGRESS,
        expect.objectContaining({ phase: 'complete' }),
      )
    }, 15000)

    it('respects minFileSize filter', async () => {
      mockReaddir.mockResolvedValue([makeDirent('file.txt', 'file')])
      mockStat.mockResolvedValue({ size: 500, mtimeMs: 1000 })

      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, { ...defaultScanOptions(), minFileSize: 1024 })) as Record<string, unknown>
      expect(result.totalFilesScanned).toBe(0)
    })

    it('respects maxFileSize filter', async () => {
      mockReaddir.mockResolvedValue([makeDirent('file.txt', 'file')])
      mockStat.mockResolvedValue({ size: 2_000_000, mtimeMs: 1000 })

      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, { ...defaultScanOptions(), maxFileSize: 1_000_000 })) as Record<
        string,
        unknown
      >
      expect(result.totalFilesScanned).toBe(0)
    })

    it('respects extension filter', async () => {
      mockReaddir.mockResolvedValue([makeDirent('file.txt', 'file'), makeDirent('file.jpg', 'file')])
      mockStat.mockResolvedValue({ size: 2_000_000, mtimeMs: 1000 })

      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, { ...defaultScanOptions(), extensionFilter: ['.jpg'] })) as Record<
        string,
        unknown
      >
      expect(result.totalFilesScanned).toBe(1)
    })

    it('respects maxDepth limit', async () => {
      mockReaddir.mockResolvedValue([makeDirent('subdir', 'dir')])

      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, { ...defaultScanOptions(), maxDepth: 0 })) as Record<string, unknown>
      expect(result.totalFilesScanned).toBe(0)
    })

    it('skips symlinks', async () => {
      mockReaddir.mockResolvedValue([makeDirent('real.txt', 'file'), makeDirent('link.txt', 'symlink')])
      mockStat.mockResolvedValue({ size: 2_000_000, mtimeMs: 1000 })

      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, defaultScanOptions())) as Record<string, unknown>
      expect(result.totalFilesScanned).toBe(1)
    })

    it('handles readdir error gracefully (inaccessible directory)', async () => {
      mockReaddir.mockRejectedValue(new Error('EACCES'))

      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, defaultScanOptions())) as Record<string, unknown>
      expect(result.totalFilesScanned).toBe(0)
      expect(result.cancelled).toBe(false)
    })

    it('handles inaccessible files during stat', async () => {
      mockReaddir.mockResolvedValue([makeDirent('bad.txt', 'file')])
      mockStat.mockRejectedValue(new Error('EACCES'))

      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, defaultScanOptions())) as Record<string, unknown>
      expect(result.totalFilesScanned).toBe(0)
    })

    it('returns cancelled result when cancelled during walk', async () => {
      mockReaddir.mockResolvedValue([makeDirent('file1.txt', 'file'), makeDirent('file2.txt', 'file')])
      let statCalls = 0
      mockStat.mockImplementation(async () => {
        statCalls++
        if (statCalls === 1) {
          const cancelHandler = getHandler(IPC.DUPLICATES_CANCEL) as () => void
          cancelHandler()
        }
        return { size: 2_000_000, mtimeMs: 1000 }
      })

      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, defaultScanOptions())) as Record<string, unknown>
      expect(result.cancelled).toBe(true)
      expect(result.totalFilesScanned).toBe(1)
    })

    it('returns early when no size-based duplicate groups', async () => {
      mockReaddir.mockResolvedValue([makeDirent('unique.txt', 'file')])
      mockStat.mockResolvedValue({ size: 2_000_000, mtimeMs: 1000 })

      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, defaultScanOptions())) as Record<string, unknown>
      expect(result.groups).toHaveLength(0)
      expect(result.totalDuplicates).toBe(0)
      expect(result.cancelled).toBe(false)
    })

    it('returns empty result when cancelled during hashing', async () => {
      mockReaddir.mockResolvedValue([makeDirent('file1.txt', 'file'), makeDirent('file2.txt', 'file')])
      mockStat.mockResolvedValue({ size: 2_000_000, mtimeMs: 1000 })

      let digestCalls = 0
      mockCreateHash.mockReturnValue({
        update: vi.fn(),
        digest: vi.fn(() => {
          digestCalls++
          if (digestCalls === 1) {
            const cancelHandler = getHandler(IPC.DUPLICATES_CANCEL) as () => void
            cancelHandler()
          }
          return 'a'.repeat(64)
        }),
      })

      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, defaultScanOptions())) as Record<string, unknown>
      expect(result.cancelled).toBe(true)
      expect(result.groups).toHaveLength(0)
    })

    it('recovers from stream error during hashing', async () => {
      mockReaddir.mockResolvedValue([makeDirent('file1.txt', 'file'), makeDirent('file2.txt', 'file')])
      mockStat.mockResolvedValue({ size: 2_000_000, mtimeMs: 1000 })
      mockCreateHash.mockReturnValue(makeHashObj('a'.repeat(64)))

      let streamCount = 0
      mockCreateReadStream.mockImplementation(() => {
        streamCount++
        const stream = new EventEmitter()
        const currentCount = streamCount
        process.nextTick(() => {
          if (currentCount === 1) {
            stream.emit('error', new Error('Read error'))
          } else {
            stream.emit('data', Buffer.from('test'))
            stream.emit('end')
          }
        })
        return stream
      })

      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, defaultScanOptions())) as Record<string, unknown>
      expect(result.groups).toHaveLength(0)
    })

    it('destroys in-flight hash streams when cancelled', async () => {
      mockReaddir.mockResolvedValue([makeDirent('file1.txt', 'file'), makeDirent('file2.txt', 'file')])
      mockStat.mockResolvedValue({ size: 2_000_000, mtimeMs: 1000 })
      mockCreateHash.mockReturnValue(makeHashObj('a'.repeat(64)))

      type MockStream = EventEmitter & { destroy: ReturnType<typeof vi.fn> }
      const streams: MockStream[] = []
      mockCreateReadStream.mockImplementation(() => {
        const stream = new EventEmitter() as MockStream
        stream.destroy = vi.fn(() => {
          stream.emit('close')
        })
        streams.push(stream)
        // Emit data but never 'end' — the stream stays open, holding its fd
        process.nextTick(() => {
          stream.emit('data', Buffer.from('test'))
        })
        return stream
      })

      const scanHandler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const cancelHandler = getHandler(IPC.DUPLICATES_CANCEL) as () => void

      const scanPromise = scanHandler(null, defaultScanOptions())
      // Give the hashing phase time to open its streams
      await new Promise((r) => setTimeout(r, 30))
      cancelHandler()

      const result = (await scanPromise) as Record<string, unknown>
      expect(result.cancelled).toBe(true)
      expect(result.groups).toHaveLength(0)

      expect(streams.length).toBeGreaterThan(0)
      for (const s of streams) {
        expect(s.destroy).toHaveBeenCalled()
      }
    })

    it('excludes directories matching excludePatterns', async () => {
      mockReaddir.mockImplementation((path: string) => {
        if (path.includes('node_modules')) return [makeDirent('dep.js', 'file')]
        return [makeDirent('file.txt', 'file'), makeDirent('node_modules', 'dir')]
      })
      mockStat.mockResolvedValue({ size: 2_000_000, mtimeMs: 1000 })

      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, { ...defaultScanOptions(), excludePatterns: ['node_modules'] })) as Record<
        string,
        unknown
      >
      expect(result.totalFilesScanned).toBe(1)
    })

    it('provides default values when options are missing', async () => {
      mockReaddir.mockResolvedValue([makeDirent('file.txt', 'file')])
      mockStat.mockResolvedValue({ size: 500, mtimeMs: 1000 })

      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, { directory: '/test', minFileSize: 1000 })) as Record<string, unknown>
      expect(result.totalFilesScanned).toBe(0)
    })

    it('validates excludePatterns and extensionFilter arrays', async () => {
      mockReaddir.mockResolvedValue([makeDirent('f.txt', 'file')])
      mockStat.mockResolvedValue({ size: 100, mtimeMs: 1000 })

      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, {
        directory: '/test',
        minFileSize: 0,
        excludePatterns: 'not-array' as unknown as string[],
        extensionFilter: 123 as unknown as string[],
      })) as Record<string, unknown>
      expect(result.totalFilesScanned).toBe(1)
    })
  })

  // ── Delete ──

  describe('IPC.DUPLICATES_DELETE', () => {
    it('sends files to recycle bin in recycle mode', async () => {
      mockStat.mockResolvedValue({ size: 2_000_000, mtimeMs: 1000 })
      mockTrashItem.mockResolvedValue(undefined)

      const handler = getHandler(IPC.DUPLICATES_DELETE) as (
        _e: unknown,
        paths: unknown,
        mode: unknown,
      ) => Promise<unknown>
      const result = await handler(null, ['C:\\file1.txt', 'C:\\file2.txt'], 'recycle')

      expect(result).toMatchObject({ deleted: 2, failed: 0, spaceRecovered: 4_000_000, errors: [] })
      expect(mockTrashItem).toHaveBeenCalledTimes(2)
      expect(mockRm).not.toHaveBeenCalled()
    })

    it('permanently deletes files in permanent mode', async () => {
      mockStat.mockResolvedValue({ size: 2_000_000, mtimeMs: 1000 })
      mockRm.mockResolvedValue(undefined)

      const handler = getHandler(IPC.DUPLICATES_DELETE) as (
        _e: unknown,
        paths: unknown,
        mode: unknown,
      ) => Promise<unknown>
      const result = await handler(null, ['C:\\file.txt'], 'permanent')

      expect(result).toMatchObject({ deleted: 1, failed: 0, spaceRecovered: 2_000_000, errors: [] })
      expect(mockRm).toHaveBeenCalledWith('C:\\file.txt', { force: true })
      expect(mockTrashItem).not.toHaveBeenCalled()
    })

    it('uses recycle mode by default for unknown mode', async () => {
      mockStat.mockResolvedValue({ size: 1_000_000, mtimeMs: 1000 })
      mockTrashItem.mockResolvedValue(undefined)

      const handler = getHandler(IPC.DUPLICATES_DELETE) as (
        _e: unknown,
        paths: unknown,
        mode: unknown,
      ) => Promise<unknown>
      const result = await handler(null, ['C:\\file.txt'], 'unknown-mode')

      expect(result).toMatchObject({ deleted: 1, failed: 0, spaceRecovered: 1_000_000 })
      expect(mockTrashItem).toHaveBeenCalledTimes(1)
    })

    it('returns zero counts for non-array paths', async () => {
      const handler = getHandler(IPC.DUPLICATES_DELETE) as (
        _e: unknown,
        paths: unknown,
        mode: unknown,
      ) => Promise<unknown>
      const result = await handler(null, null, 'permanent')

      expect(result).toMatchObject({ deleted: 0, failed: 0, spaceRecovered: 0, errors: [] })
    })

    it('filters out non-absolute paths', async () => {
      mockStat.mockResolvedValue({ size: 1_000_000, mtimeMs: 1000 })
      mockRm.mockResolvedValue(undefined)

      const handler = getHandler(IPC.DUPLICATES_DELETE) as (
        _e: unknown,
        paths: unknown,
        mode: unknown,
      ) => Promise<unknown>
      const result = await handler(null, ['relative/path.txt', 123 as unknown as string, 'C:\\valid.txt'], 'permanent')

      expect(result).toMatchObject({ deleted: 1, failed: 0, spaceRecovered: 1_000_000 })
    })

    it('handles stat errors gracefully', async () => {
      mockStat.mockRejectedValue(new Error('File not found'))

      const handler = getHandler(IPC.DUPLICATES_DELETE) as (
        _e: unknown,
        paths: unknown,
        mode: unknown,
      ) => Promise<unknown>
      const result = (await handler(null, ['C:\\missing.txt'], 'permanent')) as {
        errors: Array<{ path: string; reason: string }>
      }

      expect(result).toMatchObject({ deleted: 0, failed: 1, spaceRecovered: 0 })
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]!.path).toBe('C:\\missing.txt')
    })

    it('handles trashItem errors gracefully', async () => {
      mockStat.mockResolvedValue({ size: 2_000_000, mtimeMs: 1000 })
      mockTrashItem.mockRejectedValue(new Error('Trash unavailable'))

      const handler = getHandler(IPC.DUPLICATES_DELETE) as (
        _e: unknown,
        paths: unknown,
        mode: unknown,
      ) => Promise<unknown>
      const result = (await handler(null, ['C:\\file.txt'], 'recycle')) as {
        errors: Array<{ path: string; reason: string }>
      }

      expect(result).toMatchObject({ deleted: 0, failed: 1, spaceRecovered: 0 })
      expect(result.errors[0]!.reason).toBe('Trash unavailable')
    })

    it('handles rm errors gracefully', async () => {
      mockStat.mockResolvedValue({ size: 2_000_000, mtimeMs: 1000 })
      mockRm.mockRejectedValue(new Error('Access denied'))

      const handler = getHandler(IPC.DUPLICATES_DELETE) as (
        _e: unknown,
        paths: unknown,
        mode: unknown,
      ) => Promise<unknown>
      const result = (await handler(null, ['C:\\file.txt'], 'permanent')) as {
        errors: Array<{ path: string; reason: string }>
      }

      expect(result).toMatchObject({ deleted: 0, failed: 1, spaceRecovered: 0 })
      expect(result.errors[0]!.reason).toBe('Access denied')
    })
  })

  // ── Open Location ──

  describe('IPC.DUPLICATES_OPEN_LOCATION', () => {
    it('opens file location for a valid absolute path', () => {
      const handler = getHandler(IPC.DUPLICATES_OPEN_LOCATION) as (_e: unknown, path: unknown) => void
      handler(null, 'C:\\Users\\file.txt')

      expect(mockShowItemInFolder).toHaveBeenCalledWith('C:\\Users\\file.txt')
    })

    it('ignores non-string filePath', () => {
      const handler = getHandler(IPC.DUPLICATES_OPEN_LOCATION) as (_e: unknown, path: unknown) => void
      handler(null, 123)

      expect(mockShowItemInFolder).not.toHaveBeenCalled()
    })

    it('ignores non-absolute filePath', () => {
      const handler = getHandler(IPC.DUPLICATES_OPEN_LOCATION) as (_e: unknown, path: unknown) => void
      handler(null, 'relative/file.txt')

      expect(mockShowItemInFolder).not.toHaveBeenCalled()
    })
  })

  // ── Progress ──

  describe('sendProgress', () => {
    it('does not send progress when window is destroyed', async () => {
      const destroyedSend = vi.fn()
      getWindow.mockReturnValue({
        isDestroyed: vi.fn(() => true),
        webContents: { send: destroyedSend },
      } as unknown as Electron.BrowserWindow)
      mockReaddir.mockResolvedValue([makeDirent('file.txt', 'file')])
      mockStat.mockResolvedValue({ size: 2_000_000, mtimeMs: 1000 })

      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      await handler(null, defaultScanOptions())

      expect(destroyedSend).not.toHaveBeenCalled()
    })

    it('does not send progress when window is null', async () => {
      getWindow.mockReturnValue(null)
      mockReaddir.mockResolvedValue([makeDirent('file.txt', 'file')])
      mockStat.mockResolvedValue({ size: 2_000_000, mtimeMs: 1000 })

      const handler = getHandler(IPC.DUPLICATES_SCAN) as (_e: unknown, opts: unknown) => Promise<unknown>
      const result = (await handler(null, defaultScanOptions())) as Record<string, unknown>
      expect(result.totalFilesScanned).toBe(1)
    })
  })
})
