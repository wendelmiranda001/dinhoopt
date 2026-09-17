import { IPC } from '@shared/channels'
import type { BenchmarkResult, BenchmarkScoreClass } from '@shared/types'
import { ipcMain } from 'electron'
import { execFileAsync, psUtf8 } from '../services/exec-utf8'
import { getLogger } from '../services/logger.service'
import type { WindowGetter } from './index'

export function classifyScore(score: number): BenchmarkScoreClass {
  if (score >= 90) return 'S'
  if (score >= 80) return 'A'
  if (score >= 70) return 'B'
  if (score >= 50) return 'C'
  return 'D'
}

interface StepDef {
  label: string
  detail: string
}

const STEPS: StepDef[] = [
  { label: 'Inicializando sensores...', detail: 'Preparando ambiente de diagnóstico' },
  { label: 'Medindo CPU (baseline)', detail: '10 amostras a cada 500ms' },
  { label: 'Medindo RAM disponível', detail: 'Analisando memória livre e total' },
  { label: 'Medindo latência de rede', detail: '10 pings para 8.8.8.8' },
  { label: 'Medindo latência DPC', detail: '3 medições de timer resolution' },
  { label: 'Medindo temperaturas', detail: 'Lendo sensores CPU e GPU' },
  { label: 'Verificando tweaks aplicados', detail: 'Contando tweaks do catálogo' },
  { label: 'Verificando plano de energia', detail: 'Analisando plano ativo' },
  { label: 'Calculando score competitivo', detail: 'Processando métricas coletadas' },
  { label: 'Gerando recomendações', detail: 'Finalizando diagnóstico' },
]

function sendProgress(win: ReturnType<WindowGetter>, step: number, label: string, detail: string) {
  win?.webContents.send(IPC.BENCHMARK_PROGRESS, { step, totalSteps: STEPS.length, label, detail })
}

let _benchmarkCancelled = false

export function cancelBenchmark(): void {
  _benchmarkCancelled = true
}

async function measureCpuUsage(isCancelled: () => boolean): Promise<number> {
  try {
    let total = 0
    for (let i = 0; i < 10; i++) {
      if (isCancelled()) return 50
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          psUtf8(
            'Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average | Select-Object -ExpandProperty Average',
          ),
        ],
        { timeout: 5000, windowsHide: true, encoding: 'utf-8' },
      )
      const val = Number.parseInt(String(stdout).trim(), 10)
      if (!Number.isNaN(val)) total += val
      await sleep(500)
    }
    return total / 10
  } catch {
    return 50
  }
}

async function measureRam(): Promise<{ free: number; total: number }> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        psUtf8(
          '$os=Get-CimInstance Win32_OperatingSystem; @{Free=[math]::Round($os.FreePhysicalMemory/1024); Total=[math]::Round($os.TotalVisibleMemorySize/1024)} | ConvertTo-Json -Compress',
        ),
      ],
      { timeout: 5000, windowsHide: true, encoding: 'utf-8' },
    )
    const parsed = JSON.parse(String(stdout).trim())
    return { free: parsed.Free, total: parsed.Total }
  } catch {
    return { free: 0, total: 0 }
  }
}

async function measurePing(isCancelled: () => boolean): Promise<{ avg: number; jitter: number }> {
  try {
    let total = 0
    const times: number[] = []
    for (let i = 0; i < 10; i++) {
      if (isCancelled()) return { avg: 100, jitter: 0 }
      const { stdout } = await execFileAsync('ping', ['-n', '1', '-w', '3000', '8.8.8.8'], {
        timeout: 5000,
        windowsHide: true,
        encoding: 'utf-8',
      })
      const match = String(stdout).match(/time[=<](\d+)ms/i)
      if (match) {
        const t = Number.parseInt(match[1] ?? '', 10)
        times.push(t)
        total += t
      }
      await sleep(300)
    }
    if (times.length === 0) return { avg: 100, jitter: 0 }
    const avg = total / times.length
    const jitter = times.length > 1 ? Math.sqrt(times.reduce((sum, t) => sum + (t - avg) ** 2, 0) / times.length) : 0
    return { avg: Math.round(avg), jitter: Math.round(jitter) }
  } catch {
    return { avg: 100, jitter: 0 }
  }
}

