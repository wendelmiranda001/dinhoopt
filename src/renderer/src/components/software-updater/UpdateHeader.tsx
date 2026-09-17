import { ArrowUpDown, ChevronDown, CircleCheckBig, Filter, Loader2, RefreshCw, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OutsideClickHandler } from '@/components/shared/OutsideClickHandler'
import { FILTER_LABEL_KEYS, SORT_LABEL_KEYS } from '@/pages/software-updater/updater-constants'
import { type SeverityFilter, type SortField, useUpdaterStore } from '@/stores/updater-store'

export interface UpdateHeaderProps {
  isBusy: boolean
  loading: boolean
  hasChecked: boolean
  appsCount: number
  searchQuery: string
  severityFilter: SeverityFilter
  sortField: SortField
  sortDirection: 'asc' | 'desc'
  onCheck: () => void
}

export function UpdateHeader({
  isBusy,
  loading,
  hasChecked,
  appsCount,
  searchQuery,
  severityFilter,
  sortField,
  sortDirection,
  onCheck,
}: UpdateHeaderProps) {
  const { t } = useTranslation('updates')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showFilterMenu, setShowFilterMenu] = useState(false)

  return (
    <div className="mb-5 flex items-center gap-2.5">
      <button
        onClick={onCheck}
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

      {hasChecked && appsCount > 0 && (
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

      {hasChecked && appsCount > 0 && (
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
            {t(FILTER_LABEL_KEYS[severityFilter] ?? 'softwareUpdater.filterAll')}
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

      {hasChecked && appsCount > 0 && (
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
            {t(SORT_LABEL_KEYS[sortField] ?? 'softwareUpdater.sortName')}
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
  )
}
