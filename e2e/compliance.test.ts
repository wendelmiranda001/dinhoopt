import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { _electron as electron } from 'playwright'
import { createLicenseE2EMarker } from './license-e2e'

let electronApp: ElectronApplication
let page: Page

test.beforeAll(async () => {
  createLicenseE2EMarker(resolve(__dirname, '.e2e-userdata-compliance'))
  electronApp = await electron.launch({
    args: [
      resolve(__dirname, '../out/main/index.js'),
      `--dinho-data-dir=${resolve(__dirname, '.e2e-userdata-compliance')}`,
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
  await page.evaluate(() => {
    window.location.hash = '#/compliance'
  })
  await page.waitForTimeout(3000)
  // Trigger scan so result-dependent tests can check categories/score/counts
  await page.evaluate(async () => {
    const trigger = (window as Record<string, unknown>).__complianceRunScan as (() => Promise<void>) | undefined
    if (trigger) await trigger()
  })
  try {
    await page.waitForFunction(() => document.body.textContent?.includes('Pontuação de conformidade'), {
      timeout: 120_000,
    })
  } catch {
    // scan may fail — dependent tests will fail with clear message
  }
})

test.afterAll(async () => {
  await electronApp.close()
})

test('should navigate to Compliance page', async () => {
  const hash = await page.evaluate(() => window.location.hash)
  expect(hash).toContain('compliance')
})

test('should render the Compliance page header', async () => {
  const hasTitle = await page.evaluate(() => {
    return document.body.textContent?.includes('Auditor de Conformidade')
  })
  expect(hasTitle).toBe(true)
})

test('should expose compliance IPC handlers', async () => {
  const handlers = await page.evaluate(() => {
    const d = window.dinho as Record<string, unknown>
    return {
      scan: typeof d?.complianceScan,
      apply: typeof d?.complianceApply,
      revert: typeof d?.complianceRevert,
      progress: typeof d?.onComplianceProgress,
    }
  })
  expect(handlers.scan).toBe('function')
  expect(handlers.apply).toBe('function')
  expect(handlers.revert).toBe('function')
  expect(handlers.progress).toBe('function')
})

test('should have an Audit button', async () => {
  const hasAuditButton = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'))
    return buttons.some((b) => b.textContent?.includes('Auditar'))
  })
  expect(hasAuditButton).toBe(true)
})

test('should render category sections after scan', async () => {
  const categories = [
    'Política de Senhas',
    'Auditoria e Logging',
    'Segurança de Rede',
    'Windows Update',
    'BitLocker',
    'Firewall',
    'Controle de Contas (UAC)',
  ]
  for (const cat of categories) {
    const found = await page.evaluate((c) => {
      return document.body.textContent?.includes(c)
    }, cat)
    expect(found).toBe(true)
  }
})

test('should show compliance score section', async () => {
  const hasScore = await page.evaluate(() => {
    return document.body.textContent?.includes('Pontuação de conformidade')
  })
  expect(hasScore).toBe(true)
})

test('should display Compliant and Non-Compliant counts', async () => {
  const hasCounts = await page.evaluate(() => {
    return document.body.textContent?.includes('Conforme') && document.body.textContent?.includes('Não conforme')
  })
  expect(hasCounts).toBe(true)
})
