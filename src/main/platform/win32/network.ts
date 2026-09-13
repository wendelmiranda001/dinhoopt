import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { execNativeUtf8, psUtf8 } from '../../services/exec-utf8'
import type { ActiveConnection, DnsCacheEntry, PlatformNetwork, WifiProfile } from '../types'

const execFileAsync = promisify(execFile)

const LOOPBACK = new Set(['127.0.0.1', '::1', '0.0.0.0', '::'])

export function createWin32Network(): PlatformNetwork {
  return {
    async getEstablishedConnections(): Promise<ActiveConnection[]> {
      try {
        // Use native netstat instead of PowerShell — starts instantly, uses ~1MB
        // vs PowerShell's ~80MB and 2-5s startup. This runs every 30s.
        const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'tcp'], { timeout: 15_000, windowsHide: true })

        const results: ActiveConnection[] = []
        for (const line of stdout.split('\n')) {
          // Lines look like: "  TCP    10.0.0.5:45678     93.184.216.34:443  ESTABLISHED     1234"
          const trimmed = line.trim()
          if (!trimmed.startsWith('TCP')) continue
          if (!trimmed.includes('ESTABLISHED')) continue

          const cols = trimmed.split(/\s+/)
          // cols: [TCP, localAddr, foreignAddr, ESTABLISHED, PID]
          if (cols.length < 5) continue

          const local = cols[1]!
          const foreign = cols[2]!
          const pidStr = cols[4]!

          // Parse local port
          let localPort: number
          if (local.startsWith('[')) {
            const closeBracket = local.indexOf(']')
            if (closeBracket === -1) continue
            localPort = Number.parseInt(local.slice(closeBracket + 2), 10)
          } else {
            const lastColon = local.lastIndexOf(':')
            if (lastColon === -1) continue
            localPort = Number.parseInt(local.slice(lastColon + 1), 10)
          }
          if (Number.isNaN(localPort)) continue

          // Parse foreign address — handle IPv6 bracket notation and plain IPv4
          let remoteAddress: string
          let remotePort: number

          if (foreign.startsWith('[')) {
            // IPv6: [addr]:port
            const closeBracket = foreign.indexOf(']')
            if (closeBracket === -1) continue
            remoteAddress = foreign.slice(1, closeBracket)
            remotePort = Number.parseInt(foreign.slice(closeBracket + 2), 10)
          } else {
            // IPv4: addr:port
            const lastColon = foreign.lastIndexOf(':')
            if (lastColon === -1) continue
            remoteAddress = foreign.slice(0, lastColon)
            remotePort = Number.parseInt(foreign.slice(lastColon + 1), 10)
          }

          if (Number.isNaN(remotePort)) continue
          if (LOOPBACK.has(remoteAddress)) continue

          const pid = Number.parseInt(pidStr, 10)
          results.push({ remoteAddress, remotePort, localPort, pid: Number.isNaN(pid) ? null : pid })
        }

        return results
      } catch {
        return []
      }
    },

    async getListeningPorts(): Promise<number[]> {
      try {
        const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'tcp'], { timeout: 15_000, windowsHide: true })

        const ports: number[] = []
        for (const line of stdout.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('TCP')) continue
          if (!trimmed.includes('LISTENING')) continue

          const cols = trimmed.split(/\s+/)
          if (cols.length < 4) continue

          const local = cols[1]!
          let port: number
          if (local.startsWith('[')) {
            const closeBracket = local.indexOf(']')
            if (closeBracket === -1) continue
            port = Number.parseInt(local.slice(closeBracket + 2), 10)
          } else {
            const lastColon = local.lastIndexOf(':')
            if (lastColon === -1) continue
            port = Number.parseInt(local.slice(lastColon + 1), 10)
          }
          if (!Number.isNaN(port) && port > 0) ports.push(port)
        }

        return ports
      } catch {
        return []
      }
    },

    async getDnsCacheEntries(): Promise<DnsCacheEntry[]> {
      try {
        const { stdout } = await execFileAsync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            psUtf8('Get-DnsClientCache | Select-Object Entry,Data | ConvertTo-Json -Compress'),
          ],
          { timeout: 15_000, windowsHide: true },
        )

        const trimmed = stdout.trim()
        if (!trimmed) return []

        const raw = JSON.parse(trimmed)
        const items: Array<{ Entry: string; Data: string | null }> = Array.isArray(raw) ? raw : [raw]

        return items.map((e) => ({
          domain: e.Entry?.toLowerCase() ?? '',
          resolvedAddress: e.Data || null,
        }))
      } catch {
        return []
      }
    },

    async flushDnsCache(): Promise<boolean> {
      try {
        // Use PowerShell Clear-DnsClientCache for reliable cache clearing,
        // then also run ipconfig /flushdns as a belt-and-suspenders approach
        await execFileAsync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', psUtf8('Clear-DnsClientCache')],
          { timeout: 10000, windowsHide: true },
        )
        await execFileAsync('ipconfig', ['/flushdns'], { timeout: 10000, windowsHide: true }).catch(() => {})
        return true
      } catch {
        // Fallback to ipconfig only
        try {
          await execFileAsync('ipconfig', ['/flushdns'], { timeout: 10000, windowsHide: true })
          return true
        } catch {
          return false
        }
      }
    },

    async getWifiProfiles(): Promise<WifiProfile[]> {
      try {
        const { stdout } = await execNativeUtf8('netsh', ['wlan', 'show', 'profiles'], { timeout: 10000 })
        const profiles: WifiProfile[] = []
        for (const line of stdout.split('\n')) {
          const match = line.match(/All User Profile\s*:\s*(.+)/i) || line.match(/User Profile\s*:\s*(.+)/i)
          if (match) {
            const name = match[1]!.trim()
            // Block quotes and control chars — shell metacharacters are handled
            // by cmdEscapeArg inside execNativeUtf8.
            // biome-ignore lint/suspicious/noControlCharactersInRegex: security-critical — intentionally blocks control chars
            if (/["\x00-\x1F]/.test(name)) continue
            let security = 'Unknown'
            try {
              const { stdout: detail } = await execNativeUtf8('netsh', ['wlan', 'show', 'profile', `name=${name}`], {
                timeout: 5000,
              })
              const authMatch = detail.match(/Authentication\s*:\s*(.+)/i)
              if (authMatch) security = authMatch[1]!.trim()
            } catch {
              /* skip */
            }
            profiles.push({ name, security })
          }
        }
        return profiles
      } catch {
        return []
      }
    },

    async deleteWifiProfile(name: string): Promise<boolean> {
      try {
        // biome-ignore lint/suspicious/noControlCharactersInRegex: security-critical — intentionally blocks control chars
        if (/["\x00-\x1F]/.test(name)) return false
        await execNativeUtf8('netsh', ['wlan', 'delete', 'profile', `name=${name}`], { timeout: 10000 })
        return true
      } catch {
        return false
      }
    },

    async clearArpCache(): Promise<boolean> {
      try {
        // 'netsh interface ip delete arpcache' is deprecated on modern Windows.
        // Use PowerShell Remove-NetNeighbor which works on Windows 10/11.
        await execFileAsync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            psUtf8('Get-NetNeighbor | Remove-NetNeighbor -Confirm:$false -ErrorAction Stop'),
          ],
          { timeout: 15000, windowsHide: true },
        )
        return true
      } catch {
        // Fallback to legacy command for older Windows versions
        try {
          await execNativeUtf8('netsh', ['interface', 'ip', 'delete', 'arpcache'], { timeout: 10000 })
          return true
        } catch {
          return false
        }
      }
    },

    async setDnsServer(primary: string, secondary?: string, iface?: string): Promise<boolean> {
      const interfaces = iface ? [iface] : await getNetworkInterfaces()
      if (interfaces.length === 0) return false
      try {
        for (const int of interfaces) {
          await execFileAsync(
            'netsh',
            ['interface', 'ip', 'set', 'dns', `name=${int}`, 'source=static', `addr=${primary}`, 'register=primary'],
            { timeout: 10000, windowsHide: true },
          )

          if (secondary) {
            await execFileAsync(
              'netsh',
              ['interface', 'ip', 'add', 'dns', `name=${int}`, `addr=${secondary}`, 'index=2'],
              { timeout: 10000, windowsHide: true },
            )
          }
        }
        return true
      } catch {
        return false
      }
    },
  }
}

async function getNetworkInterfaces(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        psUtf8('Get-NetAdapter -Physical | Where-Object {$_.Status -eq "Up"} | Select-Object -ExpandProperty Name'),
      ],
      { timeout: 10000, windowsHide: true },
    )
    return stdout
      .trim()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}
