import { execFile } from 'node:child_process'
import { access, stat as fsStat, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { IPC } from '@shared/channels'
import type {
  AudioSessionInfo,
  ClipInfo,
  ClipMergeResult,
  ClipsConfig,
  ClipTrimResult,
  HotkeyBinding,
  IpcResult,
  MicDeviceInfo,
} from '@shared/types'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import {
  buildEngineConfig,
  config as C,
  clipPathInOutputDir,
  getCurrentConfigPayload,
  getDefaultOutputDir,
  persistClipsConfig,
} from '../services/clips-config-manager'
import {
  AMD_VENDOR_ID,
  appendSharpnessFilter,
  buildAmfEnhanceVf,
  normalizeSharpness,
  parseEnhanceOption,
  probeVideoResolution,
} from '../services/clips-enhance'
import { uploadClipToGofile } from '../services/clips-publish'
import { trackChildProcess } from '../services/exec-utf8'
import { getFfmpegPath } from '../services/ffmpeg-path'
import { getLogger } from '../services/logger.service'
import { getCachedThumbnailPath, getThumbnailDataUrl } from '../services/thumbnail-generator'
import {
  getCurrentStatus,
  getDurationsForClips,
  invalidateClipsCache,
  invalidateDurationCache,
  isEngineRunning,
  isPipeConnected,
  readClipsFromDisk,
  sendPipeCommand,
  sendPipeCommandLongRunning,
  sendWithFallback,
  setEngineCapturing,
  startClipCapture,
  startEngine,
  stopEngineProcess,
} from './clips-engine-connection'

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

let _micDevicesCache: MicDeviceInfo[] | null = null
let _micDevicesCacheTs = 0

let _amdDetected: boolean | null = null

const _publishingPaths = new Set<string>()
const _publishingControllers = new Map<string, AbortController>()

const VALID_ENCODER_PRESETS = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'])

function enumerateMicDevicesLocal(): Promise<MicDeviceInfo[]> {
  if (_micDevicesCache && Date.now() - _micDevicesCacheTs < 10_000) {
    return Promise.resolve(_micDevicesCache)
  }
  const ps = [
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    '$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation`1" })[0]',
    'function AsTask($WinRtTask, $ResultType) {',
    '  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)',
    '  $netTask = $asTask.Invoke($null, @($WinRtTask))',
    '  $netTask',
    '}',
    '[Windows.Devices.Enumeration.DeviceInformation,Windows.Devices,ContentType=WindowsRuntime] | Out-Null',
    '[Windows.Devices.Enumeration.DeviceClass,Windows.Devices,ContentType=WindowsRuntime] | Out-Null',
    '$task = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync([Windows.Devices.Enumeration.DeviceClass]::AudioCapture)',
    '$devices = AsTask $task ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Enumeration.DeviceInformation]]).Result',
    '$defaultId = ""',
    'try { $defaultId = [Windows.Devices.Enumeration.DeviceInformation]::GetDefaultAsync([Windows.Devices.Enumeration.DeviceClass]::AudioCapture).GetAwaiter().GetResult().Id } catch {}',
    'foreach ($d in $devices) {',
    '  $isDef = if ($d.Id -eq $defaultId) { "1" } else { "0" }',
    '  Write-Output ($d.Id + "|" + $d.Name + "|" + $isDef)',
    '}',
  ].join('\r\n')
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command', ps], { timeout: 15000 }, (_err, stdout) => {
      if (_err || !stdout) {
        getLogger().info('clips-mic', `local enumerate failed: ${_err?.message ?? 'empty output'}`)
        resolve([])
        return
      }
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
      const devices: MicDeviceInfo[] = lines
        .map((line) => {
          const [id, name, isDef] = line.split('|')
          return {
            id: (id ?? '').trim(),
            name: (name ?? '').trim(),
            isDefault: isDef === '1',
            channels: 2,
            sampleRate: 48000,
          }
        })
        .filter((d) => d.id && d.name)
      _micDevicesCache = devices
      _micDevicesCacheTs = Date.now()
      getLogger().info('clips-mic', `local enumerate returned ${devices.length} devices`)
      resolve(devices)
    })
  })
}

