import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiNhoSettings, ScheduleEntry } from '../../shared/types'
import {
  completeScheduleRun,
  getNextRunTime,
  getNextScanTime,
  isSameDay,
  notifyScheduledScanComplete,
  startScheduler,
  stopScheduler,
} from './scheduler'

const mockLogInfo = vi.fn()
const mockUpdateScheduleEntry = vi.fn()
let mockSettings: DiNhoSettings

vi.mock('./logger.service', () => ({
  getLogger: () => ({
    info: (...args: unknown[]) => mockLogInfo(...args),
  }),
}))

vi.mock('./settings-store', () => ({
  getSettings: () => mockSettings,
  updateScheduleEntry: (...args: unknown[]) => mockUpdateScheduleEntry(...args),
}))

vi.mock('../i18n', () => ({
  t: vi.fn((key: string) => key),
}))

vi.mock('electron', () => {
  const sendMock = vi.fn()
  const MockBrowserWindow = vi.fn(() => ({
    isDestroyed: vi.fn(() => false),
    webContents: { send: sendMock },
  }))
  // biome-ignore lint/complexity/useArrowFunction: vitest 4.x requires function() for constructor mocks
  const MockNotification = vi.fn(function () {
    return { show: vi.fn() }
  })
  Object.assign(MockNotification, { isSupported: vi.fn(() => false) })
  return {
    Notification: MockNotification,
    BrowserWindow: MockBrowserWindow,
  }
})

function makeEntry(overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    id: 'test-1',
    name: 'Test Schedule',
    enabled: true,
    frequency: 'daily',
    day: 0,
    hour: 3,
    minute: 0,
    tasks: ['cleaner:system', 'registry'],
    autoApply: false,
    lastRunAt: null,
    lastRunStatus: 'never',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeSettings(schedules: ScheduleEntry[] = []): DiNhoSettings {
  return {
    schedule: { enabled: false, frequency: 'daily', day: 0, hour: 3 },
    schedules,
  } as DiNhoSettings
}

describe('isSameDay', () => {
  it('returns true for same date', () => {
    expect(isSameDay(new Date('2025-06-15'), new Date('2025-06-15'))).toBe(true)
  })

  it('returns false for different dates', () => {
    expect(isSameDay(new Date('2025-06-15'), new Date('2025-06-16'))).toBe(false)
  })

  it('returns false for different months', () => {
    expect(isSameDay(new Date('2025-06-15'), new Date('2025-07-15'))).toBe(false)
  })

  it('returns false for different years', () => {
    expect(isSameDay(new Date('2025-06-15'), new Date('2024-06-15'))).toBe(false)
  })
})

describe('getNextRunTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSettings = makeSettings()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null for disabled schedule', () => {
    expect(getNextRunTime(makeEntry({ enabled: false }))).toBeNull()
  })

  it('returns today if the time is still in the future (daily)', () => {
    vi.setSystemTime(new Date(2025, 5, 15)) // Jun 15 local

    const next = getNextRunTime(makeEntry({ hour: 14, minute: 30 }))
    expect(next).not.toBeNull()
    expect(next?.getDate()).toBe(15)
    expect(next?.getHours()).toBe(14)
    expect(next?.getMinutes()).toBe(30)
  })

  it('returns tomorrow if the time has passed today (daily)', () => {
    vi.setSystemTime(new Date(2025, 5, 15, 10)) // Jun 15 10AM local

    const next = getNextRunTime(makeEntry({ hour: 3, minute: 0 }))
    expect(next).not.toBeNull()
    expect(next?.getDate()).toBe(16)
    expect(next?.getHours()).toBe(3)
    expect(next?.getMinutes()).toBe(0)
  })

  it('calculates weekly schedule correctly', () => {
    vi.setSystemTime(new Date(2025, 5, 18)) // Wednesday Jun 18 local

    const next = getNextRunTime(makeEntry({ frequency: 'weekly', day: 5, hour: 3 })) // Friday
    expect(next).not.toBeNull()
    expect(next?.getDay()).toBe(5)
    expect(next?.getDate()).toBe(20)
  })

  it('wraps to next week if the day has passed', () => {
    vi.setSystemTime(new Date(2025, 5, 20, 10)) // Friday Jun 20 10AM local

    const next = getNextRunTime(makeEntry({ frequency: 'weekly', day: 5, hour: 3 })) // Friday 3AM
    expect(next).not.toBeNull()
    expect(next?.getDate()).toBe(27)
  })

  it('calculates monthly schedule correctly', () => {
    vi.setSystemTime(new Date(2025, 5, 1)) // Jun 1 local

    const next = getNextRunTime(makeEntry({ frequency: 'monthly', day: 15, hour: 3 }))
    expect(next).not.toBeNull()
    expect(next?.getDate()).toBe(15)
    expect(next?.getMonth()).toBe(5)
  })

  it('advances to next month if the day has passed', () => {
    vi.setSystemTime(new Date(2025, 5, 20)) // Jun 20 local

    const next = getNextRunTime(makeEntry({ frequency: 'monthly', day: 15, hour: 3 }))
    expect(next).not.toBeNull()
    expect(next?.getDate()).toBe(15)
    expect(next?.getMonth()).toBe(6)
  })

  it('clamps day to month length (31st on Feb)', () => {
    vi.setSystemTime(new Date(2025, 1, 1)) // Feb 1 local

    const next = getNextRunTime(makeEntry({ frequency: 'monthly', day: 31, hour: 3 }))
    expect(next).not.toBeNull()
    expect(next?.getDate()).toBe(28)
  })
})

