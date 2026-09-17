import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { cliLog, cliOut, log } from '../utils'

export async function handleConfig(args: string[], ctx: CliContext): Promise<number | undefined> {
  const sub = args[0]
  const { getSettings, setSettings, flushSettings } = await import('../../services/settings-store')

  if (sub === 'get') {
    const key = args[1]
    const settings = getSettings() as unknown as Record<string, unknown>
    if (!key) {
      cliOut(ctx, settings)
      return
    }
    const value = key.split('.').reduce((obj: unknown, k: string) => (obj as Record<string, unknown>)?.[k], settings)
    if (value === undefined) {
      if (ctx.json) cliOut(ctx, { error: 'unknown_setting', key })
      else log(`Unknown setting: ${key}`)
      return ExitCode.INVALID_ARGS
    }
    cliOut(ctx, ctx.json ? { [key]: value } : `  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
  } else if (sub === 'set') {
    const key = args[1]
    const rawValue = args.slice(2).join(' ')
    if (!key || !rawValue) {
      if (ctx.json) {
        cliOut(ctx, { error: 'invalid_usage', usage: 'config set <key> <value>' })
      } else {
        cliLog(ctx, 'Usage: dinho --cli config set <key> <value>')
      }
      return ExitCode.INVALID_ARGS
    }
    let value: unknown = rawValue
    try {
      value = JSON.parse(rawValue)
    } catch {
      if (rawValue === 'true') value = true
      else if (rawValue === 'false') value = false
      else if (/^\d+$/.test(rawValue)) value = Number.parseInt(rawValue, 10)
    }
    const parts = key.split('.')
    const obj: Record<string, unknown> = {}
    let cursor = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const next: Record<string, unknown> = {}
      cursor[parts[i]!] = next
      cursor = next
    }
    cursor[parts[parts.length - 1]!] = value
    setSettings(obj as Record<string, unknown>)
    await flushSettings()
    if (!ctx.json) cliLog(ctx, `  Set ${key} = ${typeof value === 'string' && key.includes('apiKey') ? '****' : value}`)
    else cliOut(ctx, { success: true, key, value: key.includes('apiKey') ? '****' : value })
  } else {
    if (ctx.json) {
      cliOut(ctx, { error: 'invalid_usage', usage: 'config <get|set> [key] [value]' })
    } else {
      cliLog(ctx, 'Usage: dinho --cli config <get|set> [key] [value]')
      cliLog(ctx, '')
      cliLog(ctx, 'Examples:')
      cliLog(ctx, '  dinho --cli config get                        Show all settings')
    }
    return ExitCode.INVALID_ARGS
  }
}
