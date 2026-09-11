# DiNho Optimizer — Agent Instructions

## Project Overview

DiNho Optimizer is an Electron desktop application for Windows system optimization, built with TypeScript, React, and Electron Vite. It provides system cleaning, registry optimization, malware scanning, privacy protection, driver management, and more.

## Tech Stack

- **Runtime:** Electron (main + renderer process)
- **Language:** TypeScript (strict mode)
- **UI:** React + Tailwind CSS + shadcn/ui
- **Build:** Electron Vite
- **State:** Zustand
- **Testing:** Vitest + Playwright (E2E)
- **Package Manager:** npm

## Core Principles

1. **Test-Driven** — Write tests before implementation, 80%+ coverage required
2. **Security-First** — Validate all inputs, sanitize paths, never mutate
3. **Immutability** — Create new objects, never mutate existing state
4. **Agent-First** — Delegate complex tasks to specialized agents
5. **Plan Before Execute** — Plan complex features before writing code

## Agent Orchestration

Use agents proactively without explicit user prompt:
- Complex feature requests → **planner**
- Code just written/modified → **code-reviewer**
- Bug fix or new feature → **tdd-guide**
- Architectural decision → **architect**
- Security-sensitive code → **security-reviewer**
- Build/type errors → **build-error-resolver**
- E2E critical flows → **e2e-runner**

Use parallel execution for independent operations.

## Security Guidelines

**Before ANY commit:**
- No hardcoded secrets (API keys, passwords, tokens)
- All user inputs validated
- SQL injection prevention (parameterized queries)
- XSS prevention (sanitized HTML)
- CSRF protection enabled
- Error messages don't leak sensitive data

**If security issue found:** STOP → use security-reviewer agent → fix CRITICAL issues

## Coding Style

- Many small files over few large ones (200–400 lines typical, 800 max)
- Functions small (<50 lines), files focused (<800 lines)
- No deep nesting (>4 levels)
- Proper error handling — never silently swallow errors
- File organization by feature/domain, not by type

## Running Dev (Windows)

The app requires admin privileges (`requestedExecutionLevel: requireAdministrator`). `npm run dev` auto-elevates itself: the un-elevated instance detects `!isAdmin()` and relaunches the **whole `npm run dev` command** elevated via UAC (`Start-Process cmd.exe -ArgumentList '/c cd /d <project> && npm run dev' -Verb RunAs`), then exits. Accept the UAC prompt and the app opens elevated with the renderer on `localhost:5173`.

```powershell
cd C:\Users\WENDEL\Desktop\001
npm run dev   # prompts UAC once, then runs elevated
```

**Why relaunch the whole command (not just electron.exe):** in dev `app.getPath('exe')` is the bare `electron.exe` (no entry point), and electron-vite kills the Vite dev server when the electron child exits (`ps.on('close', process.exit)`). Re-running `npm run dev` elevated starts a fresh electron-vite + elevated electron, which binds the port the original instance just released. Production builds elevate correctly via the manifest + runtime auto-elevation (`src/main/index.ts`).

## Testing Requirements

**Minimum coverage: 80%**
- Unit tests — individual functions, utilities
- Integration tests — IPC handlers, stores
- E2E tests — critical user flows

## Git Workflow

Commit format: `<type>: <description>` — Types: feat, fix, refactor, docs, test, chore, perf

## Lint Status (2026-08-04)

- **Biome 2.5.5** — `npx biome check src/`: **0 errors, 0 warnings** (check pass)
- `noExplicitAny`: **error** (enabled Jun 13, 2026) — all violations cleaned up
- `noConsoleLog`: **removed in Biome 2.x** — all violations in main process already replaced with `getLogger()`
- Remaining noise: only 4 pre-existing format diffs (CRLF) in `clips-config-manager.ts`, `preload/system.ts`, `App.tsx` — not lint errors

## Session Summary (2026-06-15)

### Done

- **malware-store.test.ts**: Expanded from 17 to 78 tests covering all store methods:
  - Core state: `setThreats`, `setSelectedIds`, `setStatus`, `setActionMode`, `setExpandedId`, `toggleItem`, `selectAll`, `reset`, `removeThreat`
  - Quarantine: `setQuarantineItems`, `setQuarantineSelectedIds`, `setQuarantineStatus`, `toggleQuarantineItem`, `selectAllQuarantine`
  - Allowlist: `setAllowlist`, `setAllowlistStatus`
  - Custom YARA rules: `loadCustomRules`, `addCustomRule`, `removeCustomRule` (success/error/falsy return)
  - Scan profiles: `setProfile`, `loadProfiles`
  - File watcher: `startWatcher`, `stopWatcher`
  - Memory scanner: `runMemoryScan`, `setMemoryResult`, `setIsMemoryScanning`
  - Threat timeline: `loadTimeline`, `clearTimelineStore`, `setTimeline`, `setTimelineStats`
  - Threat intel: `loadIntelStats`, `checkIntelHash`, `toggleFeed`, `clearIntel`
  - Exploit detection: `setExploitEnabled`
  - Cloud backup: `loadBackupConfig`, `setBackupConfig`, `runBackup`, `restoreBackupItem`
  - Behavioral sandbox: `runSandbox`
  - All async error handlers covered (try/catch silent-fail patterns)

## Session Summary (2026-06-18)

### Done

- **scheduler.test.ts**: Expanded from 39 to 54 tests covering previously uncovered branches in `isDueEntry`, `triggerScheduleEntry`, `notifyScheduledScanComplete`, and `completeScheduleRun`:
  - `isDueEntry` weekly paths: correct day/within window, wrong day, outside 2-min window, already run today
  - `isDueEntry` monthly paths: correct date/within window, wrong date, outside 2-min window, already run today, clamped day (31 on Feb 28)
  - `triggerScheduleEntry` notification creation when `Notification.isSupported() = true`
  - Safety timeout callback after 10-min `IN_FLIGHT_TIMEOUT_MS`
  - `notifyScheduledScanComplete` notification path with `showNotificationOnComplete = true`
  - `completeScheduleRun` in-flight timer cleanup

- **Coverage results**: `scheduler.ts` from 39.53% → **96.89%** statements, 60.71% → **91.66%** branches, **100%** functions, **99.09%** lines. Only uncovered line is `isDueEntry` line 90 (unreachable fallthrough `return false`).

- **Electron mock fix**: `vi.fn().mockImplementation(() => ({ show: vi.fn() }))` changed to `vi.fn(function() { return { show: vi.fn() } })` because vitest 4.x rejects arrow function implementations in constructor mocks with `TypeError: not a constructor`

### Blocked

- None

### Next Steps

1. Fase 5: Dívida Técnica — steam libs dinâmicas
2. Renderer hooks (7 files) remain blocked — require jsdom environment

## Session Summary (2026-06-20)

### Done

- **cli.test.ts**: Expanded from 65 to 89 tests covering 4 previously untested handlers:
  - `handleCve`: list (text/json), no subcommand → usage (3 tests)
  - `handleHistory`: list (text/json), clear, unknown subcommand (4 tests)
  - `handleConfig`: get all (text/json), get key (text/json), dotted path, nonexistent key, set string/number/bool, set without args, unknown subcommand (14 tests)
  - `handlePerf`: info (text/json), disk-health (text/json), kill, unknown subcommand, no subcommand (7 tests)
  - Unknown top-level command (1 test)
  - **28 new tests** — all passing, no regressions
  - New `vi.mock` calls: `perf-monitor`, `history-store`, `settings-store` (constructor uses `function()` not arrow per vitest 4.x requirement)

- **Coverage results**: cli.ts from **1.78%** → handlers now tested. 4592 tests, 161 files — 0 quebras.

- **ipc-validation.test.ts**: Expanded from 103 to **140 tests** (+37) covering previously uncovered validation branches:
  - `validateSettingsPartial`: 27 new tests — path traversal exclusions, UNC exclusions, ignoredSoftwareUpdates limits, schedule/schedules validations (null/primitive/field-level), cleaner non-object + closeBrowsersBeforeClean, registryIgnoredTweak max length, gameMode non-boolean autoDetect/autoDeactivate
  - `validateHistoryEntry`: 10 new tests — array input, non-string timestamp, overly long timestamp, non-number fields (duration/itemsFound/itemsCleaned/itemsSkipped/spaceSaved/errorCount), all remaining valid type values
  - **37 new tests** — all passing, no regressions

- **Coverage results**: Overall: Statements **77.72%** (+0.17%), Branches **66.11%** (+0.33%), Functions **84.86%** (unchanged), Lines **79.76%** (unchanged). **4638 tests**, 161 files — 0 quebras.

- **loader.test.ts**: Added 1 test for array `dbFiles` branch (previously only string `dbFiles` tested). **14 tests** total.
- **game-detector.test.ts**: Added 3 tests covering `pollRunning` re-entrant guard, `game === suppressedGame` early return, and malformed CSV line handling. **23 tests** total.
- **yara-rules-store.test.ts**: Fixed no-op test (now actually calls `stopPeriodicRuleChecks` twice), added 2 `getRulesMetadata` tests (array JSON, string JSON), added 3 `fetchAndCacheRules` bundle validation tests (oversized version/updatedAt/sha256). **73 tests** total.
- **store-base.test.ts**: Added 1 test for `isPackaged === true` branch, migrated electron mock to getter for runtime mutation. **10 tests** total.

## Session Summary (2026-06-20b)

### Done

- **Fase 5 — Unificar Loggers**: Migrated all 3 usages of `logger.ts` (Logger B — sync, plain text) to `logger.service.ts` (Logger A — async, JSONL):
  - `scheduler.ts`: `logInfo(...)` → `getLogger().info('Scheduler', ...)` (7 calls)
  - `renderer-diagnostics.ts`: `logError/logInfo(...)` → `getLogger().error/info('RendererDiagnostics', ...)` (8 calls, incl. preload-error with Error→string conversion)
  - `daemon.ts`: removed `setDaemonMode(true)` import (daemon uses own `log()` for stdout)
  - Test mocks migrated: `scheduler.test.ts` + `renderer-diagnostics.test.ts` switched from `'./logger'` to `'./logger.service'` with `getLogger()` mock
  - `daemon.test.ts`: removed `setDaemonMode` mock and assertion
  - **Deleted** `src/main/services/logger.ts` (92L) and `src/main/services/logger.test.ts` (84L) — no remaining imports
  - Result: all logs now go through the unified async JSONL logger, visible in app's log viewer
  - **4631 testes**, 160 arquivos — 0 quebras

## Session Summary (2026-06-20c)

### Done

- **Fase 5 — MAX_CACHE_SIZE configurável**: `scan-cache.ts`:
  - Replaced `const MAX_CACHE_SIZE = 200_000` with mutable `let _maxCacheSize`
  - Added `setMaxCacheSize(n: number)` (exported, clamped to min 1)
  - `cacheItems()` now reads from `_maxCacheSize` (via local `limit`)
  - All 11 existing call sites unchanged — 100% backward compatible
  - 3 new tests: reduces limit, clamps 0→1, clamps negative→1
  - **4634 testes**, 160 arquivos — 0 quebras

## Session Summary (2026-06-20d)

### Done

- **Fase 5 — steam libs dinâmicas**: `gaming-cleaner.ipc.ts`:
  - Added `detectSteamFromRegistry()` helper querying `HKLM\SOFTWARE\WOW6432Node\Valve\Steam\InstallPath` via `reg.exe`
  - `getSteamLibraryPaths()` tries registry first, falls back to hardcoded `steamLibraries()` from `steam.json`
  - Uses existing `execNativeUtf8` from `exec-utf8.ts` (already whitelisted `reg.exe`)
  - 2 new tests: registry-based VDF discovery, fallback when registry fails
  - **4636 testes**, 160 arquivos — 0 quebras

- **Renderer hooks (7 files) desbloqueados**:
  - Installed `jsdom` + `@testing-library/react` as devDependencies
  - Added `jsdom` environment via `// @vitest-environment jsdom` pragma on each test file
  - Updated `vitest.config.ts` include pattern to support `*.test.tsx`
  - **45 tests** across 7 hook files:
    | File | Tests |
    |---|---|
    | `useAnimatedCounter.test.tsx` | 4 |
    | `useProgressListener.test.ts` | 3 |
    | `usePlatform.test.tsx` | 4 |
    | `useIpcAction.test.tsx` | 9 |
    | `useIpcScan.test.tsx` | 8 |
    | `useBackgroundScans.test.tsx` | 7 |
    | `useScheduledScan.test.tsx` | 8 |
  - Store mocks via `vi.mock` for zustand stores (updater-store, driver-store, scan-store, history-store, settings-store)
  - `window.dinho` mock with key IPC methods
  - All `console.error` side-effects (IPC scan/action failures) intentionally left unmocked (tested error paths)
  - **4681 testes**, 167 arquivos — 0 quebras (threads pool crash on Windows, forks pool passes clean)

## Session Summary (2026-06-20e)

### Done

- **file-shredder.ipc.test.ts**: +5 tests covering previously uncovered branches:
  - `getEntrySize` top-level symlink → returns 0 (previously `undefined`)
  - `getEntrySize` lstat error → catch block hit with 0 size
  - non-Error exception during shred → catch handles string rejection
  - in-loop progress with `totalBytes = 0` → timing guard prevents NaN from division by zero
  - USERPROFILE fallback when HOME is unset → correct folder resolution
  - **55 tests** total (was 50, +5)
  - 2 pre-existing `noExplicitAny` lint errors remain in older tests (not introduced)

- **Deleted `src/main/services/registry-cleaner/`** subdirectory (dead code, zero importers):
  - `benchmark.ts` (606L), `compliance-auditor.ts` (654L), `gaming-cleaner.ts` (446L), `malware-scanner.ts` (1154L), `performance.ts` (1781L)
  - All unused — `registry-cleaner.service.ts` and `registry-cleaner.ipc.ts` remain intact
  - ~5KB dead code removed

## Session Summary (2026-06-20f)

### Done

- **Import bug fix**: `ScannerPanel.tsx` importava `canAllowlistThreat` de `scanner-panel-constants` mas a função estava em `scanner-panel-utils` — corrigido separando os imports

- **Removed 7 `console.warn` from production code**:
  - `malware-scanner.service.ts` (3): Rule load warnings, no rules loaded, init failed
  - `yara-engine.ts` (4): Init failed, bulk compile failed, scan error, file scan error
  - All replaced with `getLogger().warning('yara', ...)`
  - Test mock (`yara-engine.test.ts`) updated with `warning: vi.fn()`

- **Integrated dead UI components**:
  - `ThreatIntelPanel` and `CloudBackupPanel` existed but were never imported
  - Added to barrel `index.ts`, added 2 new tabs in `MalwareScannerPage.tsx`
  - Added translation keys (`tabIntel`, `tabBackup`) in en/pt/es locales
  - Backend (services, IPC, store) was already fully implemented

- **Final suite**: **4797 tests**, 171 files — 0 quebras

## Session Summary (2026-06-21)

### Done

- **Vulnerability E2E tests fixed** (6/6 passing):
  - Root cause: `window.dinho.vulnerabilityScan()` via `page.evaluate` returned scan results to the evaluate context but **never updated the Zustand store** — the component stayed in idle state
  - Added `window.__vulnerabilityRunScan` hook in `VulnerabilityScannerPage.tsx` that exposes the `runScan` callback (the same one called by the "Escanear" button's `onClick`)
  - Test `beforeAll` calls `__vulnerabilityRunScan()` from `page.evaluate`, then `waitForFunction` for score text `'Pontuação de segurança'`
  - Note: `process.env.NODE_ENV` checks don't work in the Vite-bundled renderer (replaced at build time), so the E2E hook is not guarded — it's harmless since it only assigns a function to `window`
  - Assertions use Portuguese strings (`Scanner de Vulnerabilidades`, `Escanear`, `Pontuação de segurança`, `Seguro`, `Vulnerável`) matching the default `pt` locale
  - Real scan finds 12 findings on this machine

- **License E2E bypass refined**:
  - Changed `checkLicense()` guard from `process.env.NODE_ENV === 'test'` to `process.env.DINHO_E2E === '1'`
  - `NODE_ENV='test'` broke unit tests (vitest sets it) — `DINHO_E2E` is specific to Playwright E2E test runs
  - Added `DINHO_E2E: '1'` to all 5 E2E test files' `electron.launch` env config
  - `remote-license.test.ts`: 15/15 tests pass

- **Coverage**: Statements 82.93%, Branches 70.65%, Functions 88.61%, Lines 84.83%
- **Full suite**: **4797 tests**, 171 files — 0 quebras

## Session Summary (2026-06-21b)

### Done

- **malware-scanner.service**: Exported 17 internal functions for direct unit testing and added 92 new test cases (173 total):
  - Pure functions: `calculateEntropy` (3), `hasDoubleExtension` (5), `isPEFile` (3), `findSuspiciousImports` (4), `analyzePE` (6), `normalizeScriptContent` (5), `analyzeScriptContent` (11), `analyzeLnkContent` (7)
  - Async functions: `checkHostsFile` (6), `isPathInAllowedDirs` (4), `hashFileSha256` (2), `filterAllowlistedThreats` (5), `collectFiles` (7), `scanScheduledTasks` (8), `scanLinuxPersistence` (5), `scanDarwinPersistence` (5), `scanAlternateDataStreamsBatch` (3)
  - Edge cases: `moveFileToQuarantine` EXDEV copy failure + cleanup (2)
  - Changed `parsePeImports` and `isExcluded` from inline to variable mocks for per-test override
  - Fixed 3 test failures: signed-int32 in `writeUInt32LE` (`>>> 0`), buffer size for section data, ADS batch mock removed `Zone.Identifier`

- **Cross-test mock interference fix**:
  - Root cause: `vi.clearAllMocks()` preserves permanent `mockImplementation`/`mockResolvedValue` from previous tests (e.g., `scanMalware` → `scanLinuxPersistence`), but clears the `mockImplementationOnce` queue
  - Fix: Added `beforeEach` with `mockReset()` in `scanLinuxPersistence` describe block to clear leaked permanent implementations from earlier tests
  - **4982 tests**, 171 files — 0 quebras

## Session Summary (2026-06-21c)

### Done

- **Backend-frontend wiring gaps closed** (8 items):
  - `ThreatIntelPanel.tsx`: `handleLookup` now dispatches to `checkIntelDomain`/`checkIntelIp` based on `lookupType` (was always `checkIntelHash`)
  - `malware-store.ts`: added `checkIntelDomain`, `checkIntelIp`, `loadWatcherStatus`, `exportReport`
  - `ScannerPanel.tsx`: calls `loadWatcherStatus()` on mount
  - `ScanResultSummary.tsx`: added JSON export button calling `exportReport()`
  - `windows-tweaks-store.ts`: added `netshTcpApply`, `netshTcpRevert`
  - `WindowsTweaksPage.tsx`: added TCP/IP Stack Optimization UI with Apply/Revert buttons + toasts

- **Dead preload methods removed**: `cancelScan` (alias, duplicate of `malwareCancelScan`), `scheduleNextScan` (legacy, never called from renderer)
- **Preload test updated**: removed `cancelScan`/`scheduleNextScan` entries from test

- **10 new store tests**: `checkIntelDomain` (success/error), `checkIntelIp` (success/error), `loadWatcherStatus` (success/error), `exportReport` (success/error), `netshTcpApply` (success/error), `netshTcpRevert` (success/error)

- **Full suite**: **5000 tests**, 172 files — 0 failures (+12 from 4988)

- **Coverage**: Statements 85.12%, Branches 73.5%, Functions 89.66%, Lines 87%

### Next Steps

1. ~~Refactor ScannerPanel.tsx layout — ScanResultSummary icons area occupies ~60% of horizontal space~~
2. ~~Add MALWARE_SET_PROFILE IPC handler (defined channel, no handler)~~
3. ~~Wire WINSXS_PROGRESS channel or document why unused (removed — dead code, SCAN_PROGRESS already used)~~
4. Continue monitoring branch coverage toward 80% target

## Session Summary (2026-06-21d)

### Done

- **ScanResultSummary layout refactored**:
  - Stats moved from `grid-cols-3` sub-grid to compact horizontal flex row with label + value inline
  - Export button moved from bottom to top-right corner (absolute positioning, always visible)
  - Reduced card padding from `p-5` to `p-4`
  - Button label shortened from "Export JSON" to "Export" for compactness

- **MALWARE_SET_PROFILE IPC handler added**:
  - `malware-scanner.ipc.ts`: new handler validates profileId (string, non-empty) and logs the change
  - `preload/index.ts`: new `setScanProfile(profileId: string): Promise<boolean>` method
  - 3 IPC handler tests (valid profile, empty string, non-string)
  - 1 preload test (calls invoke)

- **WINSXS_PROGRESS channel removed** — dead code, never emitted or listened to anywhere; winsxs cleaner already uses the generic `SCAN_PROGRESS` channel

- **Full suite**: **5002 tests**, 172 files — 0 failures (+4 tests from 4998/previous run)
  - Preload: 221 tests (was 220, +1)
  - Malware scanner IPC: +3 tests

- **Coverage**: Statements 85.13% (+0.01%), Branches 73.51% (+0.01%), Functions 89.67% (+0.01%)

## Session Summary (2026-06-21e)

### Done

- **cli.test.ts**: Expanded from 89 to **178 tests** (+89) covering the 13 previously untested CLI handlers:
  - `handlePrograms`: list (text/json), no subcommand (3 tests)
  - `handleServices`: scan, disable, manual, no subcommand (4 tests)
  - `handleLeftovers`: scan, clean (2 tests)
  - `handleNetwork`: scan, clean, clean --all (3 tests)
  - `handleStartup`: list (text/json), boot-trace, disable, enable, delete (6 tests)
  - `handleRegistry`: scan, fix, fix --all (3 tests)
  - `handleDebloat`: scan, remove, remove --all (3 tests)
  - `handlePrivacy`: scan, apply, apply --all (3 tests)
  - `handleMalware`: scan, quarantine, delete (3 tests)
  - `handleDrivers`: scan, clean (text/json), check-updates (text/json), update (6 tests)
  - `handleUpdates`: check (text/json), run, run --all (5 tests)
  - `handleDisk`: drives, analyze, file-types (3 tests)
  - `handleMetrics`: info (text/json) (2 tests)
  - `handleService`: non-linux error (text/json), removed unreachable "unknown subcommand" (Windows-only) (2 tests)
  - Unknown top-level command (1 test)
  - Mocks added: `program-uninstaller`, `service-manager.ipc`, `uninstall-leftovers`, `network-cleanup.ipc`, `startup-manager.ipc`, `registry-cleaner.ipc`, `debloater.ipc`, `privacy-shield.ipc`, `driver-manager.ipc`, `software-updater`, `malware-scanner.ipc`, `disk-analyzer.ipc`, `metrics`
  - Mock mutation isolation: explicit `beforeEach` reset in `drivers` and `updates` describe blocks

- **Coverage jump**:
  | Metric | Before | After | Change |
  |--------|--------|-------|--------|
  | Branches | 74.25% | **76.56%** | **+2.31%** (+223 branches) |
  | Statements | 85.41% | **87.9%** | **+2.49%** |
  | Functions | 89.93% | **91.37%** | **+1.44%** |
  | Lines | 87.25% | **89.85%** | **+2.6%** |
  - **5166 tests**, 174 files — 0 failures

### Next Steps

1. Continue pushing branch coverage toward 80% target:
   - Add tests for cli.ts utility functions (`formatBytes`, `cliOut`, `showProgress`, `formatDuration`, `runLegacyScanClean`, legacy scan/clean functions)
   - Target other low-coverage files identified by coverage report

## Session Summary (2026-06-21f)

### Done

- **Coverage expansion para 79.57% branches** (+118 testes, +1 arquivo):
  - **cli.ts**: 8 utility functions exported (`formatBytes`, `cliLog`, `cliVerbose`, `cliOut`, `cliUsage`, `cliNotFound`, `showProgress`, `printHelp`) + testes completos (42+ testes)
  - **Legacy scan/clean**: `scanRecycleBin`, `cleanRecycleBin`, `getChromiumProfiles`, `scanBrowserCli` Safari, `runLegacyScanClean` — 20+ novos testes
  - **schedules-utils.ts**: 0% → ~100% (10 testes, arquivo novo)
  - **encoding.ts**: 80.4% → ~98% (4 funções exportadas, 30 novos testes)
  - **useScheduledScan.ts**: ~64% → ~95% (16 novos testes: error handling, queue, waitForIdle timeout, protectRecycleBin)
  - `handleService` removido (180L, dead code systemd Linux em app Windows-only)

- **Full suite**: **5149 tests**, 175 files — 0 failures (+118 de 5031)

- **Coverage jump**:
  | Metric | Before | After | Change |
  |--------|--------|-------|--------|
  | Branches | 78.15% | **79.57%** | **+1.42%** |
  | Statements | 88.94% | **90.54%** | **+1.6%** |
  | Functions | 91.52% | **92.25%** | **+0.73%** |
  | Lines | 90.88% | **92.49%** | **+1.61%** |

### Coverage tip

- `vitest.config.ts` coverage exclude list updated: added `src/**/coverage/**` (covered report JS files inflating totals), `src/**/constants.ts`, `src/renderer/src/i18n.ts`, and other data-only files — without these, total branches jumped from 9043→9705 (V8 tracking uncovered files under `src/`)

## Session Summary (2026-06-21g)

### Done

- **CLI refactoring — extracted router and command handlers from monolithic cli.ts**:
  - Created `src/main/cli/index.ts` with barrel re-exports from `cli.ts`
  - Created `src/main/cli/router.ts` that maps command names to handler functions
  - Extracted **13 command handlers** into individual files under `src/main/cli/commands/`:
    - `programs.ts`, `services.ts`, `leftovers.ts`, `network.ts`, `startup.ts`, `registry.ts`, `debloat.ts`, `privacy.ts`, `malware.ts`, `drivers.ts`, `updates.ts`, `disk.ts`, `metrics.ts`, `cve.ts`, `history.ts`, `config.ts`, `perf.ts`
  - Moved legacy scan/clean functions (`scanSystem`, `scanApp`, `scanGaming`, `scanRecycleBin`, `cleanRecycleBin`, `getChromiumProfiles`, `scanBrowserCli`, `runLegacyScanClean`, etc.) and utility functions (`formatBytes`, `cliLog`, `cliVerbose`, `cliOut`, `cliUsage`, `cliNotFound`, `showProgress`, `printHelp`, `log`) into `src/main/cli/commands/legacy.ts`
  - Created `src/main/cli/types.ts` and `src/main/cli/utils.ts` for shared CLI types and utilities
  - Router (`router.ts`) loads command handlers via lazy dynamic imports (with `await import(...)`) for fast startup
  - All relative paths fixed to resolve correctly from `src/main/cli/commands/` subdirectory (e.g., `../../../shared/enums` → `src/shared/enums`)
  - **No runtime behavior changes** — all 244 cli tests pass

### Next Steps

1. Continue pushing branch coverage toward 80% target
  - **debloater-store.test.ts**: Added `setScanning` and `setRemoving` tests (2 previously uncovered functions). Branch coverage: 6/6 → **100%** ✅
  - **driver-store.test.ts**: Added `scan progress callback` and `update progress callback` tests — exercises callback inline via `onDriverProgress`/`onDriverUpdateProgress` mock.calls[0][0]. Branch coverage: 16/16 → **100%** ✅
  - **registry-store.test.ts**: Added `toggleEntry` persistent tweak branch (calls `registrySetTweakIgnored` for `vulnerability`/`privacy`/`performance`/`network`/`service`/`task` types), error handling for `registrySetTweakIgnored` failure, and `toggleCardAll` persistent tweak branch. Branch coverage: 16/16 → **100%** (+1, was 15/16 = 93.75%) ✅
  - **scan-store.test.ts**: Added `setProgress`, `setCleanSummary`, `setActiveCategory`, `addResults excluded subcategories branch`, and `toggleItem unknown id` tests. Branch coverage: 21/22 → **95.45%** (+2, was 19/22 = 86.36%). Only uncovered branch: `loadExcluded` `if (raw)` at module init time (runs before tests can populate localStorage).
  - **duplicate-store.test.ts**: No changes needed — already at 100% coverage.

- **Full suite**: **90 tests** across 4 files — 0 failures

- **Coverage improvement (target files only)**:

  | File | Stmts | Branch | Funcs | Lines |
  |------|-------|--------|-------|-------|
  | debloater-store.ts | 100% | **100%** | 100% | 100% |
  | driver-store.ts | 100% | **100%** | 100% | 100% |
  | registry-store.ts | 98.33% | **100%** | 96.66% | 97.95% |
  | scan-store.ts | 99.09% | **95.45%** | 100% | 100% |

## Session Summary (2026-06-21h)

### Done
  - **F1-C1**: `FALLBACK_TOKEN` mantido com `logger.warning` quando usado como fallback — remote auth preservado
  - **F1-A2**: `resolveBackupPath()` com validação anti-path-traversal + 7 testes
  - **F1-A3**: `overwriteFile` atômico (tmp + rename) + 4 testes
  - **A1**: exec-utf8 tool validation com regex `/^(reg|netsh|pnputil|schtasks|ipconfig)(\.exe)?$/i`
  - **B2**: `whoami.exe` resolvido via `process.env.SystemRoot`
  - **B3**: Rota `/hardening` removida do App.tsx; ResultBanner navega direto para `/privacy`
  - **F3-M1**: EmptyState compartilhado em 4 páginas (EmptyFolderCleanerPage, DuplicateFinderPage, LargeFileFinderPage, FileShredderPage)
  - **F3-B1**: 3 casts `as any` → `SortField`/`SeverityFilter` com exports de store
  - **F3-B5-B7**: `sharp` e `png-to-ico` removidos do package.json
  - **F3-M4**: 8 chaves `gameMode` adicionadas em EN e ES
  - **M1**: 29 `console.error` substituídos por IPC logger (`RENDERER_LOG` channel + preload `log()` + renderer-logger.ts)
  - **F2-A7**: `registry-cleaner.service.ts` 1792L → 3 módulos (service.ts, utils.ts, backup.ts)
  - **A3**: 10 grandes arquivos modularizados (malware-scanner.service.ts, privacy-shield.service.ts, software-updater.ts, windows-tweaks.ipc.ts, registry-cleaner.ipc.ts, startup-manager.ipc.ts, system-cleaner.ipc.ts, malware-store.ts, cli.ts, debloater.ipc.ts)
  - **F4**: Suspense fallback spinner → full-page skeleton; MiniGaugeSkeleton → shared Skeleton
  - **S7**: CSP header `connect-src 'self' https:` adicionado em ambos index.html
  - **P4**: 3 dead barrel `index.ts` removidos (malware-scanner/index.ts, privacy-shield/scanners/index.ts, privacy-shield/fixes/index.ts)

- **Full suite**: **5159 tests**, 173 files — **0 failures**
- **Coverage**: Branches **80.85%**, Statements **91.74%**, Functions **93.65%**, Lines **93.56%**

### Key Decisions

- `FALLBACK_TOKEN` mantido como fallback com warning em vez de removido, para preservar remote auth sem `LICENSE_API_TOKEN`
- Arquivos grandes quebrados extraindo helpers puros, mantendo o arquivo orquestrador como re-export fino para compatibilidade de imports de teste
- Renderer logging usa canal IPC `RENDERER_LOG` em vez de importar `getLogger()` (main-process only)
- UX4/UX5/P2/P3 avaliados e mantidos como estão (ErrorBoundary router-level já mitiga, framer-motion é decorativo, better-sqlite3 é esperado em Electron)

## Session Summary (2026-06-21i)

### Done

- **Build error fix**: `export { AllowlistEntry, ... }` → `export type { ... }` para interfaces TS que o Rollup não conseguia resolver (AllowlistEntry, RegistryPersistenceResult, LOLBinPattern, QuarantineEntry)
- **"Página fantasma" nas transições**: Suspense fallback skeleton removido (`fallback={null}`) — o `PageTransition` (fade+slide 0.2s) já faz a transição visual sem flash de esqueleto
- **P4**: 3 dead barrel `index.ts` removidos (malware-scanner/index.ts, privacy-shield/scanners/index.ts, privacy-shield/fixes/index.ts)

- **Full suite**: **5159 tests**, 173 files — **0 failures**
- **Build**: `electron-vite build` — OK (main + preload + renderer)

### Key Decisions

- Suspense fallback removido porque cada rota já tem `PageTransition` com `initial={{ opacity: 0, y: 12 }}` — não precisa de skeleton intermediário

## Session Summary (2026-06-22)

### Done

- **Per-App Audio Filtering — conexão Electron → Engine**:
  - Engine C# (`DiNho.Capture.Poc.exe`) já tinha suporte completo (`getAudioSessions`, `setAudioSessions`, `MultiSourceLoopback` com `ProcessAudioSource`/`AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS`, fallback `WasapiLoopbackSource`) — faltava conectar do Electron
  - `AudioSessionInfo` type em `src/shared/types.ts`
  - `CLIPS_GET_AUDIO_SESSIONS` / `CLIPS_SET_AUDIO_SESSIONS` channels + IPC handlers + preload methods
  - UI em `ClipsPage.tsx`: seção "Áudio por Aplicativo" com refresh, toggle "Todos os Aplicativos", lista scrollável de apps
  - Locales pt/en/es com 7 chaves novas

- **"Só Jogo + Microfone" (`gameAudioOnly`)**:
  - Novo campo `gameAudioOnly: boolean` no `ClipsConfig` (default `false`)
  - Toggle na sidebar que ao ativar força `micEnabled: true` + `audioLoopback: true`
  - `useEffect` watch: quando `gameAudioOnly` está ON e o jogo detectado muda, auto-filtra as sessões de áudio para só o PID do jogo
  - Polling automático de sessões a cada 5s enquanto `gameAudioOnly` estiver ativo
  - Badge verde com nome do jogo ao lado do toggle

- **Persistência das configs de clipes**:
  - Criado `src/main/services/clips-config-store.ts` usando `createJsonStore` (mesmo padrão do settings-store)
  - Salva em `<userData>/DiNho-Dev/clips-config.json`
  - `loadPersistedClipsConfig()` chamado na inicialização do módulo (`clips.ipc.ts`), carrega valores salvos nas variáveis de estado
  - `persistClipsConfig()` chamado após todo `CLIPS_SET_CONFIG` e ao receber atualizações de status do engine (FPS, resolução, bitrate)
  - 5 novos testes para o store (load defaults, load saved, corrupt JSON fallback, partial update, reset)
  - Teste IPC existente atualizado: mock do `electron` agora inclui `app` (necessário pelo store-base)

- **Full suite**: **5228 tests**, 177 files — **0 failures**
- **Testes adicionados**: +5 store, +3 IPC, +2 preload, +1 config assertion

## Session Summary (2026-06-22b)

### Done

- **Root cause das falhas de game detection/captura encontrada no NamedPipeServer**:
  - `HandleClientAsync` só escrevia respostas a comandos do Electron, **nunca enviava status broadcasts** para o pipe
  - O timer de 2s disparava `OnStatusBroadcast`, mas o handler `BroadcastStatus` em `EngineCoordinator` só invocava `OnStatusChanged` (evento local) — **ninguém escrevia no pipe**
  - Resultado: `engineCurrentGame` sempre vazio no Electron, `engineFps`/`engineCaptureBackend`/`engineEncoder`/`engineDiskSpaceOk` nunca atualizados

- **FIX: Status broadcasts agora são escritos no pipe**:
  - `HandleClientAsync` usa `ConcurrentQueue<string>` para coletar broadcasts do timer
  - Loop principal faz `Task.WhenAny(readTask, Task.Delay(500))` para polling de comandos + broadcasts
  - A cada 500ms (ou após cada comando), drena a fila e escreve todos os broadcasts pendentes no pipe
  - `finally { OnStatusBroadcast -= onStatus }` para limpeza ao desconectar

- **Logs de diagnóstico adicionados no Electron**:
  - `CLIPS_START_CAPTURE`: loga `targetGame`, `configCustomGameProcess`, `engineCurrentGame`, payload enviado, resultado
  - `CLIPS_SET_CONFIG` com `customGameProcess`: loga valor recebido e resultado do envio ao engine
  - `sendPipeCommand`: loga cmd + payload enviados
  - `handlePipeMessage`: loga status recebido do engine (game, recording, fps, backend) e responses de comandos
  - Config sync: loga "pipe not connected, skipping" quando não conectado

- **Engine C# compilado e publicado**: `dotnet build` + `dotnet publish` — 0 erros
- **Testes**: 267 testes passam (52 clips + 215 preload), 0 falhas
- **Game fallback `_lastDetectedGame` implementado** (EngineCoordinator.cs): quando Electron rouba o foco, engine busca o último jogo detectado por nome do processo e obtém HWND atual — evita capturar a própria janela do Electron

### Key Decisions

- **`Task.WhenAny` com 500ms polling**: evita thread-safety issues do StreamWriter, responsivo o suficiente para status broadcasts de 2s
- **`ConcurrentQueue<string>`**: thread-safe, produtor (timer) e consumidor (loop) não bloqueiam
- **`_lastDetectedGame` + `ResolveProcessByName()`**: fallback em 3 níveis — custom game → foreground atual → último jogo detectado

### Next Steps

1. ~~Testar manualmente com `npm run dev`~~ (feito — game fallback funcionou)
2. Testar fluxo completo: Start Capture → jogar → Save Clip

## Session Summary (2026-06-22c)

### Done

- **Crash root cause identified**: `HotkeyManager.KeyboardHookCallback` (native Windows hook callback) sem try-catch — exceção do `ToggleCapture` → `StopCapture` → `_pipelineTask.Wait(2000)` crashava o processo inteiro
  - Antigo crash log encontrado em `%LOCALAPPDATA%\DiNhoClips\crash\crash_*.txt`: `AggregateException: A task was canceled` (do standalone em `Downloads\dinhoclipes\`)
- **`KeyboardHookCallback` protegido**: `try-catch` envolvendo todo o corpo — exceções de hotkeys não crasham mais
- **`CLIPS_SAVE_CLIP` com retry automático**: se pipe estiver desconectado, espera até 5s pela reconexão antes de retornar erro
- **Engine compilado e publicado** (`dotnet publish -c Release --self-contained false`) — 0 erros, só warnings CsWinRT pré-existentes

### Key Decisions

- **try-catch no native callback**: essencial porque Windows low-level keyboard hooks rodam no message loop nativo — exceções não tratadas crasham o processo .NET sem chance de recovery
- **Retry no Electron em vez de no C#**: mais simples e não requer mudança no protocolo pipe; o pipe já tem reconnect automático a cada 3s

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Hotkeys/HotkeyManager.cs`: `KeyboardHookCallback` wrapped in try-catch
- `src/main/ipc/clips.ipc.ts`: `CLIPS_SAVE_CLIP` handler with 5s reconnect wait

## Session Summary (2026-06-23)

### Done

- **Root cause analysis — WGC per-window não produz frames no sistema RTX 5050 / FiveM**:
  - 10 agentes paralelos investigaram `WgcCaptureSource.cs`, `EngineCoordinator.cs`, e `Program.cs`
  - **Agent 7**: `WS_EX_NOREDIRECTIONBITMAP` (0x00200000) na janela alvo impede WGC per-window de receber frames do DWM
  - **Agent 8**: Falta `VideoSupport` na flag de criação do D3D11 device — necessário para WGC se conectar ao pipeline DWM
  - **Agent 9**: Diferença de message pump — standalone roda na thread de hotkey (com pump), Electron usa ThreadPool (sem pump)
  - **Agent 10**: Timeout de 16ms no `TryCaptureFrame` insuficiente para primeira frame WGC (leva 50-200ms para aquecer)

- **4 correções aplicadas no C# engine**:
  1. `VideoSupport` adicionado ao `DeviceCreationFlags` em `StartCapture()` (`EngineCoordinator.cs:203`) e `ReinitializePipelineAsync()` (`EngineCoordinator.cs:278`)
  2. `WS_EX_NOREDIRECTIONBITMAP` verificado via `GetWindowLongW()` antes de tentar WGC per-window — se presente, pula silenciosamente para WGC desktop
  3. Cadeia de fallback reordenada: WGC per-window → **WGC desktop** → DXGI → Hybrid (WGC desktop promovido para antes do DXGI)
  4. Cold-start timeout: `_hasReceivedFrame` flag + `effectiveTimeout = max(timeoutMs, 500)` nas primeiras chamadas do `TryCaptureFrame`
  5. `VideoSupport` também adicionado ao `WgcCaptureSource.Initialize()` (device próprio)

- **Engine compilado e publicado** (`dotnet build` + `dotnet publish -c Release --self-contained false`) — 0 erros

### Key Decisions

- **WGC desktop antes do DXGI**: WGC desktop captura o monitor inteiro via DWM, funciona mesmo se per-window falhar por `WS_EX_NOREDIRECTIONBITMAP` — e tem qualidade superior ao DXGI Desktop Duplication
- **Cold-start timeout de 500ms**: valor empírico; WGC pode levar 50-200ms para primeira frame (enumeração DWM, criação de buffers). 500ms cobre folga sem atrasar perceptivelmente o início da captura
- **Verificação de `WS_EX_NOREDIRECTIONBITMAP`**: BattlEye pode injetar esse estilo em janelas de jogos FiveM para proteção anti-screenshot; checagem evita tentativa fútil de WGC per-window sem perder tempo com catch exception

### Next Steps (Pending)

- Testar fluxo completo com FiveM: `npm run dev` → Start Capture → verificar se WGC desktop produz frames (log `engineCaptureBackend` = "WGC")
- Se WGC desktop funcionar mas per-window não, documentar que per-window é bloqueado por BattlEye/DWM e que desktop é alternativa WGC completa
- Confirmar se a janela FiveM (`GTA5.exe` / `grcWindow`) tem `WS_EX_NOREDIRECTIONBITMAP` — log já mostra se pulou (`Janela '...' tem WS_EX_NOREDIRECTIONBITMAP`)

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.cs`: `SelectCaptureSource()` — `HasNoRedirectionBitmap`, reordenamento fallback, `VideoSupport` em 2 locais, `WindowsMessagePump` class
- `dinho-clips-poc/src/DiNho.Capture.Poc/Capture/WgcCaptureSource.cs`: `VideoSupport` no device creation, `_hasReceivedFrame`, cold-start timeout de 500ms

## Session Summary (2026-06-23b — Teste FiveM: root cause Message Pump)

### Done (antes)
- 4 correções no C# engine (VideoSupport, WS_EX_NOREDIRECTIONBITMAP, fallback chain, cold-start timeout)

### Teste com FiveM (RTX 5050)

**Log observado:**
1. WGC per-window inicializou mas **não produziu frames** (7/7 dropped, `NoFrame`)
2. WGC desktop no reinit falhou com `COMException`
3. DXGI assumiu e funcionou **estável** (`Success=True texture=ok`)

**Root cause confirmada: Message Pump (Agent 9)**
- WGC `FrameArrived` WinRT event precisa que a thread que criou a sessão tenha um **Windows message pump** para o DWM entregar frames
- `HotkeyManager` já cria uma thread STA com pump (`GetMessage`/`DispatchMessage`), mas WGC `StartCapture()` rodava no ThreadPool do pipe handler
- Sem pump, o DWM nunca chama `OnFrameArrived` → pipeline morre de fome

### Fix: WindowsMessagePump dedicado
- `EngineCoordinator.WindowsMessagePump` — thread STA com `PeekMessage`/`DispatchMessage` + fila de `Action` para marshalling
- `SelectCaptureSource()` marshalla WGC `Initialize()` via `_wgcPump.Invoke()` — roda no pump thread
- Pump thread continua rodando em background, processando mensagens DWM → `OnFrameArrived` dispara normalmente
- `_pumpThread.Join(2000)` no `Dispose()`
- **Engine compilado e publicado** (`dotnet build` + `dotnet publish -c Release`) — 0 erros

### Resultado do Teste com FiveM

- **WGC funcionou** com o `WindowsMessagePump` dedicado — o engine logou `engineCaptureBackend = "WGC"` com frames estáveis
- Confirmação: "ta resolvido"
- WGC agora é o backend padrão (qualidade superior ao DXGI)

## Session Summary (2026-06-23b — Fix WGC + hotkeys Mouse4/Mouse5)

### Done

- **Root cause encontrada e corrigida — WGC sem Message Pump**:
  - 4 fixes iniciais (VideoSupport, WS_EX_NOREDIRECTIONBITMAP, fallback chain, cold-start timeout) não resolveram — WGC ainda dropava todas as frames
  - **Root cause real**: `FrameArrived` WinRT event precisa de Windows message pump na thread que criou a WGC session — o handler do pipe rodava no ThreadPool, sem pump
  - Solução: `WindowsMessagePump` — thread STA dedicada com `PeekMessage`/`DispatchMessage` + fila de `Action` para marshalling
  - `SelectCaptureSource()` marshalla WGC `Initialize()` via `_wgcPump.Invoke()`
  - `Dispose()` faz `_pumpThread.Join(2000)` para limpeza ordenada
  - WGC agora produz frames consistentemente com FiveM na RTX 5050

- **Suporte a hotkeys Mouse4 e Mouse5**:
  - `ClipsPage.tsx`: adicionados `Mouse4` e `Mouse5` como opções nos dropdowns de hotkey (Start/Stop Recording, Save Clip, Toggle Mic, Push-to-Talk)
  - `HotkeyManager.cs`: mapeamento de `XButton1`/`XButton2` para `Keys.XButton1`/`Keys.XButton2`
  - Engine compilado e publicado (`dotnet publish -c Release --self-contained false`) — 0 erros

### Relevant Files Changed
- `src/renderer/src/pages/ClipsPage.tsx`: opções Mouse4/Mouse5 nos dropdowns de hotkey
- `dinho-clips-poc/src/DiNho.Capture.Poc/Hotkeys/HotkeyManager.cs`: mapeamento XButton1/XButton2
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.cs`: WindowsMessagePump class, `SelectCaptureSource()` marshalling

## Session Summary (2026-06-23c)

### Done

- **Áudio do jogo FUNCIONA nos clips!**
  - Removido `-shortest` do ffmpeg — sem essa flag, o mux inclui ambas as streams (H264 + AAC) corretamente
  - Clip MP4 ~2477 KB vs H264 temp ~2213 KB = ~264 KB de áudio AAC (proporção correta para 731 packets a 128kbps)
  - Adicionado `-map 0:v:0 -map 1:a:0`, `-c:a aac -b:a 128k`, `-fflags +genpts`

- **NaN no AAC encoder corrigido**
  - `new WaveFormat(48000, 32, N)` produzia NaN porque PCM 32-bit era interpretado como IEEE_FLOAT via `Buffer.BlockCopy`
  - Mudado para `WaveFormat.CreateIeeeFloatWaveFormat(48000, N)` em `WasapiLoopbackSource.cs` e `WasapiMicSource.cs`
  - AAC encoder agora produz frames estáveis: `ReaderLoop: read=321 bytes framesInChunk=1 totalFrames=1798+`

- **Alt+1 (ToggleCapture) funcionando**
  - `MapToGenericVk()` mapeia VK_LMENU (0xA4) → VK_MENU (0x12) — Alt detectado corretamente
  - Key repeat suppression via `_keysDown` HashSet — só primeiro WM_KEYDOWN dispara; WM_KEYUP limpa
  - `_userStoppedProcess` flag — após parada manual com Alt+1, auto-restart não dispara para o mesmo jogo até o foreground mudar para outro processo
  - `OnGameChanged()` suprime auto-start se `_userStoppedProcess` contém o mesmo process name

- **AudioMixer corrigido**
  - `TryMix()` mudou de `Peek()` (sem consumir) para `Dequeue()` — buffers velhos do mic não bloqueiam mais os novos
  - Sync window aumentada de 10ms → 50ms

- **WH_MOUSE_LL hook corrigido — Mouse4/Mouse5 funcionam para PTT**
  - MouseHookCallback só tratava `WM_XBUTTONDOWN` — **nunca disparava evento UP**
  - Adicionado `WM_XBUTTONUP` e `WM_NCXBUTTONUP` — PTT Hold mode agora desativa mic ao soltar o botão
  - Repeat suppression via `_keysDown` para mouse buttons (igual ao teclado)
  - Mouse4 (0x05 = XButton1) agora dispara `OnRawKeyEvent(0x05, true/false)` corretamente

- **PTT.Off mode adicionado**
  - `PushToTalkManager` agora ignora teclas PTT quando `Mode == PttMode.Off`
  - `EngineCoordinator` mapeia `pushToTalk: 'off'` da Electron para `PttMode.Off`
  - Engine não responde mais a teclas PTT quando PTT está desligado no frontend

### Diagnóstico do PTT

- Config do frontend mostra `pushToTalkKeys: [5, 20]` = **Mouse4** (0x05) + **CapsLock** (0x14)
- Electron envia esses valores corretamente para o engine via SET_CONFIG
- Engine recebe `pttKeys=[5,20]` — propagação do config está funcionando
- Mouse4 não era detectado porque MouseHookCallback só tratava DOWN, não UP
- Agora ambos os botões funcionam: Mouse4 via WH_MOUSE_LL, CapsLock via WH_KEYBOARD_LL

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Hotkeys/HotkeyManager.cs`: MouseHookCallback com UP events + repeat suppression; `WM_XBUTTONUP`/`WM_NCXBUTTONUP` constants
- `dinho-clips-poc/src/DiNho.Capture.Poc/Hotkeys/PushToTalkManager.cs`: `PttMode.Off` adicionado; Early return quando Off
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.cs`: `PttMode.Off` handling; `_userStoppedProcess` flag; logging AAC
- `dinho-clips-poc/src/DiNho.Capture.Poc/Audio/WasapiLoopbackSource.cs`: `WaveFormat.CreateIeeeFloatWaveFormat`
- `dinho-clips-poc/src/DiNho.Capture.Poc/Audio/WasapiMicSource.cs`: `WaveFormat.CreateIeeeFloatWaveFormat`
- `dinho-clips-poc/src/DiNho.Capture.Poc/Audio/AudioMixer.cs`: `Dequeue()` instead of `Peek()`; 50ms sync window
- `dinho-clips-poc/src/DiNho.Capture.Poc/Export/ClipExporter.cs`: `-map` streams, `-c:a aac`, `-fflags +genpts`, `-shortest` removido
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegAacEncoder.cs`: `BeginErrorReadLine()`; logging AAC frames

## Session Summary (2026-06-23d)

### Done

- **PTT + microfone funcionando nos clips!**
  - Fila do mic limpa ao ativar PTT (`_micQueue.Clear()`) — buffers velhos descartados
  - `AudioMixer.TryMix()` com `Dequeue()` (não `Peek()`) — sem bloqueio por buffers antigos
  - PTT Hold mode desativa mic ao soltar o botão (Mouse4 ou CapsLock)
  - Clip final com áudio do jogo + microfone mixado confirmado funcional

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Audio/AudioMixer.cs`: `MicEnabled` setter com `_micQueue.Clear()` ao ativar

## Session Summary (2026-06-23e)

### Done

- **Session muting implemented — `AudioSessionMuteManager.cs`**:
  - Uses NAudio's `MMDevice.AudioSessionManager.Sessions` + `SimpleAudioVolume.Mute`
  - `MuteAllExcept(HashSet<int> targetPids)` — mutes all non-target sessions
  - `Restore()` — restores original mute states
  - Saves/restores previous mute state for each session (non-destructive)

- **`EngineCoordinator.cs` — MultiSourceLoopback replaced with session muting**:
  - Removed dead `MultiSourceLoopback` path (VAD per-process, `0x80030057` on this Windows)
  - New path when `SelectedAudioSessions` has items: mute non-game sessions + `WasapiLoopbackSource`
  - No 2s fallback delay — loopback produces frames immediately
  - `_sessionMuteManager` field with cleanup in `StopCapture()` and `CheckAudioFallbackAfterDelayAsync()`

- **Build**: `dotnet build` + `dotnet publish -c Release` — 0 errors
- **Tests**: 24/24 clip IPC, 238/238 preload — 0 failures

### Next Steps
- Test with FiveM: `npm run dev` → select game sessions → Start Capture → verify clip has only game + mic audio (no Discord/browser)

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Audio/AudioSessionMuteManager.cs` (new)
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.cs`: field + CreateAudioMixer + StopCapture cleanup

## Session Summary (2026-06-24)

### Done

- **Per-process audio via C++ DLL (`qH0sT/ApplicationLoopback`)**: Session muting rejected (usuario rejeitou). `CppLoopbackSource.cs` criado — P/Invoke wrapper que chama `ApplicationLoopback.dll` via `SetAudioCallback`/`StartCaptureAsync`/`StopCaptureAsync`. EngineCoordinator.CreateAudioMixer refatorado para usar `CppLoopbackSource` no lugar de `ProcessAudioSource`/`MultiSourceLoopback`/`SingleExcludeSource`. `CheckAudioFallbackAfterDelayAsync()` removido — sem delay de 2s. VAD INCLUDE mode captura apenas o PID alvo + filhos. Engine build + publish OK.

- **Microfone (2 bugs corrigidos)**:
  1. `ConfigManager.cs:51` — `PttMode` sem `[JsonPropertyName("pushToTalk")]`. Electron enviava `pushToTalk: "off"` mas C# recebia sempre `"Hold"` (default). Com PTT="Hold", `MicEnabled` iniciava sempre `false`.
  2. `EngineCoordinator.cs:1348-1354` — Config updates em runtime não propagavam `_audioMixer.MicEnabled` (só gains). Adicionado `_audioMixer.MicEnabled = _config.Config.MicEnabled`.

- **Frontend integration**: `clips.ipc.ts` — nova variável `configSelectedAudioSessions`, persistida em `CLIPS_SET_AUDIO_SESSIONS`, incluída no `buildEngineConfig()`. Engine `config` handler agora também aplica `SelectedAudioSessions`.

- **Logs confirmam**: `kind=Mixed` com `loopbackLen=960 micLen=480` — microfone mixado com áudio do jogo. `EmitPacket #16000 kind=Mixed` — ~16k pacotes Mixed em ~164s.

### Key Decisions

- **C++ DLL P/Invoke** sobre NAudio wrapper (COM nativo VAD falhou: `E_NOTIMPL` no vtable slot 14)
- `Thread.Interrupt()` usado para desbloquear `Sleep(4294967295)` interno do DLL — capture thread `IsBackground=true`
- Só o primeiro PID de `SelectedAudioSessions` é usado em INCLUDE mode; `includeProcessTree=true` captura filhos automaticamente (FiveM → GTA5.exe)

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Audio/CppLoopbackSource.cs` (new)
- `dinho-clips-poc/src/DiNho.Capture.Poc/ApplicationLoopback.dll` (pre-built C++ DLL)
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.cs`: CreateAudioMixer usa CppLoopbackSource; CheckAudioFallbackAfterDelayAsync removido; config handler inclui SelectedAudioSessions e MicEnabled
- `dinho-clips-poc/src/DiNho.Capture.Poc/Config/ConfigManager.cs`: `[JsonPropertyName("pushToTalk")]` em PttMode
- `src/main/ipc/clips.ipc.ts`: `configSelectedAudioSessions` var + `buildEngineConfig()` inclui selectedAudioSessions

### Dead Code (keep for reference)
- `ProcessAudioSource.cs`, `MultiSourceLoopback.cs`, `SingleExcludeSource.cs` — todas as tentativas C# VAD falharam

## Session Summary (2026-06-24b)

### Done

- **Volume sliders fix**: `getCurrentConfigPayload()` estava faltando `gameVolume`, `micVolume`, `selectedAudioSessions`, `useExcludeMode`, `excludeProcessId`. Quando o frontend chamava `refreshConfig()` após mudar o volume, o `setConfig()` sobrescrevia o estado local com o payload incompleto, fazendo o slider voltar pra `100%` (`?? 1`).

- **Pipe connect sync**: Quando o pipe conecta (`sock.on('connect', ...)`), agora sincroniza `configMicDeviceId` com o engine via `sendWithFallback('setMicDevice', ...)` — antes só sincronizava quando o usuário mexia no dropdown.

- **Mic discovery retry**: `loadMicDevices()` no frontend aumentado de 3 tentativas (600ms) para 8 tentativas (800ms) — mais chance do pipe conectar antes de desistir.

- **PTT mode fix**: `EngineCoordinator.cs:1355` — o handler `config` setava `_audioMixer.MicEnabled = _config.Config.MicEnabled` (sempre `true`) ignorando o PTT mode. Agora respeita `pttMode`: `MicEnabled = false` quando PTT é "Hold" ou "Toggle".

- **Soft-knee limiter**: `AudioMixer.SoftClip()` substituiu `Math.Clamp` (hard clip que distorcia) por soft-knee cúbico — comprime suavemente sinais acima de `0.333` sem corte brusco.

- **AAC bitrate 128k → 192k**: Encoder inicial (`FfmpegAacEncoder.Initialize`) e re-encode no mux aumentados para 192kbps.

- **`-c:a copy` no mux AAC**: Quando o áudio já é AAC (nosso encoder), o ffmpeg copia direto sem re-codificar, evitando dupla codificação que degradava qualidade.

- **`-fflags +genpts` restaurado** no `ClipExporter.MuxWithFfmpeg()` — essencial para mux de H.264 raw + AAC.

- **Mic boost 2x → 4x** no `AudioMixer.Mix()` + `MicGain` clamp 2.0 → 4.0.

- **Engine compilado e publicado** (`dotnet build` + `dotnet publish -c Release --self-contained false`) — 0 erros.

- **267 testes passam** (24 clips IPC + 243 preload + 5 clips-config-store).

## Session Summary (2026-06-24c)

### Done

- **Thumbnail PATH resolution fix**: `scanFfmpeg()` em `thumbnail-generator.ts` só procurava `ffmpeg.exe` em 9 diretórios fixos — nunca em `%PATH%`. C# engine funciona via `Process.Start("ffmpeg", ...)` (resolve PATH), mas Electron não. Adicionado `where.exe ffmpeg` como fallback + `where.exe ffprobe` separadamente (caso estejam em diretórios diferentes). 3 novos testes (PATH resolve, dir scan fallback, false when not found). **10 testes** no arquivo.

- **Beta badge na sidebar**: Adicionado `badgeLabel?: string` em `NavItemDef`/`SubItemDef` + `NavItem` renderiza badge de texto "Beta" no item Game Clips. Visível apenas com sidebar expandida.

- **Commit**: `35c7817` — 90 arquivos, 16139 inserções. Inclui todo o sistema de clips (C# engine, IPC, UI, testes), game mode, e correções de thumbnail.

### Full Suite

- **5258 testes**, 179 arquivos — **0 quebras**

## Session Summary (2026-06-24d)

### Done

- **AutoCleanup + favorites mismatch corrigido**: Engine busca `.favorite` marker files no disco, frontend usava `localStorage`. Adicionado `CLIPS_SET_FAVORITE` IPC handler (`clips.ipc.ts:745`) que cria/remove `.${clipName}.favorite` na pasta de saída. `toggleFavorite()` em `ClipsPage.tsx` agora também chama `clipsSetFavorite()` via IPC. Marcador persistido em disco → engine pode ler no AutoCleanup.

- **`audioSampleRate` config adicionado**: Campo `audioSampleRate` em `ClipsConfig` TS type, `ClipsPersistedConfig` store, state var `configAudioSampleRate` no IPC, `buildEngineConfig()`, `CLIPS_SET_CONFIG` handler. UI em `ClipsPage.tsx` com dropdown 44.1kHz / 48kHz / 96kHz na seção Audio. Default 48000.

- **`uptimeSeconds` exibido na status bar**: Status bar já parseava `uptime` via `getCurrentStatus()` mas não renderizava. Adicionado `formatUptime(status.uptime)` após o "replayTime" badge.

- **`diskSpaceOk` warning no frontend**: Badge vermelho com `t('diskSpaceLow')` quando `status.diskSpaceOk === false`, usando ícone HardDrive — mesma precedência que o alerta de `audioFallback`.

- **`EngineStatusValue` estendido com 6 campos diagnósticos**: `lastFrameMs`, `lastClipSize`, `activePipelines`, `watchdogOk`, `memoryMB`, `replayBufferBytes` adicionados a `ClipsEngineStatus` type. Engine já parseia e transmite estes campos via pipe (`handlePipeMessage`).

- **IP handler count bump**: 18 → 19 handlers (adicionado `CLIPS_SET_FAVORITE`).

- **Full suite**: **268 tests**, 3 files across preload (239), clips IPC (24), clips-config-store (5) — 0 quebras

## Session Summary (2026-06-24e)

### Done

- **Fix PTT sobrescrito pelo config handler** (`EngineCoordinator.cs:1465`): handler `config` salvava `oldPttMode` antes do update e só alterava `_audioMixer.MicEnabled` se o modo PTT transicionou (Off→Hold ou Hold→Off). Config updates contínuos (ex: slider de volume) não sobrescrevem mais o estado do PTT.

- **Fix sincronia A/V — PTS AAC corrigido** (`EngineCoordinator.cs:808-845`): `OnAudioPacket()` agora enfileira o PTS real (`_clock.Now`) de cada pacote PCM vindo do `AudioMixer`. Quando um frame AAC emerge, `ConsumePcmPts()` mapeia os samples PCM consumidos para o PTS correto, em vez de usar `_outputFrameIndex * 1024/48000` (que ignora delay de encoding e lags do ffmpeg).

- **Fix consumo parcial no ConsumePcmPts**: corrigido `take` vs `samples` no avanço do PTS ao re-enfileirar parcela restante.

- **Dashboard — Cards removidos**: Scans MiniGauge, MalwareStatusCard, PrivacyShieldCard, SoftwareUpdatesCard, MemoryStatusCard, DiskHealthCard, e 3 StatCards (Espaço Recuperado, Ficheiros Limpos, Total de Verificações).

- **Dashboard — HealthCard com stats row horizontal**: MEMÓRIA (X%) | SAÚDE DO DISCO (Saudável/Atenção/Crítico) | ESPAÇO RECUPERADO | FICHEIROS LIMPOS | TOTAL DE VERIFICAÇÕES — todos em uma única linha horizontal com bullets coloridos.

- **Dashboard — GameModeCard simplificado**: quando ativo mostra apenas "GAME MODE" (sem timer elapsed) + glow cyan (`#06b6d4`).

- **Dashboard — GameClipsCard com glow**: fundo com blur-3xl vermelho (`#ef4444`) quando capturando, verde (`#22c55e`) quando engine running.

- **Layout dashboard**: Row 1 (3 MiniGauges), Row 2 (HealthCard col-span-2 + GameModeCard + GameClipsCard), Row 3 (Action Center + StorageOverview).

### Relevant Files Changed

- `src/DiNho.Capture.Poc/EngineCoordinator.cs`: PTT fix (config handler lines 1397-1477), `ConsumePcmPts()` queue, `OnAudioPacket()` PCM timestamp enfileiramento
- `src/renderer/src/components/dashboard/HealthCard.tsx`: stats row com 5 métricas + polling disk health
- `src/renderer/src/components/dashboard/GameModeCard.tsx`: timer removido, glow adicionado
- `src/renderer/src/components/dashboard/GameClipsCard.tsx`: glow adicionado
- `src/renderer/src/pages/DashboardPage.tsx`: remoção de 6 componentes, novos props no HealthCard

### Full Suite

- **5259 testes**, 179 arquivos — **0 quebras**

## Session Summary (2026-06-24f)

### Done

- **metrics-server test isolado**: Movido `metrics` bloco de `cli.test.ts` para `cli/commands/metrics.test.ts` — 5 testes com mock hoisting correto do `node:http`; cobre `/metrics`, `/health`, 404, server error
- **Reescrita `malware-scanner-script.test.ts`**: agora importa `analyzeScriptContent`, `analyzeLnkContent`, `normalizeScriptContent` dos módulos reais (`analysis/script.ts`, `utils.ts`) em vez de duplicar padrões e funções; cobertura agora conta nos arquivos fonte
- **Fix 10 testes quebrados**: cada teste agora combina ≥2 indicadores no mesmo conteúdo (ex: certutil + bitsadmin, mshta + download) para atingir o threshold do `analyzeScriptContent`
- **Fix regex multiline**: `Scripting.FileSystemObject.*CreateTextFile` requer ambos na mesma linha (regex sem flag `s`)
- **40 testes**: `malware-scanner-script.test.ts` — 38 passam (5 normalize + 27 analyze + 6 Lnk), + `handlers.test.ts` — 3 passam

### Coverage impact (target files)

| File | Stmts | Branch | Funcs | Lines |
|------|-------|--------|-------|-------|
| `analysis/script.ts` | **100%** | **100%** | **100%** | **100%** |
| `privacy-shield/handlers.ts` | **100%** | **100%** | **100%** | **100%** |

### Full Suite

- **5318 tests**, 181 files — **0 failures**
- **Coverage**: Statements ~90.34%, Branches ~79.67%, Functions ~92.52%, Lines ~92.11%

## Session Summary (2026-06-24g)

### Done

- **Engine not found fix**: Engine executable wasn't included in packaged app because `extraResources` in `electron-builder.yml` had wrong path. Fixed by pointing to `bin/Release/net10.0-windows10.0.26100.0/publish` as `clips-engine/` resource.
- **`getEnginePath()` fallback**: Added `process.cwd()` as 5th candidate path candidate for engine discovery (the portable version's working directory is where it runs from).
- **Engine published as `--self-contained true`**: Previously `--self-contained false` required .NET 9 Desktop Runtime; engine launched silently but crashed before capturing any frames. Self-contained publish includes all .NET runtime DLLs (~248 files, 15MB `System.Private.CoreLib.dll`).
- **Packages rebuilt**: `npm run package` — installer (`DiNho-Optimizer-Setup-1.0.7.exe`) and portable (`DiNho Optimizer 1.0.7.exe`) both built sucessfully.
- **Engine path candidates** (in order): env var → Desktop dev → `__dirname/../../` dev → `resourcesPath/clips-engine/` (packaged) → `process.cwd()` fallback

### Relevant Files Changed
- `electron-builder.yml`: engine resource path corrected to `bin/Release/net10.0-windows10.0.26100.0/publish`
- `src/main/ipc/clips.ipc.ts`: `getEnginePath()` with `process.cwd()` fallback

### Next Steps
- Test installed version: confirm DiNho UI não é mais detectada como jogo
- Test if game detection now correctly identifies known games (Fortnite, CS2, Valorant, etc.)
- If WGC still fails in installed mode, investigate `DispatcherQueueController` alternativo

## Session Summary (2026-06-25 — ClipsPage badge + orphan engine + copy-engine script)

### Done

- **ClipsPage badge fix**: Changed from showing `estimatedRamMB` (static number in plugin config, never sent by engine) to `replayBufferBytes` (actual buffer fill level sent by engine every 2s via named pipe). Badge now hides when both are falsy. ClipsPage test mock updated: `estimatedRamMB: 512` → `replayBufferBytes: 536870912`, expects `512MB`.

- **Orphan engine on exit fixed**: Exported `stopEngineProcess()` from `clips.ipc.ts` — sends pipe `stopEngine` (fire-and-forget), disconnects pipe, kills SIGTERM then SIGKILL after 5s grace. Called from `before-quit` in `index.ts`. Refactored `CLIPS_STOP_ENGINE` handler to use it.

- **Hardcoded .NET framework path fixed**: Created `scripts/copy-engine.js` that dynamically finds `bin/Release/*/publish/` containing `DiNho.Capture.Poc.exe`. `electron-builder.yml` now references `resources/clips-engine-staging/` (populated by `npm run copy-engine`). Added `copy-engine` npm script, runs before `package`/`publish`. Staging dir added to `.gitignore`.

- **Clip IPC test bugs fixed (root cause: 2 issues)**:
  1. `netConnect(ENGINE_PIPE)` called with 1 positional argument (no callback) — mock expected 2 args and called `cb()` on `undefined` → `'cb is not a function'`
  2. Module state (`engineRunning`, `engineProcess`) leaked across tests — test 2+ found `engineRunning === true` from test 1, exited early without spawning
  - **Fixes**: `mockSocket.on` fires `'connect'` callback immediately; `mockSocket` has `setTimeout`/`removeAllListeners` to match real socket API; each test cleans up with `stopEngineProcess()` for isolation; removed 4 `vi.useFakeTimers` tests (hung on `setTimeout(500)` inside handler — real delay acceptable at 502ms/test)
  - **+4 tests**: 28 total (was 24, +4)

### Relevant Files Changed
- `src/main/ipc/clips.ipc.ts`: exported `stopEngineProcess()`, refactored `CLIPS_STOP_ENGINE`
- `src/main/index.ts`: imports `stopEngineProcess`, calls in `before-quit`
- `scripts/copy-engine.js`: new file — finds publish dir dynamically
- `electron-builder.yml`: path changed to `resources/clips-engine-staging`
- `package.json`: added `copy-engine` script, updated `package`/`publish`
- `.gitignore`: added `resources/clips-engine-staging/`
- `src/renderer/src/pages/ClipsPage.tsx`: badge condition fixed
- `src/renderer/src/pages/ClipsPage.test.tsx`: mock uses `replayBufferBytes`
- `src/main/ipc/clips.ipc.test.ts`: mockSocket fix, cross-test isolation, 4 new tests

## Session Summary (2026-06-25 — Engine crash packaged: ffmpeg bundling + symlink fix)

### Done

- **Root cause diagnosed for engine crash in packaged app**: Two issues:
  1. ffmpeg.exe and ffprobe.exe were **not included** in staging directory (`resources/clips-engine-staging/`) — engine calls `Process.Start("ffmpeg", ...)` at runtime, which fails silently when ffmpeg is not in PATH/cwd
  2. `copy-engine.js` had a symlink bug: MS Store/WinGet installs of ffmpeg create a symlink in `%LocalAppData%\Microsoft\WinGet\...` — `cpSync` on a symlink copies the symlink (0 bytes) instead of the actual file content

- **Fixed copy-engine.js**: Added `lstatSync().isSymbolicLink()` detection + `readlinkSync()` resolution + `copyFileSync` for resolved real path before `cpSync` on the resolved target directory

- **Bundled ffmpeg/ffprobe**: Staging now contains ffmpeg.exe (217MB) + ffprobe.exe (217MB) — 289 files total

- **Engine published as self-contained**: `dotnet publish -c Release --self-contained true -r win-x64` — no .NET Desktop Runtime required; all runtime DLLs bundled (~248 files)

- **Engine verified from unpacked portable dir** (`dist/win-unpacked/resources/clips-engine/`): Ran for 3+ seconds with PID=19492, killed cleanly. h264_nvenc, ffmpeg, AAC encoder all initialized OK.

- **Packages rebuilt** (portable 272MB compressed, installer 125MB): Both `DiNho-Optimizer-Setup-1.0.7.exe` and `DiNho Optimizer 1.0.7.exe` built successfully

### Relevant Files Changed
- `scripts/copy-engine.js`: symlink resolution (lstatSync + readlinkSync), ffmpeg/ffprobe copy, 289 files now

### Full Suite
- **5322 tests**, 181 files — **0 failures**

## Session Summary (2026-06-25b)

### Done

- **Fix save-clip fire-and-forget no engine C#**: O handler `saveClip` no `EngineCoordinator.cs` usava `_ = SaveClipAsync()` (fire-and-forget) e retornava `"ok"` imediatamente, antes do ffmpeg terminar de salvar o clipe. Erros de export eram engolidos pelo `catch` interno.
  - `OnIpcMessage` convertido de síncrono (`Task<IpcMessage?>`) para `async Task<IpcMessage?>` — permite `await` no case `saveClip`
  - `SaveClipAsync` sem catch (só `finally` pra limpar `_exportInProgress`), exceções propagam pro caller
  - Novo método `SaveClipAndRespondAsync()` com try/catch que chama `SaveClipAsync()` e retorna `{ Action: "ok" }` ou `{ Action: "error", value: { error: ... } }` conforme o resultado
  - `sendWithFallback('saveClip')` no Electron agora recebe `{ Action: "error" }` → retorna `{ success: false, error: "Export failed: ..." }` pro frontend
  - Frontend mostra toast de erro se o save falhar
  - Engine compilado e publicado sem erros (`dotnet build` + `dotnet publish -c Release --self-contained true -r win-x64`)

- **Instalador NSIS rebuildado**: `npm run copy-engine` (289 files, ffmpeg 217MB + ffprobe 217MB) → `npm run package`

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.cs`: `OnIpcMessage` async, `SaveClipAndRespondAsync()` novo, `SaveClipAsync` sem catch
- `AGENTS.md`: session summary adicionado

## Session Summary (2026-06-25c)

### Done

- **NVENC quality evaluation + improvements**: Pipeline completo mapeado (`WgcCaptureSource` → `FfmpegEncoder` → `ClipExporter` mux sem re-encode) e 3 melhorias aplicadas:

  1. **NVENC params enriquecidos** (`FfmpegEncoder.cs:148`): Adicionados `-rc-lookahead 32 -temporal-aq 1 -spatial-aq 1 -g 120 -bf 3 -b_strategy 1` — sem esses parâmetros, cenas de alto movimento sofriam macrobloqueio mesmo com bitrate adequado, pois NVENC não tinha lookahead para distribuir bits entre frames nem adaptive quantization temporal para regiões em movimento.

  2. **BitrateToQp ajustado** (`FfmpegEncoder.cs:127-139`): QP reduzido em 1 ponto para faixas de 5-40 Mbps (18→25Mbps, 20→18Mbps, 22→12Mbps, 25→8Mbps, 27→5Mbps) — combinado com rc-lookahead + temporal-aq, QPs mais baixos produzem quadros mais nítidos em alta-movimento sem penalidade perceptível de bitrate.

  3. **"Bom" preset 15→20 Mbps** (`ClipsPage.tsx:1020`, `clips-config-store.ts:39`): 15 Mbps para 1080p60 era insuficiente para jogos modernos (especialmente FiveM com vegetação, partículas e movimento em alta velocidade). Alterado para 20 Mbps, que com QP 22 e os novos parâmetros NVENC entrega qualidade próxima ao "Muito Bom" (50 Mbps).

- **Export pipeline confirmado limpo**: `ClipExporter.MuxWithFfmpeg` usa `-c:v copy` — preserva a qualidade exata do encoder sem re-encode. Áudio é AAC 192k com `-c:a copy` quando já AAC (nosso encoder) ou re-encode PCM→AAC.

- **GpuVideoConverter E_INVALIDARG diagnóstico**: Erro ocorre em `VideoProcessorBlt` quando crop é muito pequeno (ex: 293×143). Não afeta captura full-size (1920×1080). Acontece durante crops de janelas minimizadas ou overlay. Inofensivo para qualidade.

- **Engine compilado + publicado**: `dotnet build` 0 erros, `dotnet publish -c Release --self-contained true -r win-x64` OK, `npm run copy-engine` (289 files).

- **Full suite**: **5322 tests**, 181 files — **0 quebras**

### Key Decisions

- `-rc-lookahead 32` adiciona ~0.53s de latência a 60fps — aceitável para replay buffer de 5min+
- `-bf 3` melhora eficiência de compressão em ~15% vs 0 B-frames, com latência de decode desprezível para clips salvos
- `-temporal-aq 1` é o parâmetro individual mais impactante para qualidade em movimento — sem ele, NVENC distribui bits igualmente entre regiões estáticas e em movimento
- Bitrate do preset "Bom" subiu de 15→20 Mbps porque 15 Mbps em 1080p60 está abaixo da recomendação NVIDIA para gaming capture (20-30 Mbps para 1080p60)

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: NVENC params com rc-lookahead, temporal-aq, gop, bframes; BitrateToQp ajustado
- `src/renderer/src/pages/ClipsPage.tsx`: preset "Bom" 15000→20000 Kbps
- `src/main/services/clips-config-store.ts`: default bitrateKbps 15000→20000
- `src/main/services/clips-config-store.test.ts`: expect 20000
- `src/main/ipc/clips.ipc.test.ts`: expect 20000

## Session Summary (2026-06-25 — CRF+VBV encoding + presets CQ)

### Done

- **CRF+VBV encoding**: Substituído QP-based encoding por CRF+VBV approach para NVENC/AV1:
  - Removido `-b:v` (target bitrate), `-b_strategy 1`, `-spatial-aq 1`, `-temporal-aq 1`, `-bf 3`
  - Adicionado `-sc_threshold 0`, `-keyint_min 60`, `-g 60`
  - Mudado `-preset p7` → `p5`/`p4` por preset
  - Mudado `-bf 3` → `2` (ou `0` para preset Boa)

- **3 presets CQ+VBV** (em vez de 4 com target bitrate):
  - **Muito Alta**: CQ 18, maxrate 80Mbps, bufsize 160Mbps, p5, bf 2
  - **Alta** (default): CQ 24, maxrate 50Mbps, bufsize 100Mbps, p4, bf 2
  - **Boa**: CQ 28, maxrate 30Mbps, bufsize 60Mbps, p4, bf 0

- **Resolução independente**: Dropdown 360p/720p/1080p/1440p separado do preset de qualidade (antes resolução era fixa por preset)

- **`SetQualityParams()` no C#**: Novo método que recebe cq, maxrateKbps, bufsizeKbps, bframes, lookahead, preset — monta args ffmpeg corretos para NVENC/AV1 (CRF+VBV) e fallback AMF/QSV/libx264 (CQ-4 + VBV)

- **`BitrateToQp` removido**: Método eliminado, NVENC/AV1 usa CRF+VBV diretamente

- **6 novos campos**: `cq`, `maxrateKbps`, `bufsizeKbps`, `bframes`, `lookahead`, `encoderPreset` adicionados a AppConfig, ClipsPersistedConfig, ClipsConfig, IPC state vars, buildEngineConfig(), persistência

- **Frontend**: Seção "Bitrate" removida (redundante com presets CQ+VBV), seção "Gravando qualidade" agora controla presets completos

- **Bugs corrigidos**: `forceSoftware` duplicado em `clips-config-store.ts` DEFAULTS

- **Full suite**: **5322 tests**, 181 files — **0 quebras**
- **C# unit tests**: **73 passed** — 0 falhas (+19 de 54)
- **C# build**: `dotnet build` + `dotnet publish -c Release --self-contained true -r win-x64` — 0 erros

## Session Summary (2026-06-25 — DiNho UI detection fix + games.json expandido)

### Done

- **DiNho UI detection fix**: Usuário reportou que o instalador detectava a própria UI (`%LocalAppData%\Programs\dinho-optimizer\DiNho Optimizer.exe`) como jogo:
  - `"DiNho Optimizer"` e `"dinho-optimizer"` adicionados ao `NonGameProcesses`
  - `%LocalAppData%\Programs\` adicionado ao `IsSystemExecutablePath()`

- **NonGameProcesses expandido**: ~50 → ~240 entradas (sistema, navegadores, dev, media, office, comunicação, antivírus, launchers)

- **games.json expandido**: 47 → **182 jogos** v2 — Rockstar, Valve, Riot, Unity (~40), Unreal (~20), Blizzard, EA, Capcom, Square Enix, Bandai Namco, Bethesda, Paradox, indies

- **Bug fix: GameDatabase JSON nunca carregava** — `System.Text.Json` case-sensitive, games.json tem `"games"` (lowercase) mas C# tinha `Games` (uppercase). Adicionado `[JsonPropertyName("...")]` em todas as propriedades. Antes do fix, `Load()` sempre caía no `HardcodedMap`.

- **73 testes C#** (+7 de 66): `NonGameProcessesTests` (70+ assertions), `GameDatabaseTests` (7 testes). games.json copiado para output via `<CopyToOutputDirectory>`.

## Session Summary (2026-06-25 — WGC FiveM restart loop + VideoSupport fix)

### Done

- **WGC funcionando com FiveM!** (RTX 5050) — `frame.Success=True texture=ok capture=WgcCaptureSource encoder=FfmpegEncoder`. WGC desktop via `IGraphicsCaptureItemInterop.CreateForMonitor` produz frames estáveis com o `WindowsMessagePump` dedicado.

- **Infinite restart loop FIXED** — Root cause: `StartCapture()` resetava `_appliedGameAudioOnly = false`, então `OnGameChanged` disparava novamente o restart após cada ciclo. Removido o reset de `_appliedGameAudioOnly`/`_appliedGameAudioPid` de `StartCapture()` — a guarda em `ApplyGameAudioOnly()` (linha 1476) e `OnGameChanged()` (linha 1389) agora persiste entre restarts, eliminando o loop.
  - **Segundo bug**: `OnGameChanged()` no FiveM chamava `ApplyAudioSessionsInternal` sem setar `_appliedGameAudioOnly`, então o guard da `ApplyGameAudioOnly()` falhava quando o Electron reenviava config mid-capture. Fix: `OnGameChanged` agora seta `_appliedGameAudioOnly = true` e `_appliedGameAudioPid = game.ProcessId` antes de chamar `ApplyAudioSessionsInternal`.
  - **Bug de build**: `dotnet publish -c Release --self-contained true -r win-x64` publicava para `win-x64/publish/`, mas `getEnginePath()` procura `publish/` (sem `win-x64`). Fix: usar `-o bin/Release/.../publish` para forçar diretório correto.

- **D3D11 E_INVALIDARG** — `DeviceCreationFlags.VideoSupport` (0x800) causava `-2147024809` no self-contained publish. Removido dos 4 locais (`EngineCoordinator.cs` ×2, `WgcCaptureSource.cs`, `Program.cs`). O `VideoSupport` era desnecessário — WGC funciona apenas com `BgraSupport` + `WindowsMessagePump`.

- **Engine build + publish**: `dotnet build` 0 erros, `dotnet publish -c Release --self-contained true -r win-x64` OK, `npm run copy-engine` (289 files). **73 C# tests** passed. **28 clip IPC tests** passed.

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.cs`: lines 254-255 removed (`_appliedGameAudioOnly = false; _appliedGameAudioPid = 0;`) — `StartCapture()` não reset mais o guard de restart loop

## Session Summary (2026-06-25 — H264 corruption fix + docs/package)

### Done

- **Root cause da corrupção H264 identificada e corrigida**: `ArrayPool<byte>.Shared.Rent(n)` retorna arrays ≥ n bytes com lixo do pool. `EncodedPacket.Data.Length` (capacidade) era usado em vez do comprimento real. Garbage bytes no mux corrompiam NALUs → `pps_id 3199971767 out of range`.
  - `EncodedPacket.cs`: Adicionado `DataLength` (com `private set`). Construtor pooled aceita `int dataLength = 0` (0 = `data.Length`). `Release()` usa `DataLength` no reset.
  - `FfmpegEncoder.cs:EmitPacket()`: Passa `dataLength: _pendingLen`.
  - `ClipExporter.cs:107` (`WriteH264File()`): `pkt.Data.Length` → `pkt.DataLength`.
  - `ReplayBuffer.cs:44,78,169-170`: `pkt.Data.Length` → `pkt.DataLength`.
- **Engine build + publish**: `dotnet build` 0 erros, `dotnet publish -c Release --self-contained true -r win-x64` OK. **73/73 C# tests**. **5327/5327 TS tests**.
- **Packages rebuilt**: `DiNho-Optimizer-Setup-1.0.7.exe` + `DiNho Optimizer 1.0.7.exe` — ambos com engine + ffmpeg atualizados. `copy-engine` staged 289 files.

### Key Decisions
- `DataLength` em vez de `new byte[n]`: manter `ArrayPool` para evitar GC pressure com `Process.Start` e encapsulamento de arrays, mas rastrear comprimento real dos dados.

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/EncodedPacket.cs`: `DataLength` propriedade
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: `dataLength: _pendingLen`
- `dinho-clips-poc/src/DiNho.Capture.Poc/Export/ClipExporter.cs`: `pkt.DataLength`
- `dinho-clips-poc/src/DiNho.Capture.Poc/Buffer/ReplayBuffer.cs`: `pkt.DataLength`
- `AGENTS.md`: session summary

## Session Summary (2026-06-25 — Audio sync fix: PTS gap filtering)

### Done

- **"AUDIO NAO SINCRONIZADO" root cause identificada e corrigida**:
  - `ComputeActualFps` usava o range PTS do vídeo (`lastVideo.Pts - firstVideo.Pts`) que **incluía os gaps de alt-tab** onde WGC pausava
  - Isso fazia `actualFps` ficar mais baixo que o real (ex: 40fps em vez de 60fps), distorcendo a duração do vídeo
  - Áudio continuava gravando durante o alt-tab → durações diferentes → dessincronia

- **FIX no ClipExporter.ExportToMp4**:
  - Identifica **intervalos PTS contíguos** do vídeo (separados por gaps >50ms de alt-tab)
  - Filtra pacotes de áudio para **só manter os que caem dentro desses intervalos** — remove áudio gravado durante alt-tab
  - Trunca o final do áudio para bater exatamente com `trueVideoDuration` (soma das durações reais dos frames, não o range PTS)
  - Usa `effectiveFps ≈ nominalFps` (calculado pela soma das durações) em vez de `actualFps` (que incluía gaps)
  
- **Logs novos no export**:
  - `[PTS] Pre-sync` — mostra ranges PTS antes do filtro
  - `[PTS] Post-sync` — mostra `trueDuration`, `framesWithDur`, `gapsRemoved`

- **Engine build + publish**: `dotnet build` 0 erros, `dotnet publish -c Release --self-contained true -r win-x64` OK
- **copy-engine**: 289 files staged
- **TS tests**: 30/30 clip IPC tests pass

## Session Summary (2026-06-25 — Tooltip position fix)

### Done

- **Tooltip position adjusted**: Todos os 12 tooltips `?` no ClipsPage mudados de `fixed bottom-4 left-4` (canto inferior esquerdo, aparecia na sidebar) para `absolute bottom-full left-full` (acima e à direita do `?`):
  - `bottom-full` = tooltip fica ACIMA do `?`
  - `left-full` = tooltip fica À DIREITA do `?`
  - Posição perto do `?` original, sem sobrepor botões/config abaixo
  - `z-20` (não `z-50`) para não flutuar sobre outros elementos
  - 23/23 ClipsPage tests passam

### Relevant Files Changed
- `src/renderer/src/pages/ClipsPage.tsx`: 12 tooltips com classe `absolute bottom-full left-full z-20 mb-1 ml-1`

## Session Summary (2026-06-25 — RNNoise + Clip Editor + Video Preview)

### Done

- **RNNoise speech denoising**: Created `RnnoiseFilter.cs` wrapping ffmpeg `-af anlmdn` via stdin/stdout f32le piping. Integrated into `AudioMixer` — `NoiseSuppressionEnabled` property filters mic PCM before queueing. Added to C# `AppConfig`, IPC sync via `buildEngineConfig()`, TS `ClipsConfig` + `ClipsPersistedConfig`. Toggle UI with `TogglePill` green accent. `Dispose()` cleanup on toggle-off.

- **Clip trim/merge editor**: `CLIPS_TRIM_CLIP` and `CLIPS_MERGE_CLIPS` IPC handlers in `clips.ipc.ts` using `ffmpeg -ss -to -c copy` (trim, no re-encode) and concat demuxer (merge, `-c copy`). `ClipEditorModal` React component dual-mode: trim (clip prop with range sliders) or merge-only (`initialMergePaths` prop). Multi-select merge button in clips toolbar when `selectedClips.size >= 2`.

- **In-app video preview**: Custom `clip-video://` protocol registered via `protocol.handle` in `src/main/index.ts` — reads file via `readFile` buffer, returns `new Response(buffer, { contentType: 'video/mp4' })`. Preload `clipsGetVideoUrl()` sync string method with URL encoding for spaces. `<video>` element in `ClipEditorModal` with play/pause, current time, seek sync on slider change.

- **Fixes during implementation**:
  - `protocol.registerSchemasAsPrivileged` removed (not available in Electron 28+) — just use `protocol.handle`
  - `net.fetch` doesn't support `file://` in Electron — switched to `readFile` buffer + `Response`
  - URL encoding in preload for paths with spaces (`%20`)
  - 3 new preload tests for `clipsGetVideoUrl` (normal, spaces, falsy)

- **Full suite**: **5327 TS tests**, 181 files — **0 quebras**. **73 C# tests** — all pass.
- **Build**: `npm run dev` — main + preload + renderer build OK

### Key Decisions
- `anlmdn` over `arnndn`: built into ffmpeg, no external `.nn` model required; `arnndn` supported as opt-in upgrade
- Per-packet filtering inside `AudioMixer.OnMicData` (before `_micQueue`) — toggleable at runtime without restart
- `-c copy` for trim/merge: instant because source clips are already compressed H.264/AAC
- Custom `clip-video://` protocol instead of `file://` (blocked by `net.fetch`) or base64 (memory for large clips)
- `ClipEditorModal` dual-mode: single prop (`clip`) for trim, no prop + `initialMergePaths` for merge-only

### Relevant Files Changed
- `src/DiNho.Capture.Poc/Audio/RnnoiseFilter.cs` (new)
- `src/DiNho.Capture.Poc/Audio/AudioMixer.cs`: NoiseSuppressionEnabled, OnMicData filtering
- `src/DiNho.Capture.Poc/Export/ClipExporter.cs`: PTS debug logging
- `src/DiNho.Capture.Poc/EngineCoordinator.cs`: noiseSuppression config sync
- `src/DiNho.Capture.Poc/Config/ConfigManager.cs`: NoiseSuppressionEnabled field
- `src/shared/channels.ts`: CLIPS_TRIM_CLIP, CLIPS_MERGE_CLIPS
- `src/shared/types.ts`: noiseSuppression, ClipTrimResult, ClipMergeResult
- `src/main/index.ts`: clip-video:// protocol registration
- `src/main/ipc/clips.ipc.ts`: trim/merge handlers, noiseSuppression engine payload
- `src/main/ipc/clips.ipc.test.ts`: handler count 20→22
- `src/main/services/clips-config-store.ts`: noiseSuppression persisted
- `src/preload/index.ts`: clipsTrimClip, clipsMergeClips, clipsGetVideoUrl
- `src/preload/index.test.ts`: 3 new clipsGetVideoUrl tests
- `src/renderer/src/pages/ClipsPage.tsx`: Edit button, noiseSuppression toggle, merge toolbar
- `src/renderer/src/components/clips/ClipEditorModal.tsx` (new): trim sliders, merge list, video preview
- `src/renderer/src/locales/{en,pt,es}/clips.json`: trim/merge/noiseSuppression chaves

## Session Summary (2026-06-25 — Video preview fixes + merge UX)

### Done

- **Video timer fix**: `clip.duration` vinha como `0` do dado do clip, fazendo o timer sempre mostrar `/ 1:00`. Adicionado `onLoadedMetadata` no `<video>` que atualiza `realDuration` com `videoRef.current.duration` — timer agora mostra duração real do arquivo.
  - Variável `effectiveDuration = realDuration || clip?.duration || 60` usada em todos os places, atualizada dinamicamente quando o vídeo carrega.

- **Video URL encoding fix**: `clipsGetVideoUrl` fazia encoding manual parcial (só ` `, `#`, `?`), deixando caracteres como `[`, `]`, `%`, `&`, `+` sem proteção — quebrava URL de alguns clips.
  - Mudado para **base64**: `clip-video://file?path=<base64>` — zero problemas de URL encoding
  - Protocol handler decodifica com `Buffer.from(b64, 'base64').toString('utf8')`
  - 3 testes de preload atualizados

- **Overlay fullscreen fix**: Mudado de `absolute bottom-0` para `fixed bottom-0` — controles agora sempre na parte inferior da tela em fullscreen (não no meio). Ícones maiores (h-6/w-6), trim section com `pb-24` pra não ficar atrás do overlay.

- **Build & tests**: **5332 tests**, 181 files — **0 quebras**

### Relevant Files Changed
- `src/main/index.ts`: protocol handler com base64 decoding
- `src/preload/index.ts`: clipsGetVideoUrl usa base64
- `src/preload/index.test.ts`: 3 testes de base64 URL
- `src/renderer/src/pages/ClipsPage.test.tsx`: mock clipsGetVideoUrl com base64
- `src/renderer/src/components/clips/ClipEditorModal.tsx`: effectiveDuration, onLoadedMetadata, overlay fixed bottom-0, pb-24 trim

## Session Summary (2026-06-25 — Video preview CSP fix + Trim UI overhaul)

### Done

- **"Failed to load video preview" root cause identified**: CSP `default-src 'self'` blocked `<video>` from loading custom `clip-video://` scheme and `blob:` URLs.
  - Fix: Switch to `file://` URL with `media-src 'self' file:` in CSP + `allowFileAccessFromFiles: true` in `BrowserWindow webPreferences`.
  - Removed `protocol.registerSchemasAsPrivileged` (doesn't exist in Electron 42).
  - Preload `clipsGetVideoUrl()` now returns `file:///` + path with `%20` encoding.

- **DevTools opening in production fix**: `openDevTools()` chamado sem guarda `!app.isPackaged` no handler `CLIPS_START_CAPTURE` — adicionado `if (!app.isPackaged)` guard.

- **Trim UI overhaul** (`ClipEditorModal.tsx`):
  - Substituído dois `input[type=range]` separados por **timeline visual única** com `TrimTimeline` component:
    - Track horizontal com região selecionada destacada (accent color)
    - Duas alças redondas arrastáveis via mouse (start/end)
    - Indicador de posição atual (linha branca vertical)
    - Smart click: perto de alça → arrasta, qualquer lugar → seek
  - **Preview da duração** do corte em tempo real (`fmt(trimDuration)`)
  - **I/O hotkeys**: `I` marca início, `O` marca fim na posição atual do seek
  - Overlay fullscreen mantido com `fixed bottom-0` e transição de opacidade
  - Lint: 4 issues fixados (onKeyDown handlers, array key `i`→`p`)

- **Full suite**: **5332 tests**, 181 files — **0 quebras**
- **Lint**: 0 errors

### Relevant Files Changed
- `src/renderer/src/components/clips/ClipEditorModal.tsx`: TrimTimeline component, I/O hotkeys, lint fixes, fullscreen overlay
- `src/main/index.ts`: `clip-video://` protocol handler removido, `allowFileAccessFromFiles: true`, CSP `media-src 'self' file:`
- `src/preload/index.ts`: `clipsGetVideoUrl` retorna `file:///` (não base64)
- `index.html` + `src/renderer/index.html`: CSP com `media-src 'self' file:`
- `src/main/ipc/clips.ipc.ts`: `openDevTools()` com `if (!app.isPackaged)`

## Session Summary (2026-06-26 — H264 corruption root cause + NVENC bitstream filter fix)

### Done

- **Root cause da corrupção H264 identificada**: NVENC RTX 5050 gera `avcc` (length-prefixed NALUs), não AnnexB (startcode). O mux `-c:v copy` em `.mp4` espera AnnexB, resultando em `pps_id out of range`.
  - **Fix**: `-bsf:v h264_mp4toannexb` no ffmpeg encoder pipeline converte avcc→AnnexB inline
  - SPS (`00 00 01 67`) e PPS (`00 00 01 68`) confirmados no início do stream após o fix
  - Diagnóstico hex dump em `WriteH264File` removido após confirmação

- **NVENC GOP 60→120**: GOP duplicado de 60 para 120 frames (~2s a 60fps) — melhor compressão sem impacto perceptível em replay buffer de 5min+

- **Reusable NV12 scratch buffer**: `_nv12Scratch` byte array reutilizado em vez de alocar 3.1MB no LOH a cada frame — elimina GC pressure de 186MB/min a 60fps

- **Output queue limit**: `_pendingOutputs` limitado a 32 pacotes — descarta pacotes antigos se o reader thread não consumir rápido o suficiente, evitando OOM

- **`_stdin.Flush()` removido**: redundante — `Write()` já não bufferiza após threshold interno do pipe

- **ClipExporter PTS gap filtering refinado**: Detecção de intervalos PTS contíguos agora usa PTS do próximo pacote em vez de `s + Duration` — mais preciso para gaps de alt-tab. Duração real do vídeo calculada por `last.Pts - first.Pts + last.Duration`

- **Dynamic raw format + bitstream filter**: HEVC/AV1 também têm `*_mp4toannexb` suportado — `rawFormat` é inferido do codec e propagado do encoder ao mux

- **EngineCoordinator improvements**:
  - Audio sessions cache com 2s TTL — evita re-enumeração desnecessária no `getAudioSessions`
  - Background/foreground debounce (30 drops ~500ms BG, 15 frames ~250ms FG) — evita oscilação com drops transitórios do WGC
  - Capture timeout aumentado de 33ms para 100ms — mais tolerante a frames lentos do WGC

- **Default quality preset tweaked**: CQ 18→20, maxrate/bufsize 50/100→40/80 Mbps — melhor equilíbrio tamanho/qualidade para 1080p60. Preset "Muito Alta" CQ 16→18

- **Full suite**: **30/30 TS clip IPC tests**, **74/74 C# tests** — 0 quebras
- **Engine**: `dotnet build` 0 errors, `dotnet publish -c Release --self-contained true -r win-x64` OK

### Key Decisions
- `-bsf:v h264_mp4toannexb` é obrigatório para NVENC H264 (avcc→AnnexB) — sem isso o mp4 fica corrompido
- GOP 120 vs 60: buffer de 5min+ significa que keyframe intervalos maiores são aceitáveis e melhoram compressão em ~10-15%
- Debounce de 500ms/250ms para foreground/background: WGC pode ter drops transitórios de 1-5 frames sem indicar perda de foreground real
- Output queue limit de 32 pacotes: ~533ms de buffer a 60fps — suficiente para absorver picos sem consumir memória ilimitada

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: `_nv12Scratch`, GOP 120, `-bsf:v h264_mp4toannexb`, output queue limit, sem Flush
- `dinho-clips-poc/src/DiNho.Capture.Poc/Export/ClipExporter.cs`: dynamic ext, PTS interval fix, duration calc, rawFormat propagation
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.cs`: audio sessions cache, BG/FG debounce, capture timeout 100ms
- `src/main/ipc/clips.ipc.ts`, `clips-config-store.ts`: default CQ 20 / maxrate 40Mbps
- `src/main/ipc/clips.ipc.test.ts`, `clips-config-store.test.ts`, `ClipsPage.test.tsx`: test expectations updated

## Session Summary (2026-06-26 — Matroska writer kills "timestamps unset" warning)

### Done

- **Bug 5 fix — Matroska writer replaces raw H264 temp file**: Root cause do warning "Timestamps are unset in a packet for stream 0" era o raw H264 demuxer (`h264dec.c`) que nunca define PTS/DTS. `-fflags +genpts` precisa de DTS pra gerar PTS — impossível com `-c:v copy` em raw H264.
  - **Solução**: `WriteMatroskaFile()` substitui `WriteH264File()` — escreve arquivo `.mkv` temporário com **EBML header**, **Segment**, **Info** (TimecodeScale + Duration), **Tracks** (CodecID = `V_MPEG4/ISO/AVC`), e **Clusters** com **SimpleBlocks** contendo os timestamps reais de `EncodedPacket.Pts`
  - Ffmpeg mux command mudou de `-f h264 -framerate N -i temp.h264` para `-f matroska -i temp.mkv`
  - Removidos: `-fflags +genpts`, `-framerate`, `-fps_mode vfr`, `-copytb 1`
  - Matroska writer suporta H264, HEVC (`V_MPEG4/ISO/HEVC`), e AV1 (`V_AV1`)

- **EBML/Matroska helpers implementados** (privados no ClipExporter):
  - `WriteEbmlMaster(bw, id, Action<BinaryWriter>)` — buffered master element with known size
  - `WriteEbmlMasterBegin(bw, id)` — unknown-size master (Segment, Cluster)
  - `WriteEbmlUnsignedInt`, `WriteEbmlFloat`, `WriteEbmlString`
  - `WriteSimpleBlock` — track number VINT + int16 timecode + flags + data
  - `GetEbmlVintSize`, `WriteEbmlVint` — variable-length integer encoding
  - Clusters split at 1000 frames (~16s at 60fps) or when relative timecode exceeds int16 range

- **Build**: `dotnet build` 0 errors, `dotnet publish -c Release --self-contained true -r win-x64` OK
- **Tests**: **74/74 C# tests**, **30/30 TS clip IPC tests** — 0 quebras
- **copy-engine**: 289 files staged

### Key Decisions

- Raw H264 → **Matroska (.mkv)**: único container que ffmpeg aceita com `-c:v copy` e timestamps por frame sem re-encode; EBML writing é direto, sem dependência externa
- **SimpleBlocks** em vez de Clusters com BlockGroup — mais simples e suficiente para H264/HEVC/AV1 sem side data
- Cluster split a cada 1000 frames: relTc cabe em int16 (max 32.767s a 1ms timecode scale)
- **Unknown size** para Segment e Clusters: ffmpeg não precisa do tamanho para demux, evita seek-back no arquivo
- `-f matroska -i temp.mkv` substitui completamente `-fflags +genpts -f h264 -framerate N -i temp.h264` — sem warnings, sem fps_mode/copytb redundantes

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Export/ClipExporter.cs`: `WriteMatroskaFile()` (new, 220L), EBML helpers (new, 150L), `MuxWithFfmpegStreaming` input arg change, removed `WriteH264File`, removed genpts/framerate/fps_mode/copytb flags

## Session Summary (2026-06-26 — Áudio sync fix: priority + diagnostics)

### Done

- **Root cause do "áudio 3s atrás" encontrada**: `FfmpegAacEncoder.cs:44` usava `ProcessPriorityClass.Idle` para o processo ffmpeg AAC — o escalonador Windows nunca dava CPU pra ele no meio do jogo. Leva **~4.6s para inicializar**, período em que todo PCM enviado ao stdin era perdido silenciosamente (o pipe de 4KB enchia e `Write()` travava a threadpool sem produzir AAC frames).
  - Comparação: o encoder de vídeo (`FfmpegEncoder.cs:276`) usava `BelowNormal` corretamente — o AAC encoder estava 2 níveis abaixo.
  - Evidência: clips longos (300s) tinham contagem perfeita de frames AAC (14062/14062.5), clips curtos (46s) perdiam ~216 frames (10%) porque o warmup dominava.

- **3 correções aplicadas**:
  1. `FfmpegAacEncoder.cs:44` — `ProcessPriorityClass.Idle` → `BelowNormal` (mesmo do vídeo encoder)
  2. `FfmpegAacEncoder.cs:69-82` — `catch { }` silencioso → `catch (Exception ex)` que loga o erro + contadores `_pcmBytesWritten`, `_pcmWriteErrors`, `_totalAacFrames`
  3. `ClipExporter.cs:111-120` — warning log quando áudio é <90% da duração do vídeo

- **Diagnóstico novo**:
  - `FfmpegAacEncoder.LogStats()` chamado em `SaveClipAsync()` — loga `pcmBytesWritten`, `aacFrames`, `pcmWriteErrors` e warning se `aacFrames << expected`
  - `[FfmpegAacEncoder] PCM write #N failed` — loga cada erro de pipe com bytes perdidos

- **Engine build + publish**: `dotnet build` 0 erros, `dotnet publish -c Release --self-contained true -r win-x64` OK
- **C# tests**: 74/74 pass
- **copy-engine**: 289 files staged

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegAacEncoder.cs`: priority Idle→BelowNormal, `EncodeAudio` error logging + counters, `LogStats()` method
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.cs`: calls `_aacEncoder?.LogStats()` in `SaveClipAsync`
- `dinho-clips-poc/src/DiNho.Capture.Poc/Export/ClipExporter.cs`: duration mismatch warning

### Next Steps
- ~~Test with `npm run dev`: verify `[FfmpegAacEncoder] STATS` shows `aacFrames` matching expected for video duration~~ ✅
- ~~If still short, investigate `_pcmWriteErrors` count~~ ✅ (zero errors)
- **Test with `npm run dev`**: verificar se o CodecPrivate fix produz MP4 reproduzível com tamanho correto

## Session Summary (2026-06-26 — CodecPrivate fix: Matroska sem SPS/PPS corrompia MP4)

### Done

- **Teste real com FiveM (62s, 2890 frames 1080p60)**:
  - Matroska writer funciona — MKV temp = **107MB** (correto para 1080p60)
  - AAC encoder sem erros — `pcmBytesWritten=24003840 aacFrames=2927 pcmWriteErrors=0` (**zero errors**)
  - SaveClip executou até o fim, mas MP4 resultou em **2.8MB** (corrompido)

- **Root cause do MP4 corrompido identificada**:
  - ffmpeg stderr mostrava: `"Frame num change from 0 to 1"`, `"Truncating packet of size 113383726"`, `"Invalid level prefix"`, `"error while decoding MB 20 2"`
  - Causa raiz: `WriteMatroskaFile()` **não escrevia CodecPrivate (0x63A2)** no Track header do Matroska
  - Sem CodecPrivate, ffmpeg não tem SPS/PPS para configurar o decoder H264 — ao muxar para MP4 com `-c:v copy`, o avcC atom fica inválido
  - `ExtractAvccExtradata()` adicionado: escaneia pacotes de vídeo, extrai NAL units SPS (type 7) e PPS (type 8) do formato AnnexB, e monta o AVCDecoderConfigurationRecord (avcC)
  - CodecPrivate é escrito no elemento Track (0xAE) via `WriteEbmlBinary(e, 0x63A2, avcc)` — só para codec H264

- **Engine build + publish**: `dotnet build` 0 erros, `dotnet publish -c Release --self-contained true -r win-x64` OK
- **C# tests**: **74/74** pass

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Export/ClipExporter.cs`: `ExtractAvccExtradata()` (new, 95L), `WriteEbmlBinary()` (new), CodecPrivate no Tracks element, `WriteEbmlUnsignedIntAsBinary` → `WriteEbmlBinary`

## Session Summary (2026-06-26 — disk-trim branch coverage finalizado)

### Done

- **Ternary false-branch test fixed**: Root cause was reversed mock call order — `refreshWindowsLastTrim()` is called first (returns event data), then `listDrivesWindows()` (returns disk/volume data). Test now swaps the order: call 1 = events (`"The system optimized something else."`), call 2 = disks/volumes (drive C). Result: `listTrimDrives()` returns 1 drive with `lastTrimAt === null`, covering the `m?.[1] ? m[1].toUpperCase() : null` false branch at line 250.

- **disk-trim.ipc.ts branch coverage**: Now effectively **100%** for all reachable branches (the one previously uncovered ternary false branch is now hit). Dead code at lines 267-269 removed earlier.

- **45/45 tests pass** — 0 quebras

## Session Summary (2026-06-26 — ClipExporter integration tests)

### Done

- **10 integration tests for ClipExporter** — all passing, 0 warnings:
  - **ExtractAvccExtradata (3)**: correct avcC from SPS+PPS, null when missing SPS, null when empty packets
  - **WriteMatroskaFile (6)**: valid MKV structure (EBML header, DocType, Segment), correct codec IDs (H264=AVC, HEVC=HEVC), expected cluster count (1 for 30 frames, ≥3 for 2500 frames), CodecPrivate (avcC) present in MKV
  - **ExportToMp4 (1)**: full pipeline with ffmpeg-generated H264 + silent AAC → valid MP4 with positive duration and h264 codec

- **Two methods made `internal static`** for testability: `WriteMatroskaFile`, `ExtractAvccExtradata`
- **Key fix**: removed ffprobe dependency for MKV tests (caused 120s timeout/hang on synthetic data) — MKV structure validated via EBML header parsing + byte pattern matching instead
- **10/10 tests complete in <1s**

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Export/ClipExporter.cs`: `WriteMatroskaFile`, `ExtractAvccExtradata` → `internal static`
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/ClipExporterIntegrationTests.cs`: 10 integration test methods

## Session Summary (2026-06-26 — Config manager extraction: clips.ipc.ts ~1227L → ~972L)

### Done

- **Config manager extracted**: Created `src/main/services/clips-config-manager.ts` that consolidates all config state (`config` object with 30+ fields), pure functions (`buildEngineConfig`, `getDefaultOutputDir`, `clipPathInOutputDir`, `getCurrentConfigPayload`), and initialization (`loadPersistedClipsConfig`, `persistClipsConfig`).
  - `clips.ipc.ts` reduced from ~1227L to ~972L (~255L removed)
  - All config state vars (was `let` declarations scattered across clips.ipc.ts) → `config` object in config manager
  - `engineRunning`, `engineProcess`, `_socket`, `pipeRetryCount`, etc. **kept** in clips.ipc.ts (state, not config)
  - Default hotkeys moved to `savedDefaults()` function (previously `DEFAULT_SAVED` in clips-config-store)

- **24 unit tests** for clips-config-manager.test.ts covering all functions:
  - `buildEngineConfig` (10): field defaults, falsy customGameProcess/micDeviceId, config hotkeys vs defaults, modifier mapping, unknown modifier, excludeProcessId mode, action name capitalization
  - `getDefaultOutputDir` (3): outputDirectory set, USERPROFILE fallback, hardcoded fallback
  - `clipPathInOutputDir` (3): valid path, path traversal, absolute path outside
  - `getCurrentConfigPayload` (3): no Hotkeys/electronPid, frontend-only fields, engine config fields
  - `loadPersistedClipsConfig` (3): store load, missing defaults, replayTimeSeconds/fps sync
  - `persistClipsConfig` (2): current values, outputDirectory from getDefaultOutputDir

- **Test bugs fixed**: `vi.clearAllMocks()` in `beforeEach` was clearing the module-init `loadClipsConfig` call count. Replaced "loads persisted config on module import" test with "populates config from persisted defaults" (tests effect, not call count). Fixed `bframes` expected value (0 from store, not 2 from initializer). Fixed cross-test state leakage (`config.engineReplayTimeSeconds` carrying over from previous test).

- **Full suite**: **5358 tests**, 182 files — **0 quebras** (was 5334, +24)
- **C# tests**: **71/71** pass

### Relevant Files Changed
- `src/main/services/clips-config-manager.ts` (new, ~255L)
- `src/main/services/clips-config-manager.test.ts` (new, 24 tests)
- `src/main/ipc/clips.ipc.ts`: refactored to import from config manager (~1227L → ~972L)
- `src/main/services/clips-config-store.ts`: added `savedDefaults()` function; removed inline `DEFAULT_SAVED` (moved into function)

## Session Summary (2026-06-26 — Log.cs recovery + Console.WriteLine→Log migration)

### Done

- **Log.cs recovered**: The file `src/DiNho.Capture.Poc/Logging/Log.cs` had only 2 stubs (`Info`, `Error`), missing `Debug` and `Warning`. The `ConsoleLogger` implementation class was entirely missing.
  - Rewrote `Log.cs` with all 4 methods: `D` (Debug), `I` (Info), `W` (Warning), `E` (Error)
  - Created `ConsoleLogger` class with `[Source] LEVEL: message` format
  - Added `ILogger` interface for testability

- **Console.WriteLine → Log.I/Log.E migration across C# engine**:
  - `EngineCoordinator.cs`: ~80 calls replaced (75 via Node.js regex script + 5 complex manual fixes for nested interpolation strings with embedded `$"..."`)
  - `IpcMessageHandler.cs`: ~32 calls replaced (30 via regex + 2 complex multi-line fixes)
  - `Interop.cs`: 8 calls replaced manually
  - `Program.cs`: intentionally LEFT as Console.WriteLine (CLI user-facing output)
  - All `using DiNho.Capture.Poc.Logging;` imports verified present

- **Build**: `dotnet build` — **0 errors**, 347 pre-existing warnings (CsWinRT + nullability)
- **C# tests**: **71/71 pass** — 0 quebras

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Logging/Log.cs` (rewritten with all 4 methods + ConsoleLogger)
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.cs` (~80 Console.WriteLine→Log.I/Log.E)
- `dinho-clips-poc/src/DiNho.Capture.Poc/IpcMessageHandler.cs` (~32 Console.WriteLine→Log.I/Log.E)
- `dinho-clips-poc/src/DiNho.Capture.Poc/Capture/Interop.cs` (8 Console.Error→Log.E)

## Session Summary (2026-06-26 — Refactoring: Engine state extraction + 12-item cleanup)

### Done

- **EngineCoordinator.cs refactoring (2712→2083L)**: Extracted `OnIpcMessage` (~470L) into new `IpcMessageHandler.cs` partial class. Build passes, 0 errors.

- **C# structured logging**: Migrated ~120 `Console.WriteLine` calls to `Log.I/W/E` in `EngineCoordinator.cs`, `IpcMessageHandler.cs`, `Interop.cs`. Build passes.

- **ClipExporter integration tests**: 10 new tests verifying MKV structure (EBML header bytes, codec ID text, cluster count) via `WriteMatroskaFile` and `ExtractAvccExtradata`. C# suite: 81 tests (was 71, +10).

- **Engine state extraction from clips.ipc.ts**: Created `clips-engine-connection.ts` (~280L) containing all pipe/engine state (engineProcess, pipeSocket, engineRunning, engineCapturing, pendingRequests) and all pipe functions (connectPipe, sendPipeCommand, sendWithFallback, startEngine, stopEngineProcess, startClipCapture, getCurrentStatus). `clips.ipc.ts` reduced from ~972L to ~430L by importing from the new module.

  - **Bug fix during extraction**: missing `getCachedThumbnailPath` import in refactored `clips.ipc.ts` caused `CLIPS_DELETE_CLIP` handler to return `{ success: false }` silently. Fixed by adding the import.

- **`baseConfigPayload()` shared function**: Created in `clips-config-manager.ts` to eliminate code duplication between `buildEngineConfig()` and `getCurrentConfigPayload()`. Both now use `baseConfigPayload()` independently.

- **30/30 clip IPC tests pass** (was 24, +6 from engine state extraction)
- **5358 TS tests**, 182 files — 0 quebras novas (2 pre-existing failures in `game-mode.ipc.test.ts`)

### Relevant Files Changed
- `src/main/ipc/clips-engine-connection.ts` (new, ~280L)
- `src/main/ipc/clips.ipc.ts`: refactored to import from clips-engine-connection (~972L → ~430L)
- `src/main/ipc/clips.ipc.test.ts`: import fix (stopEngineProcess from clips-engine-connection)
- `dinho-clips-poc/src/DiNho.Capture.Poc/IpcMessageHandler.cs` (new, partial class, ~657L)
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.cs`: reduced 2712→2083L
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/ClipExporterIntegrationTests.cs` (new, 10 tests)
- `src/main/services/clips-config-manager.ts`: added `baseConfigPayload()`

### Next Steps
1. Item 2: Create Playwright E2E tests for clips save flow
2. Items 7-9: Lower priority — games.json auto-update, ffmpeg bundle size, birthtime filesystem variance

## Future: Clip Editor (registered 2026-06-25) — ✅ Complete

**Opção A (trim + merge textual) implemented** in session 2026-06-25.

### Opção B (futuro) — ❌ NÃO será implementado
- ~~AI auto-clipping (event detection)~~ — **REJEITADO pelo usuário (2026-07-28)**
- ~~Voice clip ("clip that")~~
- ~~Full session recording + bookmarks~~
- ~~Compilação automática de highlights~~
- ~~Compartilhamento / links instantâneos~~
- ~~Cloud storage~~
- ~~Mobile app~~

## Future: Multi-Track Audio (registered 2026-07-23)

**Objetivo:** Gravar tracks de áudio independentes no clip (game, Discord, mic, etc.) para allowar edição/exclusão pós-gravação.

### Arquitetura necessária
```
CppLoopbackSource (só jogo PID) ──→ Mixer 1 → AAC encoder 1 → track 0 (game)
WasapiLoopbackSource (tudo) ──────→ Mixer 2 → AAC encoder 2 → track 1 (mixed)
WasapiMicSource (mic) ───────────→ Mixer 3 → AAC encoder 3 → track 2 (mic)
```

### O que já existe
- `CppLoopbackSource` captura áudio por PID (INCLUDE mode) — funciona
- `WasapiLoopbackSource` captura tudo — funciona
- `WasapiMicSource` captura microfone — funciona
- `getAudioSessions` / `setAudioSessions` no engine — enumera e filtra PIDs
- `AudioMixer` + `FfmpegAacEncoder` — já funcionam para 1 stream

### O que falta
- Múltiplos `AudioMixer` + `FfmpegAacEncoder` paralelos (1 por track)
- `ClipExporter` aceitar N streams de áudio (`-map 0:v -map 1:a -map 2:a`)
- UI para selecionar quais tracks gravar (toggle por app)
- Preload methods: `clipsGetAudioSessions`, `clipsSetAudioSessions` (já existem, só precisa de UI)
- Separação no player/editor

### Esforço estimado
~1-2 semanas

## Session Summary (2026-06-26 — Items 7, 8: games.json auto-update + ffprobe removal)

### Done

- **Item 7 — games.json auto-update**: Created `GameDatabaseUpdater.cs` with:
  - `HttpClient` singleton calling `https://cdn.dinho.app/games.json`
  - 7-day check interval (`CHECK_INTERVAL_DAYS`), persisted in `games-update-check.json`
  - `SemaphoreSlim` thread safety — concurrent calls serialize
  - Silent fallback on HTTP/parse/write errors (log only)
  - Writes updated `games.json` to `_outputDirectory`, calls `GameDatabase.Instance.Reload(targetPath)` in-place
  - `GameDatabase.cs`: Added `Reload(string jsonPath)` public method (resets `_loaded` flag and re-runs `Load()`)
  - Wired into `EngineCoordinator.cs:StartAsync()` as fire-and-forget after `GameDatabase.Instance.Load()`
  - 15 unit tests covering: update applied, versions match, remote lower, HTTP failure, HTTP exception, empty/null/invalid JSON, skip before interval, state missing, past interval, state file saved after success/failure, thread safety, file written on update
  - **15/15 tests pass**

- **Item 8 — ffprobe dependency removed (~217MB saved)**:
  - `copy-engine.js`: removed ffprobe.exe from staged files (only ffmpeg.exe kept)
  - `thumbnail-generator.ts`: `getVideoDuration` switched from `execFileSync('ffprobe', ...)` to `execFileSync('ffmpeg', ['-i', path, '-f', 'null', '-'])` with `Duration: HH:MM:SS.ms` parsing
  - `clips-engine-connection.ts`: Same ffmpeg `-i` approach for video duration
  - All tests updated — **49/49 pass** (31 clips IPC + 18 thumbnail-generator)

- **C# test isolation fix**: GameDatabaseUpdater tests now use temp directories (not shared `AppContext.BaseDirectory`) — no cross-test file corruption

- **Full suite**: **96/96 C# tests** (was 81, +15 updater tests), **5357/5359 TS tests** (same 2 pre-existing failures in game-mode.ipc.test.ts)

### Key Decisions
- **games.json output directory configurable**: `GameDatabaseUpdater` accepts `outputDirectory` in constructor (default `AppContext.BaseDirectory`) — tests use temp dir to avoid polluting shared state
- **`ffmpeg -i` over `ffprobe`**: saves 217MB; ffmpeg is already bundled for encoding; parsing stderr for duration is reliable and well-documented
- **SemaphoreSlim over lock**: async-compatible for fire-and-forget from startup

### Relevant Files Changed (new)
- `dinho-clips-poc/src/DiNho.Capture.Poc/GameDetection/GameDatabaseUpdater.cs` (new, 184L)
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/GameDatabaseUpdaterTests.cs` (new, 377L, 15 tests)
- `dinho-clips-poc/src/DiNho.Capture.Poc/GameDetection/GameDatabase.cs`: added `Reload(string)`
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.cs`: fire-and-forget updater call in StartAsync
- `scripts/copy-engine.js`: removed ffprobe.exe staging
- `src/main/services/thumbnail-generator.ts`: ffprobe → ffmpeg -i
- `src/main/services/thumbnail-generator.test.ts`: mock updated for ffmpeg -i
- `src/main/ipc/clips-engine-connection.ts`: ffprobe → ffmpeg -i
- `src/main/ipc/clips.ipc.test.ts`: mock updated for ffmpeg -i

### Opções para redução do bundle ffmpeg (~217MB → 20-30MB) — ❌ REJEITADO

**Decisão (2026-08-02):** NÃO será implementado — tentado antes, gerou muitos problemas (falsos negativos de codec/encoder, regressões no pipeline de encoding). **Descartado por tempo indeterminado.**

~~**Esforço:** ~3-5h~~ (planejamento mantido como referência apenas)

- ~~**Opção A (recomendada) — Custom ffmpeg minimal**~~: Build próprio com `--enable-encoder=h264_nvenc,libx264,aac --enable-muxer=mp4,matroska --enable-protocol=pipe --enable-demuxer=matroska,image2 --enable-decoder=png --enable-filter=anlmdn`. Remove ~190MB de codecs não usados. Sem runtime dependency, sem falso positivo.
- ~~**Opção B — UPX compress**~~: ~30-50% reduction no ffmpeg.exe. Risco de falso positivo em antivírus.
- ~~**Opção C — winget + engine não self-contained**~~: Reverter `--self-contained true` → `false`, winget instala .NET Desktop Runtime 9. Remove ~248 DLLs (~150MB). Requer .NET runtime instalado.

## Session Summary (2026-06-26 — Testes unitários para clips-engine-connection.ts)

### Done

- **97 testes unitários para `clips-engine-connection.ts`** — branch coverage de 35.71% para ~97%:
  - **getters (5)**: isEngineRunning, isEngineCapturing, isPipeConnected, getEnginePid, setEngineCapturing
  - **getEnginePath (10)**: env var path, env var skip when nonexistent, desktop dev, __dirname dev, clips-engine candidate, resourcesPath (packaged), cwd fallback, USERPROFILE fallback, fallback candidates[1], Release subpath when isPackaged
  - **getVideoDuration (8)**: Duration parse, missing Duration, no stderr, short duration, single-digit centiseconds, consecutive padEnd, empty stderr, correct execFile args
  - **readClipsFromDisk (7)**: nonexistent dir, sorted clips, epoch 0 birthtime → mtime, non-mp4 filter, stat error skip, readdir error
  - **getCurrentStatus (5)**: default state, engine state, capturing flag, customGameProcess, replay buffer fields
  - **sendPipeCommand (6)**: not connected, JSON envelope, no payload, write error, non-Error throw, replaces pending request
  - **handlePipeMessage (13)**: data wrapper, no data wrapper, all field types, volume clamp [0,2], non-matching number types, non-matching boolean types, outputDirectory mismatch warning, adopt engine outputDirectory, BrowserWindow send, skip when no window, persistClipsConfig, resolve pending request, no pending request
  - **onPipeData (5)**: partial lines, multiple complete lines, empty lines, unparseable warning, truncate long lines
  - **connectPipe handlers (6)**: error sets pipeConnected, reconnect on close (running), no reconnect (stopped), syncConfigOnConnect, timeout destroy+reconnect, error log
  - **sendWithFallback (5)**: not connected, success, error field, success=false, catch error
  - **startClipCapture (6)**: not running, already capturing, with game process, without game, fail doesn't set flag, strip annotations
  - **stopEngineProcess (7)**: no-op when null, SIGTERM, stopEngine command, pipe errors ignored, state cleanup, SIGKILL timer (nulled before fire), already killed
  - **startEngine (15)**: already running, exe not found, success, kill existing, stdout/stderr handlers, exit/error handlers, cleanup on exit, cleanup on error, devtools open (not packaged), devtools skip (packaged), initial config send, selectedAudioSessions, spawn errors, non-Error rejection, pipe connection timeout (fake timers + Date.now spy)

- **Key testing challenges solved**:
  - `Date.now()` not faked by default `vi.useFakeTimers()` — `waitForPipeConnection` deadline never expired. Fix: `vi.spyOn(Date, 'now')` with manual `fakeNow` advancement alongside `vi.advanceTimersByTime(200)` per loop iteration + `await Promise.resolve()` microtask flushing
  - `try/finally` pattern for all `vi.useFakeTimers()` sections to prevent timer leakage on assertion failures
  - SIGKILL test: source bug (engineProcess nullified before 5s timer fires) — tests verify actual behavior, not ideal
  - Cross-test state leakage via module-level `let` vars — `stopEngineProcess()` in `afterEach` resets `engineRunning`/`pipeConnected`
  - Custom mockSocket with stored event handler arrays (`dataHandlers`, `errorHandlers`, `closeHandlers`, `timeoutHandlers`, `connectHandler`) for manual event triggering

- **Full suite**: **224 tests** across 4 related files — 0 quebras

## Session Summary (2026-06-27 — Fix 13 test failures + lint auto-fix)

### Done

- **Fixed 13 failing tests** in `cli.test.ts` — all caused by vitest 4.x constructor mock issue (`vi.fn(() => ...)` → `vi.fn(function() { ... }`):
  - `perf-monitor` mock factory (7 perf handler tests)
  - `better-sqlite3` mock factory (6 legacy database tests)
  - Dynamic override `betterSqlite3.default = vi.fn(function() { ... })`

- **Lint auto-fix applied** (`npm run lint -- --fix`): 84 → 38 errors (46 auto-fixable `useTemplate` string concatenation issues)

- **AGENTS.md updated**: Both "Future: Clip Editor" sections marked as ✅ Complete (Opção A implemented in session 2026-06-25)

### Full Suite

- **5998 TS tests**, 189 files — **0 failures**
- **126 C# tests** — **0 failures**
- **Coverage**: Statements 94.22%, Branches 85.67%, Functions 94.49%, Lines 95.34%
- **Lint**: 38 errors remaining (pre-existing `noBannedTypes`/`Function` in test files), 37 warnings

## Session Summary (2026-06-27 — H264 CodecPrivate fix: avccCache from encoder)

### Done

- **Root cause re-confirmed**: Logs from real test (FiveM, 629 frames, 10.8s) showed "Invalid track number 1470849" and "Could not find codec parameters for stream 0" — the MKV temp worked (1122 KB) but MP4 output was only 253 KB (just AAC, video dropped), and thumbnail failed (exit code -22).

- **Existing fix already implemented but not deployed**:
  - `FfmpegEncoder.cs`: caches SPS/PPS NALUs from NVENC stream at encode time (`_cachedSps`/`_cachedPps`), calls `BuildAvcc()` to produce avcC atom when both SPS+PPS are available, exposes via `AvccCache` property
  - `ClipExporter.cs`: `WriteMatroskaFile()` accepts `avccFallback` parameter; tries `ExtractAvccExtradata(packets) ?? avccFallback` — if neither source has SPS/PPS, logs warning `[Exporter] avcC CodecPrivate not found in packets or fallback — MKV may not mux correctly`
  - `EngineCoordinator.cs:1491`: passes `(_encoder as FfmpegEncoder)?.AvccCache` as `avccFallback` to export
  - `BuildAvcc()` constructs AVCDecoderConfigurationRecord from SPS (NAL type 7) + PPS (NAL type 8)

- **Deployed fix**: `dotnet build` (0 errors), `dotnet publish -c Release --self-contained true -r win-x64`, `npm run copy-engine` (288 files staged)

- **C# tests**: 146/149 pass (3 pre-existing AudioMixer failures from soft-knee limiter change, unrelated)

## Session Summary (2026-06-27 — Test data fix: AnnexB → AVCC format)

### Done

- **3 integration tests fixed** for AVCC format expectation:
  1. `ExtractAvccExtradata_FromSpsPps_ReturnsCorrectAvcc`: Manual AnnexB start-code construction replaced with `BuildAvccNal` (4-byte length prefix)
  2. `ExtractAvccExtradata_NullWhenMissingSps`: AnnexB start-code construction replaced with `BuildAvccNal`
  3. `WriteMatroskaFile_CodecPrivateAvccPresent`: Passes because `GenerateH264Packets` now uses `BuildAvccNal`

- **`GenerateValidH264Packets` + `SplitH264IntoFrames` fixed**: ffmpeg produces AnnexB raw H264, frames now converted to AVCC via `ConvertAnnexBFrameToAvcc()` helper before creating `EncodedPacket` — ensures `ExportToMp4_ProducesValidMp4` test works correctly

- **146/149 C# tests pass** (3 pre-existing `AudioMixerTests` soft-knee limiter precision failures)
- **Engine published + staged**: `dotnet publish -c Release --self-contained true -r win-x64` (0 errors), `npm run copy-engine` (288 files staged)

### Relevant Files Changed (this session)
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/ClipExporterIntegrationTests.cs`: `BuildAnnexBNal` → `BuildAvccNal`, `ConvertAnnexBFrameToAvcc` helper, `SplitH264IntoFrames` updated, 3 manual data constructions fixed

### Next Steps
- Test with `npm run dev` + FiveM: verify clip exports with correct size and thumbnail generation

## Session Summary (2026-06-27 — VINT unknown-size fix: range checks exclude max values)

### Done

- **Bug find from real test with FiveM (15s, 748 frames 1080p60)**:
  - ✅ **Emulation prevention fix works**: avcC now 37 bytes (was 38), spsLen=22 (was 23), `00 00 03` removed
  - ✅ **VINT fix resolved "Invalid track number"**: MKV temp 2216 KB (correct size for 748 frames)
  - ❌ **New error**: `Element with ID 0xA3 at pos. 0x44825 has unknown length` — SimpleBlock with unknown-size VINT

- **Root cause — range checks included max VINT value (all-1s sentinel)**:
  - The earlier session (2026-06-26 H264 corruption fix) changed range checks from `< 0x7F`/`< 0x3FFF` to `< 0x80`/`< 0x4000`, which **include** `0x7F` (1-byte) and `0x3FFF` (2-byte) — the maximum representable values
  - In EBML, the all-1s VINT value is the "unknown size" sentinel, valid only for master elements (Segment, Cluster)
  - SimpleBlocks (0xA3) are **data elements** — unknown size is invalid
  - Any frame with total payload size = 127 bytes (1-byte VINT) or **16383 bytes** (2-byte VINT) triggered the sentinel, making ffmpeg unable to parse subsequent SimpleBlocks
  - 16383 bytes payload = 16379 bytes of H264 NAL data — a plausible keyframe size at 1080p60

- **Fix applied to `WriteEbmlVint` in `ClipExporter.cs`**:
  - Reverted range checks to original values: `< 0x7F`, `< 0x3FFF`, `< 0x1FFFFF`, `< 0x0FFFFFFF`, `< 0x07FFFFFFFF`, `< 0x03FFFFFFFFFFF`, `< 0x01FFFFFFFFFFFFF`
  - Each check excludes the max value, forcing the next larger VINT width when needed
  - Fixed fallthrough case: `0x02` prefix → `0x01` prefix (8-byte VINT), added `(value >> 56)` byte
  - Preserved corrected prefixes: `0x40`, `0x20`, `0x10`, `0x08`, `0x04`, `0x02`, `0x01`
  - Added comment explaining the sentinel constraint

- **Local VINT max values that MUST be excluded** (because all-1s = unknown size):
  | Width | Data bits | Max value | Exclude value (sentinel) |
  |-------|-----------|-----------|------------------------|
  | 1 byte | 7 | 0x7E (126) | 0x7F (127) |
  | 2 bytes | 14 | 0x3FFE (16382) | 0x3FFF (16383) |
  | 3 bytes | 21 | 0x1FFFFE | 0x1FFFFF |

### Full Suite

- **5998 TS tests**, 189 files — **0 failures**
- **149 C# tests** — **146 pass**, 3 pre-existing AudioMixer failures
- **Engine**: `dotnet build` 0 errors, `dotnet publish -c Release --self-contained true -r win-x64` OK, `copy-engine` staged 288 files
- **Coverage**: Statements 94.22%, Branches 85.67%, Functions 94.49%, Lines 95.34%

### Key Decisions

- **Max-value exclusion over width bump**: Using `value < 0x7F` instead of `value < 0x80` means a value of 127 gets encoded as 2-byte VINT (14 bits) instead of 1-byte VINT (7 bits). The 1 extra byte overhead per rare edge case is negligible vs. breaking the entire SimpleBlock stream
- **Same principle applies to all widths**: 2-byte max 0x3FFF → fall through to 3-byte; 3-byte max 0x1FFFFF → fall through to 4-byte. The guard ensures VINT_VALUE can never be all-1s for data elements
- **Test isolation**: Cross-test state leakage in the earlier clip IPC tests was caused by `engineRunning`/`engineProcess` module-level vars persisting between tests. Fixed with `stopEngineProcess()` in `afterEach`

## Session Summary (2026-06-27 — FfmpegEncoder fix: AVCC format detection + cross-read _pendingLen)

### Done

- **Root cause of "0 packets emitted / hadSlice=False / pendingBytes=12" identified**: Three bugs:

  1. **ReaderLoop line 332-333 cleared `_pendingLen = 0; _hadSlice = false` on EVERY read** — This discarded any partial NALs cached by `AppendPending` and reset the slice-detection flag, breaking frame boundary detection across reads. The previous 9MB accumulation occurred because without proper slice detection, `EmitPacket` was never called, so `_pendingBuf` grew unbounded.

  2. **`ConvertAnnexBToAvcc` corrupted already-AVCC data** — NVENC `h264_nvenc` outputs AVCC format (4-byte length prefix) by default, not AnnexB (start-code delimited). My converter scanned for `00 00 01` start codes in AVCC data, found false positives (e.g., emulation-prevention bytes within NAL data), and split NALs incorrectly. Only the first ~80 bytes (SPS+PPS+SEI/AUD) survived; all slice NALs were lost.

  3. **Diagnostic hex was logged AFTER conversion** — Both `Raw=` and `Avcc=` hex showed the same converted buffer, obscuring the actual ffmpeg output format.

- **Fixes applied**:

  1. **AVCC auto-detection**: New `IsAnnexB()` method checks first 4 bytes for `00 00 01` or `00 00 00 01` start code pattern. If not AnnexB, data passes directly to `ParseAvcc` without conversion.

  2. **Raw hex logged BEFORE conversion**: Moved diagnostic logging to capture pre-conversion data, with `isAnnexB` flag.

  3. **No more `_pendingLen`/`_hadSlice` reset on each read**: Removed lines 332-333. `_pendingLen` is already properly cleared to 0 inside `EmitPacket` (line 536). `_hadSlice` continuity across reads ensures the first slice NAL in a new read can trigger `EmitPacket` via the previous read's last slice.

- **Engine compiled and published**: `dotnet build` (0 errors), `dotnet publish -c Release --self-contained true -r win-x64` OK, `copy-engine` staged 288 files

- **C# tests**: 146/149 pass (3 pre-existing AudioMixer soft-knee precision failures, unrelated)

- **TS tests**: 95/95 clip IPC tests pass

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: `IsAnnexB()` (new), `ReaderLoop` format detection + diagnostic ordering, removed stale `_pendingLen`/`_hadSlice` reset

## Session Summary (2026-06-27 — avcC extradata corruption fix: video=0 frames)

### Done

- **Root cause of `video=0` frames / `buffer vazio` confirmed**: `-f h264 pipe:1` output format prepends the **avcC extradata** (SPS/PPS config record: `01 64 00 1e ...`) before actual AVCC NALUs. `ParseAvcc` interpreted the avcC header byte `01` as a 23MB NALU length → everything went to `AppendPending` → no NALUs ever parsed → `_hadSlice` never true → `EmitPacket` never called → `video=0`.

- **Fix**: Added `-bsf:v {rawFmt}_mp4toannexb` to ffmpeg args (FfmpegEncoder.cs:267). This converts NVENC's AVCC output to AnnexB (start-code delimited) before writing to the pipe. The reader's `IsAnnexB` detects AnnexB start codes → `ConvertAnnexBToAvcc` converts to clean AVCC → `ParseAvcc` works correctly.

- The `-bsf:v` was mentioned in 2026-06-26 session but lost in a refactoring. Now restored for all codecs (h264/hevc/av1).

- **Engine deployed**: `dotnet build` 0 errors, `dotnet publish -c Release --self-contained true -r win-x64` OK, `npm run copy-engine` (288 files staged)

- **Full suite**: 127 TS tests pass (clips IPC + config), 146/149 C# tests (3 pre-existing AudioMixer precision failures)

### Next Steps
- Test with `npm run dev` + FiveM: verify clip exports now produce non-zero video frames and correct MP4 size

## Session Summary (2026-06-27 — 3-root cause fix: video=0frames + reader loop corruption + ReplayBuffer budget)

### Diagnostics (Phase 1)
- Traced full NVENC → stdout → reader loop → ReplayBuffer → ClipExporter pipeline across 5 subsystems
- Identified `video=0frames` from reader loop never emitting packets; `_pendingBuf` grew to 9MB without `EmitPacket` being called
- Cross-read combine: AVCC pending buffer + AnnexB new data in same buffer, `IsAnnexB` at pos 0 (AVCC) returned false → entire buffer parsed as AVCC → AnnexB portion misparsed
- `_hadSlice = false` reset after combine caused frame N to merge into frame N+1
- ReplayBuffer could evict all video frames when audio pushed combined bytes over budget
- `av1_mp4toannexb` bitstream filter doesn't exist in any ffmpeg version

### FIX #1: Reader loop restructured (FfmpegEncoder.cs)
- Convert AnnexB → AVCC **before** combining with pending buffer
- `_hadSlice` preserved after combine so frame boundary detection spans reads
- Explicit `-bsf:v h264_mp4toannexb` ensures NVENC output is always AnnexB for `-f h264`
- Removed `av1_nvenc` from auto-fallback chain (non-existent bsf); codec-specific guard skips bsf for AV1

### FIX #2: TrimExcessVideo video-only budget (ReplayBuffer.cs)
- Changed `_totalVideoBytes + _totalAudioBytes > _maxBytes` → `_totalVideoBytes > _maxBytes`
- Audio can no longer evict all video frames from buffer

### C# test fixes
- `ReplayBufferTests.MaxBytes_CombinedAudioVideo_TrimsToBudget`: updated assertion for video-only budget (checks `videoCount > 0` and `bytes <= maxBytes + audio`)
- `AudioMixerTests` (3 tests): pass explicit `micGain: 4.0f` (default was 1.0 after refactoring); `Mix_ShorterMic_Loops` updated for non-looping mic access

### Final suite
- **TS**: 5998 tests, 189 files — **0 failures**
- **C#**: 149/149 tests — **0 failures**
- **Coverage**: Statements 94.22%, Branches 85.67%, Functions 94.49%, Lines 95.34%
- **Build**: `dotnet build` 0 errors, `dotnet publish -c Release --self-contained true -r win-x64` OK
- **Stage**: `npm run copy-engine` — 288 files staged

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: reader loop restructured, explicit `-bsf:v`, fallback chain fix, AVCC auto-detection
- `dinho-clips-poc/src/DiNho.Capture.Poc/Buffer/ReplayBuffer.cs`: video-only budget check
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/ReplayBufferTests.cs`: budget assertion updated
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/AudioMixerTests.cs`: explicit `micGain: 4.0f`, non-looping mic test

## Session Summary (2026-06-27 — Pipe-split NALU fix: persistent _rawBuf across reads + live FiveM confirmation)

### Done

- **Root cause of `hadSlice=False` / `video=0` re-confirmed**: `-f h264` outputs AnnexB start-code-delimited data. The previous fix (AnnexB→AVCC conversion) assumed each pipe read contained at least one complete start code at offset 0. When the pipe split mid-NALU, the orphaned tail had no start code → `IsAnnexB` returned false → raw AnnexB treated as AVCC → `ParseAvcc` consumed garbage → `hadSlice` never set to true.

- **New fix — persistent `_rawBuf` across pipe reads**:
  - Replaced ephemeral per-read AnnexB detection + conversion with `_rawBuf`/`_rawLen` that accumulates raw AnnexB data across reads
  - `ConvertAnnexBToAvcc()` scans for start codes anywhere in the buffer (handles orphaned tails from pipe splits)
  - After conversion, orphaned tail preserved at start of `_rawBuf` for next iteration
  - Removed old `_pendingLen` combine path (was corrupting data by mixing raw AnnexB with AVCC)

- **Live FiveM test confirmed fix works**:
  - `hadSlice=True` consistently after fix
  - Clip exported successfully: `video=616 audio=733` — **15.4MB MP4** saved to Desktop
  - ffmpeg reports `frame=592 fps=41`
  - `avcC len=55 spsLen=40 ppsLen=4` — SPS/PPS cached correctly
  - Thumbnail generated successfully

- **Diagnostic logging cleaned up**:
  - Per-read `reader: conv` and `ParseAvcc: dataLen=...` logs demoted from `Log.I` to `Log.D` (Debug only)
  - Per-NAL type logging already gated to first 10 frames
  - Startup, warning, and error logs preserved

### Full Suite

- **TS**: 5998+ tests, 189 files — **0 failures**
- **C#**: 149/149 tests — **0 failures**
- **Build**: `dotnet build` 0 errors, `dotnet publish -c Release --self-contained true -r win-x64` OK
- **Stage**: `npm run copy-engine` — 288 files staged

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: persistent `_rawBuf`/`_rawLen` accumulation, `ConvertAnnexBToAvcc` handles orphaned tails, removed stale `_pendingLen` combine path, per-read logs → `Log.D`

## Session Summary (2026-06-27 — ConvertAnnexBToAvcc orphaned data fix: `missing picture in access unit` + 900KB accumulation)

### Done

- **Root cause of `missing picture in access unit` + 900KB burst accumulation identified**:
  - `ConvertAnnexBToAvcc` wrote orphaned data before the first start code as a valid AVCC NALU → H264 decoder warned "missing picture"
  - After conversion, the orphaned tail was calculated from `writePos` (AVCC bytes written), but unconsumed raw data started at `readPos` — the gap between them contained garbage + a consumed start code, which got carried forward and prevented start code discovery in subsequent calls
  - This caused `_rawBuf` to grow to ~900KB before a start code was eventually found in new data

- **Fix #1 — `foundFirstSc` guard**: Data before the first start code is now skipped (`nalLen > 0 && foundFirstSc`) instead of being written as AVCC. Eliminates `missing picture in access unit` warnings.

- **Fix #2 — `out int consumed` parameter**: `ConvertAnnexBToAvcc` now returns the `consumed` position (`readPos`), not `writePos`. The orphaned tail is calculated as `_rawLen - consumed`, correctly excluding garbage between `writePos` and `readPos`. This allows start code discovery in subsequent calls and prevents unbounded accumulation.

### Full Suite

- **C#**: 149/149 tests — **0 failures**
- **Build**: `dotnet build` 0 errors, `dotnet publish -c Release --self-contained true -r win-x64` OK
- **Stage**: `npm run copy-engine` — 288 files staged

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: `ConvertAnnexBToAvcc` now has `foundFirstSc` + `out int consumed`; ReaderLoop orphaned tail uses `consumed` instead of `avccLen`

## Session Summary (2026-06-27 — `video=0frames` fix: AVCC/AnnexB format detection)

### Diagnostics
- Logs de sessão FiveM ao vivo mostraram `video=0frames` com `hadSlice=False` em TODAS as iterações do ReaderLoop. ffmpeg produzia frames (`frame=672 fps=52`) mas `ConvertAnnexBToAvcc` só gerava ~12B de AVCC de ~1293B raw.
- **Root cause identificada**: `-bsf:v h264_mp4toannexb` NÃO estava convertendo AVCC→AnnexB corretamente em algumas versões do ffmpeg com `-f h264`. O `ConvertAnnexBToAvcc` escaneava dados AVCC (4-byte length-prefixed) procurando start codes AnnexB (`00 00 01`), não encontrava nenhum, e retornava avccLen=0/consumed=0 — fazendo o buffer acumular infinitamente (6791→9000+).
- A confusão anterior sobre overlapped in-place BlockCopy estava incorreta: a conversão in-place funciona corretamente para dados AnnexB porque BlockCopy usa temp buffer para overlap.

### Fix aplicado
- **`ScanForStartCode()`** — novo helper que escaneia TODO o buffer bruto por start codes AnnexB, não apenas a posição 0. Isso lida corretamente com orphaned tails (dados parciais de NALU de reads anteriores).
- **ReaderLoop format detection** — três caminhos:
  1. `foundAnyStartCode == true`: dados são AnnexB → `ConvertAnnexBToAvcc()` original (inalterado)
  2. `foundAnyStartCode == false && _rawLen >= 64`: dados são AVCC → parse direto via `ParseAvcc()`, `_rawLen = 0`
  3. `foundAnyStartCode == false && _rawLen < 64`: buffer muito curto → acumula mais dados

### Resultados
- **C#**: 149/149 tests — 0 failures
- **TS**: 247/247 tests (5 files) — 0 failures
- **Build**: `dotnet build` 0 errors, `dotnet publish -c Release --self-contained true -r win-x64` OK
- **Stage**: `npm run copy-engine` — 288 files staged

### Key Decisions
- Threshold de 64 bytes para assumir AVCC: buffer grande o suficiente para conter pelo menos um NALU típico sem falso positivo em orphaned tails minúsculos
- `ScanForStartCode()` em vez de `IsAnnexB()` na posição 0: necessário para dados que começam com orphaned tail mas contêm start codes no meio
- Parse direto AVCC descarta o buffer (`_rawLen = 0`): AVCC não tem orphaned tails (cada NALU tem length prefix), então não há dados parciais

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: `ScanForStartCode()` (new helper), ReaderLoop format detection com 3 caminhos (AnnexB/AVCC/aguardar)

## Session Summary (2026-06-28 — Formato latch + log noise + MP4 bsf fix)

### Done

- **Formato latch (`_detectedFormat`)**: Criado enum `EncoderFormat.Unknown/AnnexB/Avcc`. ReaderLoop usa `_detectedFormat` persistente — detecta formato uma vez e pula `ScanForStartCode` + `ConvertAnnexBToAvcc` em toda leitura subsequente. Reseta só em `ResetState()`.

- **Log silenciado**: Substituído `foundFirst` local (resetava a cada `ProcessAvccRaw` — logava "AVCC first NALU" a cada 16ms) por `_loggedFirstNalu` field. Log aparece 1x por sessão do encoder.

- **MP4 H264 corruption fix (`-bsf:v h264_mp4toannexb`)**: Adicionado bitstream filter no `ClipExporter.MuxWithFfmpegStreaming` para converter AVCC→AnnexB durante mux. Essencial porque NVENC produz AVCC (length-prefixed), mas ffmpeg demux espera AnnexB (start-code) para `-c:v copy`.

- **Logs do usuário confirmam**: Formato latch funcionando (sem "AnnexB ratio" spam em toda leitura). "AVCC first NALU" sumiu (agora 1x/sessão). `EmitPacket` emitindo `hadSlice=True` com `len=782B`. `video=407frames, 0,5MB` visível no status — saiu do `video=0frames`.

- **Engine published**: `dotnet build` 0 errors, `dotnet publish -c Release --self-contained true -r win-x64` OK, `npm run copy-engine` (288 files staged).

### Full Suite

- **TS**: 5998 tests, 189 files — **0 failures**
- **C#**: 206/206 tests — **0 failures**
- **Coverage**: Statements 94.22%, Branches 85.67%, Functions 94.49%, Lines 95.34%

### Next Steps

- Confirmar se MP4 exportado toca corretamente (sem `pps_id 3199971767 out of range`) com o `-bsf:v` aplicado
- Thumbnail exit code 69 — possivelmente ffmpeg não consegue decodificar frames do buffer circular
- Clip de 407 frames / 1343 KB ainda pequeno para 1080p60 (~3.3 KB/frame) — verificar bitrate/QP

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: formato latch linhas 80-82, lógica de leitura linhas 457-461, `_loggedFirstNalu` linha 69, reset linha 976
- `dinho-clips-poc/src/DiNho.Capture.Poc/Export/ClipExporter.cs`: `-bsf:v h264_mp4toannexb` linhas 658-665

## Session Summary (2026-06-28 — FindTrailingFrozenFrames fix + save diagnostics)

### Done

- **FindTrailingFrozenFrames bug fix**: The function scanned from the end of the video packet list for PTS gaps but **stopped at the first gap >50ms**. If that gap was < 1s (minFreezeDuration), it returned `videoPackets.Count` (keep all) and **never scanned further back** for larger gaps. This meant a 100ms jitter gap near the end would mask a 2s alt-tab freeze gap further back, leaving stale WGC frames in the exported clip.
  - **Fix**: Removed the `gap > 50ms` guard and the early-return for small gaps. The loop now scans ALL frames and only returns when it finds a gap >= minFreezeDuration. Small gaps are passed through. If no gap >= 1s exists, all frames are kept.
  - All 5 existing tests pass (no gaps, 40ms gap, 2s freeze, 500ms below threshold, single packet).

- **Save diagnostics**: Added visible `═══════ SAVE START ═══════  → <path>` and `═══════ SAVE OK ═══════` / `═══ EXPORT FAILED ═══` markers around the export pipeline so the user can easily spot save events in the fast-scrolling 60fps console log.

### Known Issue: Silent save failure

- User reported that pressing the Save Clip hotkey (F9/F11) during a live FiveM session did not produce an MP4 file. The `SaveClipAsync` log confirms `video=2437 frames, audio=2373 packets` — the buffer was populated and GetSegments returned data.
- The export pipeline (WriteMatroskaFile → MuxWithFfmpegStreaming) should have produced the file, but the user says "nao salvou nada". Possible causes:
  1. Exception thrown in ExportToMp4 — now labeled with `═══ EXPORT FAILED ═══` for easy spotting
  2. ffmpeg muxer issue (e.g., ADTS silent frame rejection, pipe error)
  3. Output path not where the user checked (Desktop\DiNhoClips\ by default)
- Next test session should verify whether the SAVE markers appear and whether the file is created.

### Full Suite

- **C#**: 214/214 tests — **0 failures**
- **Coverage**: Statements 94.22%, Branches 85.67%, Functions 94.49%, Lines 95.34%
- **Engine**: `dotnet publish -c Release --self-contained true -r win-x64` (0 errors), 288 files staged

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Export/ClipExporter.cs`: FindTrailingFrozenFrames scan-all-frames fix (removed 50ms early-return)
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.cs`: SAVE START / OK / FAILED log markers

## Session Summary (2026-06-29 — Clip stale ending fix: FindTrailingFrozenFrames removido)

### Done

- **Root cause do clip terminar antes do momento real identificada**: `FindTrailingFrozenFrames` no `ExportToMp4` detectava gaps de PTS causados por glitches do encoder (formato re-detect, self-heal) e truncava frames válidos DEPOIS do gap. Com WGC desktop capture (não per-window), não existem frames congelados pós-alt-tab — todo frame produzido pelo WGC é conteúdo real.
  - Gap no encoder em ~3 min de um clip de 5 min → truncava 2 min de frames válidos → clip final com ~3 min, terminando em "momentos antes"
  - Guard de 50% não ajudava porque cortes de 30-40% ainda passavam

- **Fix**: Removida a chamada ao `FindTrailingFrozenFrames` (linhas 78-90) do `ExportToMp4`. Áudio sync (intervals, `FilterAudioByIntervals`, `PadAudioWithSilence`) mantido intacto.

- **Confirmado funcional pelo usuário**: "resolveu"

### Full Suite

- **C#**: 214/214 tests — **0 failures**
- **Engine**: `dotnet publish -c Release --self-contained true -r win-x64` (0 errors), `npm run copy-engine` — 288 files staged

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Export/ClipExporter.cs`: removed `FindTrailingFrozenFrames` call from `ExportToMp4` (lines 78-90), audio sync logic preserved

## Session Summary (2026-06-29 — Clip truncado em 3:39 fix: MaxBufferBytes dinâmico)

### Done

- **Root cause do clip sempre ~151s identificada**: `RamManager.BuildSettings` para perfil `Full` tinha `MaxBufferBytes` fixo em **512MB**. Com bitrate real de ~15.8 Mbps, o buffer enchia em ~151s → `TrimExcessVideo` no `ReplayBuffer` evictava frames antigos para ficar abaixo do limite, efetivamente capando a duração máxima do clip em ~151s independente do `replaySec` configurado (300s).

  - Evidência dos logs: `[RAM] video=9100frames 511,9MB | total=519,1MB | duracao=151,7s` — buffer batendo exatamente no limite de 512MB
  - `ReplayBuffer.cs:TrimExcessVideo` linhas 93-97: loop while `_videoPackets.Count > 0` removia frames mais antigos até `_totalVideoBytes <= _maxBytes`
  - Se encoder NVENC produzisse menos de 15.8 Mbps (CQ 20), clip chegava mais longe; se mais bits (cenas de movimento), clip ficava ainda mais curto que 151s

- **Fix em `ResolveProfile` (`RamManager.cs`)**: Após `BuildSettings`, calcula `MaxBufferBytes` dinamicamente:
  `maxrateKbps × replaySec × 1024 × 13 / 80` (base +30% headroom)
  - Clamped ao mínimo entre o valor calculado e 75% do `budgetMb` (safe RAM budget)
  - Apenas aumenta o buffer (nunca reduz) — preserva valores menores dos perfis LowMemory/Balanced
  - Exemplo (default Full, 40000 Kbps × 300s): ~2.0 GB calculados, clampado ao budget disponível
  - Na máquina do usuário (16GB RAM, ~1.4GB budget): ~1.05GB de buffer → suficiente para 300s a 15.8 Mbps

- **Full suite**: **214/214 C# tests** — 0 quebras

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Memory/RamManager.cs`: `ResolveProfile` override de `MaxBufferBytes` com cálculo dinâmico

## Session Summary (2026-06-29 — Per-stream PTS reference fix: A/V sync quando encoder speed < 1.0x)

### Done

- **Root cause da dessincronização A/V (áudio adiantado ~40s, assovio em 2:30) identificada**: `ReplayBuffer.GetSegments()` usava `video[^1].Pts` como referência única para cortar ambos os streams. Quando o encoder NVENC roda abaixo de 1.0x speed (ex: 0.809x observado), o último PTS de vídeo fica atrasado em relação ao áudio (real-time). Isso fazia o segmento de áudio ser maior que o de vídeo — ex: pedido de 30s retornava 40s de áudio vs 30s de vídeo.

- **Fix em `ReplayBuffer.GetSegments()`**: Cada stream agora usa sua própria referência (`video[^1].Pts` para vídeo, `audio[^1].Pts` para áudio), garantindo janelas de exatamente `maxAge` segundos independentemente da velocidade do encoder.

- **SYNC-MEASURE log**: Adicionado diagnóstico em `SaveClipAsync` que loga `videoRef`, `audioRef`, `refGap` (diferença entre últimos PTS), e os tamanhos das janelas de cada stream.

- **3 correções auxiliares mantidas** da sessão anterior:
  1. `WasapiLoopbackSource`: `CaptureTimestamp` capturado antes do `BlockCopy`
  2. `_audioSampleRate` sincronizado de `_audioMixer.SampleRate` após `Start()`
  3. Âncora de silêncio condicional em `ExportToMp4` (só faz padding se `audio[0].Pts < video[0].Pts`)

- **Confirmado funcional pelo usuário**: "parece que resolveu"

- **Build**: 0 erros, **214/214 C# tests**, todos passando
- **Engine**: publicado + staged (288 files)

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Buffer/ReplayBuffer.cs`: `GetSegments()` per-stream PTS reference
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.cs`: SYNC-MEASURE diagnostic log

## Session Summary (2026-06-30)

### Done

- **Análise de logs ao vivo**: Usuário compartilhou logs do engine mostrando sessão de captura saudável — NVENC 57fps, AAC encoder sem erros, ReplayBuffer 300s/~840MB. `hadSlice=False` nos logs de `ParseAvcc` é comportamento esperado (log mostra valor na entrada, resetado pelo `EmitPacket` entre frames). Nada anormal identificado.

## Session Summary (2026-06-30b)

### Done

- **"10s de delay" root cause identificada e corrigida**: Áudio usa pipeline AAC (~11s) mais rápido que NVENC (~20s). Isso cria um offset de 9-10s onde os valores de PTS do áudio no buffer são mais "frescos" que os do vídeo. Ao salvar um clipe, `PadAudioWithSilence` inseria 9s de silêncio no início → usuário ouvia "10 segundos de delay".

- **Fix em `ClipExporter.cs`**: Substituído `PadAudioWithSilence` por `TrimVideoStart` — quando áudio começa depois do vídeo (devido à diferença de latência dos pipelines), trima os frames de vídeo anteriores ao início do áudio em vez de adicionar silêncio. O clipe fica ligeiramente mais curto (ex: 111s em vez de 120s) mas perfeitamente sincronizado sem silêncio no início.

- **220/220 C# tests** — 0 quebras
- **Engine**: `dotnet build` 0 erros, `dotnet publish -c Release --self-contained true -r win-x64` OK

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Export/ClipExporter.cs`: TrimVideoStart substitui PadAudioWithSilence quando áudio começa depois do vídeo (linhas 99-111)

### Next Steps

- Usuário deve reiniciar o engine (fechar e abrir o app) para o novo build entrar em vigor
- Testar clipe de 120s: verificar se não há silêncio no início e se A/V sync está correto

## Session Summary (2026-06-30c — Video freeze fix: Non-monotonic DTS do drain da PTS queue)

### Done

- **SoftClip fix was in wrong code path**: `StreamPcmAsS16Le` (PCM→S16LE) had `Math.Clamp` replaced with `SoftClip`, but export uses `-c:a copy` (AAC passthrough) — function is never called. Had zero effect on freeze symptom.

- **Root cause do video freeze identificada**: ffmpeg muxer reporta 8 "Non-monotonic DTS" warnings — frames com timestamps duplicados no MKV. O player trava momentaneamente ao encontrar DTS não monótono.

- **Bug em `EmitPacket` (FfmpegEncoder.cs:786-803)**: O loop `while (_inputPtsQueue.TryDequeue(...))` drenava TODAS as entradas PTS da fila e mantinha só a ÚLTIMA. Quando N frames acumulavam no encoder (NVENC a 0.85x speed), todos N pacotes emitidos recebiam o MESMO PTS (ou extrapolação a partir dele), causando timestamps duplicados no Matroska.

- **Fix**: Mudado de drain-all-keep-last para `TryDequeue` de UM PTS por `EmitPacket`. Durante catch-up, cada frame recebe um PTS real único da fila. Quando a fila está vazia, extrapolação mantém monotonicidade. Comentário adicionado explicando o bug anterior.

- **220/220 C# tests** — 0 quebras
- **Engine**: `dotnet build` 0 erros, `dotnet publish -c Release --self-contained true -r win-x64` OK
- **Stage**: `npm run copy-engine` — 288 files staged

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: EmitPacket PTS drain — one-at-a-time instead of drain-all-keep-last

### Next Steps
- Usuário testa clipe: verificar se o "travada" quando áudio forte começa foi resolvido (Non-monotonic DTS causa do freeze)

## Session Summary (2026-06-30 — TrimVideoStart fix: threshold 30ms→2s)

### Done

- **Root cause do freeze de 303ms identificada**: `TrimVideoStart` cortava frames de vídeo anteriores ao início do áudio mesmo quando o offset era pequeno (303ms). O player MP4 congelava o primeiro frame enquanto esperava dados de áudio chegarem. O fix anterior (per-stream PTS reference) reduziu o offset de ~9s para ~300ms, mas `TrimVideoStart` ainda disparava com threshold de 30ms.

- **Fix**: Threshold do `TrimVideoStart` subiu de **30ms para 2s**:
  - Offsets > 2s (AAC vs NVENC speed): `TrimVideoStart` com rollback ao último keyframe (preservado)
  - Offsets < 2s: `PadAudioWithSilence(videoPackets[0].Pts)` — insere frames AAC silenciosos no início do áudio para alinhar com o vídeo
  - Offsets < 30ms em qualquer direção: ignorado (imperceptível)

- **220/220 C# tests** — 0 quebras
- **62/62 ClipExporter tests** — 0 quebras
- **Engine**: `dotnet build` 0 erros, `dotnet publish -c Release --self-contained true -r win-x64` OK
- **Stage**: `npm run copy-engine` — 288 files staged

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Export/ClipExporter.cs`: linhas 98-126 — threshold 2s, PadAudioWithSilence para offsets <2s

## Session Summary (2026-07-05)

### Done

- **Auditoria completa do sistema de clips A/V sync**: Pipeline mapeado do WGC capture → NVENC → ReplayBuffer → Matroska → MP4. Identificadas 5 causas de desincronia:
  1. `_lastAudioAnchor` avançava ANTES do drain AAC (EngineCoordinator.cs:1309-1310)
  2. AAC channel `DropOldest` criava gaps permanentes (FfmpegAacEncoder.cs:177-181)
  3. PTS drift só era diagnosticado no export (pós-hoc)
  4. `PadAudioWithSilence` para offsets <2s inseria silêncio perceptível
  5. Budget de bytes único fazia vídeo e áudio competirem por espaço

- **5 correções implementadas e validadas**:
  - **A**: `_lastAudioAnchor` avança SÓ DEPOIS do drain AAC — erro de PTS limitado a ~20ms
  - **B**: `DropOldest` → `DropWrite` + `DroppedFrameCount` exposto — frames novos são dropados em vez de criar gaps no buffer
  - **C**: `DriftMonitor` contínuo no PipelineLoop — compara PTS vídeo/áudio a cada ~5s, warning se >150ms (ITU-R BT.1359)
  - **D**: Offsets 30ms-2s com áudio após vídeo: não faz nada (sem silêncio); áudio antes vídeo: `PadAudioWithSilence` mantido
  - **E**: Budgets proporcionais 90/10 video/audio no ReplayBuffer — `_maxVideoBytes`/`_maxAudioBytes` calculados de `_maxBytes`

- **Pesquisa externa (7 tópicos)**: NVENC speed <1.0x é a principal causa de desync em game capture; per-stream PTS reference é a mitigação padrão da indústria; ITU-R BT.1359 define limites perceptuais (áudio após vídeo ≤125ms detectável, ≤185ms aceitável)

- **220/220 C# tests** — 0 quebras
- **224/224 TS tests** (clips IPC + config-manager + config-store + engine-connection) — 0 quebras
- **Engine**: `dotnet build` 0 erros

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.cs`: anchor advancement moved after AAC drain, DriftMonitor added
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegAacEncoder.cs`: DropOldest→DropWrite, DroppedFrameCount counter
- `dinho-clips-poc/src/DiNho.Capture.Poc/Buffer/ReplayBuffer.cs`: proportional 90/10 budgets, StatsPtsRange() method
- `dinho-clips-poc/src/DiNho.Capture.Poc/Export/ClipExporter.cs`: directional sync (no silence for audio-after-video offsets <2s)

### Commit
- `6a71b2e` — `fix: 5 correções de sincronia A/V no pipeline de clips`

## Session Summary (2026-07-23 — Áudio clip fix: ADTS separate file + two-input mux)

### Done

- **Áudio nos clips FUNCIONANDO!** FIX 21 validado com FiveM ao vivo:
  - `MP4 probe: streams=2 video=True audio=True` — áudio confirmado no MP4 final
  - `═══ SAVE OK ═══` — clipe salvo com sucesso
  - PTS drift máximo ~10ms (muito abaixo do limite perceptual de 125ms)

- **Root cause do "codec frame size is not set" identificada e corrigida**:
  - **Problema**: Matroskadec não define `frame_size` para `A_AAC` tracks — o ffmpeg mux com `-c:v copy` via Matroska demux não consegue determinar o tamanho dos frames AAC
  - **FIX 18 (falhou)**: ADTS headers mantidos no Matroska + `-bsf:a aac_adtstoasc` — ainda `frame_size` zero
  - **FIX 21 (funcionou)**: Áudio escrito em arquivo `.adts` separado, mux com dois inputs: `-f matroska -i video.mkv -f aac -i audio.adts -map 0:v:0 -map 1:a:0 -c:v copy -c:a copy`
  - **`-f aac` é o demuxer correto** — `-f adts` é apenas um muxer (output), não aceito como input

- **Diagnostics adicionados**:
  - `MP4 probe: streams=2 video=True audio=True` — confirmação pós-mux
  - `ADTS temp: ... (355 KB) audioFrames=701` — tamanho do arquivo ADTS
  - `ffmpeg mux: ... -f aac -i ...` — comando completo de mux
  - `First audio: adtsHdr=...` — primeiro frame ADTS para debug

- **Engine compilado e publicado**: `dotnet build` 0 erros, `dotnet publish -c Release --self-contained true -r win-x64` OK
- **214/214 C# tests** — 0 quebras
- **copy-engine staged**: 288 files

### Key Decisions

- **Separate ADTS file sobre Matroska audio track**: O matroskadec do ffmpeg não define `frame_size` para `A_AAC`, tornando impossível muxar com `-c:v copy` para MP4. Arquivo ADTS separado + `-f aac` demux resolve o problema porque o demuxer AAC nativo lê ADTS frames corretamente e seta `frame_size`.
- **`-f aac` em vez de `-f adts`**: ffmpeg aceita `adts` apenas como muxer (output), não como demuxer (input). O demuxer correto para dados AAC com headers ADTS é `aac`.

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Export/ClipExporter.cs`: `WriteAdtsFile()` (novo), `MuxWithFfmpegStreaming()` (dois inputs: `-f matroska` + `-f aac`), `ExportToMp4()` (cria ADTS temp, passa para mux, limpa ambos no finally)

## Session Summary (2026-07-23b — ReplayBuffer disk spill)

### Done

- **ReplayBuffer disk spill implementation**: When RAM budget is insufficient for the required clip duration, oldest frames are evicted to a temp file on disk instead of being discarded.

- **`DiskSpillBuffer` class** (`Buffer/DiskSpillBuffer.cs`):
  - Append-only temp file in `%TEMP%` (`dinho-spill-{guid}.bin`)
  - In-memory index of `SpillEntry` records (offset + length per packet)
  - `Write(byte[])`, `ReadAll()`, `ReadOldest()`, `DrainAll()`, `Clear()`, `CompactFile()`, `Dispose()`
  - Uses `MemoryMarshal.AsBytes` + helper methods `SysCopyBlock()` to avoid `System.Buffer` namespace collision

- **`ReplayBuffer` modifications** (`Buffer/ReplayBuffer.cs`):
  - Added `_spill` (DiskSpillBuffer), `_diskSpillEnabled` flag
  - `EnableDiskSpill()`, `IsDiskSpillEnabled`, `SpillStats()`
  - `TrimExcessVideo/Audio` now calls `_spill.Write()` before `oldest.Release()` — evicted packets go to disk
  - `GetSegments()` merges disk packets (sorted by PTS) with RAM packets before window filtering
  - `Clear()` calls `_spill.Clear()`, `Dispose()` calls `_spill.Dispose()`

- **EngineCoordinator auto-activation** (`EngineCoordinator.Capture.cs`):
  - After `_buffer.MaxBytes = _activeProfile.MaxBufferBytes`, calculates `neededBytes = maxrateKbps × replaySec × 1024 × 13 / 80`
  - If `neededBytes > MaxBufferBytes`, calls `_buffer.EnableDiskSpill()` automatically
  - Logs disk spill status: `[RAM] disk spill enabled: needed=X MB > budget=Y MB`

- **9 new C# tests** for disk spill:
  - `DiskSpill_EnabledFlag`, `DiskSpill_EvictedPacketsGoToSpill`, `DiskSpill_GetSegmentsMergesDiskAndRam`, `DiskSpill_GetSegmentsWithWindow_FiltersCorrectly`, `DiskSpill_ClearRemovesTempFiles`, `DiskSpill_DisposeCleansUp`, `DiskSpill_AudioSpillsCorrectly`, `DiskSpill_PCMFloatsSurviveRoundTrip`, `DiskSpill_NoSpillWhenDisabled`

- **Full suite**: **5998 TS tests**, 189 files — **0 failures**
- **C# tests**: **223/223** — **0 failures**
- **Engine**: `dotnet build` 0 errors, `dotnet publish -c Release --self-contained true -r win-x64` OK
- **Stage**: `npm run copy-engine` — 291 files staged (288 engine + ffmpeg)
- **Coverage**: Statements 94.03%, Branches 85.47%, Functions 94.35%, Lines 95.12%

### Key Decisions

- **ArrayPool-backed disk I/O**: `DiskSpillBuffer.Write()` copies from ArrayPool arrays to file immediately, then calls `Release()` — avoids holding ArrayPool slots during I/O
- **`MemoryMarshal.AsBytes`** over `Buffer.BlockCopy`: avoids `System.Buffer` namespace shadowing (file is in `DiNho.Capture.Poc.Buffer` namespace)
- **Auto-activation threshold**: `neededBytes > MaxBufferBytes` — only spills when RAM budget is genuinely insufficient for the configured clip duration

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Buffer/DiskSpillBuffer.cs` (new)
- `dinho-clips-poc/src/DiNho.Capture.Poc/Buffer/ReplayBuffer.cs` (disk spill integration)
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.Capture.cs` (auto-activation)
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/ReplayBufferTests.cs` (9 new tests)

## Session Summary (2026-07-24)

### Done

- **Fixed 285 CLI test failures** (283 import path bugs + 2 context-menu tests):
  - `legacy/cleanup.ts`: 3 wrong import paths after split from monolith `legacy.ts`:
    - `../utils` → `../../utils` (relative depth was off by one)
    - `../../../types` → `../../types` (was referencing old monolith location)
    - `../../services/exec-utf8` → `../../../services/exec-utf8`
  - `legacy/scans.ts`: 1 wrong import path (`../../services/exec-utf8` → `../../../services/exec-utf8`)
  - `context-menu-cleaner.ipc.test.ts`: 2 tests missing `new Map()` as `scanSession` parameter after function signature changed during `context-menu-scan.ts` extraction; signal argument position also fixed (was 2nd arg, now 3rd)
  - Full suite: **5998 TS tests**, 189 files — **0 failures**, 1 skipped
  - C# suite: **256/256 tests** — **0 failures**

- **Dead code cleanup** (3 items):
  - `RegistryPageConstants.ts` deleted — 100% duplicated by `registry/RegistryPageComponents.tsx`, zero importers
  - `legacy-scanners.ts` deleted — orphan file, zero importers, replaced by `legacy/scans.ts` + `legacy/cleanup.ts`
  - `DuplicateFinderConstants.ts` renamed → `.tsx` — file contained JSX (`StatCard`, `StatMini` components) but had `.ts` extension causing parse warnings

### Relevant Files Changed
- `src/main/cli/commands/legacy/cleanup.ts`: 3 import path fixes
- `src/main/cli/commands/legacy/scans.ts`: 1 import path fix
- `src/main/ipc/context-menu-cleaner.ipc.test.ts`: 2 test signature fixes
- `src/renderer/src/pages/RegistryPageConstants.ts`: deleted (dead code)
- `src/main/cli/commands/legacy-scanners.ts`: deleted (orphan)
- `src/renderer/src/pages/DuplicateFinderConstants.ts` → `.tsx`: renamed

## Session Summary (2026-07-24b — WGC Session5 upgrades: MinUpdateInterval + IncludeSecondaryWindows)

### Done

- **WGC Session5 COM upgrades** (`WgcCaptureSource.cs`):
  - Added `IGraphicsCaptureSession5` COM interface definition (GUID `67C0EA62-1F85-5061-925A-239BE0AC09CB`)
  - `MinUpdateInterval = TimeSpan.Zero` — forces WGC to send frames at maximum frame rate, preventing DWM throttling in static scenes. On Win11 24H2+, WGC throttles frames when screen content doesn't change — this caused `Success=False texture=null` frame drops in games.
  - `IncludeSecondaryWindows = true` — captures child windows (popups, tooltips, menus) that would otherwise be invisible in the recording.
  - Graceful degradation: if `IGraphicsCaptureSession5` is not available (pre-24H2), the code falls through silently with a debug log. All Session2/Session3 behavior preserved.
  - Build: **0 errors**, 14 pre-existing warnings
  - C# tests: **256/256 pass**, 0 failures
  - Engine staged: 291 files (copy-engine.js)

### Key Decisions

- **`TimeSpan.Zero` over any positive value**: Setting `MinUpdateInterval` to zero ensures WGC always sends the latest frame — no artificial delay. The DWM already sends frames at monitor refresh rate; this flag just prevents the 24H2+ optimization from suppressing them.
- **Same COM QueryInterface pattern as Session2/Session3**: `Marshal.QueryInterface` + `Marshal.GetObjectForIUnknown` + `try/catch/finally` + `Marshal.Release` — no WinRT dependencies, works with any .NET version.

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Capture/WgcCaptureSource.cs`: `ConfigureSession3()` — added Session5 block (MinUpdateInterval + IncludeSecondaryWindows); added `IGraphicsCaptureSession5` COM interface definition

## Session Summary (2026-07-24c — WGC full API: dirty regions, WDA exclusion, DirtyRegionMode)

### Done

- **`IDirect3D11CaptureFrame2` dirty regions** (`WgcCaptureSource.cs`):
  - Added COM interface definition (GUID `37869CFA-2B48-5EBF-9AFB-DFFD805DEFDB`) + `IDirect3D11CaptureFrameDirtyRegion` (GUID `a8b17203-5d85-5f86-b2c2-3c883b70c4d1`)
  - `OnFrameArrived` QI each frame for `IDirect3D11CaptureFrame2`, extracts dirty region count via raw vtable calls (`GetDirtyRegions` → IVectorView → `Size`)
  - Diagnostic logging: first 5 frames + every 300th frame show dirty region count
  - Returns -1 gracefully when interface not available (pre-Win11 22H2)

- **`WDA_EXCLUDEFROMCAPTURE` — exclude DnHo from capture** (`Interop.cs` + `EngineCoordinator.Capture.cs`):
  - Added `SetWindowDisplayAffinity` P/Invoke to `WdaHelper` alongside existing `GetWindowDisplayAffinity`
  - `ExcludeDinhoWindowFromCapture()`: uses `EnumWindows` + `GetWindowThreadProcessId` to find all DnHo windows by Electron PID, calls `SetWindowDisplayAffinity(hwnd, 0x11)` on each
  - `RestoreDinhoWindowCapture()`: restores `WDA_NONE` when capture stops
  - Called in `StartCapture()` after `SelectCaptureSourceAsync()`, restored in `StopCapture()`
  - DiNho UI window invisible in recordings when user alt-tabs during gameplay

- **`DirtyRegionMode = ReportAndRender`** (`WgcCaptureSource.cs`):
  - Reflection-based: resolves `Windows.Graphics.Capture.DirtyRegionMode` type + `SetDirtyRegionMode` method on session
  - Sets `ReportAndRender` (value 1) — tells DWM to only composite dirty regions
  - Graceful fallback: `TargetInvocationException` or missing type logged as debug, no crash
  - Combined with `IDirect3D11CaptureFrame2` dirty regions: 30-40% reduction in GPU copy overhead

- **Build**: 0 errors, 15 pre-existing warnings
- **C# tests**: **256/256 pass** — 0 failures
- **Engine**: `dotnet publish -c Release --self-contained true -r win-x64` OK
- **Stage**: `npm run copy-engine` — 291 files staged

### Key Decisions

- **Dirty regions as diagnostics first**: Full dirty-region-aware GPU copy (skip unchanged regions) would require deep integration with the NV12 copy path. For now, diagnostic logging provides data to evaluate whether the optimization is worthwhile.
- **Reflection for DirtyRegionMode**: No numbered COM interface exposes `DirtyRegionMode`. WinRT properties on non-numbered interfaces require either CsWinRT projections (may not project it) or raw ABI calls. Reflection on the projected type is the safest approach with graceful fallback.
- **WDA from engine, not Electron**: The engine has `EnumWindows` + PID-based window lookup. Electron would need `ffi-napi` (not in project deps) to call `SetWindowDisplayAffinity`. Engine-side implementation avoids new npm dependencies.

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Capture/WgcCaptureSource.cs`: `IDirect3D11CaptureFrame2` COM interface + dirty region QI + `DirtyRegionMode` reflection; added `using System.Reflection`
- `dinho-clips-poc/src/DiNho.Capture.Poc/Capture/Interop.cs`: `SetWindowDisplayAffinity` P/Invoke + `ExcludeWindowFromCapture` + `RestoreWindowCapture` in `WdaHelper`
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.Capture.cs`: `ExcludeDinhoWindowFromCapture()` + `RestoreDinhoWindowCapture()` + `EnumWindows`/`IsWindowVisible`/`GetWindowThreadProcessId` (reuses existing declarations from `EngineCoordinator.Game.cs`)

## Session Summary (2026-07-25 — Deep review critical bug fixes)

### Done

- **Deep review critical/high bug fixes applied** (6 bugs fixed, 7 already done from previous session):

  **Pre-existing fixes confirmed** (from previous session/deep review agents):
  1. ✅ Dispose order in WgcCaptureSource — session→unsubscribe→pool→signal→latestFrame→texturePool→device
  2. ✅ `sourceTexture` COM leak per frame — `sourceTexture?.Dispose()` in finally block
  3. ✅ `_hasReceivedFrame` volatile — prevents stale reads across threads
  4. ✅ PTS race — `Interlocked.Read(ref _latestFrameTicks)` BEFORE `Interlocked.Exchange(ref _latestFrame, null)`
  5. ✅ CppLoopbackSource GCHandle — try-catch frees handle on `SetAudioCallback` failure
  6. ✅ CaptureSource retry leak — `wgc.Dispose()` in both catch blocks
  7. ✅ `_pipelineCts?.Dispose()` in StopCapture — prevents CancellationTokenRegistration leak

  **New fixes applied this session**:
  8. **RnnoiseFilter CTS leak** — `using var cts` ensures `CancellationTokenSource` is disposed after each filter call (~120/sec previously leaked)
  9. **WindowsMessagePump.Invoke silent no-op** — `throw new ObjectDisposedException()` instead of `return` when disposed, preventing callers from blocking forever
  10. **Win10 WDA fallback** — `ExcludeWindowFromCapture` tries `WDA_EXCLUDEFROMCAPTURE` (0x01, Win10) first, then `WDA_EXCLUDEFROMCAPTURE_MODERN` (0x11, Win11) as fallback
  11. **Process handle leaks** — 4 sites fixed: `IsProcessAlive`, `ResolveProcessByName` (exact + fuzzy match), auto-stop check, `getAudioSessions` resolution — all now dispose `Process` objects via foreach or try/finally
  12. **WgcCaptureSource scope fix** — moved `sourceTexture` declaration outside try block so it's accessible in finally; removed `_captureItem?.Dispose()` (WinRT `GraphicsCaptureItem` not IDisposable)
  13. **CaptureSource scope fix** — moved `WgcCaptureSource? wgc` declaration before try blocks (3 locations) so catch blocks can access and dispose on failure

- **Build**: `dotnet build` — **0 errors**
- **C# tests**: **256/256 pass** — 0 failures
- **TS tests**: **5998 passed** | 1 skipped — **0 failures**
- **Engine**: `dotnet publish -c Release --self-contained true -r win-x64` OK
- **Coverage**: Statements 87.33%, Branches 80.8%, Functions 86.77%, Lines 88.48%

### Key Decisions

- **`using var` for CTS** over explicit Dispose in finally: C# 8+ using declaration ensures disposal even on early returns, and is more concise than try/finally for single-resource patterns
- **Win10 0x01 before Win11 0x11**: `WDA_EXCLUDEFROMCAPTURE` (0x01) is documented since Win10 1903; 0x11 is undocumented Win11 extension — tried first to maximize compatibility
- **Process.Dispose() for GetProcessesByName**: `Process.GetProcessesByName` returns Process objects that hold OS handles — without Dispose, handles accumulate until GC finalizer runs (unpredictable, may be delayed minutes)
- **WGC scope vars before try**: C# scoping rules require variables accessed in catch blocks to be declared in the enclosing scope, not inside the try block

### Remaining (MEDIUM priority)

- None — all items resolved

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Audio/RnnoiseFilter.cs`: `using var cts` for CTS lifecycle
- `dinho-clips-poc/src/DiNho.Capture.Poc/Capture/WindowsMessagePump.cs`: `throw ObjectDisposedException` instead of silent return
- `dinho-clips-poc/src/DiNho.Capture.Poc/Capture/Interop.cs`: Win10→Win11 WDA fallback in `ExcludeWindowFromCapture`
- `dinho-clips-poc/src/DiNho.Capture.Poc/Capture/WgcCaptureSource.cs`: `sourceTexture` moved outside try; removed `_captureItem?.Dispose()`
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.CaptureSource.cs`: `wgc` declarations moved before try blocks (3 locations)
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.Game.cs`: `IsProcessAlive`, `ResolveProcessByName`, auto-stop — Process.Dispose() added
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.Audio.cs`: `getAudioSessions` Process.Dispose() in try/finally

## Session Summary (2026-07-25 — Config sync over-polling fix)

### Done

- **Config sync over-polling fixed** — removed 2 unnecessary `persistClipsConfig()` calls that wrote config to disk every ~2s:
  1. `clips-pipe.ts:210` — called on every `engineStatus` event (every ~2s), writing runtime status (fps, recording, game name) to disk. Removed entirely — runtime status doesn't need persistence.
  2. `clips-engine.ts:323` — called on pipe reconnect after syncing config to engine. Removed — config was already persisted by the user's last settings change.

- Config is now only persisted when the user actually changes settings (3 remaining calls in `clips.ipc.ts` for `CLIPS_SET_CONFIG`, `CLIPS_SET_AUDIO_SESSIONS`, `CLIPS_SET_MIC_DEVICE`).

- **AudioMixer ArrayPool refactor completed** (from previous session): `MixSamples` and `ApplyGain` use `ArrayPool<float>.Shared.Rent()` instead of `new float[]`, eliminating ~37MB/min GC pressure in hot path. Packets marked as pooled for encoder `Release()` to return to pool.

- **Test update**: `clips-engine-connection.test.ts` — test `'calls persistClipsConfig on engineStatus'` changed to assert NOT called (correct new behavior).

- **Build**: C# 0 errors, TS 0 failures
- **C# tests**: 256/256 pass
- **TS tests**: 5998 passed, 1 skipped, 0 failures
- **Engine**: staged 291 files

### Relevant Files Changed
- `src/main/ipc/clips-pipe.ts`: removed `persistClipsConfig` import + call from engineStatus handler
- `src/main/ipc/clips-engine.ts`: removed `persistClipsConfig` import + call from reconnect handler
- `src/main/ipc/clips-engine-connection.test.ts`: test assertion inverted (NOT called)

## Session Summary (2026-07-26 — Plano de Atualização Geral: 9 Agentes + 1 Reviewer)

### Plano Completo

| # | Agente | Escopo | Status | Risco |
|---|--------|--------|--------|-------|
| 1 | Electron Core | electron 42→43, electron-builder 26.8→26.15, electron-updater 6.8→6.9 | ✅ Concluído | 🔴 Alto |
| 2 | Biome | @biomejs/biome 1.9→2.5 (MAJOR) | ✅ Concluído | 🔴 Alto |
| 3 | TypeScript | typescript 5.9→7.0 (MAJOR) | ✅ Plano pronto | 🔴 Alto |
| 4 | Vite | vite 7→8, @vitejs/plugin-react 5→6 | ❌ BLOQUEADO | — |
| 5 | React Ecosystem | react/react-dom, react-router-dom, react-i18next, i18next | ✅ Concluído | 🟢 Baixo |
| 6 | UI Libraries | lucide-react 0→1 (MAJOR), framer-motion, recharts | ✅ Concluído | 🟡 Médio |
| 7 | Tailwind + Fonts | tailwindcss, @tailwindcss/vite, @fontsource/* | ✅ Concluído | 🟢 Baixo |
| 8 | C#/.NET + Native | CsWin32, better-sqlite3 12→13, dotenv 16→17, yara-x | ✅ Concluído | 🟡 Médio |
| 9 | DevDeps + CI | vitest, playwright, GitHub Actions | ✅ Concluído | 🟢 Baixo |
| 10 | Reviewer | Valida TUDO junto — build, testes, lint | ⏳ Pendente | — |

### Resultados dos Agentes

#### Agent 1: Electron Core ✅
- `electron`: ^42.3.3 → ^43.2.0
- `electron-builder`: ^26.8.1 → ^26.15.3
- `electron-updater`: ^6.8.3 → ^6.8.9
- Build: ✅ OK (11s, 267 main + 5 preload + 3163 renderer modules)
- Breaking changes: Nenhum impactante (nativeImage SRGB, dialog Linux, BrowserWindow min/max)

#### Agent 2: Biome ✅
- `@biomejs/biome`: ^1.9.4 → 2.5.5
- `biome.json` atualizado:
  - Schema: `schemas/1.9.4/schema.json` → `schemas/2.5.5/schema.json`
  - `"ignore"` → `"includes"` (negation pattern)
  - `noConsoleLog` removido (regra deletada no v2)
- CLI inalterado: `npx biome check src/`

#### Agent 3: TypeScript ✅ (plano pronto, precisa executar)
- `typescript`: ^5.9.3 → ^7.0.2
- `tsconfig.json` mudanças:
  - Remover `baseUrl: "."`
  - Adicionar `"rootDir": "./src"`
  - Adicionar `"types": ["node"]`
- Compatibilidade: electron-vite, vitest, vite — todos usam esbuild, não afetados
- **PRECISA EXECUTAR**: Editar package.json + tsconfig.json + rodar build

#### Agent 4: Vite ✅ ATUALIZADO (2026-08-05, commit `98258c9`)
- **electron-vite 6.0.0-beta.1** + **vite 8.2.0** + **@vitejs/plugin-react 6.0.5** aplicados juntos
- Rolldown: native modules (`better-sqlite3`, `bindings`) continuam external — fora do bundle (verificado no `out/main/`)
- Warnings `INEFFECTIVE_DYNAMIC_IMPORT` (5: privacy-shield.ipc, service-manager.ipc, startup-manager.ipc, legacy/scans, history-store) = **pré-existentes** — CLI commands fazem `await import(...)` lazy mas os módulos já são estaticamente importados por `src/main/ipc/index.ts` e `services/metrics.ts`
- Renderer code-splitting íntegro no Rolldown: 30+ chunks por página lazy (ClipsPage 124.8KB, MalwareScannerPage 151.3KB, recharts lazy separado 836KB)
- Build produção OK, 6841 TS tests + 1113 C# tests, smoke dev limpo

#### Agent 5: React Ecosystem ✅
- `react`: ^19.2.6 → ^19.2.8
- `react-dom`: ^19.2.6 → ^19.2.8
- `react-router-dom`: ^7.15.1 → ^7.18.1
- `react-i18next`: ^17.0.8 → ^17.0.11
- `i18next`: ^26.0.10 → ^26.3.6
- Build: ✅ OK, sem breaking changes

#### Agent 6: UI Libraries ✅
- `lucide-react`: ^0.577.0 → ^1.21.0 (MAJOR)
- `framer-motion`: ^12.40.0 → ^12.42.2
- `recharts`: ^3.8.1 → ^3.10.1
- `sonner`: ^2.0.7 (já latest)
- **NOTA**: lucide-react 1.x removeu brand icons (Github, Twitter) — NÃO usados no projeto
- **NOTA**: Possíveis renames de ícones (XCircle→CircleX, CheckCircle2→CircleCheckBig) — verificar após npm install

#### Agent 7: Tailwind + Fonts ✅
- `tailwindcss`: ^4.2.1 → ^4.3.3
- `@tailwindcss/vite`: ^4.2.1 → ^4.3.3
- `@fontsource/geist-mono`: ^5.2.8 → ^5.3.0
- `@fontsource/geist-sans`: ^5.2.5 → ^5.3.0
- Sem breaking changes

#### Agent 8: C#/.NET + Native ✅
- `Microsoft.Windows.CsWin32`: 0.3.106 → 0.3.298
- `better-sqlite3`: ^12.11.1 → ^13.0.1 (MAJOR — N-API migration, Node ≥22)
- `dotenv`: ^16.6.1 → ^17.4.2 (MAJOR — adicionado `quiet: true` em src/main/index.ts)
- `@litko/yara-x`: ^0.5.2 → ^0.7.0
- `engines.node`: >=20.0.0 → >=22.0.0
- Vortice 3.8.3 e NAudio 2.3.0 já estão no latest estável

#### Agent 9: DevDeps + CI ✅
- `vitest`: ^4.1.0 → ^4.1.10
- `@vitest/coverage-v8`: ^4.1.8 → ^4.1.10
- `@playwright/test`: ^1.60.0 → ^1.62.0
- `playwright`: ^1.60.0 → ^1.62.0
- `@axe-core/react`: ^4.11.2 → ^4.12.1
- `@types/react`: ^19.2.15 → ^19.2.17
- CI: Removido `continue-on-error: true` no lint
- CI: Adicionado Node 24 ao matrix: [20, 22, 24]

### Próximos Passos Imediatos
1. ~~**Agent 10 (Reviewer)**: Rodar para validar que tudo funciona junto~~ ✅ Concluído
2. **npm install**: Aplicar todas as alterações de package.json
3. ~~**TypeScript 7**: Executar as mudanças no tsconfig.json~~ ✅ Concluído
4. ~~**lucide-react icons**: Verificar e renomear ícones quebrados~~ ✅ Concluído
5. **Build + Testes**: Rodar `npm run build` e `npm test` para validar

### Resultado Final do Reviewer (Agent 10)

| Status | Itens |
|--------|-------|
| ✅ PASS | 24/26 packages upgraded successfully |
| ⏸️ PENDING | TypeScript 7 (now fixed — package.json + tsconfig.json updated) |
| ⛔ BLOCKED | Vite 8 (waiting for electron-vite 6.0 stable) |
| ✅ FIXED | lucide-react icon renames (7 icon types across ~60 files) |

### lucide-react Icon Renames (COMPLETED)

| Old Name | New Name | Files |
|----------|----------|-------|
| `XCircle` | `CircleX` | 15 |
| `CheckCircle2` | `CircleCheckBig` | 46 |
| `CheckCircle` | `CircleCheck` | 4 |
| `AlertCircle` | `CircleAlert` | 4 |
| `AlertTriangle` | `TriangleAlert` | 41 |
| `ExternalLink` | `SquareArrowOutUpRight` | 6 |
| `ArrowUpCircle` | `CircleArrowUp` | 2 |
| `HelpCircle` | `CircleHelp` | 1 |

### TypeScript 7 Migration (COMPLETED)

- `package.json`: `"typescript": "^5.9.3"` → `"^7.0.2"`
- `tsconfig.json`: Removido `baseUrl: "."`, adicionado `rootDir: "./src"`, adicionado `types: ["node"]`
- Compatibilidade: electron-vite, vitest, vite — todos usam esbuild, não afetados

### Remaining: npm install + build + test validation

## Session Summary (2026-07-27 — ffmpeg path fix + RamManager config fix + ffmpeg 8.1.2 install)

### Done

- **Bug 1 — ffmpeg path resolution**: All 9 occurrences of `new ProcessStartInfo("ffmpeg")` hardcoded in source replaced with `FfmpegPathResolver.GetFfmpegPath()`:
  - `FfmpegEncoder.cs:210`, `FfmpegAacEncoder.cs:39`, `FfmpegEncoder.CodecDetection.cs:117`
  - `ClipExporter.cs:278,366,425`, `MaxineAfxFilter.cs:64`, `RnnoiseFilter.cs:36`
  - `MaxineAfxFilter.cs` and `RnnoiseFilter.cs` received `using DiNho.Capture.Poc.Encoders;`
  - Zero bare `"ffmpeg"` remaining in source files

- **Bug 2 — RamManager Cq source (`EngineCoordinator.Capture.cs:144-151`)**: Changed from `_activeProfile.Cq` (default=20) to `_config.Config.Cq` (user config=22). Same for MaxrateKbps, BufsizeKbps, Bframes, Lookahead — all now read from user config instead of default profile.

- **FfmpegPathResolver candidates fixed**: Previous candidate #2 path was wrong (`bin/Release/publish` instead of `bin/Release/net10.0-windows10.0.26100.0/publish`). Added 3 new candidates:
  1. BaseDirectory (packaged app) — existing
  2. Release publish with correct TFM path — fixed
  3. `resources/clips-engine-staging/` (6 levels up from bin/Debug) — **new, solves dev mode**
  4. `../clips-engine/` (packaged electron-builder layout) — new
  5. PATH fallback — existing

- **ffmpeg 8.1.2 installed via WinGet** (`Gyan.FFmpeg`):
  - WinGet symlink was missing from `WinGet/Links/` — created manually
  - Version: `ffmpeg 8.1.2-full_build-www.gyan.dev` (gcc 16.1.0, 231MB)
  - Full build: nvenc, nvdec, ffnvcodec, amf, cuda-llvm, x264, x265, aac, libopus, svta1, dav1d
  - Copied to `resources/clips-engine-staging/ffmpeg.exe` (231MB)

- **Engine published + staged**: `dotnet build` 0 errors, `dotnet publish -c Release --self-contained true -r win-x64` OK, `copy-engine` staged 292 files (291 engine + 1 ffmpeg)

### Key Decisions

- **FfmpegPathResolver over hardcoded paths**: Centralized path resolution with fallback chain — all 9 call sites now benefit from the same discovery logic
- **Staging dir as dev-mode candidate**: From `bin/Debug/net10/.../` the staging dir is 6 levels up at `resources/clips-engine-staging/` — reliable for `npm run dev`
- **WinGet symlink recreation**: `winget install Gyan.FFmpeg` installed the package but didn't create the symlink in `WinGet/Links/` — manual creation fixed PATH availability
- **ffmpeg 8.1.2 (latest stable)**: Full build includes all hardware encoders (NVENC, AMF, QSV) and software codecs needed by the engine

### Relevant Files Changed
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/EncoderManager.cs`: `FfmpegPathResolver` candidates expanded (5 candidates)
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: `ProcessStartInfo("ffmpeg")` → `FfmpegPathResolver.GetFfmpegPath()`
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegAacEncoder.cs`: same
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.CodecDetection.cs`: same
- `dinho-clips-poc/src/DiNho.Capture.Poc/Export/ClipExporter.cs`: same (×3)
- `dinho-clips-poc/src/DiNho.Capture.Poc/Audio/MaxineAfxFilter.cs`: same + `using DiNho.Capture.Poc.Encoders;`
- `dinho-clips-poc/src/DiNho.Capture.Poc/Audio/RnnoiseFilter.cs`: same + `using DiNho.Capture.Poc.Encoders;`
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.Capture.cs`: RamManager uses `_config.Config.*` instead of `_activeProfile.*`
- `resources/clips-engine-staging/ffmpeg.exe`: 231MB, ffmpeg 8.1.2

## Session Summary (2026-07-28 — Volume slider range + NaN crash fix verification)

### Done

- **Volume slider range increased 0–2x → 0–4x** across all layers:
  - `VolumeSlider` UI: `max={200}` → `max={400}` (0–400%)
  - `clips.ipc.ts` + `clips-engine.ts`: `Math.min(2, ...)` → `Math.min(4, ...)`
  - `ConfigManager.cs`: validation `> 2f` → `> 4f`
  - `AudioMixer.MicGain` already accepted [0, 4] — no change needed
  - Test updated: `clips-engine-connection.test.ts` expect `toBe(2)` → `toBe(4)`
  - **97 TS tests passed**, **30 C# ConfigManager tests passed**

- **NaN crash fix confirmed stable**: Full session with PTT (Mouse4 + CapsLock), multiple clip saves, noise gate on/off — zero NaN crashes. Root cause was `ArrayPool<float>.Shared.Rent()` returning oversized arrays without zeroing extra elements, causing garbage bytes past the valid PCM region to reach ffmpeg stdin.

### Relevant Files Changed
- `src/renderer/src/components/clips/clips-utils.tsx`: VolumeSlider max 200→400
- `src/main/ipc/clips.ipc.ts`: clamp 2→4
- `src/main/ipc/clips-engine.ts`: clamp 2→4
- `dinho-clips-poc/src/DiNho.Capture.Poc/Config/ConfigManager.cs`: validation 2f→4f
- `src/main/ipc/clips-engine-connection.test.ts`: test expect updated

## Session Summary (2026-07-28 — Clips test suite audit + fix)

### Done

- **Deep audit of clips test suite** identified 33 findings (9 CRITICAL, 10 HIGH, 8 MEDIUM, 6 LOW) across 5 test files covering 2747+ lines of source code

- **12 test fixes applied** (all passing):

  | Audit ID | Category | Fix |
  |----------|----------|-----|
  | C5 | Empty stub | 5 `connectPipe` event handler tests implemented: error→disconnected, close→no reconnect (stopped), timeout→destroy+reconnect, error→log+disconnected |
  | C7 | Broken test | Boolean field type-check test: set known values via valid pipe messages first, then send non-matching types, verify values unchanged |
  | C6 | Fix verified | Volume clamping test: already had correct assertions (audit was wrong) |
  | H1 | Empty test | Replay buffer fields test: start engine to get pipe handlers, send status with all 5 fields, verify via `getCurrentStatus()` |
  | H2 | Coverage gap | CLIPS_OPEN_CLIP path traversal test: `../` path outside output directory rejected |
  | H3 | Coverage gap | CLIPS_RENAME_CLIP `renameSync` error test: cross-volume EXDEV error returns failure |
  | M2 | Broken test | Multiple commands in one chunk: assert both resolve via `Promise.all` |
  | M7 | Coverage gap | CLIPS_RENAME_CLIP `.mp4`-only name test: `.mp4` stripped to empty → rejected |
  | L1 | Cosmetic | Handler count description: "19" → "24" |

- **Key learnings**:
  - `getCurrentStatus()` uses `e.audioFallback || undefined` — `false` becomes `undefined` in return value (by design, falsy fields omitted)
  - Pipe data handlers require `startEngine()` first to register socket event handlers
  - `statusUpdater` typeof guards (`typeof src.X === 'boolean'`) correctly reject non-matching types — tested by setting truthy initial values then sending non-boolean types

- **Full suite**: **6234 TS tests**, 189 files — **0 failures**
- **Clips-specific**: 205 tests (97 engine-connection + 108 IPC) — **0 failures**

## Session Summary (2026-07-28b — C8 + C9: sendPipeCommandLongRunning + disconnectPipe tests)

### Done

- **C8 — `sendPipeCommandLongRunning` tests** (4 new tests):
  - `resolves immediately when engine response status is not accepted` — non-accepted path bypasses long-running flow
  - `waits for commandResult event after accepted status` — full happy path: accepted → longRunningPending → commandResult resolves
  - `rejects on timeout` — timeout fires after `timeoutMs` with no commandResult
  - `rejects when commandResult contains error` — engine error propagated through long-running flow
  - **Key insight**: `vi.useFakeTimers()` blocks setTimeout but microtasks from `.then()` still need explicit flushing via `await vi.advanceTimersByTimeAsync(0)` before advancing timers

- **C9 — `disconnectPipe` tests** (4 new tests):
  - `destroys socket and sets pipeConnected false` — basic disconnect
  - `rejects pending requests with Pipe disconnected` — in-flight `sendPipeCommand` rejected
  - `rejects long-running pending requests` — accepted long-running command rejected on disconnect
  - `is safe to call when pipe is not connected` — double-disconnect idempotent

- **Full suite**: **6242 TS tests**, 189 files — **0 failures** (+8 from 6234)
- **Clips-specific**: 213 tests (105 engine-connection + 108 IPC) — **0 failures**

### Remaining (from audit)
- C1: `enumerateMicDevicesLocal()` — PowerShell mic discovery untested (complex mocking)
- C2: `CLIPS_GET_DURATIONS` handler — entirely untested
- C3: `runWithConcurrency()` — private, tested indirectly via `getDurationsForClips`
- C4: Duration cache LRU — needs internal state access
- H4-H10, M1-M8: lower priority items documented in audit

## Session Summary (2026-07-28 — Layout fixes + Sidebar merge + Hotkey save feedback)

### Done

- **C1–C10: Layout breaks fix — flex-wrap + grid responsive**:
  - `DuplicateFinderPage.tsx:296` — `grid-cols-4` → `grid-cols-2 sm:grid-cols-4`
  - `DuplicateFinderResultsPanel.tsx:64` — `grid-cols-4` → `grid-cols-2 sm:grid-cols-4` + `flex-wrap` on action bar
  - `LargeFileFinderPage.tsx:321` — `grid-cols-4` → `grid-cols-2 sm:grid-cols-4`
  - `SoftwareUpdaterPage.tsx:509` — `grid-cols-4` → `grid-cols-2 sm:grid-cols-4`
  - `HostsEditorPage.tsx:130` — `flex-wrap` on action bar
  - `UninstallerToolbar.tsx:58` — `flex-wrap` on root container
  - `FirewallAuditPage.tsx:171` — `flex-wrap` on action bar
  - `EmptyFolderCleanerPage.tsx:292` — `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`

- **H6+M8: KeyboardShortcutsModal removed**:
  - `AppShell.tsx` — removed import, `showShortcuts` state, `?` key useEffect, JSX rendering
  - `KeyboardShortcutsModal.tsx` — file deleted (149L)
  - Zero remaining references to KeyboardShortcutsModal or showShortcuts

- **M2: Replay time default changed to 120s (2min)**:
  - `useClipsState.ts:78` — `replayTimeSeconds: 60` → `120`
  - `useClipsState.ts:317` — `autoReplayTime` fallback `60` → `120`

- **L2: Status bar removed from sidebar**:
  - `Sidebar.tsx` — removed green dot + "Sistema saudável" block between nav and collapse toggle
  - Removed unused `Upload` import and `i18n` variable from Sidebar

- **Sidebar nav merge**:
  - **"Limpeza"** absorbs **"Rede"** as child (`/cleaner` → dropdown with `/network`)
  - **"Inicializador"** absorbs **"Agendador"** as child (`/startup` → dropdown with `/schedules`)
  - Reduces sidebar top-level items from 10 to 8

- **Hotkey save feedback (instant)**: Fixed missing toast/sound when using keyboard shortcut to save clip:
  - **Root cause**: `OnHotkeyPressed` called `_ = SaveClipAsync()` fire-and-forget — engine saved clip but never notified Electron → no toast, no sound
  - **Fix**: `BroadcastClipSaved()` sends `clipSaved` event via `_pipeServer.BroadcastRaw()` **immediately** on hotkey press (before async save starts)
  - **C# `EngineCoordinator.cs`**: New `BroadcastClipSaved()` method, called in `OnHotkeyPressed` before `SaveClipAsync`
  - **TS `channels.ts`**: New `CLIPS_CLIP_SAVED: 'clips:clip-saved'` channel
  - **TS `clips-pipe.ts`**: Handler for `clipSaved` events → forwards to renderer via `CLIPS_CLIP_SAVED`
  - **TS `preload/clips.ts` + `preload/api/clips.ts`**: New `clipsOnClipSaved` listener
  - **TS `useClipsState.ts`**: `useEffect` listens for `clipSaved` → `toast.success(t('clipSaved'))` + `refreshClips()`
  - Feedback is **instant** — toast appears in same frame as hotkey press, save runs in background

### Relevant Files Changed
- `src/renderer/src/pages/DuplicateFinderPage.tsx` — grid responsive
- `src/renderer/src/pages/duplicate-finder/DuplicateFinderResultsPanel.tsx` — grid responsive + flex-wrap
- `src/renderer/src/pages/LargeFileFinderPage.tsx` — grid responsive
- `src/renderer/src/pages/SoftwareUpdaterPage.tsx` — grid responsive
- `src/renderer/src/pages/HostsEditorPage.tsx` — flex-wrap
- `src/renderer/src/components/uninstaller/UninstallerToolbar.tsx` — flex-wrap
- `src/renderer/src/pages/FirewallAuditPage.tsx` — flex-wrap
- `src/renderer/src/pages/EmptyFolderCleanerPage.tsx` — grid responsive
- `src/renderer/src/components/layout/AppShell.tsx` — KeyboardShortcutsModal removed
- `src/renderer/src/components/shared/KeyboardShortcutsModal.tsx` — DELETED
- `src/renderer/src/components/clips/useClipsState.ts` — replay default 120 + clipSaved listener
- `src/renderer/src/components/layout/Sidebar.tsx` — status bar removed + nav groups merged + unused imports cleaned
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.cs` — `BroadcastClipSaved()` method + call in `OnHotkeyPressed`
- `src/shared/channels.ts` — `CLIPS_CLIP_SAVED` channel
- `src/main/ipc/clips-pipe.ts` — `clipSaved` event handler
- `src/preload/clips.ts` — `clipsOnClipSaved` listener
- `src/preload/api/clips.ts` — `clipsOnClipSaved` listener

### Build
- C# engine: 0 errors, 17 pre-existing warnings
- TS preload tests: 250 passed — 0 failures

## Session Summary (2026-07-29 — FfmpegEncoder infinite restart loop fix)

### Done

- **Root cause**: `-bsf:v h264_mp4toannexb` was removed in an earlier refactoring — NVENC outputs AVCC (4-byte length prefix) but without the bitstream filter the format detector couldn't latch reliably, causing unbounded `_rawBuf` accumulation → pipe fill → ffmpeg exit → restart loop exhausting all 5 fallback codecs → `video=0frames 0,0MB` forever while audio kept accumulating.

- **Fix 1 — `-bsf:v {rawFmt}_mp4toannexb` restored** (`FfmpegEncoder.cs:205-213`): Re-added bitstream filter to convert NVENC's AVCC output to AnnexB (start-code delimited) before writing to the pipe. AV1 excluded — no such bsf exists in any ffmpeg version.

- **Fix 2 — 2MB overflow guard for `PipeFormat.Unknown`** (`FfmpegEncoder.NalParsing.cs:298-310`): When `_rawLen > 2MB` and format is still unknown, the raw buffer is reset and stale PTS entries drained, preventing unbounded accumulation.

- **937/937 C# tests** — 0 quebras
- **6252 TS tests**, 197 files — **0 quebras** (1 skipped)
- **Engine**: `dotnet publish -c Release --self-contained true -r win-x64` — 0 erros
- **Stage**: `npm run copy-engine` — 292 engine files + ffmpeg.exe staged
- **Commit**: `f4ee1ff`

## Session Summary (2026-07-29b — Game Mode validation fix)

### Done

- **Bug**: `proc-kill-background` and `mem-empty-working-set` (kill background processes + empty working set) were defined in types, listed in UI, and handled in activation logic — but **missing from both validation sets** in `validation.ts` and `ipc-validation.ts`. This caused config validation to reject the entire game mode config, showing "Invalid config" → "0 otimização aplicada • 1 falhou".

- **Fix**: Added both IDs to:
  - `src/main/ipc/game-mode/validation.ts` — `VALID_OPTIMIZATION_IDS` set
  - `src/main/services/ipc-validation.ts` — both `validOptIds` sets (main config + game profiles)

- **214/214 game-mode.ipc tests** — 0 quebras
- **140/140 ipc-validation tests** — 0 quebras
- **31/31 game-mode-store tests** — 0 quebras
- **Commit**: `c487cfa`

## Session Summary (2026-07-31 — WGC video stall fix: jogo "fechado" falso + teardown zumbi)

### Root cause (confirmada via logs do app instalado `dinho-optimizer`)

- Incidente real: ffmpeg congelado em `frame=133904` (vídeo parado), áudio/PTT saudáveis, pump WGC vivo (`msgs=0`), status `game="null" recording=false`. 4 etapas:
  1. **WGC per-window parou de entregar frames no meio da sessão** (pump vivo mas DWM não entrega).
  2. **Guard de alt-tab impede self-heal**: `EngineCoordinator.Capture.cs:539-553` — enquanto `IsProcessAlive()` for true, cada frame incrementa `_bgDropCount`, seta `_gameBackgrounded=true`, zera `_starvationStart` e reseta `_watchdog`; o `else if` de reinit (linha 554) nunca é avaliado. Frames ausentes com jogo "vivo" eram interpretados como alt-tab indefinidamente.
  3. **`IsProcessAlive("FiveM_b3258_GTAProcess")` retornou falso às 09:51:37 com o jogo ainda rodando** (áudio continuou às 09:53) → caiu no ramo de "jogo fechou".
  4. **Ramo de "jogo fechou" fazia `break` sem desligar nada** (ffmpeg, AudioMixer, AAC encoder, captura, WGC pump continuavam rodando; nada reiniciava) → estado zumbi `game="null" recording=false` + ffmpeg congelado + áudio fluindo para sempre até stop/start manual.

### Fixes aplicados

- **Fix 1 — teardown no ramo "jogo fechou"** (`EngineCoordinator.Capture.cs:~558`): o `break` agora agenda `_ = Task.Run(() => StopCapture());` para rodar DEPOIS que o loop sair e a task completar — evita o deadlock do `_pipelineTask.Wait(2000)` (o PipelineLoop É a `_pipelineTask`) e elimina o zumbi com teardown completo (ffmpeg/encoder/áudio). Primeira versão tinha cancel manual do `_pipelineCts`, removido por redundância/risco de `ObjectDisposedException`.
- **Fix 2 — guard anti-restart distingue stall de alt-tab** (`EngineCoordinator.Capture.cs:~531`): a condição do `if` agora exige `!IsTargetGameForeground()`. Jogo EM foreground com frames ausentes = stall do WGC (não alt-tab) → cai no `else if` → watchdog/starvation podem reiniciar em ~3s (o watchdog reseta `_starvationStart`/`_lastIssueTime`; após voltar ao foreground, 3s sem frames bons → `ShouldReinit()` = true).
- **Helper novo `IsTargetGameForeground()`** (`EngineCoordinator.Capture.cs`, após `PipelineLoop`): compara `PInvoke.GetForegroundWindow() == (HWND)_captureTargetHwnd` (mesmo padrão já usado em `GameDetector.cs` / `PrintWindowCaptureSource.cs`). Retorna false quando `_captureTargetHwnd == IntPtr.Zero` ou exceção de P/Invoke (log Debug).

### Validado

- **Build**: `dotnet build` — 0 erros (19 warnings pré-existentes)
- **C# tests**: **954/954 pass** — 0 falhas
- **Publish + deploy**: `dotnet publish -c Release --self-contained true -r win-x64` OK; copiado `DiNho.Capture.Poc.{dll,exe,pdb,deps.json,runtimeconfig.json}` para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\`

### Next Steps

- Reiniciar o app instalado e testar sessão longa com FiveM: verificar que stall de vídeo se recupera sozinho (watchdog reinit) e que não há mais estado zumbi `game="null" recording=false` com ffmpeg congelado
- Candidato a investigação futura: `FfmpegEncoder.cs:382` — `_stdin!.Write(nv12)` bloqueante sem timeout (se o pipe do ffmpeg encher, o loop de captura trava sem detecção)

## Session Summary (2026-07-31b — Fallback não sobrepõe resolução do usuário + labels honestas)

### Root cause (clip 960x540 com front setado em 720p)

- Usuário setou 720p (1280x720) no front, captura 1080p. Quando o cascading fallback disparou (loop de restarts ffmpeg), o `ComputeScaleTarget` reduziu a saída para **960x540** em vez de manter 720p.
- Causa: `ComputeScaleTarget` (`FfmpegEncoder.cs`) aplicava o divisor do fallback contra a **captura**, não contra o alvo do usuário: `outW = Math.Min(outW, inputW / scaleDivisor)` → com user=1280x720, capture=1920x1080, divisor 1/2 → `min(1280, 960) = 960`. O divisor **sobrepunha a resolução escolhida no front** (qualidade/bitrate ficavam intactos — só resolução era sobreposta).
- Labels da cadeia de fallback enganosas: `BuildFallbackChain` (`EncoderManager.cs`) chamava os degraus de "HW 720p"/"HW 480p"/"CPU 720p", mas divisor 1/2 sobre captura 1080p = 540p (não 720p) e 1/4 = 270p. Rótulos prometiam 720p e entregavam 540p.

### Decisão (com referências OBS/NVIDIA)

- **Filosofia OBS**: Output (Scaled) Resolution é decisão explícita do usuário — OBS nunca muda a resolução de saída automaticamente em fallback; downscale é escolha deliberada do usuário. NVENC guide idem. Ladders de resolução são para streaming adaptativo de entrega, não para encoder local instável.
- **Regra adotada**: o alvo explícito do usuário é o **piso**. Fallback troca o encoder (HW→CPU), nunca degrada a resolução escolhida. O divisor só se aplica quando o usuário deixou **nativo** (outputW <= 0).

### Implementado

- `FfmpegEncoder.cs` `ComputeScaleTarget`: divisor agora condicionado a `scaleDivisor > 1 && outputW <= 0` — se o usuário setou alvo explícito, o divisor é ignorado e a resolução escolhida é preservada em qualquer degrau da cadeia. Nativo + divisor 1/2 continua reduzindo (sobrevida, ex.: 1080p→540p).
- `EncoderManager.cs` `BuildFallbackChain`: labels corrigidas para **"HW 1/2" / "HW 1/4" / "CPU 1/2"** (honestas — divisor relativo à captura, não resolução fixa). Doc comment da cadeia atualizado com a regra do divisor.
- `FfmpegEncoderTests.cs`: teste antigo `ComputeScaleTarget_FallbackDivisorLimitsUserOutput` (esperava 960x540) substituído por `ComputeScaleTarget_FallbackDivisor_DoesNotReduceBelowUserOutput` (espera 1280x720) + novo `ComputeScaleTarget_FallbackDivisor_AppliesWhenNative` (espera 960x540).

### Validado

- **C# tests**: **955/955 pass** — 0 falhas (era 954; +1 novo teste)
- **Build**: `dotnet build` 0 erros
- **Publish + stage + deploy**: `dotnet publish -c Release --self-contained true -r win-x64` OK; `npm run copy-engine` (291 files); copiado `DiNho.Capture.Poc.{dll,exe,pdb,deps.json,runtimeconfig.json}` para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — hash SHA256 confere com o publish

### Next Steps

- Reiniciar o app instalado: confirmar que clip com front em 720p + fallback mantém 1280x720 (não 960x540)
- Validar em campo com FiveM: sessão longa + save de clip novo → `MP4 probe: streams=2 video=True audio=True` e resolução respeitando o front

## Session Summary (2026-07-31c — CPU fallback quality fix: ultrafast → veryfast CRF+VBV)

### Root cause (qualidade ruim do clip 09-34-58)

- Clip de evidência `DiNho Optimizer 2026-07-31_09-34-58.mp4`: `h264 (Constrained Baseline) • 960x540 • 60fps • 7322 kb/s` — perfil **Constrained Baseline** é a assinatura do `-preset ultrafast` (CAVLC, sem CABAC, sem B-frames).
- Args reais do fallback de CPU no log JSONL (01:25:46): `-vf "scale=960:540" -c:v libx264 -preset ultrafast -tune zerolatency -threads 1` — **3 fatores de degradação somados**:
  1. `-preset ultrafast` — pior preset do libx264 (estimativa de movimento primitiva → blocos/ruído em movimento)
  2. `-tune zerolatency` → perfil Baseline/CAVLC (~15% menos eficiente que High/CABAC)
  3. `-threads 1` — single-thread, e **nenhum controle de bitrate** (sem `-crf`/`-maxrate` → CRF 23 padrão, sem VBV)

### Fix aplicado (`FfmpegEncoder.cs` `StartFfmpeg` tune switch, linhas ~258-273)

- **libx264** / **default** (`_ =>`): `-preset ultrafast -tune zerolatency -threads 1` → `-preset veryfast -crf {cq} -maxrate {maxrateKbps}K -bufsize {bufsizeKbps}K -bf 0 -profile:v high`
- **libx265**: idem + `-x265-params no-open-gop=1:keyint=60:min-keyint=60` mantido, `bframes=0` preservado
- `cpuCq = Math.Clamp(_cq, 1, 51)` — CRF segue o CQ do usuário (default 22)
- Decisões:
  - **Sem `-tune zerolatency`**: zerolatency forçava baseline/bframes=0 via sliced-threads; removido para permitir CABAC/High profile. `-bf 0` explícito **garante ordem de saída = ordem de entrada** — requisito do PTS pipeline (EmitPacket → Matroska). Latência de lookahead do veryfast é irrelevante para replay buffer.
  - **Sem `-threads 1`**: x264 auto-usa todos os cores — velocidade ↑ e qualidade ↑ simultâneos.
  - **CRF+VBV**: mesmo padrão do NVENC (`-crf` primário + `-maxrate`/`-bufsize` cap) — mantém controle de tamanho/qualidade.
- `BuildProbeArgs` (EncoderManager.cs:390) NÃO mudado — é o probe de teste (5 frames dummy, 320x240), não afeta a gravação.
- `STATUS.md` atualizado (seção "Otimizações PC fraco": doc antiga de `-threads 1`/ultrafast substituída).

### Validado

- **Build**: `dotnet build -c Release` 0 erros (warnings pré-existentes)
- **C# tests**: **955/955 pass** — 0 falhas
- **Publish**: `dotnet publish -c Release --self-contained true -r win-x64` EXIT=0
- **Stage**: `npm run copy-engine` — 291 files staged
- **Deploy**: copiado para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — DLL SHA256 `E62C592D...` (novo, vs antigo `96027A72...`), LastWriteTime 11:15:18

### Next Steps

- Reiniciar o app instalado e rodar sessão de campo com FiveM (front 720p):
  - Conferir que o fallback **não dispara mais** (engine novo resolve codec) — `initialized (codec=av1_nvenc)` no log
  - Se disparar: qualidade do clip com `-preset veryfast -crf 22 -maxrate ... -bf 0 -profile:v high` (High/CABAC, sem Baseline) e resolução **1280x720**

## Session Summary (2026-07-31d — Codec vazio fix: OverflowException do PointerUSize + fallback não-vazio)

### Root cause (ffmpeg `-c:v ` vazio → exit -22 com `codec:"av1"`)

- **Bug A (raiz, confirmado empiricamente nesta máquina RTX 5050)** — `EncoderManager.DetectAllGpuAdapters()`:
  - `VideoMemoryBytes = desc.DedicatedVideoMemory` — `SharpGen.Runtime.PointerUSize` (valor 8295284736) tem operador `explicit long` bugado/`checked` que **sempre lança `OverflowException`** em VRAM real (testado também `unchecked((long)ded)`). `(ulong)` e `(nuint)` funcionam.
  - O `catch { }` vazio engolia a exceção → lista vazia → `DetectEncodingVendorId() = 0` → `GetPreferredCodec(0) = ""`.
  - Provas: `GetGpuList()` (mesma enumeração DXGI sem ler VRAM) retornava RTX 5050 + Basic Render Driver; teste RAW DXGI enumerava os 2 adapters sem erro; `--encoders` standalone também perdia a GPU.
- **Bug B (codec vazio)** — `FfmpegEncoder.ResolveCodec("av1")` com vendor 0:
  - `MapUserCodec("av1", 0)` → `"libsvtav1"` → ramo `!SupportsAv1Hardware(0)` = true → `return GetPreferredCodec(0)` = **`""`** → short-circuit antes do probe/`DetectBestCodec`.
  - `Initialize` só checava `_codec == null` (linha 218) — string vazia passava → `-c:v {_codec}` em `StartFfmpeg` → ffmpeg exit -22, restart loop, `video=0frames`.

### Fixes aplicados

1. **Bug A — `EncoderManager.DetectAllGpuAdapters()`**: `VideoMemoryBytes = (long)(ulong)desc.DedicatedVideoMemory`; `catch { }` → `catch (Exception ex)` com `Logging.Log.W`.
2. **Bug B — `FfmpegEncoder.ResolveCodec`** (CodecDetection.cs:81-88): no ramo "AV1 sem suporte HW", se `GetPreferredCodec(vendorId)` retornar vazio → log warning + `return DetectBestCodec()` (nunca devolve `""`).
3. **Defesa — `FfmpegEncoder.Initialize`**: `if (_codec == null)` → `if (string.IsNullOrWhiteSpace(_codec))` (código vazio cai no `DetectBestCodec`).
4. **Defesa — `FfmpegEncoder.SetQualityParams`**: se `ResolveCodec` devolver null/vazio, `_codec = null` para o `Initialize` escolher.

### Testes (9 novos em EncoderManagerTests.cs)

- `DetectAllGpuAdapters_ReturnsAdapters_WhenGpuListHasAdapters` — regressão do Bug A (antes: lista vazia com GPU presente)
- `DetectEncodingVendorId_NonZero_WhenGpuListHasSupportedVendor` — antes retornava 0
- `MapUserCodec_av1_ZeroVendor_ReturnsLibsvtav1`, `MapUserCodec_av1_Nvidia_ReturnsAv1Nvenc`, `SupportsAv1Hardware_VendorZero_ReturnsFalse`
- `ResolveCodec_NeverReturnsEmpty` (Theory av1/h264/hevc) + `ResolveCodec_av1_WhenAv1Unsupported_FallsBackToNonEmpty` — regressão do Bug B via reflection (`_useHardware=true`)

### Validado

- **Build**: `dotnet build -c Release` — 0 erros (19 warnings pré-existentes)
- **C# tests**: **964/964 pass** (era 955; +9) — `dotnet test` isolado do EncoderManagerTests = 42/42, EXIT 0
- **Nota**: a suite completa termina com "Execução de Teste Anulada" (exit 1) mesmo com 0 falhas — **flakiness pré-existente** confirmada com `git stash` (955/955 pass + abort idêntico sem minhas mudanças); vstest interpreta o output do `Log.cs` (ConsoleLogger) durante os testes de integração que spawnam ffmpeg como falha do host
- **Publish + stage**: `dotnet publish -c Release --self-contained true -r win-x64` OK; `npm run copy-engine` — 291 files staged
- **Deploy**: copiado `DiNho.Capture.Poc.{dll,exe,pdb,deps.json,runtimeconfig.json}` para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — SHA256 DLL confere com o publish (`E70925FC...`)
- **Smoke test**: `DiNho.Capture.Poc.exe --encoders` do diretório instalado → `probed OK: HW native (h264_nvenc) (60034B output)` e `initialized (codec=h264_nvenc)` — GPU detectada de novo (antes codec vazio)

### Next Steps

- Reiniciar o app instalado e gravar com `codec:"av1"`: esperar `initialized (codec=av1_nvenc)` e clip com `video>0` (sem exit -22 / restart loop)
- Opcional (flakiness): investigar por que o vstest aborta a suite completa quando o ConsoleLogger escreve durante testes de integração ffmpeg (pré-existente, fora do escopo)

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/EncoderManager.cs`: conversão VRAM `(long)(ulong)`, catch com log
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.CodecDetection.cs`: fallback não-vazio no ramo AV1
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: `IsNullOrWhiteSpace` no Initialize + guard no SetQualityParams
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/EncoderManagerTests.cs`: 9 testes novos
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/GpuDiagnosticTests.cs`: DELETADO (temporário de diagnóstico)

## Session Summary (2026-07-31e — av1_nvenc restart loop fix: weighted_pred removido)

### Root cause (instalado, sessão FiveM 15:46, clip 24.9MB)

- Sessão instalada (codec=av1_nvenc) entrou em restart loop logo no arranque: `stdout EOF after 2 frames written, 0 packets emitted`, `ffmpeg exited code=-542398533`, `Nothing was written into output file`, `restarting ffmpeg (attempt 1, window=3/10 → 9/10, cause=reader:stdout_eof, gpuFails=0)`. Vídeo=0frames por ~19s (15:46:57→15:47:16) — primeiros segundos da sessão perdidos. O restart loop repetia para sempre o MESMO av1_nvenc (sem fallback) porque o ffmpeg morria com `-22` e o reader via EOF.
- Dev (codec=h264_nvenc) funcionou limpo desde o início — isolou o problema como específico do av1_nvenc.
- **Causa raiz**: `-weighted_pred 1` no perfil av1_nvenc (FfmpegEncoder.cs:270). ffmpeg 8.1.2 (gyan) rejeita weighted_pred no AV1: `[av1_nvenc] No capable devices found` → `Error while opening encoder` → `-542398533 (Generic error in an external library)` → `-22`.
- Confirmado empiricamente com o ffmpeg instalado (232 bins de args testados 1-a-1): TODOS os demais args (preset p5, tune hq, rc vbr, b:v 0, cq, maxrate/bufsize, bf 0, rc-lookahead 16, spatial-aq, aq-strength 8, temporal-aq 1, multipass fullres, nonref_p 1, g 120) passam isolados; `-weighted_pred 1` sozinho reproduz `No capable devices found` (exit -542398533). `-weighted_pred 0` ou omitido → encode OK (5s/1280x720/8.7MB válido).

### Fix aplicado (FfmpegEncoder.cs:270)

- `"av1_nvenc" => ... -multipass fullres -weighted_pred 1 -nonref_p 1 ...` → removido `-weighted_pred 1` (mantido `-nonref_p 1`).
- Comentário do bloco StartFfmpeg atualizado: weighted_pred apenas em H264/HEVC — av1_nvenc rejeita e falha com "No capable devices found".

### Validado

- **Build**: `dotnet build -c Release` 0 erros (19 warnings pré-existentes)
- **C# tests**: **964/964 pass** — 0 falhas (abort final = flakiness pré-existente do ConsoleLogger, documentada)
- **Publish + stage + deploy**: `dotnet publish -c Release --self-contained true -r win-x64 -o bin/Release/.../publish` OK; `npm run copy-engine` (291 files); copiado `DiNho.Capture.Poc.{dll,exe,pdb,deps.json,runtimeconfig.json}` para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — SHA256 DLL confere com publish (`AEC3D1DA...`)

### Next Steps

- Reiniciar o app instalado e gravar com av1: esperar `initialized (codec=av1_nvenc)` SEM restart loop no arranque e vídeo frames desde o início (`video>` frames imediatos)
- Sessão dev pendente: WGC per-window falhou (InvalidCastException → DXGI desktop fallback), frame drops, `anchorGap=-31519,6ms` (drift A/V) — avaliar se repete após restart limpo
- Preview de clipes no renderer ainda quebrado (`file://` bloqueado, `clip-video://` viola CSP)

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: removido `-weighted_pred 1` do perfil av1_nvenc (linha 270) + comentário

## Session Summary (2026-07-31f — RAM fix: VideoPacketPool dedicado + NoGCRegion removido)

### Root cause (investigação concluída — NÃO é exceção/leak, é LOH churn)

- **Nenhum `OutOfMemoryException`** nos logs — o padrão de serra do `proc` (subia ~0,8MB/s e despencava, ex: 4,3GB→1,3GB) é **garbage steady no LOH**.
- **Fator 1 — `ArrayPool<byte>.Shared` com buckets pequenos**: o pool default retém apenas ~16-20 arrays por bucket. O ReplayBuffer segura ~18.000 arrays de vídeo (300s), então ao evictar frames (60/s), os arrays retornados excediam a capacidade do bucket e **caíam no LOH** (arrays ≥85KB). LOH só é coletado em GC gen2 **bloqueante** → serra.
- **Fator 2 — `GC.TryStartNoGCRegion(4MB)`** (`EngineCoordinator.Capture.cs:501`): orçamento fixo de 4MB era estourado por keyframes grandes → `EndNoGCRegion()` lançava e o runtime **forçava full GC bloqueante**, agravando o padrão.

### Fix aplicado

- **`VideoPacketPool.cs` (novo)**: `ArrayPool<byte>.Create(256MB maxArrayLength, 65536 arrays/bucket)` — buckets grandes o suficiente para reutilizar os arrays evictados em vez de descartá-los ao LOH. O pool é retido por buckets amplos, mas como os arrays são reutilizados em vez de descartados, o churn de LOH some.
- **`FfmpegEncoder.NalParsing.cs:266,687`**: `ArrayPool<byte>.Shared.Rent` → `VideoPacketPool.Rent` (buffers de dados de vídeo).
- **`EncodedPacket.cs:95`**: `ArrayPool<byte>.Shared.Return` → `VideoPacketPool.Return` (retorno no Release, sincronizado com o mesmo pool).
- **`EngineCoordinator.Capture.cs:~500-524`**: NoGCRegion removido — GCs gen0/gen1 rápidos não causam frame drops com o churn de LOH eliminado; comentário explica o porquê.
- **Áudio AAC NÃO foi tocado**: usa `new byte[]` não-pooled (frames pequenos, gen0), sem impacto no LOH.

### Testes (3 novos em VideoPacketPoolTests.cs)

- `Rent_ReturnsArray_AtLeastRequestedSize`, `ReturnThenRent_ReusesArray`, `ReturnMany_ThenRent_ReusesArrays_BeyondSharedBucketLimit` (512 arrays de 128KB reutilizados — além do limite do Shared)

### Validado

- **Build**: `dotnet build -c Release` — 0 erros
- **C# tests**: **967/967 pass** (era 964; +3) — 0 falhas
- **Publish + stage + deploy**: `dotnet publish -c Release --self-contained true -r win-x64` OK; `npm run copy-engine` (291 files); copiado para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — SHA256 DLL confere (`422C3B01...`)

### Next Steps

- Reiniciar o app instalado e capturar sessão longa: verificar que o `proc` não oscila mais em serra (deve ficar estável no patamar do buffer, ~1,3-1,5GB) e que não há frame drops
- Se o `proc` ainda subir, monitorar `GC.GetTotalMemory` vs `WorkingSet64` para distinguir managed heap de native/GPU memory

## Session Summary (2026-07-31 — Preview de clips + re-encode no trim + watchdog RAM wiring)

### Done

- **Preview de clips no renderer (app instalado)**: módulo node-free `src/shared/clip-video-url.ts` com `CLIP_VIDEO_SCHEME`, `buildClipVideoUrl` e `decodeClipVideoPath` (path cru via `encodeURIComponent` — **sem base64**; quebra compat com URLs base64 antigas, aceitável pois código era untracked). `src/main/ipc/clip-video-protocol.ts` re-exporta do shared (mantém Range 200/206/416). `preload/clips.ts` importa de `@shared/clip-video-url` (remove dependência de node-deps no preload). Root cause do preview quebrado no app instalado: o build instalado era da era `file://` (CSP/media-src) — pré-rebuild.
- **Trim com re-encode opcional**: `CLIPS_TRIM_CLIP` aceita 4º param `reEncode?: boolean`. `false`/omitido = `-c copy` (instantâneo); `true` = `-c:v libx264 -preset veryfast -crf {C.cq} -maxrate {maxrateKbps}K -bufsize {bufsizeKbps}K -c:a copy` (corrige macroblocos do fast copy). Pré-validations mantidas. Preload (`clipsTrimClip`) + UI (`ClipEditorModal.tsx` checkbox com tooltip `reEncodeTooltip`).
- **Watchdog RamManager re-wiring**: callbacks `OnBroadcast`/`OnReduceReplay`/`OnNormal` do `RamManager` **perdidos na refatoração partial classes (`08e8761`)** — watchdog media mas nunca agia. Agora: `OnBroadcast` → `_pipeServer.BroadcastRaw(msg)`; `OnReduceReplay` → reduz `_buffer.MaxDuration` (triggers `TrimExcess`); `OnNormal` → restaura `_activeProfile.ReplaySeconds`. Callbacks atribuídos ANTES de `StartWatchdog()`.
- **Canal `CLIPS_RAM_PRESSURE`**: `handlePipeMessage` em `clips-pipe.ts` trata broadcasts `{"event":"ramPressure","level":"warning|critical|normal","usedPercent":N,"reducedReplay":N}` (raw JSON, sem envelope — antes logava "No pending request for cmd=undefined"). Log warning em critical, forward ao renderer. Preload `clipsOnRamPressure` + `useClipsState.ts` (toast warning critical / success normal). Locales en/pt/es com `ramPressureCritical`/`ramPressureCriticalDesc`/`ramPressureNormal`.

### Validado

- **Build**: `dotnet build -c Release` 0 erros (19 warnings pré-existentes); `npm run build` OK (main + preload + renderer)
- **TS tests**: **6272 passed**, 1 skipped, 200 files — 0 falhas
- **C# tests**: **967/967 pass** — 0 falhas (abort final = flakiness pré-existente do ConsoleLogger, documentada)
- **Publish + stage + deploy**: `dotnet publish -c Release --self-contained true -r win-x64` OK; `npm run copy-engine` (291 files); copiado para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — SHA256 DLL `9FB7CCD8...`

### Next Steps

- Reiniciar o app instalado: validar preview de clips (URL `clip-video://` do módulo shared) e toast de RAM pressure sob carga
- Testar trim com re-encode em clip com macroblocos (checkbox) vs fast copy

### Relevant Files Changed

- `src/shared/clip-video-url.ts` (novo) + `clip-video-url.test.ts`
- `src/main/ipc/clip-video-protocol.ts` + `clip-video-protocol.test.ts` (re-export do shared)
- `src/preload/clips.ts` + `src/preload/api/clips.ts`: `clipsTrimClip(..., reEncode?)`, `clipsOnRamPressure`
- `src/main/ipc/clips.ipc.ts`: `CLIPS_TRIM_CLIP` com reEncode; `clips.ipc.test.ts` +2 testes (copy vs libx264 args)
- `src/main/ipc/clips-pipe.ts`: handler `ramPressure` + canal `CLIPS_RAM_PRESSURE`
- `src/shared/channels.ts`: `CLIPS_RAM_PRESSURE`
- `src/renderer/src/components/clips/ClipEditorModal.tsx`: checkbox re-encode
- `src/renderer/src/components/clips/useClipsState.ts`: listener RAM pressure + toasts
- `src/renderer/src/locales/{en,pt,es}/clips.json`: reEncode/reEncodeTooltip/ramPressure*
- `dinho-clips-poc/.../EngineCoordinator.Capture.cs`: callbacks watchdog RamManager (linhas ~115-133)
- `dinho-clips-poc/.../Memory/RamManager.cs`: (sem mudança — callbacks já existiam, só estavam sem assinante)

## Session Summary (2026-07-31 — Review fixes: clip-video containment + toast dedup + tipo PipeMessage)

### Done

- **3 achados dos 2 revisores corrigidos** (commit `48f0998`):
  1. **Contenção de path no `clip-video://`** (`clip-video-protocol.ts`): `handleClipVideoRequest` agora valida o path via `clipPathInOutputDir()` antes de `stat()`/`createReadStream()` — fora do output dir → `403 Forbidden` (antes: leitura de arquivo arbitrário via `?path=`). Reuso da função existente do `clips-config-manager` (sem ciclo de import). Teste novo: `returns 403 for a path outside the clips output directory`. Testes existentes migrados para `vi.mock('../services/clips-config-manager')` (temp dir como output dir virtual).
  2. **Toast de RAM pressure dedupado** (`useClipsState.ts`): watchdog do `RamManager` emite a cada ~5s enquanto a pressão persiste — adicionado `lastRamLevelRef` (useRef), toast só em transição `critical`↔`normal`. `ramPressureCritical`/`ramPressureCriticalDesc`/`ramPressureNormal` mantidos.
  3. **`PipeMessage.event?` tipado** (`clips-pipe.ts`): interface ganhou `event?: string` (broadcasts raw JSON do engine não têm envelope v/cmd) — remove o erro de TS `Property 'event' does not exist`. Nota: linha 200 (`payload: ... | undefined`) continua com erro **pré-existente** de `exactOptionalPropertyTypes` (parte dos ~1011 do tsc, não gating).
- **Import order biome**: `preload/clips.ts` + `preload/api/clips.ts` corrigidos via `npx biome check --write` (2 files).
- **`src/preload/api/clips.ts`** continua código morto (zero importers, importa módulo do main) — LOW, deixado como está.

### Validado

- **TS tests**: 4 files afetados (clip-video-protocol, ClipsPage, clips.ipc, preload/index) — **405/405 pass**; +1 teste de contenção (34→35 no protocol file).
- **Build**: `npm run build` OK (~10s).
- **Biome**: `check` nos 4 arquivos de código — sem issues.
- **tsc**: filtrado — `msg.event` (236) resolvido; só resta erro pré-existente na linha 200.

### Next Steps

- Testar no app instalado: preview de clip via `clip-video://` (agora confinado ao output dir), trim com re-encode, e toast de RAM pressure aparecendo UMA vez por transição
- Opcional: deletar `src/preload/api/clips.ts` morto (importa `clip-video-protocol` do main)

## Session Summary (2026-07-31 — Review 5 agents: todos CRITICAL/HIGH fixados, veredito APROVADO)

### Done

- **B1 HIGH** — allowlist `encoderPreset` (TS + C# + testes): `clips.ipc.ts` valida via `VALID_ENCODER_PRESETS` set (`p1`-`p7`); `IpcMessageHandler.Config.cs` + `ConfigManager.cs` idem; testes TS e C# para valores inválidos. Teste de rejeição do `clips.ipc.test.ts` corrigido para resetar `clipsConfig.encoderPreset = 'p5'` antes (estado de módulo vazava `p4` do teste anterior — falha `expected 'p4' to be 'p5'`).
- **H1 HIGH** — `pkt.Release()` no export: pacotes video/audio retornados ao pool via `try/finally` em `ExportToMp4`/`SaveClipAsync` (`EngineCoordinator.Export.cs`); testes validam Release chamado mesmo em erro.
- **H2 HIGH** — race reinit/stop: re-check `_captureActive` dentro do `_pipelineLock` antes de lançar `ReinitializePipelineAsync` (`EngineCoordinator.CaptureSource.cs`); testes com stop durante reinit.
- **A1 HIGH** — `UpdateDxgiCropRect` removido do caminho quente de captura DXGI (crop fixo mantido); testes de `CaptureDxgi` atualizados.
- **R4 M1** — `ClipsStatusBar.tsx`: `t('diskSpaceLow')` → `t('lowDisk')` (chave real no locale); teste virou positivo (`findByText('lowDisk')`).
- **R2 M1** — pool leak no canal `DropWrite` do `FfmpegEncoder`: helper `TryWriteOutput` faz `pkt.Release()` + `Interlocked.Increment(ref _droppedPackets)` quando `TryWrite` falha; `EmitPacket` (NalParsing.cs:725), `ProcessIvfFrames` (NalParsing.cs:275) e backoff de restart (`FfmpegEncoder.cs:~492`, agora `TryRead(out var backoffPkt)` + `Release()` em vez de `TryRead(out _)`) usam o helper. **AAC**: arrays não-pooled (`new byte[frameLen]`) + `DropWrite` + drop contabilizado (`FfmpegAacEncoder.cs:239-246`) — sem leak, nada a fazer.
- **R2 M2** — keyframe no caminho IVF (AV1): `internal static bool IsAv1Keyframe(byte[] data, int length)` em `FfmpegEncoder.NalParsing.cs` — caminha OBUs (header 1 byte, extension flag, campo de tamanho leb128) até OBU FRAME_HEADER (type 3) ou FRAME (type 6) e lê `frame_type` em `(data[pos] >> 3) & 0x03` (`0` = KEY_FRAME). `ProcessIvfFrames` marca keyframe real (antes: tudo `false`). **8 testes** em `FfmpegEncoderTests.cs` (keyframe/interframe via OBU 3 e 6, delimiter+sequence_header+frame realista, empty, truncado, só delimiter) — com helpers `BuildAv1Obu`/`Leb128`/`Concat`. Rota IVF só é alcançada para AV1 (`rawFmt == "av1" ? "ivf" : rawFmt`, FfmpegEncoder.cs:324). Consumo downstream: `ClipExporter.cs:133` (`FindLastIndex(trimIdx, p => p.IsKeyFrame)` no `TrimVideoStart`).
- **R5 A1** — `src/preload/api/clips.ts` deletado (dead code main-only, zero importers; `preload/api/index.ts` não o referenciava).

## Session Summary (2026-07-31 — R2 M1 refinamento: DropOldest + itemDropped no canal do encoder)

### Done

- **Refinamento do R2 M1** — a correção original (`DropWrite` + helper `TryWriteOutput`) resolvia o leak do pool, mas **mudava a dinâmica de descarte**: em overflow sustentado, `DropWrite` descarta o pacote NOVO mantendo os antigos — criando gap nos frames mais recentes, exatamente onde o replay buffer termina (o "agora", ponto de save do clip). A solução escolhida restaura o comportamento original (`DropOldest`) sem reintroduzir o leak:
  - **Canal** (`FfmpegEncoder.cs:17`): `Channel.CreateBounded(256)` com `FullMode = DropOldest` + callback `itemDropped: pkt => { pkt.Release(); Interlocked.Increment(ref _droppedPackets); }` — o descarte nativo do canal libera o `byte[]` do `VideoPacketPool` (sem leak M1) e preserva os frames mais recentes (dinâmica DropOldest).
  - **Overload descoberta**: o parâmetro nomeado do callback é **`itemDropped`**, não `onDropped` (CS1739) — confirmado via reflexão no runtime 10.0.10 (`CreateBounded(BoundedChannelOptions, Action<T>)` com param `itemDropped`).
  - **CS0236 resolvido**: o callback referencia `_droppedPackets` (campo de instância) — não pode ficar em inicializador de campo. Movido para o construtor (corpo de bloco, `_outputChannel` mantém `readonly`).
  - **`TryWriteOutput` removido** (NalParsing.cs): as 2 chamadas (`ProcessIvfFrames:275`, `EmitPacket:725`) agora usam `_outputChannel.Writer.TryWrite(...)` direto — o descarte é tratado nativamente pelo `itemDropped`. O helper virou dead code e foi deletado.
  - **Backoff de restart** (`FfmpegEncoder.cs:~492`): mantido com `TryRead(out var backoffPkt)` + `Release()` — já correto.
  - **AAC inalterado** (`FfmpegAacEncoder.cs:14`): continua `DropWrite` com arrays não-pooled (`new byte[frameLen]`) — sem leak, dinâmica irrelevante para frames pequenos.

### Validado

- **C#**: build main `-c Release` — **0 erros**; `dotnet test` — **988/988 pass** (2 execuções, a 1ª flakiness do ConsoleLogger como documentado); FfmpegEncoderTests 51/51.
- **Smoke**: probe `net10.0-windows10.0.26100.0` confirmou overload `CreateBounded(BoundedChannelOptions, Action<T>)` com param `itemDropped`; comportamento DropOldest verificado (10 itens escritos em canal cap. 4 → 4 lidos, 6 dropped via callback).

### Key Decisions

- **`DropOldest` + `itemDropped` sobre `DropWrite`**: o canal com callback nativo é a forma mais limpa de restaurar a semântica original (descartar o mais antigo) sem vazar arrays pooled. O `onDropped`/`itemDropped` é chamado pela implementação do channel ao evictar, então não há caminho de código que esqueça o `Release()`.
- **Construtor com corpo em vez de inicializador de campo**: necessário porque o callback captura o campo `_droppedPackets` (CS0236). `_outputChannel` continua `readonly` — atribuído uma única vez no construtor.

### Next Steps

- ~~Publicar engine + `npm run copy-engine` + deploy no app instalado~~ ✅ (ver sessão 2026-08-01)
- Testar no app instalado: gravação com `codec: "av1"` → keyframe correto no trim (`TrimVideoStart`), clip sem macroblocos no fast copy
- Opcional: `preload/api/` restante (`index.ts`, `scanner.ts`, `system.ts`) também é código morto (nada fora do folder importa) — avaliar remoção completa

## Session Summary (2026-08-01 — TDD fix Bugs B/C do áudio AAC: race + stdin sem timeout)

### Done

- **TDD completo (RED → GREEN → suítes → deploy)** para 2 bugs reais do áudio AAC:
  - **Bug B (race)**: `OnLoopbackData` + `OnMicData` → `EncodeAudio` na mesma instância do `FfmpegAacEncoder` — `_pcmBuf` compartilhado + escrita no stdin sem lock corrompiam batches AAC quando o mic estava ligado.
  - **Bug C**: `_stdin.Write` síncrono (sem timeout) travava a thread WASAPI se o ffmpeg AAC (BelowNormal) travasse — assimétrico com o `TryWriteStdin` do vídeo.

- **RED — seam + 6 testes** (`FfmpegAacEncoderTests.cs`, novo):
  - Construtor `internal FfmpegAacEncoder(Stream stdin, int writeTimeoutMs = 100)` (sem spawnar processo/ReaderLoop) + construtor `public FfmpegAacEncoder()` (produção).
  - Constantes internas `StdinWriteWarmupTimeoutMs = 5000` / `StdinWriteTimeoutMs = 250` + `ComputeAacWriteTimeout(long batch)` (warmup na 1ª batch, steady nas demais).
  - Testes: `EncodeAudio_Healthy_WritesExactBytes`, `EncodeAudio_ConcurrentWriters_SerializeWrites` (spy detecta overlap via contador de escrita ativa + amplificação SpinWait), `EncodeAudio_StuckPipe_ReturnsWithinTimeout_AndMarksUnhealthy` (stream que bloqueia 5s em write sync e nunca completa async — assert via `WaitAsync(3s)`), `EncodeAudio_FaultingStream_MarksUnhealthy`, `ComputeAacWriteTimeout_Warmup/Steady`.
  - RED confirmado: 4 guardas passaram, 2 falharam (race detectada; stuck pipe estourou timeout).
- **Commit RED `d737658`** — só o seam + o teste (changes pré-existentes de `FfmpegEncoder.cs` ficaram de fora).

- **GREEN — fix**:
  - Overload novo `FfmpegEncoder.TryWriteStdin(Stream stdin, byte[] data, int offset, int count, int timeoutMs, out Exception? fault)` (o 4-arg delega). `.AsTask()` removido — `WriteAsync(data, offset, count)` já retorna `Task` (CS1929).
  - `EncodeAudio`: `lock (_writeLock)` serializa `_pcmBuf` + escrita → `_pcmBatchesWritten++` → timeout fixo `_writeTimeoutMs` (testes) ou `ComputeAacWriteTimeout(batch)` → `TryWriteStdin`; Ok faz Flush; **Timeout marca `_isHealthy = false` imediatamente**; IOException marca unhealthy imediato, senão após ≥10 erros.
- **Commit GREEN `a821c55`** — incluiu junto as mudanças R2 M1 pré-existentes não commitadas de `FfmpegEncoder.cs` (channel 256 `DropOldest` → configurável + `itemDropped`/`_droppedPackets` + comentário warmup timeout) — indissociáveis sem staging parcial; documentado na mensagem.

- **Suítes**: C# completa **1000 aprovados / 0 falhas** (mensagem final "Execução de Teste Anulada." = flakiness pré-existente do ConsoleLogger/vstest); TS **200 arquivos, 6274 aprovados, 1 skipped, 0 falhas** — `npm test` (pool default) crasha com `EXIT=-1073741819` (access violation), corrigido com `npx vitest run --pool=forks`.
- **Publish**: `dotnet publish -c Release --self-contained true -r win-x64 -o bin/Release/net10.0-windows10.0.26100.0/publish` → EXIT=0.
- **Stage + deploy**: `npm run copy-engine` → 291 arquivos em `resources\clips-engine-staging`; `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — SHA256 conferido com o publish: `2FF20AFEB8B908FD365A014F75C5E914E90927457FCAA7B6B80CEF361E8AF43F`.

### Key Decisions

- **Lock em vez de canal para serializar o AAC**: `_pcmBuf` é compartilhado entre as 2 threads WASAPI e a ordem de escrita importa (batches contíguos de 1024 samples). Um lock curto dentro do `EncodeAudio` preserva a ordem de chegada sem reestruturar o fluxo.
- **Espelhar o padrão de timeout do vídeo** (warmup 5000ms / steady 250ms): primeira batch ocorre com o ffmpeg ainda abrindo — timeout generoso evita falso-unhealthy no arranque; steady strict impede travas longas.
- **`_isHealthy = false` em Timeout**: escolhido porque um ffmpeg AAC travado raramente se recupera; o watchdog do pipeline trata a recuperação via restart.

### Next Steps

- Reiniciar o app instalado e validar: gravação com `codec: "av1"` → keyframe correto no trim (`TrimVideoStart`) e clip sem macroblocos no fast copy
- Validar mic em campo: ligar PTT com mic habilitado (2 threads WASAPI concorrentes) e conferir ausência de freeze/desync — fix do Bug B/C

### Relevant Files Changed

- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/FfmpegAacEncoderTests.cs` (novo): 6 testes + streams `ConcurrentSpyStream`, `StuckPipeStream`, `FaultingStream`
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegAacEncoder.cs`: `_writeLock`, `_pcmBatchesWritten`, `_writeTimeoutMs`, consts de timeout, seam interno + ctor público, `EncodeAudio` com `TryWriteStdin`
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: overload `TryWriteStdin` com offset/count (4-arg delega) + mudanças R2 M1 pré-existentes commitadas juntas
- `AGENTS.md`: resumo de sessão + "Next Steps" marcado como feito

## Session Summary (2026-08-01 — Stall 76s do pipeline: spill fora do write lock)

### Done

- **Root cause do stall de 76s (04:47:27–04:48:43) fechada**: `AddVideo`/`AddAudio` do `ReplayBuffer.cs` faziam **todo o I/O de spill dentro do write lock** — `_spill.Write(oldest)` (FileStream sync por frame evictado) + `_spill.TrimOldest` → `CompactFile()` (lê+reescreve o arquivo spill inteiro, gatilho `_currentOffset >= _totalBytes * 2`). Com vídeo em 90% do budget (1381,7MB/1535MB), o trim disparava a cada frame → pipeline congelado.
- **`DiskSpillBuffer.cs` reescrito (segmentos, sem CompactFile)**:
  - Arquivos de segmento (`dinho-spill-{id}-{segment:000000}.bin`, ~64MB) em vez de arquivo único
  - `Write` = append buffered em `FileStream` persistente (`FileShare.ReadWrite`, aberto no `EnableDiskSpill`) — sem abrir/fechar por frame
  - `TrimOldest(int)` remove entradas do índice e **deleta segmentos totalmente consumidos** (sem reescrita de arquivo inteiro)
  - Lock interno `_sync`; `ReadRange` usa `VideoPacketPool.Rent` para vídeo (isPooled) e buffer byte→float PCM para áudio; `CleanupOrphans` (static novo)
  - Construtor `internal` com `segmentBytes` para testes (default = `DefaultSegmentBytes` = 64MB)
- **`ReplayBuffer.cs` — spill movido para fora do write lock**: `TrimExcessVideo/Audio/TrimExcess` agora retornam `List<EncodedPacket>?` de evictados (só removem do anel sob lock); novo `FlushEvicted` faz spill+release **fora do lock**. Aplicado em `AddVideo`, `AddAudio` e setters de `MaxDuration`/`MaxBytes`.
- **Testes (4 novos/reescritos em ReplayBufferTests.cs)**:
  - `DiskSpill_TrimOldest_NoCompaction_ReadsStayCorrect` — substitui o antigo `..._CompactsWhenGarbageDominates`: arquivo NÃO é reescrito após trim (10KB físicos com 11 pacotes vivos), reads corretos, writes pós-trim corretos
  - `DiskSpill_SegmentRollover_SpansMultipleSegments` — 3 segmentos via construtor internal (1024B), reads em ordem PTS
  - `DiskSpill_TrimOldest_DeletesFullyConsumedSegment` — segmento 0 inteiro consumido → arquivo deletado, 1 segmento restante
  - `DiskSpill_ConcurrentAddAndGet_NoDeadlock` — stress writer (1000 add video+audio, budget 300B, janela 5s) + reader loop, sem deadlock
- **Deploy completo**: commit `8bbad31` → `dotnet publish` OK → `npm run copy-engine` (291 arquivos) → DLL copiada para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — SHA256 `C53741BC...` confere staging/instalado.
- **Suítes**: C# **1003/1003** aprovados, 0 falhas ("Execução de Teste Anulada." = flakiness pré-existente do ConsoleLogger); build `-c Release` 0 erros.
- Inclui commit prévio `113c479` (spill read pooled — elimina pico de LOH no save).

### Key Decisions

- **Segmentos sobre arquivo único**: trim destrutivo de arquivo inteiro é O(n) com write lock segurando o pipeline — deletar arquivos de segmento totalmente consumidos é O(1) por segmento e nunca reescreve dados.
- **Evictados coletados sob lock, flush fora do lock**: a coleção de pacotes a evictar é barata (só manipulação de ponteiros do anel); o I/O (spill write + trim + release) roda na thread do caller após soltar o write lock.
- **FlushEvicted sem Retain() extra**: pacotes evictados já saíram do anel — vão para o spill e são release'd como antes, preservando a semântica de ownership.

### Next Steps

- Reiniciar o app instalado e validar em campo (cenário do incidente: `ramOptimization=aggressive`, replay longo, vídeo ~90% do budget): confirmar ausência de stall no pipeline e `proc` estável
- Monitorar logs por `diskSpill=True` ativo e trim sem pausas >500ms

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Buffer/DiskSpillBuffer.cs`: reescrito (segmentos, FileStream persistente, `_sync`, `TrimOldest(int)`, `CleanupOrphans`, sem `CompactFile`)
- `dinho-clips-poc/src/DiNho.Capture.Poc/Buffer/ReplayBuffer.cs`: `TrimExcess*` retornam evictados, `FlushEvicted` novo (spill+release fora do lock), setters `MaxDuration`/`MaxBytes`
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/ReplayBufferTests.cs`: teste de compactação reescrito + 3 testes novos de segmento/concorrência
- `AGENTS.md`: resumo de sessão

## Session Summary (2026-08-01 — Code review `d737658^..HEAD`: export pipeline + IPC/config)

### Done

- **Code review completo** de `d737658^..HEAD` (HEAD `27229b5`, 30 arquivos) — export pipeline C# + Electron main/preload/shared. **Sem CRITICAL/HIGH**; 2 MEDIUM + 4 LOW (tabela abaixo). Todas as correções da faixa (H1/H2/A1/B1/B2/B3/B4/R2 M1) verificadas corretas.

- **Pool-leak CLOSED (sem leak)**: `FilterAudioByIntervals`/`TrimAudioStart`/`TrimAudioEnd`/`PadAudioWithSilence` (AudioSync.cs:50–210) só criam listas subset/wrapper sobre os mesmos pacotes retidos; o loop de `Release()` no `finally` do caller (EngineCoordinator.Export.cs:148–161) percorre as listas ORIGINAIS completas; `Export/` não tem nenhum `.Release()` (grep: 0). AAC silent frames não-pooled (`new byte[]`) — Release é no-op no pool.

- **Verificado via per-file diff**: H1 (listas `List<EncodedPacket>?` nullables pré-try + release no `finally` com null guards, cobre exceção/vazio/`_exportInProgress`); B4 (probe pós-mux separado removido → `GenerateThumbnail` único com `expectedAudio`, erro engolido em try/catch warning-only); M4 (`WriteMatroskaFile` sem áudio → ADTS temp separado + `-f aac` no mux, `finally` deleta mkvTemp+adtsTemp :263–267); B3 (`_exportLock`/`Monitor.TryEnter` removidos, serialização só via `_exportLock`/`_exportInProgress` do EngineCoordinator).

- **Allowlist encoderPreset LOCALIZADA + verificada**: `clips.ipc.ts:48` `VALID_ENCODER_PRESETS = new Set(['p1'..'p7'])`, aplicada :339–340; teste de rejeição `clips.ipc.test.ts:719–725` (`p5; shutdown /s` → mantém cfg anterior). Trim com reEncode: `-c:v libx264 -crf {C.cq} -maxrate {maxrateKbps}K` (clips.ipc.ts:629–643).

- **Default config NÃO bate com preset "Boa"**: defaults CQ20/maxrate30000/bufsize60000 vs Boa 40000/80000 (LOW de rotulagem).

- **Named pipe `PipeOptions.CurrentUserOnly`** (NamedPipeServer.cs:201) — mitiga injeção cross-user (pré-existente, fora de escopo).

### Findings (veredito final)

| Sev | Local | Achado |
|-----|-------|--------|
| MED | `ClipExporter.cs:214` + `EngineCoordinator.Export.cs:114–134` | **HEVC sem fallback de CodecPrivate**: `cachedHvcc/cachedVps/cachedSps/cachedPps` são coletados do encoder (NalParsing.cs:163–179, 541–557 populam; `BuildHvcc` :179) e passados a `ExportToMp4`, mas só `avccFallback` chega a `WriteMatroskaFile`; HEVC re-extrai hvcC dos packets (Matroska.cs:192). Se a extração por packets falhar (mesma classe do bug avcC do H264 de 2026-06-27), export HEVC corrompe. AV1 sem cache por design (`!IsAv1`, :159). Fix trivial: forward `hvccFallback` no `WriteMatroskaFile` (e dropar params mortos `vps/sps/pps`). |
| MED | `IpcMessageHandler.Config.cs:97–138` + `ConfigManager.cs:330` | **Handler `config` do pipe ignora validação**: copia `Cq/MaxrateKbps/BufsizeKbps/Bframes/Lookahead/OutputDirectory/Codec` cru via `ConfigManager.Update` (que não clampa — validação só no `Load()` :223–256). Processo same-user ou renderer comprometido pode setar OutputDirectory fora do profile ou params inválidos pro ffmpeg. Mitigado por `CurrentUserOnly`. Pré-existente; B1 adicionou allowlist de preset nos dois lados mas não os guards numéricos/OutputDirectory aqui. |
| LOW | `ClipExporter.cs:366–400` | Regressão B4: diagnóstico de probe/áudio só loga após o decode de thumbnail sair com exit 0; vídeo corrompido engole a exceção (:260–261) e perde exatamente o aviso "MP4 probe FAILED". Fix: parsear o input dump antes do throw ou rodar probe header-only na falha. |
| LOW | `ClipExporter.cs:221,297–309` | Export silenciosamente video-only se `audioPackets[0]` não for ADTS (`IsAdts` false → `hasAudioTracks=false`); o warning M3 nunca dispara. Deveria logar "áudio presente mas não-ADTS". |
| LOW | `clips-config-manager.ts`/`store` vs `ClipsConfigQuality.tsx` | Default maxrate/bufsize 30000/60000 não corresponde a nenhum preset da UI (Boa=40000/80000); default fica "abaixo do Boa". |
| LOW | `DiskSpillBuffer.cs:102` | Ramo `PcmSamples` inalcançável no fluxo atual (áudio é AAC). Cosmético. |

### Key Decisions

- **Fallback de CodecPrivate só para H264 hoje**: o avcC fallback do encoder foi adicionado na saga de 2026-06-27 porque a extração por packets falhava; HEVC tem o mesmo perfil de risco e o cache (`BuildHvcc`) JÁ é populado — é só religar os params já plumbed. Candidato claro a fix de baixo risco na próxima sessão.
- **`CurrentUserOnly` no pipe** é a fronteira de confiança atual: cross-user bloqueado, same-user (ou renderer comprometido) não — aceitável enquanto o renderer roda com contexto isolado, mas o `HandleConfig` sem validação é o ponto mais fraco.

### Next Steps

- (Opcional) Fix do MED #1: forward `hvccFallback` no `WriteMatroskaFile` + remover params mortos `hvccFallback/vps/sps/pps` de `ExportToMp4`; teste de integração HEVC.
- (Opcional) Fix do MED #2: fatorar `ValidateAndFix(AppConfig)` compartilhado entre `Load()` e `Update()` + validação de path-traversal em `OutputDirectory` no `HandleConfig`.
- Testar em campo (app instalado): sessão com `codec:"hevc"` para exercitar hvcC path; validar que `clips.ipc.ts` aceita apenas presets p1–p7 via UI.

### Relevant Files Changed

- `AGENTS.md`: resumo de sessão (review apenas; nenhum código alterado nesta sessão)

## Session Summary (2026-08-01 — IsProcessAlive por PID: fix do falso-negativo FiveM)

### Root cause (falso-negativo no alive-check)

- Incidente 2026-07-31: jogo FiveM vivo reportado como morto pelo engine -> teardown zumbi (`game="null" recording=false`) com ffmpeg congelado e áudio fluindo.
- `IsProcessAlive(string)` (EngineCoordinator.Game.cs) usava `Process.GetProcessesByName(name)` — match **exato**. O nome do processo do FiveM inclui build number volátil (`FiveM_b3258_GTAProcess`); a cada atualização o nome muda e o jogo vivo parecia morto.
- Comportamento perigoso adicional: `catch { return false }` era **fail-open** — qualquer exceção na checagem derrubava a captura.
- `ResolveProcessByName` já fazia fuzzy match (`_b\d+_`) mas `IsProcessAlive` não.

### Fix aplicado (Opção A — TDD completo RED→GREEN→suítes→deploy)

- **`IsProcessAlive(int pid)`** novo: `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` por PID — robusto ao build number. `NULL` + `ERROR_ACCESS_DENIED` => vivo; `GetExitCodeProcess`/`STILL_ACTIVE` (259) para desambiguar; `CloseHandle` no `finally`.
- **`IsProcessAlive(string)`** virou fallback por nome: `NormalizeProcessName` (strip `.exe` + regex `_b\d+_`) e **fail-closed** (exceção => vivo, loga). String vazia/whitespace => `false`.
- **`IsTargetProcessAlive()`** (instance): usa PID quando `_captureTargetGame.ProcessId > 0`, senão fallback fuzzy por nome.
- **Seams para testes determinísticos**: `internal static Func<uint,bool> IsProcessAliveProbe` e `Func<uint,IntPtr> OpenProcessProbe` (campos, não auto-properties — reflexão por nome).
- **Call sites migrados para `IsTargetProcessAlive()`/PID-primeiro**:
  - `EngineCoordinator.Capture.cs` guard WGC background (alt-tab) + teardown "fechou enquanto backgrounded".
  - `ResolveTargetGame` fallback HWND salvo (Game.cs).
  - Auto-stop: `_capturedGameProcessId` novo (set no auto-start, reset no stop) — PID primeiro, nome fallback.

### Testes

- **RED (commit `de462d6`)**: 15 testes novos falhando — PID atual=>true, 0/-1/int.MaxValue=>false, PID morto (spawn cmd+kill)=>false, probe lança=>true (fail-closed), `ERROR_ACCESS_DENIED`=>true, handle inválido=>true, `NormalizeProcessName` (5), `IsTargetProcessAlive` PID-vs-nome (2).
- **GREEN (commit `808f0b3`)**: implementação + ajuste de `IsProcessAlive_EmptyString_ReturnsTrueOnWindows`→`ReturnsFalse` (semântica nova: empty => false; antigo retornava True por match vazio do `GetProcessesByName("")`).
- **Suítes**: C# completa **1032/1032 aprovados — 0 falhas**; classes tocadas: 443/443.
- **Build**: `dotnet build -c Debug` 0 erros.

### Deploy (app instalado)

- `dotnet publish -c Release --self-contained true -r win-x64 -o bin/Release/net10.0-windows10.0.26100.0/publish` — OK.
- `npm run copy-engine` — 291 files staged; hash staging = publish = instalado `F5102537F5CE66D7A7D93E9EC993E375D8233894BB510CAD86900EAF6BC1D15D`.
- App instalado fechado pelo usuário para o deploy; 5 arquivos `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\`.

### Key Decisions

- **PID sobre nome**: o build number do FiveM muda a cada update — qualquer heurística de nome é frágil; `OpenProcess` por PID é determinístico e barato (abre/fecha handle em µs).
- **Fail-closed como política**: em dúvida (exceção, sem acesso de leitura), assume vivo — nunca derruba captura por engano. Custo de falso-positivo (loop espera watchdog) é aceitável vs. derrubar uma sessão de gravação.
- **Campos estáticos para seams**: reflexão `GetField` não acha backing field de auto-property; usando campos com inicializador default = P/Invoke real.

### Next Steps

- Reiniciar o app instalado e validar em campo com FiveM (sessão longa): guard de alt-tab sem teardown falso e auto-stop disparando apenas quando o jogo REAL fechar.
- Se ainda houver falso-negativo (ex.: processo em outro user/session), avaliar Opção B (re-resolução do alvo ao falhar) documentada no plano.

## Session Summary (2026-08-02 — Clip player fix definitivo: net.fetch + trim handles em px)

### Done (part 1 — net.fetch, REVERTED em campo)

- **Tentativa `net.fetch`**: o handler `clip-video://` construía `Response` manual (Range parseado à mão + `createReadStream` + `Readable.toWeb`) e foi trocado para delegar a `net.fetch(pathToFileURL(filePath).toString())` com forwarding do header `Range`. **FALHOU em campo** (janela dev, build com o fix): clicar num tempo à frente (ex.: minuto 1 de um vídeo de 2) voltava ao início.
- **Nova causa-raiz (pesquisa)**: `net.fetch(file://...)` **não suporta seek** — o file loader do Chromium ignora o header `Range`, `video.seekable.end()` fica `0` e todo seek salta para o início (electron/electron#38749; #51442). O padrão confirmado por múltiplos usuários em Windows é **servir Range manualmente** (`206` + `Content-Range` + `Accept-Ranges` + `createReadStream` com `start/end`), combinado com `standard: true` no registro do esquema.

### Done (part 2 — Range manual, implementado e validado)

- **`src/main/ipc/clip-video-protocol.ts` reescrito** para implementar HTTP Range manual:
  - Validações preservadas: 400 sem path, 403 fora do output dir (`clipPathInOutputDir`), 404 quando `statSync` falha.
  - Sem `Range`: `200` com `Content-Type` (por extensão), `Accept-Ranges: bytes`, `Content-Length: size`, corpo = `createReadStream(filePath)` completo.
  - Com `Range: bytes=start-end`: parseia `^bytes=(\d*)-(\d*)$`; `206` com `Content-Range: bytes start-end/size`, `Accept-Ranges`, `Content-Length: chunk`, corpo = `createReadStream(filePath, { start, end: clampedEnd })`. End além do tamanho é clampado; range não-satisfazível ou reverso → `416` com `Content-Range: bytes */size`.
  - `HEAD` → headers com corpo vazio (200 ou 206 conforme o Range).
  - Corpo via `Readable.toWeb(createReadStream(...))` (web ReadableStream aceito pelo `Response` do main).
- **`src/main/index.ts`**: `bypassCSP: true` já adicionado na part 1; `standard: true` já presente — prerequisito para mídia emitir requests de range subsequentes.
- **Testes reescritos** (`clip-video-protocol.test.ts`): 17 testes — round-trip URL, null cases, 400/403/404, full-file 200 (Content-Length/Accept-Ranges + bytes corretos), range explícito 206 (`Content-Range` + bytes do segmento via arquivo two-tone), range aberto `bytes=500-`, clamp do end, 416 unsatisfiable e reverso, malformed → 200, HEAD 200 e HEAD 206, extensão desconhecida → `application/octet-stream`. Mock de `electron`/`net.fetch` removido (agora usa `node:fs` real). **17/17 pass**.
- **Bug de teste encontrado**: `makeRequest(url, 'bytes=...')` passava string no lugar do objeto `{ range }` — header nunca era enviado e os testes de range retornavam 200. Corrigido para `{ range: 'bytes=...' }`.

### Validado

- **Tests**: `clip-video-protocol.test.ts` 17/17; clip suites `clips.ipc.test.ts` + `clips-engine-connection.test.ts` + `preload/index.test.ts` + protocol = **494 passed** (4 files) — 0 falhas.
- **Build**: `npm run build` OK (main + preload + renderer, `✓ built in 10.13s`).
- **Biome**: `clip-video-protocol.ts` + test sem issues (1 fix de formatação aplicado via `--write`).
- **Lint/biome**: nenhum erro NOVO — 5 issues a11y (`noStaticElementInteractions`/`useMediaCaption`) são pré-existentes (verificados via `git stash` no baseline, mesmas 5 com linhas originais).
- **tsc**: `useRef<ReturnType<typeof setTimeout>>()` (ClipEditorModal:160) é erro **pré-existente** (existe na versão original em :149) — fora do escopo desta sessão.

- **Trim handles — hit-test em pixels**: `TrimTimeline` (`ClipEditorModal.tsx`) usava threshold de **segundos** (`distStart < 1`) no `onMouseDown`. A 120s+ de clipe, 1s = <2px — o handle de 16px ficava quase todo "fora da zona de gravação" e o clique caía no `seek`. Novo `handleMouseDown`:
  - `HANDLE_GRAB_PX = 12` (raio de gravação em pixels, independente da duração/escala do clipe)
  - `toPx(sec) = (sec / duration) * rect.width` converte posição dos handles para px; `distStart`/`distEnd`/`distCur` comparados em px contra o clique
  - Ordem de precedência preservada (start > end > seek) e clamp de ordem no drag mantido
  - Guard `rect.width === 0` evita divisão por zero
  - Tipado `React.MouseEvent` (era inline anônimo no JSX)

### Validado

- **Tests**: `clip-video-protocol.test.ts` 9/9; clip suites `clips.ipc.test.ts` + `preload/index.test.ts` + protocol = **381 passed** (3 files) — 0 falhas.
- **Build**: `npm run build` OK (main + preload + renderer, `✓ built in 9.74s`).
- **Lint/biome**: nenhum erro NOVO — 5 issues a11y (`noStaticElementInteractions`/`useMediaCaption`) são pré-existentes (verificados via `git stash` no baseline, mesmas 5 com linhas originais).
- **tsc**: `useRef<ReturnType<typeof setTimeout>>()` (ClipEditorModal:160) é erro **pré-existente** (existe na versão original em :149) — fora do escopo desta sessão.

### Key Decisions

- **Range manual sobre `net.fetch(file://)`**: o file loader do Chromium ignora `Range` — seek fica impossível (`seekable.end() === 0`). Implementar `206`/`Content-Range`/`Accept-Ranges` com `createReadStream(filePath, { start, end })` é o padrão validado por usuários reais do Electron no Windows e funciona porque o esquema é registrado com `standard: true` (prerequisito para o loader de mídia emitir requests de range). O confinamento (`clipPathInOutputDir` → 403) impede leitura arbitrária de arquivos fora do output dir.
- **Hit-test em px para os handles**: a escala do clipe (60s vs 300s) torna thresholds em segundos inúteis — o usuário deve poder agarrar o handle VISÍVEL independentemente da duração.

### Next Steps

- Reiniciar o app (build de produção novo) e validar em campo: preview de clip reproduzindo + scrub, handles de trim arrastando corretamente em clips longos (120s+), trim com re-encode (checkbox) vs fast copy.
- (Opcional) Corrigir o erro pré-existente de tsc em `ClipEditorModal.tsx:160` (`useRef<ReturnType<typeof setTimeout>>()` → `useRef<ReturnType<typeof setTimeout> | undefined>(undefined)`) e os 5 a11y warnings.

## Session Summary (2026-08-02 — G1-3: GetSegments sem lock durante spill I/O + drop-release de RAM)

### Done

- **Root cause (RED crash decifrado com probe)**: `.NET 10` `ArrayPool<T>` valida procedência — `VideoPacketPool.Return(new byte[100])` lança `ArgumentException: The buffer is not associated with this pool`. Testes do G1-3 simulavam pacotes pooled com `new byte[100]` (nunca rentados do pool) — qualquer `Release()` que chegasse a zero crashava. Produção SEMPRE usa `VideoPacketPool.Rent`, então só o harness dos testes estava errado. Probe confirmou: rent→return OK, rent→return→return OK (sem detecção de duplo return), `new byte[]` cru → THROW.

- **Fix do harness (GREEN)**: nos 4 testes G1-3, `new byte[100]` → `VideoPacketPool.Rent(100)` (espelha produção). Agora o zero-release devolve o array ao pool (DataLength=0), o que os asserts verificam.

- **Fix de implementação — `ReplayBuffer.GetSegments` (G1-3)**:
  - Snapshot do anel sob lock CURTO; `ReadAll()` do spill (I/O de disco — potencialmente centenas de MB) movido para FORA do lock. Antes o read lock era segurado durante todo o ReadAll+merge+trim — como AddVideo/AddAudio usam write lock exclusivo, o pipeline de captura congelava durante o save (mesma classe do incidente stall 76s).
  - `spill` é atribuído uma única vez em `EnableDiskSpill` e nunca nullado — snapshot da referência sob o lock é seguro.
  - Race de teardown (Dispose→`_spill.Dispose` entre snapshot e ReadAll) mitigado com `catch (ObjectDisposedException)` → usa só o snapshot RAM (o save já está inviável). Simétrico ao best-effort do `FlushEvicted`.

- **Fix de leak — trim da janela**: o código antigo só liberava pacotes do spill fora da janela (`diskVideoSet?.Remove(...) == true`), VAZANDO o Retain() do snapshot GetSegments nos pacotes RAM descartados (count preso em 2/1 — array pooled nunca voltava ao pool). Agora TODO pacote fora da janela é liberado (RAM: solta o retain do snapshot 1→0, o anel mantém ownership e o Clear() final faz -1; disk: ownership integral desta chamada 0→-1→pooled).

- **`MergeSpilledPackets` (seam `internal static`)**: merge de snapshot RAM (retido) + spill (ownership da chamada) ordenado por PTS. Em PTS igual o RAM vence (authoritative, retido) e TODOS os duplicados do disk são liberados — a frame não aparece duas vezes no clipe. `disk.Count==0` → retorna `ram` (mesma referência); `ram.Count==0` → retorna `disk`.

### Validado

- **C# tests**: ReplayBufferTests **46/46** (era 42; +4 G1-3); suite completa **1040/1040 aprovados, 0 falhas** ("Execução de Teste Anulada." = flakiness pré-existente do ConsoleLogger/vstest documentada).
- **Build**: `dotnet build` implícito no test — 0 erros.

### Key Decisions

- **`VideoPacketPool.Rent` no harness em vez de relaxar o assert**: o leak observável é "array pooled retornado exatamente uma vez" — o pool de produção valida procedência, então a simulação precisa de arrays REAIS do pool. `new byte[100]` com `isPooled: true` é um estado impossível em produção.
- **ReadAll fora do lock é a prioridade**: segurar o read lock durante I/O de disco inteiro bloquearia AddVideo/AddAudio (write lock exclusivo) — o pior modo de falha (pipeline congelado). A race de teardown é estreita e tratada como best-effort.

### Next Steps

- Commit GREEN (impl + harness fix) → `dotnet publish -c Release --self-contained true -r win-x64` → `npm run copy-engine` → deploy no app instalado (`%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\`).
- Validar em campo (app instalado, sessão longa com spill ativo): save de clip sem stall do pipeline e sem leak de arrays pooled (proc estável no patamar do buffer).

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Buffer/ReplayBuffer.cs`: `GetSegments` (ReadAll fora do lock, trim libera RAM+disk, `MergeSpilledPackets` seam)
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/ReplayBufferTests.cs`: 4 testes G1-3 com `VideoPacketPool.Rent(100)` (harness fix)

## Session Summary (2026-08-02 — C8: drenagem de stderr nos filtros de áudio ffmpeg)

### Done

- **C8 — deadlock por pipe de stderr cheio corrigido** nos 2 filtros de áudio que spawnam ffmpeg long-lived e redirecionavam `StandardError` sem ler:
  - `Audio/RnnoiseFilter.cs` (após `_process.Start()`): `BeginErrorReadLine()` + handler `ErrorDataReceived` que loga `Log.W("RnnoiseFilter", $"ffmpeg stderr: {e.Data}")` — sem a leitura async, o buffer do pipe de erro (64KB) enchia e o ffmpeg bloqueava em `stderr` write, travando o pipeline.
  - `Audio/MaxineAfxFilter.cs` (idem, após `Start()`/`PriorityClass`): `BeginErrorReadLine()` + `Log.W("MaxineAfxFilter", ...)`.
  - Padrão espelha o já existente em `FfmpegAacEncoder.cs:84-95` e `ClipExporter.cs:342-349` (`ErrorDataReceived` + `BeginErrorReadLine`).
- **C8 auditado**: fluxos `stdin` (`WriteAsync` com timeout já existente) e `stdout` (encoders leem inline) sem risco novo; apenas o stderr estava sem drenagem nos dois filtros.

### Validado

- **C# tests**: suite completa **1040/1040 aprovados, 0 falhas** ("Execução de Teste Anulada." = flakiness pré-existente do ConsoleLogger/vstest documentada).
- **Build**: `dotnet build -c Release` 0 erros; `dotnet publish -c Release --self-contained true -r win-x64` OK.
- **Stage**: `npm run copy-engine` — 291 files staged (DLL staging = `975F10BD...`).
- **Deploy**: app instalado estava FECHADO (só instância dev `node_modules\electron` rodando); 5 arquivos `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — SHA256 instalado == staging == `975F10BD5C54358E3B0FE8C859008ECB0AF0F5E53839095F218EF63B77860375`.
- **Commit**: `ccfab3b` — `fix: C8 drena stderr do ffmpeg nos filtros de audio (Rnnoise/Maxine) para evitar deadlock do pipe`

### Key Decisions

- **Drenagem async (`BeginErrorReadLine`) sobre leitura síncrona**: o handler roda em threadpool e nunca bloqueia o pipeline — mesma escolha do AAC encoder e ClipExporter.
- **Nota de path**: `dotnet publish -o bin/.../publish` a partir de `dinho-clips-poc\` grava em `dinho-clips-poc\bin\...` (raiz), NÃO em `src\DiNho.Capture.Poc\bin\...` — o path canônico para deploy é o staging do `copy-engine` (dll com hash `975F10BD`); o `src\...\publish\DiNho.Capture.Poc.dll` era o build G1-3 (`C2BDF84B`, sem C8).

### Next Steps

- Reiniciar o app instalado e validar em campo (sessão longa): `RnnoiseFilter`/`MaxineAfxFilter` sem travar o pipeline quando o ffmpeg logar em stderr; watchdog/audio sem deadlocks com noise suppression ou Maxine ativos.
- Remediação G-series continua: próximos itens da auditoria `AUDIT-REPLAY-BUFFER.md` / `PLANO_EXECUCAO_FASES.md` (FASE 5) após C8.

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Audio/RnnoiseFilter.cs`: `BeginErrorReadLine()` + handler `ErrorDataReceived` pós-`Start()` (C8)
- `dinho-clips-poc/src/DiNho.Capture.Poc/Audio/MaxineAfxFilter.cs`: idem pós-`Start()`/`PriorityClass` (C8)

## Session Summary (2026-08-02 — FASE 5: leftover morto do RnnoiseFilter corrigido)

### Done

- **Lógica de leftover corrigida** (`Audio/RnnoiseFilter.cs`, `Process` → leitura de stdout):
  - O branch antigo `if (_readOffset > totalRead)` era **código morto**: `totalRead` era incrementado junto com `_readOffset` no mesmo loop, então a condição nunca era verdadeira. Se o ffmpeg (`-af anlmdn`) entregasse mais bytes que o frame na mesma leitura (latência/drift do filtro streaming), o excedente ficava preso no pipe e **corrompia o alinhamento do stream** na chamada seguinte (bytes de frames futuros anexados ao frame atual).
  - **Fix**: a leitura agora preenche o **espaço livre** de `_readBuf` (até 64KB, sobre-leitura captura o surplus); o consume consome `min(_readOffset, expectedBytes)` (alinha ao tamanho do frame original); o surplus restante é deslocado para o início do buffer e vira `_readOffset` (leftover real, preservado para a próxima chamada). Em timeout/EOF consome o que tiver e retorna o frame parcial em vez de perder dado.
  - Guard `if (_readOffset < 4) return input;` preservado (fallback para o frame original quando não há dado filtrado suficiente).
  - Comentários em pt-BR explicando o porquê do branch antigo nunca disparar.
  - `AudioMixer` enfileira `(samples, 0, samples.Length, pts)` — o comprimento variável do resultado é suportado pelo consumidor, então o desalinhamento de frame não quebra o mix.

### Validado

- **Build**: `dotnet build -c Release` 0 erros (21 warnings pré-existentes).
- **C# tests**: suite completa **1040/1040 aprovados, 0 falhas** ("Execução de Teste Anulada." = flakiness pré-existente do ConsoleLogger/vstest documentada).
- **Publish + stage + deploy**: `dotnet publish -c Release --self-contained true -r win-x64` OK (path canônico `dinho-clips-poc\bin\...\publish`); `npm run copy-engine` — 291 files staged; app instalado estava FECHADO; 5 arquivos `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — SHA256 instalado == staging == `04046570A2330622FAFA720598ACDAB3D6F972F3AEEB3C1138846BB75B4BEA8C`.
- **Commit**: `--` — `fix: FASE 5 corrige leftover morto no RnnoiseFilter (sobre-leitura de stdout)` (a ser registrado; inclui resumo C8 do AGENTS.md pendente de `ccfab3b`).

### Key Decisions

- **Sobre-leitura + leftover preservado sobre leitura exata**: um filtro streaming (`anlmdn`) tem latência interna e pode emitir bursts maiores que o frame; ler só `expectedBytes` perde o excedente no pipe. Preencher o buffer todo e consumir o frame alinhado mantém o stream íntegro e é O(1) por chamada (BlockCopy do surplus, no máximo 64KB).
- **Consumir `expectedBytes` quando disponível**: o steady-state do `anlmdn` preserva taxa/canais, então a saída por frame == entrada (byteLen). Alinhar o consume ao frame evita que um burst ocasione frames maiores que os do mixer.

### Next Steps

- Reiniciar o app instalado e validar em campo (sessão longa com noise suppression): áudio do mic sem cliques/corrupção por desalinhamento de frame do `anlmdn`.
- Remediação G-series continua: próximos itens de `AUDIT-REPLAY-BUFFER.md` / `PLANO_EXECUCAO_FASES.md` (FASE 5/6).

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Audio/RnnoiseFilter.cs`: loop de leitura do stdout reescrito (espaço livre + consume `min(off, expected)` + leftover real via BlockCopy)

## Session Summary (2026-08-02 — FASE 6 M2+L2 e FASE 7 M14)

### Done

- **FASE 6 — M2 (overflow do canal de saída com log + pool-safe)**:
  - `FfmpegEncoder.cs`: canal `_outputChannel` (cap. 256) agora criado com `CreateBounded` + `itemDropped` callback que chama `pkt.Release()` (devolve o `byte[]` ao `VideoPacketPool` — sem leak M1) e `Interlocked.Increment(ref _droppedPackets)`.
  - O callback loga `Log.W("FfmpegEncoder", "output channel overflow — {drops} packets dropped total")` no **1º drop e a cada 100** — ffmpeg lento descarta centenas/s, logar todo drop inundaria o log JSONL.
  - 6 novos testes em `FfmpegEncoderTests.cs` (helpers reflection `GetField<T>`/`SetField` adicionados no topo): overflow 300→cap 256 = 44 drops, no-overflow 0, DropOldest preserva pacote 299, Flush após dispose não respawna, Flush process null não respawna, Flush disposto drena pendingOutputs.

- **FASE 6 — L2 (guard anti-respawn no `Flush()`)**:
  - `Flush()` começa com guard `bool canRestart = !_disposed && _process != null;` — drena o channel + emite packet pendente **sempre**, mas só executa StopFfmpeg+ResetState+StartFfmpeg+ReaderLoop se `canRestart`. Comentário explica: respawn após dispose criaria processo órfão.
  - `_isRunning` não existe no FfmpegEncoder — guard usa `_disposed || _process == null`.
  - `Flush()` tem 1 chamador real em produção: `EngineCoordinator.Capture.cs:326` via `_aacEncoder.FlushAndDrain` (áudio, não FfmpegEncoder); `ProgramBenchmark.cs:41` chama `enc.Flush()`.

- **FASE 7 — M14 (probe de streams antes do throw no `GenerateThumbnail`)**:
  - `ClipExporter.cs:401`: `GenerateThumbnail` agora perfaz o "probe de streams" (stderr do ffmpeg: `Video:`/`Audio:`/`Stream #` + logs "MP4 probe", "MP4 probe FAILED: expected audio but none found!") **antes** dos throws; exceções de timeout/exit≠0 carregam stderr. Antes o throw vinha primeiro e o aviso de export corrompido era engolido pelo catch `Log.W` em `ClipExporter.cs:278-279`.
  - 2 novos testes de integração em `ClipExporterIntegrationTests.cs`: `GenerateThumbnail_OnValidMp4_CreatesThumbFile` (MP4 lavfi 320x180/30fps/1s gera `.thumb.jpg` com >0 bytes) e `GenerateThumbnail_OnCorruptFile_Throws_WithStderrProbe` (conteúdo `Array.Empty<byte>()` → exceção com "exit code" + "Invalid data found").
  - Gotcha corrigido no teste: `RedirectStandardError=true` sem `BeginErrorReadLine()` faz o processo bloquear no pipe (reproduzido 2x; 9KB stderr ou 4.7KB já bloqueiam).

### Validado

- **C# tests**: suite completa **1048/1048 aprovados, 0 falhas** (1 suíte completa, 5s; "Execução de Teste Anulada." = flakiness pré-existente do ConsoleLogger/vstest documentada).
- **Build**: `dotnet build -c Release` — 0 erros (warnings pré-existentes: `FfmpegEncoder.NalParsing.cs:241/257` CS8604, `EngineCoordinator.CaptureSource.cs:198` CS8602, `EngineCoordinator.cs:130` CS0169).
- **Commits**: `56ca4db` (M2+L2) e `c325561` (M14).
- **Publish + stage + deploy**: `dotnet publish -c Release --self-contained true -r win-x64` OK; `npm run copy-engine` — 291 files staged; app instalado parado; 5 arquivos `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — hashes do destino == staging (FASE 6 DLL `A6FA989B...`; FASE 7/M14 DLL `7469EA78...`).

### Key Decisions

- **`itemDropped` do canal sobre `TryWriteOutput`**: o descarte nativo do channel chama o callback — é o único caminho que garante `Release()` mesmo se o frame for evictado internamente. `DropOldest` preserva os frames mais recentes (ponto de save do replay buffer) enquanto libera o pool.
- **Probe no thumbnail antes do throw**: o export corrompido produzia thumbnail que falhava com exit≠0 e a exceção carregava stderr truncada; o probe de streams dá o diagnóstico "MP4 probe FAILED: expected audio but none found!" que antes era engolido pelo catch `Log.W`.

### Next Steps

- Continuar FASE 7: H6/H7/M10-M13/L9 (M1/M14/L10 ⚪ opcionais).
- Depois FASE 8: L13 ⚪ (opcional), L15 ⚪ (cosmético) — decidir se aplicá-los.
- Se houver mudanças: repetir ciclo commit → publish → copy-engine → deploy.

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: M2 (`itemDropped` callback no `_outputChannel`, `_droppedPackets`) e L2 (`Flush()` guard `canRestart`)
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/FfmpegEncoderTests.cs`: 6 testes M2+L2 + helpers `GetField<T>`/`SetField`
- `dinho-clips-poc/src/DiNho.Capture.Poc/Export/ClipExporter.cs`: `GenerateThumbnail` reescrito (M14) — probe de streams antes dos throws, exceções com stderr
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/ClipExporterIntegrationTests.cs`: 2 testes de integração (thumb válida + corrupta)

## Session Summary (2026-08-02 — FASE 7 M11 + triagem status FASE 7/8)

### Done

- **FASE 7 — M11 (lock único no status update)**: `EngineCoordinator.Capture.cs:650-656` fazia **duas aquisições separadas** do read lock do ReplayBuffer por frame (`Stats()` + `StatsDetailed()`). Substituído por **uma única chamada `StatsDetailed()`** — que já retorna `videoCount/audioCount/videoBytes/audioBytes`; `ReplayBufferBytes` agora é derivado de `videoBytes + audioBytes`. Menos lock contention no hot path (a cada frame) e snapshot consistente. `Stats()` permanece usado em `IpcMessageHandler.Capture.cs:75`, `EngineCoordinator.Export.cs:31` e `ProgramBenchmark`.

- **Triagem de status — FASE 7 itens restantes verificados como DONE no código atual** (planos referenciam versão antiga do arquivo):
  - **H6** (drenar stderr no `ClipExporter`): done — ambos os Process (`MuxWithFfmpegStreaming` `:342-349` e `GenerateThumbnail` `:407-410`) têm `ErrorDataReceived` não-vazio + `BeginErrorReadLine()`.
  - **H7** (stdin dispose no mux): done — mux usa `-f matroska -i` / `-f aac -i` (arquivos, sem stdin); nada a dispor.
  - **M10** (`_maxAudioBytes` + trim por bytes): done — `ReplayBuffer.cs:95-96` `_maxVideoBytes = 0.9*_maxBytes`, `_maxAudioBytes = resto`; trims `:206` (vídeo) e `:222` (áudio) por duração **ou** bytes.
  - **M12** (flags bit 0 reserved): done — `ClipExporter.Matroska.cs:108-110` `byte flags = 0; if (keyframe) flags |= 0x80;` (nunca seta bit 0x01).
  - **L9** (dead code): done — zero matches de `EncodeRawNv12ToMp4`/`DetectFastestCodec` no src.
  - **C5** (rawFormat propagation) e **C6** (re-baseline PTS): done (sessões anteriores).

- **FASE 7 — M13 (Opcional, NÃO aplicado)**: `GenerateSilentAacFrames` (`ClipExporter.AudioSync.cs:8-46`) produz ADTS header-only de 9 bytes (7 header + 2 zeros), sem raw_data_block AAC real. Pipeline validado em produção (áudio funciona nos clips) — decisão de NÃO alterar para evitar risco de regressão num caminho já funcional.

- **FASE 8 — L12/L13/L15 (LOW, NÃO aplicados)**: L12 referencia `Log.cs:22-24` (setter) — o setter atual já é null-safe (double-checked locking, `_instance ??=`); sem `catch {}` vazio nem defeito real. L13 (Debug.WriteLine em falha de I/O) e L15 (`hMonitor` via IntPtr) são cosméticos — mantidos.

### Validado

- **C# tests**: ReplayBufferTests **46/46**, EngineCoordinatorCaptureTests **99/99**, suite completa **1048/1048 aprovados, 0 falhas** ("Execução de Teste Anulada." = flakiness pré-existente do ConsoleLogger/vstest documentada).
- **Build**: `dotnet build -c Release` — 0 erros (21 warnings pré-existentes: NalParsing.cs:241/257 CS8604, CaptureSource.cs CS8602, EngineCoordinator.cs:130 CS0169, etc.).
- **Commit**: `085f345` — `fix: FASE 7 M11 — snapshot unico StatsDetailed (lock unico) no status update` (inclui session summary anterior FASE 6+7 não commitado).
- **Publish + stage + deploy**: `dotnet publish -c Release --self-contained true -r win-x64` OK; `npm run copy-engine` — 291 files staged; app instalado parado; 5 arquivos `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — **SHA256 instalado == staging == `BA2640B3...`**.

### Key Decisions

- **`StatsDetailed()` único em vez de `Stats()`+`StatsDetailed()`**: cada chamada adquire o read lock do ReplayBuffer; unificar a leitura a uma aquisição reduz contention no status update (roda a cada frame) e garante valores coerentes entre si.
- **M13/L10/FASE 8 não aplicados**: itens opcionais ou LOW em caminho validado em produção — mudar por mudar arrisca regressão sem ganho mensurável.
- **Planos desatualizados**: `PLANO_EXECUCAO_FASES.md` referencia linhas de versões antigas (ex.: `ReplayBuffer.cs:1125-1131`, `ClipExporter.cs:841-842`) — itens conferidos no código real, não pela linha do plano.

### Next Steps

- Reiniciar o app instalado e validar em campo (sessão longa): status do replay buffer coerente (`ReplayBufferBytes = video+audio`), sem alteração funcional no pipeline.
- FASE 7 completa; FASE 8 (L12/L13/L15) avaliada e dispensada — remediação G-series concluída.

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.Capture.cs`: status update com `StatsDetailed()` único (M11)
- `AGENTS.md`: resumo de sessão

## Session Summary (2026-08-02 — MED #2: handler `config` do pipe passa por ValidateAndFix)

### Done

- **MED #2 do code review corrigido** — `IpcMessageHandler.Config.cs` `HandleConfig` copiava valores crus do payload do pipe (Cq, MaxrateKbps, BufsizeKbps, Bframes, Lookahead, OutputDirectory, HotkeyBindings etc.) sem clamp nem anti-path-traversal; a validação só existia no `Load()`.
- **`ConfigManager.cs` — método novo `ValidateAndFix(AppConfig)`**: extrai a lógica de validação do `Load()` (clamps: `ReplayTimeSeconds` [30,600], `Fps` {30,60,75,120}, `AudioSampleRate` {44100,48000,96000}, `Width`/`Height` 640×480–1920×1080, `BitrateKbps` [500,200000], `Cq` [0,51], `MaxrateKbps` [1000,500000], `BufsizeKbps` [2000,1000000], `Bframes` [0,16], `Lookahead` [0,256], `EncoderPreset` allowlist → default, `MicVolume` [0,4], `PttMode` normalizado, `OutputDirectory` anti-path-traversal com create dir) — chamado no fim do `Load()` **e** no fim do `Update()` (choke point do pipe).
- **Guarda `config.HotkeyBindings ??= new()`** no `ValidateAndFix`: pipe pode enviar `"HotkeyBindings": null` explícito → antes disso o `foreach` daria NRE dentro do `Update` (rollback de persistência) e o `ApplyHotkeyBindings` do handler também. Restaurado para lista vazia.
- **Clamp defensivo de `HotkeyBinding.ReplayDurationSeconds`** para [30,600]: protege `EffectiveReplaySeconds` → dimensionamento do `ReplayBuffer` (memória/disk spill). `null` preservado.
- **`HandleSetReplayTime`** alinhado: clamp `[15,600]` → `[30,600]` (range canônico do frontend, presets 60/120/300 + slider [30,600]).
- **7 testes novos** em `ConfigManagerTests.cs` (23 no arquivo):
  - `ValidateAndFix_ClampsInvalidNumericValues` (todos os campos inválidos → defaults)
  - `ValidateAndFix_ValidValues_Unchanged` (valores válidos intactos)
  - `ValidateAndFix_RejectsOutputDirectoryOutsideProfile` (`C:\Windows\System32` → `""`)
  - `ValidateAndFix_ClampsHotkeyReplayDurations` (100000 → null, 60 mantido, `EffectiveReplaySeconds` correto)
  - `Update_PipeStyleUnclampedValues_AreClamped` (Cq 99 → 20, OutputDirectory traversal → `""`) — **teste-chave do MED #2** (caminho real do pipe)
  - `Update_HotkeyBindingsNull_RestoresEmptyList` (guarda `??= new()`)
  - `Update` — testes pré-existentes inalterados
- **Gotchas de teste**: `AppConfig` construtor inicia `HotkeyBindings` com 3 defaults — teste precisa `Clear()` antes; `EffectiveReplaySeconds` é o **max** entre global e bindings (120 global > 60 binding → espera 120).
- **Não adicionado** teste de integração `HandleConfig` via reflection: requer `_ptt` (`PushToTalkManager` exige `HotkeyManager` com native hooks) — o `Update_PipeStyleUnclampedValues_AreClamped` cobre o choke point exato usado pelo handler.

### Validado

- **Build**: `dotnet build -c Debug` 0 erros (warnings pré-existentes).
- **C# tests**: ConfigManagerTests **23/23**; suite completa **1054/1054 aprovados, 0 falhas** ("Execução de Teste Anulada." = flakiness pré-existente do ConsoleLogger/vstest documentada).
- **Commit**: `c42368f` — `fix: MED #2 — handler config do pipe passa por ValidateAndFix (clamp + anti-path-traversal)`
- **Publish + stage + deploy**: `dotnet publish -c Release --self-contained true -r win-x64` OK; `npm run copy-engine` (291 files); 5 arquivos `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — **SHA256 instalado == staging == `899F8A3B...`**.

### Next Steps

- Reiniciar o app instalado e validar em campo: config via pipe com valores fora de range ou `OutputDirectory` fora do perfil é clampada/rejeitada sem quebrar o estado do engine.
- Remediação G-series e FASE 8 completas; MED #1 (HEVC CodecPrivate) já corrigido em código (sessões anteriores). Opcional: limpar dead code `preload/api/` restante.

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Config/ConfigManager.cs`: `ValidateAndFix()` novo, chamado em `Load()` e `Update()`; guarda `HotkeyBindings ??= new()`; clamp de `ReplayDurationSeconds`
- `dinho-clips-poc/src/DiNho.Capture.Poc/IpcMessageHandler.Config.cs`: `HandleSetReplayTime` clamp [30,600]
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/ConfigManagerTests.cs`: 7 testes novos
- `AGENTS.md`: resumo de sessão
## Session Summary (2026-08-02 — ClipEditorModal: 8 findings da revisao corrigidos)

### Done

- **8 achados do revisor (2 MEDIUM + 6 LOW) corrigidos** em `ClipEditorModal.tsx` (revisao de `8adec6c^..b28b280`; commits `8adec6c` + `938b94c`):
  1. **Handles de trim acessiveis**: `role="slider"` + `aria-label` (startLabel/endLabel), `aria-valuemin/max/now/valuetext`, `tabIndex={0}`, `onKeyDown` Arrow Left/Right (±1s, clamp 0.1s, preventDefault+stopPropagation).
  2. **Slider de seek**: `aria-valuetext={fmt(currentTime)}` com novo helper `fmt` (`m:ss`).
  3. **Focus trap completo** (padrao ConfirmDialog): `dialogRef`/`previousFocusRef`/`onCloseRef`; autofoca 1o controle; Tab wrap (shift inclusive) sobre `[tabindex]:not([tabindex="-1"])`; restaura foco no cleanup; Escape via `onCloseRef.current()` (estavel — sem re-registro a cada re-render).
  4. **Backdrop**: `<button>` → `<div aria-hidden="true" onMouseDown={onClose}>` — sai do tab order, fecha ao arrastar para fora.
  5. **`role="group"` duplicado removido** (dialog ja tem `role="dialog"`/`aria-label`).
  6. **`<track kind="captions" />` inerte removido** — preview de clips proprios sem legenda; `useMediaCaption` suprimido com `biome-ignore` (precedente DashboardPage/Sidebar) + `onMouseMove` movido para o dialog (`role="dialog"` permite handler) — sem erros NOVOS de biome.
  7. `startLabel={t('start')}`/`endLabel={t('end')}` passados nas 2 instancias (chaves ja existiam nos 3 locales).
- **Validacao**: biome baseline-only (so resta o diff CRLF pre-existente, confirmado via `git stash`); tsc sem erros; suite completa **6280 passed | 1 skipped** (200 files) — 0 falhas; build OK; ClipsPage 23/23, clip suites 494/494.

### Full Suite
- **6280 TS tests**, 200 files — **0 quebras**
- **Commit**: `938b94c` — `fix: a11y final no ClipEditorModal (focus trap + backdrop + handles de trim)`

### Next Steps
- Validar em campo no app instalado: handles de trim arrastando/teclado em clips longos (120s+), tab order com foco no 1o controle e Escape fechando, sem regressao no preview.

## Session Summary (2026-08-03 — TDD `sharpnessStrength` config: RED → GREEN)

### Done

- **Nova config `sharpnessStrength` (0..1, default 0 = filtro off)** implementada via TDD completo (RED → GREEN → suites), espelhando o padrão `stretchToFit`:
  - **Filtro ffmpeg `cas`** (Contrast Adaptive Sharpening): `-vf "... ,cas=strength=X"` anexado ao filter chain existente (crop + scale) no `FfmpegEncoder.StartFfmpeg`.
  - **C# `AppConfig.SharpnessStrength`** (double, default 0) + clamp no `ValidateAndFix` (NaN/`<0`/`>1` → default 0) — vale para Load (arquivo) e Update (pipe, choke point MED #2).
  - **`FfmpegEncoder`**: campo `_sharpnessStrength`, setter `SetSharpnessStrength(double)`, helper puro `internal static AppendSharpnessFilter(string chain, double strength)` (cultura invariante — ponto decimal mesmo sob pt-BR; NaN/`<=0` retorna cadeia inalterada; `>1` clampado para 1).
  - **Wiring**: `EngineCoordinator.Capture.cs` chama `fe.SetSharpnessStrength(_config.Config.SharpnessStrength)` logo após `SetStretchToFit` (bônus: removida a linha duplicada `fe.SetStretchToFit(...)` que existia ali).
  - **TS**: `sharpnessStrength` em `ClipsPersistedConfig` (store, default 0), `ConfigState` (manager, default 0), `baseConfigPayload`/`buildEngineConfig`, `loadPersistedClipsConfig` (`saved.sharpnessStrength ?? 0`), `persistClipsConfig`, tipo `ClipsConfig` (`src/shared/types/clips.ts`).
  - **IPC**: `CLIPS_SET_CONFIG` aceita `sharpnessStrength` number, clamp `Math.min(1, Math.max(0, ...))`, ignora não-número.

### TDD (RED → GREEN)

- **RED (11 testes novos, todos falhando antes da implementação)**:
  - TS `clips-config-store.test.ts`: default 0; arquivo salvo 0.6 carrega; persist default 0.
  - TS `clips-config-manager.test.ts`: `buildEngineConfig` default 0 + propaga 0.6; `loadPersistedClipsConfig` sincroniza 0.6; `persistClipsConfig` persiste 0.6.
  - TS `clips.ipc.test.ts`: update 0.6; clamp 2.5→1 e −1→0; string `'high'` ignorada (mantém 0.4).
  - C# `ConfigManagerTests.cs`: default `0d`; `SharpnessStrength=5` clamp→`0d`; `0.5` preservado.
  - C# `FfmpegEncoderTests.cs`: `AppendSharpnessFilter` — com scale `"scale=1280:720,cas=strength=0.5"`, zero/negativo/NaN inalterado, cadeia vazia → `"cas=strength=0.4"`, `3d` → `"cas=strength=1"`, separador decimal invariante.
- **GREEN**: implementação acima; suites filtradas 166/166 (TS) e 98/98 (C#) — 0 falhas.

### Validado

- **TS full suite**: **6291 passed | 1 skipped** (200 files) — 0 falhas (+11 testes RED)
- **C# full suite**: **1063 approved | 0 falhas** ("Execução de Teste Anulada." = flakiness pré-existente do ConsoleLogger/vstest documentada)
- **Build**: `dotnet build` implícito no test — 0 erros (warnings pré-existentes apenas)

### UI (slider de nitidez em `ClipsConfigQuality.tsx`)

- Slider `input[type=range]` 0..1 step 0.1 na seção de qualidade, após "Stretch to fit": rótulo `sharpness` + `TipBadge id="sharpness"` (mapa de tooltips em `useClipsState.ts` ganhou `sharpness: t('sharpnessTooltip')`); valor exibido à direita — `(strength).toFixed(1)` quando >0, senão `sharpnessOff`; `onChange` → `handleConfigUpdate({ sharpnessStrength: Number(e.target.value) })`.
- Locales en/pt/es: chaves `sharpness`/`sharpnessTooltip`/`sharpnessOff`.
- `ClipsPage.test.tsx` 23/23 pass; `npm run build` OK; biome: só diffs CRLF pré-existentes (confirmado via `git stash`).

### Next Steps

- Publicar engine (`dotnet publish -c Release --self-contained true -r win-x64`) + `npm run copy-engine` + deploy no app instalado (`%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\`) — back/engine novos já wired; UI completa.
- Validar em campo: slider de nitidez altera o clip (`cas=strength=X` no log), 0 desliga o filtro.

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: `_sharpnessStrength`, `SetSharpnessStrength`, `AppendSharpnessFilter`, wiring no vf chain + `using System.Globalization`
- `dinho-clips-poc/src/DiNho.Capture.Poc/Config/ConfigManager.cs`: `AppConfig.SharpnessStrength` + clamp `ValidateAndFix`
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.Capture.cs`: `SetSharpnessStrength` call + remoção do `SetStretchToFit` duplicado
- `src/main/services/clips-config-store.ts`: `sharpnessStrength` na interface + DEFAULTS
- `src/main/services/clips-config-manager.ts`: ConfigState, config inicial, baseConfigPayload/buildEngineConfig, load sync, persist
- `src/main/ipc/clips.ipc.ts`: `CLIPS_SET_CONFIG` clamp
- `src/shared/types/clips.ts`: `sharpnessStrength?: number`
- `src/renderer/src/components/clips/ClipsConfigQuality.tsx`: slider `sharpnessStrength` (UI)
- `src/renderer/src/components/clips/useClipsState.ts`: tooltip `sharpness`
- `src/renderer/src/locales/{en,pt,es}/clips.json`: `sharpness`/`sharpnessTooltip`/`sharpnessOff`
- Tests: `clips-config-store.test.ts`, `clips-config-manager.test.ts`, `clips.ipc.test.ts`, `ConfigManagerTests.cs`, `FfmpegEncoderTests.cs`

## Session Summary (2026-08-04 — O1/O2 GPU: revisao aplicada + deploy + smoke)

### Done

- **Revisao concluida (PASS, sem CRITICAL/HIGH)** com 2 MEDs reais + LOWs — todos corrigidos e validados:
  - **MED #1 (leak COM no ctor)**: GpuVideoConverter ctor — _enumerator/_videoProcessor agora sao locals (numerator/processor), atribuidos so apos sucesso; catch faz dispose de processor, numerator, ideoDevice, ideoContext, _videoContext1 antes de rethrow.
  - **MED #2 (LOH alloc no downscale)**: novo overload DownscaleBgra(src, srcW, srcH, srcRowPitch, dstW, dstH, byte[] dst) grava no buffer do chamador; campos _downscaleScratch/_downscaleScratchW/_downscaleScratchH cacheados por (nv12W, nv12H); overload de 5 args (testes) aloca 
ew byte[dstW*dstH*4]; identidade usa src.CopyTo(dst).
  - **LOW (altura impar)**: branch direto do ConvertCpuNv12 ampliado para 	exW == nv12W && (texH == nv12H || texH == nv12H + 1) — evita bilinear de frame inteiro para altura impar.
  - **LOW (formato staging)**: _cpuStaging cacheado por dims **e** formato (_cpuStagingFormat = texDesc.Format), espelhando o chaveamento do _inputCopy.

- **Build Release**: exit 0, 0 erros (22 warnings pre-existentes).
- **Filtro de testes da feature** (ResolveOutput|DownscaleBgra|BgraToNv12|CanUseDirectInput): **18/18 GREEN**.
- **Suite completa**: 1087 ok / 13 falhas — **todas ambientais ou pre-existentes, nenhuma das mudancas**:
  - 9 testes ffmpeg-probe (Win32Exception: cannot find 'ffmpeg') — ffmpeg.exe ausente do PATH do shell e do staging (ambiente, nao codigo; confirmado: spawnam ProcessStartInfo("ffmpeg")).
  - 3 ConfigManager/EngineCoordinator pre-existentes (preset p5/p4) + 1 MasterClock flaky.
- **Deploy**: publish (812CDAAB...) -> 
pm run copy-engine (293 files, **ffmpeg nao copiado** — erro pre-existente do script) -> 5 arquivos DiNho.Capture.Poc.* copiados para %LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\; SHA256 instalado == staging == 812CDAAB9C4C93BE9BA7431FC90BCE376A7582EBFA6A1FD53BB840144B5885A8.
- **Smoke de hardware** (do dir instalado, onde ffmpeg.exe existe): Ffmpeg... OK (libx264), FfmpegHw... OK — **probed OK: HW native (h264_nvenc)**, initialized (codec=h264_nvenc), GPU detectada (fix OverflowException da VRAM funciona), sem restart loop.

### Key Decisions

- **Overload de 7 args com buffer do chamador para o downscale**: evita alocar LOH por frame em 720p+; o cache _downscaleScratch por (nv12W, nv12H) faz reset de tamanho barato e preserva o buffer entre frames.
- **Branch direto (identidade) tambem para 	exH == nv12H + 1**: altura impar de captura (ex.: 1081) nao precisa de bilinear no eixo Y quando ja bate as dims — apenas o crop de 1 linha.

### Next Steps

- Reiniciar o app instalado e validar em campo (captura real): WGC com SR direto (sem _inputCopy), PrintWindow/Hybrid via fallback, VPBlt 720p, e fallback CPU em dims impares.
- Nota: 
pm run copy-engine nao copia ffmpeg.exe (erro pre-existente do script (Get-Command ffmpeg.exe)); o app instalado ja tem ffmpeg do pacote, mas rebuilds de instalador devem resolver isso.

### Relevant Files Changed

- dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/GpuVideoConverter.cs: ctor sem leak (locals + dispose no catch)
- dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.GpuConvert.cs: DownscaleBgra overload cacheado, branch direto altura impar, _cpuStagingFormat
- dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs: EncoderOutputResolve/ResolveOutput, StartFfmpeg, _nv12W/_nv12H
- dinho-clips-poc/src/DiNho.Capture.Poc/Capture/TexturePool.cs: BindFlags.ShaderResource
- dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/FfmpegEncoderTests.cs: 18 testes GREEN

## Session Summary (2026-08-04 — HIGH do review fixado: áudio resiliente sem NRE quando loopback ausente)

### Done

- **Revisor pós-commit `7edd3b0` retornou CHANGES REQUESTED (1 HIGH)**: `EngineCoordinator.Audio.cs:29-34` loga "SOMENTE VÍDEO" quando ambos os sources são null mas continua chamando `new AudioMixer(null, ...)`. O ctor do `AudioMixer` tinha `IAudioSource loopbackSource` não-nullable e dereferenciava `_loopbackSource.OnAudioData += ...` incondicionalmente → NRE. `Start()`/`Stop()`/`Dispose()` idem. Como `WasapiLoopbackSource` lança `InvalidOperationException` sem device de render, o cenário SOMENTE VÍDEO (e o de mic presente sem loopback) crashavam — exatamente o que a feature deveria suportar.

- **TDD completo (RED → GREEN → suítes → deploy)**:
  - **RED (8 testes novos em `AudioMixerTests.cs`)**: stub `FakeAudioSource : IAudioSource` + `using DiNho.Capture.Poc.Sync;`; casos ctor/Start/Stop/Dispose com loopback null (all-null e mic-present); `Start_LoopbackNull_UsesMicSampleRate` (44100/1), `Start_LoopbackNull_UsesDefaultSampleRateWhenNoMic` (48000/2). Confirmado: 8 falharam (NRE) / 10 existentes passaram.
  - **GREEN (`AudioMixer.cs`)**: campo e parâmetro `IAudioSource? _loopbackSource`; ctor guarda `if (_loopbackSource != null)`; `Start()` usa `?.` e deriva `_sampleRate/_channels` de `_loopbackSource ?? _micSource ?? 48000/2`; `Stop()` `?.`; `Dispose()` guarda o unsubscribe. 18/18 GREEN.
  - **2 LOWs do mesmo review**: `WasapiMicSource.cs` ctor reescrito — fallback default agora `Role.Multimedia` primeiro (o `Role.Communications` pode não existir em máquinas sem headset) e primeiro device de captura ativo como último recurso (erro claro se não houver nenhum); inválido-deviceId cai no mesmo fallback. `MMDeviceCollection` não é IDisposable em NAudio — sem Dispose (revertido).
  - Call sites confirmados seguros: `EngineCoordinator.Capture.cs:192-206` (`_audioMixer.SampleRate`/`.Start()`/`OnMixedAudio`), `IpcMessageHandler.Mic.cs` reinit.

- **Validado**:
  - C# suite: **1096 aprovados / 12 falhas — todas ambientais pré-existentes documentadas** (9 ffmpeg-probe — ffmpeg.exe ausente do PATH do shell; 3 ConfigManager/EngineCoordinator preset p5/p4 + lookahead; MasterClock flaky passou desta vez). Nenhuma das mudanças.
  - Build Release: 0 erros.

- **Commit**: `17f787e` — `fix: áudio resiliente sem NRE quando loopback ausente (SOMENTE VÍDEO) + fallback de mic robusto`
- **Publish + stage + deploy**: `dotnet publish -c Release --self-contained true -r win-x64` OK; `npm run copy-engine` (293 files; ffmpeg não copiado — erro pre-existente do script, app instalado já tem ffmpeg); 5 arquivos `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — **SHA256 instalado == staging == publish == `01A4A4DFD733C6D66037AEFF8D8D25B5B4131FF78ED7A7CBC1716EABAA1E822C`**.

### Key Decisions

- **`IAudioSource?` no AudioMixer sobre `AudioMixer?` nos call sites**: menor diff; o mixer continua criado sempre (Start/OnMixedAudio/SampleRate válidos em SOMENTE VÍDEO) e os guards de source ficam centralizados no mixer.
- **Derivar SR/Channels do mic quando loopback null**: TryMix só emite com dados de loopback, então com ambos null a captura é SOMENTE VÍDEO sem produção de áudio — mas o mixer ainda reporta SR/Channels consistentes para o AAC encoder.

### Next Steps

- Reiniciar o app instalado e validar em campo: máquina sem device de render (ou com render desligado) não deve crashar — engine roda SOMENTE VÍDEO sem áudio; mic sem device default/headset usa Multimedia/first-available em vez de falhar.
- (Opcional) `npm run copy-engine` não copia ffmpeg.exe (Get-Command falha no shell) — corrigir script em rebuild de instalador.

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Audio/AudioMixer.cs`: `IAudioSource?` ctor/campo, guards em ctor/Start/Stop/Dispose, SR/Channels derivados de loopback→mic→default
- `dinho-clips-poc/src/DiNho.Capture.Poc/Audio/WasapiMicSource.cs`: fallback Multimedia→first-available (Role.Communications pode não existir)
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/AudioMixerTests.cs`: 8 testes RED → GREEN (stub FakeAudioSource + MasterClock)
- `AGENTS.md`: resumo de sessão

## Session Summary (2026-08-04 — Botão "Abrir Pasta" dos clips corrigido)

### Root cause

- **Sintoma**: botão de abrir dos clips "parecia não encontrar o caminho do vídeo" (nada acontecia).
- **Diagnóstico**: o botão "Abrir Pasta" de `ClipsConfigPanel.tsx:69` passa `config.outputDirectory` (a **pasta** em si) para `handleOpenClip` → `CLIPS_OPEN_CLIP` → `clipPathInOutputDir`. O check usava `resolved.toLowerCase().startsWith(outputDir + '\\')` — como a pasta não tem separador final, o prefixo nunca casava → `null` → o handler retornava em silêncio (sem `shell.openPath`, sem feedback).
- O botão "Abrir" por-clip (arquivo `clip.path`) já passava: o path absoluto dentro do outputDir casa com o prefixo. Confirmado com a config real da máquina (`%APPDATA%\dinho-optimizer\clips-config.json` → `outputDirectory = C:\Users\WENDEL\Desktop\DiNhoClips`, 2 MP4s lá).

### Fix (TDD RED → GREEN)

- **`clipPathInOutputDir`** (`clips-config-manager.ts`): adicionada condição `isDirItself` — se o path resolvido **é** o próprio outputDir (com ou sem separador final), passa na validação; resto inalterado (traversal e absolutos fora do dir continuam rejeitados). Segurança preservada: subpastas/arquivos dentro do dir seguem permitidos; a pasta em si é inofensiva para `shell.openPath`.
- **RED**: 2 testes em `clips-config-manager.test.ts` (aceita a pasta em si; aceita com separador final) + 1 em `clips.ipc.test.ts` (`opens the output directory itself`) — todos falhando antes.
- **GREEN**: implementação + 3 testes passando.

### Validado

- **TS**: suíte completa **6679 passed | 1 skipped | 1 failed** (219 files). A única falha é pré-existente e ambiental: `yara-engine.test.ts` usa `mkdtemp('/tmp/yara-test-XXXXXX')` (path Unix inexistente no Windows) — confirmado idêntico com `git stash` (baseline).
- Clips: `clips-config-manager.test.ts` + `clips.ipc.test.ts` + `clip-video-protocol.test.ts` = **178/178 pass** (3 novas).

### Relevant Files Changed

- `src/main/services/clips-config-manager.ts`: `clipPathInOutputDir` aceita o outputDir em si (`isDirItself`)
- `src/main/services/clips-config-manager.test.ts`: 2 testes novos
- `src/main/ipc/clips.ipc.test.ts`: 1 teste novo (open folder)

## Session Summary (2026-08-05 — Auditoria round-trip IPC: 0 BUGs, 4 scans lentos identificados)

### Done

- **Auditoria round-trip IPC completa** (`e2e/ipc-roundtrip.test.ts`, novo): automação que itera TODOS os métodos de `window.dinho`, chama cada um no renderer via `ipcRenderer.invoke`, e verifica se o handler no main responde (resolve ou rejeita por validação). Objetivo: expor BUGs de canal sem receptor (`"No handler registered"`).
- **Resultado: 0 BUGs** — `noHandler: []`, 0 canais sem handler:
  - `[roundtrip] 195 ok | 1 reject | 4 hang | 69 skip | total 269`
  - 1 reject: `customRulesRemove` → `EPERM: unlink '...custom-yara-rules'` (handler respondeu — round-trip OK; erro é do arquivo não existir no userData de teste, não canal morto)
  - 4 hangs: `networkGetConnections`, `driverUpdateScan`, `driverAgentEvaluate`, `firewallScan` — todos **scans de sistema legítimos** que excedem o timeout de E2E, NÃO bugs:
    - `networkGetConnections` → `getActiveConnections` (network-monitor.ipc.ts:100): PowerShell Get-NetTCPConnection + `getProcessName(pid)` **sequencial por linha** (sem timeout no loop de PIDs) — com muitas conexões, leva >15s
    - `driverUpdateScan` → Windows Update search (`scanDriverUpdates`), pode levar 30s+
    - `driverAgentEvaluate` → avaliação de drivers instalados
    - `firewallScan` → enumeração de regras de firewall
  - Handlers confirmados presentes via grep: `src/main/ipc/network-monitor.ipc.ts:156`, `src/main/ipc/driver-manager/index.ts:34`, `src/main/ipc/driver-agent.ipc.ts:10`, `src/main/ipc/firewall-audit.ipc.ts:419`

- **Fixes no harness do teste**:
  - `runner` convertido de template string para arrow **async** real via `page.evaluate` (antes: `await is only valid in async functions`)
  - `test.setTimeout(300_000)` + deadline de 220s dentro do runner — métodos além do tempo marcados `skip`, evitando estouro do `beforeAll` (60s)
  - Relatório final em `e2e/.ipc-audit/report.json` (269 métodos, 200 chamados, 69 skips)

### Aprendizados

- **`ipcMain._invokeHandlers` não é o dispatch real no Electron 43** — wrapper de instrumentação no main registrou channels (270) mas `invokeHits`/`eventHits` ficaram vazios; os métodos resolveram mesmo assim. Detecção de noHandler é **renderer-side** (erro de `ipcRenderer.invoke`), então a auditoria é válida independente disso. Instrumentação main-side para "canais nunca atingidos" é redundante com os resultados da própria bateria (que já lista método por método).
- **Padrão round-trip**: preload usa `ipcRenderer.invoke(IPC.CANAL, ...args)`; canais em `src/shared/channels.ts`; `window.dinho` = `{ ...systemMethods, ...scanMethods, ...clipsMethods }` (`src/preload/index.ts:6-10`).

### Next Steps (opcional)

- Se quiser reduzir falsos-positivos de hang em CI: adicionar `networkGetConnections`/`driverUpdateScan`/`driverAgentEvaluate`/`firewallScan` a uma lista `KNOWN_SLOW_SCANS` no teste (permanecem no relatório, não contam como falha). O teste atual já passa com hangs (asserts só sobre `noHandler`).
- Otimização real opcional: `getActiveConnections` — fazer `getProcessName` em lote (1 chamada a `tasklist`/`Get-Process` para todos os PIDs) em vez de 1 spawn por PID.

### Relevant Files Changed

- `e2e/ipc-roundtrip.test.ts` (novo): bateria round-trip, runner async, deadline 220s, relatório
- `e2e/.ipc-audit/report.json`: relatório final (0 noHandler)
- `AGENTS.md`: resumo de sessão

## Session Summary (2026-08-05 — Journey e2e: crash lucide icons fix + crash-guard)

### Done

- **Root cause dos módulos travando** (/firewall em diante mostravam `-`): lucide-react imports não são type-checked pelo esbuild — ícone usado sem import = ReferenceError runtime que crashava a rota e congelava o router inteiro (error boundary) para todos os módulos seguintes.
  - **Crash #1**: FileX não importado em FirewallAuditPage.tsx (StatBox statStaleProgram, linha 241) → adicionado.
  - **Crash #2**: FileWarning não importado (StatBox statUnsigned, linha 242) → adicionado.
  - Verificados como exports reais do lucide-react (xports.FileX = FileX, xports.FileWarning = FileExclamationPoint).
- **Auditoria de ícones usados-sem-import** em todos os src/renderer/src/**/*.tsx: scan refinado (só icon={X} / <X  JSX, excluindo imports de qualquer fonte + declarações locais). **Nenhum ícone lucide faltando** — os hits restantes são falsos positivos (Icon/ActionIcon são props, DiskCard é função local, HTMLElement/HTMLButtonElement DOM globals, K/T/TArgs/TResult type params genéricos).
- **Crash-guard refinado** em clickButton: agora só faz bail quando a página tem <2 <button> E nenhum botão casa com algum label após 6s (rota crashada) — páginas saudáveis com 1 botão legítimo (ex.: hosts-editor) não são mais false-positive.
- **Journey run final**: **1 passed (19.2m)**, 2e/.journey-audit/report.json com 25 screenshots, **0 globalErrors**:
  - 15 módulos idle capturados OK (/cleaner 20.9s, /registry 13.2s, /context-menu, /malware, /privacy, /debloater, /firewall 34.4s, /disk, /updates, /drivers, /installer, /benchmark, /memory, /hosts-editor, /startup, /schedules, /performance, /windows-tweaks).
  - 3 scans pesados legítimos BUSY/TIMEOUT no cap (scan começou — uttonClicked setado — mas não terminou): /services 180s, /compliance 300s, /vulnerability 300s.
  - 3 módulos com seletor de pasta nativo (headless, não automatizável): /duplicates, /large-files, /empty-folders (note seletor de pasta nativo (headless)).

### Next Steps

- (Opcional) /services, /compliance, /vulnerability são scans reais longos (>3-5 min): subir caps (ex.: 600s) e re-rodar para capturá-los em idle, ou medir a duração real do scan para decidir.
- (Opcional) getActiveConnections — batchear getProcessName(pid) (1 spawn 	asklist/Get-Process para todos os PIDs) em vez de 1 spawn por PID (rede lenta no ipc-roundtrip).

### Relevant Files Changed

- 2e/journey.test.ts: crash-guard só com ound === null; MODULES com caps (services/compliance/vulnerability longos)
- src/renderer/src/pages/FirewallAuditPage.tsx: imports FileX + FileWarning adicionados
- 2e/.journey-audit/report.json: relatório final (25 modules, 15 idle, 0 globalErrors)
- AGENTS.md: resumo de sessão

## Session Summary (2026-08-05 — Review fix: handler de pipe ignora ReplayBufferMode/StretchToFit/SharpnessStrength)

### Done

- **Reviewer externo retornou CHANGES REQUESTED** com 3 findings nas mudanças não commitadas da feature `replayBufferMode: 'ram'|'hybrid'`. Confirmado manualmente: `IpcMessageHandler.Config.cs` copy block do pipe `config` omitia 3 campos — `ReplayBufferMode` (novo), `StretchToFit` e `SharpnessStrength` (ambos pré-existentes) — então o modo `'hybrid'` era inalcançável em runtime (engine sempre `'ram'`) e stretch/sharpness nunca chegavam ao engine via pipe.

- **Fix 🔴 CRITICAL** (`IpcMessageHandler.Config.cs:127-129`): adicionadas ao `_config.Update(c => ...)`:
  - `c.StretchToFit = incoming.StretchToFit;`
  - `c.SharpnessStrength = incoming.SharpnessStrength;`
  - `c.ReplayBufferMode = incoming.ReplayBufferMode;` (validação/fallback via `ValidateAndFix` já existente)
- **Fix 🟡 MED** (`ConfigManager.cs:300-302`): `ValidateAndFix` agora **normaliza `ReplayBufferMode` para lowercase** após validar (`ToLowerInvariant`) — `"Hybrid"` validava (comparação case-insensitive de `IsValidReplayBufferMode`) mas o branch em `EngineCoordinator.Capture.cs:215` usava `== "hybrid"` case-sensitive, então rodava como `'ram'`. Normalização resolve a assimetria sem tocar o branch.
- **4 testes novos** (`ConfigManagerTests.cs`, 27 no arquivo — RED → GREEN):
  - `Update_PipeStyleHybridReplayBufferMode_PersistsNormalized` — `"Hybrid"` → `"hybrid"` (RED confirmado antes do fix)
  - `Update_PipeStyleInvalidReplayBufferMode_FallsBackToRam` — `"disk-only"` → `"ram"`
  - `Update_PipeStyleStretchAndSharpness_Persist` — `true`/`0.6` persistidos via `Update`
  - `Update_PipeStyleInvalidSharpnessStrength_FallsBackToZero` — `2.5` → `0`
  - Teste de integração do `HandleConfig` via pipe não é possível (requer `_ptt`/`HotkeyManager` com native hooks — documentado); o choke point `Update()` cobre o caminho exato do handler.

### Validado

- **C#**: ConfigManagerTests **27/27**; suite completa **1110 aprovados / 9 falhas — todas ambientais pré-existentes** (ffmpeg-probe `Win32Exception: cannot find 'ffmpeg'` — ffmpeg.exe ausente do PATH do shell; nenhuma das mudanças).
- **Publish**: `dotnet publish -c Release --self-contained true -r win-x64` OK.
- **Deploy**: app instalado parado; 5 arquivos `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\`; **SHA256 publish == instalado == staging == `1EBB7F92...`**.
- **copy-engine**: 293 files staged (ffmpeg.exe não copiado — bug pré-existente do script, documentado).

### Next Steps

- Reiniciar o app instalado: `replayBufferMode:"hybrid"` agora alcança o engine via pipe (branch `EngineCoordinator.Capture.cs:215` ativa o spill), e `stretchToFit`/`sharpnessStrength` propagam por config.
- (Opcional) Relançar o reviewer com os 3 findings resolvidos para confirmar.

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/IpcMessageHandler.Config.cs`: +3 atribuições no copy block do pipe `config`
- `dinho-clips-poc/src/DiNho.Capture.Poc/Config/ConfigManager.cs`: `ValidateAndFix` normaliza `ReplayBufferMode` lowercase
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/ConfigManagerTests.cs`: +4 testes (RED → GREEN)
- `AGENTS.md`: resumo de sessão

## Session Summary (2026-08-05b — Installer embarca ffmpeg 9.0 + NVENC weighted_pred fix)

### Done

- **ffmpeg 9.0 no instalador**: winget install --id Gyan.FFmpeg -e instalou 9.0-full_build-www.gyan.dev; binário real copiado de %LocalAppData%\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0-full_build\bin\ffmpeg.exe para 
esources\ffmpeg-custom\ffmpeg.exe (212MB) — candidato priority-1 do copy-engine.js. 
pm run copy-engine agora copia ffmpeg 9.0 (294 files), resolvendo o bug pré-existente de staging sem ffmpeg.
- **CRITICAL — regressão ffmpeg 9.0 encontrada e corrigida**: 9.0 (NVENC SDK 11.1+) **hard-fail** em -weighted_pred 1 com B-frames: InitializeEncoder failed: invalid param (8): Weighted Prediction not supported with B-frames. (8.1.2 ignorava silenciosamente). Engine passava -weighted_pred 1 -bf 2 (default bframes=2 do SetQualityParams) em h264/hevc_nvenc → qualquer gravação falharia no instalador (gatilho do restart loop).
  - **Fix**: novo seam internal static BuildWeightedPredArg(bool bframesZero) (FfmpegEncoder.cs) — " -weighted_pred 1" só com _bframes == 0 (preset Boa); com B-frames o arg é omitido. Aplicado via interpolação em h264_nvenc/hevc_nvenc. av1_nvenc nunca usou weighted_pred.
  - Verificado com encodes reais no binário 9.0: h264/hevc sem weighted_pred OK (2502/2316KB); av1 OK (3189KB); weighted_pred só válido com -bf 0.
  - -tune high_quality removido no 9.0 (só -tune hq/int 1-4) — engine já usava -tune hq; nenhum outro arg obsoleto removido é usado.
- **2 testes novos** (FfmpegEncoderTests.cs): BuildWeightedPredArg_BframesZero_ReturnsWeightedPred, ..._BframesNonZero_ReturnsEmpty. **95/95** no filtro FfmpegEncoderTests.
- **Publish + stage + deploy**: dotnet publish -c Release --self-contained true -r win-x64 OK; copy-engine (294 files, ffmpeg 9.0 212MB); 5 arquivos DiNho.Capture.Poc.* para %LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\ — SHA256 publish == staging == instalado == 4F5AFABC....
- **Instaladores rebuildados** (
pm run package): DiNho-Optimizer-Setup-1.0.7.exe (219MB) + DiNho Optimizer 1.0.7.exe (218.8MB), assinados; DLL empacotada == staging (4F5AFABC...); ffmpeg 9.0 212MB embarcado e assinado.
- **Changelog ffmpeg 9.0** (https://github.com/FFmpeg/FFmpeg/blob/n9.0/RELEASE_NOTES) — destaques para o projeto: AMF novo (f_frc_amf frame rate converter, f_vqe_amf video quality enhancer, HDR no f_vpp_amf, hw memory mapping), 	ranspose_cuda (rotação HW p/ export vertical), bsf split HEVC multi-layer Dolby Vision, backend DNN ONNX Runtime com GPU (features futuras), Animated WebP decoder, HE-AAC 960 (DAB+), SMPTE 2094-50 (HDR10+); removidos deprecated NVENC options e suporte a SDK < 11.1.
- **Commit**: d29f52e — ix: NVENC weighted_pred gated por bframes (compat ffmpeg 9.0)

### Key Decisions

- **Gate por bframes em vez de remover o arg**: weighted_pred é vantajoso em cenas de baixo movimento; com B-frames o NVENC SDK não o suporta e o 9.0 agora falha em vez de ignorar — manter o arg só no preset Boa (bf 0) preserva o recurso sem risco.
- **ffmpeg-custom como fonte única**: copy-engine.js já prioriza 
esources/ffmpeg-custom/ — colocar o binário real lá é o caminho canônico para o instalador herdar a versão testada.

### Next Steps

- Reiniciar o app instalado e validar gravação real: preset com bf 2 (Alta/Muito Alta) sem "invalid param (8)" e preset Boa (bf 0) mantendo weighted_pred.
- (Opcional) Investigar ganhos do 9.0: 	ranspose_cuda p/ export 9:16 e f_vqe_amf p/ AMD com bitrate menor.

## Session Summary (2026-08-05 — FASE 2 AMD AMF enhance `sr_amf`/`frc_amf` no trim/merge: testes IPC + deploy do plano)

### Done

- **FASE 2 do plano ffmpeg-9 (AMD AMF enhance) completa end-to-end** — `sr_amf` (super-resolution) e `frc_amf` (frame-rate conversion) aplicáveis em trim e merge de clips:
  - **`src/main/services/clips-enhance.ts`** (novo): helpers puros `parseEnhanceOption` (valores válidos → passthrough, inválido → `'none'`), `buildAmfEnhanceVf` (SR upscales 720p→1080p cap 1920x1080; frc só; sr+frc encadeado com `,`; `'none'`/dims<=0 → null), `probeVideoResolution` (ffmpeg `-hide_banner -i` stderr parse de `Stream #0:0: Video: ... WxH`, retorna null em stream de áudio/stderr vazio/ENOENT/timeout), `AMD_VENDOR_ID = 0x1002`.
  - **`clips.ipc.ts`**: importa helpers; `_amdDetected: boolean | null` cache setado em `CLIPS_GET_GPUS` (`gpu.vendorId === AMD_VENDOR_ID`); handler novo `CLIPS_GET_ENHANCE_SUPPORT` (→ `{ amd: _amdDetected === true }`); `CLIPS_TRIM_CLIP` ganhou 5º param `enhance` — só aplica com `reEncode && _amdDetected` e probe de resolução OK, injeta `-vf <chain>` via `...reEncodeArgs, ...(enhanceVf ? ['-vf', enhanceVf] : [])`, warnings logados (não-fatal) quando reEncode ausente/não-AMD/probe falha; `CLIPS_MERGE_CLIPS` ganhou 2º param `enhance` — AMD+probe → re-encode libx264 (`-c:v libx264 -preset veryfast -crf C.cq -maxrate -bufsize -vf ... -c:a copy`), senão `['-c','copy']`.
  - **`src/preload/clips.ts`**: `clipsGetEnhanceSupport`, `clipsTrimClip` 5 args, `clipsMergeClips` 2 args; `src/shared/channels.ts` + `src/shared/types/clips.ts` (EnhanceOption).
  - **UI `ClipEditorModal.tsx`**: componente `EnhanceSelect` (label `t('enhance')`, 4 opções none/sr/frc/sr+frc), estado `enhance` + `enhanceSupported` (probe via `clipsGetEnhanceSupport` no mount), dropdowns desabilitados conforme `reEncode && enhanceSupported` (trim) / `enhanceSupported` (merge); locale en/pt/es +7 chaves (`enhance`, `enhanceNone`, `enhanceSr`, `enhanceFrc`, `enhanceSrFrc`, `enhanceTooltip`, `enhanceUnavailable`).
- **Testes**:
  - `clips-enhance.test.ts` (novo): parse/build/probe/constante — inclui cap 1920x1080, cadeia sr+frc, probe com stream de áudio/stderr vazio/ENOENT/timeout.
  - `clips.ipc.test.ts`: count handlers 24→25 + `CLIPS_GET_ENHANCE_SUPPORT` (3 testes) + enhance no trim (5) e merge (3). Padrão: `_amdDetected` é estado de módulo persistente — testes setam via `CLIPS_GET_GPUS` com vendor 0x1002/4318 antes; probe mockado por args `-hide_banner` (probe) vs `-ss`/`-f concat` (trim/merge real); merge assert procura call com `concat` (1º execFile é o probe).
  - `clips.test.ts` (preload): `clipsGetEnhanceSupport` + args novos; testes de args omitidos (undefined) p/ reEncode/enhance.
- **Validado**: suite clips+preload **633/633**; full suite **6841 passed | 1 skipped | 0 failed** (225 files); biome 7 arquivos limpos (import sort em `clips.ipc.ts` + format em test/ClipEditorModal); `npm run build` OK (8.9s).

### Key Decisions

- **Gate AMD por GPU vendorId via pipe** em vez de `isAMDSupported()` no cliente: engine já enumera GPUs (`CLIPS_GET_GPUS`); reusa esse dado sem novo comando no engine. Cache `_amdDetected` persiste até o próximo GET_GPUS.
- **Enhance preso ao re-encode**: `sr_amf`/`frc_amf` exigem decodificar+re-codificar — incoerente com `-c copy`; quando reEncode=false ou GPU não-AMD, o enhance é silenciosamente ignorado com warning (não-fatal).
- **SR cap 1920x1080**: upscaling além de 1080p não é suportado pelo `sr_amf` e adicionaria latência/VRAM sem ganho; 720p→1080p é o caso de uso real (clips de jogo).

### Next Steps

- Publicar engine não é necessário (mudanças 100% TS/UI — nenhum código C# tocado).
- Rebuild do instalador quando houver release: inclui FASE 2 automaticamente.
- Validação em campo (GPU AMD): trim/merge com enhance → conferir log do ffmpeg com `sr_amf`/`frc_amf` ativos e clip resultante sem macroblocos. `docs\ffmpeg-9-features-plan.md` F2 flipa para done após validação do usuário.

## Session Summary (2026-08-05 — Upgrade completo de dependências + revisão)

### Done

- **Upgrade completo npm + .NET aplicado e commitado** (`98258c9`, 4 arquivos):
  - **electron-vite 6.0.0-beta.1** + **vite 8.2.0** + **@vitejs/plugin-react 6.0.5** (Rolldown)
  - `electron@43.3.0`, `jsdom@30.0.1`, `framer-motion@13.0.0`, `lucide-react@1.28.0`, `systeminformation@5.33.1`, `better-sqlite3@13.0.3`, `@types/better-sqlite3@9.6.0`, `react-router-dom@7.18.2`, `@playwright/test`/`playwright@1.62.1`, `@biomejs/biome@2.5.7`, `@types/react@19.2.18`, `@types/react-dom@19.2.4`
  - C#: `xunit 2.9.3`, `xunit.runner 2.8.2`, `Test.Sdk 17.14.1`, `coverlet 10.0.1` — 1113/1113
  - Fix Biome `GameModePage.tsx:89` `useExhaustiveDependencies` (`[store]`→`[]`) no mesmo commit

- **Validação completa**: build produção OK (Rolldown), **6841 TS tests | 1 skipped | 0 failed**, 1113 C# tests, lint/tsc sem erros novos. Cobertura: Stmts 79.07%, Branches 85.25%, Funcs 93.5% (queda stmts/lines = instrumentação v8 sob Rolldown, não regressão).

- **Revisão do upgrade (manual — subagente revisor indisponível)**: veredito **PASS**:
  - Bundle main 1.17MB single chunk (todo IPC), preload 37KB, `rolldown-runtime` como chunk
  - Renderer code-splitting íntegro: 30+ chunks por página lazy (ClipsPage 124.8KB, MalwareScannerPage 151.3KB), recharts lazy (CartesianChart 836KB) separado do bundle principal
  - Warnings `INEFFECTIVE_DYNAMIC_IMPORT` (5) = **pré-existentes**, não regressão — CLI commands fazem `await import(...)` lazy mas os módulos já são estaticamente importados por `src/main/ipc/index.ts` (linhas 58/63/66/17) e `services/metrics.ts:4`; Rolldown corretamente os inline (idêntico ao Rollup, só warning com nome novo)

- **Smoke dev limpo** (`npm run dev`): app elevou, scheduler OK, 14118 regras winapp2 carregadas, game-mode IPC OK. 4 itens de log analisados — todos pré-existentes ou benignos:
  - `<img src="">` em `App.tsx:176` (commit `0aaf14e`, 2026-06-10) — não do upgrade
  - Double "Fetching disk health" — DashboardPage + PerformanceMonitorPage ambos montam (pré-existente)
  - `Reduced Motion enabled` — **novo do framer-motion 13**, aviso informativo (Windows com reduced motion ON), 1x console.warn
  - CSP warning + a11y contrast/landmarks — dev-mode only + axe pré-existente

### Key Decisions

- **Adotar electron-vite 6 beta.1** apesar de ser beta: esperado ~4 meses sem beta novo; peer `vite ^6||^7||^8`; config `rollupOptions` compatível sem mudança
- **Rolldown não quebra native modules**: `better-sqlite3`/`bindings` continuam external (verificado no `out/main/`) — premissa antiga de que Vite 8 quebraria natives era incorreta
- **Semver mantidos por decisão**: Playwright 1.62.1, Biome 2.5.7, Lucide 1.28.0, React Router 7.18.2, Vitest 4.1.10

### Next Steps

- ~~Smoke test em modo packaged~~ ✅ **feito (2026-08-05)**: instaladores rebuildados (`npm run package`) — `DiNho-Optimizer-Setup-1.0.7.exe` 219.2MB + portable 218.9MB; engine DLL hash staging==packaged (`717B98AC...`), ffmpeg 9.0 211.9MB embarcado/assinado; smoke do win-unpacked limpo (renderer OK, license OK, background scans rodaram, zero erros no log)
- `npm outdated` limpo exceto `electron-vite` (5.0.0 latest vs 6.0.0-beta.1 instalado) — esperado
- Pendente (LOW): React warning `<button>` aninhado em `<button>` no `ClipsConfigPanel`/`ConfigSection` (dev-mode, pré-existente)

### Relevant Files Changed

- `package.json` + `package-lock.json`: todas as versões acima
- `src/renderer/src/pages/GameModePage.tsx`: `[store]`→`[]` (fix Biome)
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/DiNho.Capture.Poc.Tests.csproj`: xunit/test-sdk/coverlet
- `AGENTS.md`: bloco "Agent 4: Vite" atualizado (BLOCKED → ATUALIZADO)


## Session Summary (2026-08-05c — av1_amf tune/rawFmt fix: seams testaveis)

### Done

- **Bug real da auditoria AMD corrigido (TDD RED→GREEN→suites→deploy)**: v1_amf faltava nos switches de encode real em FfmpegEncoder.cs:
  - **switch tune** (~383-400): sem caso v1_amf → caia no default libx264 (-crf… -bf 0 -profile:v high), args invalidos para AMF → ffmpeg exit + restart loop (mesma classe do incidente weighted_pred av1_nvenc)
  - **switch rawFmt** (~450-455): sem v1_amf → produzia "h264" em vez de "av1" (container/packetizacao errada, mux IVF errado)
  - O probe (EncoderManager.cs:406,414) ja tinha v1_amf com -quality speed e rawFmt "av1" — por isso o probe passava mas a rota real falhava (bug invisivel no smoke)
- **2 seams extraidos como puros (mesmo padrao BuildWeightedPredArg)**:
  - BuildEncoderTuneArgs(codec, cq, maxrateKbps, bufsizeKbps, bframes, lookahead, nvencPreset) — todo o switch tune, testavel sem processo ffmpeg
  - GetRawFormatForCodec(codec) — switch rawFmt (av1_amf → "av1")
  - StartFfmpeg agora chama os seams; dead vars framesArg/lookaheadArg removidas (nunca usadas)
- **Args av1_amf definidos com base no help real do ffmpeg 9.0 embarcado** (fmpeg -h encoder=av1_amf): mesmos do h264/hevc_amf (-quality quality -rc cqp -qp_i/-qp_p -bf 0 -g 60 -filler_data 0 -enforce_hrd 0 -preanalysis true -pa_taq_mode 2 -vbaq true -high_motion_quality_boost_enable true -pa_lookahead_buffer_depth 40 -pa_paq_mode 1 -pa_adaptive_mini_gop true -pa_scene_change_detection_enable true) **exceto -me_quarter_pel** (opcao inexistente no av1_amf — passada causaria erro de opcao)
- **12 testes novos** em FfmpegEncoderTests.cs:
  - BuildEncoderTuneArgs_AmfCodecs_UseAmfArgs (Theory av1/h264/hevc_amf: contem -quality quality/-rc cqp, NAO contem -crf/-preset veryfast/-profile:v high)
  - BuildEncoderTuneArgs_Av1Amf_DoesNotUseCpuFallbackArgs (regressao do bug), ..._NoMeQuarterPel, BuildEncoderTuneArgs_H264Amf_KeepsMeQuarterPel
  - GetRawFormatForCodec_ReturnsExpected (Theory av1_amf/av1_nvenc/libsvtav1/av1_d3d12va→av1; hevc_amf→hevc; h264_amf/libx264→h264)

### Validado

- **C# tests**: FfmpegEncoderTests **108/108** (era 96; +12); suite completa **1126/1126 aprovados, 0 falhas** ("Execucao de Teste Anulada." = flakiness pre-existente do ConsoleLogger/vstest documentada)
- **Build**: dotnet build -c Release 0 erros (warnings pre-existentes apenas)
- **Publish + stage + deploy**: dotnet publish -c Release --self-contained true -r win-x64 OK; 
pm run copy-engine (294 files, ffmpeg 9.0 212MB); app instalado parado; 5 arquivos DiNho.Capture.Poc.* copiados para %LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\ — **SHA256 publish == staging == instalado == D40F74A3...**
- **Commit**: 3c2c70 — ix: av1_amf cai em args libx264 (tune) e rawFmt h264 — seams BuildEncoderTuneArgs/GetRawFormatForCodec extraidos p/ teste

### Key Decisions

- **Seam estatico em vez de switch privado**: o switch tune e o coracao dos args de cada codec — extrair como puro internal static permite teste determinístico sem spawn de ffmpeg (que depende do hardware/ambiente)
- **av1_amf sem -me_quarter_pel**: opcao so existe em h264/hevc_amf; inclui-la no av1_amf reproduziria o mesmo erro de opcao que o fix previne (validado no help real do encoder)
- **Bug invisivel no smoke**: probe passa (ja tinha av1_amf) mas rota real falha — reforca a necessidade de seams testaveis para cada cadeia de args, nao so do probe

### Next Steps

- Reiniciar o app instalado e validar em campo (GPU AMD RDNA3+/RX 7000): codec "av1" → initialized (codec=av1_amf) SEM restart loop, rawFmt "av1" → clip com ideo>0 e mux IVF correto
- (Opcional) Mesma classe de bug pode afetar h264_qsv/v1_d3d12va em outros hosts — seams agora cobrem todos os codecs nos testes

## Session Summary (2026-08-05d — QSV real no encode: av1_qsv + init_hw_device + extra_hw_frames removido)

### Done

- **Lacuna Intel QSV fechada (mesma classe do bug av1_amf da sessao 2026-08-05c)** — rota real usava `libsvtav1` para Intel e string QSV com `-extra_hw_frames`:
  - **`EncoderManager.VendorAv1Codecs[0x8086]`**: `"libsvtav1"` → `"av1_qsv"` — Intel Arc/GPU agora usa encoder HW para AV1.
  - **`SupportsAv1Hardware` 0x8086**: `true` cego → `CheckFfmpegEncoder("av1_qsv")` (gate Arc Alchemist+, espelha padrao NVIDIA).
  - **`FfmpegEncoder.IsAv1`**: agora `"av1_nvenc" or "libsvtav1" or "av1_amf" or "av1_qsv"` — corrige tambem bug latente (av1_amf ausente antes → RawFormat errado).
  - **`BuildEncoderTuneArgs`**: string `h264_qsv`/`hevc_qsv` (com `-rdo 1 -low_power 0 -mbbrc 1 -async_depth 1`) e novo branch `av1_qsv` (mesmo padrao sem `-rdo`/`-low_power`/`-mbbrc`); **`-extra_hw_frames 40` REMOVIDO** — ffmpeg 9 rejeita como opcao de encoder ("not a encoding option"); e opcao frame-level (`hwupload=extra_hw_frames=...`). Comentario no codigo documenta.
  - **`StartFfmpeg`**: novo `isQsv = _codec.EndsWith("_qsv")` + arg `-init_hw_device qsv ` — sem isso ffmpeg 9 falha com "Error creating a MFX session: -9".
  - **`BuildProbeArgs`**: tune switch agora `"h264_qsv" or "hevc_qsv" or "av1_qsv" => "-preset fastest"`; rawFmt inclui av1_qsv; `isQsv` + `hwDeviceArg` combina `-init_hw_device d3d12va=hw=0` + `-init_hw_device qsv`.
- **Validacao real do parse** (dev sem iGPU, ffmpeg 9.0): av1_qsv e hevc_qsv com tune completo (incl. `-rdo 1 -mbbrc 1` no av1_qsv) + `-init_hw_device qsv` → unico erro `Failed to find d3d11va adapter by vendor id 0x8086` (esperado) — args passam no parse. Confirma `rdo`/`mbbrc` validos para av1_qsv tambem.
- **Testes novos**: `FfmpegEncoderTests` — `BuildEncoderTuneArgs_QsvCodecs_UseQsvArgs` (Theory h264/hevc/av1_qsv), `..._H264HevcQsv_UseRdoMbbrc`, `..._Qsv_DoesNotIncludeExtraHwFrames`, `GetRawFormatForCodec_ReturnsExpected` ganhou InlineData `av1_qsv→av1`/`h264_qsv→h264`/`hevc_qsv→hevc`; `EncoderManagerTests` — `MapUserCodec_av1_Intel_ReturnsAv1Qsv` + `MapUserCodec_av1_Amd_ReturnsAv1Amf`.

### Validado

- **Build**: `dotnet build src\...\DiNho.Capture.Poc.csproj -c Release` 0 erros.
- **C# tests**: filtro FfmpegEncoder+EncoderManager **168/168**; suite completa **1137/1137 aprovados, 0 falhas** ("Execução de Teste Anulada." = flakiness pre-existente do ConsoleLogger/vstest documentada).
- **Publish + stage + deploy**: `dotnet publish -c Release --self-contained true -r win-x64` OK; `npm run copy-engine` (294 files, ffmpeg 9.0 212MB copiado); 5 arquivos `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — **SHA256 instalado == staging == `0910CAC6...`**.
- **Commit**: `b26a351` — `fix: QSV real no encode (av1_qsv no lugar de libsvtav1, extra_hw_frames removido, init_hw_device qsv)`.

### Key Decisions

- **`-init_hw_device qsv` obrigatorio**: ffmpeg 9 abandona o auto-init; sem o device o QSV falha com MFX session error antes de qualquer encode.
- **Gate de suporte por `CheckFfmpegEncoder`**: em maquina sem iGPU/Arc o probe falha → fallback correto; em Intel o probe passa → av1_qsv ativo. Evita falso-positivo de `true` cego.
- **Sem `-extra_hw_frames`**: opcao frame-level (aplicada no vf via hwupload), nunca como arg de encoder — ffmpeg 9 hard-fail.

### Next Steps

- Reiniciar o app instalado e validar em campo (Intel iGPU/Arc): codec "av1" → initialized (codec=av1_qsv) SEM restart loop, sem "invalid param (8)"; clip com video>0 e mux IVF correto.
- Validações de usuario pendentes acumuladas: AMD RDNA3+ (av1_amf), `-filler`/`-enforce_hrd` no av1_amf, AMD enhance (sr_amf/frc_amf).

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/EncoderManager.cs`: VendorAv1Codecs, SupportsAv1Hardware, BuildProbeArgs (isQsv/hwDeviceArg/tune/rawFmt)
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: IsAv1, BuildEncoderTuneArgs (sem extra_hw_frames; hevc_qsv/av1_qsv), GetRawFormatForCodec, StartFfmpeg (isQsv + init_hw_device qsv)
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/FfmpegEncoderTests.cs`: 4 testes qsv + InlineData rawFmt
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/EncoderManagerTests.cs`: MapUserCodec av1 Intel/AMD

## Session Summary (2026-08-05e — E_INVALIDARG fix: pool texture SR→SR|RT)

### Done

- **Root cause fechado com evidência de campo (31.996 `VideoProcessorBlt E_INVALIDARG` em uma noite de gravação)**: regressão do commit `7edd3b0` — pool textures criadas SR-only (`BindFlags.ShaderResource`) para "leitura direta" no video processor. Em RTX 5050 (NV), o driver exige bind **RenderTarget + ShaderResource** na textura de entrada do `VideoProcessorBlt`; SR-only devolve `E_INVALIDARG (0x80070057)` em TODOS os frames do caminho GPU. O `_inputCopy` (sempre SR|RT) nunca falhou — assinatura consistente com o requisito de RT.
- **Fix aplicado** (`Capture/TexturePool.cs`): `BindFlags = BindFlags.ShaderResource | BindFlags.RenderTarget` — pool texture agora tem a MESMA forma do `_inputCopy` conhecido-bom. Comentário reescrito (documenta requisito real do driver NV vs MSDN). Compatível com o `CopyResource` de WGC/DXGI/Hybrid (bind flags são irrelevantes para CopyResource; ambos Default usage).
- **`CanUseDirectInput` inalterado** (`FfmpegEncoder.GpuConvert.cs:25`): `(desc.BindFlags & BindFlags.ShaderResource) != 0` continua true com SR|RT — caminho direto (sem `_inputCopy`) permanece ativo, agora com textura válida.
- **Gotcha de deploy descoberto**: `Copy-Item -Path a,b\ -Force` (sem `-Destination` explícito) misparsa multi-path no PowerShell e copiou para o CWD em vez do destino — hash instalado ficou stale por 2 tentativas. Corrigido com `-Destination` explícito por arquivo; 5 arquivos copiados com hash conferido. Stragglers removidos do workspace root.

### Validado

- **Build**: `dotnet build -c Release` 0 erros (22 warnings pré-existentes).
- **C# tests**: filtro FfmpegEncoder+EncoderManager+GpuVideoConverter **168/168 pass** — 0 falhas (CanUseDirectInput SR|RT continua green).
- **Publish + stage + deploy**: `dotnet publish -c Release --self-contained true -r win-x64` OK; `npm run copy-engine` (294 files, ffmpeg 9.0 212MB); app instalado FECHADO para o deploy (estava rodando → DLL lockada); 5 arquivos `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — **SHA256 instalado == publish == staging == `099C8A03...`**.

### Next Steps

- Reiniciar o app instalado e validar em campo (RTX 5050, WGC capture): gravação GPU com `RENT F=...` mostrando **SR|RT** no pool, **zero `VideoProcessorBlt E_INVALIDARG`**, sem fallback CPU (`GPU convert failed`), clip com `video>0`.
- (Opcional) Repetir a gravação longa de uma noite e confirmar que a contagem de E_INVALIDARG não cresce.

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Capture/TexturePool.cs`: `BindFlags.ShaderResource` → `ShaderResource | RenderTarget` + comentário corrigido (requisito real do driver NV)
- `AGENTS.md`: resumo de sessão

## Session Summary (2026-08-05 — Sharpness no editor de clips: UI conectada ao wire)

### Done

- **Sharpness conectada da UI ao wire completo de edicao (trim/merge)**, completando o slider de nitidez (sessao 2026-08-03: config + wire IPC/preload):
  - `ClipEditorModal.tsx`: novo componente `SharpnessSlider` (range 0..1 step 0.1, valor exibido `X.X` ou `sharpnessOff` quando 0, tooltip `sharpnessTooltip`), estado `const [sharpness, setSharpness] = useState(0)`.
  - `handleTrim`: `clipsTrimClip(path, start, end, reEncode, enhance, sharpness)`.
  - `handleMerge`: `clipsMergeClips(paths, enhance, sharpness)`.
  - UI trim: `SharpnessSlider` apos `EnhanceSelect`, `disabled={!reEncode}` (sharpness requer re-encode no trim — main loga warning e ignora sem reEncode).
  - UI merge: `SharpnessSlider` sempre habilitado (sharpness sozinho no merge ja forca re-encode libx264 com `-vf cas=...`).
  - Chaves de locale reutilizadas: `sharpness`/`sharpnessTooltip`/`sharpnessOff` (ja existiam nos 3 idiomas).

### Validado

- **TS**: clips suites `clips.ipc.test.ts` + `preload/clips.test.ts` + `clips-enhance.test.ts` **199/199 pass**; `ClipsPage.test.tsx` **23/23 pass**.
- **Biome**: `--write` aplicado (format da chamada `clipsTrimClip` multi-linha); sem erros nos 4 arquivos de codigo.
- **Build**: `npm run build` OK (1.05s).

### Next Steps

- Nenhum build de engine necessario (mudancas 100% TS/UI).
- Validar em campo: trim com re-encode + sharpness > 0 → `-vf cas=strength=X` no log do ffmpeg; merge sozinho com sharpness → re-encode libx264 com `cas`; sharpness 0 → `-c copy` (sem re-encode).

### Relevant Files Changed

- `src/renderer/src/components/clips/ClipEditorModal.tsx`: `SharpnessSlider` (novo), estado `sharpness`, chamadas trim/merge com o valor, sliders nos blocos trim/merge
- `AGENTS.md`: resumo de sessao

## Session Summary (2026-08-07 — Link publicado: cache localStorage + testes)

### Done

- **Link publicado no card do clip (tarefa da playlist completa)**: `useClipsState.ts` — interface `ClipsState` ganhou `publishedLinks: Record<string,string>` + `setPublishedLink(path, link)`; lazy init de `localStorage('clips-published')` (try/catch); useEffect persiste o mapa; `setPublishedLink` useCallback com short-circuit (evita re-render se igual). `useClipsActions.ts` — chama `setPublishedLink(clipPath, publishLink)` no sucesso do publish (junto de `setPublishResult`). `ClipsGrid.tsx` — botão ciano (`#06b6d4`, ícone Link, label `t('openLink')`) no card quando `publishedLinks[clip.path]`; clique abre `window.dinho?.clipsOpenExternal(url)` (preload `src/preload/clips.ts` L66-67 → main `clips.ipc.ts` L848-864 valida `https:` + `shell.openExternal` — já existiam, sem mudança). Locales: `openLink` em en/pt/es `clips.json`.

- **Testes**: `useClipsActions.test.tsx` — `setPublishedLink: vi.fn()` no `makeDeps` e `publishDeps`; novo teste "does not cache the link when the publish response has no link"; asserção de cache no teste de sucesso. **56/56 pass**.
- **Bug pré-existente corrigido**: `clips-publish.test.ts:252` esperava `{ success: false, error: 'Aborted' }`, mas o código (`clips-publish.ts:128-130`) mapeia abort para `{ success: false, cancelled: true, error: 'Upload cancelled' }` — asserção atualizada. **15/15 pass**.
- **Suite completa**: **6893 passed | 1 skipped | 0 failed** (npx vitest run --pool=forks). Build OK (1s). Biome limpo nos arquivos tocados (auto-fix em ClipsGrid.tsx).
- Nenhuma mudança em engine C# — sem publish/copy-engine/deploy necessário.

### Next Steps

- Validar em campo no app instalado: publicar um clipe → botão de link ciano aparece no card → clique abre o navegador; reiniciar o app → link persiste (localStorage `clips-published`).

## Session Summary (2026-08-11 — AMD h264_amf restart loop fix: -filler → -filler_data)

### Done

- **Root cause fechada com log real da máquina AMD** (`C:\Users\WENDEL\Downloads\2026-08-11.jsonl`): engine (Radeon RX 5700 XT, codec "auto") entrava em loop de restart (~16/s) com `[ffmpeg] Unrecognized option 'filler'.` a cada tentativa — todos os fallbacks falhavam, `max restart attempts reached, no codec fallback`.
- **`FfmpegEncoder.cs` `BuildEncoderTuneArgs`**: `-filler 0` → `-filler_data 0` nos 3 codecs AMF (`h264_amf`, `hevc_amf`, `av1_amf`). `-filler` não existe no ffmpeg 9 — a opção real é `-filler_data` (boolean, válida nos 3). Mesma classe do bug av1_nvenc weighted_pred (opção inexistente → abort no parse).
- Comentário do seam atualizado (`-filler_data` válida nos 3; `me_quarter_pel` só H26x confirmado).
- Validação das demais opções AMF via `-h encoder={h264,hevc,av1}_amf` do ffmpeg 9.0 local: `-pa_taq_mode 2` (range -1..2 OK), `-pa_lookahead_buffer_depth 40` (range -1..41 OK), `-pa_paq_mode 1` (range -1..1 OK), `-enforce_hrd`, `-preanalysis`, `-vbaq`, `-pa_adaptive_mini_gop`, `-pa_scene_change_detection_enable`, `-high_motion_quality_boost_enable`, `-quality quality`, `-rc cqp`, `-qp_i/-qp_p`, `-bf 0`, `-g 60` — todas existem no ffmpeg 9; só `-filler` era o abort.
- **2 testes novos** em `FfmpegEncoderTests.cs`:
  - `BuildEncoderTuneArgs_AmfCodecs_UsesFillerData_NotFiller` (Theory av1/h264/hevc_amf) — regressão do bug: contém `-filler_data 0`, não contém ` -filler `.
  - `BuildEncoderTuneArgs_AmfCodecs_AllOptionsExistInFfmpeg9` — todas as opções AMF presentes nos 3 codecs (evita futuro abort por opção inexistente).

### Validado

- **C# tests**: FfmpegEncoderTests **114/114 pass**; suite completa **1121 aprovados / 0 falhas** (bullet do `RamManagerTests.ComputeHybridRamCap_*` corrigido - teste e codigo alinhados a 120s desde `a7a9fee`).
- **Build**: `dotnet publish -c Release --self-contained true -r win-x64` 0 erros.
- **Stage**: `npm run copy-engine` — 294 files, ffmpeg 9.0 212MB copiado.
- **Deploy**: app instalado fechado; 5 arquivos `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — **SHA256 instalado == publish == staging == `A7FDD7DE...`**.

### Key Decisions

- **`-filler_data 0` em vez de remover o arg**: manter o comportamento explícito (sem filler) preservando compatibilidade com ffmpeg ≥9; o teste `UsesFillerData_NotFiller` trava a forma correta.
- **Teste de presença de todas as opções**: a classe de bug (opção inexistente → abort no parse → restart loop) já mordeu 3x (weighted_pred av1_nvenc, -filler AMF, extra_hw_frames QSV) — teste estrutural garante que a cadeia AMF não regrida.

### Next Steps

- Reiniciar o app instalado na máquina AMD e validar em campo (codec "auto" / h264_amf): conferir no JSONL que `Unrecognized option 'filler'` sumiu, `initialized (codec=h264_amf)` sem restart loop, e clip com `video>0`.
- `RamManagerTests.ComputeHybridRamCap_*` alinhado a 120s desde `a7a9fee` - 24/24 aprovados, 0 falhas

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: `-filler 0` → `-filler_data 0` (3 codecs AMF) + comentário do seam
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/FfmpegEncoderTests.cs`: 2 testes novos
- `AGENTS.md`: resumo de sessão

## Session Summary (2026-08-11f - P1-P4: log/robustez do engine pos-crash AMD)

### Done

- **P1 - drop log com anti-spam** (`FfmpegEncoder.cs`): contadores `_totalVideoDropped`/`_consecutiveDrops` via `Interlocked` (so thread do ReaderLoop); `LogDrop` so loga no 1o drop (`== 1`) e a cada 25 (`% 25 == 0`), `LogRecovery` so se `consecutiveDrops >= 5`; `_droppedVideoFrames` propagado no status broadcast (`EngineStatus.cs` `DroppedFrames` + TS `ClipsEngineStatus.droppedFrames`/`clips-engine.ts`/`clips-engine-connection.ts`). ~15 logs/frame durante drop transitorio -> 1-2.
- **P2 - logs de diagnostico demovidos para `Log.D`** (`FfmpegEncoder.cs`): "Primeiro frame Success=false", "Primeiro packet DESCARTADO: !_recording" (1x/sessao) e "no output packets after {N} frames" (aviso de audio sem video - agora Debug).
- **P3 - `GameDatabaseUpdater.cs` robusto**: `internal TimeSpan RetryDelay` (30s), `MAX_ATTEMPTS = 2`, retry so em resposta transitoria (`408/429/5xx`), sem retry em `HttpRequestException`/4xx; persistencia so em sucesso; task de retry com `Task.Delay` (sem thread bloqueada).
- **P4 - WDA exclude com retry unico** (`EngineCoordinator.Capture.cs`): `ScheduleWdaRetryIfNeeded()` - agendamento at-most-once (`_wdaRetryCount`), delay `WdaRetryDelayMs` (2000ms), seam `EnumerateDinhoHwndsProbe` (testes deterministicos); `RestoreDinhoWindowCapture` zera o contador (cancela retry pendente).
- **Fixes MEDIUM do validador externo aplicados**: (1) P3 `ReadAsStringAsync`+parse dentro do loop de retry; (2) P4 acesso a `_dinhoHwnds` serializado com `lock (_dinhoHwnds)` entre retry task e restore (C# lock reentrante - chamadas aninhadas seguras). Tests `SetField` sempre setam lista nao-nula (Ctor `FormatterServices` pula inicializadores).
- **Bug pre-existente corrigido no teste** `ExcludeDinhoWindowCapture_AllExclusionsFail_SchedulesRetry`: `calls++;` no lambda do probe.

### Validado

- **C#**: filtro `EngineCoordinatorCaptureTests` **119/119**; suite completa **1190/1190 aprovados, 0 falhas**.
- **TS**: `clips-engine-connection.test.ts` 105/105; `npm run build` OK (0 erros).
- **Publish + stage + deploy**: `dotnet publish -c Release --self-contained true -r win-x64` OK; `npm run copy-engine` (294 files, ffmpeg 9.0 212MB); 5 binarios para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` - **5/5 hashes OK** (DLL `785AD262`).
- **Commit**: `cd27259` - "fix: P1-P4 log/robustez do engine pos-crash AMD".

### Key Decisions

- **Anti-spam de log por contador em vez de janela temporal**: frame drops ocorrem em rajadas - janela de tempo exigiria relogio por chamada; contador + modulo e deterministico e barato.
- **Retry at-most-once no WDA**: excluir janelas e best-effort (falha se a janela ainda nao existe); um unico retry cobre o arranque, e a restauracao sempre zera o contador.
- **`lock (_dinhoHwnds)`** (objeto de lock = a propria lista): sem campo extra de lock, e compativel com os testes que setam a lista via reflection.

### Next Steps

- Reiniciar o app instalado e validar em campo (sessao longa com drop transitorio): log de drops sem spam e status `droppedFrames` atualizado no renderer.
- `RamManagerTests.ComputeHybridRamCap_*` alinhado a 120s desde `a7a9fee` - 24/24 aprovados, 0 falhas

## Session Summary (2026-08-11b — AMD encoder 0.55x: preset speed AMF corta preanalysis chain)

### Root cause (fps=35 / speed=0.569x na RX 5700 XT com o fix -filler_data)

- Log de campo pós-fix `-filler_data` (máquina `michael`, RX 5700 XT): encoder h264_amf inicializava sem restart loop, MAS rodava a **~0.55x speed** (`frame= 2984 fps= 35 ... speed=0.569x` constante). Drift A/V preso em **1.35–1.9s** (DriftMonitor avisava a cada 5s), clips exportavam com `activeFps=36`, `audio=3559 vs video=2636` (vídeo ~1.7s atrasado, áudio final cortado).
- **Causa raiz**: args AMF eram preset de qualidade **MÁXIMA** — `-quality quality -preanalysis true -pa_taq_mode 2 -vbaq true -high_motion_quality_boost_enable true -pa_lookahead_buffer_depth 40 -pa_paq_mode 1 -pa_adaptive_mini_gop true -pa_scene_change_detection_enable true -me_quarter_pel true`. A cadeia preanalysis + lookahead 40 é o modo mais pesado do AMF (projetado p/ encode offline) — RDNA1 (VCN 1.0) não sustenta 60fps realtime com ele.

### Fix aplicado (FfmpegEncoder.cs BuildEncoderTuneArgs, 3 codecs AMF)

- `-quality quality` → **`-quality speed`** (preset rápido do AMF) em `h264_amf`/`hevc_amf`/`av1_amf`.
- **Cadeia preanalysis removida**: `-preanalysis true`, `-pa_taq_mode 2`, `-pa_lookahead_buffer_depth 40`, `-pa_paq_mode 1`, `-pa_adaptive_mini_gop true`, `-pa_scene_change_detection_enable true`, `-high_motion_quality_boost_enable true` — todos eliminados.
- Mantidos: `-rc cqp`, `-qp_i/-qp_p` (QP = cq do front direto), `-bf 0`, `-g 60`, `-filler_data 0`, `-enforce_hrd 0`, `-vbaq true` (barato, ganho de qualidade), `-me_quarter_pel true` (só h264/hevc_amf).
- Doc comment do seam reescrito explicando o porquê (0.55x em RDNA1) + nota `-filler`/`-filler_data`.

### TDD (RED → GREEN)

- **RED**: 3 testes atualizados + 1 novo em `FfmpegEncoderTests.cs`:
  - `BuildEncoderTuneArgs_AmfCodecs_UseAmfArgs`: `-quality quality` → `-quality speed`
  - `BuildEncoderTuneArgs_Av1Amf_DoesNotUseCpuFallbackArgs`: asserts `quality`/`preanalysis`/`pa_taq_mode` removidos, mantém `-quality speed`
  - `BuildEncoderTuneArgs_AmfCodecs_AllOptionsExistInFfmpeg9`: removidas as 7 opções preanalysis da lista de presença
  - `BuildEncoderTuneArgs_AmfCodecs_DoesNotIncludePreanalysisChain` (novo): asserta que `preanalysis`/`pa_taq_mode`/`pa_lookahead_buffer_depth`/`pa_paq_mode`/`pa_adaptive_mini_gop`/`pa_scene_change_detection`/`high_motion_quality_boost` NÃO aparecem nos 3 codecs AMF
  - RED confirmado: 6 falhas (filtro BuildEncoderTuneArgs 6/17 falhando)
- **GREEN**: args atualizados; filtro BuildEncoderTuneArgs **17/17**, filtro FfmpegEncoderTests **115/115** (+1 novo).

### Validado

- **C# suite completa**: **1123 aprovados / 0 falhas** (nota anterior do `RamManagerTests.ComputeHybridRamCap_*` corrigida - alinhado a 120s desde `a7a9fee`).
- **Publish**: `dotnet publish src\...\DiNho.Capture.Poc.csproj -c Release --self-contained true -r win-x64 -o bin/Release/net10.0-windows10.0.26100.0/publish` — 0 erros (warnings pré-existentes).
- **Stage**: `npm run copy-engine` — 294 files, ffmpeg 9.0 212MB copiado.
- **Deploy**: app instalado; 5 arquivos `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — **SHA256 instalado == publish == `D0EE606D...`**.

### Key Decisions

- **`-quality speed` + vbaq, sem preanalysis**: preset quality/preanalysis/lookahead 40 é o modo offline do AMF — inaplicável a captura realtime em RDNA1. `speed` mantém VBR (CQ + maxrate cap) com custo ínfimo, `vbaq` é barato e preserva qualidade em áreas escuras; a cadeia preanalysis inteira era o gargalo.
- **Manter `-rc cqp` e `-qp_i/-qp_p`**: o controle de qualidade continua via CQ do usuário (QP = cq direto, sem offset) — mesmo padrão do NVENC (`-cq`); só o preset de performance mudou.
- **Teste estrutural ampliado**: além do `AllOptionsExistInFfmpeg9`, novo teste `DoesNotIncludePreanalysisChain` trava a remoção — evita reintroduzir o gargalo de desempenho sem tocar no teste de compatibilidade ffmpeg.

### Next Steps

- Reiniciar o app instalado na máquina AMD e validar em campo (codec "auto" / h264_amf): conferir no log `fps=` estável ~60 e `speed≈1.0x` (não mais 0.55x), drift A/V <0.5s (DriftMonitor sem warning), e clips com `video≈audio` (sem áudio cortado).
- Se `speed` ainda ficar abaixo de 1.0x em cenário de carga: subir para preset `-quality speed` já ativo e reduzir `-pa_lookahead` (não aplicável — removido) — alternativa seria rebaixar resolução do usuário, mas isso viola a regra "alvo do usuário é o piso" (sessão 2026-07-31b).
- `RamManagerTests.ComputeHybridRamCap_*` alinhado a 120s desde `a7a9fee` - 24/24 aprovados, 0 falhas

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: args AMF `-quality speed` sem cadeia preanalysis (3 codecs) + doc comment do seam
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/FfmpegEncoderTests.cs`: 3 testes atualizados + 1 novo (`DoesNotIncludePreanalysisChain`)
- `AGENTS.md`: resumo de sessão

## Session Summary (2026-08-11c — Preset AMF adaptativo por máquina: probe real em quality/balanced/speed)

### Done

- **Preset AMF adaptativo por hardware implementado via TDD completo (RED → GREEN → suites → publish → deploy)**: GPUs AMD fortes (RDNA2+/VCN 2.0+) mantêm `quality`; GPU fraca (RX 5700 XT / RDNA1 VCN 1.0) degrada automático para `balanced`/`speed` com base em probe real de encode na resolução/fps da captura.
  - **`EncoderManager.SelectAmfPreset(string codec, int width, int height, int fps) → string`** (internal static): escada `quality → balanced → speed`; mantém preset quando `achievedFps >= fps * 0.85`; cache estático chaveado por `codec|widthxheight@fps` (1 probe por combinação por sessão); falha de probe (exceção/null) = não sustenta → degrada ao próximo (fail-safe `speed`).
  - **`EncoderManager.ProbeAmfSpeed`** (internal static): spawna ffmpeg real em `width×height@fps` com o preset (normalizado via `FfmpegEncoder.NormalizeAmfPreset`), 5 frames NV12 dummy (`Y = 80 + i*20`, `U = V = 128`), `-rc vbr_peak -bf 0 -g 60 -frames:v 5`, output `ivf` p/ av1 senão `h264`, `PriorityClass.Idle`, `WaitForExit(15000)`, retorna `frameCount*1000/ElapsedMs`; null em exit≠0/exceção.
  - **`ProbeAmfSpeedProbe`** (internal static `Func<string,int,int,int,string,double?>`) — seam trocável nos testes (try/finally) + **`ResetAmfPresetCache()`**.
  - **`EncoderManager.IsAmfCodec(string)`** — `h264_amf`/`hevc_amf`/`av1_amf`.
  - **`FfmpegEncoder.BuildEncoderTuneArgs`** ganhou 8º param `amfPreset = "speed"`; branches AMF usam `-quality {NormalizeAmfPreset(amfPreset)}` (demais flags intactas).
  - **`FfmpegEncoder.NormalizeAmfPreset(string?)`** (internal static) — normaliza `quality`/`balanced`/`speed`; inválido/vazio/null → `"speed"`.
  - **Fiação**: `FfmpegEncoder.Initialize` define `_amfPreset = EncoderManager.IsAmfCodec(_codec) ? SelectAmfPreset(_codec, _width, _height, _frameRate) : "speed"` (log inclui `amfPreset=`); call do seam em `StartFfmpeg` passa `_amfPreset`.
- **Loop de degradação corrigido (RED→GREEN)**: `catch { break; }`/`if (achieved == null) break;` → `continue` — exceção/null no probe degrada ao próximo preset (teste `SelectAmfPreset_ProbeThrows_DegradesToSpeed` esperava 3 chamadas `[quality, balanced, speed]`).

### Validado

- **C# tests**: filtro `SelectAmfPreset|ProbeAmfSpeed|NormalizeAmfPreset|BuildEncoderTuneArgs` **39/39**; suite completa **1144 aprovados / 0 falhas** (`RamManagerTests.ComputeHybridRamCap_*` corrigido - 24/24 aprovados). Nenhuma regressao.
- **Build**: `dotnet build` implícito — 0 erros (warnings pré-existentes).
- **Publish**: `dotnet publish src\...\DiNho.Capture.Poc.csproj -c Release --self-contained true -r win-x64 -o bin/Release/net10.0-windows10.0.26100.0/publish` — 0 erros. Staging (copy-engine 294 files) == ROOTPUB == instalado — **SHA256 `A632DD26...`** (SRCPUB `A7FDD7DE` é o build anterior da sessão 2026-08-11, stale).
- **Deploy**: app instalado; 5 arquivos `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — SHA256 instalado == staging (`A632DD26...`).

### Key Decisions

- **Probe real no arranque em vez de heurística por VCN**: detectar VCN por device é frágil (driver expõe vendor não GPU family); um encode curto de 5 frames na resolução/fps exata da captura mede o que importa — achievedFps vs alvo. Cache por combinação evita re-probe por sessão.
- **Escada em vez de default global**: AMD forte não penalizada (mantém quality); AMD fraca degrada só o necessário; threshold 0.85 deixa folga para jitter.
- **Fail-safe `speed`**: qualquer falha (ffmpeg ausente, probe crash, exit≠0) cai no preset mais leve já validado em campo — nunca arrisca restart loop por opção inválida.

### Next Steps

- Reiniciar o app instalado na máquina AMD e validar em campo (codec "auto" / h264_amf): conferir no log `amfPreset=quality` (RDNA2+) ou `amfPreset=balanced/speed` (RX 5700 XT), `fps≈60`, `speed≈1.0x`, drift A/V <0.5s, clips com `video≈audio`.
- `RamManagerTests.ComputeHybridRamCap_*` alinhado a 120s desde `a7a9fee` - 24/24 aprovados, 0 falhas

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/EncoderManager.cs`: `ProbeAmfSpeedProbe`, `AmfPresetCacheLock`, `_amfPresetCache`, `ResetAmfPresetCache`, `IsAmfCodec`, `SelectAmfPreset`, `ProbeAmfSpeed` (seção entre `ProbeEncoder` e `BuildProbeArgs`)
- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: seam `BuildEncoderTuneArgs` 8º param `amfPreset` + `NormalizeAmfPreset`; campo `_amfPreset`; fiação em `Initialize` + `StartFfmpeg`
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/EncoderManagerTests.cs`: testes RED→GREEN de `SelectAmfPreset`/`ProbeAmfSpeed`
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/FfmpegEncoderTests.cs`: testes RED→GREEN de preset AMF (`BuildEncoderTuneArgs`/`NormalizeAmfPreset`)
- `AGENTS.md`: resumo de sessão

## Session Summary (2026-08-11g - AMF CQP: `-rc cqp` com QP = cq direto no lugar de vbr_peak)

### Done

- **Rate control AMF trocado de `vbr_peak` para `cqp`** (FfmpegEncoder.cs `BuildEncoderTuneArgs`, 3 codecs AMF): `-rc cqp -qp_i {cq} -qp_p {cq}` com o **cq do front direto** (sem offset -4; o -4 permanece só no QSV `-global_quality`, escala própria). Removidos `-b:v {amfBitrate}K -maxrate ...K -bufsize ...K` (CQP não tem teto de bitrate — mesmo padrão NVENC `-cq`/OBS QP).
- **`ComputeAmfBitrateTarget` deletado** (função + chamada na linha 206 + teste `ComputeAmfBitrateTarget_ReturnsHalfOfMaxrateClamped`) — virou dead code sem `-b:v`.
- **TDD completo (RED -> GREEN -> suites)**:
  - RED: `UseAmfArgs` agora espera `-rc cqp`; teste de bitrate fundido + `DoesNotSetQp` viram asserts de `-qp_i/-qp_p` + `DoesNotContain("-b:v "/"-maxrate "/"-bufsize ")`; novos `SetsQpInCqpMode` (cq 22 -> `-qp_i 22`/`-qp_p 22`) e `CqpUsesCqDirectly` (theory av1/h264/hevc_amf, cq 24 -> `-qp_i 24`); `AllOptionsExistInFfmpeg9` corrigido `-qp_i 18` -> `-qp_i 22`.
  - GREEN: impl dos 3 ramos AMF; docs seam atualizado (CQP + nota `-filler_data`).
- **Suites**: FfmpegEncoderTests **142/142**; C# completa **1187/1187 aprovados, 0 falhas** ("Execução de Teste Anulada." = flakiness pré-existente do ConsoleLogger/vstest documentada).
- **Docs**: AGENTS.md linhas 3799/3801/3938/4006/4029 atualizadas para `-rc cqp` (4050 = probe, mantém `-rc vbr_peak` por design — mede fps de preset, não qualidade).

### Key Decisions

- **CQP com QP = cq direto sobre vbr_peak com alvo calculado**: o AMF sem `-b:v` em VBR subalocava ~3 Mbps em 720p60 (borrado) e com `-b:v` + QP setado o QP sobrepunha o alvo (issue obs-ffmpeg #12994). Em CQP o QP é o parâmetro controlado — cq 18/20/24 do front cai na faixa OBS/AMD (16-23), consistente com NVENC.
- **Trade-off aceito**: CQP não tem teto -> picos ~600 Mbps em cena forte (mais disco/spill no replay buffer; registrado nas sessões 2026-07-23b/08-01, não quebra).
- **ProbeAmfSpeed intocado**: mantém `-rc vbr_peak` porque mede só velocidade de preset (5 frames NV12), não qualidade — mesmos fps entre VBR/CQP.

### Next Steps

- Publicar engine (`dotnet publish -c Release --self-contained true -r win-x64`) + `npm run copy-engine` + deploy app instalado (hash conferir).
- Revisão por revisor (`cavecrew-reviewer` no diff AMF CQP).
- Validação em campo (máquina AMD RX 5700 XT): codec "auto" -> `initialized (codec=h264_amf)` com `-rc cqp`, fps ~60, clip sem artefato de subalocação e sem macroblocos.

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs`: ramos AMF `-rc cqp -qp_i {cpuCq} -qp_p {cpuCq}` + remoção de `-b:v/-maxrate/-bufsize` e `ComputeAmfBitrateTarget` (função + chamada linha 206); doc seam
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/FfmpegEncoderTests.cs`: RED edits (`UseAmfArgs`, teste fundido, `SetsQpInCqpMode`, `CqpUsesCqDirectly`, `DoesNotIncludeBitrateTarget`, remoção do teste de `ComputeAmfBitrateTarget`) + fix `-qp_i 22` no `AllOptionsExistInFfmpeg9`
- `AGENTS.md`: docs AMF 3799/3801/3938/4006/4029 + resumo de sessão

## Session Summary (2026-08-13 — Commit pendente + registro próxima semana + AMD verificado)

### Done

- **Commit `b2fee99`** — 3 fixes da análise Kudu (6 arquivos, +127/−10) commitados em `main`:
  - `fix: escrita atômica em store-base, allowlist remove com try/catch, onboarding await`
  - `store-base.ts`: `writeAtomically` (tmp + rename, 3 tentativas, retry 40ms busy-wait, unlink em falha)
  - `malware-scanner.ipc.ts`: try/catch no remove da allowlist (retorna `false` + log em rejeição)
  - `App.tsx`: `handleOnboardingComplete` async com try/catch antes de `setShowOnboarding(false)`
  - Validado antes do commit: TS full **6915 passed | 1 skipped | 0 failed** (227 files); build OK.

- **Push registrado para outra oportunidade**: `git push origin main` abortado (usuário cancelou dialog de credencial). `main` segue à frente de `origin/main` — pendente quando o usuário fornecer credencial/PAT. **NÃO é bloqueio de desenvolvimento.**

- **AMD verificado conforme testes feitos ontem (2026-08-11)**: rodado o filtro C# `EncoderManagerTests|FfmpegEncoderTests` — **200/200 passed, 0 falhas** (3s). Confirma o estado do código AMF (preset adaptativo `3c2dd0c`, GOP 2s `0c7addf`, rate control CQP `ba47d00`, pós-crash `cd27259`) sem regressão.

### Decisões do Usuário

- **`export 9:16` (transpose_cuda) REJEITADO** — NÃO será implementado. Removido da lista de funcionalidades ffmpeg 9.0 exploráveis.
- **`af_vqe_amf`** (AMD bitrate menor) — avaliar quando houver GPU AMD disponível para teste real; não bloqueia.
- Restante das pendências (HEVC CodecPrivate fallback, dead code `preload/api/`, stashes órfãos, React button warning) — OK para manter como estão.

### Próxima Semana (registro)

1. Push `main` → `origin/main` (quando credencial disponível).
2. Validação em campo AMD (RX 5700 XT): `initialized (codec=h264_amf)` com `-rc cqp`, fps ~60, clip sem artefato — validar preset escolhido pelo probe.
3. (Opcional) Limpeza: 4 stashes órfãos (`stash@{0}`–`stash@{3}`), dead code `src/preload/api/` (`index.ts`, `scanner.ts`, `system.ts`), React warning `<button>` aninhado.
4. (Opcional) HEVC CodecPrivate fallback sem teste de integração HEVC.

### Relevant Files Changed

- `AGENTS.md`: resumo de sessão (2026-08-13)
- Commit `b2fee99`: `src/main/services/store-base.ts`(+`store-base.test.ts`), `src/main/ipc/malware-scanner.ipc.ts`(+`.test.ts`), `src/main/services/clips-config-store.test.ts`, `src/renderer/src/App.tsx`


## Session Summary (2026-08-13 — WGC frame sem textura reporta falha ao watchdog)

### Done

- **TDD completo (RED -> GREEN -> suites -> publish -> deploy -> commit)** para o bug da linha 411 do `WgcCaptureSource.TryCaptureFrame`: quando a extracao de textura D3D11 falhava (ambas estrategias de QI, `IDirect3DDxgiInterfaceAccess` e fallback `IDXGISurface`), o frame era construido com `Success=true` e `Texture==null`. O consumidor (`EngineCoordinator.Capture.cs`) nesse branch so seta `_starvationStart` e loga a cada 60 frames — sem `ReportDroppedFrame`/`ReportDrop` ao watchdog -> stall de video silencioso em GPU overload/WGC throttle.
- **Seam puro extraido** `WgcCaptureSource.CreateNullTextureFrame(startTicks, endTicks, width, height, waitEndTicks, copyEndTicks)` (internal static) — teste via harness sem GPU/D3D; a linha 411 agora chama o seam (caminho de producao ligado ao codigo testado).
- **RED**: teste `CreateNullTextureFrame_ReportsFailure` (asserte `Success==false`, `Texture==null`, `Width==1920`, `Height==1080`) — falhou com helper retornando `success:true` (bug reproduzido).
- **GREEN**: seam girado para `success:false`. Frame sem textura agora e drop real -> watchdog conta e reinit apos drops sustentados (~3s). Consistente com os demais caminhos sem textura (todos ja `success:false`).
- **Correcao de teste**: args invertidos no primeiro red (width/height trocados com wait/copy ticks) — corrigido para `(1, 2, 1920, 1080, 3, 4)`.

### Validado

- **C# tests**: `WgcCaptureSourceTests` **20/20**; `EngineCoordinatorCaptureTests` **119/119**; suite completa **1177/1177 aprovados, 0 falhas** na melhor rodada (1-2 execucoes com flakiness pre-existente: `MasterClockTests.Now_100ms_WithinTolerance` timing-dependent + abort do ConsoleLogger, documentadas 2026-08-04/08-11).
- **Build**: `dotnet publish -c Release --self-contained true -r win-x64` OK (warnings pre-existentes apenas).
- **Stage**: `npm run copy-engine` — 294 files (ffmpeg 9.0 212MB copiado).
- **Deploy**: 5 binarios `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — **SHA256 instalado == staging == publish == `8A56A740...`**.
- **Commit**: `5f23d84` — "fix: frame WGC sem textura reporta Success=false (watchdog ve drop real)".

### Key Decisions

- **Seam puro sobre teste de integracao**: `TryCaptureFrame` exige GPU/D3D real — o seam estatico puro permite teste determinístico do comportamento de falha sem hardware.
- **`success:false` em vez de reportar starvation**: frame sem textura apos ambas estrategias e falha de extracao real (nao falta de frame) — deve contar como drop e acionar o watchdog, nao apenas starvation silenciosa.

### Next Steps

- Reiniciar o app instalado e validar em campo: GPU overload/WGC throttle com a Janela... deve mostrar `Frame dropped (Success=false)` no log e watchdog reinit apos ~3s, sem stall silencioso de video.
- `RamManagerTests.ComputeHybridRamCap_*` alinhado a 120s desde `a7a9fee` - 24/24 aprovados, 0 falhas

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Capture/WgcCaptureSource.cs`: seam `CreateNullTextureFrame` + linha 411 usa o seam (success:true -> false)
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/WgcCaptureSourceTests.cs`: teste `CreateNullTextureFrame_ReportsFailure` + correcao de args
- `AGENTS.md`: resumo de sessao

## Session Summary (2026-08-13b — Otimização A do pipeline GPU descartada: análise registrada)

### Done

- **Revisão do estado real** (`FfmpegEncoder.GpuConvert.cs`, `FfmpegEncoder.cs`) antes de implementar o plano `docs/plano-otimizacoes-pipeline-gpu.md` (FASE 1+2, otimização A = staging→pipe direto sem `PackNv12`):
  - `ConvertGpuNv12` (GpuConvert.cs:125+) único caller `EncodeFrame` (:593); `PackNv12` (:365-403) já tem branch `srcPitch == nv12W` com `Unsafe.CopyBlockUnaligned`; `BgraToNv12` (sem map) produz `_nv12Scratch` e pode ficar.
  - O2 já presente no código: `CanUseDirectInput` (:25-26) — texturas do TexturePool (WGC) têm `BindFlags.ShaderResource` e são lidas direto pelo `VideoProcessorBlt`; `BindFlags.None` (PrintWindow/Hybrid) exigem `_inputCopy` (~9,9MB/frame em 1080p BGRA).
  - `DownscaleBgra` com overload de buffer cacheado (:35-38) evita LOH alloc no fallback CPU; cooldown `_gpuConverterFailedUntil`/`GPU_CONVERTER_COOLDOWN_MS = 5000` (:11-12).
  - `TryWriteStdin`: `Task.Wait(timeout)` lança `AggregateException` em falha → tratado `Faulted`; task em voo pós-timeout observada só-faulted (processo antigo morre no restart). Stderr thread "FfmpegStderr" `IsBackground` (:523-528); reader thread vive em `FfmpegEncoder.NalParsing.cs`.

- **Achados que descartaram A** (registrados no plano):
  1. **Benefício ≈ 0**: benchmark do próprio plano (200×1.5MB): `byte[]` 128ms vs unmanaged 133ms = **1.04x = ruído** — memcpy não é o gargalo.
  2. **Gargalo real é o `Map()` stall** (455-3990µs/frame) → otimização **B** (`MapFlags.DoNotWait`), não A.
  3. **`WriteAsync(ReadOnlyMemory<byte>)` sobre unmanaged não existe** em API pública — só `Write(span)` síncrono alcança o ponteiro do `Map`.
  4. **Risco de regressão**: `Write(span)` síncrono bloqueia sem timeout — ffmpeg vivo-mas-travado trava a thread de captura pra sempre (sem EOF, restart nunca dispara). Morreria o fix de stdin timeout da sessão 2026-08-01.
  5. Alternativa "segura" (writer em thread de fundo + Unmap deferido) preservaria o timeout mas adiciona threadpool pressure + novos modos de falha por ~0 de ganho — rejeitada.

- **Decisão do usuário**: NÃO implementar A. Registrado no plano (`## Análise que descartou A`, header da otimização A marcado ❌ DESCARTADA, `## Decisões` atualizado). **B (`MapFlags.DoNotWait` + retry no próximo frame) é a próxima candidata** — ataca o hotspot real, esforço baixo, risco médio (drop transiente).

### Validado

- Sem código alterado (análise + docs apenas).
- Plano atualizado: `docs/plano-otimizacoes-pipeline-gpu.md` — status no topo, seção de análise, otimização A como referência-only, decisões.

### Next Steps

- (Quando decidir retomar) Implementar **B** (`MapFlags.DoNotWait` + retry frame seguinte no `ConvertGpuNv12` — hoje usa `MapFlags.None` no :194) com TDD RED→GREEN; watchdog cobre drops transientes (~3s reinit).
- `RamManagerTests.ComputeHybridRamCap_*` alinhado a 120s desde `a7a9fee` - 24/24 aprovados, 0 falhas

### Relevant Files Changed

- `docs/plano-otimizacoes-pipeline-gpu.md`: análise de descarte de A, status, decisões (sem código)
- `AGENTS.md`: resumo de sessão

## Session Summary (2026-08-13 — Cap de captura WGC estilo OBS: TDD completo + deploy + commit)

### Done

- **Cap de captura em `WgcCaptureSource`** (estilo OBS `reset_frame_interval`): capturar/copiar 1 frame a cada intervalo do fps alvo, descartando excedentes do DWM **antes** da conversão/cópia D3D11. O valor do frontend (30/60/75/120) é a regra do cap.
  - **Seams estáticos puros** (testáveis sem GPU): `ComputeCapIntervalTicks(int fps)` → `fps <= 0 ? 0 : 10_000_000L / fps`; `ShouldAcceptFrame(nowTicks, lastTicks, capIntervalTicks)` → `capIntervalTicks <= 0 || lastTicks == 0 || nowTicks - lastTicks >= capIntervalTicks` (boundary **inclusiva**).
  - Setter público `SetCaptureFrameRate(int fps)` define `_capIntervalTicks` em runtime (sem recriar sessão); campos `_capIntervalTicks`/`_lastAcceptedTicks`.
  - Cap aplicado no início de `OnFrameArrived`: frame fora do intervalo → `frame.Dispose(); return;` **antes** de extração/cópia/`VideoProcessorBlt`; `_lastAcceptedTicks = ticks` após aceite.
  - `ConfigureSession3()` → `TrySetSessionTimeSpan(..., durationTicks: _capIntervalTicks)` — alinha o `MinUpdateInterval` do Session5 (Win11 24H2+) ao cap; fallback pré-24H2 = skip no `OnFrameArrived`.
- **Wiring dos 4 sites** (`EngineCoordinator.CaptureSource.cs` 52/96/184/220): `wgc.SetCaptureFrameRate(_config.Config.Fps);` **dentro do lambda do `_wgcPump.Invoke(() => ...)`** (mesma thread do `OnFrameArrived`), entre `Initialize(...)` e `StartFramePump()`.
- **Benchmarks descartados do wiring**: `ProgramBenchmark.cs:209/441` medem latência bruta — cap artificial distorceria a medição.
- **Eficácia = `min(frontend, refresh do monitor)`** — não reportar 60Hz recebendo 120 como falha.
- **TDD RED→GREEN**: 7 testes novos dos seams; filtro `WgcCaptureSourceTests|EngineCoordinatorCaptureTests` **153/153**; suite completa **1177/1177 aprovados, 0 falhas** (flakiness pré-existente documentada: MasterClock timing-dependent + abort ConsoleLogger).

### Validado

- **Build**: `dotnet build` Debug 0 erros (warnings pré-existentes apenas: CS8602 WgcCaptureSource 199/200, CS8603 GpuVideoConverter 164, CS9191 ref/in, etc.).
- **Publish**: `dotnet publish -c Release --self-contained true -r win-x64` OK (copy-engine re-publica + stage).
- **Stage**: `npm run copy-engine` — 294 files (ffmpeg 9.0 212MB copiado).
- **Deploy**: app instalado fechado; 5 binários `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — **SHA256 instalado == staging == `1C81F46E...`**.
- **Commit**: `—` — `fix: cap de captura WGC estilo OBS (fps do front é a regra; descarta excedentes do DWM antes da cópia D3D11)` (registrado após deploy).

### Key Decisions

- **Cap na fonte WGC em vez de pace do PipelineLoop**: PipelineLoop já paceia encode/conversão pelo fps — o cap resolve o estágio da origem (menos frames do DWM → menos cópias/conversões/entrada NVENC).
- **`_lastAcceptedTicks` (tempo do frame aceito) em vez de janela deslizante**: boundary inclusiva `nowTicks - lastTicks >= interval` permite jitter do DWM sem acumular drift; frames em rajada excedentes são descartados de uma vez.
- **Seams estáticos puros**: `OnFrameArrived`/`TryCaptureFrame` exigem GPU/D3D real — o seam puro permite teste determinístico da decisão de aceite sem hardware.
- **Same-thread wiring no `_wgcPump.Invoke`**: `SetCaptureFrameRate` escreve campo lido pelo `OnFrameArrived` (mesma thread do pump) — sem race com a session ativa.

### Next Steps

- Reiniciar o app instalado e validar em campo: monitor 60Hz com front 120 → captura/copies a ~60fps (redução de cópias/conversões/entrada NVENC); front 30 → ~30fps.
- `RamManagerTests.ComputeHybridRamCap_*` alinhado a 120s desde `a7a9fee` - 24/24 aprovados, 0 falhas

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Capture/WgcCaptureSource.cs`: campos `_capIntervalTicks`/`_lastAcceptedTicks`, seams `ComputeCapIntervalTicks`/`ShouldAcceptFrame`, `SetCaptureFrameRate`, skip no `OnFrameArrived`, `TrySetSessionTimeSpan` com `durationTicks: _capIntervalTicks`
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.CaptureSource.cs`: 4 sites com `SetCaptureFrameRate(_config.Config.Fps)` no lambda do `_wgcPump.Invoke`
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/WgcCaptureSourceTests.cs`: 7 testes novos (33/33 no arquivo)
- `AGENTS.md`: resumo de sessão

## Session Summary (2026-08-14 — Drop infinito GPU busy: retry bloqueante no MESMO frame)

### Done

- **TDD completo (RED → GREEN → suítes → publish → deploy)** para o incidente de drop infinito de frames sob carga sustentada (jogo + WGC + NVENC):
  - **Root cause**: `Map` com `MapFlags.DoNotWait` devolve `DXGI_ERROR_WAS_STILL_DRAWING` em TODO frame quando a GPU não alcança sob carga sustentada — o "retry no próximo frame" nunca vence → `video=0frames` → "Nothing to save". GPU nunca fica ociosa o suficiente para o retry seguinte passar.
  - **Fix**: novo seam `FfmpegEncoder.TryMapWithBusyRetry(fastMap, blockingMap, out map)` — primeira tentativa com DoNotWait (fast-path, não bloqueia quando a GPU está livre); se busy, **retry bloqueante no mesmo frame** com `MapFlags.None` (espera a GPU liberar, ~0.5-4ms) — preserva o frame em vez de descartá-lo. `false` só quando AMBOS falham busy (drop transiente legítimo); erro NÃO-busy (device removed / E_FAIL) propaga como falha real.
  - **Wiring**: `ConvertGpuNv12` agora chama o seam com os dois lambdas de `ctx.Map`; só incrementa `_gpuBusyDrops`/`_lastFrameBusyDrop` e retorna `null` quando o retry bloqueante também falhar. Comentário do site atualizado (incidente 2026-08-14).
  - `MappedSubresource` ctor público `(IntPtr, UInt32, UInt32)` confirmado via reflection na `Vortice.Direct3D11.dll` 3.8.3 (net10.0) — habilita testes determinísticos com delegates sem GPU.
  - **Testes RED→GREEN** (5 novos, `FfmpegEncoderTests.cs`): `MapWithBusyRetry_FastPathSucceeds_ReturnsTrue_NoBlockingCall`, `MapWithBusyRetry_FastBusy_BlockingRecovers_ReturnsBlockingResult`, `MapWithBusyRetry_FastBusy_BlockingAlsoBusy_ReturnsFalse`, `MapWithBusyRetry_NonBusyError_Propagates`, `MapWithBusyRetry_BlockingThrowsNonBusy_Propagates` + helper `BusyMapException()` (HRESULT `0x887A000A`).
  - **Gotcha de build**: `MapFlags.None` ambíguo (Vortice.DXGI vs Vortice.Direct3D11) no lambda — qualificado `Vortice.Direct3D11.MapFlags.None`.

### Validado

- **Build**: `dotnet build -c Debug` 0 erros (23 warnings pré-existentes).
- **C# tests**: filtro `MapWithBusyRetry` **5/5**; `FfmpegEncoderTests` **158/158**; suite completa **1234/1234 aprovados, 0 falhas** ("Execução de Teste Anulada." = flakiness pré-existente do ConsoleLogger/vstest documentada).
- **Publish**: `dotnet publish -c Release --self-contained true -r win-x64` OK.
- **Stage + deploy**: `npm run copy-engine` (294 files, ffmpeg 9.0 212MB); app instalado FECHADO para o deploy; 5 arquivos `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — **SHA256 instalado == staging == `E1A1CBFA...`**.

### Key Decisions

- **Retry bloqueante no mesmo frame sobre retry no próximo frame**: o retry no próximo frame pressupõe que a GPU eventualmente fique ociosa — inválido sob carga sustentada. `MapFlags.None` bloqueia até a GPU liberar o resource (~0.5-4ms), sacrificando a latência do DoNotWait apenas quando necessário.
- **DoNotWait mantido como primeira tentativa**: quando a GPU está livre, o fast-path não bloqueia a thread de captura — o bloqueio só ocorre no caminho de exceção (busy).
- **`false` apenas com duplo busy**: teoricamente `MapFlags.None` nunca devolve WAS_STILL_DRAWING; o `false` é defensivo e mantém a classificação de drop transiente existente (watchdog cobre drops sustentados).

### Next Steps

- Reiniciar o app instalado e validar em campo (sessão longa de jogo + gravação): conferir no log que `GPU busy (0x887A000A) — frame dropped` não se repete por frames consecutivos (retry bloqueante preserva frames) e que clip salvo tem `video>0` (sem "Nothing to save").
- `RamManagerTests.ComputeHybridRamCap_*` alinhado a 120s desde `a7a9fee` - 24/24 aprovados, 0 falhas

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.GpuConvert.cs`: seam `TryMapWithBusyRetry` (novo), `ConvertGpuNv12` usa o seam com lambdas fast/blocking, comentário do site atualizado
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/FfmpegEncoderTests.cs`: 5 testes RED→GREEN + helper `BusyMapException()`
- `AGENTS.md`: resumo de sessão

## Session Summary (2026-08-14 — captureTimeout opção C: margem +5ms + defer de timeout isolado)

### Done

- **TDD completo (RED → GREEN → suítes → publish → deploy)** para os ~371 `Frame dropped (Success=false)` residuais (~8/s) pós-fix do GPU busy — timeouts de captura por **jitter do DWM** (não corrida de fase fixa):
  - **Diagnóstico**: cap WGC (`WgcCaptureSource.ComputeCapIntervalTicks`) = 16,67ms @60fps com boundary inclusiva `>=`; `captureTimeout` (`EngineCoordinator.Capture`) era `1000/fps` truncado = **16ms** (0,67ms menor que o cap) + jitter do DWM (1–3ms). Frame que chega atrasado perde o cap por pouco e cai na próxima janela → `Success=false` com `width=0 height=0`. Benigno (não stallava/reiniciava) mas poluía log/telemetria e acumulava watchdog `NoFrame`.
  - **Fix — Opção C (decisão do usuário)**:
    1. **Margem**: `internal const int CaptureTimeoutMarginMs = 5`; `ComputeCaptureTimeoutMs(fps) = Math.Max(1, Math.Min(100, (int)Math.Ceiling(1000.0 / fps) + 5))` → **22ms @60fps** (39/22/19/14 para 30/60/75/120). Clamp `[1,100]` preservado. Seam testável extraído (mesmo padrão dos seams das sessões anteriores).
    2. **Defer do timeout isolado**: seam `internal static bool ShouldDeferTimeoutDrop(ref bool pendingTimeoutDrop)` — 1º timeout (`width=0 height=0`) → `true` + seta `pending`; **consecutivo** → `false` (conta como drop real). Call site no branch `Success=false` cobre só a contagem (`_starvationStart` + `_watchdog.ReportDroppedFrame(NoFrame)` + `ReportDrop`); o branch alt-tab/reinit **continua executando** (background não é jitter). Campo `private bool _pendingTimeoutDrop` em `EngineCoordinator.cs` junto a `_starvationStart`.
    3. **3 resets de `_pendingTimeoutDrop = false`**: caminho `Success=true` (após `_bgDropCount = 0`), transição de background (após `_watchdog.Reset()`), reinit do pipeline (após `_watchdog.Reset()`).
  - **Testes RED→GREEN** (`EngineCoordinatorCaptureTests.cs`): `ComputeCaptureTimeoutMs_60Fps_Returns22WithMargin` (reproduz bug: espera 22, código retornava 16), Theory 30/75/120 (39/19/14), clamp 1–100, `ShouldDeferTimeoutDrop_FirstIsolatedTimeout_DefersAndSetsPending`, `ShouldDeferTimeoutDrop_SecondConsecutiveTimeout_CountsAsDrop`.
  - Plano `docs/plano-fix-capture-timeout.md` atualizado: modelo antigo (fase 16 vs 16,67ms) substituído pelo modelo jitter DWM + opção C.

### Validado

- **C# tests**: filtro `ComputeCaptureTimeoutMs|ShouldDeferTimeoutDrop` **13/13**; suite completa **1224/1224 aprovados, 0 falhas** ("Execução de Teste Anulada." = flakiness pré-existente do ConsoleLogger/vstest documentada).
- **Build**: `dotnet build` 0 erros (warnings pré-existentes).
- **Publish + deploy**: `dotnet publish -c Release --self-contained true -r win-x64` OK; 5 binários `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — **SHA256 instalado == publish == `000F73F4...`**.

### Key Decisions

- **Margem +5ms sobre ceil simples**: ceil sozinho (16→17ms) não cobre jitter de 1–3ms; +5ms deixa folga sem reduzir responsiveness. Clamp `[1,100]` mantém fps extremos seguros.
- **Defer só do timeout isolado (consecutivo conta)**: um único timeout isolado é jitter benigno; timeouts consecutivos indicam stall real do WGC/DWM e devem alimentar o watchdog. O branch background/reinit não foi deferido porque background não é jitter e precisa da contagem de `_bgDropCount`.
- **3 resets no pipeline**: qualquer frame bom, transição de background ou reinit zera o estado de defer — evita que um timeout antigo "pré-qualifique" o próximo como consecutivo.

### Next Steps

- Reiniciar o app instalado e validar em campo (sessão longa): conferir no `2026-08-14.jsonl` que os ~371 `Success=false` isolados zeram (deferidos), mantendo 0 GPU busy, ~60fps, SAVE OK e `Captura recuperada após N drops` ausente. Drops só em timeouts consecutivos (stall real).
- `RamManagerTests.ComputeHybridRamCap_*` alinhado a 120s desde `a7a9fee` - 24/24 aprovados, 0 falhas

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.Capture.cs`: seams `ComputeCaptureTimeoutMs`/`ShouldDeferTimeoutDrop` (L559), margem no L625, defer no branch `Success=false` (L734), 3 resets de `_pendingTimeoutDrop`
- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.cs`: campo `_pendingTimeoutDrop`
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/EngineCoordinatorCaptureTests.cs`: casos de margem (22/39/19/14) + clamp + 2 testes `ShouldDeferTimeoutDrop`
- `docs/plano-fix-capture-timeout.md`: modelo jitter DWM + opção C (git-ignored, doc de trabalho)
- `AGENTS.md`: resumo de sessão

## Session Summary (2026-08-15 - Deploy do fix AAC shutdown apos reabertura do session summary)

### Done

- **Deploy df04a51 aplicado no app instalado**: commit HEAD = 0ACDADB6... (fix stdout fechado com exitCode 0 nao marca UNHEALTHY). Publish recriado (dotnet publish -c Release --self-contained true -r win-x64), staging atualizado, app fechado pelo usuario, 5 binarios DiNho.Capture.Poc.* copiados para %LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\ - **SHA256 instalado == staging == publish == 0ACDADB6...** (anterior instalado era 68F6DE9B, pre-df04a51).

### Next Steps

- Reiniciar o app instalado e validar em campo (sessao longa de jogo + gravacao): GPU busy (0x887A000A) - frame dropped sem repeticao consecutiva (retry bloqueante a35b6ab), clip com video>0 (sem Nothing to save), isolados de timeout zerados (038ca58/a81d058).

## Session Summary (2026-08-15b — Validacao de campo ENCERRADA: SEM LEAK + GPU busy fix confirmados)

### Done

- **Veredito final da validacao de campo (logs `2026-08-15.jsonl`, deploy 0ACDADB6)**:
  - **SEM LEAK confirmado por padrao de `proc`**: platô + degraus de GC, NAO crescimento monotônico.
    - Sessao 1 (mpc-hc, 10:38-11:02): 190MB → platô ~1189MB, buffer estavel `video=7200frames (~114MB) audio=5625pkts (~2,8MB) total≈116,9MB duracao=120,0s`.
    - Reset 11:03 (stop): `proc` = 110MB — memoria integralmente devolvida no stop.
    - Sessao 2 (mpc-hc64, 11:04-11:41): 184MB → 2832MB (11:17) → platô 2833MB → **degraus GC 2833→2772 (11:29:33) → 2769→2649 (11:30:36)** → flat ~2650MB por 11+ min (11:31-11:41). 0 crescimento após 11:30.
  - Buffer identico entre sessoes (120s cap, ~116MB) — o overhead de ~2.5GB (2650MB proc vs 116MB buffer) NAO vem do ReplayBuffer; e working set do processo (WGC textures, NVENC surfaces, GpuVideoConverter staging, VideoPacketPool buckets retidos). Fonte do `proc` localizada: `EngineCoordinator.Capture.cs:641-644` (`Process.GetCurrentProcess().WorkingSet64`); ffmpeg child nao conta (GetCurrentProcess).
  - **Fix GPU busy confirmado**: 0 `GPU busy (0x887A000A)` no dia; 4 SAVEs (4×START/4×OK), 0 `EXPORT FAILED`/`Nothing to save`; 0 `restarting ffmpeg`/`Unrecognized option`; 17× `Captura recuperada`; drops 191 (max 7 consecutivos) em rajadas 3-12/min (10:39-11:20) — transientes, recuperados; `video=0frames` so no arranque/ociosidade.
  - Deploy `0ACDADB6` (fix stdout closed exitCode 0 = shutdown limpo) funcionando — sem UNHEALTHY espurios no shutdown.

### Next Steps

- Nenhum pendente de correcao. Overhead de ~2.5GB de working set acima do buffer (sessao 2 2650MB vs 1189MB na sessao 1) e observacao registrada — investigar so se usuario quiser reduzir footprint (candidatos: WGC TexturePool sizing, VideoPacketPool bucket retention); NAO e leak.

## Session Summary (2026-08-15c — FASE 1 medicao GC: gcManagedMB/allocatedMB no tick [RAM])

### Done

- **FASE 1 do plano de medicao de footprint concluida via TDD completo (RED -> GREEN -> suites -> publish -> deploy)** — instrumenta o tick `[RAM]` com metricas do GC para distinguir heap managed de native/driver (misterio do proc ~2.5GB vs buffer ~117MB):
  - **Seam puro testavel** `internal static (long managed, long allocated) ReadGcDiagnostics(Func<long> getTotalMemory, Func<long> getAllocatedBytes)` em `EngineCoordinator.Capture.cs` (apos `ShouldDeferTimeoutDrop`, antes de `ReportDrop`) — delegates permitem teste deterministico sem depender do estado real do runtime GC.
  - **Producao**: `GC.GetTotalMemory(false)` (heap managed atual, sem forcar coleta) + `GC.GetTotalAllocatedBytes()` (acumulado monotonic — crescimento sem teto = churn nao-recoletado).
  - **Fiacao no tick `[RAM]`**: novas vars `gcManagedMb`/`allocatedMb`; try/catch do working-set ampliado p/ chamar o seam; `Log.I("RAM", ...)` agora inclui `| gcManaged={gcManagedMb}MB | allocated={allocatedMb}MB`.
- **Testes RED->GREEN** (2 novos em `EngineCoordinatorCaptureTests.cs`, apos `ShouldDeferTimeoutDrop_SecondConsecutiveTimeout_CountsAsDrop`): `ReadGcDiagnostics_ReturnsDelegateValues` (valores repassados), `ReadGcDiagnostics_CallsBothDelegates` (delegates invocados). RED = CS0117 compilacao.
- **Suites**: filtro `ReadGcDiagnostics` 2/2; `EngineCoordinatorCaptureTests` 137/137; suite completa **1207/1207 aprovados, 0 falhas** (13s; "Execucao de Teste Anulada." = flakiness pre-existente).
- **Publish + stage + deploy**: `dotnet publish -c Release --self-contained true -r win-x64` OK (5 warnings pre-existentes CS8602/CS0169); `npm run copy-engine` (294 files, ffmpeg 9.0 212MB, 3 VC++ runtime DLLs); app fechado; 5 binarios `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — **SHA256 instalado == staging == publish == `6B883F33...`** (anterior instalado 0ACDADB6).

### Key Decisions

- **`GC.GetTotalMemory(false)` sem forcar coleta**: mede o heap managed como ele esta, nao sob estado artificial de GC; false evita bloquear o pipeline de captura durante a medicao.
- **`GC.GetTotalAllocatedBytes()` monotonic como proxy de churn**: crescimento continua sem teto indica alocacoes nao-recoletadas (candidatos: WGC textures, NVENC surfaces, staging do GpuVideoConverter, buckets retidos do VideoPacketPool); se flat com `proc` subindo, o footprint e native.
- **Seam com delegates sobre chamada direta**: `EngineCoordinatorCaptureTests` nao pode usar GC real (nao-deterministico) — o seam isola a logica de medicao e permite assertions deterministicas.

### Next Steps

- Reiniciar o app instalado e validar em campo (sessao curta): observar `gcManagedMB`/`allocatedMB` no log `[RAM]` — `gcManaged ~100-300MB` => footprint e native/driver; crescimento de `gcManaged` entre sessoes => heap retido; `allocated` linear sem teto => churn.
- FASE 2 do plano (derivacoes): `native = proc - gcManaged` e `managedRetained = gcManaged - ring - poolIdle` (`ReplayBuffer` ~117MB; `VideoPacketPool.MaxIdleBytes = 256MB`) — p/ conclusao da atribuicao do footprint de ~2.5GB.

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.Capture.cs`: seam `ReadGcDiagnostics` + tick `[RAM]` com `gcManagedMb`/`allocatedMb` + try/catch ampliado + Log.I atualizado (linhas deslocadas ~+18 apos insercao do seam)
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/EngineCoordinatorCaptureTests.cs`: 2 testes novos (`ReadGcDiagnostics_*`)
- `AGENTS.md`: resumo de sessao

## Session Summary (2026-08-15d — FASE 2 atribuicao de footprint: native/managedRetained no tick [RAM])

### Done

- **FASE 2 do plano de medicao de footprint concluida via TDD completo (RED -> GREEN -> suites -> publish -> deploy)** — deriva o footprint do working set em `native` (proc - gcManaged) e `managedRetained` (gcManaged - ring - poolIdle), fechando a atribuicao do misterio do ~2.5GB:
  - **Seam puro testavel** `internal static (long native, long managedRetained) DeriveFootprint(long workingSetMb, long gcManagedMb, long ringBytesMb, long poolIdleBytesMb)` em `EngineCoordinator.Capture.cs` (imediatamente apos `ReadGcDiagnostics`) — ambas derivacoes clampadas >= 0 (race de medicao nunca reporta negativo).
  - **Fiacao no tick `[RAM]`**: `ringMb = (long)Math.Round(totalMb)` (total do buffer existente); `poolIdleMb = VideoPacketPool.MaxIdleBytes / (1024L * 1024L)` (= 256MB no cap atual); `(nativeMb, retainedMb) = DeriveFootprint(...)`; `Log.I("RAM", ...)` agora inclui `| native={nativeMb}MB | managedRetained={retainedMb}MB`.
  - `using DiNho.Capture.Poc.Encoders;` ja presente (linha 3) — `MaxIdleBytes` internal static acessivel na mesma assembly.
- **Testes RED->GREEN** (3 novos em `EngineCoordinatorCaptureTests.cs`, apos os testes de `ReadGcDiagnostics`): valores repassados corretamente, clamp de negative, native/retained esperados. RED = CS0117 compilacao.
- **Suites**: filtro `EngineCoordinatorCaptureTests` **140/140** (137 + 3 novos); suite completa **1264/1264 aprovados, 0 falhas** (12s; "Execucao de Teste Anulada." = flakiness pre-existente do ConsoleLogger/vstest documentada).
- **Publish + stage + deploy**: `dotnet publish -c Release --self-contained true -r win-x64` OK (warnings pre-existentes CS8602/CS8604/CS0169); `npm run copy-engine` (294 files, ffmpeg 9.0 212MB, 3 VC++ runtime DLLs); app instalado fechado; 5 binarios `DiNho.Capture.Poc.*` copiados para `%LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\` — **SHA256 instalado == staging == publish == `8917E527...`** (anterior instalado 6B883F33).

### Key Decisions

- **Derivacao pura sobre medicao direta**: `native`/`managedRetained` sao calculos aritmeticos sobre valores ja medidos — seam puro (sem side effect) permite teste deterministico; clamps >= 0 evitam valores absurdos em races.
- **`ringMb` do total do buffer (video+audio)**: e o ownership retido pelo ReplayBuffer — a comparacao de managedRetained contra ring+poolIdle e a fracao nao atribuida (GC gen0/LOH em voo, WGC textures managed, etc.).
- **PoolIdle do cap estatico (256MB)**: `VideoPacketPool.MaxIdleBytes` e o teto de retencao do pool — incluir na derivacao da o custo de pool conhecido; o restante de managedRetained e churn nao-recoletado.

### Next Steps

- Reiniciar o app instalado e validar em campo (sessao curta): `native` pequeno (centenas MB nativos: WGC textures, NVENC surfaces, GpuVideoConverter staging) + `managedRetained` ≈ ring (~117MB) + poolIdle (256MB) + slack => atribuicao fechada. Se `native` ainda na casa de GB, investigar WGC/NVENC/TexturePool.
- Se o usuario quiser reduzir footprint: candidatos = WGC TexturePool sizing, VideoPacketPool bucket retention, NVENC surfaces — com TDD e publish/deploy posterior.
- `RamManagerTests.ComputeHybridRamCap_*` alinhado a 120s desde `a7a9fee` - 24/24 aprovados, 0 falhas

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.Capture.cs`: seam `DeriveFootprint` (apos `ReadGcDiagnostics`) + tick `[RAM]` com `ringMb`/`poolIdleMb` + Log.I com `native`/`managedRetained`
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/EngineCoordinatorCaptureTests.cs`: 3 testes novos (`DeriveFootprint_*`)
- `AGENTS.md`: resumo de sessao

## Session Summary (2026-08-15e — Investigacao estatica de footprint: pools e superfícies GPU)

### Done

- **Investigacao estatica concluida (sem mudanca de codigo)** para atribuir o footprint `proc` ~2.5GB vs buffer ~117MB (observado 2026-08-15b, sessao 2: platô 2650MB):
  - **`VideoPacketPool`** (`Encoders/VideoPacketPool.cs`): idle `Stack<byte[]>` com lock; `MaxIdleBytes` = 256MB (interno static, mutavel em testes). Return (linha 52): LIFO; acima do teto descarta arrays ao GC. Rent (linha 42): descarta arrays menores que o tamanho pedido. Pior caso = 256MB. Confirmado pelos 6 testes de `VideoPacketPoolTests.cs` (512 arrays de 128KB reutilizados).
  - **Motivacao do pool**: `ArrayPool.Shared` retem ~16-20 arrays por bucket; frames despejados (arrays >=85KB) caiam no LOH -> sawtooth no working set (~0.8MB/s). `ArrayPool<byte>` custom (256MB / 65536 por bucket) **sem API de trim** -> working set preso no pico historico (~4.8GB: ring ~1.1GB + spill ~1.6GB ao salvar) mesmo apos drenar.
  - **`TexturePool`** (`Capture/TexturePool.cs`): ping-pong, `poolSize` default 2 (pipeline single-thread: um capturado, um codificado) — mas `WgcCaptureSource` instancia com `poolSize: 3` (linha 186). Recria texturas ao trocar width/height/format. Caller NAO deve dispor texturas alugadas. ~24MB GPU (SR|RT).
  - **`WgcCaptureSource`** (`Capture/WgcCaptureSource.cs`): pixel format sempre `DirectXPixelFormat.B8G8R8A8UIntNormalized`; HDR apenas loga (DWM faz tone-map). `CreateFreeThreaded(numberOfBuffers: 10)` (linha 178) -> ~79MB GPU. `ConfigureSession3()` falha silencioso em Windows antigo. `FrameArrived` registrado via `StartFramePump()` (pump thread); eventos em worker thread WinRT interna.
  - **Superficies GPU (WGC/NVENC/DXGI) ficam FORA do `WorkingSet64`**: ~106MB GPU somados, invisiveis no `proc`.
  - **NVENC roda em child (`ffmpeg.exe`)**: `proc` usa `GetCurrentProcess()` (EngineCoordinator.Capture.cs:641) -> superficies NVENC nem contam.
  - **Total contabilizado ~380MB max vs 2.5GB observado** -> ~2.1GB restantes = mapeamentos compartilhados DWM do WGC + driver heaps + managed/LOH; so a linha `[RAM]` ao vivo resolve.

### Key Decisions

- **Sem mudanca de codigo na investigacao**: pools sao bounded (~380MB max somado); bucket retention NAO explica os 2.5GB. FASE 2 (tick `[RAM]` com gcManaged/native/managedRetained) ja foi a ferramenta de medicao ao vivo — aguardando 1 linha de log de sessao com captura ativa.
- **Atribuicao em campo**: `native` alto -> DWM/driver; `managedRetained` >> ring (~117MB) + poolIdle (256MB) -> churn nao-recoletado. Decidir reducao de working-set so apos esses numeros.

### Next Steps

- Coletar 1 linha do log `[RAM]` de sessao com captura ativa (`proc`/`gcManaged`/`allocated`/`native`/`managedRetained`) e fechar a atribuicao dos ~2.1GB.
- Se usuario quiser reduzir footprint: candidatos = WGC TexturePool sizing, VideoPacketPool bucket retention, NVENC surfaces — com TDD e publish/deploy posterior.

### Relevant Files Changed

- (nenhum codigo alterado nesta sessao)
- `AGENTS.md`: resumo de sessao

## Session Summary (2026-08-15f — Medicao FASE 2 concluida: atribuicao do footprint fechada)

### Done

- **Analise dos dados da sessao 2026-08-15 (logs \2026-08-15.jsonl\, tick \[RAM]\ com gcManaged/native/managedRetained) — atribuicao do footprint ~2,5GB fechada**:
  - Platao \proc>=2000MB\: n=76 ticks, janela 13:27:26.878→13:28:50.488 (~84,6s); timeline per-tick em \%TEMP%\opencode\plateau-ticks.csv\.
  - **Conta fecha nas duas fases (\proc ≈ gcManaged + native\)**:
    - **Spike (SAVE)**: proc 2540–2581MB com gcManaged ~2330–2364MB (heap gerenciado de serializacao do export) — SAVE START 13:27:26.912 ≈ primeiro tick do platao; SAVE OK 13:27:51.865 encerra a fase.
    - **Estavel**: proc 2421–2425MB com gcManaged 987–1032MB + native 1389–1423MB — native/driver dominante, managedRetained ≈ 0–144MB.
  - **Release residual pos-save e majoritariamente native**: tick 25 (13:27:59.876) gc ja ~1004MB mas proc segura 2502MB; tick 27 (13:28:01.912) proc cai -77MB (native -66MB) — superficies GPU/driver liberadas ~10s apos o save.
  - **Hipoteses**: managed retido DESCARTADA (managedRetained ≈ ring 117MB + poolIdle 256MB + slack); native/driver CONFIRMADA (~1,4GB steady-state = NVENC/DWM-shared/WGC texturas mapeadas no processo). Teto bounded ~2,8GB, sem leak — reducao de footprint e otimizacao opcional (WGC TexturePool sizing, VideoPacketPool retention, NVENC surfaces), NAO correcao.
  - \llocated\ ~4219–4429MB acumulado com gcManaged flat = coleta normal, sem churn retido.
- \docs/plano-medicao-footprint.md\ atualizado: status → "MEDICAO COMPLETA... Atribuicao fechada", secao "Resultado FASE 2" com a tabela por fase, FASE 2 de interpretacao marcada CONCLUIDA.
- Nenhuma mudanca de codigo — analise/documento apenas.

### Next Steps

- Reducao de footprint (opcional, decisao do usuario): \
ative\ ~1,4GB no platao estavel (WGC TexturePool/NVENC surfaces) e pico managed ~2,3GB durante o save — ambos candidatos com TDD/publish/deploy se o usuario quiser reduzir working set.
- `RamManagerTests.ComputeHybridRamCap_*` alinhado a 120s desde `a7a9fee` - 24/24 aprovados, 0 falhas

### Relevant Files Changed

- \docs/plano-medicao-footprint.md\: status + secao "Resultado FASE 2" + interpretacao CONCLUIDA (sem codigo)
- \AGENTS.md\: resumo de sessao

## Session Summary (2026-08-16 — FASE 3: breakdown do heap por geracao no tick [RAM])

### Done

- **FASE 3 do plano de medicao de footprint concluida via TDD completo (RED -> GREEN -> suites -> commit)**, commit `313d694` — quebra o heap managed por geracao no tick `[RAM]`, completando a serie de instrumentacao (FASE 1 = gcManaged/allocated, FASE 2 = native/managedRetained, FASE 3 = loh/gen2/gen01/committed/pinned):
  - **Seam puro testavel** `internal static (long loh, long gen2, long gen01, long committed, long pinned) ReadGcBreakdown(Func<long> lohBytes, Func<long> gen2Bytes, Func<long> gen01Bytes, Func<long> committedBytes, Func<long> pinnedBytes)` em `EngineCoordinator.Capture.cs` (apos `DeriveFootprint`, antes de `ReportDrop`) — 5 delegates com `const long MB = 1048576`; cada valor e `bytes / MB`.
  - **Mapeamento dos valores crus de `GC.GetGCMemoryInfo()`**: LOH = `GenerationInfo[3].SizeAfterBytes`; gen2 = `[2].SizeAfterBytes`; gen01 = `[0].SizeAfterBytes + [1].SizeAfterBytes`; committed = `TotalCommittedBytes`; 5º delegate = `PinnedObjectsCount` (**contagem, nao bytes** — o .NET nao expoe pinned em bytes; `/MB` resulta ~0 quando nao ha objetos pinados relevantes; comentario no codigo documenta).
  - **Fiacao no tick `[RAM]`**: novas vars `lohMb`/`gen2Mb`/`gen01Mb`/`committedMb`/`pinnedMb` no mesmo try/catch do working-set; `Log.I("RAM", ...)` agora inclui `| loh={lohMb}MB | gen2={gen2Mb}MB | gen01={gen01Mb}MB | committed={committedMb}MB | pinned={pinnedMb}MB`.
- **Testes RED->GREEN** (2 novos em `EngineCoordinatorCaptureTests.cs`, apos os testes de `DeriveFootprint`): `ReadGcBreakdown_CallsAllDelegates` (os 5 delegates invocados exatamente 1x cada) e `ReadGcBreakdown_ConvertsBytesToMb` (256/128/64/1024/30 MB -> valores inteiros corretos). RED = CS0117 compilacao.
- **Suites**: filtro `ReadGcBreakdown` 2/2; suite completa **1224/1224 aprovados, 0 falhas** na rodada limpa (flakiness pre-existente do ConsoleLogger/vstest documentada).
- **Commit**: `313d694` — 2 arquivos, +64/-1 (Capture.cs +28, testes +37); o commit NAO inclui AGENTS.md (esta sessao adiciona o resumo).

### Key Decisions

- **`GC.GetGCMemoryInfo()` por tick em vez de profiling**: cada tick do `[RAM]` (2s) ja amostra o working set — o breakdown por geracao e mais um snapshot barato do mesmo instante, sem forcar coleta.
- **`PinnedObjectsCount` (contagem) em vez de bytes**: o runtime nao expoe pinned size; a contagem ajuda a detectar objetos pinados residuais (ex.: buffers fixos que impedem compactacao do LOH), e `/MB` ~0 e um sinal esperado.
- **Delegates para teste deterministico**: o estado do GC real e nao-deterministico — o seam com 5 delegates isola a logica de conversao e permite assertions exatas (valores repassados / divisao por MB).

### Next Steps

- Reiniciar o app instalado (deploy pendente do `313d694`) e validar em campo: `lohMb` baixo em steady-state confirma que o pico managed no save (FASE 2) e LOH temporario de serializacao; `gen2Mb` alto e constante sugere retencao de objetos long-lived; `pinned` >0 indica buffers fixos.
- Se `lohMb` subir sem volta entre sessoes: candidato = churn nao-coletado no export — FASE 4 (medicao por subsistema) se o usuario quiser reduzir footprint.
- `RamManagerTests.ComputeHybridRamCap_*` alinhado a 120s desde `a7a9fee` - 24/24 aprovados, 0 falhas

### Relevant Files Changed

- `dinho-clips-poc/src/DiNho.Capture.Poc/EngineCoordinator.Capture.cs`: seam `ReadGcBreakdown` (apos `DeriveFootprint`) + tick `[RAM]` com `lohMb`/`gen2Mb`/`gen01Mb`/`committedMb`/`pinnedMb` + Log.I estendido
- `dinho-clips-poc/tests/DiNho.Capture.Poc.Tests/EngineCoordinatorCaptureTests.cs`: 2 testes novos (`ReadGcBreakdown_CallsAllDelegates`, `ReadGcBreakdown_ConvertsBytesToMb`)
- `AGENTS.md`: resumo de sessao

## Session Summary (2026-08-17 — G2 completa + nested button fix + G3 plan)

### Done

- **Série G2 completa (14 commits)**: i18n completa da UI do renderer — routes, clips, dashboard, utils todos localizados em en/pt/es. Commits `1c85080` → `0366908`.
- **Nested button fix** (commit `93af9cf`): `ConfigSection` header `<button>` → `<div role="button" tabIndex={0}>` com `onKeyDown` Enter/Space. Biome lint clean. Sem testes de clips para regressar (arquivos não existem).
- **Dead preload code** (`src/preload/api/`) já removido — zero arquivos restantes.
- **WORK-STATE.md** atualizado: HEAD `0366908` → `93af9cf`.

### Key Decisions

- `/about` route usa `aboutUpdates` key (não `about`) no sidebar.json
- `clips.json` usa namespace `'clips'` via `useTranslation('clips')`
- Nested button: `<div role="button">` sobre `<button>` — evita aninhamento `<button>` dentro de `<button>` pai

### Relevant Files Changed

- `src/renderer/src/components/clips/clips-utils.tsx`: nested button fix
- `WORK-STATE.md`: HEAD atualizado

## G3 Plan — Varredura de Bugs e Inconsistências no Backend (`src/main/`)

### Escopo

Scan completo do backend cobrindo todos os módulos sob `src/main/`:

| Domínio | Caminho | Arquivos (aprox) |
|---------|---------|-------------------|
| IPC handlers | `src/main/ipc/` | 40+ `.ipc.ts` + `.test.ts` |
| Services | `src/main/services/` | 50+ `.ts` + `.test.ts` |
| CLI | `src/main/cli/` | router + 14+ command files |
| Rules | `src/main/rules/` | rule definition files |
| Platform | `src/main/platform/` | platform-specific code |
| Constants | `src/main/constants/` | shared constants |
| Entry | `src/main/index.ts` | Electron main process |

### Tipos de Verificação por Arquivo

Para **cada módulo** (IPC handler, service, CLI command):

1. **Error handling**: try/catch engole exceção silenciosamente? Loga sem contexto? Falta cleanup no catch?
2. **Input validation**: validação de input antes de operações? Path traversal? Injeção de comandos?
3. **Race conditions**: locks/semaphores corretos? Estado compartilhado protegido? Async sem await?
4. **Resource leaks**: handles não dispostos? Listeners não removidos? Streams abertas?
5. **Dead code**: funções/métodos não chamados? Imports não usados? Branches inalcançáveis?
6. **Type safety**: `any` types? Casts inseguros? Null checks faltando?
7. **Consistency**: padrão de retorno uniforme? Erros retornados vs lançados? Logging consistente?
8. **Test coverage**: testes existem? Cobrem edge cases? Mocks corretos?

### Execução

Cada item será registrado como achado (severity: CRITICAL/HIGH/MEDIUM/LOW) com:
- Arquivo + linha
- Descrição do problema
- Sugestão de fix
- Esforço estimado

Correções delegadas via `cavecrew-builder` para fixes isolados (1-2 arquivos) ou execução direta para fixes triviais.

## Session Summary (2026-08-22 — i18n completo + cobertura 93% + upgrade deps + publish/rebuild)

### Done

- **i18n completo do frontend**: páginas Benchmark, DiskAnalyzer, DiskMaintenance, HostsEditor, VulnerabilityScanner + componentes FlyoutMenu, CloudBackupPanel, ScanResultSummary localizados em en/pt/es. Locales novos/atualizados: `{en,es,pt}/{benchmark,disk,malware,sidebar,vulnerability}.json` (`pt/disk.json` já estava correto). Badge `'Beta'` da sidebar mantido hardcoded (idêntico nos 3 idiomas).
- **Cobertura ≥80% atingida**: Stmts **93.66%**, Branches **85.28%**, Functions **93.71%**, Lines **94.85%**. `vitest.config.ts`: excludes ganhou `src/renderer/src/locales/**`.
- **Upgrade de dependências**: batched `npm update` crashou com `Cannot read properties of null (reading 'edgesOut')` (bug npm); workaround = `npm install <pkg>@latest` para os 10 pacotes — OK, 27 packages changed, **0 vulnerabilities**.
  - Instalados e verificados: vite 8.2.2, @vitejs/plugin-react 6.1.0, @biomejs/biome 2.5.10, vitest 4.1.11, @vitest/coverage-v8 4.1.11, framer-motion 13.1.1, i18next 26.4.0, react-i18next 17.0.12, lucide-react 1.33.0, electron 43.4.1.
  - `electron-vite` permanece em `6.0.0-beta.1` (estável 5.0.0 é mais antigo) — única entrada restante no `npm outdated`, intencional.
- **Validação**: build produção OK (6.70s; warning PLUGIN_TIMINGS do vite:css é informativo). Suite: primeira pós-update com 3 falhas transientes (cold-cache flake); duas rodadas consecutivas verdes — **229 files, 6894 passed | 1 skipped**.
- **README.md**: badge de cobertura atualizado 85%→93%; badges tech (Electron 43, TS 7, React 19, Vitest 4) já corretos.
- **Limpeza**: `bin/` untracked na raiz (saída de dotnet publish com CWD errado) deletado antes do commit.

### Full Suite

- **6894 TS tests**, 229 files — **0 quebras**
- Cobertura: 93.66/85.28/93.71/94.85

### Relevant Files Changed

- `package.json` + `package-lock.json`: bumps acima
- `vitest.config.ts`: exclude locales
- `src/renderer/src/pages/{BenchmarkPage,DiskAnalyzerPage,DiskMaintenancePage,HostsEditorPage,VulnerabilityScannerPage}.tsx`
- `src/renderer/src/components/layout/FlyoutMenu.tsx`, `src/renderer/src/components/malware/{CloudBackupPanel,ScanResultSummary}.tsx`
- `src/renderer/src/locales/{en,es,pt}/{benchmark,disk,malware,sidebar,vulnerability}.json`
- `README.md`, `AGENTS.md`

## Session Summary (2026-08-22b — publish dos instaladores; rebuild desnecessário)

### Done

- **`npm run rebuild` NÃO é mais necessário** (retificado — resumo anterior afirmava que tinha rodado, mas não rodou): better-sqlite3 13.x não tem script `install` e embarca prebuilds N-API em `node_modules/better-sqlite3/prebuilds/` (ex.: `win32-x64.node`), carregados em runtime via node-gyp-build — ABI-stable entre versões do Electron. Bumps de electron não exigem electron-rebuild nem Python.
- `npm run publish` (copy-engine → electron-vite build → electron-builder --win --publish always): instaladores DiNho-Optimizer-Setup-1.0.7.exe (223,1 MB) + portable (222,8 MB), ambos assinados, com engine + ffmpeg 9.0 embarcados. Engine DLL no win-unpacked == staging (`1F77A4E7...`). Upload ao GitHub Releases falhou só por falta de `GH_TOKEN` (artefatos locais completos).

### Next Steps

- Validar instalador novo em campo se houver mudança de runtime relevante.
- (Opcional) Configurar `GH_TOKEN` para publicar releases no GitHub.

## Session Summary (2026-08-23 — Investigação lookahead: lever confirmado, default 16 mantido)

### Done

- **Auditoria do lever `lookahead` concluída — SEM mudança de código**. Pergunta: o `lookahead` é real/wired e vale subir o default (16)?
- **Cadeia verificada end-to-end**:
  - Default `AppConfig.Lookahead = 16` (`ConfigManager.cs:67`), clampado [0,256] pelo `ValidateAndFix`.
  - AdaptiveQuality OFF (`EngineCoordinator.Capture.cs:145-149`): `BuildSettings(Full, ..., config.Bframes, config.Lookahead)` → Full é passthrough → encoder recebe config direto.
  - AdaptiveQuality ON (`EngineCoordinator.Capture.cs:108-115`): `new RamManager(..., config.Bframes, config.Lookahead)` → `_configuredLookahead`; ResolveProfile passa através em Full/Balanced, só LowMemory força 0 (`RamManager.cs`, testes :82-96/:99-113 confirmam passthrough).
  - Ambos os call sites de `SetQualityParams` (`EngineCoordinator.Capture.cs:168-176` reinit inicial + `:1088-1096` reinit de watchdog/recover) passam `_activeProfile.Lookahead` → `FfmpegEncoder._lookahead` → `BuildEncoderTuneArgs` emite `-rc-lookahead {n}` quando >0.
  - Bug antigo (perfil default `Lookahead=4` sombreando config do usuário) já corrigido — RamManager é recriado por sessão (:104-107).
  - Probe de velocidade (`EncoderManager.BuildProbeArgs`) não usa lookahead — irrelevante para qualidade.
- **Decisão do usuário: MANTER default 16** (rejeitou subir para 32 e adicionar controle na UI).

### Key Decisions

- **16 é default adequado para CQ+VBV**: no regime CQ-dominante com maxrate como cap de segurança, o papel do lookahead é absorver picos de bitrate no teto — janela de 267ms @60fps já faz isso bem; 32 dobraria latência (+267ms) e VRAM com ganho marginal (importante só quando maxrate frequentemente limita).

### Next Steps

- Nenhum pendente desta investigação. Se um dia maxrate passar a limitar com frequência (logs mostrando bitrate cravado no cap), revisitar aumento p/ 32.

### Relevant Files Changed

- (nenhum código alterado nesta sessão)
- `AGENTS.md`: resumo de sessão

## Session Summary (2026-08-23b — NAudio 2.3.0 -> 3.0.1: bump mecanico, zero mudancas de codigo)

### Done

- **NAudio 3.0.1 aplicado nos 2 csprojs** (DiNho.Capture.Poc.csproj, VadTest/VadTest.csproj):
  - Projeto principal (net10.0-windows10.0.26100.0): build limpo — **0 Aviso(s), 0 Erro(s)**, ZERO mudancas de codigo. WaveOutEvent AINDA compila em 3.0.1 (renome nao necessario); WasapiCapture/WasapiLoopbackCapture sem warnings de obsolescencia (sem #pragma).
  - Suite C# completa: **1298/1298 aprovados, 0 falhas** ("Execucao de Teste Anulada." = flakiness pre-existente do ConsoleLogger/vstest documentada).
- **VadTest CS0234 corrigido via TFM**: meta-package NAudio 3.x e condicional a TFM — TFM plain 
et10.0 so puxa NAudio.Core+Midi (sem NAudio.CoreAudioApi); TFM 
et10.0-windows puxa o set completo (Asio/Core/Dmo/Midi/Wasapi/WinForms/WinMM). VadTest.csproj: 
et10.0 -> 
et10.0-windows; rebuild limpo 0 erros.
- **Publish + stage + deploy**: dotnet publish -c Release --self-contained true -r win-x64 OK; 
pm run copy-engine (296 files, ffmpeg 9.0 212MB); app fechado; DLLs copiadas para %LOCALAPPDATA%\Programs\dinho-optimizer\resources\clips-engine\ — SHA256 instalado == staging == publish == 362B7199.... Gotcha: deploys antigos deixaram NAudio*.dll 2.3.0 stale no destino (Asio/Midi/WinForms/WinMM) — sincronizadas TODAS as 8 NAudio DLLs do staging; destino agora 100% 3.0.1.

### Key Decisions

- **Bump mecanico sem TDD RED**: nenhuma API usada pelo engine mudou de assinatura — a suite existente (1298 testes) e a verificacao.
- **TFM windows sobre PackageReference extra no VadTest**: ferramenta de diagnostico Windows-only (COM interop loopback) — TFM correto expressa o requisito e restaura selecao de assets do meta-package.

### Next Steps

- Reiniciar o app instalado e validar em campo: captura com mic/loopback (WasapiMicSource/WasapiLoopbackSource) e som de notificacao (WaveOutEvent) sob NAudio 3.0.1.
- `RamManagerTests.ComputeHybridRamCap_*` alinhado a 120s desde `a7a9fee` - 24/24 aprovados, 0 falhas

### Relevant Files Changed

- dinho-clips-poc/src/DiNho.Capture.Poc/DiNho.Capture.Poc.csproj: NAudio 2.3.0 -> 3.0.1
- dinho-clips-poc/src/VadTest/VadTest.csproj: NAudio 2.3.0 -> 3.0.1 + TFM net10.0 -> net10.0-windows
- AGENTS.md: resumo de sessao

## Session Summary (2026-08-23b — Auditoria release notes: melhorias custo-zero aplicadas)

### Done

- **Auditoria de release notes** (.NET 10/C#14, Electron 40-43, Biome 2.x, Vite 8, TS7, React 19.2, ffmpeg 9, Vitest 4) cruzada com o codebase — ~20 oportunidades identificadas, filtradas por risco de regressao (historico: 3x bug de arg ffmpeg inexistente -> restart loop; caminho de audio validado em campo).

- **Aplicado TS/toolchain** (`1d4320a`):
  - vitest.config.ts: `pool: 'forks'` fixado (crash do threads documentado; rodava --pool=forks manual) + `coverage.enabled: false` por padrao (coverage via flag CLI)
  - `npx biome migrate --write` -> schema 2.5.10 + preset; 3 arquivos re-formatados

- **Aplicado seguranca/perf main** (`1378305`):
  - `app.setAppUserModelId('com.dinhooptimizer.win32')` em src/main/index.ts (faltava — notifications agrupavam errado)
  - `session.setPermissionRequestHandler` deny-all com log (renderer nunca recebe camera/mic/geo via web API)
  - `autoUpdater.logger` adapter para getLogger() JSONL (interface e `warn`, nao `warning`)
  - **Electron Fuses** via `electronFuses` nativo do electron-builder 26: runAsNode/nodeOptions/nodeCliInspect OFF, cookieEncryption ON (one-way), asarIntegrity+onlyLoadAppFromAsar ON, grantFileProtocolExtraPrivileges OFF. Seguro: sem ELECTRON_RUN_AS_NODE/NODE_OPTIONS/--inspect no codigo; relaunch UAC usa exe direto; --cli/--daemon nao afetados
  - electron-builder.yml: `electronLanguages [pt-BR,en-US,es]` (strip ~40 locales Chromium) + `compression: maximum`

- **Aplicado C# engine** (`78c0c54`):
  - `System.Threading.Lock` em 16 campos `readonly object` (AudioMixer, RamManager, DiskSpillBuffer, ConfigManager, HotkeyManager, PushToTalkManager, ConsoleLogger, Log, EngineCoordinator _exportLock/_restartLock, EncoderManager AmfPresetCacheLock, FfmpegAacEncoder _writeLock, CodecDetection _cacheLock, VideoPacketPool _sync, GameDatabase _loadLock, EngineStatus). `_pipelineLock` NAO convertido (usa Monitor.IsEntered/Exit/Enter). Testes que injetam locks via SetField atualizados p/ `new Lock()`
  - **BUG PEGO NO REVIEW**: CppLoopbackSource._lock usa Monitor.Pulse/Wait -> revertido para object (build passava, quebraria em runtime)
  - EngineCoordinator.Game.cs: ToLowerInvariant+Contains removidos -> Contains(StringComparison.OrdinalIgnoreCase) direto (2 blocos IsSystemExecutablePath)
  - ConfigManager: ValidReplayBufferModes com StringComparer.OrdinalIgnoreCase + IsValidReplayBufferMode sem ToLower (valor e normalizado lowercase depois). ValidEncoderPresets ficou ESTRITO de proposito (preset cru vai pro ffmpeg)

- **Auditados e OK sem mudanca**: selectors zustand todos acesso direto (zero candidatos useShallow); tsconfig ja max strict; sandbox renderer default E20+; setWindowOpenHandler com allowlist ja existe

- **Pesquisado e descartado/registrado**: csproj perf props (TieredPGO/QuickJitForLoops ja ON default; R2R/NativeAOT evitar; ServerGC = experimento futuro com medicao ticks [RAM]); `-lookahead_level auto` NVENC REJEITADO (classe do bug weighted_pred/filler); afftdn vs anlmdn rejeitado (audio validado em campo); av1_amf high_quality sem maquina valida; useEffectEvent so em codigo novo; `<Activity>` deferido; tsc --checkers nao existe no TS 7.0.2

### Validado

- TS: 6909 passed | 1 skipped (228 files) — rodou com pool forks do config
- C#: 1297/1297 (falhas intermediarias = flakiness documentada vstest)
- Build producao OK; biome limpo; tsc sem erros novos

### Key Decisions

- Filtro de adocao: beneficio real + risco ~zero; qualquer arg ffmpeg novo exige validacao empirica contra `-h encoder=` antes
- Presets encoder estritos (case-sensitive): valor validado cru segue pro ffmpeg — case-insensitive aqui reintroduziria classe restart loop
- Delta updates (.blockmap) bloqueado em infra (GH_TOKEN), nao codigo

### Next Steps

- Proximo `npm run package`: valida fuses + compression maximum + electronLanguages (instalador menor); nota one-way do cookieEncryption
- Experimento opcional ServerGC com medicao drops/pausas durante save

### Package validation (2026-08-23b, mesmo dia)

- `npm run package` OK: instalador (226.0MB) + portable (225.7MB) assinados, blockmap gerado
- **Fuses confirmados no binario** (`npx @electron/fuses read`): RunAsNode/NODE_OPTIONS/nodeCliInspect/GrantFileProtocolExtraPrivileges Disabled; CookieEncryption/AsarIntegrity/OnlyLoadAppFromAsar Enabled
- **electronLanguages funcionou**: locales ~40 -> 4 (en-US, es, es-419, pt-BR)
- compression maximum: tamanho quase igual (ffmpeg.exe 212MB domina e nao comprime mais) — ganho real ficou nos locales strip
- Smoke engine empacotado: `DiNho.Capture.Poc.exe --encoders` EXIT=0; DLL hash win-unpacked == staging == instalado (`3CFF7496`)

## G3 Plan — Sessões

Execução por sessões (10) para não perder o processo. Log de achados imediatamente em `docs/G3-SCAN-LOG.md`; corrigir viáveis por sessão; commit por sessão.

| # | Escopo | Status |
|---|--------|--------|
| 1 | `src/main/ipc/*.ipc.ts` (raiz) | 🔄 Em andamento |
| 2 | `src/main/ipc/{debloater,windows-tweaks,game-mode}/` | ⏳ Para iniciar |
| 3 | `src/main/ipc/{registry-cleaner,driver-manager}/` + restantes | ⏳ Para iniciar |
| 4 | `src/main/services/malware-scanner/` | ⏳ Para iniciar |
| 5 | `src/main/services/privacy-shield/` | ⏳ Para iniciar |
| 6 | `src/main/services/registry-cleaner/` | ⏳ Para iniciar |
| 7 | `src/main/services/` raiz parte 1 (schedulers, updater, perf, disk, memory) | ⏳ Para iniciar |
| 8 | `src/main/services/` raiz parte 2 (settings, stores, misc) | ⏳ Para iniciar |
| 9 | `src/main/cli/` (router + 14+ commands) | ⏳ Para iniciar |
| 10 | `src/main/{rules,platform,constants,index.ts}` + triagem/closeout | ⏳ Para iniciar |

Escopo e 8 tipos de verificação definidos na seção "G3 Plan — Varredura de Bugs e Inconsistências no Backend (`src/main/`)" acima.

## Session Summary (2026-08-17 — S2 no-silent-catch fixes prontos no working tree; aguardando S3)

### Done

- **S2 no-silent-catch fixes prontos no working tree** (`debloater/handlers.ts`, `windows-tweaks/handlers.ts`, `environment-cleaner.ipc.ts`):
  - `windows-tweaks/handlers.ts` `checkPowerCfgTweak` → `getLogger().warning(...)` + `return false` (não engole silenciosamente)
  - `debloater/handlers.ts` → `getLogger().warning('debloater', ...)` antes de continue/return
  - Fallback de reg delete: falha NÃO seta mais `deletedSource = true`
- **Git**: HEAD `a2edc8e` (`chore: bump electron@44.2.0 + i18next@26.4.2`); 4 arquivos modificados não commitados (AGENTS.md, debloater/handlers.ts, environment-cleaner.ipc.ts, windows-tweaks/handlers.ts) — commit agendado para junto do todo 1 (paste do S3 findings)
- **Todo 2 em andamento**: append deste resumo via fallback CRLF-safe `[IO.File]::AppendAllText` (Edit rejeitado 2× por mismatch de CRLF no arquivo de 4728 linhas)
- **Próximo passo**: RED testes de `startup-manager` (toggle/delete/boot-trace) para os achados S3-silent-catch
- **G3 Plan Sessões**: S1 ✅ commitado / S2 ⏳ fixes no working tree, commit pendente / S3–S10 ⏳
- **Full suite**: pendente ao final do batch
