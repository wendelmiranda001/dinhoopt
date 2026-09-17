import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('fs/promises', () => {
  const statFn = vi.fn()
  return {
    rm: vi.fn(),
    stat: statFn,
    lstat: statFn,
    readdir: vi.fn(),
    open: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
  }
})

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
    renameSync: vi.fn(),
  }
})

vi.mock('crypto', () => ({
  randomBytes: (size: number, cb?: (err: Error | null, buf: Buffer) => void) => {
    const buf = Buffer.alloc(size, 0xab)
    if (cb) cb(null, buf)
    return buf
  },
}))

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}))

vi.mock('./logger.service', () => ({
  getLogger: () => mockLogger,
}))

let mockSettings: any

vi.mock('./settings-store', () => ({
  getSettings: vi.fn(),
}))

vi.mock('./scan-cache', () => ({
  getCachedItems: vi.fn(),
}))

import type { Stats } from 'node:fs'
import { existsSync, constants as fsConstants } from 'node:fs'
import { open, readdir, rename, rm, stat } from 'node:fs/promises'

import { CleanerType } from '../../shared/enums'
import {
  cleanItems,
  getDirectorySize,
  isExcluded,
  overwriteFile,
  resolveChildSubdirs,
  safeDelete,
  scanDirectoriesAsItems,
  scanDirectory,
  scanFile,
  scanMultipleDirectories,
  scanWithFileMask,
} from './file-utils'
import { getCachedItems } from './scan-cache'
import { getSettings } from './settings-store'

const mockedRm = vi.mocked(rm)
const mockedStat = vi.mocked(stat)
const mockedReaddir = vi.mocked(readdir)
const mockedOpen = vi.mocked(open)
const mockedExistsSync = vi.mocked(existsSync)
const mockedRename = vi.mocked(rename)
const mockedGetSettings = vi.mocked(getSettings)
const mockedGetCachedItems = vi.mocked(getCachedItems)

beforeEach(() => {
  vi.resetAllMocks()
  mockSettings = {
    cleaner: { secureDelete: false, skipRecentMinutes: 60 },
    exclusions: [],
  }
  mockedGetSettings.mockReturnValue(mockSettings)
  mockedGetCachedItems.mockReturnValue([])
})

function mockDirEntry(name: string, isDir: boolean) {
  return { name, isDirectory: () => isDir } as any
}
function mockFileStats(size: number, mtimeMs = Date.now()): any {
  return {
    size,
    mtimeMs,
    isFile: () => true,
    isDirectory: () => false,
  }
}
function mockDirStats(): any {
  return {
    isFile: () => false,
    isDirectory: () => true,
  }
}

// ─────────────────────────────────────────────
// isExcluded (existing)
// ─────────────────────────────────────────────
describe('isExcluded', () => {
  it('returns false for empty exclusions', () => {
    expect(isExcluded('C:\\temp\\file.txt', [])).toBe(false)
  })
  it('matches *.log extension pattern', () => {
    expect(isExcluded('C:\\logs\\app.log', ['*.log'])).toBe(true)
  })
  it('matches *.tmp extension pattern', () => {
    expect(isExcluded('C:\\temp\\cache.tmp', ['*.tmp'])).toBe(true)
  })
  it('does not match different extension', () => {
    expect(isExcluded('C:\\temp\\file.txt', ['*.log'])).toBe(false)
  })
  it('extension match is case-insensitive', () => {
    expect(isExcluded('C:\\temp\\file.LOG', ['*.log'])).toBe(true)
    expect(isExcluded('C:\\temp\\file.log', ['*.LOG'])).toBe(true)
  })
  it('matches exact path prefix', () => {
    expect(isExcluded('C:\\Users\\keep\\file.txt', ['C:\\Users\\keep'])).toBe(true)
  })
  it('matches exact path', () => {
    expect(isExcluded('C:\\Users\\keep', ['C:\\Users\\keep'])).toBe(true)
  })
  it('path prefix match is case-insensitive', () => {
    expect(isExcluded('C:\\USERS\\keep\\file.txt', ['c:\\users\\keep'])).toBe(true)
  })
  it('normalizes forward slashes to backslashes', () => {
    expect(isExcluded('C:/temp/file.log', ['*.log'])).toBe(true)
    expect(isExcluded('C:/Users/keep/file.txt', ['C:/Users/keep'])).toBe(true)
  })
  it('does not match unrelated path', () => {
    expect(isExcluded('D:\\other\\file.txt', ['C:\\Users\\keep'])).toBe(false)
  })
  it('matches any of multiple exclusions', () => {
    const exclusions = ['*.log', '*.tmp', 'C:\\protected']
    expect(isExcluded('C:\\temp\\debug.log', exclusions)).toBe(true)
    expect(isExcluded('C:\\temp\\cache.tmp', exclusions)).toBe(true)
    expect(isExcluded('C:\\protected\\data.db', exclusions)).toBe(true)
    expect(isExcluded('C:\\temp\\file.txt', exclusions)).toBe(false)
  })
  it('handles deeply nested paths', () => {
    expect(isExcluded('C:\\a\\b\\c\\d\\e\\f.log', ['*.log'])).toBe(true)
  })
  it('extension pattern requires dot', () => {
    expect(isExcluded('C:\\temp\\catalog', ['*.log'])).toBe(false)
  })
  it('does not over-match sibling prefixes', () => {
    expect(isExcluded('C:\\Windows10\\file.txt', ['C:\\Windows'])).toBe(false)
    expect(isExcluded('C:\\Windows\\System32\\file.txt', ['C:\\Windows'])).toBe(true)
  })
  it('matches exclusion with trailing separator', () => {
    expect(isExcluded('C:\\Windows\\System32\\file.txt', ['C:\\Windows\\'])).toBe(true)
  })
})

