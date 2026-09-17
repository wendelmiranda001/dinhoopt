import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  CircleCheckBig,
  CircleX,
  Download,
  EyeOff,
  Filter,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { OutsideClickHandler } from '@/components/shared/OutsideClickHandler'
import { StatCard } from '@/components/shared/StatCard'

import logger from '@/lib/renderer-logger'
import { useHistoryStore } from '@/stores/history-store'
import { useSettingsStore } from '@/stores/settings-store'
import { type SeverityFilter, type SortField, useUpdaterStore } from '@/stores/updater-store'
import { AppRow, IgnoredRow, UpToDateRow } from './software-updater/SoftwareUpdaterRows'
import { FILTER_LABEL_KEYS, SORT_LABEL_KEYS } from './software-updater/updater-constants'
import { useFilteredAndSortedApps } from './software-updater/useFilteredAndSortedApps'
import { useInitialLoader } from './software-updater/useIgnoredUpdatesLoader'
import { useUpdaterProgress } from './software-updater/useUpdaterProgress'

export function SoftwareUpdaterPage({ embedded }: { embedded?: boolean }) {
  const { t } = useTranslation('updates')
  const {
    apps,
    loading,
    updating,
    progress,
    updateResult,
    error,
    hasChecked,
    packageManagerAvailable,
    packageManagerName,
    searchQuery,
    severityFilter,
    sortField,
    sortDirection,
    ignoredApps,
  } = useUpdaterStore(
    useShallow((s) => ({
      apps: s.apps,
      loading: s.loading,
      updating: s.updating,
      progress: s.progress,
      updateResult: s.updateResult,
      error: s.error,
      hasChecked: s.hasChecked,
      packageManagerAvailable: s.packageManagerAvailable,
      packageManagerName: s.packageManagerName,
      searchQuery: s.searchQuery,
      severityFilter: s.severityFilter,
      sortField: s.sortField,
      sortDirection: s.sortDirection,
      ignoredApps: s.ignoredApps,
    })),
  )

  const autoInstallUpdates = useSettingsStore((s) => s.settings.autoInstallUpdates)
  const autoInstallSchedule = useSettingsStore((s) => s.settings.autoInstallSchedule)

  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [showIgnored, setShowIgnored] = useState(false)

  const { filteredApps, upToDate, selectedCount, allSelected, isBusy, majorCount, minorCount, patchCount } =
    useFilteredAndSortedApps()

  // ─── Run updates ────────────────────────────────────────────
  const handleUpdate = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      const store = useUpdaterStore.getState()
      store.setUpdating(true)
      store.setUpdateResult(null)
      store.setError(null)
      store.setProgress(null)

      const startTime = Date.now()
      const appsToUpdate = store.apps.filter((a) => ids.includes(a.id))

      try {
        const result = await window.dinho.softwareUpdateRun(ids, store.packageManagerName ?? undefined)
        const s = useUpdaterStore.getState()
        s.setUpdateResult(result)
        s.setProgress(null)

        if (result.succeeded > 0) {
          const failedIds = new Set(result.errors.map((e) => e.appId))
          const succeededIds = ids.filter((id) => !failedIds.has(id))
          s.removeApps(succeededIds)
          toast.success(
            result.succeeded !== 1
              ? t('softwareUpdater.toastUpdateSuccessPlural', { count: result.succeeded })
              : t('softwareUpdater.toastUpdateSuccess', { count: result.succeeded }),
          )
        }
        if (result.failed > 0) {
          toast.error(
            result.failed !== 1
              ? t('softwareUpdater.toastUpdateFailedPlural', { count: result.failed })
              : t('softwareUpdater.toastUpdateFailed', { count: result.failed }),
          )
        }

        const bySeverity: Record<string, { found: number; updated: number }> = {}
        const failedAppIds = new Set(result.errors.map((e) => e.appId))
        for (const app of appsToUpdate) {
          const sev = app.severity
          if (!bySeverity[sev]) bySeverity[sev] = { found: 0, updated: 0 }
          bySeverity[sev].found++
          if (!failedAppIds.has(app.id)) bySeverity[sev].updated++
        }
        await useHistoryStore.getState().addEntry({
          id: Date.now().toString(),
          type: 'software-update',
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
          totalItemsFound: ids.length,
          totalItemsCleaned: result.succeeded,
          totalItemsSkipped: 0,
          totalSpaceSaved: 0,
          categories: Object.entries(bySeverity).map(([name, d]) => ({
            name: `${name} updates`,
            itemsFound: d.found,
            itemsCleaned: d.updated,
            spaceSaved: 0,
          })),
          errorCount: result.failed,
        })
      } catch (err) {
        logger.error('SoftwareUpdaterPage', 'Update failed', err)
        useUpdaterStore.getState().setError(t('softwareUpdater.errorUpdateFailed'))
      } finally {
        useUpdaterStore.getState().setUpdating(false)
      }
    },
    [t],
  )

  const handleUpdateSelected = useCallback(() => {
    const selectedIds = useUpdaterStore
      .getState()
      .apps.filter((a) => a.selected)
      .map((a) => a.id)
    handleUpdate(selectedIds)
  }, [handleUpdate])

  // ─── Check for updates ──────────────────────────────────────
  const handleCheck = useCallback(() => {
    const store = useUpdaterStore.getState()
    store.setLoading(true)
    store.setError(null)
    store.setUpdateResult(null)

    window.dinho
      .softwareUpdateCheck()
      .then((result) => {
        const s = useUpdaterStore.getState()
        s.setApps(result.apps)
        s.setPackageManagerAvailable(result.packageManagerAvailable)
        s.setPackageManagerName(result.packageManagerName)
        s.setHasChecked(true)

        const visibleCount = useUpdaterStore.getState().apps.length
        if (
          result.packageManagerAvailable &&
          visibleCount === 0 &&
          useUpdaterStore.getState().ignoredApps.length === 0
        ) {
          toast.success(t('softwareUpdater.toastAllUpToDate'))
        } else if (visibleCount > 0) {
          toast.info(
            visibleCount !== 1
              ? t('softwareUpdater.toastUpdatesFoundPlural', { count: visibleCount })
              : t('softwareUpdater.toastUpdatesFound', { count: visibleCount }),
          )
        }

        // Auto-install: if enabled and updates found, install all visible apps
        const settings = useSettingsStore.getState().settings
        if (settings.autoInstallUpdates && visibleCount > 0 && result.packageManagerAvailable) {
          const allIds = useUpdaterStore.getState().apps.map((a) => a.id)
          if (allIds.length > 0) {
            toast.info(t('softwareUpdater.autoInstalling', { count: allIds.length }))
            handleUpdate(allIds)
          }
        }
      })
      .catch((err) => {
        logger.error('SoftwareUpdaterPage', 'Update check failed', err)
        useUpdaterStore.getState().setError(t('softwareUpdater.errorCheckFailed'))
      })
      .finally(() => {
        useUpdaterStore.getState().setLoading(false)
      })
  }, [t, handleUpdate])

  useUpdaterProgress()
  useInitialLoader(handleCheck)

  return (
    <div className={embedded ? '' : 'animate-fade-in'}>
      {!embedded && (
        <PageHeader title={t('softwareUpdater.pageTitle')} description={t('softwareUpdater.pageDescription')} />
      )}

      {/* Actions */}
      <div className="mb-5 flex items-center gap-2.5">
        <button
          onClick={handleCheck}
          disabled={isBusy}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
            color: 'var(--text-on-accent)',
          }}
          type="button"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : (
            <RefreshCw className="h-4 w-4" strokeWidth={2} />
          )}
          {loading
            ? t('softwareUpdater.checkingButton')
            : hasChecked
              ? t('softwareUpdater.recheckButton')
              : t('softwareUpdater.checkForUpdatesButton')}
        </button>

        {/* Auto-install updates toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              const next = !autoInstallUpdates
              useSettingsStore.getState().updateSettings({ autoInstallUpdates: next })
              await window.dinho.settingsSet({ autoInstallUpdates: next })
            }}
            disabled={isBusy}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-all disabled:opacity-40"
            style={{
              background: autoInstallUpdates ? 'rgba(34,197,94,0.1)' : 'var(--bg-subtle)',
              border: autoInstallUpdates ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--border-medium)',
              color: autoInstallUpdates ? '#4ade80' : 'var(--text-muted)',
            }}
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('softwareUpdater.autoInstallLabel')}
          </button>

          {autoInstallUpdates && (
            <select
              value={autoInstallSchedule ?? 'daily'}
              onChange={async (e) => {
                const value = e.target.value as 'daily' | 'weekly'
                useSettingsStore.getState().updateSettings({ autoInstallSchedule: value })
                await window.dinho.settingsSet({ autoInstallSchedule: value })
              }}
              disabled={isBusy}
              aria-label={t('softwareUpdater.autoInstallScheduleLabel')}
              className="rounded-xl px-3 py-2.5 text-[12px] font-medium text-zinc-400 outline-none transition-all disabled:opacity-40"
              style={{
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-medium)',
              }}
            >
              <option value="daily">{t('softwareUpdater.scheduleDaily')}</option>
              <option value="weekly">{t('softwareUpdater.scheduleWeekly')}</option>
            </select>
          )}
        </div>

        {/* Search */}
        {hasChecked && apps.length > 0 && (
          <div
            className="flex items-center gap-2 rounded-xl px-4 py-2.5"
            style={{
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-medium)',
            }}
          >
            <Search className="h-4 w-4 text-zinc-500" strokeWidth={1.8} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => useUpdaterStore.getState().setSearchQuery(e.target.value)}
              placeholder={t('softwareUpdater.searchPlaceholder')}
              className="bg-transparent text-[13px] text-zinc-300 placeholder-zinc-600 outline-none w-48"
            />
          </div>
        )}

        {/* Severity filter */}
        {hasChecked && apps.length > 0 && (
          <OutsideClickHandler isOpen={showFilterMenu} onClose={() => setShowFilterMenu(false)} className="relative">
            <button
              type="button"
              onClick={() => setShowFilterMenu(!showFilterMenu)}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-400 transition-all"
              style={{
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-medium)',
              }}
            >
              <Filter className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t(FILTER_LABEL_KEYS[severityFilter] ?? '')}
              <ChevronDown className="h-3 w-3" strokeWidth={2} />
            </button>
            {showFilterMenu && (
              <div
                className="absolute top-full left-0 z-50 mt-1 rounded-xl py-1 shadow-xl"
                style={{
                  background: '#1e1e22',
                  border: '1px solid var(--border-strong)',
                  minWidth: 120,
                }}
              >
                {Object.entries(FILTER_LABEL_KEYS).map(([key, labelKey]) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => {
                      useUpdaterStore.getState().setSeverityFilter(key as SeverityFilter)
                      setShowFilterMenu(false)
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-[12px] text-zinc-300 hover:bg-white/5 transition-colors"
                  >
                    {t(labelKey)}
                    {severityFilter === key && (
                      <CircleCheckBig className="ml-auto h-3 w-3 text-amber-400" strokeWidth={2} />
                    )}
                  </button>
                ))}
              </div>
            )}
          </OutsideClickHandler>
        )}

        {/* Sort */}
        {hasChecked && apps.length > 0 && (
          <OutsideClickHandler isOpen={showSortMenu} onClose={() => setShowSortMenu(false)} className="relative">
            <button
              type="button"
              onClick={() => setShowSortMenu(!showSortMenu)}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-400 transition-all"
              style={{
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-medium)',
              }}
            >
              <ArrowUpDown className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t(SORT_LABEL_KEYS[sortField] ?? '')}
              <ChevronDown className="h-3 w-3" strokeWidth={2} />
            </button>
            {showSortMenu && (
              <div
                className="absolute top-full left-0 z-50 mt-1 rounded-xl py-1 shadow-xl"
                style={{
                  background: '#1e1e22',
                  border: '1px solid var(--border-strong)',
                  minWidth: 140,
                }}
              >
                {Object.entries(SORT_LABEL_KEYS).map(([field, labelKey]) => (
                  <button
                    type="button"
                    key={field}
                    onClick={() => {
                      const store = useUpdaterStore.getState()
                      if (sortField === field) {
                        store.setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
                      } else {
                        store.setSortField(field as SortField)
                        store.setSortDirection('asc')
                      }
                      setShowSortMenu(false)
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-[12px] text-zinc-300 hover:bg-white/5 transition-colors"
                  >
                    {t(labelKey)}
                    {sortField === field && (
                      <span className="ml-auto text-amber-400 text-[10px]">
                        {sortDirection === 'asc' ? t('softwareUpdater.sortAsc') : t('softwareUpdater.sortDesc')}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </OutsideClickHandler>
        )}
      </div>

      {/* Package manager not available warning */}
      {hasChecked && !packageManagerAvailable && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
          style={{
            background: 'rgba(239,68,68,0.04)',
            border: '1px solid rgba(239,68,68,0.1)',
          }}
        >
          <TriangleAlert className="h-5 w-5 shrink-0 text-red-400" strokeWidth={1.8} />
          <p className="text-[12px] text-zinc-400">
            <span className="font-semibold text-red-400">
              {t('softwareUpdater.packageManagerNotFound.wingetNotFound')}
            </span>{' '}
            — {t('softwareUpdater.packageManagerNotFound.wingetRequired')}{' '}
            <span className="text-zinc-300">{t('softwareUpdater.packageManagerNotFound.wingetStore')}</span>{' '}
            {t('softwareUpdater.packageManagerNotFound.wingetSearchTerm')}
          </p>
        </div>
      )}

      {/* Errors */}
      {error && (
        <ErrorAlert message={error} onDismiss={() => useUpdaterStore.getState().setError(null)} className="mb-5" />
      )}

      {/* Stat cards */}
      {hasChecked && packageManagerAvailable && apps.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <StatCard icon={Package} label={t('softwareUpdater.statOutdatedApps')} value={apps.length} variant="accent" />
          <StatCard
            icon={TriangleAlert}
            label={t('softwareUpdater.statMajorUpdates')}
            value={majorCount}
            variant="danger"
          />
          <StatCard
            icon={TriangleAlert}
            label={t('softwareUpdater.statMinorUpdates')}
            value={minorCount}
            variant="default"
          />
          <StatCard
            icon={CircleCheckBig}
            label={t('softwareUpdater.statPatches')}
            value={patchCount}
            variant="success"
          />
        </div>
      )}

      {/* Update progress */}
      {updating && progress && (
        <div
          className="mb-5 rounded-2xl p-4"
          style={{
            background: 'rgba(245,158,11,0.04)',
            border: '1px solid var(--accent-muted-bg)',
          }}
        >
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-amber-400" strokeWidth={2} />
              <span className="text-[13px] font-medium text-zinc-200">
                {t('softwareUpdater.updatingProgress', {
                  app: progress.currentApp,
                  current: progress.current,
                  total: progress.total,
                })}
              </span>
            </div>
            <span className="text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {progress.percent}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--bg-hover-2)' }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress.percent}%`,
                background: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)',
              }}
            />
          </div>
          {progress.status === 'failed' && (
            <p className="mt-2 text-[11px] text-red-400">
              {t('softwareUpdater.failedToUpdate', { app: progress.currentApp })}
            </p>
          )}
        </div>
      )}

      {/* Update result banner */}
      {updateResult && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl p-4"
          style={{
            background: updateResult.failed === 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
            border: `1px solid ${updateResult.failed === 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}`,
          }}
        >
          {updateResult.failed === 0 ? (
            <CircleCheckBig className="h-5 w-5 text-green-500 shrink-0" strokeWidth={1.8} />
          ) : (
            <CircleX className="h-5 w-5 text-red-500 shrink-0" strokeWidth={1.8} />
          )}
          <div className="text-[13px] text-zinc-200">
            {updateResult.succeeded > 0 && (
              <span className="text-green-400">
                {updateResult.succeeded !== 1
                  ? t('softwareUpdater.updateResultAppsUpdatedPlural', { count: updateResult.succeeded })
                  : t('softwareUpdater.updateResultAppsUpdated', { count: updateResult.succeeded })}
              </span>
            )}
            {updateResult.succeeded > 0 && updateResult.failed > 0 && <span> — </span>}
            {updateResult.failed > 0 && (
              <span className="text-red-400">
                {t('softwareUpdater.updateResultFailed', { count: updateResult.failed })}
              </span>
            )}
            {updateResult.errors.length > 0 && (
              <div className="mt-2">
                {updateResult.errors.map((e) => {
                  const isInstallerChange = e.reason.toLowerCase().includes('installer type changed')
                  return (
                    <div key={e.appId} className="mt-1.5">
                      <span style={{ color: 'var(--text-muted)' }} className="text-[12px]">
                        {e.name}: {e.reason}
                      </span>
                      {isInstallerChange && packageManagerName && (
                        <div
                          className="mt-1.5 rounded-lg px-3 py-2 font-mono text-[11px] text-zinc-300 select-all cursor-text"
                          style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-medium)' }}
                        >
                          {packageManagerName} uninstall {e.appId}
                          <br />
                          {packageManagerName} install {e.appId}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Selection controls + Update button */}
      {hasChecked && apps.length > 0 && !loading && (
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              const store = useUpdaterStore.getState()
              allSelected ? store.deselectAll() : store.selectAll()
            }}
            disabled={updating}
            className="flex items-center gap-2 text-[12px] font-medium text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-40"
          >
            <div
              className="flex h-4 w-4 items-center justify-center rounded"
              style={{
                background: allSelected ? 'var(--accent)' : 'var(--bg-hover-2)',
                border: allSelected ? 'none' : '1px solid var(--border-stronger)',
              }}
            >
              {allSelected && (
                <CircleCheckBig className="h-3 w-3" style={{ color: 'var(--text-on-accent)' }} strokeWidth={3} />
              )}
            </div>
            {allSelected ? t('softwareUpdater.deselectAll') : t('softwareUpdater.selectAll')}
          </button>

          {selectedCount > 0 && (
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {t('softwareUpdater.selectedCount', { count: selectedCount })}
            </span>
          )}

          <div className="flex-1" />

          <button
            type="button"
            onClick={handleUpdateSelected}
            disabled={selectedCount === 0 || updating}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
            style={{
              background: selectedCount > 0 ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' : 'var(--bg-hover)',
              color: selectedCount > 0 ? '#052e16' : 'var(--text-muted)',
              border: selectedCount > 0 ? 'none' : '1px solid var(--border-medium)',
            }}
          >
            <Download className="h-4 w-4" strokeWidth={2} />
            {t('softwareUpdater.updateSelectedButton', { count: selectedCount })}
          </button>
        </div>
      )}

      {/* Empty state — before first check */}
      {!hasChecked && !loading && (
        <EmptyState
          icon={RefreshCw}
          title={t('softwareUpdater.emptyStateTitle')}
          description={t('softwareUpdater.emptyStateDescription')}
          action={
            <button
              onClick={handleCheck}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'var(--text-on-accent)',
              }}
              type="button"
            >
              <RefreshCw className="h-4 w-4" strokeWidth={2} />
              {t('softwareUpdater.checkForUpdatesButton')}
            </button>
          }
        />
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-amber-400 mb-4" strokeWidth={1.5} />
          <p className="text-[13px] text-zinc-400">{t('softwareUpdater.checkingForUpdates')}</p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('softwareUpdater.checkingSubtext')}
          </p>
        </div>
      )}

      {/* All up to date */}
      {hasChecked && !loading && apps.length === 0 && ignoredApps.length === 0 && packageManagerAvailable && (
        <EmptyState
          icon={Sparkles}
          title={t('softwareUpdater.allUpToDateTitle')}
          description={t('softwareUpdater.allUpToDateDescription')}
        />
      )}

      {/* No results from filter/search */}
      {hasChecked && !loading && filteredApps.length === 0 && apps.length > 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <Search className="h-10 w-10 text-zinc-600 mb-4" strokeWidth={1.5} />
          <p className="text-[13px] text-zinc-400">{t('softwareUpdater.noAppsMatchFilters')}</p>
        </div>
      )}

      {/* App list */}
      {hasChecked && !loading && filteredApps.length > 0 && (
        <div className="mb-6">
          <div className="grid grid-cols-1 gap-2">
            {filteredApps.map((app) => (
              <AppRow
                key={app.id}
                app={app}
                updating={updating}
                onToggle={() => useUpdaterStore.getState().toggleAppSelected(app.id)}
                onUpdate={() => handleUpdate([app.id])}
                onIgnore={() => useUpdaterStore.getState().ignoreApp(app.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Ignored apps */}
      {hasChecked && !loading && ignoredApps.length > 0 && (
        <div className="mb-6">
          <button
            type="button"
            onClick={() => setShowIgnored(!showIgnored)}
            className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            {showIgnored ? (
              <ChevronDown className="h-4 w-4" strokeWidth={2} />
            ) : (
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            )}
            <EyeOff className="h-4 w-4 text-zinc-500" strokeWidth={1.8} />
            {t('softwareUpdater.ignoredSection', { count: ignoredApps.length })}
          </button>

          {showIgnored && (
            <div className="grid grid-cols-1 gap-1.5">
              {ignoredApps.map((app) => (
                <IgnoredRow key={app.id} app={app} onUnignore={() => useUpdaterStore.getState().unignoreApp(app.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Up to date apps */}
      {hasChecked && !loading && packageManagerAvailable && upToDate.length > 0 && (
        <div className="mb-6">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-zinc-500">
            <CircleCheckBig className="h-4 w-4 text-green-500" strokeWidth={1.8} />
            {t('softwareUpdater.upToDateSection', { count: upToDate.length })}
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            {upToDate.map((app) => (
              <UpToDateRow key={app.id} app={app} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
