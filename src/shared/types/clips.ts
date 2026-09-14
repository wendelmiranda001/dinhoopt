// ─── Clips / Game Capture ───────────────────────────────────

export type HotkeyAction = 'saveClip' | 'toggleCapture' | 'toggleMic' | 'pushToTalk'
export type HotkeyModifier = 'Ctrl' | 'Shift' | 'Alt'
export type PushToTalkMode = 'off' | 'hold' | 'toggle'

export interface HotkeyBinding {
  id: string
  vk: number
  modifiers: HotkeyModifier[]
  action: HotkeyAction
  replayDurationSeconds?: number
  enabled: boolean
}

export interface AudioSessionInfo {
  processId: number
  processName: string
  displayName: string
  isSelected: boolean
}

export interface ClipsEngineStatus {
  running: boolean
  capturing: boolean
  uptime: number
  fps: number
  replayTimeSeconds: number
  captureBackend?: string
  encoder?: string
  estimatedRamMB?: number
  diskSpaceOk?: boolean
  currentGame?: string
  customGameProcess?: string
  lastCrashRecovered?: boolean
  audioLoopback?: boolean
  audioFallback?: boolean
  audioSampleRate?: number
  lastFrameMs?: number
  lastClipSize?: number
  activePipelines?: number
  watchdogOk?: boolean
  memoryMB?: number
  replayBufferBytes?: number
  replayBufferVideoFrames?: number
  replayBufferVideoBytes?: number
  replayBufferAudioPackets?: number
  replayBufferAudioBytes?: number
  droppedFrames?: number
  gpuBusyDrops?: number
  /** Perfil calibrado da máquina aplicado na última captura (Weak/Medium/Strong) */
  calibrationTier?: string
}

export interface ClipInfo {
  name: string
  path: string
  size: number
  createdAt: string
  duration: number
}

export interface MicDeviceInfo {
  id: string
  name: string
  isDefault: boolean
  channels: number
  sampleRate: number
}

export interface ClipsConfig {
  replayTimeSeconds: number
  micEnabled: boolean
  audioLoopback: boolean
  fps: number
  width: number
  height: number
  bitrateKbps: number
  /** CRF value for NVENC/AV1 (0-51, lower = better, default 24) */
  cq: number
  /** VBV max bitrate in Kbps (default 50000 = 50Mbps) */
  maxrateKbps: number
  /** VBV buffer size in Kbps (default 100000 = 100Mbps) */
  bufsizeKbps: number
  /** Number of B-frames (0-16, default 2) */
  bframes: number
  /** RC lookahead frames (0-256, default 4) */
  lookahead: number
  /** NVENC preset (p4, p5, etc., default p4) */
  encoderPreset: string
  /** Codec preference: auto | h264 | hevc | av1 | libx264 | libx265 */
  codec?: string
  /** GPU adapter index for multi-GPU systems (-1 = auto) */
  adapterIndex?: number
  outputDirectory: string
  forceSoftware: boolean
  hotkeys: HotkeyBinding[]
  pushToTalk: PushToTalkMode
  pushToTalkKeys: number[]
  gameDetection: boolean
  gameAudioOnly: boolean
  customGameProcess?: string
  micDeviceId?: string
  autoStartCapture?: boolean
  /** Volume do áudio do jogo no clip (0.0 a 2.0, default 1.0) */
  gameVolume?: number
  /** Volume do microfone no clip (0.0 a 2.0, default 1.0) */
  micVolume?: number
  selectedAudioSessions: number[]
  useExcludeMode: boolean
  excludeProcessId: number
  /** Sample rate de áudio: 44100, 48000, 96000 (default 48000) */
  audioSampleRate?: number
  /** AutoCleanup: remove clips antigos quando o disco está cheio */
  autoCleanupEnabled: boolean
  /** Limite em GB de espaço total que o usuário quer usar para clips (default 20) */
  autoCleanupThresholdGB: number
  /** RNNoise/anlmdn noise suppression on microphone */
  noiseSuppression?: boolean
  /** RAM-aware adaptive quality: adjusts CQ/resolution/replay based on available system RAM */
  adaptiveQuality?: boolean
  /** Remove black bars (letterboxing) by stretching to fill the full 16:9 frame instead of preserving aspect ratio */
  stretchToFit?: boolean
  /** Buffer de replay: 'ram' = só RAM (excedente descartado); 'hybrid' = RAM cap 3min + excedente no disco */
  replayBufferMode?: 'ram' | 'hybrid'
}

export interface ClipTrimResult {
  success: boolean
  path?: string
  error?: string
}

export interface ClipMergeResult {
  success: boolean
  path?: string
  error?: string
}

/** AMF enhancement applied during re-encode (AMD GPUs only). 'none' = no enhancement. */
export type EnhanceOption = 'none' | 'sr' | 'frc' | 'sr+frc'
