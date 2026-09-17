import { CleanerType, ScanStatus } from '@shared/enums'
import type { CleanResult, ScanResult } from '@shared/types'
import { FileText, Loader2, Search, ShieldAlert, Sparkles, TriangleAlert, Wifi } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CleanSummary } from '@/components/cleaner/CleanSummary'
import { NetworkCleanupModal } from '@/components/cleaner/NetworkCleanupModal'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { loadReport, ReportCard, type ReportData, saveReport } from '@/components/shared/ReportCard'
import { ScanProgress } from '@/components/shared/ScanProgress'
import { StickyActionBar } from '@/components/shared/StickyActionBar'
import { usePlatform } from '@/hooks/usePlatform'
import logger from '@/lib/renderer-logger'
import { formatBytes, formatNumber } from '@/lib/utils'
import { useHistoryStore } from '@/stores/history-store'
import { useScanStore } from '@/stores/scan-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useStatsStore } from '@/stores/stats-store'
import { CategoryResultsPanel } from './cleaner/CategoryResultsPanel'
import { categories } from './cleaner/CleanerPageConstants'

export function CleanerPage() {
  const { t } = useTranslation('cleaner')
  const { platform } = usePlatform()
  const store = useScanStore()
  const recomputeStats = useStatsStore((s) => s.recompute)
  const addEntry = useHistoryStore((s) => s.addEntry)

  const protectRecycleBin = useSettingsStore((s) => s.settings.cleaner.protectRecycleBin)
  const visibleCategories = protectRecycleBin ? categories.filter((c) => c.type !== CleanerType.RecycleBin) : categories
  const [activeCategory, setActiveCategory] = useState<CleanerType>(CleanerType.System)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showNetworkModal, setShowNetworkModal] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const cleanStartRef = useRef<number>(0)
  const [scanningCategory, setScanningCategory] = useState<CleanerType | null>(null)
  const [report, setReport] = useState<ReportData | null>(() => loadReport())

  const scanIndexRef = useRef(0)
  const cleanIndexRef = useRef(0)
  const cleanTotalRef = useRef(1)
  const totalCategoriesRef = useRef(visibleCategories.length)
  totalCategoriesRef.current = visibleCategories.length
  const setProgress = useScanStore((s) => s.setProgress)

  useEffect(() => {
    if (!window.dinho?.onScanProgress) return
    return window.dinho.onScanProgress((data) => {
      if (data.phase === 'cleaning') {
        const total = Math.max(cleanTotalRef.current, 1)
        const base = (cleanIndexRef.current / total) * 100
        const slice = Math.min(data.progress, 100) / total
        setProgress({ ...data, progress: Math.min(100, base + slice) })
      } else {
        const total = Math.max(totalCategoriesRef.current, 1)
        const base = (scanIndexRef.current / total) * 100
        const slice = Math.min(data.progress, 100) / total
        setProgress({ ...data, progress: Math.min(100, base + slice) })
      }
    })
  }, [setProgress])

  const [failedCategories, setFailedCategories] = useState<string[]>([])
  const [elevationSkipped, setElevationSkipped] = useState<string[]>([])

  const handleRelaunch = useCallback(() => {
    window.dinho.elevationRelaunch()
  }, [])

  const handleScan = useCallback(async () => {
    store.setStatus(ScanStatus.Scanning)
    store.setResults([])
    setExpandedGroups(new Set())
    setFailedCategories([])
    setElevationSkipped([])
    const failed: string[] = []
    const skippedForElevation: string[] = []
    try {
      const scanFns: Partial<Record<CleanerType, () => Promise<ScanResult[]>>> = {
        [CleanerType.System]: () => window.dinho.systemScan(),
        [CleanerType.WinSxS]: () => window.dinho.winSxSScan(),
        [CleanerType.Browser]: () => window.dinho.browserScan(),
        [CleanerType.App]: () => window.dinho.appScan(),
        [CleanerType.Gaming]: () => window.dinho.gamingScan(),
        [CleanerType.RecycleBin]: () => window.dinho.recycleBinScan(),
        [CleanerType.Shortcut]: () => window.dinho.shortcutScan(),
        [CleanerType.Environment]: () => window.dinho.environmentScan(),
        [CleanerType.Database]: () => window.dinho.databaseScan(),
        [CleanerType.UninstallLeftovers]: () => window.dinho.uninstallLeftoversScan(),
      }
      for (let ci = 0; ci < visibleCategories.length; ci++) {
        const cat = visibleCategories[ci]
        if (!cat) continue
        scanIndexRef.current = ci
        setScanningCategory(cat.type)
        try {
          const scanFn = scanFns[cat.type]
          if (!scanFn) continue
          const results = await scanFn()
          const elevationMarker = results.find((r) => r.subcategory === '__elevation_required')
          if (elevationMarker?.group) {
            skippedForElevation.push(...elevationMarker.group.split(', '))
          }
          store.addResults(results.filter((r) => r.subcategory !== '__elevation_required'))
        } catch {
          failed.push(t(cat.labelKey))
        }
      }
      if (failed.length > 0) setFailedCategories(failed)
      if (skippedForElevation.length > 0) setElevationSkipped(skippedForElevation)
      setScanningCategory(null)
      store.setStatus(ScanStatus.Complete)
    } catch {
      setScanningCategory(null)
      store.setStatus(ScanStatus.Error)
    }
    store.setProgress(null)
  }, [store, visibleCategories, t])

  const handleClean = useCallback(async () => {
    setShowConfirm(false)
    store.setStatus(ScanStatus.Cleaning)
    cleanStartRef.current = Date.now()
    try {
      const selectedIds = store.getSelectedIds()
      const cleanFns: Partial<Record<CleanerType, (ids: string[]) => Promise<CleanResult>>> = {
        [CleanerType.System]: (ids) => window.dinho.systemClean(ids),
        [CleanerType.WinSxS]: () => window.dinho.winSxSClean(),
        [CleanerType.Browser]: (ids) => window.dinho.browserClean(ids),
        [CleanerType.App]: (ids) => window.dinho.appClean(ids),
        [CleanerType.Gaming]: (ids) => window.dinho.gamingClean(ids),
        [CleanerType.RecycleBin]: () => window.dinho.recycleBinClean(),
        [CleanerType.Shortcut]: (ids) => window.dinho.shortcutClean(ids),
        [CleanerType.Environment]: (ids) => window.dinho.environmentClean(ids),
        [CleanerType.Database]: (ids) => window.dinho.databaseClean(ids),
        [CleanerType.UninstallLeftovers]: (ids) => window.dinho.uninstallLeftoversClean(ids),
      }
      let totalCleaned = 0
      let totalFiles = 0
      let totalSkipped = 0
      let anyNeedsElevation = false
      const allErrors: { path: string; reason: string }[] = []
      const categoryBreakdown: Array<{ name: string; type: string; found: number; cleaned: number; space: number }> = []

      const activeCount = visibleCategories.filter((cat) => {
        const catItems = store.results.filter((r) => r.category === cat.type).flatMap((r) => r.items)
        return catItems.some((item) => selectedIds.includes(item.id))
      }).length
      cleanTotalRef.current = Math.max(activeCount, 1)
      let activeIndex = 0

      store.setProgress({ phase: 'cleaning', category: '', currentPath: '', progress: 0, itemsFound: 0, sizeFound: 0 })

      for (let ci = 0; ci < visibleCategories.length; ci++) {
        const cat = visibleCategories[ci]
        if (!cat) continue
        const catResults = store.results.filter((r) => r.category === cat.type)
        const catItemsAll = catResults.flatMap((r) => r.items)
        const catItemIds = catItemsAll.filter((item) => selectedIds.includes(item.id)).map((item) => item.id)
        if (catItemIds.length > 0) {
          cleanIndexRef.current = activeIndex
          try {
            const cleanFn = cleanFns[cat.type]
            if (!cleanFn) continue
            const result = await cleanFn(catItemIds)
            if (result) {
              totalCleaned += result.totalCleaned || 0
              totalFiles += result.filesDeleted || 0
              totalSkipped += result.filesSkipped || 0
              if (result.needsElevation) anyNeedsElevation = true
              if (result.errors?.length) allErrors.push(...result.errors)
              categoryBreakdown.push({
                name: t(cat.labelKey),
                type: cat.type,
                found: catItemsAll.length,
                cleaned: result.filesDeleted || 0,
                space: result.totalCleaned || 0,
              })
            }
          } catch (err) {
            logger.error('CleanerPage', `Clean failed for category ${cat.type}`, err)
          }
          activeIndex++
        } else if (catItemsAll.length > 0) {
          categoryBreakdown.push({
            name: t(cat.labelKey),
            type: cat.type,
            found: catItemsAll.length,
            cleaned: 0,
            space: 0,
          })
        }
      }

      const totalFound = store.results.reduce((s, r) => s + r.itemCount, 0)
      const duration = Date.now() - cleanStartRef.current
      await addEntry({
        id: Date.now().toString(),
        type: 'cleaner',
        timestamp: new Date().toISOString(),
        duration,
        totalItemsFound: totalFound,
        totalItemsCleaned: totalFiles,
        totalItemsSkipped: totalSkipped,
        totalSpaceSaved: totalCleaned,
        categories: categoryBreakdown.map((d) => ({
          name: d.name,
          itemsFound: d.found,
          itemsCleaned: d.cleaned,
          spaceSaved: d.space,
        })),
        errorCount: allErrors.length,
      })
      recomputeStats()

      const totalSizeBefore = store.getTotalSize()
      store.setCleanSummary({
        totalCleaned,
        filesDeleted: totalFiles,
        filesSkipped: totalSkipped,
        errors: allErrors,
        needsElevation: anyNeedsElevation,
        categories: categoryBreakdown,
        duration,
        totalSizeBefore,
      })
      const reportData: ReportData = {
        timestamp: new Date().toISOString(),
        spaceBefore: totalSizeBefore,
        spaceAfter: totalSizeBefore - totalCleaned,
        spaceFreed: totalCleaned,
        filesDeleted: totalFiles,
        duration,
        categories: categoryBreakdown,
      }
      saveReport(reportData)
      setReport(reportData)
      store.setStatus(ScanStatus.Complete)
    } catch {
      store.setStatus(ScanStatus.Error)
    }
    store.setProgress(null)
  }, [store, t, visibleCategories, addEntry, recomputeStats])

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSubcategorySelection = (result: ScanResult) => {
    store.toggleSubcategory(result)
  }

  const selectedCount = useMemo(() => store.getSelectedIds().length, [store])

  const isScanning = store.status === ScanStatus.Scanning
  const isCleaning = store.status === ScanStatus.Cleaning
  const hasResults = store.results.length > 0

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleScan}
              disabled={isScanning || isCleaning}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
            >
              <Search className="h-4 w-4" strokeWidth={1.8} />
              {t('scanButton')}
            </button>
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              disabled={!hasResults || isScanning || isCleaning || store.getSelectedIds().length === 0}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'var(--text-on-accent)',
                boxShadow: hasResults ? '0 4px 20px rgba(245,158,11,0.2)' : 'none',
              }}
            >
              <Sparkles className="h-4 w-4" strokeWidth={2} />
              {t('cleanButton')}
            </button>
            <button
              type="button"
              onClick={() => setShowNetworkModal(true)}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-300 transition-all"
              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
            >
              <Wifi className="h-4 w-4" strokeWidth={1.8} />
              {t('networkLink')}
            </button>
          </div>
        }
      />

      <div className="flex gap-5">
        {/* Category sidebar */}
        <div className="w-56 shrink-0 space-y-1.5">
          {visibleCategories.map((cat) => {
            const count = store.results.filter((r) => r.category === cat.type).reduce((sum, r) => sum + r.itemCount, 0)
            const isActive = activeCategory === cat.type
            return (
              <button
                type="button"
                key={cat.type}
                onClick={() => setActiveCategory(cat.type)}
                className="relative flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all"
                style={{
                  background: isActive ? 'var(--accent-muted-bg)' : 'transparent',
                  color: isActive ? 'var(--accent-hover)' : 'var(--text-muted)',
                }}
              >
                {isActive && (
                  <div
                    className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full"
                    style={{ background: 'var(--accent)' }}
                  />
                )}
                {scanningCategory === cat.type ? (
                  <Loader2 className="h-[17px] w-[17px] shrink-0 animate-spin text-amber-400" strokeWidth={1.8} />
                ) : (
                  <cat.icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} />
                )}
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-medium">{t(cat.labelKey)}</span>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {t(cat.descriptionKey)}
                  </p>
                </div>
                {count > 0 && (
                  <span
                    className="rounded-md px-1.5 py-0.5 font-mono text-[11px]"
                    style={{ background: 'var(--bg-hover-2)', color: 'var(--text-muted)' }}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}

          {hasResults && (
            <div
              className="mt-5 rounded-2xl p-4"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
            >
              <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                {t('totalRecoverable')}
              </p>
              <p className="text-[20px] font-bold tracking-tight text-amber-400">{formatBytes(store.getTotalSize())}</p>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {t('itemsCount', { count: formatNumber(store.results.reduce((s, r) => s + r.itemCount, 0)) })}
              </p>
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                  {t('selectedLabel')}
                </p>
                <p className="text-[15px] font-semibold text-zinc-200">{formatBytes(store.getSelectedSize())}</p>
              </div>
            </div>
          )}
        </div>

        {/* Item panel */}
        <div className="flex-1 min-w-0">
          {(isScanning || isCleaning) && store.progress && (
            <ScanProgress
              status={isScanning ? 'scanning' : 'cleaning'}
              progress={store.progress.progress}
              currentPath={store.progress.currentPath}
              itemsFound={store.progress.itemsFound}
              sizeFound={store.progress.sizeFound}
              className="mb-5"
            />
          )}

          {failedCategories.length > 0 && store.status === ScanStatus.Complete && (
            <div
              className="mb-5 flex items-center gap-3 rounded-2xl px-4 py-3"
              style={{ background: 'var(--accent-muted-bg)', border: '1px solid rgba(245,158,11,0.12)' }}
            >
              <TriangleAlert className="h-4 w-4 shrink-0 text-amber-400" strokeWidth={1.8} />
              <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {t('scannersFailed')} <span className="text-amber-400 font-medium">{failedCategories.join(', ')}</span>
              </p>
            </div>
          )}

          {elevationSkipped.length > 0 && store.status === ScanStatus.Complete && !store.cleanSummary && (
            <div
              className="mb-5 flex items-center gap-3 rounded-2xl px-4 py-3"
              style={{ background: 'var(--accent-muted-bg)', border: '1px solid var(--accent-muted-border)' }}
            >
              <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" strokeWidth={1.8} />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-zinc-300">
                  <span className="font-medium">{t('categoriesSkipped', { count: elevationSkipped.length })}</span>
                  <span style={{ color: 'var(--text-muted)' }}> {t('categoriesSkippedSuffix')}</span>
                </p>
                <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                  {elevationSkipped.slice(0, 4).join(', ')}
                  {elevationSkipped.length > 4
                    ? ` ${t('categoriesSkippedMore', { count: elevationSkipped.length - 4 })}`
                    : ''}
                </p>
              </div>
              {platform !== 'darwin' && (
                <button
                  type="button"
                  onClick={handleRelaunch}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-medium text-amber-400 transition-colors hover:bg-amber-500/15"
                  style={{ border: '1px solid rgba(245,158,11,0.2)' }}
                >
                  {t('relaunchAsAdmin')}
                </button>
              )}
            </div>
          )}

          {store.cleanSummary && store.status === ScanStatus.Complete && (
            <CleanSummary summary={store.cleanSummary} onRelaunchAsAdmin={handleRelaunch} platform={platform} />
          )}

          {report && !hasResults && !isScanning && <ReportCard report={report} icon={FileText} />}

          {!hasResults && !isScanning && (
            <EmptyState
              icon={Search}
              title={t('noScanResultsTitle')}
              description={t('noScanResultsDescription')}
              showLastScan
              lastScanType="cleaner"
              actions={[
                {
                  label: t('startScan'),
                  onClick: handleScan,
                  icon: Search,
                },
              ]}
            />
          )}

          {hasResults && (
            <CategoryResultsPanel
              activeCategory={activeCategory}
              expandedGroups={expandedGroups}
              toggleGroup={toggleGroup}
              toggleSubcategorySelection={toggleSubcategorySelection}
            />
          )}
        </div>
      </div>

      <StickyActionBar
        selectedCount={selectedCount}
        totalLabel={t('itemsSelected')}
        onAction={() => setShowConfirm(true)}
        actionLabel={t('cleanButton')}
        actionIcon={Sparkles}
      />

      <NetworkCleanupModal open={showNetworkModal} onClose={() => setShowNetworkModal(false)} />

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleClean}
        onCancel={() => setShowConfirm(false)}
        title={t('confirmCleanTitle')}
        description={t('confirmCleanDescription', {
          count: formatNumber(selectedCount),
          size: formatBytes(store.getSelectedSize()),
        })}
        confirmLabel={t('confirmCleanLabel')}
        variant="warning"
      />
    </div>
  )
}
