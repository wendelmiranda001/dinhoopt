import { CleanerType } from '@shared/enums'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDashboardStore } from './dashboard-store'

type DinhoMock = Record<string, ReturnType<typeof vi.fn>>

function mockWindowDinho(): DinhoMock {
  const dinho: DinhoMock = {
    systemScan: vi.fn(),
    systemClean: vi.fn(),
    winSxSScan: vi.fn(),
    winSxSClean: vi.fn(),
    browserScan: vi.fn(),
    browserClean: vi.fn(),
    appScan: vi.fn(),
    appClean: vi.fn(),
    gamingScan: vi.fn(),
    gamingClean: vi.fn(),
    recycleBinScan: vi.fn(),
    recycleBinClean: vi.fn(),
    shortcutScan: vi.fn(),
    shortcutClean: vi.fn(),
    environmentScan: vi.fn(),
    environmentClean: vi.fn(),
    databaseScan: vi.fn(),
    databaseClean: vi.fn(),
    uninstallLeftoversScan: vi.fn(),
    uninstallLeftoversClean: vi.fn(),
  }
  ;(globalThis as { window?: unknown }).window = {}
  ;(window as { dinho?: unknown }).dinho = dinho
  return dinho
}

const CLEANERS: { type: CleanerType; scan: string; clean: string; cleanNoArgs?: boolean }[] = [
  { type: CleanerType.System, scan: 'systemScan', clean: 'systemClean' },
  { type: CleanerType.WinSxS, scan: 'winSxSScan', clean: 'winSxSClean', cleanNoArgs: true },
  { type: CleanerType.Browser, scan: 'browserScan', clean: 'browserClean' },
  { type: CleanerType.App, scan: 'appScan', clean: 'appClean' },
  { type: CleanerType.Gaming, scan: 'gamingScan', clean: 'gamingClean' },
  { type: CleanerType.RecycleBin, scan: 'recycleBinScan', clean: 'recycleBinClean', cleanNoArgs: true },
  { type: CleanerType.Shortcut, scan: 'shortcutScan', clean: 'shortcutClean' },
  { type: CleanerType.Environment, scan: 'environmentScan', clean: 'environmentClean' },
  { type: CleanerType.Database, scan: 'databaseScan', clean: 'databaseClean' },
  { type: CleanerType.UninstallLeftovers, scan: 'uninstallLeftoversScan', clean: 'uninstallLeftoversClean' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useDashboardStore', () => {
  it('registers one cleaner entry per CleanerType', () => {
    const fns = useDashboardStore.getState().cleanerFns
    expect(fns).toHaveLength(CLEANERS.length)
    expect(fns.map((f) => f.type)).toEqual(CLEANERS.map((c) => c.type))
  })

  it('exposes a scan and clean function for every entry', () => {
    const fns = useDashboardStore.getState().cleanerFns
    for (const fn of fns) {
      expect(typeof fn.scan).toBe('function')
      expect(typeof fn.clean).toBe('function')
    }
  })

  it('delegates each scan to the matching window.dinho method and returns its result', async () => {
    const dinho = mockWindowDinho()
    const fns = useDashboardStore.getState().cleanerFns
    for (const cleaner of CLEANERS) {
      const entry = fns.find((f) => f.type === cleaner.type)
      expect(entry).toBeDefined()
      const expected = [{ id: `${cleaner.type}-result` }]
      dinho[cleaner.scan]!.mockResolvedValue(expected)
      await expect(entry!.scan()).resolves.toEqual(expected)
      expect(dinho[cleaner.scan]).toHaveBeenCalledWith()
    }
  })

  it('delegates each clean to the matching window.dinho method', async () => {
    const dinho = mockWindowDinho()
    const fns = useDashboardStore.getState().cleanerFns
    const ids = ['a', 'b']
    for (const cleaner of CLEANERS) {
      const entry = fns.find((f) => f.type === cleaner.type)
      expect(entry).toBeDefined()
      const expected = { cleaned: 1, failed: 0, skipped: 0 }
      dinho[cleaner.clean]!.mockResolvedValue(expected)
      if (cleaner.cleanNoArgs) {
        await expect(entry!.clean([])).resolves.toEqual(expected)
        expect(dinho[cleaner.clean]).toHaveBeenCalledWith()
      } else {
        await expect(entry!.clean(ids)).resolves.toEqual(expected)
        expect(dinho[cleaner.clean]).toHaveBeenCalledWith(ids)
      }
    }
  })
})
