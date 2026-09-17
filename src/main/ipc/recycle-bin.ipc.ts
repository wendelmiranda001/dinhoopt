import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { IPC } from '@shared/channels'
import { CleanerType } from '@shared/enums'
import type { CleanResult, ScanResult } from '@shared/types'
import { ipcMain } from 'electron'
import { getPlatform } from '../platform'
import { execFileAsync, psArgs } from '../services/exec-utf8'
import { cleanItems, scanDirectory } from '../services/file-utils'
import { validateStringArray } from '../services/ipc-validation'
import { getLogger } from '../services/logger.service'
import { cacheItems } from '../services/scan-cache'

export function registerRecycleBinIpc(): void {
  // Per-invocation state — scoped to closure so no external mutation
  let lastScannedSize = 0
  let lastScannedItemIds: string[] = []

  ipcMain.handle(IPC.RECYCLE_BIN_SCAN, async (): Promise<ScanResult[]> => {
    getLogger().info('recycle-bin', 'Scanning recycle bin')
    const trashPath = getPlatform().paths.trashPath()

    if (trashPath) {
      // macOS / Linux: scan trash directory as real files
      try {
        if (!existsSync(trashPath)) {
          getLogger().info('recycle-bin', 'Trash path does not exist')
          return []
        }
        const result = await scanDirectory(trashPath, CleanerType.RecycleBin, 'Trash', 0)
        if (result.items.length > 0) {
          cacheItems(result.items)
          lastScannedItemIds = result.items.map((i) => i.id)
          getLogger().success('recycle-bin', `Found ${result.items.length} items (${result.totalSize} bytes)`)
          return [result]
        }
        getLogger().info('recycle-bin', 'No items found in trash')
        return []
      } catch (err) {
        getLogger().error('recycle-bin', `Scan failed: ${err}`)
        return []
      }
    }

    // Windows: COM-based recycle bin
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        psArgs(
          `$shell = New-Object -ComObject Shell.Application; $rb = $shell.NameSpace(0x0a); $items = $rb.Items(); $count = $items.Count; $size = ($items | Measure-Object -Property Size -Sum).Sum; Write-Output "$count|$size"`,
        ),
        { windowsHide: true },
      )

      const [countStr, sizeStr] = String(stdout).trim().split('|')
      const count = Number.parseInt(countStr!, 10) || 0
      const size = Number.parseInt(sizeStr!, 10) || 0

      lastScannedSize = size

      if (count === 0) {
        getLogger().info('recycle-bin', 'Recycle bin is empty')
        return []
      }

      getLogger().success('recycle-bin', `Found ${count} items totalling ${size} bytes`)
      return [
        {
          category: CleanerType.RecycleBin,
          subcategory: 'Recycle Bin',
          items: [
            {
              id: randomUUID(),
              path: 'Recycle Bin',
              size,
              category: CleanerType.RecycleBin,
              subcategory: 'Recycle Bin',
              lastModified: Date.now(),
              selected: true,
            },
          ],
          totalSize: size,
          itemCount: count,
        },
      ]
    } catch (err) {
      getLogger().error('recycle-bin', `Windows scan failed: ${err}`)
      return []
    }
  })

  ipcMain.handle(IPC.RECYCLE_BIN_CLEAN, async (_event, itemIds?: string[]): Promise<CleanResult> => {
    getLogger().info('recycle-bin', 'Cleaning recycle bin')

    // Validate IDs when provided (macOS/Linux path uses them)
    if (itemIds && !validateStringArray(itemIds)) {
      getLogger().warning('recycle-bin', 'Clean skipped — invalid item IDs')
      return { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }
    }

    const trashPath = getPlatform().paths.trashPath()

    if (trashPath) {
      // macOS / Linux: delete cached trash items via standard file-utils flow
      try {
        const ids = itemIds ?? lastScannedItemIds
        const result = await cleanItems(ids)
        lastScannedItemIds = []
        getLogger().success('recycle-bin', `Cleaned ${result.totalCleaned} bytes from trash`)
        return result
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        getLogger().error('recycle-bin', `Trash clean failed: ${message}`)
        return {
          totalCleaned: 0,
          filesDeleted: 0,
          filesSkipped: 0,
          errors: [{ path: 'Trash', reason: message }],
          needsElevation: false,
        }
      }
    }

    // Windows: SHEmptyRecycleBin Win32 API
    const sizeBeforeClean = lastScannedSize
    try {
      getLogger().info('recycle-bin', 'Emptying recycle bin...')
      // Flags: SHERB_NOCONFIRMATION(1) | SHERB_NOPROGRESSUI(2) | SHERB_NOSOUND(4) = 7
      await execFileAsync(
        'powershell.exe',
        psArgs(
          `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class RecycleBin { [DllImport("Shell32.dll", CharSet = CharSet.Unicode)] public static extern uint SHEmptyRecycleBin(IntPtr hwnd, string pszRootPath, uint dwFlags); }'; [RecycleBin]::SHEmptyRecycleBin([IntPtr]::Zero, $null, 7)`,
        ),
        { windowsHide: true },
      )

      // Re-scan to determine actual cleaned space
      const { stdout } = await execFileAsync(
        'powershell.exe',
        psArgs(
          `$shell = New-Object -ComObject Shell.Application; $rb = $shell.NameSpace(0x0a); $items = $rb.Items(); $count = $items.Count; $size = ($items | Measure-Object -Property Size -Sum).Sum; Write-Output "$count|$size"`,
        ),
        { windowsHide: true },
      )
      const [remainingStr, afterSizeStr] = String(stdout).trim().split('|')
      const remaining = Number.parseInt(remainingStr!, 10) || 0
      const afterSize = Number.parseInt(afterSizeStr!, 10) || 0
      const actualCleaned = Math.max(0, sizeBeforeClean - afterSize)

      lastScannedSize = afterSize

      if (remaining === 0) {
        getLogger().success('recycle-bin', `Cleaned ${actualCleaned} bytes from recycle bin`)
        return { totalCleaned: actualCleaned, filesDeleted: 1, filesSkipped: 0, errors: [], needsElevation: false }
      }
      // Partial clean - some items couldn't be removed
      getLogger().warning('recycle-bin', `Partial clean: ${remaining} items remaining (may be in use)`)
      return {
        totalCleaned: actualCleaned,
        filesDeleted: 1,
        filesSkipped: remaining,
        errors: [
          { path: 'Recycle Bin', reason: `${remaining} item(s) could not be removed (may be in use or protected)` },
        ],
        needsElevation: false,
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      getLogger().error('recycle-bin', `Windows clean failed: ${message}`)
      return {
        totalCleaned: 0,
        filesDeleted: 0,
        filesSkipped: 0,
        errors: [{ path: 'Recycle Bin', reason: message }],
        needsElevation: false,
      }
    }
  })
}
