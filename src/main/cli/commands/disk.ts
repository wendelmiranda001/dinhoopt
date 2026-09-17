import type { DiskNode } from '@shared/types'
import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { cliLog, cliOut, cliUsage, formatBytes } from '../utils'

export async function handleDisk(args: string[], ctx: CliContext): Promise<number | undefined> {
  const sub = args[0]
  const { getDrives, analyzeDisk, getFileTypes } = await import('../../ipc/disk-analyzer.ipc')

  if (sub === 'drives') {
    const drives = await getDrives()
    if (ctx.json) {
      cliOut(ctx, drives)
    } else {
      for (const d of drives)
        cliLog(
          ctx,
          `  ${d.letter}: ${d.label || 'Local Disk'} — ${formatBytes(d.usedSpace)} / ${formatBytes(d.totalSize)} (${((d.usedSpace / d.totalSize) * 100).toFixed(1)}% used)`,
        )
    }
  } else if (sub === 'analyze') {
    const drive = args[1]?.replace(':', '')
    if (!drive) {
      cliUsage(ctx, 'dinho --cli disk analyze <drive-letter>')
      return ExitCode.INVALID_ARGS
    }
    cliLog(ctx, `Analyzing drive ${drive}:...`)
    const tree = await analyzeDisk(drive)
    if (ctx.json) {
      cliOut(ctx, tree)
    } else {
      const printNode = (node: DiskNode, depth: number): void => {
        if (depth > 2) return
        cliLog(ctx, `${'  '.repeat(depth + 1)}${node.name} — ${formatBytes(node.size)}`)
        if (node.children) for (const child of node.children.slice(0, 10)) printNode(child, depth + 1)
      }
      printNode(tree, 0)
    }
  } else if (sub === 'file-types') {
    const drive = args[1]?.replace(':', '')
    if (!drive) {
      cliUsage(ctx, 'dinho --cli disk file-types <drive-letter>')
      return ExitCode.INVALID_ARGS
    }
    cliLog(ctx, `Analyzing file types on ${drive}:...`)
    const types = await getFileTypes(drive)
    if (ctx.json) {
      cliOut(ctx, types)
    } else {
      for (const t of types) cliLog(ctx, `  ${t.extension}: ${t.fileCount} files, ${formatBytes(t.totalSize)}`)
    }
  } else {
    cliUsage(ctx, 'dinho --cli disk <drives|analyze|file-types> [drive-letter]')
    return ExitCode.INVALID_ARGS
  }
}
