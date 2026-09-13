import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { RegistryEntry } from '@shared/types'
import { execTracked, psArgs } from '../exec-utf8'
import { expandEnvVars, extractExePath } from './utils'

export async function scanScheduledTasks(signal?: AbortSignal): Promise<RegistryEntry[]> {
  const entries: RegistryEntry[] = []

  try {
    const { stdout } = await execTracked(
      'powershell',
      psArgs(`Get-ScheduledTask | Where-Object { $_.State -ne 'Disabled' } | ForEach-Object {
        $action = if ($_.Actions) { $_.Actions | Select-Object -First 1 } else { $null }
        $execute = if ($action -and $action.Execute) { $action.Execute } else { '' }
        [PSCustomObject]@{ TaskName = $_.TaskName; TaskPath = $_.TaskPath; Execute = $execute }
      } | ConvertTo-Json -Compress`),
      { timeout: 20000, ...(signal ? { signal } : {}) },
    )
    const tasks: Array<{ TaskName: string; TaskPath: string; Execute: string }> = JSON.parse(stdout)
    const taskList = Array.isArray(tasks) ? tasks : [tasks]
    const seen = new Set<string>()
    for (const t of taskList) {
      const taskName = t.TaskPath + t.TaskName
      const taskToRun = (t.Execute || '').trim()
      if (!taskToRun || taskToRun === 'N/A' || taskToRun.startsWith('COM handler') || seen.has(taskName)) continue
      seen.add(taskName)
      const exePath = extractExePath(taskToRun)
      if (exePath) {
        if (
          exePath.includes('\\') &&
          !exePath.toLowerCase().startsWith('c:\\windows\\') &&
          !exePath.startsWith('%') &&
          !existsSync(expandEnvVars(exePath))
        ) {
          entries.push({
            id: randomUUID(),
            type: 'task',
            keyPath: taskName,
            valueName: 'Task To Run',
            issue: `Scheduled task points to missing executable: ${exePath}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-task' },
          })
        }
      }
    }
  } catch {
    /* Skip */
  }

  const thirdPartyTasks = [
    { pattern: 'Adobe Acrobat Update', exe: 'AdobeARM.exe' },
    { pattern: 'Adobe Flash Player', exe: 'FlashPlayerUpdateService.exe' },
    { pattern: 'JavaUpdateSched', exe: 'jusched.exe' },
    { pattern: 'GoogleUpdate', exe: 'GoogleUpdate.exe' },
    { pattern: 'CCleaner', exe: 'CCleaner' },
  ]
  try {
    const { stdout } = await execTracked(
      'powershell',
      psArgs(`Get-ScheduledTask | ForEach-Object {
        $action = if ($_.Actions) { $_.Actions | Select-Object -First 1 } else { $null }
        $execute = if ($action -and $action.Execute) { $action.Execute } else { '' }
        [PSCustomObject]@{ TaskName = $_.TaskName; TaskPath = $_.TaskPath; Execute = $execute }
      } | ConvertTo-Json -Compress`),
      { timeout: 15000, ...(signal ? { signal } : {}) },
    )
    const tasks: Array<{ TaskName: string; TaskPath: string; Execute: string }> = JSON.parse(stdout)
    const taskList = Array.isArray(tasks) ? tasks : [tasks]
    for (const task of thirdPartyTasks) {
      const matchingTasks = taskList.filter((t) => (t.TaskPath + t.TaskName).includes(task.pattern))
      for (const t of matchingTasks) {
        const taskToRun = (t.Execute || '').trim()
        const taskExe = taskToRun ? extractExePath(taskToRun) : null
        if (taskExe && existsSync(expandEnvVars(taskExe))) continue
        entries.push({
          id: randomUUID(),
          type: 'task',
          keyPath: t.TaskPath + t.TaskName,
          valueName: 'Scheduled Task',
          issue: `Third-party update task "${task.pattern}" — may be for uninstalled software`,
          risk: 'low',
          selected: true,
          fix: { op: 'delete-task' },
        })
      }
    }
  } catch {
    /* Skip */
  }

  return entries
}
