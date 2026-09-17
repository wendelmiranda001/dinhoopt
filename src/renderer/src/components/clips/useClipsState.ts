import type { ClipInfo, ClipsConfig, ClipsEngineStatus, MicDeviceInfo } from '@shared/types'
import type { TFunction } from 'i18next'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { QUALITY_PRESETS, type QualityPresetKey } from './clips-quality-presets'
import type { FilterTab } from './clips-utils'
import { formatClipsDate, formatClipsSeconds, formatClipsSize, useClipsActions } from './useClipsActions'

export interface ClipsState {
  status: ClipsEngineStatus
  statusLoaded: boolean
  clipsLoaded: boolean
  config: ClipsConfig | null
  clips: ClipInfo[]
  loading: boolean
  starting: boolean
  stopping: boolean
  rebindingId: string | null
  setRebindingId: (id: string | null) => void
  filterTab: FilterTab
  setFilterTab: (tab: FilterTab) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  thumbnails: Record<string, string>
  refreshing: boolean
  showProcPicker: boolean
  setShowProcPicker: (v: boolean) => void
  procSearch: string
  setProcSearch: (v: string) => void
  processes: Array<{ name: string; pid: number }>
  setProcesses: React.Dispatch<React.SetStateAction<Array<{ name: string; pid: number }>>>
  micDevices: MicDeviceInfo[]
  loadingMicDevices: boolean
  gpuList: Array<{ index: number; name: string; vendorId: number }>
  showConfig: boolean
  setShowConfig: (v: boolean) => void
  selectedClips: Set<string>
  setSelectedClips: React.Dispatch<React.SetStateAction<Set<string>>>
  favorites: Set<string>
  activeTip: string | null
  setActiveTip: (tip: string | null) => void
  editingClip: ClipInfo | null
  setEditingClip: (clip: ClipInfo | null) => void
  renameTarget: string | null
  setRenameTarget: (name: string | null) => void
  mergeModePaths: string[] | null
  setMergeModePaths: (paths: string[] | null) => void
  filteredClips: ClipInfo[]
  estimatedRamMB: number
  tooltipContent: Record<string, string>
  filterTabs: { key: FilterTab; label: string }[]
  refreshStatus: () => Promise<void>
  refreshConfig: () => Promise<void>
  refreshClips: () => Promise<void>
  handleStartRecording: () => Promise<void>
  handleStopRecording: () => Promise<void>
  handleSaveClip: () => Promise<void>
  handleDeleteClip: (name: string) => Promise<void>
  handleDeleteSelected: () => Promise<void>
  handleOpenClip: (path: string) => Promise<void>
  handleRenameClip: (oldName: string, newName: string) => Promise<void>
  handlePublishClip: (clipName: string, clipPath: string) => Promise<void>
  handleCancelPublish: (clipPath: string) => Promise<void>
  publishingPath: string | null
  publishProgress: number
  publishResult: { link: string } | null
  setPublishResult: (r: { link: string } | null) => void
  publishedLinks: Record<string, string>
  setPublishedLink: (path: string, link: string) => void
  handleConfigUpdate: (partial: Partial<ClipsConfig>) => Promise<void>
  handleSelectOutputDir: () => Promise<void>
  toggleFavorite: (name: string) => void
  addHotkey: () => void
  removeHotkey: (id: string) => void
  updateHotkey: (id: string, patch: Partial<import('@shared/types').HotkeyBinding>) => void
  formatSize: (bytes: number) => string
  formatDate: (iso: string) => string
  formatSeconds: (s: number) => string
  QUALITY_PRESETS: Record<QualityPresetKey, Partial<ClipsConfig>>
  t: TFunction<'clips'>
}

