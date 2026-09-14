import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC } from '@shared/channels'
import { CleanerType } from '@shared/enums'
import type { CleanResult, ScanItem, ScanResult } from '@shared/types'
import { ipcMain } from 'electron'
import { getPlatform } from '../platform'
import { cleanItems, scanDirectory } from '../services/file-utils'
import { validateStringArray } from '../services/ipc-validation'
import { getLogger } from '../services/logger.service'
import { cacheItems } from '../services/scan-cache'
import { getSettings } from '../services/settings-store'
import type { WindowGetter } from './index'

interface ChromiumBrowserDef {
  key: string
  label: string
  base: string
  cache: string
  codeCache: string
  gpuCache: string
  serviceWorker: string
  hasProfiles: boolean
}

const COOKIE_FILES = ['Cookies', 'Network/Cookies']
const FIREFOX_COOKIE = 'cookies.sqlite'

function scanCookieFiles(
  basePath: string,
  cookieFiles: string[],
  _browserLabel: string,
  _profile: string,
  category: string,
): ScanItem[] {
  const items: ScanItem[] = []
  for (const cookieFile of cookieFiles) {
    const fullPath = join(basePath, cookieFile)
    if (existsSync(fullPath)) {
      try {
        const size = statSync(fullPath).size
        items.push({
          id: randomUUID(),
          path: fullPath,
          size,
          category,
          subcategory: 'Cookies',
          lastModified: 0,
          selected: true,
        })
      } catch {
        /* skip */
      }
    }
  }
  return items
}