export function registerClipsIpc(): void {
  ipcMain.handle(IPC.CLIPS_GET_STATUS, getCurrentStatus)

  ipcMain.handle(IPC.CLIPS_START_ENGINE, startEngine)

  ipcMain.handle(IPC.CLIPS_STOP_ENGINE, async (): Promise<{ success: boolean }> => {
    stopEngineProcess()
    return { success: true }
  })

  ipcMain.handle(IPC.CLIPS_START_CAPTURE, startClipCapture)

  ipcMain.handle(IPC.CLIPS_STOP_CAPTURE, async (): Promise<IpcResult> => {
    if (!isEngineRunning()) {
      setEngineCapturing(false)
      return { success: true }
    }
    const result = await sendWithFallback('stopCapture')
    if (result.success) {
      setEngineCapturing(false)
    }
    return result
  })

  ipcMain.handle(IPC.CLIPS_SAVE_CLIP, async (): Promise<IpcResult> => {
    if (!isEngineRunning()) {
      getLogger().warning('clips', 'SaveClip failed: Engine not running')
      return { success: false, error: 'Engine not running' }
    }
    if (!isPipeConnected()) {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        if (isPipeConnected()) break
        if (!isEngineRunning()) {
          getLogger().warning('clips', 'SaveClip failed: Engine stopped during reconnect wait')
          return { success: false, error: 'Engine not running' }
        }
      }
    }
    if (isPipeConnected()) {
      const engineConfig = buildEngineConfig()
      await sendWithFallback('config', engineConfig)
    }
    try {
      const resp = await sendPipeCommandLongRunning('saveClip')
      if (resp.payload?.success === false || resp.payload?.error) {
        getLogger().warning('clips', `SaveClip failed: ${resp.payload?.error || 'Save failed'}`)
        return { success: false, error: String(resp.payload?.error || 'Save failed') }
      }
      invalidateClipsCache()
      return { success: true }
    } catch (err) {
      getLogger().warning('clips', `SaveClip exception: ${err instanceof Error ? err.message : String(err)}`)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.CLIPS_LIST_CLIPS, async (): Promise<ClipInfo[]> => {
    invalidateClipsCache()
    return readClipsFromDisk()
  })

  ipcMain.handle(IPC.CLIPS_GET_DURATIONS, async (_event, paths: unknown): Promise<Record<string, number>> => {
    if (!Array.isArray(paths)) return {}
    const clips = (
      await Promise.all(
        paths
          .filter((p): p is string => typeof p === 'string')
          .map(async (p) => {
            const safe = clipPathInOutputDir(p)
            if (!safe) return null
            try {
              const s = await fsStat(safe)
              return { path: safe, mtimeMs: s.mtime.getTime() }
            } catch {
              return { path: safe, mtimeMs: 0 }
            }
          }),
      )
    ).filter((x): x is { path: string; mtimeMs: number } => x !== null)
    const durations = await getDurationsForClips(clips)
    const result: Record<string, number> = {}
    for (const [k, v] of durations) {
      result[k] = v
    }
    return result
  })

  ipcMain.handle(IPC.CLIPS_DELETE_CLIP, async (_event, clipName: unknown): Promise<IpcResult> => {
    if (typeof clipName !== 'string') {
      getLogger().warning('clips', 'DeleteClip failed: Invalid clip name (not a string)')
      return { success: false, error: 'Invalid clip name' }
    }
    const clipPath = clipPathInOutputDir(clipName)
    if (!clipPath) {
      getLogger().warning('clips', `DeleteClip failed: Invalid path for '${clipName}'`)
      return { success: false, error: 'Invalid path' }
    }
    try {
      const outputDir = getDefaultOutputDir()
      await unlink(clipPath)
      const thumbPath = getCachedThumbnailPath(outputDir, clipName)
      if (thumbPath) {
        try {
          await unlink(thumbPath)
        } catch {
          /* ignore thumbnail cleanup failure */
        }
      }
      const engineThumb = join(outputDir, `${clipName.replace(/\.mp4$/, '')}.thumb.jpg`)
      if (await fileExists(engineThumb)) {
        try {
          await unlink(engineThumb)
        } catch {
          /* ignore engine thumbnail cleanup failure */
        }
      }
      invalidateDurationCache(clipPath)
      invalidateClipsCache()
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      getLogger().warning('clips', `DeleteClip failed: ${msg}`)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(IPC.CLIPS_RENAME_CLIP, async (_event, clipName: unknown, newName: unknown): Promise<IpcResult> => {
    if (typeof clipName !== 'string' || !clipName) {
      getLogger().warning('clips', 'RenameClip failed: Invalid clip name')
      return { success: false, error: 'Invalid clip name' }
    }
    if (typeof newName !== 'string' || !newName) {
      getLogger().warning('clips', 'RenameClip failed: Invalid new name')
      return { success: false, error: 'Invalid new name' }
    }
    if (newName.endsWith('.mp4')) {
      newName = newName.slice(0, -4)
    }
    if (!newName) {
      getLogger().warning('clips', 'RenameClip failed: Invalid new name (empty after stripping .mp4)')
      return { success: false, error: 'Invalid new name' }
    }
    newName = `${newName}.mp4`
    const oldPath = clipPathInOutputDir(clipName)
    if (!oldPath) {
      getLogger().warning('clips', `RenameClip failed: Invalid old clip name '${clipName}'`)
      return { success: false, error: 'Invalid old clip name' }
    }
    const newPath = clipPathInOutputDir(newName)
    if (!newPath) {
      getLogger().warning('clips', `RenameClip failed: Invalid new clip name '${newName}'`)
      return { success: false, error: 'Invalid new clip name' }
    }
    try {
      if (!(await fileExists(oldPath))) {
        getLogger().warning('clips', `RenameClip failed: Clip '${clipName}' not found`)
        return { success: false, error: 'Clip not found' }
      }
      if (await fileExists(newPath)) {
        getLogger().warning('clips', `RenameClip failed: A clip named '${newName}' already exists`)
        return { success: false, error: 'A clip with that name already exists' }
      }
      await rename(oldPath, newPath)
      const outputDir = getDefaultOutputDir()
      const oldThumbPath = getCachedThumbnailPath(outputDir, clipName)
      if (oldThumbPath && (await fileExists(oldThumbPath))) {
        const newThumbPath = join(outputDir, '.thumbnails', `${newName.replace(/\.mp4$/, '')}.jpg`)
        try {
          await rename(oldThumbPath, newThumbPath)
        } catch {
          /* ignore thumbnail rename failure */
        }
      }
      const oldEngineThumb = join(outputDir, `${clipName.replace(/\.mp4$/, '')}.thumb.jpg`)
      if (await fileExists(oldEngineThumb)) {
        const newEngineThumb = join(outputDir, `${newName.replace(/\.mp4$/, '')}.thumb.jpg`)
        try {
          await rename(oldEngineThumb, newEngineThumb)
        } catch {
          /* ignore engine thumbnail rename failure */
        }
      }
      const oldFavPath = join(outputDir, `.${clipName}.favorite`)
      if (await fileExists(oldFavPath)) {
        const newFavPath = join(outputDir, `.${newName}.favorite`)
        try {
          await rename(oldFavPath, newFavPath)
        } catch {
          /* ignore favorite rename failure */
        }
      }
      invalidateDurationCache(oldPath)
      invalidateClipsCache()
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      getLogger().warning('clips', `RenameClip failed: ${msg}`)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(IPC.CLIPS_OPEN_CLIP, async (_event, clipPath: unknown): Promise<void> => {
    if (typeof clipPath !== 'string') return
    const safe = clipPathInOutputDir(clipPath)
    if (!safe) return
    try {
      await shell.openPath(safe)
    } catch (err) {
      getLogger().error('clips', `Failed to open clip: ${err}`)
    }
  })

  ipcMain.handle(IPC.CLIPS_GET_THUMBNAIL, async (_event, clipName: unknown): Promise<string | null> => {
    if (typeof clipName !== 'string') return null
    const safe = clipPathInOutputDir(`${clipName}.mp4`)
    if (!safe) return null
    return getThumbnailDataUrl(getDefaultOutputDir(), clipName)
  })

  ipcMain.handle(IPC.CLIPS_GET_CONFIG, (): ClipsConfig => getCurrentConfigPayload() as ClipsConfig)

  ipcMain.handle(IPC.CLIPS_SET_CONFIG, async (_event, config: unknown): Promise<IpcResult> => {
    getLogger().info('clips', `Config update requested: ${JSON.stringify(config)}`)
    const c = config as Record<string, unknown> | undefined
    if (c) {
      if (typeof c.replayTimeSeconds === 'number')
        C.engineReplayTimeSeconds = Math.max(30, Math.min(600, c.replayTimeSeconds))
      if (typeof c.fps === 'number') C.engineFps = c.fps
      if (typeof c.width === 'number') C.width = c.width
      if (typeof c.height === 'number') C.height = c.height
      if (typeof c.bitrateKbps === 'number') C.bitrateKbps = c.bitrateKbps
      if (typeof c.cq === 'number') C.cq = Math.max(0, Math.min(51, c.cq))
      if (typeof c.maxrateKbps === 'number') C.maxrateKbps = Math.max(1000, c.maxrateKbps)
      if (typeof c.bufsizeKbps === 'number') C.bufsizeKbps = Math.max(2000, c.bufsizeKbps)
      if (typeof c.bframes === 'number') C.bframes = Math.max(0, Math.min(16, c.bframes))
      if (typeof c.lookahead === 'number') C.lookahead = Math.max(0, Math.min(256, c.lookahead))
      if (typeof c.encoderPreset === 'string' && VALID_ENCODER_PRESETS.has(c.encoderPreset))
        C.encoderPreset = c.encoderPreset
      if (typeof c.codec === 'string') C.codec = c.codec
      if (typeof c.adapterIndex === 'number') C.adapterIndex = c.adapterIndex
      if (typeof c.micEnabled === 'boolean') C.micEnabled = c.micEnabled
      if (typeof c.audioLoopback === 'boolean') C.audioLoopback = c.audioLoopback
      if (typeof c.forceSoftware === 'boolean') C.forceSoftware = c.forceSoftware
      if (typeof c.stretchToFit === 'boolean') C.stretchToFit = c.stretchToFit
      if (c.replayBufferMode === 'ram' || c.replayBufferMode === 'hybrid' || c.replayBufferMode === 'disk')
        C.replayBufferMode = c.replayBufferMode
      if (typeof c.gameDetection === 'boolean') C.gameDetection = c.gameDetection
      if (typeof c.gameAudioOnly === 'boolean') C.gameAudioOnly = c.gameAudioOnly
      if (typeof c.customGameProcess === 'string') {
        C.customGameProcess = c.customGameProcess
        getLogger().info(
          'clips',
          `Config customGameProcess set to "${c.customGameProcess}" (pipeConnected=${isPipeConnected()})`,
        )
        if (isPipeConnected() && c.customGameProcess) {
          sendWithFallback('setCustomGameProcess', { processName: c.customGameProcess })
            .then((r) => {
              getLogger().info('clips', `setCustomGameProcess sent: success=${r.success} error=${r.error}`)
            })
            .catch(() => {
              getLogger().warning('clips', 'setCustomGameProcess send failed (caught)')
            })
        }
      }
      if (typeof c.micDeviceId === 'string') {
        C.micDeviceId = c.micDeviceId
        if (isPipeConnected()) {
          sendWithFallback('setMicDevice', { deviceId: c.micDeviceId }).catch(() => {})
        }
      }
      if (typeof c.autoStartCapture === 'boolean') C.autoStartCapture = c.autoStartCapture
      if (typeof c.useExcludeMode === 'boolean') C.useExcludeMode = c.useExcludeMode
      if (typeof c.excludeProcessId === 'number') C.excludeProcessId = c.excludeProcessId
      if (typeof c.gameVolume === 'number') C.gameVolume = Math.max(0, Math.min(4, c.gameVolume))
      if (typeof c.micVolume === 'number') C.micVolume = Math.max(0, Math.min(4, c.micVolume))
      if (c.pushToTalk === 'off' || c.pushToTalk === 'hold' || c.pushToTalk === 'toggle') C.pushToTalk = c.pushToTalk
      if (Array.isArray(c.pushToTalkKeys)) {
        C.pushToTalkKeys = (c.pushToTalkKeys as unknown[]).filter((k) => typeof k === 'number') as number[]
        if (C.pushToTalkKeys.length === 0) C.pushToTalkKeys = [0x7a]
      } else if (typeof c.pushToTalkKey === 'number') {
        C.pushToTalkKeys = [c.pushToTalkKey as number]
      }
      if (Array.isArray(c.hotkeys)) {
        C.hotkeys = c.hotkeys.filter(
          (h): h is HotkeyBinding =>
            typeof h === 'object' &&
            h !== null &&
            typeof (h as Record<string, unknown>).vk === 'number' &&
            typeof (h as Record<string, unknown>).action === 'string' &&
            Array.isArray((h as Record<string, unknown>).modifiers),
        )
      }
      if (typeof c.outputDirectory === 'string' && c.outputDirectory.length > 0 && c.outputDirectory.length < 1024) {
        try {
          const stat = await fsStat(c.outputDirectory)
          if (stat.isDirectory()) {
            C.outputDirectory = c.outputDirectory
          }
        } catch {
          /* reject invalid path */
        }
      }
      if (typeof c.noiseSuppression === 'boolean') C.noiseSuppression = c.noiseSuppression
      if (typeof c.audioSampleRate === 'number') C.audioSampleRate = c.audioSampleRate
      if (typeof c.autoCleanupEnabled === 'boolean') C.autoCleanupEnabled = c.autoCleanupEnabled
      if (typeof c.autoCleanupThresholdGB === 'number')
        C.autoCleanupThresholdGB = Math.max(1, Math.min(100, c.autoCleanupThresholdGB))
      if (typeof c.adaptiveQuality === 'boolean') C.adaptiveQuality = c.adaptiveQuality
    }
    persistClipsConfig()
    if (isPipeConnected()) {
      const engineConfig = buildEngineConfig()
      const hotkeyInfo = (engineConfig.Hotkeys as Record<string, unknown>[]).map(
        (h) => `vk=0x${(h.vk as number).toString(16)} mods=[${(h.modifiers as number[]).join(',')}] act=${h.action}`,
      )
      getLogger().info(
        'clips',
        `Config sync to engine: hotkeys=${JSON.stringify(hotkeyInfo)} pipeConnected=${isPipeConnected()}`,
      )
      const syncResult = await sendWithFallback('config', engineConfig)
      if (!syncResult.success) {
        getLogger().warning('clips', `Config sync to engine failed: ${syncResult.error}`)
      }
    } else {
      getLogger().info('clips', 'Config sync: pipe not connected, skipping')
    }
    return { success: true }
  })

  ipcMain.handle(IPC.CLIPS_SELECT_OUTPUT_DIR, async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Escolher pasta de saída dos clipes',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: getDefaultOutputDir(),
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths.length) return null
    const selectedPath = result.filePaths[0]
    C.outputDirectory = selectedPath
    return selectedPath
  })

  ipcMain.handle(IPC.CLIPS_GET_RUNNING_PROCESSES, async (): Promise<Array<{ name: string; pid: number }>> => {
    return new Promise((resolve) => {
      execFile('tasklist', ['/FO', 'CSV', '/NH'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
        if (err) {
          resolve([])
          return
        }
        const processes: Array<{ name: string; pid: number }> = []
        for (const line of stdout.split('\n')) {
          const parts = line.match(/"([^"]+)","(\d+)"/)
          if (parts) {
            processes.push({ name: parts[1]!, pid: Number(parts[2]!) })
          }
        }
        resolve(processes)
      })
    })
  })

  ipcMain.handle(IPC.CLIPS_GET_AUDIO_SESSIONS, async (): Promise<AudioSessionInfo[]> => {
    if (!isPipeConnected()) return []
    try {
      const resp = await sendPipeCommand('getAudioSessions')
      const sessions = resp.payload?.sessions
      if (Array.isArray(sessions)) {
        return sessions as AudioSessionInfo[]
      }
      return []
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC.CLIPS_SET_AUDIO_SESSIONS, async (_event, sessionPids: unknown): Promise<IpcResult> => {
    if (!Array.isArray(sessionPids)) {
      getLogger().warning('clips', 'SetAudioSessions failed: sessionPids must be an array')
      return { success: false, error: 'sessionPids must be an array' }
    }
    const pids = sessionPids.filter((p): p is number => typeof p === 'number')
    C.selectedAudioSessions = pids
    persistClipsConfig()
    if (!isPipeConnected()) {
      getLogger().warning('clips', 'SetAudioSessions failed: engine pipe not connected')
      return { success: false, error: 'Engine pipe not connected' }
    }
    try {
      const resp = await sendPipeCommand('setAudioSessions', { pids })
      if (resp.payload?.success === false) {
        getLogger().warning('clips', `SetAudioSessions failed: ${resp.payload?.error || 'Command failed'}`)
        return { success: false, error: (resp.payload?.error as string) || 'Command failed' }
      }
      return { success: true }
    } catch (err) {
      getLogger().warning('clips', `SetAudioSessions failed: ${err instanceof Error ? err.message : String(err)}`)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.CLIPS_GET_MIC_DEVICES, async (): Promise<MicDeviceInfo[]> => {
    getLogger().info('clips-mic', `pipeConnected=${isPipeConnected()}`)
    if (isPipeConnected()) {
      try {
        const resp = await sendPipeCommand('getMicDevices')
        getLogger().info(
          'clips-mic',
          `response cmd=${resp.cmd} payload keys=${Object.keys(resp.payload ?? {})} hasDevices=${'devices' in (resp.payload ?? {})}`,
        )
        const devices = resp.payload?.devices
        if (Array.isArray(devices)) {
          getLogger().info('clips-mic', `returning ${devices.length} devices from engine`)
          return devices as MicDeviceInfo[]
        }
        getLogger().warning('clips-mic', 'devices is not an array')
      } catch (err) {
        getLogger().warning('clips-mic', `pipe error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return enumerateMicDevicesLocal()
  })

  ipcMain.handle(IPC.CLIPS_SET_MIC_DEVICE, async (_event, deviceId: unknown): Promise<IpcResult> => {
    if (typeof deviceId !== 'string') {
      getLogger().warning('clips', 'SetMicDevice failed: deviceId must be a string')
      return { success: false, error: 'deviceId must be a string' }
    }
    C.micDeviceId = deviceId
    persistClipsConfig()
    if (!isPipeConnected()) {
      return { success: true }
    }
    try {
      await sendPipeCommand('setMicDevice', { deviceId })
      return { success: true }
    } catch (err) {
      getLogger().warning('clips', `SetMicDevice failed: ${err instanceof Error ? err.message : String(err)}`)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  interface GpuInfo {
    index: number
    name: string
    vendorId: number
  }

  ipcMain.handle(IPC.CLIPS_GET_GPUS, async (): Promise<GpuInfo[]> => {
    if (!isPipeConnected()) return []
    try {
      const resp = await sendPipeCommand('getGpus')
      if (Array.isArray(resp.payload)) {
        // 0x1414 = Microsoft Basic Render Driver (software fallback, no hw encoder)
        const gpus = (resp.payload as GpuInfo[]).filter(
          (gpu) => gpu && typeof gpu === 'object' && typeof gpu.vendorId === 'number' && gpu.vendorId !== 0x1414,
        )
        _amdDetected = gpus.some((gpu) => gpu.vendorId === AMD_VENDOR_ID)
        return gpus
      }
      return []
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC.CLIPS_GET_ENHANCE_SUPPORT, (): { amd: boolean } => ({
    amd: _amdDetected === true,
  }))

  ipcMain.handle(IPC.CLIPS_SET_FAVORITE, async (_event, clipName: unknown, favorite: unknown): Promise<IpcResult> => {
    if (typeof clipName !== 'string' || !clipName) {
      getLogger().warning('clips', 'SetFavorite failed: Invalid clip name')
      return { success: false, error: 'Invalid clip name' }
    }
    if (typeof favorite !== 'boolean') {
      getLogger().warning('clips', 'SetFavorite failed: Invalid favorite value (must be boolean)')
      return { success: false, error: 'Invalid favorite value' }
    }
    const resolvedName = clipPathInOutputDir(`.${clipName}.favorite`)
    if (!resolvedName) {
      getLogger().warning('clips', `SetFavorite failed: Invalid clip name '${clipName}'`)
      return { success: false, error: 'Invalid clip name' }
    }
    try {
      if (favorite) {
        await writeFile(resolvedName, '', 'utf-8')
      } else {
        if (await fileExists(resolvedName)) {
          await unlink(resolvedName)
        }
      }
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      getLogger().error('clips', `Failed to set favorite: ${msg}`)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(
    IPC.CLIPS_TRIM_CLIP,
    async (
      _event,
      clipPath: string,
      startSeconds: number,
      endSeconds: number,
      reEncode?: boolean,
      enhance?: unknown,
      sharpness?: unknown,
    ): Promise<ClipTrimResult> => {
      if (!clipPath || typeof clipPath !== 'string') {
        getLogger().warning('clips', 'TrimClip failed: Invalid clip path')
        return { success: false, error: 'Invalid clip path' }
      }
      const safePath = clipPathInOutputDir(clipPath)
      if (!safePath || !(await fileExists(safePath))) {
        getLogger().warning('clips', `TrimClip failed: Clip file not found '${clipPath}'`)
        return { success: false, error: 'Clip file not found' }
      }
      if (
        typeof startSeconds !== 'number' ||
        typeof endSeconds !== 'number' ||
        endSeconds <= startSeconds ||
        startSeconds < 0
      ) {
        getLogger().warning('clips', `TrimClip failed: Invalid trim range (${startSeconds}-${endSeconds})`)
        return { success: false, error: 'Invalid trim range' }
      }
      const outDir = getDefaultOutputDir()
      await mkdir(outDir, { recursive: true })
      const baseName = basename(safePath, '.mp4')
      const outPath = join(outDir, `${baseName} DiNho Clipe ${Date.now()}.mp4`)
      const copyArgs = ['-c', 'copy']
      const reEncodeArgs = [
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        String(C.cq),
        '-maxrate',
        `${C.maxrateKbps}K`,
        '-bufsize',
        `${C.bufsizeKbps}K`,
        '-c:a',
        'copy',
      ]
      const enhanceOption = parseEnhanceOption(enhance)
      let enhanceVf: string | null = null
      if (enhanceOption !== 'none') {
        if (!reEncode) {
          getLogger().warning('clips', 'TrimClip enhance ignored: enhancement requires re-encode')
        } else if (_amdDetected !== true) {
          getLogger().warning('clips', 'TrimClip enhance ignored: no AMD GPU detected')
        } else {
          const res = await probeVideoResolution(getFfmpegPath(), safePath)
          if (res) {
            enhanceVf = buildAmfEnhanceVf(enhanceOption, res.w, res.h)
          } else {
            getLogger().warning('clips', 'TrimClip enhance ignored: could not probe source resolution')
          }
        }
      }
      const sharpnessVal = normalizeSharpness(sharpness)
      if (sharpnessVal > 0 && !reEncode) {
        getLogger().warning('clips', 'TrimClip sharpness ignored: sharpening requires re-encode')
      }
      const vfChain = appendSharpnessFilter(enhanceVf, sharpnessVal)
      return new Promise((resolve) => {
        const seekArgs = reEncode
          ? [
              '-i',
              safePath,
              '-ss',
              String(startSeconds),
              '-to',
              String(endSeconds),
              ...reEncodeArgs,
              ...(vfChain ? ['-vf', vfChain] : []),
            ]
          : ['-ss', String(startSeconds), '-to', String(endSeconds), '-i', safePath, ...copyArgs]
        const args = ['-y', '-loglevel', 'error', ...seekArgs, outPath]
        const proc = execFile(getFfmpegPath(), args, { timeout: 120_000 }, (err) => {
          if (err) {
            void unlink(outPath).catch(() => {
              /* ignore cleanup error */
            })
            getLogger().warning('clips', `TrimClip ffmpeg failed: ${err.message}`)
            resolve({ success: false, error: err.message })
          } else {
            invalidateClipsCache()
            resolve({ success: true, path: outPath })
          }
        })
        trackChildProcess(proc)
        proc.on('error', (e) => {
          void unlink(outPath).catch(() => {
            /* ignore cleanup error */
          })
          getLogger().warning('clips', `TrimClip process error: ${e.message}`)
          resolve({ success: false, error: e.message })
        })
      })
    },
  )

  ipcMain.handle(
    IPC.CLIPS_MERGE_CLIPS,
    async (_event, clipPaths: string[], enhance?: unknown, sharpness?: unknown): Promise<ClipMergeResult> => {
      if (!Array.isArray(clipPaths) || clipPaths.length < 2) {
        getLogger().warning(
          'clips',
          `MergeClips failed: At least 2 clips required (got ${Array.isArray(clipPaths) ? clipPaths.length : 0})`,
        )
        return { success: false, error: 'At least 2 clips required' }
      }
      const safePaths: string[] = []
      for (const p of clipPaths) {
        if (typeof p !== 'string') {
          getLogger().warning('clips', 'MergeClips failed: Invalid clip path (not a string)')
          return { success: false, error: 'Invalid clip path' }
        }
        const safe = clipPathInOutputDir(p)
        if (!safe || !(await fileExists(safe))) {
          getLogger().warning('clips', `MergeClips failed: Clip not found '${p}'`)
          return { success: false, error: `Clip not found: ${p}` }
        }
        safePaths.push(safe)
      }
      const outDir = getDefaultOutputDir()
      await mkdir(outDir, { recursive: true })
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
      const concatFile = join(outDir, `concat_${Date.now()}.txt`)
      const outPath = join(outDir, `DiNho Clipes ${ts}.mp4`)
      const enhanceOption = parseEnhanceOption(enhance)
      let enhanceVf: string | null = null
      if (enhanceOption !== 'none') {
        if (_amdDetected !== true) {
          getLogger().warning('clips', 'MergeClips enhance ignored: no AMD GPU detected')
        } else {
          const res = await probeVideoResolution(getFfmpegPath(), safePaths[0])
          if (res) {
            enhanceVf = buildAmfEnhanceVf(enhanceOption, res.w, res.h)
          } else {
            getLogger().warning('clips', 'MergeClips enhance ignored: could not probe source resolution')
          }
        }
      }
      const sharpnessVal = normalizeSharpness(sharpness)
      const vfChain = appendSharpnessFilter(enhanceVf, sharpnessVal)
      const streamArgs =
        vfChain !== null
          ? [
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              String(C.cq),
              '-maxrate',
              `${C.maxrateKbps}K`,
              '-bufsize',
              `${C.bufsizeKbps}K`,
              '-vf',
              vfChain,
              '-c:a',
              'copy',
            ]
          : ['-c', 'copy']
      try {
        const lines = safePaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
        await writeFile(concatFile, lines.join('\n'), 'utf-8')
        return await new Promise((resolve) => {
          const args = [
            '-y',
            '-loglevel',
            'error',
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            concatFile,
            ...streamArgs,
            outPath,
          ]
          const proc = execFile(getFfmpegPath(), args, { timeout: 120_000 }, (err) => {
            void unlink(concatFile).catch(() => {})
            if (err) {
              void unlink(outPath).catch(() => {
                /* ignore cleanup error */
              })
              getLogger().warning('clips', `MergeClips ffmpeg failed: ${err.message}`)
              resolve({ success: false, error: err.message })
            } else {
              invalidateClipsCache()
              resolve({ success: true, path: outPath })
            }
          })
          trackChildProcess(proc)
          proc.on('error', (e) => {
            void unlink(concatFile).catch(() => {})
            void unlink(outPath).catch(() => {
              /* ignore cleanup error */
            })
            getLogger().warning('clips', `MergeClips process error: ${e.message}`)
            resolve({ success: false, error: e.message })
          })
        })
      } catch (err) {
        await unlink(concatFile).catch(() => {})
        getLogger().warning('clips', `MergeClips failed: ${err instanceof Error ? err.message : String(err)}`)
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(IPC.CLIPS_OPEN_EXTERNAL, (_event, url: unknown): IpcResult => {
    if (typeof url !== 'string') {
      return { success: false, error: 'Invalid URL' }
    }
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:') {
        getLogger().warning('clips', `Blocked non-https external URL: ${url}`)
        return { success: false, error: 'Only https URLs are allowed' }
      }
      shell.openExternal(parsed.toString())
      return { success: true, data: { opened: true } }
    } catch {
      getLogger().warning('clips', `Invalid external URL: ${url}`)
      return { success: false, error: 'Invalid URL' }
    }
  })

  ipcMain.handle(IPC.CLIPS_PUBLISH, async (_event, clipPath: unknown): Promise<IpcResult> => {
    if (typeof clipPath !== 'string' || !clipPath) {
      getLogger().warning('clips', 'Publish failed: Invalid clip path')
      return { success: false, error: 'Invalid clip path' }
    }
    const safe = clipPathInOutputDir(clipPath)
    if (!safe || !(await fileExists(safe))) {
      getLogger().warning('clips', `Publish failed: Clip file not found '${clipPath}'`)
      return { success: false, error: 'Clip file not found' }
    }
    if (_publishingPaths.has(safe)) {
      getLogger().warning('clips', 'Publish failed: Upload already in progress')
      return { success: false, error: 'Upload already in progress' }
    }
    const controller = new AbortController()
    _publishingPaths.add(safe)
    _publishingControllers.set(safe, controller)
    try {
      const result = await uploadClipToGofile(
        safe,
        (progress) => {
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(IPC.CLIPS_PUBLISH_PROGRESS, { clipPath: safe, ...progress })
          }
        },
        controller.signal,
      )
      return result.success
        ? { success: true, data: { link: result.link } }
        : {
            success: false,
            error: result.error ?? 'Upload failed',
            code: result.cancelled ? 'ABORTED' : undefined,
          }
    } finally {
      _publishingPaths.delete(safe)
      _publishingControllers.delete(safe)
    }
  })

  ipcMain.handle(IPC.CLIPS_PUBLISH_CANCEL, (_event, clipPath: unknown): IpcResult => {
    if (typeof clipPath !== 'string' || !clipPath) {
      return { success: false, error: 'Invalid clip path' }
    }
    const safe = clipPathInOutputDir(clipPath)
    const controller = safe ? _publishingControllers.get(safe) : undefined
    if (!safe || !controller) {
      getLogger().warning('clips', 'Publish cancel failed: no upload in progress')
      return { success: false, error: 'No upload in progress' }
    }
    controller.abort(new Error('Aborted'))
    return { success: true }
  })
}
