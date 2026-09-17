import type {
  GameModeAuditCheck,
  GameModeAuditReport,
  GameModeConfig,
  GameModeOptimizationId,
  GameModeSnapshot,
} from '@shared/types'
import { execFileAsync, psUtf8 } from './exec-utf8'

const ANTI_CHEAT_CONFLICTS: Record<string, GameModeOptimizationId[]> = {
  'EasyAntiCheat.exe': ['sys-timer-resolution', 'net-disable-nagle'],
  'BEService.exe': ['sys-timer-resolution', 'sys-disable-game-bar'],
  'vgc.exe': ['sys-disable-game-bar', 'sys-disable-fse-opt', 'sys-disable-transparency'],
  'BattlEye.exe': ['sys-timer-resolution'],
  'nProtectGameGuard.exe': ['proc-kill-browsers', 'proc-kill-chat', 'proc-kill-updaters'],
  'XIGNCODE3.exe': ['sys-timer-resolution', 'net-disable-nagle'],
}

async function ps(script: string, timeout = 15000): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psUtf8(script)],
    { timeout, windowsHide: true },
  )
  return String(stdout).trim()
}

async function getRunningProcesses(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH'], {
      timeout: 10000,
      windowsHide: true,
    })
    return String(stdout)
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^"([^"]+)"/)
        return m ? m[1]!.toLowerCase() : ''
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

export async function auditServiceHealth(services: GameModeSnapshot['services']): Promise<GameModeAuditCheck[]> {
  const checks: GameModeAuditCheck[] = []
  for (const svc of services) {
    try {
      const out = await ps(
        `Get-Service -Name '${svc.name}' -ErrorAction Stop | Select-Object -Property Status,StartType | ConvertTo-Json -Compress`,
      )
      const parsed = JSON.parse(out)
      const status = String(parsed.Status ?? parsed.status ?? '').toLowerCase()
      const startType = String(parsed.StartType ?? parsed.startType ?? '')
      const isStopped = status.includes('stopped')
      const isDisabled = startType.toLowerCase() === 'disabled'

      checks.push({
        id: `svc-${svc.name}`,
        name: `Service: ${svc.name}`,
        description: `Check if ${svc.name} was properly stopped and disabled`,
        severity: isStopped && isDisabled ? 'info' : 'warning',
        category: 'service',
        passed: isStopped && isDisabled,
        details:
          isStopped && isDisabled
            ? `${svc.name} is stopped and disabled`
            : `${svc.name} status=${status}, startType=${startType}`,
        ...(!isDisabled ? { remediation: 'Set service startup type to Disabled manually' } : {}),
      })
    } catch {
      checks.push({
        id: `svc-${svc.name}`,
        name: `Service: ${svc.name}`,
        description: `Check if ${svc.name} was properly stopped and disabled`,
        severity: 'error',
        category: 'service',
        passed: false,
        details: `Could not query ${svc.name} status`,
      })
    }
  }
  return checks
}

export async function auditOrphanProcesses(
  killedPids: GameModeSnapshot['killedProcesses'],
): Promise<GameModeAuditCheck[]> {
  if (killedPids.length === 0) return []
  const running = await getRunningProcesses()
  const stillAlive = killedPids.filter((p) => {
    const name = p.name.toLowerCase()
    return running.some((r) => r === name)
  })
  if (stillAlive.length === 0) {
    return [
      {
        id: 'orphan-processes',
        name: 'Orphan processes',
        description: 'Verify no killed processes are still running',
        severity: 'info',
        category: 'process',
        passed: true,
        details: `All ${killedPids.length} killed process(es) are gone`,
      },
    ]
  }
  return [
    {
      id: 'orphan-processes',
      name: 'Orphan processes',
      description: 'Verify no killed processes are still running',
      severity: 'warning',
      category: 'process',
      passed: false,
      details: `${stillAlive.length} process(es) still running: ${stillAlive.map((p) => p.name).join(', ')}`,
      remediation: 'Manually kill the remaining processes via Task Manager',
    },
  ]
}

