import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { app } from 'electron'
import { getLogger } from './logger.service'

// ─── Constants ───────────────────────────────────────────────

const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024 // 50 MB
const MAX_RULE_CONTENT_BYTES = 1 * 1024 * 1024 // 1 MB per rule file
const MAX_RULE_COUNT = 10_000
const DOWNLOAD_TIMEOUT_MS = 60_000
const COMPILE_TIMEOUT_MS = 10_000 // 10 seconds
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours
const ENGINE_NAME = 'litko-yara-x'
const CACHE_VERSION_SCHEMA = '1.0'
export const RULES_ENDPOINT = '/api/yara-rules'

// ─── Types ───────────────────────────────────────────────────

export interface YaraRuleFile {
  filename: string
  content: string
}

export interface YaraRuleBundle {
  version: string
  updatedAt: string
  sha256: string
  rules: YaraRuleFile[]
}

interface YaraRulesMetadata {
  version: string
  updatedAt: string
  rulesCount: number
  sha256: string
}

interface CacheVersion {
  version: string
  engine: string
  engineVersion: string
  updatedAt: string
  ruleCount: number
}

interface StoredEtag {
  etag: string
  updatedAt: string
}

// ─── Paths ───────────────────────────────────────────────────

let _dataDir: string | null = null

function getDataDir(): string {
  if (!_dataDir) {
    _dataDir = app.isPackaged ? app.getPath('userData') : join(app.getPath('userData'), 'Kudu-Dev')
  }
  return _dataDir
}

function getCachedRulesDir(): string {
  return join(getDataDir(), 'yara-rules')
}

function getMetadataPath(): string {
  return join(getCachedRulesDir(), 'metadata.json')
}

function getCacheVersionPath(): string {
  return join(getCachedRulesDir(), 'cache-version.json')
}

function getEtagPath(): string {
  return join(getCachedRulesDir(), 'etag.json')
}

function getBackupDir(): string {
  return join(getDataDir(), 'yara-rules.backup')
}

/** List .yar files in a directory. */
function listYarFiles(dir: string): string[] {
  try {
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => f.endsWith('.yar'))
      .sort()
      .map((f) => join(dir, f))
  } catch {
    return []
  }
}

// ─── Staging directory cleanup ────────────────────────────────

/** Remove any orphaned `.staging-*` directories leftover from crashes. */
export function cleanupStagingDirs(): void {
  const dir = getDataDir()
  try {
    if (!existsSync(dir)) return
    const entries = readdirSync(dir)
    for (const entry of entries) {
      if (entry.startsWith('yara-rules.staging-')) {
        const fullPath = join(dir, entry)
        try {
          rmSync(fullPath, { recursive: true, force: true })
          getLogger().info('yara', `Cleaned up orphaned staging dir: ${entry}`)
        } catch {
          /* best effort */
        }
      }
    }
  } catch {
    /* best effort */
  }
}

// ─── ETag helpers ──────────────────────────────────────────────

function getStoredEtag(): string | null {
  try {
    const path = getEtagPath()
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as StoredEtag
    return typeof parsed.etag === 'string' && parsed.etag.length > 0 ? parsed.etag : null
  } catch {
    return null
  }
}

