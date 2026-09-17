import type { GameModeSnapshot } from '@shared/types'
import { execFileAsync } from '../../../services/exec-utf8'

export const BROWSER_PROCESSES = ['chrome.exe', 'firefox.exe', 'msedge.exe', 'opera.exe', 'brave.exe', 'vivaldi.exe']
export const CHAT_PROCESSES = [
  'Discord.exe',
  'Slack.exe',
  'Teams.exe',
  'ms-teams.exe',
  'Telegram.exe',
  'WhatsApp.exe',
  'Signal.exe',
  'Element.exe',
  'Messenger.exe',
  'Skype.exe',
]
export const UPDATER_PROCESSES = [
  'GoogleUpdate.exe',
  'MicrosoftEdgeUpdate.exe',
  'AdobeARM.exe',
  'jusched.exe',
  'BraveUpdate.exe',
  'OperaUpdate.exe',
  'CCleaner.exe',
  'CCUpdate.exe',
  'Dropbox.Update.exe',
  'ZoomUpdateAgent.exe',
]

export const BACKGROUND_PROCESSES = [
  // Microsoft bloat
  'OneDrive.exe',
  'OneDriveStandaloneUpdater.exe',
  'Teams.exe',
  'ms-teams.exe',
  'msedgewebview2.exe',
  'EdgeUpdate.exe',
  'SkypeBackgroundHost.exe',
  'YourPhone.exe',
  'PhoneExperienceHost.exe',
  'SearchUI.exe',
  'SearchApp.exe',
  'GameBarPresenceWriter.exe',
  'XboxAppServices.exe',
  'XboxGameOverlay.exe',
  // Windows Copilot + Widgets
  'WindowsCopilot.exe',
  'Widgets.exe',
  'WidgetsExperienceHost.exe',
  // Cortana
  'Cortana.exe',
  'CortanaBackgroundHost.exe',
  // Office
  'ONENOTEM.EXE',
  'OneNoteClipper.exe',
  // Windows Tips / News
  'NewsAndInterests.exe',
  'NewsAndInterestHost.exe',
  // ClipChamp / Media
  'ClipChamp.exe',
  'ClipchampClipboardService.exe',
  'ClipchampCompressionService.exe',
  // Solitaire
  'Microsoft.SolitaireCollection.exe',
  // Weather
  'Microsoft.Windowsweathermap.exe',
]

const PROTECTED_PROCESSES = new Set([
  'csrss.exe',
  'smss.exe',
  'wininit.exe',
  'services.exe',
  'lsass.exe',
  'lsaiso.exe',
  'svchost.exe',
  'winlogon.exe',
  'dwm.exe',
  'explorer.exe',
  'ntoskrnl.exe',
  'system',
  'registry',
  'memory compression',
  'launchd',
  'kernel_task',
  'windowserver',
  'systemd',
  'init',
  'kthreadd',
])

export async function killProcessesByName(
  names: string[],
  snapshot: GameModeSnapshot,
): Promise<{ killed: number; errors: string[] }> {
  let killed = 0
  const errors: string[] = []

  try {
    const { stdout } = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH'], {
      timeout: 10000,
      windowsHide: true,
      encoding: 'utf-8',
    })
    const lowerNames = new Set(names.map((n) => n.toLowerCase()))
    const lines = String(stdout).split('\n').filter(Boolean)

    for (const line of lines) {
      const match = line.match(/^"([^"]+)","(\d+)"/)
      if (!match) continue
      const procName = match[1] ?? ''
      const pidStr = match[2] ?? ''
      const pid = Number.parseInt(pidStr, 10)
      if (Number.isNaN(pid) || pid <= 4) continue
      if (!procName || PROTECTED_PROCESSES.has(procName.toLowerCase())) continue
      if (!lowerNames.has(procName.toLowerCase())) continue

      try {
        process.kill(pid)
        snapshot.killedProcesses.push({ pid, name: procName })
        killed++
      } catch {
        try {
          await execFileAsync('taskkill', ['/PID', String(pid), '/F'], {
            timeout: 5000,
            windowsHide: true,
          })
          snapshot.killedProcesses.push({ pid, name: procName })
          killed++
        } catch (err: unknown) {
          const reason = err instanceof Error ? err.message : 'unknown'
          errors.push(`Failed to kill ${procName} (${pid}): ${reason}`)
        }
      }
    }
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : 'unknown'
    errors.push(`Process enumeration failed: ${reason}`)
  }

  return { killed, errors }
}