// ─────────────────────────────────────────────
// overwriteFile
// ─────────────────────────────────────────────
describe('overwriteFile', () => {
  function mockTmpFd() {
    return {
      writeFile: vi.fn().mockResolvedValue(undefined),
      sync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
  }

  it('writes to a unique tmp file, fsyncs, then renames atomically', async () => {
    const fd = mockTmpFd()
    mockedOpen.mockResolvedValue(fd as any)
    mockedRename.mockResolvedValue(undefined)

    await overwriteFile('C:\\data\\config.json', '{"key":"value"}')

    const tmpPath = mockedOpen.mock.calls[0]![0] as string
    expect(tmpPath).toMatch(/^C:\\data\\config\.json\.\d+\.\d+\.tmp$/)
    expect(mockedOpen).toHaveBeenCalledWith(tmpPath, 'w')
    expect(fd.writeFile).toHaveBeenCalledWith('{"key":"value"}')
    expect(fd.sync).toHaveBeenCalled()
    expect(mockedRename).toHaveBeenCalledWith(tmpPath, 'C:\\data\\config.json')
  })

  it('supports Buffer content', async () => {
    const fd = mockTmpFd()
    mockedOpen.mockResolvedValue(fd as any)
    mockedRename.mockResolvedValue(undefined)
    const buf = Buffer.from('binary data')

    await overwriteFile('C:\\data\\file.bin', buf)

    expect(fd.writeFile).toHaveBeenCalledWith(buf)
    expect(fd.close).toHaveBeenCalled()
  })

  it('generates a different tmp name per invocation (no collisions)', async () => {
    const fd = mockTmpFd()
    mockedOpen.mockResolvedValue(fd as any)
    mockedRename.mockResolvedValue(undefined)

    await overwriteFile('C:\\data\\config.json', 'a')
    await overwriteFile('C:\\data\\config.json', 'b')

    const first = mockedOpen.mock.calls[0]![0] as string
    const second = mockedOpen.mock.calls[1]![0] as string
    expect(first).not.toBe(second)
  })

  it('closes the handle and does not rename when writing fails', async () => {
    const fd = mockTmpFd()
    fd.writeFile.mockRejectedValueOnce(new Error('disk full'))
    mockedOpen.mockResolvedValue(fd as any)

    await expect(overwriteFile('C:\\data\\config.json', 'data')).rejects.toThrow('disk full')
    expect(fd.close).toHaveBeenCalled()
    expect(mockedRename).not.toHaveBeenCalled()
  })

  it('propagates rename errors', async () => {
    const fd = mockTmpFd()
    mockedOpen.mockResolvedValue(fd as any)
    mockedRename.mockRejectedValueOnce(new Error('access denied'))

    await expect(overwriteFile('C:\\data\\config.json', 'data')).rejects.toThrow('access denied')
  })
})

// ─────────────────────────────────────────────
// safeDelete
// ─────────────────────────────────────────────
describe('safeDelete', () => {
  it('deletes a file successfully (without the recursive flag)', async () => {
    mockedStat.mockResolvedValue(mockFileStats(1024))
    mockedRm.mockResolvedValue(undefined)
    const result = await safeDelete('C:\\temp\\file.tmp')
    expect(result).toEqual({ path: 'C:\\temp\\file.tmp', success: true })
    expect(mockedRm).toHaveBeenCalledWith('C:\\temp\\file.tmp', { force: true, recursive: false })
  })

  it('keeps recursive removal only when the target is a directory', async () => {
    mockedStat.mockResolvedValue(mockDirStats())
    mockedRm.mockResolvedValue(undefined)

    const result = await safeDelete('C:\\cache\\app')
    expect(result.success).toBe(true)
    expect(mockedRm).toHaveBeenCalledWith('C:\\cache\\app', { force: true, recursive: true })
  })

  it('still deletes when the path cannot be statted', async () => {
    mockedStat.mockRejectedValue(new Error('ENOENT'))
    mockedRm.mockResolvedValue(undefined)

    const result = await safeDelete('C:\\temp\\gone.tmp')
    expect(result.success).toBe(true)
    expect(mockedRm).toHaveBeenCalledWith('C:\\temp\\gone.tmp', { force: true, recursive: false })
  })

  it('calls secureOverwrite when secureDelete is enabled', async () => {
    mockSettings.cleaner.secureDelete = true
    mockedStat.mockResolvedValue(mockFileStats(1024))
    const mockFd = {
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ size: 1024 }),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mockedOpen.mockResolvedValue(mockFd as any)
    mockedRm.mockResolvedValue(undefined)

    const result = await safeDelete('C:\\temp\\file.tmp')
    expect(result.success).toBe(true)
    expect(mockedOpen).toHaveBeenCalledWith('C:\\temp\\file.tmp', fsConstants.O_RDWR | fsConstants.O_NOFOLLOW)
    expect(mockFd.write).toHaveBeenCalled()
    expect(mockFd.datasync).toHaveBeenCalled()
    expect(mockFd.close).toHaveBeenCalled()
  })

  it('still deletes if secureOverwrite fails, but logs a warning', async () => {
    mockSettings.cleaner.secureDelete = true
    mockedStat.mockRejectedValue(new Error('permission'))
    mockedRm.mockResolvedValue(undefined)

    const result = await safeDelete('C:\\temp\\file.tmp')
    expect(result.success).toBe(true)
    expect(mockLogger.warning).toHaveBeenCalledWith('file-utils', expect.stringContaining('Secure overwrite failed'))
  })

  it('re-stats the open file handle before overwriting (size after open)', async () => {
    mockSettings.cleaner.secureDelete = true
    mockedStat.mockResolvedValue(mockFileStats(100))
    const mockFd = {
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ size: 300 }),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mockedOpen.mockResolvedValue(mockFd as any)
    mockedRm.mockResolvedValue(undefined)

    await safeDelete('C:\\temp\\file.tmp')

    expect(mockFd.stat).toHaveBeenCalled()
    expect(mockFd.write).toHaveBeenCalledWith(expect.any(Buffer), 0, 300, 0)
  })

  it('returns in-use for EBUSY error', async () => {
    const err = new Error('file in use') as any
    err.code = 'EBUSY'
    mockedRm.mockRejectedValue(err)

    const result = await safeDelete('C:\\temp\\locked.tmp')
    expect(result).toEqual({ path: 'C:\\temp\\locked.tmp', success: false, reason: 'in-use' })
  })

  it('returns permission-denied for EACCES error', async () => {
    const err = new Error('access denied') as any
    err.code = 'EACCES'
    mockedRm.mockRejectedValue(err)

    const result = await safeDelete('C:\\temp\\protected.tmp')
    expect(result).toEqual({ path: 'C:\\temp\\protected.tmp', success: false, reason: 'permission-denied' })
  })

  it('returns success for ENOENT error (file already gone)', async () => {
    const err = new Error('not found') as any
    err.code = 'ENOENT'
    mockedRm.mockRejectedValue(err)

    const result = await safeDelete('C:\\temp\\gone.tmp')
    expect(result).toEqual({ path: 'C:\\temp\\gone.tmp', success: true })
  })

  it('returns error with message for unknown errors', async () => {
    mockedRm.mockRejectedValue(new Error('disk full'))

    const result = await safeDelete('C:\\temp\\other.tmp')
    expect(result).toEqual({ path: 'C:\\temp\\other.tmp', success: false, reason: 'disk full' })
  })
})

