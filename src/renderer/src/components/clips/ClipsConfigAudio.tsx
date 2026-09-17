import type { AudioSessionInfo } from '@shared/types'
import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TipBadge } from './ClipsConfigQuality'
import { CollapsibleMini, ToggleItem, TogglePill, VK_MAP, VolumeSlider } from './clips-utils'
import type { ClipsState } from './useClipsState'

export function AudioSection({
  config,
  status,
  activeTip,
  setActiveTip,
  rebindingId,
  setRebindingId,
  micDevices,
  loadingMicDevices,
  handleConfigUpdate,
  t,
}: Pick<
  ClipsState,
  | 'config'
  | 'status'
  | 'activeTip'
  | 'setActiveTip'
  | 'rebindingId'
  | 'setRebindingId'
  | 'micDevices'
  | 'loadingMicDevices'
  | 'handleConfigUpdate'
  | 't'
>) {
  const [audioSessions, setAudioSessions] = useState<AudioSessionInfo[]>([])
  const loadSessions = useCallback(async () => {
    try {
      const sessions = await window.dinho?.clipsGetAudioSessions()
      setAudioSessions(Array.isArray(sessions) ? sessions : [])
    } catch {
      setAudioSessions([])
    }
  }, [])
  useEffect(() => {
    void loadSessions()
  }, [loadSessions])
  const toggleSession = useCallback(
    (pid: number) => {
      if (!config) return
      const current = config.selectedAudioSessions ?? []
      const isSelected = current.includes(pid)
      void handleConfigUpdate({ selectedAudioSessions: isSelected ? [] : [pid] })
    },
    [config, handleConfigUpdate],
  )
  if (!config) return null
  return (
    <div className="space-y-3">
      {/* Mic + Loopback side by side */}
      <div className="grid grid-cols-2 gap-2">
        <ToggleItem
          label={
            <span className="flex items-center gap-1">
              {t('micEnabled')}
              <TipBadge id="mic" activeTip={activeTip} setActiveTip={setActiveTip} />
            </span>
          }
          enabled={config.micEnabled}
          accent="blue"
          onToggle={() => handleConfigUpdate({ micEnabled: !config.micEnabled })}
        />
        <ToggleItem
          label={
            <span className="flex items-center gap-1">
              {t('audioLoopback')}
              <TipBadge id="loopback" activeTip={activeTip} setActiveTip={setActiveTip} />
            </span>
          }
          enabled={config.audioLoopback}
          accent="blue"
          onToggle={() => {
            const newVal = !config.audioLoopback
            handleConfigUpdate({
              audioLoopback: newVal,
              gameAudioOnly: !newVal,
            })
          }}
        />
      </div>

      {/* Noise Suppression */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
            {t('noiseSuppression')}
          </span>
          <TipBadge id="noise-suppression" activeTip={activeTip} setActiveTip={setActiveTip} />
        </div>
        <TogglePill
          enabled={config.noiseSuppression ?? false}
          accent="blue"
          onToggle={() => handleConfigUpdate({ noiseSuppression: !(config.noiseSuppression ?? false) })}
        />
      </div>

      {/* Push-to-Talk */}
      <CollapsibleMini
        label={
          <span className="flex items-center gap-1.5">
            {t('pushToTalk')}
            <TipBadge id="ptt" activeTip={activeTip} setActiveTip={setActiveTip} />
          </span>
        }
        defaultOpen={false}
      >
        <div className="space-y-2">
          <div className="flex gap-1">
            {(['off', 'hold', 'toggle'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => handleConfigUpdate({ pushToTalk: mode })}
                className="flex-1 rounded-lg py-1 text-[10px] font-medium transition-all"
                style={{
                  background: config.pushToTalk === mode ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
                  color: config.pushToTalk === mode ? '#fff' : 'var(--text-primary)',
                }}
              >
                {t(`ptt${mode.charAt(0).toUpperCase() + mode.slice(1)}`)}
              </button>
            ))}
          </div>
          {config.pushToTalk !== 'off' && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                {t('pttKey')}:
              </span>
              {config.pushToTalkKeys.map((vk, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: duplicate VK codes possible — index disambiguates
                  key={`${vk}-${i}`}
                  className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium"
                  style={{ borderColor: 'var(--border-medium)', color: 'var(--text-primary)' }}
                >
                  {VK_MAP[vk] || `0x${vk.toString(16)}`}
                  <button
                    type="button"
                    onClick={() => {
                      if (config.pushToTalkKeys.length > 1) {
                        handleConfigUpdate({
                          pushToTalkKeys: config.pushToTalkKeys.filter((k) => k !== vk),
                        })
                      }
                    }}
                    className="rounded p-0.5 leading-none transition-colors hover:bg-white/10"
                    style={{ color: 'var(--text-dim)', fontSize: '10px' }}
                  >
                    \u00d7
                  </button>
                </span>
              ))}
              <button
                type="button"
                disabled={!!rebindingId}
                onClick={() => setRebindingId('hk-ptt')}
                className="rounded-md border border-dashed px-1.5 py-0.5 font-mono text-[10px] font-medium transition-colors hover:bg-white/5 disabled:opacity-60"
                style={{
                  borderColor: rebindingId === 'hk-ptt' ? 'var(--accent)' : 'var(--border-medium)',
                  color: rebindingId === 'hk-ptt' ? 'var(--accent)' : 'var(--text-dim)',
                }}
              >
                {rebindingId === 'hk-ptt' ? '...' : `+ ${t('pttKey')}`}
              </button>
            </div>
          )}
        </div>
      </CollapsibleMini>

      {/* Volume Sliders */}
      <div className="space-y-2">
        <VolumeSlider
          label={t('gameVolume')}
          value={config.gameVolume ?? 1}
          onChange={(v) => handleConfigUpdate({ gameVolume: v })}
        />
        <VolumeSlider
          label={t('micVolume')}
          value={config.micVolume ?? 1}
          onChange={(v) => handleConfigUpdate({ micVolume: v })}
        />
      </div>

      {/* Sample Rate */}
      <div className="space-y-1">
        <span className="text-[10px] font-medium" style={{ color: 'var(--text-dim)' }}>
          {t('audioSampleRate')}
          <TipBadge id="sample-rate" activeTip={activeTip} setActiveTip={setActiveTip} />
        </span>
        <div className="flex gap-1">
          {[44100, 48000, 96000].map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => handleConfigUpdate({ audioSampleRate: rate })}
              className="flex-1 rounded-lg py-1 text-[10px] font-medium transition-all"
              style={{
                background: (config.audioSampleRate ?? 48000) === rate ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
                color: (config.audioSampleRate ?? 48000) === rate ? '#fff' : 'var(--text-primary)',
              }}
            >
              {rate / 1000}
              {t('kilohertz')}
            </button>
          ))}
        </div>
      </div>

      {/* Game Audio Only */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
            {t('gameAudioOnly')}
          </span>
          <TipBadge id="game-audio" activeTip={activeTip} setActiveTip={setActiveTip} />
          {status.currentGame && config.gameAudioOnly && (
            <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[9px] font-medium text-green-500">
              {status.currentGame}
            </span>
          )}
        </div>
        <TogglePill
          data-testid="gameAudioOnly-toggle"
          enabled={config.gameAudioOnly}
          accent="blue"
          onToggle={() => {
            const newVal = !config.gameAudioOnly
            handleConfigUpdate({
              gameAudioOnly: newVal,
              ...(newVal ? { micEnabled: true, audioLoopback: false } : { audioLoopback: true }),
            })
          }}
        />
      </div>

      {/* AutoCleanup */}
      <div className="space-y-1.5 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
            {t('autoCleanup')}
          </span>
          <TogglePill
            enabled={config.autoCleanupEnabled ?? true}
            accent="blue"
            onToggle={() => handleConfigUpdate({ autoCleanupEnabled: !(config.autoCleanupEnabled ?? true) })}
          />
        </div>
        {(config.autoCleanupEnabled ?? true) && (
          <AutoCleanupThresholdPicker
            value={config.autoCleanupThresholdGB ?? 20}
            onChange={(gb) => handleConfigUpdate({ autoCleanupThresholdGB: gb })}
          />
        )}
      </div>

      {/* Microphone Device Selector */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
          {t('micDevice')}
        </span>
        <div className="flex items-center gap-1.5">
          {loadingMicDevices ? (
            <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
              {t('loadingMicDevices')}
            </span>
          ) : (
            <select
              value={config.micDeviceId || ''}
              onChange={(e) => handleConfigUpdate({ micDeviceId: e.target.value })}
              className="rounded-md border bg-transparent px-2 py-1 text-[10px] outline-none"
              style={{ borderColor: 'var(--border-medium)', color: 'var(--text-primary)' }}
            >
              <option value="">{t('defaultMic')}</option>
              {micDevices.map((d) => (
                <option key={d.id} value={d.id} style={{ color: '#000' }}>
                  {d.name}
                  {d.isDefault ? ` (${t('defaultMic')})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* App Audio Sessions */}
      <CollapsibleMini
        label={
          <span className="flex items-center gap-1.5">
            {t('audioSessions')}
            <TipBadge id="audio-sessions" activeTip={activeTip} setActiveTip={setActiveTip} />
          </span>
        }
        defaultOpen={false}
      >
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
              {audioSessions.length > 0 ? t('audioSessionsCount') : t('audioSessionsEmpty')}
            </span>
            <button
              type="button"
              onClick={() => void loadSessions()}
              title={t('refreshSessions')}
              className="rounded p-0.5 transition-colors hover:bg-white/10"
              style={{ color: 'var(--text-dim)' }}
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
          <p className="px-1 text-[9px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
            {t('audioSessionsHint')}
          </p>
          <div className="max-h-44 space-y-1 overflow-y-auto pr-0.5">
            {audioSessions.map((s) => {
              const selected = (config.selectedAudioSessions ?? []).includes(s.processId)
              return (
                <div
                  key={s.processId}
                  className="flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
                  style={{ borderColor: selected ? 'var(--accent)' : 'var(--border-subtle)' }}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>
                      {s.displayName}
                    </div>
                    <div className="truncate text-[9px]" style={{ color: 'var(--text-dim)' }}>
                      {s.processName} &middot; PID {s.processId}
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid={`audio-session-${s.processId}`}
                    onClick={() => toggleSession(s.processId)}
                    className="shrink-0 rounded-md px-2 py-0.5 text-[9px] font-semibold transition-all"
                    style={{
                      background: selected ? 'rgba(113,113,122,0.1)' : 'var(--accent)',
                      color: selected ? 'var(--text-dim)' : '#fff',
                    }}
                  >
                    {selected ? t('sessionRemove') : t('sessionInclude')}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </CollapsibleMini>
    </div>
  )
}

function AutoCleanupThresholdPicker({ value, onChange }: { value: number; onChange: (gb: number) => void }) {
  const { t } = useTranslation('clips')
  const presets = [10, 20, 50]
  const isPreset = presets.includes(value)
  const [draft, setDraft] = useState(String(value))

  const commit = (raw: string) => {
    const n = Number(raw)
    if (Number.isNaN(n)) {
      setDraft(String(value))
      return
    }
    const clamped = Math.max(1, Math.min(100, Math.round(n)))
    setDraft(String(clamped))
    if (clamped !== value) onChange(clamped)
  }

  return (
    <div className="flex gap-1">
      {presets.map((gb) => (
        <button
          key={gb}
          type="button"
          onClick={() => {
            setDraft(String(gb))
            onChange(gb)
          }}
          className="flex-1 rounded-lg py-1 text-[10px] font-medium transition-all"
          style={{
            background: value === gb ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
            color: value === gb ? '#fff' : 'var(--text-primary)',
          }}
        >
          {gb} {t('gigabytes')}
        </button>
      ))}
      <input
        type="number"
        min={1}
        max={100}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit((e.target as HTMLInputElement).value)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className="w-16 rounded-lg border bg-transparent px-1.5 py-1 text-center text-[10px] font-medium outline-none"
        style={{
          borderColor: !isPreset ? 'var(--accent)' : 'var(--border-medium)',
          color: 'var(--text-primary)',
        }}
      />
    </div>
  )
}
