import type { GamingTimerStatus } from '@shared/types'
import { Timer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useWindowsTweaksStore } from '@/stores/windows-tweaks-store'

interface TimerGamingSectionProps {
  gamingTimer: GamingTimerStatus | null
  loading: boolean
}

export function TimerGamingSection({ gamingTimer, loading }: TimerGamingSectionProps) {
  const { t } = useTranslation('windowsTweaks')
  const store = useWindowsTweaksStore

  const handleSetTimer = async (
    patch: Partial<Pick<GamingTimerStatus, 'hpetOff' | 'tscSyncPolicy' | 'dynamicTickDisabled'>>,
  ) => {
    const r = await store.getState().setGamingTimer(patch)
    if (r.success) toast.success(t('timerApplied', 'Timer setting applied!'))
    else toast.error(r.errors[0] ?? t('failed', 'Failed'))
  }

  const handleSetAutoTuning = async (mode: 'apply' | 'revert') => {
    const r = await store.getState().setAutoTuning(mode)
    if (r.success) toast.success(t('timerApplied', 'Timer setting applied!'))
    else toast.error(r.error ?? t('failed', 'Failed'))
  }

  const handleRevertAll = async () => {
    const r = await store.getState().revertGamingTimer()
    if (r.success) toast.success(t('timerReverted', 'Timer settings reverted to defaults!'))
    else toast.error(r.errors[0] ?? t('failed', 'Failed'))
  }

  if (loading) {
    return (
      <div className="mb-6">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-300">
          <Timer className="h-4 w-4 text-orange-400" />
          {t('timerTweaks', 'Timer & Gaming Tweaks')}
        </h3>
        <div className="flex items-center gap-2 py-4">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-orange-400" />
          <span className="text-xs text-zinc-500">{t('loadingTimer', 'Loading timer status...')}</span>
        </div>
      </div>
    )
  }

  if (!gamingTimer) {
    return (
      <div className="mb-6">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-300">
          <Timer className="h-4 w-4 text-orange-400" />
          {t('timerTweaks', 'Timer & Gaming Tweaks')}
        </h3>
        <p className="text-xs text-zinc-500">{t('timerLoadFailed', 'Failed to load timer status.')}</p>
      </div>
    )
  }

  return (
    <div className="mb-6">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-300">
        <Timer className="h-4 w-4 text-orange-400" />
        {t('timerTweaks', 'Timer & Gaming Tweaks')}
      </h3>
      <p className="mb-3 text-xs text-zinc-500">
        {t(
          'timerTweaksDescription',
          'Optimize Windows timer resolution and CPU scheduling for competitive gaming. Requires reboot to take effect.',
        )}
      </p>
      <div className="space-y-3">
        {/* HPET */}
        <div
          className="flex items-center justify-between rounded-lg border px-4 py-3"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--card-bg)' }}
        >
          <div>
            <div className="text-sm font-medium text-zinc-200">
              {t('hpetTitle', 'HPET (High Precision Event Timer)')}
            </div>
            <div className="text-xs text-zinc-500">
              {t(
                'hpetDescription',
                'Disable platform clock for lower timer latency on Intel CPUs. May help on AMD Ryzen too.',
              )}
            </div>
          </div>
          <ToggleSwitch
            enabled={gamingTimer.hpetOff}
            onToggle={() => handleSetTimer({ hpetOff: !gamingTimer.hpetOff })}
          />
        </div>

        {/* TSC Sync Policy */}
        <div
          className="rounded-lg border px-4 py-3"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--card-bg)' }}
        >
          <div className="mb-2">
            <div className="text-sm font-medium text-zinc-200">{t('tscSyncTitle', 'TSC Sync Policy')}</div>
            <div className="text-xs text-zinc-500">
              {t(
                'tscSyncDescription',
                'Legacy = lower input lag, slightly less FPS. Enhanced = more FPS, slightly more input lag.',
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {(['default', 'legacy', 'enhanced'] as const).map((policy) => (
              <button
                type="button"
                key={policy}
                onClick={() => handleSetTimer({ tscSyncPolicy: policy })}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  gamingTimer.tscSyncPolicy === policy
                    ? 'bg-orange-500/20 text-orange-400 ring-1 ring-orange-500/40'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-300'
                }`}
              >
                {policy === 'default'
                  ? t('tscDefault', 'Default')
                  : policy === 'legacy'
                    ? t('tscLegacy', 'Legacy (Low Latency)')
                    : t('tscEnhanced', 'Enhanced (High FPS)')}
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic Tick */}
        <div
          className="flex items-center justify-between rounded-lg border px-4 py-3"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--card-bg)' }}
        >
          <div>
            <div className="text-sm font-medium text-zinc-200">{t('dynamicTickTitle', 'Disable Dynamic Tick')}</div>
            <div className="text-xs text-zinc-500">
              {t(
                'dynamicTickDescription',
                'Prevents Windows from suspending the system timer tick in idle. Reduces micro-stutters.',
              )}
            </div>
          </div>
          <ToggleSwitch
            enabled={gamingTimer.dynamicTickDisabled}
            onToggle={() => handleSetTimer({ dynamicTickDisabled: !gamingTimer.dynamicTickDisabled })}
          />
        </div>

        {/* AutoTuning */}
        <div
          className="flex items-center justify-between rounded-lg border px-4 py-3"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--card-bg)' }}
        >
          <div>
            <div className="text-sm font-medium text-zinc-200">{t('autoTuningTitle', 'TCP AutoTuning — Disabled')}</div>
            <div className="text-xs text-zinc-500">
              {t(
                'autoTuningDescription',
                'Reduces bufferbloat and jitter during gaming. Recommended for competitive gaming. May slow large downloads.',
              )}
            </div>
          </div>
          <ToggleSwitch
            enabled={gamingTimer.autoTuningDisabled}
            onToggle={() => handleSetAutoTuning(gamingTimer.autoTuningDisabled ? 'revert' : 'apply')}
          />
        </div>

        {/* Revert All */}
        <button
          type="button"
          onClick={handleRevertAll}
          className="rounded-lg border border-red-800 px-4 py-2 text-xs font-medium text-red-400 transition-all hover:bg-red-900/20"
        >
          {t('revertTimerDefaults', 'Revert Timer to Defaults')}
        </button>
      </div>
    </div>
  )
}

function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
        enabled ? 'bg-orange-500' : 'bg-zinc-700'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}
