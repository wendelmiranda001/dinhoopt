import type { StartupBootEntry, StartupBootTrace } from '@shared/types'
import { getPlatform } from '../../platform'
import { execFileAsync, psArgs } from '../../services/exec-utf8'
import { deriveDisplayName } from './utils'

export async function getBootTrace(): Promise<StartupBootTrace> {
  const empty: StartupBootTrace = {
    totalBootMs: 0,
    lastBootDate: null,
    mainPathMs: 0,
    startupAppsMs: 0,
    entries: [],
    available: false,
    needsAdmin: false,
  }

  if (process.platform !== 'win32') {
    const platformTrace = await getPlatform().startup.getBootTrace?.()
    return platformTrace ?? empty
  }

  try {
    const bootScript = `
      $log = 'Microsoft-Windows-Diagnostics-Performance/Operational'
      try {
        $boot = Get-WinEvent -LogName $log -FilterXPath '*[System[EventID=100]]' -MaxEvents 1 -ErrorAction Stop
        $xml = [xml]$boot.ToXml()
        $ns = New-Object Xml.XmlNamespaceManager($xml.NameTable)
        $ns.AddNamespace('e','http://schemas.microsoft.com/win/2004/08/events/event')
        $totalMs = $xml.SelectSingleNode('//e:EventData/e:Data[@Name="BootTime"]', $ns).'#text'
        $mainMs = $xml.SelectSingleNode('//e:EventData/e:Data[@Name="MainPathBootTime"]', $ns).'#text'
        Write-Output "BOOT|$totalMs|$mainMs|$($boot.TimeCreated.ToString('o'))"
      } catch {
        if ($_.Exception -is [System.UnauthorizedAccessException] -or
            ($_.Exception.InnerException -and $_.Exception.InnerException -is [System.UnauthorizedAccessException])) {
          Write-Output 'STATUS|DENIED'
          return
        }
        Write-Output 'BOOT|0|0|'
      }

      try {
        $apps = Get-WinEvent -LogName $log -FilterXPath '*[System[EventID=101 or EventID=102 or EventID=103 or EventID=106 or EventID=109]]' -MaxEvents 50 -ErrorAction Stop
        foreach ($evt in $apps) {
          $xm = [xml]$evt.ToXml()
          $ns2 = New-Object Xml.XmlNamespaceManager($xm.NameTable)
          $ns2.AddNamespace('e','http://schemas.microsoft.com/win/2004/08/events/event')
          $appName = $xm.SelectSingleNode('//e:EventData/e:Data[@Name="Name"]', $ns2).'#text'
          $degradMs = $xm.SelectSingleNode('//e:EventData/e:Data[@Name="TotalTime"]', $ns2).'#text'
          if (-not $degradMs) { $degradMs = $xm.SelectSingleNode('//e:EventData/e:Data[@Name="DegradationTime"]', $ns2).'#text' }
          $filePath = $xm.SelectSingleNode('//e:EventData/e:Data[@Name="FriendlyName"]', $ns2).'#text'
          if (-not $filePath) { $filePath = $appName }
          if ($appName -and $degradMs) {
            Write-Output "APP|$appName|$degradMs|$filePath"
          }
        }
      } catch {}
    `

    const { stdout } = await execFileAsync('powershell', psArgs(bootScript), { timeout: 15000, windowsHide: true })

    const lines = String(stdout)
      .trim()
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean)

    if (lines.some((l) => l === 'STATUS|DENIED')) {
      return { ...empty, needsAdmin: true }
    }

    let totalBootMs = 0
    let mainPathMs = 0
    let lastBootDate: string | null = null
    const entries: StartupBootEntry[] = []

    for (const line of lines) {
      const parts = line.split('|')
      if (parts[0] === 'BOOT') {
        totalBootMs = Number.parseInt(parts[1] ?? '', 10) || 0
        mainPathMs = Number.parseInt(parts[2] ?? '', 10) || 0
        lastBootDate = parts[3] ?? null
      } else if (parts[0] === 'APP') {
        const appName = parts[1] ?? ''
        const delayMs = Number.parseInt(parts[2] ?? '', 10) || 0
        const filePath = parts[3] ?? appName
        if (delayMs > 0) {
          entries.push({
            name: appName,
            displayName: deriveDisplayName(appName, filePath),
            delayMs,
            source: 'registry-hkcu',
            impact: delayMs > 3000 ? 'high' : delayMs > 1000 ? 'medium' : 'low',
          })
        }
      }
    }

    const seen = new Map<string, StartupBootEntry>()
    for (const entry of entries) {
      const key = entry.name.toLowerCase()
      if (!seen.has(key)) {
        seen.set(key, entry)
      }
    }
    const deduped = Array.from(seen.values())

    deduped.sort((a, b) => b.delayMs - a.delayMs)

    const startupAppsMs = deduped.reduce((sum, e) => sum + e.delayMs, 0)

    return {
      totalBootMs,
      lastBootDate,
      mainPathMs,
      startupAppsMs,
      entries: deduped,
      available: totalBootMs > 0 || deduped.length > 0,
      needsAdmin: false,
    }
  } catch {
    return empty
  }
}
