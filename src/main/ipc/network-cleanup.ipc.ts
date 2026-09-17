import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/channels'
import type { NetworkCleanResult, NetworkItem } from '@shared/types'
import { ipcMain } from 'electron'
import { getPlatform } from '../platform'
import { execFileAsync, execNativeUtf8, psUtf8 } from '../services/exec-utf8'
import { validateStringArray } from '../services/ipc-validation'
import { getLogger } from '../services/logger.service'
import type { WindowGetter } from './index'

async function getDnsCacheCount(): Promise<number> {
  const platform = getPlatform()
  const entries = await platform.network.getDnsCacheEntries()
  if (entries.length > 0) return entries.length
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-Command', psUtf8('(Get-DnsClientCache | Measure-Object).Count')],
      { timeout: 10000, windowsHide: true },
    )
    return Number.parseInt(String(stdout).trim(), 10) || 0
  } catch {
    getLogger().warning('network-cleanup', 'Failed to read DNS cache count, returning 0')
    return 0
  }
}

async function getArpEntryCount(): Promise<number> {
  try {
    const cmd = 'arp'
    const { stdout } = await execFileAsync(cmd, ['-a'], { timeout: 10000 })
    const lines = String(stdout)
      .split('\n')
      .filter((l) => /\d+\.\d+\.\d+\.\d+/.test(l))
    return lines.length
  } catch (error) {
    getLogger().warning('network-cleanup', 'Failed to read ARP entry count, returning 0', String(error))
    return 0
  }
}

async function getNetworkHistory(): Promise<{ name: string; guid: string }[]> {
  try {
    const { stdout } = await execNativeUtf8(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\NetworkList\\Profiles', '/s'],
      { timeout: 10000, windowsHide: true },
    )
    const entries: { name: string; guid: string }[] = []
    let currentGuid = ''
    for (const line of stdout.split('\n')) {
      const guidMatch = line.match(/\\(\{[0-9A-F-]+\})$/i)
      if (guidMatch) {
        currentGuid = guidMatch[1]!
      }
      const nameMatch = line.match(/ProfileName\s+REG_SZ\s+(.+)/i)
      if (nameMatch && currentGuid) {
        entries.push({ name: nameMatch[1]!.trim(), guid: currentGuid })
      }
    }
    return entries
  } catch (error) {
    getLogger().warning(
      'network-cleanup',
      'Failed to read profiles from HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\NetworkList\\Profiles, returning []',
      String(error),
    )
    return []
  }
}

// ── Exported core logic (used by both IPC handlers and CLI) ──

export async function scanNetwork(): Promise<NetworkItem[]> {
  getLogger().info('network-cleanup', 'Starting network scan...')
  const platform = getPlatform()
  const items: NetworkItem[] = []

  const dnsCount = await getDnsCacheCount()
  if (dnsCount > 0) {
    items.push({
      id: randomUUID(),
      type: 'dns-cache',
      label: 'DNS Resolver Cache',
      detail: `${dnsCount} cached entries — flushing forces fresh DNS lookups`,
      selected: true,
    })
  }

  const wifiProfiles = await (platform.network.getWifiProfiles?.() ?? Promise.resolve([]))
  for (const profile of wifiProfiles) {
    items.push({
      id: randomUUID(),
      type: 'wifi-profile',
      label: profile.name,
      detail: `Wi-Fi profile · ${profile.security}`,
      selected: false,
    })
  }

  const arpCount = await getArpEntryCount()
  if (arpCount > 0) {
    items.push({
      id: randomUUID(),
      type: 'arp-cache',
      label: 'ARP Cache',
      detail: `${arpCount} entries — maps IP addresses to hardware addresses`,
      selected: true,
    })
  }

  const history = await getNetworkHistory()
  if (history.length > 0) {
    items.push({
      id: randomUUID(),
      type: 'network-history',
      label: 'Network History',
      detail: `${history.length} saved network profile${history.length === 1 ? '' : 's'}`,
      selected: false,
    })
  }

  getLogger().success('network-cleanup', `Network scan completed — ${items.length} item(s) found`)
  return items
}

