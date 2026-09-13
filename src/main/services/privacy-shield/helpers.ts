import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { execNativeUtf8 } from '../exec-utf8'

export interface SettingDef {
  id: string
  category: string
  label: string
  description: string
  requiresAdmin: boolean
  dependsOn?: string
  check: () => Promise<boolean>
  apply: () => Promise<void>
  revert?: () => Promise<void>
  applicable?: () => Promise<boolean>
}

export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))])
}

export async function regQueryDword(key: string, value: string): Promise<number | null> {
  try {
    const { stdout } = await execNativeUtf8('reg', ['query', key, '/v', value], { timeout: 5000, windowsHide: true })
    const match = stdout.match(new RegExp(`${value}\\s+REG_DWORD\\s+0x([0-9a-fA-F]+)`, 'i'))
    return match ? Number.parseInt(match[1]!, 16) : null
  } catch {
    return null
  }
}

export async function regSetDword(key: string, value: string, data: number): Promise<void> {
  await execNativeUtf8('reg', ['add', key, '/v', value, '/t', 'REG_DWORD', '/d', String(data), '/f'], {
    timeout: 5000,
    windowsHide: true,
  })
}

export async function isTaskActive(taskPath: string): Promise<boolean> {
  try {
    const { stdout } = await execNativeUtf8('schtasks', ['/query', '/tn', taskPath, '/xml'], {
      timeout: 8000,
      windowsHide: true,
    })
    const m = stdout.match(/<Settings>[\s\S]*?<Enabled>(true|false)<\/Enabled>[\s\S]*?<\/Settings>/i)
    if (m) return m[1]!.toLowerCase() === 'true'
    return true
  } catch {
    return false
  }
}

export async function taskExists(taskPath: string): Promise<boolean> {
  try {
    await execNativeUtf8('schtasks', ['/query', '/tn', taskPath, '/fo', 'CSV', '/nh'], {
      timeout: 8000,
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}

export async function serviceExists(serviceName: string): Promise<boolean> {
  const val = await regQueryDword(`HKLM\\SYSTEM\\CurrentControlSet\\Services\\${serviceName}`, 'Start')
  return val !== null
}

export async function disableTask(taskPath: string): Promise<void> {
  await execNativeUtf8('schtasks', ['/change', '/tn', taskPath, '/disable'], { timeout: 5000, windowsHide: true })
}

export async function enableTask(taskPath: string): Promise<void> {
  await execNativeUtf8('schtasks', ['/change', '/tn', taskPath, '/enable'], { timeout: 5000, windowsHide: true })
}

function getServiceCachePath(): string {
  const dir = app.isPackaged ? app.getPath('userData') : join(app.getPath('userData'), 'Kudu-Dev')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'service-start-types.json')
}

function loadServiceStartTypes(): Map<string, number> {
  try {
    const raw = readFileSync(getServiceCachePath(), 'utf-8')
    const obj = JSON.parse(raw)
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return new Map(Object.entries(obj).filter(([, v]) => typeof v === 'number') as [string, number][])
    }
  } catch {
    /* file missing or corrupt */
  }
  return new Map()
}

function saveServiceStartTypes(cache: Map<string, number>): void {
  try {
    writeFileSync(getServiceCachePath(), JSON.stringify(Object.fromEntries(cache), null, 2))
  } catch {
    /* best-effort */
  }
}

const originalServiceStartType = loadServiceStartTypes()

const KNOWN_SERVICE_DEFAULTS: Record<string, number> = {
  DiagTrack: 2,
  dmwappushservice: 3,
  MapsBroker: 3,
  AiHost: 3,
}

export async function disableService(serviceName: string): Promise<void> {
  const serviceKey = `HKLM\\SYSTEM\\CurrentControlSet\\Services\\${serviceName}`
  if (!originalServiceStartType.has(serviceName)) {
    const startVal = await regQueryDword(serviceKey, 'Start')
    if (startVal === null) {
      throw new Error(`Service '${serviceName}' does not exist`)
    }
    if (startVal !== 4) {
      originalServiceStartType.set(serviceName, startVal)
      saveServiceStartTypes(originalServiceStartType)
    }
  }
  await execNativeUtf8('reg', ['add', serviceKey, '/v', 'Start', '/t', 'REG_DWORD', '/d', '4', '/f'], {
    timeout: 5000,
    windowsHide: true,
  })
}

export async function enableService(serviceName: string): Promise<void> {
  const serviceKey = `HKLM\\SYSTEM\\CurrentControlSet\\Services\\${serviceName}`
  let original = originalServiceStartType.get(serviceName)
  if (original === undefined) {
    const current = await regQueryDword(serviceKey, 'Start')
    if (current === null) {
      throw new Error(`Service '${serviceName}' does not exist`)
    }
    original = current !== 4 ? current : (KNOWN_SERVICE_DEFAULTS[serviceName] ?? 3)
  }
  await execNativeUtf8('reg', ['add', serviceKey, '/v', 'Start', '/t', 'REG_DWORD', '/d', String(original), '/f'], {
    timeout: 5000,
    windowsHide: true,
  })
  originalServiceStartType.delete(serviceName)
  saveServiceStartTypes(originalServiceStartType)
}

export async function regDeleteValue(key: string, value: string): Promise<void> {
  try {
    await execNativeUtf8('reg', ['delete', key, '/v', value, '/f'], { timeout: 5000, windowsHide: true })
  } catch (err: unknown) {
    try {
      await execNativeUtf8('reg', ['query', key, '/v', value], { timeout: 5000, windowsHide: true })
    } catch {
      return
    }
    throw err
  }
}

export async function isBrowserInstalled(registryKey: string): Promise<boolean> {
  try {
    await execNativeUtf8('reg', ['query', registryKey, '/ve'], { timeout: 5000, windowsHide: true })
    return true
  } catch {
    return false
  }
}

export async function isServiceEnabled(serviceName: string): Promise<boolean> {
  const val = await regQueryDword(`HKLM\\SYSTEM\\CurrentControlSet\\Services\\${serviceName}`, 'Start')
  return val !== null && val !== 4
}
