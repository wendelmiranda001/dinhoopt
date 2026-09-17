import type { NetworkConnection } from '@shared/types'
import { AlertTriangle, ArrowUpDown, Globe, Loader2, Search, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type SortField = 'remoteAddress' | 'remotePort' | 'processName' | 'state'
type SortDir = 'asc' | 'desc'

export function NetworkMonitor() {
  const { t } = useTranslation('network')
  const [connections, setConnections] = useState<NetworkConnection[]>([])
  const [suspicious, setSuspicious] = useState<NetworkConnection[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterProcess, setFilterProcess] = useState('')
  const [filterState, setFilterState] = useState('')
  const [sortField, setSortField] = useState<SortField>('remoteAddress')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [showSuspiciousOnly, setShowSuspiciousOnly] = useState(false)

  const fetchConnections = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.dinho.networkGetConnections()
      setConnections(result.connections)
      setSuspicious(result.suspicious)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConnections()
  }, [fetchConnections])

  const uniqueStates = useMemo(() => {
    const states = new Set<string>()
    for (const c of connections) states.add(c.state)
    return [...states].sort()
  }, [connections])

  const suspiciousPids = useMemo(() => new Set(suspicious.map((c) => `${c.pid}-${c.remotePort}`)), [suspicious])

  const filtered = useMemo(() => {
    let list = showSuspiciousOnly ? suspicious : connections
    if (filterProcess) list = list.filter((c) => c.processName === filterProcess)
    if (filterState) list = list.filter((c) => c.state === filterState)

    const sorted = [...list].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'remoteAddress':
          cmp = a.remoteAddress.localeCompare(b.remoteAddress)
          break
        case 'remotePort':
          cmp = a.remotePort - b.remotePort
          break
        case 'processName':
          cmp = a.processName.localeCompare(b.processName)
          break
        case 'state':
          cmp = a.state.localeCompare(b.state)
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [connections, suspicious, filterProcess, filterState, sortField, sortDir, showSuspiciousOnly])

  const toggleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      else {
        setSortField(field)
        setSortDir('asc')
      }
    },
    [sortField],
  )

  const SortIcon = ({ field }: { field: SortField }) => (
    <ArrowUpDown
      className="h-3 w-3 shrink-0"
      style={{
        color: sortField === field ? 'var(--accent)' : 'var(--text-muted)',
        opacity: sortField === field ? 1 : 0.4,
      }}
    />
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchConnections}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
            style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
            {t('monitorRefresh')}
          </button>
          {suspicious.length > 0 && (
            <button
              type="button"
              onClick={() => setShowSuspiciousOnly((v) => !v)}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium transition-all"
              style={{
                background: showSuspiciousOnly ? 'rgba(239,68,68,0.1)' : 'var(--bg-hover)',
                border: `1px solid ${showSuspiciousOnly ? 'rgba(239,68,68,0.2)' : 'var(--border-medium)'}`,
                color: showSuspiciousOnly ? '#ef4444' : 'var(--text-muted)',
              }}
            >
              <ShieldAlert className="h-4 w-4" />
              {t('monitorSuspiciousCount', { count: suspicious.length })}
            </button>
          )}
        </div>
        <span className="text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>
          {t('monitorConnectionCount', { total: connections.length, shown: filtered.length })}
        </span>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search
            className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            type="text"
            placeholder={t('monitorFilterProcess')}
            value={filterProcess}
            onChange={(e) => setFilterProcess(e.target.value)}
            className="w-full rounded-lg py-2 pl-9 pr-3 text-[13px] text-zinc-300 placeholder:text-zinc-600"
            style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)' }}
          />
        </div>
        <select
          value={filterState}
          onChange={(e) => setFilterState(e.target.value)}
          className="rounded-lg px-3 py-2 text-[13px] text-zinc-300"
          style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)' }}
        >
          <option value="">{t('monitorAllStates')}</option>
          {uniqueStates.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div
          className="flex items-center gap-2 rounded-xl px-4 py-3"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.1)' }}
        >
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
          <span className="text-[13px] text-red-300">{error}</span>
        </div>
      )}

      {loading && connections.length === 0 && (
        <div
          className="flex items-center gap-3 rounded-2xl px-5 py-8"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
          <span className="text-[13px] text-zinc-400">{t('monitorLoading')}</span>
        </div>
      )}

      {!loading && filtered.length === 0 && !error && (
        <div className="py-12 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
          {t('monitorNoConnections')}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--border-default)' }}>
          <table className="w-full text-left">
            <thead>
              <tr style={{ background: 'var(--bg-hover)' }}>
                {(
                  [
                    ['remoteAddress', t('monitorColRemote')],
                    ['remotePort', t('monitorColPort')],
                    ['processName', t('monitorColProcess')],
                    ['state', t('monitorColState')],
                  ] as const
                ).map(([field, label]) => (
                  <th
                    key={field}
                    className="cursor-pointer select-none px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}
                    onClick={() => toggleSort(field)}
                  >
                    <div className="flex items-center gap-1.5">
                      {label}
                      <SortIcon field={field} />
                    </div>
                  </th>
                ))}
                <th
                  className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider"
                  style={{ color: 'var(--text-muted)' }}
                >
                  PID
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((conn, i) => {
                const key = `${conn.pid}-${conn.remotePort}-${conn.remoteAddress}`
                const isSusp = suspiciousPids.has(key)
                return (
                  <tr
                    // biome-ignore lint/suspicious/noArrayIndexKey: duplicate connections share pid/port/addr — index disambiguates
                    key={`${key}-${i}`}
                    style={{
                      background: isSusp ? 'rgba(239,68,68,0.03)' : i % 2 === 0 ? 'transparent' : 'var(--bg-subtle)',
                      borderBottom: '1px solid var(--bg-hover)',
                    }}
                  >
                    <td className="px-4 py-2 text-[12px] font-mono text-zinc-300">{conn.remoteAddress}</td>
                    <td className="px-4 py-2 text-[12px] font-mono text-zinc-400">{conn.remotePort}</td>
                    <td className="px-4 py-2 text-[12px] text-zinc-300">
                      <div className="flex items-center gap-1.5">
                        {isSusp && <ShieldAlert className="h-3 w-3 text-red-400 shrink-0" />}
                        {conn.processName}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-[12px] text-zinc-400">{conn.state}</td>
                    <td className="px-4 py-2 text-[11px] font-mono text-zinc-500">{conn.pid}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
