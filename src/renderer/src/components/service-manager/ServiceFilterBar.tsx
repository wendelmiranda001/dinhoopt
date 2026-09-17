import type { ServiceCategory, ServiceSafety } from '@shared/types'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CATEGORY_LABEL_KEYS } from '@/pages/service-manager/ServiceManagerComponents'
import { useServiceStore } from '@/stores/service-store'
import { FilterDropdown } from './ServiceManagerRows'

interface ServiceFilterBarProps {
  searchQuery: string
  safetyFilter: string
  categoryFilter: string
  statusFilter: string
  presentCategories: Set<ServiceCategory>
}

export function ServiceFilterBar({
  searchQuery,
  safetyFilter,
  categoryFilter,
  statusFilter,
  presentCategories,
}: ServiceFilterBarProps) {
  const { t } = useTranslation('hardening')

  return (
    <div className="mb-4 flex items-center gap-3">
      <div
        className="flex flex-1 items-center gap-2 rounded-lg px-3 py-2"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)' }}
      >
        <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} strokeWidth={1.8} />
        <input
          type="text"
          placeholder={t('serviceManager.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => useServiceStore.getState().setSearchQuery(e.target.value)}
          className="w-full bg-transparent text-[13px] text-white placeholder-zinc-600 outline-none"
        />
      </div>

      <FilterDropdown
        value={safetyFilter}
        options={[
          { value: 'all', label: t('serviceManager.filterAllSafety') },
          { value: 'safe', label: t('serviceManager.filterSafe') },
          { value: 'caution', label: t('serviceManager.filterCaution') },
          { value: 'unsafe', label: t('serviceManager.filterUnsafe') },
        ]}
        onChange={(v) => useServiceStore.getState().setSafetyFilter(v as 'all' | ServiceSafety)}
      />

      <FilterDropdown
        value={categoryFilter}
        options={[
          { value: 'all', label: t('serviceManager.filterAllCategories') },
          ...Array.from(presentCategories)
            .sort()
            .map((c) => ({ value: c, label: t(CATEGORY_LABEL_KEYS[c]) || c })),
        ]}
        onChange={(v) => useServiceStore.getState().setCategoryFilter(v as 'all' | ServiceCategory)}
      />

      <FilterDropdown
        value={statusFilter}
        options={[
          { value: 'all', label: t('serviceManager.filterAllStatus') },
          { value: 'running', label: t('serviceManager.filterRunning') },
          { value: 'stopped', label: t('serviceManager.filterStopped') },
          { value: 'disabled', label: t('serviceManager.filterDisabled') },
        ]}
        onChange={(v) => useServiceStore.getState().setStatusFilter(v as 'all' | 'running' | 'stopped' | 'disabled')}
      />
    </div>
  )
}
