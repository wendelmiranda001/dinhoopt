import { app } from 'electron'
import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { cliLog, cliOut, log } from '../utils'

export async function handleMetrics(_args: string[], ctx: CliContext): Promise<number | undefined> {
  const { collectMetrics, formatPrometheus } = await import('../../services/metrics')
  const metrics = await collectMetrics()

  if (ctx.json) {
    cliOut(ctx, metrics)
  } else {
    log(formatPrometheus(metrics))
  }
  return undefined
}

export async function handleMetricsServer(args: string[], ctx: CliContext): Promise<void> {
  const http = await import('node:http')
  const { collectMetrics, formatPrometheus } = await import('../../services/metrics')

  const portIdx = args.indexOf('--port')
  const port = portIdx !== -1 ? Number.parseInt(args[portIdx + 1]!, 10) || 9100 : 9100

  const server = http.createServer(async (req, res) => {
    if (req.url === '/metrics') {
      try {
        const metrics = await collectMetrics()
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' })
        res.end(formatPrometheus(metrics))
      } catch (err: unknown) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end(`Error collecting metrics: ${err instanceof Error ? err.message : 'Unknown error'}\n`)
      }
    } else if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
    } else {
      res.writeHead(404)
      res.end('Not Found\n')
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use`))
      } else if (err.code === 'EACCES') {
        reject(new Error(`Permission denied for port ${port} (try a port >= 1024)`))
      } else {
        reject(err)
      }
    })
    server.listen(port, () => {
      cliLog(ctx, `Prometheus metrics server listening on http://0.0.0.0:${port}/metrics`)
      cliLog(ctx, 'Press Ctrl+C to stop.')
      resolve()
    })
  })

  const shutdown = (): void => {
    server.closeAllConnections()
    server.close()
    app.exit(ExitCode.SUCCESS)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  await new Promise(() => {})
}
