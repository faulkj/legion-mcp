import { createMcpExpressApp } from '@modelcontextprotocol/express'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { banner, log } from './log.js'
import { bootstrap } from './server.js'

const
   { config, models, createServer } = bootstrap(),
   transport = process.argv[2] ?? 'stdio',
   displayHost = (host: string): string => host === '127.0.0.1' ? 'localhost' : host

if (transport === 'http') {
   const
      handler = createMcpHandler(createServer),
      node = toNodeHandler(handler),
      app = createMcpExpressApp({
         host: config.host,
         ...(config.allowedHosts === undefined ? {} : { allowedHosts: config.allowedHosts })
      })

   app.all('/mcp', (req, res) => void node(req, res, req.body))

   app.listen(config.port, config.host, () => {
      banner(`🌐 ${config.name} v${config.version} listening on http://${displayHost(config.host)}:${config.port}/mcp`)
      log('info', '🚀 transport: http')
      log('info', `🧩 models loaded: ${models.length}`)
   })

   process.on('SIGINT', async () => {
      await handler.close()
      process.exit(0)
   })
} else if (transport === 'stdio') {
   void serveStdio(createServer)
   banner(`⚡ ${config.name} v${config.version} running`)
   log('info', '🚀 transport: stdio')
   log('info', `🧩 models loaded: ${models.length}`)
} else {
   console.error(`Unknown transport "${transport}". Use "stdio" (default) or "http".`)
   process.exit(1)
}
