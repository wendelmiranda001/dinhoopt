import { resolve } from 'node:path'
import { test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { createLicenseE2EMarker } from './license-e2e'

test('dump buttons on problem routes', async () => {
  test.setTimeout(180_000)
  createLicenseE2EMarker(resolve(__dirname, '.dbg-userdata'))
  const app = await electron.launch({
    args: [resolve(__dirname, '../out/main/index.js'), `--dinho-data-dir=${resolve(__dirname, '.dbg-userdata')}`],
    env: { ...process.env, NODE_ENV: 'test', DINHO_E2E: '1' },
  })
  const page = await app.firstWindow()
  await page.evaluate(async () => {
    const d = window.dinho as Record<string, unknown>
    await (d?.onboardingSet as ((v: boolean) => Promise<void>) | undefined)?.(true)
  })
  await page.reload()
  await page.waitForTimeout(2000)

  for (const route of ['/privacy', '/services', '/debloater', '/firewall', '/updates', '/compliance']) {
    await page.evaluate((r) => (window.location.hash = `#${r}`), route)
    await page.waitForTimeout(6000)
    const btns = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .map(
          (b) =>
            `${(b.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50)}|disabled=${b.hasAttribute('disabled')}`,
        )
        .filter((x) => x.trim().length > 3),
    )
    console.log(`\n=== ${route} ===`)
    console.log(btns.join('\n'))
  }
  await app.close()
})
