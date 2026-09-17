import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  existsSync: vi.fn(),
  execFile: vi.fn(),
  isAdmin: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

vi.mock('../services/elevation', () => ({
  isAdmin: () => mocks.isAdmin(),
}))

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mocks.existsSync?.(...args) ?? true,
  readFileSync: (...args: unknown[]) => mocks.readFileSync(...args),
  writeFileSync: (...args: unknown[]) => mocks.writeFileSync(...args),
  renameSync: (...args: unknown[]) => mocks.renameSync?.(...args),
}))

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mocks.execFile(...args),
}))

vi.mock('node:util', () => ({
  promisify: <T>(fn: T): T => fn,
}))

vi.mock('./sender-validation', () => ({
  validateSender: vi.fn(() => true),
}))

import { IPC } from '@shared/channels'
import type { HostsFileData, HostsWriteRequest } from '@shared/types'
import { parseHostsForTest, registerHostsEditorIpc, serializeHostsForTest } from './hosts-editor.ipc'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mocks.ipcHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

describe('parseHostsForTest', () => {
  it('parses valid entries with IP, hostname, and optional comment', () => {
    const content = '127.0.0.1 localhost\n192.168.1.1 router comment text\n'
    const result = parseHostsForTest(content)
    expect(result.entries).toHaveLength(2)
    expect(result.entries[0]).toMatchObject({ ip: '127.0.0.1', hostname: 'localhost', enabled: true })
    expect(result.entries[1]).toMatchObject({
      ip: '192.168.1.1',
      hostname: 'router',
      comment: '# comment text',
      enabled: true,
    })
  })

  it('skips empty lines', () => {
    const content = '127.0.0.1 localhost\n\n\n192.168.1.1 router\n'
    const result = parseHostsForTest(content)
    expect(result.entries).toHaveLength(2)
  })

  it('treats comment lines as header', () => {
    const content = '# This is a comment\n127.0.0.1 localhost\n# Another comment\n'
    const result = parseHostsForTest(content)
    expect(result.headerComment).toBe('# This is a comment\n# Another comment')
    expect(result.entries).toHaveLength(1)
  })

  it('handles malformed lines with fewer than 2 parts as header', () => {
    const content = '127.0.0.1 localhost\nmalformed\n'
    const result = parseHostsForTest(content)
    expect(result.headerComment).toBe('malformed')
    expect(result.entries).toHaveLength(1)
  })

  it('generates ID from hostname and ip', () => {
    const content = '127.0.0.1 localhost\n'
    const result = parseHostsForTest(content)
    expect(result.entries[0]!.id).toBe('localhost-127.0.0.1')
  })

  it('sets enabled: true for non-commented entries', () => {
    const content = '127.0.0.1 localhost\n'
    const result = parseHostsForTest(content)
    expect(result.entries[0]!.enabled).toBe(true)
  })

  it('handles Windows-style comments with semicolon', () => {
    const content = '; Windows comment\n127.0.0.1 localhost\n'
    const result = parseHostsForTest(content)
    expect(result.headerComment).toBe('; Windows comment')
    expect(result.entries).toHaveLength(1)
  })
})

describe('serializeHostsForTest', () => {
  it('serializes entries back to text', () => {
    const data: HostsWriteRequest = {
      headerComment: '',
      entries: [{ id: 'localhost-127.0.0.1', ip: '127.0.0.1', hostname: 'localhost', comment: '', enabled: true }],
    }
    const result = serializeHostsForTest(data)
    expect(result).toBe('127.0.0.1 localhost\n')
  })

  it('prepends # for disabled entries', () => {
    const data: HostsWriteRequest = {
      headerComment: '',
      entries: [{ id: 'example-0.0.0.0', ip: '0.0.0.0', hostname: 'example.com', comment: '', enabled: false }],
    }
    const result = serializeHostsForTest(data)
    expect(result).toBe('# 0.0.0.0 example.com\n')
  })

  it('includes header comment at top with blank line separator', () => {
    const data: HostsWriteRequest = {
      headerComment: '# Hosts file header',
      entries: [{ id: 'localhost-127.0.0.1', ip: '127.0.0.1', hostname: 'localhost', comment: '', enabled: true }],
    }
    const result = serializeHostsForTest(data)
    expect(result).toBe('# Hosts file header\n\n127.0.0.1 localhost\n')
  })

  it('appends newline at end of output', () => {
    const data: HostsWriteRequest = {
      headerComment: '',
      entries: [{ id: 'x-1.2.3.4', ip: '1.2.3.4', hostname: 'x', comment: '', enabled: true }],
    }
    expect(serializeHostsForTest(data).endsWith('\n')).toBe(true)
  })
})

