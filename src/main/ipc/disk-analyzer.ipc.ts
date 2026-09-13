import { spawn } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { IPC } from '@shared/channels'
import type { DiskNode, DiskRepairProgress, DiskRepairResult, DriveInfo, FileTypeInfo } from '@shared/types'
import { type BrowserWindow, ipcMain } from 'electron'
import { isAdmin } from '../services/elevation'
import { execFileAsync, psUtf8, trackChildProcess } from '../services/exec-utf8'
import { getLogger } from '../services/logger.service'
import type { WindowGetter } from './index'

const MAX_DEPTH = 3
const FILE_TYPE_MAX_DEPTH = 4

// ── Internal helpers ──

async function analyzeDirectory(dirPath: string, depth: number, mainWindow: BrowserWindow | null): Promise<DiskNode> {
  const node: DiskNode = {
    name: basename(dirPath) || dirPath,
    path: dirPath,
    size: 0,
    children: [],
  }

  if (depth >= MAX_DEPTH) {
    node.size = await quickSize(dirPath)
    return node
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      try {
        if (entry.isDirectory()) {
          const child = await analyzeDirectory(fullPath, depth + 1, mainWindow)
          node.children!.push(child)
          node.size += child.size
        } else {
          const s = await stat(fullPath)
          node.size += s.size
        }
      } catch {
        // Skip inaccessible
      }
    }

    if (depth === 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.SCAN_PROGRESS, {
        phase: 'scanning',
        category: 'disk',
        currentPath: dirPath,
        progress: 50,
        itemsFound: node.children!.length,
        sizeFound: node.size,
      })
    }
  } catch {
    // Inaccessible directory
  }

  node.children?.sort((a, b) => b.size - a.size)
  return node
}

async function collectFileTypes(
  dirPath: string,
  depth: number,
  extMap: Map<string, { size: number; count: number }>,
  mainWindow: BrowserWindow | null,
): Promise<void> {
  if (depth >= FILE_TYPE_MAX_DEPTH) return
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      try {
        if (entry.isDirectory()) {
          await collectFileTypes(fullPath, depth + 1, extMap, mainWindow)
        } else {
          const s = await stat(fullPath)
          const ext = (extname(entry.name) || '(no extension)').toLowerCase()
          const existing = extMap.get(ext)
          if (existing) {
            existing.size += s.size
            existing.count += 1
          } else {
            extMap.set(ext, { size: s.size, count: 1 })
          }
        }
      } catch {
        // Skip inaccessible
      }
    }
    if (depth === 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.SCAN_PROGRESS, {
        phase: 'scanning',
        category: 'disk-file-types',
        currentPath: dirPath,
        progress: 50,
        itemsFound: extMap.size,
        sizeFound: 0,
      })
    }
  } catch {
    // Inaccessible directory
  }
}

async function quickSize(dirPath: string): Promise<number> {
  let size = 0
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      try {
        const s = await stat(join(dirPath, entry.name))
        size += s.isDirectory() ? 0 : s.size
      } catch {
        // Skip
      }
    }
  } catch {
    // Skip
  }
  return size
}

// ── Exported core logic ──

export async function getDrives(): Promise<DriveInfo[]> {
  getLogger().info('disk-analyzer', 'Fetching drive list...')
  try {
    const driveScript = `$fixed = (Get-WmiObject Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 }).DeviceID -replace ':',''; Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null -and $fixed -contains $_.Name } | ForEach-Object { "$($_.Name)|$($_.Description)|$($_.Used)|$($_.Free)" }`
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psUtf8(driveScript)], {
      timeout: 10000,
      windowsHide: true,
    })

    const drives: DriveInfo[] = []
    for (const line of stdout.trim().split('\n')) {
      const [letter, label, used, free] = line.trim().split('|')
      if (letter && used && free) {
        const usedSpace = Number.parseInt(used, 10) || 0
        const freeSpace = Number.parseInt(free, 10) || 0
        drives.push({
          letter: letter.trim(),
          label: label?.trim() || letter.trim(),
          totalSize: usedSpace + freeSpace,
          freeSpace,
          usedSpace,
        })
      }
    }
    getLogger().success('disk-analyzer', `Found ${drives.length} drive(s) on Windows`)
    return drives
  } catch {
    getLogger().error('disk-analyzer', 'Failed to fetch drives via WMI')
    return []
  }
}

