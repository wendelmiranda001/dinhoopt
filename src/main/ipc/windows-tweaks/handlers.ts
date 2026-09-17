import { IPC } from '@shared/channels'
import type {
  WindowsTweakApplyProgress,
  WindowsTweakCategory,
  WindowsTweakDef,
  WindowsTweakResult,
  WindowsTweakState,
} from '@shared/types'
import { ipcMain } from 'electron'
import { isAdmin } from '../../services/elevation'
import { execFileAsync, psUtf8 } from '../../services/exec-utf8'
import { getLogger } from '../../services/logger.service'
import type { WindowGetter } from '../index'
import { CONTEXT_MENU_TWEAKS, registerContextMenuTweaks } from './tweaks/context-menu'
import { registerGamingTweaks } from './tweaks/gaming'
import { NETWORK_TWEAKS, registerNetworkTweaks } from './tweaks/network'
import { PERFORMANCE_TWEAKS, registerPerformanceTweaks } from './tweaks/performance'
import { registerSecurityTweaks, SECURITY_TWEAKS } from './tweaks/security'
import { registerSystemTweaks, SYSTEM_TWEAKS } from './tweaks/system'
import { registerVisualTweaks, VISUAL_TWEAKS } from './tweaks/visual'

const TWEAK_CATALOG: WindowsTweakDef[] = [
  ...VISUAL_TWEAKS,
  ...NETWORK_TWEAKS,
  ...PERFORMANCE_TWEAKS,
  ...SECURITY_TWEAKS,
  ...CONTEXT_MENU_TWEAKS,
  ...SYSTEM_TWEAKS,
]

export function getCatalog(): WindowsTweakDef[] {
  return TWEAK_CATALOG
}

export function getCatalogByCategory(cat: WindowsTweakCategory): WindowsTweakDef[] {
  return TWEAK_CATALOG.filter((t) => t.category === cat)
}

async function runPsScript(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psUtf8(script)],
    { timeout: 30000, windowsHide: true },
  )
  return String(stdout)
}

const POWERCFG_TWEAKS = new Set(['pcie-aspm-off', 'usb-selective-suspend-off', 'processor-min-max'])

const POWERCFG_SETTINGS: Record<
  string,
  { subgroup: string; setting: string; applyValue: number; revertValue: number }[]
> = {
  'pcie-aspm-off': [
    {
      subgroup: 'ee19f59b-bb67-4979-a67f-5f16dfc4bcae',
      setting: '0a717a8c-0a10-4e57-9b23-2b0ad0b32ec8',
      applyValue: 0,
      revertValue: 2,
    },
  ],
  'usb-selective-suspend-off': [
    {
      subgroup: '2a737441-1930-4402-8d77-b2bebba308a3',
      setting: '48e6b7a6-50f5-4782-a5d4-53bb8f07e226',
      applyValue: 0,
      revertValue: 1,
    },
  ],
  'processor-min-max': [
    {
      subgroup: '54533251-82be-4824-96c1-47b60b740d00',
      setting: '893dee8e-2bef-41e0-89c6-b55d0929964c',
      applyValue: 100,
      revertValue: 5,
    },
    {
      subgroup: '54533251-82be-4824-96c1-47b60b740d00',
      setting: 'bc5038f7-23e0-4960-96da-33abaf5935ec',
      applyValue: 100,
      revertValue: 100,
    },
  ],
}

async function applyPowerCfgTweak(tweakId: string, action: 'apply' | 'revert'): Promise<void> {
  const settings = POWERCFG_SETTINGS[tweakId]
  if (!settings) throw new Error(`Unknown powercfg tweak: ${tweakId}`)
  const valueKey = action === 'apply' ? 'applyValue' : ('revertValue' as const)
  const basePowerKey = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerSettings'

  const listOut = await execFileAsync('powercfg', ['/LIST'], { timeout: 10000, windowsHide: true })
  const guids = [...String(listOut.stdout).matchAll(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi)].map((m) => m[0])

  const activeOut = await execFileAsync('powercfg', ['/GETACTIVESCHEME'], { timeout: 5000, windowsHide: true })
  const activeGuid = String(activeOut.stdout).match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0]

  for (const s of settings) {
    const val = s[valueKey]
    for (const guid of guids) {
      await execFileAsync('powercfg', ['-setacvalueindex', guid, s.subgroup, s.setting, String(val)], {
        timeout: 10000,
        windowsHide: true,
      })
      await execFileAsync('powercfg', ['-setdcvalueindex', guid, s.subgroup, s.setting, String(val)], {
        timeout: 10000,
        windowsHide: true,
      })
    }
    await execFileAsync(
      'reg',
      [
        'add',
        `${basePowerKey}\\${s.subgroup}\\${s.setting}`,
        '/v',
        'Default',
        '/t',
        'REG_DWORD',
        '/d',
        String(val),
        '/f',
      ],
      { timeout: 10000, windowsHide: true },
    )
  }

  if (activeGuid) {
    await execFileAsync('powercfg', ['/SETACTIVE', activeGuid], { timeout: 10000, windowsHide: true })
  }
}

