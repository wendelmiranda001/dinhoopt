import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { _electron as electron } from 'playwright'
import { createLicenseE2EMarker } from './license-e2e'

/**
 * Round-trip IPC audit:
 * 1. Instrumenta o main process — envolve todos os handlers de `ipcMain.handle`
 *    e anexa listeners de contagem em todos os canais `ipcMain.on` — registrando
 *    todo comando que CHEGA ao main e quem o recebeu.
 * 2. No renderer, chama CADA método de `window.dinho` com args seguros
 *    (arrays/objetos vazios = no-op confirmado pelos handlers) e registra
 *    se resolve, rejeita (round-trip OK — handler respondeu) ou trava (hang).
 * 3. Cruza: método que rejeitou com "No handler registered" = BUG (canal enviado
 *    sem receptor). Canais registrados no main nunca atingidos = módulo não
 *    exercitado / handler morto.
 *
 * Segurança: métodos destrutivos (clean/fix/apply/delete/install) são chamados
 * com `[]` (validados como no-op). Diálogos nativos e operações reais de sistema
 * (relaunch, updater, game mode, recycle bin, repair, hosts, DNS/tweaks) ficam
 * em SKIP — apenas verificados pela cobertura de canais registrados.
 */

test.setTimeout(300_000)

const SKIP = new Set<string>([
  // window controls (fecharia/minimizaria a janela do teste)
  'windowMinimize',
  'windowMaximize',
  'windowClose',
  // diálogos nativos (bloqueiam em headless)
  'settingsSelectBackupDir',
  'settingsOpenBackupDir',
  'duplicatesSelectDir',
  'largeFilesSelectDir',
  'emptyFoldersSelectDir',
  'shredderSelectFiles',
  'shredderSelectFolders',
  'clipsSelectOutputDir',
  // relaunch como admin / autostart real
  'elevationRelaunch',
  'applyStartup',
  // updater (rede + instalação real)
  'updaterCheck',
  'updaterDownload',
  'updaterInstall',
  // destrutivos reais sem forma segura de no-op
  'recycleBinClean',
  'winSxSClean',
  'diskRepairSfc',
  'diskRepairDism',
  'diskRepairChkdsk',
  // scans pesados/longos demais para E2E
  'malwareScan',
  'diskAnalyze',
  'diskFileTypes',
  'benchmarkRun',
  // rede / ativação remota
  'malwareYaraUpdate',
  'licenseActivate',
  'backupNow',
  // game mode real (mata processos) / audit aplica mudanças
  'gameModeActivate',
  'gameModeRunAudit',
  // mudanças reais de config de sistema (não revertíveis sem conhecimento do usuário)
  'hostsWrite',
  'gamingVbsSet',
  'gamingHagsSet',
  'gamingTimerSet',
  'gamingTimerRevert',
  'gamingAutoTuning',
  'windowsTweaksNetshTcp',
  // onboarding já dispensado no beforeAll
  'onboardingSet',
])

