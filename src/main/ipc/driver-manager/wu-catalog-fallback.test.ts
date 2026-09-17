import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaleDriver } from './wu-catalog-fallback'
import { parseCatalogHtml, searchCatalogForDrivers } from './wu-catalog-fallback'

vi.mock('../../services/exec-utf8', () => ({
  execFileAsync: vi.fn(),
  psArgs: vi.fn((script: string) => ['-NoProfile', '-Command', script]),
}))

vi.mock('../../services/logger.service', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  }),
}))

const MOCK_DRIVER: StaleDriver = {
  hardwareId: 'PCI\\VEN_10DE&DEV_2484',
  deviceName: 'NVIDIA GeForce RTX 4090',
  currentVersion: '31.0.14.7239',
  className: 'DISPLAY',
}

function buildCatalogRow(updateId: string, title: string, products: string, date: string, size: string): string {
  return `
    <tr data-updateid="{${updateId}}" class="even">
      <td class="chkbx"><input type="checkbox" /></td>
      <td class="title"><a href="/">${title}</a></td>
      <td class="products">${products}</td>
      <td class="classification">Drivers</td>
      <td class="date">${date}</td>
      <td class="size">${size}</td>
    </tr>
  `
}

describe('parseCatalogHtml', () => {
  it('extracts updates from valid catalog HTML', () => {
    const html = `
      <table>
        <tr><th>Title</th><th>Products</th><th>Classification</th><th>Last Updated</th><th>Size</th></tr>
        ${buildCatalogRow('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'NVIDIA GeForce - 31.0.15.5135', 'Windows 10 x64', '10/25/2024', '15.2 MB')}
        ${buildCatalogRow('b2c3d4e5-f6a7-8901-bcde-f12345678901', 'NVIDIA GeForce - 32.0.1.0001', 'Windows 11 x64', '11/01/2024', '22.1 MB')}
      </table>
    `
    const results = parseCatalogHtml(html, MOCK_DRIVER)

    expect(results).toHaveLength(2)
    expect(results[0]!.updateId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    expect(results[0]!.availableVersion).toBe('31.0.15.5135')
    expect(results[0]!.downloadSize).toBe('15.2 MB')
    expect(results[0]!.deviceName).toBe('NVIDIA GeForce RTX 4090')
    expect(results[0]!.deviceId).toBe('PCI\\VEN_10DE&DEV_2484')
    expect(results[0]!.currentVersion).toBe('31.0.14.7239')
    expect(results[0]!.selected).toBe(true)

    expect(results[1]!.updateId).toBe('b2c3d4e5-f6a7-8901-bcde-f12345678901')
    expect(results[1]!.availableVersion).toBe('32.0.1.0001')
  })

  it('returns empty array for HTML with no matching rows', () => {
    const html = '<table><tr><th>No results</th></tr></table>'
    const results = parseCatalogHtml(html, MOCK_DRIVER)
    expect(results).toHaveLength(0)
  })

  it('returns empty array for empty HTML', () => {
    expect(parseCatalogHtml('', MOCK_DRIVER)).toHaveLength(0)
    expect(parseCatalogHtml('<html></html>', MOCK_DRIVER)).toHaveLength(0)
  })

  it('skips rows without updateid', () => {
    const html = `
      <table>
        <tr>
          <td class="chkbx"><input type="checkbox" /></td>
          <td class="title"><a href="/">Some Driver</a></td>
          <td>Products</td>
          <td>Classification</td>
          <td>10/25/2024</td>
          <td>5 MB</td>
        </tr>
      </table>
    `
    const results = parseCatalogHtml(html, MOCK_DRIVER)
    expect(results).toHaveLength(0)
  })

  it('skips header rows (no <a> tag)', () => {
    const html = `
      <table>
        <tr><th>Title</th><th>Products</th></tr>
        ${buildCatalogRow('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'NVIDIA - 31.0.15.5135', 'Windows 10', '10/25/2024', '15 MB')}
      </table>
    `
    const results = parseCatalogHtml(html, MOCK_DRIVER)
    expect(results).toHaveLength(1)
    expect(results[0]!.updateId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
  })

  it('handles version extraction from various title formats', () => {
    const html = `
      <table>
        ${buildCatalogRow('11111111-2222-3333-4444-555555555555', 'Realtek - 6.0.1.8638', 'Windows 10', '01/01/2024', '5 MB')}
        ${buildCatalogRow('22222222-3333-4444-5555-666666666666', 'Intel Corporation version 28.3.1.0', 'Windows 11', '02/01/2024', '8 MB')}
        ${buildCatalogRow('33333333-4444-5555-6666-777777777777', 'AMD Radeon - 12.0.1.3', 'Windows 10', '03/01/2024', '12 MB')}
      </table>
    `
    const results = parseCatalogHtml(html, MOCK_DRIVER)
    expect(results).toHaveLength(3)
    expect(results[0]!.availableVersion).toBe('6.0.1.8638')
    expect(results[1]!.availableVersion).toBe('28.3.1.0')
    expect(results[2]!.availableVersion).toBe('12.0.1.3')
  })

  it('uses date as version fallback when no version in title', () => {
    const html = `
      <table>
        ${buildCatalogRow('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Generic Driver Update', 'Windows 10', '10/25/2024', '1 MB')}
      </table>
    `
    const results = parseCatalogHtml(html, MOCK_DRIVER)
    expect(results).toHaveLength(1)
    expect(results[0]!.availableVersion).toBe('10/25/2024')
    expect(results[0]!.provider).toBe('Windows 10')
  })

  it('handles data-updateid with curly braces', () => {
    const html = `
      <table>
        ${buildCatalogRow('A1B2C3D4-E5F6-7890-ABCD-EF1234567890', 'NVIDIA - 31.0.15.5135', 'Windows 10', '10/25/2024', '15 MB')}
      </table>
    `
    const results = parseCatalogHtml(html, MOCK_DRIVER)
    expect(results).toHaveLength(1)
    expect(results[0]!.updateId).toBe('A1B2C3D4-E5F6-7890-ABCD-EF1234567890')
  })
})

describe('searchCatalogForDrivers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array for empty input', async () => {
    const result = await searchCatalogForDrivers([])
    expect(result).toHaveLength(0)
  })

  it('calls PowerShell and parses HTML response', async () => {
    const html = `
      <table>
        ${buildCatalogRow('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'NVIDIA - 31.0.15.5135', 'Windows 10', '10/25/2024', '15.2 MB')}
      </table>
    `
    const psOutput = `CATALOG_HTML_START\n${html}\nCATALOG_HTML_END`
    const { execFileAsync } = await import('../../services/exec-utf8')
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: psOutput, stderr: '' })

    const results = await searchCatalogForDrivers([MOCK_DRIVER])

    expect(results).toHaveLength(1)
    expect(results[0]!.updateId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    expect(results[0]!.deviceName).toBe('NVIDIA GeForce RTX 4090')
  })

  it('handles PowerShell errors gracefully', async () => {
    const psOutput = 'CATALOG_ERROR|Connection refused'
    const { execFileAsync } = await import('../../services/exec-utf8')
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: psOutput, stderr: '' })

    const results = await searchCatalogForDrivers([MOCK_DRIVER])
    expect(results).toHaveLength(0)
  })

  it('handles missing HTML markers gracefully', async () => {
    const { execFileAsync } = await import('../../services/exec-utf8')
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: 'random output\nno markers here', stderr: '' })

    const results = await searchCatalogForDrivers([MOCK_DRIVER])
    expect(results).toHaveLength(0)
  })

  it('deduplicates results by updateId + version', async () => {
    const html = `
      <table>
        ${buildCatalogRow('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'NVIDIA - 31.0.15.5135', 'Windows 10', '10/25/2024', '15.2 MB')}
      </table>
    `
    const psOutput = `CATALOG_HTML_START\n${html}\nCATALOG_HTML_END`
    const { execFileAsync } = await import('../../services/exec-utf8')
    vi.mocked(execFileAsync).mockResolvedValueOnce({ stdout: psOutput, stderr: '' })

    const results = await searchCatalogForDrivers([MOCK_DRIVER, MOCK_DRIVER])
    expect(results).toHaveLength(1) // deduplicated
  })

  it('skips drivers without hardwareId', async () => {
    const { execFileAsync } = await import('../../services/exec-utf8')
    const noHwDriver: StaleDriver = { hardwareId: '', deviceName: 'Test', currentVersion: '1.0', className: 'System' }

    const results = await searchCatalogForDrivers([noHwDriver])
    expect(results).toHaveLength(0)
    expect(execFileAsync).not.toHaveBeenCalled()
  })
})
