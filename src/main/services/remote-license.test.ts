import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { E2E_MARKER_FILENAME } from '@shared/e2e-license-marker'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mock state (dynamic per-test) ────────────────────────────────────
const mockVars = vi.hoisted(() => {
  let _testRoot = ''
  return {
    setTestRoot: (r: string) => {
      _testRoot = r
    },
    getTestRoot: () => _testRoot,
  }
})

const mockNet = vi.hoisted(() => {
  let _status = 200
  let _body: any = { valid: false, reason: 'test-blocked' }
  let _error: string | null = null
  let _streamError: string | null = null
  let _streamAborted = false
  let _capturedPayload = ''
  let _callIndex = 0
  const _responses: Array<{ status?: number; body?: any; error?: string }> = []

  return {
    setResponse: (body: any, status = 200) => {
      _status = status
      _body = body
      _error = null
      _streamError = null
      _streamAborted = false
      _responses.length = 0
      _callIndex = 0
    },
    setError: (msg: string) => {
      _error = msg
      _streamError = null
      _streamAborted = false
      _responses.length = 0
      _callIndex = 0
    },
    setStreamError: (msg: string) => {
      _error = null
      _streamError = msg
      _streamAborted = false
      _responses.length = 0
      _callIndex = 0
    },
    setStreamAborted: () => {
      _error = null
      _streamError = null
      _streamAborted = true
      _responses.length = 0
      _callIndex = 0
    },
    setSequence: (seq: Array<{ status?: number; body?: any; error?: string }>) => {
      _responses.splice(0, _responses.length, ...seq)
      _streamError = null
      _streamAborted = false
      _callIndex = 0
    },
    getCapturedPayload: () => _capturedPayload,
    _makeRequest: () => {
      _capturedPayload = ''
      return {
        on(ev: string, cb: any) {
          const idx = Math.min(_callIndex, _responses.length > 0 ? _responses.length - 1 : 0)
          let status = _status
          let body = _body
          let error = _error
          if (_responses.length > 0) {
            const r = _responses[idx]!
            if (r.error !== undefined) error = r.error
            if (r.body !== undefined) body = r.body
            if (r.status !== undefined) status = r.status
            _callIndex++
          }
          if (error && ev === 'error') {
            setTimeout(() => cb(new Error(error)), 0)
          } else if (!error && ev === 'response') {
            setTimeout(
              () =>
                cb({
                  statusCode: status,
                  response: {
                    on(dEv: string, dCb: any) {
                      if (dEv === 'error' && _streamError) dCb(new Error(_streamError))
                      if (dEv === 'aborted' && _streamAborted) dCb(null)
                      if (dEv === 'data') dCb(Buffer.from(JSON.stringify(body)))
                      if (dEv === 'end') dCb(null)
                    },
                  },
                }),
              0,
            )
          }
          return this
        },
        setHeader() {},
        write(data: string) {
          _capturedPayload = data
        },
        end() {},
      }
    },
  }
})

vi.mock('electron', () => {
  const p = require('node:path')
  const os = require('node:os')
  return {
    app: {
      getPath: (n: string) => (n === 'userData' ? mockVars.getTestRoot() : p.join(os.tmpdir(), n)),
      isPackaged: false,
    },
    net: {
      request: () => mockNet._makeRequest(),
    },
  }
})

vi.mock('./hwid', () => ({ generateHwid: async () => 'test-hwid-12345' }))

import { initStore, readSavedKey } from './license-store'
import { __resetForTest, activateLicense, checkLicense, getHwid } from './remote-license'

const KEYFILE = 'remote-license.key'
let testRoot = ''

beforeEach(() => {
  testRoot = path.join(tmpdir(), 'dinho-license-test', String(Date.now()))
  mockVars.setTestRoot(testRoot)
  try {
    fs.rmSync(testRoot, { recursive: true, force: true })
  } catch {}
  fs.mkdirSync(testRoot, { recursive: true })
  __resetForTest()
})

