import { execFileAsync, psUtf8 } from '../../services/exec-utf8'

export async function ps(script: string, timeout = 15000): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psUtf8(script)],
    { timeout, windowsHide: true },
  )
  return String(stdout).trim()
}