async function checkPowerCfgTweak(tweakId: string, expectedValue: number): Promise<boolean> {
  const settings = POWERCFG_SETTINGS[tweakId]
  if (!settings || settings.length === 0) return false
  const { stdout: schemeOut } = await execFileAsync('powercfg', ['/GETACTIVESCHEME'], {
    timeout: 10000,
    windowsHide: true,
  })
  const guidMatch = String(schemeOut).match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)
  if (!guidMatch) return false
  const schemeGuid = guidMatch[0]
  for (const s of settings) {
    let stdout: string
    try {
      const result = await execFileAsync('powercfg', ['-query', schemeGuid, s.subgroup, s.setting], {
        timeout: 10000,
        windowsHide: true,
      })
      stdout = String(result.stdout)
    } catch {
      getLogger().warning(
        'windows-tweaks',
        `checkPowerCfgTweak failed for scheme ${schemeGuid}, subgroup ${s.subgroup}, setting ${s.setting}`,
      )
      return false
    }
    const match = stdout.match(/Current AC Power Setting Index: 0x([0-9a-fA-F]+)/i)
    if (!match) return false
    const hex = match[1]
    if (hex === undefined) return false
    if (Number.parseInt(hex, 16) !== expectedValue) return false
  }
  return true
}

async function applyInterfaceTweak(tweak: WindowsTweakDef, field: 'defaultValue' | 'optimizedValue'): Promise<boolean> {
  const val = tweak[field]
  const psVal = typeof val === 'string' ? `'${val.replace(/'/g, "''")}'` : String(val)
  const kind = tweak.kind === 'DWord' ? 'DWord' : 'String'
  const script = `Get-ChildItem "HKLM:\\${tweak.path}" -Name | ForEach-Object { New-ItemProperty -Path "HKLM:\\${tweak.path}\\$_" -Name "${tweak.key}" -Value ${psVal} -PropertyType ${kind} -Force -ErrorAction Stop }`
  await runPsScript(script)
  return true
}

async function checkInterfaceTweakApplied(tweak: WindowsTweakDef): Promise<boolean> {
  const expected = Number(tweak.optimizedValue)
  const script = `$ok = $true; Get-ChildItem "HKLM:\\${tweak.path}" -Name | ForEach-Object { $val = (Get-ItemProperty -Path "HKLM:\\${tweak.path}\\$_" -Name "${tweak.key}" -ErrorAction SilentlyContinue)."${tweak.key}"; if ($val -ne ${expected}) { $ok = $false } }; if ($ok) { Write-Output "OK" }`
  const stdout = await runPsScript(script)
  return stdout.includes('OK')
}

async function applyPolicyTweak(value: number): Promise<boolean> {
  const script = `
    $ErrorActionPreference = 'Stop'
    Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\default\\ApplicationManagement\\AllowGameDVR" -Name "value" -Value ${value} -Type DWord -Force
    Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\PolicyManager\\current\\ApplicationManagement\\AllowGameDVR" -Name "value" -Value ${value} -Type DWord -Force -ErrorAction SilentlyContinue
    gpupdate /target:computer /force 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Error "gpupdate falhou com codigo $LASTEXITCODE"; exit 1 }
  `
  await runPsScript(script)
  return true
}

function tweakRequiresAdmin(tweak: WindowsTweakDef): boolean {
  return tweak.requiresAdmin ?? tweak.hive === 'HKEY_LOCAL_MACHINE'
}

function mapRegError(err: unknown, _tweak: WindowsTweakDef): string {
  const msg = String(err?.toString?.() ?? err ?? '')
  if (/access is denied/i.test(msg) || /accesso negado/i.test(msg)) {
    return 'Acesso negado — execute o DiNho Optimizer como administrador.'
  }
  if (/system cannot find (the path|the file|the registry)/i.test(msg)) {
    return 'Chave de registro não encontrada.'
  }
  if (/incorrect function/i.test(msg)) {
    return 'Tipo de valor inválido para esta chave.'
  }
  return 'Falha ao escrever no registro.'
}

