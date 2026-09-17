import * as os from 'node:os'
import { IPC } from '@shared/channels'
import type {
  DiskSmartInfo,
  PerfKillResult,
  PerfProcess,
  PerfProcessList,
  PerfSnapshot,
  PerfSystemInfo,
  StartupItem,
} from '@shared/types'
import * as si from 'systeminformation'
import { execFileAsync, psUtf8 } from './exec-utf8'

export class PerfMonitorService {
  private fastTimer: ReturnType<typeof setInterval> | null = null
  private slowTimer: ReturnType<typeof setInterval> | null = null
  private sender: Electron.WebContents | null = null
  private cachedSystemInfo: PerfSystemInfo | null = null
  private startupExeMap: Map<string, string> = new Map()
  private snapshotRunning = false
  private processesRunning = false
  private prevCpuTimes: Array<{ idle: number; total: number }> | null = null
  private cachedDiskIO: { rIO_sec: number; wIO_sec: number } | null = null
  private lastDiskIOPoll = 0
  private diskIOPolling = false
  private cachedDiskLayout: DiskSmartInfo[] | null = null

  async getSystemInfo(): Promise<PerfSystemInfo> {
    if (this.cachedSystemInfo) return this.cachedSystemInfo

    const [cpu, os, mem] = await Promise.all([si.cpu(), si.osInfo(), si.mem()])

    this.cachedSystemInfo = {
      cpuModel: `${cpu.manufacturer} ${cpu.brand}`,
      cpuCores: cpu.physicalCores,
      cpuThreads: cpu.cores,
      totalMemBytes: mem.total,
      osVersion: `${os.distro} ${os.release}`,
      hostname: os.hostname,
    }
    return this.cachedSystemInfo
  }

  async startMonitoring(sender: Electron.WebContents, getStartupItems?: () => Promise<StartupItem[]>): Promise<void> {
    // If already running, just update the sender
    if (this.fastTimer) {
      this.sender = sender
      return
    }

    this.sender = sender

    // Build startup exe map for correlation
    if (getStartupItems) {
      try {
        const items = await getStartupItems()
        this.startupExeMap.clear()
        for (const item of items) {
          // Extract exe name from command string
          const match = item.command.match(/([^/\\]+\.exe)/i)
          if (match) {
            this.startupExeMap.set(match[1]!.toLowerCase(), item.displayName || item.name)
          }
        }
      } catch {
        // Startup correlation is optional
      }
    }

    // Fast interval: system metrics every 3s (was 1s — unnecessary IPC pressure)
    this.fastTimer = setInterval(() => this.collectSnapshot(), 3000)
    // Collect immediately
    this.collectSnapshot()
  }

  startProcessPolling(): void {
    if (this.slowTimer) return
    this.slowTimer = setInterval(() => this.collectProcesses(), 10000)
    this.collectProcesses()
  }

  stopProcessPolling(): void {
    if (this.slowTimer) {
      clearInterval(this.slowTimer)
      this.slowTimer = null
    }
  }

  stopMonitoring(): void {
    if (this.fastTimer) {
      clearInterval(this.fastTimer)
      this.fastTimer = null
    }
    this.stopProcessPolling()
    this.sender = null
  }

  async getProcessName(pid: number): Promise<string | null> {
    try {
      const data = await si.processes()
      const proc = data.list.find((p) => p.pid === pid)
      return proc?.name ?? null
    } catch {
      return null
    }
  }

  async killProcess(pid: number): Promise<PerfKillResult> {
    try {
      process.kill(pid)
      return { success: true }
    } catch {
      // Fallback to platform-specific kill command
      try {
        if (process.platform === 'win32') {
          await execFileAsync('taskkill', ['/F', '/PID', String(pid)])
        } else {
          await execFileAsync('kill', ['-9', String(pid)])
        }
        return { success: true }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        const requiresAdmin =
          message.includes('Access') || message.includes('denied') || message.includes('Operation not permitted')
        return {
          success: false,
          error: requiresAdmin
            ? 'Acesso negado. Execute o DiNho Optimizer como administrador para encerrar este processo.'
            : `Failed to end process: ${message}`,
          requiresAdmin,
        }
      }
    }
  }