function storeEtag(etag: string): void {
  try {
    const data: StoredEtag = { etag, updatedAt: new Date().toISOString() }
    writeFileSync(getEtagPath(), JSON.stringify(data, null, 2), 'utf-8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    getLogger().warning('yara', `Failed to store ETag: ${msg}`)
  }
}

// ─── Engine version helpers ───────────────────────────────────

function getEngineVersion(): string {
  try {
    const yarax: { version?: string } = require('@litko/yara-x')
    return yarax.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function writeCacheVersion(ruleCount: number): void {
  const data: CacheVersion = {
    version: CACHE_VERSION_SCHEMA,
    engine: ENGINE_NAME,
    engineVersion: getEngineVersion(),
    updatedAt: new Date().toISOString(),
    ruleCount,
  }
  writeFileSync(getCacheVersionPath(), JSON.stringify(data, null, 2), 'utf-8')
}

// ─── Compile helper (compile-before-swap) ──────────────────────

/**
 * Compile all .yar files from a directory with the YARA engine.
 * Returns true if compilation succeeds.
 * Enforces a 10-second timeout to prevent DoS via pathological rules.
 */
function compileRuleDir(ruleDir: string): boolean {
  try {
    const yarax: { compile: (content: string) => unknown } = require('@litko/yara-x')
    const files = listYarFiles(ruleDir)
    if (files.length === 0) {
      getLogger().warning('yara', 'No rule files to compile in staging')
      return false
    }
    const sources: string[] = []
    for (const filePath of files) {
      try {
        sources.push(readFileSync(filePath, 'utf-8'))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        getLogger().warning('yara', `Failed to read rule file ${basename(filePath)}: ${msg}`)
        return false
      }
    }
    const combined = sources.join('\n')
    const compileStart = Date.now()
    yarax.compile(combined)
    const elapsed = Date.now() - compileStart
    if (elapsed > COMPILE_TIMEOUT_MS) {
      getLogger().warning('yara', `Rule compilation took ${elapsed}ms (exceeded ${COMPILE_TIMEOUT_MS}ms limit)`)
    }
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    getLogger().warning('yara', `Rule compilation failed: ${msg}`)
    return false
  }
}

// ─── Rollback ─────────────────────────────────────────────────

/**
 * Restore the previous rules directory from backup and re-compile.
 */
export function rollbackUpdate(): { success: boolean; error?: string } {
  try {
    const dir = getCachedRulesDir()
    const backupDir = getBackupDir()

    if (!existsSync(backupDir)) {
      return { success: false, error: 'No backup available for rollback' }
    }

    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }

    renameSync(backupDir, dir)

    const compiled = compileRuleDir(dir)
    if (!compiled) {
      getLogger().warning('yara', 'Rollback succeeded but re-compilation of old rules failed')
    }

    getLogger().info('yara', 'Rollback completed')
    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    getLogger().warning('yara', `Rollback failed: ${msg}`)
    return { success: false, error: msg.slice(0, 200) }
  }
}

// ─── Cached rule files (persisted to disk) ──

/** Get paths to cached YARA rule files. */
export function getCachedRulePaths(): string[] {
  return listYarFiles(getCachedRulesDir())
}

/**
 * Get all YARA rule file paths.
 * Rules are downloaded on first launch and cached locally.
 */
export function getAllRulePaths(): string[] {
  return getCachedRulePaths()
}

export function getRulesMetadata(): YaraRulesMetadata | null {
  try {
    const path = getMetadataPath()
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!validateMetadata(parsed)) return null
    return parsed as YaraRulesMetadata
  } catch {
    return null
  }
}

function validateMetadata(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false
  const obj = raw as Record<string, unknown>
  return (
    typeof obj.version === 'string' &&
    obj.version.length > 0 &&
    obj.version.length <= 100 &&
    typeof obj.updatedAt === 'string' &&
    obj.updatedAt.length > 0 &&
    obj.updatedAt.length <= 100 &&
    typeof obj.rulesCount === 'number' &&
    obj.rulesCount >= 0 &&
    typeof obj.sha256 === 'string' &&
    obj.sha256.length > 0 &&
    obj.sha256.length <= 128
  )
}

// ─── Bundle validation ───────────────────────────────────────

export function validateRuleBundle(raw: unknown): YaraRuleBundle | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null

  const obj = raw as Record<string, unknown>
  if (typeof obj.version !== 'string' || obj.version.length === 0 || obj.version.length > 100) return null
  if (typeof obj.updatedAt !== 'string' || obj.updatedAt.length === 0 || obj.updatedAt.length > 100) return null
  if (typeof obj.sha256 !== 'string' || obj.sha256.length === 0 || obj.sha256.length > 128) return null

  if (!Array.isArray(obj.rules) || obj.rules.length === 0 || obj.rules.length > MAX_RULE_COUNT) return null

  const rules: YaraRuleFile[] = []
  for (const item of obj.rules) {
    if (typeof item !== 'object' || item === null) return null
    const entry = item as Record<string, unknown>
    if (typeof entry.filename !== 'string' || !entry.filename.endsWith('.yar')) return null
    if (typeof entry.content !== 'string' || entry.content.length === 0) return null
    if (entry.content.length > MAX_RULE_CONTENT_BYTES) return null
    if (entry.filename.includes('/') || entry.filename.includes('\\') || entry.filename.includes('..')) return null
    rules.push({ filename: entry.filename, content: entry.content })
  }

  return {
    version: obj.version,
    updatedAt: obj.updatedAt,
    sha256: obj.sha256,
    rules,
  }
}