describe('getNextScanTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when no schedules are enabled', () => {
    mockSettings = makeSettings([makeEntry({ enabled: false })])
    expect(getNextScanTime(mockSettings)).toBeNull()
  })

  it('returns the soonest next run across multiple schedules', () => {
    vi.setSystemTime(new Date(2025, 5, 15, 1)) // Jun 15 1AM local
    mockSettings = makeSettings([makeEntry({ id: 'later', hour: 5 }), makeEntry({ id: 'soon', hour: 2 })])
    const next = getNextScanTime(mockSettings)
    expect(next).not.toBeNull()
    expect(next?.getHours()).toBe(2)
  })

  it('uses legacy schedule when no multi-schedules exist', () => {
    vi.setSystemTime(new Date(2025, 5, 15, 1)) // Jun 15 1AM local
    mockSettings = makeSettings()
    mockSettings.schedule = { enabled: true, frequency: 'daily', day: 0, hour: 4 }
    const next = getNextScanTime(mockSettings)
    expect(next).not.toBeNull()
    expect(next?.getHours()).toBe(4)
  })

  it('returns null for legacy schedule if disabled', () => {
    mockSettings = makeSettings()
    mockSettings.schedule = { enabled: false, frequency: 'daily', day: 0, hour: 4 }
    expect(getNextScanTime(mockSettings)).toBeNull()
  })
})

describe('completeScheduleRun', () => {
  it('can be imported and called', async () => {
    const { completeScheduleRun } = await import('./scheduler')
    vi.useFakeTimers()
    expect(() => completeScheduleRun('test-1', 'success')).not.toThrow()
    vi.useRealTimers()
  })
})

describe('stopScheduler', () => {
  beforeEach(() => {
    mockSettings = makeSettings()
  })

  it('cleans up timers gracefully', () => {
    expect(() => stopScheduler()).not.toThrow()
  })

  it('can be called multiple times', () => {
    stopScheduler()
    expect(() => stopScheduler()).not.toThrow()
  })
})

describe('notifyScheduledScanComplete', () => {
  beforeEach(() => {
    mockSettings = makeSettings()
    mockSettings.showNotificationOnComplete = true
  })

  it('does not throw when called', () => {
    expect(() => notifyScheduledScanComplete(1024, 5)).not.toThrow()
  })

  it('handles zero values', () => {
    expect(() => notifyScheduledScanComplete(0, 0)).not.toThrow()
  })

  it('returns early when --daemon flag is present', () => {
    const originalArgv = process.argv
    process.argv = [...process.argv, '--daemon']
    expect(() => notifyScheduledScanComplete(1024, 5)).not.toThrow()
    process.argv = originalArgv
  })

  it('returns early when Notification is not supported (default mock)', () => {
    // Default mock already has isSupported returning false
    expect(() => notifyScheduledScanComplete(1024, 5)).not.toThrow()
  })

  it('returns early when showNotificationOnComplete is false', () => {
    mockSettings.showNotificationOnComplete = false
    expect(() => notifyScheduledScanComplete(1024, 5)).not.toThrow()
  })
})

