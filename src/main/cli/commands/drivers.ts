import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { cliLog, cliOut, cliUsage, log, showProgress } from '../utils'

export async function handleDrivers(args: string[], ctx: CliContext): Promise<number | undefined> {
  const sub = args[0]
  const { scanDrivers, cleanDrivers, scanDriverUpdates, installDriverUpdates } = await import(
    '../../ipc/driver-manager.ipc'
  )

  if (sub === 'scan') {
    cliLog(ctx, 'Scanning driver packages...')
    const result = await scanDrivers((progress) => {
      if (showProgress(ctx)) process.stdout.write(`\r  ${progress}`)
    })
    if (showProgress(ctx)) log('')
    if (ctx.json) {
      cliOut(ctx, { packages: result.packages, count: result.packages.length })
    } else {
      cliLog(ctx, `Found ${result.packages.length} driver packages`)
      for (const p of result.packages) cliLog(ctx, `  ${p.publishedName} — ${p.className} — ${p.version}`)
    }
  } else if (sub === 'clean') {
    const nameArgs = args.filter((a) => a !== 'clean' && !a.startsWith('--'))
    if (nameArgs.length === 0) {
      cliUsage(ctx, 'dinho --cli drivers clean <name1,name2,...>')
      return ExitCode.INVALID_ARGS
    }
    const names = nameArgs.flatMap((a) =>
      a
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    cliLog(ctx, `Removing ${names.length} driver packages...`)
    const result = await cleanDrivers(names)
    cliOut(ctx, result)
    return ExitCode.SUCCESS
  } else if (sub === 'check-updates') {
    cliLog(ctx, 'Checking for driver updates...')
    const updateResult = await scanDriverUpdates((progress) => {
      if (showProgress(ctx)) process.stdout.write(`\r  ${progress}`)
    })
    if (showProgress(ctx)) log('')
    if (ctx.json) {
      cliOut(ctx, { updates: updateResult.updates, count: updateResult.updates.length })
    } else {
      cliLog(ctx, `Found ${updateResult.updates.length} driver updates`)
      for (const u of updateResult.updates) cliLog(ctx, `  ${u.updateTitle}`)
    }
  } else if (sub === 'update') {
    cliLog(ctx, 'Checking for driver updates...')
    const updateResult = await scanDriverUpdates()
    if (updateResult.updates.length === 0) {
      cliOut(ctx, ctx.json ? { message: 'No updates available' } : 'Drivers are up to date.')
      return
    }
    const toInstall = args.includes('--all')
      ? updateResult.updates.map((u) => u.updateId)
      : (() => {
          const idArgs = args.filter((a) => a !== 'update' && !a.startsWith('--'))
          return idArgs.flatMap((a) =>
            a
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          )
        })()
    if (toInstall.length === 0) {
      cliUsage(ctx, 'dinho --cli drivers update <id,...> or --all')
      return ExitCode.INVALID_ARGS
    }
    cliLog(ctx, `Installing ${toInstall.length} driver updates...`)
    const result = await installDriverUpdates(toInstall, (progress) => {
      if (showProgress(ctx)) process.stdout.write(`\r  ${progress}`)
    })
    if (showProgress(ctx)) log('')
    cliOut(ctx, result)
  } else {
    cliUsage(ctx, 'dinho --cli drivers <scan|clean|check-updates|update> [names|--all]')
    return ExitCode.INVALID_ARGS
  }
}