// Args seguros por método (default = [] → handler valida no-op ou responde erro)
const ARGS: Record<string, unknown[]> = {
  log: ['info', 'e2e-roundtrip'],
  systemClean: [[]],
  browserClean: [[]],
  appClean: [[]],
  gamingClean: [[]],
  databaseClean: [[]],
  uninstallLeftoversClean: [[]],
  shortcutClean: [[]],
  environmentClean: [[]],
  cleanerOpenLocation: [''],
  registryFix: [[]],
  registrySetTweakIgnored: [[], true],
  contextMenuApply: [[]],
  startupToggle: ['', '', '', '', true],
  startupDelete: ['', '', ''],
  networkClean: [[]],
  diskTrimRun: [[]],
  settingsSet: [{}],
  historyAdd: [{}],
  privacyApply: [[]],
  privacyRevert: [[]],
  complianceApply: [[]],
  complianceRevert: [[]],
  vulnerabilityApply: [[]],
  vulnerabilityRevert: [[]],
  malwareCancelScan: [''],
  malwareQuarantine: [[]],
  malwareDelete: [[]],
  malwareRestore: ['', ''],
  malwareIgnore: ['', {}],
  malwareAllowlistRemove: [''],
  driverClean: [[]],
  driverUpdateInstall: [[]],
  driverAgentApprove: [[]],
  perfKillProcess: [-1],
  serviceApply: [[], true],
  firewallApply: [[]],
  uninstallerUninstall: [''],
  uninstallerForceRemove: [''],
  softwareUpdateRun: [[]],
  appInstallerInstall: [[]],
  duplicatesScan: [{ dir: '' }],
  duplicatesDelete: [[], 'keepFirst'],
  duplicatesOpenLocation: [''],
  largeFilesScan: [{ dir: '' }],
  largeFilesDelete: [[], 'toRecycleBin'],
  largeFilesOpenLocation: [''],
  emptyFoldersScan: [{ dir: '' }],
  emptyFoldersDelete: [[], 'toRecycleBin'],
  emptyFoldersOpenLocation: [''],
  shredderShred: [[]],
  shredderOpenLocation: [''],
  windowsTweaksApply: [[]],
  windowsTweaksRevert: [[]],
  windowsTweaksSetDns: ['', ''],
  watcherStart: [[]],
  setScanProfile: [''],
  powerPlansActivate: ['00000000-0000-0000-0000-000000000000'],
  powerPlansCreate: [''],
  powerPlansDelete: ['00000000-0000-0000-0000-000000000000'],
  customRulesAdd: ['', ''],
  customRulesRemove: [''],
  exportReport: [{}, 'json', ''],
  logsConfigSet: [{}],
  intelCheckHash: [''],
  intelCheckDomain: [''],
  intelCheckIp: [''],
  intelToggleFeed: ['', true],
  exploitScan: [''],
  backupConfigSet: [{}],
  backupRestore: ['', ''],
  sandboxAnalyze: [''],
  notifyScheduledScanComplete: [0, 0],
  scheduleRunComplete: ['', ''],
  applyTray: [true],
  clipsGetDurations: [[]],
  clipsDelete: [''],
  clipsRename: ['', ''],
  clipsOpen: [''],
  clipsSetConfig: [{}],
  clipsGetThumbnail: [''],
  clipsSetAudioSessions: [[]],
  clipsSetMicDevice: [''],
  clipsSetFavorite: ['', false],
  clipsTrimClip: ['', 0, 1],
  clipsMergeClips: [[]],
  clipsPublish: [''],
  clipsPublishCancel: [''],
  clipsOpenExternal: ['not a url'],
  clipsGetEnhanceSupport: [],
}

// Scan read-only podem levar alguns segundos — timeout generoso
const SLOW = new Set<string>([
  'systemScan',
  'browserScan',
  'appScan',
  'gamingScan',
  'databaseScan',
  'uninstallLeftoversScan',
  'shortcutScan',
  'environmentScan',
  'winSxSScan',
  'registryScan',
  'privacyScan',
  'complianceScan',
  'vulnerabilityScan',
  'serviceScan',
  'firewallScan',
  'driverScan',
  'driverUpdateScan',
  'driverAgentEvaluate',
  'softwareUpdateCheck',
  'appInstallerListAvailable',
  'memoryScan',
  'clipsStartEngine',
  'clipsGetAudioSessions',
  'clipsGetMicDevices',
  'clipsGetGpus',
])

const _DEFAULT_TIMEOUT = 15_000
const _SLOW_TIMEOUT = 30_000

type Result = {
  name: string
  status: 'ok' | 'reject' | 'hang' | 'skip'
  ms?: number
  error?: string
}

let electronApp: ElectronApplication
let page: Page
let results: Result[] = []
let audit: {
  invokeHits: Record<string, number>
  eventHits: Record<string, number>
  invokeChannels: string[]
  eventChannels: string[]
  wrapped: boolean
} | null = null

