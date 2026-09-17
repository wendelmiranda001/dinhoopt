import {
  Activity,
  CircleStop,
  Cpu,
  Download,
  Gamepad2,
  HardDrive,
  Loader2,
  Mic,
  Microscope,
  ShieldAlert,
  TriangleAlert,
  Video,
} from 'lucide-react'
import { formatUptime } from './clips-utils'
import type { ClipsState } from './useClipsState'

export function ClipsStatusBar({
  status,
  statusLoaded,
  starting,
  stopping,
  loading,
  estimatedRamMB,
  handleStartRecording,
  handleStopRecording,
  handleSaveClip,
  t,
}: ClipsState) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--border-medium)' }}
    >
      {!statusLoaded ? (
        <div className="space-y-3">
          <div className="h-4 w-32 rounded-md animate-pulse" style={{ background: 'rgba(113,113,122,0.15)' }} />
          <div className="flex gap-2">
            <div className="h-7 w-20 rounded-lg animate-pulse" style={{ background: 'rgba(113,113,122,0.12)' }} />
            <div className="h-7 w-24 rounded-lg animate-pulse" style={{ background: 'rgba(113,113,122,0.12)' }} />
          </div>
        </div>
      ) : (
        <>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {t('recordingStatus')}
          </h3>
          <div className="mt-3 flex flex-wrap gap-3">
            {(() => {
              if (status.running && status.capturing) {
                return (
                  <div
                    className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium"
                    style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}
                  >
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    {t('recording')}
                  </div>
                )
              }
              if (status.running) {
                return (
                  <div
                    className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium"
                    style={{ background: 'rgba(234,179,8,0.12)', color: '#eab308' }}
                  >
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    {t('idle')}
                  </div>
                )
              }
              return (
                <div
                  className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium"
                  style={{ background: 'rgba(113,113,122,0.12)', color: '#71717a' }}
                >
                  <span className="h-2 w-2 rounded-full bg-zinc-500" />
                  {t('stopped')}
                </div>
              )
            })()}
            {status.running && (
              <div
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                style={{ background: 'rgba(113,113,122,0.08)', color: 'var(--text-dim)' }}
              >
                <span>
                  {t('fps')}: {status.fps}
                </span>
                <span className="mx-1">&middot;</span>
                <span>
                  {t('replayTime')}: {Math.floor(status.replayTimeSeconds / 60)}
                  {t('min')}
                </span>
                {status.uptime > 0 && (
                  <>
                    <span className="mx-1">&middot;</span>
                    <span>{formatUptime(status.uptime, t)}</span>
                  </>
                )}
              </div>
            )}
            {status.running && status.micLevel != null && (
              <div
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                style={{ background: 'rgba(113,113,122,0.08)', color: 'var(--text-dim)' }}
                title={t('micLevel')}
              >
                <Mic className="h-3 w-3" />
                <div className="flex items-end gap-0.5">
                  {[0.25, 0.5, 0.75, 0.9, 1].map((th) => (
                    <div
                      key={th}
                      className="w-1 rounded-sm transition-colors"
                      style={{
                        height: `${3 + th * 7}px`,
                        background:
                          (status.micLevel ?? 0) >= th ? (th >= 0.9 ? '#ef4444' : '#22c55e') : 'rgba(113,113,122,0.25)',
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
            {status.running && status.captureBackend && (
              <div
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                style={{ background: 'rgba(113,113,122,0.08)', color: 'var(--text-dim)' }}
              >
                <Cpu className="h-3 w-3" />
                <span>{status.captureBackend}</span>
                {status.encoder && (
                  <>
                    <span className="mx-1">&middot;</span>
                    <span>{status.encoder}</span>
                  </>
                )}
              </div>
            )}
            {status.running && status.currentGame && (
              <div
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                style={{ background: 'rgba(59,130,246,0.12)', color: '#3b82f6' }}
              >
                <Gamepad2 className="h-3 w-3" />
                <span>{status.currentGame}</span>
              </div>
            )}
            {status.running && (status.replayBufferBytes || estimatedRamMB > 0) && (
              <div
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                style={{ background: 'rgba(113,113,122,0.08)', color: 'var(--text-dim)' }}
              >
                <HardDrive className="h-3 w-3" />
                <span>
                  {status.replayBufferBytes
                    ? `${Math.round(status.replayBufferBytes / 1024 / 1024)}${t('megabytes')}`
                    : `~${estimatedRamMB}${t('megabytes')}`}
                </span>
              </div>
            )}
            {status.running && status.memoryMB && status.memoryMB > 0 && (
              <div
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                style={{ background: 'rgba(113,113,122,0.08)', color: 'var(--text-dim)' }}
              >
                <Activity className="h-3 w-3" />
                <span title={t('memoryMBDesc')}>
                  {t('memoryMB')}: {status.memoryMB} {t('megabytes')}
                </span>
              </div>
            )}
            {status.lastCrashRecovered && (
              <div
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                style={{ background: 'rgba(234,179,8,0.12)', color: '#eab308' }}
              >
                <Microscope className="h-3 w-3" />
                <span>{t('crashRecovered')}</span>
              </div>
            )}
            {status.audioFallback && (
              <div
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                style={{ background: 'rgba(234,179,8,0.12)', color: '#eab308' }}
              >
                <TriangleAlert className="h-3 w-3" />
                <span title={t('audioFallbackDesc')}>{t('audioFallbackWarning')}</span>
              </div>
            )}
            {status.running && (status.droppedFrames ?? 0) > 0 && (
              <div
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                style={{ background: 'rgba(234,179,8,0.12)', color: '#eab308' }}
              >
                <TriangleAlert className="h-3 w-3" />
                <span title={t('droppedFramesTooltip')}>
                  {t('droppedFrames')}: {status.droppedFrames}
                  {(status.gpuBusyDrops ?? 0) > 0 && <span className="ml-1">(GPU: {status.gpuBusyDrops})</span>}
                </span>
              </div>
            )}
            {status.diskSpaceOk === false && (
              <div
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}
              >
                <HardDrive className="h-3 w-3" />
                <span>{t('lowDisk')}</span>
              </div>
            )}
            {status.running && status.watchdogOk === false && (
              <div
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}
              >
                <ShieldAlert className="h-3 w-3" />
                <span title={t('watchdogFailedDesc')}>{t('watchdogFailed')}</span>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {stopping ? (
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium opacity-60 transition-all"
                style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('stoppingRecording')}
              </button>
            ) : status.running && status.capturing ? (
              <>
                <button
                  type="button"
                  onClick={handleStopRecording}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all"
                  style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
                >
                  <CircleStop className="h-4 w-4" />
                  {t('stopRecording')}
                </button>
                <button
                  type="button"
                  onClick={handleSaveClip}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all disabled:opacity-50"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  <Download className="h-4 w-4" />
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t('saveClip')}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleStartRecording}
                disabled={starting}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all disabled:opacity-50"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                <Video className="h-4 w-4" />
                {starting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('startingRecording')}
                  </>
                ) : (
                  t('startRecording')
                )}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
