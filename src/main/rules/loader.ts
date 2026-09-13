import { homedir } from 'node:os'
import path from 'node:path'
import type { AppCacheDef, BrowserPathConfig, BrowserPaths, CleanTarget, DatabaseTarget } from '../platform/types'
import { getLogger } from '../services/logger.service'

// ─── JSON Rule Types ─────────────────────────────────────

interface CleanTargetEntryJson {
  path: string
  subcategory: string
  needsAdmin?: boolean
  description?: string
}

export interface SystemRuleJson {
  type: 'system'
  cleanTargets: CleanTargetEntryJson[]
  singleFileTargets: Array<{
    path: string
    subcategory: string
    description?: string
  }>
}

export interface BrowsersRuleJson {
  type: 'browsers'
  chromiumCacheDirs: {
    cache: string
    codeCache: string
    gpuCache: string
    serviceWorker: string
  }
  chromium: Array<{ key: string; base: string }>
  firefox: { base: string; cache: string }
  firefoxForks: Array<{ key: string; base: string; cache: string }>
  safari: null
}

export interface AppEntryJson {
  id: string
  name: string
  paths: string[]
  childSubdir?: string
  description?: string
}

export interface AppsRuleJson {
  type: 'apps'
  apps: AppEntryJson[]
}

export interface GamingRuleJson {
  type: 'gaming'
  apps: AppEntryJson[]
}

export interface GpuCacheRuleJson {
  type: 'gpu-cache'
  apps: AppEntryJson[]
}

export interface SteamRuleJson {
  type: 'steam'
  libraries: string[]
  redistPatterns: string[]
}

export interface DatabaseTargetJson {
  label: string
  basePath: string
  dbFiles: string[] | string
  multiProfile?: boolean
  profilePattern?: string[]
  description?: string
}

export interface DatabasesRuleJson {
  type: 'databases'
  sharedDbFileSets: {
    chromium: string[]
    firefox: string[]
  }
  targets: DatabaseTargetJson[]
}

export interface MiscRuleJson {
  type: 'misc'
  protectedEventLogs: string[]
  trashPath: string | null
}

export interface RulesJsonSet {
  system: SystemRuleJson
  browsers: BrowsersRuleJson
  apps: AppsRuleJson
  gaming: GamingRuleJson
  gpuCache: GpuCacheRuleJson
  steam: SteamRuleJson
  databases: DatabasesRuleJson
  misc: MiscRuleJson
}

// ─── Variable Resolution ───────────────────────────────

function getWinVars(): Record<string, string> {
  const home = homedir()
  return {
    LOCALAPPDATA: process.env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'),
    APPDATA: process.env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'),
    WINDIR: process.env.WINDIR || 'C:\\Windows',
    PROGRAMDATA: process.env.ProgramData || 'C:\\ProgramData',
    PROGRAMFILES: process.env.ProgramFiles || 'C:\\Program Files',
    PROGRAMFILES_X86: process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    HOME: home,
  }
}

function resolveVars(template: string, vars: Record<string, string>): string {
  const unresolved = new Set<string>()
  const resolved = template.replace(/\$\{(\w+)\}/g, (_, name: string) => {
    const value = vars[name]
    if (value === undefined) {
      unresolved.add(name)
      return ''
    }
    return value
  })
  if (unresolved.size > 0) {
    const names = [...unresolved].sort().join(', ')
    getLogger().warning('rules-loader', `Unresolved rule variables replaced with empty string: ${names}`)
  }
  return path.win32.normalize(resolved)
}

// ─── buildCleanerPaths ──────────────────────────────────

