import { readdir } from 'node:fs/promises'
import { app } from 'electron'
import { CleanerType } from '../../../../shared/enums'
import type { CleanResult, ScanResult } from '../../../../shared/types'
import { getPlatform } from '../../../platform'
import { cleanItems } from '../../../services/file-utils'
import { getCachedItem } from '../../../services/scan-cache'
import type { CliContext } from '../../types'
import { ExitCode } from '../../types'
import { cliLog, cliVerbose, formatBytes, log, showProgress } from '../../utils'

export async function getChromiumProfiles(basePath: string): Promise<string[]> {
  const profiles = ['Default']
  try {
    const entries = await readdir(basePath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('Profile ')) profiles.push(entry.name)
    }
  } catch {
    /* skip */
  }
  return profiles
}

export async function cleanRecycleBin(sizeBytes = 0): Promise<CleanResult> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  try {
    const { psUtf8 } = await import('../../../services/exec-utf8')
    const cleanScript =
      '$shell = New-Object -ComObject Shell.Application; $shell.NameSpace(0x0a).Items() | ForEach-Object { Remove-Item $_.Path -Recurse -Force -ErrorAction SilentlyContinue }; Clear-RecycleBin -Force -Confirm:$false -ErrorAction SilentlyContinue'
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psUtf8(cleanScript)], {
      timeout: 60_000,
      windowsHide: true,
    })
    return { totalCleaned: sizeBytes, filesDeleted: 1, filesSkipped: 0, errors: [], needsElevation: false }
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err)
    return {
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [{ path: 'Recycle Bin', reason }],
      needsElevation: false,
    }
  }
}

export async function cleanDatabasesCli(itemIds: string[]): Promise<CleanResult> {
  const { statSync } = await import('node:fs')
  let Database: new (
    path: string,
    options?: { fileMustExist?: boolean },
  ) => {
    pragma: (key: string, options?: { simple?: boolean }) => unknown
    exec: (sql: string) => unknown
    close: () => void
  }
  try {
    Database = (await import('better-sqlite3')).default
  } catch {
    return { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }
  }
  let totalCleaned = 0
  let filesDeleted = 0
  let filesSkipped = 0
  const errors: CleanResult['errors'] = []

  for (const id of itemIds) {
    const item = getCachedItem(id)
    if (!item) continue
    try {
      const sizeBefore = statSync(item.path).size
      let walSizeBefore = 0
      try {
        walSizeBefore = statSync(`${item.path}-wal`).size
      } catch {
        /* no WAL */
      }
      const db = new Database(item.path, { fileMustExist: true })
      try {
        const journalMode = (db.pragma('journal_mode', { simple: true }) as string).toLowerCase()
        db.exec('VACUUM')
        if (journalMode === 'wal') db.pragma('journal_mode = WAL')
      } finally {
        db.close()
      }
      const sizeAfter = statSync(item.path).size
      let walSizeAfter = 0
      try {
        walSizeAfter = statSync(`${item.path}-wal`).size
      } catch {
        /* no WAL */
      }
      const reclaimed = sizeBefore + walSizeBefore - (sizeAfter + walSizeAfter)
      if (reclaimed > 0) totalCleaned += reclaimed
      filesDeleted++
    } catch (err: unknown) {
      filesSkipped++
      const code = (err as { code?: string }).code
      if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED' || code === 'EBUSY') {
        errors.push({ path: item.path, reason: 'in-use' })
      } else if (code === 'EPERM' || code === 'EACCES') {
        errors.push({ path: item.path, reason: 'permission-denied' })
      } else {
        errors.push({ path: item.path, reason: (err as Error).message || 'unknown error' })
      }
    }
  }
  return {
    totalCleaned,
    filesDeleted,
    filesSkipped,
    errors,
    needsElevation: errors.some((e) => e.reason === 'permission-denied'),
  }
}

