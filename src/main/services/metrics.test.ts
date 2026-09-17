import type { ScanHistoryEntry } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'

// Mock electron app
vi.mock('electron', () => ({
  app: { getVersion: () => '1.17.0', getPath: () => '/tmp/dinho' },
}))

// Mock systeminformation
vi.mock('systeminformation', () => ({
  currentLoad: vi.fn().mockResolvedValue({ currentLoad: 23.5 }),
  mem: vi.fn().mockResolvedValue({ total: 17179869184, used: 8589934592 }),
}))

const mockGetHistory = vi.hoisted(() => vi.fn<() => ScanHistoryEntry[]>(() => []))
vi.mock('./history-store', () => ({
  getHistory: mockGetHistory,
}))

import { collectMetrics, formatPrometheus } from './metrics'

describe('collectMetrics', () => {
  beforeEach(() => {
    mockGetHistory.mockReturnValue([
      {
        id: '1',
        type: 'cleaner',
        timestamp: '2026-03-20T10:00:00.000Z',
        duration: 5000,
        totalItemsFound: 100,
        totalItemsCleaned: 95,
        totalItemsSkipped: 5,
        totalSpaceSaved: 1073741824,
        categories: [],
        errorCount: 2,
      },
      {
        id: '2',
        type: 'registry',
        timestamp: '2026-03-19T10:00:00.000Z',
        duration: 3000,
        totalItemsFound: 10,
        totalItemsCleaned: 10,
        totalItemsSkipped: 0,
        totalSpaceSaved: 0,
        categories: [],
        errorCount: 0,
      },
    ])
  })
  it('returns an array of metric lines', async () => {
    const metrics = await collectMetrics()
    expect(Array.isArray(metrics)).toBe(true)
    expect(metrics.length).toBeGreaterThan(0)
  })

  it('includes dinho_info metric', async () => {
    const metrics = await collectMetrics()
    const info = metrics.find((m) => m.name === 'dinho_info')
    expect(info).toBeDefined()
    expect(info!.type).toBe('gauge')
    expect(info!.value).toBe(1)
    expect(info!.labels?.version).toBe('1.17.0')
    expect(info!.labels?.platform).toBeDefined()
    expect(info!.labels?.arch).toBeDefined()
  })

  it('includes system uptime metric', async () => {
    const metrics = await collectMetrics()
    const uptime = metrics.find((m) => m.name === 'dinho_system_uptime_seconds')
    expect(uptime).toBeDefined()
    expect(uptime!.type).toBe('gauge')
    expect(uptime!.value).toBeGreaterThan(0)
  })

  it('includes CPU usage metric', async () => {
    const metrics = await collectMetrics()
    const cpu = metrics.find((m) => m.name === 'dinho_system_cpu_usage_percent')
    expect(cpu).toBeDefined()
    expect(cpu!.value).toBe(23.5)
  })

  it('includes memory metrics', async () => {
    const metrics = await collectMetrics()
    const total = metrics.find((m) => m.name === 'dinho_system_memory_total_bytes')
    const used = metrics.find((m) => m.name === 'dinho_system_memory_used_bytes')
    expect(total).toBeDefined()
    expect(total!.value).toBe(17179869184)
    expect(used).toBeDefined()
    expect(used!.value).toBe(8589934592)
  })

  it('includes history-based counters', async () => {
    const metrics = await collectMetrics()
    const scans = metrics.find((m) => m.name === 'dinho_scans_total')
    const cleaned = metrics.find((m) => m.name === 'dinho_items_cleaned_total')
    const space = metrics.find((m) => m.name === 'dinho_space_saved_bytes_total')
    const errors = metrics.find((m) => m.name === 'dinho_scan_errors_total')
    expect(scans?.value).toBe(2)
    expect(cleaned?.value).toBe(105)
    expect(space?.value).toBe(1073741824)
    expect(errors?.value).toBe(2)
  })

  it('includes last scan metrics', async () => {
    const metrics = await collectMetrics()
    const ts = metrics.find((m) => m.name === 'dinho_last_scan_timestamp_seconds')
    const dur = metrics.find((m) => m.name === 'dinho_last_scan_duration_seconds')
    const items = metrics.find((m) => m.name === 'dinho_last_scan_items_found')
    expect(ts).toBeDefined()
    expect(ts!.value).toBe(Math.floor(new Date('2026-03-20T10:00:00.000Z').getTime() / 1000))
    expect(dur?.value).toBe(5)
    expect(items?.value).toBe(100)
  })

  it('omits last scan metrics when history is empty', async () => {
    mockGetHistory.mockReturnValue([])
    const metrics = await collectMetrics()
    const ts = metrics.find((m) => m.name === 'dinho_last_scan_timestamp_seconds')
    const dur = metrics.find((m) => m.name === 'dinho_last_scan_duration_seconds')
    const items = metrics.find((m) => m.name === 'dinho_last_scan_items_found')
    expect(ts).toBeUndefined()
    expect(dur).toBeUndefined()
    expect(items).toBeUndefined()
  })
})

describe('formatPrometheus', () => {
  it('formats a simple gauge metric', () => {
    const output = formatPrometheus([{ name: 'dinho_test', type: 'gauge', help: 'A test metric', value: 42 }])
    expect(output).toContain('# HELP dinho_test A test metric')
    expect(output).toContain('# TYPE dinho_test gauge')
    expect(output).toContain('dinho_test 42')
  })

  it('formats a gauge metric with large value', () => {
    const output = formatPrometheus([{ name: 'dinho_count', type: 'gauge', help: 'A gauge', value: 100 }])
    expect(output).toContain('# TYPE dinho_count gauge')
    expect(output).toContain('dinho_count 100')
  })

  it('formats labels correctly', () => {
    const output = formatPrometheus([
      { name: 'dinho_info', type: 'gauge', help: 'Info', labels: { version: '1.17.0', platform: 'win32' }, value: 1 },
    ])
    expect(output).toContain('dinho_info{version="1.17.0",platform="win32"} 1')
  })

  it('escapes label values', () => {
    const output = formatPrometheus([
      { name: 'dinho_test', type: 'gauge', help: 'Test', labels: { path: 'C:\\Users\\test' }, value: 1 },
    ])
    expect(output).toContain('path="C:\\\\Users\\\\test"')
  })

  it('handles metrics without labels', () => {
    const output = formatPrometheus([{ name: 'dinho_uptime', type: 'gauge', help: 'Uptime', value: 3600 }])
    expect(output).toContain('dinho_uptime 3600')
    expect(output).not.toContain('{')
  })

  it('separates multiple metrics with blank lines', () => {
    const output = formatPrometheus([
      { name: 'metric_a', type: 'gauge', help: 'A', value: 1 },
      { name: 'metric_b', type: 'counter', help: 'B', value: 2 },
    ])
    const lines = output.split('\n')
    // Each metric block is: HELP, TYPE, value, blank line
    expect(lines.filter((l) => l === '').length).toBeGreaterThanOrEqual(2)
  })
})
