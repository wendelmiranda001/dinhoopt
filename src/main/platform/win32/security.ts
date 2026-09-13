import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getLogger } from '../../services/logger.service'
import type {
  AntivirusProduct,
  AntivirusStatus,
  DiskEncryptionStatus,
  DiskEncryptionVolume,
  FirewallStatus,
  PasswordPolicy,
  PatchInfo,
  PlatformSecurity,
  ScreenLockStatus,
  UpdateStatus,
} from '../types'

const execFileAsync = promisify(execFile)

function runPowerShell(script: string, timeoutMs = 30_000): Promise<string> {
  return execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    timeout: timeoutMs,
  }).then((r) => r.stdout)
}

function parseProductState(state: number): {
  enabled: boolean
  realtimeProtection: boolean
  signaturesUpToDate: boolean
} {
  const enabledLevel = (state >> 12) & 0xf
  const realtime = (state >> 8) & 0xf
  const sigs = (state >> 4) & 0xf
  return {
    enabled: enabledLevel >= 1,
    realtimeProtection: realtime === 0,
    signaturesUpToDate: sigs === 0,
  }
}

async function collectAntivirusStatus(): Promise<AntivirusStatus> {
  try {
    const stdout = await runPowerShell(
      'Get-WmiObject -Namespace root\\SecurityCenter2 -Class AntiVirusProduct | Select-Object displayName, productState | ConvertTo-Json -Compress',
    )
    const raw = JSON.parse(stdout)
    const items: Array<{ displayName: string | null; productState: number }> = Array.isArray(raw) ? raw : [raw]
    const products: AntivirusProduct[] = items.map((item) => ({
      name: item.displayName || 'Unknown',
      ...parseProductState(item.productState ?? 0),
    }))
    const thirdParty = products.find((p) => p.name !== 'Windows Defender')
    return {
      products,
      primary: thirdParty
        ? thirdParty.name
        : (products.find((p) => p.name === 'Windows Defender')?.name ?? products[0]?.name ?? null),
    }
  } catch {
    return { products: [], primary: null }
  }
}

async function collectFirewallStatus(): Promise<FirewallStatus> {
  const [productsResult, profilesResult] = await Promise.allSettled([
    runPowerShell(
      'Get-WmiObject -Namespace root\\SecurityCenter2 -Class FirewallProduct | Select-Object displayName, productState | ConvertTo-Json -Compress',
    ).then((stdout) => {
      const raw = JSON.parse(stdout)
      const items: Array<{ displayName: string; productState: number }> = Array.isArray(raw) ? raw : [raw]
      return items.map((item) => ({
        name: item.displayName ?? 'Unknown',
        enabled: (((item.productState ?? 0) >> 12) & 0xf) >= 1,
      }))
    }),
    runPowerShell('Get-NetFirewallProfile | Select-Object Name, Enabled | ConvertTo-Json -Compress').then((stdout) => {
      const raw = JSON.parse(stdout)
      const items: Array<{ Name: string; Enabled: boolean | number }> = Array.isArray(raw) ? raw : [raw]
      const profiles: Record<string, boolean> = {}
      for (const item of items) {
        profiles[item.Name.toLowerCase()] = item.Enabled === true || item.Enabled === 1
      }
      return {
        domain: profiles.domain ?? false,
        private: profiles.private ?? false,
        public: profiles.public ?? false,
      }
    }),
  ])

  const products = productsResult.status === 'fulfilled' ? productsResult.value : []
  const windowsProfiles =
    profilesResult.status === 'fulfilled' ? profilesResult.value : { domain: false, private: false, public: false }
  const hasEnabledProduct = products.some((p) => p.enabled)
  const allProfilesOn = windowsProfiles.domain && windowsProfiles.private && windowsProfiles.public
  return {
    enabled: hasEnabledProduct || allProfilesOn,
    products,
    windowsProfiles,
  }
}

const VOLUME_STATUS_MAP: Record<number, string> = {
  0: 'FullyDecrypted',
  1: 'FullyEncrypted',
  2: 'EncryptionInProgress',
  3: 'DecryptionInProgress',
  4: 'EncryptionPaused',
  5: 'DecryptionPaused',
}

async function collectDiskEncryptionStatus(): Promise<DiskEncryptionStatus> {
  try {
    const stdout = await runPowerShell(
      'Get-WmiObject -Namespace root\\cimv2\\Security\\MicrosoftVolumeEncryption -Class Win32_EncryptableVolume | Select-Object MountPoint, VolumeStatus, ProtectionStatus | ConvertTo-Json -Compress',
    )
    const raw = JSON.parse(stdout)
    const items: Array<{ MountPoint: string; VolumeStatus: number; ProtectionStatus: number }> = Array.isArray(raw)
      ? raw
      : [raw]
    const volumes: DiskEncryptionVolume[] = items.map((item) => ({
      mount: item.MountPoint,
      status: VOLUME_STATUS_MAP[item.VolumeStatus] ?? 'Unknown',
      protectionOn: item.ProtectionStatus === 1,
    }))
    return { volumes }
  } catch {
    return { volumes: [] }
  }
}