test.beforeAll(async () => {
  test.setTimeout(300_000)
  createLicenseE2EMarker(resolve(__dirname, '.e2e-userdata-ipc'))
  electronApp = await electron.launch({
    args: [resolve(__dirname, '../out/main/index.js'), `--dinho-data-dir=${resolve(__dirname, '.e2e-userdata-ipc')}`],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DINHO_E2E: '1',
    },
  })
  page = await electronApp.firstWindow()
  await page.evaluate(async () => {
    const d = window.dinho as Record<string, unknown>
    const onboardingSet = d?.onboardingSet as ((v: boolean) => Promise<void>) | undefined
    await onboardingSet?.(true)
  })
  await page.waitForTimeout(500)
  await page.reload()
  await page.waitForTimeout(2000)

  // Instrumenta o main: wrap de handlers de invoke + contadores por canal de evento
  audit = await electronApp.evaluate(({ ipcMain }) => {
    const g = globalThis as unknown as Record<string, unknown>
    const state = {
      invokeHits: {} as Record<string, number>,
      eventHits: {} as Record<string, number>,
      invokeChannels: [] as string[],
      eventChannels: [] as string[],
      wrapped: false,
    }
    g.__ipcAudit = state

    const ipc = ipcMain as unknown as { _invokeHandlers?: Map<string, (...a: unknown[]) => unknown> }
    const eventChannels = ipcMain.eventNames().filter((c): c is string => typeof c === 'string')
    for (const ch of eventChannels) {
      state.eventChannels.push(ch)
      ipcMain.prependListener(ch, () => {
        state.eventHits[ch] = (state.eventHits[ch] ?? 0) + 1
      })
    }

    try {
      const handlers = ipc._invokeHandlers
      if (handlers && typeof handlers.forEach === 'function') {
        handlers.forEach((orig, ch) => {
          if (typeof ch !== 'string') return
          state.invokeChannels.push(ch)
          handlers.set(ch, (...args: unknown[]) => {
            state.invokeHits[ch] = (state.invokeHits[ch] ?? 0) + 1
            return (orig as (...a: unknown[]) => unknown)(...args)
          })
        })
        state.wrapped = true
      }
    } catch {
      state.wrapped = false
    }
    return state
  })

  const runner = async ({ skip, args, slow }: { skip: string[]; args: Record<string, unknown[]>; slow: string[] }) => {
    const d = window.dinho as Record<string, (...a: unknown[]) => unknown>
    const names = Object.keys(d)
    const withTimeout = (p: Promise<unknown>, ms: number) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('__TIMEOUT__')), ms)
        p.then(
          (v) => {
            clearTimeout(t)
            resolve(v)
          },
          (e) => {
            clearTimeout(t)
            reject(e)
          },
        )
      })
    const out: Result[] = []
    const deadline = Date.now() + 220_000
    for (const name of names) {
      if (skip.includes(name)) {
        out.push({ name, status: 'skip' })
        continue
      }
      if (Date.now() > deadline) {
        out.push({ name, status: 'skip' })
        continue
      }
      const callArgs = args[name] ?? []
      const t0 = performance.now()
      try {
        const ret = d[name](...callArgs)
        if (ret && typeof ret.then === 'function') {
          await withTimeout(ret, slow.includes(name) ? 30000 : 15000)
          out.push({ name, status: 'ok', ms: Math.round(performance.now() - t0) })
        } else if (typeof ret === 'function') {
          const cleanup = (ret as unknown as (cb: () => void) => unknown)(() => {})
          if (typeof cleanup === 'function') (cleanup as () => void)()
          out.push({ name, status: 'ok', ms: Math.round(performance.now() - t0) })
        } else {
          out.push({ name, status: 'ok', ms: Math.round(performance.now() - t0) })
        }
      } catch (e) {
        const msg = String((e && (e as Error).message) || e)
        out.push({
          name,
          status: msg === '__TIMEOUT__' ? 'hang' : 'reject',
          ms: Math.round(performance.now() - t0),
          error: msg,
        })
      }
    }
    return { out, total: names.length }
  }

  const raw = await page.evaluate(runner, {
    skip: [...SKIP],
    args: ARGS,
    slow: [...SLOW],
  })
  results = raw.out
})

test.afterAll(async () => {
  await electronApp.close()
})

test('IPC round-trip: todo método resolve/rejeita (comando enviado e recebido)', () => {
  const called = results.filter((r) => r.status !== 'skip')
  expect(results.length).toBeGreaterThan(180)
  expect(called.length).toBeGreaterThan(150)

  const noHandler = called.filter((r) => r.status === 'reject' && r.error?.includes('No handler registered'))
  const hangs = called.filter((r) => r.status === 'hang')
  const rejects = called.filter((r) => r.status === 'reject' && !r.error?.includes('No handler registered'))
  const skips = results.filter((r) => r.status === 'skip')
  const oks = called.filter((r) => r.status === 'ok')

  // CRITICAL: comando enviado sem receptor no main
  expect(noHandler, `canais sem handler: ${noHandler.map((r) => `${r.name} → ${r.error}`).join(' | ')}`).toHaveLength(0)

  writeReport({
    total: results.length,
    called: called.length,
    ok: oks.length,
    reject: rejects.length,
    hang: hangs.length,
    skip: skips.length,
    noHandler,
    rejects,
    hangs,
    skips: skips.map((r) => r.name),
    audit,
  })

  console.log(
    `[roundtrip] ${oks.length} ok | ${rejects.length} reject | ${hangs.length} hang | ${skips.length} skip | total ${results.length}`,
  )
  if (rejects.length) {
    console.log(
      '[roundtrip] rejects (round-trip OK, handler respondeu com erro/validação):',
      rejects.map((r) => r.name).join(', '),
    )
  }
  if (hangs.length) console.log('[roundtrip] HANG (atenção):', hangs.map((r) => r.name).join(', '))
})

function writeReport(data: Record<string, unknown>): void {
  const dir = resolve(__dirname, '.ipc-audit')
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'report.json'), JSON.stringify(data, null, 2))
  console.log('[roundtrip] relatório: e2e/.ipc-audit/report.json')
}