// ─────────────────────────────────────────────
// cleanItems
// ─────────────────────────────────────────────
describe('cleanItems', () => {
  it('validates and cleans cached items', async () => {
    mockedGetCachedItems.mockReturnValue([
      {
        id: '1',
        path: 'C:\\a.tmp',
        size: 100,
        category: 'system',
        subcategory: 'logs',
        lastModified: 0,
        selected: true,
      },
      {
        id: '2',
        path: 'C:\\b.tmp',
        size: 200,
        category: 'system',
        subcategory: 'logs',
        lastModified: 0,
        selected: true,
      },
    ])
    mockedRm.mockResolvedValue(undefined)

    const result = await cleanItems(['1', '2'])
    expect(result.filesDeleted).toBe(2)
    expect(result.filesSkipped).toBe(0)
    expect(result.totalCleaned).toBe(300)
    expect(result.needsElevation).toBe(false)
  })

  it('filters out non-string IDs', async () => {
    mockedGetCachedItems.mockReturnValue([])
    await cleanItems([1, 'valid'] as any)
    expect(mockedGetCachedItems).toHaveBeenCalledWith(['valid'])
  })

  it('logs an info when non-string IDs are discarded', async () => {
    mockedGetCachedItems.mockReturnValue([])
    await cleanItems([1, 2, 'valid'] as any)
    expect(mockLogger.info).toHaveBeenCalledWith('file-utils', expect.stringContaining('2'))
  })

  it('handles non-array input', async () => {
    const result = await cleanItems(null)
    expect(result.filesDeleted).toBe(0)
    expect(mockedGetCachedItems).toHaveBeenCalledWith([])
  })

  it('reports skipped files and errors', async () => {
    mockedGetCachedItems.mockReturnValue([
      {
        id: '1',
        path: 'C:\\a.tmp',
        size: 100,
        category: 'system',
        subcategory: 'logs',
        lastModified: 0,
        selected: true,
      },
      {
        id: '2',
        path: 'C:\\b.tmp',
        size: 200,
        category: 'system',
        subcategory: 'logs',
        lastModified: 0,
        selected: true,
      },
    ])
    mockedRm.mockRejectedValueOnce(Object.assign(new Error('permission'), { code: 'EACCES' }))
    mockedRm.mockResolvedValueOnce(undefined)

    const result = await cleanItems(['1', '2'])
    expect(result.filesDeleted).toBe(1)
    expect(result.filesSkipped).toBe(1)
    expect(result.totalCleaned).toBe(200)
    expect(result.needsElevation).toBe(true)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.reason).toBe('permission-denied')
  })

  it('calls onProgress callback', async () => {
    mockedGetCachedItems.mockReturnValue([
      {
        id: '1',
        path: 'C:\\a.tmp',
        size: 100,
        category: 'system',
        subcategory: 'logs',
        lastModified: 0,
        selected: true,
      },
    ])
    mockedRm.mockResolvedValue(undefined)
    const onProgress = vi.fn()

    await cleanItems(['1'], onProgress)
    expect(onProgress).toHaveBeenCalledWith(1, 1, 'C:\\a.tmp', 100)
  })
})