  async getDiskHealth(): Promise<DiskSmartInfo[]> {
    if (this.cachedDiskLayout) return this.cachedDiskLayout
    try {
      const disks = await si.diskLayout()
      const reliabilityMap = await this.getStorageReliability()
      this.cachedDiskLayout = disks.map((d) => {
        const smartStatus =
          d.smartStatus === 'Ok'
            ? 'Healthy'
            : d.smartStatus === 'Caution'
              ? 'Caution'
              : d.smartStatus === 'Bad'
                ? 'Bad'
                : 'Unknown'

        let diskType: DiskSmartInfo['type'] = 'Unknown'
        if (d.interfaceType === 'NVMe') diskType = 'NVMe'
        else if (d.type === 'SSD') diskType = 'SSD'
        else if (d.type === 'HD') diskType = 'HDD'

        // Match reliability data by device index (e.g. "\\.\PHYSICALDRIVE0" → "0")
        const deviceIndex = d.device.replace(/\D/g, '')
        const rel = reliabilityMap.get(deviceIndex)

        return {
          device: d.device,
          model: d.name,
          type: diskType,
          sizeBytes: d.size,
          temperature: rel?.temperature ?? d.temperature ?? null,
          healthStatus: smartStatus as DiskSmartInfo['healthStatus'],
          powerOnHours: rel?.powerOnHours ?? null,
          remainingLife: rel?.wear !== null && rel?.wear !== undefined ? 100 - rel.wear : null,
          readErrors: rel?.readErrors ?? null,
          writeErrors: rel?.writeErrors ?? null,
          reallocatedSectors: null,
          smartAttributes: [],
        }
      })
      return this.cachedDiskLayout
    } catch {
      return []
    }
  }

  private async getStorageReliability(): Promise<
    Map<
      string,
      {
        temperature: number | null
        powerOnHours: number | null
        wear: number | null
        readErrors: number | null
        writeErrors: number | null
      }
    >
  > {
    const map = new Map<
      string,
      {
        temperature: number | null
        powerOnHours: number | null
        wear: number | null
        readErrors: number | null
        writeErrors: number | null
      }
    >()

    try {
      const script =
        'Get-PhysicalDisk | ForEach-Object { $disk = $_; $rel = $_ | Get-StorageReliabilityCounter; [PSCustomObject]@{ DeviceId = $disk.DeviceId; Temperature = $rel.Temperature; PowerOnHours = $rel.PowerOnHours; ReadErrorsTotal = $rel.ReadErrorsTotal; WriteErrorsTotal = $rel.WriteErrorsTotal; Wear = $rel.Wear } } | ConvertTo-Json -Compress'

      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psUtf8(script)], {
        timeout: 10000,
        windowsHide: true,
        encoding: 'utf-8',
      })

      const parsed = JSON.parse(String(stdout).trim())
      const entries = Array.isArray(parsed) ? parsed : [parsed]