async function measureDpcLatency(isCancelled: () => boolean): Promise<number> {
  try {
    let maxLatency = 0
    for (let i = 0; i < 3; i++) {
      if (isCancelled()) return 1000
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          psUtf8(
            '(Get-CimInstance Win32_PerfRawData_Counters_TimerResolution | Select-Object -ExpandProperty Percent_Interval_Timer_Rate) -replace ",", ""',
          ),
        ],
        { timeout: 5000, windowsHide: true, encoding: 'utf-8' },
      )
      const val = Number.parseInt(String(stdout).trim(), 10)
      if (!Number.isNaN(val) && val > maxLatency) maxLatency = val
      await sleep(300)
    }
    return maxLatency
  } catch {
    return 1000
  }
}

async function measureTemperature(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        psUtf8(
          'Get-CimInstance MSAcpi_ThermalZoneTemperature -Namespace "root/wmi" | Select-Object -ExpandProperty CurrentTemperature | ForEach-Object { [math]::Round(($_ - 2732) / 10) }',
        ),
      ],
      { timeout: 5000, windowsHide: true, encoding: 'utf-8' },
    )
    const temps = String(stdout)
      .trim()
      .split('\n')
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => !Number.isNaN(n))
    if (temps.length === 0) return null
    return Math.max(...temps)
  } catch {
    return null
  }
}

async function countTweaksApplied(): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        psUtf8(
          '$count=0; @("MouseSpeed","MouseThreshold1","MouseThreshold2","MenuShowDelay").foreach({ $v=Get-ItemPropertyValue -Path "HKCU:\\Control Panel\\Mouse" -Name $_ -ErrorAction SilentlyContinue; if($v -eq "0"){$count++} }); $count',
        ),
      ],
      { timeout: 10000, windowsHide: true, encoding: 'utf-8' },
    )
    const c = Number.parseInt(String(stdout).trim(), 10)
    return Number.isNaN(c) ? 0 : c
  } catch {
    return 0
  }
}

async function getActivePowerPlan(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('powercfg', ['/getactivescheme'], { timeout: 5000, windowsHide: true })
    if (stdout.includes('e9a42b02-d5df-448d-aa00-03f14749eb61')) return 'ultimate'
    if (stdout.includes('8c5e7fda-e8bf-4a96-9a05-a4e062abba23')) return 'high'
    return 'balanced'
  } catch {
    return 'balanced'
  }
}

export function scoreCpu(usage: number): number {
  if (usage < 5) return 20
  if (usage < 10) return 17
  if (usage < 20) return 14
  if (usage < 35) return 9
  return 4
}

export function scoreRam(percent: number): number {
  if (percent > 60) return 20
  if (percent > 40) return 16
  if (percent > 25) return 11
  if (percent > 10) return 6
  return 2
}

export function scoreNetwork(avg: number, jitter: number): number {
  let score = 0
  if (avg < 10) score = 15
  else if (avg < 30) score = 13
  else if (avg < 60) score = 10
  else if (avg < 100) score = 6
  else score = 2
  if (jitter > 60) score -= 8
  else if (jitter > 30) score -= 4
  return Math.max(0, score)
}

export function scoreDpc(latency: number): number {
  if (latency < 200) return 25
  if (latency < 500) return 20
  if (latency < 1000) return 13
  if (latency < 2000) return 6
  return 2
}

export function scoreTemperature(temp: number | null): number {
  if (temp === null) return 10
  if (temp < 50) return 20
  if (temp < 60) return 17
  if (temp < 70) return 13
  if (temp < 80) return 8
  return 3
}

export function scoreTweakBonus(applied: number, total: number): number {
  return Math.round((applied / total) * 10)
}

export function scorePowerBonus(plan: string): number {
  if (plan === 'ultimate') return 5
  if (plan === 'high') return 3
  return 0
}

export function registerBenchmarkIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.BENCHMARK_RUN, async () => {
    _benchmarkCancelled = false
    getLogger().info('benchmark', 'Starting benchmark...')
    const win = getWindow()
    sendProgress(win, 0, STEPS[0]?.label ?? '', STEPS[0]?.detail ?? '')
    await sleep(500)

    // CPU
    sendProgress(win, 1, STEPS[1]?.label ?? '', STEPS[1]?.detail ?? '')
    const cpuUsage = await measureCpuUsage(() => _benchmarkCancelled)
    const cpuScore = scoreCpu(cpuUsage)
    const cpuDetail = `Uso médio: ${cpuUsage.toFixed(1)}%`

    // RAM
    sendProgress(win, 2, STEPS[2]?.label ?? '', STEPS[2]?.detail ?? '')
    const ram = await measureRam()
    const ramFreePercent = ram.total > 0 ? (ram.free / ram.total) * 100 : 0
    const ramScore = scoreRam(ramFreePercent)
    const ramDetail = `Livre: ${ram.free}MB / ${ram.total}MB (${ramFreePercent.toFixed(0)}%)`

    // Network
    sendProgress(win, 3, STEPS[3]?.label ?? '', STEPS[3]?.detail ?? '')
    const { avg: pingAvg, jitter } = await measurePing(() => _benchmarkCancelled)
    const netScore = scoreNetwork(pingAvg, jitter)
    const netDetail = `Ping médio: ${pingAvg}ms, Jitter: ${jitter}ms`

    // DPC
    sendProgress(win, 4, STEPS[4]?.label ?? '', STEPS[4]?.detail ?? '')
    const dpc = await measureDpcLatency(() => _benchmarkCancelled)
    const dpcScore = scoreDpc(dpc)
    const dpcDetail = `Latência DPC: ${dpc}µs`

    // Temperature
    sendProgress(win, 5, STEPS[5]?.label ?? '', STEPS[5]?.detail ?? '')
    const temp = await measureTemperature()
    const tempScore = scoreTemperature(temp)
    const tempDetail = temp !== null ? `${temp}°C` : 'Indisponível'

    // Tweaks
    sendProgress(win, 6, STEPS[6]?.label ?? '', STEPS[6]?.detail ?? '')
    const tweaksApplied = await countTweaksApplied()
    const totalTweaks = 51
    const tweakBonus = scoreTweakBonus(tweaksApplied, totalTweaks)

    // Power Plan
    sendProgress(win, 7, STEPS[7]?.label ?? '', STEPS[7]?.detail ?? '')
    const powerPlan = await getActivePowerPlan()
    const powerBonus = scorePowerBonus(powerPlan)
    const powerDetail =
      powerPlan === 'ultimate' ? 'Ultimate Performance' : powerPlan === 'high' ? 'High Performance' : 'Balanced'

    // Score
    const totalScore = cpuScore + ramScore + netScore + dpcScore + tempScore + tweakBonus + powerBonus

    sendProgress(win, 8, STEPS[8]?.label ?? '', STEPS[8]?.detail ?? '')
    await sleep(300)

    sendProgress(win, 9, STEPS[9]?.label ?? '', STEPS[9]?.detail ?? '')
    await sleep(300)

    const result: BenchmarkResult = {
      score: totalScore,
      scoreClass: classifyScore(totalScore),
      details: {
        cpu: { score: cpuScore, detail: cpuDetail },
        ram: { score: ramScore, detail: ramDetail },
        network: { score: netScore, detail: netDetail, jitter },
        latencyDpc: { score: dpcScore, detail: dpcDetail },
        temperature: { score: tempScore, detail: tempDetail },
        tweakBonus: { score: tweakBonus, applied: tweaksApplied, total: totalTweaks },
        powerBonus: { score: powerBonus, plan: powerDetail },
      },
      completedAt: new Date().toISOString(),
    }

    getLogger().success('benchmark', `Benchmark completed with score ${totalScore} (${classifyScore(totalScore)})`)
    return result
  })

  ipcMain.handle(IPC.BENCHMARK_CANCEL, () => {
    getLogger().info('benchmark', 'Benchmark cancelled by user')
    _benchmarkCancelled = true
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
