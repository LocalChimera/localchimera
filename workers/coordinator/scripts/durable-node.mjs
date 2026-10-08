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
 *   300 SWARM_INFER  — text-generation. Engine selection is honest and
 *                      reported on the result: a reachable local Ollama
 *                      daemon (llama.cpp — ~10x faster warm than the ONNX
 *                      path) is preferred; @huggingface/transformers is
 *                      the fallback (dynamic import; honest JOB_REJECTED
 *                      when neither is available). Payload:
 *                      {prompt, model?, ollamaModel?, maxTokens?, engine?}
 *                      or a bare prompt string.
 *   301 BUILD_VERIFY — runs a declared command in a fresh temp dir. No
 *                      shell, argv[0] must be in BUILD_ALLOWLIST, stdout/
 *                      stderr and artifacts are size-capped and sha256'd.
 *                      Network isolation: bwrap --unshare-net when present,
 *                      else `unshare -Urn`, else reported 'none'.
 *                      Payload: {cmd, args?, files?:[{name,dataBase64}],
 *                      expectExit?}.
 *   Helia/IPFS groundwork — when TRANSFORMERS_IPFS_CID is set, model weights
 *   are fetched over IPFS (dynamic import of helia + @helia/unixfs) into a
 *   cache dir, the tarball sha256 checked against TRANSFORMERS_IPFS_SHA256,
 *   and transformers.js pointed at the extracted local dir.
 *
 * Env:
 *   COORDINATOR_URL    ws(s):// or http(s):// coordinator base (required)
 *   VOLUNTEER_TOKEN    WS upgrade token (required when the coordinator sets one)
 *   VOLUNTEER_ID       stable id (default durable-<host>-<pid>)
 *   KEY_FILE           ed25519 PKCS8 PEM path; created if absent
 *   SHARD_CAPACITY     max concurrent jobs (default 4)
 *   TRANSFORMERS_MODEL default HF model for 300 (default Qwen2.5-0.5B-Instruct)
 *   OLLAMA_URL         local Ollama/llama.cpp daemon (default :11434)
 *   OLLAMA_MODEL       model tag for the ollama engine (default qwen2.5:0.5b)
 *   INFER_ENGINE       'auto' (default) | 'ollama' | 'onnx' — auto prefers a
 *                      reachable ollama daemon, else transformers.js
 *   BUILD_ALLOWLIST    comma-sep allowed argv[0] for 301 (default "node,npm")
 *   VERIFY_DISPATCH    "0" to skip dispatch-sig verification (default on)
 *   JOB_TIMEOUT_MS     per-job cap (default 120000)
 *   MAX_RESULT_BYTES   result cap (default 1 MiB)
 */
import { spawn, spawnSync } from 'node:child_process'
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
  OLLAMA_URL = 'http://localhost:11434',
  OLLAMA_MODEL = 'qwen2.5:0.5b',
  INFER_ENGINE = 'auto',               // 'auto' | 'ollama' | 'onnx'
  BUILD_ALLOWLIST = 'node,npm',
  VERIFY_DISPATCH = '1',
  JOB_TIMEOUT_MS = '120000',
  MAX_RESULT_BYTES = String(1024 * 1024),
  BUILD_NET_ISOLATION = 'auto',        // 'auto' | 'bwrap' | 'unshare' | 'none'
  TRANSFORMERS_IPFS_CID = '',          // fetch weights over helia instead of HF
  TRANSFORMERS_IPFS_SHA256 = '',       // required when the CID is set
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

// ── Sandbox detection (probed once at startup) ──

function probeIsolation() {
  const pref = BUILD_NET_ISOLATION
  if (pref === 'none') return 'none'
  // bwrap: user-namespace sandbox, unshare-net + die-with-parent.
  if (pref === 'auto' || pref === 'bwrap') {
    const t = spawnSync('bwrap', ['--bind', '/', '/', '--unshare-net', 'true'],
      { stdio: 'ignore', timeout: 5000 })
    if (!t.error && t.status === 0) return 'bwrap'
    if (pref === 'bwrap') return 'none'
  }
  // unshare: user+net namespace, maps current uid to fake-root inside.
  if (pref === 'auto' || pref === 'unshare') {
    const t = spawnSync('unshare', ['-Urn', 'true'], { stdio: 'ignore', timeout: 5000 })
    if (!t.error && t.status === 0) return 'unshare'
  }
  return 'none'
}
const isolation = probeIsolation()
console.log(`[node] build-verify net isolation: ${isolation}`)

/** Wrap [cmd, ...args] in the detected net-isolation sandbox. */
function sandboxWrap(cmd, args, workdir) {
  if (isolation === 'bwrap') {
    // Bind the host tree, open a fresh empty netns, die with the daemon.
    return ['bwrap', ['--bind', '/', '/', '--unshare-net', '--unshare-pid', '--die-with-parent', '--new-session', '--', cmd, ...args]]
  }
  if (isolation === 'unshare') {
    return ['unshare', ['-Urn', '--kill-child', '--', cmd, ...args]]
  }
  return [cmd, args]
}

// ── Helia weight-shard fetch (optional — model weights over IPFS) ──

async function fetchWeightsIpfs(cid, expectedSha256) {
  let helia, unixfs
  try {
    helia = await import('helia')
    unixfs = await import('@helia/unixfs')
  } catch {
    throw new Error('helia/@helia/unixfs not installed — npm i helia @helia/unixfs in the node env')
  }
  const node = await helia.createHelia()
  try {
    const fs = unixfs.unixfs(node)
    const chunks = []
    for await (const chunk of fs.cat(cid)) chunks.push(chunk)
    const blob = Buffer.concat(chunks.map((c) => Buffer.from(c)))
    const got = sha256Hex(blob)
    // Weight shards are executable-adjacent — never trust unverified bytes.
    if (expectedSha256 && got !== expectedSha256) {
      throw new Error(`IPFS weight sha256 mismatch: got ${got}, want ${expectedSha256}`)
    }
    return blob
  } finally {
    await node.stop()
  }
}

