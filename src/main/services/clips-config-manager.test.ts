import { join } from 'node:path'
import type { HotkeyBinding } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./clips-config-store', () => ({
  loadClipsConfig: vi.fn(() => ({
    replayTimeSeconds: 120,
    micEnabled: true,
    noiseSuppression: undefined as unknown as boolean,
    audioLoopback: false,
    fps: 30,
    width: 1280,
    height: 720,
    bitrateKbps: 40000,
    cq: 20,
    maxrateKbps: 35000,
    bufsizeKbps: 70000,
    bframes: 3,
    lookahead: 16,
    encoderPreset: 'p4',
    codec: 'auto',
    adapterIndex: -1,
    outputDirectory: '',
    forceSoftware: false,
    hotkeys: [
      { id: 'hk-save-8', vk: 123, modifiers: [], action: 'saveClip', replayDurationSeconds: 300, enabled: true },
      { id: 'hk-1782208376874', vk: 122, modifiers: [], action: 'saveClip', replayDurationSeconds: 120, enabled: true },
      {
        id: 'hk-1782222941097',
        vk: 49,
        modifiers: ['Alt'],
        action: 'toggleCapture',
        replayDurationSeconds: 60,
        enabled: true,
      },
    ],
    pushToTalk: 'hold',
    pushToTalkKeys: [5, 20],
    gameDetection: true,
    gameAudioOnly: true,
    customGameProcess: '',
    micDeviceId: '',
    autoStartCapture: true,
    useExcludeMode: false,
    excludeProcessId: 0,
    gameVolume: 1.0,
    micVolume: 1.0,
    selectedAudioSessions: [],
    audioSampleRate: 48000,
    autoCleanupEnabled: true,
    autoCleanupThresholdGB: 100,
    adaptiveQuality: true,
  })),
  saveClipsConfig: vi.fn((cfg: Record<string, unknown>) => cfg),
}))

const mockUserProfile = 'C:\\Users\\TestUser'
const originalUserProfile = process.env.USERPROFILE

import {
  buildEngineConfig,
  clipPathInOutputDir,
  config,
  getCurrentConfigPayload,
  getDefaultOutputDir,
  loadPersistedClipsConfig,
  persistClipsConfig,
} from './clips-config-manager'
import { loadClipsConfig, saveClipsConfig } from './clips-config-store'