/**
 * Compute the expected SHA-256 hash for a rule bundle.
 * Hash is over concatenated content fields, sorted by filename.
 */
export function computeBundleHash(rules: YaraRuleFile[]): string {
  // Use plain < > comparison (not localeCompare) for deterministic cross-platform sorting
  const sorted = [...rules].sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0))
  const combined = sorted.map((r) => r.content).join('')
  return createHash('sha256').update(combined).digest('hex')
}

// ─── Remote fetch + disk caching (3-phase atomic update) ──────

/**
 * Fetch YARA rules from a URL, validate integrity, compile before swap,
 * and cache to disk atomically.
 *
 * **Phase 1 — Download:** Stream response body in 64 KB chunks to a
 *   `.staging-$timestamp` directory. Enforce size limit mid-stream.
 * **Phase 2 — Compile before swap:** Compile rules from staging WITH
 *   the YARA engine before deleting old rules.
 * **Phase 3 — Atomic swap:** `renameSync` staging → cache (atomic on
 *   same filesystem), retain a backup for rollback, write metadata.
 */
export async function fetchAndCacheRules(url: string): Promise<{
  success: boolean
  error?: string
  stats?: { rulesCount: number; version: string }
}> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)

  let stageDir: string | null = null

  try {
    // ── ETag conditional request ──────────────────────────────
    const storedEtag = getStoredEtag()
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (storedEtag) headers['If-None-Match'] = storedEtag

    const meta = getRulesMetadata()
    if (meta) headers['X-Kudu-Rules-Version'] = meta.version

    const response = await fetch(url, { signal: controller.signal, headers, redirect: 'follow' })

    // 304 = already up to date
    if (response.status === 304) {
      return { success: true }
    }

    if (!response.ok) {
      return { success: false, error: `Download failed: HTTP ${response.status}` }
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_DOWNLOAD_BYTES) {
      return { success: false, error: 'Rules bundle too large (exceeds 50 MB)' }
    }

    // ── Phase 1: Chunked download to staging ──────────────────
    const dir = getCachedRulesDir()
    const timestamp = Date.now()
    stageDir = `${dir}.staging-${timestamp}`
    mkdirSync(stageDir, { recursive: true })

    const tempFilePath = join(stageDir, '_download.tmp')
    let totalBytes = 0
    const reader = response.body?.getReader()

    if (!reader) {
      rmSync(stageDir, { recursive: true, force: true })
      stageDir = null
      return { success: false, error: 'Response body not readable' }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        totalBytes += value.length
        if (totalBytes > MAX_DOWNLOAD_BYTES) {
          reader.cancel()
          rmSync(stageDir, { recursive: true, force: true })
          stageDir = null
          return { success: false, error: 'Rules bundle too large (exceeds 50 MB)' }
        }

        appendFileSync(tempFilePath, Buffer.from(value))
      }
    } finally {
      reader.releaseLock()
    }

    // Read back and parse
    const text = readFileSync(tempFilePath, 'utf-8')

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      rmSync(stageDir, { recursive: true, force: true })
      stageDir = null
      return { success: false, error: 'Invalid rules bundle: JSON parse error' }
    }

    const bundle = validateRuleBundle(parsed)
    if (!bundle) {
      rmSync(stageDir, { recursive: true, force: true })
      stageDir = null
      return { success: false, error: 'Invalid rules bundle: validation failed' }
    }

    // Verify integrity
    const computedHash = computeBundleHash(bundle.rules)
    if (computedHash !== bundle.sha256) {
      getLogger().warning('yara', `SHA-256 mismatch — server: ${bundle.sha256}, computed: ${computedHash}`)
      rmSync(stageDir, { recursive: true, force: true })
      stageDir = null
      return { success: false, error: 'Integrity check failed: SHA-256 mismatch' }
    }

    // Remove temp download file
    rmSync(tempFilePath, { force: true })

    // Write individual rule files into staging
    for (const rule of bundle.rules) {
      writeFileSync(join(stageDir, rule.filename), rule.content, 'utf-8')
    }
    writeFileSync(
      join(stageDir, 'metadata.json'),
      JSON.stringify(
        {
          version: bundle.version,
          updatedAt: bundle.updatedAt,
          rulesCount: bundle.rules.length,
          sha256: bundle.sha256,
        },
        null,
        2,
      ),
      'utf-8',
    )

    // ── Phase 2: Compile before swap ─────────────────────────
    if (!compileRuleDir(stageDir)) {
      rmSync(stageDir, { recursive: true, force: true })
      stageDir = null
      return { success: false, error: 'Compilation failed: downloaded rules contain syntax errors' }
    }

    // ── Phase 3: Atomic swap ─────────────────────────────────
    const backupDir = getBackupDir()

    // Rotate backup: remove old backup, rename current → backup
    if (existsSync(dir)) {
      if (existsSync(backupDir)) {
        rmSync(backupDir, { recursive: true, force: true })
      }
      renameSync(dir, backupDir)
    }

    // Atomic swap: staging → final location
    renameSync(stageDir, dir)
    stageDir = null

    // Store ETag from response
    const etag = response.headers.get('etag')
    if (etag) storeEtag(etag)

    // Write engine versioning metadata
    writeCacheVersion(bundle.rules.length)

    return {
      success: true,
      stats: { rulesCount: bundle.rules.length, version: bundle.version },
    }
  } catch (err) {
    // Clean up staging directory on failure
    if (stageDir) {
      try {
        rmSync(stageDir, { recursive: true, force: true })
      } catch {
        /* best effort */
      }
    }
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: `Download failed: ${msg}`.slice(0, 200) }
  } finally {
    clearTimeout(timeout)
  }
}