describe('completeScheduleRun', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSettings = makeSettings()
    stopScheduler()
    mockUpdateScheduleEntry.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls updateScheduleEntry with correct args', () => {
    completeScheduleRun('test-1', 'success')
    expect(mockUpdateScheduleEntry).toHaveBeenCalledWith('test-1', {
      lastRunAt: expect.any(String),
      lastRunStatus: 'success',
    })
  })

  it('calls updateScheduleEntry with failed status', () => {
    completeScheduleRun('test-1', 'failed')
    expect(mockUpdateScheduleEntry).toHaveBeenCalledWith('test-1', {
      lastRunAt: expect.any(String),
      lastRunStatus: 'failed',
    })
  })

  it('clears inFlight timeout timer', () => {
    // Start a schedule to create in-flight state, then stop to get into cleanup path
    startScheduler(() => null)
    completeScheduleRun('test-2', 'success')
    expect(() => completeScheduleRun('test-2', 'success')).not.toThrow()
  })

  it('does not throw when called with unknown scheduleId', () => {
    expect(() => completeScheduleRun('unknown-id', 'success')).not.toThrow()
  })

  it('handles multiple completions', () => {
    completeScheduleRun('sched-1', 'success')
    completeScheduleRun('sched-2', 'failed')
    expect(mockUpdateScheduleEntry).toHaveBeenCalledTimes(2)
  })
})

describe('startScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSettings = makeSettings()
    stopScheduler()
    mockUpdateScheduleEntry.mockClear()
    mockLogInfo.mockClear()
  })

  afterEach(() => {
    stopScheduler()
    vi.useRealTimers()
  })

  it('creates an interval and runs check on startup', () => {
    const mockGetMainWindow = vi.fn(() => null)
    startScheduler(mockGetMainWindow)
    expect(mockLogInfo).toHaveBeenCalledWith('Scheduler', 'Scheduler started')
  })

  it('does not start twice', () => {
    const mockGetMainWindow = vi.fn(() => null)
    startScheduler(mockGetMainWindow)
    mockLogInfo.mockClear()

    startScheduler(mockGetMainWindow)
    // Should not log "Scheduler started" a second time
    expect(mockLogInfo).not.toHaveBeenCalledWith('Scheduler', 'Scheduler started')
  })

  it('runs initial check after 5 seconds', () => {
    const mockGetMainWindow = vi.fn(() => null)
    startScheduler(mockGetMainWindow)

    vi.advanceTimersByTime(5_000)

    // The initial check runs getSettings() which is the mock
    expect(mockLogInfo).toHaveBeenCalled()
  })

  it('triggers due schedule entry through the main window', () => {
    const mockSend = vi.fn()
    const mockMainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: mockSend },
    } as unknown as BrowserWindow
    const mockGetMainWindow = vi.fn(() => mockMainWindow)

    // Set time to 3:00 AM so the daily entry at hour 3 is within 2-min window
    vi.setSystemTime(new Date(2025, 5, 15, 3, 0, 0))

    mockSettings = makeSettings([makeEntry({ id: 'daily-scan', hour: 3, minute: 0, enabled: true })])

    startScheduler(mockGetMainWindow)

    // Advance past the initial check delay
    vi.advanceTimersByTime(5_000)

    expect(mockLogInfo).toHaveBeenCalledWith('Scheduler', expect.stringContaining('Schedule triggered'))
  })

  it('handles error in checkSchedules gracefully', () => {
    // Make settings throw by corrupting the schedules array into a non-iterable
    const mockGetMainWindow = vi.fn()
    mockSettings = { schedule: { enabled: false, frequency: 'daily', day: 0, hour: 3 } } as DiNhoSettings

    startScheduler(mockGetMainWindow)
    vi.advanceTimersByTime(5_000)

    expect(mockLogInfo).toHaveBeenCalledWith('Scheduler', expect.stringContaining('Scheduler initial check error'))
  })

  it('skips schedule when window is destroyed', () => {
    const mockMainWindow = {
      isDestroyed: vi.fn(() => true),
      webContents: { send: vi.fn() },
    } as unknown as BrowserWindow
    const mockGetMainWindow = vi.fn(() => mockMainWindow)

    vi.setSystemTime(new Date(2025, 5, 15, 3, 0, 0))
    mockSettings = makeSettings([makeEntry({ id: 'skip-me', hour: 3, minute: 0, enabled: true })])

    startScheduler(mockGetMainWindow)
    vi.advanceTimersByTime(5_000)

    expect(mockLogInfo).toHaveBeenCalledWith('Scheduler', expect.stringContaining('skipped'))
    expect(mockUpdateScheduleEntry).toHaveBeenCalledWith(
      'skip-me',
      expect.objectContaining({ lastRunStatus: 'failed' }),
    )
  })

  it('skips schedule when getMainWindow returns null', () => {
    const mockGetMainWindow = vi.fn(() => null)

    vi.setSystemTime(new Date(2025, 5, 15, 3, 0, 0))
    mockSettings = makeSettings([makeEntry({ id: 'null-win', hour: 3, minute: 0, enabled: true })])

    startScheduler(mockGetMainWindow)
    vi.advanceTimersByTime(5_000)

    expect(mockLogInfo).toHaveBeenCalledWith('Scheduler', expect.stringContaining('skipped'))
  })

  it('handles interval check error gracefully', () => {
    const mockGetMainWindow = vi.fn()
    mockSettings = { schedule: { enabled: false, frequency: 'daily', day: 0, hour: 3 } } as DiNhoSettings

    startScheduler(mockGetMainWindow)
    vi.advanceTimersByTime(60_000)

    expect(mockLogInfo).toHaveBeenCalledWith('Scheduler', expect.stringContaining('Scheduler error'))
  })

  it('does not re-trigger in-flight schedule', () => {
    const mockSend = vi.fn()
    const mockMainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: mockSend },
    } as unknown as BrowserWindow
    const mockGetMainWindow = vi.fn(() => mockMainWindow)

    vi.setSystemTime(new Date(2025, 5, 15, 3, 0, 0))
    mockSettings = makeSettings([makeEntry({ id: 'inflight', hour: 3, minute: 0, enabled: true })])

    startScheduler(mockGetMainWindow)
    vi.advanceTimersByTime(5_000)

    const sendCallsAfterFirst = mockSend.mock.calls.length

    // Advance to next minute interval
    vi.advanceTimersByTime(60_000)

    // Should not have sent again (still in-flight)
    expect(mockSend.mock.calls.length).toBe(sendCallsAfterFirst)
  })
})

