import { IPC } from '@shared/channels'
import type { GamingTimerStatus } from '@shared/types'
import { ipcMain } from 'electron'
import { execFileAsync } from '../../../services/exec-utf8'
import { getLogger } from '../../../services/logger.service'
import type { WindowGetter } from '../../index'

async function queryBcdEditEnum(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('bcdedit', ['/enum'], {
      timeout: 10000,
      windowsHide: true,
    })
    return String(stdout)
  } catch {
    return ''
  }
}

function parseBcdValue(output: string, key: string): string | null {
  const regex = new RegExp(`^\\s*${key}\\s+(.+?)\\s*$`, 'im')
  const match = output.match(regex)
  return match?.[1]?.trim() ?? null
}

async function getTimerStatus(): Promise<GamingTimerStatus> {
  try {
    const [bcdOut, tuningOut] = await Promise.all([
      queryBcdEditEnum(),
      execFileAsync('netsh', ['int', 'tcp', 'show', 'global'], { timeout: 10000, windowsHide: true })
        .then((r) => String(r.stdout))
        .catch(() => ''),
    ])

    const hpetValue = parseBcdValue(bcdOut, 'useplatformclock')
    const hpetOff = hpetValue !== null ? /No/i.test(hpetValue) : false

    const tickValue = parseBcdValue(bcdOut, 'disabledynamictick')
    const dynamicTickDisabled = tickValue !== null ? /Yes/i.test(tickValue) : false

    const tscValue = parseBcdValue(bcdOut, 'tscsyncpolicy')
    let tscSyncPolicy: GamingTimerStatus['tscSyncPolicy'] = 'default'
    if (tscValue) {
      if (/legacy/i.test(tscValue)) tscSyncPolicy = 'legacy'
      else if (/enhanced/i.test(tscValue)) tscSyncPolicy = 'enhanced'
    }

    const autoTuningDisabled = /disabled/i.test(tuningOut) && !/normal/i.test(tuningOut)

    return { hpetOff, tscSyncPolicy, dynamicTickDisabled, autoTuningDisabled }
  } catch (err) {
    getLogger().error('windows-tweaks', `getTimerStatus failed: ${err}`)
    return { hpetOff: false, tscSyncPolicy: 'default', dynamicTickDisabled: false, autoTuningDisabled: false }
  }
}

