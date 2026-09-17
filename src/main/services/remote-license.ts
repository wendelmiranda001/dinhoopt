import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { E2E_MARKER_FILENAME } from '@shared/e2e-license-marker'
import { app, net } from 'electron'
import { getSecret } from './env-sanitize'
import { generateHwid } from './hwid'
import { deleteSavedKey, initStore, readSavedKey, writeSavedKey } from './license-store'
import { getLogger } from './logger.service'

const NETWORK_TIMEOUT = 20_000
const MAX_RETRIES = 2

const FALLBACK_URL = 'https://crimson-wildflower-4de0.mirandaotabol.workers.dev'
const FALLBACK_TOKEN = 'DiNhoTOKEN0001'

function getLicenseConfig(): { url: string; token: string } {
  const configPath = join(app.getPath('userData'), 'license-config.json')
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      if (config.url && config.token) {
        return { url: config.url, token: config.token }
      }
    }
  } catch {}
  const url = process.env.LICENSE_API_URL || FALLBACK_URL
  const token = getSecret('LICENSE_API_TOKEN') || FALLBACK_TOKEN
  if (!getSecret('LICENSE_API_TOKEN')) {
    getLogger().warning('license', 'Using hardcoded fallback token — set LICENSE_API_TOKEN env var for production')
  }
  return { url, token }
}

let initialized = false

function ensureInit(): void {
  if (initialized) return
  const userData = app.getPath('userData')
  initStore({
    keyFile: join(userData, 'remote-license.key'),
    saltFile: join(userData, '.store-salt'),
  })
  initialized = true
}

async function callApi(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { url: apiUrl, token: apiToken } = getLicenseConfig()
  const payload = JSON.stringify({ ...body, token: apiToken })
  let lastBodySnippet = ''

  async function fetchOnce(url: string): Promise<{ status: number; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      const req = net.request({ method: 'POST', url, useSessionCookies: false } as {
        method: string
        url: string
        useSessionCookies: boolean
      })
      const timer = setTimeout(() => req.abort(), NETWORK_TIMEOUT)

      req.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(new Error(err.message || 'network error'))
      })
      req.on('abort', () => {
        clearTimeout(timer)
        reject(new Error('aborted/connection closed'))
      })
      req.on('response', (resp: Electron.IncomingMessage) => {
        clearTimeout(timer)
        const code = resp.statusCode ?? 0
        const stream = (resp as Electron.IncomingMessage & { response?: Electron.IncomingMessage }).response ?? resp
        if (!stream || typeof stream.on !== 'function') {
          reject(new Error('invalid response stream'))
          return
        }
        const onStreamError = (err: Error) => {
          clearTimeout(timer)
          reject(new Error(err.message || 'response stream error'))
        }
        const onStreamAborted = () => {
          clearTimeout(timer)
          reject(new Error('response aborted/stream closed'))
        }
        stream.on('error', onStreamError)
        stream.on('aborted' as unknown as 'aborted', onStreamAborted)
        stream.on('data', (d: unknown) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d as string)))
        stream.on('end', () => {
          clearTimeout(timer)
          resolve({ status: code, body: Buffer.concat(chunks) })
        })
      })
      req.setHeader('Content-Type', 'application/json')
      req.setHeader('Authorization', `Bearer ${apiToken}`)
      req.setHeader('Accept', 'application/json')
      req.write(payload)
      req.end()
    })
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      let url = apiUrl
      for (let hop = 0; hop < 5; hop++) {
        const { status, body } = await fetchOnce(url)
        lastBodySnippet = body.toString('utf8').slice(0, 500)
        if (status >= 300 && status < 400) {
          const loc =
            lastBodySnippet.match(/Location:\s*(\S+)/i)?.[1] ?? lastBodySnippet.match(/<A HREF="([^"]+)">/)?.[1]
          if (!loc) throw new Error(`redirect ${status} sem Location`)
          url = loc
          continue
        }
        const parsed = JSON.parse(body.toString('utf8'))
        if (parsed && typeof parsed === 'object') return parsed
        throw new Error(`invalid response (not a JSON object): ${lastBodySnippet}`)
      }
      throw new Error('muitos redirects')
    } catch {
      if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 1500))
    }
  }
  throw new Error('Falha ao conectar com o servidor de licença')
}

export interface RemoteLicenseResult {
  valid: boolean
  reason?: string
  type?: string
  expires_at?: string | null
}

const CACHE_VALIDITY_MS = 24 * 60 * 60 * 1000

