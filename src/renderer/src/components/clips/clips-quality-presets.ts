import type { ClipsConfig } from '@shared/types'

export type QualityPresetKey = 'muito-alta' | 'alta' | 'boa'

/**
 * Fonte única dos presets de qualidade. O componente usa estes valores para
 * aplicar a qualidade e exibir a seleção; nenhum outro local duplica os valores.
 */
export const QUALITY_PRESETS: Record<QualityPresetKey, Partial<ClipsConfig>> = {
  'muito-alta': {
    cq: 16,
    maxrateKbps: 65000,
    bufsizeKbps: 130000,
    encoderPreset: 'p5',
    bframes: 3,
    lookahead: 16,
    bitrateKbps: 65000,
    width: 1920,
    height: 1080,
    fps: 60,
  },
  alta: {
    cq: 18,
    maxrateKbps: 55000,
    bufsizeKbps: 110000,
    encoderPreset: 'p5',
    bframes: 2,
    lookahead: 16,
    bitrateKbps: 55000,
    width: 1920,
    height: 1080,
    fps: 60,
  },
  boa: {
    cq: 20,
    maxrateKbps: 40000,
    bufsizeKbps: 80000,
    encoderPreset: 'p5',
    bframes: 2,
    lookahead: 16,
    bitrateKbps: 40000,
    width: 1280,
    height: 720,
    fps: 60,
  },
}
