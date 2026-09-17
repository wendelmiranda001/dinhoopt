export const RENDERER_LOG = 'renderer-log' as const

export const IPC = {
  // System cleaner
  SYSTEM_SCAN: 'cleaner:system:scan',
  SYSTEM_CLEAN: 'cleaner:system:clean',

  // Browser cleaner
  BROWSER_SCAN: 'cleaner:browser:scan',
  BROWSER_CLEAN: 'cleaner:browser:clean',

  // App cleaner
  APP_SCAN: 'cleaner:app:scan',
  APP_CLEAN: 'cleaner:app:clean',

  // Gaming cleaner
  GAMING_SCAN: 'cleaner:gaming:scan',
  GAMING_CLEAN: 'cleaner:gaming:clean',

  // Database optimizer
  DATABASE_SCAN: 'cleaner:database:scan',
  DATABASE_CLEAN: 'cleaner:database:clean',

  // Recycle bin
  RECYCLE_BIN_SCAN: 'cleaner:recyclebin:scan',
  RECYCLE_BIN_CLEAN: 'cleaner:recyclebin:clean',

  // Uninstall leftovers
  UNINSTALL_LEFTOVERS_SCAN: 'cleaner:uninstall-leftovers:scan',
  UNINSTALL_LEFTOVERS_CLEAN: 'cleaner:uninstall-leftovers:clean',

  // Shortcut cleaner
  SHORTCUT_SCAN: 'cleaner:shortcut:scan',
  SHORTCUT_CLEAN: 'cleaner:shortcut:clean',

  // Environment cleaner (orphaned PATH entries & env vars)
  ENVIRONMENT_SCAN: 'cleaner:environment:scan',
  ENVIRONMENT_CLEAN: 'cleaner:environment:clean',

  // Cleaner shared
  CLEANER_OPEN_LOCATION: 'cleaner:open-location',

  // Registry
  REGISTRY_SCAN: 'cleaner:registry:scan',
  REGISTRY_FIX: 'cleaner:registry:fix',
  REGISTRY_SCAN_CANCEL: 'cleaner:registry:scan:cancel',
  REGISTRY_FIX_CANCEL: 'cleaner:registry:fix:cancel',
  REGISTRY_SET_TWEAK_IGNORED: 'cleaner:registry:tweak:set-ignored',

  // Context Menu Cleaner (Windows shell extensions / right-click verbs)
  CONTEXT_MENU_SCAN: 'cleaner:context-menu:scan',
  CONTEXT_MENU_SCAN_CANCEL: 'cleaner:context-menu:scan:cancel',
  CONTEXT_MENU_APPLY: 'cleaner:context-menu:apply',
  CONTEXT_MENU_APPLY_PROGRESS: 'cleaner:context-menu:apply:progress',

  // Startup
  STARTUP_LIST: 'startup:list',
  STARTUP_TOGGLE: 'startup:toggle',
  STARTUP_DELETE: 'startup:delete',
  STARTUP_BOOT_TRACE: 'startup:boot-trace',
  STARTUP_SAFETY_FETCH: 'startup:safety:fetch',

  // Debloater
  DEBLOATER_SCAN: 'debloater:scan',
  DEBLOATER_REMOVE: 'debloater:remove',
  DEBLOATER_REMOVE_PROGRESS: 'debloater:remove:progress',

  // Duplicate Finder
  DUPLICATES_SCAN: 'duplicates:scan',
  DUPLICATES_DELETE: 'duplicates:delete',
  DUPLICATES_CANCEL: 'duplicates:cancel',
  DUPLICATES_PROGRESS: 'duplicates:progress',
  DUPLICATES_SELECT_DIR: 'duplicates:select-dir',
  DUPLICATES_OPEN_LOCATION: 'duplicates:open-location',

  // Disk analyzer
  DISK_ANALYZE: 'disk:analyze',
  DISK_DRIVES: 'disk:drives',
  DISK_FILE_TYPES: 'disk:file-types',

  // Disk repair (SFC/DISM/CHKDSK)
  DISK_REPAIR_SFC: 'disk:repair:sfc',
  DISK_REPAIR_DISM: 'disk:repair:dism',
  DISK_REPAIR_CHKDSK: 'disk:repair:chkdsk',
  DISK_REPAIR_PROGRESS: 'disk:repair:progress',

  // Disk maintenance (SSD TRIM)
  DISK_TRIM_LIST: 'disk:trim:list',
  DISK_TRIM_RUN: 'disk:trim:run',
  DISK_TRIM_PROGRESS: 'disk:trim:progress',

  // Network cleanup
  NETWORK_SCAN: 'cleaner:network:scan',
  NETWORK_CLEAN: 'cleaner:network:clean',
  NETWORK_GET_CONNECTIONS: 'network:get-connections',

  // Progress events (main -> renderer)
  SCAN_PROGRESS: 'scan:progress',
  REGISTRY_FIX_PROGRESS: 'registry:fix:progress',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_SELECT_BACKUP_DIR: 'settings:select-backup-dir',
  SETTINGS_OPEN_BACKUP_DIR: 'settings:open-backup-dir',

  // System
  ELEVATION_CHECK: 'elevation:check',
  ELEVATION_RELAUNCH: 'elevation:relaunch',
  // Scheduled scans (legacy single-schedule)
  SCHEDULE_NEXT_SCAN: 'schedule:next-scan',
  SCHEDULE_SCAN_COMPLETE: 'schedule:scan-complete',

  // Multi-schedule
  SCHEDULE_RUN_TRIGGER: 'schedule:run-trigger',
  SCHEDULE_RUN_COMPLETE: 'schedule:run-complete',

  // Settings apply (renderer -> main)
  SETTINGS_APPLY_STARTUP: 'settings:apply-startup',
  SETTINGS_APPLY_TRAY: 'settings:apply-tray',

  // Scan history
  HISTORY_GET: 'history:get',
  HISTORY_ADD: 'history:add',
  HISTORY_CLEAR: 'history:clear',

  // Malware scanner
  MALWARE_SCAN: 'malware:scan',
  MALWARE_QUARANTINE: 'malware:quarantine',
  MALWARE_DELETE: 'malware:delete',
  MALWARE_RESTORE: 'malware:restore',
  MALWARE_PROGRESS: 'malware:progress',
  MALWARE_QUARANTINE_LIST: 'malware:quarantine:list',
  MALWARE_IGNORE: 'malware:ignore',
  MALWARE_ALLOWLIST_LIST: 'malware:allowlist:list',
  MALWARE_ALLOWLIST_REMOVE: 'malware:allowlist:remove',
  MALWARE_YARA_INFO: 'malware:yara:info',
  MALWARE_YARA_UPDATE: 'malware:yara:update',
  MALWARE_YARA_COMPILE_PROGRESS: 'malware:yara:compile-progress',
  MALWARE_CANCEL_SCAN: 'malware:cancel-scan',
  MALWARE_YARA_ROLLBACK: 'yara:rollback-update',

  // File watcher
  MALWARE_WATCHER_START: 'malware:watcher-start',
  MALWARE_WATCHER_STOP: 'malware:watcher-stop',
  MALWARE_WATCHER_STATUS: 'malware:watcher-status',

  // Scan profiles
  MALWARE_GET_PROFILES: 'malware:get-profiles',
  MALWARE_SET_PROFILE: 'malware:set-profile',

  // Compliance Auditor
  COMPLIANCE_SCAN: 'compliance:scan',
  COMPLIANCE_APPLY: 'compliance:apply',
  COMPLIANCE_REVERT: 'compliance:revert',
  COMPLIANCE_PROGRESS: 'compliance:progress',

  // Vulnerability Scanner
  VULN_SCAN: 'vuln:scan',
  VULN_APPLY: 'vuln:apply',
  VULN_REVERT: 'vuln:revert',
  VULN_PROGRESS: 'vuln:progress',

  // Privacy Shield
  PRIVACY_SCAN: 'privacy:scan',
  PRIVACY_APPLY: 'privacy:apply',
  PRIVACY_REVERT: 'privacy:revert',
  PRIVACY_PROGRESS: 'privacy:progress',

  // Driver Manager
  DRIVER_SCAN: 'driver:scan',
  DRIVER_CLEAN: 'driver:clean',
  DRIVER_PROGRESS: 'driver:progress',
  DRIVER_UPDATE_SCAN: 'driver:update:scan',
  DRIVER_UPDATE_INSTALL: 'driver:update:install',
  DRIVER_UPDATE_PROGRESS: 'driver:update:progress',

  // Program Uninstaller
  UNINSTALLER_LIST: 'uninstaller:list',
  UNINSTALLER_UNINSTALL: 'uninstaller:uninstall',
  UNINSTALLER_FORCE_REMOVE: 'uninstaller:force-remove',
  UNINSTALLER_PROGRESS: 'uninstaller:progress',
  PROGRAM_SAFETY_FETCH: 'program:safety:fetch',

  // Onboarding
  ONBOARDING_GET: 'onboarding:get',
  ONBOARDING_SET: 'onboarding:set',

  // Performance Monitor
  PERF_QUICK_STATS: 'perf:quick-stats',
  PERF_GET_SYSTEM_INFO: 'perf:system-info',
  PERF_START_MONITORING: 'perf:start',
  PERF_STOP_MONITORING: 'perf:stop',
  PERF_START_PROCESS_POLLING: 'perf:start-process',
  PERF_STOP_PROCESS_POLLING: 'perf:stop-process',
  PERF_SNAPSHOT: 'perf:snapshot',
  PERF_PROCESS_LIST: 'perf:process-list',
  PERF_KILL_PROCESS: 'perf:kill',
  PERF_DISK_HEALTH: 'perf:disk-health',

  // Auto-updater
  UPDATER_CHECK: 'updater:check',
  UPDATER_DOWNLOAD: 'updater:download',
  UPDATER_INSTALL: 'updater:install',
  UPDATER_GET_STATUS: 'updater:get-status',
  UPDATER_STATUS: 'updater:status',

  // Service Manager
  SERVICE_SCAN: 'service:scan',
  SERVICE_APPLY: 'service:apply',
  SERVICE_PROGRESS: 'service:progress',

  // WinSxS Cleanup
  WINSXS_ANALYZE: 'winsxs:analyze',
  WINSXS_CLEAN: 'winsxs:clean',

  // Firewall Audit (Windows-only)
  FIREWALL_SCAN: 'firewall:scan',
  FIREWALL_APPLY: 'firewall:apply',
  FIREWALL_PROGRESS: 'firewall:progress',

  // Software Updater
  SOFTWARE_UPDATE_CHECK: 'software-update:check',
  SOFTWARE_UPDATE_RUN: 'software-update:run',
  SOFTWARE_UPDATE_PROGRESS: 'software-update:progress',

  // App Installer
  APP_INSTALLER_LIST_AVAILABLE: 'app-installer:list-available',
  APP_INSTALLER_INSTALL: 'app-installer:install',
  APP_INSTALLER_CANCEL: 'app-installer:cancel',
  APP_INSTALLER_PROGRESS: 'app-installer:progress',

  // History push events (main -> renderer)
  HISTORY_CHANGED: 'history:changed',

  // Large File Finder
  LARGE_FILES_SCAN: 'large-files:scan',
  LARGE_FILES_CANCEL: 'large-files:cancel',
  LARGE_FILES_PROGRESS: 'large-files:progress',
  LARGE_FILES_SELECT_DIR: 'large-files:select-dir',
  LARGE_FILES_DELETE: 'large-files:delete',
  LARGE_FILES_OPEN_LOCATION: 'large-files:open-location',

  // Empty Folder Cleaner
  EMPTY_FOLDERS_SCAN: 'empty-folders:scan',
  EMPTY_FOLDERS_CANCEL: 'empty-folders:cancel',
  EMPTY_FOLDERS_PROGRESS: 'empty-folders:progress',
  EMPTY_FOLDERS_SELECT_DIR: 'empty-folders:select-dir',
  EMPTY_FOLDERS_DELETE: 'empty-folders:delete',
  EMPTY_FOLDERS_OPEN_LOCATION: 'empty-folders:open-location',

  // File Shredder
  SHREDDER_SELECT_FILES: 'shredder:select-files',
  SHREDDER_SELECT_FOLDERS: 'shredder:select-folders',
  SHREDDER_SHRED: 'shredder:shred',
  SHREDDER_CANCEL: 'shredder:cancel',
  SHREDDER_PROGRESS: 'shredder:progress',
  SHREDDER_OPEN_LOCATION: 'shredder:open-location',

  // Game Mode
  GAME_MODE_ACTIVATE: 'game-mode:activate',
  GAME_MODE_DEACTIVATE: 'game-mode:deactivate',
  GAME_MODE_STATUS: 'game-mode:status',
  GAME_MODE_PROGRESS: 'game-mode:progress',
  GAME_MODE_AUTO_EVENT: 'game-mode:auto-event',
  GAME_MODE_RUN_AUDIT: 'game-mode:run-audit',

  // Platform
  PLATFORM_INFO: 'platform:info',

  // Window controls
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',

  // Windows Tweaks
  WINDOWS_TWEAKS_LIST: 'windows-tweaks:list',
  WINDOWS_TWEAKS_APPLY: 'windows-tweaks:apply',
  WINDOWS_TWEAKS_APPLY_PROGRESS: 'windows-tweaks:apply:progress',
  WINDOWS_TWEAKS_REVERT: 'windows-tweaks:revert',
  WINDOWS_TWEAKS_REVERT_PROGRESS: 'windows-tweaks:revert:progress',
  WINDOWS_TWEAKS_STATUS: 'windows-tweaks:status',
  WINDOWS_TWEAKS_SET_DNS: 'windows-tweaks:set-dns',
  WINDOWS_TWEAKS_GET_DNS: 'windows-tweaks:get-dns',
  WINDOWS_TWEAKS_NETSH_TCP: 'windows-tweaks:netsh-tcp',

  // Gaming Timer Tweaks (HPET, tscsyncpolicy, disabledynamictick, autotuning)
  WINDOWS_TWEAKS_GAMING_TIMER_GET: 'windows-tweaks:gaming-timer-get',
  WINDOWS_TWEAKS_GAMING_TIMER_SET: 'windows-tweaks:gaming-timer-set',
  WINDOWS_TWEAKS_GAMING_TIMER_REVERT: 'windows-tweaks:gaming-timer-revert',
  WINDOWS_TWEAKS_GAMING_AUTOTUNING: 'windows-tweaks:gaming-autotuning',

  // Gaming VBS / HAGS
  WINDOWS_TWEAKS_GAMING_VBS_GET: 'windows-tweaks:gaming-vbs-get',
  WINDOWS_TWEAKS_GAMING_VBS_SET: 'windows-tweaks:gaming-vbs-set',
  WINDOWS_TWEAKS_GAMING_HAGS_GET: 'windows-tweaks:gaming-hags-get',
  WINDOWS_TWEAKS_GAMING_HAGS_SET: 'windows-tweaks:gaming-hags-set',

  // DirectStorage check
  GAME_MODE_DIRECTSTORAGE_CHECK: 'game-mode:directstorage-check',
  GAME_MODE_DETECTOR_START: 'game-mode:detector-start',
  GAME_MODE_DETECTOR_STOP: 'game-mode:detector-stop',

  // Benchmark
  BENCHMARK_RUN: 'benchmark:run',
  BENCHMARK_PROGRESS: 'benchmark:progress',
  BENCHMARK_CANCEL: 'benchmark:cancel',

  // License / Activation
  LICENSE_ACTIVATE: 'license:activate',
  LICENSE_STATUS: 'license:status',
  LICENSE_GET_HWID: 'license:get-hwid',

  // Memory Optimizer
  MEMORY_INFO: 'memory:info',
  MEMORY_OPTIMIZE: 'memory:optimize',
  MEMORY_PROGRESS: 'memory:progress',

  // Power Plans
  POWER_PLANS_LIST: 'power-plans:list',
  POWER_PLANS_ACTIVATE: 'power-plans:activate',
  POWER_PLANS_CREATE: 'power-plans:create',
  POWER_PLANS_DELETE: 'power-plans:delete',

  // HOSTS Editor
  HOSTS_READ: 'hosts:read',
  HOSTS_WRITE: 'hosts:write',
  HOSTS_FLUSH_DNS: 'hosts:flush-dns',

  // Driver Agent Evaluation
  DRIVER_AGENT_EVALUATE: 'driver:agent:evaluate',
  DRIVER_AGENT_APPROVE: 'driver:agent:approve',

  // Custom YARA rules
  MALWARE_CUSTOM_RULES_LIST: 'malware:custom-rules-list',
  MALWARE_CUSTOM_RULES_ADD: 'malware:custom-rules-add',
  MALWARE_CUSTOM_RULES_REMOVE: 'malware:custom-rules-remove',

  // Report export
  MALWARE_EXPORT_REPORT: 'malware:export-report',

  // Logs
  LOGS_LIST: 'logs:list',
  LOGS_CLEAR: 'logs:clear',
  LOGS_EXPORT: 'logs:export',
  LOGS_CONFIG_GET: 'logs:config:get',
  LOGS_CONFIG_SET: 'logs:config:set',

  // Memory Scanner (Feature A)
  MALWARE_MEMORY_SCAN: 'malware:memory-scan',

  // Threat Timeline (Feature B)
  MALWARE_TIMELINE_GET: 'malware:timeline-get',
  MALWARE_TIMELINE_CLEAR: 'malware:timeline-clear',
  MALWARE_TIMELINE_STATS: 'malware:timeline-stats',

  // Threat Intel (Feature C)
  MALWARE_INTEL_CHECK_HASH: 'malware:intel-check-hash',
  MALWARE_INTEL_CHECK_DOMAIN: 'malware:intel-check-domain',
  MALWARE_INTEL_CHECK_IP: 'malware:intel-check-ip',
  MALWARE_INTEL_STATS: 'malware:intel-stats',
  MALWARE_INTEL_FEEDS: 'malware:intel-feeds',
  MALWARE_INTEL_TOGGLE_FEED: 'malware:intel-toggle-feed',
  MALWARE_INTEL_CLEAR: 'malware:intel-clear',

  // Exploit Detection (Feature D)
  MALWARE_EXPLOIT_SCAN: 'malware:exploit-scan',

  // Feature E: Cloud Backup
  MALWARE_BACKUP_CONFIG_GET: 'malware:backup-config-get',
  MALWARE_BACKUP_CONFIG_SET: 'malware:backup-config-set',
  MALWARE_BACKUP_NOW: 'malware:backup-now',
  MALWARE_BACKUP_LIST: 'malware:backup-list',
  MALWARE_BACKUP_RESTORE: 'malware:backup-restore',
  MALWARE_BACKUP_STORAGE: 'malware:backup-storage',

  // Feature F: Behavioral Sandbox
  MALWARE_SANDBOX_ANALYZE: 'malware:sandbox-analyze',

  // ─── Clips / Game Capture ────────────────────────────────
  CLIPS_GET_STATUS: 'clips:get-status',
  CLIPS_START_ENGINE: 'clips:start-engine',
  CLIPS_STOP_ENGINE: 'clips:stop-engine',
  CLIPS_START_CAPTURE: 'clips:start-capture',
  CLIPS_STOP_CAPTURE: 'clips:stop-capture',
  CLIPS_SAVE_CLIP: 'clips:save-clip',
  CLIPS_LIST_CLIPS: 'clips:list-clips',
  CLIPS_DELETE_CLIP: 'clips:delete-clip',
  CLIPS_OPEN_CLIP: 'clips:open-clip',
  CLIPS_SET_CONFIG: 'clips:set-config',
  CLIPS_GET_CONFIG: 'clips:get-config',
  CLIPS_SELECT_OUTPUT_DIR: 'clips:select-output-dir',
  CLIPS_GET_AUDIO_SESSIONS: 'clips:get-audio-sessions',
  CLIPS_SET_AUDIO_SESSIONS: 'clips:set-audio-sessions',
  CLIPS_GET_THUMBNAIL: 'clips:get-thumbnail',
  CLIPS_ENGINE_STATUS: 'clips:engine-status',
  CLIPS_GET_MIC_DEVICES: 'clips:get-mic-devices',
  CLIPS_GET_GPUS: 'clips:get-gpus',
  CLIPS_GET_RUNNING_PROCESSES: 'clips:get-running-processes',
  CLIPS_SET_FAVORITE: 'clips:set-favorite',
  CLIPS_TRIM_CLIP: 'clips:trim-clip',
  CLIPS_MERGE_CLIPS: 'clips:merge-clips',
  CLIPS_RENAME_CLIP: 'clips:rename-clip',
  CLIPS_CLIP_SAVED: 'clips:clip-saved',
  CLIPS_RAM_PRESSURE: 'clips:ram-pressure',
  CLIPS_DURATIONS_READY: 'clips:durations-ready',
  CLIPS_GET_ENHANCE_SUPPORT: 'clips:get-enhance-support',
  CLIPS_PUBLISH: 'clips:publish',
  CLIPS_PUBLISH_PROGRESS: 'clips:publish-progress',
  CLIPS_PUBLISH_CANCEL: 'clips:publish-cancel',
  CLIPS_OPEN_EXTERNAL: 'clips:open-external',
} as const