describe('registerHostsEditorIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all 3 IPC handlers', () => {
    registerHostsEditorIpc(() => null)
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain(IPC.HOSTS_READ)
    expect(channels).toContain(IPC.HOSTS_WRITE)
    expect(channels).toContain(IPC.HOSTS_FLUSH_DNS)
    expect(channels).toHaveLength(3)
  })

  describe('HOSTS_READ handler', () => {
    it('reads and parses hosts file successfully', async () => {
      mocks.readFileSync.mockReturnValue('127.0.0.1 localhost\n')
      registerHostsEditorIpc(() => null)
      const handler = getHandler(IPC.HOSTS_READ)
      const result = (await handler()) as HostsFileData
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0]).toMatchObject({ ip: '127.0.0.1', hostname: 'localhost' })
      expect(mocks.readFileSync).toHaveBeenCalled()
    })

    it('returns empty data on read error', async () => {
      mocks.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })
      registerHostsEditorIpc(() => null)
      const handler = getHandler(IPC.HOSTS_READ)
      const result = (await handler()) as HostsFileData
      expect(result).toEqual({ headerComment: '', entries: [] })
    })
  })

  describe('HOSTS_WRITE handler', () => {
    it('returns error when not admin', async () => {
      mocks.isAdmin.mockReturnValue(false)
      registerHostsEditorIpc(() => null)
      const handler = getHandler(IPC.HOSTS_WRITE)
      const result = await handler(null, {
        headerComment: '',
        entries: [{ id: 'x', ip: '127.0.0.1', hostname: 'x', comment: '', enabled: true }],
      })
      expect(result).toEqual({ success: false, error: 'Acesso negado — execute o DiNho Optimizer como administrador.' })
    })

    it('validates entries array exists', async () => {
      mocks.isAdmin.mockReturnValue(true)
      registerHostsEditorIpc(() => null)
      const handler = getHandler(IPC.HOSTS_WRITE)
      const result = await handler(null, { headerComment: '' })
      expect(result).toEqual({ success: false, error: 'entries must be an array' })
    })

    it('validates each entry has an id', async () => {
      mocks.isAdmin.mockReturnValue(true)
      registerHostsEditorIpc(() => null)
      const handler = getHandler(IPC.HOSTS_WRITE)
      const result = await handler(null, {
        headerComment: '',
        entries: [{ ip: '127.0.0.1', hostname: 'x', comment: '', enabled: true }],
      })
      expect(result).toEqual({ success: false, error: 'Entry must have an id' })
    })

    it('validates IP format', async () => {
      mocks.isAdmin.mockReturnValue(true)
      registerHostsEditorIpc(() => null)
      const handler = getHandler(IPC.HOSTS_WRITE)
      const result = await handler(null, {
        headerComment: '',
        entries: [{ id: 'x', ip: 'invalid-ip', hostname: 'x', comment: '', enabled: true }],
      })
      expect(result).toEqual({ success: false, error: 'Invalid IP format' })
    })

    it('writes successfully with valid data', async () => {
      mocks.isAdmin.mockReturnValue(true)
      mocks.writeFileSync.mockReturnValue(undefined)
      registerHostsEditorIpc(() => null)
      const handler = getHandler(IPC.HOSTS_WRITE)
      const result = await handler(null, {
        headerComment: '',
        entries: [{ id: 'x-127.0.0.1', ip: '127.0.0.1', hostname: 'x', comment: '', enabled: true }],
      })
      expect(result).toEqual({ success: true })
      expect(mocks.writeFileSync).toHaveBeenCalled()
      expect(mocks.renameSync).toHaveBeenCalled()
    })

    it('returns error on write failure', async () => {
      mocks.isAdmin.mockReturnValue(true)
      mocks.writeFileSync.mockImplementation(() => {
        throw new Error('Access denied')
      })
      registerHostsEditorIpc(() => null)
      const handler = getHandler(IPC.HOSTS_WRITE)
      const result = await handler(null, {
        headerComment: '',
        entries: [{ id: 'x-127.0.0.1', ip: '127.0.0.1', hostname: 'x', comment: '', enabled: true }],
      })
      expect(result).toEqual({ success: false, error: 'Error: Access denied' })
    })
  })

  describe('HOSTS_FLUSH_DNS handler', () => {
    it('flushes DNS successfully', async () => {
      mocks.execFile.mockResolvedValue(undefined)
      registerHostsEditorIpc(() => null)
      const handler = getHandler(IPC.HOSTS_FLUSH_DNS)
      const result = await handler()
      expect(result).toEqual({ success: true })
      expect(mocks.execFile).toHaveBeenCalledWith('ipconfig', ['/flushdns'], { timeout: 10000, windowsHide: true })
    })

    it('returns error on flush failure', async () => {
      mocks.execFile.mockRejectedValue(new Error('Command failed'))
      registerHostsEditorIpc(() => null)
      const handler = getHandler(IPC.HOSTS_FLUSH_DNS)
      const result = await handler()
      expect(result).toEqual({ success: false, error: 'Error: Command failed' })
    })
  })
})