async function applyRegistryTweak(tweak: WindowsTweakDef): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (tweakRequiresAdmin(tweak) && !isAdmin()) {
      return { ok: false, reason: 'Acesso negado — execute o DiNho Optimizer como administrador.' }
    }
    if (tweak.path.includes('\\Interfaces')) {
      await applyInterfaceTweak(tweak, 'optimizedValue')
      return { ok: true }
    }
    if (tweak.id === 'gamedvr-pm') {
      await applyPolicyTweak(Number(tweak.optimizedValue))
      return { ok: true }
    }
    if (POWERCFG_TWEAKS.has(tweak.id)) {
      await applyPowerCfgTweak(tweak.id, 'apply')
      return { ok: true }
    }
    const baseKey = tweak.hive === 'HKEY_LOCAL_MACHINE' ? 'HKLM' : 'HKCU'
    const value = typeof tweak.optimizedValue === 'string' ? tweak.optimizedValue : String(tweak.optimizedValue)
    const type = tweak.kind === 'DWord' ? 'REG_DWORD' : 'REG_SZ'

    await execFileAsync(
      'reg.exe',
      ['add', `${baseKey}\\${tweak.path}`, '/v', tweak.key, '/t', type, '/d', value, '/f'],
      { timeout: 10000, windowsHide: true },
    )

    if (tweak.id === 'ntfs-last-access-off') {
      await execFileAsync('fsutil', ['behavior', 'set', 'disablelastaccess', value], {
        timeout: 10000,
        windowsHide: true,
      })
    }

    return { ok: true }
  } catch (err) {
    getLogger().error('windows-tweaks', `Apply failed: ${tweak.id} — ${mapRegError(err, tweak)}`)
    return { ok: false, reason: mapRegError(err, tweak) }
  }
}

async function revertRegistryTweak(tweak: WindowsTweakDef): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (tweakRequiresAdmin(tweak) && !isAdmin()) {
      return { ok: false, reason: 'Acesso negado — execute o DiNho Optimizer como administrador.' }
    }
    if (tweak.path.includes('\\Interfaces')) {
      await applyInterfaceTweak(tweak, 'defaultValue')
      return { ok: true }
    }
    if (tweak.id === 'gamedvr-pm') {
      await applyPolicyTweak(Number(tweak.defaultValue))
      return { ok: true }
    }
    if (POWERCFG_TWEAKS.has(tweak.id)) {
      await applyPowerCfgTweak(tweak.id, 'revert')
      return { ok: true }
    }
    const baseKey = tweak.hive === 'HKEY_LOCAL_MACHINE' ? 'HKLM' : 'HKCU'
    const value = typeof tweak.defaultValue === 'string' ? tweak.defaultValue : String(tweak.defaultValue)
    const type = tweak.kind === 'DWord' ? 'REG_DWORD' : 'REG_SZ'

    await execFileAsync(
      'reg.exe',
      ['add', `${baseKey}\\${tweak.path}`, '/v', tweak.key, '/t', type, '/d', value, '/f'],
      { timeout: 10000, windowsHide: true },
    )

    if (tweak.id === 'ntfs-last-access-off') {
      await execFileAsync('fsutil', ['behavior', 'set', 'disablelastaccess', value], {
        timeout: 10000,
        windowsHide: true,
      })
    }

    return { ok: true }
  } catch (err) {
    getLogger().error('windows-tweaks', `Revert failed: ${tweak.id} — ${mapRegError(err, tweak)}`)
    return { ok: false, reason: mapRegError(err, tweak) }
  }
}

export const REG_TYPE_RE = /\s+(REG_\w+)\s+(.+)$/

async function checkTweakApplied(tweak: WindowsTweakDef): Promise<boolean> {
  try {
    if (tweak.path.includes('\\Interfaces')) {
      return await checkInterfaceTweakApplied(tweak)
    }
    if (POWERCFG_TWEAKS.has(tweak.id)) {
      return await checkPowerCfgTweak(tweak.id, Number(tweak.optimizedValue))
    }
    const baseKey = tweak.hive === 'HKEY_LOCAL_MACHINE' ? 'HKLM' : 'HKCU'
    const { stdout } = await execFileAsync('reg.exe', ['query', `${baseKey}\\${tweak.path}`, '/v', tweak.key], {
      timeout: 10000,
      windowsHide: true,
    })

    const lines = String(stdout)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const dataLine = lines.find((l) => l.includes(tweak.key))
    if (!dataLine) return false

    const match = dataLine.match(REG_TYPE_RE)
    if (!match) return false
    const valueStr = match[2]
    if (!valueStr) return false
    const trimmedValue = valueStr.trim()

    if (tweak.kind === 'DWord') {
      const actual = trimmedValue.startsWith('0x')
        ? Number.parseInt(trimmedValue, 16)
        : Number.parseInt(trimmedValue, 10)
      return actual === Number(tweak.optimizedValue)
    }
    return trimmedValue === String(tweak.optimizedValue)
  } catch (err) {
    const code = (err as { code?: unknown })?.code
    const stderr = (err as { stderr?: string })?.stderr ?? ''
    const keyNotFound = code === 1 || /unable to find the specified registry/i.test(stderr)
    if (keyNotFound) return false
    getLogger().warning('windows-tweaks', `Check failed: ${tweak.id} — ${err}`)
    return false
  }
}

