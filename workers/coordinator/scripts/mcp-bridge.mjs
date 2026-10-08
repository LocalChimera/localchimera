#!/usr/bin/env node
/**
 * mcp-bridge.mjs — stdio↔HTTP MCP bridge for the coordinator.
 *
 * Agent CLIs (Claude Code, MCP clients that speak stdio JSON-RPC) can expose
 * the coordinator's /mcp endpoints as a local MCP server:
 *
 *   { "mcpServers": { "chimera": {
 *       "command": "node", "args": ["mcp-bridge.mjs"],
 *       "env": { "COORDINATOR": "https://...", "DISPATCH_TOKEN": "..." } } } }
 *
 * Implements initialize, tools/list (proxied to /mcp/tools), tools/call
 * (proxied to /mcp/call), and ping. Everything else errors per JSON-RPC.
 */
const COORD = (process.env.COORDINATOR || 'http://localhost:8787').replace(/\/$/, '')
const TOKEN = process.env.DISPATCH_TOKEN || ''

const headers = () => ({
  'content-type': 'application/json',
  ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
})

let buffer = ''
process.stdin.on('data', (d) => { buffer += d; drain() })
process.stdin.on('end', () => process.exit(0))
process.stdin.resume()
process.stdin.setEncoding('utf8')

function drain() {
  let idx
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (line) handle(line)
  }
}

function reply(id, result) {
  if (id === undefined) return
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}
function fail(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

async function handle(line) {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  const { id, method, params } = msg
  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'chimera-mcp-bridge', version: '1.0.0' },
        })
      case 'notifications/initialized':
        return // no response
      case 'ping':
        return reply(id, {})
      case 'tools/list': {
        const r = await fetch(`${COORD}/mcp/tools`, { headers: headers() })
        return reply(id, await r.json())
      }
      case 'tools/call': {
        const r = await fetch(`${COORD}/mcp/call`, {
          method: 'POST', headers: headers(),
          body: JSON.stringify(params),
        })
        return reply(id, await r.json())
      }
      default:
        if (id !== undefined) return fail(id, -32601, `method not found: ${method}`)
    }
  } catch (e) {
    if (id !== undefined) fail(id, -32603, String(e))
  }
}
