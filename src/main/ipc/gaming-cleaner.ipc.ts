import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC } from '@shared/channels'
import { CleanerType } from '@shared/enums'
import type { CleanResult, ScanItem, ScanResult } from '@shared/types'
import { ipcMain } from 'electron'
import { getPlatform } from '../platform'
import { execNativeUtf8 } from '../services/exec-utf8'
import { cleanItems, getDirectorySize, scanDirectoriesAsItems } from '../services/file-utils'
import { validateStringArray } from '../services/ipc-validation'
import { getLogger } from '../services/logger.service'
import { cacheItems } from '../services/scan-cache'
import type { WindowGetter } from './index'

export function registerGamingCleanerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.GAMING_SCAN, async (): Promise<ScanResult[]> => {
    getLogger().info('gaming-cleaner', 'Starting gaming scan...')
    const results: ScanResult[] = []
    const category = CleanerType.Gaming

    // Launcher caches — directory-level items, one row per launcher
    for (const launcher of getPlatform().paths.gamingPaths()) {
      try {
        const result = await scanDirectoriesAsItems(launcher.paths, category, launcher.name, 'Launcher Caches')
        if (result.items.length > 0) {
          cacheItems(result.items)
          results.push(result)
        }
      } catch (err) {
        getLogger().debug('gaming-cleaner', `Launcher cache scan skipped (${launcher.name}): ${String(err)}`)
      }
    }

    // GPU shader caches — directory-level items, one row per vendor
    for (const gpu of getPlatform().paths.gpuCachePaths()) {
      try {
        const result = await scanDirectoriesAsItems(gpu.paths, category, gpu.name, 'GPU Shader Caches')
        if (result.items.length > 0) {
          cacheItems(result.items)
          results.push(result)
        }
      } catch (err) {
        getLogger().debug('gaming-cleaner', `GPU cache scan skipped (${gpu.name}): ${String(err)}`)
      }
    }

    // Per-game Steam shader caches — one row per game
    try {
      const shaderResults = await scanSteamShaderCaches(category)
      for (const r of shaderResults) cacheItems(r.items)
      results.push(...shaderResults)
    } catch (err) {
      getLogger().debug('gaming-cleaner', `Steam shader cache scan failed: ${String(err)}`)
    }

    // Per-game redistributables — one row per game
    try {
      const redistResults = await scanSteamRedistributables(category)
      for (const r of redistResults) cacheItems(r.items)
      results.push(...redistResults)
    } catch (err) {
      getLogger().debug('gaming-cleaner', `Steam redistributables scan failed: ${String(err)}`)
    }

    const win = getWindow()
    if (win && !win.isDestroyed())
      win.webContents.send(IPC.SCAN_PROGRESS, {
        phase: 'scanning',
        category,
        currentPath: 'Gaming scan complete',
        progress: 100,
        itemsFound: results.reduce((s, r) => s + r.itemCount, 0),
        sizeFound: results.reduce((s, r) => s + r.totalSize, 0),
      })

    getLogger().success('gaming-cleaner', `Gaming scan completed: ${results.length} categories found`)
    return results
  })

  ipcMain.handle(IPC.GAMING_CLEAN, async (_event, itemIds: string[]): Promise<CleanResult> => {
    getLogger().info('gaming-cleaner', 'Starting gaming clean...')
    const valid = validateStringArray(itemIds)
    if (!valid) {
      getLogger().warning('gaming-cleaner', 'Invalid item IDs provided for gaming clean')
      return { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }
    }
    const result = await cleanItems(valid, (processed, total, currentPath, cleanedSize) => {
      const win = getWindow()
      if (win && !win.isDestroyed())
        win.webContents.send(IPC.SCAN_PROGRESS, {
          phase: 'cleaning',
          category: CleanerType.Gaming,
          currentPath,
          progress: (processed / total) * 100,
          itemsFound: total,
          sizeFound: cleanedSize,
        })
    })
    getLogger().success('gaming-cleaner', `Gaming clean completed: ${result?.filesDeleted ?? 0} files cleaned`)
    return result
  })
}

// ---------------------------------------------------------------------------
// Steam library discovery
// ---------------------------------------------------------------------------

/**
 * Query the Windows registry to discover Steam's real install directory.
 * Falls back to null if the registry key is unavailable (Steam not installed).
 */
async function detectSteamFromRegistry(): Promise<string | null> {
  try {
    const { stdout } = await execNativeUtf8('reg', [
      'query',
      'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam',
      '/v',
      'InstallPath',
    ])
    const match = stdout.match(/REG_SZ\s+(.+)$/m)
    if (!match) return null
    return match[1]!.trim()
  } catch (err) {
    getLogger().debug('gaming-cleaner', `Steam registry detection failed: ${String(err)}`)
    return null
  }
}

async function getSteamLibraryPaths(): Promise<string[]> {
  const libraries: Set<string> = new Set()

  // Try dynamic detection from Windows registry first; fall back to
  // the hardcoded path list from steam.json.
  const registryDir = await detectSteamFromRegistry()
  const searchDirs = registryDir ? [registryDir] : getPlatform().paths.steamLibraries()

  for (const steamDir of searchDirs) {
    const vdfPath = join(steamDir, 'steamapps', 'libraryfolders.vdf')
    try {
      const content = await readFile(vdfPath, 'utf-8')
      const pathMatches = content.matchAll(/"path"\s+"([^"]+)"/g)
      for (const match of pathMatches) {
        libraries.add(match[1]!.replace(/\\\\/g, '\\'))
      }
    } catch (err) {
      getLogger().debug('gaming-cleaner', `Failed to read libraryfolders.vdf (${vdfPath}): ${String(err)}`)
    }
  }

  for (const dir of searchDirs) {
    if (existsSync(join(dir, 'steamapps'))) {
      libraries.add(dir)
    }
  }

  return Array.from(libraries)
}

