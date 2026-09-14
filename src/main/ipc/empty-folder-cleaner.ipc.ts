import { readdir, rmdir } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { IPC } from '@shared/channels'
import type {
  EmptyFolderDeleteResult,
  EmptyFolderEntry,
  EmptyFolderScanOptions,
  EmptyFolderScanProgress,
  EmptyFolderScanResult,
} from '@shared/types'
import { type BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { getLogger } from '../services/logger.service'
import type { WindowGetter } from './index'

let cancelled = false

// ── Safety: paths we must never delete from ──

const PROTECTED_WIN32 = [
  'windows',
  'system32',
  'syswow64',
  'winsxs',
  'program files',
  'program files (x86)',
  'programdata',
  'recovery',
  'boot',
  '$recycle.bin',
  'system volume information',
  'perflogs',
  'msocache',
  'config.msi',
  'drivers',
  'inf',
  'logs',
]
const PROTECTED_GENERIC = [
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '.npm',
  '.cache',
  '.local',
  '__pycache__',
  '.venv',
  '.env',
  '.ssh',
  '.gnupg',
  '.config',
  'appdata',
  '.android',
  '.gradle',
]

function isProtectedFolder(folderPath: string): boolean {
  const name = basename(folderPath).toLowerCase()
  const pathLower = folderPath.toLowerCase().replace(/\\/g, '/')

  // Never touch root-level directories on any drive
  // e.g. C:\Windows, /usr, /etc
  const segments = pathLower.split('/').filter(Boolean)
  // On Windows paths like C:/Windows, segments = ['c:', 'windows'] — depth 2 means root-level folder
  // On Unix /usr — segments = ['usr'] — depth 1 means root-level folder
  const isRootLevel = segments.length <= 2

  if (isRootLevel) return true

  // Check against protected lists
  const protectedNames = [...PROTECTED_WIN32, ...PROTECTED_GENERIC]

  if (protectedNames.includes(name)) return true

  // Never delete user profile root folders (Desktop, Documents, Downloads, etc.)
  const userProfileDirs = ['desktop', 'documents', 'downloads', 'pictures', 'videos', 'music', 'onedrive']
  if (userProfileDirs.includes(name)) {
    // Only protect if it's directly under the user profile
    const home = (process.env.HOME || process.env.USERPROFILE || '').toLowerCase().replace(/\\/g, '/')
    if (home) {
      const parent = pathLower.substring(0, pathLower.lastIndexOf('/'))
      if (parent === home || parent === `${home}/`) return true
    }
  }

  return false
}

function sendProgress(win: BrowserWindow | null, data: EmptyFolderScanProgress): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.EMPTY_FOLDERS_PROGRESS, data)
  }
}

/**
 * Recursively finds empty folders (bottom-up).
 * A folder is "empty" if it contains no files and no non-empty subdirectories.
 */
async function findEmptyFolders(
  dirPath: string,
  options: EmptyFolderScanOptions,
  depth: number,
  emptyFolders: EmptyFolderEntry[],
  counters: { scanned: number },
  win: BrowserWindow | null,
  lastReport: { time: number },
  rootDir: string,
): Promise<boolean> {
  if (cancelled) return false
  if (depth > options.maxDepth) return false

  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch (err) {
    getLogger().debug('empty-folder-cleaner', `Skipped inaccessible directory ${dirPath}: ${String(err)}`)
    return false // inaccessible — treat as non-empty for safety
  }

  counters.scanned++

  const now = Date.now()
  if (now - lastReport.time > 500) {
    lastReport.time = now
    sendProgress(win, {
      currentPath: dirPath,
      foldersScanned: counters.scanned,
      emptyFound: emptyFolders.length,
      progress: 0,
    })
  }

  let hasFiles = false
  let hasNonEmptySubdirs = false

  for (const entry of entries) {
    if (cancelled) return false

    if (entry.isSymbolicLink()) {
      hasFiles = true // treat symlinks as content
      continue
    }

    if (entry.isFile()) {
      hasFiles = true
    } else if (entry.isDirectory()) {
      // Skip hidden/dot-directories and user-configured exclusions before recursing
      if (entry.name.startsWith('.')) {
        hasNonEmptySubdirs = true // treat as non-empty so parent isn't flagged
        continue
      }
      const entryNameLower = entry.name.toLowerCase()
      if (options.excludePatterns.some((p) => entry.name === p || entryNameLower === p.toLowerCase())) {
        hasNonEmptySubdirs = true
        continue
      }

      const subPath = join(dirPath, entry.name)
      const subEmpty = await findEmptyFolders(
        subPath,
        options,
        depth + 1,
        emptyFolders,
        counters,
        win,
        lastReport,
        rootDir,
      )
      if (!subEmpty) {
        hasNonEmptySubdirs = true
      }
    }
  }

  // This folder is empty if it has no files and all subdirectories were empty (and removed from consideration)
  const isEmpty = !hasFiles && !hasNonEmptySubdirs

  // Never mark the root scan directory or protected folders as empty
  if (isEmpty && dirPath !== rootDir && !isProtectedFolder(dirPath)) {
    emptyFolders.push({
      path: dirPath,
      name: basename(dirPath),
      depth,
    })
  }

  return isEmpty
}

export function registerEmptyFolderCleanerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.EMPTY_FOLDERS_SELECT_DIR, async () => {
    getLogger().info('empty-folder-cleaner', 'Opening directory selection dialog')
    const win = getWindow()
    if (!win) return null
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const result = await dialog.showOpenDialog(win, opts)
    if (result.canceled || !result.filePaths.length) {
      getLogger().warning('empty-folder-cleaner', 'Directory selection cancelled')
      return null
    }
    getLogger().success('empty-folder-cleaner', `Selected directory: ${result.filePaths[0]}`)
    return result.filePaths[0]
  })

  // Cancel
  ipcMain.handle(IPC.EMPTY_FOLDERS_CANCEL, () => {
    getLogger().warning('empty-folder-cleaner', 'Scan cancelled by user')
    cancelled = true
  })

  // Scan
  ipcMain.handle(IPC.EMPTY_FOLDERS_SCAN, async (_event, options: unknown): Promise<EmptyFolderScanResult> => {
    cancelled = false
    const startTime = Date.now()
    const win = getWindow()
    const emptyResult: EmptyFolderScanResult = { folders: [], totalFoldersScanned: 0, duration: 0, cancelled: false }

    if (!options || typeof options !== 'object') {
      getLogger().warning('empty-folder-cleaner', 'Scan called with invalid options')
      return emptyResult
    }
    const opts = options as Record<string, unknown>

    const dir = typeof opts.directory === 'string' ? opts.directory : ''
    const safeOptions: EmptyFolderScanOptions = {
      directory: isAbsolute(dir) ? dir : '',
      maxDepth: typeof opts.maxDepth === 'number' && opts.maxDepth > 0 ? opts.maxDepth : 20,
      excludePatterns: Array.isArray(opts.excludePatterns)
        ? (opts.excludePatterns as unknown[]).filter((p): p is string => typeof p === 'string')
        : [],
    }

    if (!safeOptions.directory) {
      getLogger().warning('empty-folder-cleaner', 'Scan called without a valid directory')
      return emptyResult
    }
    getLogger().info('empty-folder-cleaner', `Scanning for empty folders in: ${safeOptions.directory}`)

    const emptyFolders: EmptyFolderEntry[] = []
    const counters = { scanned: 0 }
    const lastReport = { time: Date.now() }
    await findEmptyFolders(
      safeOptions.directory,
      safeOptions,
      0,
      emptyFolders,
      counters,
      win,
      lastReport,
      safeOptions.directory,
    )

    // Sort by depth descending (deepest first — so deleting goes bottom-up)
    emptyFolders.sort((a, b) => b.depth - a.depth)

    if (cancelled) {
      getLogger().warning(
        'empty-folder-cleaner',
        `Scan cancelled after scanning ${counters.scanned} folder(s), found ${emptyFolders.length} empty`,
      )
    } else {
      getLogger().success(
        'empty-folder-cleaner',
        `Scan complete: scanned ${counters.scanned} folder(s), found ${emptyFolders.length} empty in ${Date.now() - startTime}ms`,
      )
    }

    return {
      folders: emptyFolders,
      totalFoldersScanned: counters.scanned,
      duration: Date.now() - startTime,
      cancelled,
    }
  })

  // Delete — always uses recycle bin for safety (rmdir only works on truly empty dirs)
  ipcMain.handle(
    IPC.EMPTY_FOLDERS_DELETE,
    async (_event, paths: unknown, mode: unknown): Promise<EmptyFolderDeleteResult> => {
      if (!Array.isArray(paths)) {
        getLogger().warning('empty-folder-cleaner', 'Delete called with non-array paths')
        return { deleted: 0, failed: 0, errors: [] }
      }
      const safePaths = paths.filter((p): p is string => typeof p === 'string' && isAbsolute(p))
      const deleteMode = mode === 'permanent' ? 'permanent' : 'recycle'
      getLogger().info('empty-folder-cleaner', `Deleting ${safePaths.length} empty folder(s) (mode: ${deleteMode})`)

      let deleted = 0
      let failed = 0
      const errors: { path: string; reason: string }[] = []

      // Sort deepest first to ensure children are removed before parents
      safePaths.sort((a, b) => b.split(/[\\/]/).length - a.split(/[\\/]/).length)

      for (const folderPath of safePaths) {
        // Double-check protection at delete time
        if (isProtectedFolder(folderPath)) {
          getLogger().warning('empty-folder-cleaner', `Skipped protected folder: ${folderPath}`)
          failed++
          errors.push({ path: folderPath, reason: 'Protected system folder' })
          continue
        }

        try {
          // Verify folder is still empty before deleting
          const entries = await readdir(folderPath)
          if (entries.length > 0) {
            getLogger().warning('empty-folder-cleaner', `Skipped non-empty folder: ${folderPath}`)
            failed++
            errors.push({ path: folderPath, reason: 'Folder is no longer empty' })
            continue
          }

          if (deleteMode === 'recycle') {
            await shell.trashItem(folderPath)
          } else {
            await rmdir(folderPath)
          }
          deleted++
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          getLogger().error('empty-folder-cleaner', `Failed to delete ${folderPath}: ${msg}`)
          failed++
          errors.push({ path: folderPath, reason: msg })
        }
      }

      getLogger().success('empty-folder-cleaner', `Deleted ${deleted}/${safePaths.length} folder(s), ${failed} failed`)
      return { deleted, failed, errors }
    },
  )

  // Open folder location
  ipcMain.handle(IPC.EMPTY_FOLDERS_OPEN_LOCATION, (_event, folderPath: unknown) => {
    getLogger().info('empty-folder-cleaner', `Opening folder location: ${folderPath}`)
    if (typeof folderPath !== 'string' || !isAbsolute(folderPath)) return
    shell.showItemInFolder(folderPath)
  })
}
