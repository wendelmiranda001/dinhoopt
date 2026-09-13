import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { RegistryEntry } from '@shared/types'
import { execReg, expandEnvVars, extractExePath } from './utils'

export async function scanSystemHealth(signal?: AbortSignal): Promise<RegistryEntry[]> {
  const entries: RegistryEntry[] = []

  function checkAborted(): void {
    if (signal?.aborted) throw new Error('Operation cancelled')
  }

  checkAborted()
  try {
    const { stdout } = await execReg(['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths', '/s'], {
      timeout: 15000,
      ...(signal ? { signal } : {}),
    })
    const blocks = stdout.split(/\r?\n\r?\n/)
    for (const block of blocks) {
      const keyMatch = block.match(/^(HKLM\\[^\r\n]+)/m)
      const valMatch = block.match(/\(Default\)\s+REG_SZ\s+(.+)/i)
      if (valMatch) {
        const exePath = (valMatch[1] ?? '').trim().replace(/"/g, '')
        if (exePath && !existsSync(expandEnvVars(exePath))) {
          entries.push({
            id: randomUUID(),
            type: 'invalid',
            keyPath: keyMatch?.[1] || 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
            valueName: '(Default)',
            issue: `App path points to missing file: ${exePath}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-key' },
          })
        }
      }
    }
  } catch {
    /* Skip if reg query fails */
  }

  checkAborted()
  try {
    const { stdout } = await execReg(
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\SharedDLLs', '/s'],
      { timeout: 15000, ...(signal ? { signal } : {}) },
    )
    const lines = stdout.split(/\r?\n/)
    for (const line of lines) {
      const match = line.match(/^\s+(.+?\.\w{2,4})\s+REG_DWORD\s+/i)
      if (match) {
        const dllPath = match[1]!.trim()
        if (dllPath && dllPath.length > 3 && !existsSync(expandEnvVars(dllPath))) {
          entries.push({
            id: randomUUID(),
            type: 'broken',
            keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\SharedDLLs',
            valueName: dllPath,
            issue: `Shared DLL reference missing: ${dllPath}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-value' },
          })
        }
      }
    }
  } catch {
    /* Skip */
  }

  checkAborted()
  const runKeys = [
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
  ]
  for (const runKey of runKeys) {
    try {
      const { stdout } = await execReg(['query', runKey], { timeout: 10000, ...(signal ? { signal } : {}) })
      const lines = stdout.split(/\r?\n/)
      for (const line of lines) {
        const match = line.match(/^\s+(\S+)\s+REG_SZ\s+(.+)/i)
        if (match) {
          const valueName = match[1]!.trim()
          const command = match[2]!.trim()
          const exePath = extractExePath(command)
          if (exePath) {
            if (exePath.includes('\\') && !existsSync(expandEnvVars(exePath))) {
              entries.push({
                id: randomUUID(),
                type: 'broken',
                keyPath: runKey,
                valueName,
                issue: `Startup entry points to missing file: ${exePath}`,
                risk: 'medium',
                selected: true,
                fix: { op: 'delete-value' },
              })
            }
          }
        }
      }
    } catch {
      /* Skip */
    }
  }

  checkAborted()
  try {
    const { stdout } = await execReg(
      ['query', 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts', '/s'],
      { timeout: 15000, ...(signal ? { signal } : {}) },
    )
    const blocks = stdout.split(/\r?\n\r?\n/)
    for (const block of blocks) {
      const keyMatch = block.match(/^(HKCU\\[^\r\n]+\\OpenWithList)/m)
      const appMatch = block.match(/REG_SZ\s+(.+\.exe)/i)
      if (keyMatch && appMatch) {
        const appName = appMatch[1]!.trim()
        try {
          await execReg(['query', `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${appName}`], {
            timeout: 5000,
            ...(signal ? { signal } : {}),
          })
        } catch {
          if (!appName.includes('\\') && !appName.includes('/')) {
            entries.push({
              id: randomUUID(),
              type: 'obsolete',
              keyPath: keyMatch[1]!,
              valueName: appName,
              issue: `File association references unregistered app: ${appName}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-value' },
            })
          }
        }
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const { stdout } = await execReg(['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', '/s'], {
      timeout: 15000,
      ...(signal ? { signal } : {}),
    })
    const winDir = process.env.WINDIR || 'C:\\Windows'
    const fontsDir = join(winDir, 'Fonts')
    const lines = stdout.split(/\r?\n/)
    for (const line of lines) {
      const match = line.match(/^\s+(.+?)\s+REG_SZ\s+(.+)/i)
      if (match) {
        const fontName = match[1]!.trim()
        let fontFile = match[2]!.trim()
        if (!fontFile.includes('\\') && !fontFile.includes('/')) {
          fontFile = join(fontsDir, fontFile)
        }
        if (fontFile && !existsSync(fontFile)) {
          entries.push({
            id: randomUUID(),
            type: 'invalid',
            keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
            valueName: fontName,
            issue: `Font file missing: ${fontFile}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-value' },
          })
        }
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const { stdout } = await execReg(
      ['query', 'HKCU\\SOFTWARE\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache', '/s'],
      { timeout: 15000, ...(signal ? { signal } : {}) },
    )
    const muiKey = 'HKCU\\SOFTWARE\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache'
    const lines = stdout.split(/\r?\n/)
    for (const line of lines) {
      const match = line.match(/^\s+(.+?\.exe(\.\w+))\s+REG_SZ\s+/i)
      if (match) {
        const fullValueName = match[1]!.trim()
        const exePath = fullValueName.replace(/\.\w+$/, '')
        if (exePath?.includes('\\') && !existsSync(expandEnvVars(exePath))) {
          entries.push({
            id: randomUUID(),
            type: 'obsolete',
            keyPath: muiKey,
            valueName: fullValueName,
            issue: `MUI cache references uninstalled program: ${exePath}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-value' },
          })
        }
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const fwRulesKey =
      'HKLM\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\FirewallRules'
    const { stdout } = await execReg(['query', fwRulesKey, '/s'], { timeout: 15000, ...(signal ? { signal } : {}) })
    const lines = stdout.split(/\r?\n/)
    for (const line of lines) {
      const match = line.match(/REG_SZ\s+(.+)/i)
      if (match) {
        const ruleValue = match[1]!
        const appMatch = ruleValue.match(/App=([^|]+)/i)
        if (appMatch) {
          const appPath = appMatch[1]!.trim()
          if (appPath && !appPath.startsWith('%') && appPath.includes('\\') && !existsSync(appPath)) {
            const nameMatch = line.match(/^\s+(.+?)\s+REG_SZ/i)
            entries.push({
              id: randomUUID(),
              type: 'obsolete',
              keyPath: fwRulesKey,
              valueName: nameMatch?.[1]?.trim() || 'Unknown Rule',
              issue: `Firewall rule for missing program: ${appPath}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-value' },
            })
          }
        }
      }
    }
  } catch {
    /* Skip */
  }

  checkAborted()

  try {
    const installerKey = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Installer\\Folders'
    const { stdout } = await execReg(['query', installerKey, '/s'], { timeout: 15000, ...(signal ? { signal } : {}) })
    const lines = stdout.split(/\r?\n/)
    for (const line of lines) {
      const match = line.match(/^\s+(.+?)\s+REG_SZ/i)
      if (match) {
        const folderPath = match[1]!.trim()
        if (folderPath && folderPath.length > 3 && !existsSync(expandEnvVars(folderPath))) {
          entries.push({
            id: randomUUID(),
            type: 'orphaned',
            keyPath: installerKey,
            valueName: folderPath,
            issue: `Windows Installer references missing folder: ${folderPath}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-value' },
          })
        }
      }
    }
  } catch {
    /* Skip */
  }

  const uninstallKeys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ]
  for (const uninstallKey of uninstallKeys) {
    try {
      const { stdout } = await execReg(['query', uninstallKey, '/s'], { timeout: 15000, ...(signal ? { signal } : {}) })
      const blocks = stdout.split(/\r?\n\r?\n/)
      for (const block of blocks) {
        const keyMatch = block.match(/^(HK[^\r\n]+)/m)
        if (!keyMatch) continue
        const subKey = keyMatch[1]!
        if (subKey === uninstallKey) continue
        const installLocMatch = block.match(/InstallLocation\s+REG_(?:EXPAND_)?SZ\s+(.+)/i)
        const uninstallStrMatch = block.match(/UninstallString\s+REG_(?:EXPAND_)?SZ\s+(.+)/i)
        const displayNameMatch = block.match(/DisplayName\s+REG_(?:EXPAND_)?SZ\s+(.+)/i)
        if (!displayNameMatch) continue
        const displayName = (displayNameMatch[1] ?? '').trim()
        if (
          displayName.startsWith('Microsoft') ||
          displayName.startsWith('Windows') ||
          displayName.includes('Update for') ||
          displayName.includes('Security Update') ||
          displayName.includes('Hotfix') ||
          displayName.includes('KB')
        )
          continue
        let uninstallBroken = false
        if (uninstallStrMatch) {
          const rawUninstall = (uninstallStrMatch[1] ?? '').trim()
          const exePath = expandEnvVars(extractExePath(rawUninstall) || '')
          if (exePath?.toLowerCase().includes('msiexec')) {
            // MSI uninstallers are always functional
          } else if (exePath?.toLowerCase().includes('rundll32')) {
            const strippedUninstall = rawUninstall.replace(/"/g, '')
            const dllMatch = strippedUninstall.match(/rundll32(?:\.exe)?\s+([^,]+\.dll)/i)
            if (dllMatch) {
              const dllPath = expandEnvVars((dllMatch[1] ?? '').trim())
              if (dllPath.includes('\\') && !dllPath.startsWith('%') && !existsSync(dllPath)) {
                uninstallBroken = true
              }
            }
          } else if (exePath?.includes('\\') && !exePath.startsWith('%') && !existsSync(exePath)) {
            uninstallBroken = true
          }
        }
        let installDirExists = false
        if (installLocMatch) {
          const installLoc = expandEnvVars((installLocMatch[1] ?? '').trim().replace(/"/g, ''))
          if (installLoc && installLoc.length > 3 && installLoc.includes('\\') && !installLoc.startsWith('%')) {
            installDirExists = existsSync(installLoc)
          }
        }
        if (!installDirExists) {
          const iconMatch = block.match(/DisplayIcon\s+REG_(?:EXPAND_)?SZ\s+(.+)/i)
          if (iconMatch) {
            const iconPath = expandEnvVars((iconMatch[1] ?? '').trim().replace(/"/g, '').split(',')[0]?.trim() ?? '')
            if (iconPath?.includes('\\') && !iconPath.startsWith('%') && existsSync(iconPath)) {
              installDirExists = true
            }
          }
        }
        let orphaned = false
        if (uninstallBroken && !installDirExists) {
          orphaned = true
        } else if (!uninstallStrMatch && !installDirExists && installLocMatch) {
          orphaned = true
        }
        if (orphaned) {
          entries.push({
            id: randomUUID(),
            type: 'orphaned',
            keyPath: subKey,
            valueName: 'DisplayName',
            issue: `Uninstall entry for removed program: ${displayName}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-key' },
          })
        }
      }
    } catch {
      /* Skip */
    }
  }

  checkAborted()

  const appCompatKeyLM = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers'
  try {
    const { stdout } = await execReg(['query', appCompatKeyLM, '/s'], { timeout: 10000, ...(signal ? { signal } : {}) })
    const lines = stdout.split(/\r?\n/)
    for (const line of lines) {
      const match = line.match(/^\s+(.+?\.\w{2,4})\s+REG_SZ\s+/i)
      if (match) {
        const appPath = match[1]!.trim()
        if (appPath?.includes('\\') && !existsSync(expandEnvVars(appPath))) {
          entries.push({
            id: randomUUID(),
            type: 'obsolete',
            keyPath: appCompatKeyLM,
            valueName: appPath,
            issue: `Compatibility shim for uninstalled app: ${appPath}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-value' },
          })
        }
      }
    }
  } catch {
    /* Skip */
  }

  const appCompatKeyCU = 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers'
  try {
    const { stdout } = await execReg(['query', appCompatKeyCU, '/s'], { timeout: 10000, ...(signal ? { signal } : {}) })
    const lines = stdout.split(/\r?\n/)
    for (const line of lines) {
      const match = line.match(/^\s+(.+?\.\w{2,4})\s+REG_SZ\s+/i)
      if (match) {
        const appPath = match[1]!.trim()
        if (appPath?.includes('\\') && !existsSync(expandEnvVars(appPath))) {
          entries.push({
            id: randomUUID(),
            type: 'obsolete',
            keyPath: appCompatKeyCU,
            valueName: appPath,
            issue: `Compatibility shim for uninstalled app: ${appPath}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-value' },
          })
        }
      }
    }
  } catch {
    /* Skip */
  }

  checkAborted()

  try {
    const servicesKey = 'HKLM\\SYSTEM\\CurrentControlSet\\Services'
    const { stdout } = await execReg(['query', servicesKey, '/s', '/f', 'ImagePath', '/v'], {
      timeout: 20000,
      ...(signal ? { signal } : {}),
    })
    const blocks = stdout.split(/\r?\n\r?\n/)
    let svcCount = 0
    for (const block of blocks) {
      if (svcCount >= 40) break
      const fullKeyMatch = block.match(/^(HK[^\r\n]+)/m)
      if (!fullKeyMatch) continue
      const fullKey = fullKeyMatch[1]!.trim()
      const afterServices = fullKey.replace(/^.*\\Services\\/i, '')
      if (afterServices.includes('\\')) continue
      const svcName = afterServices
      const valMatch = block.match(/ImagePath\s+REG_(?:EXPAND_)?SZ\s+(.+)/i)
      if (valMatch) {
        const rawImagePath = (valMatch[1] ?? '').trim()
        let imagePath = extractExePath(rawImagePath)
        if (!imagePath) continue
        imagePath = expandEnvVars(imagePath)
        const lowerPath = imagePath.toLowerCase()
        if (
          lowerPath.startsWith('\\systemroot\\') ||
          lowerPath.startsWith('c:\\windows\\') ||
          lowerPath.includes('\\microsoft\\') ||
          lowerPath.includes('\\windows\\') ||
          imagePath.startsWith('\\??\\')
        )
          continue
        if (!imagePath.match(/^[A-Za-z]:\\/)) continue
        if (imagePath && !existsSync(imagePath)) {
          entries.push({
            id: randomUUID(),
            type: 'orphaned',
            keyPath: fullKey,
            valueName: 'ImagePath',
            issue: `Service "${svcName}" points to missing executable: ${imagePath}`,
            risk: 'medium',
            selected: true,
            fix: { op: 'delete-key' },
          })
          svcCount++
        }
      }
    }
  } catch {
    /* Skip */
  }

  return entries
}