// ── Inference engines ──
// A local Ollama daemon (llama.cpp) is ~10x faster warm than the in-process
// ONNX path and runs inference off the event loop — the heartbeat never
// starves under sustained load. It's probed once at startup; the chosen
// engine is reported on the JOB_RESULT so the deterministic-replay prover
// can re-execute on the SAME engine (cross-engine outputs legitimately
// differ — a mismatched engine would false-flag honest results).
let ollama = null // probed {url, model} | null
async function probeOllama() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return
    const tags = await res.json()
    const names = (tags?.models ?? []).map((m) => m.name)
    const model = names.includes(OLLAMA_MODEL) ? OLLAMA_MODEL
      : names.find((n) => n.startsWith(`${OLLAMA_MODEL}:`))
    if (model) { ollama = { url: OLLAMA_URL, model }; console.log(`[node] ollama backend — ${model} @ ${OLLAMA_URL}`) }
    else console.log(`[node] ollama reachable but '${OLLAMA_MODEL}' not pulled — onnx fallback`)
  } catch { /* no local daemon — onnx fallback */ }
}
async function runInferOllama(spec, prompt) {
  const model = spec.ollamaModel || spec.model && !spec.model.includes('/') && spec.model || ollama.model
  const res = await fetch(`${ollama.url}/api/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model, prompt, stream: false, keep_alive: '5m',
      options: { num_predict: Math.min(Number(spec.maxTokens) || 256, 1024), temperature: 0 },
    }),
    signal: AbortSignal.timeout(parseInt(JOB_TIMEOUT_MS, 10)),
  })
  if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const body = await res.json()
  if (typeof body.response !== 'string' || !body.response) throw new Error('empty ollama generation')
  // Match transformers.js output shape: generated_text includes the prompt.
  return prompt + body.response
}

let inferPipeline = null
let inferModel = null
async function runInferOnnx(spec, prompt) {
  const model = spec.model || TRANSFORMERS_MODEL
  let tf
  try {
    tf = await import('@huggingface/transformers')
  } catch {
    throw new Error('@huggingface/transformers not installed — npm i @huggingface/transformers in the node env')
  }
  // Optional IPFS weight fetch — TRANSFORMERS_IPFS_CID points at a tarball
  // of the model dir; sha256-checked before it touches the runtime.
  if (TRANSFORMERS_IPFS_CID) {
    if (!TRANSFORMERS_IPFS_SHA256) throw new Error('TRANSFORMERS_IPFS_SHA256 required with TRANSFORMERS_IPFS_CID')
    const cacheDir = join(tmpdir(), `weights-${TRANSFORMERS_IPFS_SHA256.slice(0, 16)}`, model)
    if (!existsSync(join(cacheDir, 'config.json'))) {
      const tarball = await fetchWeightsIpfs(TRANSFORMERS_IPFS_CID, TRANSFORMERS_IPFS_SHA256)
      mkdirSync(cacheDir, { recursive: true })
      // Extract via tar(1) — tarballs from IPFS are untrusted until hashed.
      const ok = spawnSync('tar', ['-xzf', '/dev/stdin', '-C', cacheDir],
        { input: tarball, stdio: ['pipe', 'ignore', 'inherit'], timeout: 120000 })
      if (ok.error || ok.status !== 0) throw new Error('weight tarball extract failed')
      if (!existsSync(join(cacheDir, 'config.json'))) throw new Error('extracted weights lack config.json')
    }
    tf.env.localModelPath = join(cacheDir, '..')
    tf.env.allowRemoteModels = false
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

/** Engine-picking dispatcher — returns {text, engine}. The engine is
 *  reported on the JOB_RESULT envelope so the prover replays on the same
 *  engine; a node claiming the wrong engine produces a replay mismatch,
 *  which is exactly what verification is for. */
async function runInfer(payload) {
  const spec = typeof payload === 'string'
    ? { prompt: payload }
    : (typeof payload === 'object' && payload !== null ? payload : {})
  const prompt = String(spec.prompt ?? spec.input ?? '')
  if (!prompt) throw new Error('SWARM_INFER payload needs prompt')
  const engine = spec.engine || INFER_ENGINE
  if (engine === 'ollama' || (engine === 'auto' && ollama)) {
    if (!ollama) throw new Error('engine=ollama requested but no daemon reachable')
    return { text: await runInferOllama(spec, prompt), engine: 'ollama' }
  }
  return { text: await runInferOnnx(spec, prompt), engine: 'onnx' }
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

    const [execCmd, execArgs] = sandboxWrap(cmd, args, workdir)
    const { code, stdout, stderr } = await new Promise((resolve, reject) => {
      const child = spawn(execCmd, execArgs, {
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
      inputs: inHashes, artifacts, isolation,
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
    let result, engine
    if (taskType === TASK_SWARM_INFER) {
      const r = await runInfer(payload)
      result = r.text; engine = r.engine
    } else if (taskType === TASK_BUILD_VERIFY) result = await runBuildVerify(payload)
    else throw new Error(`unsupported taskType ${taskType}`)
    if (Buffer.byteLength(result) > parseInt(MAX_RESULT_BYTES, 10)) {
      throw new Error('result exceeds MAX_RESULT_BYTES')
    }
    const resultSig = signEd25519(`chimera-result:${jobId}:${sha256Hex(result)}`)
    send({ type: 'JOB_RESULT', jobId, result, resultSig, ...(engine ? { engine } : {}) })
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
await probeOllama()
connect()