interface CacheEntry {
  valid: boolean
  reason?: string
  type?: string
  expires_at?: string | null
  timestamp: number
}

function getCachePath(): string {
  return join(app.getPath('userData'), '.license-cache.json')
}

function readCache(): CacheEntry | null {
  try {
    const cachePath = getCachePath()
    if (existsSync(cachePath)) {
      const data = JSON.parse(readFileSync(cachePath, 'utf-8'))
      if (data && typeof data.timestamp === 'number') return data as CacheEntry
    }
  } catch {}
  return null
}

function writeCache(entry: CacheEntry): void {
  try {
    writeFileSync(getCachePath(), JSON.stringify(entry), 'utf-8')
  } catch {}
}

export function validateLicenseOffline(): RemoteLicenseResult {
  const cached = readCache()
  if (cached && Date.now() - cached.timestamp < CACHE_VALIDITY_MS && cached.valid) {
    return {
      valid: true,
      ...(cached.type ? { type: cached.type } : {}),
      ...(cached.expires_at !== undefined ? { expires_at: cached.expires_at } : {}),
    }
  }
  return { valid: false, reason: 'Sem validação offline disponível' }
}

export async function validateLicense(key: string, hwid: string): Promise<RemoteLicenseResult> {
  try {
    const data = await callApi({ action: 'validate', key, hwid })
    if (data?.valid) {
      const result: RemoteLicenseResult = {
        valid: true,
        ...(typeof data.type === 'string' ? { type: data.type } : {}),
        ...(typeof data.expires_at === 'string' && data.expires_at !== ''
          ? { expires_at: data.expires_at }
          : { expires_at: null }),
      }
      writeCache({ ...result, timestamp: Date.now() } as CacheEntry)
      return result
    }
    return {
      valid: false,
      reason: typeof data?.reason === 'string' ? data.reason : 'Licença inválida',
      ...(typeof data.type === 'string' ? { type: data.type } : {}),
      ...(typeof data.expires_at === 'string' && data.expires_at !== ''
        ? { expires_at: data.expires_at }
        : { expires_at: null }),
    }
  } catch {
    return { valid: false, reason: 'Sem conexao com o servidor' }
  }
}

export async function activateLicense(key: string): Promise<RemoteLicenseResult> {
  ensureInit()
  const hwid = await generateHwid()
  const result = await validateLicense(key.toUpperCase().trim(), hwid)
  const userData = app.getPath('userData')
  if (result.valid) writeSavedKey(join(userData, 'remote-license.key'), key.toUpperCase().trim())
  else deleteSavedKey(join(userData, 'remote-license.key'))
  return result
}

export function isE2EBypassEnabled(): boolean {
  if (process.env.DINHO_E2E !== '1') return false
  if (app.isPackaged) return false
  if (!process.env.DINHO_E2E_KEY) return false
  try {
    const markerPath = join(app.getPath('userData'), E2E_MARKER_FILENAME)
    return existsSync(markerPath)
  } catch {
    return false
  }
}

let revalidationInFlight = false

function scheduleBackgroundRevalidation(key: string): void {
  if (revalidationInFlight) return
  revalidationInFlight = true
  void generateHwid()
    .then((hwid) => validateLicense(key, hwid))
    .catch(() => {})
    .finally(() => {
      revalidationInFlight = false
    })
}

export async function checkLicense(): Promise<RemoteLicenseResult> {
  if (isE2EBypassEnabled()) {
    return { valid: true, type: 'test' }
  }
  ensureInit()
  const userData = app.getPath('userData')
  const key = readSavedKey(join(userData, 'remote-license.key'))
  if (!key) return { valid: false, reason: 'Nenhuma licença encontrada' }
  const cached = readCache()
  if (cached && Date.now() - cached.timestamp < CACHE_VALIDITY_MS && cached.valid) {
    scheduleBackgroundRevalidation(key)
    return {
      valid: true,
      ...(cached.type ? { type: cached.type } : {}),
      ...(cached.expires_at !== undefined ? { expires_at: cached.expires_at } : {}),
    }
  }
  const hwid = await generateHwid()
  const result = await validateLicense(key, hwid)
  if (!result.valid && result.reason === 'Sem conexao com o servidor') {
    return validateLicenseOffline()
  }
  return result
}

export async function getHwid(): Promise<string> {
  return generateHwid()
}

/** @internal reset de estado para testes */
export function __resetForTest(): void {
  initialized = false
}