// ─────────────────────────────────────────────
// getDirectorySize
// ─────────────────────────────────────────────
describe('getDirectorySize', () => {
  it('returns 0 for maxDepth <= 0', async () => {
    expect(await getDirectorySize('C:\\dir', 0)).toBe(0)
  })

  it('sums file sizes in directory', async () => {
    mockedReaddir.mockResolvedValue([mockDirEntry('a.txt', false), mockDirEntry('b.txt', false)])
    mockedStat.mockResolvedValueOnce(mockFileStats(100))
    mockedStat.mockResolvedValueOnce(mockFileStats(200))

    expect(await getDirectorySize('C:\\dir', 2)).toBe(300)
  })

  it('recurses into subdirectories', async () => {
    mockedReaddir
      .mockResolvedValueOnce([mockDirEntry('sub', true)])
      .mockResolvedValueOnce([mockDirEntry('c.txt', false)])
    mockedStat.mockResolvedValueOnce(mockDirStats()).mockResolvedValueOnce(mockFileStats(500))

    expect(await getDirectorySize('C:\\dir', 3)).toBe(500)
  })

  it('skips inaccessible entries', async () => {
    mockedReaddir.mockResolvedValue([mockDirEntry('secret.txt', false)])
    mockedStat.mockRejectedValue(new Error('access denied'))

    expect(await getDirectorySize('C:\\dir', 2)).toBe(0)
  })

  it('returns 0 when readdir fails', async () => {
    mockedReaddir.mockRejectedValue(new Error('not found'))
    expect(await getDirectorySize('C:\\gone', 2)).toBe(0)
  })
})