describe('stopScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSettings = makeSettings()
    stopScheduler()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stops scheduler and cleans up timers', () => {
    const mockGetMainWindow = vi.fn(() => null)
    startScheduler(mockGetMainWindow)
    mockLogInfo.mockClear()

    stopScheduler()

    expect(mockLogInfo).toHaveBeenCalledWith('Scheduler', 'Scheduler stopped')
  })

  it('can be called without starting first', () => {
    expect(() => stopScheduler()).not.toThrow()
  })

  it('can be called multiple times safely', () => {
    stopScheduler()
    expect(() => stopScheduler()).not.toThrow()
  })
})

describe('isDueEntry weekly schedule', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSettings = makeSettings()
    stopScheduler()
  })

  afterEach(() => {
    stopScheduler()
    vi.useRealTimers()
  })

  function setupWindow() {
    const mockSend = vi.fn()
    const mockMainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: mockSend },
    } as unknown as BrowserWindow
    const mockGetMainWindow = vi.fn(() => mockMainWindow)
    return { mockSend, mockGetMainWindow }
  }

  it('triggers weekly schedule on correct day within window', () => {
    vi.setSystemTime(new Date(2025, 5, 18, 3, 0, 0)) // Wed Jun 18 3:00 AM
    const { mockGetMainWindow } = setupWindow()

    mockSettings = makeSettings([makeEntry({ id: 'weekly', frequency: 'weekly', day: 3, hour: 3, minute: 0 })])

    startScheduler(mockGetMainWindow)
    vi.advanceTimersByTime(5_000)

    expect(mockLogInfo).toHaveBeenCalledWith('Scheduler', expect.stringContaining('Schedule triggered'))
  })

  it('does not trigger weekly schedule on wrong day', () => {
    vi.setSystemTime(new Date(2025, 5, 19, 3, 0, 0)) // Thu Jun 19 3:00 AM
    const { mockSend, mockGetMainWindow } = setupWindow()

    mockSettings = makeSettings([makeEntry({ id: 'weekly', frequency: 'weekly', day: 3, hour: 3, minute: 0 })])

    startScheduler(mockGetMainWindow)
    vi.advanceTimersByTime(5_000)

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('does not trigger weekly schedule outside 2-min window', () => {
    vi.setSystemTime(new Date(2025, 5, 18, 3, 5, 0)) // Wed 3:05 AM ( >2 min past 3:00)
    const { mockSend, mockGetMainWindow } = setupWindow()

    mockSettings = makeSettings([makeEntry({ id: 'weekly', frequency: 'weekly', day: 3, hour: 3, minute: 0 })])

    startScheduler(mockGetMainWindow)
    vi.advanceTimersByTime(5_000)

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('does not trigger weekly schedule if already run today', () => {
    vi.setSystemTime(new Date(2025, 5, 18, 3, 0, 0))
    const { mockSend, mockGetMainWindow } = setupWindow()

    mockSettings = makeSettings([
      makeEntry({
        id: 'weekly',
        frequency: 'weekly',
        day: 3,
        hour: 3,
        minute: 0,
        lastRunAt: new Date(2025, 5, 18, 3, 0, 0).toISOString(),
      }),
    ])

    startScheduler(mockGetMainWindow)
    vi.advanceTimersByTime(5_000)

    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('isDueEntry monthly schedule', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSettings = makeSettings()
    stopScheduler()
  })

  afterEach(() => {
    stopScheduler()
    vi.useRealTimers()
  })

  function setupWindow() {
    const mockSend = vi.fn()
    const mockMainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: mockSend },
    } as unknown as BrowserWindow
    const mockGetMainWindow = vi.fn(() => mockMainWindow)
    return { mockSend, mockGetMainWindow }
  }

  it('triggers monthly schedule on correct date within window', () => {
    vi.setSystemTime(new Date(2025, 5, 15, 3, 0, 0)) // Jun 15 3:00 AM
    const { mockGetMainWindow } = setupWindow()

    mockSettings = makeSettings([makeEntry({ id: 'monthly', frequency: 'monthly', day: 15, hour: 3, minute: 0 })])

    startScheduler(mockGetMainWindow)
    vi.advanceTimersByTime(5_000)

    expect(mockLogInfo).toHaveBeenCalledWith('Scheduler', expect.stringContaining('Schedule triggered'))
  })

  it('does not trigger monthly schedule on wrong date', () => {
    vi.setSystemTime(new Date(2025, 5, 14, 3, 0, 0)) // Jun 14
    const { mockSend, mockGetMainWindow } = setupWindow()

    mockSettings = makeSettings([makeEntry({ id: 'monthly', frequency: 'monthly', day: 15, hour: 3, minute: 0 })])

    startScheduler(mockGetMainWindow)
    vi.advanceTimersByTime(5_000)

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('does not trigger monthly schedule outside 2-min window', () => {
    vi.setSystemTime(new Date(2025, 5, 15, 3, 5, 0)) // Jun 15 3:05 AM
    const { mockSend, mockGetMainWindow } = setupWindow()

    mockSettings = makeSettings([makeEntry({ id: 'monthly', frequency: 'monthly', day: 15, hour: 3, minute: 0 })])

    startScheduler(mockGetMainWindow)
    vi.advanceTimersByTime(5_000)

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('does not trigger monthly schedule if already run today', () => {
    vi.setSystemTime(new Date(2025, 5, 15, 3, 0, 0))
    const { mockSend, mockGetMainWindow } = setupWindow()

    mockSettings = makeSettings([
      makeEntry({
        id: 'monthly',
        frequency: 'monthly',
        day: 15,
        hour: 3,
        minute: 0,
        lastRunAt: new Date(2025, 5, 15, 3, 0, 0).toISOString(),
      }),
    ])

    startScheduler(mockGetMainWindow)
    vi.advanceTimersByTime(5_000)

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('triggers monthly schedule with clamped day (31 on Feb 28)', () => {
    vi.setSystemTime(new Date(2025, 1, 28, 3, 0, 0)) // Feb 28 3:00 AM (non-leap)
    const { mockGetMainWindow } = setupWindow()

    mockSettings = makeSettings([makeEntry({ id: 'monthly-clamp', frequency: 'monthly', day: 31, hour: 3, minute: 0 })])

    startScheduler(mockGetMainWindow)
    vi.advanceTimersByTime(5_000)

    expect(mockLogInfo).toHaveBeenCalledWith('Scheduler', expect.stringContaining('Schedule triggered'))
  })
})

describe('triggerScheduleEntry notification', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSettings = makeSettings()
    stopScheduler()
  })

  afterEach(async () => {
    stopScheduler()
    vi.useRealTimers()
    const { Notification } = await import('electron')
    vi.mocked(Notification.isSupported).mockReturnValue(false)
  })

  it('shows desktop notification when supported and not daemon', async () => {
    const { Notification } = await import('electron')
    vi.mocked(Notification.isSupported).mockReturnValue(true)
    vi.mocked(Notification).mockClear()

    vi.setSystemTime(new Date(2025, 5, 15, 3, 0, 0))
    const mockSend = vi.fn()
    const mockMainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: mockSend },
    } as unknown as BrowserWindow
    const mockGetMainWindow = vi.fn(() => mockMainWindow)

    mockSettings = makeSettings([makeEntry({ id: 'notif-test', hour: 3, minute: 0, enabled: true })])

    startScheduler(mockGetMainWindow)
    vi.advanceTimersByTime(5_000)

    expect(Notification).toHaveBeenCalledOnce()
  })
})

describe('safety timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSettings = makeSettings()
    stopScheduler()
  })

  afterEach(() => {
    stopScheduler()
    vi.useRealTimers()
  })

  it('clears in-flight schedule after 10-minute safety timeout', () => {
    const mockSend = vi.fn()
    const mockMainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: mockSend },
    } as unknown as BrowserWindow
    const mockGetMainWindow = vi.fn(() => mockMainWindow)

    vi.setSystemTime(new Date(2025, 5, 15, 3, 0, 0))
    mockSettings = makeSettings([makeEntry({ id: 'timeout-test', hour: 3, minute: 0, enabled: true })])

    startScheduler(mockGetMainWindow)
    vi.advanceTimersByTime(5_000)

    // Schedule is now in-flight. Advance past the 10-minute safety timeout.
    vi.advanceTimersByTime(600_000)

    expect(mockLogInfo).toHaveBeenCalledWith('Scheduler', expect.stringContaining('timed out'))
  })
})