export function buildCleanerPaths(rulesJson: RulesJsonSet, _platform: string) {
  const vars = getWinVars()
  const { system, browsers, apps, gaming, gpuCache, steam, databases, misc } = rulesJson

  return {
    systemCleanTargets(): CleanTarget[] {
      return system.cleanTargets.map((t) => ({
        path: resolveVars(t.path, vars),
        subcategory: t.subcategory,
        ...(t.needsAdmin ? { needsAdmin: true } : {}),
      }))
    },

    singleFileCleanTargets(): { path: string; subcategory: string }[] {
      return system.singleFileTargets.map((t) => ({
        path: resolveVars(t.path, vars),
        subcategory: t.subcategory,
      }))
    },

    protectedEventLogs(): string[] {
      return [...misc.protectedEventLogs]
    },

    browserPaths(): BrowserPathConfig {
      const { chromiumCacheDirs, chromium, firefox, firefoxForks } = browsers

      const makeChromiumPaths = (base: string): BrowserPaths => {
        const baseDir = resolveVars(base, vars)
        return {
          base: baseDir,
          cache: path.win32.join(baseDir, chromiumCacheDirs.cache),
          codeCache: path.win32.join(baseDir, chromiumCacheDirs.codeCache),
          gpuCache: path.win32.join(baseDir, chromiumCacheDirs.gpuCache),
          serviceWorker: path.win32.join(baseDir, chromiumCacheDirs.serviceWorker),
        }
      }

      const br = Object.fromEntries(chromium.map((e) => [e.key, makeChromiumPaths(e.base)])) as Record<
        string,
        BrowserPaths
      >

      const foxForkMap: Record<string, { base: string; cache: string }> = {}
      for (const entry of firefoxForks) {
        foxForkMap[entry.key] = {
          base: resolveVars(entry.base, vars),
          cache: resolveVars(entry.cache, vars),
        }
      }

      return {
        chrome: br.chrome!,
        edge: br.edge!,
        brave: br.brave!,
        opera: br.opera!,
        operaGX: br.operaGX!,
        vivaldi: br.vivaldi!,
        arc: br.arc!,
        chromium: br.chromium!,
        thorium: br.thorium!,
        supermium: br.supermium!,
        helium: br.helium!,
        cromite: br.cromite!,
        catsxp: br.catsxp!,
        firefox: {
          base: resolveVars(firefox.base, vars),
          cache: resolveVars(firefox.cache, vars),
        },
        librewolf: foxForkMap.librewolf!,
        waterfox: foxForkMap.waterfox!,
        floorp: foxForkMap.floorp!,
        zen: foxForkMap.zen!,
        safari: null,
      }
    },

    appPaths(): AppCacheDef[] {
      return apps.apps.map((a) => ({
        id: a.id,
        name: a.name,
        paths: a.paths.map((p) => resolveVars(p, vars)),
        ...(a.childSubdir ? { childSubdir: a.childSubdir } : {}),
      }))
    },

    gamingPaths(): AppCacheDef[] {
      return gaming.apps.map((a) => ({
        id: a.id,
        name: a.name,
        paths: a.paths.map((p) => resolveVars(p, vars)),
      }))
    },

    gpuCachePaths(): AppCacheDef[] {
      return gpuCache.apps.map((a) => ({
        id: a.id,
        name: a.name,
        paths: a.paths.map((p) => resolveVars(p, vars)),
      }))
    },

    steamLibraries(): string[] {
      return steam.libraries.map((p) => resolveVars(p, vars))
    },

    steamRedistPatterns(): string[] {
      return [...steam.redistPatterns]
    },

    trashPath(): string | null {
      return misc.trashPath
    },

    databaseOptimizeTargets(): DatabaseTarget[] {
      const { sharedDbFileSets, targets } = databases

      const getDbFiles = (dbFiles: string[] | string): string[] => {
        if (typeof dbFiles === 'string') {
          if (dbFiles === '$chromium') return [...sharedDbFileSets.chromium]
          if (dbFiles === '$firefox') return [...sharedDbFileSets.firefox]
          return [dbFiles]
        }
        return [...dbFiles]
      }

      return targets.map((t) => ({
        label: t.label,
        basePath: resolveVars(t.basePath, vars),
        dbFiles: getDbFiles(t.dbFiles),
        ...(t.multiProfile ? { multiProfile: true } : {}),
        ...(t.profilePattern ? { profilePattern: [...t.profilePattern] } : {}),
      }))
    },
  }
}
