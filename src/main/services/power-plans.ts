import type {
  PowerPlanActivateResult,
  PowerPlanCreateResult,
  PowerPlanDeleteResult,
  PowerPlanInfo,
} from '@shared/types'
import { execFileAsync, psUtf8 } from './exec-utf8'

const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const SANITIZE_RE = /[^A-Za-z0-9 ._\-()]/g

async function ps(script: string, timeout = 15000): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psUtf8(script)],
    { timeout, windowsHide: true },
  )
  return String(stdout).trim()
}

export async function listPowerPlans(): Promise<PowerPlanInfo[]> {
  const out = await ps(
    `powercfg /LIST | ForEach-Object { if ($_ -match '^.*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}).*\\s(.+)$') { $guid=$matches[1]; $name=$matches[2].Trim(); $isActive=$_ -match '\\*'; $hp=$name -match '(?i)alto desempenho|high performance|máximo|ultimate|desempenho'; $bal=$name -match '(?i)equilibrado|balanced|balan(ç|c)ed'; $ps=$name -match '(?i)economia|power saver|energy|economizer'; [PSCustomObject]@{Guid=$guid;Name=$name;IsActive=$isActive;IsHighPerformance=$hp;IsBalanced=$bal;IsPowerSaver=$ps} } } | ConvertTo-Json -Compress`,
    15000,
  )
  if (!out || out === '[]' || out === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(out)
  } catch {
    return []
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed]
  return arr.map((p: Record<string, unknown>) => ({
    guid: (p.Guid as string) ?? '',
    name: (p.Name as string) ?? 'Unknown',
    description: typeof p.Name === 'string' ? p.Name : '',
    isActive: p.IsActive === true,
    isHighPerformance: p.IsHighPerformance === true,
    isBalanced: p.IsBalanced === true,
    isPowerSaver: p.IsPowerSaver === true,
  }))
}

export async function activatePowerPlan(guid: string): Promise<PowerPlanActivateResult> {
  if (typeof guid !== 'string' || !GUID_RE.test(guid)) {
    return { success: false, error: 'Invalid GUID' }
  }
  try {
    await execFileAsync('powercfg', ['/SETACTIVE', guid], {
      timeout: 10000,
      windowsHide: true,
    })
    return { success: true }
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : 'Failed to activate power plan'
    return { success: false, error: reason }
  }
}

export async function createPowerPlan(name: string): Promise<PowerPlanCreateResult> {
  const sanitized = (name || 'Plano Personalizado').replace(SANITIZE_RE, '').slice(0, 100)
  if (!sanitized) return { success: false, error: 'Invalid plan name' }
  try {
    const out = await ps(`powercfg /DUPLICATESCHEME '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' | Out-String`)
    const guidMatch = out.match(GUID_RE)
    if (!guidMatch) return { success: false, error: 'Failed to create power plan' }
    const newGuid = guidMatch[0]
    await ps(`powercfg /CHANGENAME '${newGuid}' '${sanitized}'`)
    return { success: true, guid: newGuid }
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : 'Failed to create power plan'
    return { success: false, error: reason }
  }
}

export async function deletePowerPlan(guid: string): Promise<PowerPlanDeleteResult> {
  if (typeof guid !== 'string' || !GUID_RE.test(guid)) {
    return { success: false, error: 'Invalid GUID' }
  }
  try {
    await execFileAsync('powercfg', ['/DELETE', guid], {
      timeout: 10000,
      windowsHide: true,
    })
    return { success: true }
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : 'Failed to delete power plan'
    return { success: false, error: reason }
  }
}

export async function getActivePowerPlanGuid(): Promise<string | null> {
  try {
    const out = await ps('powercfg /GETACTIVESCHEME')
    const match = out.match(GUID_RE)
    return match?.[0] ?? null
  } catch {
    return null
  }
}
