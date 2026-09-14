// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetStatus = vi.fn()
const mockGetConfig = vi.fn()
const mockSetConfig = vi.fn()
const mockList = vi.fn()
const mockStartEngine = vi.fn()
const mockStopEngine = vi.fn()
const mockStartCapture = vi.fn()
const mockStopCapture = vi.fn()
const mockSaveClip = vi.fn()
const mockDeleteClip = vi.fn()
const mockOpenClip = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...props }: any) => <div {...props}>{children}</div>,
    },
  ) as any,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('lucide-react', () => {
  const Icon = ({ children, ...props }: { children?: React.ReactNode }) => <div {...props}>{children}</div>
  const icons = [
    'ChevronDown',
    'CircleStop',
    'Clapperboard',
    'Combine',
    'Cpu',
    'Disc',
    'Download',
    'EllipsisVertical',
    'Film',
    'FolderOpen',
    'Gamepad2',
    'Gauge',
    'HardDrive',
    'Mic',
    'Microscope',
    'Pencil',
    'Plus',
    'Power',
    'PowerOff',
    'RefreshCw',
    'Search',
    'Settings',
    'Sparkles',
    'Star',
    'Trash2',
    'TriangleAlert',
    'Upload',
    'Video',
    'X',
  ]
  const iconMap: Record<string, any> = {}
  for (const name of icons) iconMap[name] = Icon
  return iconMap
})

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const mockOnEngineStatus = vi.fn(() => vi.fn())

window.dinho = {
  clipsGetStatus: mockGetStatus,
  clipsGetConfig: mockGetConfig,
  clipsSetConfig: mockSetConfig,
  clipsList: mockList,
  clipsStartEngine: mockStartEngine,
  clipsStopEngine: mockStopEngine,
  clipsStartCapture: mockStartCapture,
  clipsStopCapture: mockStopCapture,
  clipsSaveClip: mockSaveClip,
  clipsDelete: mockDeleteClip,
  clipsOpen: mockOpenClip,
  clipsOnEngineStatus: mockOnEngineStatus,
  clipsGetVideoUrl: (path: string) => `clip-video://file?path=${encodeURIComponent(path)}`,
} as Record<string, unknown> as typeof window.dinho

import { ClipsPage } from './ClipsPage'