async function collectUpdateStatus(): Promise<UpdateStatus> {
  try {
    const stdout = await runPowerShell(
      'Get-HotFix | Select-Object HotFixID, InstalledOn, Description | ConvertTo-Json -Compress',
    )
    const raw = JSON.parse(stdout)
    const patches: PatchInfo[] = (Array.isArray(raw) ? raw : [raw])
      .filter(
        (item: { HotFixID?: string | null; InstalledOn?: string | string[] | null }) =>
          item.HotFixID && item.InstalledOn,
      )
      .map((item: { HotFixID: string; InstalledOn: string | string[]; Description: string }) => {
        let installedOn: string
        if (Array.isArray(item.InstalledOn)) {
          installedOn = String(item.InstalledOn[0]).slice(0, 10)
        } else {
          installedOn = String(item.InstalledOn).slice(0, 10)
        }
        return {
          id: item.HotFixID,
          installedOn,
          description: item.Description ?? '',
        }
      })
    if (patches.length === 0) {
      return { recentPatches: [], lastPatchDate: null, daysSinceLastPatch: null }
    }
    const lastPatchDate = patches[0]!.installedOn
    const daysSince = Math.floor((Date.now() - new Date(lastPatchDate).getTime()) / (1000 * 60 * 60 * 24))
    return { recentPatches: patches, lastPatchDate, daysSinceLastPatch: daysSince }
  } catch {
    return { recentPatches: [], lastPatchDate: null, daysSinceLastPatch: null }
  }
}

async function collectScreenLockStatus(): Promise<ScreenLockStatus> {
  try {
    const stdout = await runPowerShell(`
$base = 'HKCU:Control Panel\\Desktop'
$gpo = 'HKLM:SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System'
$ssActive = (Get-ItemProperty -Path $base -Name ScreenSaveActive -ErrorAction SilentlyContinue).ScreenSaveActive
$ssSecure = (Get-ItemProperty -Path $base -Name ScreenSaverIsSecure -ErrorAction SilentlyContinue).ScreenSaverIsSecure
$ssTimeout = (Get-ItemProperty -Path $base -Name ScreenSaveTimeOut -ErrorAction SilentlyContinue).ScreenSaveTimeOut
$gpoTimeout = (Get-ItemProperty -Path $gpo -Name InactivityTimeoutSecs -ErrorAction SilentlyContinue).InactivityTimeoutSecs
@{
  ssActive = if ($null -eq $ssActive) { $null } else { "$ssActive" }
  ssSecure = if ($null -eq $ssSecure) { $null } else { "$ssSecure" }
  ssTimeout = if ($null -eq $ssTimeout) { $null } else { "$ssTimeout" }
  gpoTimeout = $gpoTimeout
} | ConvertTo-Json -Compress
`)
    const data = JSON.parse(stdout)
    const ssActive = data.ssActive === null || data.ssActive === undefined ? null : String(data.ssActive)
    const ssSecure = data.ssSecure === null || data.ssSecure === undefined ? null : String(data.ssSecure)
    const ssTimeout = data.ssTimeout === null || data.ssTimeout === undefined ? null : Number(data.ssTimeout)
    const gpoTimeout =
      data.gpoTimeout === null || data.gpoTimeout === undefined || data.gpoTimeout === 0
        ? null
        : Number(data.gpoTimeout)
    return {
      screenSaverEnabled: ssActive === '1',
      lockOnResume: ssSecure === '1',
      timeoutSec: ssTimeout,
      inactivityLockSec: gpoTimeout,
    }
  } catch {
    return { screenSaverEnabled: false, lockOnResume: false, timeoutSec: null, inactivityLockSec: null }
  }
}