describe('clips-config-manager', () => {
  beforeEach(() => {
    process.env.USERPROFILE = mockUserProfile
    vi.clearAllMocks()
  })

  afterAll(() => {
    process.env.USERPROFILE = originalUserProfile
  })

  describe('module initialization', () => {
    it('populates config from persisted defaults', () => {
      expect(config.width).toBe(1280)
      expect(config.height).toBe(720)
      expect(config.bitrateKbps).toBe(40000)
      expect(config.pushToTalk).toBe('hold')
      expect(config.hotkeys).toHaveLength(3)
    })
  })

  describe('buildEngineConfig', () => {
    it('returns all expected fields with values from loaded config', () => {
      const result = buildEngineConfig()
      expect(result.replayTimeSeconds).toBe(120)
      expect(result.micEnabled).toBe(true)
      expect(result.audioLoopback).toBe(false)
      expect(result.fps).toBe(30)
      expect(result.width).toBe(1280)
      expect(result.height).toBe(720)
      expect(result.bitrateKbps).toBe(40000)
      expect(result.cq).toBe(20)
      expect(result.maxrateKbps).toBe(35000)
      expect(result.bufsizeKbps).toBe(70000)
      expect(result.bframes).toBe(3)
      expect(result.lookahead).toBe(16)
      expect(result.encoderPreset).toBe('p4')
      expect(result.codec).toBe('auto')
      expect(result.adapterIndex).toBe(-1)
      expect(result.forceSoftware).toBe(false)
      expect(result.pushToTalk).toBe('hold')
      expect(result.pushToTalkKeys).toEqual([5, 20])
      expect(result.gameDetection).toBe(true)
      expect(result.gameAudioOnly).toBe(true)
      expect(result.customGameProcess).toBeUndefined()
      expect(result.micDeviceId).toBeUndefined()
      expect(result.autoStartCapture).toBe(true)
      expect(result.useExcludeMode).toBe(false)
      expect(result.excludeProcessId).toBe(0)
      expect(result.gameVolume).toBe(1.0)
      expect(result.micVolume).toBe(1.0)
      expect(result.audioSampleRate).toBe(48000)
      expect(result.electronPid).toBe(process.pid)
    })

    it('returns undefined for falsy customGameProcess', () => {
      config.customGameProcess = ''
      expect(buildEngineConfig().customGameProcess).toBeUndefined()
      config.customGameProcess = 'game.exe'
    })

    it('returns undefined for falsy micDeviceId', () => {
      config.micDeviceId = ''
      expect(buildEngineConfig().micDeviceId).toBeUndefined()
      config.micDeviceId = 'mic-1'
    })

    it('includes stretchToFit false by default', () => {
      config.stretchToFit = false
      expect(buildEngineConfig().stretchToFit).toBe(false)
    })

    it('propagates stretchToFit true to the engine payload', () => {
      config.stretchToFit = true
      expect(buildEngineConfig().stretchToFit).toBe(true)
      config.stretchToFit = false
    })

    it('includes replayBufferMode disk by default', () => {
      config.replayBufferMode = 'disk'
      expect(buildEngineConfig().replayBufferMode).toBe('disk')
    })

    it('propagates replayBufferMode ram to the engine payload', () => {
      config.replayBufferMode = 'ram'
      expect(buildEngineConfig().replayBufferMode).toBe('ram')
    })

    it('propagates replayBufferMode disk to the engine payload', () => {
      config.replayBufferMode = 'disk'
      expect(buildEngineConfig().replayBufferMode).toBe('disk')
    })

    it('uses config hotkeys when non-empty', () => {
      const customHk = [
        { id: 'test', vk: 0x31, modifiers: [], action: 'saveClip', replayDurationSeconds: 30, enabled: true },
      ]
      config.hotkeys = customHk as HotkeyBinding[]
      const result = buildEngineConfig()
      expect(result.Hotkeys as Record<string, unknown>[]).toHaveLength(1)
      expect((result.Hotkeys as Record<string, unknown>[])[0]!.vk).toBe(0x31)
    })

    it('uses default hotkeys when config.hotkeys is empty', () => {
      config.hotkeys = []
      const result = buildEngineConfig()
      expect((result.Hotkeys as Record<string, unknown>[])[0]!.vk).toBe(0x77)
    })

    it('maps modifier names to VK codes', () => {
      config.hotkeys = [
        {
          id: 'test',
          vk: 0x31,
          modifiers: ['Ctrl', 'Shift', 'Alt'],
          action: 'saveClip',
          replayDurationSeconds: 30,
          enabled: true,
        },
      ]
      const result = buildEngineConfig()
      const hk = (result.Hotkeys as Record<string, unknown>[])[0]!
      expect(hk.modifiers).toEqual([0x11, 0x10, 0x12])
    })

    it('returns 0 for unknown modifier', () => {
      const hotkey: HotkeyBinding = {
        id: 'test',
        vk: 0x31,
        modifiers: ['Ctrl'],
        action: 'saveClip',
        replayDurationSeconds: 30,
        enabled: true,
      }
      const modifiers = hotkey.modifiers as string[]
      modifiers.length = 0
      modifiers.push('Super')
      config.hotkeys = [hotkey]
      const result = buildEngineConfig()
      const hk = (result.Hotkeys as Record<string, unknown>[])[0]!
      expect(hk.modifiers).toEqual([0])
    })

    it('uses process.pid for excludeProcessId when useExcludeMode is true', () => {
      config.useExcludeMode = true
      expect(buildEngineConfig().excludeProcessId).toBe(process.pid)
      config.useExcludeMode = false
    })

    it('capitalizes action name for engine format', () => {
      config.hotkeys = [
        { id: 'test', vk: 0x31, modifiers: [], action: 'toggleMic', replayDurationSeconds: 30, enabled: true },
      ]
      const result = buildEngineConfig()
      const hk = (result.Hotkeys as Record<string, unknown>[])[0]!
      expect(hk.action).toBe('ToggleMic')
    })

    it('returns undefined for falsy autoStartCapture', () => {
      config.autoStartCapture = false
      expect(buildEngineConfig().autoStartCapture).toBeUndefined()
      config.autoStartCapture = true
    })
  })

  describe('getDefaultOutputDir', () => {
    it('returns config.outputDirectory when set', () => {
      config.outputDirectory = 'D:\\Clips'
      expect(getDefaultOutputDir()).toBe('D:\\Clips')
      config.outputDirectory = ''
    })

    it('falls back to USERPROFILE when outputDirectory is empty', () => {
      config.outputDirectory = ''
      expect(getDefaultOutputDir()).toBe(join(mockUserProfile, 'Videos', 'DiNho Clips'))
    })

    it('falls back to HOMEDRIVE+HOMEPATH when USERPROFILE is unset', () => {
      delete process.env.USERPROFILE
      process.env.HOMEDRIVE = 'D:'
      process.env.HOMEPATH = '\\Users\\teste'
      config.outputDirectory = ''
      expect(getDefaultOutputDir()).toBe(join('D:\\Users\\teste', 'Videos', 'DiNho Clips'))
      delete process.env.HOMEDRIVE
      delete process.env.HOMEPATH
      process.env.USERPROFILE = mockUserProfile
    })

    it('falls back to cwd when no home env vars are set', () => {
      delete process.env.USERPROFILE
      delete process.env.HOMEDRIVE
      delete process.env.HOMEPATH
      config.outputDirectory = ''
      expect(getDefaultOutputDir()).toBe(join(process.cwd(), 'Videos', 'DiNho Clips'))
      process.env.USERPROFILE = mockUserProfile
    })
  })

  describe('clipPathInOutputDir', () => {
    beforeEach(() => {
      config.outputDirectory = ''
    })

    it('returns resolved path for valid clip name', () => {
      const result = clipPathInOutputDir('clip.mp4')
      expect(result).toBe(join(mockUserProfile, 'Videos', 'DiNho Clips', 'clip.mp4'))
    })

    it('accepts the output directory itself (open folder)', () => {
      const dir = join(mockUserProfile, 'Videos', 'DiNho Clips')
      expect(clipPathInOutputDir(dir)).toBe(dir)
    })

    it('accepts the output directory itself with trailing separator', () => {
      const dir = join(mockUserProfile, 'Videos', 'DiNho Clips')
      expect(clipPathInOutputDir(`${dir}\\`)).toBe(dir)
    })

    it('returns null for path traversal attempt', () => {
      expect(clipPathInOutputDir('..\\..\\Windows\\system.ini')).toBeNull()
    })

    it('returns null for absolute path outside output dir', () => {
      expect(clipPathInOutputDir('C:\\Windows\\system.ini')).toBeNull()
    })

    it('returns null when path resolution throws', () => {
      expect(clipPathInOutputDir(undefined as unknown as string)).toBeNull()
    })
  })

  describe('getCurrentConfigPayload', () => {
    it('returns engine config without Hotkeys and electronPid', () => {
      const result = getCurrentConfigPayload()
      expect(result.Hotkeys).toBeUndefined()
      expect(result.electronPid).toBeUndefined()
    })

    it('includes frontend-only fields', () => {
      const result = getCurrentConfigPayload()
      expect(result).toHaveProperty('hotkeys')
      expect(result).toHaveProperty('selectedAudioSessions')
      expect(result).toHaveProperty('useExcludeMode')
      expect(result).toHaveProperty('excludeProcessId')
    })

    it('preserves all engine config fields', () => {
      const result = getCurrentConfigPayload()
      expect(result.replayTimeSeconds).toBe(120)
      expect(result.width).toBe(1280)
      expect(result.bitrateKbps).toBe(40000)
    })

    it('uses default hotkeys when config.hotkeys is empty', () => {
      config.hotkeys = []
      const result = getCurrentConfigPayload()
      expect((result.hotkeys as Record<string, unknown>[])[0]!.vk).toBe(0x77)
    })
  })

  describe('loadPersistedClipsConfig', () => {
    it('loads from store and updates config object', () => {
      config.width = 0
      loadPersistedClipsConfig()
      expect(config.width).toBe(1280)
    })

    it('applies defaults for missing optional fields', () => {
      vi.mocked(loadClipsConfig).mockReturnValueOnce({
        replayTimeSeconds: 300,
        micEnabled: true,
        noiseSuppression: false,
        audioLoopback: false,
        fps: 60,
        width: 1920,
        height: 1080,
        bitrateKbps: 40000,
        cq: undefined as unknown as number,
        maxrateKbps: undefined as unknown as number,
        bufsizeKbps: undefined as unknown as number,
        bframes: undefined as unknown as number,
        lookahead: undefined as unknown as number,
        encoderPreset: undefined as unknown as string,
        codec: undefined as unknown as string,
        adapterIndex: undefined as unknown as number,
        outputDirectory: '',
        forceSoftware: false,
        hotkeys: [],
        pushToTalk: 'hold',
        pushToTalkKeys: [],
        gameDetection: true,
        gameAudioOnly: false,
        customGameProcess: '',
        micDeviceId: undefined as unknown as string,
        autoStartCapture: undefined as unknown as boolean,
        useExcludeMode: undefined as unknown as boolean,
        excludeProcessId: undefined as unknown as number,
        gameVolume: undefined as unknown as number,
        micVolume: undefined as unknown as number,
        selectedAudioSessions: undefined as unknown as number[],
        audioSampleRate: undefined as unknown as number,
        autoCleanupEnabled: undefined as unknown as boolean,
        autoCleanupThresholdGB: undefined as unknown as number,
        adaptiveQuality: undefined as unknown as boolean,
        stretchToFit: false,
        replayBufferMode: 'ram',
      })
      loadPersistedClipsConfig()
      expect(config.cq).toBe(20)
      expect(config.maxrateKbps).toBe(30000)
      expect(config.bufsizeKbps).toBe(60000)
      expect(config.bframes).toBe(3)
      expect(config.lookahead).toBe(16)
      expect(config.encoderPreset).toBe('p5')
      expect(config.codec).toBe('auto')
      expect(config.adapterIndex).toBe(-1)
      expect(config.micDeviceId).toBe('')
      expect(config.autoStartCapture).toBe(false)
      expect(config.useExcludeMode).toBe(false)
      expect(config.excludeProcessId).toBe(0)
      expect(config.gameVolume).toBe(1.0)
      expect(config.micVolume).toBe(1.0)
      expect(config.selectedAudioSessions).toEqual([])
      expect(config.noiseSuppression).toBe(false)
      expect(config.audioSampleRate).toBe(48000)
      expect(config.autoCleanupEnabled).toBe(true)
      expect(config.autoCleanupThresholdGB).toBe(100)
      expect(config.stretchToFit).toBe(false)
    })

    it('syncs replayTimeSeconds and fps from store', () => {
      const saved: ReturnType<typeof loadClipsConfig> = {
        replayTimeSeconds: 600,
        fps: 120,
        micEnabled: true,
        noiseSuppression: false,
        audioLoopback: false,
        width: 1920,
        height: 1080,
        bitrateKbps: 40000,
        cq: 22,
        maxrateKbps: 30000,
        bufsizeKbps: 60000,
        bframes: 3,
        lookahead: 32,
        encoderPreset: 'p4',
        codec: 'auto',
        adapterIndex: -1,
        outputDirectory: '',
        forceSoftware: false,
        hotkeys: [],
        pushToTalk: 'hold',
        pushToTalkKeys: [],
        gameDetection: true,
        gameAudioOnly: false,
        customGameProcess: '',
        micDeviceId: '',
        autoStartCapture: false,
        useExcludeMode: false,
        excludeProcessId: 0,
        gameVolume: 1.0,
        micVolume: 1.0,
        selectedAudioSessions: [],
        audioSampleRate: 48000,
        autoCleanupEnabled: true,
        autoCleanupThresholdGB: 100,
        adaptiveQuality: true,
        replayBufferMode: 'disk',
        stretchToFit: false,
      }
      vi.mocked(loadClipsConfig).mockReturnValueOnce(saved)
      loadPersistedClipsConfig()
      expect(config.engineReplayTimeSeconds).toBe(600)
      expect(config.engineFps).toBe(120)
      expect(config.replayBufferMode).toBe('disk')
    })
  })

  describe('persistClipsConfig', () => {
    it('calls saveClipsConfig with current config values', () => {
      config.width = 2560
      config.height = 1440
      config.engineReplayTimeSeconds = 300
      config.engineFps = 60
      persistClipsConfig()
      expect(saveClipsConfig).toHaveBeenCalledTimes(1)
      const saved = vi.mocked(saveClipsConfig).mock.calls[0]![0]
      expect(saved.width).toBe(2560)
      expect(saved.height).toBe(1440)
      expect(saved.bitrateKbps).toBe(40000)
      expect(saved.replayTimeSeconds).toBe(300)
      expect(saved.fps).toBe(60)
    })

    it('persists stretchToFit from config', () => {
      config.stretchToFit = true
      persistClipsConfig()
      const saved = vi.mocked(saveClipsConfig).mock.calls[0]![0] as Record<string, unknown>
      expect(saved.stretchToFit).toBe(true)
      config.stretchToFit = false
    })

    it('persists replayBufferMode from config', () => {
      config.replayBufferMode = 'hybrid'
      persistClipsConfig()
      const saved = vi.mocked(saveClipsConfig).mock.calls[0]![0] as Record<string, unknown>
      expect(saved.replayBufferMode).toBe('hybrid')
      config.replayBufferMode = 'hybrid'
    })

    it('includes outputDirectory from getDefaultOutputDir', () => {
      config.outputDirectory = ''
      persistClipsConfig()
      const saved = vi.mocked(saveClipsConfig).mock.calls[0]![0] as Record<string, unknown>
      expect(saved.outputDirectory).toBe(join(mockUserProfile, 'Videos', 'DiNho Clips'))
    })
  })
})
