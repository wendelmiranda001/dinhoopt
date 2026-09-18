import type { ClipInfo, ClipMergeResult, ClipTrimResult, EnhanceOption } from '@shared/types'
import { Combine, Maximize, Minimize, Pause, Play, Scissors, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const fmt = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

interface ClipEditorModalProps {
  clip?: ClipInfo
  initialMergePaths?: string[]
  startFullscreen?: boolean
  onClose: () => void
  onSave: () => void
}

function EnhanceSelect({
  value,
  onChange,
  disabled,
  title,
}: {
  value: EnhanceOption
  onChange: (v: EnhanceOption) => void
  disabled?: boolean
  title?: string
}) {
  const { t } = useTranslation('clips')
  return (
    <label
      className="mb-3 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[10px]"
      style={{ background: 'rgba(0,0,0,0.2)' }}
      title={title}
    >
      <span style={{ color: 'var(--text-secondary)' }}>{t('enhance')}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as EnhanceOption)}
        className="flex-1 rounded border bg-transparent px-1 py-0.5 text-[10px] disabled:opacity-40"
        style={{ borderColor: 'var(--border-medium)', color: 'var(--text-primary)' }}
      >
        <option value="none">{t('enhanceNone')}</option>
        <option value="sr">{t('enhanceSr')}</option>
        <option value="frc">{t('enhanceFrc')}</option>
        <option value="sr+frc">{t('enhanceSrFrc')}</option>
      </select>
    </label>
  )
}

