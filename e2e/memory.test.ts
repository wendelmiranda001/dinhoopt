import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { _electron as electron } from 'playwright'
import { createLicenseE2EMarker } from './license-e2e'

let electronApp: ElectronApplication
let page: Page

test.beforeAll(async () => {
  createLicenseE2EMarker(resolve(__dirname, '.e2e-userdata-memory'))
  electronApp = await electron.launch({
    args: [
      resolve(__dirname, '../out/main/index.js'),
      `--dinho-data-dir=${resolve(__dirname, '.e2e-userdata-memory')}`,
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

test('should navigate to Memory Optimizer page', async () => {
  await page.evaluate(() => {
    window.location.hash = '#/memory'
  })
  await page.waitForTimeout(1500)
  const hash = await page.evaluate(() => window.location.hash)
  expect(hash).toContain('memory')
})

test('should render the Memory Optimizer page header', async () => {
  const hasTitle = await page.evaluate(() => {
    return document.body.textContent?.includes('Otimizador de Memória')
  })
  expect(hasTitle).toBe(true)
})

test('should expose memory IPC handlers', async () => {
  const handlers = await page.evaluate(() => {
    const d = window.dinho as Record<string, unknown>
    return {
      info: typeof d?.memoryInfo,
      optimize: typeof d?.memoryOptimize,
      progress: typeof d?.onMemoryProgress,
    }
  })
  expect(handlers.info).toBe('function')
  expect(handlers.optimize).toBe('function')
  expect(handlers.progress).toBe('function')
})

test('should display memory usage section', async () => {
  await page.waitForFunction(() => document.body.textContent?.includes('Uso de Memória'), { timeout: 15000 })
  const hasMemoryUsage = await page.evaluate(() => document.body.textContent?.includes('Uso de Memória'))
  expect(hasMemoryUsage).toBe(true)
})

test('should display health score section', async () => {
  const hasHealthScore = await page.evaluate(() => document.body.textContent?.includes('Pontuação de Saúde'))
  expect(hasHealthScore).toBe(true)
})

test('should have an Optimize Memory button', async () => {
  const hasOptimize = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'))
    return buttons.some((b) => b.textContent?.includes('Otimizar Memória'))
  })
  expect(hasOptimize).toBe(true)
})

test('should have a Refresh button', async () => {
  const hasRefresh = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'))
    return buttons.some((b) => b.textContent?.includes('Atualizar'))
  })
  expect(hasRefresh).toBe(true)
})

test('should display top processes section', async () => {
  const hasTopProcesses = await page.evaluate(() => {
    return document.body.textContent?.includes('Principais Processos')
  })
  expect(hasTopProcesses).toBe(true)
})
