import { randomBytes } from 'node:crypto'
import { existsSync, constants as fsConstants } from 'node:fs'
import { lstat, open, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { CleanerType } from '@shared/enums'
import type { CleanResult, ScanItem, ScanResult } from '@shared/types'
import { getLogger } from './logger.service'
import { getCachedItems } from './scan-cache'
import { getSettings } from './settings-store'

let nextId = 1
function nextItemId(): string {
  return String(nextId++)
}

export interface DeleteResult {
  path: string
  success: boolean
  reason?: string
}

/**
 * Check if a path matches any of the configured exclusions.
 * Supports exact path prefixes and *.ext glob patterns.
 */
export function isExcluded(filePath: string, exclusions: string[]): boolean {
  if (exclusions.length === 0) return false
  // Only normalize to backslash on Windows; on Linux/macOS forward slash is the separator
  const toSep = process.platform === 'win32' ? /\//g : /\\/g
  const sep = process.platform === 'win32' ? '\\' : '/'
  const normalized = filePath.toLowerCase().replace(toSep, sep)
  for (const exc of exclusions) {
    const pattern = exc.toLowerCase().replace(toSep, sep)
    if (pattern.startsWith('*.')) {
      // Extension glob: *.log, *.tmp etc.
      if (normalized.endsWith(pattern.substring(1))) return true
    } else {
      // Path prefix match — require a separator boundary so `C:\Windows` does not
      // exclude `C:\Windows10`. Trailing separators are normalized away.
      const boundary = pattern.endsWith(sep) ? pattern : `${pattern}${sep}`
      if (normalized === pattern || normalized.startsWith(boundary)) return true
    }
  }
  return false
}

/**
 * Overwrite a single file's contents with random data, then zeros, before deletion.
 * For directories, recursively overwrite all files within.
 *
 * Symlink safety: the target is first inspected with `lstat` (never follows links)
 * and then opened with `O_NOFOLLOW`. A path that resolves to (or races into) a
 * symlink is left untouched — only the link itself is removed later by `rm`.
 * Directory entries are still subject to TOCTOU (no `openat` in Node.js).
 */
async function secureOverwrite(filePath: string): Promise<void> {
  const stats = await lstat(filePath)

  // Detect directories via lstat BEFORE opening: on Windows `open(dir, 'r+')`
  // throws EISDIR, so the old post-open isDirectory() branch was unreachable.
  if (stats.isDirectory()) {
    const entries = await readdir(filePath, { withFileTypes: true })
    for (const entry of entries) {
      await secureOverwrite(join(filePath, entry.name))
    }
    return
  }

  // Skip symlinks, special files and empty files without touching them.
  if (!stats.isFile() || stats.size === 0) return

  const fh = await open(filePath, fsConstants.O_RDWR | fsConstants.O_NOFOLLOW)
  try {
    const { size } = await fh.stat()
    const CHUNK = 1024 * 1024 // 1 MB chunks

    // Pass 1: random data
    let offset = 0
    while (offset < size) {
      const len = Math.min(CHUNK, size - offset)
      const buf = await new Promise<Buffer>((resolve, reject) => {
        randomBytes(len, (err, buf) => {
          if (err) reject(err)
          else resolve(buf)
        })
      })
      await fh.write(buf, 0, len, offset)
      offset += len
    }
    await fh.datasync()

    // Pass 2: zeros
    const zeroBuf = Buffer.alloc(Math.min(CHUNK, size))
    offset = 0
    while (offset < size) {
      const len = Math.min(CHUNK, size - offset)
      await fh.write(zeroBuf, 0, len, offset)
      offset += len
    }
    await fh.datasync()
  } finally {
    await fh.close()
  }
}

/**
 * Atomically overwrite a file with new content using a temporary file + rename.
 * Writes content to a unique temporary file ({path}.{pid}.{n}.tmp), fsyncs it,
 * then renames it over the original. The unique name prevents concurrent callers
 * from colliding on the same temp file, and the fsync guarantees the data reaches
 * disk before the rename swaps it in place.
 */
export async function overwriteFile(filePath: string, content: string | Buffer): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${nextItemId()}.tmp`
  const fh = await open(tmpPath, 'w')
  try {
    await fh.writeFile(content)
    await fh.sync()
  } finally {
    await fh.close()
  }
  await rename(tmpPath, filePath)
}

export async function safeDelete(filePath: string): Promise<DeleteResult> {
  try {
    const settings = getSettings()
    if (settings.cleaner.secureDelete) {
      try {
        await secureOverwrite(filePath)
      } catch (err) {
        getLogger().warning('file-utils', `Secure overwrite failed for ${filePath}: ${String(err)}`)
      }
    }

    // Send the recursive flag only for directories: some callers intentionally
    // feed directories (e.g. launcher/GPU caches scanned via scanDirectoriesAsItems),
    // so a blanket `recursive: true` for plain files would be wasteful. lstat keeps
    // symlinks from being followed into arbitrary targets.
    let isDirectory = false
    try {
      isDirectory = Boolean((await lstat(filePath))?.isDirectory?.())
    } catch {
      // Path missing/unreadable — force removal handles it
    }

    await rm(filePath, { force: true, recursive: isDirectory })
    return { path: filePath, success: true }
  } catch (err: unknown) {
    const nodeErr = err as { code?: string; message?: string }
    if (nodeErr.code === 'EBUSY' || nodeErr.code === 'EPERM') {
      return { path: filePath, success: false, reason: 'in-use' }
    }
    if (nodeErr.code === 'EACCES') {
      return { path: filePath, success: false, reason: 'permission-denied' }
    }
    if (nodeErr.code === 'ENOENT') {
      return { path: filePath, success: true }
    }
    return { path: filePath, success: false, reason: nodeErr.message || String(err) }
  }
}

/**
 * Look up cached scan items by ID, delete each one, and return a CleanResult.
 */
export async function cleanItems(
  itemIds: unknown,
  onProgress?: (processed: number, total: number, currentPath: string, cleanedSize: number) => void,
): Promise<CleanResult> {
  // Validate input is a string array
  const validIds = Array.isArray(itemIds) ? itemIds.filter((v): v is string => typeof v === 'string') : []
  if (Array.isArray(itemIds) && itemIds.length > validIds.length) {
    getLogger().info('file-utils', `Ignored ${itemIds.length - validIds.length} non-string item id(s)`)
  }
  const items = getCachedItems(validIds)
  let totalCleaned = 0
  let filesDeleted = 0
  let filesSkipped = 0
  const errors: CleanResult['errors'] = []
  let lastReport = 0

  for (const item of items) {
    const result = await safeDelete(item.path)
    if (result.success) {
      totalCleaned += item.size
      filesDeleted++
    } else {
      filesSkipped++
      if (result.reason) {
        errors.push({ path: item.path, reason: result.reason })
      }
    }
    if (onProgress) {
      const processed = filesDeleted + filesSkipped
      const now = Date.now()
      if (now - lastReport > 120 || processed === items.length) {
        lastReport = now
        onProgress(processed, items.length, item.path, totalCleaned)
      }
    }
  }

  const needsElevation = errors.some((e) => e.reason === 'permission-denied')
  return { totalCleaned, filesDeleted, filesSkipped, errors, needsElevation }
}

export async function scanDirectory(
  dirPath: string,
  category: CleanerType,
  subcategory: string,
  skipRecentMinutes = getSettings().cleaner.skipRecentMinutes ?? 60,
): Promise<ScanResult> {
  const items: ScanItem[] = []
  let totalSize = 0
  let entryErrors = 0
  let truncated = false
  const cutoff = Date.now() - skipRecentMinutes * 60 * 1000
  const MAX_ITEMS = 5000
  const exclusions = getSettings().exclusions

  const entries = await readdir(dirPath, { withFileTypes: true }).catch((err: unknown) => {
    getLogger().warning('file-utils', `Could not read directory ${dirPath}: ${String(err)}`)
    return null
  })

  if (entries) {
    const CONCURRENCY = 50

    async function processEntry(entry: import('fs').Dirent): Promise<void> {
      if (items.length >= MAX_ITEMS) {
        truncated = true
        return
      }
      const fullPath = join(dirPath, entry.name)

      // Check exclusions
      if (isExcluded(fullPath, exclusions)) return

      try {
        const stats = await lstat(fullPath)

        if (stats.mtimeMs > cutoff) return

        const size = stats.isDirectory() ? await getDirectorySize(fullPath, 2) : stats.size

        const item: ScanItem = {
          id: nextItemId(),
          path: fullPath,
          size,
          category,
          subcategory,
          lastModified: stats.mtimeMs,
          selected: true,
        }

        items.push(item)
        totalSize += item.size
      } catch {
        // Skip inaccessible files
        entryErrors += 1
      }
    }

    for (let i = 0; i < entries.length; i += CONCURRENCY) {
      const batch = entries.slice(i, i + CONCURRENCY)
      await Promise.all(batch.map(processEntry))
    }
  }

  if (truncated) {
    getLogger().warning('file-utils', `Scan of ${dirPath} capped at ${MAX_ITEMS} items`)
  }
  if (entryErrors > 0) {
    getLogger().info('file-utils', `Skipped ${entryErrors} unreadable item(s) in ${dirPath}`)
  }

  return {
    category,
    subcategory,
    items,
    totalSize,
    itemCount: items.length,
  }
}

/**
 * Scan multiple directories and merge their items into a single ScanResult.
 * Each item's subcategory is set to the provided label so they group together.
 */
export async function scanMultipleDirectories(
  dirPaths: string[],
  category: CleanerType,
  subcategory: string,
  skipRecentMinutes = getSettings().cleaner.skipRecentMinutes ?? 60,
): Promise<ScanResult> {
  const allItems: ScanItem[] = []
  let totalSize = 0

  for (const dirPath of dirPaths) {
    const result = await scanDirectory(dirPath, category, subcategory, skipRecentMinutes)
    allItems.push(...result.items)
    totalSize += result.totalSize
  }

  return {
    category,
    subcategory,
    items: allItems,
    totalSize,
    itemCount: allItems.length,
  }
}

export async function scanFile(filePath: string, category: CleanerType, subcategory: string): Promise<ScanResult> {
  const exclusions = getSettings().exclusions
  if (isExcluded(filePath, exclusions)) {
    return { category, subcategory, items: [], totalSize: 0, itemCount: 0 }
  }

  try {
    const stats = await lstat(filePath)
    if (!stats.isFile()) {
      return { category, subcategory, items: [], totalSize: 0, itemCount: 0 }
    }
    const item: ScanItem = {
      id: nextItemId(),
      path: filePath,
      size: stats.size,
      category,
      subcategory,
      lastModified: stats.mtimeMs,
      selected: true,
    }
    return { category, subcategory, items: [item], totalSize: stats.size, itemCount: 1 }
  } catch {
    return { category, subcategory, items: [], totalSize: 0, itemCount: 0 }
  }
}

/**
 * Treat each directory path as a single deletable item (not individual files inside).
 * Returns one ScanItem per existing directory with its total size.
 */
export async function scanDirectoriesAsItems(
  dirPaths: string[],
  category: CleanerType,
  subcategory: string,
  group?: string,
): Promise<ScanResult> {
  const items: ScanItem[] = []
  let totalSize = 0
  const exclusions = getSettings().exclusions

  for (const dirPath of dirPaths) {
    if (isExcluded(dirPath, exclusions)) continue

    try {
      const stats = await lstat(dirPath)
      if (!stats.isDirectory()) continue
      const size = await getDirectorySize(dirPath, 3)
      if (size < 1024) continue

      items.push({
        id: nextItemId(),
        path: dirPath,
        size,
        category,
        subcategory,
        lastModified: stats.mtimeMs,
        selected: true,
      })
      totalSize += size
    } catch {
      // Path doesn't exist or inaccessible
    }
  }

  return { category, subcategory, ...(group ? { group } : {}), items, totalSize, itemCount: items.length }
}

/**
 * For paths with a childSubdir, expand paths/&ast;/childSubdir.
 * e.g. given ['/home/.var/app'] with childSubdir='cache', returns
 * ['/home/.var/app/com.spotify.Client/cache', '/home/.var/app/org.foo/cache', ...]
 * If no childSubdir, returns the original paths unchanged.
 */
export async function resolveChildSubdirs(paths: string[], childSubdir?: string): Promise<string[]> {
  if (!childSubdir) return paths

  const resolved: string[] = []
  for (const basePath of paths) {
    try {
      if (!existsSync(basePath)) continue
      const children = await readdir(basePath, { withFileTypes: true })
      for (const child of children) {
        if (child.isDirectory()) {
          const subPath = join(basePath, child.name, childSubdir)
          if (existsSync(subPath)) resolved.push(subPath)
        }
      }
    } catch {
      /* skip */
    }
  }
  return resolved
}

/**
 * Convert a Windows wildcard pattern (e.g. *.log, thumb?.*, *.*) to a RegExp.
 * Only `*` (any chars) and `?` (single char) are supported.
 */
function wildcardToRe(pattern: string): RegExp {
  // On Windows `*.*` matches every file, including those without an extension.
  if (pattern === '*.*') return /^.*$/i
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const reStr = escaped.replace(/\?/g, '.').replace(/\*/g, '.*')
  return new RegExp(`^${reStr}$`, 'i')
}

/**
 * Scan a directory for files matching a fileMask, optionally recursing.
 * Returns one ScanItem per matching file (not directories).
 */
export async function scanWithFileMask(
  dirPath: string,
  fileMask: string,
  recurse: boolean,
  category: CleanerType,
  subcategory: string,
  removeSelf = false,
  skipRecentMinutes = getSettings().cleaner.skipRecentMinutes ?? 60,
): Promise<ScanResult> {
  const items: ScanItem[] = []
  let totalSize = 0
  const cutoff = Date.now() - skipRecentMinutes * 60 * 1000
  const MAX_ITEMS = 5000
  const exclusions = getSettings().exclusions
  const pattern = wildcardToRe(fileMask)

  async function walk(currentPath: string, depth: number): Promise<void> {
    if (depth > 10 || items.length >= MAX_ITEMS) return
    let entries: import('fs').Dirent[]
    try {
      entries = await readdir(currentPath, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (items.length >= MAX_ITEMS) break
      const fullPath = join(currentPath, entry.name)
      if (isExcluded(fullPath, exclusions)) continue
      if (entry.isDirectory()) {
        if (recurse) await walk(fullPath, depth + 1)
      } else if (entry.isFile() && pattern.test(entry.name)) {
        try {
          const stats = await lstat(fullPath)
          if (!stats.isFile() || stats.mtimeMs > cutoff) continue
          items.push({
            id: nextItemId(),
            path: fullPath,
            size: stats.size,
            category,
            subcategory,
            lastModified: stats.mtimeMs,
            selected: true,
          })
          totalSize += stats.size
        } catch {
          // Skip inaccessible
        }
      }
    }
  }

  await walk(dirPath, 0)

  // REMOVESELF: the rule also owns the directory itself, so offer it as one item.
  if (removeSelf) {
    try {
      const dirStats = await lstat(dirPath)
      if (dirStats.isDirectory()) {
        const dirSize = await getDirectorySize(dirPath, 10)
        items.push({
          id: nextItemId(),
          path: dirPath,
          size: dirSize,
          category,
          subcategory,
          lastModified: dirStats.mtimeMs,
          selected: true,
        })
        totalSize += dirSize
      }
    } catch {
      // Directory doesn't exist — nothing to add
    }
  }

  return { category, subcategory, items, totalSize, itemCount: items.length }
}

export async function getDirectorySize(dirPath: string, maxDepth = 3): Promise<number> {
  if (maxDepth <= 0) return 0
  let size = 0
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      try {
        const stats = await lstat(fullPath)
        if (stats.isDirectory()) {
          size += await getDirectorySize(fullPath, maxDepth - 1)
        } else if (stats.isFile()) {
          size += stats.size
        }
      } catch {
        // Skip
      }
    }
  } catch {
    // Skip
  }
  return size
}
