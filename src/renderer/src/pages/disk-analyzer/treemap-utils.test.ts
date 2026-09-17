import { describe, expect, it } from 'vitest'

import { COLORS, layoutTreemap, squarify, type TreemapRect } from './treemap-utils'

const item = (name: string, size: number, fill = '') => ({ name, size, fill })

describe('squarify', () => {
  it('does nothing for empty input', () => {
    const rects: unknown[] = []
    squarify([], 0, 0, 100, 100, rects as never)
    expect(rects).toHaveLength(0)
  })

  it('does nothing when width or height is zero or negative', () => {
    const rects: unknown[] = []
    squarify([item('a', 10)], 0, 0, 0, 100, rects as never)
    expect(rects).toHaveLength(0)
    squarify([item('a', 10)], 0, 0, 100, -1, rects as never)
    expect(rects).toHaveLength(0)
  })

  it('handles a single item by filling the whole rect', () => {
    const rects: unknown[] = []
    squarify([item('only', 50, '#fff')], 4, 5, 200, 100, rects as never)
    expect(rects).toEqual([{ name: 'only', size: 50, x: 4, y: 5, w: 200, h: 100, color: '#fff' }])
  })

  it('defaults the fill to transparent when absent', () => {
    const rects: unknown[] = []
    const noFill = { name: 'only', size: 50, fill: undefined as unknown as string }
    squarify([noFill], 0, 0, 10, 10, rects as never)
    expect((rects as { color: string }[])[0]!.color).toBe('transparent')
  })

  it('produces rects that tile the whole area for two items', () => {
    const rects: TreemapRect[] = []
    squarify([item('a', 75, '#111'), item('b', 25, '#222')], 0, 0, 100, 100, rects)
    expect(rects).toHaveLength(2)
    expect(rects[0]!.name).toBe('a')
    expect(rects[1]!.name).toBe('b')
    const covered = rects.reduce((s, r) => s + r.w * r.h, 0)
    expect(covered).toBe(100 * 100)
  })

  it('lays out horizontally when width >= height', () => {
    const rects: TreemapRect[] = []
    squarify([item('a', 50), item('b', 50)], 0, 0, 200, 100, rects)
    expect(rects[0]!.w).toBeCloseTo(100)
    expect(rects[0]!.h).toBeCloseTo(100)
    expect(rects[0]!.y).toBe(0)
  })

  it('lays out vertically when height > width', () => {
    const rects: TreemapRect[] = []
    squarify([item('a', 50), item('b', 50)], 0, 0, 100, 200, rects)
    expect(rects[0]!.h).toBeCloseTo(100)
    expect(rects[0]!.w).toBeCloseTo(100)
    expect(rects[0]!.x).toBe(0)
  })

  it('handles zero-size items without crashing', () => {
    const rects: unknown[] = []
    squarify([item('a', 0), item('b', 10)], 0, 0, 100, 100, rects as never)
    expect(rects.length).toBeGreaterThan(0)
  })
})

describe('layoutTreemap', () => {
  it('returns an empty array for no items or invalid dimensions', () => {
    expect(layoutTreemap([], 100, 100)).toEqual([])
    expect(layoutTreemap([item('a', 10)], 0, 100)).toEqual([])
    expect(layoutTreemap([item('a', 10)], 100, -5)).toEqual([])
  })

  it('returns an empty array when the total size is zero', () => {
    expect(layoutTreemap([item('a', 0), item('b', 0)], 100, 100)).toEqual([])
  })

  it('groups small items into an Other bucket with the default label', () => {
    const rects = layoutTreemap([item('big', 90), item('tiny1', 1), item('tiny2', 1)], 100, 100)
    expect(rects).toHaveLength(2)
    expect(rects[1]!.name).toBe('2 other items')
    expect(rects[1]!.color).toBe('var(--text-muted)')
  })

  it('uses the custom otherLabel callback for the grouped bucket', () => {
    const rects = layoutTreemap([item('big', 90), item('tiny', 1)], 100, 100, (n) => `${n} pequenos`)
    expect(rects).toHaveLength(2)
    expect(rects[1]!.name).toBe('1 pequenos')
  })

  it('does not create an Other bucket when every item is large enough', () => {
    const rects = layoutTreemap([item('a', 50), item('b', 50)], 100, 100)
    expect(rects).toHaveLength(2)
    expect(rects.map((r) => r.name).sort()).toEqual(['a', 'b'])
  })

  it('sorts the grouped items by size descending', () => {
    const rects = layoutTreemap([item('small', 40), item('large', 60)], 100, 100)
    expect(rects[0]!.name).toBe('large')
    expect(rects[0]!.size).toBe(60)
  })

  it('sums the sizes of the small items into the Other bucket', () => {
    const rects = layoutTreemap([item('big', 500), item('a', 3), item('b', 4)], 100, 100)
    expect(rects).toHaveLength(2)
    expect(rects[1]!.name).toBe('2 other items')
    expect(rects[1]!.size).toBe(7)
  })
})

describe('COLORS', () => {
  it('exports the color palette used by the treemap', () => {
    expect(COLORS).toHaveLength(10)
    expect(COLORS[0]!).toBe('#f59e0b')
  })
})
