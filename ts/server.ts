#!/usr/bin/env node

import { createMcpExpressApp } from '@modelcontextprotocol/express'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { banner, log } from './core/log.js'
import { bootstrap } from './bootstrap.js'

const
   { config, models, createServer, probe, jobs } = (() => {
      try { return bootstrap() }
      catch (e) {
         console.error(`✖ Fatal: ${e instanceof Error ? e.message : String(e)}`)
         process.exit(1)
      }
   })(),
   displayHost = (host: string): string => host === '127.0.0.1' ? 'localhost' : host,
   shutdown = (close: () => Promise<void> = async () => {}): void => {
      let once = false
      const handler = async () => {
         if (once) return
         once = true
         log('info', `🛑 shutting down${jobs ? ` — draining ${jobs.counts().active} job(s), up to ${config.jobLimits.shutdownGraceMs / 1000}s` : ''}`)
         await jobs?.shutdown()
         await close()
         process.exit(0)
      }
      process.on('SIGINT', handler)
      process.on('SIGTERM', handler)
   }

if (config.transport === 'http') {
   const
      // 'sse' (not the 'auto' default) so the stream — and its keepalive frames — start immediately: 'auto' only upgrades once a
      // notification is emitted, which never happens for a caller that sends no progressToken, leaving a long council silent.
      handler = createMcpHandler(createServer, { responseMode: 'sse' }),
      node = toNodeHandler(handler),
      app = createMcpExpressApp({
         host: config.host,
         ...(config.allowedHosts === undefined ? {} : { allowedHosts: config.allowedHosts })
      })

   app.get('/health', async (req, res) => {
      if (req.query.deep === undefined)
         return void res.json({ status: 'ok', name: config.name, version: config.version, models: models.length, ...(jobs ? { jobs: jobs.counts() } : {}) })
      const report = await probe()
      res.status(report.status === 'ok' ? 200 : 503).json(report)
   })
   app.all('/mcp', (req, res) => void node(req, res, req.body))

   app.listen(config.port, config.host, () => {
      banner(`🌐 ${config.name} v${config.version} listening on http://${displayHost(config.host)}:${config.port}/mcp`)
      log('info', '🚀 transport: http')
      log('info', `🧩 models loaded: ${models.length}`)
      jobs && log('info', `🧵 async tools: on (max ${config.jobLimits.maxActive} active, retain ${config.jobLimits.retainMs / 60_000} min${config.trustProxyAuth ? ', proxy auth trusted' : ''})`)
   })

   shutdown(() => handler.close())
} else {
   void serveStdio(createServer)
   banner(`⚡ ${config.name} v${config.version} running`)
   log('info', '🚀 transport: stdio')
   log('info', `🧩 models loaded: ${models.length}`)
   jobs && log('info', `🧵 async tools: on (max ${config.jobLimits.maxActive} active)`)
   shutdown()
}
