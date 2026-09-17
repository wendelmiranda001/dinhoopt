import type { GameModeConfig } from './game-mode'
import type { MalwareAllowlistEntry } from './security'

// ─── Platform ───────────────────────────────────────────────

export interface PlatformInfo {
  platform: 'win32' | 'darwin' | 'linux'
  features: {
    registry: boolean
    debloater: boolean
    drivers: boolean
    bootTrace: boolean
    gameMode: boolean
    firewallAudit: boolean
    contextMenu: boolean
    windowsTweaks: boolean
    benchmark: boolean
    compliance: boolean
    vulnerability: boolean
    clips: boolean
  }
}

// ─── Schedules ──────────────────────────────────────────────

export type ScheduleTaskType =
  | 'cleaner:system'
  | 'cleaner:browsers'
  | 'cleaner:apps'
  | 'cleaner:gaming'
  | 'cleaner:recycleBin'
  | 'cleaner:databases'
  | 'registry'
  | 'drivers'
  | 'software-update'

export type ScheduleRunStatus = 'success' | 'partial' | 'failed' | 'never'

export interface ScheduleEntry {
  id: string
  name: string
  enabled: boolean
  frequency: 'daily' | 'weekly' | 'monthly'
  day: number
  hour: number
  /** Minute of the hour (0-59). Defaults to 0 for backward compatibility. */
  minute?: number
  tasks: ScheduleTaskType[]
  autoApply: boolean
  lastRunAt: string | null
  lastRunStatus: ScheduleRunStatus
  createdAt: string
}

// ─── Settings ───────────────────────────────────────────────

export interface DiNhoSettings {
  theme: 'dark' | 'light' | 'system'
  language: string
  minimizeToTray: boolean
  showNotificationOnComplete: boolean
  showThreatNotifications: boolean
  runAtStartup: boolean
  autoUpdate: boolean
  /** Automatically restart the app to apply downloaded updates */
  autoRestart: boolean
  /** How often (in hours) to check for updates in the background */
  updateCheckIntervalHours: number
  /** Automatically download and install software updates after check */
  autoInstallUpdates: boolean
  /** Schedule for automatic software update checks: null = disabled */
  autoInstallSchedule: 'daily' | 'weekly' | null
  cleaner: {
    skipRecentMinutes: number
    secureDelete: boolean
    closeBrowsersBeforeClean: boolean
    protectRecycleBin: boolean
  }
  exclusions: string[]
  ignoredSoftwareUpdates: string[]
  /** Folder where backups (registry, shell extensions, etc.) are written. Empty = use default. */
  backupPath: string
  /**
   * How registry fixes are backed up before applying.
   * `targeted` (default): export only the keys being modified into one consolidated .reg per run.
   * `full`: export entire hives (HKLM\SOFTWARE, HKCR branches, etc.) — safer but can grow to hundreds of MB.
   */
  backupMode: 'targeted' | 'full'
  schedule: {
    enabled: boolean
    frequency: 'daily' | 'weekly' | 'monthly'
    day: number
    hour: number
  }
  schedules: ScheduleEntry[]
  /** @deprecated No longer used — only Winget is supported */
  windowsPackageManager?: 'winget'
  gameMode: GameModeConfig
  /**
   * Registry-cleaner tweaks the user has chosen to ignore. Recurring advisory
   * recommendations (e.g. "disable SysMain") whose signature is listed here are
   * never pre-selected on a scan, so they aren't applied by accident on a later
   * run. Signatures are `keyPath|valueName` lowercased — see `tweakSignature`
   * in `shared/registry-tweaks.ts` and issue #172.
   */
  registryIgnoredTweaks: string[]
  /**
   * Files the user has marked as false positives in the malware scanner. Any
   * detection whose file content hash matches an entry here is suppressed on
   * future scans. Keyed by content SHA-256 so a known-good file stays trusted
   * even if moved, while a different binary at the same path is still scanned.
   */
  malwareAllowlist: MalwareAllowlistEntry[]
  /**
   * User profile selected during onboarding. Used to personalize the UI
   * (e.g. highlight GameMode for gamers, Privacy for professionals).
   */
  userProfile?: 'gamer' | 'professional' | 'general'
}

// ─── License ────────────────────────────────────────────────

export interface LicenseResult {
  valid: boolean
  reason?: string
  type?: string
  expires_at?: string | null
}

// ─── Logs ───────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'success' | 'warning' | 'error'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  module: string
  message: string
  details?: string
}

export interface LogFilter {
  level?: LogLevel
  search?: string
  module?: string
}

export interface LogsListResult {
  entries: LogEntry[]
  total: number
  page: number
  pageSize: number
}

export interface LogConfig {
  retentionDays: number
}
