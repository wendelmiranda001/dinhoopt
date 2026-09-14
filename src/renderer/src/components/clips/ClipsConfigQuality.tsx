import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { QUALITY_PRESETS, type QualityPresetKey } from './clips-quality-presets'
import { TogglePill } from './clips-utils'
import type { ClipsState } from './useClipsState'

export function TipBadge({
  id,
  activeTip,
  setActiveTip,
}: {
  id: string
  activeTip: string | null
  setActiveTip: (tip: string | null) => void
}) {
  return (
    <span className="relative inline-flex" data-tip={id}>
      <button
        type="button"
        className="inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full text-[9px] font-bold"
        style={{ background: 'rgba(113,113,122,0.15)', color: 'var(--text-dim)' }}
        onClick={() => setActiveTip(activeTip === id ? null : id)}
      >
        ?
      </button>
    </span>
  )
}

export function QualitySection({
  config,
  status: _status,
  activeTip,
  setActiveTip,
  gpuList,
  estimatedRamMB,
  handleConfigUpdate,
  t,
}: Pick<
  ClipsState,
  'config' | 'status' | 'activeTip' | 'setActiveTip' | 'gpuList' | 'estimatedRamMB' | 'handleConfigUpdate' | 't'
>) {
  const [gpuOpen, setGpuOpen] = useState(false)
  if (!config) return null
  const replayPresets = [30, 120, 300]
  const isCustomReplay = !replayPresets.includes(config.replayTimeSeconds)
  const formatReplay = (s: number) =>
    s < 60
      ? `${s}${t('s')}`
      : s % 60 === 0
        ? `${s / 60}${t('min')}`
        : `${Math.floor(s / 60)}${t('min')} ${s % 60}${t('s')}`
  return (
    <div className="space-y-3">
      {/* Quick Preset */}
      <div className="flex gap-1.5">
        {(
          [
            { id: 'muito-alta', label: t('presetMuitoAlta'), sub: 'CQ 16 \u00b7 1080p', icon: '\u25cf\u25cf\u25cf' },
            { id: 'alta', label: t('presetAlta'), sub: 'CQ 18 \u00b7 1080p', icon: '\u25cf\u25cf\u25cb' },
            { id: 'boa', label: t('presetBoa'), sub: 'CQ 20 \u00b7 720p', icon: '\u25cf\u25cb\u25cb' },
          ] as Array<{ id: QualityPresetKey; label: string; sub: string; icon: string }>
        ).map((p) => {
          const preset = QUALITY_PRESETS[p.id]
          const active = config.cq === preset.cq && config.maxrateKbps === preset.maxrateKbps
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => handleConfigUpdate(preset)}
              className={`group relative flex-1 rounded-xl border px-2.5 py-2 text-left transition-all ${
                active ? 'border-transparent' : 'hover:border-white/10'
              }`}
              style={{
                background: active ? 'var(--accent)' : 'rgba(113,113,122,0.06)',
                borderColor: active ? 'transparent' : 'rgba(113,113,122,0.1)',
                boxShadow: 'none',
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold" style={{ color: active ? '#fff' : 'var(--text-primary)' }}>
                  {p.label}
                </span>
                <span
                  className="text-[9px] tracking-wider"
                  style={{
                    color: active ? '#fff' : 'var(--text-dim)',
                    opacity: active ? 0.7 : 0.5,
                  }}
                >
                  {p.icon}
                </span>
              </div>
              <div
                className="mt-0.5 text-[9px]"
                style={{
                  color: active ? '#fff' : 'var(--text-dim)',
                  opacity: active ? 0.7 : 0.6,
                }}
              >
                {p.sub}
              </div>
            </button>
          )
        })}
      </div>

      {/* Codec selector */}
      <div>
        <p className="mb-1 text-[10px] font-medium tracking-wide uppercase" style={{ color: 'var(--text-dim)' }}>
          {t('codec')}
          <TipBadge id="codec" activeTip={activeTip} setActiveTip={setActiveTip} />
        </p>
        <div className="flex flex-wrap gap-1">
          {[
            { id: 'auto', labelKey: 'codecAuto' },
            { id: 'h264', labelKey: 'codecH264' },
            { id: 'hevc', labelKey: 'codecHevc' },
            { id: 'av1', labelKey: 'codecAv1' },
            { id: 'libx264', labelKey: 'codecSwH264' },
            { id: 'libx265', labelKey: 'codecSwHevc' },
          ].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => handleConfigUpdate({ codec: c.id })}
              className="rounded-lg py-1 px-2 text-[10px] font-medium transition-all"
              style={{
                background: (config.codec ?? 'auto') === c.id ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
                color: (config.codec ?? 'auto') === c.id ? '#fff' : 'var(--text-primary)',
              }}
            >
              {t(c.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* GPU selector */}
      {gpuList.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-medium tracking-wide uppercase" style={{ color: 'var(--text-dim)' }}>
            {t('gpuLabel')}
            <TipBadge id="gpu" activeTip={activeTip} setActiveTip={setActiveTip} />
          </p>
          <div className="relative">
            <button
              type="button"
              onClick={() => setGpuOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[11px] transition-all"
              style={{
                background: 'rgba(113,113,122,0.08)',
                color: 'var(--text-primary)',
                border: '1px solid rgba(113,113,122,0.15)',
              }}
            >
              <span className="truncate">
                {config.adapterIndex === undefined || config.adapterIndex === -1
                  ? t('codecAuto')
                  : (gpuList.find((g) => g.index === config.adapterIndex)?.name ?? t('codecAuto'))}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0" style={{ color: 'var(--text-dim)' }} />
            </button>
            {gpuOpen && (
              <>
                <div aria-hidden="true" className="fixed inset-0 z-20" onMouseDown={() => setGpuOpen(false)} />
                <div
                  className="absolute z-30 mt-1 max-h-48 w-full overflow-y-auto rounded-lg py-1"
                  style={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-medium)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                  }}
                >
                  {[{ index: -1, name: t('codecAuto') }, ...gpuList].map((gpu) => (
                    <button
                      key={gpu.index}
                      type="button"
                      onClick={() => {
                        handleConfigUpdate({ adapterIndex: gpu.index })
                        setGpuOpen(false)
                      }}
                      className="block w-full truncate px-2.5 py-1.5 text-left text-[11px] transition-colors hover:bg-white/[0.05]"
                      style={{
                        color: (config.adapterIndex ?? -1) === gpu.index ? 'var(--accent)' : 'var(--text-primary)',
                      }}
                    >
                      {gpu.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Resolution + FPS side by side */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="mb-1 text-[10px] font-medium tracking-wide uppercase" style={{ color: 'var(--text-dim)' }}>
            {t('resolution')}
            <TipBadge id="resolution" activeTip={activeTip} setActiveTip={setActiveTip} />
          </p>
          <div className="flex gap-1">
            {[
              { w: 854, h: 480, l: '480p' },
              { w: 1280, h: 720, l: '720p' },
              { w: 1920, h: 1080, l: '1080p' },
            ].map((r) => (
              <button
                key={r.l}
                type="button"
                onClick={() => handleConfigUpdate({ width: r.w, height: r.h })}
                className="flex-1 rounded-lg py-1 text-[11px] font-medium transition-all"
                style={{
                  background: r.w === config.width ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
                  color: r.w === config.width ? '#fff' : 'var(--text-primary)',
                }}
              >
                {r.l}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-medium tracking-wide uppercase" style={{ color: 'var(--text-dim)' }}>
            {t('fps')}
            <TipBadge id="fps" activeTip={activeTip} setActiveTip={setActiveTip} />
          </p>
          <div className="flex gap-1">
            {[30, 60, 75, 120].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => handleConfigUpdate({ fps: f })}
                className="flex-1 rounded-lg py-1 text-[11px] font-medium transition-all"
                style={{
                  background: f === config.fps ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
                  color: f === config.fps ? '#fff' : 'var(--text-primary)',
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stretch to fit (remove black bars) */}
      <div className="rounded-lg px-2.5 py-2" style={{ background: 'rgba(113,113,122,0.06)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
              {t('stretchToFit')}
            </span>
            <TipBadge id="stretch-to-fit" activeTip={activeTip} setActiveTip={setActiveTip} />
          </div>
          <TogglePill
            enabled={config.stretchToFit ?? false}
            accent="blue"
            onToggle={() => handleConfigUpdate({ stretchToFit: !(config.stretchToFit ?? false) })}
          />
        </div>
      </div>

      {/* Replay buffer mode (RAM + disk) */}
      <div className="rounded-lg px-2.5 py-2" style={{ background: 'rgba(113,113,122,0.06)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
              {t('replayBufferMode')}
            </span>
            <TipBadge id="replay-buffer-mode" activeTip={activeTip} setActiveTip={setActiveTip} />
          </div>
          <TogglePill
            enabled={(config.replayBufferMode ?? 'ram') === 'hybrid'}
            accent="blue"
            onToggle={() =>
              handleConfigUpdate({
                replayBufferMode: (config.replayBufferMode ?? 'ram') === 'hybrid' ? 'ram' : 'hybrid',
              })
            }
          />
        </div>
      </div>

      {/* Replay Time */}
      <div>
        <p className="mb-1 text-[10px] font-medium tracking-wide uppercase" style={{ color: 'var(--text-dim)' }}>
          {t('replayTime')}
          <TipBadge id="replay" activeTip={activeTip} setActiveTip={setActiveTip} />
        </p>
        <div className="flex gap-1">
          {[
            { s: 30, label: t('replayPreset30s') },
            { s: 120, label: t('replayPreset2min') },
            { s: 300, label: t('replayPreset5min') },
          ].map(({ s, label }) => (
            <button
              key={s}
              type="button"
              onClick={() => handleConfigUpdate({ replayTimeSeconds: s })}
              className="flex-1 rounded-lg py-1 text-[11px] font-medium transition-all"
              style={{
                background: s === config.replayTimeSeconds ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
                color: s === config.replayTimeSeconds ? '#fff' : 'var(--text-primary)',
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleConfigUpdate({ replayTimeSeconds: isCustomReplay ? config.replayTimeSeconds : 150 })}
            className="flex-1 rounded-lg py-1 text-[11px] font-medium transition-all"
            style={{
              background: isCustomReplay ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
              color: isCustomReplay ? '#fff' : 'var(--text-primary)',
            }}
          >
            {t('replayCustom')}
          </button>
        </div>
        {isCustomReplay && (
          <div className="mt-2 rounded-lg px-2.5 py-2" style={{ background: 'rgba(113,113,122,0.06)' }}>
            <input
              type="range"
              min={30}
              max={600}
              step={5}
              value={Math.max(30, Math.min(600, config.replayTimeSeconds))}
              onChange={(e) => handleConfigUpdate({ replayTimeSeconds: Number(e.target.value) })}
              className="w-full"
            />
            <div className="mt-1 flex justify-between text-[10px]">
              <span style={{ color: 'var(--text-dim)' }}>{t('replayMin')}</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                {formatReplay(config.replayTimeSeconds)}
              </span>
              <span style={{ color: 'var(--text-dim)' }}>{t('replayMax')}</span>
            </div>
          </div>
        )}
        {config.replayTimeSeconds >= 300 && (
          <div
            className="mt-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[10px] leading-snug"
            style={{ color: '#f87171' }}
          >
            {t('replayRamWarning')}
          </div>
        )}
      </div>

      {/* Force Software Encoding */}
      <div className="rounded-lg px-2.5 py-2" style={{ background: 'rgba(113,113,122,0.06)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
              {t('forceSoftware')}
            </span>
            <TipBadge id="force-software" activeTip={activeTip} setActiveTip={setActiveTip} />
          </div>
          <TogglePill
            enabled={config.forceSoftware ?? false}
            accent="blue"
            onToggle={() => handleConfigUpdate({ forceSoftware: !(config.forceSoftware ?? false) })}
          />
        </div>
      </div>

      {/* Adaptive Quality */}
      <div className="rounded-lg px-2.5 py-2" style={{ background: 'rgba(113,113,122,0.06)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
              {t('adaptiveQuality')}
            </span>
            <TipBadge id="adaptive-quality" activeTip={activeTip} setActiveTip={setActiveTip} />
          </div>
          <TogglePill
            enabled={config.adaptiveQuality ?? true}
            accent="blue"
            onToggle={() => handleConfigUpdate({ adaptiveQuality: !(config.adaptiveQuality ?? true) })}
          />
        </div>
        {(config.adaptiveQuality ?? true) && _status.calibrationTier ? (
          <div
            className="mt-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px]"
            style={{ background: 'rgba(59,130,246,0.12)', color: '#60a5fa' }}
          >
            <span>{t('calibrationActive', { tier: _status.calibrationTier })}</span>
          </div>
        ) : null}
      </div>

      {/* Buffer Usage */}
      {estimatedRamMB > 0 && (
        <div>
          <div className="mb-1 flex justify-between text-[10px]">
            <span style={{ color: 'var(--text-dim)' }}>{t('ramLabel')}</span>
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {_status.replayBufferBytes
                ? `${Math.round(_status.replayBufferBytes / 1024 / 1024)} ${t('megabytes')}`
                : `~${estimatedRamMB} ${t('megabytes')}`}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(113,113,122,0.12)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${
                  _status.replayBufferBytes
                    ? Math.min((_status.replayBufferBytes / 1024 / 1024 / estimatedRamMB) * 100, 100)
                    : 0
                }%`,
                background: estimatedRamMB > 3000 ? '#ef4444' : estimatedRamMB > 1500 ? '#f59e0b' : '#3b82f6',
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
