import { IPC } from '@shared/channels'
import type { DnsPreset, WindowsTweakDef } from '@shared/types'
import { ipcMain } from 'electron'
import { getPlatform } from '../../../platform'
import { execFileAsync, psUtf8 } from '../../../services/exec-utf8'
import { getLogger } from '../../../services/logger.service'
import type { WindowGetter } from '../../index'

export const DNS_PRESETS: DnsPreset[] = [
  { name: 'Cloudflare', primary: '1.1.1.1', secondary: '1.0.0.1' },
  { name: 'Google', primary: '8.8.8.8', secondary: '8.8.4.4' },
  { name: 'OpenDNS', primary: '208.67.222.222', secondary: '208.67.220.220' },
  { name: 'Quad9', primary: '9.9.9.9', secondary: '149.112.112.112' },
]

export const NETWORK_TWEAKS: WindowsTweakDef[] = [
  {
    id: 'tcp-no-delay',
    name: 'TCP No Delay — ON',
    description: 'Desativa algoritmo Nagle (envio imediato de pacotes TCP)',
    category: 'network',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    key: 'TCPNoDelay',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
  },
  {
    id: 'tcp-ack-freq',
    name: 'TCP Ack Frequency — 1',
    description: 'Reduz ACKs para 1 por pacote (menor latência de rede)',
    category: 'network',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces',
    key: 'TcpAckFrequency',
    kind: 'DWord',
    defaultValue: 2,
    optimizedValue: 1,
  },
  {
    id: 'tcp-no-delay-iface',
    name: 'TCP No Delay (Interfaces)',
    description: 'Desativa Nagle em cada interface de rede individualmente',
    category: 'network',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces',
    key: 'TCPNoDelay',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
  },
  {
    id: 'default-ttl',
    name: 'Default TTL — 64',
    description: 'Ajusta TTL dos pacotes para 64 saltos',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    key: 'DefaultTTL',
    kind: 'DWord',
    defaultValue: 128,
    optimizedValue: 64,
  },
  {
    id: 'max-user-port',
    name: 'Max User Port — 65534',
    description: 'Expande portas disponíveis para 65534 (mais conexões simultâneas)',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    key: 'MaxUserPort',
    kind: 'DWord',
    defaultValue: 5000,
    optimizedValue: 65534,
  },
  {
    id: 'tcp-1323-opts',
    name: 'TCP Window Scaling — ON',
    description: 'Ativa TCP Window Scaling (melhor throughput em alta latência)',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    key: 'Tcp1323Opts',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 1,
  },
  {
    id: 'tcp-max-dup-acks',
    name: 'TCP Max Dup Acks — 2',
    description: 'Reduz ACKs duplicados para 2 (recuperação mais rápida)',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    key: 'TcpMaxDupAcks',
    kind: 'DWord',
    defaultValue: 3,
    optimizedValue: 2,
  },
  {
    id: 'tcp-timed-wait-delay',
    name: 'TCP Timed Wait Delay — 30s',
    description: 'Reduz espera de portas em TIME_WAIT para 30 segundos',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    key: 'TcpTimedWaitDelay',
    kind: 'DWord',
    defaultValue: 120,
    optimizedValue: 30,
  },
  {
    id: 'network-throttling',
    name: 'Network Throttling Index — OFF',
    description: 'Remove limite de throttle de rede do Windows',
    category: 'network',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile',
    key: 'NetworkThrottlingIndex',
    kind: 'DWord',
    defaultValue: 10,
    optimizedValue: 4294967295,
  },
  {
    id: 'tcp-window-size',
    name: 'TCP Window Size — 65535',
    description: 'Aumenta janela TCP para 65535 bytes (melhor throughput)',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    key: 'TcpWindowSize',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 65535,
    needsReboot: true,
  },
  {
    id: 'global-max-tcp-window-size',
    name: 'Global Max TCP Window — 65535',
    description: 'Define janela TCP máxima global para 65535 bytes',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    key: 'GlobalMaxTcpWindowSize',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 65535,
    needsReboot: true,
  },
  {
    id: 'tcp-del-ack-ticks',
    name: 'TCP Delayed Ack Ticks — 0 (desligado)',
    description: 'Desativa ACK atrasado do TCP (ACK imediato)',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces',
    key: 'TcpDelAckTicks',
    kind: 'DWord',
    defaultValue: 2,
    optimizedValue: 0,
  },
  {
    id: 'delivery-opt-off',
    name: 'Delivery Optimization (P2P) — OFF',
    description: 'Desativa compartilhamento P2P de atualizações do Windows',
    category: 'network',
    level: 'basico',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\DeliveryOptimization\\Config',
    key: 'DODownloadMode',
    kind: 'DWord',
    defaultValue: 1,
    optimizedValue: 0,
  },
  {
    id: 'qos-reservable-bw',
    name: 'QoS Reservable Bandwidth — 0% (desligado)',
    description: 'Libera 100% da banda de rede (remove reserva QoS de 20%)',
    category: 'network',
    level: 'medio',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SOFTWARE\\Policies\\Microsoft\\Windows\\Psched',
    key: 'NonBestEffortLimit',
    kind: 'DWord',
    defaultValue: 20,
    optimizedValue: 0,
    needsReboot: true,
  },
  {
    id: 'ecn-capability',
    name: 'ECN — ON (ambos lados)',
    description: 'Ativa Explicit Congestion Notification (menos perda de pacotes)',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters',
    key: 'EnableECN',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 2,
    needsReboot: true,
  },
  {
    id: 'fast-send-datagram-threshold',
    name: 'UDP Fast Path — 65536 bytes',
    description: 'Aumenta limite do UDP fast path (menos latência em jogos/VoIP)',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\AFD\\Parameters',
    key: 'FastSendDatagramThreshold',
    kind: 'DWord',
    defaultValue: 1024,
    optimizedValue: 65536,
    needsReboot: true,
  },
  {
    id: 'disable-ipv6',
    name: 'IPv6 — OFF (todas interfaces)',
    description: 'Desativa IPv6 em todas interfaces de rede',
    category: 'network',
    level: 'full',
    hive: 'HKEY_LOCAL_MACHINE',
    path: 'SYSTEM\\CurrentControlSet\\Services\\Tcpip6\\Parameters',
    key: 'DisabledComponents',
    kind: 'DWord',
    defaultValue: 0,
    optimizedValue: 255,
    needsReboot: true,
  },
]

