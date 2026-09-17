import { ScanStatus } from '@shared/enums'
import type { ScanResult } from '@shared/types'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { formatBytes, formatNumber } from '@/lib/utils'
import { useHistoryStore } from '@/stores/history-store'
import { useScanStore } from '@/stores/scan-store'
import { refreshSettings, useSettingsStore } from '@/stores/settings-store'

interface ScheduleRunPayload {
  scheduleId: string
  scheduleName: string
  tasks: string[]
  autoApply: boolean
}

// Map task types to scan/clean functions
const CLEANER_TASKS: Record<
  string,
  {
    label: string
    scan: () => Promise<ScanResult[]>
    clean: (ids: string[]) => Promise<{ filesDeleted?: number; totalCleaned?: number }>
  }
> = {
  'cleaner:system': {
    label: 'System',
    scan: () => window.dinho.systemScan(),
    clean: (ids) => window.dinho.systemClean(ids),
  },
  'cleaner:browsers': {
    label: 'Browsers',
    scan: () => window.dinho.browserScan(),
    clean: (ids) => window.dinho.browserClean(ids),
  },
  'cleaner:apps': {
    label: 'Applications',
    scan: () => window.dinho.appScan(),
    clean: (ids) => window.dinho.appClean(ids),
  },
  'cleaner:gaming': {
    label: 'Gaming',
    scan: () => window.dinho.gamingScan(),
    clean: (ids) => window.dinho.gamingClean(ids),
  },
  'cleaner:recycleBin': {
    label: 'Recycle Bin',
    scan: () => window.dinho.recycleBinScan(),
    clean: () => window.dinho.recycleBinClean(),
  },
  'cleaner:databases': {
    label: 'Databases',
    scan: () => window.dinho.databaseScan(),
    clean: (ids) => window.dinho.databaseClean(ids),
  },
  'cleaner:shortcuts': {
    label: 'Shortcuts',
    scan: () => window.dinho.shortcutScan(),
    clean: (ids) => window.dinho.shortcutClean(ids),
  },
  'cleaner:uninstallLeftovers': {
    label: 'Uninstall Leftovers',
    scan: () => window.dinho.uninstallLeftoversScan(),
    clean: (ids) => window.dinho.uninstallLeftoversClean(ids),
  },
}

/**
 * Execute a single schedule's tasks.
 */
