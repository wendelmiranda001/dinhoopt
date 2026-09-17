import type { WindowsTweakCategory, WindowsTweakState } from '@shared/types'
import { AnimatePresence, motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { TweakRow } from '@/components/TweakRow'

export interface CategoryDef {
  id: WindowsTweakCategory
  label: string
  icon: LucideIcon
  color: string
  glow: string
}

interface TweakCategoryCardProps {
  category: CategoryDef
  tweaks: WindowsTweakState[]
  selectedIds: Set<string>
  catColors: Record<string, { color: string; glow: string }>
  isExpanded: boolean
  onToggle: (id: string) => void
  onToggleCategory: (id: WindowsTweakCategory) => void
}

export function TweakCategoryCard({
  category,
  tweaks,
  selectedIds,
  catColors,
  isExpanded,
  onToggle,
  onToggleCategory,
}: TweakCategoryCardProps) {
  const { t } = useTranslation('windowsTweaks')
  const applied = tweaks.filter((tw) => tw.applied).length
  const total = tweaks.length

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: 'var(--border-strong)', background: 'var(--card-bg)' }}
    >
      <button
        type="button"
        onClick={() => onToggleCategory(category.id)}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-all hover:bg-white/[0.02]"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: category.glow }}>
          <category.icon className="h-4 w-4" style={{ color: category.color }} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-zinc-200">{category.label}</div>
          <div className="text-xs text-zinc-500">{t('categoryStats', { applied, total })}</div>
        </div>
        <ChevronDown className={`h-4 w-4 text-zinc-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden will-change-transform"
          >
            <div className="space-y-0.5 border-t px-5 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
              {tweaks.map(({ tweak, applied: isApplied }, idx) => {
                const catColor = catColors[tweak.category]
                return (
                  <TweakRow
                    key={tweak.id}
                    tweak={tweak}
                    applied={isApplied}
                    selected={selectedIds.has(tweak.id)}
                    accentColor={catColor?.color ?? '#8b5cf6'}
                    accentGlow={catColor?.glow ?? 'rgba(139,92,246,0.12)'}
                    index={idx}
                    onToggle={onToggle}
                  />
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
