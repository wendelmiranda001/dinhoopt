import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { IPC } from '@shared/channels'
import { CleanerType } from '@shared/enums'
import type { CleanResult, ScanItem, ScanResult } from '@shared/types'
import { ipcMain } from 'electron'
import { execFileAsync, psUtf8 } from '../services/exec-utf8'
import { cleanItems } from '../services/file-utils'
import { validateStringArray } from '../services/ipc-validation'
import { getLogger } from '../services/logger.service'
import { cacheItems } from '../services/scan-cache'
import type { WindowGetter } from './index'

// ── Shortcut target resolution ──

interface ShortcutInfo {
  path: string
  targetPath: string | null
}

/**
 * Resolve the target of a Windows .lnk shortcut using PowerShell.
 * Returns target paths for all .lnk files in the given directory.
 */
async function resolveWinShortcuts(dir: string): Promise<ShortcutInfo[]> {
  if (!existsSync(dir)) return []
  try {
    // PowerShell script to resolve all .lnk targets in the directory
    const psScript = `
$shell = New-Object -ComObject WScript.Shell
Get-ChildItem -Path '${dir.replace(/'/g, "''")}' -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $sc = $shell.CreateShortcut($_.FullName)
    "$($_.FullName)|$($sc.TargetPath)"
  } catch { "$($_.FullName)|" }
}`
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psUtf8(psScript)], {
      timeout: 30000,
      windowsHide: true,
      encoding: 'utf-8',
    })

    const results: ShortcutInfo[] = []
    for (const line of String(stdout).trim().split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const sepIdx = trimmed.lastIndexOf('|')
      if (sepIdx < 0) continue
      const shortcutPath = trimmed.substring(0, sepIdx)
      const targetPath = trimmed.substring(sepIdx + 1).trim() || null
      results.push({ path: shortcutPath, targetPath })
    }
    return results
  } catch {
    return []
  }
}

// ── Shortcut directories ──

function getShortcutDirs(): { path: string; subcategory: string }[] {
  const home = homedir()
  const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming')
  return [
    { path: join(home, 'Desktop'), subcategory: 'Desktop Shortcuts' },
    { path: join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), subcategory: 'Start Menu Shortcuts' },
    {
      path: join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
      subcategory: 'Taskbar Shortcuts',
    },
    {
      path: join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      subcategory: 'All Users Start Menu',
    },
    { path: join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop'), subcategory: 'Public Desktop Shortcuts' },
  ]
}

// ── Check if a shortcut target is broken ──

/** Windows Start Menu subdirectories that contain built-in OS shortcuts */
const WIN_SYSTEM_SUBDIRS =
  /\\(System Tools|Administrative Tools|Accessibility|Windows PowerShell|Windows System|Windows Accessories)\\/i

function isTargetBroken(info: ShortcutInfo): boolean {
  if (process.platform === 'win32') {
    // Never flag shortcuts in built-in Windows Start Menu subdirectories
    if (WIN_SYSTEM_SUBDIRS.test(info.path)) return false
    // A .lnk with a stored filesystem path returns it from WScript.Shell even
    // when the file is gone, so an empty TargetPath means the shortcut targets
    // a shell namespace item (File Explorer, This PC, Recycle Bin, etc.) which
    // we can't verify via the filesystem — leave it alone.
    if (!info.targetPath) return false
    // Never flag shortcuts pointing to Windows system executables
    if (/\\Windows\\/i.test(info.targetPath)) return false
  }
  // If we couldn't resolve the target at all, consider it broken
  if (!info.targetPath) return true
  // Empty target
  if (info.targetPath.trim() === '') return true
  // Skip URLs and special targets
  if (/^https?:\/\//i.test(info.targetPath)) return false
  if (/^[a-z]+:/i.test(info.targetPath) && !info.targetPath.startsWith('/')) return false
  // Skip Windows UWP / shell: / explorer targets — these don't have normal file paths
  if (/^shell:/i.test(info.targetPath)) return false
  if (/^microsoft\./i.test(info.targetPath)) return false
  // Skip targets that reference Windows Apps store folder (UWP apps)
  if (/\\WindowsApps\\/i.test(info.targetPath)) return false
  // Check if the target exists on disk
  return !existsSync(info.targetPath)
}

// ── IPC registration ──

export function registerShortcutCleanerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.SHORTCUT_SCAN, async (): Promise<ScanResult[]> => {
    getLogger().info('shortcut-cleaner', 'Scanning for broken shortcuts...')
    const results: ScanResult[] = []
    const category = CleanerType.Shortcut
    const dirs = getShortcutDirs()
    for (const dir of dirs) {
      try {
        const shortcuts = await resolveWinShortcuts(dir.path)

        const brokenItems: ScanItem[] = []
        for (const sc of shortcuts) {
          if (isTargetBroken(sc)) {
            let size = 0
            let lastModified = 0
            try {
              const s = await stat(sc.path)
              size = s.size
              lastModified = s.mtimeMs
            } catch {
              // Can't stat, that's fine
            }
            brokenItems.push({
              id: randomUUID(),
              path: sc.path,
              size,
              category,
              subcategory: dir.subcategory,
              lastModified,
              selected: true,
            })
          }
        }

        if (brokenItems.length > 0) {
          cacheItems(brokenItems)
          const totalSize = brokenItems.reduce((s, i) => s + i.size, 0)
          results.push({
            category,
            subcategory: dir.subcategory,
            items: brokenItems,
            totalSize,
            itemCount: brokenItems.length,
          })
        }
      } catch {
        getLogger().warning('shortcut-cleaner', `Skipped inaccessible directory: ${dir.path}`)
      }
    }

    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.SCAN_PROGRESS, {
        phase: 'scanning',
        category,
        currentPath: 'Shortcut scan complete',
        progress: 100,
        itemsFound: results.reduce((s, r) => s + r.itemCount, 0),
        sizeFound: results.reduce((s, r) => s + r.totalSize, 0),
      })
    }

    const totalBroken = results.reduce((s, r) => s + r.itemCount, 0)
    if (totalBroken > 0) {
      getLogger().success(
        'shortcut-cleaner',
        `Found ${totalBroken} broken shortcut(s) across ${results.length} location(s)`,
      )
    } else {
      getLogger().success('shortcut-cleaner', 'No broken shortcuts found')
    }
    return results
  })

  ipcMain.handle(IPC.SHORTCUT_CLEAN, async (_event, itemIds: string[]): Promise<CleanResult> => {
    getLogger().info('shortcut-cleaner', `Cleaning ${Array.isArray(itemIds) ? itemIds.length : 0} shortcut(s)...`)
    const valid = validateStringArray(itemIds)
    if (!valid) {
      getLogger().warning('shortcut-cleaner', 'Clean called with invalid item IDs')
      return { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }
    }
    const result = await cleanItems(valid, (processed, total, currentPath, cleanedSize) => {
      const win = getWindow()
      if (win && !win.isDestroyed())
        win.webContents.send(IPC.SCAN_PROGRESS, {
          phase: 'cleaning',
          category: CleanerType.Shortcut,
          currentPath,
          progress: (processed / total) * 100,
          itemsFound: total,
          sizeFound: cleanedSize,
        })
    })
    getLogger().success('shortcut-cleaner', `Cleaned ${result.totalCleaned} shortcut(s)`)
    return result
  })
}
