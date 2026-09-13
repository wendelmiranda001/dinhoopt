import { mkdirSync } from 'node:fs'
import type { RegistryEntry } from '@shared/types'
import { getBackupDir } from '../backup-dir'
import { execTracked, psUtf8 } from '../exec-utf8'
import { getSettings } from '../settings-store'
import { createFullBackup, createTargetedBackup, pruneOldBackups } from './backup'
import { execReg, splitTaskPath } from './utils'

export async function fixRegistryEntries(
  entries: RegistryEntry[],
  onProgress?: (current: number, total: number, label: string) => void,
  signal?: AbortSignal,
): Promise<{ fixed: number; failed: number; failures: { issue: string; reason: string }[] }> {
  const total = entries.length
  onProgress?.(0, total, 'Creating registry backup...')
  let fixed = 0
  let failed = 0
  const failures: { issue: string; reason: string }[] = []

  try {
    const backupDir = getBackupDir()
    mkdirSync(backupDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const mode = getSettings().backupMode ?? 'targeted'
    if (mode === 'full') {
      await createFullBackup(backupDir, timestamp, signal)
    } else {
      await createTargetedBackup(entries, backupDir, timestamp, signal)
    }
    pruneOldBackups(backupDir, 3)
  } catch {
    /* Backup failed, but continue */
  }

  for (let i = 0; i < entries.length; i++) {
    if (signal?.aborted) break
    const entry = entries[i]
    if (!entry?.fix) {
      failed++
      failures.push({ issue: 'Unknown entry', reason: 'Entry data not found — try scanning again before fixing' })
      continue
    }

    const fix = entry.fix
    const key = fix.key || entry.keyPath
    const value = fix.value || entry.valueName

    onProgress?.(i + 1, total, `Fixing: ${entry.issue.substring(0, 80)}...`)

    try {
      switch (fix.op) {
        case 'delete-value':
          await execReg(['delete', key, '/v', value, '/f'], { timeout: 10000, ...(signal ? { signal } : {}) })
          break
        case 'delete-key':
          await execReg(['delete', key, '/f'], { timeout: 10000, ...(signal ? { signal } : {}) })
          break
        case 'set-value':
          if (!fix.regType || fix.data === undefined) {
            throw new Error(`Missing regType or data for set-value on ${value}`)
          }
          await execReg(['add', key, '/v', value, '/t', fix.regType, '/d', fix.data, '/f'], {
            timeout: 10000,
            ...(signal ? { signal } : {}),
          })
          break
        case 'disable-task': {
          const disableParts = splitTaskPath(entry.keyPath)
          if (!disableParts) throw new Error('Invalid task path')
          const safeDisablePath = disableParts.path.replace(/'/g, "''")
          const safeDisableName = disableParts.name.replace(/'/g, "''")
          const disableScript = `Disable-ScheduledTask -TaskPath '${safeDisablePath}' -TaskName '${safeDisableName}' -ErrorAction Stop`
          await execTracked('powershell', ['-NoProfile', '-NonInteractive', '-Command', psUtf8(disableScript)], {
            timeout: 10000,
            ...(signal ? { signal } : {}),
          })
          break
        }
        case 'delete-task': {
          const deleteParts = splitTaskPath(entry.keyPath)
          if (!deleteParts) throw new Error('Invalid task path')
          const safeDeletePath = deleteParts.path.replace(/'/g, "''")
          const safeDeleteName = deleteParts.name.replace(/'/g, "''")
          const deleteScript = `Unregister-ScheduledTask -TaskPath '${safeDeletePath}' -TaskName '${safeDeleteName}' -Confirm:$false -ErrorAction Stop`
          await execTracked('powershell', ['-NoProfile', '-NonInteractive', '-Command', psUtf8(deleteScript)], {
            timeout: 10000,
            ...(signal ? { signal } : {}),
          })
          break
        }
      }
      fixed++
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string }
      const stderr: string = (e?.stderr || e?.message) ?? 'Unknown error'
      const reason = stderr.includes('Access is denied')
        ? 'Access denied — run as administrator'
        : stderr.includes('cannot find') || stderr.includes('does not exist')
          ? 'Key or value no longer exists'
          : stderr.includes('network')
            ? 'Network error'
            : stderr.split(/\r?\n/)[0].substring(0, 120) || 'Unknown error'
      failed++
      failures.push({ issue: entry.issue, reason })
    }
  }

  onProgress?.(total, total, 'Done')
  return { fixed, failed, failures }
}
