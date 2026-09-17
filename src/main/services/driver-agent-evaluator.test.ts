import type { DriverUpdate } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { AGENTS, evaluateDrivers } from './driver-agent-evaluator'

function makeUpdate(overrides: Partial<DriverUpdate> = {}): DriverUpdate {
  return {
    id: 'test-1',
    updateId: 'update-test-1',
    deviceName: 'NVIDIA GeForce RTX 3080',
    deviceId: 'PCI\\VEN_10DE&DEV_2206',
    className: 'Display',
    currentVersion: '31.0.15.1234',
    currentDate: '2024-06-01',
    availableVersion: '31.0.15.5678',
    availableDate: '2025-01-15',
    provider: 'NVIDIA',
    updateTitle: 'NVIDIA GeForce RTX 3080 Driver Update',
    downloadSize: '850 MB',
    selected: false,
    ...overrides,
  }
}

describe('driver-agent-evaluator', () => {
  describe('AGENTS list', () => {
    it('has exactly 10 agents defined', () => {
      expect(AGENTS).toHaveLength(10)
    })

    it('includes consensus agent with weight 0', () => {
      const consensus = AGENTS.find((a) => a.id === 'consensus')
      expect(consensus).toBeDefined()
      expect(consensus!.weight).toBe(0)
    })

    it('every agent has a unique id', () => {
      const ids = AGENTS.map((a) => a.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })

  describe('evaluateDrivers', () => {
    it('returns empty candidates for empty input', () => {
      const result = evaluateDrivers([])
      expect(result.candidates).toHaveLength(0)
      expect(result.totalCandidates).toBe(0)
    })

    it('produces 10 verdicts per candidate (9 agents + 1 consensus)', () => {
      const result = evaluateDrivers([makeUpdate()])
      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0]!.verdicts).toHaveLength(10)
    })

    it('sorts candidates by consensusScore descending', () => {
      const result = evaluateDrivers([
        makeUpdate({ id: 'low', updateTitle: 'unknown brand driver', provider: 'Unknown Corp' }),
        makeUpdate({ id: 'high', provider: 'Microsoft Corporation' }),
      ])
      expect(result.candidates[0]!.consensusScore).toBeGreaterThanOrEqual(result.candidates[1]!.consensusScore)
    })

    it('sets approved to false for all candidates', () => {
      const result = evaluateDrivers([makeUpdate(), makeUpdate({ id: 'test-2' })])
      expect(result.candidates.every((c) => c.approved === false)).toBe(true)
    })

    it('tallies counts correctly', () => {
      const result = evaluateDrivers([makeUpdate()])
      const total =
        result.criticalCount + result.recommendedCount + result.optionalCount + result.cautionCount + result.skipCount
      expect(total).toBe(result.totalCandidates)
    })
  })

  describe('Agent 1: Windows Update', () => {
    it('always returns recommended with score 80', () => {
      const result = evaluateDrivers([makeUpdate()])
      const wu = result.candidates[0]!.verdicts.find((v) => v.agentId === 'windows-update')!
      expect(wu.score).toBe(80)
      expect(wu.label).toBe('recommended')
      expect(wu.summaryKey).toBe('agentWuFound')
    })
  })

  describe('Agent 2: Version Freshness', () => {
    it('returns skip when available version is not newer', () => {
      const result = evaluateDrivers([makeUpdate({ currentVersion: '2.0', availableVersion: '1.0' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'version-freshness')!
      expect(v.label).toBe('skip')
      expect(v.score).toBe(0)
    })

    it('returns recommended for major version upgrade', () => {
      const result = evaluateDrivers([makeUpdate({ currentVersion: '1.0.0.0', availableVersion: '2.0.0.0' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'version-freshness')!
      expect(v.score).toBeGreaterThanOrEqual(70)
      expect(v.label).toBe('recommended')
    })

    it('handles non-numeric version parts gracefully', () => {
      const result = evaluateDrivers([makeUpdate({ currentVersion: 'beta', availableVersion: '1.0' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'version-freshness')!
      expect(v.score).toBeGreaterThanOrEqual(0)
    })

    it('returns optional for minor-only version diff', () => {
      const result = evaluateDrivers([makeUpdate({ currentVersion: '1.0.0', availableVersion: '1.2.0' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'version-freshness')!
      expect(v.score).toBe(65)
      expect(v.label).toBe('optional')
    })

    it('clamps score to 70 when major jump is >= 2', () => {
      const result = evaluateDrivers([makeUpdate({ currentVersion: '1.0.0', availableVersion: '3.0.0' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'version-freshness')!
      expect(v.score).toBe(70)
      expect(v.label).toBe('recommended')
    })
  })

  describe('Agent 3: Date Maturity', () => {
    it('scores very low for updates less than 7 days old', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0]!
      const sameDate = twoDaysAgo // avoid extra bump from daysSinceCurrent
      const result = evaluateDrivers([makeUpdate({ availableDate: twoDaysAgo, currentDate: sameDate })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'date-maturity')!
      expect(v.score).toBeLessThanOrEqual(15)
    })

    it('scores highest for updates between 90 and 365 days', () => {
      const old = new Date(Date.now() - 180 * 86400000).toISOString().split('T')[0]!
      const result = evaluateDrivers([makeUpdate({ availableDate: old })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'date-maturity')!
      expect(v.score).toBeGreaterThanOrEqual(80)
    })

    it('scores 40 for updates between 7 and 30 days old', () => {
      const date20 = new Date(Date.now() - 20 * 86400000).toISOString().split('T')[0]!
      const result = evaluateDrivers([makeUpdate({ availableDate: date20, currentDate: date20 })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'date-maturity')!
      expect(v.score).toBe(40)
      expect(v.label).toBe('optional')
    })

    it('scores 70 for updates between 30 and 90 days old', () => {
      const date60 = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0]!
      const result = evaluateDrivers([makeUpdate({ availableDate: date60, currentDate: date60 })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'date-maturity')!
      expect(v.score).toBe(70)
      expect(v.label).toBe('recommended')
    })

    it('scores 30 for updates older than 365 days', () => {
      const date400 = new Date(Date.now() - 400 * 86400000).toISOString().split('T')[0]!
      const result = evaluateDrivers([makeUpdate({ availableDate: date400, currentDate: date400 })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'date-maturity')!
      expect(v.score).toBe(30)
      expect(v.label).toBe('optional')
    })

    it('adds +10 bonus when daysSinceCurrent exceeds 180', () => {
      const old = new Date(Date.now() - 200 * 86400000).toISOString().split('T')[0]!
      const veryOldCurrent = new Date(Date.now() - 500 * 86400000).toISOString().split('T')[0]!
      const result = evaluateDrivers([makeUpdate({ availableDate: old, currentDate: veryOldCurrent })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'date-maturity')!
      expect(v.score).toBeGreaterThanOrEqual(80)
    })
  })

  describe('Agent 4: WHQL Certification', () => {
    it('scores 90 for Microsoft provider', () => {
      const result = evaluateDrivers([makeUpdate({ provider: 'Microsoft Corporation' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'whql-certification')!
      expect(v.score).toBe(90)
    })

    it('scores 70 for known OEM providers', () => {
      const result = evaluateDrivers([makeUpdate({ provider: 'Intel Corporation' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'whql-certification')!
      expect(v.score).toBe(70)
    })

    it('scores 30 for unknown providers', () => {
      const result = evaluateDrivers([makeUpdate({ provider: 'Random Corp' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'whql-certification')!
      expect(v.score).toBe(30)
    })
  })

  describe('Agent 5: Publisher Reputation', () => {
    it('scores 95 for Microsoft', () => {
      const result = evaluateDrivers([makeUpdate({ provider: 'Microsoft Corporation' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'publisher-reputation')!
      expect(v.score).toBe(95)
      expect(v.label).toBe('critical')
    })

    it('scores 85 for known GPU vendors', () => {
      const result = evaluateDrivers([makeUpdate({ provider: 'NVIDIA Corporation' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'publisher-reputation')!
      expect(v.score).toBe(85)
    })

    it('scores 85 for Intel provider', () => {
      const result = evaluateDrivers([makeUpdate({ provider: 'Intel Corporation' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'publisher-reputation')!
      expect(v.score).toBe(85)
      expect(v.label).toBe('recommended')
    })

    it('scores 85 for AMD provider', () => {
      const result = evaluateDrivers([makeUpdate({ provider: 'Advanced Micro Devices' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'publisher-reputation')!
      expect(v.score).toBe(85)
      expect(v.label).toBe('recommended')
    })

    it('scores 70 for Realtek/Broadcom/Qualcomm providers', () => {
      const result = evaluateDrivers([makeUpdate({ provider: 'Realtek Semiconductor Corp.' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'publisher-reputation')!
      expect(v.score).toBe(70)
      expect(v.label).toBe('recommended')
    })

    it('scores 40 for unknown publishers', () => {
      const result = evaluateDrivers([makeUpdate({ provider: 'Some Unknown Company' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'publisher-reputation')!
      expect(v.score).toBe(40)
    })
  })

  describe('Agent 6: Hardware Match', () => {
    it('scores 90 when update title closely matches device name', () => {
      const result = evaluateDrivers([
        makeUpdate({
          deviceName: 'NVIDIA GeForce RTX 3080',
          updateTitle: 'NVIDIA GeForce RTX 3080 Driver Update',
        }),
      ])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'hardware-match')!
      expect(v.score).toBeGreaterThanOrEqual(80)
    })

    it('scores 50 for generic titles with no match', () => {
      const result = evaluateDrivers([
        makeUpdate({
          deviceName: 'NVIDIA GeForce RTX 3080',
          updateTitle: 'Generic Driver Update Package',
        }),
      ])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'hardware-match')!
      expect(v.score).toBeLessThanOrEqual(60)
    })

    it('uses default score 60 when deviceName is missing', () => {
      const result = evaluateDrivers([makeUpdate({ deviceName: '' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'hardware-match')!
      expect(v.score).toBe(60)
      expect(v.label).toBe('optional')
    })

    it('uses default score 60 when updateTitle is missing', () => {
      const result = evaluateDrivers([makeUpdate({ updateTitle: '' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'hardware-match')!
      expect(v.score).toBe(60)
      expect(v.label).toBe('optional')
    })

    it('scores 70 for partial match (0.3 <= ratio < 0.7)', () => {
      const result = evaluateDrivers([
        makeUpdate({
          deviceName: 'NVIDIA Graphics Driver',
          updateTitle: 'NVIDIA Graphics Update',
        }),
      ])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'hardware-match')!
      expect(v.score).toBe(70)
      expect(v.label).toBe('recommended')
    })
  })

  describe('Agent 7: Stability Risk', () => {
    it('penalizes large version jumps', () => {
      const result = evaluateDrivers([makeUpdate({ currentVersion: '1.0.0.0', availableVersion: '5.0.0.0' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'stability-risk')!
      expect(v.score).toBeLessThan(60)
    })

    it('rewards minor updates within same major version', () => {
      const result = evaluateDrivers([makeUpdate({ currentVersion: '1.0.0.0', availableVersion: '1.2.0.0' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'stability-risk')!
      expect(v.score).toBeGreaterThanOrEqual(70)
    })

    it('applies moderate penalty for majorDiff === 1', () => {
      const date100 = new Date(Date.now() - 100 * 86400000).toISOString().split('T')[0]!
      const result = evaluateDrivers([
        makeUpdate({
          currentVersion: '1.0.0',
          availableVersion: '2.0.0',
          availableDate: date100,
          provider: 'Unknown Corp',
        }),
      ])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'stability-risk')!
      expect(v.score).toBe(60)
      expect(v.label).toBe('recommended')
    })

    it('penalizes very recent drivers (daysAvail < 14)', () => {
      const date5 = new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0]!
      const result = evaluateDrivers([
        makeUpdate({
          currentVersion: '1.0.0',
          availableVersion: '1.0.0',
          availableDate: date5,
          provider: 'Unknown Corp',
        }),
      ])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'stability-risk')!
      expect(v.score).toBe(50)
      expect(v.label).toBe('caution')
    })

    it('rewards well-tested drivers (daysAvail > 180)', () => {
      const date200 = new Date(Date.now() - 200 * 86400000).toISOString().split('T')[0]!
      const result = evaluateDrivers([
        makeUpdate({ currentVersion: '1.0.0', availableVersion: '1.1.0', availableDate: date200 }),
      ])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'stability-risk')!
      expect(v.score).toBeGreaterThanOrEqual(75)
    })
  })

  describe('Agent 8: Security Relevance', () => {
    it('flags critical security keywords', () => {
      const result = evaluateDrivers([makeUpdate({ updateTitle: 'Critical Security Update for CVE-2025-1234' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'security-relevance')!
      expect(v.label).toBe('critical')
      expect(v.score).toBeGreaterThanOrEqual(90)
    })

    it('returns optional for non-security updates', () => {
      const result = evaluateDrivers([makeUpdate({ updateTitle: 'Regular Feature Update' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'security-relevance')!
      expect(v.label).toBe('optional')
    })

    it('returns recommended for moderate security relevance (score 40-69)', () => {
      const result = evaluateDrivers([makeUpdate({ updateTitle: 'Driver Patch Available' })])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'security-relevance')!
      expect(v.score).toBe(50)
      expect(v.label).toBe('recommended')
      expect(v.summaryKey).toBe('agentSecurityPresent')
    })
  })

  describe('Agent 9: Rollback Safety', () => {
    it('always returns score 60 with optional label', () => {
      const result = evaluateDrivers([makeUpdate()])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'rollback-safety')!
      expect(v.score).toBe(60)
      expect(v.label).toBe('optional')
      expect(v.summaryKey).toBe('agentRollbackAvailable')
    })
  })

  describe('Agent 10: Consensus', () => {
    it('is always the last verdict', () => {
      const result = evaluateDrivers([makeUpdate()])
      const verdicts = result.candidates[0]!.verdicts
      expect(verdicts[verdicts.length - 1]!.agentId).toBe('consensus')
    })

    it('falls within 0-100 range', () => {
      const result = evaluateDrivers([makeUpdate()])
      const v = result.candidates[0]!.verdicts.find((v) => v.agentId === 'consensus')!
      expect(v.score).toBeGreaterThanOrEqual(0)
      expect(v.score).toBeLessThanOrEqual(100)
    })

    it('scores higher for Microsoft drivers than unknown ones', () => {
      const microsoft = evaluateDrivers([makeUpdate({ provider: 'Microsoft Corporation' })])
      const unknown = evaluateDrivers([makeUpdate({ provider: 'Unknown Random Corp' })])
      const mScore = microsoft.candidates[0]!.verdicts.find((v) => v.agentId === 'consensus')!.score
      const uScore = unknown.candidates[0]!.verdicts.find((v) => v.agentId === 'consensus')!.score
      expect(mScore).toBeGreaterThan(uScore)
    })
  })
})
