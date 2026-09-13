import { app } from 'electron'
import { handleConfig } from './commands/config'
import { handleCve } from './commands/cve'
import { handleDebloat } from './commands/debloat'
import { handleDisk } from './commands/disk'
import { handleDrivers } from './commands/drivers'
import { handleHistory } from './commands/history'
import { handleLeftovers } from './commands/leftovers'
import { runLegacyScanClean } from './commands/legacy'
import { handleMalware } from './commands/malware'
import { handleMetrics, handleMetricsServer } from './commands/metrics'
import { handleNetwork } from './commands/network'
import { handlePerf } from './commands/perf'
import { handlePrivacy } from './commands/privacy'
import { handlePrograms } from './commands/programs'
import { handleRegistry } from './commands/registry'
import { handleServices } from './commands/services'
import { handleStartup } from './commands/startup'
import { handleUpdates } from './commands/updates'
import type { CliContext, ParsedCliArgs } from './types'
import { ExitCode } from './types'
import { log, printHelp } from './utils'

const GLOBAL_FLAGS = new Set(['--json', '--verbose', '--quiet', '-q', '--help', '-h', '--version', '-v'])

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const cliIndex = argv.indexOf('--cli')
  const cliArgs = argv.slice(cliIndex + 1)

  const json = cliArgs.includes('--json')
  const verbose = cliArgs.includes('--verbose')
  const quiet = cliArgs.includes('--quiet') || cliArgs.includes('-q')
  const help = cliArgs.includes('--help') || cliArgs.includes('-h')
  const version = cliArgs.includes('--version') || cliArgs.includes('-v')

  const verbosity = verbose ? 'verbose' : quiet ? 'quiet' : 'normal'
  const ctx: CliContext = { json, verbosity }

  const command = cliArgs.find((a) => !a.startsWith('--') && !a.startsWith('-'))
  const commandArgs = cliArgs.filter((a) => a !== command && !GLOBAL_FLAGS.has(a))

  const legacyCats = ['system', 'browser', 'app', 'gaming', 'recycle-bin']
  const hasLegacyFlags = legacyCats.some((c) => cliArgs.includes(`--${c}`)) || cliArgs.includes('--all')
  const hasCleanFlag = cliArgs.includes('--clean')

  return { command, commandArgs, ctx, help, version, hasLegacyFlags, hasCleanFlag }
}

export async function runCli(): Promise<void> {
  const parsed = parseCliArgs(process.argv)

  if (parsed.help) {
    printHelp()
    app.exit(ExitCode.SUCCESS)
    return
  }
  if (parsed.version) {
    log(`DiNho v${app.getVersion()}`)
    app.exit(ExitCode.SUCCESS)
    return
  }

  const { ctx } = parsed

  const cliArgs = process.argv.slice(process.argv.indexOf('--cli') + 1)
  if (cliArgs.includes('--verbose') && (cliArgs.includes('--quiet') || cliArgs.includes('-q'))) {
    if (ctx.json)
      log(JSON.stringify({ error: 'invalid_args', message: '--verbose and --quiet are mutually exclusive' }))
    else process.stderr.write('Error: --verbose and --quiet are mutually exclusive.\n')
    app.exit(ExitCode.INVALID_ARGS)
    return
  }

  if (!parsed.command || parsed.command === 'scan' || parsed.command === 'clean') {
    const legacyCats = ['system', 'browser', 'app', 'gaming', 'recycle-bin']
    let categories: string[]
    if (cliArgs.includes('--all')) {
      categories = [...legacyCats]
    } else {
      categories = legacyCats.filter((c) => cliArgs.includes(`--${c}`))
      if (categories.length === 0) categories = [...legacyCats]
    }
    const doClean = parsed.hasCleanFlag || parsed.command === 'clean'
    const exitCode = await runLegacyScanClean(categories, doClean, ctx)
    app.exit(exitCode)
    return
  }

  try {
    let exitCode: number | undefined
    switch (parsed.command) {
      case 'registry':
        exitCode = await handleRegistry(parsed.commandArgs, ctx)
        break
      case 'startup':
        exitCode = await handleStartup(parsed.commandArgs, ctx)
        break
      case 'debloat':
        exitCode = await handleDebloat(parsed.commandArgs, ctx)
        break
      case 'disk':
        exitCode = await handleDisk(parsed.commandArgs, ctx)
        break
      case 'network':
        exitCode = await handleNetwork(parsed.commandArgs, ctx)
        break
      case 'malware':
        exitCode = await handleMalware(parsed.commandArgs, ctx)
        break
      case 'privacy':
        exitCode = await handlePrivacy(parsed.commandArgs, ctx)
        break
      case 'drivers':
        exitCode = await handleDrivers(parsed.commandArgs, ctx)
        break
      case 'services':
        exitCode = await handleServices(parsed.commandArgs, ctx)
        break
      case 'programs':
        exitCode = await handlePrograms(parsed.commandArgs, ctx)
        break
      case 'updates':
        exitCode = await handleUpdates(parsed.commandArgs, ctx)
        break
      case 'perf':
        exitCode = await handlePerf(parsed.commandArgs, ctx)
        break
      case 'leftovers':
        exitCode = await handleLeftovers(parsed.commandArgs, ctx)
        break
      case 'history':
        exitCode = await handleHistory(parsed.commandArgs, ctx)
        break
      case 'config':
        exitCode = await handleConfig(parsed.commandArgs, ctx)
        break
      case 'cve':
        exitCode = await handleCve(parsed.commandArgs, ctx)
        break
      case 'metrics':
        exitCode = await handleMetrics(parsed.commandArgs, ctx)
        break
      case 'metrics-server':
        await handleMetricsServer(parsed.commandArgs, ctx)
        exitCode = ExitCode.SUCCESS
        break
      default:
        if (ctx.json) log(JSON.stringify({ error: 'unknown_command', command: parsed.command }))
        else {
          log(`Unknown command: ${parsed.command}`)
          log('Run dinho --cli --help for usage information.')
        }
        app.exit(ExitCode.UNKNOWN_COMMAND)
        return
    }
    app.exit(exitCode ?? ExitCode.SUCCESS)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (ctx.json) {
      log(JSON.stringify({ error: message }))
    } else {
      process.stderr.write(`Error: ${message}\n`)
    }
    app.exit(ExitCode.GENERAL_ERROR)
  }
}
