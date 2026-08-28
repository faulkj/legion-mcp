// Smoke test: boot bin/server.js over stdio from a config-less cwd and list tools.
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const
   server = process.argv[2] ?? join(import.meta.dirname, '..', 'bin', 'server.js'),
   cwd = mkdtempSync(join(tmpdir(), 'legion-smoke-')),
   child = spawn(process.execPath, [server], { cwd, env: { ...process.env, MCP_TRANSPORT: 'stdio', ...JSON.parse(process.argv[3] ?? '{}') }, stdio: ['pipe', 'pipe', 'inherit'] }),
   send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n')

let buf = ''
const timer = setTimeout(() => { console.error('TIMEOUT'); child.kill(); process.exit(1) }, 15000)

child.stdout.on('data', (d) => {
   buf += d.toString()
   let idx
   while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      const msg = JSON.parse(line)
      if (msg.id === 1) {
         send({ jsonrpc: '2.0', method: 'notifications/initialized' })
         send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      }
      if (msg.id === 2) {
         clearTimeout(timer)
         const tools = msg.result?.tools ?? []
         console.log(`TOOLS (${tools.length}):`, tools.map(t => t.name).join(', '))
         child.kill()
         process.exit(msg.error ? 1 : 0)
      }
   }
})
child.on('exit', (code) => { if (code) { console.error(`SERVER EXITED ${code}`); process.exit(code) } })

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } })
