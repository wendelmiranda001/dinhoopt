import { Plus, X } from 'lucide-react'
import { cn, formatBytes } from '@/lib/utils'

export const SIZE_PRESETS = [
  { label: '100 KB', value: 102_400 },
  { label: '1 MB', value: 1_048_576 },
  { label: '10 MB', value: 10_485_760 },
  { label: '100 MB', value: 104_857_600 },
]

export const EXT_PRESETS: Record<string, string[]> = {
  images: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff'],
  videos: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm'],
  audio: ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.wma', '.m4a'],
  documents: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'],
}

export const PHASE_LABELS: Record<string, string> = {
  walking: 'phaseWalking',
  grouping: 'phaseGrouping',
  'partial-hash': 'phasePartialHash',
  'full-hash': 'phaseFullHash',
  complete: 'phaseComplete',
}

export function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </div>
      <div className="mt-1 text-[18px] font-bold" style={{ color: accent ? 'var(--accent)' : 'var(--text-primary)' }}>
        {value}
      </div>
    </div>
  )
}

export function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        {label}:{' '}
      </span>
      <span className="text-[12px] font-medium text-white">{value}</span>
    </div>
  )
}

interface SettingsPanelProps {
  minFileSize: number
  maxFileSize: number | null
  extensionFilter: string[]
  maxDepth: number
  excludePatterns: string[]
  activeExtPreset: string | null | 'all'
  excludeInput: string
  setMinFileSize: (v: number) => void
  setMaxFileSize: (v: number | null) => void
  setExtensionFilter: (v: string[]) => void
  setMaxDepth: (v: number) => void
  setExcludePatterns: (v: string[]) => void
  setExcludeInput: (v: string) => void
  onAddExclude: () => void
  onRemoveExclude: (pattern: string) => void
  t: (key: string) => string
}

export function SettingsPanel({
  minFileSize,
  maxFileSize,
  maxDepth,
  excludePatterns,
  activeExtPreset,
  excludeInput,
  setMinFileSize,
  setMaxFileSize,
  setExtensionFilter,
  setMaxDepth,
  setExcludeInput,
  onAddExclude,
  onRemoveExclude,
  t,
}: SettingsPanelProps) {
  return (
    <div
      className="mb-5 rounded-2xl p-5"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="grid grid-cols-2 gap-x-8 gap-y-4">
        {/* Min file size */}
        <fieldset>
          <legend
            className="mb-2 block text-[11px] font-semibold tracking-wide"
            style={{ color: 'var(--text-secondary)' }}
          >
            {t('minFileSize')}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {SIZE_PRESETS.map((p) => (
              <button
                type="button"
                key={p.value}
                onClick={() => setMinFileSize(p.value)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors',
                  minFileSize === p.value ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300',
                )}
                style={{
                  background: minFileSize === p.value ? 'rgba(245,158,11,0.1)' : 'var(--bg-subtle-2)',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Max file size */}
        <fieldset>
          <legend
            className="mb-2 block text-[11px] font-semibold tracking-wide"
            style={{ color: 'var(--text-secondary)' }}
          >
            {t('maxFileSize')}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setMaxFileSize(null)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors',
                maxFileSize === null ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300',
              )}
              style={{
                background: maxFileSize === null ? 'rgba(245,158,11,0.1)' : 'var(--bg-subtle-2)',
              }}
            >
              {t('noLimit')}
            </button>
            {[104_857_600, 1_073_741_824, 5_368_709_120].map((v) => (
              <button
                type="button"
                key={v}
                onClick={() => setMaxFileSize(v)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors',
                  maxFileSize === v ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300',
                )}
                style={{
                  background: maxFileSize === v ? 'rgba(245,158,11,0.1)' : 'var(--bg-subtle-2)',
                }}
              >
                {formatBytes(v, 0)}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Extension filter */}
        <fieldset>
          <legend
            className="mb-2 block text-[11px] font-semibold tracking-wide"
            style={{ color: 'var(--text-secondary)' }}
          >
            {t('extensionFilter')}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'images', 'videos', 'audio', 'documents'] as const).map((preset) => (
              <button
                type="button"
                key={preset}
                onClick={() => setExtensionFilter(preset === 'all' ? [] : (EXT_PRESETS[preset] ?? []))}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors',
                  activeExtPreset === preset ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300',
                )}
                style={{
                  background: activeExtPreset === preset ? 'rgba(245,158,11,0.1)' : 'var(--bg-subtle-2)',
                }}
              >
                {t(preset === 'all' ? 'allFiles' : preset)}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Max depth */}
        <div>
          <label
            htmlFor="dup-max-depth"
            className="mb-2 block text-[11px] font-semibold tracking-wide"
            style={{ color: 'var(--text-secondary)' }}
          >
            {t('maxDepth')}
          </label>
          <input
            id="dup-max-depth"
            type="number"
            min={1}
            max={50}
            value={maxDepth}
            onChange={(e) => setMaxDepth(Math.max(1, Math.min(50, Number.parseInt(e.target.value, 10) || 20)))}
            className="w-20 rounded-lg px-3 py-1.5 text-[13px] text-white"
            style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
          />
        </div>

        {/* Exclude patterns */}
        <div className="col-span-2">
          <label
            htmlFor="dup-exclude-input"
            className="mb-2 block text-[11px] font-semibold tracking-wide"
            style={{ color: 'var(--text-secondary)' }}
          >
            {t('excludePatterns')}
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            {excludePatterns.map((p) => (
              <span
                key={p}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-medium"
                style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-secondary)' }}
              >
                {p}
                <button type="button" onClick={() => onRemoveExclude(p)} className="text-zinc-600 hover:text-zinc-400">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <div className="flex items-center gap-1">
              <input
                id="dup-exclude-input"
                type="text"
                value={excludeInput}
                onChange={(e) => setExcludeInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onAddExclude()}
                placeholder={t('excludePlaceholder')}
                className="w-48 rounded-lg px-2.5 py-1 text-[12px] text-white placeholder-zinc-600"
                style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
              />
              <button
                type="button"
                onClick={onAddExclude}
                aria-label={t('addExcludeAria')}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
