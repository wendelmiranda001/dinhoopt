import type { TFunction } from 'i18next'
import { Gamepad2, Plus, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CollapsibleMini, formatKey, GamePickerBtn, REPLAY_DURATIONS, TogglePill } from './clips-utils'
import type { ClipsState } from './useClipsState'

export function GameSection({
  config,
  status,
  rebindingId,
  setRebindingId,
  handleConfigUpdate,
  addHotkey,
  removeHotkey,
  updateHotkey,
  setProcesses,
  setShowProcPicker,
  t,
}: Pick<
  ClipsState,
  | 'config'
  | 'status'
  | 'rebindingId'
  | 'setRebindingId'
  | 'handleConfigUpdate'
  | 'addHotkey'
  | 'removeHotkey'
  | 'updateHotkey'
  | 'setProcesses'
  | 'setShowProcPicker'
  | 't'
>) {
  const { t: tClips } = useTranslation('clips')
  if (!config) return null
  return (
    <div className="space-y-2.5">
      {/* Game Detection toggle */}
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
          {t('gameDetection')}
        </span>
        <TogglePill
          enabled={config.gameDetection}
          onToggle={() => handleConfigUpdate({ gameDetection: !config.gameDetection })}
        />
      </div>
      {/* Auto-start capture */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
            {t('autoStartCapture')}
          </span>
          <span className="text-[9px] opacity-50" style={{ color: 'var(--text-dim)' }}>
            {t('autoStartCaptureDesc')}
          </span>
        </div>
        <TogglePill
          enabled={config.autoStartCapture ?? false}
          onToggle={() => handleConfigUpdate({ autoStartCapture: !config.autoStartCapture })}
        />
      </div>
      {/* Detected game */}
      {status.running && status.currentGame && (
        <div
          className="flex items-center justify-between rounded-lg px-2 py-1.5"
          style={{ background: 'rgba(34,197,94,0.08)' }}
        >
          <div className="flex items-center gap-1.5">
            <Gamepad2 className="h-3 w-3" style={{ color: '#22c55e' }} />
            <span className="text-xs font-medium" style={{ color: '#22c55e' }}>
              {status.currentGame}
            </span>
          </div>
        </div>
      )}
      {/* Custom Game */}
      <div className="flex items-center justify-between">
        <span className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>
          {config.customGameProcess || <span style={{ color: 'var(--text-dim)' }}>{t('noGameDetected')}</span>}
        </span>
        <GamePickerBtn
          config={config}
          onClear={() => handleConfigUpdate({ customGameProcess: '' })}
          onOpenPicker={async () => {
            const list = await window.dinho?.clipsGetRunningProcesses()
            if (list && list.length > 0) setProcesses(list)
            setShowProcPicker(true)
          }}
        />
      </div>

      {/* Hotkeys */}
      <CollapsibleMini label={t('hotkeys')} defaultOpen={false}>
        <div className="space-y-1.5">
          {config.hotkeys.map((hk) => (
            <div
              key={hk.id}
              className="rounded-lg px-2 py-1.5"
              style={{ background: 'rgba(113,113,122,0.06)', opacity: hk.enabled ? 1 : 0.4 }}
            >
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setRebindingId(hk.id)}
                  disabled={!!rebindingId}
                  className="shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium transition-all disabled:opacity-60"
                  style={{
                    borderColor: rebindingId === hk.id ? 'var(--accent)' : 'var(--border-medium)',
                    color: rebindingId === hk.id ? 'var(--accent)' : 'var(--text-primary)',
                  }}
                >
                  {rebindingId === hk.id ? '...' : formatKey(hk.vk, hk.modifiers)}
                </button>
                <select
                  value={hk.action}
                  onChange={(e) =>
                    updateHotkey(hk.id, { action: e.target.value as import('@shared/types').HotkeyAction })
                  }
                  className="rounded-md border bg-transparent px-1 py-0.5 text-[10px] outline-none"
                  style={{
                    borderColor: 'var(--border-medium)',
                    color: 'var(--text-primary)',
                    colorScheme: 'dark',
                  }}
                >
                  <option value="saveClip">{tClips('actionSaveClipLabel')}</option>
                  <option value="toggleCapture">{tClips('actionToggleCaptureLabel')}</option>
                  <option value="toggleMic">{tClips('actionToggleMicLabel')}</option>
                  <option value="pushToTalk">{tClips('actionPushToTalkLabel')}</option>
                </select>
                {hk.action === 'saveClip' && (
                  <select
                    value={hk.replayDurationSeconds || 60}
                    onChange={(e) => updateHotkey(hk.id, { replayDurationSeconds: Number(e.target.value) })}
                    className="rounded-md border bg-transparent px-1 py-0.5 text-[10px] outline-none"
                    style={{
                      borderColor: 'var(--border-medium)',
                      color: 'var(--text-primary)',
                      colorScheme: 'dark',
                    }}
                  >
                    {REPLAY_DURATIONS.map((d) => (
                      <option key={d} value={d}>
                        {d < 60 ? `${d}${t('s')}` : `${d / 60}${t('min')}`}
                      </option>
                    ))}
                  </select>
                )}
                <div className="ml-auto flex items-center gap-0.5">
                  <TogglePill
                    enabled={hk.enabled}
                    accent="blue"
                    onToggle={() => updateHotkey(hk.id, { enabled: !hk.enabled })}
                  />
                  <button
                    type="button"
                    onClick={() => removeHotkey(hk.id)}
                    className="rounded p-0.5 transition-colors hover:bg-red-500/10"
                  >
                    <X className="h-2.5 w-2.5" style={{ color: '#ef4444' }} />
                  </button>
                </div>
              </div>
              <p className="mt-1 px-0.5 text-[9px] leading-tight" style={{ color: 'var(--text-dim)', opacity: 0.7 }}>
                {hk.action === 'saveClip' && t('saveClipDesc')}
                {hk.action === 'toggleCapture' && t('toggleCaptureDesc')}
                {hk.action === 'toggleMic' && t('toggleMicDesc')}
                {hk.action === 'pushToTalk' && t('pushToTalkDesc')}
              </p>
            </div>
          ))}
          <div className="flex items-center pt-1">
            <button
              type="button"
              onClick={addHotkey}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-all"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              <Plus className="h-3 w-3" />
              {t('addHotkey')}
            </button>
          </div>
        </div>
      </CollapsibleMini>
    </div>
  )
}

