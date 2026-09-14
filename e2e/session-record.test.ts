import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { _electron as electron } from 'playwright'
import { createLicenseE2EMarker } from './license-e2e'

type RecEvent =
  | { kind: 'console'; level: string; text: string }
  | { kind: 'pageerror'; text: string; stack?: string }
  | { kind: 'requestfailed'; url: string; error: string }
  | { kind: 'unhandledrejection'; text: string }

interface RouteVisit {
  route: string
  title: string
  errors: RecEvent[]
  screenshot: string
}

const ROUTES = [
  '/',
  '/cleaner',
  '/registry',
  '/context-menu',
  '/startup',
  '/disk',
  '/duplicates',
  '/large-files',
  '/empty-folders',
  '/file-shredder',
  '/disk-repair',
  '/disk-maintenance',
  '/network',
  '/hosts-editor',
  '/malware',
  '/game-mode',
  '/windows-tweaks',
  '/benchmark',
  '/clips',
  '/memory',
  '/performance',
  '/uninstaller',
  '/history',
  '/settings',
  '/about',
  '/privacy',
  '/services',
  '/compliance',
  '/vulnerability',
  '/firewall',
  '/power-plans',
  '/debloater',
  '/updates',
  '/installer',
  '/schedules',
  '/activation',
  '/drivers',
]

let electronApp: ElectronApplication
let page: Page
const globalErrors: RecEvent[] = []
const visits: RouteVisit[] = []
const outDir = resolve(__dirname, '.session-record')

function push(kind: RecEvent['kind'], payload: { text: string; stack?: string; url?: string }) {
  const ev: RecEvent =
    kind === 'requestfailed'
      ? { kind, url: payload.url ?? '', error: payload.text }
      : { kind, text: payload.text, ...(payload.stack ? { stack: payload.stack } : {}) }
  globalErrors.push(ev)
  console.log(`[captured] ${kind}: ${payload.text}`)
}

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
      push('console', { text: msg.text() })
    }
  })
  page.on('pageerror', (err) => push('pageerror', { text: err.message, stack: err.stack }))
  page.on('requestfailed', (req) =>
    push('requestfailed', { url: req.url(), text: req.failure()?.errorText ?? 'unknown' }),
  )
  page.on('unhandledrejection', (reason) =>
    push('unhandledrejection', { text: reason instanceof Error ? reason.message : String(reason) }),
  )

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
  const report = { routes: ROUTES.length, visits, globalErrors, summary: summarize(visits, globalErrors) }
  writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`\nReport: ${resolve(outDir, 'report.json')}`)
  await electronApp.close()
})

function summarize(routeVisits: RouteVisit[], errors: RecEvent[]) {
  const byRoute = new Map<string, number>()
  for (const v of routeVisits) {
    if (v.errors.length > 0) byRoute.set(v.route, v.errors.length)
  }
  const failingRoutes = routeVisits.filter((v) => v.errors.length > 0)
  return {
    routesWithErrors: failingRoutes.length,
    routesWithErrorsList: failingRoutes.map((v) => `${v.route} (${v.errors.length})`),
    totalConsoleErrors: errors.filter((e) => e.kind === 'console').length,
    totalPageErrors: errors.filter((e) => e.kind === 'pageerror').length,
    totalRequestFailures: errors.filter((e) => e.kind === 'requestfailed').length,
    totalUnhandledRejections: errors.filter((e) => e.kind === 'unhandledrejection').length,
  }
}

test('record session across all routes', async () => {
  test.setTimeout(0)
  for (const route of ROUTES) {
    const visit: RouteVisit = { route, title: '', errors: [], screenshot: '' }
    try {
      await page.evaluate((r) => {
        window.location.hash = `#${r}`
      }, route)
      await page.waitForTimeout(2500)

      // collect errors that fired during this visit
      const before = globalErrors.length
      visit.errors = globalErrors.slice(before)

      const title = await page.title().catch(() => '')
      visit.title = title

      const shot = `shots${route.replaceAll('/', '_') || '_root'}.png`
      await page.screenshot({ path: resolve(outDir, shot) }).catch(() => {})
      visit.screenshot = shot

      const hash = await page.evaluate(() => window.location.hash)
      if (!hash.includes(route)) {
        visit.errors.push({ kind: 'console', text: `ROUTE DID NOT NAVIGATE: hash=${hash} expected=${route}` })
        globalErrors.push({ kind: 'console', text: `ROUTE DID NOT NAVIGATE: hash=${hash} expected=${route}` })
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      visit.errors.push({ kind: 'pageerror', text: `ROUTE THREW: ${text}` })
      globalErrors.push({ kind: 'pageerror', text: `ROUTE THREW: ${text}` })
    }
    visits.push(visit)
  }
})