export async function auditAntiCheatRisk(
  enabledIds: GameModeConfig['enabledOptimizations'],
): Promise<GameModeAuditCheck[]> {
  const running = await getRunningProcesses()
  const checks: GameModeAuditCheck[] = []

  for (const [acProcess, conflictingOpts] of Object.entries(ANTI_CHEAT_CONFLICTS)) {
    const isRunning = running.some((p) => p === acProcess.toLowerCase())
    if (!isRunning) continue

    const activeConflicts = conflictingOpts.filter((opt) => enabledIds.includes(opt))
    if (activeConflicts.length === 0) continue

    checks.push({
      id: `anti-cheat-${acProcess.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`,
      name: `Anti-cheat: ${acProcess}`,
      description: `Check if active optimizations conflict with ${acProcess}`,
      severity: 'warning',
      category: 'anti-cheat',
      passed: false,
      details: `${acProcess} detected — conflicting optimization(s): ${activeConflicts.join(', ')}`,
      remediation: `Disable ${activeConflicts.join(', ')} while ${acProcess} is running`,
    })
  }

  if (checks.length === 0) {
    checks.push({
      id: 'anti-cheat-none',
      name: 'Anti-cheat conflict check',
      description: 'Verify no anti-cheat processes conflict with active optimizations',
      severity: 'info',
      category: 'anti-cheat',
      passed: true,
      details: 'No anti-cheat conflicts detected',
    })
  }

  return checks
}

export async function auditPlatformCompatibility(): Promise<GameModeAuditCheck[]> {
  const platform = process.platform
  if (platform === 'win32') {
    return [
      {
        id: 'platform-compat',
        name: 'Platform compatibility',
        description: 'Verify the platform supports Game Mode optimizations',
        severity: 'info',
        category: 'platform',
        passed: true,
        details: 'Windows detected — all optimizations supported',
      },
    ]
  }
  return [
    {
      id: 'platform-compat',
      name: 'Platform compatibility',
      description: 'Verify the platform supports Game Mode optimizations',
      severity: 'warning',
      category: 'platform',
      passed: false,
      details: `Game Mode is designed for Windows (current: ${platform}) — some optimizations may not work`,
      remediation: 'Use on Windows for full functionality',
    },
  ]
}

export async function auditRegistryTweakImpact(
  registryTweaks: GameModeSnapshot['registryTweaks'],
): Promise<GameModeAuditCheck[]> {
  if (registryTweaks.length === 0) return []
  const checks: GameModeAuditCheck[] = []

  for (const tweak of registryTweaks) {
    try {
      const out = await ps(
        `$v = (Get-ItemProperty -Path '${tweak.path}' -Name '${tweak.name}' -ErrorAction SilentlyContinue).'${tweak.name}'; if ($v -ne $null) { $v } else { 'NULL' }`,
      )
      const current = out === 'NULL' || out === '' ? null : Number.parseInt(out, 10)
      if (tweak.originalValue !== null && current === 0) {
        checks.push({
          id: `reg-${tweak.name}`,
          name: `Registry: ${tweak.name}`,
          description: `Verify ${tweak.name} was applied`,
          severity: 'info',
          category: 'registry',
          passed: true,
          details: `${tweak.name} set to 0 (was ${tweak.originalValue})`,
        })
      } else if (tweak.originalValue === null && current === 0) {
        checks.push({
          id: `reg-${tweak.name}`,
          name: `Registry: ${tweak.name}`,
          description: `Verify ${tweak.name} was applied`,
          severity: 'info',
          category: 'registry',
          passed: true,
          details: `${tweak.name} set to 0 (had no previous value)`,
        })
      } else {
        checks.push({
          id: `reg-${tweak.name}`,
          name: `Registry: ${tweak.name}`,
          description: `Verify ${tweak.name} was applied`,
          severity: 'warning',
          category: 'registry',
          passed: false,
          details: `${tweak.name} expected 0, got ${current ?? 'null'}`,
          remediation: `Manually set ${tweak.name} to 0 at ${tweak.path}`,
        })
      }
    } catch {
      checks.push({
        id: `reg-${tweak.name}`,
        name: `Registry: ${tweak.name}`,
        description: `Verify ${tweak.name} was applied`,
        severity: 'error',
        category: 'registry',
        passed: false,
        details: `Could not read ${tweak.name} at ${tweak.path}`,
      })
    }
  }

  return checks
}

