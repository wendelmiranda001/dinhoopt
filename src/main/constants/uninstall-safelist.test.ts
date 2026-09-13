import { describe, expect, it } from 'vitest'
import { R_LANGUAGE_RUNTIME_FOLDER, SAFE_FOLDER_NAMES } from './uninstall-safelist'

describe('uninstall-safelist', () => {
  describe('R runtime folder entry', () => {
    it('exposes the R runtime folder via a descriptively named constant', () => {
      expect(R_LANGUAGE_RUNTIME_FOLDER).toBe('r')
    })

    it('keeps the R runtime folder safe from leftover detection', () => {
      expect(SAFE_FOLDER_NAMES.has(R_LANGUAGE_RUNTIME_FOLDER)).toBe(true)
    })
  })
})
