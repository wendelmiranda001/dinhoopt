import { CircleCheckBig, Database, Loader2, Search, Shield, StopCircle, Wrench } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ScanProgress } from '@/components/shared/ScanProgress'
import { useIpcAction } from '@/hooks/useIpcAction'
import { useIpcScan } from '@/hooks/useIpcScan'
import { usePlatform } from '@/hooks/usePlatform'
import { useProgressListener } from '@/hooks/useProgressListener'
import { useHistoryStore } from '@/stores/history-store'
import { useRegistryStore } from '@/stores/registry-store'
import { useStatsStore } from '@/stores/stats-store'
import { RegistryCardsSection } from './registry/RegistryPageComponents'

export function RegistryPage() {
  const { features } = usePlatform()
  const { t } = useTranslation('registry')

  if (!features.registry) {
    return (
      <div className="animate-fade-in">
        <PageHeader title={t('pageHeaderUnavailableTitle')} description={t('pageHeaderUnavailableDescription')} />
        <EmptyState icon={Database} title={t('notAvailableTitle')} description={t('notAvailableDescription')} />
      </div>
    )
  }

  return <RegistryPageContent />
}

function RegistryPageContent() {
  const { t } = useTranslation('registry')
  const translate: (key: string, params?: Record<string, unknown>) => string = (key, params) =>
    params ? t(key, params) : t(key)
  const entries = useRegistryStore((s) => s.entries)
  const scanning = useRegistryStore((s) => s.scanning)
  const scanned = useRegistryStore((s) => s.scanned)
  const fixing = useRegistryStore((s) => s.fixing)
  const fixProgress = useRegistryStore((s) => s.fixProgress)
  const expandedCards = useRegistryStore((s) => s.expandedCards)
  const fixResult = useRegistryStore((s) => s.fixResult)
  const showFailures = useRegistryStore((s) => s.showFailures)
  const error = useRegistryStore((s) => s.error)

  const [showConfirm, setShowConfirm] = useState(false)
  const fixStartRef = useRef<number>(0)
  const addEntry = useHistoryStore((s) => s.addEntry)
  const recomputeStats = useStatsStore((s) => s.recompute)

  useProgressListener(window.dinho.onRegistryFixProgress, (data) => useRegistryStore.getState().setFixProgress(data))

  const { scan: handleScan } = useIpcScan({
    scanFn: () => window.dinho.registryScan(),
    setLoading: (v) => useRegistryStore.getState().setScanning(v),
    resetState: () => {
      const s = useRegistryStore.getState()
      s.setScanned(false)
      s.setEntries([])
      s.setFixResult(null)
      s.setError(null)
    },
    onResult: (results) => {
      const s = useRegistryStore.getState()
      s.setEntries(Array.isArray(results) ? results : [])
      s.setScanned(true)
    },
    onError: () => {
      useRegistryStore.getState().setError(t('toastScanFailedError'))
    },
  })

  const handleScanCancel = useCallback(async () => {
    try {
      await window.dinho.registryScanCancel()
    } catch {
      /* ignore */
    }
    useRegistryStore.getState().setScanning(false)
  }, [])

  const handleFixCancel = useCallback(async () => {
    try {
      await window.dinho.registryFixCancel()
    } catch {
      /* ignore */
    }
    useRegistryStore.getState().setFixing(false)
    useRegistryStore.getState().setFixProgress(null)
  }, [])

  const { execute: handleFix } = useIpcAction({
    actionFn: async () => {
      const store = useRegistryStore.getState()
      const currentEntries = store.entries
      const selectedEntries = currentEntries.filter((e) => e.selected)
      const selectedIds = selectedEntries.map((e) => e.id)
      return { result: await window.dinho.registryFix(selectedIds), currentEntries, selectedEntries, selectedIds }
    },
    setLoading: (v) => useRegistryStore.getState().setFixing(v),
    onStart: () => {
      setShowConfirm(false)
      const store = useRegistryStore.getState()
      store.setFixResult(null)
      store.setShowFailures(false)
      fixStartRef.current = Date.now()
      const currentEntries = store.entries
      const selectedEntries = currentEntries.filter((e) => e.selected)
      store.setFixProgress({ current: 0, total: selectedEntries.length, currentEntry: t('creatingBackup') })
    },
    onResult: ({ result, currentEntries, selectedEntries, selectedIds }) => {
      const s = useRegistryStore.getState()
      s.setFixResult(result)
      s.setEntries(s.entries.filter((e) => !selectedIds.includes(e.id)))

      const byType: Record<string, { found: number; fixed: number }> = {}
      for (const e of selectedEntries) {
        if (!byType[e.type]) byType[e.type] = { found: 0, fixed: 0 }
        const typeEntry = byType[e.type]
        if (typeEntry) typeEntry.found++
      }
      const totalSelected = selectedEntries.length
      for (const t in byType) {
        const typeEntry = byType[t]
        if (typeEntry) typeEntry.fixed = Math.round((typeEntry.found / totalSelected) * result.fixed)
      }

      addEntry({
        id: Date.now().toString(),
        type: 'registry',
        timestamp: new Date().toISOString(),
        duration: Date.now() - fixStartRef.current,
        totalItemsFound: currentEntries.length,
        totalItemsCleaned: result.fixed,
        totalItemsSkipped: result.failed,
        totalSpaceSaved: 0,
        categories: Object.entries(byType).map(([name, d]) => ({
          name,
          itemsFound: d.found,
          itemsCleaned: d.fixed,
          spaceSaved: 0,
        })),
        errorCount: result.failed,
      })
      recomputeStats()
    },
    onError: () => {
      useRegistryStore.getState().setError(t('toastFixFailedError'))
    },
  })

  const selectedCount = entries.filter((e) => e.selected).length
  const busy = scanning || fixing

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
              disabled={busy}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
            >
              <Search className="h-4 w-4" strokeWidth={1.8} /> {t('scanButton')}
            </button>
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              disabled={selectedCount === 0 || busy}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'var(--text-on-accent)',
              }}
            >
              <Wrench className="h-4 w-4" strokeWidth={2} /> {t('fixButton', { count: selectedCount })}
            </button>
          </div>
        }
      />

      {/* Warning */}
      <div
        className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
        style={{ background: 'var(--accent-muted-bg)', border: '1px solid var(--accent-muted-bg)' }}
      >
        <Shield className="h-5 w-5 shrink-0 text-amber-500" strokeWidth={1.8} />
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          <span className="font-semibold text-amber-500">{t('advancedFeatureLabel')}</span> —{' '}
          {t('advancedFeatureDescription')}
        </p>
      </div>

      {error && (
        <ErrorAlert message={error} onDismiss={() => useRegistryStore.getState().setError(null)} className="mb-5" />
      )}
      {scanning && (
        <div className="mb-5 flex items-center gap-3">
          <div className="flex-1">
            <ScanProgress status="scanning" progress={0} currentPath={t('scanProgressText')} />
          </div>
          <button
            type="button"
            onClick={handleScanCancel}
            className="flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-medium text-red-400 transition-all hover:text-red-300"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}
          >
            <StopCircle className="h-3.5 w-3.5" strokeWidth={2} /> {t('cancelButton')}
          </button>
        </div>
      )}

      {/* Fix progress */}
      {fixing && fixProgress && (
        <div
          className="mb-5 rounded-2xl p-5"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
              <span className="text-[13px] font-medium text-zinc-200">{t('fixingEntries')}</span>
            </div>
            <span className="font-mono text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              {fixProgress.current} / {fixProgress.total}
            </span>
          </div>
          <div className="mb-3 h-[6px] overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
            <div
              className="h-full rounded-full transition-all duration-200 ease-out"
              style={{
                width: `${fixProgress.total > 0 ? (fixProgress.current / fixProgress.total) * 100 : 0}%`,
                background: 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)',
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="truncate font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {fixProgress.currentEntry}
            </p>
            <button
              type="button"
              onClick={handleFixCancel}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-red-400 transition-all hover:text-red-300"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}
            >
              <StopCircle className="h-3 w-3" strokeWidth={2} /> {t('cancelButton')}
            </button>
          </div>
        </div>
      )}

      {fixResult && (
        <div
          className="mb-5 overflow-hidden rounded-2xl"
          style={{ border: `1px solid ${fixResult.failed > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)'}` }}
        >
          <div
            className="flex items-center gap-3 p-4"
            style={{ background: fixResult.failed > 0 ? 'rgba(239,68,68,0.04)' : 'rgba(34,197,94,0.06)' }}
          >
            <CircleCheckBig className="h-5 w-5 text-green-500" strokeWidth={1.8} />
            <p className="flex-1 text-[13px] text-zinc-200">
              {t('fixedEntries', { count: fixResult.fixed })}
              {fixResult.failed > 0 && (
                <button
                  type="button"
                  onClick={() => useRegistryStore.getState().setShowFailures(!showFailures)}
                  className="ml-2 text-red-400 underline decoration-red-400/30 hover:decoration-red-400 transition-colors"
                >
                  {t('failedCount', { count: fixResult.failed })} —{' '}
                  {showFailures ? t('failedHideDetails') : t('failedShowDetails')}
                </button>
              )}
            </p>
          </div>
          {showFailures && fixResult.failures.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
              {fixResult.failures.map((f, i) => (
                <div
                  key={`${f.issue}-${f.reason}`}
                  className="flex items-start gap-3 px-5 py-3"
                  style={{ borderBottom: i < fixResult.failures.length - 1 ? '1px solid var(--bg-subtle)' : 'none' }}
                >
                  <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                  <div className="min-w-0">
                    <p className="text-[12px] text-zinc-300">{f.issue}</p>
                    <p className="mt-0.5 text-[11px] text-red-400/80">{f.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!scanned && !scanning && (
        <EmptyState
          icon={Database}
          title={t('emptyStateTitle')}
          description={t('emptyStateDescription')}
          action={
            <button
              type="button"
              onClick={handleScan}
              disabled={fixing}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'var(--text-on-accent)',
              }}
            >
              <Search className="h-4 w-4" strokeWidth={1.8} />
              {t('startScan')}
            </button>
          }
        />
      )}

      {/* ============ CARDS ============ */}
      {scanned && !scanning && (
        <RegistryCardsSection
          entries={entries}
          expandedCards={expandedCards}
          fixing={fixing}
          onToggleCardAll={(types) => useRegistryStore.getState().toggleCardAll(types)}
          onToggleCardExpand={(i) => useRegistryStore.getState().toggleCardExpand(i)}
          onToggleEntry={(id) => useRegistryStore.getState().toggleEntry(id)}
          t={translate}
        />
      )}

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleFix}
        onCancel={() => setShowConfirm(false)}
        title={t('confirmFixTitle')}
        description={t('confirmFixDescription', { count: selectedCount })}
        confirmLabel={t('confirmFixLabel')}
        variant="warning"
      />
    </div>
  )
}