async function setHpetOff(off: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    if (off) {
      await execFileAsync('bcdedit', ['/set', 'useplatformclock', 'false'], {
        timeout: 10000,
        windowsHide: true,
      })
    } else {
      await execFileAsync('bcdedit', ['/deletevalue', 'useplatformclock'], {
        timeout: 10000,
        windowsHide: true,
      }).catch(() => {
        // Value may not exist — that's fine, it means default (TSC)
      })
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

async function setTscSyncPolicy(
  policy: 'legacy' | 'enhanced' | 'default',
): Promise<{ success: boolean; error?: string }> {
  try {
    if (policy === 'default') {
      await execFileAsync('bcdedit', ['/deletevalue', 'tscsyncpolicy'], {
        timeout: 10000,
        windowsHide: true,
      }).catch(() => {})
    } else {
      await execFileAsync('bcdedit', ['/set', 'tscsyncpolicy', policy], {
        timeout: 10000,
        windowsHide: true,
      })
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

async function setDynamicTick(disabled: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    if (disabled) {
      await execFileAsync('bcdedit', ['/set', 'disabledynamictick', 'yes'], {
        timeout: 10000,
        windowsHide: true,
      })
    } else {
      await execFileAsync('bcdedit', ['/deletevalue', 'disabledynamictick'], {
        timeout: 10000,
        windowsHide: true,
      }).catch(() => {})
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

async function setAutoTuning(disabled: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    const level = disabled ? 'disabled' : 'normal'
    await execFileAsync('netsh', ['int', 'tcp', 'set', 'global', `autotuninglevel=${level}`], {
      timeout: 10000,
      windowsHide: true,
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

// ─── VBS (Virtualization-Based Security) ────────────────────────

async function getVbsStatus(): Promise<{ enabled: boolean; requirePlatformSecurity: number }> {
  try {
    const { stdout } = await execFileAsync(
      'reg.exe',
      ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard', '/v', 'EnableVirtualizationBasedSecurity'],
      { timeout: 10000, windowsHide: true },
    )
    const enabledMatch = String(stdout).match(/EnableVirtualizationBasedSecurity\s+REG_DWORD\s+0x([0-9a-fA-F]+)/i)
    const enabled = enabledMatch ? Number.parseInt(enabledMatch[1] ?? '0', 16) !== 0 : true

    const { stdout: pfsOut } = await execFileAsync(
      'reg.exe',
      ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard', '/v', 'RequirePlatformSecurityFeatures'],
      { timeout: 10000, windowsHide: true },
    )
    const pfsMatch = String(pfsOut).match(/RequirePlatformSecurityFeatures\s+REG_DWORD\s+0x([0-9a-fA-F]+)/i)
    const requirePlatformSecurity = pfsMatch ? Number.parseInt(pfsMatch[1] ?? '1', 16) : 1

    return { enabled, requirePlatformSecurity }
  } catch {
    return { enabled: true, requirePlatformSecurity: 1 }
  }
}

async function setVbsEnabled(enabled: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    const val = enabled ? 1 : 0
    await execFileAsync(
      'reg.exe',
      [
        'add',
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard',
        '/v',
        'EnableVirtualizationBasedSecurity',
        '/t',
        'REG_DWORD',
        '/d',
        String(val),
        '/f',
      ],
      { timeout: 10000, windowsHide: true },
    )
    await execFileAsync(
      'reg.exe',
      [
        'add',
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard',
        '/v',
        'RequirePlatformSecurityFeatures',
        '/t',
        'REG_DWORD',
        '/d',
        String(enabled ? 1 : 0),
        '/f',
      ],
      { timeout: 10000, windowsHide: true },
    )
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

// ─── HAGS (Hardware-Accelerated GPU Scheduling) ─────────────────

async function getHagsStatus(): Promise<{ enabled: boolean }> {
  try {
    const { stdout } = await execFileAsync(
      'reg.exe',
      ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', '/v', 'HwSchMode'],
      { timeout: 10000, windowsHide: true },
    )
    const match = String(stdout).match(/HwSchMode\s+REG_DWORD\s+0x([0-9a-fA-F]+)/i)
    const enabled = match ? Number.parseInt(match[1] ?? '0', 16) === 2 : true
    return { enabled }
  } catch {
    return { enabled: true }
  }
}

async function setHagsEnabled(enabled: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    const val = enabled ? 2 : 1
    await execFileAsync(
      'reg.exe',
      [
        'add',
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers',
        '/v',
        'HwSchMode',
        '/t',
        'REG_DWORD',
        '/d',
        String(val),
        '/f',
      ],
      { timeout: 10000, windowsHide: true },
    )
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export function registerGamingTweaks(_getWindow: WindowGetter): void {
  getLogger().info('windows-tweaks', 'Registering gaming/timer tweak handlers')

  ipcMain.handle(IPC.WINDOWS_TWEAKS_GAMING_TIMER_GET, async (): Promise<GamingTimerStatus> => {
    getLogger().info('windows-tweaks', 'Gaming timer status requested')
    return getTimerStatus()
  })

  ipcMain.handle(
    IPC.WINDOWS_TWEAKS_GAMING_TIMER_SET,
    async (
      _event,
      settings: Partial<Pick<GamingTimerStatus, 'hpetOff' | 'tscSyncPolicy' | 'dynamicTickDisabled'>>,
    ): Promise<{ success: boolean; errors: string[] }> => {
      getLogger().info('windows-tweaks', `Gaming timer set: ${JSON.stringify(settings)}`)
      const errors: string[] = []

      if (settings.hpetOff !== undefined) {
        const r = await setHpetOff(settings.hpetOff)
        if (!r.success) errors.push(`HPET: ${r.error}`)
      }
      if (settings.tscSyncPolicy !== undefined) {
        const r = await setTscSyncPolicy(settings.tscSyncPolicy)
        if (!r.success) errors.push(`TSC Sync: ${r.error}`)
      }
      if (settings.dynamicTickDisabled !== undefined) {
        const r = await setDynamicTick(settings.dynamicTickDisabled)
        if (!r.success) errors.push(`Dynamic Tick: ${r.error}`)
      }

      if (errors.length > 0) {
        getLogger().error('windows-tweaks', `Gaming timer errors: ${errors.join('; ')}`)
        return { success: false, errors }
      }
      getLogger().success('windows-tweaks', 'Gaming timer settings applied')
      return { success: true, errors: [] }
    },
  )

  ipcMain.handle(IPC.WINDOWS_TWEAKS_GAMING_TIMER_REVERT, async (): Promise<{ success: boolean; errors: string[] }> => {
    getLogger().info('windows-tweaks', 'Gaming timer revert requested')
    const errors: string[] = []

    const r1 = await setHpetOff(false)
    if (!r1.success) errors.push(`HPET revert: ${r1.error}`)

    const r2 = await setTscSyncPolicy('default')
    if (!r2.success) errors.push(`TSC Sync revert: ${r2.error}`)

    const r3 = await setDynamicTick(false)
    if (!r3.success) errors.push(`Dynamic Tick revert: ${r3.error}`)

    const r4 = await setAutoTuning(false)
    if (!r4.success) errors.push(`TCP AutoTuning revert: ${r4.error}`)

    if (errors.length > 0) {
      getLogger().error('windows-tweaks', `Gaming timer revert errors: ${errors.join('; ')}`)
      return { success: false, errors }
    }
    getLogger().success('windows-tweaks', 'Gaming timer reverted to defaults')
    return { success: true, errors: [] }
  })

  ipcMain.handle(
    IPC.WINDOWS_TWEAKS_GAMING_AUTOTUNING,
    async (_event, action: 'apply' | 'revert'): Promise<{ success: boolean; error?: string }> => {
      getLogger().info('windows-tweaks', `AutoTuning ${action}`)
      return setAutoTuning(action === 'apply')
    },
  )

  ipcMain.handle(IPC.WINDOWS_TWEAKS_GAMING_VBS_GET, async (): Promise<{ enabled: boolean }> => {
    getLogger().info('windows-tweaks', 'VBS status requested')
    return getVbsStatus()
  })

  ipcMain.handle(
    IPC.WINDOWS_TWEAKS_GAMING_VBS_SET,
    async (_event, enabled: boolean): Promise<{ success: boolean; error?: string }> => {
      getLogger().info('windows-tweaks', `VBS set: ${enabled}`)
      return setVbsEnabled(enabled)
    },
  )

  ipcMain.handle(IPC.WINDOWS_TWEAKS_GAMING_HAGS_GET, async (): Promise<{ enabled: boolean }> => {
    getLogger().info('windows-tweaks', 'HAGS status requested')
    return getHagsStatus()
  })

  ipcMain.handle(
    IPC.WINDOWS_TWEAKS_GAMING_HAGS_SET,
    async (_event, enabled: boolean): Promise<{ success: boolean; error?: string }> => {
      getLogger().info('windows-tweaks', `HAGS set: ${enabled}`)
      return setHagsEnabled(enabled)
    },
  )
}