async function runSchedule(payload: ScheduleRunPayload): Promise<void> {
  const store = useScanStore.getState()
  const startTime = Date.now()

  let status: 'success' | 'partial' | 'failed' = 'success'
  let totalSize = 0
  let totalItems = 0
  let totalCleaned = 0
  let totalSpaceSaved = 0
  const categoryResults: Record<string, { found: number; cleaned: number; size: number }> = {}

  try {
    toast.info(`Running "${payload.scheduleName}"`, { description: 'Scheduled task started...' })
    store.setStatus(ScanStatus.Scanning)
    store.setResults([])
    const cleanerTasks = payload.tasks.filter((t) => t.startsWith('cleaner:'))
    // ── Cleaner tasks ──
    const { protectRecycleBin } = useSettingsStore.getState().settings.cleaner
    for (const taskType of cleanerTasks) {
      if (taskType === 'cleaner:recycleBin' && protectRecycleBin) continue
      const task = CLEANER_TASKS[taskType]
      if (!task) continue
      try {
        const results = await task.scan()
        store.addResults(results)
        const found = results.reduce((s, r) => s + r.itemCount, 0)
        const size = results.reduce((s, r) => s + r.totalSize, 0)
        totalSize += size
        totalItems += found

        if (payload.autoApply && found > 0) {
          const allIds = results.flatMap((r) => r.items.map((i) => i.id))
          try {
            const cleanResult = await task.clean(allIds)
            const cleaned = cleanResult?.filesDeleted ?? found
            const saved = cleanResult?.totalCleaned ?? size
            totalCleaned += cleaned
            totalSpaceSaved += saved
            categoryResults[task.label] = { found, cleaned, size: saved }
          } catch {
            status = 'partial'
            categoryResults[task.label] = { found, cleaned: 0, size: 0 }
          }
        } else if (found > 0) {
          categoryResults[task.label] = { found, cleaned: 0, size }
        }
      } catch {
        status = 'partial'
      }
    }

    // ── Registry fixes ──
    if (payload.tasks.includes('registry')) {
      try {
        const entries = await window.dinho.registryScan()
        const found = entries.length
        totalItems += found
        if (payload.autoApply && found > 0) {
          const ids = entries.map((e) => e.id)
          try {
            const result = await window.dinho.registryFix(ids)
            totalCleaned += result.fixed
            categoryResults.Registry = { found, cleaned: result.fixed, size: 0 }
          } catch {
            status = 'partial'
            categoryResults.Registry = { found, cleaned: 0, size: 0 }
          }
        } else if (found > 0) {
          categoryResults.Registry = { found, cleaned: 0, size: 0 }
        }
      } catch {
        status = 'partial'
      }
    }

    // ── Driver updates ──
    if (payload.tasks.includes('drivers')) {
      try {
        const result = await window.dinho.driverUpdateScan()
        const found = result.updates.length
        totalItems += found
        if (payload.autoApply && found > 0) {
          const ids = result.updates.map((u) => u.updateId)
          try {
            const installResult = await window.dinho.driverUpdateInstall(ids)
            totalCleaned += installResult.installed
            categoryResults.Drivers = { found, cleaned: installResult.installed, size: 0 }
          } catch {
            status = 'partial'
            categoryResults.Drivers = { found, cleaned: 0, size: 0 }
          }
        } else if (found > 0) {
          categoryResults.Drivers = { found, cleaned: 0, size: 0 }
        }
      } catch {
        status = 'partial'
      }
    }

    // ── Software updates ──
    if (payload.tasks.includes('software-update')) {
      try {
        const result = await window.dinho.softwareUpdateCheck()
        const found = result.apps.length
        totalItems += found
        if (payload.autoApply && found > 0) {
          const ids = result.apps.map((a) => a.id)
          try {
            const updateResult = await window.dinho.softwareUpdateRun(ids, result.packageManagerName ?? undefined)
            totalCleaned += updateResult.succeeded
            categoryResults.Software = { found, cleaned: updateResult.succeeded, size: 0 }
          } catch {
            status = 'partial'
            categoryResults.Software = { found, cleaned: 0, size: 0 }
          }
        } else if (found > 0) {
          categoryResults.Software = { found, cleaned: 0, size: 0 }
        }
      } catch {
        status = 'partial'
      }
    }

    store.setStatus(ScanStatus.Complete)
    store.setProgress(null)

    // Pick the most representative history type based on tasks that actually ran
    const hasCleanerTasks = payload.tasks.some((t) => t.startsWith('cleaner:'))
    const historyType = hasCleanerTasks
      ? 'cleaner'
      : payload.tasks.includes('registry')
        ? 'registry'
        : payload.tasks.includes('drivers')
          ? 'drivers'
          : payload.tasks.includes('software-update')
            ? 'software-update'
            : 'cleaner'

    // Log to history
    await useHistoryStore.getState().addEntry({
      id: Date.now().toString(),
      type: historyType,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
      totalItemsFound: totalItems,
      totalItemsCleaned: totalCleaned,
      totalItemsSkipped: totalItems - totalCleaned,
      totalSpaceSaved,
      categories: Object.entries(categoryResults).map(([name, d]) => ({
        name,
        itemsFound: d.found,
        itemsCleaned: d.cleaned,
        spaceSaved: d.size,
      })),
      errorCount: 0,
      scheduled: true,
      scheduleName: payload.scheduleName,
    })

    // Notify main process and refresh renderer state so the UI shows updated status
    window.dinho.notifyScheduledScanComplete?.(totalSize, totalItems)
    window.dinho.scheduleRunComplete?.(payload.scheduleId, status)
    refreshSettings()

    const desc = payload.autoApply
      ? `Cleaned ${formatNumber(totalCleaned)} items (${formatBytes(totalSpaceSaved)}).`
      : `Found ${formatNumber(totalItems)} items (${formatBytes(totalSize)}) that can be cleaned.`
    toast.success(`"${payload.scheduleName}" complete`, { description: desc })
  } catch {
    store.setStatus(ScanStatus.Error)
    store.setProgress(null)
    status = 'failed'
    window.dinho.scheduleRunComplete?.(payload.scheduleId, status)
    refreshSettings()
    toast.error(`"${payload.scheduleName}" failed`, { description: 'An error occurred during the scheduled task.' })
  }
}

/**
 * Hook that listens for scheduled scan triggers from the main process
 * and runs the configured tasks when triggered. Queues multiple triggers.
 */
export function useScheduledScan(): void {
  const runningRef = useRef(false)
  const queueRef = useRef<ScheduleRunPayload[]>([])

  useEffect(() => {
    if (!window.dinho?.onScheduleRunTrigger) return undefined

    const waitForIdle = async (): Promise<boolean> => {
      // Wait up to 5 minutes for any manual scan/clean to finish
      for (let waited = 0; waited < 300_000; waited += 10_000) {
        const s = useScanStore.getState().status
        if (s !== ScanStatus.Scanning && s !== ScanStatus.Cleaning) return true
        await new Promise((r) => setTimeout(r, 10_000))
      }
      return false
    }

    const processQueue = async () => {
      while (queueRef.current.length > 0) {
        const next = queueRef.current.shift()!
        try {
          // Wait for any manual work to finish before running
          const idle = await waitForIdle()
          if (!idle) {
            window.dinho.scheduleRunComplete?.(next.scheduleId, 'failed')
            toast.warning(`"${next.scheduleName}" skipped`, {
              description: 'Timed out waiting for manual scan to finish.',
            })
            continue
          }
          await runSchedule(next)
        } catch {
          // Ensure completion is reported even on unexpected errors
          window.dinho.scheduleRunComplete?.(next.scheduleId, 'failed')
        }
      }
      runningRef.current = false
    }

    const unsubscribe = window.dinho.onScheduleRunTrigger((payload: ScheduleRunPayload) => {
      queueRef.current.push(payload)
      if (!runningRef.current) {
        runningRef.current = true
        processQueue()
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])
}
