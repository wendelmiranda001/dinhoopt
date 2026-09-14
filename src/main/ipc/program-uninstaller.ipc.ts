import { IPC } from '@shared/channels'
import type { InstalledProgram, UninstallerListResult, UninstallProgress, UninstallResult } from '@shared/types'
import { ipcMain } from 'electron'
import { safeDelete } from '../services/file-utils'
import { getLogger } from '../services/logger.service'
import {
  deleteRegistryKey,
  getInstalledProgramsFull,
  runUninstaller,
  scanLeftoversForProgram,
  verifyUninstall,
} from '../services/program-uninstaller'
import type { WindowGetter } from './index'
import { validateSender } from './sender-validation'

let cachedPrograms: InstalledProgram[] = []

export function registerProgramUninstallerIpc(getWindow: WindowGetter): void {
  const sendProgress = (data: UninstallProgress): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.UNINSTALLER_PROGRESS, data)
  }

  /**
   * Drop a program from the module-level cache after a successful uninstall so
   * a stale entry can never be targeted again by id.
   */
  const invalidateCacheFor = (programId: string): void => {
    cachedPrograms = cachedPrograms.filter((p) => p.id !== programId)
  }

  ipcMain.handle(IPC.UNINSTALLER_LIST, async (): Promise<UninstallerListResult> => {
    getLogger().info('program-uninstaller', 'Listing installed programs')
    const programs = await getInstalledProgramsFull()
    cachedPrograms = programs
    getLogger().success('program-uninstaller', `Found ${programs.length} installed programs`)
    return { programs, totalCount: programs.length }
  })

  ipcMain.handle(IPC.UNINSTALLER_UNINSTALL, async (event, programId: string): Promise<UninstallResult> => {
    if (!validateSender(event, getWindow()))
      return {
        success: false,
        programName: 'Unknown',
        exitCode: null,
        error: 'Invalid sender',
        leftoversFound: 0,
        leftoversCleaned: 0,
        leftoversSize: 0,
      }
    const program = cachedPrograms.find((p) => p.id === programId)
    if (!program) {
      getLogger().warning('program-uninstaller', `Program ${programId} not found in cache`)
      return {
        success: false,
        programName: 'Unknown',
        exitCode: null,
        error: 'Program not found in cache. Please refresh the list.',
        leftoversFound: 0,
        leftoversCleaned: 0,
        leftoversSize: 0,
      }
    }

    getLogger().info('program-uninstaller', `Starting uninstall of ${program.displayName}`)

    // Phase 1: Run the native uninstaller
    sendProgress({
      phase: 'uninstalling',
      currentProgram: program.displayName,
      progress: 10,
      detail: 'Running native uninstaller...',
    })

    const exitCode = await runUninstaller(program)

    // Phase 2: Verify the uninstall
    const removed = await verifyUninstall(program.registryKey)

    if (!removed) {
      // Registry key still exists — program is likely still installed.
      // Exit codes: 0 may mean cancelled, 1602/1603 are MSI cancel/fail,
      // 3010 means success but reboot needed (registry clears after reboot).
      const rebootPending = exitCode === 3010
      if (!rebootPending) {
        getLogger().error(
          'program-uninstaller',
          `Uninstall of ${program.displayName} failed or was cancelled (exit code ${exitCode})`,
        )
        return {
          success: false,
          programName: program.displayName,
          exitCode,
          error: 'Uninstall may have been cancelled or failed. The program still appears in the registry.',
          leftoversFound: 0,
          leftoversCleaned: 0,
          leftoversSize: 0,
        }
      }
    }

    // Phase 3: Scan for leftovers
    sendProgress({
      phase: 'scanning-leftovers',
      currentProgram: program.displayName,
      progress: 50,
      detail: 'Scanning for leftover files...',
    })

    const leftovers = await scanLeftoversForProgram(program)
    if (leftovers.length === 0) {
      getLogger().success('program-uninstaller', `Uninstalled ${program.displayName} — no leftovers found`)
      invalidateCacheFor(programId)
      return {
        success: true,
        programName: program.displayName,
        exitCode,
        leftoversFound: 0,
        leftoversCleaned: 0,
        leftoversSize: 0,
      }
    }

    // Phase 4: Clean leftovers
    sendProgress({
      phase: 'cleaning-leftovers',
      currentProgram: program.displayName,
      progress: 75,
      detail: `Cleaning ${leftovers.length} leftover items...`,
    })

    let cleaned = 0
    let cleanedSize = 0
    for (const item of leftovers) {
      const result = await safeDelete(item.path)
      if (result.success) {
        cleaned++
        cleanedSize += item.size
      }
    }

    getLogger().success(
      'program-uninstaller',
      `Uninstalled ${program.displayName}: ${cleaned}/${leftovers.length} leftovers cleaned`,
    )
    invalidateCacheFor(programId)
    return {
      success: true,
      programName: program.displayName,
      exitCode,
      leftoversFound: leftovers.length,
      leftoversCleaned: cleaned,
      leftoversSize: cleanedSize,
    }
  })

  ipcMain.handle(IPC.UNINSTALLER_FORCE_REMOVE, async (_event, programId: string): Promise<UninstallResult> => {
    const program = cachedPrograms.find((p) => p.id === programId)
    if (!program) {
      getLogger().warning('program-uninstaller', `Force remove: program ${programId} not found in cache`)
      return {
        success: false,
        programName: 'Unknown',
        exitCode: null,
        error: 'Program not found in cache. Please refresh the list.',
        leftoversFound: 0,
        leftoversCleaned: 0,
        leftoversSize: 0,
      }
    }

    getLogger().info('program-uninstaller', `Force removing ${program.displayName}`)

    // Phase 1: Delete registry key
    sendProgress({
      phase: 'force-removing',
      currentProgram: program.displayName,
      progress: 10,
      detail: 'Removing registry entry...',
    })

    const deleted = await deleteRegistryKey(program.registryKey)
    if (!deleted) {
      getLogger().error('program-uninstaller', `Force remove: failed to delete registry key for ${program.displayName}`)
      return {
        success: false,
        programName: program.displayName,
        exitCode: null,
        error: 'Failed to delete the registry entry. This may require administrator privileges.',
        leftoversFound: 0,
        leftoversCleaned: 0,
        leftoversSize: 0,
      }
    }

    // Phase 2: Scan for leftovers
    sendProgress({
      phase: 'scanning-leftovers',
      currentProgram: program.displayName,
      progress: 40,
      detail: 'Scanning for leftover files...',
    })

    const leftovers = await scanLeftoversForProgram(program)

    if (leftovers.length === 0) {
      getLogger().success('program-uninstaller', `Force removed ${program.displayName} — no leftovers`)
      invalidateCacheFor(programId)
      return {
        success: true,
        programName: program.displayName,
        exitCode: null,
        leftoversFound: 0,
        leftoversCleaned: 0,
        leftoversSize: 0,
      }
    }

    // Phase 3: Clean leftovers
    sendProgress({
      phase: 'cleaning-leftovers',
      currentProgram: program.displayName,
      progress: 70,
      detail: `Cleaning ${leftovers.length} leftover items...`,
    })

    let cleaned = 0
    let cleanedSize = 0
    for (const item of leftovers) {
      const result = await safeDelete(item.path)
      if (result.success) {
        cleaned++
        cleanedSize += item.size
      }
    }

    getLogger().success(
      'program-uninstaller',
      `Force removed ${program.displayName}: ${cleaned}/${leftovers.length} leftovers cleaned`,
    )
    invalidateCacheFor(programId)
    return {
      success: true,
      programName: program.displayName,
      exitCode: null,
      leftoversFound: leftovers.length,
      leftoversCleaned: cleaned,
      leftoversSize: cleanedSize,
    }
  })
}
