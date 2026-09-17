import { IPC, RENDERER_LOG } from '@shared/channels'
import type { AgentEvaluationResult } from '@shared/driver-agent-types'
import type {
  AppInstallerListResult,
  AppInstallProgress,
  AppInstallResult,
  BenchmarkProgress,
  BenchmarkResult,
  ComplianceApplyResult,
  ComplianceScanProgress,
  ComplianceState,
  ContextMenuApplyProgress,
  ContextMenuApplyRequest,
  ContextMenuApplyResult,
  ContextMenuScanResult,
  DiNhoSettings,
  DiskNode,
  DiskRepairProgress,
  DiskRepairResult,
  DiskSmartInfo,
  DnsPreset,
  DriveInfo,
  DriverCleanResult,
  DriverScanProgress,
  DriverScanResult,
  DriverUpdateInstallResult,
  DriverUpdateProgress,
  DriverUpdateScanResult,
  DuplicateDeleteMode,
  DuplicateDeleteResult,
  DuplicateScanOptions,
  DuplicateScanProgress,
  DuplicateScanResult,
  EmptyFolderDeleteResult,
  EmptyFolderScanOptions,
  EmptyFolderScanProgress,
  EmptyFolderScanResult,
  FileTypeInfo,
  FirewallAction,
  FirewallApplyResult,
  FirewallScanProgress,
  FirewallScanResult,
  GameModeActivateResult,
  GameModeAuditReport,
  GameModeConfig,
  GameModeDeactivateResult,
  GameModeProgress,
  GameModeStatus,
  LargeFileDeleteMode,
  LargeFileDeleteResult,
  LargeFileScanOptions,
  LargeFileScanProgress,
  LargeFileScanResult,
  LicenseResult,
  LogConfig,
  LogFilter,
  LogsListResult,
  MalwareActionResult,
  MalwareAllowlistEntry,
  MalwareScanProgress,
  MalwareScanResult,
  MemoryInfo,
  MemoryOptimizeProgress,
  MemoryOptimizeResult,
  MemoryProcess,
  NetworkCleanResult,
  NetworkConnection,
  NetworkItem,
  PerfKillResult,
  PerfProcessList,
  PerfQuickStats,
  PerfSnapshot,
  PerfSystemInfo,
  PlatformInfo,
  PowerPlanActivateResult,
  PowerPlanCreateResult,
  PowerPlanDeleteResult,
  PowerPlanInfo,
  PrivacyApplyResult,
  PrivacyScanProgress,
  PrivacyShieldState,
  QuarantinedItem,
  QuarantineMeta,
  RegistryEntry,
  ScanHistoryEntry,
  ServiceApplyResult,
  ServiceScanProgress,
  ServiceScanResult,
  ShredderEntry,
  ShredderProgress,
  ShredderResult,
  StartupBootTrace,
  StartupItem,
  StartupSafetyResult,
  TrimDriveInfo,
  TrimProgress,
  TrimRunResult,
  UninstallerListResult,
  UninstallProgress,
  UninstallResult,
  UpdateCheckResult,
  UpdateProgress,
  UpdateResult,
  UpdateStatus,
  VulnerabilityActionResult,
  VulnerabilityScanProgress,
  VulnerabilityScanResult,
  WindowsTweakApplyProgress,
  WindowsTweakResult,
  WindowsTweakState,
  YaraRulesInfo,
} from '@shared/types'
import { ipcRenderer } from 'electron'

