import type { DriverScanProgress, DriverUpdateProgress } from '@shared/types'
import {
  ChevronDown,
  ChevronRight,
  CircleArrowUp,
  CircleCheckBig,
  Cpu,
  Loader2,
  Search,
  Shield,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ScanProgress } from '@/components/shared/ScanProgress'
import { useIpcAction } from '@/hooks/useIpcAction'
import { useIpcScan } from '@/hooks/useIpcScan'
import { useProgressListener } from '@/hooks/useProgressListener'
import logger from '@/lib/renderer-logger'
import { formatBytes } from '@/lib/utils'
import { useDriverStore } from '@/stores/driver-store'
import { useHistoryStore } from '@/stores/history-store'
import { useStatsStore } from '@/stores/stats-store'

import { InstalledDriverRow, StaleItemRow, UpdateItemRow } from './driver-manager/DriverManagerComponents'

export function DriverManagerPage({ embedded }: { embedded?: boolean }) {
  const { t } = useTranslation('updates')
  const {
    packages,
    scanning,
    scanProgress,
    cleaning,
    cleanResult,
    error,
    totalStaleSize,
    updates,
    updateScanning,
    updateProgress,
    installing,
    installResult,
    updateError,
    applying,
    hasScanned,
    allDrivers,
    showUpToDateDrivers,
  } = useDriverStore(
    useShallow((s) => ({
      packages: s.packages,
      scanning: s.scanning,
      scanProgress: s.scanProgress,
      cleaning: s.cleaning,
      cleanResult: s.cleanResult,
      error: s.error,
      totalStaleSize: s.totalStaleSize,
      updates: s.updates,
      updateScanning: s.updateScanning,
      updateProgress: s.updateProgress,
      installing: s.installing,
      installResult: s.installResult,
      updateError: s.updateError,
      applying: s.applying,
      hasScanned: s.hasScanned,
      allDrivers: s.allDrivers,
      showUpToDateDrivers: s.showUpToDateDrivers,
    })),
  )

  const [showConfirm, setShowConfirm] = useState(false)
  const cleanStartRef = useRef<number>(0)
  const addEntry = useHistoryStore((s) => s.addEntry)
  const recomputeStats = useStatsStore((s) => s.recompute)

  const isScanning = scanning || updateScanning
  const isBusy = isScanning || applying

  useProgressListener(window.dinho.onDriverProgress, (data: DriverScanProgress) =>
    useDriverStore.getState().setScanProgress(data),
  )
  useProgressListener(window.dinho.onDriverUpdateProgress, (data: DriverUpdateProgress) =>
    useDriverStore.getState().setUpdateProgress(data),
  )

  // ─── Scan for both stale packages and updates ─────────────
  const { scan: handleScan } = useIpcScan({
    scanFn: async () => {
      const scanStart = Date.now()
      const [staleResult, updateResult] = await Promise.allSettled([
        window.dinho.driverScan(),
        window.dinho.driverUpdateScan(),
      ])
      return { staleResult, updateResult, scanStart }
    },
    setLoading: (v) => {
      useDriverStore.getState().setScanning(v)
      useDriverStore.getState().setUpdateScanning(v)
    },
    resetState: () => {
      const s = useDriverStore.getState()
      s.setPackages([])
      s.setUpdates([])
      s.setCleanResult(null)
      s.setInstallResult(null)
      s.setError(null)
      s.setUpdateError(null)
      s.setScanProgress(null)
      s.setUpdateProgress(null)
    },
    onResult: ({ staleResult, updateResult, scanStart }) => {
      const s = useDriverStore.getState()
      let staleCount = 0
      let staleSize = 0
      if (staleResult.status === 'fulfilled') {
        s.setPackages(staleResult.value.packages)
        s.setTotalStaleSize(staleResult.value.totalStaleSize)
        staleCount = staleResult.value.packages.length
        staleSize = staleResult.value.totalStaleSize
        useDriverStore.getState().selectAllStale()
      } else {
        logger.error('DriverManagerPage', 'Driver scan failed', staleResult.reason)
        toast.error(t('driverManager.scanFailedToast'), { description: t('driverManager.scanFailedDescription') })
        s.setError(t('driverManager.scanFailedError'))
      }
      let updateCount = 0
      if (updateResult.status === 'fulfilled') {
        s.setUpdates(updateResult.value.updates)
        s.setAllDrivers(updateResult.value.allDrivers || [])
        updateCount = updateResult.value.updates.length
      } else {
        logger.error('DriverManagerPage', 'Driver update scan failed', updateResult.reason)
        toast.error(t('driverManager.updateScanFailedToast'), {
          description: t('driverManager.updateScanFailedDescription'),
        })
        s.setUpdateError(t('driverManager.updateScanFailedError'))
      }
      s.setHasScanned(true)

      if (staleResult.status === 'fulfilled' || updateResult.status === 'fulfilled') {
        const totalFound = staleCount + updateCount
        addEntry({
          id: Date.now().toString(),
          type: 'drivers',
          timestamp: new Date().toISOString(),
          duration: Date.now() - scanStart,
          totalItemsFound: totalFound,
          totalItemsCleaned: 0,
          totalItemsSkipped: 0,
          totalSpaceSaved: 0,
          categories: [
            ...(staleCount > 0
              ? [{ name: 'Stale Drivers', itemsFound: staleCount, itemsCleaned: 0, spaceSaved: staleSize }]
              : []),
            ...(updateCount > 0
              ? [{ name: 'Driver Updates', itemsFound: updateCount, itemsCleaned: 0, spaceSaved: 0 }]
              : []),
          ],
          errorCount: 0,
        })
        recomputeStats()
      }
    },
    onError: (err) => {
      logger.error('DriverManagerPage', 'Driver scan unexpected error', err)
      useDriverStore.getState().setScanProgress(null)
      useDriverStore.getState().setUpdateProgress(null)
    },
  })

  // ─── Combined Update & Clean ──────────────────────────────
  const { execute: handleApply } = useIpcAction({
    actionFn: async () => {
      setShowConfirm(false)
      const store = useDriverStore.getState()
      store.setCleanResult(null)
      store.setInstallResult(null)
      cleanStartRef.current = Date.now()

      const selectedUpdates = store.updates.filter((u) => u.selected)
      const selectedStale = store.packages.filter((p) => p.selected && !p.isCurrent)

      // Step 1: Install driver updates (if any selected)
      if (selectedUpdates.length > 0) {
        store.setInstalling(true)
        store.setUpdateProgress(null)
        const ids = selectedUpdates.map((u) => u.updateId)
        try {
          const result = await window.dinho.driverUpdateInstall(ids)
          useDriverStore.getState().setInstallResult(result)
        } catch (err) {
          logger.error('DriverManagerPage', 'Driver install failed', err)
          toast.error(t('driverManager.installFailedToast'), {
            description: t('driverManager.installFailedDescription'),
          })
          useDriverStore.getState().setUpdateError(t('driverManager.installFailedError'))
        } finally {
          const s = useDriverStore.getState()
          s.setInstalling(false)
          s.setUpdateProgress(null)
        }
      }

      // Step 2: Clean stale packages (if any selected)
      if (selectedStale.length > 0) {
        const s2 = useDriverStore.getState()
        s2.setCleaning(true)
        const names = selectedStale.map((p) => p.publishedName)
        try {
          const result = await window.dinho.driverClean(names)
          useDriverStore.getState().setCleanResult(result)

          const byClass: Record<string, { found: number; cleaned: number; size: number }> = {}
          for (const pkg of selectedStale) {
            if (!byClass[pkg.className]) byClass[pkg.className] = { found: 0, cleaned: 0, size: 0 }
            const entry = byClass[pkg.className]
            if (entry) {
              entry.found++
              entry.size += pkg.size
            }
          }
          const totalSelected = selectedStale.length
          for (const c in byClass) {
            const entry = byClass[c]
            if (entry) entry.cleaned = Math.round((entry.found / totalSelected) * result.removed)
          }

          await addEntry({
            id: Date.now().toString(),
            type: 'drivers',
            timestamp: new Date().toISOString(),
            duration: Date.now() - cleanStartRef.current,
            totalItemsFound: store.packages.length,
            totalItemsCleaned: result.removed,
            totalItemsSkipped: result.failed,
            totalSpaceSaved: result.spaceRecovered,
            categories: Object.entries(byClass).map(([name, d]) => ({
              name: `Drivers: ${name}`,
              itemsFound: d.found,
              itemsCleaned: d.cleaned,
              spaceSaved: d.size,
            })),
            errorCount: result.failed,
          })
          recomputeStats()
        } catch (err) {
          logger.error('DriverManagerPage', 'Driver clean failed', err)
          toast.error(t('driverManager.cleanFailedToast'), { description: t('driverManager.cleanFailedDescription') })
          useDriverStore.getState().setError(t('driverManager.cleanFailedError'))
        } finally {
          useDriverStore.getState().setCleaning(false)
        }
      }

      // Step 3: Re-scan to refresh the list
      const finalStore = useDriverStore.getState()
      const didInstall = finalStore.installResult && finalStore.installResult.installed > 0
      const didClean = finalStore.cleanResult && finalStore.cleanResult.removed > 0
      if (didInstall || didClean) {
        finalStore.setScanning(true)
        finalStore.setUpdateScanning(true)
        const [staleResult, updateResult] = await Promise.allSettled([
          window.dinho.driverScan(),
          window.dinho.driverUpdateScan(),
        ])
        const s = useDriverStore.getState()
        if (staleResult.status === 'fulfilled') {
          s.setPackages(staleResult.value.packages)
          s.setTotalStaleSize(staleResult.value.totalStaleSize)
          useDriverStore.getState().selectAllStale()
        }
        if (updateResult.status === 'fulfilled') {
          s.setUpdates(updateResult.value.updates)
          s.setAllDrivers(updateResult.value.allDrivers || [])
        }
        s.setScanning(false)
        s.setUpdateScanning(false)
        s.setScanProgress(null)
        s.setUpdateProgress(null)
      }
    },
    setLoading: (v) => useDriverStore.getState().setApplying(v),
    onStart: () => {
      // handled in actionFn
    },
    onError: (err) => {
      logger.error('DriverManagerPage', 'Driver apply failed', err)
      toast.error(t('driverManager.applyFailedToast'))
    },
  })

  const stalePackages = useMemo(() => packages.filter((p) => !p.isCurrent), [packages])
  const selectedStaleCount = useMemo(() => stalePackages.filter((p) => p.selected).length, [stalePackages])
  const selectedUpdateCount = useMemo(() => updates.filter((u) => u.selected).length, [updates])
  const totalSelected = selectedStaleCount + selectedUpdateCount
  const allStaleSelected = stalePackages.length > 0 && stalePackages.every((p) => p.selected)
  const allUpdatesSelected = updates.length > 0 && updates.every((u) => u.selected)

  // Build confirmation description
  const confirmDesc = useMemo(() => {
    const confirmParts: string[] = []
    if (selectedUpdateCount > 0) {
      confirmParts.push(t('driverManager.confirmDescriptionInstall', { count: selectedUpdateCount }))
    }
    if (selectedStaleCount > 0) {
      confirmParts.push(t('driverManager.confirmDescriptionRemove', { count: selectedStaleCount }))
    }
    return `${t('driverManager.confirmDescriptionPrefix')} ${confirmParts.join(` ${t('driverManager.confirmDescriptionAnd')} `)}. ${selectedUpdateCount > 0 ? `${t('driverManager.confirmDescriptionRebootNote')} ` : ''}${t('driverManager.confirmDescriptionSuffix')}`
  }, [selectedUpdateCount, selectedStaleCount, t])

  const handleToggleUpdates = useCallback(() => {
    const store = useDriverStore.getState()
    allUpdatesSelected ? store.deselectAllUpdates() : store.selectAllUpdates()
  }, [allUpdatesSelected])

  const handleToggleStale = useCallback(() => {
    const store = useDriverStore.getState()
    allStaleSelected ? store.deselectAllStale() : store.selectAllStale()
  }, [allStaleSelected])

  const handleToggleUpdateItem = useCallback((id: string) => {
    useDriverStore.getState().toggleUpdate(id)
  }, [])

  const handleTogglePackageItem = useCallback((id: string) => {
    useDriverStore.getState().togglePackage(id)
  }, [])

  const handleShowAllDrivers = useCallback(() => {
    useDriverStore.getState().setShowUpToDateDrivers(!showUpToDateDrivers)
  }, [showUpToDateDrivers])

  const handleDismissError = useCallback(() => {
    useDriverStore.getState().setError(null)
  }, [])

  const handleDismissUpdateError = useCallback(() => {
    useDriverStore.getState().setUpdateError(null)
  }, [])

  return (
    <div className={embedded ? '' : 'animate-fade-in'}>
      {!embedded && (
        <PageHeader title={t('driverManager.pageTitle')} description={t('driverManager.pageDescription')} />
      )}

      {/* Actions */}
      <div className="mb-5 flex items-center gap-2.5">
        <button
          type="button"
          onClick={handleScan}
          disabled={isBusy}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
          style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
        >
          <Search className={`h-4 w-4 ${isScanning ? 'animate-pulse' : ''}`} strokeWidth={1.8} />
          {isScanning ? t('driverManager.scanningButton') : t('driverManager.scanDriversButton')}
        </button>
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          disabled={totalSelected === 0 || isBusy}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
          style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#fff' }}
        >
          {applying ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : (
            <Sparkles className="h-4 w-4" strokeWidth={2} />
          )}
          {applying
            ? installing
              ? t('driverManager.installingButton')
              : cleaning
                ? t('driverManager.cleaningButton')
                : t('driverManager.applyingButton')
            : t('driverManager.updateAndCleanButton', { count: totalSelected })}
        </button>
      </div>

      {/* Info banner */}
      <div
        className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
        style={{ background: 'var(--accent-muted-bg)', border: '1px solid var(--accent-muted-bg)' }}
      >
        <Shield className="h-5 w-5 shrink-0 text-amber-500" strokeWidth={1.8} />
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          <span className="font-semibold text-amber-500">{t('driverManager.safeOperationBold')}</span> —{' '}
          {t('driverManager.safeOperationText')}
        </p>
      </div>

      {/* Errors */}
      {error && <ErrorAlert message={error} onDismiss={handleDismissError} className="mb-5" />}
      {updateError && <ErrorAlert message={updateError} onDismiss={handleDismissUpdateError} className="mb-5" />}

      {/* Scan progress */}
      {scanning && scanProgress && (
        <ScanProgress
          status="scanning"
          progress={scanProgress.total > 0 ? Math.round((scanProgress.current / scanProgress.total) * 100) : 0}
          currentPath={scanProgress.currentDriver}
          className="mb-5"
        />
      )}
      {scanning && !scanProgress && (
        <ScanProgress
          status="scanning"
          progress={0}
          currentPath={t('driverManager.enumeratingPackages')}
          className="mb-5"
        />
      )}

      {/* Update progress (during scan or install) */}
      {(updateScanning || installing) && updateProgress && (
        <div
          className="mb-5 rounded-2xl p-4"
          style={{ background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.08)' }}
        >
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-blue-400" strokeWidth={2} />
              <span className="text-[13px] font-medium text-zinc-200">
                {updateProgress.phase === 'checking'
                  ? t('driverManager.updateProgressChecking')
                  : updateProgress.phase === 'downloading'
                    ? t('driverManager.updateProgressDownloading')
                    : t('driverManager.updateProgressInstalling')}
                {updateProgress.total > 0 && ` (${updateProgress.current}/${updateProgress.total})`}
              </span>
            </div>
            <span className="text-[12px] font-mono" style={{ color: 'var(--text-secondary)' }}>
              {updateProgress.percent}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--bg-hover-2)' }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${updateProgress.percent}%`,
                background: 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%)',
              }}
            />
          </div>
          <p className="mt-2 text-[11px] truncate" style={{ color: 'var(--text-secondary)' }}>
            {updateProgress.currentDevice}
          </p>
        </div>
      )}
      {updateScanning && !updateProgress && !scanning && (
        <ScanProgress
          status="scanning"
          progress={0}
          currentPath={t('driverManager.queryingWindowsUpdate')}
          className="mb-5"
        />
      )}

      {/* Results summary */}
      {installResult && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl p-4"
          style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.1)' }}
        >
          <CircleCheckBig className="h-5 w-5 text-green-500" strokeWidth={1.8} />
          <div className="text-[13px] text-zinc-200">
            <p>
              {installResult.installed !== 1
                ? t('driverManager.installedDriverUpdatesPlural', { count: installResult.installed })
                : t('driverManager.installedDriverUpdates', { count: installResult.installed })}
              {installResult.failed > 0 && (
                <span className="text-red-400"> {t('driverManager.failedCount', { count: installResult.failed })}</span>
              )}
            </p>
            {installResult.rebootRequired && (
              <p className="mt-1 text-[12px] text-amber-400">{t('driverManager.rebootRequired')}</p>
            )}
          </div>
        </div>
      )}
      {cleanResult && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl p-4"
          style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.1)' }}
        >
          <CircleCheckBig className="h-5 w-5 text-green-500" strokeWidth={1.8} />
          <p className="text-[13px] text-zinc-200">
            {cleanResult.removed !== 1
              ? t('driverManager.removedStalePackagesPlural', { count: cleanResult.removed })
              : t('driverManager.removedStalePackages', { count: cleanResult.removed })}
            {cleanResult.spaceRecovered > 0 && (
              <span className="text-green-400">
                {' '}
                — {t('driverManager.spaceRecovered', { size: formatBytes(cleanResult.spaceRecovered) })}
              </span>
            )}
            {cleanResult.failed > 0 && (
              <span className="text-red-400"> {t('driverManager.failedCount', { count: cleanResult.failed })}</span>
            )}
          </p>
        </div>
      )}

      {/* Empty state */}
      {!hasScanned && !isScanning && (
        <EmptyState
          icon={Cpu}
          title={t('driverManager.emptyStateTitle')}
          description={t('driverManager.emptyStateDescription')}
          action={
            <button
              type="button"
              onClick={handleScan}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'var(--text-on-accent)',
              }}
            >
              <Search className="h-4 w-4" strokeWidth={1.8} />
              {t('driverManager.scanDriversButton')}
            </button>
          }
        />
      )}

      {/* All up to date state */}
      {hasScanned && !isScanning && updates.length === 0 && stalePackages.length === 0 && allDrivers.length > 0 && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
          style={{ background: 'rgba(34,197,94,0.03)', border: '1px solid rgba(34,197,94,0.08)' }}
        >
          <CircleCheckBig className="h-5 w-5 text-green-500 shrink-0" strokeWidth={1.8} />
          <p className="text-[13px] text-zinc-200">
            {t('driverManager.allUpToDateTitle')} —{' '}
            {t('driverManager.allInstalledDescription', { count: allDrivers.length })}
          </p>
        </div>
      )}

      {/* ─── Updates Section ──────────────────────────────────── */}
      {updates.length > 0 && !isScanning && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <CircleArrowUp className="h-4.5 w-4.5 text-blue-400" strokeWidth={1.8} />
              <span className="text-[13px] font-semibold text-zinc-200">
                {t('driverManager.updatesAvailable', { count: updates.length })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleUpdates}
                className="rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors"
                style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-secondary)' }}
              >
                {allUpdatesSelected ? t('driverManager.deselectAll') : t('driverManager.selectAll')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {updates.map((upd) => (
              <UpdateItemRow
                key={upd.id}
                upd={upd}
                t={t as (key: string, options?: Record<string, unknown>) => string}
                onToggle={handleToggleUpdateItem}
              />
            ))}
          </div>
        </div>
      )}

      {/* ─── Stale Packages Section ──────────────────────────── */}
      {stalePackages.length > 0 && !isScanning && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Trash2 className="h-4.5 w-4.5 text-amber-400" strokeWidth={1.8} />
              <span className="text-[13px] font-semibold text-zinc-200">
                {t('driverManager.stalePackages', { count: stalePackages.length })}
              </span>
              {totalStaleSize > 0 && (
                <span
                  className="rounded-md px-2 py-0.5 text-[10px] font-medium"
                  style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}
                >
                  {formatBytes(totalStaleSize)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleStale}
                className="rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors"
                style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-secondary)' }}
              >
                {allStaleSelected ? t('driverManager.deselectAll') : t('driverManager.selectAll')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {stalePackages.map((pkg) => (
              <StaleItemRow key={pkg.id} pkg={pkg} onToggle={handleTogglePackageItem} />
            ))}
          </div>
        </div>
      )}

      {/* ─── All Installed Drivers Section (collapsible) ───── */}
      {allDrivers.length > 0 && !isScanning && (
        <div className="mb-6">
          <button
            type="button"
            onClick={handleShowAllDrivers}
            className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            {showUpToDateDrivers ? (
              <ChevronDown className="h-4 w-4" strokeWidth={2} />
            ) : (
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            )}
            <CircleCheckBig className="h-4 w-4 text-green-500" strokeWidth={1.8} />
            {t('driverManager.allInstalledSection', { count: allDrivers.length })}
          </button>

          {showUpToDateDrivers && (
            <div className="grid grid-cols-1 gap-1.5">
              {allDrivers.map((drv) => (
                <InstalledDriverRow
                  key={drv.id}
                  drv={drv}
                  t={t as (key: string, options?: Record<string, unknown>) => string}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleApply}
        onCancel={() => setShowConfirm(false)}
        title={t('driverManager.confirmTitle')}
        description={confirmDesc}
        confirmLabel={t('driverManager.confirmLabel')}
        variant="danger"
      />
    </div>
  )
}