/** Resolve a drive identifier to a root path (Windows letter) */
function resolveRootPath(drive: string): string | null {
  if (typeof drive !== 'string' || !drive) return null
  if (/^[A-Za-z]$/.test(drive)) return `${drive.toUpperCase()}:\\`
  return null
}

export async function analyzeDisk(drive: string): Promise<DiskNode> {
  getLogger().info('disk-analyzer', `Analyzing disk: ${drive}`)
  const rootPath = resolveRootPath(drive)
  if (!rootPath) {
    getLogger().warning('disk-analyzer', `Invalid drive identifier: ${drive}`)
    return { name: '', path: '', size: 0, children: [] }
  }
  const node = await analyzeDirectory(rootPath, 0, null)
  getLogger().success(
    'disk-analyzer',
    `Disk analysis complete for ${drive}: ${node.size} bytes in ${node.children?.length ?? 0} items`,
  )
  return node
}

export async function getFileTypes(drive: string): Promise<FileTypeInfo[]> {
  getLogger().info('disk-analyzer', `Collecting file types for: ${drive}`)
  const rootPath = resolveRootPath(drive)
  if (!rootPath) {
    getLogger().warning('disk-analyzer', `Invalid drive for file types: ${drive}`)
    return []
  }
  const extMap = new Map<string, { size: number; count: number }>()
  await collectFileTypes(rootPath, 0, extMap, null)
  const results: FileTypeInfo[] = []
  for (const [ext, info] of extMap) {
    results.push({ extension: ext, totalSize: info.size, fileCount: info.count })
  }
  results.sort((a, b) => b.totalSize - a.totalSize)
  getLogger().success('disk-analyzer', `Found ${results.length} file type(s) on ${drive}`)
  return results
}

// ── Disk Repair helpers (Windows SFC / DISM) ──

function sendRepairProgress(win: BrowserWindow | null, data: DiskRepairProgress): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.DISK_REPAIR_PROGRESS, data)
  }
}

/**
 * Run SFC /scannow and stream progress to the renderer.
 * SFC outputs progress lines like "Verification 42% complete."
 */
