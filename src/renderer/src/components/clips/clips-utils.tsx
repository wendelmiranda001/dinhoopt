import type { ClipsConfig } from '@shared/types'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export type FilterTab = 'all' | 'today' | 'week' | 'favorites'

export const VK_MAP: Record<number, string> = {
  5: 'Mouse4',
  6: 'Mouse5',
  8: 'Backspace',
  9: 'Tab',
  12: 'Clear',
  13: 'Enter',
  19: 'Pause',
  20: 'CapsLock',
  27: 'Esc',
  32: 'Space',
  33: 'PageUp',
  34: 'PageDown',
  35: 'End',
  36: 'Home',
  37: '\u2190',
  38: '\u2191',
  39: '\u2192',
  40: '\u2193',
  44: 'PrintScreen',
  45: 'Insert',
  46: 'Delete',
  48: '0',
  49: '1',
  50: '2',
  51: '3',
  52: '4',
  53: '5',
  54: '6',
  55: '7',
  56: '8',
  57: '9',
  65: 'A',
  66: 'B',
  67: 'C',
  68: 'D',
  69: 'E',
  70: 'F',
  71: 'G',
  72: 'H',
  73: 'I',
  74: 'J',
  75: 'K',
  76: 'L',
  77: 'M',
  78: 'N',
  79: 'O',
  80: 'P',
  81: 'Q',
  82: 'R',
  83: 'S',
  84: 'T',
  85: 'U',
  86: 'V',
  87: 'W',
  88: 'X',
  89: 'Y',
  90: 'Z',
  91: 'Win',
  92: 'Win',
  93: 'Menu',
  96: 'Num0',
  97: 'Num1',
  98: 'Num2',
  99: 'Num3',
  100: 'Num4',
  101: 'Num5',
  102: 'Num6',
  103: 'Num7',
  104: 'Num8',
  105: 'Num9',
  106: 'Num*',
  107: 'Num+',
  109: 'Num-',
  110: 'Num.',
  111: 'Num/',
  112: 'F1',
  113: 'F2',
  114: 'F3',
  115: 'F4',
  116: 'F5',
  117: 'F6',
  118: 'F7',
  119: 'F8',
  120: 'F9',
  121: 'F10',
  122: 'F11',
  123: 'F12',
  124: 'F13',
  125: 'F14',
  126: 'F15',
  127: 'F16',
  128: 'F17',
  129: 'F18',
  130: 'F19',
  131: 'F20',
  132: 'F21',
  133: 'F22',
  134: 'F23',
  135: 'F24',
  144: 'NumLock',
  145: 'ScrollLock',
  160: 'LShift',
  161: 'RShift',
  162: 'LCtrl',
  163: 'RCtrl',
  164: 'LAlt',
  165: 'RAlt',
  186: ';',
  187: '=',
  188: ',',
  189: '-',
  190: '.',
  191: '/',
  192: '`',
  219: '[',
  220: '\\',
  221: ']',
  222: "'",
  226: '\\',
}
export const MODIFIER_KEYS = new Set([0x11, 0x10, 0x12])
export const REPLAY_DURATIONS = [30, 60, 120, 300, 600]

export function formatUptime(seconds: number, t: (key: string) => string): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m >= 60) return `${Math.floor(m / 60)}${t('hours')} ${m % 60}${t('minutes')}`
  if (m > 0) return `${m}${t('minutes')} ${s}${t('seconds')}`
  return `${s}${t('seconds')}`
}

export function formatKey(vk: number, modifiers: string[]): string {
  const order: Record<string, number> = { Ctrl: 0, Shift: 1, Alt: 2 }
  const parts = [...modifiers.sort((a, b) => (order[a] ?? 99) - (order[b] ?? 99)), VK_MAP[vk] || `0x${vk.toString(16)}`]
  return parts.join('+')
}

/* ── Shared UI Components ── */

