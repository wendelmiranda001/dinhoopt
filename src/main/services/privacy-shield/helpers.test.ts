import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const execNativeUtf8Mock = vi.fn()
  const existsSyncMock = vi.fn<(path: string) => boolean>()
  const writeFileSyncMock = vi.fn()
  return {
    execNativeUtf8Mock,
    existsSyncMock,
    writeFileSyncMock,
  }
})

vi.mock('node:fs', () => ({
  existsSync: mocks.existsSyncMock,
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: mocks.writeFileSyncMock,
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => 'C:\\MockUserData',
  },
}))

vi.mock('../exec-utf8', () => ({
  execNativeUtf8: (...args: unknown[]) => mocks.execNativeUtf8Mock(...args),
}))

import { disableService, enableService } from './helpers'

const SERVICE_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\'

function regAddCalls(): unknown[][] {
  return mocks.execNativeUtf8Mock.mock.calls.filter(
    (c) => (c[0] as string) === 'reg' && (c[1] as string[])[0] === 'add',
  )
}

beforeEach(() => {
  mocks.execNativeUtf8Mock.mockReset()
  mocks.existsSyncMock.mockReset()
  mocks.writeFileSyncMock.mockReset()
  mocks.existsSyncMock.mockReturnValue(true)
  mocks.execNativeUtf8Mock.mockRejectedValue(new Error('Not found'))
})

describe('disableService', () => {
  it('throws when the service key does not exist instead of creating a phantom key', async () => {
    await expect(disableService('NoSuchService')).rejects.toThrow("Service 'NoSuchService' does not exist")

    const addCalls = regAddCalls()
    expect(addCalls).toHaveLength(0)
    expect(mocks.writeFileSyncMock).not.toHaveBeenCalled()
  })

  it('writes Start=4 only after confirming the service exists', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query') {
        return { stdout: '    Start    REG_DWORD    0x3', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    await expect(disableService('DiagTrack')).resolves.toBeUndefined()
    expect(regAddCalls()[0]![1]).toEqual([
      'add',
      `${SERVICE_KEY}DiagTrack`,
      '/v',
      'Start',
      '/t',
      'REG_DWORD',
      '/d',
      '4',
      '/f',
    ])
  })
})

describe('enableService', () => {
  it('throws when the service key does not exist instead of restoring a phantom key', async () => {
    await expect(enableService('NoSuchService')).rejects.toThrow("Service 'NoSuchService' does not exist")

    const addCalls = regAddCalls()
    expect(addCalls).toHaveLength(0)
  })

  it('restores the cached original start value without re-querying when restored twice', async () => {
    mocks.execNativeUtf8Mock.mockImplementation(async (tool: string, args: string[]) => {
      if (tool === 'reg' && args[0] === 'query') {
        return { stdout: '    Start    REG_DWORD    0x2', stderr: '' }
      }
      if (tool === 'reg' && args[0] === 'add') {
        return { stdout: '', stderr: '' }
      }
      throw new Error('Unexpected')
    })

    await disableService('CacheOnlyService')
    const callsBefore = regAddCalls().length

    await expect(enableService('CacheOnlyService')).resolves.toBeUndefined()
    expect(regAddCalls()).toHaveLength(callsBefore + 1)
    expect(regAddCalls().at(-1)![1]).toEqual([
      'add',
      `${SERVICE_KEY}CacheOnlyService`,
      '/v',
      'Start',
      '/t',
      'REG_DWORD',
      '/d',
      '2',
      '/f',
    ])
  })
})