async function runSfc(drive: string, getWindow: WindowGetter): Promise<DiskRepairResult> {
  if (!isAdmin()) {
    getLogger().warning('disk-analyzer', 'SFC skipped: admin privileges required')
    return {
      tool: 'sfc',
      success: false,
      exitCode: null,
      summary: 'Administrator privileges required to run SFC',
      log: '',
      requiresReboot: false,
      needsAdmin: true,
    }
  }

  // Validate drive letter — must be a single A-Z character
  const safeDrive = /^[A-Za-z]$/.test(drive) ? drive.toUpperCase() : 'C'

  return new Promise((resolve) => {
    const args = ['/scannow']
    // If a non-system drive is specified, use /offbootdir and /offwindir
    if (safeDrive !== 'C') {
      args.push(`/offbootdir=${safeDrive}:\\`, `/offwindir=${safeDrive}:\\Windows`)
    }

    const child = spawn('cmd', ['/c', 'chcp 65001 >nul & sfc', ...args], { windowsHide: true })
    let stdout = ''
    let lastPercent = 0
    const decoder = new StringDecoder('utf-8')
    const stderrDecoder = new StringDecoder('utf-8')
    trackChildProcess(child)

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = decoder.write(chunk)
      stdout += text
      // Parse progress from SFC output like "Verification 42% complete."
      const match = text.match(/(\d+)\s*%/i)
      if (match) {
        const pct = Number.parseInt(match[1] ?? '0', 10)
        if (pct > lastPercent) {
          lastPercent = pct
          sendRepairProgress(getWindow(), {
            tool: 'sfc',
            phase: 'running',
            percent: pct,
            message: `System File Checker: ${pct}% complete`,
          })
        }
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stdout += stderrDecoder.write(chunk)
    })

    child.on('error', (err) => {
      sendRepairProgress(getWindow(), {
        tool: 'sfc',
        phase: 'failed',
        percent: 0,
        message: `SFC failed to start: ${err.message}`,
      })
      resolve({
        tool: 'sfc',
        success: false,
        exitCode: null,
        summary: `Failed to start SFC: ${err.message}`,
        log: stdout,
        requiresReboot: false,
        needsAdmin: false,
      })
    })

    child.on('close', (code) => {
      const success = code === 0
      let summary: string
      if (stdout.includes('did not find any integrity violations')) {
        summary = 'No integrity violations found — your system files are healthy.'
      } else if (stdout.includes('successfully repaired')) {
        summary = 'Windows found and repaired corrupted system files.'
      } else if (stdout.includes('found corrupt files but was unable to fix')) {
        summary = 'Corrupted files were found but could not be repaired. Try running DISM first, then SFC again.'
      } else if (success) {
        summary = 'SFC completed successfully.'
      } else {
        summary = `SFC exited with code ${code}.`
      }

      // Check for reboot indicators — use specific phrases, not generic words
      const requiresReboot = /pending system repair|restart your computer|reboot.*required/i.test(stdout)
      sendRepairProgress(getWindow(), {
        tool: 'sfc',
        phase: success ? 'done' : 'failed',
        percent: 100,
        message: summary,
      })
      resolve({ tool: 'sfc', success, exitCode: code, summary, log: stdout, requiresReboot, needsAdmin: false })
    })
  })
}

/**
 * Run DISM /Online /Cleanup-Image /RestoreHealth and stream progress.
 * DISM outputs progress like "[==                 10.0%                 ]"
 */
async function runDism(getWindow: WindowGetter): Promise<DiskRepairResult> {
  if (!isAdmin()) {
    getLogger().warning('disk-analyzer', 'DISM skipped: admin privileges required')
    return {
      tool: 'dism',
      success: false,
      exitCode: null,
      summary: 'Administrator privileges required to run DISM',
      log: '',
      requiresReboot: false,
      needsAdmin: true,
    }
  }

  return new Promise((resolve) => {
    const child = spawn(
      'cmd',
      ['/c', 'chcp 65001 >nul & DISM', '/English', '/Online', '/Cleanup-Image', '/RestoreHealth'],
      {
        windowsHide: true,
      },
    )
    let stdout = ''
    let lastPercent = 0
    const dismDecoder = new StringDecoder('utf-8')
    const dismStderrDecoder = new StringDecoder('utf-8')
    trackChildProcess(child)

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = dismDecoder.write(chunk)
      stdout += text
      const match = text.match(/(\d+(?:\.\d+)?)\s*%/i)
      if (match) {
        const pct = Math.round(Number.parseFloat(match[1] ?? '0'))
        if (pct > lastPercent) {
          lastPercent = pct
          sendRepairProgress(getWindow(), {
            tool: 'dism',
            phase: 'running',
            percent: pct,
            message: `DISM RestoreHealth: ${pct}% complete`,
          })
        }
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stdout += dismStderrDecoder.write(chunk)
    })

    child.on('error', (err) => {
      sendRepairProgress(getWindow(), {
        tool: 'dism',
        phase: 'failed',
        percent: 0,
        message: `DISM failed to start: ${err.message}`,
      })
      resolve({
        tool: 'dism',
        success: false,
        exitCode: null,
        summary: `Failed to start DISM: ${err.message}`,
        log: stdout,
        requiresReboot: false,
        needsAdmin: false,
      })
    })

    child.on('close', (code) => {
      const success = code === 0
      let summary: string
      if (stdout.includes('The restore operation completed successfully')) {
        summary = 'DISM successfully repaired the Windows component store.'
      } else if (stdout.includes('No component store corruption detected')) {
        summary = 'No component store corruption detected — image is healthy.'
      } else if (success) {
        summary = 'DISM completed successfully.'
      } else {
        summary = `DISM exited with code ${code}. Check the log for details.`
      }

      // Check for reboot indicators — use specific phrases to avoid false positives
      const requiresReboot = /restart your computer|reboot.*required|pending reboot/i.test(stdout)
      sendRepairProgress(getWindow(), {
        tool: 'dism',
        phase: success ? 'done' : 'failed',
        percent: 100,
        message: summary,
      })
      resolve({ tool: 'dism', success, exitCode: code, summary, log: stdout, requiresReboot, needsAdmin: false })
    })
  })
}

