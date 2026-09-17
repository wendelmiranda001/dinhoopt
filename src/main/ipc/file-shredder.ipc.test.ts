import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ──

const mockHandle = vi.fn()
const mockSend = vi.fn()
const mockShowOpenDialog = vi.fn()
const mockShowItemInFolder = vi.fn()
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  dialog: { showOpenDialog: (...args: unknown[]) => mockShowOpenDialog(...args) },
  ipcMain: { handle: (...args: unknown[]) => mockHandle(...args) },
  shell: { showItemInFolder: (...args: unknown[]) => mockShowItemInFolder(...args) },
}))

const mockReaddir = vi.fn()
const mockRmdir = vi.fn()
const mockStat = vi.fn()
const mockLstat = vi.fn()
const mockOpen = vi.fn()
const mockRm = vi.fn()
vi.mock('fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  rmdir: (...args: unknown[]) => mockRmdir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  lstat: (...args: unknown[]) => mockLstat(...args),
  open: (...args: unknown[]) => mockOpen(...args),
  rm: (...args: unknown[]) => mockRm(...args),
}))

vi.mock('crypto', () => ({
  randomBytes: (len: number) => Buffer.alloc(len, 0xaa),
}))

vi.mock('./sender-validation', () => ({
  validateSender: vi.fn(() => true),
}))

import { registerFileShredderIpc } from './file-shredder.ipc'

// ── Helpers ──

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function mockWindow() {
  return { isDestroyed: () => false, webContents: { send: mockSend } }
}

// ── Tests ──

describe('registerFileShredderIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all shredder IPC handlers', () => {
    registerFileShredderIpc(() => null)
    const channels = mockHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('shredder:select-files')
    expect(channels).toContain('shredder:select-folders')
    expect(channels).toContain('shredder:cancel')
    expect(channels).toContain('shredder:shred')
    expect(channels).toContain('shredder:open-location')
  })
})

describe('SHREDDER_SELECT_FILES handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when no window', async () => {
    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:select-files')
    const result = await handler()
    expect(result).toEqual([])
  })

  it('returns empty array when dialog is canceled', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:select-files')
    const result = await handler()
    expect(result).toEqual([])
  })

  it('returns empty array when no files selected', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] })
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:select-files')
    const result = await handler()
    expect(result).toEqual([])
  })

  it('returns file entries with size information', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/home/user/secret.txt', '/home/user/data.bin'],
    })
    mockStat.mockImplementation((p: string) => {
      if (p === '/home/user/secret.txt') return Promise.resolve({ size: 1024 })
      if (p === '/home/user/data.bin') return Promise.resolve({ size: 2048 })
      return Promise.reject(new Error('ENOENT'))
    })
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:select-files')
    const result = (await handler()) as Array<{ path: string; size: number; isDirectory: boolean; name: string }>

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(
      expect.objectContaining({
        path: '/home/user/secret.txt',
        size: 1024,
        isDirectory: false,
      }),
    )
    expect(result[0]!.name).toBe('secret.txt')
  })

  it('skips files that fail stat', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/home/user/gone.txt', '/home/user/exists.txt'],
    })
    mockStat.mockImplementation((p: string) => {
      if (p === '/home/user/gone.txt') return Promise.reject(new Error('ENOENT'))
      return Promise.resolve({ size: 512 })
    })
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:select-files')
    const result = (await handler()) as Array<{ path: string }>
    expect(result).toHaveLength(1)
    expect(result[0]!.path).toBe('/home/user/exists.txt')
  })
})

