import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import { formatDuration } from './formatDuration'

describe('formatDuration', () => {
  it('formats sub-second durations with the raw fallback', () => {
    expect(formatDuration(0)).toBe('<1s')
    expect(formatDuration(500)).toBe('<1s')
    expect(formatDuration(999)).toBe('<1s')
  })

  it('formats sub-second durations via the t function', () => {
    const t = vi.fn<TFunction>()
    expect(formatDuration(250, t)).toBe(t('duration.lessThanOneSecond'))
    expect(t).toHaveBeenCalledWith('duration.lessThanOneSecond')
  })

  it('formats seconds below a minute with the raw fallback', () => {
    expect(formatDuration(1000)).toBe('1s')
    expect(formatDuration(30_000)).toBe('30s')
    expect(formatDuration(59_999)).toBe('59s')
  })

  it('formats seconds below a minute via the t function with a count', () => {
    const t = vi.fn<TFunction>()
    expect(formatDuration(45_000, t)).toBe(t('duration.seconds', { count: 45 }))
    expect(t).toHaveBeenCalledWith('duration.seconds', { count: 45 })
  })

  it('formats minutes and seconds with the raw fallback', () => {
    expect(formatDuration(60_000)).toBe('1m 0s')
    expect(formatDuration(125_000)).toBe('2m 5s')
    expect(formatDuration(600_000)).toBe('10m 0s')
  })

  it('formats minutes and seconds via the t function', () => {
    const t = vi.fn<TFunction>()
    expect(formatDuration(125_000, t)).toBe(t('duration.minutesAndSeconds', { minutes: 2, seconds: 5 }))
    expect(t).toHaveBeenCalledWith('duration.minutesAndSeconds', { minutes: 2, seconds: 5 })
  })

  it('handles the exact one-minute boundary', () => {
    expect(formatDuration(60_000)).toBe('1m 0s')
    expect(formatDuration(59_999)).toBe('59s')
  })
})
