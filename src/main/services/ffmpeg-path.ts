import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

let _cachedPath: string | null = null

const _candidates = ['ffmpeg.exe', 'ffmpeg']

function findInDirs(dirs: string[]): string | null {
  for (const dir of dirs) {
    for (const name of _candidates) {
      const p = join(dir, name)
      if (existsSync(p)) return p
    }
  }
  return null
}

function commonDirs(): string[] {
  const dirs: string[] = []
  const pf = process.env.ProgramFiles
  const pf86 = process.env['ProgramFiles(x86)']
  const localAppData = process.env.LOCALAPPDATA
  if (pf) dirs.push(join(pf, 'ffmpeg', 'bin'), join(pf, 'FFmpeg', 'bin'))
  if (pf86) dirs.push(join(pf86, 'ffmpeg', 'bin'), join(pf86, 'FFmpeg', 'bin'))
  if (localAppData) {
    dirs.push(
      join(localAppData, 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe'),
    )
  }
  dirs.push('C:\\ffmpeg\\bin', 'C:\\FFmpeg\\bin', 'C:\\tools\\ffmpeg\\bin')
  return dirs
}

// ffmpeg shipped next to the clips engine — used by the encoder, so probes and
// thumbnails must use the same binary when there is no system ffmpeg on PATH.
function bundledDirs(): string[] {
  const dirs: string[] = []
  const enginePath = process.env.DINHO_CLIPS_ENGINE_PATH
  if (enginePath) dirs.push(dirname(enginePath))
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    dirs.push(join(resourcesPath, 'clips-engine'), join(resourcesPath, 'clips-engine-staging'))
  }
  const cwd = process.cwd()
  if (cwd) {
    dirs.push(join(cwd, 'resources', 'clips-engine'), join(cwd, 'resources', 'clips-engine-staging'))
  }
  return dirs
}

function findFfmpeg(): string | null {
  // Try PATH first (most common: WinGet, scoop, choco, manual)
  const pathDirs = (process.env.PATH || '').split(';')
  const found = findInDirs(pathDirs.map((d) => d.trim()).filter(Boolean))
  if (found) return found

  // Fall back to common install directories
  const fromDirs = findInDirs(commonDirs())
  if (fromDirs) return fromDirs

  // Fall back to the ffmpeg bundled with the clips engine
  const bundled = findInDirs(bundledDirs())
  if (bundled) return bundled

  try {
    const result = execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf-8', timeout: 3000 }).trim()
    if (result) return result.split('\n')[0]!.trim()
  } catch {
    /* ffmpeg not in PATH */
  }

  return null
}

export function resolveFfmpegOrNull(): string | null {
  if (_cachedPath && existsSync(_cachedPath)) return _cachedPath
  _cachedPath = findFfmpeg()
  return _cachedPath
}

export function getFfmpegPath(): string {
  return resolveFfmpegOrNull() ?? 'ffmpeg'
}
