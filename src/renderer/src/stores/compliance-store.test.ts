import type { ComplianceApplyResult, ComplianceState } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComplianceStore } from './compliance-store'

const mockKudu = {
  complianceScan: vi.fn(),
  complianceApply: vi.fn(),
  complianceRevert: vi.fn(),
  onComplianceProgress: vi.fn(() => vi.fn()),
}

vi.stubGlobal('window', { dinho: mockKudu })

const fakeState: ComplianceState = {
  checks: [
    {
      id: 'uac-enabled',
      category: 'uac',
      severity: 'critical',
      label: 'UAC',
      description: 'UAC ativo',
      compliant: true,
      reversible: true,
      requiresAdmin: false,
      applicable: true,
      value: 'Ativado',
      expected: 'Ativado',
    },
    {
      id: 'smb1-disabled',
      category: 'network',
      severity: 'critical',
      label: 'SMBv1',
      description: 'SMBv1 desativado',
      compliant: false,
      reversible: true,
      requiresAdmin: true,
      applicable: true,
      value: 'Ativado',
      expected: 'Desativado',
    },
  ],
  score: 50,
  total: 2,
  compliant: 1,
}

describe('compliance-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useComplianceStore.getState().reset()
  })

  it('starts idle with null state', () => {
    const s = useComplianceStore.getState()
    expect(s.status).toBe('idle')
    expect(s.state).toBeNull()
    expect(s.applyResult).toBeNull()
  })

  it('setStatus updates status', () => {
    useComplianceStore.getState().setStatus('scanning')
    expect(useComplianceStore.getState().status).toBe('scanning')
  })

  it('setState stores ComplianceState', () => {
    useComplianceStore.getState().setState(fakeState)
    expect(useComplianceStore.getState().state).toEqual(fakeState)
  })

  it('toggleCategory adds and removes from set', () => {
    useComplianceStore.getState().toggleCategory('password')
    expect(useComplianceStore.getState().expandedCategories.has('password')).toBe(true)
    useComplianceStore.getState().toggleCategory('password')
    expect(useComplianceStore.getState().expandedCategories.has('password')).toBe(false)
  })

  it('reset clears all state', () => {
    useComplianceStore.getState().setState(fakeState)
    useComplianceStore.getState().setStatus('done')
    useComplianceStore.getState().reset()
    const s = useComplianceStore.getState()
    expect(s.state).toBeNull()
    expect(s.status).toBe('idle')
  })

  it('scan calls complianceScan and updates state', async () => {
    mockKudu.complianceScan.mockResolvedValueOnce(fakeState)
    await useComplianceStore.getState().scan()
    expect(mockKudu.complianceScan).toHaveBeenCalled()
    expect(mockKudu.onComplianceProgress).toHaveBeenCalled()
    expect(useComplianceStore.getState().state).toEqual(fakeState)
    expect(useComplianceStore.getState().status).toBe('done')
  })

  it('scan sets idle on failure', async () => {
    mockKudu.complianceScan.mockRejectedValueOnce(new Error('fail'))
    await useComplianceStore.getState().scan()
    expect(useComplianceStore.getState().status).toBe('idle')
  })

  it('apply calls complianceApply and rescans', async () => {
    const expectedResult: ComplianceApplyResult = { succeeded: 1, failed: 0, errors: [] }
    mockKudu.complianceApply.mockResolvedValueOnce(expectedResult)
    mockKudu.complianceScan.mockResolvedValueOnce(fakeState)

    await useComplianceStore.getState().apply(['uac-enabled'])

    expect(mockKudu.complianceApply).toHaveBeenCalledWith(['uac-enabled'])
    expect(mockKudu.complianceScan).toHaveBeenCalled()
    expect(useComplianceStore.getState().state).toEqual(fakeState)
    expect(useComplianceStore.getState().status).toBe('done')
  })

  it('revert calls complianceRevert and rescans', async () => {
    const expectedResult: ComplianceApplyResult = { succeeded: 1, failed: 0, errors: [] }
    mockKudu.complianceRevert.mockResolvedValueOnce(expectedResult)
    mockKudu.complianceScan.mockResolvedValueOnce(fakeState)

    await useComplianceStore.getState().revert(['smb1-disabled'])

    expect(mockKudu.complianceRevert).toHaveBeenCalledWith(['smb1-disabled'])
    expect(mockKudu.complianceScan).toHaveBeenCalled()
  })
})
