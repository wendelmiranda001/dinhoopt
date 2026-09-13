import { execSync, spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { IPC } from '@shared/channels'
import { CleanerType } from '@shared/enums'
import type { CleanResult, ScanItem, ScanResult } from '@shared/types'
import { ipcMain } from 'electron'
import { isAdmin } from '../services/elevation'
import { execFileAsync } from '../services/exec-utf8'
import { getLogger } from '../services/logger.service'
import { cacheItems } from '../services/scan-cache'
import type { WindowGetter } from './index'

const WINSXS_SUBCATEGORY = 'WinSxS Component Store'

function parseDismSize(text: string): number | null {
  const normalized = text.replace(',', '.')
  const match = normalized.match(/^([\d.]+)\s*(GB|MB|KB)/i)
  if (!match) return null
  const value = Number.parseFloat(match[1] ?? '0')
  const unit = match[2]?.toUpperCase()
  if (unit === 'GB') return Math.round(value * 1024 * 1024 * 1024)
  if (unit === 'MB') return Math.round(value * 1024 * 1024)
  if (unit === 'KB') return Math.round(value * 1024)
  return null
}

interface AnalyzeResult {
  reclaimableBytes: number
  packagesCount: number
  recommended: boolean
}

function parseAnalyzeOutput(stdout: string): AnalyzeResult {
  let reclaimableBytes = 0
  let packagesCount = 0
  let recommended = false

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()

    const backupsMatch = trimmed.match(/Backups and Disabled Features\s*:\s*(.+)/i)
    if (backupsMatch) {
      const size = parseDismSize(backupsMatch[1] ?? '')
      if (size !== null) reclaimableBytes += size
    }

    const cacheMatch = trimmed.match(/Cache and Temporary Data\s*:\s*(.+)/i)
    if (cacheMatch) {
      const size = parseDismSize(cacheMatch[1] ?? '')
      if (size !== null) reclaimableBytes += size
    }

    const pkgMatch = trimmed.match(/Number of Reclaimable Packages\s*:\s*(\d+)/i)
    if (pkgMatch) {
      packagesCount = Number.parseInt(pkgMatch[1] ?? '0', 10)
    }

    if (trimmed.match(/Component Store Cleanup Recommended\s*:\s*Yes/i)) {
      recommended = true
    }
  }

  return { reclaimableBytes, packagesCount, recommended }
}

async function runAnalyze(): Promise<AnalyzeResult> {
  const { stdout } = await execFileAsync(
    'cmd.exe',
    ['/c', 'chcp 65001 >nul & DISM /English /Online /Cleanup-Image /AnalyzeComponentStore'],
    { timeout: 120_000, windowsHide: true },
  )
  return parseAnalyzeOutput(stdout)
}

