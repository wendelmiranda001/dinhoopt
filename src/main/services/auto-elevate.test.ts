import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.fn()
const execFileMock = vi.fn()
const existsSyncMock = vi.fn()
const psUtf8Mock = vi.fn((command: string): string => `ps:${command}`)

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  execFile: execFileMock,
}))

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
}))

vi.mock('./exec-utf8', () => ({
  psUtf8: psUtf8Mock,
}))

const RESOURCES = 'C:\\Program Files\\DiNhoOptimizer\\resources'
const EXE = 'C:\\Program Files\\DiNhoOptimizer\\DiNho Optimizer.exe'

type Mock = ReturnType<typeof vi.fn>

function childLike(): { on: Mock; unref: Mock; pid: number } {
  return { on: vi.fn(), unref: vi.fn(), pid: 4242 }
}

function mockBareExecFile(): void {
  execFileMock.mockImplementation((_f: unknown, _a: unknown, _o: unknown, cb: (e?: Error | null) => void) => {
    cb(null)
  })
}

describe('auto-elevate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('prefers elevate.exe when it ships in resources', async () => {
    existsSyncMock.mockReturnValue(true)
    const child = childLike()
    spawnMock.mockReturnValue(child)

    const { relaunchElevated } = await import('./auto-elevate')
    const result = relaunchElevated({ childExecutable: EXE, resourcesPath: RESOURCES })

    expect(result.method).toBe('elevate.exe')
    expect(existsSyncMock).toHaveBeenCalledWith(join(RESOURCES, 'elevate.exe'))
    expect(spawnMock).toHaveBeenCalledWith(join(RESOURCES, 'elevate.exe'), [EXE], {
      detached: true,
      stdio: 'ignore',
    })
    expect(child.unref).toHaveBeenCalled()
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('forwards child args after the executable to elevate.exe', async () => {
    existsSyncMock.mockReturnValue(true)
    spawnMock.mockReturnValue(childLike())

    const { relaunchElevated } = await import('./auto-elevate')
    relaunchElevated({
      childExecutable: EXE,
      resourcesPath: RESOURCES,
      childArgs: ['--dinho-data-dir=C:\\Users\\A\\Din', '--startup'],
    })

    expect(spawnMock).toHaveBeenCalledWith(
      join(RESOURCES, 'elevate.exe'),
      [EXE, '--dinho-data-dir=C:\\Users\\A\\Din', '--startup'],
      { detached: true, stdio: 'ignore' },
    )
  })

  it('falls back to PowerShell when elevate.exe is missing', async () => {
    existsSyncMock.mockReturnValue(false)
    mockBareExecFile()

    const { relaunchElevated } = await import('./auto-elevate')
    const result = relaunchElevated({ childExecutable: EXE, resourcesPath: RESOURCES })

    expect(result.method).toBe('powershell')
    expect(spawnMock).not.toHaveBeenCalled()
    expect(execFileMock).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining(['-NoProfile', '-Command']),
      { windowsHide: true },
      expect.any(Function),
    )
    const script = execFileMock.mock.calls[0]?.[1]?.[2] as string
    expect(script).toBe(
      "ps:Start-Process -FilePath 'C:\\Program Files\\DiNhoOptimizer\\DiNho Optimizer.exe' -Verb RunAs",
    )
  })

  it('forwards quoted child args in the PowerShell fallback', async () => {
    existsSyncMock.mockReturnValue(false)
    mockBareExecFile()

    const { relaunchElevated } = await import('./auto-elevate')
    relaunchElevated({
      childExecutable: EXE,
      resourcesPath: RESOURCES,
      childArgs: ['--dinho-data-dir=C:\\Users\\A\\Din'],
    })

    const script = execFileMock.mock.calls[0]?.[1]?.[2] as string
    expect(script).toContain("-ArgumentList '--dinho-data-dir=C:\\Users\\A\\Din'")
  })

  it('escapes single quotes in paths passed to PowerShell', async () => {
    existsSyncMock.mockReturnValue(false)
    mockBareExecFile()

    const { relaunchElevated } = await import('./auto-elevate')
    relaunchElevated({ childExecutable: "C:\\Data'dir\\App.exe", resourcesPath: RESOURCES })

    const script = execFileMock.mock.calls[0]?.[1]?.[2] as string
    expect(script).toContain("Start-Process -FilePath 'C:\\Data''dir\\App.exe' -Verb RunAs")
  })

  it('routes spawn errors to onError in the elevate.exe path', async () => {
    existsSyncMock.mockReturnValue(true)
    const child = childLike()
    spawnMock.mockReturnValue(child)
    const onError = vi.fn()

    const { relaunchElevated } = await import('./auto-elevate')
    relaunchElevated({ childExecutable: EXE, resourcesPath: RESOURCES, onError })

    const errorHandler = (child.on as Mock).mock.calls.find((c: unknown[]) => c[0] === 'error')?.[1]
    expect(errorHandler).toBeTypeOf('function')
    errorHandler(new Error('EPERM'))
    expect(onError).toHaveBeenCalledWith(new Error('EPERM'))
  })

  it('routes execFile errors to onError in the PowerShell fallback', async () => {
    existsSyncMock.mockReturnValue(false)
    let capturedCallback: ((e?: Error | null) => void) | undefined
    execFileMock.mockImplementation((_f: unknown, _a: unknown, _o: unknown, cb: (e?: Error | null) => void) => {
      capturedCallback = cb
    })
    const onError = vi.fn()

    const { relaunchElevated } = await import('./auto-elevate')
    relaunchElevated({ childExecutable: EXE, resourcesPath: RESOURCES, onError })

    expect(capturedCallback).toBeTypeOf('function')
    capturedCallback?.(new Error('powershell missing'))
    expect(onError).toHaveBeenCalledWith(new Error('powershell missing'))
  })
})
