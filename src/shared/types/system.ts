// ─── System Scanning & Cleaning ──────────────────────────────

import type { CleanerType } from '../enums'

export interface ScanHistoryCategory {
  name: string
  itemsFound: number
  itemsCleaned: number
  spaceSaved: number
}

export type HistoryEntryType =
  | 'cleaner'
  | 'registry'
  | 'debloater'
  | 'network'
  | 'drivers'
  | 'malware'
  | 'privacy'
  | 'startup'
  | 'services'
  | 'software-update'
  | 'compliance'
  | 'vulnerability'
  | 'delivery-optimization'
  | 'cookie'

export interface ScanHistoryEntry {
  id: string
  type: HistoryEntryType
  timestamp: string
  duration: number
  totalItemsFound: number
  totalItemsCleaned: number
  totalItemsSkipped: number
  totalSpaceSaved: number
  categories: ScanHistoryCategory[]
  errorCount: number
  /** true when the entry was created by the scheduler rather than a manual action */
  scheduled?: boolean
  /** Name of the schedule that triggered this entry */
  scheduleName?: string
}

export interface ScanItem {
  id: string
  path: string
  size: number
  category: string
  subcategory: string
  lastModified: number
  selected: boolean
}

export interface NetworkConnection {
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  state: string
  pid: number
  processName: string
}

export interface ScanResult {
  category: CleanerType
  subcategory: string
  group?: string
  items: ScanItem[]
  totalSize: number
  itemCount: number
}

export interface CleanResult {
  totalCleaned: number
  filesDeleted: number
  filesSkipped: number
  errors: CleanError[]
  needsElevation: boolean
}

export interface CleanError {
  path: string
  reason: string
}

export interface CleanSummaryData {
  totalCleaned: number
  filesDeleted: number
  filesSkipped: number
  errors: CleanError[]
  needsElevation: boolean
  categories: Array<{ name: string; type: string; found: number; cleaned: number; space: number }>
  duration: number
  totalSizeBefore: number
}

export interface ProgressData {
  phase: 'scanning' | 'cleaning'
  category: string
  currentPath: string
  progress: number
  itemsFound: number
  sizeFound: number
}

// ─── Dashboard / App Stats ──────────────────────────────────

export interface AppStats {
  totalSpaceSaved: number
  totalFilesCleaned: number
  totalScans: number
  lastScanDate: string | null
  recentActivity: ActivityEntry[]
}

export interface ActivityEntry {
  id: string
  type: 'clean' | 'registry' | 'startup' | 'scan' | 'drivers' | 'network' | 'delivery-optimization' | 'cookie'
  message: string
  timestamp: string
  spaceSaved?: number
}

// ─── Software Updater ───────────────────────────────────────

export type UpdateSeverity = 'major' | 'minor' | 'patch' | 'unknown'

export interface UpdatableApp {
  id: string
  name: string
  currentVersion: string
  availableVersion: string
  source: string
  severity: UpdateSeverity
  selected: boolean
  isUpToDate?: boolean
}

export interface UpdateCheckResult {
  apps: UpdatableApp[]
  totalCount: number
  majorCount: number
  minorCount: number
  patchCount: number
  packageManagerAvailable: boolean
  packageManagerName: 'winget' | null
}

export interface UpdateProgress {
  phase: 'checking' | 'updating'
  current: number
  total: number
  currentApp: string
  percent: number
  status: 'in-progress' | 'done' | 'failed'
}

export interface UpdateResult {
  succeeded: number
  failed: number
  errors: { appId: string; name: string; reason: string }[]
}

// ─── Auto-Updater ───────────────────────────────────────────

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  progress?: number
  error?: string
}

// ─── Compliance Auditor ─────────────────────────────────────

export type ComplianceSeverity = 'critical' | 'warning' | 'info'

export type ComplianceCategory = 'password' | 'audit' | 'network' | 'update' | 'bitlocker' | 'firewall' | 'uac'

export interface ComplianceCheck {
  id: string
  category: ComplianceCategory
  severity: ComplianceSeverity
  label: string
  description: string
  compliant: boolean
  reversible: boolean
  applicable: boolean
  requiresAdmin: boolean
  value?: string
  expected: string
}

export interface ComplianceState {
  checks: ComplianceCheck[]
  score: number
  total: number
  compliant: number
}

export interface ComplianceScanProgress {
  current: number
  total: number
  currentLabel: string
  category: string
}

export interface ComplianceApplyResult {
  succeeded: number
  failed: number
  errors: { id: string; label: string; reason: string }[]
}

// ─── Vulnerability Scanner ──────────────────────────────────

export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low'

export type VulnerabilityCategory = 'os' | 'framework' | 'network' | 'security' | 'update' | 'config'

export interface VulnerabilityFinding {
  id: string
  category: VulnerabilityCategory
  severity: VulnerabilitySeverity
  label: string
  description: string
  cve?: string
  vulnerable: boolean
  reversible: boolean
  requiresAdmin: boolean
  value?: string
  expected: string
  fixDescription?: string
}

export interface VulnerabilityScanResult {
  findings: VulnerabilityFinding[]
  score: number
  total: number
  vulnerable: number
  duration: number
}

export interface VulnerabilityScanProgress {
  current: number
  total: number
  currentLabel: string
  category: string
}

export interface VulnerabilityActionResult {
  succeeded: number
  failed: number
  errors: { id: string; label: string; reason: string }[]
}

// ─── Privacy Shield ─────────────────────────────────────────

export interface PrivacySetting {
  id: string
  category:
    | 'telemetry'
    | 'ads'
    | 'search'
    | 'services'
    | 'tasks'
    | 'sync'
    | 'kernel'
    | 'network'
    | 'access'
    | 'ai'
    | 'browser'
    | 'recall'
  label: string
  description: string
  enabled: boolean // true = privacy-friendly (tracking disabled)
  reversible: boolean // true = can be reverted to Windows default
  requiresAdmin: boolean
  dependsOn?: string // ID of a setting that must be enabled first
}

export interface PrivacyShieldState {
  settings: PrivacySetting[]
  score: number // 0-100 privacy score
  total: number // total settings count
  protected: number // settings already privacy-friendly
}

export interface PrivacyScanProgress {
  current: number
  total: number
  currentLabel: string
  category: string
}

export interface PrivacyApplyResult {
  succeeded: number
  failed: number
  skipped: number
  errors: { id: string; label: string; reason: string }[]
}