describe('SHREDDER_SELECT_FOLDERS handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when no window', async () => {
    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:select-folders')
    const result = await handler()
    expect(result).toEqual([])
  })

  it('returns empty array when dialog is canceled', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:select-folders')
    const result = await handler()
    expect(result).toEqual([])
  })

  it('returns folder entries with calculated size', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/home/user/secret-folder'],
    })
    // getEntrySize calls lstat, readdir, stat
    mockLstat.mockResolvedValue({ isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, size: 0 })
    mockReaddir.mockResolvedValue([
      { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, name: 'a.txt' },
    ])
    mockStat.mockResolvedValue({ isDirectory: () => false, size: 5000 })
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:select-folders')
    const result = (await handler()) as Array<{ isDirectory: boolean; name: string }>

    expect(result).toHaveLength(1)
    expect(result[0]!.isDirectory).toBe(true)
    expect(result[0]!.name).toBe('secret-folder')
  })

  it('handles non-file non-directory entries in getEntrySize', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/home/user/mixed-folder'],
    })
    mockLstat.mockImplementation((p: string) => {
      if (p === '/home/user/mixed-folder') {
        return Promise.resolve({ isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, size: 0 })
      }
      // socket.sock — non-file, non-directory → triggers fallthrough
      return Promise.resolve({ isSymbolicLink: () => false, isFile: () => false, isDirectory: () => false, size: 0 })
    })
    mockReaddir.mockResolvedValue([
      { isSymbolicLink: () => false, isFile: () => false, isDirectory: () => false, name: 'socket.sock' },
    ])
    mockStat.mockResolvedValue({ size: 0 })
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:select-folders')
    const result = (await handler()) as Array<{ isDirectory: boolean; size: number }>
    expect(result).toHaveLength(1)
    expect(result[0]!.size).toBe(0) // Non-file entries contribute 0
  })

  it('skips symlink entries when calculating folder size', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/home/user/link-folder'],
    })
    mockLstat.mockImplementation((p: string) => {
      if (p === '/home/user/link-folder') {
        return Promise.resolve({ isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, size: 0 })
      }
      // regular file entry stats
      return Promise.resolve({ isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, size: 42 })
    })
    mockReaddir.mockResolvedValue([
      { isSymbolicLink: () => true, isFile: () => false, isDirectory: () => false, name: 'link-to-somewhere' },
      { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, name: 'real.txt' },
    ])
    mockStat.mockResolvedValue({ size: 42 })
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:select-folders')
    const result = (await handler()) as Array<{ isDirectory: boolean; size: number }>
    expect(result).toHaveLength(1)
    // symlink entry is skipped, only real.txt contributes
    expect(result[0]!.size).toBe(42)
  })
})

describe('SHREDDER_CANCEL handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets the cancelled flag (does not throw)', () => {
    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:cancel')
    expect(() => handler()).not.toThrow()
  })
})