export function useClipsState(): ClipsState {
  const { t } = useTranslation('clips')

  const [status, setStatus] = useState<ClipsEngineStatus>({
    running: false,
    capturing: false,
    uptime: 0,
    fps: 60,
    replayTimeSeconds: 120,
  })
  const [config, setConfig] = useState<ClipsConfig | null>(null)
  const [clips, setClips] = useState<ClipInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [rebindingId, setRebindingId] = useState<string | null>(null)
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [showProcPicker, setShowProcPicker] = useState(false)
  const [procSearch, setProcSearch] = useState('')
  const [processes, setProcesses] = useState<Array<{ name: string; pid: number }>>([])
  const [micDevices, setMicDevices] = useState<MicDeviceInfo[]>([])
  const [loadingMicDevices, setLoadingMicDevices] = useState(false)
  const [gpuList, setGpuList] = useState<Array<{ index: number; name: string; vendorId: number }>>([])
  const [showConfig, setShowConfig] = useState(false)
  const [selectedClips, setSelectedClips] = useState<Set<string>>(new Set())
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('clips-favorites')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch {
      return new Set()
    }
  })
  const [activeTip, setActiveTip] = useState<string | null>(null)
  const [editingClip, setEditingClip] = useState<ClipInfo | null>(null)
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [mergeModePaths, setMergeModePaths] = useState<string[] | null>(null)
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [clipsLoaded, setClipsLoaded] = useState(false)
  const [publishingPath, setPublishingPath] = useState<string | null>(null)
  const [publishProgress, setPublishProgress] = useState(0)
  const [publishResult, setPublishResult] = useState<{ link: string } | null>(null)
  const [publishedLinks, setPublishedLinks] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('clips-published')
      return saved ? (JSON.parse(saved) as Record<string, string>) : {}
    } catch {
      return {}
    }
  })

  const tooltipContent: Record<string, string> = useMemo(
    () => ({
      quality: t('tooltipQuality'),
      codec: t('tooltipCodec'),
      gpu: t('tooltipGpu'),
      resolution: t('tooltipResolution'),
      fps: t('tooltipFps'),
      replay: t('tooltipReplay'),
      'force-software': t('forceSoftwareTooltip'),
      'stretch-to-fit': t('stretchToFitTooltip'),
      'replay-buffer-mode': t('replayBufferModeTooltip'),
      mic: t('tooltipMic'),
      loopback: t('tooltipLoopback'),
      ptt: t('pushToTalkTooltip'),
      'sample-rate': t('tooltipSampleRate'),
      'game-audio': t('tooltipGameAudio'),
      'noise-suppression': t('tooltipNoiseSuppression'),
      'audio-sessions': t('audioSessionsTooltip'),
      'adaptive-quality': t('tooltipAdaptiveQuality'),
    }),
    [t],
  )

  // Escape key closes active tooltip
  useEffect(() => {
    if (!activeTip) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveTip(null)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [activeTip])

  // Persist favorites to localStorage
  useEffect(() => {
    localStorage.setItem('clips-favorites', JSON.stringify([...favorites]))
  }, [favorites])

  // Persist published links to localStorage
  useEffect(() => {
    localStorage.setItem('clips-published', JSON.stringify(publishedLinks))
  }, [publishedLinks])

  const refreshStatus = useCallback(async () => {
    try {
      const s = await window.dinho?.clipsGetStatus()
      if (s) setStatus(s)
    } catch {
      /* ignore */
    }
  }, [])

  const refreshConfig = useCallback(async () => {
    try {
      const c = await window.dinho?.clipsGetConfig()
      if (c) setConfig(c)
    } catch {
      /* ignore */
    }
  }, [])

  const refreshClips = useCallback(async () => {
    setRefreshing(true)
    try {
      const list = await window.dinho?.clipsList()
      if (list) {
        setClips(list)
        setThumbnails({})
      }
    } catch (err) {
      console.error('refreshClips error:', err)
    }
    setRefreshing(false)
  }, [])

  const loadMicDevices = useCallback(async () => {
    setLoadingMicDevices(true)
    try {
      const devices = await window.dinho?.clipsGetMicDevices()
      if (devices && devices.length > 0) {
        setMicDevices(devices)
      }
    } catch {
      /* ignore */
    }
    setLoadingMicDevices(false)
  }, [])

  // Load mic devices after status loaded
  useEffect(() => {
    if (!statusLoaded) return
    loadMicDevices()
  }, [statusLoaded, loadMicDevices])

  // Reload mic devices when engine starts
  useEffect(() => {
    if (status.running) loadMicDevices()
  }, [status.running, loadMicDevices])

  // Refresh clips when engine starts running (output directory may have changed)
  const prevRunning = useRef(status.running)
  const lastRamLevelRef = useRef<string | undefined>('normal')
  useEffect(() => {
    if (status.running && !prevRunning.current) {
      refreshClips()
    }
    prevRunning.current = status.running
  }, [status.running, refreshClips])

  // Load GPU list once
  useEffect(() => {
    if (!statusLoaded || gpuList.length > 0) return
    ;(async () => {
      try {
        const gpus = await window.dinho?.clipsGetGpus()
        if (gpus && gpus.length > 0) setGpuList(gpus)
      } catch {
        /* ignore */
      }
    })()
  }, [statusLoaded, gpuList.length])

  const loadThumbnail = useCallback(async (clipName: string) => {
    try {
      const dataUrl = await window.dinho?.clipsGetThumbnail(clipName)
      if (dataUrl) setThumbnails((prev) => ({ ...prev, [clipName]: dataUrl }))
    } catch {
      /* ignore */
    }
  }, [])

  // Batch load thumbnails
  useEffect(() => {
    if (clips.length === 0) return
    const BATCH = 6
    let cancelled = false
    const loadBatch = async () => {
      for (let i = 0; i < clips.length; i += BATCH) {
        if (cancelled) break
        const batch = clips.slice(i, i + BATCH)
        await Promise.all(batch.map((c) => loadThumbnail(c.name)))
      }
    }
    const timer = setTimeout(loadBatch, 0)
    return () => {
      clearTimeout(timer)
      cancelled = true
    }
  }, [clips, loadThumbnail])

  // Initial data load — all three in one effect so clipsLoaded is set in same microtask batch
  useEffect(() => {
    window.dinho?.gameModeDetectorStart?.()
    ;(async () => {
      await Promise.all([refreshStatus(), refreshConfig()])
      setStatusLoaded(true)
      await refreshClips()
      setClipsLoaded(true)
    })()
    return () => {
      window.dinho?.gameModeDetectorStop?.()
    }
  }, [refreshStatus, refreshConfig, refreshClips])

  // Poll status every 3s
  useEffect(() => {
    const timer = setInterval(refreshStatus, 3000)
    return () => clearInterval(timer)
  }, [refreshStatus])

  // Subscribe to engine status events
  useEffect(() => {
    const unsub = window.dinho?.clipsOnEngineStatus?.((s) => setStatus(s))
    return () => unsub?.()
  }, [])

  // Listen for clip saved events (from hotkey saves in the engine)
  useEffect(() => {
    const unsub = window.dinho?.clipsOnClipSaved?.(() => {
      toast.success(t('clipSaved'))
      refreshClips()
    })
    return () => unsub?.()
  }, [refreshClips, t])

  // Listen for RAM pressure broadcasts (RamManager watchdog)
  useEffect(() => {
    // Watchdog broadcasts every ~5s while pressure persists — toast only on
    // level transitions (critical↔normal) to avoid spam.
    const unsub = window.dinho?.clipsOnRamPressure?.((data) => {
      const level = data.level ?? 'normal'
      if (level === lastRamLevelRef.current) return
      lastRamLevelRef.current = level
      if (level === 'critical') {
        toast.warning(t('ramPressureCritical'), {
          description: t('ramPressureCriticalDesc', { pct: Math.round((data.usedPercent ?? 0) * 100) }),
        })
      } else if (level === 'normal') {
        toast.success(t('ramPressureNormal'))
      }
    })
    return () => unsub?.()
  }, [t])

  // Listen for durations-ready event (background duration computation finished)
  useEffect(() => {
    const unsub = window.dinho?.clipsOnDurationsReady?.(() => {
      refreshClips()
    })
    return () => unsub?.()
  }, [refreshClips])

  // Listen for publish progress broadcasts (main forwards per-file progress)
  const publishingPathRef = useRef<string | null>(null)
  publishingPathRef.current = publishingPath
  useEffect(() => {
    const unsub = window.dinho?.clipsOnPublishProgress?.((data) => {
      if (data.clipPath === publishingPathRef.current) {
        setPublishProgress(data.percent ?? 0)
      }
    })
    return () => unsub?.()
  }, [])

  // ── Actions (delegated to useClipsActions) ───────────────

  const setPublishedLink = useCallback((path: string, link: string) => {
    setPublishedLinks((prev) => (prev[path] === link ? prev : { ...prev, [path]: link }))
  }, [])

  const actions = useClipsActions({
    config,
    status,
    selectedClips,
    favorites,
    setStarting,
    setStopping,
    setLoading,
    setConfig,
    setFavorites,
    setRebindingId,
    setPublishingPath,
    setPublishProgress,
    setPublishResult,
    setPublishedLink,
    refreshClips,
    refreshConfig,
    refreshStatus,
    setSelectedClips,
    t,
  })

  // Hotkey rebinding listeners (delegated to useClipsActions)
  useEffect(() => {
    return actions.setupRebindingListeners(rebindingId)
  }, [rebindingId, actions.setupRebindingListeners])

  // ── Derived state ─────────────────────────────────────────

  const filteredClips = useMemo(() => {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000

    return clips.filter((clip) => {
      const ct = new Date(clip.createdAt).getTime()
      if (ct <= 0) return true
      if (filterTab === 'today') {
        if (ct < startOfToday) return false
      }
      if (filterTab === 'week') {
        if (ct < startOfWeek) return false
      }
      if (filterTab === 'favorites' && !favorites.has(clip.name)) return false
      if (searchQuery && !clip.name.toLowerCase().includes(searchQuery.toLowerCase())) return false
      return true
    })
  }, [clips, filterTab, searchQuery, favorites])

  // Expose save trigger for E2E tests
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__clipsSaveClip = actions.handleSaveClip
    return () => {
      delete (window as unknown as Record<string, unknown>).__clipsSaveClip
    }
  }, [actions.handleSaveClip])

  const estimatedRamMB = useMemo(() => {
    if (!config) return 0
    const rate = config.maxrateKbps || 50000
    return Math.round(((rate * (config.replayTimeSeconds || status.replayTimeSeconds)) / 8 / 1024) * 1.05)
  }, [config, status.replayTimeSeconds])

  const filterTabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'all' },
    { key: 'today', label: 'today' },
    { key: 'week', label: 'week' },
    { key: 'favorites', label: 'favorites' },
  ]

  return {
    status,
    stopping,
    statusLoaded,
    clipsLoaded,
    config,
    clips,
    loading,
    starting,
    rebindingId,
    setRebindingId,
    filterTab,
    setFilterTab,
    searchQuery,
    setSearchQuery,
    thumbnails,
    refreshing,
    showProcPicker,
    setShowProcPicker,
    procSearch,
    setProcSearch,
    processes,
    setProcesses,
    micDevices,
    loadingMicDevices,
    gpuList,
    showConfig,
    setShowConfig,
    selectedClips,
    setSelectedClips,
    favorites,
    activeTip,
    setActiveTip,
    editingClip,
    setEditingClip,
    renameTarget,
    setRenameTarget,
    mergeModePaths,
    setMergeModePaths,
    filteredClips,
    estimatedRamMB,
    tooltipContent,
    filterTabs,
    refreshStatus,
    refreshConfig,
    refreshClips,
    handleStartRecording: actions.handleStartRecording,
    handleStopRecording: actions.handleStopRecording,
    handleSaveClip: actions.handleSaveClip,
    handleDeleteClip: actions.handleDeleteClip,
    handleDeleteSelected: actions.handleDeleteSelected,
    handleOpenClip: actions.handleOpenClip,
    handleRenameClip: actions.handleRenameClip,
    handlePublishClip: actions.handlePublishClip,
    handleCancelPublish: actions.handleCancelPublish,
    publishingPath,
    publishProgress,
    publishResult,
    setPublishResult,
    publishedLinks,
    setPublishedLink,
    handleConfigUpdate: actions.handleConfigUpdate,
    handleSelectOutputDir: actions.handleSelectOutputDir,
    toggleFavorite: actions.toggleFavorite,
    addHotkey: actions.addHotkey,
    removeHotkey: actions.removeHotkey,
    updateHotkey: actions.updateHotkey,
    formatSize: (bytes: number) => formatClipsSize(bytes, t),
    formatDate: formatClipsDate,
    formatSeconds: formatClipsSeconds,
    QUALITY_PRESETS,
    t,
  }
}