// ─────────────────────────────────────────────
// scanDirectory
// ─────────────────────────────────────────────
describe('scanDirectory', () => {
  const OLD = Date.now() - 7_200_000

  it('scans files and returns ScanResult', async () => {
    mockedReaddir.mockResolvedValue([mockDirEntry('old.log', false), mockDirEntry('recent.log', false)])
    mockedStat.mockResolvedValueOnce(mockFileStats(500, OLD)).mockResolvedValueOnce(mockFileStats(1000, Date.now()))

    const result = await scanDirectory('C:\\logs', CleanerType.System, 'logs')
    expect(result.category).toBe('system')
    expect(result.subcategory).toBe('logs')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.path).toBe('C:\\logs\\old.log')
    expect(result.items[0]!.size).toBe(500)
  })

  it('skips excluded files', async () => {
    mockSettings.exclusions = ['*.log']
    mockedReaddir.mockResolvedValue([mockDirEntry('app.log', false), mockDirEntry('data.db', false)])
    mockedStat.mockResolvedValueOnce(mockFileStats(100, OLD)).mockResolvedValueOnce(mockFileStats(200, OLD))

    const result = await scanDirectory('C:\\data', CleanerType.System, 'data')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.path).toBe('C:\\data\\data.db')
  })

  it('skips inaccessible files', async () => {
    mockedReaddir.mockResolvedValue([mockDirEntry('secret.tmp', false)])
    mockedStat.mockRejectedValue(new Error('access denied'))

    const result = await scanDirectory('C:\\temp', CleanerType.System, 'temp')
    expect(result.items).toHaveLength(0)
  })

  it('returns empty result when readdir fails', async () => {
    mockedReaddir.mockRejectedValue(new Error('no such dir'))

    const result = await scanDirectory('C:\\gone', CleanerType.System, 'temp')
    expect(result.items).toHaveLength(0)
    expect(result.totalSize).toBe(0)
  })

  it('logs a warning when the root directory cannot be read', async () => {
    mockedReaddir.mockRejectedValue(new Error('no such dir'))

    await scanDirectory('C:\\gone', CleanerType.System, 'temp')
    expect(mockLogger.warning).toHaveBeenCalledWith('file-utils', expect.stringContaining('C:\\gone'))
  })

  it('respects skipRecentMinutes cutoff', async () => {
    mockedReaddir.mockResolvedValue([mockDirEntry('recent.txt', false)])
    mockedStat.mockResolvedValue(mockFileStats(50, Date.now()))

    const result = await scanDirectory('C:\\temp', CleanerType.System, 'temp', 60)
    expect(result.items).toHaveLength(0)
  })

  it('enforces MAX_ITEMS limit', async () => {
    const entries = Array.from({ length: 6000 }, (_, i) => mockDirEntry(`f${i}.txt`, false))
    mockedReaddir.mockResolvedValue(entries)
    mockedStat.mockResolvedValue(mockFileStats(10, OLD))

    const result = await scanDirectory('C:\\bulk', CleanerType.System, 'bulk')
    expect(result.items).toHaveLength(5000)
  })

  it('logs a warning when the MAX_ITEMS cap truncates the scan', async () => {
    const entries = Array.from({ length: 6000 }, (_, i) => mockDirEntry(`f${i}.txt`, false))
    mockedReaddir.mockResolvedValue(entries)
    mockedStat.mockResolvedValue(mockFileStats(10, OLD))

    await scanDirectory('C:\\bulk', CleanerType.System, 'bulk')
    expect(mockLogger.warning).toHaveBeenCalledWith('file-utils', expect.stringContaining('5000'))
  })

  it('logs a debug count when individual entries fail to scan', async () => {
    mockedReaddir.mockResolvedValue([mockDirEntry('secret.tmp', false)])
    mockedStat.mockRejectedValue(new Error('access denied'))

    await scanDirectory('C:\\temp', CleanerType.System, 'temp')
    expect(mockLogger.info).toHaveBeenCalledWith('file-utils', expect.stringContaining('1'))
  })

  it('sizes symlinks via lstat (does not follow into the target)', async () => {
    const symEntry = {
      name: 'link.log',
      isDirectory: () => false,
      isFile: () => false,
      isSymbolicLink: () => true,
    }
    mockedReaddir.mockResolvedValue([symEntry as any])
    mockedStat.mockResolvedValue({
      size: 64,
      mtimeMs: OLD,
      isFile: () => false,
      isDirectory: () => false,
    } as Stats)

    const result = await scanDirectory('C:\\logs', CleanerType.System, 'logs')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.size).toBe(64)
  })
})

