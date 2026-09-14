import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { _electron as electron } from 'playwright'
import { createLicenseE2EMarker } from './license-e2e'

let electronApp: ElectronApplication
let page: Page

test.beforeAll(async () => {
  createLicenseE2EMarker(resolve(__dirname, '.e2e-userdata-app'))
  electronApp = await electron.launch({
    args: [resolve(__dirname, '../out/main/index.js'), `--dinho-data-dir=${resolve(__dirname, '.e2e-userdata-app')}`],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DINHO_E2E: '1',
    },
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

test('should display the app window', async () => {
  const title = await page.title()
  expect(title).toBeTruthy()
})

test('should expose dinho API in the renderer', async () => {
  const hasKudu = await page.evaluate(() => typeof window.dinho !== 'undefined')
  expect(hasKudu).toBe(true)
})

test('should navigate to Activation page', async () => {
  await page.evaluate(() => {
    window.location.hash = '#/activation'
  })
  await page.waitForTimeout(1000)
  const hash = await page.evaluate(() => window.location.hash)
  expect(hash).toContain('activation')
})