function SharpnessSlider({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('clips')
  return (
    <label
      className="mb-3 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[10px]"
      style={{ background: 'rgba(0,0,0,0.2)' }}
      title={t('sharpnessTooltip')}
    >
      <span style={{ color: 'var(--text-secondary)' }}>{t('sharpness')}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 disabled:opacity-40"
      />
      <span style={{ color: 'var(--text-primary)' }}>{value > 0 ? value.toFixed(1) : t('sharpnessOff')}</span>
    </label>
  )
}

function TrimTimeline({
  currentTime,
  startSec,
  endSec,
  duration,
  ariaLabel,
  startLabel,
  endLabel,
  onSeek,
  onStartChange,
  onEndChange,
}: {
  currentTime: number
  startSec: number
  endSec: number
  duration: number
  ariaLabel: string
  startLabel: string
  endLabel: string
  onSeek: (s: number) => void
  onStartChange: (s: number) => void
  onEndChange: (s: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<'seek' | 'start' | 'end' | null>(null)

  // Half the handle width (w-4 = 16px). Insetting the track by this much keeps
  // the edge handles fully inside the timeline box instead of overflowing it.
  const TRACK_INSET_PX = 8

  const adjustStart = (delta: number) => {
    onStartChange(Math.max(0, Math.min(endSec - 0.1, startSec + delta)))
  }

  const adjustEnd = (delta: number) => {
    onEndChange(Math.max(startSec + 0.1, Math.min(duration, endSec + delta)))
  }

  const posFromClient = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect) return 0
      return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration))
    },
    [duration],
  )

  // Handle grab threshold in pixels — the previous seconds-based threshold
  // (< 1s) was sub-pixel at clip lengths >= 120s, making the visible handles
  // ungrabbable (clicks registered as seek instead of drag).
  const HANDLE_GRAB_PX = 12

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const s = posFromClient(e.clientX)
    const x = e.clientX - rect.left
    const toPx = (sec: number) => (sec / duration) * rect.width
    const distStart = Math.abs(x - toPx(startSec))
    const distEnd = Math.abs(x - toPx(endSec))
    const distCur = Math.abs(x - toPx(currentTime))
    if (distStart <= HANDLE_GRAB_PX && distStart <= distEnd && distStart <= distCur) setDragging('start')
    else if (distEnd <= HANDLE_GRAB_PX && distEnd <= distCur) setDragging('end')
    else {
      setDragging('seek')
      onSeek(s)
    }
  }

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return
      const s = posFromClient(e.clientX)
      if (dragging === 'seek') onSeek(s)
      else if (dragging === 'start' && s < endSec) onStartChange(s)
      else if (dragging === 'end' && s > startSec) onEndChange(s)
    },
    [dragging, posFromClient, startSec, endSec, onSeek, onStartChange, onEndChange],
  )

  const onMouseUp = useCallback(() => setDragging(null), [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let next = currentTime
      if (e.key === 'ArrowRight') next = currentTime + 1
      else if (e.key === 'ArrowLeft') next = currentTime - 1
      else if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = duration
      else return
      e.preventDefault()
      onSeek(Math.max(0, Math.min(duration, next)))
    },
    [currentTime, duration, onSeek],
  )

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
      return () => {
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }
    }
  }, [dragging, onMouseMove, onMouseUp])

  const pct = (s: number) => (duration > 0 ? (s / duration) * 100 : 0)

  return (
    <div
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={fmt(currentTime)}
      className="relative h-8 cursor-pointer select-none"
      style={{ touchAction: 'none' }}
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onKeyDown={onKeyDown}
    >
      {/* Inset track: absolute handlers at 0%/100% stay within this box */}
      <div
        ref={trackRef}
        data-testid="trim-track"
        className="absolute inset-y-0"
        style={{ left: TRACK_INSET_PX, right: TRACK_INSET_PX }}
      >
        {/* Track background */}
        <div
          className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{ background: 'rgba(255,255,255,0.12)' }}
        />

        {/* Selected region highlight */}
        <div
          data-testid="trim-region"
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{
            left: `${pct(startSec)}%`,
            width: `${pct(endSec) - pct(startSec)}%`,
            background: 'var(--accent)',
            opacity: 0.5,
          }}
        />

        {/* Start handle */}
        <div
          role="slider"
          aria-label={startLabel}
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={Math.round(startSec)}
          aria-valuetext={fmt(startSec)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault()
              e.stopPropagation()
              adjustStart(1)
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault()
              e.stopPropagation()
              adjustStart(-1)
            }
          }}
          className="absolute top-1/2 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2"
          style={{
            left: `${pct(startSec)}%`,
            borderColor: 'var(--accent)',
            background: dragging === 'start' ? 'var(--accent)' : '#111318',
          }}
        />

        {/* End handle */}
        <div
          data-testid="trim-end-handle"
          role="slider"
          aria-label={endLabel}
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={Math.round(endSec)}
          aria-valuetext={fmt(endSec)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault()
              e.stopPropagation()
              adjustEnd(1)
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault()
              e.stopPropagation()
              adjustEnd(-1)
            }
          }}
          className="absolute top-1/2 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2"
          style={{
            left: `${pct(endSec)}%`,
            borderColor: 'var(--accent)',
            background: dragging === 'end' ? 'var(--accent)' : '#111318',
          }}
        />

        {/* Current position indicator */}
        <div
          className="absolute top-0 z-20 h-full w-0.5 -translate-x-1/2"
          style={{
            left: `${pct(currentTime)}%`,
            background: '#fff',
            opacity: 0.7,
          }}
        />
      </div>
    </div>
  )
}