export function ProcessPicker({
  procSearch,
  setProcSearch,
  processes,
  onSelect,
  onClose,
  t,
}: {
  procSearch: string
  setProcSearch: (v: string) => void
  processes: Array<{ name: string; pid: number }>
  onSelect: (name: string) => void
  onClose: () => void
  t: TFunction<'clips'>
}) {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={onClose}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: popover panel that must intercept mousedown to prevent backdrop close */}
      <div
        className="w-80 max-h-96 rounded-xl border p-4 shadow-xl"
        style={{ background: 'var(--card-bg)', borderColor: 'var(--border-subtle)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
          {t('selectProcess')}
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
          <input
            type="text"
            value={procSearch}
            onChange={(e) => setProcSearch(e.target.value)}
            className="w-full rounded-lg border bg-transparent py-1.5 pl-7 pr-2 text-xs outline-none"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            placeholder={t('searchProcess')}
          />
        </div>
        <div className="max-h-60 overflow-y-auto space-y-0.5">
          {processes
            .filter((p) => !procSearch || p.name.toLowerCase().includes(procSearch.toLowerCase()))
            .slice(0, 100)
            .map((p) => (
              <button
                key={p.pid}
                type="button"
                onClick={() => onSelect(p.name)}
                className="w-full rounded px-2 py-1 text-left text-xs transition-all hover:bg-white/5"
                style={{ color: 'var(--text-primary)' }}
              >
                <span className="font-medium">{p.name}</span>
                <span className="ml-2" style={{ color: 'var(--text-dim)' }}>
                  {t('pidLabel', { pid: p.pid })}
                </span>
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}
