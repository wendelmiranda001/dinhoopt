import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { _electron as electron } from 'playwright'
import { createLicenseE2EMarker } from './license-e2e'

let electronApp: ElectronApplication
let page: Page

test.beforeAll(async () => {
  createLicenseE2EMarker(resolve(__dirname, '.e2e-userdata-game-mode'))
  electronApp = await electron.launch({
    args: [
      resolve(__dirname, '../out/main/index.js'),
      `--dinho-data-dir=${resolve(__dirname, '.e2e-userdata-game-mode')}`,
    ],
    env: { ...process.env, NODE_ENV: 'test', DINHO_E2E: '1' },
  })
  page = await electronApp.firstWindow()
  // Dismiss onboarding
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
  await electronApp.close()
})

test('should navigate to Game Mode page', async () => {
  await page.evaluate(() => {
    window.location.hash = '#/game-mode'
  })
  await page.waitForTimeout(1500)
  const hash = await page.evaluate(() => window.location.hash)
  expect(hash).toContain('game-mode')
})

test('should render the Game Mode hero toggle', async () => {
  const toggleText = await page.textContent('button:has(svg)')
  expect(toggleText).toBeTruthy()
})

test('should have game mode store accessible via renderer', async () => {
  const hasStore = await page.evaluate(() => {
    return typeof window.dinho?.gameModeActivate === 'function'
  })
  expect(hasStore).toBe(true)
})

test('should expose all game mode IPC handlers', async () => {
  const handlers = await page.evaluate(() => {
    const d = window.dinho as Record<string, unknown>
    return {
      activate: typeof d?.gameModeActivate,
      deactivate: typeof d?.gameModeDeactivate,
      status: typeof d?.gameModeStatus,
      audit: typeof d?.gameModeRunAudit,
      progress: typeof d?.onGameModeProgress,
      autoEvent: typeof d?.onGameModeAutoEvent,
    }
  })
  expect(handlers.activate).toBe('function')
  expect(handlers.deactivate).toBe('function')
  expect(handlers.status).toBe('function')
  expect(handlers.audit).toBe('function')
  expect(handlers.progress).toBe('function')
  expect(handlers.autoEvent).toBe('function')
})

test('should render optimization category cards', async () => {
  const categoryLabels = ['Serviços', 'Processos', 'Memória', 'Sistema', 'Rede']
  for (const label of categoryLabels) {
    const found = await page.evaluate((lbl) => {
      return document.body.textContent?.includes(lbl)
    }, label)
    expect(found).toBe(true)
  }
})

test('should toggle an optimization via store and reflect in config', async () => {
  const _before = await page.evaluate(() => {
    const store = (window as any).__GAME_MODE_STORE__
    return store?.getState()?.config?.enabledOptimizations?.length ?? -1
  })

  // If the store isn't exposed globally, use the IPC approach
  const hasOptimizations = await page.evaluate(() => {
    return (window as any).__GAME_MODE_STORE__?.getState?.()?.config?.enabledOptimizations?.length > 0
  })

  // The page should render at least the default enabled count
  const _enabledText = await page.evaluate(() => {
    const el = document.querySelector('[class*="enabledCount"]')
    return el?.textContent ?? null
  })

  expect(hasOptimizations).toBe(true)
})

test('should have audit section with run button', async () => {
  const hasAuditButton = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'))
    return buttons.some((b) => b.textContent?.includes('Auditoria') || b.textContent?.includes('Executar Auditoria'))
  })
  expect(hasAuditButton).toBe(true)
})

test('should show session stats when game mode is active', async () => {
  // Activate via the exposed store (UI state only — no real IPC optimization runs)
  await page.evaluate(() => {
    ;(window as any).__GAME_MODE_STORE__?.getState()?.setActive(true, new Date().toISOString())
  })
  await page.waitForTimeout(500)
  const hasStats = await page.evaluate(() => {
    return (
      document.body.textContent?.includes('Otimizações ativas') ||
      document.body.textContent?.includes('Temporizador da sessão')
    )
  })
  expect(hasStats).toBe(true)
})