describe('ClipsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStatus.mockResolvedValue({
      running: false,
      capturing: false,
      uptime: 0,
      fps: 30,
      replayTimeSeconds: 120,
    })
    mockGetConfig.mockResolvedValue({
      replayTimeSeconds: 120,
      micEnabled: true,
      audioLoopback: false,
      fps: 30,
      width: 1920,
      height: 1080,
      bitrateKbps: 50000,
      cq: 22,
      maxrateKbps: 30000,
      bufsizeKbps: 60000,
      bframes: 2,
      lookahead: 16,
      encoderPreset: 'p4',
      outputDirectory: 'C:\\Users\\Test\\Desktop\\DiNhoClips',
      forceSoftware: false,
      pushToTalk: 'off',
      pushToTalkKeys: [0x7a],
      gameDetection: false,
      hotkeys: [
        { id: 'hk-save', vk: 0x77, modifiers: [], action: 'saveClip', replayDurationSeconds: 60, enabled: true },
        { id: 'hk-capture', vk: 0x78, modifiers: [], action: 'toggleCapture', enabled: true },
        { id: 'hk-mic', vk: 0x79, modifiers: [], action: 'toggleMic', enabled: true },
      ],
    })
    mockList.mockResolvedValue([])
  })

  const showSettings = () => {
    const btn = screen.getByTitle('showSettings')
    btn.click()
  }

  it('renders page header and engine status section', async () => {
    render(<ClipsPage />)
    expect(await screen.findByText('pageTitle')).toBeTruthy()
    expect(screen.getByText('pageDescription')).toBeTruthy()
    expect(screen.getByText('recordingStatus')).toBeTruthy()
  })

  it('displays stopped state when engine is not running', async () => {
    render(<ClipsPage />)
    expect(await screen.findByText('stopped')).toBeTruthy()
  })

  it('displays idle state when engine is running but not capturing', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: false,
      uptime: 120,
      fps: 30,
      replayTimeSeconds: 120,
    })
    render(<ClipsPage />)
    expect(await screen.findByText('idle')).toBeTruthy()
  })

  it('displays recording state when capturing', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: true,
      uptime: 120,
      fps: 30,
      replayTimeSeconds: 120,
    })
    render(<ClipsPage />)
    expect(await screen.findByText('recording')).toBeTruthy()
  })

  it('shows start recording button when not running', async () => {
    render(<ClipsPage />)
    expect(await screen.findByText('startRecording')).toBeTruthy()
  })

  it('shows start recording button when engine is idle', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: false,
      uptime: 120,
      fps: 30,
      replayTimeSeconds: 120,
    })
    render(<ClipsPage />)
    expect(await screen.findByText('startRecording')).toBeTruthy()
  })

  it('shows no clips message when list is empty', async () => {
    render(<ClipsPage />)
    expect(await screen.findByText('noClips')).toBeTruthy()
  })

  it('renders clip list when clips exist', async () => {
    mockList.mockResolvedValue([
      { name: 'clip1.mp4', path: 'C:\\clips\\clip1.mp4', size: 102400, createdAt: '2026-06-21T10:00:00Z', duration: 0 },
      { name: 'clip2.mp4', path: 'C:\\clips\\clip2.mp4', size: 204800, createdAt: '2026-06-20T10:00:00Z', duration: 0 },
    ])
    render(<ClipsPage />)
    expect(await screen.findByText('clip1.mp4')).toBeTruthy()
    expect(screen.getByText('clip2.mp4')).toBeTruthy()
    expect(screen.getByText('clipCount')).toBeTruthy()
  })

  it('calls clipsGetStatus and clipsList on mount', async () => {
    render(<ClipsPage />)
    await screen.findByText('pageTitle')
    expect(mockGetStatus).toHaveBeenCalled()
    expect(mockList).toHaveBeenCalled()
  })

  it('handles missing window.dinho gracefully', () => {
    const savedDinho = window.dinho
    delete (window as any).dinho
    expect(() => render(<ClipsPage />)).not.toThrow()
    ;(window as any).dinho = savedDinho
  })

  it('shows expanded engine status fields when provided', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: true,
      uptime: 300,
      fps: 30,
      replayTimeSeconds: 120,
      captureBackend: 'nvenc',
      encoder: 'h264',
      replayBufferBytes: 536870912,
      diskSpaceOk: true,
      currentGame: 'Cyberpunk 2077',
      lastCrashRecovered: true,
    })
    render(<ClipsPage />)
    expect(await screen.findByText('nvenc')).toBeTruthy()
    expect(screen.getByText('h264')).toBeTruthy()
    expect(screen.getByText('512megabytes')).toBeTruthy()
    expect(screen.getByText('Cyberpunk 2077')).toBeTruthy()
    expect(screen.getByText('crashRecovered')).toBeTruthy()
  })

  it('shows low disk warning in status badges when diskSpaceOk is false', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: false,
      uptime: 120,
      fps: 30,
      replayTimeSeconds: 120,
      diskSpaceOk: false,
    })
    render(<ClipsPage />)
    expect(await screen.findByText('lowDisk')).toBeTruthy()
  })

  it('renders push-to-talk mode selector', async () => {
    render(<ClipsPage />)
    showSettings()
    expect(await screen.findByText('recordingQuality')).toBeTruthy()
    screen.getByText('pushToTalk').click()
    expect(await screen.findByText('pttOff')).toBeTruthy()
    expect(screen.getByText('pttHold')).toBeTruthy()
    expect(screen.getByText('pttToggle')).toBeTruthy()
  })

  it('calls setConfig when PTT mode button is clicked', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    screen.getByText('pushToTalk').click()
    await screen.findByText('pttHold')
    screen.getByText('pttHold').click()
    expect(mockSetConfig).toHaveBeenCalledWith({ pushToTalk: 'hold' })
  })

  it('calls setConfig when game detection toggle is clicked', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    const gdToggle = screen.getAllByText('gameDetection')[1].parentElement!.querySelector('button')!
    gdToggle.click()
    expect(mockSetConfig).toHaveBeenCalledWith({ gameDetection: true })
  })

  it('renders audio loopback toggle', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    expect(screen.getByText('audioLoopback')).toBeTruthy()
  })

  it('calls setConfig when audio loopback toggle is clicked', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    const alToggle = screen.getByText('audioLoopback')
    alToggle.click()
    expect(mockSetConfig).toHaveBeenCalledWith({ audioLoopback: true, gameAudioOnly: false })
  })

  it('renders game detection toggle', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    expect(screen.getAllByText('gameDetection')[1]).toBeTruthy()
  })

  it('renders pushToTalk as a hotkey action option', async () => {
    mockGetConfig.mockResolvedValue({
      replayTimeSeconds: 120,
      micEnabled: true,
      audioLoopback: false,
      fps: 30,
      width: 1920,
      height: 1080,
      bitrateKbps: 50000,
      cq: 22,
      maxrateKbps: 30000,
      bufsizeKbps: 60000,
      bframes: 2,
      lookahead: 16,
      encoderPreset: 'p4',
      outputDirectory: 'C:\\Users\\Test\\Desktop\\DiNhoClips',
      forceSoftware: false,
      pushToTalk: 'off',
      pushToTalkKeys: [0x7a],
      gameDetection: false,
      hotkeys: [{ id: 'hk-ptt', vk: 0x7b, modifiers: [], action: 'pushToTalk', enabled: true }],
    })
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    screen.getByText('hotkeys').click()
    expect(await screen.findByText('actionPushToTalkLabel')).toBeTruthy()
  })

  it('renders quality presets', async () => {
    render(<ClipsPage />)
    showSettings()
    expect(await screen.findByText('recordingQuality')).toBeTruthy()
    expect(screen.getByText('presetMuitoAlta')).toBeTruthy()
    expect(screen.getByText('presetAlta')).toBeTruthy()
    expect(screen.getByText('presetBoa')).toBeTruthy()
  })

  it('calls setConfig when quality preset is clicked', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    screen.getByText('presetAlta').click()
    expect(mockSetConfig).toHaveBeenCalledWith(expect.objectContaining({ cq: 18, maxrateKbps: 55000 }))
  })

  it('renders force software toggle', async () => {
    render(<ClipsPage />)
    showSettings()
    expect(await screen.findByText('forceSoftware')).toBeTruthy()
  })

  it('shows calibrated machine profile badge when adaptive quality is active', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: true,
      uptime: 120,
      fps: 30,
      replayTimeSeconds: 120,
      calibrationTier: 'Strong',
    })
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    expect(screen.getByText('calibrationActive')).toBeTruthy()
  })

  it('hides calibration badge when no tier was reported', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: true,
      uptime: 120,
      fps: 30,
      replayTimeSeconds: 120,
    })
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    expect(screen.queryByText('calibrationActive')).toBeNull()
  })

  it('shows dropped frames badge when drop counters are non-zero', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: true,
      uptime: 120,
      fps: 30,
      replayTimeSeconds: 120,
      droppedFrames: 7,
      gpuBusyDrops: 3,
    })
    render(<ClipsPage />)
    expect(await screen.findByText(/droppedFrames/)).toBeTruthy()
    expect(screen.getByText('(GPU: 3)')).toBeTruthy()
  })

  it('does not show dropped frames badge when counters are zero', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: true,
      uptime: 120,
      fps: 30,
      replayTimeSeconds: 120,
    })
    render(<ClipsPage />)
    expect(await screen.findByText('recording')).toBeTruthy()
    expect(screen.queryByText(/droppedFrames/)).toBeNull()
  })

  it('calls setConfig when force software toggle is clicked', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    const row = screen.getByText('forceSoftware').parentElement!.parentElement!
    const buttons = row.querySelectorAll('button')
    const fsToggle = buttons[buttons.length - 1]
    fsToggle.click()
    expect(mockSetConfig).toHaveBeenCalledWith({ forceSoftware: true })
  })
})
