import { randomUUID } from 'node:crypto'
import type { AppStats, DiNhoSettings, MalwareAllowlistEntry, ScheduleEntry, ScheduleTaskType } from '@shared/types'
import { createJsonStore } from './store-base'

interface StoreData {
  settings: DiNhoSettings
  stats: AppStats
  onboardingComplete: boolean
  machineId: string
}

const defaults: StoreData = {
  machineId: '',
  onboardingComplete: false,
  settings: {
    theme: 'dark' as const,
    language: 'en',
    minimizeToTray: false,
    showNotificationOnComplete: true,
    showThreatNotifications: true,
    runAtStartup: false,
    autoUpdate: true,
    autoRestart: true,
    updateCheckIntervalHours: 4,
    autoInstallUpdates: false,
    autoInstallSchedule: null,
    cleaner: {
      skipRecentMinutes: 60,
      secureDelete: false,
      closeBrowsersBeforeClean: false,
      protectRecycleBin: true,
    },
    exclusions: [],
    ignoredSoftwareUpdates: [],
    backupPath: '',
    backupMode: 'targeted' as const,
    schedule: {
      enabled: false,
      frequency: 'weekly',
      day: 1,
      hour: 9,
    },
    schedules: [],
    gameMode: {
      enabledOptimizations: [
        'svc-wsearch',
        'svc-sysmain',
        'proc-kill-updaters',
        'mem-clear-standby',
        'sys-focus-assist',
        'sys-power-plan',
        'sys-prevent-sleep',
        'sys-disable-game-bar',
        'sys-disable-fse-opt',
        'sys-timer-resolution',
        'cpu-game-priority',
        'net-flush-dns',
      ],
      customProcessKillList: [],
      autoDetect: false,
      autoDeactivate: true,
      customGameProcesses: [],
      gameProfiles: {},
    },
    registryIgnoredTweaks: [],
    malwareAllowlist: [],
  },
  stats: {
    totalSpaceSaved: 0,
    totalFilesCleaned: 0,
    totalScans: 0,
    lastScanDate: null,
    recentActivity: [],
  },
}

const store = createJsonStore<StoreData>({
  name: 'config.json',
  defaults,
  devSuffix: 'DiNho-Dev',
})
export function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = JSON.parse(JSON.stringify(target)) as Record<string, unknown>
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    const value = source[key as keyof T]
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>)
    } else if (value !== undefined) {
      result[key] = value as unknown as Record<string, unknown>
    }
  }
  return result as unknown as T
}

function readStore(): StoreData {
  try {
    const parsed = store.load()
    const merged = deepMerge(defaults, parsed)
    if (merged.settings.schedule.enabled && merged.settings.schedules.length === 0) {
      const allCleanerTasks: ScheduleTaskType[] = [
        'cleaner:system',
        'cleaner:browsers',
        'cleaner:apps',
        'cleaner:gaming',
        'cleaner:recycleBin',
        'cleaner:databases',
      ]
      const migrated: ScheduleEntry = {
        id: randomUUID(),
        name: 'Scheduled Scan',
        enabled: true,
        frequency: merged.settings.schedule.frequency,
        day: merged.settings.schedule.day,
        hour: merged.settings.schedule.hour,
        minute: 0,
        tasks: allCleanerTasks,
        autoApply: false,
        lastRunAt: null,
        lastRunStatus: 'never',
        createdAt: new Date().toISOString(),
      }
      merged.settings.schedules = [migrated]
      merged.settings.schedule.enabled = false
      try {
        store.save(merged)
      } catch {
        /* best-effort */
      }
    }
    return merged
  } catch {
    return JSON.parse(JSON.stringify(defaults))
  }
}

function writeStore(data: StoreData): void {
  store.save(data)
}

export function getSettings(): DiNhoSettings {
  return readStore().settings
}

let writeLock: Promise<void> = Promise.resolve()

export function setSettings(partial: Partial<DiNhoSettings>): void {
  const prev = writeLock
  let unlock: () => void
  writeLock = new Promise<void>((r) => {
    unlock = r
  })
  prev.then(() => {
    try {
      const data = readStore()
      data.settings = deepMerge(data.settings, partial)
      writeStore(data)
    } finally {
      unlock!()
    }
  })
}

export function updateScheduleEntry(scheduleId: string, patch: Partial<import('@shared/types').ScheduleEntry>): void {
  const prev = writeLock
  let unlock: () => void
  writeLock = new Promise<void>((r) => {
    unlock = r
  })
  prev.then(() => {
    try {
      const data = readStore()
      data.settings.schedules = data.settings.schedules.map((s) => (s.id === scheduleId ? { ...s, ...patch } : s))
      writeStore(data)
    } finally {
      unlock!()
    }
  })
}

export function updateRegistryIgnoredTweaks(signatures: string[], ignored: boolean): void {
  const prev = writeLock
  let unlock: () => void
  writeLock = new Promise<void>((r) => {
    unlock = r
  })
  prev.then(() => {
    try {
      const data = readStore()
      const set = new Set(data.settings.registryIgnoredTweaks ?? [])
      for (const sig of signatures) {
        if (!sig) continue
        if (ignored) set.add(sig)
        else set.delete(sig)
      }
      data.settings.registryIgnoredTweaks = [...set].slice(-200)
      writeStore(data)
    } finally {
      unlock!()
    }
  })
}

export function getMalwareAllowlist(): MalwareAllowlistEntry[] {
  return readStore().settings.malwareAllowlist ?? []
}

export function addMalwareAllowlistEntry(entry: MalwareAllowlistEntry): Promise<void> {
  const prev = writeLock
  let unlock: () => void
  writeLock = new Promise<void>((r) => {
    unlock = r
  })
  return prev.then(() => {
    try {
      const data = readStore()
      const list = (data.settings.malwareAllowlist ?? []).filter((e) => e.sha256 !== entry.sha256)
      list.push(entry)
      data.settings.malwareAllowlist = list.slice(-500)
      writeStore(data)
    } finally {
      unlock!()
    }
  })
}

export function removeMalwareAllowlistEntry(sha256: string): Promise<void> {
  const prev = writeLock
  let unlock: () => void
  writeLock = new Promise<void>((r) => {
    unlock = r
  })
  return prev.then(() => {
    try {
      const data = readStore()
      data.settings.malwareAllowlist = (data.settings.malwareAllowlist ?? []).filter((e) => e.sha256 !== sha256)
      writeStore(data)
    } finally {
      unlock!()
    }
  })
}

export function flushSettings(): Promise<void> {
  return writeLock
}

export function getOnboardingComplete(): boolean {
  return readStore().onboardingComplete
}

export function setOnboardingComplete(value: boolean): Promise<void> {
  const prev = writeLock
  let unlock: () => void
  writeLock = new Promise<void>((r) => {
    unlock = r
  })
  return prev.then(() => {
    try {
      const data = readStore()
      data.onboardingComplete = value
      writeStore(data)
    } finally {
      unlock!()
    }
  })
}

export function getMachineId(): string {
  const data = readStore()
  if (data.machineId) return data.machineId
  const id = randomUUID()
  const prev = writeLock
  let unlock: () => void
  writeLock = new Promise<void>((r) => {
    unlock = r
  })
  prev.then(() => {
    try {
      const fresh = readStore()
      if (!fresh.machineId) {
        fresh.machineId = id
        writeStore(fresh)
      }
    } finally {
      unlock!()
    }
  })
  return id
}
