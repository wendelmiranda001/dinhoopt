import { existsSync, readdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { StartupItem } from '@shared/types'
import { app } from 'electron'
import { getPlatform } from '../../platform'
import { execFileAsync, execNativeUtf8, psArgs } from '../../services/exec-utf8'
import { getLogger } from '../../services/logger.service'
import { readDisabledEntries } from './disabled-file'
import { mergeStartupApproved, parseRegOutput } from './registry'
import { deriveDisplayName, estimateImpact, extractPublisher, makeStableId } from './utils'

function getStartupFolderItems(): StartupItem[] {
  const items: StartupItem[] = []
  const startupDir = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')

  try {
    if (!existsSync(startupDir)) return items
    const files = readdirSync(startupDir)
    for (const file of files) {
      if (file === 'desktop.ini') continue
      const filePath = join(startupDir, file)
      const name = basename(file, extname(file))
      items.push({
        id: makeStableId(name, 'startup-folder'),
        name: file,
        displayName: name,
        command: filePath,
        location: startupDir,
        source: 'startup-folder',
        enabled: true,
        publisher: extractPublisher(filePath),
        impact: estimateImpact(name, filePath),
      })
    }
  } catch {
    /* skip */
  }

  return items
}

async function getScheduledLogonTasks(): Promise<StartupItem[]> {
  const items: StartupItem[] = []

  try {
    const script = `
      Get-ScheduledTask | ForEach-Object {
        $task = $_
        $hasLogon = $false
        foreach ($t in $task.Triggers) {
          if ($t.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger') {
            $hasLogon = $true; break
          }
        }
        if ($hasLogon -and $task.TaskName -ne 'DiNhoStartup' -and $task.TaskPath -notmatch '^\\\\Microsoft\\\\' -and $task.TaskPath -notmatch '^\\\\ASUS\\\\') {
          $action = ($task.Actions | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskExecAction' } | Select-Object -First 1)
          if ($action) {
            $exe = $action.Execute
            $args = $action.Arguments
            $cmd = if ($args) { "$exe $args" } else { $exe }
            Write-Output "TASK|$($task.TaskName)|$cmd|$($task.State)"
          }
        }
      }
    `

    const { stdout } = await execFileAsync('powershell', psArgs(script), { timeout: 15000, windowsHide: true })

    const lines = stdout
      .trim()
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean)
    for (const line of lines) {
      const parts = line.split('|')
      if (parts[0] !== 'TASK' || parts.length < 4) continue
      const name = parts[1] ?? ''
      const command = parts[2] ?? ''
      const state = parts[3] ?? ''

      items.push({
        id: makeStableId(name, 'task-scheduler'),
        name,
        displayName: deriveDisplayName(name, command),
        command,
        location: 'Task Scheduler',
        source: 'task-scheduler',
        enabled: state === 'Ready' || state === 'Running',
        publisher: extractPublisher(command),
        impact: estimateImpact(name, command),
      })
    }
  } catch {
    /* task scheduler unavailable */
  }

  return items
}

export async function listStartupItems(): Promise<StartupItem[]> {
  if (process.platform !== 'win32') {
    return getPlatform().startup.listItems()
  }

  const items: StartupItem[] = []

  try {
    const { stdout } = await execNativeUtf8(
      'reg',
      ['query', 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'],
      { timeout: 10000 },
    )
    items.push(...parseRegOutput(stdout, 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', 'registry-hkcu'))
  } catch (err) {
    getLogger().warning('startup-manager', `Failed to read registry key HKCU\\...\\Run: ${String(err)}`)
  }

  try {
    const { stdout } = await execNativeUtf8(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'],
      { timeout: 10000 },
    )
    items.push(...parseRegOutput(stdout, 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', 'registry-hklm'))
  } catch (err) {
    getLogger().warning('startup-manager', `Failed to read registry key HKLM\\...\\Run: ${String(err)}`)
  }

  try {
    const { stdout } = await execNativeUtf8(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'],
      { timeout: 10000 },
    )
    items.push(
      ...parseRegOutput(
        stdout,
        'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run',
        'registry-hklm',
      ),
    )
  } catch (err) {
    getLogger().warning('startup-manager', `Failed to read registry key HKLM\\...\\WOW6432Node\\Run: ${String(err)}`)
  }

  items.push(...getStartupFolderItems())

  await mergeStartupApproved(items)

  const scheduledItems = await getScheduledLogonTasks()
  for (const sItem of scheduledItems) {
    if (!items.some((i) => i.name === sItem.name)) {
      items.push(sItem)
    }
  }

  const disabled = readDisabledEntries()
  for (const entry of disabled) {
    const existing = items.find((i) => i.name === entry.name && i.source === entry.source)
    if (existing) {
      existing.enabled = false
    } else {
      items.push({
        id: makeStableId(entry.name, entry.source),
        name: entry.name,
        displayName: deriveDisplayName(entry.name, entry.command),
        command: entry.command,
        location: entry.location,
        source: entry.source,
        enabled: false,
        publisher: extractPublisher(entry.command),
        impact: estimateImpact(entry.name, entry.command),
      })
    }
  }

  return items
}
