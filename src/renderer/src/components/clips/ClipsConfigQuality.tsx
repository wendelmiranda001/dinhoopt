import { ChevronDown, Gauge, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { QUALITY_PRESETS, type QualityPresetKey } from './clips-quality-presets'
import { SegmentedControl, TogglePill } from './clips-utils'
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
  const active = activeTip === id
  return (
    <span className="relative inline-flex" data-tip={id}>
      <button
        type="button"
        className="inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full text-[9px] font-bold transition-all duration-150"
        style={{
          background: active ? 'rgba(139,92,246,0.2)' : 'rgba(113,113,122,0.15)',
          color: active ? 'var(--accent)' : 'var(--text-dim)',
        }}
        onClick={() => setActiveTip(active ? null : id)}
      >
        ?
      </button>
    </span>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold tracking-wide uppercase"
      style={{ color: 'var(--text-dim)' }}
    >
      {children}
    </p>
  )
}

function ToggleRow({
  title,
  tip,
  activeTip,
  setActiveTip,
  enabled,
  tooltipId,
  onToggle,
}: {
  title: string
  tip?: string
  activeTip?: ClipsState['activeTip']
  setActiveTip?: ClipsState['setActiveTip']
  enabled: boolean
  tooltipId: string
  onToggle: () => void
}) {
  return (
    <div
      className="flex items-center justify-between rounded-xl px-3 py-2.5"
      style={{
        background: `linear-gradient(180deg, rgba(255,255,255,0.03), transparent 55%), var(--card-bg)`,
        border: `1px solid ${enabled ? `rgba(59,130,246,0.35)` : 'var(--border-subtle)'}`,
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium" style={{ color: 'var(--text-primary)' }}>
          {title}
        </span>
        {tip && activeTip && setActiveTip && (
          <TipBadge id={tooltipId} activeTip={activeTip} setActiveTip={setActiveTip} />
        )}
      </div>
      <TogglePill accent="blue" enabled={enabled} onToggle={onToggle} />
    </div>
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
      <div className="grid grid-cols-3 gap-1.5">
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
              className="relative overflow-hidden rounded-xl border px-2 py-2 transition-all duration-150"
              style={{
                background: active
                  ? 'linear-gradient(160deg, rgba(139,92,246,0.22), rgba(139,92,246,0.06))'
                  : 'rgba(113,113,122,0.05)',
                borderColor: active ? 'rgba(139,92,246,0.5)' : 'var(--border-subtle)',
                boxShadow: active ? '0 4px 16px rgba(139,92,246,0.15)' : 'none',
              }}
            >
              <div
                className="mb-1 text-[9px] tracking-[0.08em]"
                style={{ color: active ? 'var(--accent)' : 'var(--text-dim)', opacity: active ? 1 : 0.6 }}
              >
                {p.icon}
              </div>
              <div
                className="text-[11px] font-semibold leading-tight"
                style={{ color: active ? '#fff' : 'var(--text-primary)' }}
              >
                {p.label}
              </div>
              <div
                className="mt-0.5 text-[8px] font-medium"
                style={{ color: active ? 'rgba(255,255,255,0.7)' : 'var(--text-dim)', opacity: active ? 1 : 0.7 }}
              >
                {p.sub}
              </div>
            </button>
          )
        })}
      </div>

      {/* Codec selector */}
      <div>
        <FieldLabel>
          {t('codec')}
          <TipBadge id="codec" activeTip={activeTip} setActiveTip={setActiveTip} />
        </FieldLabel>
        <SegmentedControl
          layoutId="codec"
          wrap
          options={[
            { value: 'auto', label: t('codecAuto') },
            { value: 'h264', label: t('codecH264') },
            { value: 'hevc', label: t('codecHevc') },
            { value: 'av1', label: t('codecAv1') },
            { value: 'libx264', label: t('codecSwH264') },
            { value: 'libx265', label: t('codecSwHevc') },
          ]}
          value={(config.codec ?? 'auto') as 'auto' | 'h264' | 'hevc' | 'av1' | 'libx264' | 'libx265'}
          onChange={(codec) => handleConfigUpdate({ codec })}
        />
      </div>

      {/* GPU selector */}
      {gpuList.length > 0 && (
        <div>
          <FieldLabel>
            {t('gpuLabel')}
            <TipBadge id="gpu" activeTip={activeTip} setActiveTip={setActiveTip} />
          </FieldLabel>
          <div className="relative">
            <button
              type="button"
              onClick={() => setGpuOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-[11px] transition-all"
              style={{
                background: 'rgba(113,113,122,0.06)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <span className="truncate">
                {config.adapterIndex === undefined || config.adapterIndex === -1
                  ? t('codecAuto')
                  : (gpuList.find((g) => g.index === config.adapterIndex)?.name ?? t('codecAuto'))}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0 transition-transform" style={{ color: 'var(--text-dim)' }} />
            </button>
            {gpuOpen && (
              <>
                <div aria-hidden="true" className="fixed inset-0 z-20" onMouseDown={() => setGpuOpen(false)} />
                <div
                  className="absolute z-30 mt-1 max-h-48 w-full overflow-y-auto rounded-xl py-1"
                  style={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-medium)',
                    boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
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
                      className="block w-full truncate px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-white/[0.05]"
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
      <div className="grid grid-cols-2 gap-2">
        <div>
          <FieldLabel>
            {t('resolution')}
            <TipBadge id="resolution" activeTip={activeTip} setActiveTip={setActiveTip} />
          </FieldLabel>
          <SegmentedControl
            layoutId="resolution"
            options={[
              { value: '854', label: '480p' },
              { value: '1280', label: '720p' },
              { value: '1920', label: '1080p' },
            ]}
            value={String(config.width) as '854' | '1280' | '1920'}
            onChange={(v) => {
              const w = Number(v)
              handleConfigUpdate({ width: w, height: w === 854 ? 480 : w === 1280 ? 720 : 1080 })
            }}
          />
        </div>
        <div>
          <FieldLabel>
            {t('fps')}
            <TipBadge id="fps" activeTip={activeTip} setActiveTip={setActiveTip} />
          </FieldLabel>
          <SegmentedControl
            layoutId="fps"
            options={[
              { value: '30', label: '30' },
              { value: '60', label: '60' },
              { value: '75', label: '75' },
              { value: '120', label: '120' },
            ]}
            value={String(config.fps) as '30' | '60' | '75' | '120'}
            onChange={(v) => handleConfigUpdate({ fps: Number(v) })}
          />
        </div>
      </div>

      {/* Stretch to fit (remove black bars) */}
      <ToggleRow
        title={t('stretchToFit')}
        tip={t('stretchToFitTooltip')}
        tooltipId="stretch-to-fit"
        activeTip={activeTip}
        setActiveTip={setActiveTip}
        enabled={config.stretchToFit ?? false}
        onToggle={() => handleConfigUpdate({ stretchToFit: !(config.stretchToFit ?? false) })}
      />

      {/* Replay buffer mode (RAM + disk) */}
      <ToggleRow
        title={t('replayBufferMode')}
        tip={t('replayBufferModeTooltip')}
        tooltipId="replay-buffer-mode"
        activeTip={activeTip}
        setActiveTip={setActiveTip}
        enabled={(config.replayBufferMode ?? 'ram') === 'hybrid'}
        onToggle={() =>
          handleConfigUpdate({
            replayBufferMode: (config.replayBufferMode ?? 'ram') === 'hybrid' ? 'ram' : 'hybrid',
          })
        }
      />

      {/* Replay Time */}
      <div
        className="rounded-xl px-3 py-2.5"
        style={{ background: 'rgba(113,113,122,0.05)', border: '1px solid var(--border-subtle)' }}
      >
        <FieldLabel>
          {t('replayTime')}
          <TipBadge id="replay" activeTip={activeTip} setActiveTip={setActiveTip} />
        </FieldLabel>
        <SegmentedControl
          layoutId="replay"
          options={[
            { value: '30', label: t('replayPreset30s') },
            { value: '120', label: t('replayPreset2min') },
            { value: '300', label: t('replayPreset5min') },
            {
              value: 'custom',
              label: t('replayCustom'),
              ...(isCustomReplay ? { title: `${formatReplay(config.replayTimeSeconds)}` } : {}),
            },
          ]}
          value={isCustomReplay ? 'custom' : String(config.replayTimeSeconds)}
          onChange={(v) =>
            handleConfigUpdate({ replayTimeSeconds: v === 'custom' ? config.replayTimeSeconds || 150 : Number(v) })
          }
        />
        {isCustomReplay && (
          <div className="mt-2">
            <input
              type="range"
              min={30}
              max={600}
              step={5}
              value={Math.max(30, Math.min(600, config.replayTimeSeconds))}
              onChange={(e) => handleConfigUpdate({ replayTimeSeconds: Number(e.target.value) })}
              className="clip-range w-full"
              style={{
                background: `linear-gradient(to right, var(--accent) ${
                  ((Math.max(30, Math.min(600, config.replayTimeSeconds)) - 30) / 570) * 100
                }%, rgba(113,113,122,0.2) ${((Math.max(30, Math.min(600, config.replayTimeSeconds)) - 30) / 570) * 100}%)`,
              }}
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
            className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[10px] leading-snug"
            style={{ color: '#f87171' }}
          >
            {t('replayRamWarning')}
          </div>
        )}
      </div>

      {/* Force Software Encoding */}
      <ToggleRow
        title={t('forceSoftware')}
        tip={t('forceSoftwareTooltip')}
        tooltipId="force-software"
        activeTip={activeTip}
        setActiveTip={setActiveTip}
        enabled={config.forceSoftware ?? false}
        onToggle={() => handleConfigUpdate({ forceSoftware: !(config.forceSoftware ?? false) })}
      />

      {/* Adaptive Quality */}
      <ToggleRow
        title={t('adaptiveQuality')}
        tip={t('tooltipAdaptiveQuality')}
        tooltipId="adaptive-quality"
        activeTip={activeTip}
        setActiveTip={setActiveTip}
        enabled={config.adaptiveQuality ?? true}
        onToggle={() => handleConfigUpdate({ adaptiveQuality: !(config.adaptiveQuality ?? true) })}
      />
      {(config.adaptiveQuality ?? true) && _status.calibrationTier && (
        <div
          className="flex items-center gap-2 rounded-xl border px-3 py-2"
          style={{
            background: 'linear-gradient(90deg, rgba(139,92,246,0.16), rgba(59,130,246,0.1))',
            borderColor: 'rgba(139,92,246,0.35)',
          }}
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
          <span className="text-[10px] font-medium" style={{ color: 'var(--text-secondary)' }}>
            {t('calibrationActive', { tier: _status.calibrationTier })}
          </span>
        </div>
      )}

      {/* Buffer Usage */}
      {estimatedRamMB > 0 && (
        <div
          className="rounded-xl px-3 py-2.5"
          style={{ background: 'rgba(113,113,122,0.05)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="mb-1.5 flex justify-between text-[10px]">
            <span className="flex items-center gap-1 font-medium" style={{ color: 'var(--text-dim)' }}>
              <Gauge className="h-3 w-3" />
              {t('ramLabel')}
            </span>
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {_status.replayBufferBytes
                ? `${Math.round(_status.replayBufferBytes / 1024 / 1024)} ${t('megabytes')}`
                : `~${estimatedRamMB} ${t('megabytes')}`}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(113,113,122,0.12)' }}>
            <div
              className="relative h-full rounded-full transition-all duration-300"
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