/**
 * Run CHKDSK on a drive and stream progress to the renderer.
 * CHKDSK outputs progress like "Stage 1: ... (42% complete)"
 */
async function runChkdsk(drive: string, getWindow: WindowGetter): Promise<DiskRepairResult> {
  if (!isAdmin()) {
    getLogger().warning('disk-analyzer', 'CHKDSK skipped: admin privileges required')
    return {
      tool: 'chkdsk',
      success: false,
      exitCode: null,
      summary: 'Administrator privileges required to run CHKDSK',
      log: '',
      requiresReboot: false,
      needsAdmin: true,
    }
  }

  const safeDrive = /^[A-Za-z]$/.test(drive) ? drive.toUpperCase() : 'C'

  return new Promise((resolve) => {
    const child = spawn('cmd', ['/c', `chcp 65001 >nul & chkdsk ${safeDrive}: /scan`], { windowsHide: true })
    let stdout = ''
    let lastPercent = 0
    const decoder = new StringDecoder('utf-8')
    const stderrDecoder = new StringDecoder('utf-8')
    trackChildProcess(child)

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = decoder.write(chunk)
      stdout += text
      const match = text.match(/(\d+)\s*percent/i) || text.match(/(\d+)\s*%/i)
      if (match) {
        const pct = Number.parseInt(match[1] ?? '0', 10)
        if (pct > lastPercent) {
          lastPercent = pct
          sendRepairProgress(getWindow(), {
            tool: 'chkdsk',
            phase: 'running',
            percent: pct,
            message: `CHKDSK: ${pct}% complete`,
          })
        }
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stdout += stderrDecoder.write(chunk)
    })

    child.on('error', (err) => {
      sendRepairProgress(getWindow(), {
        tool: 'chkdsk',
        phase: 'failed',
        percent: 0,
        message: `CHKDSK failed to start: ${err.message}`,
      })
      resolve({
        tool: 'chkdsk',
        success: false,
        exitCode: null,
        summary: `Failed to start CHKDSK: ${err.message}`,
        log: stdout,
        requiresReboot: false,
        needsAdmin: false,
      })
    })

    child.on('close', (code) => {
      // CHKDSK exit codes: 0 = no errors, 1 = errors found & fixed,
      // 2 = cleanup performed, 3 = could not check the disk.
      // Codes 0–2 are successful completions.
      const success = code !== null && code <= 2
      let summary: string
      if (stdout.includes('Windows has scanned the file system and found no problems')) {
        summary = 'No file system errors found — disk is healthy.'
      } else if (stdout.includes('Windows has made corrections to the file system')) {
        summary = 'File system errors were found and repaired.'
      } else if (stdout.includes('no further action is required')) {
        summary = 'CHKDSK completed — no further action required.'
      } else if (code === 1) {
        summary = 'Errors were found and fixed successfully.'
      } else if (code === 2) {
        summary = 'CHKDSK completed disk cleanup.'
      } else if (code === 0) {
        summary = 'CHKDSK completed successfully.'
      } else {
        summary = `CHKDSK exited with code ${code}. Check the log for details.`
      }

      const requiresReboot = /restart your computer|schedule.*check.*restart|cannot run.*volume is in use/i.test(stdout)
      sendRepairProgress(getWindow(), {
        tool: 'chkdsk',
        phase: success ? 'done' : 'failed',
        percent: 100,
        message: summary,
      })
      resolve({ tool: 'chkdsk', success, exitCode: code, summary, log: stdout, requiresReboot, needsAdmin: false })
    })
  })
}