export function registerBrowserCleanerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.BROWSER_SCAN, async (): Promise<ScanResult[]> => {
    getLogger().info('browser-cleaner', 'Starting browser scan...')
    const results: ScanResult[] = []
    const category = CleanerType.Browser
    const browserPaths = getPlatform().paths.browserPaths()

    const chromiumBrowsers: ChromiumBrowserDef[] = [
      { key: 'chrome', label: 'Chrome', ...browserPaths.chrome, hasProfiles: true },
      { key: 'edge', label: 'Edge', ...browserPaths.edge, hasProfiles: true },
      { key: 'brave', label: 'Brave', ...browserPaths.brave, hasProfiles: true },
      { key: 'vivaldi', label: 'Vivaldi', ...browserPaths.vivaldi, hasProfiles: true },
      // Opera stores profiles differently — cache is directly under the base path
      { key: 'opera', label: 'Opera', ...browserPaths.opera, hasProfiles: false },
      { key: 'operaGX', label: 'Opera GX', ...browserPaths.operaGX, hasProfiles: false },
      { key: 'arc', label: 'Arc', ...browserPaths.arc, hasProfiles: true },
      { key: 'chromium', label: 'Chromium', ...browserPaths.chromium, hasProfiles: true },
      { key: 'thorium', label: 'Thorium', ...browserPaths.thorium, hasProfiles: true },
      { key: 'supermium', label: 'Supermium', ...browserPaths.supermium, hasProfiles: true },
      { key: 'helium', label: 'Helium', ...browserPaths.helium, hasProfiles: true },
      { key: 'cromite', label: 'Cromite', ...browserPaths.cromite, hasProfiles: true },
      { key: 'catsxp', label: 'CatsXP', ...browserPaths.catsxp, hasProfiles: true },
    ]

    // Scan all Chromium-based browsers
    for (const browser of chromiumBrowsers) {
      if (!existsSync(browser.base)) continue

      if (browser.hasProfiles) {
        const profiles = await getChromiumProfiles(browser.base)
        for (const profile of profiles) {
          const cacheDirs = [
            { dir: browser.cache, label: 'Cache' },
            { dir: browser.codeCache, label: 'Code Cache' },
            { dir: browser.gpuCache, label: 'GPU Cache' },
            { dir: browser.serviceWorker, label: 'Service Worker Cache' },
          ]
          for (const { dir, label } of cacheDirs) {
            const cachePath = join(browser.base, profile, dir)
            if (existsSync(cachePath)) {
              const result = await scanDirectory(cachePath, category, `${browser.label} - ${profile} ${label}`)
              if (result.items.length > 0) {
                cacheItems(result.items)
                results.push(result)
              }
            }
          }
          // Cookies
          const profilePath = join(browser.base, profile)
          const cookieItems = scanCookieFiles(profilePath, COOKIE_FILES, browser.label, profile, category)
          if (cookieItems.length > 0) {
            cacheItems(cookieItems)
            results.push({
              category,
              subcategory: 'Cookies',
              group: browser.label,
              items: cookieItems,
              totalSize: cookieItems.reduce((s, i) => s + i.size, 0),
              itemCount: cookieItems.length,
            })
          }
        }
      } else {
        // Opera-style: cache dirs directly under base
        const cacheDirs = [
          { dir: browser.cache, label: 'Cache' },
          { dir: browser.codeCache, label: 'Code Cache' },
          { dir: browser.gpuCache, label: 'GPU Cache' },
          { dir: browser.serviceWorker, label: 'Service Worker Cache' },
        ]
        for (const { dir, label } of cacheDirs) {
          const cachePath = join(browser.base, dir)
          if (existsSync(cachePath)) {
            const result = await scanDirectory(cachePath, category, `${browser.label} - ${label}`)
            if (result.items.length > 0) {
              cacheItems(result.items)
              results.push(result)
            }
          }
        }
        // Cookies
        const cookieItems = scanCookieFiles(browser.base, COOKIE_FILES, browser.label, 'Default', category)
        if (cookieItems.length > 0) {
          cacheItems(cookieItems)
          results.push({
            category,
            subcategory: 'Cookies',
            group: browser.label,
            items: cookieItems,
            totalSize: cookieItems.reduce((s, i) => s + i.size, 0),
            itemCount: cookieItems.length,
          })
        }
      }
    }

    // Firefox
    if (existsSync(browserPaths.firefox.cache)) {
      try {
        const profileDirs = await readdir(browserPaths.firefox.cache, { withFileTypes: true })
        for (const dir of profileDirs) {
          if (dir.isDirectory()) {
            const cachePath = join(browserPaths.firefox.cache, dir.name, 'cache2', 'entries')
            if (existsSync(cachePath)) {
              const result = await scanDirectory(cachePath, category, `Firefox - ${dir.name} Cache`)
              if (result.items.length > 0) {
                cacheItems(result.items)
                results.push(result)
              }
            }
          }
        }
      } catch {
        getLogger().warning('browser-cleaner', 'Skipped inaccessible Firefox cache')
      }
    }
    // Firefox cookies (in base profiles dir, not cache dir)
    if (browserPaths.firefox.base && existsSync(browserPaths.firefox.base)) {
      try {
        const profileDirs = await readdir(browserPaths.firefox.base, { withFileTypes: true })
        for (const dir of profileDirs) {
          if (dir.isDirectory()) {
            const cookieItems = scanCookieFiles(
              join(browserPaths.firefox.base, dir.name),
              [FIREFOX_COOKIE],
              'Firefox',
              dir.name,
              category,
            )
            if (cookieItems.length > 0) {
              cacheItems(cookieItems)
              results.push({
                category,
                subcategory: 'Cookies',
                group: 'Firefox',
                items: cookieItems,
                totalSize: cookieItems.reduce((s, i) => s + i.size, 0),
                itemCount: cookieItems.length,
              })
            }
          }
        }
      } catch {
        getLogger().warning('browser-cleaner', 'Skipped inaccessible Firefox profiles')
      }
    }

    // Firefox forks — Zen is excluded here because it's already covered by the app scanner (zen-browser in apps.json)
    const firefoxForks = [
      { key: 'librewolf', label: 'LibreWolf', ...browserPaths.librewolf },
      { key: 'waterfox', label: 'Waterfox', ...browserPaths.waterfox },
      { key: 'floorp', label: 'Floorp', ...browserPaths.floorp },
    ]
    for (const fork of firefoxForks) {
      if (!fork.cache || !existsSync(fork.cache)) continue
      try {
        const profileDirs = await readdir(fork.cache, { withFileTypes: true })
        for (const dir of profileDirs) {
          if (dir.isDirectory()) {
            const cachePath = join(fork.cache, dir.name, 'cache2')
            if (existsSync(cachePath)) {
              const result = await scanDirectory(cachePath, category, `${fork.label} - ${dir.name} Cache`)
              if (result.items.length > 0) {
                cacheItems(result.items)
                results.push(result)
              }
            }
          }
        }
      } catch {
        getLogger().warning('browser-cleaner', `Skipped inaccessible ${fork.label} cache`)
      }
      // Fork cookies
      if (fork.base && existsSync(fork.base)) {
        try {
          const profileDirs = await readdir(fork.base, { withFileTypes: true })
          for (const dir of profileDirs) {
            if (dir.isDirectory()) {
              const cookieItems = scanCookieFiles(
                join(fork.base, dir.name),
                [FIREFOX_COOKIE],
                fork.label,
                dir.name,
                category,
              )
              if (cookieItems.length > 0) {
                cacheItems(cookieItems)
                results.push({
                  category,
                  subcategory: 'Cookies',
                  group: fork.label,
                  items: cookieItems,
                  totalSize: cookieItems.reduce((s, i) => s + i.size, 0),
                  itemCount: cookieItems.length,
                })
              }
            }
          }
        } catch {
          getLogger().warning('browser-cleaner', `Skipped inaccessible ${fork.label} profiles`)
        }
      }
    }

    // Safari (macOS only) — cache directory only, never cookies/history/bookmarks
    if (browserPaths.safari && existsSync(browserPaths.safari.cache)) {
      const result = await scanDirectory(browserPaths.safari.cache, category, 'Safari - Cache')
      if (result.items.length > 0) {
        cacheItems(result.items)
        results.push(result)
      }
    }

    const win = getWindow()
    if (win && !win.isDestroyed())
      win.webContents.send(IPC.SCAN_PROGRESS, {
        phase: 'scanning',
        category,
        currentPath: 'Browser scan complete',
        progress: 100,
        itemsFound: results.reduce((s, r) => s + r.itemCount, 0),
        sizeFound: results.reduce((s, r) => s + r.totalSize, 0),
      })

    getLogger().success('browser-cleaner', 'Browser scan completed')
    return results
  })

  ipcMain.handle(IPC.BROWSER_CLEAN, async (_event, itemIds: string[]): Promise<CleanResult> => {
    getLogger().info('browser-cleaner', 'Starting browser clean...')
    const valid = validateStringArray(itemIds)
    if (!valid) {
      getLogger().warning('browser-cleaner', 'Invalid item IDs received for browser clean')
      return { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }
    }
    const settings = getSettings()
    if (settings.cleaner.closeBrowsersBeforeClean) {
      await getPlatform().browser.closeBrowsers()
    }
    return cleanItems(valid, (processed, total, currentPath, cleanedSize) => {
      const win = getWindow()
      if (win && !win.isDestroyed())
        win.webContents.send(IPC.SCAN_PROGRESS, {
          phase: 'cleaning',
          category: CleanerType.Browser,
          currentPath,
          progress: total > 0 ? (processed / total) * 100 : 100,
          itemsFound: total,
          sizeFound: cleanedSize,
        })
    }).then((result) => {
      getLogger().success(
        'browser-cleaner',
        `Browser clean completed — ${result.totalCleaned} bytes cleaned, ${result.filesDeleted} files deleted`,
      )
      return result
    })
  })
}

async function getChromiumProfiles(basePath: string): Promise<string[]> {
  const profiles = ['Default']
  try {
    const entries = await readdir(basePath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('Profile ')) {
        profiles.push(entry.name)
      }
    }
  } catch {
    getLogger().warning('browser-cleaner', 'Skipped inaccessible Chromium profiles directory')
  }
  return profiles
}