      for (const entry of entries) {
        map.set(String(entry.DeviceId), {
          temperature: entry.Temperature ?? null,
          powerOnHours: entry.PowerOnHours ?? null,
          wear: entry.Wear ?? null,
          readErrors: entry.ReadErrorsTotal ?? null,
          writeErrors: entry.WriteErrorsTotal ?? null,
        })
      }
    } catch {
      // Requires admin — return empty map, fall back to basic data
    }

    return map
  }

  private getCpuLoad(): { overall: number; perCore: number[] } {
    const cpus = os.cpus()
    const now = cpus.map((cpu) => {
      const t = cpu.times
      const idle = t.idle
      const total = t.user + t.nice + t.sys + t.idle + t.irq
      return { idle, total }
    })

    if (!this.prevCpuTimes) {
      this.prevCpuTimes = now
      return { overall: 0, perCore: cpus.map(() => 0) }
    }

    const perCore: number[] = []
    let totalIdleDelta = 0
    let totalDelta = 0

    for (let i = 0; i < now.length; i++) {
      const cur = now[i]
      const prev = this.prevCpuTimes[i]
      if (!cur || !prev) continue
      const idleDelta = cur.idle - prev.idle
      const totalDeltaCore = cur.total - prev.total
      totalIdleDelta += idleDelta
      totalDelta += totalDeltaCore
      perCore.push(totalDeltaCore > 0 ? Math.min(100, Math.max(0, (1 - idleDelta / totalDeltaCore) * 100)) : 0)
    }

    this.prevCpuTimes = now
    const overall = totalDelta > 0 ? Math.min(100, Math.max(0, (1 - totalIdleDelta / totalDelta) * 100)) : 0
    return { overall, perCore }
  }

  private async getDiskIO(): Promise<{ rIO_sec: number; wIO_sec: number }> {
    const now = Date.now()
    if (this.cachedDiskIO && now - this.lastDiskIOPoll < 30000) {
      return this.cachedDiskIO
    }
    if (this.diskIOPolling) {
      return this.cachedDiskIO ?? { rIO_sec: 0, wIO_sec: 0 }
    }
    this.diskIOPolling = true
    try {
      const disk = await si.disksIO()
      this.cachedDiskIO = { rIO_sec: disk?.rIO_sec ?? 0, wIO_sec: disk?.wIO_sec ?? 0 }
      this.lastDiskIOPoll = now
      return this.cachedDiskIO
    } catch {
      return this.cachedDiskIO ?? { rIO_sec: 0, wIO_sec: 0 }
    } finally {
      this.diskIOPolling = false
    }
  }

  private async collectSnapshot(): Promise<void> {
    if (!this.sender || this.sender.isDestroyed()) {
      this.stopMonitoring()
      return
    }
    if (this.snapshotRunning) return
    this.snapshotRunning = true

    try {
      const cpu = this.getCpuLoad()
      const disk = await this.getDiskIO()

      const totalMem = os.totalmem()
      const usedMem = totalMem - os.freemem()

      const snapshot: PerfSnapshot = {
        timestamp: Date.now(),
        cpu,
        memory: {
          usedBytes: usedMem,
          totalBytes: totalMem,
          cachedBytes: 0,
          percent: totalMem > 0 ? (usedMem / totalMem) * 100 : 0,
        },
        disk: {
          readBytesPerSec: disk.rIO_sec,
          writeBytesPerSec: disk.wIO_sec,
        },
        network: { rxBytesPerSec: 0, txBytesPerSec: 0 },
        uptime: os.uptime(),
      }

      if (!this.sender.isDestroyed()) {
        this.sender.send(IPC.PERF_SNAPSHOT, snapshot)
      }
    } catch {
      // Silently skip failed ticks
    } finally {
      this.snapshotRunning = false
    }
  }

  private async collectProcesses(): Promise<void> {
    if (!this.sender || this.sender.isDestroyed()) {
      this.stopMonitoring()
      return
    }
    if (this.processesRunning) return
    this.processesRunning = true

    try {
      const data = await si.processes()
      const totalMem = os.totalmem()

      // Sort by CPU + memory and take top 100
      const sorted = data.list.sort((a, b) => b.cpu + b.memRss - (a.cpu + a.memRss)).slice(0, 100)

      const processes: PerfProcess[] = sorted.map((p) => {
        const exeName = (p.name || '').toLowerCase()
        const startupName = this.startupExeMap.get(exeName.endsWith('.exe') ? exeName : `${exeName}.exe`)

        return {
          pid: p.pid,
          name: p.name,
          cpuPercent: p.cpu,
          memBytes: p.memRss,
          memPercent: totalMem > 0 ? (p.memRss / totalMem) * 100 : 0,
          user: p.user || '',
          started: p.started || '',
          isStartupItem: !!startupName,
          ...(startupName ? { startupItemName: startupName } : {}),
        }
      })

      const result: PerfProcessList = {
        timestamp: Date.now(),
        processes,
        totalCount: data.all,
      }

      if (!this.sender.isDestroyed()) {
        this.sender.send(IPC.PERF_PROCESS_LIST, result)
      }
    } catch {
      // Silently skip failed ticks
    } finally {
      this.processesRunning = false
    }
  }
}
