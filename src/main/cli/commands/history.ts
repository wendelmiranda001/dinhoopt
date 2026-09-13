import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { cliLog, cliOut, cliUsage, formatBytes } from '../utils'

export async function handleHistory(args: string[], ctx: CliContext): Promise<number | undefined> {
  const sub = args[0]
  const { getHistory, clearHistory } = await import('../../services/history-store')

  if (sub === 'list') {
    const history = getHistory()
    if (history.length === 0) {
      cliOut(ctx, ctx.json ? { message: 'No scan history' } : 'No scan history.')
      return ExitCode.NOTHING_FOUND
    }
    if (ctx.json) {
      cliOut(ctx, history)
    } else {
      for (const entry of history) {
        cliLog(
          ctx,
          `  [${entry.timestamp}] ${entry.type} — ${entry.totalItemsCleaned} items cleaned, ${formatBytes(entry.totalSpaceSaved)} saved`,
        )
      }
    }
    return ExitCode.SUCCESS
  } else if (sub === 'clear') {
    clearHistory()
    cliOut(ctx, ctx.json ? { message: 'History cleared' } : 'Scan history cleared.')
    return ExitCode.SUCCESS
  } else {
    cliUsage(ctx, 'dinho --cli history <list|clear>')
    return ExitCode.INVALID_ARGS
  }
}
