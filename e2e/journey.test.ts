import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { _electron as electron } from 'playwright'
import { createLicenseE2EMarker } from './license-e2e'

/**
 * Jornada UI completa: para cada módulo, navega até a rota, clica no botão de
 * análise/scan real (texto pt-BR), aguarda o fim do scan (spinner/botão ocupado
 * desaparecer), captura screenshot + trecho do resultado e registra tudo num
 * relatório JSON.
 *
 * - Módulos que exigem seletor de pasta nativo (duplicados, arquivos grandes,
 *   pastas vazias) não são clicáveis em headless — registrados com a razão.
 * - Módulos auto-load (inicializador, agendador, desempenho, tweaks) só navegam
 *   + screenshot.
 * - Nenhuma ação destrutiva (limpar/apagar/desinstalar) é disparada.
 */

type Module = {
  route: string
  label: string
  buttons: string[]
  capMs?: number
  note?: string
  auto?: boolean
  busySelector?: string
}

const MODULES: Module[] = [
  { route: '/cleaner', label: 'Limpeza', buttons: ['Analisar'], capMs: 90_000 },
  { route: '/network', label: 'Rede', buttons: ['Analisar'], capMs: 45_000 },
  { route: '/registry', label: 'Registro', buttons: ['Verificar'], capMs: 60_000 },
  { route: '/context-menu', label: 'Menu de Contexto', buttons: ['Verificar'], capMs: 45_000 },
  { route: '/malware', label: 'Antimalware', buttons: ['Analisar'], capMs: 180_000 },
  { route: '/privacy', label: 'Privacidade', buttons: ['Analisar'], capMs: 90_000 },
  { route: '/services', label: 'Serviços', buttons: ['Analisar Serviços'], capMs: 180_000 },
  { route: '/debloater', label: 'Bloatware', buttons: ['Analisar'], capMs: 180_000 },
  { route: '/compliance', label: 'Conformidade', buttons: ['Auditar'], capMs: 300_000 },
  { route: '/vulnerability', label: 'Vulnerabilidades', buttons: ['Escanear'], capMs: 300_000 },
  { route: '/firewall', label: 'Firewall', buttons: ['Reanalisar', 'Analisar'], capMs: 120_000 },
  { route: '/disk', label: 'Analisador de Disco', buttons: ['Analisar'], capMs: 180_000 },
  { route: '/duplicates', label: 'Duplicados', buttons: [], note: 'seletor de pasta nativo (headless)', capMs: 5_000 },
  {
    route: '/large-files',
    label: 'Arquivos Grandes',
    buttons: [],
    note: 'seletor de pasta nativo (headless)',
    capMs: 5_000,
  },
  {
    route: '/empty-folders',
    label: 'Pastas Vazias',
    buttons: [],
    note: 'seletor de pasta nativo (headless)',
    capMs: 5_000,
  },
  {
    route: '/updates',
    label: 'Atualizações',
    buttons: ['Verificar atualizações', 'Verificar novamente'],
    capMs: 120_000,
  },
  { route: '/drivers', label: 'Drivers', buttons: ['Analisar drivers'], capMs: 120_000 },
  { route: '/installer', label: 'Instalador', buttons: ['Carregar apps', 'Atualizar lista'], capMs: 60_000 },
  {
    route: '/benchmark',
    label: 'Benchmark',
    buttons: ['INICIAR BENCHMARK'],
    capMs: 120_000,
    busySelector: '[class*="border-t-cyan"]',
  },
  { route: '/memory', label: 'Memória', buttons: ['Atualizar'], capMs: 45_000 },
  { route: '/hosts-editor', label: 'Hosts', buttons: ['Ler Arquivo Hosts'], capMs: 30_000 },
  { route: '/startup', label: 'Inicializador', buttons: [], auto: true, capMs: 5_000 },
  { route: '/schedules', label: 'Agendador', buttons: [], auto: true, capMs: 5_000 },
  { route: '/performance', label: 'Desempenho', buttons: [], auto: true, capMs: 5_000 },
  { route: '/windows-tweaks', label: 'Tweaks Windows', buttons: [], auto: true, capMs: 5_000 },
]

