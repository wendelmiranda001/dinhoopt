import type { FirewallAction, FirewallScanProgress } from '@shared/types'
import {
  CircleCheckBig,
  FileWarning,
  FileX,
  Globe,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldOff,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { Checkbox } from '@/components/shared/Checkbox'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { useIpcAction } from '@/hooks/useIpcAction'
import { useIpcScan } from '@/hooks/useIpcScan'
import { useProgressListener } from '@/hooks/useProgressListener'
import { useFirewallStore } from '@/stores/firewall-store'

import { FilterSelect, RISK_COLORS, RuleRow, StatBox } from './firewall/FirewallComponents'

export function FirewallAuditPage() {
  const rules = useFirewallStore((s) => s.rules)
  const scanning = useFirewallStore((s) => s.scanning)
  const applying = useFirewallStore((s) => s.applying)
  const scanProgress = useFirewallStore((s) => s.scanProgress)
  const applyResult = useFirewallStore((s) => s.applyResult)
  const error = useFirewallStore((s) => s.error)
  const hasScanned = useFirewallStore((s) => s.hasScanned)
  const searchQuery = useFirewallStore((s) => s.searchQuery)
  const riskFilter = useFirewallStore((s) => s.riskFilter)
  const programFilter = useFirewallStore((s) => s.programFilter)
  const showBuiltin = useFirewallStore((s) => s.showBuiltin)

  const { t } = useTranslation('firewall')
  const tRule = useCallback(
    (key: string, options?: Record<string, unknown>): string => (options ? t(key, options) : t(key)),
    [t],
  )
  const [pendingAction, setPendingAction] = useState<FirewallAction | null>(null)
  const isBusy = scanning || applying

  useProgressListener(window.dinho.onFirewallProgress, (data: FirewallScanProgress) =>
    useFirewallStore.getState().setScanProgress(data),
  )

  const { scan: handleScan } = useIpcScan({
    scanFn: () => window.dinho.firewallScan(),
    setLoading: (v) => useFirewallStore.getState().setScanning(v),
    resetState: () => {
      const s = useFirewallStore.getState()
      s.setRules([])
      s.setApplyResult(null)
      s.setError(null)
      s.setScanProgress(null)
    },
    onResult: (result) => {
      const s = useFirewallStore.getState()
      s.setRules(result.rules)
      s.setHasScanned(true)
    },
    onError: (err) => {
      useFirewallStore.getState().setError(err instanceof Error ? err.message : t('scanFailed'))
    },
  })

  // Auto-scan on first visit
  const autoScannedRef = useRef(false)
  if (!autoScannedRef.current && !hasScanned && !scanning) {
    autoScannedRef.current = true
    queueMicrotask(() => {
      handleScan()
    })
  }

  const { execute: handleApply } = useIpcAction({
    actionFn: async (action: FirewallAction) => {
      const store = useFirewallStore.getState()
      const selected = store.rules.filter((r) => r.selected)
      if (selected.length === 0) return undefined
      const result = await window.dinho.firewallApply(selected.map((r) => ({ name: r.name, action })))
      return { result, selected, action }
    },
    setLoading: (v) => useFirewallStore.getState().setApplying(v),
    onStart: () => {
      setPendingAction(null)
      useFirewallStore.getState().setApplyResult(null)
      useFirewallStore.getState().setError(null)
    },
    onResult: (payload) => {
      if (!payload) return
      const { result, selected, action } = payload
      useFirewallStore.getState().setApplyResult(result)
      if (result.succeeded > 0) {
        toast.success(
          action === 'delete'
            ? t('rulesDeleted', { count: result.succeeded })
            : t('rulesDisabled', { count: result.succeeded }),
        )
      }
      if (result.failed > 0) toast.error(t('rulesFailed', { count: result.failed }))
      const failedNames = new Set(result.errors.map((e: { name: string }) => e.name).filter(Boolean))
      const requestedNames = new Set(selected.map((r) => r.name))
      useFirewallStore
        .getState()
        .setRules(
          useFirewallStore.getState().rules.filter((r) => !requestedNames.has(r.name) || failedNames.has(r.name)),
        )
    },
    onError: (err) => {
      toast.error(t('updateFailed'))
      useFirewallStore.getState().setError(err instanceof Error ? err.message : t('applyFailed'))
    },
  })

  const handleSelectStale = useCallback(() => {
    useFirewallStore.getState().selectRecommended()
  }, [])

  const filteredRules = useMemo(() => {
    let result = rules

    // Built-in / Microsoft / AppX rules are hidden by default. Stale built-ins
    // are still surfaced because a leftover rule pointing at a removed Windows
    // feature is genuinely worth cleaning up — toggle handles only the noise.
    if (!showBuiltin) result = result.filter((r) => !r.builtin || r.issues.includes('stale'))

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.displayName.toLowerCase().includes(q) ||
          r.group.toLowerCase().includes(q) ||
          r.programResolved.toLowerCase().includes(q),
      )
    }
    if (riskFilter !== 'all') result = result.filter((r) => r.risk === riskFilter)
    if (programFilter === 'with-program') result = result.filter((r) => !!r.programResolved)
    else if (programFilter === 'no-program') result = result.filter((r) => !r.programResolved)
    else if (programFilter === 'stale') result = result.filter((r) => r.issues.includes('stale'))

    return result
  }, [rules, searchQuery, riskFilter, programFilter, showBuiltin])

  const builtinCount = useMemo(() => rules.filter((r) => r.builtin && !r.issues.includes('stale')).length, [rules])

  const selectedCount = rules.filter((r) => r.selected).length
  const staleCount = rules.filter((r) => r.issues.includes('stale')).length
  const unsignedCount = rules.filter((r) => r.issues.includes('unsigned')).length
  const broadScopeCount = rules.filter((r) => r.issues.includes('broad-scope')).length

  const riskGroups = useMemo(() => {
    const groups: { key: 'high' | 'medium' | 'low'; label: string; rules: typeof filteredRules }[] = [
      { key: 'high', label: t('riskHigh'), rules: filteredRules.filter((r) => r.risk === 'high') },
      { key: 'medium', label: t('riskMedium'), rules: filteredRules.filter((r) => r.risk === 'medium') },
      { key: 'low', label: t('riskLow'), rules: filteredRules.filter((r) => r.risk === 'low') },
    ]
    return groups.filter((g) => g.rules.length > 0)
  }, [filteredRules, t])

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} />

      {/* Action bar */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleScan}
          disabled={isBusy}
          className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white transition-all"
          style={{ background: isBusy ? '#27272a' : 'var(--accent)', opacity: isBusy ? 0.5 : 1 }}
        >
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" strokeWidth={2} />}
          {scanning ? t('scanningButton') : t('scanButton')}
        </button>

        {hasScanned && (
          <>
            <button
              type="button"
              onClick={handleSelectStale}
              disabled={isBusy || staleCount === 0}
              className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-medium transition-all"
              style={{
                background: 'rgba(34,197,94,0.10)',
                color: '#22c55e',
                border: '1px solid rgba(34,197,94,0.20)',
                opacity: isBusy || staleCount === 0 ? 0.5 : 1,
              }}
            >
              <Sparkles className="h-4 w-4" strokeWidth={2} />
              {t('selectStale', { count: staleCount })}
            </button>

            <button
              type="button"
              onClick={() => setPendingAction('disable')}
              disabled={isBusy || selectedCount === 0}
              className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white transition-all"
              style={{
                background: selectedCount > 0 && !isBusy ? '#f59e0b' : '#27272a',
                opacity: isBusy || selectedCount === 0 ? 0.5 : 1,
              }}
            >
              {applying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldOff className="h-4 w-4" strokeWidth={2} />
              )}
              {t('disableSelected', { count: selectedCount })}
            </button>

            <button
              type="button"
              onClick={() => setPendingAction('delete')}
              disabled={isBusy || selectedCount === 0}
              className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white transition-all"
              style={{
                background: selectedCount > 0 && !isBusy ? '#dc2626' : '#27272a',
                opacity: isBusy || selectedCount === 0 ? 0.5 : 1,
              }}
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
              {t('deleteSelected')}
            </button>
          </>
        )}
      </div>

      {/* Stats banner */}
      {hasScanned && rules.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBox label={t('statTotalInbound')} value={rules.length} icon={Inbox} color="var(--text-muted)" />
          <StatBox label={t('statStaleProgram')} value={staleCount} icon={FileX} color="#ef4444" />
          <StatBox label={t('statUnsigned')} value={unsignedCount} icon={FileWarning} color="#f59e0b" />
          <StatBox label={t('statBroadScope')} value={broadScopeCount} icon={Globe} color="#ef4444" />
        </div>
      )}

      {error && (
        <ErrorAlert message={error} onDismiss={() => useFirewallStore.getState().setError(null)} className="mb-5" />
      )}

      {scanning && scanProgress && (
        <div
          className="mb-5 rounded-xl p-4"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)' }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12.5px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              {scanProgress.phase === 'enumerating'
                ? t('scanPhaseEnumerating')
                : scanProgress.phase === 'classifying'
                  ? t('scanPhaseClassifying')
                  : t('scanPhaseVerifying')}
            </span>
            {scanProgress.total > 0 && (
              <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {scanProgress.current} / {scanProgress.total}
              </span>
            )}
          </div>
          {scanProgress.total > 0 && (
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: '#27272a' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  background: 'var(--accent)',
                  width: `${Math.round((scanProgress.current / scanProgress.total) * 100)}%`,
                }}
              />
            </div>
          )}
          <div className="mt-1.5 truncate text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            {scanProgress.currentRule}
          </div>
        </div>
      )}

      {applyResult && (
        <div
          className="mb-5 rounded-xl p-4"
          style={{
            background: applyResult.failed > 0 ? 'rgba(245,158,11,0.06)' : 'rgba(34,197,94,0.06)',
            border: `1px solid ${applyResult.failed > 0 ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)'}`,
          }}
        >
          <div className="flex items-center gap-2">
            {applyResult.failed > 0 ? (
              <TriangleAlert className="h-4 w-4" style={{ color: '#f59e0b' }} />
            ) : (
              <CircleCheckBig className="h-4 w-4" style={{ color: '#22c55e' }} />
            )}
            <span className="text-[13px] font-medium text-white">
              {t('resultSucceeded', { count: applyResult.succeeded })}
              {applyResult.failed > 0 && t('resultFailed', { count: applyResult.failed })}
            </span>
          </div>
          {applyResult.errors.length > 0 && (
            <div className="mt-2 space-y-1">
              {applyResult.errors.map((e, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: same rule name can fail multiple times — index disambiguates
                  key={`${e.name || e.displayName}-${i}`}
                  className="text-[11.5px]"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {e.displayName || e.name}: {e.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!hasScanned && !scanning && (
        <EmptyState
          icon={ShieldAlert}
          title={t('emptyStateTitle')}
          description={t('emptyStateDescription')}
          action={
            <button
              type="button"
              onClick={handleScan}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'var(--text-on-accent)',
              }}
            >
              <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
              {t('emptyStateAction')}
            </button>
          }
        />
      )}

      {hasScanned && rules.length > 0 && (
        <>
          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px]">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                style={{ color: 'var(--text-muted)' }}
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => useFirewallStore.getState().setSearchQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="w-full rounded-lg border-0 px-3 py-2 pl-9 text-[13px] outline-none"
                style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
            <FilterSelect
              value={riskFilter}
              onChange={(v) => useFirewallStore.getState().setRiskFilter(v as 'all' | 'high' | 'medium' | 'low')}
              options={[
                { value: 'all', label: t('filterAllRisk') },
                { value: 'high', label: t('filterHighRisk') },
                { value: 'medium', label: t('filterMediumRisk') },
                { value: 'low', label: t('filterLowRisk') },
              ]}
            />
            <FilterSelect
              value={programFilter}
              onChange={(v) =>
                useFirewallStore.getState().setProgramFilter(v as 'all' | 'with-program' | 'no-program' | 'stale')
              }
              options={[
                { value: 'all', label: t('filterAllRules') },
                { value: 'with-program', label: t('filterWithProgram') },
                { value: 'no-program', label: t('filterNoProgram') },
                { value: 'stale', label: t('filterStale') },
              ]}
            />
            {builtinCount > 0 && (
              <div
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[13px]"
                style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-secondary)',
                }}
                title={t('builtinTitle', { count: builtinCount })}
              >
                <Checkbox
                  checked={showBuiltin}
                  onChange={() => useFirewallStore.getState().setShowBuiltin(!showBuiltin)}
                  size="sm"
                />
                <span
                  onClick={() => useFirewallStore.getState().setShowBuiltin(!showBuiltin)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      useFirewallStore.getState().setShowBuiltin(!showBuiltin)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  {t('showBuiltin', { count: builtinCount })}
                </span>
              </div>
            )}
          </div>

          {filteredRules.length === 0 ? (
            <EmptyState icon={Search} title={t('noRulesTitle')} description={t('noRulesDescription')} />
          ) : (
            <div className="space-y-6">
              {riskGroups.map((group) => (
                <div key={group.key}>
                  <div className="mb-2 flex items-center gap-2">
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{ background: RISK_COLORS[group.key].dot }}
                      aria-hidden="true"
                    />
                    <h3
                      className="text-[12px] font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {group.label}
                    </h3>
                    <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                      {group.rules.length}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {group.rules.map((r) => (
                      <RuleRow key={r.name} rule={r} t={tRule} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={pendingAction !== null}
        onConfirm={() => pendingAction && handleApply(pendingAction)}
        onCancel={() => setPendingAction(null)}
        title={pendingAction === 'delete' ? t('confirmDeleteTitle') : t('confirmDisableTitle')}
        description={
          pendingAction === 'delete'
            ? t('confirmDeleteDescription', { count: selectedCount })
            : t('confirmDisableDescription', { count: selectedCount })
        }
        variant={pendingAction === 'delete' ? 'danger' : 'warning'}
        confirmLabel={pendingAction === 'delete' ? t('confirmDeleteLabel') : t('confirmDisableLabel')}
      />
    </div>
  )
}
