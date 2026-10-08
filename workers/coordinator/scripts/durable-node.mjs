#!/usr/bin/env node
/**
 * durable-node.mjs — persistent volunteer daemon for the swarm tier.
 *
 * Registers with the coordinator as `durable: true` claiming task types
 * 300 (SWARM_INFER) and 301 (BUILD_VERIFY), executes jobs, and returns
 * signed result proofs. Browser nodes can't claim swarm types — this is
 * the supply side for the durable pool.
 *
 * Identity: generates (or loads) an ed25519 keypair, self-encodes a
 * `did:key:z…` DID, and binds it at REGISTER with a signature over
 * `chimera-bind:<volunteerId>`. Result proofs sign
 * `chimera-result:<jobId>:<sha256(result)>`.
 *
 * Dispatch authenticity: when VERIFY_DISPATCH=1 (default) the node fetches
 * the coordinator address from /pubkey and rejects JOB_DISPATCH envelopes
 * whose EIP-191 signature over `chimera-job:<jobId>` doesn't recover to it.
 * If the coordinator has no key configured (dev mode) unsigned dispatches
 * are accepted with a warning.
 *
 * Task handlers:
 *   300 SWARM_INFER  — text-generation via @huggingface/transformers when
 *                      installed (dynamic import; honest JOB_REJECTED when
 *                      absent). Payload: {prompt, model?, maxTokens?} or a
 *                      bare prompt string.
 *   301 BUILD_VERIFY — runs a declared command in a fresh temp dir. No
 *                      shell, argv[0] must be in BUILD_ALLOWLIST, stdout/
 *                      stderr and artifacts are size-capped and sha256'd.
 *                      Payload: {cmd, args?, files?:[{name,dataBase64}],
 *                      expectExit?}.
 *
 * Env:
 *   COORDINATOR_URL    ws(s):// or http(s):// coordinator base (required)
 *   VOLUNTEER_TOKEN    WS upgrade token (required when the coordinator sets one)
 *   VOLUNTEER_ID       stable id (default durable-<host>-<pid>)
 *   KEY_FILE           ed25519 PKCS8 PEM path; created if absent
 *   SHARD_CAPACITY     max concurrent jobs (default 4)
 *   TRANSFORMERS_MODEL default HF model for 300 (default SmolLM2-135M-Instruct)
 *   BUILD_ALLOWLIST    comma-sep allowed argv[0] for 301 (default "node,npm")
 *   VERIFY_DISPATCH    "0" to skip dispatch-sig verification (default on)
 *   JOB_TIMEOUT_MS     per-job cap (default 120000)
 *   MAX_RESULT_BYTES   result cap (default 1 MiB)
 */
import { spawn } from 'node:child_process'
import { createHash, generateKeyPairSync, sign as edSign, createPrivateKey, createPublicKey } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs'
import { tmpdir, hostname, cpus, totalmem } from 'node:os'
import { join } from 'node:path'
import { verifyMessage } from 'viem'

const {
  COORDINATOR_URL = '',
  VOLUNTEER_TOKEN = '',
  VOLUNTEER_ID = `durable-${hostname()}-${process.pid}`,
  KEY_FILE = join(tmpdir(), `${VOLUNTEER_ID}-ed25519.pk8`),
  SHARD_CAPACITY = '4',
  TRANSFORMERS_MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct',
  BUILD_ALLOWLIST = 'node,npm',
  VERIFY_DISPATCH = '1',
  JOB_TIMEOUT_MS = '120000',
  MAX_RESULT_BYTES = String(1024 * 1024),
} = process.env

if (!COORDINATOR_URL) {
  console.error('COORDINATOR_URL required (e.g. http://localhost:8787 or wss://coord.example.com)')
  process.exit(2)
}

const TASK_SWARM_INFER = 300
const TASK_BUILD_VERIFY = 301
const shardCapacity = Math.max(1, parseInt(SHARD_CAPACITY, 10) || 4)
const allowlist = new Set(BUILD_ALLOWLIST.split(',').map((s) => s.trim()).filter(Boolean))

// ── Identity: ed25519 → did:key ──

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58Encode(bytes) {
  let num = 0n
  for (const b of bytes) num = num * 256n + BigInt(b)
  let enc = ''
  while (num > 0n) { enc = B58[Number(num % 58n)] + enc; num /= 58n }
  for (const b of bytes) { if (b === 0) enc = '1' + enc; else break }
  return enc
}