async function buildAppIdMap(steamAppsDir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const files = await readdir(steamAppsDir)
    for (const file of files) {
      if (!file.startsWith('appmanifest_') || !file.endsWith('.acf')) continue
      try {
        const content = await readFile(join(steamAppsDir, file), 'utf-8')
        const idMatch = content.match(/"appid"\s+"(\d+)"/)
        const nameMatch = content.match(/"name"\s+"([^"]+)"/)
        if (idMatch && nameMatch) {
          map.set(idMatch[1]!, nameMatch[1]!)
        }
      } catch (err) {
        getLogger().debug('gaming-cleaner', `Skipped unreadable manifest (${file}): ${String(err)}`)
      }
    }
  } catch (err) {
    getLogger().debug('gaming-cleaner', `Failed to read app manifest dir (${steamAppsDir}): ${String(err)}`)
  }
  return map
}

// ---------------------------------------------------------------------------
// Per-game Steam shader caches
// ---------------------------------------------------------------------------

async function scanSteamShaderCaches(category: CleanerType): Promise<ScanResult[]> {
  const results: ScanResult[] = []
  const libraries = await getSteamLibraryPaths()

  for (const libPath of libraries) {
    const steamAppsDir = join(libPath, 'steamapps')
    const shaderDir = join(steamAppsDir, 'shadercache')
    if (!existsSync(shaderDir)) continue

    const appIdMap = await buildAppIdMap(steamAppsDir)

    try {
      const entries = await readdir(shaderDir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const cacheDir = join(shaderDir, entry.name)

        try {
          const size = await getDirectorySize(cacheDir)
          if (size < 1024) continue

          const gameName = appIdMap.get(entry.name) || `Unknown (${entry.name})`
          const subcategory = `${gameName} — Shader Cache`

          results.push({
            category,
            subcategory,
            group: 'Game Shader Caches',
            items: [
              {
                id: randomUUID(),
                path: cacheDir,
                size,
                category,
                subcategory,
                lastModified: Date.now(),
                selected: true,
              },
            ],
            totalSize: size,
            itemCount: 1,
          })
        } catch (err) {
          getLogger().debug('gaming-cleaner', `Skipped shader cache: ${entry.name}: ${err}`)
        }
      }
    } catch (err) {
      getLogger().debug('gaming-cleaner', `Failed to list shader cache dir (${shaderDir}): ${String(err)}`)
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Per-game redistributables
// ---------------------------------------------------------------------------

async function scanSteamRedistributables(category: CleanerType): Promise<ScanResult[]> {
  const results: ScanResult[] = []
  const libraries = await getSteamLibraryPaths()

  for (const libPath of libraries) {
    const commonDir = join(libPath, 'steamapps', 'common')
    if (!existsSync(commonDir)) continue

    try {
      const games = await readdir(commonDir, { withFileTypes: true })

      for (const game of games) {
        if (!game.isDirectory()) continue
        const gameDir = join(commonDir, game.name)
        const gameItems: ScanItem[] = []
        let gameSize = 0
        const subcategory = `${game.name} — Redistributables`

        // Check top-level redist patterns
        for (const pattern of getPlatform().paths.steamRedistPatterns()) {
          const redistPath = join(gameDir, pattern)
          if (!existsSync(redistPath)) continue

          try {
            const stats = await stat(redistPath)
            const size = stats.isDirectory() ? await getDirectorySize(redistPath) : stats.size

            if (size < 1024) continue

            gameItems.push({
              id: randomUUID(),
              path: redistPath,
              size,
              category,
              subcategory,
              lastModified: stats.mtimeMs,
              selected: true,
            })
            gameSize += size
          } catch (err) {
            getLogger().debug('gaming-cleaner', `Skipped redist: ${redistPath}: ${err}`)
          }
        }

        // Also scan one level deep for redist folders inside subdirs
        try {
          const subdirs = await readdir(gameDir, { withFileTypes: true })
          for (const sub of subdirs) {
            if (!sub.isDirectory()) continue
            for (const pattern of getPlatform().paths.steamRedistPatterns()) {
              const redistPath = join(gameDir, sub.name, pattern)
              if (!existsSync(redistPath)) continue
              // Avoid duplicates
              if (gameItems.some((i) => i.path === redistPath)) continue

              try {
                const stats = await stat(redistPath)
                const size = stats.isDirectory() ? await getDirectorySize(redistPath) : stats.size

                if (size < 1024) continue

                gameItems.push({
                  id: randomUUID(),
                  path: redistPath,
                  size,
                  category,
                  subcategory,
                  lastModified: stats.mtimeMs,
                  selected: true,
                })
                gameSize += size
              } catch (err) {
                getLogger().debug('gaming-cleaner', `Skipped nested redist (${redistPath}): ${String(err)}`)
              }
            }
          }
        } catch (err) {
          getLogger().debug('gaming-cleaner', `Failed to scan subdirs of ${gameDir}: ${String(err)}`)
        }

        if (gameItems.length > 0) {
          results.push({
            category,
            subcategory,
            group: 'Redistributables',
            items: gameItems,
            totalSize: gameSize,
            itemCount: gameItems.length,
          })
        }
      }
    } catch (err) {
      getLogger().debug('gaming-cleaner', `Failed to scan redistributables for library ${libPath}: ${String(err)}`)
    }
  }

  return results
}