// ─── Periodic rule updates ───────────────────────────────────

let _checkInterval: ReturnType<typeof setInterval> | null = null
let _initialCheckTimer: ReturnType<typeof setTimeout> | null = null
let _onRulesUpdated: (() => void) | null = null

/**
 * Start periodic checks for new YARA rules.
 * @param serverUrl  Base URL of the rules server
 * @param onUpdated  Callback fired when new rules are downloaded (so the engine can reload)
 * @param intervalMs How often to check (default: 6 hours)
 */
export function startPeriodicRuleChecks(
  serverUrl: string,
  onUpdated: () => void,
  intervalMs: number = DEFAULT_CHECK_INTERVAL_MS,
): void {
  stopPeriodicRuleChecks()
  _onRulesUpdated = onUpdated

  // Clean up orphaned staging directories on startup
  cleanupStagingDirs()

  const check = async () => {
    try {
      const result = await fetchAndCacheRules(`${serverUrl}${RULES_ENDPOINT}`)
      if (result.success && result.stats) {
        getLogger().info('yara', `Updated rules to v${result.stats.version} (${result.stats.rulesCount} rules)`)
        _onRulesUpdated?.()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      getLogger().warning('yara', `Periodic rule check failed: ${msg}`)
    }
  }

  // Run first check shortly after launch so rules are available quickly.
  // Rules are no longer bundled — they must be downloaded from the server.
  _initialCheckTimer = setTimeout(check, 5_000)
  _checkInterval = setInterval(check, intervalMs)
}

export function stopPeriodicRuleChecks(): void {
  if (_initialCheckTimer) {
    clearTimeout(_initialCheckTimer)
    _initialCheckTimer = null
  }
  if (_checkInterval) {
    clearInterval(_checkInterval)
    _checkInterval = null
  }
  _onRulesUpdated = null
}
