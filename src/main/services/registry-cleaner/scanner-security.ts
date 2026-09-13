import { randomUUID } from 'node:crypto'
import type { RegistryEntry } from '@shared/types'
import { getLogger } from '../logger.service'
import { execReg } from './utils'

function errorMessage(err: unknown): string {
  const e = err as { stderr?: string; message?: string }
  return e?.stderr ? e.stderr.trim().split(/\r?\n/)[0]! : (e?.message ?? 'unknown error')
}

export async function scanSecurity(signal?: AbortSignal): Promise<RegistryEntry[]> {
  const entries: RegistryEntry[] = []

  try {
    const { stdout } = await execReg(
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', '/v', 'EnableLUA'],
      { timeout: 5000, ...(signal ? { signal } : {}) },
    )
    const match = stdout.match(/EnableLUA\s+REG_DWORD\s+0x(\d+)/i)
    if (match && match[1]! === '0') {
      entries.push({
        id: randomUUID(),
        type: 'vulnerability',
        keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System',
        valueName: 'EnableLUA',
        issue: 'User Account Control (UAC) is disabled — malware can run with admin privileges silently',
        risk: 'high',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '1' },
      })
    }
  } catch {
    /* Skip */
  }

  try {
    const { stdout } = await execReg(
      [
        'query',
        'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Real-Time Protection',
        '/v',
        'DisableRealtimeMonitoring',
      ],
      { timeout: 5000, ...(signal ? { signal } : {}) },
    )
    const match = stdout.match(/DisableRealtimeMonitoring\s+REG_DWORD\s+0x(\d+)/i)
    if (match && match[1]! === '1') {
      entries.push({
        id: randomUUID(),
        type: 'vulnerability',
        keyPath: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Real-Time Protection',
        valueName: 'DisableRealtimeMonitoring',
        issue: 'Windows Defender real-time protection is disabled via policy',
        risk: 'high',
        selected: true,
        fix: { op: 'delete-value' },
      })
    }
  } catch {
    /* Skip */
  }

  try {
    const { stdout } = await execReg(
      ['query', 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender', '/v', 'DisableAntiSpyware'],
      { timeout: 5000, ...(signal ? { signal } : {}) },
    )
    const match = stdout.match(/DisableAntiSpyware\s+REG_DWORD\s+0x(\d+)/i)
    if (match && match[1]! === '1') {
      entries.push({
        id: randomUUID(),
        type: 'vulnerability',
        keyPath: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender',
        valueName: 'DisableAntiSpyware',
        issue: 'Windows Defender antivirus is completely disabled via policy',
        risk: 'high',
        selected: true,
        fix: { op: 'delete-value' },
      })
    }
  } catch {
    /* Skip */
  }

  try {
    const { stdout } = await execReg(
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer', '/v', 'NoDriveTypeAutoRun'],
      { timeout: 5000, ...(signal ? { signal } : {}) },
    )
    const match = stdout.match(/NoDriveTypeAutoRun\s+REG_DWORD\s+0x([0-9a-fA-F]+)/i)
    if (!match || Number.parseInt(match[1]!, 16) < 0xff) {
      entries.push({
        id: randomUUID(),
        type: 'vulnerability',
        keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer',
        valueName: 'NoDriveTypeAutoRun',
        issue: 'AutoRun is not fully disabled — removable drives can auto-execute malware',
        risk: 'medium',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '255' },
      })
    }
  } catch (err: unknown) {
    if (signal?.aborted) throw new Error('Operation cancelled')
    getLogger().warning('registry-scanner', `Failed to query AutoRun policy: ${errorMessage(err)}`)
    entries.push({
      id: randomUUID(),
      type: 'vulnerability',
      keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer',
      valueName: 'NoDriveTypeAutoRun',
      issue: 'AutoRun is not disabled — removable drives can auto-execute malware',
      risk: 'medium',
      selected: true,
      fix: { op: 'set-value', regType: 'REG_DWORD', data: '255' },
    })
  }

  try {
    const { stdout } = await execReg(
      ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters', '/v', 'SMB1'],
      { timeout: 5000, ...(signal ? { signal } : {}) },
    )
    const match = stdout.match(/SMB1\s+REG_DWORD\s+0x(\d+)/i)
    if (match && match[1]! !== '0') {
      entries.push({
        id: randomUUID(),
        type: 'vulnerability',
        keyPath: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters',
        valueName: 'SMB1',
        issue: 'SMBv1 protocol is enabled — vulnerable to WannaCry and EternalBlue exploits',
        risk: 'high',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '0' },
      })
    }
  } catch {
    /* Skip */
  }

  try {
    const { stdout: rdpEnabled } = await execReg(
      ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server', '/v', 'fDenyTSConnections'],
      { timeout: 5000, ...(signal ? { signal } : {}) },
    )
    const rdpMatch = rdpEnabled.match(/fDenyTSConnections\s+REG_DWORD\s+0x(\d+)/i)
    if (rdpMatch && rdpMatch[1] === '0') {
      try {
        const rdpNlaKey = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp'
        const { stdout: nlaOut } = await execReg(['query', rdpNlaKey, '/v', 'UserAuthentication'], {
          timeout: 5000,
          ...(signal ? { signal } : {}),
        })
        const nlaMatch = nlaOut.match(/UserAuthentication\s+REG_DWORD\s+0x(\d+)/i)
        if (!nlaMatch || nlaMatch[1] === '0') {
          entries.push({
            id: randomUUID(),
            type: 'vulnerability',
            keyPath: rdpNlaKey,
            valueName: 'UserAuthentication',
            issue: 'Remote Desktop is enabled without Network Level Authentication (NLA)',
            risk: 'high',
            selected: true,
            fix: { op: 'set-value', regType: 'REG_DWORD', data: '1' },
          })
        }
      } catch {
        /* Skip */
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const { stdout } = await execReg(
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\PowerShell\\1\\ShellIds\\Microsoft.PowerShell', '/v', 'ExecutionPolicy'],
      { timeout: 5000, ...(signal ? { signal } : {}) },
    )
    const match = stdout.match(/ExecutionPolicy\s+REG_SZ\s+(.+)/i)
    if (match) {
      const policy = match[1]!.trim().toLowerCase()
      if (policy === 'unrestricted' || policy === 'bypass') {
        entries.push({
          id: randomUUID(),
          type: 'vulnerability',
          keyPath: 'HKLM\\SOFTWARE\\Microsoft\\PowerShell\\1\\ShellIds\\Microsoft.PowerShell',
          valueName: 'ExecutionPolicy',
          issue: `PowerShell execution policy is "${match[1]!.trim()}" — scripts from any source can run`,
          risk: 'medium',
          selected: true,
          fix: { op: 'set-value', regType: 'REG_SZ', data: 'RemoteSigned' },
        })
      }
    }
  } catch {
    /* Skip */
  }

  const fwProfiles = [
    { key: 'DomainProfile', label: 'Domain' },
    { key: 'StandardProfile', label: 'Private' },
    { key: 'PublicProfile', label: 'Public' },
  ]
  for (const profile of fwProfiles) {
    try {
      const fwKey = `HKLM\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\${profile.key}`
      const { stdout } = await execReg(['query', fwKey, '/v', 'EnableFirewall'], {
        timeout: 5000,
        ...(signal ? { signal } : {}),
      })
      const match = stdout.match(/EnableFirewall\s+REG_DWORD\s+0x(\d+)/i)
      if (match && match[1]! === '0') {
        entries.push({
          id: randomUUID(),
          type: 'vulnerability',
          keyPath: fwKey,
          valueName: 'EnableFirewall',
          issue: `Windows Firewall is disabled for ${profile.label} network profile`,
          risk: 'high',
          selected: true,
          fix: { op: 'set-value', regType: 'REG_DWORD', data: '1' },
        })
      }
    } catch {
      /* Skip */
    }
  }

  try {
    const { stdout } = await execReg(
      ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\RemoteRegistry', '/v', 'Start'],
      { timeout: 5000, ...(signal ? { signal } : {}) },
    )
    const match = stdout.match(/Start\s+REG_DWORD\s+0x(\d+)/i)
    if (match && (match[1]! === '2' || match[1]! === '3')) {
      entries.push({
        id: randomUUID(),
        type: 'vulnerability',
        keyPath: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\RemoteRegistry',
        valueName: 'Start',
        issue: `Remote Registry service is ${match[1]! === '2' ? 'set to auto-start' : 'enabled'} — allows remote registry access`,
        risk: 'medium',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '4' },
      })
    }
  } catch {
    /* Skip */
  }

  return entries
}
