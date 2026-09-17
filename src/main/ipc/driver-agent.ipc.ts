import { IPC } from '@shared/channels'
import type { AgentEvaluationResult } from '@shared/driver-agent-types'
import { ipcMain } from 'electron'
import { evaluateDrivers } from '../services/driver-agent-evaluator'
import { getLogger } from '../services/logger.service'
import { installDriverUpdates, scanDriverUpdates } from './driver-manager.ipc'
import type { WindowGetter } from './index'

export function registerDriverAgentIpc(_getWindow: WindowGetter): void {
  ipcMain.handle(IPC.DRIVER_AGENT_EVALUATE, async (): Promise<AgentEvaluationResult> => {
    getLogger().info('driver-agent', 'Starting multi-agent driver evaluation')

    try {
      const scanResult = await scanDriverUpdates()

      if (!scanResult?.updates || scanResult.updates.length === 0) {
        getLogger().info('driver-agent', 'No driver updates found to evaluate')
        return {
          candidates: [],
          evaluatedAt: new Date().toISOString(),
          totalCandidates: 0,
          criticalCount: 0,
          recommendedCount: 0,
          optionalCount: 0,
          cautionCount: 0,
          skipCount: 0,
        }
      }

      getLogger().info('driver-agent', `Evaluating ${scanResult.updates.length} driver updates across 10 agents`)
      const result = evaluateDrivers(scanResult.updates)

      getLogger().success(
        'driver-agent',
        `Evaluation complete: ${result.criticalCount} critical, ${result.recommendedCount} recommended, ${result.optionalCount} optional, ${result.cautionCount} caution, ${result.skipCount} skip`,
      )

      return result
    } catch (err) {
      getLogger().error('driver-agent', `Evaluation failed: ${err}`)
      throw err
    }
  })

  ipcMain.handle(
    IPC.DRIVER_AGENT_APPROVE,
    async (_event, request: unknown): Promise<{ success: boolean; error?: string; rebootRequired?: boolean }> => {
      if (!request || typeof request !== 'object') {
        return { success: false, error: 'Invalid request' }
      }

      const { updateIds } = request as { updateIds: unknown }
      if (!Array.isArray(updateIds) || updateIds.length === 0) {
        return { success: false, error: 'No updates selected' }
      }

      const validIds = updateIds.filter((id): id is string => typeof id === 'string')
      if (validIds.length === 0) {
        return { success: false, error: 'No valid update IDs' }
      }

      getLogger().info('driver-agent', `User approved ${validIds.length} driver updates for installation`)

      try {
        const result = await installDriverUpdates(validIds)
        getLogger().success(
          'driver-agent',
          `Installed ${result.installed}, failed ${result.failed}, reboot: ${result.rebootRequired}`,
        )
        return {
          success: result.failed === 0,
          ...(result.errors.length > 0
            ? { error: result.errors.map((e) => `${e.deviceName}: ${e.reason}`).join('; ') }
            : {}),
          rebootRequired: result.rebootRequired,
        }
      } catch (err) {
        getLogger().error('driver-agent', `Install failed: ${err}`)
        return { success: false, error: String(err) }
      }
    },
  )
}
