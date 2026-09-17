import type { HistoryEntryType, ScanHistoryEntry } from '@shared/types'
import { BarChart3, Clock, HardDrive, TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipValueType,
  XAxis,
  YAxis,
} from 'recharts'
import { StaggerContainer, StaggerItem } from '@/components/shared/StaggerContainer'
import { formatBytes } from '@/lib/utils'
import { PIE_COLORS, typeConfigBase } from './constants'
import { formatDuration } from './formatDuration'
import { MiniStat } from './MiniStat'
import { RecentScanRow } from './RecentScanRow'

const TYPE_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(typeConfigBase).map(([k, v]) => [k, v.color]),
)

export function OverviewView({
  stats,
  typeBreakdown,
  categoryBreakdown,
  weeklyData,
  entries,
}: {
  stats: { totalSpace: number; totalItems: number; totalErrors: number; avgDuration: number; totalScans: number }
  typeBreakdown: { name: string; count: number; space: number; items: number }[]
  categoryBreakdown: { name: string; items: number; space: number }[]
  weeklyData: { week: string; space: number; items: number; count: number }[]
  entries: ScanHistoryEntry[]
}) {
  const { t } = useTranslation('history')

  const activeTypes = useMemo(() => {
    const set = new Set<HistoryEntryType>()
    for (const e of entries) set.add(e.type)
    return Array.from(set)
  }, [entries])

  const stackedData = useMemo(() => {
    if (entries.length === 0) return []
    const byDay: Record<string, Record<string, number>> = {}
    for (const e of entries) {
      const key = new Date(e.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      if (!byDay[key]) byDay[key] = {}
      const bucket = byDay[key]
      if (bucket) {
        bucket[e.type] = (bucket[e.type] ?? 0) + e.totalSpaceSaved
      }
    }
    return Object.entries(byDay)
      .slice(-30)
      .map(([date, types]) => ({ date, ...types }))
  }, [entries])

  return (
    <>
      <StaggerContainer className="mb-5 grid grid-cols-4 gap-3">
        <StaggerItem>
          <MiniStat
            icon={BarChart3}
            label={t('overview.totalScans')}
            value={stats.totalScans.toString()}
            color="#f59e0b"
          />
        </StaggerItem>
        <StaggerItem>
          <MiniStat
            icon={HardDrive}
            label={t('overview.spaceRecovered')}
            value={formatBytes(stats.totalSpace)}
            color="#22c55e"
          />
        </StaggerItem>
        <StaggerItem>
          <MiniStat
            icon={TrendingUp}
            label={t('overview.itemsProcessed')}
            value={stats.totalItems.toLocaleString()}
            color="#3b82f6"
          />
        </StaggerItem>
        <StaggerItem>
          <MiniStat
            icon={Clock}
            label={t('overview.avgDuration')}
            value={formatDuration(stats.avgDuration, t)}
            color="#a855f7"
          />
        </StaggerItem>
      </StaggerContainer>

      <div className="mb-5 grid grid-cols-3 gap-4">
        <div
          className="col-span-2 rounded-2xl p-5"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {t('overview.spaceRecoveredOverTime')}
            </h3>
          </div>
          {stackedData.length > 1 ? (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stackedData} barSize={16}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => formatBytes(v as number, 0)}
                    width={60}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--card-bg)',
                      border: '1px solid var(--border-stronger)',
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: 'var(--text-secondary)' }}
                    formatter={(value: TooltipValueType | undefined, name: number | string | undefined) => {
                      const label = t(`typeLabels.${name}`, { defaultValue: String(name) })
                      return [formatBytes(typeof value === 'number' ? value : 0), label]
                    }}
                  />
                  {activeTypes.map((tp) => (
                    <Bar key={tp} dataKey={tp} stackId="stack" fill={TYPE_COLORS[tp] ?? '#888'} radius={[0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {activeTypes.map((tp) => (
                  <div key={tp} className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-sm" style={{ background: TYPE_COLORS[tp] ?? '#888' }} />
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {t(`typeLabels.${tp}`, { defaultValue: tp })}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div
              className="flex h-[220px] items-center justify-center text-[13px]"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('overview.needTwoScansForChart')}
            </div>
          )}
        </div>

        <div
          className="rounded-2xl p-5"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <h3 className="mb-4 text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {t('overview.scanTypeDistribution')}
          </h3>
          {typeBreakdown.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie
                    data={typeBreakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={60}
                    dataKey="count"
                    stroke="none"
                  >
                    {typeBreakdown.map((item, idx) => (
                      <Cell key={item.name || idx} fill={PIE_COLORS[idx % PIE_COLORS.length] ?? '#888'} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'var(--card-bg)',
                      border: '1px solid var(--border-stronger)',
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    formatter={(value) => [Number(value), t('overview.tooltipScans')]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1.5">
                {typeBreakdown.map((item, idx) => (
                  <div key={item.name} className="flex items-center gap-2">
                    <div
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: PIE_COLORS[idx % PIE_COLORS.length] }}
                    />
                    <span className="flex-1 text-[12px] text-zinc-400">{item.name}</span>
                    <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div
              className="flex h-[200px] items-center justify-center text-[13px]"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('overview.noData')}
            </div>
          )}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4">
        <div
          className="rounded-2xl p-5"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <h3 className="mb-4 text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {t('overview.topCategoriesBySpace')}
          </h3>
          {categoryBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={categoryBreakdown} layout="vertical" barSize={14}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatBytes(v as number, 0)}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={90}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-stronger)',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(value) => [formatBytes(Number(value)), t('overview.tooltipSpace')]}
                />
                <Bar dataKey="space" radius={[0, 6, 6, 0]}>
                  {categoryBreakdown.map((item, idx) => (
                    <Cell
                      key={item.name || idx}
                      fill={PIE_COLORS[idx % PIE_COLORS.length] ?? '#888'}
                      fillOpacity={0.8}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div
              className="flex h-[220px] items-center justify-center text-[13px]"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('overview.noCategoryData')}
            </div>
          )}
        </div>

        <div
          className="rounded-2xl p-5"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
        >
          <h3 className="mb-4 text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {t('overview.weeklyActivity')}
          </h3>
          {weeklyData.length > 1 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weeklyData} barSize={20}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-line)" />
                <XAxis
                  dataKey="week"
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-stronger)',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: 'var(--text-secondary)' }}
                  formatter={(value, name) => [
                    name === 'count' ? Number(value) : formatBytes(Number(value)),
                    name === 'count' ? t('overview.tooltipScans') : t('overview.tooltipSpace'),
                  ]}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} fillOpacity={0.8} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div
              className="flex h-[220px] items-center justify-center text-[13px]"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('overview.needTwoWeeksData')}
            </div>
          )}
        </div>
      </div>

      <div
        className="rounded-2xl p-5"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
      >
        <h3 className="mb-4 text-[12px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {t('overview.recentScans')}
        </h3>
        <StaggerContainer className="space-y-2">
          {entries.slice(0, 5).map((entry) => (
            <StaggerItem key={entry.id}>
              <RecentScanRow entry={entry} />
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </>
  )
}
