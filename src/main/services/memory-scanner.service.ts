import { execSync } from 'node:child_process'
import { getLogger } from './logger.service'

export interface ProcessInfo {
  pid: number
  name: string
  path: string
  cpu: number
  memory: number
  suspicious: boolean
  reason?: string
}

export interface MemoryScanResult {
  processes: ProcessInfo[]
  suspiciousCount: number
  timestamp: string
}

/** tasklist memory column reports kilobytes; 500 MB is the high-memory threshold. */
const HIGH_MEMORY_MB = 500
const TASKLIST_TIMEOUT_MS = 5_000

const SUSPICIOUS_PATTERNS = [
  {
    name: 'Process Hollowing',
    check: (p: ProcessInfo) => p.name === 'svchost.exe' && p.path?.toLowerCase().includes('temp'),
  },
  {
    name: 'Run from Temp',
    check: (p: ProcessInfo) => p.path?.toLowerCase().includes('\\temp\\') || p.path?.toLowerCase().includes('\\tmp\\'),
  },
  {
    name: 'Unsigned DLL Host',
    check: (p: ProcessInfo) => ['rundll32.exe', 'regsvr32.exe', 'mshta.exe'].includes(p.name),
  },
  {
    name: 'High Memory Usage',
    check: (p: ProcessInfo) =>
      p.memory > HIGH_MEMORY_MB &&
      !['chrome.exe', 'msedge.exe', 'firefox.exe', 'Code.exe', 'explorer.exe'].includes(p.name),
  },
  {
    name: 'Suspicious Parent',
    check: (p: ProcessInfo) =>
      p.name === 'powershell.exe' || p.name === 'cmd.exe' || p.name === 'wscript.exe' || p.name === 'cscript.exe',
  },
]

export function scanMemory(): MemoryScanResult {
  const processes = getProcessList()
  const scanned = processes.map((p) => {
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.check(p)) {
        return { ...p, suspicious: true, reason: pattern.name }
      }
    }
    return { ...p, suspicious: false }
  })
  return {
    processes: scanned,
    suspiciousCount: scanned.filter((p) => p.suspicious).length,
    timestamp: new Date().toISOString(),
  }
}

function getProcessList(): ProcessInfo[] {
  try {
    const output = execSync('tasklist /FO CSV /NH', { encoding: 'utf-8', timeout: TASKLIST_TIMEOUT_MS })
    const lines = output.trim().split('\n').filter(Boolean)
    return lines.map((line) => {
      const parts = parseCsvLine(line)
      const memStr = parts[parts.length - 1] || '0'
      const memNum = Number.parseFloat(memStr) / 1024
      return {
        pid: Number.parseInt(parts[1] || '0', 10),
        name: parts[0].trim() || 'unknown',
        path: '',
        cpu: 0,
        memory: Math.round(memNum * 100) / 100,
        suspicious: false,
      }
    })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    getLogger().warning(
      'memory-scanner',
      `tasklist failed${code === 'ETIMEDOUT' ? ' (timed out)' : ''}: ${String(err)}`,
    )
    return []
  }
}

/**
 * Split a tasklist `/FO CSV /NH` line into its quoted fields. Image names may
 * themselves contain commas (e.g. "chrome, dev.exe"), so a naive `replace(/"/g,'')
 * .split(',')` corrupts both the name and every positional column after it.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        field += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  fields.push(field)
  return fields.map((f) => f.trim())
}
