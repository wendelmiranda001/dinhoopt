import { describe, expect, it } from 'vitest'
import { isSafeFolder, R_LANGUAGE_RUNTIME_FOLDER, SAFE_FOLDER_NAMES, SAFE_PREFIXES } from './uninstall-safelist'

describe('uninstall-safelist', () => {
  describe('R runtime folder entry', () => {
    it('exposes the R runtime folder via a descriptively named constant', () => {
      expect(R_LANGUAGE_RUNTIME_FOLDER).toBe('r')
    })

    it('keeps the R runtime folder safe from leftover detection', () => {
      expect(SAFE_FOLDER_NAMES.has(R_LANGUAGE_RUNTIME_FOLDER)).toBe(true)
    })
  })

  describe('SAFE_PREFIXES', () => {
    it('does not use the overly broad brace and kb prefixes', () => {
      expect(SAFE_PREFIXES).not.toContain('{')
      expect(SAFE_PREFIXES).not.toContain('kb')
    })
  })

  describe('isSafeFolder', () => {
    it('accepts folders matching descriptive prefixes', () => {
      expect(isSafeFolder('microsoft edge')).toBe(true)
      expect(isSafeFolder('windows.old')).toBe(true)
    })

    it('accepts GUID-style folders with a precise GUID shape', () => {
      expect(isSafeFolder('{12345678-1234-1234-1234-123456789012}')).toBe(true)
    })

    it('rejects brace folders that are not GUIDs', () => {
      expect(isSafeFolder('{not-a-hex-guid}')).toBe(false)
    })

    it('accepts Windows KB update folders by precise pattern', () => {
      expect(isSafeFolder('KB5034441')).toBe(true)
      expect(isSafeFolder('kb5001234-1')).toBe(true)
    })

    it('rejects generic kb-prefixed folders', () => {
      expect(isSafeFolder('kbtool')).toBe(false)
      expect(isSafeFolder('kbengine')).toBe(false)
    })

    it('accepts hidden folders and exact safelist matches', () => {
      expect(isSafeFolder('.config')).toBe(true)
      expect(isSafeFolder('windows')).toBe(true)
    })

    it('rejects unknown application folders', () => {
      expect(isSafeFolder('someapp')).toBe(false)
    })
  })
})