export const ACCENT_TINTS = {
  violet: { solid: '#8b5cf6', soft: '#a78bfa', chip: 'rgba(139,92,246,0.14)' },
  blue: { solid: '#3b82f6', soft: '#60a5fa', chip: 'rgba(59,130,246,0.14)' },
  green: { solid: '#22c55e', soft: '#4ade80', chip: 'rgba(34,197,94,0.14)' },
  amber: { solid: '#f59e0b', soft: '#fbbf24', chip: 'rgba(245,158,11,0.14)' },
  red: { solid: '#ef4444', soft: '#f87171', chip: 'rgba(239,68,68,0.14)' },
} as const

export type AccentKey = keyof typeof ACCENT_TINTS

export function ConfigSection({
  icon: Icon,
  label,
  defaultOpen,
  content,
  accent = 'violet',
}: {
  icon: React.ElementType
  label: React.ReactNode
  defaultOpen: boolean
  content: React.ReactNode
  accent?: AccentKey
}) {
  const [open, setOpen] = useState(defaultOpen)
  const tint = ACCENT_TINTS[accent]
  return (
    <div
      className="overflow-hidden rounded-2xl border transition-all duration-200"
      style={{
        background: `linear-gradient(180deg, rgba(255,255,255,0.025), transparent 34%), var(--card-bg)`,
        borderColor: 'var(--border-medium)',
        boxShadow: open ? '0 10px 28px rgba(0,0,0,0.28)' : '0 2px 8px rgba(0,0,0,0.16)',
      }}
    >
      <div className="h-px w-full" style={{ background: `linear-gradient(90deg, ${tint.solid}, transparent)` }} />
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(!open)
          }
        }}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-xs font-semibold transition-colors hover:bg-white/[0.02]"
        style={{ color: 'var(--text-primary)' }}
      >
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
          style={{ background: tint.chip, color: tint.soft }}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="flex-1 text-left">{label}</span>
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          style={{ color: 'var(--text-dim)' }}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </motion.div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden will-change-transform"
          >
            <div className="px-4 pb-4">{content}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accent = 'violet',
  layoutId,
  wrap = false,
  className = '',
}: {
  options: Array<{ value: T; label: React.ReactNode; sub?: React.ReactNode; title?: string }>
  value: T
  onChange: (v: T) => void
  accent?: AccentKey
  layoutId: string
  wrap?: boolean
  className?: string
}) {
  const tint = ACCENT_TINTS[accent]
  return (
    <div
      className={`${wrap ? 'flex flex-wrap gap-1' : 'flex gap-1 rounded-xl p-1'} ${className}`}
      style={wrap ? undefined : { background: 'rgba(113,113,122,0.08)', border: '1px solid var(--border-subtle)' }}
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={`relative ${wrap ? 'rounded-lg px-2 py-1' : 'flex-1 rounded-lg py-1'} text-[10px] font-medium transition-all`}
            style={{ color: active ? '#fff' : 'var(--text-secondary)' }}
          >
            {active && (
              <motion.div
                layoutId={layoutId}
                className="absolute inset-0 rounded-lg"
                style={{
                  background: `linear-gradient(135deg, ${tint.solid}, ${tint.soft})`,
                  boxShadow: `0 4px 14px ${tint.solid}44`,
                }}
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative z-10 flex flex-col items-center leading-tight">
              <span>{opt.label}</span>
              {opt.sub && (
                <span style={{ opacity: active ? 0.85 : 0.55, fontSize: '8px', fontWeight: 400 }}>{opt.sub}</span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function VolumeSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  const pct = Math.round(value * 100)
  return (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{ background: 'rgba(113,113,122,0.05)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-medium" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </span>
        <span className="font-mono text-[10px] tabular-nums" style={{ color: 'var(--text-dim)' }}>
          {pct}%
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={400}
          value={pct}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          className="clip-range flex-1"
          style={{
            background: `linear-gradient(to right, var(--accent) ${pct}%, rgba(113,113,122,0.2) ${pct}%)`,
          }}
        />
      </div>
    </div>
  )
}

export function ToggleItem({
  label,
  enabled,
  accent = 'blue',
  onToggle,
}: {
  label: React.ReactNode
  enabled: boolean
  accent: 'green' | 'amber' | 'blue' | 'violet'
  onToggle: () => void
}) {
  const colorMap = { green: '#22c55e', amber: '#f59e0b', blue: '#3b82f6', violet: '#8b5cf6' }
  const color = colorMap[accent]
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-[10px] font-medium transition-all hover:bg-white/[0.03]"
      style={{
        background: `linear-gradient(180deg, rgba(255,255,255,0.03), transparent 55%), var(--card-bg)`,
        border: `1px solid ${enabled ? `${color}44` : 'var(--border-subtle)'}`,
      }}
      aria-pressed={enabled}
    >
      <span className="flex items-center gap-1.5" style={{ color: enabled ? color : 'var(--text-secondary)' }}>
        <span
          className="grid h-4 w-4 place-items-center rounded-full"
          style={{ background: enabled ? `${color}22` : 'rgba(113,113,122,0.12)' }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: enabled ? color : 'rgba(113,113,122,0.5)' }}
          />
        </span>
        {label}
      </span>
      <span
        className="rounded-full px-2 py-0.5 text-[8px] font-semibold"
        style={{
          background: enabled ? `${color}22` : 'rgba(113,113,122,0.15)',
          color: enabled ? color : 'var(--text-dim)',
        }}
      >
        {enabled ? 'ON' : 'OFF'}
      </span>
    </button>
  )
}

export function TogglePill({
  enabled,
  accent = 'blue',
  onToggle,
  ...rest
}: {
  enabled: boolean
  accent?: 'blue' | 'violet'
  onToggle: () => void
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const colorMap = { blue: '#3b82f6', violet: '#8b5cf6' }
  const c = colorMap[accent]
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      {...rest}
      className="relative h-5 w-9 shrink-0 rounded-full transition-all duration-200"
      style={{
        background: enabled ? c : 'rgba(113,113,122,0.25)',
        boxShadow: enabled ? `0 0 12px ${c}55` : 'none',
      }}
    >
      <motion.span
        className="absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow"
        animate={{ left: enabled ? 18 : 2 }}
        transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      />
    </button>
  )
}

export function CollapsibleMini({
  label,
  defaultOpen,
  children,
}: {
  label: React.ReactNode
  defaultOpen: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div
      className="overflow-hidden rounded-xl transition-colors"
      style={{ background: 'rgba(113,113,122,0.05)', border: '1px solid var(--border-subtle)' }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-[10px] font-medium transition-colors hover:bg-white/[0.02]"
        style={{ color: 'var(--text-secondary)' }}
      >
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronDown className="h-3 w-3" style={{ color: 'var(--text-dim)' }} />
        </motion.div>
        {label}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="mini-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
            className="overflow-hidden will-change-transform"
          >
            <div className="px-3 pb-2.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function GamePickerBtn({
  config,
  onClear,
  onOpenPicker,
}: {
  config: ClipsConfig
  onClear: () => void
  onOpenPicker: () => void
}) {
  const { t } = useTranslation('clips')
  if (config.customGameProcess) {
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onOpenPicker}
          className="rounded-md px-2 py-0.5 text-[10px] font-medium transition-all"
          style={{ background: 'rgba(113,113,122,0.12)', color: 'var(--text-dim)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(113,113,122,0.2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(113,113,122,0.12)')}
        >
          {t('change')}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md px-2 py-0.5 text-[10px] font-medium transition-all hover:bg-red-500/15"
          style={{ color: '#ef4444' }}
        >
          {t('clear')}
        </button>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onOpenPicker}
      className="rounded-md px-2 py-0.5 text-[10px] font-medium transition-all"
      style={{ background: 'rgba(113,113,122,0.12)', color: 'var(--text-dim)' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(113,113,122,0.2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(113,113,122,0.12)')}
    >
      {t('choose')}
    </button>
  )
}