export function registerWinSxSCleanerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.WINSXS_ANALYZE, async (): Promise<ScanResult> => {
    const logger = getLogger()
    logger.info('winsxs-cleaner', 'Analyzing WinSxS component store...')

    if (!isAdmin()) {
      logger.warning('winsxs-cleaner', 'Skipped — admin required')
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.SCAN_PROGRESS, {
          phase: 'scanning',
          category: CleanerType.WinSxS,
          currentPath: '',
          progress: 100,
          itemsFound: 0,
          sizeFound: 0,
        })
      }
      return {
        category: CleanerType.WinSxS,
        subcategory: '__elevation_required',
        items: [],
        totalSize: 0,
        itemCount: 0,
        group: WINSXS_SUBCATEGORY,
      }
    }

    try {
      const { reclaimableBytes, packagesCount } = await runAnalyze()
      logger.success(
        'winsxs-cleaner',
        `Analysis complete: ${reclaimableBytes} bytes reclaimable, ${packagesCount} packages`,
      )

      const items: ScanItem[] = []
      if (reclaimableBytes > 0) {
        items.push({
          id: 'winsxs',
          path: 'WinSxS Component Store',
          size: reclaimableBytes,
          category: CleanerType.WinSxS,
          subcategory: WINSXS_SUBCATEGORY,
          lastModified: Date.now(),
          selected: true,
        })
      }

      cacheItems(items)

      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.SCAN_PROGRESS, {
          phase: 'scanning',
          category: CleanerType.WinSxS,
          currentPath: '',
          progress: 100,
          itemsFound: items.length,
          sizeFound: reclaimableBytes,
        })
      }

      return {
        category: CleanerType.WinSxS,
        subcategory: WINSXS_SUBCATEGORY,
        items,
        totalSize: reclaimableBytes,
        itemCount: items.length,
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('winsxs-cleaner', `Analysis failed: ${message}`)

      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.SCAN_PROGRESS, {
          phase: 'scanning',
          category: CleanerType.WinSxS,
          currentPath: '',
          progress: 100,
          itemsFound: 0,
          sizeFound: 0,
        })
      }

      return {
        category: CleanerType.WinSxS,
        subcategory: WINSXS_SUBCATEGORY,
        items: [],
        totalSize: 0,
        itemCount: 0,
      }
    }
  })

  ipcMain.handle(IPC.WINSXS_CLEAN, async (): Promise<CleanResult> => {
    const logger = getLogger()
    logger.info('winsxs-cleaner', 'Cleaning WinSxS...')

    if (!isAdmin()) {
      return {
        totalCleaned: 0,
        filesDeleted: 0,
        filesSkipped: 0,
        errors: [],
        needsElevation: true,
      }
    }

    return new Promise((resolve) => {
      const child = spawn(
        'cmd',
        ['/c', 'chcp 65001 >nul & DISM /English /Online /Cleanup-Image /StartComponentCleanup'],
        {
          windowsHide: true,
        },
      )

      let lastPercent = 0
      const decoder = new StringDecoder('utf-8')

      // Safety timeout: DISM should complete within 10 minutes
      const DISM_TIMEOUT = 600_000
      const timeout = setTimeout(() => {
        logger.error('winsxs-cleaner', 'DISM cleanup timed out after 10 minutes — killing process')
        child.kill()
        // Give it a moment to die, then force-kill the whole process tree via
        // taskkill. child.killed only means the signal was *sent* — the cmd
        // wrapper can linger owning the DISM grandchild, so only an actual exit
        // (exitCode set) cancels the tree kill.
        setTimeout(() => {
          if (child.exitCode !== null) return
          try {
            execSync(`taskkill /T /F /PID ${child.pid}`, { windowsHide: true })
          } catch {
            /* already dead */
          }
        }, 5000)
      }, DISM_TIMEOUT)

      const cleanup = () => {
        clearTimeout(timeout)
      }

      // Drain DISM's stderr — if it is never consumed, the ~64KB pipe buffer
      // fills and the process stalls silently before the timeout can fire.
      const errDecoder = new StringDecoder('utf-8')
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = errDecoder.write(chunk).trim()
        if (text) {
          logger.warning('winsxs-cleaner', `DISM stderr: ${text.slice(0, 200)}`)
        }
      })

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = decoder.write(chunk)
        const match = text.match(/(\d+(?:\.\d+)?)\s*%/i)
        if (match) {
          const pct = Math.round(Number.parseFloat(match[1] ?? '0'))
          if (pct > lastPercent) {
            lastPercent = pct
            const win = getWindow()
            if (win && !win.isDestroyed()) {
              win.webContents.send(IPC.SCAN_PROGRESS, {
                phase: 'cleaning',
                category: CleanerType.WinSxS,
                currentPath: 'WinSxS Component Store',
                progress: pct,
                itemsFound: 1,
                sizeFound: 0,
              })
            }
          }
        }
      })

      child.on('error', (err) => {
        cleanup()
        logger.error('winsxs-cleaner', `Clean failed to start: ${err.message}`)
        resolve({
          totalCleaned: 0,
          filesDeleted: 0,
          filesSkipped: 0,
          errors: [{ path: 'WinSxS', reason: err.message }],
          needsElevation: false,
        })
      })

      child.on('close', (code) => {
        cleanup()
        const success = code === 0
        if (success) {
          logger.success('winsxs-cleaner', 'WinSxS cleanup completed successfully')
        } else if (code === null) {
          logger.error('winsxs-cleaner', 'WinSxS cleanup timed out')
        } else {
          logger.error('winsxs-cleaner', `WinSxS cleanup exited with code ${code}`)
        }

        const win = getWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC.SCAN_PROGRESS, {
            phase: 'cleaning',
            category: CleanerType.WinSxS,
            currentPath: 'WinSxS Component Store',
            progress: 100,
            itemsFound: 1,
            sizeFound: success ? 1 : 0,
          })
        }

        resolve({
          totalCleaned: success ? 1 : 0,
          filesDeleted: success ? 1 : 0,
          filesSkipped: 0,
          errors: success
            ? []
            : code === null
              ? [{ path: 'WinSxS', reason: 'DISM timed out after 10 minutes' }]
              : [{ path: 'WinSxS', reason: `DISM exited with code ${code}` }],
          needsElevation: false,
        })
      })
    })
  })
}
