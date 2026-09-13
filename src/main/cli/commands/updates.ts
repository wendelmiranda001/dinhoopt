import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { cliLog, cliOut, cliUsage } from '../utils'

export async function handleUpdates(args: string[], ctx: CliContext): Promise<number | undefined> {
  const sub = args[0]
  const { checkForUpdates, runUpdates } = await import('../../services/software-updater')

  if (sub === 'check') {
    cliLog(ctx, 'Checking for software updates...')
    const result = await checkForUpdates()
    if (ctx.json) {
      cliOut(ctx, result)
    } else {
      if (!result.packageManagerAvailable) {
        cliLog(ctx, `  ${result.packageManagerName ?? 'package manager'} is not available on this system`)
        return
      }
      cliLog(ctx, `Found ${result.apps.length} apps, ${result.apps.filter((a) => a.isUpToDate).length} up to date`)
      for (const a of result.apps)
        cliLog(ctx, `  ${a.name}: ${a.currentVersion} → ${a.availableVersion} (${a.severity})`)
    }
  } else if (sub === 'run') {
    cliLog(ctx, 'Checking for software updates...')
    const check = await checkForUpdates()
    if (check.apps.length === 0) {
      cliOut(ctx, ctx.json ? { message: 'Everything up to date' } : 'All software is up to date.')
      return
    }
    const allFlag = args.includes('--all')
    const toUpdate = allFlag
      ? check.apps.map((a) => a.id)
      : (() => {
          const idArgs = args.filter((a) => a !== 'run' && !a.startsWith('--'))
          return idArgs.flatMap((a) =>
            a
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          )
        })()
    if (toUpdate.length === 0) {
      cliUsage(ctx, 'dinho --cli updates run <id,...> or --all')
      return ExitCode.INVALID_ARGS
    }
    cliLog(ctx, `Updating ${toUpdate.length} apps...`)
    const result = await runUpdates(toUpdate, (progress) => {
      cliLog(ctx, `  [${progress.current}/${progress.total}] ${progress.currentApp}: ${progress.status}`)
    })
    cliOut(ctx, result)
    return ExitCode.SUCCESS
  } else {
    cliUsage(ctx, 'dinho --cli updates <check|run> [ids|--all]')
    return ExitCode.INVALID_ARGS
  }
}
