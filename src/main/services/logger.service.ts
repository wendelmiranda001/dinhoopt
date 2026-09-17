import { appendFile, mkdir, readdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { LogConfig, LogEntry, LogFilter, LogLevel, LogsListResult } from '@shared/types'
import { app } from 'electron'

const DEFAULT_RETENTION_DAYS = 7
const PAGE_SIZE = 50

function resolveLogDir(): string {
  try {
    return join(app.getPath('userData'), 'logs')
  } catch {
    return join(process.cwd(), 'logs')
  }
}

function localTimestamp(): string {
  const d = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

function localDate(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

class LoggerService {
  private logDir: string
  private retentionDays: number
  private currentDate: string
  private _ready: Promise<void>

  constructor() {
    this.retentionDays = DEFAULT_RETENTION_DAYS
    this.currentDate = localDate()
    this.logDir = resolveLogDir()
    this._ready = this.init()
  }

  async ready(): Promise<void> {
    await this._ready
  }

  private async init(): Promise<void> {
    try {
      await mkdir(this.logDir, { recursive: true })
    } catch {
      // directory already exists
    }
    await this.cleanup()
  }

  private logFilePath(date: string): string {
    return join(this.logDir, `${date}.jsonl`)
  }

  async log(level: LogLevel, module: string, message: string, details?: string): Promise<void> {
    await this._ready
    const entry: LogEntry = {
      timestamp: localTimestamp(),
      level,
      module,
      message,
      ...(details ? { details } : {}),
    }
    const line = `${JSON.stringify(entry)}\n`
    try {
      await appendFile(this.logFilePath(this.currentDate), line, 'utf-8')
    } catch {
      try {
        await mkdir(this.logDir, { recursive: true })
        await appendFile(this.logFilePath(this.currentDate), line, 'utf-8')
      } catch {
        // fs/promises mocked or unavailable — skip
      }
    }
  }

  async info(module: string, message: string, details?: string): Promise<void> {
    return this.log('info', module, message, details)
  }

  async debug(module: string, message: string, details?: string): Promise<void> {
    return this.log('debug', module, message, details)
  }

  async success(module: string, message: string, details?: string): Promise<void> {
    return this.log('success', module, message, details)
  }

  async warning(module: string, message: string, details?: string): Promise<void> {
    return this.log('warning', module, message, details)
  }

  async error(module: string, message: string, details?: string): Promise<void> {
    return this.log('error', module, message, details)
  }

  async list(filter?: LogFilter, page = 1, pageSize = PAGE_SIZE): Promise<LogsListResult> {
    await this._ready
    const files = await this.listLogFiles()
    if (files.length === 0) {
      return { entries: [], total: 0, page, pageSize }
    }

    const allEntries: LogEntry[] = []
    for (const file of files) {
      let content = ''
      try {
        content = await readFile(join(this.logDir, file), 'utf-8')
      } catch {
        /* skip */
      }
      const lines = content.split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as LogEntry
          if (!this.isLogEntry(entry)) continue
          if (this.matchesFilter(entry, filter)) {
            allEntries.push(entry)
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    allEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    const total = allEntries.length
    const start = (page - 1) * pageSize
    const entries = allEntries.slice(start, start + pageSize)
    return { entries, total, page, pageSize }
  }

  async exportAsText(filter?: LogFilter): Promise<string> {
    await this._ready
    const result = await this.list(filter, 1, 1_000_000)
    return result.entries
      .map((e) => {
        const ts = e.timestamp.slice(0, 19).replace('T', ' ')
        const tag = e.level.toUpperCase().padEnd(7)
        return `[${ts}] ${tag} [${e.module}] ${e.message}${e.details ? ` \u2014 ${e.details}` : ''}`
      })
      .join('\n')
  }

  async clear(): Promise<void> {
    await this._ready
    const files = await this.listLogFiles()
    for (const file of files) {
      try {
        await unlink(join(this.logDir, file))
      } catch {
        /* skip */
      }
    }
  }

  async getConfig(): Promise<LogConfig> {
    return { retentionDays: this.retentionDays }
  }

  async setConfig(config: LogConfig): Promise<void> {
    this.retentionDays = Math.max(1, Math.min(365, config.retentionDays))
    await this._ready
    await this.cleanup()
  }

  private async listLogFiles(): Promise<string[]> {
    try {
      const files = await readdir(this.logDir)
      return (files ?? []).filter((f) => f.endsWith('.jsonl')).sort()
    } catch {
      return []
    }
  }

  private async cleanup(): Promise<void> {
    const files = await this.listLogFiles()
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - this.retentionDays)
    for (const file of files) {
      const dateStr = file.slice(0, 10)
      const fileDate = new Date(`${dateStr}T00:00:00Z`)
      if (fileDate < cutoff) {
        try {
          await unlink(join(this.logDir, file))
        } catch {
          /* skip */
        }
      }
    }
  }

  private isLogEntry(value: unknown): value is LogEntry {
    if (typeof value !== 'object' || value === null) return false
    const v = value as Record<string, unknown>
    return (
      typeof v.timestamp === 'string' &&
      typeof v.level === 'string' &&
      typeof v.module === 'string' &&
      typeof v.message === 'string'
    )
  }

  private matchesFilter(entry: LogEntry, filter?: LogFilter): boolean {
    if (!filter) return true
    if (filter.level && entry.level !== filter.level) return false
    if (filter.module && entry.module !== filter.module) return false
    if (filter.search) {
      const q = filter.search.toLowerCase()
      if (
        !entry.message.toLowerCase().includes(q) &&
        !entry.module.toLowerCase().includes(q) &&
        !entry.details?.toLowerCase().includes(q)
      ) {
        return false
      }
    }
    return true
  }
}

let instance: LoggerService | null = null

export function getLogger(): LoggerService {
  if (!instance) {
    instance = new LoggerService()
  }
  return instance
}

export function resetLoggerForTest(): void {
  instance = null
}
