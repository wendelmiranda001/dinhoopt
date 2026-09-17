import { CircleCheckBig, Eye, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ElevationBanner } from '@/components/cleaner/ElevationBanner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { useIpcScan } from '@/hooks/useIpcScan'
import { useProgressListener } from '@/hooks/useProgressListener'
import logger from '@/lib/renderer-logger'
import { cn } from '@/lib/utils'
import { useHistoryStore } from '@/stores/history-store'
import { usePrivacyStore } from '@/stores/privacy-store'
import { categories, ScoreRing } from './privacy/PrivacyShieldComponents'

export function PrivacyShieldPage({ embedded }: { embedded?: boolean }) {
  const { t } = useTranslation('hardening')
  const state = usePrivacyStore((s) => s.state)
  const status = usePrivacyStore((s) => s.status)
  const applyResult = usePrivacyStore((s) => s.applyResult)
  const expandedCategories = usePrivacyStore((s) => s.expandedCategories)
  const progress = usePrivacyStore((s) => s.progress)
  useProgressListener(window.dinho.onPrivacyProgress, (data) => usePrivacyStore.getState().setProgress(data))

  const { scan: handleScan } = useIpcScan({
    scanFn: () => window.dinho.privacyScan(),
    setLoading: (v) => usePrivacyStore.getState().setStatus(v ? 'scanning' : 'done'),
    resetState: () => {
      const s = usePrivacyStore.getState()
      s.setApplyResult(null)
      s.setProgress(null)
    },
    onResult: (result) => {
      const s = usePrivacyStore.getState()
      s.setState(result)
      const unprotected = new Set<string>()
      for (const setting of result.settings) {
        if (!setting.enabled) unprotected.add(setting.category)
      }
      s.setExpandedCategories(unprotected)
    },
    onError: () => {
      usePrivacyStore.getState().setStatus('idle')
    },
  })

  // Auto-scan on first visit (empty state)
  const autoScannedRef = useRef(false)
  if (!autoScannedRef.current) {
    const s = usePrivacyStore.getState()
    if (s.status === 'idle' && !s.state) {
      autoScannedRef.current = true
      queueMicrotask(() => {
        handleScan()
      })
    }
  }

  const handleApplyAll = useCallback(async () => {
    const store = usePrivacyStore.getState()
    if (!store.state) return
    const unprotectedIds = store.state.settings.filter((s) => !s.enabled).map((s) => s.id)
    if (unprotectedIds.length === 0) return

    const startTime = Date.now()
    store.setStatus('applying')
    store.setApplyResult(null)
    try {
      const result = await window.dinho.privacyApply(unprotectedIds)
      usePrivacyStore.getState().setApplyResult(result)
      const updated = await window.dinho.privacyScan()
      usePrivacyStore.getState().setState(updated)
      usePrivacyStore.getState().setStatus('done')

      const catMap: Record<string, { found: number; applied: number }> = {}
      for (const id of unprotectedIds) {
        const setting = store.state!.settings.find((s) => s.id === id)
        if (setting) {
          if (!catMap[setting.category]) catMap[setting.category] = { found: 0, applied: 0 }
          const cat = catMap[setting.category]
          if (cat) cat.found++
        }
      }
      const failedIds = new Set(result.errors.map((e) => e.id))
      for (const id of unprotectedIds) {
        const setting = store.state!.settings.find((s) => s.id === id)
        if (setting && !failedIds.has(id)) {
          const cat = catMap[setting.category]
          if (cat) cat.applied++
        }
      }
      await useHistoryStore.getState().addEntry({
        id: Date.now().toString(),
        type: 'privacy',
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        totalItemsFound: unprotectedIds.length,
        totalItemsCleaned: result.succeeded,
        totalItemsSkipped: 0,
        totalSpaceSaved: 0,
        categories: Object.entries(catMap).map(([name, d]) => ({
          name,
          itemsFound: d.found,
          itemsCleaned: d.applied,
          spaceSaved: 0,
        })),
        errorCount: result.failed,
      })
    } catch (err) {
      logger.error('PrivacyShieldPage', 'Privacy apply failed', err)
      usePrivacyStore.getState().setApplyResult({
        succeeded: 0,
        failed: unprotectedIds.length,
        skipped: 0,
        errors: [{ id: '', label: t('privacy.allSettingsLabel'), reason: t('privacy.ipcCallFailed') }],
      })
      usePrivacyStore.getState().setStatus('done')
    }
  }, [t])

  const handleApplyCategory = useCallback(
    async (categoryId: string) => {
      const store = usePrivacyStore.getState()
      if (!store.state) return
      const ids = store.state.settings.filter((s) => s.category === categoryId && !s.enabled).map((s) => s.id)
      if (ids.length === 0) return

      const startTime = Date.now()
      store.setStatus('applying')
      store.setApplyResult(null)
      try {
        const result = await window.dinho.privacyApply(ids)
        usePrivacyStore.getState().setApplyResult(result)
        const updated = await window.dinho.privacyScan()
        usePrivacyStore.getState().setState(updated)
        usePrivacyStore.getState().setStatus('done')
        if (result.succeeded > 0)
          toast.success(
            t(result.succeeded > 1 ? 'privacy.settingsAppliedToastPlural' : 'privacy.settingsAppliedToast', {
              count: result.succeeded,
            }),
          )
        if (result.failed > 0)
          toast.error(
            t(result.failed > 1 ? 'privacy.settingsFailedToastPlural' : 'privacy.settingsFailedToast', {
              count: result.failed,
            }),
          )

        await useHistoryStore.getState().addEntry({
          id: Date.now().toString(),
          type: 'privacy',
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
          totalItemsFound: ids.length,
          totalItemsCleaned: result.succeeded,
          totalItemsSkipped: 0,
          totalSpaceSaved: 0,
          categories: [{ name: categoryId, itemsFound: ids.length, itemsCleaned: result.succeeded, spaceSaved: 0 }],
          errorCount: result.failed,
        })
      } catch (err) {
        logger.error('PrivacyShieldPage', 'Privacy apply failed', err)
        toast.error(t('privacy.applyFailed'), { description: t('privacy.applyFailedDescription') })
        usePrivacyStore.getState().setApplyResult({
          succeeded: 0,
          failed: ids.length,
          skipped: 0,
          errors: [{ id: '', label: categoryId, reason: t('privacy.ipcCallFailed') }],
        })
        usePrivacyStore.getState().setStatus('done')
      }
    },
    [t],
  )

  const handleToggleSingle = useCallback(
    async (settingId: string) => {
      const store = usePrivacyStore.getState()
      if (!store.state) return
      const setting = store.state.settings.find((s) => s.id === settingId)
      if (!setting) return

      const wasEnabled = setting.enabled
      const isEnabling = !wasEnabled
      store.setStatus('applying')
      try {
        const result = isEnabling
          ? await window.dinho.privacyApply([settingId])
          : await window.dinho.privacyRevert([settingId])
        const updated = await window.dinho.privacyScan()
        usePrivacyStore.getState().setState(updated)
        usePrivacyStore.getState().setStatus('done')

        const newSetting = updated.settings.find((s) => s.id === settingId)
        const actuallyChanged = newSetting != null && newSetting.enabled !== wasEnabled

        if (result.failed > 0) {
          const reason = result.errors[0]?.reason || t('privacy.unknownError')
          toast.error(
            t(isEnabling ? 'privacy.settingApplyFailed' : 'privacy.settingRevertFailed', { label: setting.label }),
            { description: reason },
          )
        } else if (!actuallyChanged) {
          toast.error(
            t(isEnabling ? 'privacy.settingApplyFailed' : 'privacy.settingRevertFailed', { label: setting.label }),
            { description: t('privacy.adminRequired') },
          )
        } else {
          toast.success(
            t(newSetting.enabled ? 'privacy.settingEnabled' : 'privacy.settingDisabled', { label: setting.label }),
          )
        }
      } catch {
        toast.error(t(isEnabling ? 'privacy.settingApplyFailedGeneric' : 'privacy.settingRevertFailedGeneric'))
        usePrivacyStore.getState().setStatus('done')
      }
    },
    [t],
  )

  const isScanning = status === 'scanning'
  const isApplying = status === 'applying'
  const busy = isScanning || isApplying
  const unprotectedCount = state ? state.total - state.protected : 0
  const requiresAdminForFixes = useMemo(
    () => (state ? state.settings.some((s) => !s.enabled && s.requiresAdmin) : false),
    [state],
  )

  const headerAction = (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={handleScan}
        disabled={busy}
        className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
        style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
      >
        <Eye className="h-4 w-4" strokeWidth={1.8} />
        {t('privacy.scanButton')}
      </button>
      {state && unprotectedCount > 0 && (
        <button
          type="button"
          onClick={handleApplyAll}
          disabled={busy}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
          style={{
            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            color: '#fff',
            boxShadow: '0 4px 20px rgba(34,197,94,0.2)',
          }}
        >
          <ShieldCheck className="h-4 w-4" strokeWidth={2} />
          {t('privacy.protectAllButton', { count: unprotectedCount })}
        </button>
      )}
    </div>
  )

  return (
    <div className={embedded ? '' : 'animate-fade-in'}>
      {!embedded && (
        <PageHeader title={t('privacy.pageTitle')} description={t('privacy.pageDescription')} action={headerAction} />
      )}
      {embedded && <div className="mb-5 flex justify-end">{headerAction}</div>}

      {/* Score + stats cards */}
      {state && !isScanning && (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div
            className="rounded-2xl p-5 flex items-center gap-5"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
          >
            <ScoreRing score={state.score} />
            <div>
              <p className="text-[14px] font-semibold text-zinc-200">{t('privacy.privacyScore')}</p>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {state.score >= 80
                  ? t('privacy.scoreWellProtected')
                  : state.score >= 50
                    ? t('privacy.scoreNeedsImprovement')
                    : t('privacy.scoreAtRisk')}
              </p>
            </div>
          </div>

          <div
            className="rounded-2xl p-5"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
          >
            <div className="flex items-center gap-2 mb-2">
              {unprotectedCount === 0 ? (
                <ShieldCheck className="h-5 w-5 text-green-500" strokeWidth={1.8} />
              ) : (
                <ShieldAlert className="h-5 w-5 text-amber-500" strokeWidth={1.8} />
              )}
              <span className="text-[13px] font-medium text-zinc-200">
                {unprotectedCount === 0
                  ? t('privacy.fullyProtected')
                  : t('privacy.unprotectedCount', { count: unprotectedCount })}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover-2)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${(state.protected / state.total) * 100}%`,
                    background: state.score >= 80 ? '#22c55e' : state.score >= 50 ? '#f59e0b' : '#ef4444',
                  }}
                />
              </div>
              <span className="text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>
                {state.protected}/{state.total}
              </span>
            </div>
          </div>

          <div
            className="rounded-2xl p-5"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
          >
            <p className="text-[11px] font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
              {t('privacy.categoriesLabel')}
            </p>
            <div className="space-y-1.5">
              {categories.map((cat) => {
                const catSettings = state.settings.filter((s) => s.category === cat.id)
                if (catSettings.length === 0) return null
                const protectedInCat = catSettings.filter((s) => s.enabled).length
                const allGood = protectedInCat === catSettings.length
                return (
                  <div key={cat.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: allGood ? '#22c55e' : cat.color }}
                      />
                      <span className="text-[11px] text-zinc-400">{t(cat.labelKey).split(' ')[0]}</span>
                    </div>
                    <span
                      className="text-[11px] font-mono"
                      style={{ color: allGood ? '#22c55e' : 'var(--text-muted)' }}
                    >
                      {protectedInCat}/{catSettings.length}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Scanning progress */}
      {isScanning && (
        <div
          className="mb-5 rounded-2xl p-5"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-green-400 border-t-transparent" />
            <span className="text-[13px] font-medium text-zinc-200">
              {progress
                ? t('privacy.scanProgressChecking', { label: progress.currentLabel })
                : t('privacy.scanProgressPreparing')}
            </span>
            {progress && (
              <span className="ml-auto text-[12px] font-mono text-zinc-500">
                {progress.current} / {progress.total}
              </span>
            )}
          </div>

          <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: 'var(--bg-hover-2)' }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress ? (progress.current / progress.total) * 100 : 0}%`,
                background: 'linear-gradient(90deg, #22c55e, #16a34a)',
              }}
            />
          </div>

          {progress && (
            <div className="flex flex-wrap gap-1.5">
              {categories.map((cat) => {
                const catLabel = t(cat.labelKey).split(' ')[0]
                const isCurrent = progress.category === cat.id
                const catIdx = categories.findIndex((c) => c.id === cat.id)
                const currentCatIdx = categories.findIndex((c) => c.id === progress.category)
                const isDone = catIdx < currentCatIdx

                return (
                  <div
                    key={cat.id}
                    className="flex items-center gap-1 rounded-md px-2 py-1"
                    style={{
                      background: isCurrent
                        ? 'rgba(34,197,94,0.1)'
                        : isDone
                          ? 'rgba(34,197,94,0.06)'
                          : 'var(--bg-subtle)',
                      border: `1px solid ${isCurrent ? 'rgba(34,197,94,0.2)' : isDone ? 'rgba(34,197,94,0.1)' : 'var(--border-subtle)'}`,
                    }}
                  >
                    {isDone ? (
                      <CircleCheckBig className="h-3 w-3 text-green-500" strokeWidth={2} />
                    ) : isCurrent ? (
                      <div className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-green-400 border-t-transparent" />
                    ) : (
                      <div className="h-3 w-3 rounded-full" style={{ background: 'var(--bg-active)' }} />
                    )}
                    <span
                      className="text-[10px] font-medium"
                      style={{ color: isCurrent ? '#4ade80' : isDone ? '#4ade80' : 'var(--text-muted)' }}
                    >
                      {catLabel}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Applying state */}
      {isApplying && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <Loader2 className="h-4 w-4 animate-spin text-green-400" />
          <span className="text-[13px] text-zinc-400">{t('privacy.applyingProtections')}</span>
        </div>
      )}

      {/* Apply result */}
      {applyResult && status === 'done' && (
        <div
          className="mb-5 rounded-2xl p-4"
          style={{
            background: applyResult.failed > 0 ? 'rgba(245,158,11,0.04)' : 'rgba(34,197,94,0.06)',
            border: `1px solid ${applyResult.failed > 0 ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)'}`,
          }}
        >
          <div className="flex items-center gap-3">
            <CircleCheckBig className="h-5 w-5 text-green-500 shrink-0" strokeWidth={1.8} />
            <div>
              <p className="text-[13px] font-medium text-zinc-200">
                {t(applyResult.succeeded !== 1 ? 'privacy.settingsAppliedPlural' : 'privacy.settingsApplied', {
                  count: applyResult.succeeded,
                })}
              </p>
              {applyResult.failed > 0 && (
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--accent)' }}>
                  {t('privacy.settingsFailedRequireAdmin', { count: applyResult.failed })}
                </p>
              )}
            </div>
          </div>
          {applyResult.errors.length > 0 && (
            <div className="mt-3 ml-8 space-y-1">
              {applyResult.errors.map((err) => (
                <p key={err.id} className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                  {err.label}: {err.reason}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!state && !isScanning && (
        <EmptyState
          icon={Eye}
          title={t('privacy.emptyStateTitle')}
          description={t('privacy.emptyStateDescription')}
          showLastScan
          lastScanType="privacy"
        />
      )}

      {/* Category cards */}
      {state && !isScanning && (
        <div className="space-y-3">
          {categories.map((cat) => {
            const catSettings = state.settings.filter((s) => s.category === cat.id)
            if (catSettings.length === 0) return null

            const protectedInCat = catSettings.filter((s) => s.enabled).length
            const allProtected = protectedInCat === catSettings.length
            const isExpanded = expandedCategories.has(cat.id)
            const unprotectedInCat = catSettings.length - protectedInCat
            const CatIcon = cat.icon

            return (
              <div
                key={cat.id}
                className="overflow-hidden rounded-2xl"
                style={{
                  border: `1px solid ${allProtected ? 'rgba(34,197,94,0.15)' : cat.border}`,
                  opacity: isApplying ? 0.5 : 1,
                  pointerEvents: isApplying ? 'none' : 'auto',
                }}
              >
                <button
                  type="button"
                  onClick={() => usePrivacyStore.getState().toggleCategory(cat.id)}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors"
                  style={{ background: allProtected ? 'rgba(34,197,94,0.03)' : 'var(--bg-subtle)' }}
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: allProtected ? 'rgba(34,197,94,0.1)' : cat.bg }}
                  >
                    <CatIcon
                      className="h-5 w-5"
                      style={{ color: allProtected ? '#22c55e' : cat.color }}
                      strokeWidth={1.8}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[14px] font-semibold text-zinc-200">{t(cat.labelKey)}</span>
                      {allProtected ? (
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}
                        >
                          {t('privacy.allProtectedBadge')}
                        </span>
                      ) : (
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{ background: cat.bg, color: cat.color }}
                        >
                          {t('privacy.unprotectedBadge', { count: unprotectedInCat })}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-dim)' }}>
                      {t(cat.descriptionKey)}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {!allProtected && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleApplyCategory(cat.id)
                        }}
                        disabled={busy}
                        className="rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40"
                        style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}
                      >
                        {t('privacy.protectAllCategoryButton')}
                      </button>
                    )}
                    {allProtected && (
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded-full"
                        style={{ background: 'rgba(34,197,94,0.1)' }}
                      >
                        <CircleCheckBig className="h-4 w-4 text-green-500" strokeWidth={2.5} />
                      </div>
                    )}
                    <div
                      className={cn('h-5 w-5 transition-transform', isExpanded ? 'rotate-180' : 'rotate-0')}
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" role="img" aria-label={t('expandAria')}>
                        <title>{t('expandAria')}</title>
                        <path
                          fillRule="evenodd"
                          d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    {catSettings.map((setting, i) => {
                      const depSetting = setting.dependsOn
                        ? state?.settings.find((s) => s.id === setting.dependsOn)
                        : undefined
                      const depMissing = depSetting !== undefined && !depSetting.enabled
                      const toggleDisabled = busy || depMissing || (setting.enabled && !setting.reversible)

                      return (
                        <div
                          key={setting.id}
                          className="flex items-center gap-4 px-5 py-3.5"
                          style={{
                            borderBottom: i < catSettings.length - 1 ? '1px solid var(--bg-subtle)' : 'none',
                          }}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-zinc-300">{setting.label}</span>
                              {setting.requiresAdmin && (
                                <span
                                  className="rounded px-1 py-0.5 text-[9px] font-semibold uppercase"
                                  style={{ background: 'var(--accent-muted-bg)', color: 'var(--accent)' }}
                                >
                                  {t('privacy.adminBadge')}
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-dim)' }}>
                              {t(`privacy.descriptions.${setting.id}`, setting.description)}
                            </p>
                            {depMissing && depSetting && (
                              <p className="mt-0.5 text-[10px]" style={{ color: 'var(--accent)' }}>
                                {t('privacy.requiresSettingEnabled', { label: depSetting.label })}
                              </p>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleToggleSingle(setting.id)}
                            disabled={toggleDisabled}
                            className="relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60"
                            style={{ background: setting.enabled ? '#22c55e' : 'var(--bg-active)' }}
                          >
                            <div
                              className="absolute top-0.5 h-5 w-5 rounded-full transition-all"
                              style={{
                                left: setting.enabled ? '22px' : '2px',
                                background: setting.enabled ? '#fff' : 'var(--text-muted)',
                              }}
                            />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <ElevationBanner show={requiresAdminForFixes && unprotectedCount > 0 && !busy} />
    </div>
  )
}
