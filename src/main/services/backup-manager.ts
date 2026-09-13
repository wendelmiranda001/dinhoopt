import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { getBackupDir } from './backup-dir'
import { getLogger } from './logger.service'

let backupDir: string

export function initBackupManager(): void {
  backupDir = getBackupDir()
  mkdirSync(backupDir, { recursive: true })
}

export function backupFile(sourcePath: string): string | null {
  if (!existsSync(sourcePath)) return null
  try {
    const timestamp = Date.now()
    const name = sourcePath.replace(/[\\/]/g, '_').replace(/:/g, '')
    const backupPath = join(backupDir, `${name}_${timestamp}.bak`)
    writeFileSync(backupPath, readFileSync(sourcePath))
    getLogger().info('backup-manager', `Backed up ${basename(sourcePath)} → ${basename(backupPath)}`)
    return backupPath
  } catch (err) {
    getLogger().warning('backup-manager', `Backup failed for ${sourcePath}: ${err}`)
    return null
  }
}

export function getLatestBackup(sourcePath: string): string | null {
  if (!backupDir || !existsSync(backupDir)) return null
  try {
    const prefix = sourcePath.replace(/[\\/]/g, '_').replace(/:/g, '')
    const files = readdirSync(backupDir)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.bak'))
      .filter((f) => {
        try {
          const st = statSync(join(backupDir, f))
          return st.size > 0
        } catch {
          // Corrupt / unreadable backup — skip it when resolving the latest.
          return false
        }
      })
      .sort()
    return files.length > 0 ? join(backupDir, files[files.length - 1]!) : null
  } catch {
    return null
  }
}