function loadOrCreateKey() {
  if (existsSync(KEY_FILE)) return createPrivateKey(readFileSync(KEY_FILE, 'utf8'))
  const { privateKey } = generateKeyPairSync('ed25519')
  writeFileSync(KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  return privateKey
}

const privKey = loadOrCreateKey()
const rawPub = createPublicKey(privKey).export({ type: 'spki', format: 'der' }).subarray(-32)
// multicodec ed25519-pub = 0xed01; multibase base58btc prefix = 'z'
const DID = `did:key:z${base58Encode(new Uint8Array([0xed, 0x01, ...rawPub]))}`

function signEd25519(msg) {
  return Buffer.from(edSign(null, Buffer.from(msg, 'utf8'), privKey)).toString('hex')
}

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex')

// ── Coordinator dispatch verification ──

let coordinatorAddress = null
async function fetchCoordinatorKey() {
  try {
    const base = COORDINATOR_URL.replace(/^ws/, 'http').replace(/\/$/, '')
    const res = await fetch(`${base}/pubkey`)
    if (res.ok) {
      const j = await res.json()
      coordinatorAddress = j.address || null
    }
  } catch { /* coordinator without key → dev mode */ }
  if (!coordinatorAddress) console.warn('[node] coordinator has no signing key — dispatch verify off')
}

async function verifyDispatchSig(jobId, sig) {
  if (VERIFY_DISPATCH === '0') return true
  if (!sig) return !coordinatorAddress // unsigned ok only in dev mode
  if (!coordinatorAddress) return true
  try {
    return await verifyMessage({ address: coordinatorAddress, message: `chimera-job:${jobId}`, signature: sig })
  } catch { return false }
}

// ── Task handlers ──

let inferPipeline = null
let inferModel = null
async function runInfer(payload) {
  const spec = typeof payload === 'string'
    ? { prompt: payload }
    : (typeof payload === 'object' && payload !== null ? payload : {})
  const prompt = String(spec.prompt ?? spec.input ?? '')
  if (!prompt) throw new Error('SWARM_INFER payload needs prompt')
  const model = spec.model || TRANSFORMERS_MODEL
  let tf
  try {
    tf = await import('@huggingface/transformers')
  } catch {
    throw new Error('@huggingface/transformers not installed — npm i @huggingface/transformers in the node env')
  }
  if (!inferPipeline || inferModel !== model) {
    inferPipeline = await tf.pipeline('text-generation', model, { dtype: 'q4' })
    inferModel = model
  }
  const out = await inferPipeline(prompt, {
    max_new_tokens: Math.min(Number(spec.maxTokens) || 256, 1024),
    do_sample: false,
  })
  const text = Array.isArray(out) ? out[0]?.generated_text : out?.generated_text
  const result = typeof text === 'string' ? text : String(text ?? '')
  if (!result) throw new Error('empty generation')
  return result
}

async function runBuildVerify(payload) {
  const spec = typeof payload === 'object' && payload !== null ? payload : {}
  const cmd = String(spec.cmd || '')
  if (!allowlist.has(cmd)) throw new Error(`cmd '${cmd}' not in BUILD_ALLOWLIST`)
  const args = Array.isArray(spec.args) ? spec.args.map(String) : []
  if (args.some((a) => a.includes('\0'))) throw new Error('nul byte in args')

  const workdir = join(tmpdir(), `bv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(workdir, { recursive: true })
  try {
    // Stage declared input files — names confined to the workdir.
    const inHashes = {}
    for (const f of Array.isArray(spec.files) ? spec.files.slice(0, 32) : []) {
      const name = String(f.name || '').replace(/[^A-Za-z0-9._-]/g, '_')
      if (!name || name.startsWith('.')) throw new Error(`bad file name '${f.name}'`)
      const data = Buffer.from(String(f.dataBase64 || ''), 'base64')
      if (data.length > 16 * 1024 * 1024) throw new Error(`file '${name}' exceeds 16MiB`)
      writeFileSync(join(workdir, name), data)
      inHashes[name] = sha256Hex(data)
    }

    const { code, stdout, stderr } = await new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: workdir,
        shell: false,
        env: { PATH: process.env.PATH, HOME: workdir, CI: '1' }, // scrubbed env — no secrets reach jobs
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: parseInt(JOB_TIMEOUT_MS, 10),
        killSignal: 'SIGKILL',
      })
      let out = Buffer.alloc(0), err = Buffer.alloc(0)
      const cap = 512 * 1024
      child.stdout.on('data', (d) => { if (out.length < cap) out = Buffer.concat([out, d]).subarray(0, cap) })
      child.stderr.on('data', (d) => { if (err.length < cap) err = Buffer.concat([err, d]).subarray(0, cap) })
      child.on('error', reject)
      child.on('close', (c) => resolve({ code: c, stdout: out.toString('utf8'), stderr: err.toString('utf8') }))
    })

    // Hash every artifact the command produced inside the workdir.
    const artifacts = {}
    for (const name of readdirSync(workdir)) {
      const p = join(workdir, name)
      if (!statSync(p).isFile() || name in inHashes) continue
      const data = readFileSync(p)
      if (data.length <= 16 * 1024 * 1024) artifacts[name] = sha256Hex(data)
    }

    const expectExit = spec.expectExit === undefined ? 0 : Number(spec.expectExit)
    return JSON.stringify({
      ok: code === expectExit, exitCode: code,
      stdoutHash: sha256Hex(stdout), stderrHash: sha256Hex(stderr),
      stdoutTail: stdout.slice(-4096), stderrTail: stderr.slice(-2048),
      inputs: inHashes, artifacts,
    })
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
}

// ── Protocol client ──

let ws = null
let inFlight = 0
let stopping = false

function wsUrl() {
  // The coordinator accepts the WS upgrade at the root path; VOLUNTEER_TOKEN
  // rides the query string (the upgrade handshake can't carry headers).
  const base = COORDINATOR_URL.replace(/\/$/, '')
  const wsBase = base.startsWith('ws') ? base : base.replace(/^http/, 'ws')
  return VOLUNTEER_TOKEN ? `${wsBase}/?token=${encodeURIComponent(VOLUNTEER_TOKEN)}` : `${wsBase}/`
}

async function handleDispatch(env) {
  const { jobId, taskType } = env
  if (inFlight >= shardCapacity) {
    return send({ type: 'JOB_REJECTED', jobId, reason: 'shard-capacity-full' })
  }
  if (!(await verifyDispatchSig(jobId, env.sig))) {
    return send({ type: 'JOB_REJECTED', jobId, reason: 'bad-dispatch-signature' })
  }
  inFlight++
  const deadline = setTimeout(() => {}, parseInt(JOB_TIMEOUT_MS, 10))
  try {
    let payload = env.requestHash
    try { payload = JSON.parse(env.requestHash) } catch { /* bare string payload */ }
    let result
    if (taskType === TASK_SWARM_INFER) result = await runInfer(payload)
    else if (taskType === TASK_BUILD_VERIFY) result = await runBuildVerify(payload)
    else throw new Error(`unsupported taskType ${taskType}`)
    if (Buffer.byteLength(result) > parseInt(MAX_RESULT_BYTES, 10)) {
      throw new Error('result exceeds MAX_RESULT_BYTES')
    }
    const resultSig = signEd25519(`chimera-result:${jobId}:${sha256Hex(result)}`)
    send({ type: 'JOB_RESULT', jobId, result, resultSig })
  } catch (e) {
    send({ type: 'JOB_REJECTED', jobId, reason: String(e?.message || e).slice(0, 256) })
  } finally {
    clearTimeout(deadline)
    inFlight--
  }
}

function send(obj) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
}

function connect() {
  if (stopping) return
  ws = new WebSocket(wsUrl())
  ws.onopen = () => {
    send({
      type: 'REGISTER',
      volunteerId: VOLUNTEER_ID,
      did: DID,
      sig: signEd25519(`chimera-bind:${VOLUNTEER_ID}`),
      taskTypes: [TASK_SWARM_INFER, TASK_BUILD_VERIFY],
      durable: true,
      shardCapacity,
      networks: ['base'],
      capabilities: {
        cpuCores: cpus().length,
        memMB: Math.round(totalmem() / 1048576),
        models: [TRANSFORMERS_MODEL],
        runtime: `node-${process.version}`,
      },
    })
    console.log(`[node] registered ${VOLUNTEER_ID} as ${DID} (capacity ${shardCapacity})`)
  }
  ws.onmessage = (ev) => {
    let env
    try { env = JSON.parse(ev.data) } catch { return }
    if (env.type === 'JOB_DISPATCH') void handleDispatch(env)
    else if (env.type === 'ERROR') console.error('[node] coordinator error:', env.error)
  }
  ws.onclose = () => {
    if (!stopping) {
      console.warn('[node] disconnected — reconnecting in 5s')
      setTimeout(connect, 5000)
    }
  }
  ws.onerror = () => { /* onclose handles reconnect — closing here recurses */ }
}

setInterval(() => {
  if (ws?.readyState === WebSocket.OPEN) {
    send({ type: 'HEARTBEAT', taskTypes: [TASK_SWARM_INFER, TASK_BUILD_VERIFY], capabilities: { cpuCores: cpus().length } })
  }
}, 30_000)

async function shutdown() {
  if (stopping) return
  stopping = true
  console.log('[node] shutting down — honest EXIT')
  send({ type: 'EXIT' })
  // Give the EXIT a beat to flush, then close.
  setTimeout(() => { try { ws?.close() } catch {} ; process.exit(0) }, 500)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await fetchCoordinatorKey()
connect()