describe('SHREDDER_SHRED handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty result for non-array input', async () => {
    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, 'not-an-array')) as {
      shredded: number
      failed: number
      bytesShredded: number
      cancelled: boolean
    }
    expect(result).toEqual(
      expect.objectContaining({
        shredded: 0,
        failed: 0,
        bytesShredded: 0,
        cancelled: false,
      }),
    )
  })

  it('returns empty result for empty array', async () => {
    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, [])) as { shredded: number }
    expect(result).toEqual(expect.objectContaining({ shredded: 0 }))
  })

  it('filters out non-string and relative path entries', async () => {
    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, [123, 'relative/path', null])) as { shredded: number }
    expect(result).toEqual(expect.objectContaining({ shredded: 0 }))
  })

  it('blocks protected system paths', async () => {
    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    // Root-level paths should be blocked
    const result = (await handler({}, ['/usr', '/etc', '/bin'])) as {
      failed: number
      errors: Array<{ reason: string }>
    }
    expect(result.failed).toBeGreaterThan(0)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]!.reason).toContain('Protected system path')
  })

  it('shreds a single file successfully', async () => {
    const mockFh = {
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      isDirectory: () => false,
      size: 512,
    })
    mockOpen.mockResolvedValue(mockFh)
    mockRm.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 512 })
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/temp/secret.txt'])) as {
      shredded: number
      bytesShredded: number
      failed: number
    }

    expect(result.shredded).toBe(1)
    expect(result.bytesShredded).toBe(512)
    expect(result.failed).toBe(0)
    // File handle should have been written to (random pass + zero pass)
    expect(mockFh.write).toHaveBeenCalled()
    expect(mockFh.datasync).toHaveBeenCalled()
  })

  it('handles shred errors and reports them', async () => {
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
    })
    mockOpen.mockRejectedValue(new Error('EACCES: permission denied'))
    mockStat.mockResolvedValue({ size: 100 })
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/temp/locked.txt'])) as {
      failed: number
      errors: Array<{ path: string }>
    }

    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.path).toBe('/home/user/temp/locked.txt')
  })

  it('deduplicates file paths', async () => {
    const mockFh = {
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
    })
    mockOpen.mockResolvedValue(mockFh)
    mockRm.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 100 })

    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/temp/file.txt', '/home/user/temp/file.txt'])) as { shredded: number }

    // Should only shred once despite duplicate path
    expect(result.shredded).toBe(1)
  })

  it('skips symlinks during file shredding', async () => {
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => true,
      isFile: () => false,
      isDirectory: () => false,
      size: 100,
    })

    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/temp/link'])) as { shredded: number }

    expect(result.shredded).toBe(0)
  })

  it('recursively collects files from directories', async () => {
    const mockFh = {
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }

    let _lstatCallCount = 0
    mockLstat.mockImplementation((p: string) => {
      _lstatCallCount++
      if (p === '/home/user/temp/mydir') {
        return Promise.resolve({ isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, size: 0 })
      }
      // shredFile lstat
      return Promise.resolve({ isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, size: 256 })
    })

    mockReaddir.mockImplementation((p: string) => {
      if (typeof p === 'string' && p.includes('mydir')) {
        return Promise.resolve([
          { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, name: 'inner.txt' },
        ])
      }
      return Promise.resolve([])
    })

    mockOpen.mockResolvedValue(mockFh)
    mockRm.mockResolvedValue(undefined)
    mockRmdir.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 256 })
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/temp/mydir'])) as { shredded: number }

    expect(result.shredded).toBe(1)
  })

  it('cancels shredding mid-operation', async () => {
    let writeCount = 0
    const mockFh = {
      write: vi.fn().mockImplementation(() => {
        writeCount++
        // Cancel on the second write call (first chunk of zero pass)
        if (writeCount === 2) {
          getHandler('shredder:cancel')()
        }
        return Promise.resolve(undefined)
      }),
      datasync: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      isDirectory: () => false,
      size: 1024 * 1024, // 1MB = 1 chunk per pass
    })
    mockOpen.mockResolvedValue(mockFh)
    mockStat.mockResolvedValue({ size: 1024 * 1024 })
    mockRm.mockResolvedValue(undefined)

    registerFileShredderIpc(() => null)
    const shredHandler = getHandler('shredder:shred')
    const result = (await shredHandler({}, ['/home/user/temp/big.bin'])) as { cancelled: boolean; shredded: number }
    expect(result.cancelled).toBe(true)
  })

  it('sends progress during long shred', async () => {
    const mockFh = {
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      isDirectory: () => false,
      size: 1024 * 1024 * 10,
    })
    mockOpen.mockResolvedValue(mockFh)
    mockRm.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 1024 * 1024 * 10 })
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:shred')
    await handler({}, ['/home/user/temp/big.bin'])

    expect(mockSend).toHaveBeenCalledWith('shredder:progress', expect.any(Object))
  })

  it('recursively removes empty subdirectories', async () => {
    const mockFh = {
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }

    const dirPath = '/home/user/temp/mydir'
    const subdirPath = `${dirPath}/subdir`

    mockLstat.mockImplementation((p: string) => {
      const path = String(p)
      if (path === dirPath || path === subdirPath) {
        return Promise.resolve({ isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, size: 0 })
      }
      return Promise.resolve({ isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, size: 100 })
    })

    mockReaddir.mockImplementation((p: string) => {
      if (String(p).includes('subdir')) return Promise.resolve([])
      return Promise.resolve([
        { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, name: 'inner.txt' },
        { isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, name: 'subdir' },
      ])
    })

    mockOpen.mockResolvedValue(mockFh)
    mockRm.mockResolvedValue(undefined)
    mockRmdir.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 100 })
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, [dirPath])) as { shredded: number }

    expect(result.shredded).toBe(1)
    expect(mockRmdir).toHaveBeenCalledWith(expect.stringContaining('subdir'))
    expect(mockRmdir).toHaveBeenCalledWith(expect.stringContaining('mydir'))
  })

  it('collectFiles skips symlinks', async () => {
    const mockFh = {
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mockLstat.mockImplementation((p: string) => {
      if (p === '/home/user/temp/mydir') {
        return Promise.resolve({ isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, size: 0 })
      }
      return Promise.resolve({ isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, size: 100 })
    })
    mockReaddir.mockResolvedValue([
      { isSymbolicLink: () => true, isFile: () => false, isDirectory: () => false, name: 'link' },
      { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, name: 'real.txt' },
    ])
    mockOpen.mockResolvedValue(mockFh)
    mockRm.mockResolvedValue(undefined)
    mockRmdir.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 100 })
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/temp/mydir'])) as { shredded: number }
    expect(result.shredded).toBe(1)
  })

  it('collectFiles recurses into nested subdirectories', async () => {
    const mockFh = {
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }

    const topPath = '/home/user/temp/nested'
    const levelPath = '/home/user/temp/nested/level1'

    mockLstat.mockImplementation((p: string) => {
      const path = String(p)
      if (path === topPath || path === levelPath) {
        return Promise.resolve({ isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, size: 0 })
      }
      return Promise.resolve({ isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, size: 50 })
    })

    mockReaddir.mockImplementation((p: string) => {
      if (String(p).includes('level1')) {
        return Promise.resolve([
          { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, name: 'deep.txt' },
        ])
      }
      return Promise.resolve([
        { isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, name: 'level1' },
      ])
    })

    mockOpen.mockResolvedValue(mockFh)
    mockRm.mockResolvedValue(undefined)
    mockRmdir.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 50 })
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, [topPath])) as { shredded: number }

    expect(result.shredded).toBe(1) // Only deep.txt was shredded
    expect(mockRm).toHaveBeenCalledWith(expect.stringContaining('deep.txt'), { force: true })
  })

  it('collectFiles sets depthExceeded at MAX_DEPTH', async () => {
    const mockFh = {
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }

    // Auto-generate 50 nested directories — each level readdir returns [a]
    const dirEntry = { isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, name: 'a' }
    mockLstat.mockResolvedValue({ isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, size: 0 })
    mockReaddir.mockResolvedValue([dirEntry])

    mockOpen.mockResolvedValue(mockFh)
    mockRm.mockResolvedValue(undefined)
    mockRmdir.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 0 })
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/temp/deep'])) as { shredded: number }

    // No files collected (all directories at every level)
    expect(result.shredded).toBe(0)
  })

  it('handles inaccessible directory during collectFiles', async () => {
    mockLstat.mockResolvedValue({ isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, size: 0 })
    mockReaddir.mockRejectedValue(new Error('EACCES'))

    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/temp/nope'])) as { shredded: number }
    expect(result.shredded).toBe(0)
  })

  it('collectFiles skips protected subdirectories', async () => {
    mockLstat.mockImplementation((p) => {
      const n = String(p).replace(/\\/g, '/')
      if (n.includes('notes.txt')) {
        return Promise.resolve({ isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, size: 100 })
      }
      return Promise.resolve({ isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, size: 0 })
    })
    mockReaddir.mockImplementation((p) => {
      const name = String(p).replace(/\\/g, '/')
      if (name === '/home/user/top') {
        return Promise.resolve([
          { name: '.git', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
          { name: 'safe', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
        ])
      }
      if (name === '/home/user/top/safe') {
        return Promise.resolve([
          { name: 'notes.txt', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
        ])
      }
      return Promise.resolve([])
    })
    mockOpen.mockResolvedValue({
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    })
    mockRm.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 100 })

    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/top'])) as { shredded: number }
    // .git is skipped, safe/notes.txt IS shredded
    expect(result.shredded).toBe(1)
  })

  it('collectFiles handles non-file non-directory entries', async () => {
    mockLstat.mockResolvedValue({ isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, size: 0 })
    mockReaddir.mockImplementation((p) => {
      const name = String(p)
      if (name === '/home/user/top') {
        return Promise.resolve([
          { name: 'socket.sock', isFile: () => false, isDirectory: () => false, isSymbolicLink: () => false },
          { name: 'readme.txt', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
        ])
      }
      return Promise.resolve([])
    })
    mockOpen.mockResolvedValue({
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    })
    mockRm.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 100 })

    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/top'])) as { shredded: number }
    // socket.sock is neither file nor directory, only readme.txt gets shredded
    expect(result.shredded).toBe(1)
  })

  it('handles cancelled during file write', async () => {
    const mockFh = {
      write: vi.fn().mockImplementation(() => {
        // Cancel via the cancel handler
        getHandler('shredder:cancel')()
        return Promise.resolve(undefined)
      }),
      datasync: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      isDirectory: () => false,
      size: 1024 * 1024 * 5,
    })
    mockOpen.mockResolvedValue(mockFh)
    mockStat.mockResolvedValue({ size: 1024 * 1024 * 5 })
    mockRm.mockResolvedValue(undefined)
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/temp/big.bin'])) as { shredded: number }
    expect(result.shredded).toBe(1) // First chunk wrote before cancel
  })

  it('handles stat failure during byte calculation', async () => {
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
    })
    mockStat.mockRejectedValue(new Error('ENOENT'))
    const mockFh = {
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mockOpen.mockResolvedValue(mockFh)
    mockRm.mockResolvedValue(undefined)

    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/temp/file.txt'])) as { shredded: number; bytesShredded: number }
    // stat failed during byte calc → size set to 0 → bytesShredded stays 0
    expect(result.shredded).toBe(1)
    expect(result.bytesShredded).toBe(0)
  })

  it('skips non-file non-directory entries during allowed path collection', async () => {
    // lstat returns a FIFO/named pipe (not symlink, not dir, not file)
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => false,
      isDirectory: () => false,
    })

    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/temp/fifo'])) as { shredded: number }
    expect(result.shredded).toBe(0)
  })

  it('breaks early when cancelled between multiple files', async () => {
    const mockFh = {
      write: vi.fn().mockImplementation(() => {
        getHandler('shredder:cancel')()
        return Promise.resolve(undefined)
      }),
      datasync: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
    })
    mockOpen.mockResolvedValue(mockFh)
    mockRm.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 100 })

    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/a.txt', '/home/user/b.txt'])) as {
      shredded: number
      cancelled: boolean
    }
    // First file shreds, second iteration hits `if (cancelled) break`
    expect(result.shredded).toBe(1)
    expect(result.cancelled).toBe(true)
  })

  it('getEntrySize top-level symlink returns 0', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/home/user/symlink-target'],
    })
    mockLstat.mockImplementation((p: string) => {
      if (p === '/home/user/symlink-target') {
        return Promise.resolve({ isSymbolicLink: () => true, isFile: () => false, isDirectory: () => false })
      }
      return Promise.resolve({ isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, size: 100 })
    })
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:select-folders')
    const result = (await handler()) as Array<{ path: string; size: number }>

    expect(result).toHaveLength(1)
    expect(result[0]!.size).toBe(0)
  })

  it('handles lstat error in getEntrySize catch block', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/home/user/bad-folder'],
    })
    mockLstat.mockRejectedValue(new Error('EACCES'))
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:select-folders')
    const result = (await handler()) as Array<{ size: number }>

    expect(result).toHaveLength(1)
    expect(result[0]!.size).toBe(0)
  })

  it('handles non-Error exception during shred', async () => {
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
    })
    mockOpen.mockRejectedValue('permission denied string')
    mockStat.mockResolvedValue({ size: 100 })

    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/file.txt'])) as {
      failed: number
      errors: Array<{ path: string; reason: string }>
    }
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('Unknown error')
  })

  it('handles cancelled with zero total bytes in progress', async () => {
    const mockFh = {
      write: vi.fn().mockImplementation(() => {
        getHandler('shredder:cancel')()
        return Promise.resolve(undefined)
      }),
      datasync: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }
    // lstat returns > 0 so shredFile processes it, but stat returns 0 so totalBytes = 0
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
    })
    mockOpen.mockResolvedValue(mockFh)
    mockRm.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 0 })

    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/file.txt'])) as { cancelled: boolean }
    expect(result.cancelled).toBe(true)
  })

  it('triggers in-loop progress updates for long files', async () => {
    const mockFh = {
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
    })
    mockOpen.mockResolvedValue(mockFh)
    mockRm.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 100 })

    let t = 0
    const spy = vi.spyOn(Date, 'now')
    spy.mockImplementation(() => {
      t += 500
      return t
    })

    try {
      registerFileShredderIpc(() => mockWindow() as any)
      const handler = getHandler('shredder:shred')
      await handler({}, ['/home/user/temp/file.txt'])
      // At least one in-loop progress + final progress = 2+ calls
      expect(mockSend.mock.calls.filter((c: unknown[]) => c[0] === 'shredder:progress').length).toBeGreaterThanOrEqual(
        2,
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('sends in-loop progress with zero totalBytes', async () => {
    // Multiple files where stat returns 0 for each → totalBytes = 0
    const mockFh = {
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
    })
    mockOpen.mockResolvedValue(mockFh)
    mockRm.mockResolvedValue(undefined)
    // stat returns 0 → totalBytes = 0
    mockStat.mockResolvedValue({ size: 0 })

    let t = 0
    const spy = vi.spyOn(Date, 'now')
    spy.mockImplementation(() => {
      t += 500
      return t
    })

    try {
      registerFileShredderIpc(() => mockWindow() as any)
      const handler = getHandler('shredder:shred')
      await handler({}, ['/home/user/temp/a.txt', '/home/user/temp/b.txt'])

      const progressCalls = mockSend.mock.calls.filter((c: unknown[]) => c[0] === 'shredder:progress')
      // At least one in-loop progress with progress: 0
      expect(progressCalls.length).toBeGreaterThanOrEqual(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('sends final progress after shredding', async () => {
    mockLstat.mockResolvedValue({ isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, size: 0 })
    mockStat.mockResolvedValue({ size: 0 })

    // shredFile skips zero-size files, rm still called
    const mockFh = {
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mockOpen.mockResolvedValue(mockFh)
    mockRm.mockResolvedValue(undefined)
    registerFileShredderIpc(() => mockWindow() as any)
    const handler = getHandler('shredder:shred')
    await handler({}, ['/home/user/temp/file.txt'])

    expect(mockSend).toHaveBeenCalledWith(
      'shredder:progress',
      expect.objectContaining({
        progress: 100,
      }),
    )
  })
})

describe('sendProgress window edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles null window silently', async () => {
    const mockFh = {
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
    })
    mockOpen.mockResolvedValue(mockFh)
    mockRm.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 100 })

    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/temp/file.txt'])) as { shredded: number }
    expect(result.shredded).toBe(1)
  })

  it('handles destroyed window silently', async () => {
    const mockFh = {
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
    })
    mockOpen.mockResolvedValue(mockFh)
    mockRm.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 100 })
    registerFileShredderIpc(() => ({ isDestroyed: () => true, webContents: { send: mockSend } }) as any)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/temp/file.txt'])) as { shredded: number }
    expect(result.shredded).toBe(1)
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('SHREDDER_OPEN_LOCATION handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls shell.showItemInFolder for valid absolute path', () => {
    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:open-location')
    handler({}, '/home/user/file.txt')
    expect(mockShowItemInFolder).toHaveBeenCalledWith('/home/user/file.txt')
  })

  it('ignores non-string input', () => {
    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:open-location')
    handler({}, 12345)
    expect(mockShowItemInFolder).not.toHaveBeenCalled()
  })

  it('ignores relative path input', () => {
    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:open-location')
    handler({}, 'relative/path.txt')
    expect(mockShowItemInFolder).not.toHaveBeenCalled()
  })
})

