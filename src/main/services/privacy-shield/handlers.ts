import type { PrivacyApplyResult, PrivacySetting, PrivacyShieldState } from '@shared/types'
import { getPlatform } from '../../platform'
import type { SettingDef } from './helpers'
import { withTimeout } from './helpers'
import { SETTINGS } from './settings'

function getSettingsForPlatform(): SettingDef[] {
  if (process.platform === 'win32') return SETTINGS
  return getPlatform().privacy.getSettings()
}

export async function scanPrivacy(
  onProgress?: (data: { current: number; total: number; currentLabel: string; category: string }) => void,
): Promise<PrivacyShieldState> {
  const settingDefs = getSettingsForPlatform()
  const settings: PrivacySetting[] = []
  const total = settingDefs.length
  for (let i = 0; i < settingDefs.length; i++) {
    const def = settingDefs[i]!
    onProgress?.({ current: i + 1, total, currentLabel: def.label, category: def.category })
    const enabled = await withTimeout(
      def.check().catch(() => false),
      10000,
      false,
    )
    const hasRevert = typeof def.revert === 'function'
    const isApplicable = def.applicable
      ? await withTimeout(
          def.applicable().catch(() => true),
          10000,
          true,
        )
      : true
    const reversible = hasRevert && isApplicable
    settings.push({
      id: def.id,
      category: def.category as PrivacySetting['category'],
      label: def.label,
      description: def.description,
      enabled,
      reversible,
      requiresAdmin: def.requiresAdmin,
      ...(def.dependsOn ? { dependsOn: def.dependsOn } : {}),
    })
  }
  const protectedCount = settings.filter((s) => s.enabled).length
  const score = total > 0 ? Math.round((protectedCount / total) * 100) : 0
  return { settings, score, total, protected: protectedCount }
}

export async function applyPrivacySettings(ids: string[]): Promise<PrivacyApplyResult> {
  const settingDefs = getSettingsForPlatform()
  let succeeded = 0
  let failed = 0
  let skipped = 0
  const errors: PrivacyApplyResult['errors'] = []
  for (const id of ids) {
    const def = settingDefs.find((s) => s.id === id)
    if (!def) {
      skipped++
      continue
    }
    try {
      await def.apply()
      succeeded++
    } catch (err) {
      failed++
      errors.push({ id: def.id, label: def.label, reason: err instanceof Error ? err.message : 'Unknown error' })
    }
  }
  return { succeeded, failed, skipped, errors }
}

export async function revertPrivacySettings(ids: string[]): Promise<PrivacyApplyResult> {
  const settingDefs = getSettingsForPlatform()
  let succeeded = 0
  let failed = 0
  const skipped = 0
  const errors: PrivacyApplyResult['errors'] = []
  for (const id of ids) {
    const def = settingDefs.find((s) => s.id === id)
    if (!def?.revert) {
      failed++
      errors.push({ id, label: def?.label ?? id, reason: 'Revert not supported for this setting' })
      continue
    }
    try {
      await def.revert()
      succeeded++
    } catch (err) {
      failed++
      errors.push({ id: def.id, label: def.label, reason: err instanceof Error ? err.message : 'Unknown error' })
    }
  }
  return { succeeded, failed, skipped, errors }
}