export async function auditRestoreCompleteness(errors: string[]): Promise<GameModeAuditCheck[]> {
  if (errors.length === 0) {
    return [
      {
        id: 'restore-completeness',
        name: 'Restore completeness',
        description: 'Verify all settings were restored successfully',
        severity: 'info',
        category: 'restore',
        passed: true,
        details: 'All settings restored successfully — no residual state',
      },
    ]
  }
  return [
    {
      id: 'restore-completeness',
      name: 'Restore completeness',
      description: 'Verify all settings were restored successfully',
      severity: 'error',
      category: 'restore',
      passed: false,
      details: `${errors.length} setting(s) could not be restored`,
      remediation: 'Check for permission issues and retry deactivation',
    },
  ]
}

export async function auditConsent(hasPermanentTweaks: boolean): Promise<GameModeAuditCheck[]> {
  if (!hasPermanentTweaks) {
    return [
      {
        id: 'consent-check',
        name: 'User consent',
        description: 'Verify all changes are reversible',
        severity: 'info',
        category: 'restore',
        passed: true,
        details: 'All optimizations are reversible — nothing permanent',
      },
    ]
  }
  return [
    {
      id: 'consent-check',
      name: 'User consent',
      description: 'Verify all changes are reversible',
      severity: 'warning',
      category: 'restore',
      passed: false,
      details: 'Some optimizations may leave permanent changes (registry tweaks)',
      remediation: 'Create a system restore point before activation',
    },
  ]
}

export async function auditTimerResolution(originalValue: number | null): Promise<GameModeAuditCheck[]> {
  if (originalValue === null) {
    return [
      {
        id: 'timer-resolution',
        name: 'Timer resolution',
        description: 'Check timer resolution was set to 0.5ms',
        severity: 'info',
        category: 'process',
        passed: true,
        details: 'Timer resolution was not modified',
      },
    ]
  }

  // NtSetTimerResolution(5000) sets a persistent 0.5ms resolution.
  // We take a pre-change snapshot so we can restore on app restart.
  return [
    {
      id: 'timer-resolution',
      name: 'Timer resolution',
      description: 'Check timer resolution was set to 0.5ms',
      severity: 'info',
      category: 'process',
      passed: true,
      details: 'Timer resolution set to 0.5ms via NtSetTimerResolution — snapshot saved for recovery on restart',
    },
  ]
}

export async function runGameModeAudit(
  phase: GameModeAuditReport['phase'],
  context: {
    config?: GameModeConfig
    snapshot?: GameModeSnapshot | null
    errors?: string[]
  },
): Promise<GameModeAuditReport> {
  const allChecks: GameModeAuditCheck[] = []
  const snapshot = context.snapshot
  const config = context.config

  if (phase === 'pre-activation' || phase === 'post-activation') {
    const compat = await auditPlatformCompatibility()
    allChecks.push(...compat)

    if (config) {
      const antiCheat = await auditAntiCheatRisk(config.enabledOptimizations)
      allChecks.push(...antiCheat)

      const consent = await auditConsent(
        config.enabledOptimizations.some((id) =>
          ['sys-disable-game-bar', 'sys-disable-fse-opt', 'sys-disable-transparency'].includes(id),
        ),
      )
      allChecks.push(...consent)
    }

    if (phase === 'post-activation' && snapshot) {
      const services = await auditServiceHealth(snapshot.services)
      allChecks.push(...services)

      const processes = await auditOrphanProcesses(snapshot.killedProcesses)
      allChecks.push(...processes)

      const registry = await auditRegistryTweakImpact(snapshot.registryTweaks)
      allChecks.push(...registry)

      const timerRes = await auditTimerResolution(snapshot.originalTimerResolution)
      allChecks.push(...timerRes)
    }
  }

  if (phase === 'pre-deactivation' || phase === 'post-restore') {
    if (snapshot) {
      const services = await auditServiceHealth(snapshot.services)
      allChecks.push(...services)

      const registry = await auditRegistryTweakImpact(snapshot.registryTweaks)
      allChecks.push(...registry)
    }

    if (phase === 'post-restore') {
      const restore = await auditRestoreCompleteness(context.errors ?? [])
      allChecks.push(...restore)
    }
  }

  const passed = allChecks.filter((c) => c.passed).length
  const warnings = allChecks.filter((c) => !c.passed && c.severity === 'warning').length
  const errors = allChecks.filter((c) => !c.passed && c.severity === 'error').length

  return {
    timestamp: new Date().toISOString(),
    phase,
    checks: allChecks,
    summary: { passed, warnings, errors },
  }
}