export function registerNetworkTweaks(_getWindow: WindowGetter): void {
  ipcMain.handle(IPC.WINDOWS_TWEAKS_GET_DNS, async () => {
    getLogger().info('windows-tweaks', 'DNS presets requested')
    return DNS_PRESETS
  })

  ipcMain.handle(IPC.WINDOWS_TWEAKS_SET_DNS, async (_event, primary: string, secondary?: string) => {
    getLogger().info('windows-tweaks', `Setting DNS: ${primary}${secondary ? ` / ${secondary}` : ''}`)
    try {
      const plat = getPlatform()
      if (plat.network.setDnsServer) {
        const result = await plat.network.setDnsServer(primary, secondary)
        if (result) getLogger().success('windows-tweaks', 'DNS set successfully')
        else getLogger().error('windows-tweaks', 'Failed to set DNS server')
        return result
      }
      getLogger().warning('windows-tweaks', 'setDnsServer not available on this platform')
      return false
    } catch (err) {
      getLogger().error('windows-tweaks', `DNS set failed: ${err}`)
      return false
    }
  })

  ipcMain.handle(
    IPC.WINDOWS_TWEAKS_NETSH_TCP,
    async (_event, action: 'apply' | 'revert'): Promise<{ success: boolean; error?: string }> => {
      getLogger().info('windows-tweaks', `netsh TCP global: ${action}`)
      try {
        const script =
          action === 'apply'
            ? `
          $e = $null
          try { netsh int tcp set global chimney=disabled } catch { $e = $_ }
          try { netsh int tcp set global rss=enabled } catch { $e = $_ }
          try { netsh int tcp set global timestamps=disabled } catch { $e = $_ }
          try { netsh int tcp set global initialRto=2000 } catch { $e = $_ }
          if ($e) { Write-Output "ERROR: $e" } else { Write-Output "OK" }
        `
            : `
          try { netsh int tcp set global chimney=enabled } catch {}
          try { netsh int tcp set global rss=default } catch {}
          try { netsh int tcp set global timestamps=default } catch {}
          try { netsh int tcp set global initialRto=3000 } catch {}
          Write-Output "OK"
        `
        const { stdout } = await execFileAsync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', psUtf8(script)],
          { timeout: 30000, windowsHide: true },
        )

        if (stdout.includes('ERROR')) {
          getLogger().error('windows-tweaks', `netsh TCP failed: ${stdout}`)
          return { success: false, error: String(stdout).replace('ERROR: ', '').trim() }
        }
        getLogger().success('windows-tweaks', `netsh TCP ${action} concluído`)
        return { success: true }
      } catch (err) {
        getLogger().error('windows-tweaks', `netsh TCP ${action} error: ${err}`)
        return { success: false, error: String(err) }
      }
    },
  )
}
