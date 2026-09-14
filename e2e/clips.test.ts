import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { _electron as electron } from 'playwright'
import { createLicenseE2EMarker } from './license-e2e'

let electronApp: ElectronApplication
let page: Page

test.beforeAll(async () => {
  createLicenseE2EMarker(resolve(__dirname, '.e2e-userdata-clips'))
  electronApp = await electron.launch({
    args: [resolve(__dirname, '../out/main/index.js'), `--dinho-data-dir=${resolve(__dirname, '.e2e-userdata-clips')}`],
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
  await page.evaluate(() => {
    window.location.hash = '#/clips'
  })
  await page.waitForTimeout(3000)
})

test.afterAll(async () => {
  await electronApp.close()
})

test('should navigate to Clips page', async () => {
  const hash = await page.evaluate(() => window.location.hash)
  expect(hash).toContain('clips')
})

test('should render the Clips page header', async () => {
  const hasTitle = await page.evaluate(() => {
    return (
      document.body.textContent?.includes('Clipes de Jogo') ||
      document.body.textContent?.includes('Game Clips') ||
      document.body.textContent?.includes('Clips')
    )
  })
  expect(hasTitle).toBe(true)
})

test('should expose clips IPC handlers', async () => {
  const handlers = await page.evaluate(() => {
    const d = window.dinho as Record<string, unknown>
    return {
      startEngine: typeof d?.clipsStartEngine,
      stopEngine: typeof d?.clipsStopEngine,
      saveClip: typeof d?.clipsSaveClip,
      startCapture: typeof d?.clipsStartCapture,
      stopCapture: typeof d?.clipsStopCapture,
      listClips: typeof d?.clipsList,
      deleteClip: typeof d?.clipsDelete,
      getConfig: typeof d?.clipsGetConfig,
      setConfig: typeof d?.clipsSetConfig,
      getVideoUrl: typeof d?.clipsGetVideoUrl,
    }
  })
  expect(handlers.startEngine).toBe('function')
  expect(handlers.stopEngine).toBe('function')
  expect(handlers.saveClip).toBe('function')
  expect(handlers.startCapture).toBe('function')
  expect(handlers.stopCapture).toBe('function')
  expect(handlers.listClips).toBe('function')
  expect(handlers.deleteClip).toBe('function')
  expect(handlers.getConfig).toBe('function')
  expect(handlers.setConfig).toBe('function')
  expect(handlers.getVideoUrl).toBe('function')
})

test('should expose __clipsSaveClip E2E hook', async () => {
  const hasHook = await page.evaluate(() => {
    return typeof (window as Record<string, unknown>).__clipsSaveClip === 'function'
  })
  expect(hasHook).toBe(true)
})
