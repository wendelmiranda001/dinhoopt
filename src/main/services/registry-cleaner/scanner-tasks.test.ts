import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = {
  execTracked: vi.fn(),
  existsSync: vi.fn(),
  randomUUID: vi.fn(),
  expandEnvVars: vi.fn(),
  extractExePath: vi.fn(),
}

vi.mock('node:crypto', () => ({
  randomUUID: (...a: unknown[]) => mocks.randomUUID(...a),
}))

vi.mock('node:fs', () => ({
  existsSync: (...a: unknown[]) => mocks.existsSync(...a),
}))

vi.mock('../exec-utf8', () => ({
  execNativeUtf8: (...a: unknown[]) => mocks.execTracked(...a),
  execTracked: (...a: unknown[]) => mocks.execTracked(...a),
  psArgs: (script: string) => ['-NoProfile', '-NonInteractive', '-Command', script],
}))

vi.mock('./utils', () => ({
  expandEnvVars: (...a: unknown[]) => mocks.expandEnvVars(...a),
  extractExePath: (...a: unknown[]) => mocks.extractExePath(...a),
}))

import { scanScheduledTasks } from './scanner-tasks'

describe('scanScheduledTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.randomUUID.mockReturnValue('uuid-1')
    mocks.expandEnvVars.mockImplementation((p: string) => p)
  })

  describe('first pass — missing executable tasks', () => {
    it('pushes an entry for a task whose exe does not exist', async () => {
      mocks.execTracked.mockResolvedValueOnce({
        stdout: JSON.stringify([
          { TaskName: 'BadTask', TaskPath: '\\Root\\', Execute: 'C:\\Program Files\\Gone\\tool.exe --arg' },
        ]),
        stderr: '',
      })
      mocks.extractExePath.mockReturnValue('C:\\Program Files\\Gone\\tool.exe')
      mocks.existsSync.mockReturnValue(false)
      const entries = await scanScheduledTasks()
      expect(entries).toHaveLength(1)
      expect(entries[0]!.type).toBe('task')
      expect(entries[0]!.keyPath).toBe('\\Root\\BadTask')
      expect(entries[0]!.valueName).toBe('Task To Run')
      expect(entries[0]!.issue).toContain('C:\\Program Files\\Gone\\tool.exe')
      expect(entries[0]!.risk).toBe('low')
      expect(entries[0]!.selected).toBe(true)
      expect(entries[0]!.fix).toEqual({ op: 'delete-task' })
      expect(mocks.execTracked).toHaveBeenNthCalledWith(
        1,
        'powershell',
        expect.any(Array),
        expect.objectContaining({ timeout: 20000 }),
      )
    })

    it('spawns powershell via execTracked so it bypasses the exec-utf8 tool allowlist', async () => {
      mocks.execTracked.mockResolvedValueOnce({ stdout: JSON.stringify([]), stderr: '' })
      mocks.execTracked.mockResolvedValueOnce({ stdout: JSON.stringify([]), stderr: '' })
      const entries = await scanScheduledTasks()
      expect(entries).toEqual([])
      expect(mocks.execTracked).toHaveBeenCalledTimes(2)
      for (const call of mocks.execTracked.mock.calls) {
        expect(call[0]).toBe('powershell')
        expect(call[1]).toContain('-NoProfile')
      }
    })

    it('skips tasks whose exe exists', async () => {
      mocks.execTracked.mockResolvedValueOnce({
        stdout: JSON.stringify([{ TaskName: 'Ok', TaskPath: '\\', Execute: 'C:\\Windows\\System32\\x.exe' }]),
        stderr: '',
      })
      mocks.extractExePath.mockReturnValue('C:\\Windows\\System32\\x.exe')
      mocks.existsSync.mockReturnValue(true)
      const entries = await scanScheduledTasks()
      expect(entries).toHaveLength(0)
    })

    it('skips tasks with empty, N/A or COM-handler Execute', async () => {
      mocks.execTracked.mockResolvedValueOnce({
        stdout: JSON.stringify([
          { TaskName: 'A', TaskPath: '\\', Execute: '' },
          { TaskName: 'B', TaskPath: '\\', Execute: 'N/A' },
          { TaskName: 'C', TaskPath: '\\', Execute: 'COM handler' },
        ]),
        stderr: '',
      })
      const entries = await scanScheduledTasks()
      expect(entries).toHaveLength(0)
    })

    it('dedupes tasks with identical TaskPath+TaskName', async () => {
      mocks.execTracked.mockResolvedValueOnce({
        stdout: JSON.stringify([
          { TaskName: 'Dup', TaskPath: '\\', Execute: 'C:\\x.exe' },
          { TaskName: 'Dup', TaskPath: '\\', Execute: 'C:\\x.exe' },
        ]),
        stderr: '',
      })
      mocks.extractExePath.mockReturnValue('C:\\x.exe')
      mocks.existsSync.mockReturnValue(false)
      const entries = await scanScheduledTasks()
      expect(entries).toHaveLength(1)
    })

    it('skips exes under c:\\windows even when missing', async () => {
      mocks.execTracked.mockResolvedValueOnce({
        stdout: JSON.stringify([{ TaskName: 'Win', TaskPath: '\\', Execute: 'C:\\Windows\\System32\\w.exe' }]),
        stderr: '',
      })
      mocks.extractExePath.mockReturnValue('C:\\Windows\\System32\\w.exe')
      mocks.existsSync.mockReturnValue(false)
      const entries = await scanScheduledTasks()
      expect(entries).toHaveLength(0)
    })

    it('skips exes that start with % (env var) when unexpanded check fails to exist', async () => {
      mocks.execTracked.mockResolvedValueOnce({
        stdout: JSON.stringify([{ TaskName: 'Env', TaskPath: '\\', Execute: '%ProgramFiles%\\x.exe' }]),
        stderr: '',
      })
      mocks.extractExePath.mockReturnValue('%ProgramFiles%\\x.exe')
      mocks.existsSync.mockReturnValue(false)
      const entries = await scanScheduledTasks()
      expect(entries).toHaveLength(0)
    })

    it('skips tasks whose exe has no backslash (no path to validate)', async () => {
      mocks.execTracked.mockResolvedValueOnce({
        stdout: JSON.stringify([{ TaskName: 'NoSlash', TaskPath: '\\', Execute: 'notepad.exe' }]),
        stderr: '',
      })
      mocks.extractExePath.mockReturnValue('notepad.exe')
      const entries = await scanScheduledTasks()
      expect(entries).toHaveLength(0)
    })

    it('returns [] when powershell query throws', async () => {
      mocks.execTracked.mockRejectedValueOnce(new Error('boom'))
      mocks.execTracked.mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      const entries = await scanScheduledTasks()
      expect(entries).toEqual([])
    })

    it('handles a single-object JSON response (not an array)', async () => {
      mocks.execTracked.mockResolvedValueOnce({
        stdout: JSON.stringify({ TaskName: 'Solo', TaskPath: '\\', Execute: 'C:\\missing.exe' }),
        stderr: '',
      })
      mocks.extractExePath.mockReturnValue('C:\\missing.exe')
      mocks.existsSync.mockReturnValue(false)
      const entries = await scanScheduledTasks()
      expect(entries).toHaveLength(1)
    })

    it('passes an abort signal through to execTracked', async () => {
      const controller = new AbortController()
      mocks.execTracked.mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      mocks.execTracked.mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      await scanScheduledTasks(controller.signal)
      expect(mocks.execTracked).toHaveBeenCalledWith(
        'powershell',
        expect.any(Array),
        expect.objectContaining({ signal: controller.signal }),
      )
    })
  })

  describe('second pass — third-party update tasks', () => {
    function tasksJson(taskNames: string[]): string {
      return JSON.stringify(taskNames.map((n) => ({ TaskName: n, TaskPath: '\\', Execute: 'C:\\x.exe' })))
    }

    it('pushes an entry for a matching third-party task whose exe is missing', async () => {
      mocks.execTracked.mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      mocks.execTracked.mockResolvedValueOnce({
        stdout: tasksJson(['Adobe Acrobat Update Scheduler']),
        stderr: '',
      })
      mocks.extractExePath.mockReturnValue('C:\\gone\\AdobeARM.exe')
      mocks.existsSync.mockReturnValue(false)
      const entries = await scanScheduledTasks()
      expect(entries).toHaveLength(1)
      expect(entries[0]!.issue).toContain('Adobe Acrobat Update')
      expect(entries[0]!.valueName).toBe('Scheduled Task')
      expect(mocks.execTracked).toHaveBeenNthCalledWith(
        2,
        'powershell',
        expect.any(Array),
        expect.objectContaining({ timeout: 15000 }),
      )
    })

    it('skips third-party tasks whose exe exists', async () => {
      mocks.execTracked.mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      mocks.execTracked.mockResolvedValueOnce({
        stdout: tasksJson(['GoogleUpdate TaskMachineUA']),
        stderr: '',
      })
      mocks.extractExePath.mockReturnValue('C:\\GoogleUpdate.exe')
      mocks.existsSync.mockReturnValue(true)
      const entries = await scanScheduledTasks()
      expect(entries).toHaveLength(0)
    })

    it('matches multiple third-party patterns in one pass', async () => {
      mocks.execTracked.mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      mocks.execTracked.mockResolvedValueOnce({
        stdout: tasksJson(['CCleaner Update', 'JavaUpdateSched']),
        stderr: '',
      })
      mocks.extractExePath.mockReturnValue('C:\\gone\\x.exe')
      mocks.existsSync.mockReturnValue(false)
      const entries = await scanScheduledTasks()
      expect(entries).toHaveLength(2)
    })

    it('returns [] when the third-party pass throws', async () => {
      mocks.execTracked.mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      mocks.execTracked.mockRejectedValueOnce(new Error('boom'))
      const entries = await scanScheduledTasks()
      expect(entries).toEqual([])
    })
  })
})
