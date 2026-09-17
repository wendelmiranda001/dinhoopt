import type { LicenseResult } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLicenseStore } from './license-store'

function mockKudu() {
  const mock = {
    licenseGetHwid: vi.fn(),
    licenseActivate: vi.fn(),
    licenseStatus: vi.fn(),
  }
  if (typeof window === 'undefined') {
    ;(globalThis as any).window = {}
  }
  ;(window as any).dinho = mock
  return mock
}

function makeLicenseResult(overrides: Partial<LicenseResult> = {}): LicenseResult {
  return {
    valid: true,
    reason: 'Ativação bem-sucedida',
    ...overrides,
  }
}

describe('license-store', () => {
  beforeEach(() => {
    useLicenseStore.setState({
      hwid: '',
      status: null,
      isActivating: false,
      error: null,
      loading: false,
    })
  })

  it('starts with default state', () => {
    const state = useLicenseStore.getState()
    expect(state.hwid).toBe('')
    expect(state.status).toBeNull()
    expect(state.isActivating).toBe(false)
    expect(state.error).toBeNull()
    expect(state.loading).toBe(false)
  })

  it('getHwid returns and stores hwid', async () => {
    const kudu = mockKudu()
    kudu.licenseGetHwid.mockResolvedValue('HWID-12345')
    const hwid = await useLicenseStore.getState().getHwid()
    expect(hwid).toBe('HWID-12345')
    expect(useLicenseStore.getState().hwid).toBe('HWID-12345')
  })

  it('getHwid returns empty string on error', async () => {
    const kudu = mockKudu()
    kudu.licenseGetHwid.mockRejectedValue(new Error('fail'))
    const hwid = await useLicenseStore.getState().getHwid()
    expect(hwid).toBe('')
  })

  it('getHwid falls back when method is undefined', async () => {
    mockKudu()
    delete (window as any).dinho.licenseGetHwid
    const hwid = await useLicenseStore.getState().getHwid()
    expect(hwid).toBe('')
    expect(useLicenseStore.getState().hwid).toBe('')
  })

  it('activate sets isActivating and calls kudu.licenseActivate', async () => {
    const kudu = mockKudu()
    const result = makeLicenseResult({ valid: true })
    kudu.licenseActivate.mockResolvedValue(result)
    const res = await useLicenseStore.getState().activate('KEY-123')
    expect(kudu.licenseActivate).toHaveBeenCalledWith('KEY-123')
    expect(res).toEqual(result)
    expect(useLicenseStore.getState().isActivating).toBe(false)
    expect(useLicenseStore.getState().status).toEqual(result)
  })

  it('activate sets error on invalid result', async () => {
    const kudu = mockKudu()
    const result = makeLicenseResult({ valid: false, reason: 'Chave inválida' })
    kudu.licenseActivate.mockResolvedValue(result)
    await useLicenseStore.getState().activate('KEY-BAD')
    expect(useLicenseStore.getState().error).toBe('Chave inválida')
  })

  it('activate sets error to reason even when reason is null', async () => {
    const kudu = mockKudu()
    const result: LicenseResult = { valid: false }
    kudu.licenseActivate.mockResolvedValue(result)
    await useLicenseStore.getState().activate('KEY-NULL')
    expect(useLicenseStore.getState().error).toBeNull()
  })

  it('activate falls back when method is undefined', async () => {
    mockKudu()
    delete (window as any).dinho.licenseActivate
    const result = await useLicenseStore.getState().activate('KEY')
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('Erro na ativação')
    expect(useLicenseStore.getState().isActivating).toBe(false)
  })

  it('activate handles non-Error thrown to exercise ?. fallback', async () => {
    const kudu = mockKudu()
    kudu.licenseActivate.mockRejectedValue('string error' as unknown as never)
    const result = await useLicenseStore.getState().activate('KEY-STR')
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('Erro ao ativar')
    expect(useLicenseStore.getState().error).toBe('Erro ao ativar')
  })

  it('activate handles error gracefully', async () => {
    const kudu = mockKudu()
    kudu.licenseActivate.mockRejectedValue(new Error('network error'))
    const result = await useLicenseStore.getState().activate('KEY-ERR')
    expect(result.valid).toBe(false)
    expect(useLicenseStore.getState().isActivating).toBe(false)
    expect(useLicenseStore.getState().error).toBeTruthy()
  })

  it('checkStatus sets loading and calls kudu.licenseStatus', async () => {
    const kudu = mockKudu()
    const result = makeLicenseResult({ valid: true })
    kudu.licenseStatus.mockResolvedValue(result)
    const res = await useLicenseStore.getState().checkStatus()
    expect(kudu.licenseStatus).toHaveBeenCalled()
    expect(res).toEqual(result)
    expect(useLicenseStore.getState().loading).toBe(false)
    expect(useLicenseStore.getState().status).toEqual(result)
  })

  it('checkStatus handles error gracefully', async () => {
    const kudu = mockKudu()
    kudu.licenseStatus.mockRejectedValue(new Error('fail'))
    const result = await useLicenseStore.getState().checkStatus()
    expect(result.valid).toBe(false)
    expect(useLicenseStore.getState().loading).toBe(false)
  })
})