export async function runLegacyScanClean(categories: string[], doClean: boolean, ctx: CliContext): Promise<number> {
  const { scanSystem, scanBrowserCli, scanApp, scanGaming, scanRecycleBin, scanDatabaseCli } = await import('./scans')

  const scannerMap: Record<string, () => Promise<ScanResult[]>> = {
    system: scanSystem,
    browser: scanBrowserCli,
    app: scanApp,
    gaming: scanGaming,
    'recycle-bin': scanRecycleBin,
    database: scanDatabaseCli,
  }

  const allResults: ScanResult[] = []
  const scanErrors: Array<{ category: string; error: string }> = []

  cliLog(ctx, `DiNho CLI v${app.getVersion()}`)
  cliLog(ctx, `Scanning: ${categories.join(', ')}`)
  cliLog(ctx, '')

  for (const cat of categories) {
    const scanner = scannerMap[cat]
    if (!scanner) continue
    cliLog(ctx, `Scanning ${cat}...`)
    const startTime = Date.now()
    try {
      const results = await scanner()
      allResults.push(...results)
      cliVerbose(ctx, `${cat} scan took ${Date.now() - startTime}ms, found ${results.length} groups`)
      if (showProgress(ctx)) {
        if (results.length === 0) log('  No items found.')
        else for (const r of results) log(`  ${r.subcategory}: ${r.itemCount} items, ${formatBytes(r.totalSize)}`)
        log('')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      scanErrors.push({ category: cat, error: msg })
      cliLog(ctx, `  Error scanning ${cat}: ${msg}`)
      cliLog(ctx, '')
    }
  }

  const totalItems = allResults.reduce((s, r) => s + r.itemCount, 0)
  const totalSize = allResults.reduce((s, r) => s + r.totalSize, 0)

  let cleanResult: CleanResult | null = null
  if (doClean && totalItems > 0) {
    cliLog(ctx, `Cleaning ${totalItems} items (${formatBytes(totalSize)})...`)
    const hasTrashPath = getPlatform().paths.trashPath() !== null
    const fileItemIds = allResults
      .filter((r) => r.category !== CleanerType.RecycleBin || hasTrashPath)
      .filter((r) => r.category !== CleanerType.Database)
      .flatMap((r) => r.items.map((i) => i.id))
    const dbItemIds = allResults
      .filter((r) => r.category === CleanerType.Database)
      .flatMap((r) => r.items.map((i) => i.id))
    const hasRecycleBin = !hasTrashPath && allResults.some((r) => r.category === CleanerType.RecycleBin)
    let fileCleaned: CleanResult = {
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    }
    let recycleCleaned: CleanResult = {
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    }
    let dbCleaned: CleanResult = {
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    }
    if (fileItemIds.length > 0) fileCleaned = await cleanItems(fileItemIds)
    if (hasRecycleBin) {
      const rbSize = allResults.find((r) => r.category === CleanerType.RecycleBin)?.totalSize || 0
      recycleCleaned = await cleanRecycleBin(rbSize)
    }
    if (dbItemIds.length > 0) dbCleaned = await cleanDatabasesCli(dbItemIds)
    cleanResult = {
      totalCleaned: fileCleaned.totalCleaned + recycleCleaned.totalCleaned + dbCleaned.totalCleaned,
      filesDeleted: fileCleaned.filesDeleted + recycleCleaned.filesDeleted + dbCleaned.filesDeleted,
      filesSkipped: fileCleaned.filesSkipped + recycleCleaned.filesSkipped + dbCleaned.filesSkipped,
      errors: [...fileCleaned.errors, ...recycleCleaned.errors, ...dbCleaned.errors],
      needsElevation: fileCleaned.needsElevation || recycleCleaned.needsElevation || dbCleaned.needsElevation,
    }
    if (showProgress(ctx)) {
      log(`  Deleted: ${cleanResult.filesDeleted} items (${formatBytes(cleanResult.totalCleaned)})`)
      if (cleanResult.filesSkipped > 0) log(`  Skipped: ${cleanResult.filesSkipped} items`)
      if (cleanResult.errors.length > 0) {
        log(`  Errors: ${cleanResult.errors.length}`)
        for (const err of cleanResult.errors.slice(0, 10)) log(`    ${err.path}: ${err.reason}`)
        if (cleanResult.errors.length > 10) log(`    ... and ${cleanResult.errors.length - 10} more`)
      }
      log('')
    }
  }

  if (ctx.json) {
    const output: Record<string, unknown> = {
      scan: {
        categories,
        results: allResults.map((r) => ({
          category: r.category,
          subcategory: r.subcategory,
          group: r.group || null,
          itemCount: r.itemCount,
          totalSize: r.totalSize,
          items: r.items.map((i) => ({ path: i.path, size: i.size, lastModified: i.lastModified })),
        })),
        totalItems,
        totalSize,
        errors: scanErrors.length > 0 ? scanErrors : undefined,
      },
    }
    if (cleanResult) output.clean = cleanResult
    log(JSON.stringify(output, null, 2))
  } else {
    cliLog(ctx, '─'.repeat(50))
    cliLog(ctx, `Total: ${totalItems} items, ${formatBytes(totalSize)}`)
    if (cleanResult) cliLog(ctx, `Cleaned: ${formatBytes(cleanResult.totalCleaned)}`)
    else if (totalItems > 0) cliLog(ctx, 'Run with --clean to delete these items.')
  }

  if (cleanResult?.errors.length) {
    if (cleanResult.needsElevation) return ExitCode.PERMISSION_DENIED
    if (cleanResult.filesDeleted > 0) return ExitCode.PARTIAL_SUCCESS
    return ExitCode.GENERAL_ERROR
  }
  if (totalItems === 0) return ExitCode.NOTHING_FOUND
  return ExitCode.SUCCESS
}
