// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockStore = {
  apps: [],
  searchQuery: '',
  sortField: 'name',
  sortDirection: 'asc' as const,
  severityFilter: 'all' as 'all' | 'major' | 'minor' | 'patch' | 'uptodate',
  loading: false,
  updating: false,
}

vi.mock('@/stores/updater-store', () => ({
  useUpdaterStore: (selector: (s: typeof mockStore) => unknown) => selector(mockStore),
  severityOrder: { major: 0, minor: 1, patch: 2, uptodate: 3, all: 4 },
}))

import { useFilteredAndSortedApps } from './useFilteredAndSortedApps'

describe('useFilteredAndSortedApps', () => {
  beforeEach(() => {
    mockStore.apps = []
    mockStore.searchQuery = ''
    mockStore.sortField = 'name'
    mockStore.sortDirection = 'asc'
    mockStore.severityFilter = 'all'
    mockStore.loading = false
    mockStore.updating = false
  })

  it('returns empty arrays for no apps', () => {
    const { result } = renderHook(() => useFilteredAndSortedApps())

    expect(result.current.filteredApps).toEqual([])
    expect(result.current.upToDate).toEqual([])
    expect(result.current.selectedCount).toBe(0)
    expect(result.current.allSelected).toBe(false)
    expect(result.current.isBusy).toBe(false)
  })

  it('filters by severity', () => {
    mockStore.apps = [
      { id: 'a', name: 'App A', severity: 'major', selected: false, source: 'winget' },
      { id: 'b', name: 'App B', severity: 'minor', selected: false, source: 'winget' },
      { id: 'c', name: 'App C', severity: 'patch', selected: false, source: 'winget' },
    ] as never
    mockStore.severityFilter = 'major'

    const { result } = renderHook(() => useFilteredAndSortedApps())

    expect(result.current.filteredApps).toHaveLength(1)
    expect(result.current.filteredApps[0]!.id).toBe('a')
  })

  it('filters by search query', () => {
    mockStore.apps = [
      { id: 'a', name: 'Alpha', severity: 'major', selected: false, source: 'winget' },
      { id: 'b', name: 'Beta', severity: 'minor', selected: false, source: 'winget' },
    ] as never
    mockStore.searchQuery = 'beta'

    const { result } = renderHook(() => useFilteredAndSortedApps())

    expect(result.current.filteredApps).toHaveLength(1)
    expect(result.current.filteredApps[0]!.id).toBe('b')
  })

  it('sorts by name ascending', () => {
    mockStore.apps = [
      { id: 'b', name: 'Beta', severity: 'major', selected: false, source: 'winget' },
      { id: 'a', name: 'Alpha', severity: 'minor', selected: false, source: 'winget' },
    ] as never
    mockStore.sortField = 'name'
    mockStore.sortDirection = 'asc'

    const { result } = renderHook(() => useFilteredAndSortedApps())

    expect(result.current.filteredApps[0]!.name).toBe('Alpha')
    expect(result.current.filteredApps[1]!.name).toBe('Beta')
  })

  it('sorts by severity', () => {
    mockStore.apps = [
      { id: 'b', name: 'Beta', severity: 'patch', selected: false, source: 'winget' },
      { id: 'a', name: 'Alpha', severity: 'major', selected: false, source: 'winget' },
    ] as never
    mockStore.sortField = 'severity'
    mockStore.sortDirection = 'asc'

    const { result } = renderHook(() => useFilteredAndSortedApps())

    expect(result.current.filteredApps[0]!.id).toBe('a')
    expect(result.current.filteredApps[1]!.id).toBe('b')
  })

  it('computed selectedCount and allSelected', () => {
    mockStore.apps = [
      { id: 'a', name: 'A', severity: 'major', selected: true, source: 'winget' },
      { id: 'b', name: 'B', severity: 'minor', selected: false, source: 'winget' },
      { id: 'c', name: 'C', severity: 'patch', selected: true, source: 'winget' },
    ] as never

    const { result } = renderHook(() => useFilteredAndSortedApps())

    expect(result.current.selectedCount).toBe(2)
    expect(result.current.allSelected).toBe(false)
  })

  it('reports isBusy when loading or updating', () => {
    mockStore.loading = true

    const { result, rerender } = renderHook(() => useFilteredAndSortedApps())
    expect(result.current.isBusy).toBe(true)

    mockStore.loading = false
    mockStore.updating = true

    rerender()
    expect(result.current.isBusy).toBe(true)
  })

  it('separates upToDate apps', () => {
    mockStore.apps = [
      { id: 'a', name: 'A', severity: 'uptodate', isUpToDate: true, selected: false, source: 'winget' },
      { id: 'b', name: 'B', severity: 'major', isUpToDate: false, selected: false, source: 'winget' },
    ] as never

    const { result } = renderHook(() => useFilteredAndSortedApps())

    expect(result.current.upToDate).toHaveLength(1)
    expect(result.current.upToDate[0]!.id).toBe('a')
  })

  it('reports severity counts', () => {
    mockStore.apps = [
      { id: 'a', name: 'A', severity: 'major', selected: false, source: 'winget' },
      { id: 'b', name: 'B', severity: 'major', selected: false, source: 'winget' },
      { id: 'c', name: 'C', severity: 'minor', selected: false, source: 'winget' },
      { id: 'd', name: 'D', severity: 'patch', selected: false, source: 'winget' },
    ] as never

    const { result } = renderHook(() => useFilteredAndSortedApps())

    expect(result.current.majorCount).toBe(2)
    expect(result.current.minorCount).toBe(1)
    expect(result.current.patchCount).toBe(1)
  })
})