// ─────────────────────────────────────────────
// scanMultipleDirectories
// ─────────────────────────────────────────────
describe('scanMultipleDirectories', () => {
  const OLD = Date.now() - 7_200_000

  it('merges results from multiple directories', async () => {
    mockedReaddir
      .mockResolvedValueOnce([mockDirEntry('a.log', false)])
      .mockResolvedValueOnce([mockDirEntry('b.log', false)])
    mockedStat.mockResolvedValueOnce(mockFileStats(100, OLD)).mockResolvedValueOnce(mockFileStats(200, OLD))

    const result = await scanMultipleDirectories(['C:\\dir1', 'C:\\dir2'], CleanerType.System, 'logs')
    expect(result.items).toHaveLength(2)
    expect(result.totalSize).toBe(300)
  })
})

// ─────────────────────────────────────────────
// scanFile
// ─────────────────────────────────────────────
describe('scanFile', () => {
  it('returns a single-item ScanResult for a file', async () => {
    mockedStat.mockResolvedValue(mockFileStats(500))
    const result = await scanFile('C:\\file.txt', CleanerType.System, 'files')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.size).toBe(500)
    expect(result.totalSize).toBe(500)
  })

  it('returns empty when file is excluded', async () => {
    mockSettings.exclusions = ['*.txt']
    const result = await scanFile('C:\\file.txt', CleanerType.System, 'files')
    expect(result.items).toHaveLength(0)
  })

  it('returns empty when path is not a file', async () => {
    mockedStat.mockResolvedValue(mockDirStats())
    const result = await scanFile('C:\\dir', CleanerType.System, 'files')
    expect(result.items).toHaveLength(0)
  })

  it('returns empty when stat fails', async () => {
    mockedStat.mockRejectedValue(new Error('not found'))
    const result = await scanFile('C:\\gone.txt', CleanerType.System, 'files')
    expect(result.items).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────
// scanDirectoriesAsItems
// ─────────────────────────────────────────────
describe('scanDirectoriesAsItems', () => {
  it('scans directories as single items', async () => {
    mockedStat.mockResolvedValueOnce(mockDirStats()).mockResolvedValueOnce(mockFileStats(2048))
    mockedReaddir.mockResolvedValue([mockDirEntry('f.dat', false)])
    const result = await scanDirectoriesAsItems(['C:\\app'], CleanerType.System, 'cache')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.size).toBeGreaterThan(1024)
  })

  it('skips excluded directories', async () => {
    mockSettings.exclusions = ['C:\\app']
    const result = await scanDirectoriesAsItems(['C:\\app'], CleanerType.System, 'cache')
    expect(result.items).toHaveLength(0)
  })

  it('skips non-directories', async () => {
    mockedStat.mockResolvedValue(mockFileStats(100))
    const result = await scanDirectoriesAsItems(['C:\\file.txt'], CleanerType.System, 'cache')
    expect(result.items).toHaveLength(0)
  })

  it('skips directories smaller than 1024 bytes', async () => {
    mockedStat.mockResolvedValue(mockDirStats())
    mockedReaddir.mockResolvedValue([])
    const result = await scanDirectoriesAsItems(['C:\\empty'], CleanerType.System, 'cache')
    expect(result.items).toHaveLength(0)
  })

  it('skips inaccessible directories', async () => {
    mockedStat.mockRejectedValue(new Error('access denied'))
    const result = await scanDirectoriesAsItems(['C:\\secret'], CleanerType.System, 'cache')
    expect(result.items).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────
// resolveChildSubdirs
// ─────────────────────────────────────────────
describe('resolveChildSubdirs', () => {
  it('returns original paths when no childSubdir', async () => {
    const result = await resolveChildSubdirs(['C:\\a', 'C:\\b'])
    expect(result).toEqual(['C:\\a', 'C:\\b'])
  })

  it('expands child subdirectories', async () => {
    mockedExistsSync.mockReturnValue(true)
    mockedReaddir.mockResolvedValue([
      mockDirEntry('app1', true),
      mockDirEntry('app2', true),
      mockDirEntry('file.txt', false),
    ])
    const result = await resolveChildSubdirs(['C:\\apps'], 'cache')
    expect(result).toEqual(['C:\\apps\\app1\\cache', 'C:\\apps\\app2\\cache'])
  })

  it('skips base path that does not exist', async () => {
    mockedExistsSync.mockReturnValue(false)
    const result = await resolveChildSubdirs(['C:\\gone'], 'cache')
    expect(result).toEqual([])
  })

  it('skips children without the target subdir', async () => {
    mockedExistsSync.mockReturnValue(true)
    mockedReaddir.mockResolvedValue([mockDirEntry('app1', true)])
    mockedExistsSync.mockReturnValueOnce(true)
    mockedExistsSync.mockReturnValueOnce(false)

    const result = await resolveChildSubdirs(['C:\\apps'], 'cache')
    expect(result).toEqual([])
  })
})

// ─────────────────────────────────────────────
// secureOverwrite (tested indirectly via safeDelete)
// ─────────────────────────────────────────────
describe('secureOverwrite (via safeDelete)', () => {
  it('recursively overwrites directory contents', async () => {
    mockSettings.cleaner.secureDelete = true
    mockedReaddir.mockResolvedValue([mockDirEntry('child.dat', false)])
    mockedStat
      .mockResolvedValueOnce(mockDirStats()) // lstat(dir) → isDirectory
      .mockResolvedValueOnce(mockFileStats(50)) // lstat(dir/child.dat)
    const fileFd = {
      write: vi.fn().mockResolvedValue(undefined),
      datasync: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ size: 50 }),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mockedOpen.mockResolvedValue(fileFd as any)
    mockedRm.mockResolvedValue(undefined)

    const result = await safeDelete('C:\\dir')
    expect(result.success).toBe(true)
    expect(mockedOpen).toHaveBeenCalledWith('C:\\dir\\child.dat', fsConstants.O_RDWR | fsConstants.O_NOFOLLOW)
    expect(fileFd.write).toHaveBeenCalled()
    expect(fileFd.close).toHaveBeenCalled()
  })

  it('does not overwrite zero-size files', async () => {
    mockSettings.cleaner.secureDelete = true
    mockedStat.mockResolvedValue(mockFileStats(0))
    mockedRm.mockResolvedValue(undefined)

    const result = await safeDelete('C:\\empty.tmp')
    expect(result.success).toBe(true)
    expect(mockedOpen).not.toHaveBeenCalled()
  })

  it('skips symlinks without opening them', async () => {
    mockSettings.cleaner.secureDelete = true
    mockedStat.mockResolvedValue({
      isFile: () => false,
      isDirectory: () => false,
      isSymbolicLink: () => true,
      size: 10,
      mtimeMs: 0,
    } as any)
    mockedRm.mockResolvedValue(undefined)

    const result = await safeDelete('C:\\temp\\link.tmp')
    expect(result.success).toBe(true)
    expect(mockedOpen).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────
// scanWithFileMask
// ─────────────────────────────────────────────
describe('scanWithFileMask', () => {
  const OLD = Date.now() - 3600 * 1000 // 1 hour ago (past cutoff)
  const RECENT = Date.now() // too recent
  function fileEntry(name: string): any {
    return { name, isDirectory: () => false, isFile: () => true }
  }
  function dirEntry(name: string): any {
    return { name, isDirectory: () => true, isFile: () => false }
  }

  beforeEach(() => {
    mockedStat.mockReset()
    mockedReaddir.mockReset()
  })

  it('returns empty result for non-existent directory', async () => {
    mockedReaddir.mockRejectedValue(new Error('ENOENT'))
    const result = await scanWithFileMask('C:\\missing', '*.*', false, CleanerType.System, 'Test')
    expect(result.items).toEqual([])
    expect(result.itemCount).toBe(0)
  })

  it('finds files matching wildcard mask *.*', async () => {
    mockedReaddir.mockResolvedValue([fileEntry('file1.log'), fileEntry('file2.tmp')])
    mockedStat.mockResolvedValue(mockFileStats(100, OLD))

    const result = await scanWithFileMask('C:\\temp', '*.*', false, CleanerType.System, 'Test')

    expect(result.itemCount).toBe(2)
    expect(result.subcategory).toBe('Test')
  })

  it('filters files by *.log mask', async () => {
    mockedReaddir.mockResolvedValue([fileEntry('output.log'), fileEntry('data.tmp'), fileEntry('error.LOG')])
    mockedStat.mockResolvedValue(mockFileStats(50, OLD))

    const result = await scanWithFileMask('C:\\temp', '*.log', false, CleanerType.System, 'Logs Only')

    expect(result.itemCount).toBe(2) // output.log and error.LOG (case-insensitive)
  })

  it('filters files by thumb*.db mask', async () => {
    mockedReaddir.mockResolvedValue([fileEntry('thumb.db'), fileEntry('thumbnail.dat'), fileEntry('other.txt')])
    mockedStat.mockResolvedValue(mockFileStats(30, OLD))

    const result = await scanWithFileMask('C:\\temp', 'thumb*.db', false, CleanerType.System, 'Thumbs')

    expect(result.itemCount).toBe(1)
    expect(result.items[0]!.path).toContain('thumb.db')
  })

  it('skips recent files based on skipRecentMinutes', async () => {
    mockedReaddir.mockResolvedValue([fileEntry('old.log'), fileEntry('recent.log')])
    mockedStat
      .mockResolvedValueOnce(mockFileStats(100, OLD)) // old.log passes
      .mockResolvedValueOnce(mockFileStats(100, RECENT)) // recent.log filtered out

    const result = await scanWithFileMask('C:\\temp', '*.log', false, CleanerType.System, 'Test')
    expect(result.itemCount).toBe(1)
  })

  it('scans recursively when recurse=true', async () => {
    mockedReaddir
      .mockResolvedValueOnce([dirEntry('sub')]) // top level: 'sub' dir
      .mockResolvedValueOnce([fileEntry('deep.log')]) // sub/deep.log
    mockedStat.mockResolvedValueOnce(mockFileStats(200, OLD)) // deep.log

    const result = await scanWithFileMask('C:\\temp', '*.log', true, CleanerType.System, 'Recursive')

    expect(result.itemCount).toBe(1)
    expect(result.items[0]!.path).toContain('deep.log')
    expect(mockedReaddir).toHaveBeenCalledTimes(2)
  })

  it('does NOT recurse when recurse=false', async () => {
    mockedReaddir.mockResolvedValueOnce([dirEntry('sub')])

    const result = await scanWithFileMask('C:\\temp', '*.log', false, CleanerType.System, 'NoRecurse')

    expect(result.itemCount).toBe(0)
    // Should not have read the sub directory
    expect(mockedReaddir).toHaveBeenCalledTimes(1)
  })

  it('respects file exclusions', async () => {
    mockSettings.exclusions = ['*.skipme']
    mockedReaddir.mockResolvedValue([fileEntry('good.log'), fileEntry('bad.skipme')])
    mockedStat.mockResolvedValue(mockFileStats(50, OLD))

    const result = await scanWithFileMask('C:\\temp', '*.*', false, CleanerType.System, 'Excluded')

    expect(result.itemCount).toBe(1)
    expect(result.items[0]!.path).toContain('good.log')
  })

  it('matches ? wildcard (single char)', async () => {
    mockedReaddir.mockResolvedValue([fileEntry('file1.txt'), fileEntry('file2.txt'), fileEntry('file10.txt')])
    mockedStat.mockResolvedValue(mockFileStats(10, OLD))

    const result = await scanWithFileMask('C:\\temp', 'file?.txt', false, CleanerType.System, 'SingleChar')

    expect(result.itemCount).toBe(2) // file1.txt, file2.txt — NOT file10.txt (too long)
  })

  it('matches *.* including files without an extension', async () => {
    mockedReaddir.mockResolvedValue([fileEntry('README'), fileEntry('data.txt')])
    mockedStat.mockResolvedValue(mockFileStats(10, OLD))

    const result = await scanWithFileMask('C:\\temp', '*.*', false, CleanerType.System, 'All')

    expect(result.itemCount).toBe(2)
  })

  it('adds the directory itself when removeSelf=true', async () => {
    mockedReaddir.mockResolvedValueOnce([fileEntry('a.log')]).mockResolvedValueOnce([])
    mockedStat
      .mockResolvedValueOnce(mockFileStats(100, OLD)) // a.log file
      .mockResolvedValueOnce(mockDirStats()) // lstat(dirPath) → isDirectory

    const result = await scanWithFileMask('C:\\temp', '*.log', false, CleanerType.System, 'Self', true)

    expect(result.itemCount).toBe(2)
    expect(result.items[1]!.path).toBe('C:\\temp')
    expect(result.items[1]!.selected).toBe(true)
  })

  it('does not add the directory itself when removeSelf=false', async () => {
    mockedReaddir.mockResolvedValue([fileEntry('a.log')])
    mockedStat.mockResolvedValue(mockFileStats(100, OLD))

    const result = await scanWithFileMask('C:\\temp', '*.log', false, CleanerType.System, 'NoSelf')

    expect(result.itemCount).toBe(1)
    expect(result.items[0]!.path).not.toBe('C:\\temp')
  })
})