type JourneyResult = {
  route: string
  label: string
  title: string
  buttonClicked?: string
  buttonDisabled?: string
  note?: string
  autoLoad?: boolean
  idle: boolean
  idleMs?: number
  errors: string[]
  screenshot: string
  bodySnippet: string
}

let electronApp: ElectronApplication
let page: Page
const globalErrors: string[] = []
const results: JourneyResult[] = []
const outDir = resolve(__dirname, '.journey-audit')

test.beforeAll(async () => {
  mkdirSync(resolve(outDir, 'shots'), { recursive: true })
  createLicenseE2EMarker(resolve(outDir, 'userdata'))
  electronApp = await electron.launch({
    args: [resolve(__dirname, '../out/main/index.js'), `--dinho-data-dir=${resolve(outDir, 'userdata')}`],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DINHO_E2E: '1',
    },
  })
  page = await electronApp.firstWindow()

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text()
      if (!globalErrors.includes(t)) globalErrors.push(t)
    }
  })
  page.on('pageerror', (err) => {
    const t = err.message
    if (!globalErrors.includes(t)) globalErrors.push(t)
  })
  page.on('unhandledrejection', (reason) => {
    const t = reason instanceof Error ? reason.message : String(reason)
    if (!globalErrors.includes(t)) globalErrors.push(t)
  })

  await page.evaluate(async () => {
    const d = window.dinho as Record<string, unknown>
    const onboardingSet = d?.onboardingSet as ((v: boolean) => Promise<void>) | undefined
    await onboardingSet?.(true)
  })
  await page.waitForTimeout(500)
  await page.reload()
  await page.waitForTimeout(2000)
})

test.afterAll(async () => {
  writeFileSync(
    resolve(outDir, 'report.json'),
    JSON.stringify(
      {
        modules: MODULES.length,
        results,
        globalErrors,
        summary: {
          clicked: results.filter((r) => r.buttonClicked).length,
          idle: results.filter((r) => r.idle).length,
          notIdle: results.filter((r) => !r.idle).length,
          dirPickerSkipped: results.filter((r) => r.note).length,
          totalGlobalErrors: globalErrors.length,
        },
      },
      null,
      2,
    ),
  )
  console.log(`\nJourney report: ${resolve(outDir, 'report.json')}`)
  await electronApp.close()
})

function push(route: string, kind: string, text: string) {
  globalErrors.push(`[${route}] ${kind}: ${text}`)
}

test('jornada completa: navega + analisa + captura em todos os módulos', async () => {
  test.setTimeout(0)

  for (const mod of MODULES) {
    const r: JourneyResult = {
      route: mod.route,
      label: mod.label,
      title: '',
      errors: [],
      idle: false,
      screenshot: '',
      bodySnippet: '',
    }

    try {
      await page.evaluate((route) => {
        window.location.hash = `#${route}`
      }, mod.route)
      await page.waitForTimeout(2500)

      // errors fired during this visit (dedup against globals)
      const before = globalErrors.length
      const afterNav = globalErrors.slice(before)
      const navErrors = afterNav.filter((e) => !e.startsWith(`[${mod.route}]`))

      r.title = await page.title().catch(() => '')

      const shotName = `shots${mod.route.replaceAll('/', '_') || '_root'}.png`
      await page.screenshot({ path: resolve(outDir, shotName) }).catch(() => {})
      r.screenshot = shotName
      r.bodySnippet = (await page.evaluate(() => document.body?.textContent?.slice(0, 300) ?? '')).replace(/\s+/g, ' ')

      const hash = await page.evaluate(() => window.location.hash)
      if (!hash.includes(mod.route)) r.errors.push(`ROUTE DID NOT NAVIGATE: hash=${hash}`)

      if (mod.buttons && mod.buttons.length > 0) {
        const capMs = mod.capMs ?? 45_000
        const clicked = await clickButton(mod.buttons, capMs)
        if (clicked) {
          r.buttonClicked = clicked.text
          const idle = await waitForIdle(capMs, mod.busySelector)
          r.idle = idle.idle
          r.idleMs = idle.elapsed
        } else {
          r.note = 'nenhum botão de análise encontrado'
        }
      } else if (mod.auto) {
        r.autoLoad = true
        await page.waitForTimeout(3000)
      } else {
        r.note = mod.note ?? 'sem botão de análise'
      }

      const before2 = globalErrors.length
      await page.screenshot({ path: resolve(outDir, shotName) }).catch(() => {})
      r.errors.push(...globalErrors.slice(before2))

      // aggregate any route-scoped console errors logged during module work
      for (const e of navErrors) r.errors.push(e)
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      r.errors.push(`MODULE THREW: ${text}`)
      push(mod.route, 'pageerror', text)
    }

    results.push(r)
    const line = `[journey] ${mod.route.padEnd(16)} ${r.buttonClicked ?? (r.autoLoad ? 'auto' : '-')}${r.idle ? ' OK' : ''}${!r.idle && !r.note && !r.autoLoad ? ' BUSY/TIMEOUT' : ''}`
    console.log(line)
  }

  // Final aggregate assertion: we must have visited every module
  if (results.length !== MODULES.length) {
    throw new Error(`visitou ${results.length}/${MODULES.length} módulos`)
  }
})