async function listTweakStatuses(): Promise<WindowsTweakState[]> {
  const statuses = await Promise.all(
    TWEAK_CATALOG.map(async (tweak) => {
      const applied = await checkTweakApplied(tweak)
      return { tweak, applied }
    }),
  )
  return statuses
}

export function registerWindowsTweaksIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.WINDOWS_TWEAKS_LIST, async () => {
    getLogger().info('windows-tweaks', 'Listing tweak statuses')
    return listTweakStatuses()
  })

  ipcMain.handle(IPC.WINDOWS_TWEAKS_APPLY, async (_event, ids: string[]) => {
    getLogger().info('windows-tweaks', `Applying ${ids.length} tweaks`)
    const win = getWindow()
    const selected = TWEAK_CATALOG.filter((t) => ids.includes(t.id))
    let succeeded = 0
    const errors: { id: string; name: string; reason: string }[] = []
    const rebootRequired: { id: string; name: string }[] = []
    const logoffRequired: { id: string; name: string }[] = []

    for (let i = 0; i < selected.length; i++) {
      const tweak = selected[i]
      if (!tweak) continue
      win?.webContents.send(IPC.WINDOWS_TWEAKS_APPLY_PROGRESS, {
        current: i + 1,
        total: selected.length,
        currentTweak: tweak.name,
      } satisfies WindowsTweakApplyProgress)

      const result = await applyRegistryTweak(tweak)
      if (result.ok) {
        succeeded++
        getLogger().success('windows-tweaks', `Tweak applied: ${tweak.id}`)
        if (tweak.needsReboot) rebootRequired.push({ id: tweak.id, name: tweak.name })
        if (tweak.needsLogoff) logoffRequired.push({ id: tweak.id, name: tweak.name })
      } else {
        getLogger().error('windows-tweaks', `Tweak failed: ${tweak.id} — ${result.reason}`)
        errors.push({ id: tweak.id, name: tweak.name, reason: result.reason ?? 'Falha ao escrever no registro.' })
      }
    }

    getLogger().success('windows-tweaks', `Applied ${succeeded}/${selected.length} tweaks (${errors.length} failed)`)
    return { succeeded, failed: errors.length, errors, rebootRequired, logoffRequired } satisfies WindowsTweakResult
  })

  ipcMain.handle(IPC.WINDOWS_TWEAKS_REVERT, async (_event, ids: string[]) => {
    getLogger().info('windows-tweaks', `Reverting ${ids.length} tweaks`)
    const win = getWindow()
    const selected = TWEAK_CATALOG.filter((t) => ids.includes(t.id))
    let succeeded = 0
    const errors: { id: string; name: string; reason: string }[] = []
    const rebootRequired: { id: string; name: string }[] = []
    const logoffRequired: { id: string; name: string }[] = []

    for (let i = 0; i < selected.length; i++) {
      const tweak = selected[i]
      if (!tweak) continue
      win?.webContents.send(IPC.WINDOWS_TWEAKS_REVERT_PROGRESS, {
        current: i + 1,
        total: selected.length,
        currentTweak: tweak.name,
      } satisfies WindowsTweakApplyProgress)

      const result = await revertRegistryTweak(tweak)
      if (result.ok) {
        succeeded++
        getLogger().success('windows-tweaks', `Tweak reverted: ${tweak.id}`)
        if (tweak.needsReboot) rebootRequired.push({ id: tweak.id, name: tweak.name })
        if (tweak.needsLogoff) logoffRequired.push({ id: tweak.id, name: tweak.name })
      } else {
        getLogger().error('windows-tweaks', `Revert failed: ${tweak.id} — ${result.reason}`)
        errors.push({ id: tweak.id, name: tweak.name, reason: result.reason ?? 'Falha ao reverter o registro.' })
      }
    }

    getLogger().success('windows-tweaks', `Reverted ${succeeded}/${selected.length} tweaks (${errors.length} failed)`)
    return { succeeded, failed: errors.length, errors, rebootRequired, logoffRequired } satisfies WindowsTweakResult
  })

  ipcMain.handle(IPC.WINDOWS_TWEAKS_STATUS, async () => {
    getLogger().info('windows-tweaks', 'Status requested via IPC')
    return listTweakStatuses()
  })

  registerVisualTweaks(getWindow)
  registerNetworkTweaks(getWindow)
  registerPerformanceTweaks(getWindow)
  registerSecurityTweaks(getWindow)
  registerContextMenuTweaks(getWindow)
  registerSystemTweaks(getWindow)
  registerGamingTweaks(getWindow)
}
