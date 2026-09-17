import { randomUUID } from 'node:crypto'
import type { RegistryEntry } from '@shared/types'
import { execFileAsync, psUtf8 } from '../exec-utf8'
import { execReg } from './utils'

export async function scanPerformance(signal?: AbortSignal): Promise<RegistryEntry[]> {
  const entries: RegistryEntry[] = []

  try {
    const { stdout } = await execReg(['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\SysMain', '/v', 'Start'], {
      timeout: 5000,
      ...(signal ? { signal } : {}),
    })
    const match = stdout.match(/Start\s+REG_DWORD\s+0x(\d+)/i)
    if (match && (match[1]! === '2' || match[1]! === '3')) {
      let isSSD = false
      try {
        const diskScript =
          '$disk = Get-PhysicalDisk | Where-Object { $_.DeviceID -eq (Get-Partition -DriveLetter C | Get-Disk).Number }; $disk.MediaType'
        const { stdout: driveInfo } = await execFileAsync(
          'powershell',
          ['-NoProfile', '-Command', psUtf8(diskScript)],
          { timeout: 10000, windowsHide: true },
        )
        isSSD = String(driveInfo).trim().toUpperCase() === 'SSD'
      } catch {
        /* Assume HDD if detection fails */
      }
      if (isSSD) {
        entries.push({
          id: randomUUID(),
          type: 'performance',
          keyPath: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\SysMain',
          valueName: 'Start',
          issue: 'SysMain (Superfetch) is enabled — unnecessary on your SSD, safe to disable',
          risk: 'low',
          selected: true,
          fix: { op: 'set-value', regType: 'REG_DWORD', data: '4' },
        })
      } else {
        entries.push({
          id: randomUUID(),
          type: 'performance',
          keyPath: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\SysMain',
          valueName: 'Start',
          issue: 'SysMain (Superfetch) is enabled — improves performance on HDDs, only disable if you have an SSD',
          risk: 'low',
          selected: false,
          fix: { op: 'set-value', regType: 'REG_DWORD', data: '4' },
        })
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const { stdout } = await execReg(['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Fax', '/v', 'Start'], {
      timeout: 5000,
      ...(signal ? { signal } : {}),
    })
    const match = stdout.match(/Start\s+REG_DWORD\s+0x(\d+)/i)
    if (match && (match[1]! === '2' || match[1]! === '3')) {
      entries.push({
        id: randomUUID(),
        type: 'service',
        keyPath: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Fax',
        valueName: 'Start',
        issue: `Fax service is ${match[1]! === '2' ? 'set to auto-start' : 'enabled'} — unnecessary on most machines`,
        risk: 'low',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '4' },
      })
    }
  } catch {
    /* Skip */
  }

  return entries
}
