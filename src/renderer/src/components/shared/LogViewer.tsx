import type { LogLevel } from '@shared/types'
import { ChevronLeft, ChevronRight, Download, FileText, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useLoggerStore } from '@/stores/logger-store'

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '#6b7280',
  info: '#3b82f6',
  success: '#22c55e',
  warning: '#eab308',
  error: '#ef4444',
}

export function LogViewer() {
  const { t } = useTranslation('settings')
  const {
    entries,
    total,
    page,
    pageSize,
    filter,
    config,
    loading,
    setFilter,
    setPage,
    fetchLogs,
    clearLogs,
    exportLogs,
    fetchConfig,
    setConfig,
  } = useLoggerStore()

  useEffect(() => {
    fetchLogs()
    fetchConfig()
  }, [fetchLogs, fetchConfig])

  const handleExport = useCallback(async () => {
    const text = await exportLogs()
    if (!text) {
      toast.error(t('logsNoEntries'))
      return
    }
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dinho-logs-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t('logsExport'))
  }, [exportLogs, t])

  const handleClear = useCallback(async () => {
    await clearLogs()
    toast.success(t('logsClear'))
  }, [clearLogs, t])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5"
            style={{ color: 'var(--text-muted)' }}
            strokeWidth={1.8}
          />
          <input
            type="text"
            value={filter.search ?? ''}
            onChange={(e) => setFilter({ ...filter, ...(e.target.value ? { search: e.target.value } : {}) })}
            placeholder={t('logsSearchPlaceholder')}
            className="w-full rounded-xl pl-9 pr-4 py-2 text-[13px] text-zinc-300 outline-none placeholder:text-zinc-700"
            style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
          />
        </div>
        <select
          value={filter.level ?? ''}
          onChange={(e) => {
            const level = e.target.value as LogLevel
            setFilter({ ...filter, ...(level ? { level } : {}) })
          }}
          className="rounded-lg px-3 py-2 text-[13px] text-zinc-400 outline-none"
          style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
        >
          <option value="">{t('logsLevelAll')}</option>
          <option value="info">{t('logsLevelInfo')}</option>
          <option value="success">{t('logsLevelSuccess')}</option>
          <option value="warning">{t('logsLevelWarning')}</option>
          <option value="error">{t('logsLevelError')}</option>
        </select>
        <button
          type="button"
          onClick={fetchLogs}
          disabled={loading}
          className="rounded-xl p-2.5 text-zinc-400 transition-colors disabled:opacity-50"
          style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={handleExport}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] text-zinc-400 transition-colors"
          style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.8} /> {t('logsExport')}
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] text-red-400 transition-colors"
          style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} /> {t('logsClear')}
        </button>
      </div>

      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
      >
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <FileText className="h-8 w-8 mb-3" style={{ color: 'var(--text-faint)' }} strokeWidth={1.5} />
            <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              {t('logsNoEntries')}
            </p>
          </div>
        ) : (
          <div className="max-h-[400px] overflow-y-auto">
            {entries.map((entry) => (
              <div
                key={`${entry.timestamp}-${entry.module}-${entry.message.slice(0, 40)}`}
                className="flex items-start gap-3 px-4 py-2.5 border-b last:border-b-0 text-[12px] font-mono"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <span className="shrink-0" style={{ color: 'var(--text-faint)' }}>
                  {entry.timestamp.slice(0, 19).replace('T', ' ')}
                </span>
                <span className="shrink-0 font-semibold" style={{ color: LEVEL_COLORS[entry.level] }}>
                  {entry.level.toUpperCase().padEnd(7)}
                </span>
                <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>
                  [{entry.module}]
                </span>
                <span className="break-words" style={{ color: 'var(--text-primary)' }}>
                  {entry.message}
                  {entry.details ? ` — ${entry.details}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="rounded-lg p-1.5 text-zinc-400 transition-colors disabled:opacity-30"
            style={{ background: 'var(--bg-subtle-2)' }}
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
          </button>
          <span className="text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="rounded-lg p-1.5 text-zinc-400 transition-colors disabled:opacity-30"
            style={{ background: 'var(--bg-subtle-2)' }}
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <label
          htmlFor="log-retention"
          className="text-[12px] font-medium shrink-0"
          style={{ color: 'var(--text-muted)' }}
        >
          {t('logsRetentionLabel')}
        </label>
        <input
          id="log-retention"
          type="number"
          min={1}
          max={365}
          value={config.retentionDays}
          onChange={(e) => {
            const val = Math.max(1, Math.min(365, Number(e.target.value) || 7))
            setConfig({ retentionDays: val })
          }}
          className="w-20 rounded-lg px-3 py-1.5 text-[13px] text-zinc-300 outline-none text-center"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
        />
        <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
          {t('logsRetentionDesc')}
        </span>
      </div>
    </div>
  )
}
