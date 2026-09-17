import { IPC } from '@shared/channels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowGetter } from './index'

const mockHandle = vi.fn()
vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle },
}))

vi.mock('../services/elevation', () => ({
  isAdmin: () => true,
}))

vi.mock('../services/compliance-auditor.service', () => ({
  scanCompliance: vi.fn(),
  applyComplianceSettings: vi.fn(),
  revertComplianceSettings: vi.fn(),
}))

describe('registerComplianceAuditorIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all three COMPLIANCE handlers', async () => {
    const { registerComplianceAuditorIpc } = await import('./compliance-auditor.ipc')
    const getWindow = () => null
    registerComplianceAuditorIpc(getWindow)

    expect(mockHandle).toHaveBeenCalledTimes(3)
    const channels = mockHandle.mock.calls.map((c: any[]) => c[0])
    expect(channels).toContain(IPC.COMPLIANCE_SCAN)
    expect(channels).toContain(IPC.COMPLIANCE_APPLY)
    expect(channels).toContain(IPC.COMPLIANCE_REVERT)
  })

  it('COMPLIANCE_SCAN handler calls scanCompliance', async () => {
    const { registerComplianceAuditorIpc } = await import('./compliance-auditor.ipc')
    const { scanCompliance } = await import('../services/compliance-auditor.service')
    const getWindow = () => null
    registerComplianceAuditorIpc(getWindow)
    const scanHandler = mockHandle.mock.calls.find((c: any[]) => c[0] === IPC.COMPLIANCE_SCAN)?.[1]
    await scanHandler()

    expect(scanCompliance).toHaveBeenCalled()
  })

  it('COMPLIANCE_APPLY validates input before passing to service', async () => {
    const { registerComplianceAuditorIpc } = await import('./compliance-auditor.ipc')
    const { applyComplianceSettings } = await import('../services/compliance-auditor.service')
    const getWindow = () => null
    registerComplianceAuditorIpc(getWindow)
    const applyHandler = mockHandle.mock.calls.find((c: any[]) => c[0] === IPC.COMPLIANCE_APPLY)?.[1]
    const result = await applyHandler(null, 'not-an-array')

    expect(applyComplianceSettings).not.toHaveBeenCalled()
    expect(result).toEqual({ succeeded: 0, failed: 'not-an-array'.length, errors: [] })
  })

  it('COMPLIANCE_REVERT validates input before passing to service', async () => {
    const { registerComplianceAuditorIpc } = await import('./compliance-auditor.ipc')
    const { revertComplianceSettings } = await import('../services/compliance-auditor.service')
    const getWindow = () => null
    registerComplianceAuditorIpc(getWindow)
    const revertHandler = mockHandle.mock.calls.find((c: any[]) => c[0] === IPC.COMPLIANCE_REVERT)?.[1]
    const result = await revertHandler(null, null)

    expect(revertComplianceSettings).not.toHaveBeenCalled()
    expect(result).toEqual({ succeeded: 0, failed: 0, errors: [] })
  })

  it('COMPLIANCE_APPLY passes valid string array to service', async () => {
    const { registerComplianceAuditorIpc } = await import('./compliance-auditor.ipc')
    const { applyComplianceSettings } = await import('../services/compliance-auditor.service')
    const getWindow = () => null
    registerComplianceAuditorIpc(getWindow)
    const applyHandler = mockHandle.mock.calls.find((c: any[]) => c[0] === IPC.COMPLIANCE_APPLY)?.[1]
    await applyHandler(null, ['uac-enabled', 'smb1-disabled'])

    expect(applyComplianceSettings).toHaveBeenCalledWith(['uac-enabled', 'smb1-disabled'])
  })

  it('COMPLIANCE_SCAN sends progress to the window', async () => {
    const { registerComplianceAuditorIpc } = await import('./compliance-auditor.ipc')
    const { scanCompliance } = await import('../services/compliance-auditor.service')

    const mockWebContents = { send: vi.fn() }
    const mockWin = { isDestroyed: () => false, webContents: mockWebContents }
    const getWindow = () => mockWin

    vi.mocked(scanCompliance).mockImplementation(async (onProgress) => {
      onProgress?.({ current: 1, total: 5, currentLabel: 'scanning', category: 'uac' })
      return { checks: [], score: 100, total: 0, compliant: 0 }
    })

    registerComplianceAuditorIpc(getWindow as unknown as WindowGetter)
    const scanHandler = mockHandle.mock.calls.find((c: any[]) => c[0] === IPC.COMPLIANCE_SCAN)?.[1]
    await scanHandler()

    expect(mockWebContents.send).toHaveBeenCalledWith(IPC.COMPLIANCE_PROGRESS, {
      current: 1,
      total: 5,
      currentLabel: 'scanning',
      category: 'uac',
    })
  })

  it('COMPLIANCE_SCAN handles window throwing on send', async () => {
    const { registerComplianceAuditorIpc } = await import('./compliance-auditor.ipc')
    const { scanCompliance } = await import('../services/compliance-auditor.service')

    const mockWebContents = {
      send: vi.fn(() => {
        throw new Error('Window gone')
      }),
    }
    const mockWin = { isDestroyed: () => false, webContents: mockWebContents }
    const getWindow = () => mockWin

    vi.mocked(scanCompliance).mockImplementation(async (onProgress) => {
      onProgress?.({ current: 1, total: 5, currentLabel: 'scanning', category: 'uac' })
      return { checks: [], score: 100, total: 0, compliant: 0 }
    })

    registerComplianceAuditorIpc(getWindow as unknown as WindowGetter)
    const scanHandler = mockHandle.mock.calls.find((c: any[]) => c[0] === IPC.COMPLIANCE_SCAN)?.[1]

    await expect(scanHandler()).resolves.not.toThrow()
  })

  it('COMPLIANCE_REVERT passes valid string array to service', async () => {
    const { registerComplianceAuditorIpc } = await import('./compliance-auditor.ipc')
    const { revertComplianceSettings } = await import('../services/compliance-auditor.service')
    const getWindow = () => null

    registerComplianceAuditorIpc(getWindow)
    const revertHandler = mockHandle.mock.calls.find((c: any[]) => c[0] === IPC.COMPLIANCE_REVERT)?.[1]
    await revertHandler(null, ['setting-1', 'setting-2'])

    expect(revertComplianceSettings).toHaveBeenCalledWith(['setting-1', 'setting-2'])
  })
})
