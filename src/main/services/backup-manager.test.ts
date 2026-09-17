import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = {
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  statSync: vi.fn(),
  join: vi.fn(),
  basename: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:\\Users\\tester\\AppData\\Roaming\\DiNho-Dev') },
}))

vi.mock('node:fs', () => ({
  existsSync: (...a: unknown[]) => mocks.existsSync(...a),
  mkdirSync: (...a: unknown[]) => mocks.mkdirSync(...a),
  readdirSync: (...a: unknown[]) => mocks.readdirSync(...a),
  readFileSync: (...a: unknown[]) => mocks.readFileSync(...a),
  writeFileSync: (...a: unknown[]) => mocks.writeFileSync(...a),
  statSync: (...a: unknown[]) => mocks.statSync(...a),
}))

vi.mock('node:path', () => ({
  join: (...a: unknown[]) => mocks.join(...a),
  basename: (...a: unknown[]) => mocks.basename(...a),
  resolve: (...a: unknown[]) => mocks.join(...a),
  isAbsolute: (p: string) => /^[A-Za-z]:[\\/]/.test(p),
  relative: () => 'x',
}))

vi.mock('node:os', () => ({
  homedir: vi.fn(() => 'C:\\Users\\tester'),
}))

vi.mock('./settings-store', () => ({
  getSettings: vi.fn(() => ({ backupPath: '' })),
}))

vi.mock('./logger.service', () => ({
  getLogger: vi.fn(() => ({
    info: (...a: unknown[]) => mocks.info(...a),
    warning: (...a: unknown[]) => mocks.warning(...a),
  })),
}))

import type { basename, join } from 'node:path'
import { backupFile, getLatestBackup, initBackupManager } from './backup-manager'
import { getSettings } from './settings-store'