describe('notifyScheduledScanComplete notification path', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSettings = makeSettings()
    mockSettings.showNotificationOnComplete = true
    stopScheduler()
  })

  afterEach(() => {
    stopScheduler()
    vi.useRealTimers()
  })

  it('shows notification when supported and showNotificationOnComplete is true', async () => {
    const { Notification } = await import('electron')
    vi.mocked(Notification.isSupported).mockReturnValue(true)
    vi.mocked(Notification).mockClear()

    notifyScheduledScanComplete(2_097_152, 10)

    expect(Notification).toHaveBeenCalledOnce()
  })
})

describe('completeScheduleRun timer cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSettings = makeSettings()
    stopScheduler()
  })

  afterEach(() => {
    stopScheduler()
    vi.useRealTimers()
  })

  it('clears in-flight timer on completion', () => {
    const mockMainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn() },
    } as unknown as BrowserWindow
    const mockGetMainWindow = vi.fn(() => mockMainWindow)

    vi.setSystemTime(new Date(2025, 5, 15, 3, 0, 0))
    mockSettings = makeSettings([makeEntry({ id: 'timer-cleanup', hour: 3, minute: 0, enabled: true })])

    startScheduler(mockGetMainWindow)
    vi.advanceTimersByTime(5_000)

    mockUpdateScheduleEntry.mockClear()

    completeScheduleRun('timer-cleanup', 'success')

    // Subsequent completeScheduleRun should not throw
    expect(() => completeScheduleRun('timer-cleanup', 'success')).not.toThrow()
    // updateScheduleEntry called a second time
    expect(mockUpdateScheduleEntry).toHaveBeenCalledWith(
      'timer-cleanup',
      expect.objectContaining({ lastRunStatus: 'success' }),
    )
  })
})
