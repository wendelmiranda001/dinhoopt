import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/user-data'),
    isPackaged: false,
  },
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { loadClipsConfig, resetClipsConfig, saveClipsConfig } from './clips-config-store'

describe('clips-config-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads defaults when no file exists', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const cfg = loadClipsConfig()
    expect(cfg.replayTimeSeconds).toBe(120)
    expect(cfg.micEnabled).toBe(true)
    expect(cfg.audioLoopback).toBe(false)
    expect(cfg.fps).toBe(60)
    expect(cfg.width).toBe(1280)
    expect(cfg.height).toBe(720)
    expect(cfg.bitrateKbps).toBe(30000)
    expect(cfg.cq).toBe(20)
    expect(cfg.maxrateKbps).toBe(30000)
    expect(cfg.bufsizeKbps).toBe(60000)
    expect(cfg.bframes).toBe(3)
    expect(cfg.lookahead).toBe(16)
    expect(cfg.encoderPreset).toBe('p5')
    expect(cfg.forceSoftware).toBe(false)
    expect(cfg.pushToTalk).toBe('hold')
    expect(cfg.pushToTalkKeys).toEqual([5, 20])
    expect(cfg.gameDetection).toBe(true)
    expect(cfg.gameAudioOnly).toBe(true)
    expect(cfg.hotkeys).toHaveLength(3)
    expect(cfg.hotkeys[0]!.vk).toBe(123)
    expect(cfg.hotkeys[1]!.vk).toBe(122)
    expect(cfg.hotkeys[2]!.vk).toBe(49)
    expect(cfg.outputDirectory).toBe('')
    expect(cfg.useExcludeMode).toBe(false)
    expect(cfg.excludeProcessId).toBe(0)
    expect(cfg.stretchToFit).toBe(false)
    expect(cfg.customGameProcess).toBe('')
    expect(cfg.micDeviceId).toBe('')
  })

  it('loads saved config when file exists', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        replayTimeSeconds: 300,
        micEnabled: false,
        audioLoopback: true,
        fps: 120,
        width: 2560,
        height: 1440,
        bitrateKbps: 50000,
        cq: 22,
        maxrateKbps: 30000,
        bufsizeKbps: 60000,
        bframes: 0,
        lookahead: 4,
        encoderPreset: 'p4',
        outputDirectory: 'D:\\Clips',
        forceSoftware: true,
        stretchToFit: true,
        hotkeys: [],
        pushToTalk: 'hold',
        pushToTalkKeys: [0x7a, 0x7b],
        gameDetection: true,
        gameAudioOnly: true,
      }),
    )
    const cfg = loadClipsConfig()
    expect(cfg.replayTimeSeconds).toBe(300)
    expect(cfg.micEnabled).toBe(false)
    expect(cfg.audioLoopback).toBe(true)
    expect(cfg.fps).toBe(120)
    expect(cfg.width).toBe(2560)
    expect(cfg.height).toBe(1440)
    expect(cfg.bitrateKbps).toBe(50000)
    expect(cfg.cq).toBe(22)
    expect(cfg.maxrateKbps).toBe(30000)
    expect(cfg.bufsizeKbps).toBe(60000)
    expect(cfg.bframes).toBe(0)
    expect(cfg.lookahead).toBe(4)
    expect(cfg.encoderPreset).toBe('p4')
    expect(cfg.outputDirectory).toBe('D:\\Clips')
    expect(cfg.forceSoftware).toBe(true)
    expect(cfg.pushToTalk).toBe('hold')
    expect(cfg.pushToTalkKeys).toEqual([0x7a, 0x7b])
    expect(cfg.gameDetection).toBe(true)
    expect(cfg.gameAudioOnly).toBe(true)
    expect(cfg.stretchToFit).toBe(true)
  })

  it('loads saved replayBufferMode hybrid from file', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ replayBufferMode: 'hybrid' }))
    const cfg = loadClipsConfig()
    expect(cfg.replayBufferMode).toBe('hybrid')
  })

  it('loads saved replayBufferMode disk from file', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ replayBufferMode: 'disk' }))
    const cfg = loadClipsConfig()
    expect(cfg.replayBufferMode).toBe('disk')
  })

  it('falls back to defaults on corrupt JSON', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('not-json')
    const cfg = loadClipsConfig()
    expect(cfg.replayTimeSeconds).toBe(120)
  })

  it('saves config with partial update', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const saved = saveClipsConfig({ fps: 120, gameAudioOnly: true })
    expect(saved.fps).toBe(120)
    expect(saved.gameAudioOnly).toBe(true)
    expect(saved.replayTimeSeconds).toBe(120)
    expect(writeFileSync).toHaveBeenCalledTimes(1)
  })

  it('resets to defaults', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    resetClipsConfig()
    expect(writeFileSync).toHaveBeenCalled()
    const callArg = JSON.parse(vi.mocked(writeFileSync).mock.calls[0]![1] as string)
    expect(callArg.gameDetection).toBe(true)
    expect(callArg.gameAudioOnly).toBe(true)
  })

  it('merges partial JSON with defaults via config manager', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        replayTimeSeconds: 300,
        fps: 60,
        width: 2560,
        height: 1440,
        micEnabled: false,
        encoderPreset: 'p5',
        pushToTalk: 'off',
        pushToTalkKeys: [0x7a],
        hotkeys: [],
        gameDetection: false,
        gameAudioOnly: false,
      }),
    )
    const cfg = loadClipsConfig()
    // Store returns exactly what's in the file (no deep merge)
    expect(cfg.replayTimeSeconds).toBe(300)
    expect(cfg.fps).toBe(60)
    expect(cfg.width).toBe(2560)
    expect(cfg.height).toBe(1440)
    expect(cfg.micEnabled).toBe(false)
    expect(cfg.encoderPreset).toBe('p5')
    expect(cfg.pushToTalk).toBe('off')
    expect(cfg.pushToTalkKeys).toEqual([0x7a])
    expect(cfg.hotkeys).toHaveLength(0)
    expect(cfg.gameDetection).toBe(false)
  })

  it('resetClipsConfig writes all important default fields', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    resetClipsConfig()
    expect(writeFileSync).toHaveBeenCalledTimes(1)
    const callArg = JSON.parse(vi.mocked(writeFileSync).mock.calls[0]![1] as string)
    expect(callArg.replayTimeSeconds).toBe(120)
    expect(callArg.micEnabled).toBe(true)
    expect(callArg.audioLoopback).toBe(false)
    expect(callArg.fps).toBe(60)
    expect(callArg.width).toBe(1280)
    expect(callArg.height).toBe(720)
    expect(callArg.bitrateKbps).toBe(30000)
    expect(callArg.cq).toBe(20)
    expect(callArg.maxrateKbps).toBe(30000)
    expect(callArg.bufsizeKbps).toBe(60000)
    expect(callArg.bframes).toBe(3)
    expect(callArg.lookahead).toBe(16)
    expect(callArg.encoderPreset).toBe('p5')
    expect(callArg.forceSoftware).toBe(false)
    expect(callArg.pushToTalk).toBe('hold')
    expect(callArg.pushToTalkKeys).toEqual([5, 20])
    expect(callArg.hotkeys).toHaveLength(3)
    expect(callArg.outputDirectory).toBe('')
    expect(callArg.gameVolume).toBe(1.0)
    expect(callArg.micVolume).toBe(1.0)
    expect(callArg.autoCleanupEnabled).toBe(true)
    expect(callArg.autoCleanupThresholdGB).toBe(100)
    expect(callArg.adaptiveQuality).toBe(true)
    expect(callArg.replayBufferMode).toBe('disk')
  })

  it('mutation safety: modifying returned config does not affect subsequent loads', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const cfg1 = loadClipsConfig()
    cfg1.fps = 999
    cfg1.replayTimeSeconds = 9999
    const cfg2 = loadClipsConfig()
    expect(cfg2.fps).toBe(60)
    expect(cfg2.replayTimeSeconds).toBe(120)
  })
})