export function ClipEditorModal({ clip, initialMergePaths, startFullscreen, onClose, onSave }: ClipEditorModalProps) {
  const { t } = useTranslation('clips')
  const [startSec, setStartSec] = useState(0)
  const [endSec, setEndSec] = useState(clip?.duration || 60)
  const [trimming, setTrimming] = useState(false)
  const [reEncode, setReEncode] = useState(false)
  const [enhance, setEnhance] = useState<EnhanceOption>('none')
  const [enhanceSupported, setEnhanceSupported] = useState(false)
  const [sharpness, setSharpness] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [realDuration, setRealDuration] = useState(clip?.duration || 0)
  const effectiveDuration = realDuration || clip?.duration || 60
  const [fullscreen, setFullscreen] = useState(false)
  const [showOverlay, setShowOverlay] = useState(true)
  const overlayTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mountedRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const mergeClipsState = useState<string[]>(initialMergePaths ?? (clip ? [clip.path] : []))
  const [mergeClips] = mergeClipsState
  const setMergeClips = mergeClipsState[1]
  const videoRef = useRef<HTMLVideoElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const lastTimeUpdateRef = useRef(0)

  // Auto-enter fullscreen when the editor is opened from a thumbnail click.
  // A layout effect keeps the click's transient user activation alive, which
  // the HTML5 Fullscreen API requires.
  useLayoutEffect(() => {
    if (!startFullscreen) return
    const el = containerRef.current
    if (el?.requestFullscreen) {
      el.requestFullscreen().catch(() => {})
    }
  }, [startFullscreen])

  useEffect(() => {
    mountedRef.current = true
    let active = true
    window.dinho
      .clipsGetEnhanceSupport()
      .then((r) => {
        if (active) setEnhanceSupported(r.amd)
      })
      .catch(() => {
        if (active) setEnhanceSupported(false)
      })
    return () => {
      active = false
      mountedRef.current = false
      if (overlayTimer.current) {
        clearTimeout(overlayTimer.current)
        overlayTimer.current = undefined
      }
    }
  }, [])

  // The reported clip duration can be stale/rounded (or 0 when the ffmpeg probe
  // failed). Once real metadata is known, clamp the trim range so the selection
  // never renders past the end of the timeline.
  useEffect(() => {
    if (realDuration <= 0) return
    setEndSec((e) => Math.min(e, realDuration))
    setStartSec((s) => Math.min(s, realDuration))
  }, [realDuration])

  const videoUrl = useMemo(() => (clip ? window.dinho.clipsGetVideoUrl(clip.path) : ''), [clip])

  const showTrim = clip && !initialMergePaths

  const seekTo = useCallback((seconds: number) => {
    const vid = videoRef.current
    if (vid) vid.currentTime = seconds
  }, [])

  const togglePlay = useCallback(() => {
    const vid = videoRef.current
    if (!vid) return
    if (vid.paused) {
      vid
        .play()
        .then(() => setPlaying(true))
        .catch(() => {})
    } else {
      vid.pause()
      setPlaying(false)
    }
  }, [])

  const lastOverlayThrottleRef = useRef(0)

  const showOverlayTemporarily = useCallback(() => {
    const now = Date.now()
    if (now - lastOverlayThrottleRef.current < 100) return
    lastOverlayThrottleRef.current = now
    setShowOverlay(true)
    if (overlayTimer.current) clearTimeout(overlayTimer.current)
    if (fullscreen) {
      overlayTimer.current = setTimeout(() => setShowOverlay(false), 2500)
    }
  }, [fullscreen])

  useEffect(() => {
    const cb = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', cb)
    return () => document.removeEventListener('fullscreenchange', cb)
  }, [])

  useEffect(() => {
    if (!fullscreen) {
      setShowOverlay(true)
      if (overlayTimer.current) clearTimeout(overlayTimer.current)
    }
  }, [fullscreen])

  // Keyboard shortcuts: I = mark in, O = mark out
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!showTrim) return
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault()
        setStartSec(currentTime)
        if (currentTime >= endSec) setEndSec(Math.min(currentTime + 1, effectiveDuration))
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault()
        setEndSec(currentTime)
        if (currentTime <= startSec) setStartSec(Math.max(currentTime - 1, 0))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showTrim, currentTime, endSec, startSec, effectiveDuration])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current
        ?.requestFullscreen()
        .then(() => setFullscreen(true))
        .catch(() => {})
    } else {
      document
        .exitFullscreen()
        .then(() => setFullscreen(false))
        .catch(() => {})
    }
  }, [])

  const handleSeek = useCallback(
    (s: number) => {
      setCurrentTime(s)
      seekTo(s)
    },
    [seekTo],
  )

  const handleStartChange = useCallback(
    (s: number) => {
      setStartSec(s)
      seekTo(s)
    },
    [seekTo],
  )

  const handleEndChange = useCallback(
    (s: number) => {
      setEndSec(s)
      seekTo(s)
    },
    [seekTo],
  )

  // At least one quality improvement selected for the "Improve quality" button.
  // Sharpness alone still requires a re-encode to be applied.
  const qualityEnhancementSelected = reEncode || sharpness > 0

  const runExport = async (useReEncode: boolean, successKey: string) => {
    if (endSec <= startSec || startSec < 0 || endSec > effectiveDuration) {
      toast.error(t('invalidTrimRange'))
      return
    }
    setTrimming(true)
    try {
      const result: ClipTrimResult = await window.dinho.clipsTrimClip(
        clip!.path,
        startSec,
        endSec,
        useReEncode,
        enhance,
        sharpness,
      )
      if (result.success) {
        toast.success(t(successKey))
        if (mountedRef.current) onSave()
      } else {
        toast.error(result.error || t('trimFailed'))
      }
    } catch {
      toast.error(t('trimFailed'))
    } finally {
      if (mountedRef.current) setTrimming(false)
    }
  }

  const handleTrim = () => runExport(qualityEnhancementSelected, 'trimSuccess')

  const handleImproveQuality = () => runExport(true, 'improveQualitySuccess')

  const handleMerge = async () => {
    if (mergeClips.length < 2) {
      toast.error(t('needTwoClips'))
      return
    }
    try {
      const result: ClipMergeResult = await window.dinho.clipsMergeClips(mergeClips, enhance, sharpness)
      if (result.success) {
        toast.success(t('mergeSuccess'))
        if (mountedRef.current) onSave()
      } else {
        toast.error(result.error || t('mergeFailed'))
      }
    } catch {
      toast.error(t('mergeFailed'))
    }
  }

  const trimDuration = endSec - startSec

  // Focus trap: autofocus first control, wrap Tab, restore focus on close.
  // Escape handled here via onCloseRef (stable) — no re-registration on re-render.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    previousFocusRef.current = document.activeElement as HTMLElement | null

    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    first?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85">
      <div aria-hidden="true" className="absolute inset-0" onMouseDown={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={showTrim && clip ? `${t('editClip')}: ${clip.name}` : t('merge')}
        onMouseMove={showOverlayTemporarily}
        className="relative w-full rounded-xl border shadow-2xl"
        style={{
          maxWidth: fullscreen ? '100%' : '36rem',
          height: fullscreen ? '100%' : 'auto',
          background: fullscreen ? '#000' : '#111318',
          borderColor: 'var(--border-medium)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header — hidden in fullscreen */}
        {!fullscreen && (
          <div className="flex items-center justify-between px-6 pt-6 pb-3">
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {showTrim ? `${t('editClip')}: ${clip!.name}` : t('merge')}
            </h2>
            <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div
          ref={containerRef}
          className={fullscreen ? 'flex flex-1 flex-col' : ''}
          style={fullscreen ? { background: '#000', minHeight: 0 } : undefined}
        >
          {showTrim && clip && (
            <>
              {/* Video wrapper */}
              <div className="relative flex-1 flex flex-col" style={{ minHeight: fullscreen ? 0 : undefined }}>
                <div
                  className={
                    fullscreen ? 'flex-1 flex items-center justify-center bg-black' : 'mb-4 overflow-hidden rounded-lg'
                  }
                >
                  {/* biome-ignore lint/a11y/useMediaCaption: preview of the user's own recordings — no dialogue captions exist */}
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    className={fullscreen ? 'max-h-full max-w-full' : 'w-full'}
                    style={fullscreen ? { objectFit: 'contain' } : { maxHeight: 240 }}
                    autoPlay
                    playsInline
                    onClick={togglePlay}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        togglePlay()
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    onLoadedMetadata={() => {
                      if (videoRef.current) setRealDuration(videoRef.current.duration)
                    }}
                    onEnded={() => {
                      setPlaying(false)
                      setCurrentTime(effectiveDuration)
                    }}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onTimeUpdate={() => {
                      if (videoRef.current) {
                        const t = videoRef.current.currentTime
                        if (t - lastTimeUpdateRef.current > 0.016) {
                          lastTimeUpdateRef.current = t
                          setCurrentTime(t)
                        }
                      }
                    }}
                    onError={() => toast.error(t('videoPreviewFailed'))}
                    preload="auto"
                  ></video>
                </div>

                {/* Overlay controls (fullscreen) — fixed at bottom */}
                {fullscreen && (
                  <div
                    className="fixed bottom-0 left-0 right-0 z-50 transition-opacity duration-300"
                    style={{
                      opacity: showOverlay ? 1 : 0,
                      pointerEvents: showOverlay ? 'auto' : 'none',
                    }}
                  >
                    <TrimTimeline
                      currentTime={currentTime}
                      startSec={startSec}
                      endSec={endSec}
                      duration={effectiveDuration}
                      ariaLabel={t('trim')}
                      startLabel={t('start')}
                      endLabel={t('end')}
                      onSeek={handleSeek}
                      onStartChange={handleStartChange}
                      onEndChange={handleEndChange}
                    />
                    <div
                      className="flex items-center gap-3 px-4 py-4"
                      style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.9))' }}
                    >
                      <button type="button" onClick={togglePlay} className="rounded p-1.5 hover:bg-white/10">
                        {playing ? <Pause className="h-6 w-6 text-white" /> : <Play className="h-6 w-6 text-white" />}
                      </button>
                      <span className="text-sm font-mono text-white/90">
                        {fmt(currentTime)} / {fmt(effectiveDuration)}
                      </span>
                      <span className="ml-2 text-xs font-mono text-white/60">{fmt(trimDuration)}</span>
                      <button
                        type="button"
                        onClick={toggleFullscreen}
                        className="ml-auto rounded p-1.5 hover:bg-white/10"
                      >
                        <Minimize className="h-5 w-5 text-white" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Seek bar + controls (normal mode) */}
                {!fullscreen && (
                  <div className="mb-3">
                    <TrimTimeline
                      currentTime={currentTime}
                      startSec={startSec}
                      endSec={endSec}
                      duration={effectiveDuration}
                      ariaLabel={t('trim')}
                      startLabel={t('start')}
                      endLabel={t('end')}
                      onSeek={handleSeek}
                      onStartChange={handleStartChange}
                      onEndChange={handleEndChange}
                    />
                    <div className="flex items-center gap-2 px-1 py-1.5">
                      <button type="button" onClick={togglePlay} className="rounded p-0.5 hover:bg-white/10">
                        {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      </button>
                      <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                        {fmt(currentTime)} / {fmt(effectiveDuration)}
                      </span>
                      <button
                        type="button"
                        onClick={toggleFullscreen}
                        className="ml-auto rounded p-0.5 hover:bg-white/10"
                      >
                        <Maximize className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Clip info + Trim section — normal mode only; fullscreen uses the overlay player */}
              {!fullscreen && (
                <>
                  <p className="mb-4 text-xs" style={{ color: 'var(--text-dim)' }}>
                    {clip.path} · {(clip.size / 1024 / 1024).toFixed(1)}
                    {t('megabytes')} · {effectiveDuration.toFixed(1)}
                    {t('seconds')}
                  </p>
                  <div className="rounded-lg p-3" style={{ background: 'rgba(113,113,122,0.08)' }}>
                    <div className="mb-2 flex items-center justify-between">
                      <h3
                        className="flex items-center gap-1.5 text-sm font-medium"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        <Scissors className="h-3.5 w-3.5" />
                        {t('trim')}
                      </h3>
                      <span className="text-[11px] font-mono" style={{ color: 'var(--accent)' }}>
                        {fmt(trimDuration)}
                      </span>
                    </div>

                    {/* In/Out markers + hotkey hints */}
                    <div className="mb-3 flex items-center gap-3 text-[10px]" style={{ color: 'var(--text-dim)' }}>
                      <span>
                        <kbd
                          className="rounded border px-1 py-0.5 font-mono text-[9px]"
                          style={{ borderColor: 'var(--border-medium)' }}
                        >
                          I
                        </kbd>{' '}
                        {fmt(startSec)}
                      </span>
                      <span>
                        <kbd
                          className="rounded border px-1 py-0.5 font-mono text-[9px]"
                          style={{ borderColor: 'var(--border-medium)' }}
                        >
                          O
                        </kbd>{' '}
                        {fmt(endSec)}
                      </span>
                      <span className="ml-auto text-[9px]" style={{ color: 'var(--text-muted)' }}>
                        {t('trimHint')}
                      </span>
                    </div>

                    <label
                      className="mb-3 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[10px]"
                      style={{ background: 'rgba(0,0,0,0.2)' }}
                      title={t('reEncodeTooltip')}
                    >
                      <input
                        type="checkbox"
                        checked={reEncode}
                        onChange={(e) => setReEncode(e.target.checked)}
                        className="accent-[var(--accent)]"
                      />
                      <span style={{ color: 'var(--text-secondary)' }}>{t('reEncode')}</span>
                    </label>

                    <EnhanceSelect
                      value={enhance}
                      onChange={setEnhance}
                      disabled={!reEncode || !enhanceSupported}
                      title={enhanceSupported ? t('enhanceTooltip') : t('enhanceUnavailable')}
                    />

                    <SharpnessSlider value={sharpness} onChange={setSharpness} />

                    <button
                      type="button"
                      onClick={handleImproveQuality}
                      disabled={trimming || !qualityEnhancementSelected}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                      style={{ borderColor: 'var(--border-medium)', color: 'var(--text-primary)' }}
                      title={qualityEnhancementSelected ? t('improveQualityTooltip') : t('improveQualityHint')}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {t('improveQuality')}
                    </button>
                    {!qualityEnhancementSelected && (
                      <p className="mt-1 text-[9px]" style={{ color: 'var(--text-muted)' }}>
                        {t('improveQualityHint')}
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={handleTrim}
                      disabled={trimming}
                      className="mt-2 w-full rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                      style={{ background: 'var(--accent)', color: '#fff' }}
                    >
                      {trimming ? t('trimming') : `${t('applyTrim')} (${fmt(trimDuration)})`}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Merge section — only in merge mode, hidden in edit mode and fullscreen */}
        {!showTrim && !fullscreen && (
          <div className="mb-5 rounded-lg p-3" style={{ background: 'rgba(113,113,122,0.08)' }}>
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              <Combine className="h-3.5 w-3.5" />
              {t('merge')}
            </h3>
            <p className="mb-2 text-[10px]" style={{ color: 'var(--text-dim)' }}>
              {t('mergeHint')}
            </p>
            <div className="mb-2 max-h-32 space-y-1 overflow-y-auto">
              {mergeClips.map((p, i) => (
                <div
                  key={p}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[10px]"
                  style={{ background: 'rgba(0,0,0,0.2)' }}
                >
                  <span className="flex-1 truncate">{p}</span>
                  {mergeClips.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setMergeClips((prev) => prev.filter((_, idx) => idx !== i))}
                      className="rounded p-0.5 hover:bg-white/10"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <EnhanceSelect
              value={enhance}
              onChange={setEnhance}
              disabled={!enhanceSupported}
              title={enhanceSupported ? t('enhanceTooltip') : t('enhanceUnavailable')}
            />
            <SharpnessSlider value={sharpness} onChange={setSharpness} />
            <button
              type="button"
              onClick={handleMerge}
              disabled={mergeClips.length < 2}
              className="w-full rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {t('applyMerge')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