describe('isProtectedPath USERPROFILE fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
    })
    mockStat.mockResolvedValue({ size: 100 })
  })

  it('protects Desktop when HOME is not set but USERPROFILE is', async () => {
    const origHome = process.env.HOME
    const origUserProfile = process.env.USERPROFILE
    process.env.HOME = ''
    process.env.USERPROFILE = 'C:\\Users\\testuser'

    try {
      registerFileShredderIpc(() => null)
      const handler = getHandler('shredder:shred')
      const result = (await handler({}, ['C:\\Users\\testuser\\Desktop'])) as {
        errors: Array<{ reason: string }>
      }
      expect(result.errors.some((e) => e.reason.includes('Protected'))).toBe(true)
    } finally {
      process.env.HOME = origHome
      process.env.USERPROFILE = origUserProfile
    }
  })
})

// ── Protected path validation (mirrored logic) ──

describe('protected path safety', () => {
  // We test the safety logic indirectly through the shred handler
  beforeEach(() => {
    vi.clearAllMocks()
    // Make lstat return file for all so we can check protection
    mockLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
    })
    mockStat.mockResolvedValue({ size: 100 })
  })

  it('blocks .git directories', async () => {
    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/project/.git'])) as {
      errors: Array<{ path: string; reason: string }>
    }
    expect(result.errors.some((e: { path: string; reason: string }) => e.reason.includes('Protected'))).toBe(true)
  })

  it('blocks .ssh directories', async () => {
    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/.ssh'])) as { errors: Array<{ path: string; reason: string }> }
    expect(result.errors.some((e: { path: string; reason: string }) => e.reason.includes('Protected'))).toBe(true)
  })

  it('blocks filesystem roots (empty segments)', async () => {
    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/'])) as { errors: Array<{ reason: string }> }
    expect(result.errors.some((e) => e.reason.includes('Protected'))).toBe(true)
  })

  it('blocks root-level directories (win32 C: drive)', async () => {
    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['C:\\Windows'])) as { errors: Array<{ reason: string }> }
    expect(result.errors.some((e) => e.reason.includes('Protected'))).toBe(true)
  })

  it('blocks user profile root dirs (Desktop under home)', async () => {
    registerFileShredderIpc(() => null)
    const home = process.env.HOME || process.env.USERPROFILE || '/home/user'
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, [`${home}/Desktop`])) as { errors: Array<{ reason: string }> }
    expect(result.errors.some((e) => e.reason.includes('Protected'))).toBe(true)
  })

  it('blocks program files directory', async () => {
    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['C:\\Program Files'])) as { errors: Array<{ reason: string }> }
    expect(result.errors.some((e) => e.reason.includes('Protected'))).toBe(true)
  })

  it('blocks $Recycle.Bin directory', async () => {
    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['C:\\$Recycle.Bin'])) as { errors: Array<{ reason: string }> }
    expect(result.errors.some((e) => e.reason.includes('Protected'))).toBe(true)
  })

  it('blocks node_modules directories', async () => {
    registerFileShredderIpc(() => null)
    const handler = getHandler('shredder:shred')
    const result = (await handler({}, ['/home/user/project/node_modules'])) as {
      errors: Array<{ path: string; reason: string }>
    }
    expect(result.errors.some((e: { path: string; reason: string }) => e.reason.includes('Protected'))).toBe(true)
  })
})
