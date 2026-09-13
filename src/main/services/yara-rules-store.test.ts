import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Top-level mutable variable for the mock — vi.mock factories capture
// the variable reference, not the value, so beforeEach can set it.
let currentTmpDir = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => currentTmpDir,
    isPackaged: false,
  },
}))

vi.mock('@litko/yara-x', () => ({
  compile: () => {
    if (_yaraCompileShouldFail) throw new Error('Compilation failed: bad rule syntax')
    return { scan: () => [], getWarnings: () => [] }
  },
  create: () => ({
    addRuleSource: () => {},
    scan: () => [],
    getWarnings: () => [],
  }),
  version: '0.5.2',
}))

const sharedLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('./logger.service', () => ({
  getLogger: () => sharedLogger,
}))

// Shared flag for yara-x compile success/failure
let _yaraCompileShouldFail = false

// ─── Replicate pure validation logic to avoid Electron imports ───

const MAX_RULE_CONTENT_BYTES = 1 * 1024 * 1024
const MAX_RULE_COUNT = 10_000

interface YaraRuleFile {
  filename: string
  content: string
}

interface YaraRuleBundle {
  version: string
  updatedAt: string
  sha256: string
  rules: YaraRuleFile[]
}

function validateRuleBundle(raw: unknown): YaraRuleBundle | null {
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

function computeBundleHash(rules: YaraRuleFile[]): string {
  const sorted = [...rules].sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0))
  const combined = sorted.map((r) => r.content).join('')
  return createHash('sha256').update(combined).digest('hex')
}

// ─── validateRuleBundle ──────────────────────────────────────

describe('validateRuleBundle', () => {
  const validBundle = {
    version: '1.0.0',
    updatedAt: '2026-03-28T12:00:00Z',
    sha256: 'abc123',
    rules: [{ filename: 'miners.yar', content: 'rule Test { condition: true }' }],
  }

  it('accepts a valid bundle', () => {
    expect(validateRuleBundle(validBundle)).not.toBeNull()
  })

  it('returns correct fields', () => {
    const result = validateRuleBundle(validBundle)!
    expect(result.version).toBe('1.0.0')
    expect(result.updatedAt).toBe('2026-03-28T12:00:00Z')
    expect(result.sha256).toBe('abc123')
    expect(result.rules).toHaveLength(1)
    expect(result.rules[0]!.filename).toBe('miners.yar')
  })

  it('rejects null', () => {
    expect(validateRuleBundle(null)).toBeNull()
  })

  it('rejects arrays', () => {
    expect(validateRuleBundle([1, 2, 3])).toBeNull()
  })

  it('rejects non-objects', () => {
    expect(validateRuleBundle('string')).toBeNull()
    expect(validateRuleBundle(42)).toBeNull()
  })

  it('rejects missing version', () => {
    const { version, ...rest } = validBundle
    expect(validateRuleBundle(rest)).toBeNull()
  })

  it('rejects empty version', () => {
    expect(validateRuleBundle({ ...validBundle, version: '' })).toBeNull()
  })

  it('rejects missing updatedAt', () => {
    const { updatedAt, ...rest } = validBundle
    expect(validateRuleBundle(rest)).toBeNull()
  })

  it('rejects missing sha256', () => {
    const { sha256, ...rest } = validBundle
    expect(validateRuleBundle(rest)).toBeNull()
  })

  it('rejects empty rules array', () => {
    expect(validateRuleBundle({ ...validBundle, rules: [] })).toBeNull()
  })

  it('rejects non-array rules', () => {
    expect(validateRuleBundle({ ...validBundle, rules: 'not an array' })).toBeNull()
  })

  it('rejects rules without .yar extension', () => {
    expect(
      validateRuleBundle({
        ...validBundle,
        rules: [{ filename: 'test.txt', content: 'rule Test { condition: true }' }],
      }),
    ).toBeNull()
  })

  it('rejects rules with empty content', () => {
    expect(
      validateRuleBundle({
        ...validBundle,
        rules: [{ filename: 'test.yar', content: '' }],
      }),
    ).toBeNull()
  })

  it('rejects path traversal in filename', () => {
    expect(
      validateRuleBundle({
        ...validBundle,
        rules: [{ filename: '../evil.yar', content: 'rule X { condition: true }' }],
      }),
    ).toBeNull()
    expect(
      validateRuleBundle({
        ...validBundle,
        rules: [{ filename: 'sub/test.yar', content: 'rule X { condition: true }' }],
      }),
    ).toBeNull()
    expect(
      validateRuleBundle({
        ...validBundle,
        rules: [{ filename: 'sub\\test.yar', content: 'rule X { condition: true }' }],
      }),
    ).toBeNull()
  })

  it('rejects rules exceeding content size limit', () => {
    expect(
      validateRuleBundle({
        ...validBundle,
        rules: [{ filename: 'big.yar', content: 'x'.repeat(MAX_RULE_CONTENT_BYTES + 1) }],
      }),
    ).toBeNull()
  })

  it('accepts rules at the content size limit', () => {
    expect(
      validateRuleBundle({
        ...validBundle,
        rules: [{ filename: 'big.yar', content: 'x'.repeat(MAX_RULE_CONTENT_BYTES) }],
      }),
    ).not.toBeNull()
  })
})

