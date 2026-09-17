import { CleanerType, ScanStatus } from '@shared/enums'
import type { CleanSummaryData, ProgressData, ScanResult } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useScanStore } from './scan-store'

// Mock localStorage
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, val: string) => storage.set(key, val),
  removeItem: (key: string) => storage.delete(key),
})

function makeResult(category: string, subcategory: string, items: { id: string; size: number }[]): ScanResult {
  return {
    category: category as CleanerType,
    subcategory,
    items: items.map((i) => ({
      ...i,
      path: `C:\\temp\\${i.id}`,
      category: category as CleanerType,
      subcategory,
      lastModified: Date.now(),
      selected: true,
    })),
    totalSize: items.reduce((s, i) => s + i.size, 0),
    itemCount: items.length,
  }
}

describe('scan-store', () => {
  beforeEach(() => {
    storage.clear()
    useScanStore.getState().reset()
  })

  it('starts in idle state with empty results', () => {
    const state = useScanStore.getState()
    expect(state.status).toBe(ScanStatus.Idle)
    expect(state.results).toEqual([])
    expect(state.selectedItems.size).toBe(0)
  })

  it('setResults populates results and auto-selects items', () => {
    const results = [
      makeResult('system', 'temp', [
        { id: 'a', size: 100 },
        { id: 'b', size: 200 },
      ]),
    ]
    useScanStore.getState().setResults(results)
    const state = useScanStore.getState()
    expect(state.results).toHaveLength(1)
    expect(state.selectedItems.has('a')).toBe(true)
    expect(state.selectedItems.has('b')).toBe(true)
  })

  it('addResults appends without replacing', () => {
    useScanStore.getState().setResults([makeResult('system', 'temp', [{ id: 'a', size: 100 }])])
    useScanStore.getState().addResults([makeResult('system', 'logs', [{ id: 'b', size: 200 }])])
    const state = useScanStore.getState()
    expect(state.results).toHaveLength(2)
    expect(state.selectedItems.has('a')).toBe(true)
    expect(state.selectedItems.has('b')).toBe(true)
  })

  it('toggleItem deselects and reselects', () => {
    useScanStore.getState().setResults([makeResult('system', 'temp', [{ id: 'a', size: 100 }])])
    useScanStore.getState().toggleItem('a')
    expect(useScanStore.getState().selectedItems.has('a')).toBe(false)
    useScanStore.getState().toggleItem('a')
    expect(useScanStore.getState().selectedItems.has('a')).toBe(true)
  })

  it('toggleSubcategory deselects all when all selected, selects all when some deselected', () => {
    const result = makeResult('system', 'temp', [
      { id: 'a', size: 100 },
      { id: 'b', size: 200 },
    ])
    useScanStore.getState().setResults([result])
    // All selected → toggle deselects all
    useScanStore.getState().toggleSubcategory(result)
    expect(useScanStore.getState().selectedItems.has('a')).toBe(false)
    expect(useScanStore.getState().selectedItems.has('b')).toBe(false)
    // None selected → toggle selects all
    useScanStore.getState().toggleSubcategory(result)
    expect(useScanStore.getState().selectedItems.has('a')).toBe(true)
    expect(useScanStore.getState().selectedItems.has('b')).toBe(true)
  })

  it('selectAll / deselectAll works per category', () => {
    useScanStore
      .getState()
      .setResults([
        makeResult('system', 'temp', [{ id: 'a', size: 100 }]),
        makeResult('browser', 'chrome', [{ id: 'b', size: 200 }]),
      ])
    useScanStore.getState().deselectAll('system')
    expect(useScanStore.getState().selectedItems.has('a')).toBe(false)
    expect(useScanStore.getState().selectedItems.has('b')).toBe(true)
    useScanStore.getState().selectAll('system')
    expect(useScanStore.getState().selectedItems.has('a')).toBe(true)
  })

  it('toggleCategory toggles all items in a category', () => {
    useScanStore
      .getState()
      .setResults([
        makeResult('system', 'temp', [{ id: 'a', size: 100 }]),
        makeResult('system', 'logs', [{ id: 'b', size: 200 }]),
      ])
    // All selected → deselect all
    useScanStore.getState().toggleCategory('system')
    expect(useScanStore.getState().selectedItems.has('a')).toBe(false)
    expect(useScanStore.getState().selectedItems.has('b')).toBe(false)
    // None selected → select all
    useScanStore.getState().toggleCategory('system')
    expect(useScanStore.getState().selectedItems.has('a')).toBe(true)
    expect(useScanStore.getState().selectedItems.has('b')).toBe(true)
  })

  it('getTotalSize sums all result sizes', () => {
    useScanStore
      .getState()
      .setResults([
        makeResult('system', 'temp', [{ id: 'a', size: 100 }]),
        makeResult('system', 'logs', [{ id: 'b', size: 200 }]),
      ])
    expect(useScanStore.getState().getTotalSize()).toBe(300)
  })

  it('getSelectedSize sums only selected item sizes', () => {
    useScanStore.getState().setResults([
      makeResult('system', 'temp', [
        { id: 'a', size: 100 },
        { id: 'b', size: 200 },
      ]),
    ])
    useScanStore.getState().toggleItem('a')
    expect(useScanStore.getState().getSelectedSize()).toBe(200)
  })

  it('getSelectedIds returns array of selected IDs', () => {
    useScanStore.getState().setResults([
      makeResult('system', 'temp', [
        { id: 'a', size: 100 },
        { id: 'b', size: 200 },
      ]),
    ])
    const ids = useScanStore.getState().getSelectedIds()
    expect(ids.sort()).toEqual(['a', 'b'])
  })

  it('excluded subcategories persist to localStorage', () => {
    const result = makeResult('system', 'temp', [{ id: 'a', size: 100 }])
    useScanStore.getState().setResults([result])
    useScanStore.getState().toggleSubcategory(result)
    expect(useScanStore.getState().excludedSubcategories.has('system:temp')).toBe(true)
    const stored = JSON.parse(storage.get('kudu:excluded-subcategories')!)
    expect(stored).toContain('system:temp')
  })

  it('reset clears state back to defaults', () => {
    useScanStore.getState().setResults([makeResult('system', 'temp', [{ id: 'a', size: 100 }])])
    useScanStore.getState().setStatus(ScanStatus.Complete)
    useScanStore.getState().reset()
    const state = useScanStore.getState()
    expect(state.status).toBe(ScanStatus.Idle)
    expect(state.results).toEqual([])
    expect(state.selectedItems.size).toBe(0)
  })

  it('setProgress stores progress data', () => {
    const progress: ProgressData = {
      phase: 'scanning',
      category: 'system',
      currentPath: 'test.log',
      progress: 50,
      itemsFound: 10,
      sizeFound: 1024,
    }
    useScanStore.getState().setProgress(progress)
    expect(useScanStore.getState().progress).toEqual(progress)

    useScanStore.getState().setProgress(null)
    expect(useScanStore.getState().progress).toBeNull()
  })

  it('setCleanSummary stores clean summary data', () => {
    const summary: CleanSummaryData = {
      totalCleaned: 1024,
      filesDeleted: 10,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
      categories: [],
      duration: 500,
      totalSizeBefore: 2048,
    }
    useScanStore.getState().setCleanSummary(summary)
    expect(useScanStore.getState().cleanSummary).toEqual(summary)

    useScanStore.getState().setCleanSummary(null)
    expect(useScanStore.getState().cleanSummary).toBeNull()
  })

  it('setActiveCategory stores active category', () => {
    useScanStore.getState().setActiveCategory(CleanerType.System)
    expect(useScanStore.getState().activeCategory).toBe(CleanerType.System)

    useScanStore.getState().setActiveCategory(null)
    expect(useScanStore.getState().activeCategory).toBeNull()
  })

  it('addResults does not auto-select items from excluded subcategories', () => {
    useScanStore.setState({ excludedSubcategories: new Set<string>() })
    const result = makeResult('system', 'temp', [{ id: 'a', size: 100 }])
    useScanStore.getState().setResults([result])
    useScanStore.getState().toggleSubcategory(result)

    useScanStore.getState().addResults([makeResult('system', 'temp', [{ id: 'b', size: 200 }])])

    const state = useScanStore.getState()
    expect(state.selectedItems.has('b')).toBe(false)
  })

  it('toggleItem handles unknown id not in any result', () => {
    useScanStore.setState({ excludedSubcategories: new Set<string>() })
    useScanStore.getState().setResults([makeResult('system', 'temp', [{ id: 'a', size: 100 }])])
    useScanStore.getState().toggleItem('unknown')
    expect(useScanStore.getState().excludedSubcategories.size).toBe(0)
    expect(useScanStore.getState().selectedItems.has('unknown')).toBe(true)
  })
})
