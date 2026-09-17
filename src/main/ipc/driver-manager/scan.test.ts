import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveLabel } from './scan'

vi.mock('../../services/exec-utf8', () => ({
  execFileAsync: vi.fn(),
  execNativeUtf8: vi.fn(),
  psArgs: vi.fn((script: string) => ['-NoProfile', '-Command', script]),
}))

vi.mock('../../services/logger.service', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  }),
}))

describe('resolveLabel', () => {
  it('resolves English labels', () => {
    expect(resolveLabel('Published Name')).toBe('published name')
    expect(resolveLabel('Original Name')).toBe('original name')
    expect(resolveLabel('Driver Package Provider')).toBe('driver package provider')
    expect(resolveLabel('Class Name')).toBe('class name')
    expect(resolveLabel('Driver Version')).toBe('driver version')
    expect(resolveLabel('Driver Date')).toBe('driver date')
    expect(resolveLabel('Driver Date and Version')).toBe('driver date and version')
    expect(resolveLabel('Signer Name')).toBe('signer name')
  })

  it('resolves Portuguese (PT-BR) labels', () => {
    expect(resolveLabel('Nome Publicado')).toBe('published name')
    expect(resolveLabel('Nome Original')).toBe('original name')
    expect(resolveLabel('Nome do Provedor')).toBe('driver package provider')
    expect(resolveLabel('Nome da Classe')).toBe('class name')
    expect(resolveLabel('Versão do Driver')).toBe('driver version')
    expect(resolveLabel('Nome do Signatário')).toBe('signer name')
    expect(resolveLabel('Atributos')).toBe('attributes')
  })

  it('resolves German labels', () => {
    expect(resolveLabel('Veröffentlichter Name')).toBe('published name')
    expect(resolveLabel('Ursprünglicher Name')).toBe('original name')
    expect(resolveLabel('Treiberdatum')).toBe('driver date')
  })

  it('resolves French labels', () => {
    expect(resolveLabel('Nom publié')).toBe('published name')
    expect(resolveLabel('Nom original')).toBe('original name')
    expect(resolveLabel('Nom du signataire')).toBe('signer name')
  })

  it('resolves Spanish labels', () => {
    expect(resolveLabel('Nombre publicado')).toBe('published name')
    expect(resolveLabel('Nombre original')).toBe('original name')
    expect(resolveLabel('Versión del controlador')).toBe('driver version')
    expect(resolveLabel('Fecha del controlador')).toBe('driver date')
  })

  it('resolves case-insensitively', () => {
    expect(resolveLabel('NOME PUBLICADO')).toBe('published name')
    expect(resolveLabel('published name')).toBe('published name')
  })

  it('returns null for unknown labels', () => {
    expect(resolveLabel('Completely Unknown Label')).toBeNull()
    expect(resolveLabel('')).toBeNull()
  })
})

describe('parseEnumDriversPnpUtil (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses Portuguese pnputil output correctly', async () => {
    const ptOutput = `
Nome Publicado:     oem0.inf
Nome Original:      haswellesystem.inf
Nome do Provedor:      INTEL
Nome da Classe:         System
GUID de Classe:         {4d36e97d-e325-11ce-bfc1-08002be10318}
Versão do Driver:     01/26/2016 10.1.2.19
Nome do Signatário:        Microsoft Windows Hardware Compatibility Publisher
Atributos:         Legacy

Nome Publicado:     oem18.inf
Nome Original:      droidcamaudio.inf
Nome do Provedor:      DEV47APPS
Nome da Classe:         MEDIA
GUID de Classe:         {4d36e96c-e325-11ce-bfc1-08002be10318}
Versão do Driver:     06/22/2022 11.34.27.91
Nome do Signatário:        Microsoft Windows Hardware Compatibility Publisher
Atributos:         Universal
`
    const { execNativeUtf8 } = await import('../../services/exec-utf8')
    vi.mocked(execNativeUtf8).mockResolvedValueOnce({ stdout: ptOutput, stderr: '' })

    const { scanDrivers } = await import('./scan')
    const result = await scanDrivers()

    expect(result.packages.length).toBe(2)
    expect(result.packages[0]!.publishedName).toBe('oem0.inf')
    expect(result.packages[0]!.originalName).toBe('haswellesystem.inf')
    expect(result.packages[0]!.provider).toBe('INTEL')
    expect(result.packages[0]!.className).toBe('System')
    expect(result.packages[0]!.version).toBe('10.1.2.19')
    expect(result.packages[0]!.date).toBe('01/26/2016')
    expect(result.packages[0]!.signer).toBe('Microsoft Windows Hardware Compatibility Publisher')

    expect(result.packages[1]!.publishedName).toBe('oem18.inf')
    expect(result.packages[1]!.provider).toBe('DEV47APPS')
    expect(result.packages[1]!.className).toBe('MEDIA')
  })

  it('parses English pnputil output correctly', async () => {
    const enOutput = `
Published Name:     oem0.inf
Original Name:      haswellesystem.inf
Driver Package Provider:      INTEL
Class Name:         System
Driver Version:     10.1.2.19
Driver Date:        01/26/2016
Signer Name:        Microsoft Windows Hardware Compatibility Publisher
Attributes:         Legacy
`
    const { execNativeUtf8 } = await import('../../services/exec-utf8')
    vi.mocked(execNativeUtf8).mockResolvedValueOnce({ stdout: enOutput, stderr: '' })

    const { scanDrivers } = await import('./scan')
    const result = await scanDrivers()

    expect(result.packages.length).toBe(1)
    expect(result.packages[0]!.publishedName).toBe('oem0.inf')
    expect(result.packages[0]!.provider).toBe('INTEL')
  })

  it('parses combined date+version field', async () => {
    const output = `
Nome Publicado:     oem5.inf
Nome Original:      test.inf
Nome do Provedor:      TestProvider
Nome da Classe:         DISPLAY
Versão do Driver:     2024-01-15 31.0.15.5135
Nome do Signatário:        NVIDIA
Atributos:         Legacy
`
    const { execNativeUtf8 } = await import('../../services/exec-utf8')
    vi.mocked(execNativeUtf8).mockResolvedValueOnce({ stdout: output, stderr: '' })

    const { scanDrivers } = await import('./scan')
    const result = await scanDrivers()

    expect(result.packages.length).toBe(1)
    expect(result.packages[0]!.version).toBe('31.0.15.5135')
    expect(result.packages[0]!.date).toBe('2024-01-15')
  })

  it('skips non-oem entries', async () => {
    const output = `
Published Name:     somefile.txt
Original Name:      test.inf
Driver Package Provider:      TestProvider
Class Name:         System
Driver Version:     1.0.0
`
    const { execNativeUtf8 } = await import('../../services/exec-utf8')
    vi.mocked(execNativeUtf8).mockResolvedValueOnce({ stdout: output, stderr: '' })

    const { scanDrivers } = await import('./scan')
    const result = await scanDrivers()

    expect(result.packages.length).toBe(0)
  })
})
