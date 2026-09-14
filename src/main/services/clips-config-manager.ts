import { join, resolve } from 'node:path'
import type { HotkeyBinding } from '@shared/types'
import { loadClipsConfig, saveClipsConfig } from './clips-config-store'

const MODIFIER_VK_MAP: Record<string, number> = {
  Ctrl: 0x11,
  Shift: 0x10,
  Alt: 0x12,
}

export interface ConfigState {
  engineFps: number
  engineReplayTimeSeconds: number
  width: number
  height: number
  bitrateKbps: number
  cq: number
  maxrateKbps: number
  bufsizeKbps: number
  bframes: number
  lookahead: number
  encoderPreset: string
  codec: string
  adapterIndex: number
  micEnabled: boolean
  audioLoopback: boolean
  forceSoftware: boolean
  pushToTalk: 'off' | 'hold' | 'toggle'
  pushToTalkKeys: number[]
  gameDetection: boolean
  gameAudioOnly: boolean
  customGameProcess: string
  micDeviceId: string
  autoStartCapture: boolean
  useExcludeMode: boolean
  excludeProcessId: number
  hotkeys: HotkeyBinding[]
  outputDirectory: string
  gameVolume: number
  micVolume: number
  selectedAudioSessions: number[]
  noiseSuppression: boolean
  audioSampleRate: number
  autoCleanupEnabled: boolean
  autoCleanupThresholdGB: number
  adaptiveQuality: boolean
  stretchToFit: boolean
  replayBufferMode: 'ram' | 'hybrid'
}

export const config: ConfigState = {
  engineFps: 60,
  engineReplayTimeSeconds: 120,
  width: 1280,
  height: 720,
  bitrateKbps: 30000,
  cq: 20,
  maxrateKbps: 30000,
  bufsizeKbps: 60000,
  bframes: 3,
  lookahead: 16,
  encoderPreset: 'p5',
  codec: 'auto',
  adapterIndex: -1,
  micEnabled: true,
  audioLoopback: false,
  forceSoftware: false,
  pushToTalk: 'hold',
  pushToTalkKeys: [5, 20],
  gameDetection: true,
  gameAudioOnly: true,
  customGameProcess: '',
  micDeviceId: '',
  autoStartCapture: true,
  useExcludeMode: false,
  excludeProcessId: 0,
  hotkeys: [],
  outputDirectory: '',
  gameVolume: 1.0,
  micVolume: 1.0,
  selectedAudioSessions: [],
  noiseSuppression: false,
  audioSampleRate: 48000,
  autoCleanupEnabled: true,
  autoCleanupThresholdGB: 100,
  adaptiveQuality: true,
  stretchToFit: false,
  replayBufferMode: 'hybrid',
}

function defaultHotkeys(): HotkeyBinding[] {
  return [
    { id: 'hk-save-8', vk: 0x77, modifiers: [], action: 'saveClip', replayDurationSeconds: 60, enabled: true },
    { id: 'hk-capture', vk: 0x78, modifiers: [], action: 'toggleCapture', enabled: true },
    { id: 'hk-mic', vk: 0x79, modifiers: [], action: 'toggleMic', enabled: true },
  ]
}

function baseConfigPayload(): Record<string, unknown> {
  const c = config
  return {
    replayTimeSeconds: c.engineReplayTimeSeconds,
    micEnabled: c.micEnabled,
    audioLoopback: c.audioLoopback,
    fps: c.engineFps,
    width: c.width,
    height: c.height,
    bitrateKbps: c.bitrateKbps,
    cq: c.cq,
    maxrateKbps: c.maxrateKbps,
    bufsizeKbps: c.bufsizeKbps,
    bframes: c.bframes,
    lookahead: c.lookahead,
    encoderPreset: c.encoderPreset,
    codec: c.codec,
    adapterIndex: c.adapterIndex,
    outputDirectory: getDefaultOutputDir(),
    forceSoftware: c.forceSoftware,
    pushToTalk: c.pushToTalk,
    pushToTalkKeys: c.pushToTalkKeys,
    gameDetection: c.gameDetection,
    gameAudioOnly: c.gameAudioOnly,
    customGameProcess: c.customGameProcess || undefined,
    micDeviceId: c.micDeviceId || undefined,
    autoStartCapture: c.autoStartCapture || undefined,
    useExcludeMode: c.useExcludeMode,
    excludeProcessId: c.useExcludeMode ? process.pid : c.excludeProcessId,
    gameVolume: c.gameVolume,
    micVolume: c.micVolume,
    audioSampleRate: c.audioSampleRate,
    autoCleanupEnabled: c.autoCleanupEnabled,
    autoCleanupThresholdGB: c.autoCleanupThresholdGB,
    noiseSuppression: c.noiseSuppression,
    adaptiveQuality: c.adaptiveQuality,
    stretchToFit: c.stretchToFit,
    replayBufferMode: c.replayBufferMode,
  }
}

export function buildEngineConfig(): Record<string, unknown> {
  const hks = config.hotkeys.length > 0 ? config.hotkeys : defaultHotkeys()
  return {
    ...baseConfigPayload(),
    Hotkeys: hks.map((hk) => ({
      vk: hk.vk,
      modifiers: hk.modifiers.map((m) => MODIFIER_VK_MAP[m] ?? 0),
      action: hk.action.charAt(0).toUpperCase() + hk.action.slice(1),
      replayDurationSeconds: hk.replayDurationSeconds,
      enabled: hk.enabled,
    })),
    electronPid: process.pid,
  }
}