// ─── computeBundleHash ───────────────────────────────────────

describe('computeBundleHash', () => {
  it('produces consistent hashes for the same content', () => {
    const rules: YaraRuleFile[] = [
      { filename: 'a.yar', content: 'rule A { condition: true }' },
      { filename: 'b.yar', content: 'rule B { condition: true }' },
    ]
    expect(computeBundleHash(rules)).toBe(computeBundleHash(rules))
  })

  it('sorts by filename before hashing (order-independent)', () => {
    const rules1: YaraRuleFile[] = [
      { filename: 'b.yar', content: 'rule B { condition: true }' },
      { filename: 'a.yar', content: 'rule A { condition: true }' },
    ]
    const rules2: YaraRuleFile[] = [
      { filename: 'a.yar', content: 'rule A { condition: true }' },
      { filename: 'b.yar', content: 'rule B { condition: true }' },
    ]
    expect(computeBundleHash(rules1)).toBe(computeBundleHash(rules2))
  })

  it('produces different hashes for different content', () => {
    const rules1: YaraRuleFile[] = [{ filename: 'a.yar', content: 'rule A { condition: true }' }]
    const rules2: YaraRuleFile[] = [{ filename: 'a.yar', content: 'rule B { condition: false }' }]
    expect(computeBundleHash(rules1)).not.toBe(computeBundleHash(rules2))
  })

  it('returns a valid SHA-256 hex string', () => {
    const rules: YaraRuleFile[] = [{ filename: 'test.yar', content: 'rule Test { condition: true }' }]
    const hash = computeBundleHash(rules)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ─── Integrity verification ──────────────────────────────────

describe('bundle integrity verification', () => {
  it('validates correctly when sha256 matches computed hash', () => {
    const rules: YaraRuleFile[] = [{ filename: 'test.yar', content: 'rule Test { condition: true }' }]
    const sha256 = computeBundleHash(rules)
    const bundle = validateRuleBundle({
      version: '1.0.0',
      updatedAt: '2026-03-28T12:00:00Z',
      sha256,
      rules,
    })
    expect(bundle).not.toBeNull()
    expect(computeBundleHash(bundle!.rules)).toBe(sha256)
  })

  it('detects tampered content via hash mismatch', () => {
    const rules: YaraRuleFile[] = [{ filename: 'test.yar', content: 'rule Test { condition: true }' }]
    const sha256 = computeBundleHash(rules)
    const tamperedRules: YaraRuleFile[] = [{ filename: 'test.yar', content: 'rule Malicious { condition: true }' }]
    expect(computeBundleHash(tamperedRules)).not.toBe(sha256)
  })
})

// ─── Metadata validation ─────────────────────────────────────

describe('metadata validation', () => {
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

  it('accepts valid metadata', () => {
    expect(
      validateMetadata({
        version: '1.0.0',
        updatedAt: '2026-03-28T12:00:00Z',
        rulesCount: 50,
        sha256: 'abc123',
      }),
    ).toBe(true)
  })

  it('rejects null', () => {
    expect(validateMetadata(null)).toBe(false)
  })

  it('rejects missing version', () => {
    expect(
      validateMetadata({
        updatedAt: '2026-03-28T12:00:00Z',
        rulesCount: 50,
        sha256: 'abc123',
      }),
    ).toBe(false)
  })

  it('rejects empty version', () => {
    expect(
      validateMetadata({
        version: '',
        updatedAt: '2026-03-28T12:00:00Z',
        rulesCount: 50,
        sha256: 'abc123',
      }),
    ).toBe(false)
  })

  it('rejects negative rulesCount', () => {
    expect(
      validateMetadata({
        version: '1.0.0',
        updatedAt: '2026-03-28T12:00:00Z',
        rulesCount: -1,
        sha256: 'abc123',
      }),
    ).toBe(false)
  })

  it('rejects non-number rulesCount', () => {
    expect(
      validateMetadata({
        version: '1.0.0',
        updatedAt: '2026-03-28T12:00:00Z',
        rulesCount: '50',
        sha256: 'abc123',
      }),
    ).toBe(false)
  })
})

// ─── Integration tests (temp dir, real fs, mocked yara-x) ────

describe('yara-rules-store integration', () => {
  let tmpDir: string
  let rulesDir: string
  let backupDir: string
  let stagingDirs: () => string[]

  beforeEach(() => {
    _yaraCompileShouldFail = false
    vi.resetModules()
    tmpDir = join(require('node:os').tmpdir(), `yara-test-${randomBytes(4).toString('hex')}`)
    currentTmpDir = tmpDir
    rulesDir = join(tmpDir, 'Kudu-Dev', 'yara-rules')
    backupDir = join(tmpDir, 'Kudu-Dev', 'yara-rules.backup')
    mkdirSync(join(tmpDir, 'Kudu-Dev'), { recursive: true })
    stagingDirs = () => {
      const kd = join(tmpDir, 'Kudu-Dev')
      return existsSync(kd) ? readdirSync(kd).filter((e) => e.includes('.staging-')) : []
    }
  })

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  function buildBundleJson(rules: { filename: string; content: string }[]): string {
    const sorted = [...rules].sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0))
    const combined = sorted.map((r) => r.content).join('')
    const sha256 = createHash('sha256').update(combined).digest('hex')
    return JSON.stringify({
      version: '2.0.0',
      updatedAt: '2026-06-14T12:00:00Z',
      sha256,
      rules,
    })
  }

  function mockFetchResponse(body: string, status = 200, etag?: string) {
    const encoder = new TextEncoder()
    const data = encoder.encode(body)
    let pos = 0
    const reader = {
      read: async () => {
        if (pos >= data.length) return { done: true as const, value: undefined as undefined }
        const chunk = data.slice(pos, pos + 64)
        pos += 64
        return { done: false as const, value: chunk }
      },
      cancel: vi.fn(),
      releaseLock: vi.fn(),
    }

    const headers = new Map<string, string>()
    headers.set('content-length', String(body.length))
    if (etag) headers.set('etag', etag)

    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (name: string) => headers.get(name) ?? null },
      body: { getReader: () => reader },
    }
  }

  function createExistingRules() {
    mkdirSync(rulesDir, { recursive: true })
    writeFileSync(join(rulesDir, 'existing.yar'), 'rule Existing { condition: true }', 'utf-8')
    writeFileSync(
      join(rulesDir, 'metadata.json'),
      JSON.stringify({
        version: '1.0.0',
        updatedAt: '2026-01-01T00:00:00Z',
        rulesCount: 1,
        sha256: 'abc',
      }),
      'utf-8',
    )
  }

  describe('cleanupStagingDirs', () => {
    it('removes orphaned .staging-* dirs', async () => {
      const staging1 = join(tmpDir, 'Kudu-Dev', 'yara-rules.staging-100')
      const staging2 = join(tmpDir, 'Kudu-Dev', 'yara-rules.staging-200')
      mkdirSync(staging1, { recursive: true })
      mkdirSync(staging2, { recursive: true })
      writeFileSync(join(staging1, 'test.yar'), 'rule X {}', 'utf-8')

      const mod = await import('./yara-rules-store')
      mod.cleanupStagingDirs()

      expect(existsSync(staging1)).toBe(false)
      expect(existsSync(staging2)).toBe(false)
    })

    it('does not remove non-staging dirs', async () => {
      mkdirSync(rulesDir, { recursive: true })
      mkdirSync(backupDir, { recursive: true })

      const mod = await import('./yara-rules-store')
      mod.cleanupStagingDirs()

      expect(existsSync(rulesDir)).toBe(true)
      expect(existsSync(backupDir)).toBe(true)
    })
  })

  describe('rollbackUpdate', () => {
    it('restores previous version from backup', async () => {
      mkdirSync(rulesDir, { recursive: true })
      mkdirSync(backupDir, { recursive: true })
      writeFileSync(join(rulesDir, 'current.yar'), 'rule Current {}', 'utf-8')
      writeFileSync(join(backupDir, 'old.yar'), 'rule Old { condition: true }', 'utf-8')

      const mod = await import('./yara-rules-store')
      const result = mod.rollbackUpdate()

      expect(result.success).toBe(true)
      expect(existsSync(join(rulesDir, 'old.yar'))).toBe(true)
      expect(existsSync(join(rulesDir, 'current.yar'))).toBe(false)
    })

    it('fails when no backup exists', async () => {
      const mod = await import('./yara-rules-store')
      const result = mod.rollbackUpdate()

      expect(result.success).toBe(false)
      expect(result.error).toContain('No backup')
    })

    it('re-compiles old rules after rollback', async () => {
      mkdirSync(rulesDir, { recursive: true })
      mkdirSync(backupDir, { recursive: true })
      writeFileSync(join(backupDir, 'old.yar'), 'rule Old { condition: true }', 'utf-8')
      writeFileSync(join(backupDir, 'another.yar'), 'rule Another { condition: false }', 'utf-8')

      const mod = await import('./yara-rules-store')
      const result = mod.rollbackUpdate()

      expect(result.success).toBe(true)
      expect(existsSync(join(rulesDir, 'old.yar'))).toBe(true)
      expect(existsSync(join(rulesDir, 'another.yar'))).toBe(true)
    })

    it('handles rollback when old rules dir does not exist', async () => {
      mkdirSync(backupDir, { recursive: true })
      writeFileSync(join(backupDir, 'old.yar'), 'rule Old { condition: true }', 'utf-8')

      const mod = await import('./yara-rules-store')
      const result = mod.rollbackUpdate()

      expect(result.success).toBe(true)
      expect(existsSync(join(rulesDir, 'old.yar'))).toBe(true)
    })

    it('logs warning when rollback re-compilation fails', async () => {
      _yaraCompileShouldFail = true
      mkdirSync(rulesDir, { recursive: true })
      mkdirSync(backupDir, { recursive: true })
      writeFileSync(join(backupDir, 'bad.yar'), 'rule Bad { invalid syntax }', 'utf-8')

      const mod = await import('./yara-rules-store')
      const result = mod.rollbackUpdate()

      expect(result.success).toBe(true)
      expect(sharedLogger.warning).toHaveBeenCalledWith('yara', expect.stringContaining('Rollback'))
    })

    it('handles rollback when compileRuleDir has empty file list', async () => {
      mkdirSync(backupDir, { recursive: true })
      // No .yar files in backup — only a readme
      writeFileSync(join(backupDir, 'readme.txt'), 'not a rule', 'utf-8')

      const mod = await import('./yara-rules-store')
      const result = mod.rollbackUpdate()

      expect(result.success).toBe(true)
      expect(sharedLogger.warning).toHaveBeenCalledWith('yara', 'No rule files to compile in staging')
    })
  })

  describe('fetchAndCacheRules — 3-phase update', () => {
    it('downloads to staging, compiles, then swaps atomically', async () => {
      // Pre-populate existing rules so backup is created
      createExistingRules()

      const rules = [{ filename: 'test.yar', content: 'rule Test { condition: true }' }]
      const body = buildBundleJson(rules)

      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(body, 200, 'etag-123'))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const result = await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      expect(result.success).toBe(true)
      expect(result.stats?.rulesCount).toBe(1)
      expect(result.stats?.version).toBe('2.0.0')

      expect(existsSync(rulesDir)).toBe(true)
      expect(existsSync(join(rulesDir, 'test.yar'))).toBe(true)
      expect(existsSync(join(rulesDir, 'metadata.json'))).toBe(true)

      // Old rules should NOT be in the new dir
      expect(existsSync(join(rulesDir, 'existing.yar'))).toBe(false)

      const cacheVersionPath = join(rulesDir, 'cache-version.json')
      expect(existsSync(cacheVersionPath)).toBe(true)
      const cacheVersion = JSON.parse(readFileSync(cacheVersionPath, 'utf-8'))
      expect(cacheVersion.version).toBe('1.0')
      expect(cacheVersion.engine).toBe('litko-yara-x')
      expect(cacheVersion.engineVersion).toBeDefined()
      expect(cacheVersion.ruleCount).toBe(1)

      expect(stagingDirs()).toHaveLength(0)
      expect(existsSync(backupDir)).toBe(true)
    })

    it('removes old backup before rotating to new backup', async () => {
      createExistingRules()
      // Create an existing backup so the inner rmSync(backupDir) branch is hit
      mkdirSync(backupDir, { recursive: true })
      writeFileSync(join(backupDir, 'backup.yar'), 'rule Backup { condition: true }', 'utf-8')

      const rules = [{ filename: 'new.yar', content: 'rule New { condition: true }' }]
      const body = buildBundleJson(rules)
      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(body, 200, 'etag-789'))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const result = await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      expect(result.success).toBe(true)
      // Old backup should be removed
      expect(existsSync(join(backupDir, 'backup.yar'))).toBe(false)
      // New rules should be in place
      expect(existsSync(join(rulesDir, 'new.yar'))).toBe(true)
    })

    it('preserves old rules intact if crash during phase 1', async () => {
      createExistingRules()

      const failReader = {
        read: async () => {
          throw new Error('Network failure mid-stream')
        },
        cancel: vi.fn(),
        releaseLock: vi.fn(),
      }
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: { get: () => null },
        body: { getReader: () => failReader },
      })
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const result = await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Network failure')
      expect(existsSync(join(rulesDir, 'existing.yar'))).toBe(true)
    })

    it('rejects corrupt download via SHA-256 mismatch', async () => {
      const body = JSON.stringify({
        version: '2.0.0',
        updatedAt: '2026-06-14T12:00:00Z',
        sha256: '0000000000000000000000000000000000000000000000000000000000000000',
        rules: [{ filename: 'test.yar', content: 'rule Test { condition: true }' }],
      })

      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(body))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const result = await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      expect(result.success).toBe(false)
      expect(result.error).toContain('SHA-256 mismatch')
    })

    it('returns 304 when server responds with 304', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse('', 304))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const result = await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      expect(result.success).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/api/yara-rules',
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: 'application/json' }),
        }),
      )
    })

    it('downloads in chunks and validates SHA-256', async () => {
      createExistingRules()

      const rules = [{ filename: 'chunked.yar', content: 'rule Chunked { condition: true }' }]
      const body = buildBundleJson(rules)

      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(body, 200, 'etag-chunked'))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const result = await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      expect(result.success).toBe(true)
      expect(result.stats?.rulesCount).toBe(1)
    })

    it('rejects download that exceeds size limit mid-stream', async () => {
      const oversizedData = new Uint8Array(60 * 1024 * 1024)
      const reader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: oversizedData })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        cancel: vi.fn(),
        releaseLock: vi.fn(),
      }

      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: { get: () => null },
        body: { getReader: () => reader },
      })
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const result = await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      expect(result.success).toBe(false)
      expect(result.error).toContain('too large')
    })

    it('cleans up staging dir on compilation failure', async () => {
      _yaraCompileShouldFail = true

      const rules = [{ filename: 'bad.yar', content: 'rule Bad { invalid syntax }' }]
      const body = buildBundleJson(rules)

      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(body, 200))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const result = await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Compilation failed')
      expect(stagingDirs()).toHaveLength(0)
    })

    it('returns error on HTTP 500 response', async () => {
      createExistingRules()

      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse('Server error', 500))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const result = await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      expect(result.success).toBe(false)
      expect(result.error).toContain('HTTP 500')
    })

    it('rejects download when content-length exceeds 50 MB', async () => {
      createExistingRules()

      const encoder = new TextEncoder()
      const _data = encoder.encode('small body')
      const reader = {
        read: async () => ({ done: true as const, value: undefined as undefined }),
        cancel: vi.fn(),
        releaseLock: vi.fn(),
      }
      const headers = new Map<string, string>()
      headers.set('content-length', String(60 * 1024 * 1024))

      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: { get: (name: string) => headers.get(name) ?? null },
        body: { getReader: () => reader },
      })
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const result = await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      expect(result.success).toBe(false)
      expect(result.error).toContain('too large')
    })

    it('returns error when response body is not readable', async () => {
      createExistingRules()

      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: { get: () => null },
        body: null,
      })
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const result = await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      expect(result.success).toBe(false)
      expect(result.error).toContain('not readable')
    })

    it('returns error on JSON parse failure', async () => {
      createExistingRules()

      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse('not-json-content', 200))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const result = await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      expect(result.success).toBe(false)
      expect(result.error).toContain('JSON parse error')
    })

    it('returns error on bundle validation failure', async () => {
      createExistingRules()

      const body = JSON.stringify({ version: '1.0', rules: [] })
      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(body, 200))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const result = await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      expect(result.success).toBe(false)
      expect(result.error).toContain('validation failed')
    })

    it('rejects bundle with version exceeding 100 chars', async () => {
      createExistingRules()

      const body = JSON.stringify({
        version: 'x'.repeat(101),
        updatedAt: '2026-06-14T12:00:00Z',
        sha256: 'abc123',
        rules: [{ filename: 'test.yar', content: 'rule Test { condition: true }' }],
      })
      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(body, 200))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const result = await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      expect(result.success).toBe(false)
      expect(result.error).toContain('validation failed')
    })

    it('rejects bundle with updatedAt exceeding 100 chars', async () => {
      createExistingRules()

      const body = JSON.stringify({
        version: '2.0.0',
        updatedAt: 'x'.repeat(101),
        sha256: 'abc123',
        rules: [{ filename: 'test.yar', content: 'rule Test { condition: true }' }],
      })
      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(body, 200))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const result = await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      expect(result.success).toBe(false)
      expect(result.error).toContain('validation failed')
    })

    it('rejects bundle with sha256 exceeding 128 chars', async () => {
      createExistingRules()

      const body = JSON.stringify({
        version: '2.0.0',
        updatedAt: '2026-06-14T12:00:00Z',
        sha256: 'x'.repeat(129),
        rules: [{ filename: 'test.yar', content: 'rule Test { condition: true }' }],
      })
      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(body, 200))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const result = await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      expect(result.success).toBe(false)
      expect(result.error).toContain('validation failed')
    })

    it('skips If-None-Match when stored etag is empty string', async () => {
      mkdirSync(rulesDir, { recursive: true })
      writeFileSync(
        join(rulesDir, 'etag.json'),
        JSON.stringify({ etag: '', updatedAt: '2026-06-14T12:00:00Z' }),
        'utf-8',
      )

      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse('', 304))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      // If-None-Match should NOT be in headers since etag was empty
      const callHeaders = fetchMock.mock.calls[0][1].headers
      expect(callHeaders['If-None-Match']).toBeUndefined()
    })

    it('handles corrupt etag.json gracefully', async () => {
      mkdirSync(rulesDir, { recursive: true })
      writeFileSync(join(rulesDir, 'etag.json'), 'not valid json', 'utf-8')

      const rules = [{ filename: 'test.yar', content: 'rule Test { condition: true }' }]
      const body = buildBundleJson(rules)
      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(body, 200, 'new-etag'))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const result = await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      // Should succeed despite corrupt etag
      expect(result.success).toBe(true)
      expect(result.stats?.rulesCount).toBe(1)
    })

    it('sends If-None-Match header when ETag is stored', async () => {
      mkdirSync(rulesDir, { recursive: true })
      writeFileSync(
        join(rulesDir, 'etag.json'),
        JSON.stringify({ etag: '"abc123"', updatedAt: '2026-06-14T12:00:00Z' }),
        'utf-8',
      )
      writeFileSync(
        join(rulesDir, 'metadata.json'),
        JSON.stringify({
          version: '2.0.0',
          updatedAt: '2026-06-14T12:00:00Z',
          rulesCount: 1,
          sha256: 'abc',
        }),
        'utf-8',
      )

      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse('', 304))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const result = await mod.fetchAndCacheRules('https://example.com/api/yara-rules')

      expect(result.success).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/api/yara-rules',
        expect.objectContaining({
          headers: expect.objectContaining({ 'If-None-Match': '"abc123"' }),
        }),
      )
    })
  })

  // ─── getCachedRulePaths / getAllRulePaths ─────────────────────

  describe('getCachedRulePaths', () => {
    it('returns .yar files in the cached rules directory', async () => {
      mkdirSync(rulesDir, { recursive: true })
      writeFileSync(join(rulesDir, 'miners.yar'), 'rule X {}', 'utf-8')
      writeFileSync(join(rulesDir, 'ransomware.yar'), 'rule Y {}', 'utf-8')
      writeFileSync(join(rulesDir, 'readme.txt'), 'not a rule', 'utf-8')

      const mod = await import('./yara-rules-store')
      const paths = mod.getCachedRulePaths()

      expect(paths).toHaveLength(2)
      expect(paths[0]).toContain('miners.yar')
      expect(paths[1]).toContain('ransomware.yar')
    })

    it('returns empty array when dir does not exist', async () => {
      const mod = await import('./yara-rules-store')
      expect(mod.getCachedRulePaths()).toEqual([])
    })

    it('returns empty array when no .yar files exist', async () => {
      mkdirSync(rulesDir, { recursive: true })
      writeFileSync(join(rulesDir, 'readme.txt'), 'not a rule', 'utf-8')

      const mod = await import('./yara-rules-store')
      expect(mod.getCachedRulePaths()).toEqual([])
    })
  })

  describe('getAllRulePaths', () => {
    it('returns same as getCachedRulePaths', async () => {
      mkdirSync(rulesDir, { recursive: true })
      writeFileSync(join(rulesDir, 'test.yar'), 'rule X {}', 'utf-8')

      const mod = await import('./yara-rules-store')
      expect(mod.getAllRulePaths()).toEqual(mod.getCachedRulePaths())
    })
  })

  // ─── getRulesMetadata ────────────────────────────────────────

  describe('getRulesMetadata', () => {
    it('returns parsed metadata when metadata.json exists and is valid', async () => {
      mkdirSync(rulesDir, { recursive: true })
      writeFileSync(
        join(rulesDir, 'metadata.json'),
        JSON.stringify({
          version: '2.0.0',
          updatedAt: '2026-06-14T12:00:00Z',
          rulesCount: 42,
          sha256: 'a'.repeat(64),
        }),
        'utf-8',
      )

      const mod = await import('./yara-rules-store')
      const meta = mod.getRulesMetadata()

      expect(meta).not.toBeNull()
      expect(meta!.version).toBe('2.0.0')
      expect(meta!.rulesCount).toBe(42)
    })

    it('returns null when metadata.json does not exist', async () => {
      const mod = await import('./yara-rules-store')
      expect(mod.getRulesMetadata()).toBeNull()
    })

    it('returns null when metadata.json contains invalid JSON', async () => {
      mkdirSync(rulesDir, { recursive: true })
      writeFileSync(join(rulesDir, 'metadata.json'), 'not-json', 'utf-8')

      const mod = await import('./yara-rules-store')
      expect(mod.getRulesMetadata()).toBeNull()
    })

    it('returns null when metadata has invalid structure (missing version)', async () => {
      mkdirSync(rulesDir, { recursive: true })
      writeFileSync(join(rulesDir, 'metadata.json'), JSON.stringify({ rulesCount: 42, sha256: 'abc' }), 'utf-8')

      const mod = await import('./yara-rules-store')
      expect(mod.getRulesMetadata()).toBeNull()
    })

    it('returns null when metadata version is empty string', async () => {
      mkdirSync(rulesDir, { recursive: true })
      writeFileSync(
        join(rulesDir, 'metadata.json'),
        JSON.stringify({
          version: '',
          updatedAt: '2026-01-01T00:00:00Z',
          rulesCount: 1,
          sha256: 'abc',
        }),
        'utf-8',
      )

      const mod = await import('./yara-rules-store')
      expect(mod.getRulesMetadata()).toBeNull()
    })

    it('returns null when version exceeds max length', async () => {
      mkdirSync(rulesDir, { recursive: true })
      writeFileSync(
        join(rulesDir, 'metadata.json'),
        JSON.stringify({
          version: 'x'.repeat(101),
          updatedAt: '2026-01-01T00:00:00Z',
          rulesCount: 1,
          sha256: 'abc',
        }),
        'utf-8',
      )

      const mod = await import('./yara-rules-store')
      expect(mod.getRulesMetadata()).toBeNull()
    })

    it('returns null when metadata.json is a JSON array', async () => {
      mkdirSync(rulesDir, { recursive: true })
      writeFileSync(join(rulesDir, 'metadata.json'), '[1, 2, 3]', 'utf-8')

      const mod = await import('./yara-rules-store')
      expect(mod.getRulesMetadata()).toBeNull()
    })

    it('returns null when metadata.json is a primitive string', async () => {
      mkdirSync(rulesDir, { recursive: true })
      writeFileSync(join(rulesDir, 'metadata.json'), '"just a string"', 'utf-8')

      const mod = await import('./yara-rules-store')
      expect(mod.getRulesMetadata()).toBeNull()
    })
  })

  // ─── startPeriodicRuleChecks / stopPeriodicRuleChecks ────────

  describe('startPeriodicRuleChecks', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('sets up interval and calls fetch', async () => {
      const rules = [{ filename: 'test.yar', content: 'rule Test { condition: true }' }]
      const body = buildBundleJson(rules)
      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(body, 200))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const onUpdated = vi.fn()
      mod.startPeriodicRuleChecks('https://example.com', onUpdated, 60_000)

      expect(mod.RULES_ENDPOINT).toBe('/api/yara-rules')

      await vi.advanceTimersByTimeAsync(5_000)
      expect(fetchMock).toHaveBeenCalledWith('https://example.com/api/yara-rules', expect.any(Object))
    })

    it('calls onUpdated when fetch succeeds', async () => {
      const rules = [{ filename: 'test.yar', content: 'rule Test { condition: true }' }]
      const body = buildBundleJson(rules)
      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(body, 200))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const onUpdated = vi.fn()
      mod.startPeriodicRuleChecks('https://example.com', onUpdated, 60_000)

      await vi.advanceTimersByTimeAsync(5_000)
      expect(onUpdated).toHaveBeenCalled()
    })

    it('handles fetch errors gracefully without crashing', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const onUpdated = vi.fn()
      mod.startPeriodicRuleChecks('https://example.com', onUpdated, 60_000)

      await vi.advanceTimersByTimeAsync(5_000)
      expect(onUpdated).not.toHaveBeenCalled()
    })

    it('stops previous checks before starting new ones', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse('{}', 304))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const onUpdated = vi.fn()
      mod.startPeriodicRuleChecks('https://example.com', onUpdated, 60_000)
      // Second start must cancel the first start's pending 5s initial check
      mod.startPeriodicRuleChecks('https://example.com', onUpdated, 60_000)

      await vi.advanceTimersByTimeAsync(5_000)
      // Only the latest start's initial check runs — no double fetch
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('stopPeriodicRuleChecks', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('stops periodic checks and clears state', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse('{}', 304))
      vi.stubGlobal('fetch', fetchMock)

      const mod = await import('./yara-rules-store')
      const onUpdated = vi.fn()
      mod.startPeriodicRuleChecks('https://example.com', onUpdated, 60_000)
      mod.stopPeriodicRuleChecks()

      // The 5s initial check must also be cancelled by stop
      await vi.advanceTimersByTimeAsync(5_000)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('can be called multiple times without error', async () => {
      const mod = await import('./yara-rules-store')
      // Guard against null _checkInterval — should not throw
      mod.stopPeriodicRuleChecks()
      mod.stopPeriodicRuleChecks()
    })
  })
})