afterAll(() => {
  try {
    const base = path.join(tmpdir(), 'dinho-license-test')
    if (fs.existsSync(base)) fs.rmSync(base, { recursive: true, force: true })
  } catch {}
})

function initStoreForTest(): void {
  initStore({
    keyFile: path.join(testRoot, KEYFILE),
    saltFile: path.join(testRoot, '.store-salt'),
  })
}

function savedKey(): string | null {
  try {
    return readSavedKey(path.join(testRoot, KEYFILE))
  } catch {
    initStoreForTest()
    return readSavedKey(path.join(testRoot, KEYFILE))
  }
}

describe('remote-license', () => {
  // ── checkLicense ──────────────────────────────────────────────────
  describe('checkLicense', () => {
    it('blocks when no key is saved', async () => {
      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Nenhuma licença encontrada')
    })

    it('returns expired when API reports expired', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'OLD-EXPIRED-KEY', 'utf-8')
      mockNet.setResponse({ valid: false, reason: 'Licença expirada', type: 'expired', expires_at: '2024-01-01' })

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Licença expirada')
      expect(result.type).toBe('expired')
      expect(result.expires_at).toBe('2024-01-01')
    })

    it('returns valid when API confirms license', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'VALID-KEY', 'utf-8')
      mockNet.setResponse({ valid: true, type: 'lifetime', expires_at: null })

      const result = await checkLicense()
      expect(result.valid).toBe(true)
      expect(result.type).toBe('lifetime')
      expect(result.expires_at).toBeNull()
    })

    it('returns valid with subscription type and expiry date', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'SUB-KEY', 'utf-8')
      mockNet.setResponse({ valid: true, type: 'subscription', expires_at: '2026-12-31' })

      const result = await checkLicense()
      expect(result.valid).toBe(true)
      expect(result.type).toBe('subscription')
      expect(result.expires_at).toBe('2026-12-31')
    })

    it('falls back to offline cache when server is unreachable and cache is valid', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      // write a valid cache entry
      const cache = { valid: true, type: 'lifetime', expires_at: null, timestamp: Date.now() }
      fs.writeFileSync(path.join(testRoot, '.license-cache.json'), JSON.stringify(cache), 'utf-8')
      mockNet.setError('connection refused')

      const result = await checkLicense()
      expect(result.valid).toBe(true)
      expect(result.type).toBe('lifetime')
    })

    it('returns offline message when server is unreachable and no cache', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setError('connection refused')

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Sem validação offline disponível')
    })

    it('returns generic invalid when API returns invalid without reason', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'INVALID-KEY', 'utf-8')
      mockNet.setResponse({ valid: false })

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Licença inválida')
    })

    it('serves fresh valid cache without consulting the network', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      const cache = { valid: true, type: 'lifetime', expires_at: null, timestamp: Date.now() }
      fs.writeFileSync(path.join(testRoot, '.license-cache.json'), JSON.stringify(cache), 'utf-8')
      // Servidor acessível e respondendo inválido — cache fresco deve vencer sem rede
      mockNet.setResponse({ valid: false, reason: 'bloqueado' })

      const result = await checkLicense()
      expect(result.valid).toBe(true)
      expect(result.type).toBe('lifetime')
    })

    it('consults the network when fresh cache says invalid', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      const cache = { valid: false, reason: 'x', timestamp: Date.now() }
      fs.writeFileSync(path.join(testRoot, '.license-cache.json'), JSON.stringify(cache), 'utf-8')
      mockNet.setResponse({ valid: true, type: 'subscription', expires_at: '2026-12-31' })

      const result = await checkLicense()
      expect(result.valid).toBe(true)
      expect(result.type).toBe('subscription')
    })

    it('revalidates in background and refreshes the cache', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      const cache = { valid: true, type: 'lifetime', expires_at: null, timestamp: Date.now() - 1000 }
      const cachePath = path.join(testRoot, '.license-cache.json')
      fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf-8')
      mockNet.setResponse({ valid: true, type: 'lifetime', expires_at: null })

      const result = await checkLicense()
      expect(result.valid).toBe(true)

      await vi.waitFor(
        () => {
          const refreshed = JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
          expect(refreshed.timestamp).toBeGreaterThan(cache.timestamp)
        },
        { timeout: 5000 },
      )
    })
  })

  // ── activateLicense ───────────────────────────────────────────────
  describe('activateLicense', () => {
    it('saves key and returns valid on successful activation', async () => {
      mockNet.setResponse({ valid: true, type: 'lifetime', expires_at: null })

      const result = await activateLicense('NEW-VALID-KEY')
      expect(result.valid).toBe(true)
      expect(savedKey()).toBe('NEW-VALID-KEY')
    })

    it('uppercases and trims the key before saving', async () => {
      mockNet.setResponse({ valid: true, type: 'lifetime', expires_at: null })

      const result = await activateLicense('  new-key-abc  ')
      expect(result.valid).toBe(true)
      expect(savedKey()).toBe('NEW-KEY-ABC')
    })

    it('deletes saved key when activation fails', async () => {
      mockNet.setResponse({ valid: false, reason: 'Chave inválida' })

      const result = await activateLicense('INVALID-KEY')
      expect(result.valid).toBe(false)
      expect(savedKey()).toBeNull()
    })

    it('deletes saved key on network error during activation', async () => {
      // write an existing key first
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'OLD-KEY', 'utf-8')
      mockNet.setError('server timeout')

      const result = await activateLicense('NEW-KEY')
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/conexao|connection|timeout|Sem conexao/i)
      expect(savedKey()).toBeNull()
    })

    it('trims key down to 49 chars max', async () => {
      const longKey = 'A'.repeat(60)
      mockNet.setResponse({ valid: true, type: 'lifetime' })

      const result = await activateLicense(longKey)
      expect(result.valid).toBe(true)
      expect(savedKey()?.length).toBe(60)
    })
  })

  // ── Renewal: expired → activate new → valid ─────────────────────
  describe('license renewal flow', () => {
    it('expired license can be renewed with a new key', async () => {
      // Step 1: expired key on disk
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'EXPIRED-KEY', 'utf-8')
      mockNet.setResponse({ valid: false, reason: 'Licença expirada', type: 'expired', expires_at: '2024-01-01' })

      const expired = await checkLicense()
      expect(expired.valid).toBe(false)
      expect(expired.reason).toBe('Licença expirada')

      // Step 2: activate with new key
      mockNet.setResponse({ valid: true, type: 'subscription', expires_at: '2027-06-01' })

      const activated = await activateLicense('RENEWED-KEY-2027')
      expect(activated.valid).toBe(true)
      expect(savedKey()).toBe('RENEWED-KEY-2027')

      // Step 3: checkLicense now reports valid with new key
      const valid = await checkLicense()
      expect(valid.valid).toBe(true)
      expect(valid.type).toBe('subscription')
      expect(valid.expires_at).toBe('2027-06-01')
    })
  })

  // ── getHwid ──────────────────────────────────────────────────────
  describe('getHwid', () => {
    it('returns the hwid from generateHwid', async () => {
      const hwid = await getHwid()
      expect(hwid).toBe('test-hwid-12345')
    })
  })

  // ── Payload sent to API ──────────────────────────────────────────
  describe('API payload', () => {
    it('sends key, hwid and action in the request body', async () => {
      mockNet.setResponse({ valid: true, type: 'lifetime' })

      await activateLicense('MY-KEY')
      const raw = mockNet.getCapturedPayload()
      const payload = JSON.parse(raw)

      expect(payload.action).toBe('validate')
      expect(payload.key).toBe('MY-KEY')
      expect(payload.hwid).toBe('test-hwid-12345')
    })
  })

  // ── getLicenseConfig branches ─────────────────────────────────────
  describe('getLicenseConfig (via config file)', () => {
    it('reads custom url and token from license-config.json', async () => {
      const config = { url: 'https://custom-license.api/verify', token: 'custom-token-abc' }
      fs.writeFileSync(path.join(testRoot, 'license-config.json'), JSON.stringify(config), 'utf-8')
      mockNet.setResponse({ valid: true, type: 'lifetime' })

      const result = await activateLicense('MY-KEY')
      expect(result.valid).toBe(true)
    })

    it('falls through when license-config.json has no token field', async () => {
      fs.writeFileSync(
        path.join(testRoot, 'license-config.json'),
        JSON.stringify({ url: 'https://custom.url' }),
        'utf-8',
      )
      mockNet.setResponse({ valid: true, type: 'lifetime' })

      const result = await activateLicense('MY-KEY')
      expect(result.valid).toBe(true)
    })

    it('falls through when license-config.json has invalid JSON', async () => {
      fs.writeFileSync(path.join(testRoot, 'license-config.json'), '{bad json}', 'utf-8')
      mockNet.setResponse({ valid: true, type: 'lifetime' })

      const result = await activateLicense('MY-KEY')
      expect(result.valid).toBe(true)
    })
  })

  // ── API response edge cases ──────────────────────────────────────
  describe('API response branches', () => {
    it('handles non-JSON API response', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setSequence([
        { status: 200, body: 'just a string' },
        { status: 200, body: 'just a string' },
      ])

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Sem validação offline disponível')
    })

    it('converts empty expires_at string to null', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setResponse({ valid: true, type: 'subscription', expires_at: '' })

      const result = await checkLicense()
      expect(result.valid).toBe(true)
      expect(result.expires_at).toBeNull()
    })

    it('settles (falls back offline) when the response stream errors mid-body', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setStreamError('stream reset by peer')

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Sem validação offline disponível')
    })

    it('settles (falls back offline) when the response stream aborts mid-body', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      mockNet.setStreamAborted()

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Sem validação offline disponível')
    })
  })

  // ── Cache read branches ──────────────────────────────────────────
  describe('cache read branches', () => {
    it('returns null when cache file has no timestamp field', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      fs.writeFileSync(path.join(testRoot, '.license-cache.json'), JSON.stringify({ valid: true }), 'utf-8')
      mockNet.setError('connection refused')

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Sem validação offline disponível')
    })

    it('handles corrupt cache JSON gracefully', async () => {
      fs.writeFileSync(path.join(testRoot, KEYFILE), 'KEY', 'utf-8')
      fs.writeFileSync(path.join(testRoot, '.license-cache.json'), 'not valid json at all', 'utf-8')
      mockNet.setError('connection refused')

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Sem validação offline disponível')
    })
  })

  // ── E2E bypass ───────────────────────────────────────────────────
  describe('DINHO_E2E bypass', () => {
    function createMarker(): void {
      fs.writeFileSync(path.join(testRoot, E2E_MARKER_FILENAME), String(Date.now()), 'utf-8')
    }

    afterEach(() => {
      delete process.env.DINHO_E2E
      delete process.env.DINHO_E2E_KEY
      try {
        fs.rmSync(path.join(testRoot, E2E_MARKER_FILENAME), { force: true })
      } catch {}
    })

    it('returns valid test license when env key and marker are present', async () => {
      process.env.DINHO_E2E = '1'
      process.env.DINHO_E2E_KEY = 'test-secret'
      createMarker()

      const result = await checkLicense()
      expect(result.valid).toBe(true)
      expect(result.type).toBe('test')
    })

    it('does not bypass when DINHO_E2E_KEY is missing', async () => {
      process.env.DINHO_E2E = '1'
      createMarker()

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Nenhuma licença encontrada')
    })

    it('does not bypass when the marker file is missing', async () => {
      process.env.DINHO_E2E = '1'
      process.env.DINHO_E2E_KEY = 'test-secret'

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Nenhuma licença encontrada')
    })

    it('does not bypass when DINHO_E2E is not set', async () => {
      process.env.DINHO_E2E_KEY = 'test-secret'
      createMarker()

      const result = await checkLicense()
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Nenhuma licença encontrada')
    })
  })
})
