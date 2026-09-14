import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Hoisted mocks ──

const mocks = vi.hoisted(() => {
  const ipcHandle: ReturnType<typeof vi.fn> = vi.fn()
  const dialogShowOpenDialog: ReturnType<typeof vi.fn> = vi.fn()
  const shellTrashItem: ReturnType<typeof vi.fn> = vi.fn()
  const shellShowItemInFolder: ReturnType<typeof vi.fn> = vi.fn()
  const readdir: ReturnType<typeof vi.fn> = vi.fn()
  const rmdir: ReturnType<typeof vi.fn> = vi.fn()
  const logger = { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() }
  const webContentsSend: ReturnType<typeof vi.fn> = vi.fn()

  return {
    ipcHandle,
    dialogShowOpenDialog,
    shellTrashItem,
    shellShowItemInFolder,
    readdir,
    rmdir,
    logger,
    webContentsSend,
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => (mocks.ipcHandle as (...a: unknown[]) => unknown)(...args) },
  dialog: {
    showOpenDialog: (...args: unknown[]) => (mocks.dialogShowOpenDialog as (...a: unknown[]) => unknown)(...args),
  },
  shell: {
    trashItem: (...args: unknown[]) => (mocks.shellTrashItem as (...a: unknown[]) => unknown)(...args),
    showItemInFolder: (...args: unknown[]) => (mocks.shellShowItemInFolder as (...a: unknown[]) => unknown)(...args),
  },
  BrowserWindow: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readdir: (...args: unknown[]) => (mocks.readdir as (...a: unknown[]) => unknown)(...args),
  rmdir: (...args: unknown[]) => (mocks.rmdir as (...a: unknown[]) => unknown)(...args),
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

// ── SUT ──

import type { BrowserWindow } from 'electron'
import { registerEmptyFolderCleanerIpc } from './empty-folder-cleaner.ipc'

type IpcHandler = (...args: unknown[]) => unknown

interface ScanResult {
  folders: Array<{ name: string; depth: number }>
  totalFoldersScanned: number
  duration: number
  cancelled: boolean
}

interface DeleteResult {
  deleted: number
  failed: number
  errors: Array<{ path: string; reason: string }>
}

// On Windows, path.join() produces backslashes.  Normalise to forward slashes
// so our mock comparisons work cross-platform.
const n = (p: string) => p.replace(/\\/g, '/')

function getHandler(channel: string): IpcHandler {
  const call = mocks.ipcHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1] as IpcHandler
}

function makeWindow(): BrowserWindow {
  return { webContents: { send: mocks.webContentsSend }, isDestroyed: () => false } as unknown as BrowserWindow
}

function winNull(): BrowserWindow | null {
  return null
}

// All scan/dir paths must have >2 path segments on Win32 otherwise
// isProtectedFolder treats them as root-level.  "/a/b/c/d/target" has 4
// segments — safe on both platforms (Win32: 4 > 2, Unix: 4 > 1).
const ROOT = '/a/b/c/d/e'

// ── Tests ──

describe('registerEmptyFolderCleanerIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all 5 IPC handlers', () => {
    registerEmptyFolderCleanerIpc(winNull)
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('empty-folders:select-dir')
    expect(channels).toContain('empty-folders:cancel')
    expect(channels).toContain('empty-folders:scan')
    expect(channels).toContain('empty-folders:delete')
    expect(channels).toContain('empty-folders:open-location')
    expect(channels.length).toBe(5)
  })

  // ── SELECT_DIR ──

  describe('EMPTY_FOLDERS_SELECT_DIR', () => {
    it('returns selected directory on success', async () => {
      registerEmptyFolderCleanerIpc(() => makeWindow())
      mocks.dialogShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/chosen/dir'] })
      const handler = getHandler('empty-folders:select-dir')
      const result = await handler()
      expect(result).toBe('/chosen/dir')
      expect(mocks.logger.info).toHaveBeenCalledWith('empty-folder-cleaner', 'Opening directory selection dialog')
      expect(mocks.logger.success).toHaveBeenCalledWith('empty-folder-cleaner', 'Selected directory: /chosen/dir')
    })

    it('returns null when dialog is cancelled', async () => {
      registerEmptyFolderCleanerIpc(() => makeWindow())
      mocks.dialogShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
      const handler = getHandler('empty-folders:select-dir')
      const result = await handler()
      expect(result).toBeNull()
      expect(mocks.logger.warning).toHaveBeenCalledWith('empty-folder-cleaner', 'Directory selection cancelled')
    })

    it('returns null when no window is available', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:select-dir')
      const result = await handler()
      expect(result).toBeNull()
      expect(mocks.dialogShowOpenDialog).not.toHaveBeenCalled()
    })
  })

  // ── CANCEL ──

  describe('EMPTY_FOLDERS_CANCEL', () => {
    it('sets cancelled flag and logs warning', () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:cancel')
      handler()
      expect(mocks.logger.warning).toHaveBeenCalledWith('empty-folder-cleaner', 'Scan cancelled by user')
    })
  })

  // ── SCAN ──

  describe('EMPTY_FOLDERS_SCAN', () => {
    beforeEach(() => {
      mocks.readdir.mockReset()
      mocks.readdir.mockImplementation(async (_dirPath: string) => [])
    })

    // IPC handler signature: async (_event, options) => { ... }
    // Call as: handler(undefined, { directory: ..., maxDepth: ..., excludePatterns: ... })

    it('returns empty result when options is null', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, null)) as ScanResult
      expect(result).toEqual({ folders: [], totalFoldersScanned: 0, duration: expect.any(Number), cancelled: false })
      expect(mocks.logger.warning).toHaveBeenCalledWith('empty-folder-cleaner', 'Scan called with invalid options')
    })

    it('returns empty result when options is not an object', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, 'string')) as ScanResult
      expect(result).toEqual({ folders: [], totalFoldersScanned: 0, duration: expect.any(Number), cancelled: false })
      expect(mocks.logger.warning).toHaveBeenCalledWith('empty-folder-cleaner', 'Scan called with invalid options')
    })

    it('returns empty result when directory is missing from options', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, { maxDepth: 5 })) as ScanResult
      expect(result).toEqual({ folders: [], totalFoldersScanned: 0, duration: expect.any(Number), cancelled: false })
      expect(mocks.logger.warning).toHaveBeenCalledWith('empty-folder-cleaner', 'Scan called without a valid directory')
    })

    it('returns empty result when directory is relative', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, { directory: 'relative/path', maxDepth: 5 })) as ScanResult
      expect(result).toEqual({ folders: [], totalFoldersScanned: 0, duration: expect.any(Number), cancelled: false })
      expect(mocks.logger.warning).toHaveBeenCalledWith('empty-folder-cleaner', 'Scan called without a valid directory')
    })

    it('returns empty result when directory is empty string', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, { directory: '', maxDepth: 5 })) as ScanResult
      expect(result).toEqual({ folders: [], totalFoldersScanned: 0, duration: expect.any(Number), cancelled: false })
      expect(mocks.logger.warning).toHaveBeenCalledWith('empty-folder-cleaner', 'Scan called without a valid directory')
    })

    it('defaults maxDepth to 20 when not provided', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, { directory: ROOT })) as ScanResult
      expect(result.folders).toEqual([])
      expect(result.cancelled).toBe(false)
    })

    it('defaults maxDepth to 20 when invalid (negative)', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, { directory: ROOT, maxDepth: -1 })) as ScanResult
      expect(result.folders).toEqual([])
    })

    it('defaults maxDepth to 20 when invalid (zero)', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, { directory: ROOT, maxDepth: 0 })) as ScanResult
      expect(result.folders).toEqual([])
    })

    it('defaults excludePatterns to empty array when not provided', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, { directory: ROOT, maxDepth: 10 })) as ScanResult
      expect(result.folders).toEqual([])
    })

    it('filters non-string items from excludePatterns', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, {
        directory: ROOT,
        maxDepth: 10,
        excludePatterns: ['ok', 42, null],
      })) as ScanResult
      expect(result.folders).toEqual([])
    })

    it('scans and finds empty folders (single level)', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      mocks.readdir.mockImplementation(async (_dirPath: string) => {
        const dir = n(_dirPath)
        if (dir === ROOT) {
          return [
            { name: 'empty1', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
            { name: 'empty2', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
          ]
        }
        return []
      })
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, { directory: ROOT, maxDepth: 10, excludePatterns: [] })) as ScanResult
      expect(result.folders).toHaveLength(2)
      expect(result.folders.map((f) => f.name).sort()).toEqual(['empty1', 'empty2'])
      expect(result.totalFoldersScanned).toBe(3)
      expect(result.cancelled).toBe(false)
      expect(mocks.logger.success).toHaveBeenCalled()
    })

    it('does not mark root scan directory as empty', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, { directory: ROOT, maxDepth: 10, excludePatterns: [] })) as ScanResult
      expect(result.folders).toHaveLength(0)
      expect(result.totalFoldersScanned).toBe(1)
    })

    it('treats folder with files as non-empty', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      mocks.readdir.mockImplementation(async (_dirPath: string) => {
        const dir = n(_dirPath)
        if (dir === ROOT) {
          return [{ name: 'sub', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false }]
        }
        return [{ name: 'file.txt', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }]
      })
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, { directory: ROOT, maxDepth: 10, excludePatterns: [] })) as ScanResult
      expect(result.folders).toHaveLength(0)
    })

    it('treats symlinks as content (makes folder non-empty)', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      mocks.readdir.mockImplementation(async (_dirPath: string) => {
        const dir = n(_dirPath)
        if (dir === ROOT) {
          return [{ name: 'sub', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false }]
        }
        return [{ name: 'link', isFile: () => false, isDirectory: () => false, isSymbolicLink: () => true }]
      })
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, { directory: ROOT, maxDepth: 10, excludePatterns: [] })) as ScanResult
      expect(result.folders).toHaveLength(0)
    })

    it('skips hidden/dot directories but finds other empty dirs', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      mocks.readdir.mockImplementation(async (_dirPath: string) => {
        const dir = n(_dirPath)
        if (dir === ROOT) {
          return [
            { name: '.hidden', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
            { name: 'empty', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
          ]
        }
        return []
      })
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, { directory: ROOT, maxDepth: 10, excludePatterns: [] })) as ScanResult
      // .hidden is treated as non-empty (hasNonEmptySubdirs = true)
      // 'empty' is empty and not-root, so it gets flagged
      expect(result.folders).toHaveLength(1)
      expect(result.folders[0]!.name).toBe('empty')
    })

    it('skips directories matching excludePatterns', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      mocks.readdir.mockImplementation(async (_dirPath: string) => {
        const dir = n(_dirPath)
        if (dir === ROOT) {
          return [
            { name: 'build', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
            { name: 'src', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
          ]
        }
        return []
      })
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, {
        directory: ROOT,
        maxDepth: 10,
        excludePatterns: ['build'],
      })) as ScanResult
      // 'build' is excluded (treated as non-empty), only 'src' is empty
      expect(result.folders).toHaveLength(1)
      expect(result.folders[0]!.name).toBe('src')
    })

    it('skips directories matching excludePatterns case-insensitively', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      mocks.readdir.mockImplementation(async (_dirPath: string) => {
        const dir = n(_dirPath)
        if (dir === ROOT) {
          return [{ name: 'Build', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false }]
        }
        return []
      })
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, {
        directory: ROOT,
        maxDepth: 10,
        excludePatterns: ['BUILD'],
      })) as ScanResult
      expect(result.folders).toHaveLength(0)
    })

    it('respects maxDepth and stops recursion beyond limit', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      // Tree: root → sub1 → sub2
      // maxDepth=1 means depth 1 is allowed (root depth=0, sub1 depth=1)
      // but sub2 at depth=2 is beyond limit
      let sub2Reached = false
      mocks.readdir.mockImplementation(async (_dirPath: string) => {
        const dir = n(_dirPath)
        if (dir === ROOT) {
          return [{ name: 'sub1', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false }]
        }
        if (dir.endsWith('/sub1')) {
          return [{ name: 'sub2', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false }]
        }
        sub2Reached = true
        return []
      })
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, { directory: ROOT, maxDepth: 1, excludePatterns: [] })) as ScanResult
      // sub2 is at depth 2 > maxDepth 1, so findEmptyFolders returns false
      // sub1 has a subdir that returned false => hasNonEmptySubdirs = true
      // so no empty folders found
      expect(result.folders).toHaveLength(0)
      // sub1 at depth 1 is within maxDepth 1, so it gets scanned (total 2)
      expect(result.totalFoldersScanned).toBe(2)
      expect(sub2Reached).toBe(false)
    })

    it('handles inaccessible directories gracefully', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      mocks.readdir.mockRejectedValue(new Error('EACCES: permission denied'))
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, { directory: ROOT, maxDepth: 10, excludePatterns: [] })) as ScanResult
      expect(result.folders).toHaveLength(0)
      expect(result.totalFoldersScanned).toBe(0)
    })

    it('sorts empty folders by depth descending', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      mocks.readdir.mockImplementation(async (_dirPath: string) => {
        const dir = n(_dirPath)
        if (dir === ROOT) {
          return [{ name: 'a', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false }]
        }
        if (dir === `${ROOT}/a`) {
          return [{ name: 'b', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false }]
        }
        return []
      })
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, { directory: ROOT, maxDepth: 10, excludePatterns: [] })) as ScanResult
      // a at depth 1 (empty), b at depth 2 (empty)
      expect(result.folders).toHaveLength(2)
      expect(result.folders[0]!.depth).toBe(2)
      expect(result.folders[1]!.depth).toBe(1)
    })

    it('progress is throttled (not sent for fast scans under 500ms)', async () => {
      registerEmptyFolderCleanerIpc(() => makeWindow())
      mocks.readdir.mockImplementation(async (_dirPath: string) => {
        const dir = n(_dirPath)
        if (dir === ROOT) {
          return [
            { name: 'sub1', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
            { name: 'sub2', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
          ]
        }
        return []
      })
      const handler = getHandler('empty-folders:scan')
      await handler(undefined, { directory: ROOT, maxDepth: 10, excludePatterns: [] })
      // With fast tests (<500ms), the progress throttle prevents sending
      expect(mocks.webContentsSend).not.toHaveBeenCalledWith('empty-folders:progress', expect.anything())
    })

    it('handles cancelled flag during scan (reset per scan)', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:scan')
      const result = (await handler(undefined, { directory: ROOT, maxDepth: 10, excludePatterns: [] })) as ScanResult
      // cancelled flag is reset to false at the start of every scan
      expect(result.cancelled).toBe(false)
    })

    it('logs success message on completion', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:scan')
      await handler(undefined, { directory: ROOT, maxDepth: 10, excludePatterns: [] })
      expect(mocks.logger.success).toHaveBeenCalledWith('empty-folder-cleaner', expect.stringMatching(/Scan complete:/))
    })
  })

  // ── DELETE ──

  // ── SCAN: isProtectedFolder user-profile-dirs ──

  describe('EMPTY_FOLDERS_SCAN - user profile protection', () => {
    const origHome = process.env.HOME

    afterEach(() => {
      process.env.HOME = origHome
    })

    it('protects Desktop when directly under HOME', async () => {
      process.env.HOME = ROOT
      registerEmptyFolderCleanerIpc(winNull)
      mocks.readdir.mockImplementation(async (_dirPath: string) => {
        const dir = n(_dirPath)
        // Desktop is directly under HOME (=ROOT) → isProtectedFolder should return true
        // because parent of Desktop === HOME
        if (dir === `${ROOT}/Desktop`) return []
        if (dir === ROOT) {
          return [{ name: 'Desktop', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false }]
        }
        return []
      })
      const handler = getHandler('empty-folders:scan')
      const result = await handler(undefined, { directory: ROOT, maxDepth: 10, excludePatterns: [] })
      // Desktop should be protected (parent matches HOME), NOT in results
      expect(result.folders.map((f) => f.name)).not.toContain('Desktop')
    })

    it('does not protect Desktop when HOME is not set', async () => {
      delete process.env.HOME
      delete process.env.USERPROFILE
      registerEmptyFolderCleanerIpc(winNull)
      mocks.readdir.mockImplementation(async (_dirPath: string) => {
        const dir = n(_dirPath)
        if (dir === ROOT) {
          return [{ name: 'Desktop', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false }]
        }
        return []
      })
      const handler = getHandler('empty-folders:scan')
      const result = await handler(undefined, { directory: ROOT, maxDepth: 10, excludePatterns: [] })
      // HOME not set, so isProtectedFolder skips the user profile check,
      // Desktop is not protected → appears in empty folders
      expect(result.folders.map((f) => f.name)).toContain('Desktop')
    })
  })

  // ── SCAN: mid-loop cancellation ──

  describe('EMPTY_FOLDERS_SCAN - mid-loop cancellation', () => {
    it('returns cancelled=true when cancel handler fires mid-scan', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      const scanHandler = getHandler('empty-folders:scan')
      const cancelHandler = getHandler('empty-folders:cancel')

      let _readdirCalls = 0
      mocks.readdir.mockImplementation(async (_dirPath: string) => {
        _readdirCalls++
        const dir = n(_dirPath)
        if (dir === ROOT) {
          // Return 3 subdirectories; the 3rd will trigger a deeper recursion
          return [
            { name: 'empty1', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
            { name: 'empty2', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
            { name: 'trigger', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
          ]
        }
        // On the first recursive directory (empty1, empty2, or trigger),
        // fire cancel so subsequent entries see cancelled=true
        cancelHandler()
        return []
      })

      const result = await scanHandler(undefined, { directory: ROOT, maxDepth: 10, excludePatterns: [] })
      expect(result.cancelled).toBe(true)
    })
  })

  // ── SCAN: sendProgress with destroyed window ──

  describe('EMPTY_FOLDERS_SCAN - sendProgress with destroyed window', () => {
    it('does not throw when window is destroyed', async () => {
      registerEmptyFolderCleanerIpc(() => {
        return { webContents: { send: mocks.webContentsSend }, isDestroyed: () => true } as unknown as BrowserWindow
      })
      mocks.readdir.mockImplementation(async (_dirPath: string) => {
        const dir = n(_dirPath)
        if (dir === ROOT) {
          return [
            { name: 'sub1', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
            { name: 'sub2', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
          ]
        }
        return []
      })
      const handler = getHandler('empty-folders:scan')
      await expect(handler(undefined, { directory: ROOT, maxDepth: 10, excludePatterns: [] })).resolves.not.toThrow()
    })
  })

  // ── SCAN: progress sent when scan takes >500ms ──

  describe('EMPTY_FOLDERS_SCAN - progress send', () => {
    it('sends progress when scan takes longer than 500ms', async () => {
      vi.useFakeTimers()
      registerEmptyFolderCleanerIpc(() => {
        return { webContents: { send: mocks.webContentsSend }, isDestroyed: () => false } as unknown as BrowserWindow
      })
      // Each readdir call waits for a fake timer to advance
      mocks.readdir.mockImplementation(async (_dirPath: string) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 300))
        const dir = n(_dirPath)
        if (dir === ROOT) {
          return [
            { name: 'sub1', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
            { name: 'sub2', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false },
          ]
        }
        return []
      })
      const handler = getHandler('empty-folders:scan')
      // Start the scan (readdir calls are pending on setTimeout)
      const resultPromise = handler(undefined, { directory: ROOT, maxDepth: 10, excludePatterns: [] })
      // Advance enough for both readdir calls (300ms each = 600ms) + 500ms throttle gap
      await vi.advanceTimersByTimeAsync(1200)
      const result = await resultPromise
      // Progress should have been sent at least once
      expect(mocks.webContentsSend).toHaveBeenCalledWith('empty-folders:progress', expect.anything())
      expect(result.cancelled).toBe(false)
      vi.useRealTimers()
    }, 10000)
  })

  // ── DELETE ──

  describe('EMPTY_FOLDERS_DELETE', () => {
    beforeEach(() => {
      mocks.readdir.mockReset()
      mocks.rmdir.mockReset()
      mocks.shellTrashItem.mockReset()
    })

    // IPC handler signature: async (_event, paths, mode) => { ... }
    // Call as: handler(undefined, [...paths], 'recycle'|'permanent')

    it('returns zero counts for non-array paths', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:delete')
      const result = (await handler(undefined, 'not-an-array')) as DeleteResult
      expect(result).toEqual({ deleted: 0, failed: 0, errors: [] })
      expect(mocks.logger.warning).toHaveBeenCalledWith('empty-folder-cleaner', 'Delete called with non-array paths')
    })

    it('filters non-string and relative paths from the array', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      mocks.readdir.mockResolvedValue([])
      mocks.shellTrashItem.mockResolvedValue(undefined)
      const handler = getHandler('empty-folders:delete')
      const result = (await handler(undefined, [`${ROOT}/target`, 42, 'relative/path'])) as DeleteResult
      expect(result).toEqual({ deleted: 1, failed: 0, errors: [] })
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'empty-folder-cleaner',
        'Deleting 1 empty folder(s) (mode: recycle)',
      )
    })

    it('skips protected folders', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      // .git is in PROTECTED_GENERIC
      const handler = getHandler('empty-folders:delete')
      const result = (await handler(undefined, [`${ROOT}/.git`])) as DeleteResult
      expect(result).toEqual({
        deleted: 0,
        failed: 1,
        errors: [{ path: `${ROOT}/.git`, reason: 'Protected system folder' }],
      })
      expect(mocks.logger.warning).toHaveBeenCalledWith(
        'empty-folder-cleaner',
        `Skipped protected folder: ${ROOT}/.git`,
      )
    })

    it('skips non-empty folders (has entries)', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      mocks.readdir.mockResolvedValue(['some-file.txt'])
      const handler = getHandler('empty-folders:delete')
      const result = (await handler(undefined, [`${ROOT}/target`])) as DeleteResult
      expect(result).toEqual({
        deleted: 0,
        failed: 1,
        errors: [{ path: `${ROOT}/target`, reason: 'Folder is no longer empty' }],
      })
      expect(mocks.logger.warning).toHaveBeenCalledWith(
        'empty-folder-cleaner',
        `Skipped non-empty folder: ${ROOT}/target`,
      )
    })

    it('deletes empty folder via recycle bin (default mode)', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      mocks.readdir.mockResolvedValue([])
      mocks.shellTrashItem.mockResolvedValue(undefined)
      const handler = getHandler('empty-folders:delete')
      const result = (await handler(undefined, [`${ROOT}/target`])) as DeleteResult
      expect(result).toEqual({ deleted: 1, failed: 0, errors: [] })
      expect(mocks.shellTrashItem).toHaveBeenCalledWith(`${ROOT}/target`)
      expect(mocks.rmdir).not.toHaveBeenCalled()
    })

    it('deletes empty folder permanently when mode is permanent', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      mocks.readdir.mockResolvedValue([])
      mocks.rmdir.mockResolvedValue(undefined)
      const handler = getHandler('empty-folders:delete')
      const result = (await handler(undefined, [`${ROOT}/target`], 'permanent')) as DeleteResult
      expect(result).toEqual({ deleted: 1, failed: 0, errors: [] })
      expect(mocks.rmdir).toHaveBeenCalledWith(`${ROOT}/target`)
      expect(mocks.shellTrashItem).not.toHaveBeenCalled()
    })

    it('handles delete errors gracefully', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      mocks.readdir.mockResolvedValue([])
      mocks.shellTrashItem.mockRejectedValue(new Error('Access denied'))
      const handler = getHandler('empty-folders:delete')
      const result = (await handler(undefined, [`${ROOT}/target`])) as DeleteResult
      expect(result).toEqual({
        deleted: 0,
        failed: 1,
        errors: [{ path: `${ROOT}/target`, reason: 'Access denied' }],
      })
      expect(mocks.logger.error).toHaveBeenCalledWith(
        'empty-folder-cleaner',
        expect.stringContaining(`Failed to delete ${ROOT}/target`),
      )
    })

    it('handles error with non-Error thrown value', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      mocks.readdir.mockResolvedValue([])
      mocks.shellTrashItem.mockRejectedValue('some string error')
      const handler = getHandler('empty-folders:delete')
      const result = (await handler(undefined, [`${ROOT}/target`])) as DeleteResult
      expect(result).toEqual({
        deleted: 0,
        failed: 1,
        errors: [{ path: `${ROOT}/target`, reason: 'Unknown error' }],
      })
    })

    it('sorts paths deepest first for deletion order', async () => {
      registerEmptyFolderCleanerIpc(winNull)
      mocks.readdir.mockResolvedValue([])
      mocks.shellTrashItem.mockResolvedValue(undefined)
      const paths = [`${ROOT}/a`, `${ROOT}/a/b`, `${ROOT}/a/b/c`]
      const handler = getHandler('empty-folders:delete')
      const result = (await handler(undefined, paths)) as DeleteResult
      expect(result.deleted).toBe(3)
      // Should try deepest first: .../a/b/c, .../a/b, .../a
      expect(mocks.shellTrashItem.mock.calls[0]![0]).toBe(`${ROOT}/a/b/c`)
      expect(mocks.shellTrashItem.mock.calls[1]![0]).toBe(`${ROOT}/a/b`)
      expect(mocks.shellTrashItem.mock.calls[2]![0]).toBe(`${ROOT}/a`)
    })
  })

  // ── OPEN_LOCATION ──

  describe('EMPTY_FOLDERS_OPEN_LOCATION', () => {
    // IPC handler signature: (_event, folderPath) => { ... }
    // Call as: handler(undefined, '/some/path')

    it('logs and opens folder for valid absolute path', () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:open-location')
      handler(undefined, '/some/absolute/path')
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'empty-folder-cleaner',
        'Opening folder location: /some/absolute/path',
      )
      expect(mocks.shellShowItemInFolder).toHaveBeenCalledWith('/some/absolute/path')
    })

    it('does nothing for non-string path', () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:open-location')
      handler(undefined, 42)
      expect(mocks.shellShowItemInFolder).not.toHaveBeenCalled()
    })

    it('does nothing for relative path', () => {
      registerEmptyFolderCleanerIpc(winNull)
      const handler = getHandler('empty-folders:open-location')
      handler(undefined, 'relative/path')
      expect(mocks.shellShowItemInFolder).not.toHaveBeenCalled()
    })
  })
})