// ── IPC registration ──

export function registerDiskAnalyzerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.DISK_DRIVES, () => getDrives())

  ipcMain.handle(IPC.DISK_FILE_TYPES, async (_event, drive: string): Promise<FileTypeInfo[]> => {
    getLogger().info('disk-analyzer', `IPC: collecting file types for ${drive}`)
    const rootPath = resolveRootPath(drive)
    if (!rootPath) {
      getLogger().warning('disk-analyzer', `IPC: invalid drive for file types: ${drive}`)
      return []
    }
    const extMap = new Map<string, { size: number; count: number }>()
    await collectFileTypes(rootPath, 0, extMap, getWindow())
    const results: FileTypeInfo[] = []
    for (const [ext, info] of extMap) {
      results.push({ extension: ext, totalSize: info.size, fileCount: info.count })
    }
    results.sort((a, b) => b.totalSize - a.totalSize)
    getLogger().success('disk-analyzer', `IPC: collected ${results.length} file type(s) for ${drive}`)
    return results
  })

  ipcMain.handle(IPC.DISK_ANALYZE, async (_event, drive: string): Promise<DiskNode> => {
    getLogger().info('disk-analyzer', `IPC: analyzing disk ${drive}`)
    const rootPath = resolveRootPath(drive)
    if (!rootPath) {
      getLogger().warning('disk-analyzer', `IPC: invalid drive for analyze: ${drive}`)
      return { name: '', path: '', size: 0, children: [] }
    }
    const node = await analyzeDirectory(rootPath, 0, getWindow())
    getLogger().success('disk-analyzer', `IPC: analysis complete for ${drive}: ${node.size} bytes`)
    return node
  })

  // Disk repair
  ipcMain.handle(IPC.DISK_REPAIR_SFC, async (_event, drive: unknown): Promise<DiskRepairResult> => {
    const safeDrive = typeof drive === 'string' && /^[A-Za-z]$/.test(drive) ? drive : 'C'
    getLogger().info('disk-analyzer', `IPC: running SFC scan on ${safeDrive}`)
    const result = await runSfc(safeDrive, getWindow)
    if (result.success) {
      getLogger().success('disk-analyzer', `SFC completed on ${safeDrive}: ${result.summary}`)
    } else {
      getLogger().error('disk-analyzer', `SFC failed on ${safeDrive}: ${result.summary}`)
    }
    return result
  })

  ipcMain.handle(IPC.DISK_REPAIR_DISM, async (): Promise<DiskRepairResult> => {
    getLogger().info('disk-analyzer', 'IPC: running DISM RestoreHealth')
    const result = await runDism(getWindow)
    if (result.success) {
      getLogger().success('disk-analyzer', `DISM completed: ${result.summary}`)
    } else {
      getLogger().error('disk-analyzer', `DISM failed: ${result.summary}`)
    }
    return result
  })

  ipcMain.handle(IPC.DISK_REPAIR_CHKDSK, async (_event, drive: unknown): Promise<DiskRepairResult> => {
    const safeDrive = typeof drive === 'string' && /^[A-Za-z]$/.test(drive) ? drive : 'C'
    getLogger().info('disk-analyzer', `IPC: running CHKDSK on ${safeDrive}`)
    const result = await runChkdsk(safeDrive, getWindow)
    if (result.success) {
      getLogger().success('disk-analyzer', `CHKDSK completed on ${safeDrive}: ${result.summary}`)
    } else {
      getLogger().error('disk-analyzer', `CHKDSK failed on ${safeDrive}: ${result.summary}`)
    }
    return result
  })
}
