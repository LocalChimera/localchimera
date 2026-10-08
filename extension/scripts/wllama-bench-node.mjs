// Bench wllama (llama.cpp→WASM) in Node by shimming the browser bits the wrapper needs.
import wt from 'node:worker_threads'
import { readFileSync } from 'node:fs'

globalThis.self = globalThis
self.location = { href: 'file:///tmp/wllama-bench.mjs' }

// Capture the embedded worker source when the lib does URL.createObjectURL(new Blob([code]))
const RealBlob = globalThis.Blob
const blobSrc = new WeakMap()
globalThis.Blob = class extends RealBlob {
  constructor(parts, opts) {
    super(parts, opts)
    if (Array.isArray(parts) && parts.length === 1 && typeof parts[0] === 'string') blobSrc.set(this, parts[0])
  }
}
const origCreate = URL.createObjectURL.bind(URL)
const blobStore = new Map()
let blobId = 0
URL.createObjectURL = (b) => {
  const src = blobSrc.get(b)
  if (src !== undefined) { blobStore.set(++blobId, src); return `wllama-blob:${blobId}` }
  return origCreate(b)
}
URL.revokeObjectURL = () => {}

// Worker shim: browser-style onmessage API over node worker_threads
globalThis.Worker = class extends wt.Worker {
  constructor(url, opts) {
    const m = String(url).match(/^wllama-blob:(\d+)$/)
    if (!m) throw new Error('unexpected worker URL ' + url)
    const code = `
      const wt = require('node:worker_threads');
      globalThis.self = globalThis;
      globalThis.postMessage = (d, t) => wt.parentPort.postMessage(d, t);
      wt.parentPort.on('message', (data) => globalThis.onmessage?.({ data }));
    ` + blobStore.get(+m[1])
    super(code, { eval: true }) // worker code is CJS (emscripten uses require)
    this.on('message', (data) => {
      if (data?.verb?.startsWith("console")) console.error("[w]", JSON.stringify(data.args).slice(0,200)); else
        console.error('[worker]', JSON.stringify(data).slice(0, 400))
      this.onmessage?.({ data })
    })
    this.on('error', (e) => this.onerror?.(e))
    this.on('exit', (c) => this.onexit?.(c))
  }
}

const { Wllama } = await import('@wllama/wllama/esm/index.js')
const quiet = { debug() {}, log() {}, warn() {}, error: console.error }
const extDir = process.env.HOME + '/Documents/docker/localchimera/extension'
const compatDir = extDir + '/node_modules/@wllama/wllama-compat/wasm'
const w = new Wllama(
  { default: 'file://' + extDir + '/node_modules/@wllama/wllama/esm/wasm/wllama.wasm' },
  { logger: quiet, cacheManager: {} })
w.setCompat({ worker: { code: readFileSync(compatDir + '/wllama.js', 'utf8') }, wasm: 'file://' + compatDir + '/wllama.wasm' })

const t0 = performance.now()
const gguf = extDir.replace(/extension$/, 'x') // placeholder
const modelPath = process.env.HOME + '/.ollama/models/blobs/sha256-c5396e06af294bd101b30dce59131a76d2b773e76950acc870eda801d3ab0515'
const blob = new RealBlob([readFileSync(modelPath)])
await w.loadModel([blob], { n_ctx: 1024, n_threads: 1 })
console.log('load:', Math.round(performance.now() - t0), 'ms')
const lats = []
for (let i = 0; i < 5; i++) {
  const t = performance.now()
  const r = await w.createCompletion({ prompt: 'Say hi in 3 words', max_tokens: 8, temperature: 0, stream: false })
  lats.push(Math.round(performance.now() - t))
  if (i === 0) console.log('output:', JSON.stringify(r.choices?.[0]?.text ?? r))
}
console.log('latencies:', lats.join(','), '→ p50', lats.sort((a, b) => a - b)[2], 'ms')
process.exit(0)
