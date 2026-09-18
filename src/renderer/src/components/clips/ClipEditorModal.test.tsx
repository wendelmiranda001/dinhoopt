// @vitest-environment jsdom

import type { ClipInfo, ClipTrimResult } from '@shared/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClipEditorModal } from './ClipEditorModal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('lucide-react', () => {
  const Icon = ({ children, ...props }: { children?: React.ReactNode }) => <div {...props}>{children}</div>
  const icons = ['Combine', 'Maximize', 'Minimize', 'Pause', 'Play', 'Scissors', 'Sparkles', 'X']
  const iconMap: Record<string, any> = {}
  for (const name of icons) iconMap[name] = Icon
  return iconMap
})

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const mockGetEnhanceSupport = vi.fn()
const mockGetVideoUrl = vi.fn()
const mockTrim = vi.fn()

const makeDinho = () =>
  ({
    clipsGetEnhanceSupport: mockGetEnhanceSupport,
    clipsGetVideoUrl: mockGetVideoUrl,
    clipsTrimClip: mockTrim,
  }) as never

const clip: ClipInfo = {
  name: 'a.mp4',
  path: 'C:\\Clips\\a.mp4',
  size: 1234,
  createdAt: '2026-01-01T00:00:00.000Z',
  duration: 60,
}

describe('ClipEditorModal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.dinho = makeDinho()
    mockGetEnhanceSupport.mockResolvedValue({ amd: false })
    mockGetVideoUrl.mockReturnValue('file:///clip.mp4')
    mockTrim.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    delete (document as any).fullscreenElement
  })

  const renderModal = (overrides: { onClose?: () => void; onSave?: () => void } = {}) => {
    const onClose = overrides.onClose ?? vi.fn()
    const onSave = overrides.onSave ?? vi.fn()
    const utils = render(<ClipEditorModal clip={clip} onClose={onClose} onSave={onSave} />)
    return { onClose, onSave, ...utils }
  }

  it('clears the overlay timer when unmounted while fullscreen', async () => {
    Object.defineProperty(document, 'fullscreenElement', {
      get: () => document.body,
      configurable: true,
    })

    const { unmount } = renderModal()

    await act(async () => {
      document.dispatchEvent(new Event('fullscreenchange'))
    })

    const dialog = screen.getByRole('dialog')
    await act(async () => {
      fireEvent.mouseMove(dialog)
    })

    const timersBeforeUnmount = vi.getTimerCount()

    unmount()
    expect(vi.getTimerCount()).toBe(timersBeforeUnmount - 1)
  })

  it('clamps the trim range when the real video is shorter than the reported duration', async () => {
    renderModal()

    const video = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { value: 30, configurable: true })
    await act(async () => {
      fireEvent.loadedMetadata(video)
    })

    const region = screen.getByTestId('trim-region')
    expect(Number.parseFloat(region.style.width)).toBeLessThanOrEqual(100)
    const endHandle = screen.getByTestId('trim-end-handle')
    expect(Number.parseFloat(endHandle.style.left)).toBeLessThanOrEqual(100)
  })

  it('insets the draggable track so handles stay inside its box', () => {
    renderModal()
    const track = screen.getByTestId('trim-track')
    expect(track.style.left).toBe('8px')
    expect(track.style.right).toBe('8px')
  })

  it('does not call onSave when clipsTrimClip resolves after unmount', async () => {
    let resolveTrim!: (r: ClipTrimResult) => void
    mockTrim.mockReturnValue(new Promise<ClipTrimResult>((res) => (resolveTrim = res)))

    const { onSave, unmount } = renderModal()

    const trimButton = screen.getByRole('button', { name: /applyTrim/ })
    fireEvent.click(trimButton)

    await act(async () => {})

    unmount()

    await act(async () => {
      resolveTrim({ success: true })
      await Promise.resolve()
    })

    expect(onSave).not.toHaveBeenCalled()
  })

  it('disables improve quality until re-encode or sharpness is selected', () => {
    renderModal()

    const improve = screen.getByRole('button', { name: /improveQuality/ }) as HTMLButtonElement
    expect(improve.disabled).toBe(true)

    fireEvent.click(screen.getByRole('checkbox'))
    expect(improve.disabled).toBe(false)

    fireEvent.click(screen.getByRole('checkbox'))
    expect(improve.disabled).toBe(true)

    const sharpness = document.querySelector('input[type="range"]') as HTMLInputElement
    fireEvent.change(sharpness, { target: { value: '0.5' } })
    expect(improve.disabled).toBe(false)
  })

  it('defaults the re-encode toggle to off', () => {
    renderModal()
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  })

  it('improve quality forces a re-encode of the selected range', async () => {
    mockTrim.mockResolvedValue({ success: true })
    renderModal()

    const sharpness = document.querySelector('input[type="range"]') as HTMLInputElement
    fireEvent.change(sharpness, { target: { value: '0.6' } })

    fireEvent.click(screen.getByRole('button', { name: /improveQuality/ }))
    await act(async () => {})

    expect(mockTrim).toHaveBeenCalledWith(clip.path, 0, 60, true, 'none', 0.6)
  })

  it('forces a re-encode on trim when only sharpness is selected', async () => {
    mockTrim.mockResolvedValue({ success: true })
    renderModal()

    const sharpness = document.querySelector('input[type="range"]') as HTMLInputElement
    fireEvent.change(sharpness, { target: { value: '0.3' } })

    fireEvent.click(screen.getByRole('button', { name: /applyTrim/ }))
    await act(async () => {})

    expect(mockTrim).toHaveBeenCalledWith(clip.path, 0, 60, true, 'none', 0.3)
  })

  it('requests fullscreen on mount when startFullscreen is set', () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    Element.prototype.requestFullscreen = requestFullscreen

    render(<ClipEditorModal clip={clip} startFullscreen onClose={vi.fn()} onSave={vi.fn()} />)

    expect(requestFullscreen).toHaveBeenCalledTimes(1)
  })

  it('hides the trim and enhance controls while fullscreen', async () => {
    renderModal()
    expect(screen.getByRole('button', { name: /improveQuality/ })).toBeTruthy()

    Object.defineProperty(document, 'fullscreenElement', {
      get: () => document.body,
      configurable: true,
    })
    await act(async () => {
      document.dispatchEvent(new Event('fullscreenchange'))
    })

    expect(screen.queryByRole('button', { name: /improveQuality/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /applyTrim/ })).toBeNull()
  })
})