describe('backup-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.join.mockImplementation(((...parts: string[]) => parts.join('\\')) as typeof join)
    mocks.basename.mockImplementation(((p: string) => p.split(/[\\/]/).pop() ?? '') as typeof basename)
    mocks.statSync.mockReturnValue({ isFile: () => true, size: 100 } as any)
    vi.mocked(getSettings).mockReturnValue({ backupPath: '' } as ReturnType<typeof getSettings>)
  })

  describe('initBackupManager', () => {
    it('creates the default Documents backup directory', () => {
      initBackupManager()
      expect(mocks.mkdirSync).toHaveBeenCalledWith('C:\\Users\\tester\\Documents\\DiNho Optimizer Backups', {
        recursive: true,
      })
    })

    it('honors a user-configured backup path via getBackupDir', () => {
      vi.mocked(getSettings).mockReturnValue({ backupPath: 'D:\\MyBackups' } as ReturnType<typeof getSettings>)
      initBackupManager()
      expect(mocks.mkdirSync).toHaveBeenCalledWith('D:\\MyBackups', { recursive: true })
      vi.mocked(getSettings).mockReturnValue({ backupPath: '' } as ReturnType<typeof getSettings>)
      initBackupManager()
    })
  })

  describe('backupFile', () => {
    it('returns null when the source file does not exist', () => {
      mocks.existsSync.mockReturnValue(false)
      expect(backupFile('C:\\src\\missing.txt')).toBeNull()
      expect(mocks.writeFileSync).not.toHaveBeenCalled()
    })

    it('writes a timestamped backup and returns its path', () => {
      mocks.existsSync.mockReturnValue(true)
      mocks.readFileSync.mockReturnValue(Buffer.from('data'))
      mocks.join.mockImplementation(((...parts: string[]) => parts.join('\\')) as typeof join)
      const result = backupFile('C:\\src\\file.txt')
      expect(mocks.readFileSync).toHaveBeenCalledWith('C:\\src\\file.txt')
      expect(mocks.writeFileSync).toHaveBeenCalled()
      expect(result).toContain('C:\\Users\\tester\\Documents\\DiNho Optimizer Backups')
      expect(result).toMatch(/\.bak$/)
      expect(mocks.info).toHaveBeenCalled()
    })

    it('sanitizes drive colons in the backup name', () => {
      mocks.existsSync.mockReturnValue(true)
      mocks.readFileSync.mockReturnValue(Buffer.from('data'))
      const result = backupFile('C:\\src\\file.txt')
      expect(result).toContain('C_src_file.txt_')
    })

    it('returns null and logs a warning when the write fails', () => {
      mocks.existsSync.mockReturnValue(true)
      mocks.readFileSync.mockReturnValue(Buffer.from('data'))
      mocks.writeFileSync.mockImplementation(() => {
        throw new Error('EACCES')
      })
      expect(backupFile('C:\\src\\file.txt')).toBeNull()
      expect(mocks.warning).toHaveBeenCalled()
    })
  })

  describe('getLatestBackup', () => {
    it('returns null when backupDir was never initialized', () => {
      // backupDir is undefined before initBackupManager — readdir never runs
      mocks.existsSync.mockReturnValue(true)
      expect(getLatestBackup('C:\\src\\file.txt')).toBeNull()
    })

    it('returns null when the backup dir does not exist', () => {
      initBackupManager()
      mocks.existsSync.mockReturnValue(false)
      expect(getLatestBackup('C:\\src\\file.txt')).toBeNull()
    })

    it('returns the newest matching backup file', () => {
      initBackupManager()
      mocks.existsSync.mockReturnValue(true)
      mocks.readdirSync.mockReturnValue(['C_src_file.txt_1.bak', 'C_src_file.txt_2.bak', 'C_src_file.txt_3.bak'])
      const result = getLatestBackup('C:\\src\\file.txt')
      expect(result).toBe('C:\\Users\\tester\\Documents\\DiNho Optimizer Backups\\C_src_file.txt_3.bak')
    })

    it('filters out non-matching and non-.bak files', () => {
      initBackupManager()
      mocks.existsSync.mockReturnValue(true)
      mocks.readdirSync.mockReturnValue(['C_src_file.txt_1.bak', 'other.txt.bak', 'C_src_other.txt.bak', 'readme'])
      const result = getLatestBackup('C:\\src\\file.txt')
      expect(result).toContain('C_src_file.txt_1.bak')
    })

    it('skips zero-size backups when resolving the latest', () => {
      initBackupManager()
      mocks.existsSync.mockReturnValue(true)
      mocks.readdirSync.mockReturnValue(['C_src_file.txt_2.bak', 'C_src_file.txt_1.bak'])
      mocks.statSync
        .mockImplementationOnce(() => ({ isFile: () => true, size: 0 }) as any)
        .mockImplementationOnce(() => ({ isFile: () => true, size: 512 }) as any)
      const result = getLatestBackup('C:\\src\\file.txt')
      expect(result).toBe('C:\\Users\\tester\\Documents\\DiNho Optimizer Backups\\C_src_file.txt_1.bak')
    })

    it('returns null when all backups are empty or corrupt', () => {
      initBackupManager()
      mocks.existsSync.mockReturnValue(true)
      mocks.readdirSync.mockReturnValue(['C_src_file.txt_2.bak', 'C_src_file.txt_1.bak'])
      mocks.statSync.mockImplementation(() => {
        throw new Error('EACCES')
      })
      expect(getLatestBackup('C:\\src\\file.txt')).toBeNull()
    })

    it('returns null when no backups match', () => {
      initBackupManager()
      mocks.existsSync.mockReturnValue(true)
      mocks.readdirSync.mockReturnValue(['C__src_other.txt_1.bak'])
      expect(getLatestBackup('C:\\src\\file.txt')).toBeNull()
    })

    it('returns null when readdirSync throws', () => {
      initBackupManager()
      mocks.existsSync.mockReturnValue(true)
      mocks.readdirSync.mockImplementation(() => {
        throw new Error('EACCES')
      })
      expect(getLatestBackup('C:\\src\\file.txt')).toBeNull()
    })
  })
})