export async function cleanNetworkItems(
  items: NetworkItem[],
  onProgress?: (processed: number, total: number, label: string) => void,
): Promise<NetworkCleanResult> {
  getLogger().info('network-cleanup', `Starting network clean for ${items.length} item(s)...`)
  const platform = getPlatform()
  let cleaned = 0
  let failed = 0
  const details: string[] = []
  const total = items.length

  // Separate Wi-Fi profiles for parallel deletion
  const wifiItems: NetworkItem[] = []
  const otherItems: NetworkItem[] = []

  for (const item of items) {
    if (item.type === 'wifi-profile') wifiItems.push(item)
    else otherItems.push(item)
  }

  // Process non-WiFi items sequentially (each is a single bulk operation)
  let processed = 0
  for (const item of otherItems) {
    try {
      switch (item.type) {
        case 'dns-cache': {
          const success = await (platform.network.flushDnsCache?.() ?? Promise.resolve(false))
          if (success) {
            details.push('Flushed DNS resolver cache')
            cleaned++
          } else {
            failed++
            details.push('Failed to flush DNS cache')
          }
          break
        }

        case 'arp-cache': {
          const success = await (platform.network.clearArpCache?.() ?? Promise.resolve(false))
          if (success) {
            details.push('Cleared ARP cache')
            cleaned++
          } else {
            failed++
            details.push('Failed to clear ARP cache')
          }
          break
        }

        case 'network-history': {
          const histories = await getNetworkHistory()
          if (histories.length === 0) break
          const histResults = await Promise.allSettled(
            histories.map((entry) =>
              execNativeUtf8(
                'reg',
                [
                  'delete',
                  `HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\NetworkList\\Profiles\\${entry.guid}`,
                  '/f',
                ],
                { timeout: 10000, windowsHide: true },
              ),
            ),
          )
          const histCleaned = histResults.filter((r) => r.status === 'fulfilled').length
          if (histCleaned > 0) {
            details.push(`Removed ${histCleaned} network histor${histCleaned === 1 ? 'y' : 'ies'}`)
            cleaned += histCleaned
          }
          if (histories.length - histCleaned > 0) {
            failed += histories.length - histCleaned
          }
          break
        }
      }
      processed++
      onProgress?.(processed, total, item.label)
    } catch {
      failed++
      details.push(`Failed to clean: ${item.label}`)
      processed++
      onProgress?.(processed, total, item.label)
    }
  }

  // Process Wi-Fi profiles in parallel
  if (wifiItems.length > 0) {
    const wifiResults = await Promise.allSettled(
      wifiItems.map(async (item) => {
        // biome-ignore lint/suspicious/noControlCharactersInRegex: security-critical — intentionally blocks control chars
        if (!item.label || /["\x00-\x1F]/.test(item.label)) {
          return { success: false as const, label: item.label ?? '(empty)' }
        }
        const ok = await (platform.network.deleteWifiProfile?.(item.label) ?? Promise.resolve(false))
        return { success: ok, label: item.label }
      }),
    )
    for (const result of wifiResults) {
      if (result.status === 'fulfilled') {
        if (result.value.success) {
          details.push(`Removed Wi-Fi profile: ${result.value.label}`)
          cleaned++
        } else {
          failed++
          details.push(`Failed to remove Wi-Fi profile: ${result.value.label}`)
        }
      } else {
        failed++
      }
    }
  }

  const result = { cleaned, failed, details }
  if (result.failed > 0) {
    getLogger().error(
      'network-cleanup',
      `Network clean completed with ${result.failed} failure(s) — ${result.cleaned} cleaned`,
    )
  } else {
    getLogger().success('network-cleanup', `Network clean completed — ${result.cleaned} cleaned`)
  }
  return result
}

// ── IPC registration ──

const scanSessions = new Map<string, Map<string, NetworkItem>>()

export function registerNetworkCleanupIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.NETWORK_SCAN, async (): Promise<NetworkItem[]> => {
    getLogger().info('network-cleanup', 'IPC network scan requested')
    const items = await scanNetwork()

    const scanId = randomUUID()
    const sessionMap = new Map<string, NetworkItem>()
    for (const item of items) sessionMap.set(item.id, item)
    scanSessions.set(scanId, sessionMap)
    const sessionKeys = [...scanSessions.keys()]
    while (sessionKeys.length > 3) scanSessions.delete(sessionKeys.shift()!)

    return items
  })

  ipcMain.handle(IPC.NETWORK_CLEAN, async (_event, itemIds: string[]): Promise<NetworkCleanResult> => {
    getLogger().info('network-cleanup', 'IPC network clean requested')
    const valid = validateStringArray(itemIds)
    if (!valid) {
      getLogger().warning('network-cleanup', 'Invalid item IDs received for network clean')
      return { cleaned: 0, failed: 0, details: [] }
    }
    // Search all sessions for the requested items (avoids race if a new scan started)
    const items: NetworkItem[] = []
    for (const id of valid) {
      for (const session of scanSessions.values()) {
        const item = session.get(id)
        if (item) {
          items.push(item)
          break
        }
      }
    }
    return cleanNetworkItems(items, (processed, total, label) => {
      try {
        const win = getWindow()
        if (win && !win.isDestroyed())
          win.webContents.send(IPC.SCAN_PROGRESS, {
            phase: 'cleaning',
            category: 'network',
            currentPath: label,
            progress: total > 0 ? Math.round((processed / total) * 100) : 100,
            itemsFound: total,
            sizeFound: 0,
          })
      } catch (err) {
        getLogger().debug('network-cleanup', `Progress update failed: ${err}`)
      }
    }).then((result) => {
      getLogger().success(
        'network-cleanup',
        `IPC network clean completed — ${result.cleaned} cleaned, ${result.failed} failed`,
      )
      return result
    })
  })
}