async function clickButton(texts: string[], timeoutMs: number): Promise<{ text: string; disabled: boolean } | null> {
  const t0 = Date.now()
  const deadline = t0 + timeoutMs
  // Some pages auto-scan on mount (privacy/services/debloater/firewall/updates):
  // the scan button stays disabled (or absent) until that first pass finishes, then
  // becomes enabled again. Poll until an enabled matching button appears, then click.
  while (Date.now() < deadline) {
    // Crash guard: a healthy module page always renders at least its scan
    // button. If the page shows <2 <button>s several seconds after nav, the
    // router hit the error boundary (renderer crash) — bail instead of
    // polling the full cap for a button that will never appear.
    const found = await page.evaluate((labels) => {
      const btns = Array.from(document.querySelectorAll('button'))
      for (const label of labels) {
        const b = btns.find((x) => (x.textContent ?? '').trim().toLowerCase().includes(label.toLowerCase()))
        if (!b) continue
        const disabled =
          b.hasAttribute('disabled') ||
          b.getAttribute('aria-disabled') === 'true' ||
          (b as HTMLButtonElement).disabled === true
        return { text: label, disabled }
      }
      return null
    }, texts)
    if (found && !found.disabled) {
      await page.evaluate((label) => {
        const b = Array.from(document.querySelectorAll('button')).find((x) =>
          (x.textContent ?? '').trim().toLowerCase().includes(label.toLowerCase()),
        )
        if (b && !(b as HTMLButtonElement).disabled) b.click()
      }, found.text)
      return found
    }
    // Crash guard: a healthy module page renders at least its scan button. If
    // after a few seconds the page has <2 <button>s AND none matches a scan
    // label, the router likely hit the error boundary (renderer crash) — bail
    // instead of polling the full cap for a button that will never appear.
    if (found === null) {
      const btnCount = await page.evaluate(() => document.querySelectorAll('button').length)
      if (btnCount < 2 && Date.now() - t0 > 6000) return null
    }
    await page.waitForTimeout(2000)
  }
  return null
}

async function waitForIdle(capMs: number, busySelector?: string): Promise<{ idle: boolean; elapsed: number }> {
  const t0 = Date.now()
  const deadline = t0 + capMs
  let idleStreak = 0
  while (Date.now() < deadline) {
    const busy = await page.evaluate((selector) => {
      const spin = document.querySelectorAll('.animate-spin, [class*="animate-spin"]').length
      const customSel = selector ? document.querySelectorAll(selector).length : 0
      const busyBtn = Array.from(document.querySelectorAll('button')).some((b) =>
        /Analisando|Verificando|Auditando|Escan[eê]ando|A carregar|Procurando|Pesquisando|Encontrando|Avaliando|Executando|Otimizando|Lendo|Checking|Loading|Scanning/i.test(
          b.textContent ?? '',
        ),
      )
      return spin + customSel + (busyBtn ? 1 : 0)
    }, busySelector)
    if (busy === 0) {
      idleStreak++
      if (idleStreak >= 2) return { idle: true, elapsed: Date.now() - t0 }
    } else {
      idleStreak = 0
    }
    await page.waitForTimeout(1000)
  }
  return { idle: false, elapsed: Date.now() - t0 }
}