async function collectPasswordPolicy(): Promise<PasswordPolicy> {
  try {
    const stdout = await runPowerShell(`
$net = net accounts
$minLength = 0; $maxAge = 0; $minAge = 0; $history = 0; $complexity = $false
$lockThreshold = 0; $lockDuration = 0; $lockWindow = 0
$helloEnrolled = $false; $helloFace = $false; $helloFinger = $false; $helloPin = $false

# Parse net accounts output
foreach ($line in $net) {
  if ($line -match 'Minimum password length:\\s+(\\d+)') { $minLength = [int]$Matches[1] }
  elseif ($line -match 'Maximum password age \\(days\\):\\s+(\\d+)') { $maxAge = [int]$Matches[1] }
  elseif ($line -match 'Minimum password age \\(days\\):\\s+(\\d+)') { $minAge = [int]$Matches[1] }
  elseif ($line -match 'Length of password history maintained:\\s+(\\d+)') { $history = [int]$Matches[1] }
  elseif ($line -match 'Password complexity meets requirements:\\s+(Yes|No)') { $complexity = $Matches[1] -eq 'Yes' }
  elseif ($line -match 'Lockout threshold:\\s+(\\d+)') { $lockThreshold = [int]$Matches[1] }
  elseif ($line -match 'Lockout duration \\(minutes\\):\\s+(\\d+)') { $lockDuration = [int]$Matches[1] }
  elseif ($line -match 'Lockout observation window \\(minutes\\):\\s+(\\d+)') { $lockWindow = [int]$Matches[1] }
}

try {
  $hello = Get-WmiObject -Namespace root\\cimv2\\Security\\MicrosoftPassportContainer -Class PassportContainer | Select-Object -First 1
  if ($hello) { $helloEnrolled = $true }
} catch {}
try {
  $face = Get-WmiObject -Namespace root\\cimv2\\Security\\MicrosoftPassportContainer -Class PassportContainer | Where-Object { $_.BiometricFactor -eq 1 }
  if ($face) { $helloFace = $true }
} catch {}
try {
  $pin = Get-WindowsHelloPin -ErrorAction SilentlyContinue
  if ($pin) { $helloPin = $true }
} catch {}
@{
  minLength = $minLength; maxAge = $maxAge; minAge = $minAge; history = $history; complexity = $complexity
  lockoutThreshold = $lockThreshold; lockoutDuration = $lockDuration; lockoutWindow = $lockWindow
  helloEnrolled = $helloEnrolled; helloFace = $helloFace; helloFinger = $helloFinger; helloPin = $helloPin
} | ConvertTo-Json -Compress
`)
    const data = JSON.parse(stdout)
    const toNum = (v: unknown): number => {
      if (typeof v === 'number' && !Number.isNaN(v)) return v
      const n = Number(v)
      return Number.isNaN(n) ? 0 : n
    }
    const toBool = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true'
    return {
      minLength: toNum(data.minLength),
      maxAgeDays: toNum(data.maxAge),
      minAgeDays: toNum(data.minAge),
      historyCount: toNum(data.history),
      complexityRequired: toBool(data.complexity),
      lockoutThreshold: toNum(data.lockoutThreshold),
      lockoutDurationMin: toNum(data.lockoutDuration),
      lockoutObservationMin: toNum(data.lockoutWindow),
      windowsHello: {
        enrolled: toBool(data.helloEnrolled),
        faceEnabled: toBool(data.helloFace),
        fingerprintEnabled: toBool(data.helloFinger),
        pinEnabled: toBool(data.helloPin),
      },
    }
  } catch {
    return {
      minLength: 0,
      maxAgeDays: 0,
      minAgeDays: 0,
      historyCount: 0,
      complexityRequired: false,
      lockoutThreshold: 0,
      lockoutDurationMin: 0,
      lockoutObservationMin: 0,
      windowsHello: { enrolled: false, faceEnabled: false, fingerprintEnabled: false, pinEnabled: false },
    }
  }
}

async function detectServerRole(): Promise<boolean> {
  const stdout = await runPowerShell(`$os = Get-WmiObject -Class Win32_OperatingSystem | Select-Object -First 1
$reg = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' -Name 'InstallationType' -ErrorAction SilentlyContinue
$productType = 0
if ($null -ne $os) { $productType = [int]$os.ProductType }
$installationType = ''
if ($null -ne $reg) { $installationType = [string]$reg.InstallationType }
[PSCustomObject]@{ productType = $productType; installationType = $installationType } | ConvertTo-Json -Compress`)
  const data = JSON.parse(stdout)
  const productType = Number(data.productType ?? 0)
  const installationType = String(data.installationType ?? '')
  return productType >= 2 || /server/i.test(installationType)
}

function unsupportedOnWindows(name: string): () => Promise<never> {
  return async () => {
    throw new Error(`${name} is not supported on Windows`)
  }
}

export function createWin32Security(): PlatformSecurity {
  return {
    async isServer() {
      try {
        const server = await detectServerRole()
        if (!server) {
          getLogger().warning(
            'win32-security',
            'isServer() = false — trust decisions on the local server service are not verified',
          )
        }
        return server
      } catch (err) {
        getLogger().warning(
          'win32-security',
          `isServer() could not be determined — defaulting to false: ${err instanceof Error ? err.message : String(err)}`,
        )
        return false
      }
    },
    collectAntivirusStatus,
    collectFirewallStatus,
    collectDiskEncryptionStatus,
    collectUpdateStatus,
    collectScreenLockStatus,
    collectPasswordPolicy,
    collectSshHardening: unsupportedOnWindows('collectSshHardening'),
    collectFail2ban: unsupportedOnWindows('collectFail2ban'),
    collectListeningPorts: unsupportedOnWindows('collectListeningPorts'),
    collectAuditd: unsupportedOnWindows('collectAuditd'),
    collectSuidSgidBinaries: unsupportedOnWindows('collectSuidSgidBinaries'),
    collectLinuxFirewallStatus: unsupportedOnWindows('collectLinuxFirewallStatus'),
  }
}