function onEvent<T>(channel: string, callback: (data: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

export const systemMethods = {
  log: (level: string, message: string) => ipcRenderer.send(RENDERER_LOG, level, message),

  platformInfo: (): Promise<PlatformInfo> => ipcRenderer.invoke(IPC.PLATFORM_INFO),

  windowMinimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
  windowMaximize: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
  windowClose: () => ipcRenderer.send(IPC.WINDOW_CLOSE),

  registryScan: (): Promise<RegistryEntry[]> => ipcRenderer.invoke(IPC.REGISTRY_SCAN),
  registryFix: (
    entryIds: string[],
  ): Promise<{ fixed: number; failed: number; failures: { issue: string; reason: string }[] }> =>
    ipcRenderer.invoke(IPC.REGISTRY_FIX, entryIds),
  registryScanCancel: (): Promise<void> => ipcRenderer.invoke(IPC.REGISTRY_SCAN_CANCEL),
  registryFixCancel: (): Promise<void> => ipcRenderer.invoke(IPC.REGISTRY_FIX_CANCEL),
  registrySetTweakIgnored: (signatures: string[], ignored: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.REGISTRY_SET_TWEAK_IGNORED, signatures, ignored),
  onRegistryFixProgress: (callback: (data: { current: number; total: number; currentEntry: string }) => void) =>
    onEvent(IPC.REGISTRY_FIX_PROGRESS, callback),

  contextMenuScan: (): Promise<ContextMenuScanResult> => ipcRenderer.invoke(IPC.CONTEXT_MENU_SCAN),
  contextMenuScanCancel: (): Promise<void> => ipcRenderer.invoke(IPC.CONTEXT_MENU_SCAN_CANCEL),
  contextMenuApply: (requests: ContextMenuApplyRequest[]): Promise<ContextMenuApplyResult> =>
    ipcRenderer.invoke(IPC.CONTEXT_MENU_APPLY, requests),
  onContextMenuApplyProgress: (callback: (data: ContextMenuApplyProgress) => void) =>
    onEvent(IPC.CONTEXT_MENU_APPLY_PROGRESS, callback),

  startupList: (): Promise<StartupItem[]> => ipcRenderer.invoke(IPC.STARTUP_LIST),
  startupToggle: (
    name: string,
    location: string,
    command: string,
    source: string,
    enabled: boolean,
  ): Promise<boolean> => ipcRenderer.invoke(IPC.STARTUP_TOGGLE, name, location, command, source, enabled),
  startupDelete: (name: string, location: string, source: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.STARTUP_DELETE, name, location, source),
  startupBootTrace: (): Promise<StartupBootTrace> => ipcRenderer.invoke(IPC.STARTUP_BOOT_TRACE),
  startupSafetyFetch: (): Promise<StartupSafetyResult> => ipcRenderer.invoke(IPC.STARTUP_SAFETY_FETCH),

  networkScan: (): Promise<NetworkItem[]> => ipcRenderer.invoke(IPC.NETWORK_SCAN),
  networkClean: (itemIds: string[]): Promise<NetworkCleanResult> => ipcRenderer.invoke(IPC.NETWORK_CLEAN, itemIds),
  networkGetConnections: (): Promise<{ connections: NetworkConnection[]; suspicious: NetworkConnection[] }> =>
    ipcRenderer.invoke(IPC.NETWORK_GET_CONNECTIONS),

  diskAnalyze: (driveLetter: string): Promise<DiskNode> => ipcRenderer.invoke(IPC.DISK_ANALYZE, driveLetter),
  diskDrives: (): Promise<DriveInfo[]> => ipcRenderer.invoke(IPC.DISK_DRIVES),
  diskFileTypes: (driveLetter: string): Promise<FileTypeInfo[]> => ipcRenderer.invoke(IPC.DISK_FILE_TYPES, driveLetter),

  diskRepairSfc: (drive: string): Promise<DiskRepairResult> => ipcRenderer.invoke(IPC.DISK_REPAIR_SFC, drive),
  diskRepairDism: (): Promise<DiskRepairResult> => ipcRenderer.invoke(IPC.DISK_REPAIR_DISM),
  diskRepairChkdsk: (drive: string): Promise<DiskRepairResult> => ipcRenderer.invoke(IPC.DISK_REPAIR_CHKDSK, drive),
  onDiskRepairProgress: (callback: (data: DiskRepairProgress) => void) => onEvent(IPC.DISK_REPAIR_PROGRESS, callback),

  diskTrimList: (): Promise<TrimDriveInfo[]> => ipcRenderer.invoke(IPC.DISK_TRIM_LIST),
  diskTrimRun: (driveIds: string[]): Promise<TrimRunResult[]> => ipcRenderer.invoke(IPC.DISK_TRIM_RUN, driveIds),
  onDiskTrimProgress: (callback: (data: TrimProgress) => void) => onEvent(IPC.DISK_TRIM_PROGRESS, callback),

  onboardingGet: (): Promise<boolean> => ipcRenderer.invoke(IPC.ONBOARDING_GET),
  onboardingSet: (value: boolean): Promise<void> => ipcRenderer.invoke(IPC.ONBOARDING_SET, value),

  settingsGet: (): Promise<DiNhoSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
  settingsSet: (settings: Partial<DiNhoSettings>): Promise<void> => ipcRenderer.invoke(IPC.SETTINGS_SET, settings),
  settingsSelectBackupDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.SETTINGS_SELECT_BACKUP_DIR),
  settingsOpenBackupDir: (): Promise<string> => ipcRenderer.invoke(IPC.SETTINGS_OPEN_BACKUP_DIR),

  elevationCheck: (): Promise<boolean> => ipcRenderer.invoke(IPC.ELEVATION_CHECK),
  elevationRelaunch: (): Promise<void> => ipcRenderer.invoke(IPC.ELEVATION_RELAUNCH),

  applyStartup: (enabled: boolean): Promise<void> => ipcRenderer.invoke(IPC.SETTINGS_APPLY_STARTUP, enabled),
  applyTray: (enabled: boolean) => ipcRenderer.send(IPC.SETTINGS_APPLY_TRAY, enabled),
  notifyScheduledScanComplete: (totalSize: number, itemCount: number) =>
    ipcRenderer.send(IPC.SCHEDULE_SCAN_COMPLETE, totalSize, itemCount),

  onScheduleRunTrigger: (
    callback: (data: { scheduleId: string; scheduleName: string; tasks: string[]; autoApply: boolean }) => void,
  ) => onEvent(IPC.SCHEDULE_RUN_TRIGGER, callback),
  scheduleRunComplete: (scheduleId: string, status: string) =>
    ipcRenderer.send(IPC.SCHEDULE_RUN_COMPLETE, scheduleId, status),

  historyGet: (): Promise<ScanHistoryEntry[]> => ipcRenderer.invoke(IPC.HISTORY_GET),
  historyAdd: (entry: ScanHistoryEntry): Promise<void> => ipcRenderer.invoke(IPC.HISTORY_ADD, entry),
  historyClear: (): Promise<void> => ipcRenderer.invoke(IPC.HISTORY_CLEAR),

  onHistoryChanged: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC.HISTORY_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC.HISTORY_CHANGED, handler)
    }
  },

  privacyScan: (): Promise<PrivacyShieldState> => ipcRenderer.invoke(IPC.PRIVACY_SCAN),
  privacyApply: (ids: string[]): Promise<PrivacyApplyResult> => ipcRenderer.invoke(IPC.PRIVACY_APPLY, ids),
  privacyRevert: (ids: string[]): Promise<PrivacyApplyResult> => ipcRenderer.invoke(IPC.PRIVACY_REVERT, ids),
  onPrivacyProgress: (callback: (data: PrivacyScanProgress) => void) => onEvent(IPC.PRIVACY_PROGRESS, callback),

  complianceScan: (): Promise<ComplianceState> => ipcRenderer.invoke(IPC.COMPLIANCE_SCAN),
  complianceApply: (ids: string[]): Promise<ComplianceApplyResult> => ipcRenderer.invoke(IPC.COMPLIANCE_APPLY, ids),
  complianceRevert: (ids: string[]): Promise<ComplianceApplyResult> => ipcRenderer.invoke(IPC.COMPLIANCE_REVERT, ids),
  onComplianceProgress: (callback: (data: ComplianceScanProgress) => void) =>
    onEvent(IPC.COMPLIANCE_PROGRESS, callback),

  vulnerabilityScan: (): Promise<VulnerabilityScanResult> => ipcRenderer.invoke(IPC.VULN_SCAN),
  vulnerabilityApply: (ids: string[]): Promise<VulnerabilityActionResult> => ipcRenderer.invoke(IPC.VULN_APPLY, ids),
  vulnerabilityRevert: (ids: string[]): Promise<VulnerabilityActionResult> => ipcRenderer.invoke(IPC.VULN_REVERT, ids),
  onVulnerabilityProgress: (callback: (data: VulnerabilityScanProgress) => void) =>
    onEvent(IPC.VULN_PROGRESS, callback),

  malwareScan: (scanId?: string, profileId?: string): Promise<MalwareScanResult> =>
    ipcRenderer.invoke(IPC.MALWARE_SCAN, scanId, profileId),
  malwareCancelScan: (scanId: string): Promise<boolean> => ipcRenderer.invoke(IPC.MALWARE_CANCEL_SCAN, scanId),
  malwareQuarantine: (paths: string[], meta?: QuarantineMeta[]): Promise<MalwareActionResult> =>
    ipcRenderer.invoke(IPC.MALWARE_QUARANTINE, paths, meta),
  malwareDelete: (paths: string[]): Promise<MalwareActionResult> => ipcRenderer.invoke(IPC.MALWARE_DELETE, paths),
  malwareRestore: (quarantinedPath: string, originalPath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MALWARE_RESTORE, quarantinedPath, originalPath),
  malwareQuarantineList: (): Promise<QuarantinedItem[]> => ipcRenderer.invoke(IPC.MALWARE_QUARANTINE_LIST),
  malwareIgnore: (path: string, meta?: QuarantineMeta): Promise<MalwareAllowlistEntry | null> =>
    ipcRenderer.invoke(IPC.MALWARE_IGNORE, path, meta),
  malwareAllowlistList: (): Promise<MalwareAllowlistEntry[]> => ipcRenderer.invoke(IPC.MALWARE_ALLOWLIST_LIST),
  malwareAllowlistRemove: (sha256: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MALWARE_ALLOWLIST_REMOVE, sha256),
  onMalwareProgress: (callback: (data: MalwareScanProgress) => void) => onEvent(IPC.MALWARE_PROGRESS, callback),
  malwareYaraInfo: (): Promise<YaraRulesInfo> => ipcRenderer.invoke(IPC.MALWARE_YARA_INFO),
  malwareYaraUpdate: (): Promise<{
    success: boolean
    error?: string
    stats?: { rulesCount: number; version: string }
  }> => ipcRenderer.invoke(IPC.MALWARE_YARA_UPDATE),
  onYaraCompileProgress: (callback: (data: { loaded: number; total: number }) => void) =>
    onEvent(IPC.MALWARE_YARA_COMPILE_PROGRESS, callback),

  driverScan: (): Promise<DriverScanResult> => ipcRenderer.invoke(IPC.DRIVER_SCAN),
  driverClean: (publishedNames: string[]): Promise<DriverCleanResult> =>
    ipcRenderer.invoke(IPC.DRIVER_CLEAN, publishedNames),
  onDriverProgress: (callback: (data: DriverScanProgress) => void) => onEvent(IPC.DRIVER_PROGRESS, callback),

  driverUpdateScan: (): Promise<DriverUpdateScanResult> => ipcRenderer.invoke(IPC.DRIVER_UPDATE_SCAN),
  driverUpdateInstall: (updateIds: string[]): Promise<DriverUpdateInstallResult> =>
    ipcRenderer.invoke(IPC.DRIVER_UPDATE_INSTALL, updateIds),
  onDriverUpdateProgress: (callback: (data: DriverUpdateProgress) => void) =>
    onEvent(IPC.DRIVER_UPDATE_PROGRESS, callback),

  driverAgentEvaluate: (): Promise<AgentEvaluationResult> => ipcRenderer.invoke(IPC.DRIVER_AGENT_EVALUATE),
  driverAgentApprove: (updateIds: string[]): Promise<{ success: boolean; error?: string; rebootRequired?: boolean }> =>
    ipcRenderer.invoke(IPC.DRIVER_AGENT_APPROVE, { updateIds }),

  perfQuickStats: (): Promise<PerfQuickStats> => ipcRenderer.invoke(IPC.PERF_QUICK_STATS),
  perfGetSystemInfo: (): Promise<PerfSystemInfo> => ipcRenderer.invoke(IPC.PERF_GET_SYSTEM_INFO),
  perfStartMonitoring: (): Promise<void> => ipcRenderer.invoke(IPC.PERF_START_MONITORING),
  perfStopMonitoring: (): Promise<void> => ipcRenderer.invoke(IPC.PERF_STOP_MONITORING),
  perfStartProcessPolling: (): Promise<void> => ipcRenderer.invoke(IPC.PERF_START_PROCESS_POLLING),
  perfStopProcessPolling: (): Promise<void> => ipcRenderer.invoke(IPC.PERF_STOP_PROCESS_POLLING),
  perfKillProcess: (pid: number): Promise<PerfKillResult> => ipcRenderer.invoke(IPC.PERF_KILL_PROCESS, pid),
  perfGetDiskHealth: (): Promise<DiskSmartInfo[]> => ipcRenderer.invoke(IPC.PERF_DISK_HEALTH),
  onPerfSnapshot: (callback: (data: PerfSnapshot) => void) => onEvent(IPC.PERF_SNAPSHOT, callback),
  onPerfProcessList: (callback: (data: PerfProcessList) => void) => onEvent(IPC.PERF_PROCESS_LIST, callback),

  updaterCheck: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_CHECK),
  updaterDownload: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_DOWNLOAD),
  updaterInstall: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_INSTALL),
  updaterGetStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.UPDATER_GET_STATUS),
  onUpdaterStatus: (callback: (data: UpdateStatus) => void) => onEvent(IPC.UPDATER_STATUS, callback),

  serviceScan: (): Promise<ServiceScanResult> => ipcRenderer.invoke(IPC.SERVICE_SCAN),
  serviceApply: (changes: { name: string; targetStartType: string }[], force?: boolean): Promise<ServiceApplyResult> =>
    ipcRenderer.invoke(IPC.SERVICE_APPLY, changes, force),
  onServiceProgress: (callback: (data: ServiceScanProgress) => void) => onEvent(IPC.SERVICE_PROGRESS, callback),

  firewallScan: (): Promise<FirewallScanResult> => ipcRenderer.invoke(IPC.FIREWALL_SCAN),
  firewallApply: (changes: { name: string; action: FirewallAction }[]): Promise<FirewallApplyResult> =>
    ipcRenderer.invoke(IPC.FIREWALL_APPLY, changes),
  onFirewallProgress: (callback: (data: FirewallScanProgress) => void) => onEvent(IPC.FIREWALL_PROGRESS, callback),

  uninstallerList: (): Promise<UninstallerListResult> => ipcRenderer.invoke(IPC.UNINSTALLER_LIST),
  uninstallerUninstall: (programId: string): Promise<UninstallResult> =>
    ipcRenderer.invoke(IPC.UNINSTALLER_UNINSTALL, programId),
  uninstallerForceRemove: (programId: string): Promise<UninstallResult> =>
    ipcRenderer.invoke(IPC.UNINSTALLER_FORCE_REMOVE, programId),
  onUninstallerProgress: (callback: (data: UninstallProgress) => void) => onEvent(IPC.UNINSTALLER_PROGRESS, callback),
  programSafetyFetch: (): Promise<StartupSafetyResult> => ipcRenderer.invoke(IPC.PROGRAM_SAFETY_FETCH),

  softwareUpdateCheck: (): Promise<UpdateCheckResult> => ipcRenderer.invoke(IPC.SOFTWARE_UPDATE_CHECK),
  softwareUpdateRun: (appIds: string[], source?: string): Promise<UpdateResult> =>
    ipcRenderer.invoke(IPC.SOFTWARE_UPDATE_RUN, appIds, source),
  onSoftwareUpdateProgress: (callback: (data: UpdateProgress) => void) =>
    onEvent(IPC.SOFTWARE_UPDATE_PROGRESS, callback),

  appInstallerListAvailable: (): Promise<AppInstallerListResult> =>
    ipcRenderer.invoke(IPC.APP_INSTALLER_LIST_AVAILABLE),
  appInstallerInstall: (appIds: string[]): Promise<AppInstallResult> =>
    ipcRenderer.invoke(IPC.APP_INSTALLER_INSTALL, appIds),
  appInstallerCancel: (): Promise<void> => ipcRenderer.invoke(IPC.APP_INSTALLER_CANCEL),
  onAppInstallerProgress: (callback: (data: AppInstallProgress) => void) =>
    onEvent(IPC.APP_INSTALLER_PROGRESS, callback),

  duplicatesSelectDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.DUPLICATES_SELECT_DIR),
  duplicatesScan: (options: DuplicateScanOptions): Promise<DuplicateScanResult> =>
    ipcRenderer.invoke(IPC.DUPLICATES_SCAN, options),
  duplicatesCancel: (): Promise<void> => ipcRenderer.invoke(IPC.DUPLICATES_CANCEL),
  duplicatesDelete: (paths: string[], mode: DuplicateDeleteMode): Promise<DuplicateDeleteResult> =>
    ipcRenderer.invoke(IPC.DUPLICATES_DELETE, paths, mode),
  duplicatesOpenLocation: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.DUPLICATES_OPEN_LOCATION, filePath),
  onDuplicatesProgress: (callback: (data: DuplicateScanProgress) => void) => onEvent(IPC.DUPLICATES_PROGRESS, callback),

  largeFilesSelectDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.LARGE_FILES_SELECT_DIR),
  largeFilesScan: (options: LargeFileScanOptions): Promise<LargeFileScanResult> =>
    ipcRenderer.invoke(IPC.LARGE_FILES_SCAN, options),
  largeFilesCancel: (): Promise<void> => ipcRenderer.invoke(IPC.LARGE_FILES_CANCEL),
  largeFilesDelete: (paths: string[], mode: LargeFileDeleteMode): Promise<LargeFileDeleteResult> =>
    ipcRenderer.invoke(IPC.LARGE_FILES_DELETE, paths, mode),
  largeFilesOpenLocation: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.LARGE_FILES_OPEN_LOCATION, filePath),
  onLargeFilesProgress: (callback: (data: LargeFileScanProgress) => void) =>
    onEvent(IPC.LARGE_FILES_PROGRESS, callback),

  emptyFoldersSelectDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.EMPTY_FOLDERS_SELECT_DIR),
  emptyFoldersScan: (options: EmptyFolderScanOptions): Promise<EmptyFolderScanResult> =>
    ipcRenderer.invoke(IPC.EMPTY_FOLDERS_SCAN, options),
  emptyFoldersCancel: (): Promise<void> => ipcRenderer.invoke(IPC.EMPTY_FOLDERS_CANCEL),
  emptyFoldersDelete: (paths: string[], mode: string): Promise<EmptyFolderDeleteResult> =>
    ipcRenderer.invoke(IPC.EMPTY_FOLDERS_DELETE, paths, mode),
  emptyFoldersOpenLocation: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.EMPTY_FOLDERS_OPEN_LOCATION, folderPath),
  onEmptyFoldersProgress: (callback: (data: EmptyFolderScanProgress) => void) =>
    onEvent(IPC.EMPTY_FOLDERS_PROGRESS, callback),

  shredderSelectFiles: (): Promise<ShredderEntry[]> => ipcRenderer.invoke(IPC.SHREDDER_SELECT_FILES),
  shredderSelectFolders: (): Promise<ShredderEntry[]> => ipcRenderer.invoke(IPC.SHREDDER_SELECT_FOLDERS),
  shredderShred: (paths: string[]): Promise<ShredderResult> => ipcRenderer.invoke(IPC.SHREDDER_SHRED, paths),
  shredderCancel: (): Promise<void> => ipcRenderer.invoke(IPC.SHREDDER_CANCEL),
  shredderOpenLocation: (filePath: string): Promise<void> => ipcRenderer.invoke(IPC.SHREDDER_OPEN_LOCATION, filePath),
  onShredderProgress: (callback: (data: ShredderProgress) => void) => onEvent(IPC.SHREDDER_PROGRESS, callback),

  windowsTweaksList: (): Promise<WindowsTweakState[]> => ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_LIST),
  windowsTweaksApply: (ids: string[]): Promise<WindowsTweakResult> => ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_APPLY, ids),
  windowsTweaksRevert: (ids: string[]): Promise<WindowsTweakResult> =>
    ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_REVERT, ids),
  windowsTweaksStatus: (): Promise<WindowsTweakState[]> => ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_STATUS),
  windowsTweaksGetDnsPresets: (): Promise<DnsPreset[]> => ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_GET_DNS),
  windowsTweaksSetDns: (primary: string, secondary?: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_SET_DNS, primary, secondary),
  onWindowsTweaksApplyProgress: (callback: (data: WindowsTweakApplyProgress) => void) =>
    onEvent(IPC.WINDOWS_TWEAKS_APPLY_PROGRESS, callback),
  onWindowsTweaksRevertProgress: (callback: (data: WindowsTweakApplyProgress) => void) =>
    onEvent(IPC.WINDOWS_TWEAKS_REVERT_PROGRESS, callback),

  windowsTweaksNetshTcp: (action: 'apply' | 'revert'): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_NETSH_TCP, action),

  gamingTimerGet: (): Promise<import('@shared/types').GamingTimerStatus> =>
    ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_GAMING_TIMER_GET),
  gamingTimerSet: (
    settings: Partial<
      Pick<import('@shared/types').GamingTimerStatus, 'hpetOff' | 'tscSyncPolicy' | 'dynamicTickDisabled'>
    >,
  ): Promise<{ success: boolean; errors: string[] }> =>
    ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_GAMING_TIMER_SET, settings),
  gamingTimerRevert: (): Promise<{ success: boolean; errors: string[] }> =>
    ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_GAMING_TIMER_REVERT),
  gamingAutoTuning: (action: 'apply' | 'revert'): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_GAMING_AUTOTUNING, action),

  gamingVbsGet: (): Promise<{ enabled: boolean }> => ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_GAMING_VBS_GET),
  gamingVbsSet: (enabled: boolean): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_GAMING_VBS_SET, enabled),
  gamingHagsGet: (): Promise<{ enabled: boolean }> => ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_GAMING_HAGS_GET),
  gamingHagsSet: (enabled: boolean): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_GAMING_HAGS_SET, enabled),

  directstorageCheck: (): Promise<import('@shared/types').DirectStorageStatus> =>
    ipcRenderer.invoke(IPC.GAME_MODE_DIRECTSTORAGE_CHECK),

  hostsRead: (): Promise<import('@shared/types').HostsFileData> => ipcRenderer.invoke(IPC.HOSTS_READ),
  hostsWrite: (request: import('@shared/types').HostsWriteRequest): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.HOSTS_WRITE, request),
  hostsFlushDns: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke(IPC.HOSTS_FLUSH_DNS),

  benchmarkRun: (): Promise<BenchmarkResult> => ipcRenderer.invoke(IPC.BENCHMARK_RUN),
  benchmarkCancel: (): Promise<void> => ipcRenderer.invoke(IPC.BENCHMARK_CANCEL),
  onBenchmarkProgress: (callback: (data: BenchmarkProgress) => void) => onEvent(IPC.BENCHMARK_PROGRESS, callback),

  watcherStart: (directories: string[]): Promise<boolean> => ipcRenderer.invoke(IPC.MALWARE_WATCHER_START, directories),
  watcherStop: (): Promise<boolean> => ipcRenderer.invoke(IPC.MALWARE_WATCHER_STOP),
  watcherStatus: (): Promise<{ isWatching: boolean; watchedCount: number }> =>
    ipcRenderer.invoke(IPC.MALWARE_WATCHER_STATUS),

  getScanProfiles: (): Promise<import('@shared/types').ScanProfile[]> => ipcRenderer.invoke(IPC.MALWARE_GET_PROFILES),
  setScanProfile: (profileId: string): Promise<boolean> => ipcRenderer.invoke(IPC.MALWARE_SET_PROFILE, profileId),

  licenseActivate: (key: string): Promise<LicenseResult> => ipcRenderer.invoke(IPC.LICENSE_ACTIVATE, key),
  licenseStatus: (): Promise<LicenseResult> => ipcRenderer.invoke(IPC.LICENSE_STATUS),
  licenseGetHwid: (): Promise<string> => ipcRenderer.invoke(IPC.LICENSE_GET_HWID),

  memoryInfo: (): Promise<{ info: MemoryInfo; processes: MemoryProcess[] }> => ipcRenderer.invoke(IPC.MEMORY_INFO),
  memoryOptimize: (): Promise<MemoryOptimizeResult> => ipcRenderer.invoke(IPC.MEMORY_OPTIMIZE),
  onMemoryProgress: (callback: (data: MemoryOptimizeProgress) => void) => onEvent(IPC.MEMORY_PROGRESS, callback),

  gameModeActivate: (config: GameModeConfig): Promise<GameModeActivateResult> =>
    ipcRenderer.invoke(IPC.GAME_MODE_ACTIVATE, config),
  gameModeDeactivate: (): Promise<GameModeDeactivateResult> => ipcRenderer.invoke(IPC.GAME_MODE_DEACTIVATE),
  gameModeStatus: (): Promise<GameModeStatus> => ipcRenderer.invoke(IPC.GAME_MODE_STATUS),
  onGameModeProgress: (callback: (data: GameModeProgress) => void) => onEvent(IPC.GAME_MODE_PROGRESS, callback),
  onGameModeAutoEvent: (
    callback: (data: { type: 'game-detected' | 'game-exited'; processName: string | null }) => void,
  ) => onEvent(IPC.GAME_MODE_AUTO_EVENT, callback),
  gameModeRunAudit: (phase: GameModeAuditReport['phase']): Promise<GameModeAuditReport> =>
    ipcRenderer.invoke(IPC.GAME_MODE_RUN_AUDIT, phase),
  gameModeDetectorStart: (): Promise<void> => ipcRenderer.invoke(IPC.GAME_MODE_DETECTOR_START),
  gameModeDetectorStop: (): Promise<void> => ipcRenderer.invoke(IPC.GAME_MODE_DETECTOR_STOP),

  powerPlansList: (): Promise<PowerPlanInfo[]> => ipcRenderer.invoke(IPC.POWER_PLANS_LIST),
  powerPlansActivate: (guid: string): Promise<PowerPlanActivateResult> =>
    ipcRenderer.invoke(IPC.POWER_PLANS_ACTIVATE, guid),
  powerPlansCreate: (name: string): Promise<PowerPlanCreateResult> => ipcRenderer.invoke(IPC.POWER_PLANS_CREATE, name),
  powerPlansDelete: (guid: string): Promise<PowerPlanDeleteResult> => ipcRenderer.invoke(IPC.POWER_PLANS_DELETE, guid),

  customRulesList: (): Promise<{ name: string; content: string; size: number; addedAt: Date }[]> =>
    ipcRenderer.invoke(IPC.MALWARE_CUSTOM_RULES_LIST),
  customRulesAdd: (name: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MALWARE_CUSTOM_RULES_ADD, name, content),
  customRulesRemove: (name: string): Promise<boolean> => ipcRenderer.invoke(IPC.MALWARE_CUSTOM_RULES_REMOVE, name),

  exportReport: (result: MalwareScanResult, format: string, outputPath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MALWARE_EXPORT_REPORT, result, format, outputPath),

  logsList: (filter?: LogFilter, page?: number, pageSize?: number): Promise<LogsListResult> =>
    ipcRenderer.invoke(IPC.LOGS_LIST, filter, page, pageSize),
  logsClear: (): Promise<void> => ipcRenderer.invoke(IPC.LOGS_CLEAR),
  logsExport: (filter?: LogFilter): Promise<string> => ipcRenderer.invoke(IPC.LOGS_EXPORT, filter),
  logsConfigGet: (): Promise<LogConfig> => ipcRenderer.invoke(IPC.LOGS_CONFIG_GET),
  logsConfigSet: (config: LogConfig): Promise<void> => ipcRenderer.invoke(IPC.LOGS_CONFIG_SET, config),

  memoryScan: (): Promise<import('@shared/types').MemoryScanResult> => ipcRenderer.invoke(IPC.MALWARE_MEMORY_SCAN),

  getTimeline: (limit?: number, offset?: number): Promise<import('@shared/types').TimelineEntry[]> =>
    ipcRenderer.invoke(IPC.MALWARE_TIMELINE_GET, limit, offset),
  clearTimeline: (): Promise<void> => ipcRenderer.invoke(IPC.MALWARE_TIMELINE_CLEAR),
  getTimelineStats: (): Promise<{
    total: number
    bySeverity: Record<string, number>
    byAction: Record<string, number>
  }> => ipcRenderer.invoke(IPC.MALWARE_TIMELINE_STATS),

  intelCheckHash: (hash: string): Promise<import('@shared/types').ThreatIntelEntry | null> =>
    ipcRenderer.invoke(IPC.MALWARE_INTEL_CHECK_HASH, hash),
  intelCheckDomain: (domain: string): Promise<import('@shared/types').ThreatIntelEntry | null> =>
    ipcRenderer.invoke(IPC.MALWARE_INTEL_CHECK_DOMAIN, domain),
  intelCheckIp: (ip: string): Promise<import('@shared/types').ThreatIntelEntry | null> =>
    ipcRenderer.invoke(IPC.MALWARE_INTEL_CHECK_IP, ip),
  intelStats: (): Promise<{ total: number; byType: Record<string, number>; bySeverity: Record<string, number> }> =>
    ipcRenderer.invoke(IPC.MALWARE_INTEL_STATS),
  intelFeeds: (): Promise<
    Array<{ name: string; url: string; enabled: boolean; updateInterval: number; lastUpdated?: number; parser: string }>
  > => ipcRenderer.invoke(IPC.MALWARE_INTEL_FEEDS),
  intelToggleFeed: (name: string, enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MALWARE_INTEL_TOGGLE_FEED, name, enabled),
  intelClear: (): Promise<void> => ipcRenderer.invoke(IPC.MALWARE_INTEL_CLEAR),

  exploitScan: (filePath: string): Promise<import('@shared/types').ExploitScanResult> =>
    ipcRenderer.invoke(IPC.MALWARE_EXPLOIT_SCAN, filePath),

  backupConfigGet: (): Promise<import('../main/services/cloud-backup.service').CloudBackupConfig> =>
    ipcRenderer.invoke(IPC.MALWARE_BACKUP_CONFIG_GET),
  backupConfigSet: (updates: Record<string, unknown>): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MALWARE_BACKUP_CONFIG_SET, updates),
  backupNow: (): Promise<import('../main/services/cloud-backup.service').BackupResult> =>
    ipcRenderer.invoke(IPC.MALWARE_BACKUP_NOW),
  backupList: (): Promise<{ name: string; size: number; date: string }[]> =>
    ipcRenderer.invoke(IPC.MALWARE_BACKUP_LIST),
  backupRestore: (backupId: string, destPath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MALWARE_BACKUP_RESTORE, backupId, destPath),
  backupStorage: (): Promise<number> => ipcRenderer.invoke(IPC.MALWARE_BACKUP_STORAGE),

  sandboxAnalyze: (
    filePath: string,
  ): Promise<import('../main/services/behavioral-sandbox.service').SandboxResult | null> =>
    ipcRenderer.invoke(IPC.MALWARE_SANDBOX_ANALYZE, filePath),
}