export function getDefaultOutputDir(): string {
  if (config.outputDirectory) return config.outputDirectory
  const home =
    process.env.USERPROFILE ||
    (process.env.HOMEDRIVE && process.env.HOMEPATH ? process.env.HOMEDRIVE + process.env.HOMEPATH : undefined) ||
    process.cwd()
  // Default: %USERPROFILE%\Videos\DiNho Clips — pasta de vídeos do usuário (observável,
  // com nome da marca). O usuário muda pelo front (seletor de pasta) e o valor escolhido
  // persiste em config.outputDirectory, que tem precedência aqui.
  return join(home, 'Videos', 'DiNho Clips')
}

export function clipPathInOutputDir(inputPath: string): string | null {
  const outputDir = getDefaultOutputDir()
  try {
    const resolved = resolve(outputDir, inputPath)
    const normalized = outputDir.toLowerCase()
    const prefix = normalized.endsWith('\\') || normalized.endsWith('/') ? normalized : `${normalized}\\`
    const isDirItself = resolved.toLowerCase() === normalized
    if (!isDirItself && !resolved.toLowerCase().startsWith(prefix)) return null
    return resolved
  } catch {
    return null
  }
}

export function getCurrentConfigPayload(): Record<string, unknown> {
  return {
    ...baseConfigPayload(),
    selectedAudioSessions: config.selectedAudioSessions,
    hotkeys: config.hotkeys.length > 0 ? config.hotkeys : defaultHotkeys(),
    excludeProcessId: config.useExcludeMode ? process.pid : config.excludeProcessId,
  }
}

export function loadPersistedClipsConfig(): void {
  const saved = loadClipsConfig()
  config.width = saved.width
  config.height = saved.height
  config.bitrateKbps = saved.bitrateKbps
  config.cq = saved.cq ?? 20
  config.maxrateKbps = saved.maxrateKbps ?? 30000
  config.bufsizeKbps = saved.bufsizeKbps ?? 60000
  config.bframes = saved.bframes ?? 3
  config.lookahead = saved.lookahead ?? 16
  config.encoderPreset = saved.encoderPreset ?? 'p5'
  config.codec = saved.codec ?? 'auto'
  config.adapterIndex = saved.adapterIndex ?? -1
  config.micEnabled = saved.micEnabled
  config.audioLoopback = saved.audioLoopback
  config.forceSoftware = saved.forceSoftware
  config.pushToTalk = saved.pushToTalk
  config.pushToTalkKeys = saved.pushToTalkKeys
  config.gameDetection = saved.gameDetection
  config.gameAudioOnly = saved.gameAudioOnly
  config.customGameProcess = saved.customGameProcess ?? ''
  config.micDeviceId = saved.micDeviceId ?? ''
  config.autoStartCapture = saved.autoStartCapture ?? false
  config.useExcludeMode = saved.useExcludeMode ?? false
  config.excludeProcessId = saved.excludeProcessId ?? 0
  config.gameVolume = saved.gameVolume ?? 1.0
  config.micVolume = saved.micVolume ?? 1.0
  config.selectedAudioSessions = saved.selectedAudioSessions ?? []
  config.noiseSuppression = saved.noiseSuppression ?? false
  config.adaptiveQuality = saved.adaptiveQuality ?? true
  config.stretchToFit = saved.stretchToFit ?? false
  config.replayBufferMode = saved.replayBufferMode ?? 'hybrid'
  config.audioSampleRate = saved.audioSampleRate ?? 48000
  config.autoCleanupEnabled = saved.autoCleanupEnabled ?? true
  config.autoCleanupThresholdGB = saved.autoCleanupThresholdGB ?? 100
  config.hotkeys = saved.hotkeys
  config.outputDirectory = saved.outputDirectory
  config.engineReplayTimeSeconds = saved.replayTimeSeconds
  config.engineFps = saved.fps
}

export function persistClipsConfig(): void {
  saveClipsConfig({
    width: config.width,
    height: config.height,
    bitrateKbps: config.bitrateKbps,
    cq: config.cq,
    maxrateKbps: config.maxrateKbps,
    bufsizeKbps: config.bufsizeKbps,
    bframes: config.bframes,
    lookahead: config.lookahead,
    encoderPreset: config.encoderPreset,
    codec: config.codec,
    adapterIndex: config.adapterIndex,
    micEnabled: config.micEnabled,
    audioLoopback: config.audioLoopback,
    forceSoftware: config.forceSoftware,
    pushToTalk: config.pushToTalk,
    pushToTalkKeys: config.pushToTalkKeys,
    gameDetection: config.gameDetection,
    gameAudioOnly: config.gameAudioOnly,
    customGameProcess: config.customGameProcess,
    micDeviceId: config.micDeviceId,
    autoStartCapture: config.autoStartCapture,
    useExcludeMode: config.useExcludeMode,
    excludeProcessId: config.excludeProcessId,
    gameVolume: config.gameVolume,
    micVolume: config.micVolume,
    selectedAudioSessions: config.selectedAudioSessions,
    noiseSuppression: config.noiseSuppression,
    adaptiveQuality: config.adaptiveQuality,
    stretchToFit: config.stretchToFit,
    replayBufferMode: config.replayBufferMode,
    audioSampleRate: config.audioSampleRate,
    autoCleanupEnabled: config.autoCleanupEnabled,
    autoCleanupThresholdGB: config.autoCleanupThresholdGB,
    hotkeys: config.hotkeys,
    outputDirectory: getDefaultOutputDir(),
    replayTimeSeconds: config.engineReplayTimeSeconds,
    fps: config.engineFps,
  })
}

loadPersistedClipsConfig()
