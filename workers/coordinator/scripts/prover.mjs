#!/usr/bin/env node
/**
 * prover.mjs — deterministic-replay execution prover.
 *
 * Stance: this service INDEPENDENTLY re-executes a job and compares its
 * output to the node's claimed result. It does not share the executor's
 * code path (verifier independence — a shared bug would invalidate the
 * proof) and it never trusts claimed hashes without recomputing them.
 *
 * This is the honest substrate of "opML-style" verification: optimistic
 * acceptance + reproducible re-execution as the dispute oracle. It is NOT
 * a zero-knowledge proof and NOT a full fraud-proof VM — it attests
 * "re-running this deterministic job produces/doesn't produce this output."
 *
 * Protocol:
 *   POST /prove {jobId, taskType, inputHash, outputHash, nodeDid, jobUrl}
 *     → fetches {taskType, payload, result} from COORDINATOR_URL + jobUrl
 *       (jobUrl is resultToken-gated — the coordinator scopes what we see)
 *     → re-executes: 301 BUILD_VERIFY sandboxed (bwrap/unshare, no net),
 *                    300 SWARM_INFER greedy-decode via @huggingface/transformers
 *     → returns a signed artifact the coordinator stores on the result:
 *       { type:'deterministic-replay', reproduced, outputHash (byte-exact
 *         hash of OUR recomputed result), fieldDiffs, proverDid, proverSig }
 *
 * Env:
 *   PROVER_PORT         — listen port (default 8790)
 *   COORDINATOR_URL     — coordinator base for jobUrl fetches (default :8787)
 *   PROVER_KEY_FILE     — ed25519 pkcs8 PEM for signing proofs (auto-created)
 *   TRANSFORMERS_MODEL  — default model for 300 (same default as the daemon)
 *   OLLAMA_URL          — local Ollama daemon for 'ollama'-engine replays
 *   OLLAMA_MODEL        — model tag for the ollama engine
 *   BUILD_ALLOWLIST     — same command allowlist semantics as the daemon
 *   PROVE_TIMEOUT_MS    — re-execution cap (default 120000)
 */
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, generateKeyPairSync, sign as edSign, createPublicKey, createPrivateKey } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const {
  PROVER_PORT = '8790',
  COORDINATOR_URL = 'http://localhost:8787',
  PROVER_KEY_FILE = join(tmpdir(), 'chimera-prover-key.pk8'),
  TRANSFORMERS_MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct',
  OLLAMA_URL = 'http://localhost:11434',
  OLLAMA_MODEL = 'qwen2.5:0.5b',
  BUILD_ALLOWLIST = 'node,npm,python3,make,git',
  PROVE_TIMEOUT_MS = '120000',
} = process.env

const coord = COORDINATOR_URL.replace(/\/$/, '')
const sha256Hex = (b) => createHash('sha256').update(b).digest('hex')
const allowlist = new Set(BUILD_ALLOWLIST.split(',').map((s) => s.trim()).filter(Boolean))

// ── Prover identity (did:key, same shape as nodes) ──
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const b58 = (bytes) => {
  let num = 0n
  for (const x of bytes) num = num * 256n + BigInt(x)
  let enc = ''
  while (num > 0n) { enc = B58[Number(num % 58n)] + enc; num /= 58n }
  for (const x of bytes) { if (x === 0) enc = '1' + enc; else break }
  return enc
}
let proverPriv, proverDid
if (existsSync(PROVER_KEY_FILE)) {
  proverPriv = createPrivateKey({ key: readFileSync(PROVER_KEY_FILE), format: 'pem', type: 'pkcs8' })
} else {
  const kp = generateKeyPairSync('ed25519')
  writeFileSync(PROVER_KEY_FILE, kp.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  proverPriv = createPrivateKey({ key: kp.privateKey.export({ type: 'pkcs8', format: 'pem' }), format: 'pem', type: 'pkcs8' })
}
proverDid = `did:key:z${b58(new Uint8Array([0xed, 0x01, ...createPublicKey(proverPriv).export({ type: 'spki', format: 'der' }).subarray(-32)]))}`
const sign = (msg) => Buffer.from(edSign(null, Buffer.from(msg, 'utf8'), proverPriv)).toString('hex')

// ── Net-isolated execution (independent re-probe — do NOT inherit the
//    node's claim about which sandbox it used) ──
function probeIsolation() {
  const t1 = spawnSync('bwrap', ['--bind', '/', '/', '--unshare-net', 'true'], { stdio: 'ignore', timeout: 5000 })
  if (!t1.error && t1.status === 0) return 'bwrap'
  const t2 = spawnSync('unshare', ['-Urn', 'true'], { stdio: 'ignore', timeout: 5000 })
  if (!t2.error && t2.status === 0) return 'unshare'
  return 'none'
}
const isolation = probeIsolation()
const wrap = (cmd, args) =>
  isolation === 'bwrap' ? ['bwrap', ['--bind', '/', '/', '--unshare-net', '--unshare-pid', '--die-with-parent', '--new-session', '--', cmd, ...args]]
    : isolation === 'unshare' ? ['unshare', ['-Urn', '--kill-child', '--', cmd, ...args]]
      : [cmd, args]

// ── Re-executors (independent implementations) ──
async function reexecBuildVerify(payload) {
  const spec = typeof payload === 'string' ? JSON.parse(payload) : payload
  const cmd = String(spec?.cmd || '')
  if (!allowlist.has(cmd)) throw new Error(`cmd '${cmd}' not in allowlist`)
  const args = (spec?.args ?? []).map(String)
  const workdir = join(tmpdir(), `prove-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(workdir, { recursive: true })
  try {
    const inHashes = {}
    for (const f of (spec?.files ?? []).slice(0, 32)) {
      const name = String(f.name || '').replace(/[^A-Za-z0-9._-]/g, '_')
      if (!name || name.startsWith('.')) throw new Error(`bad file name '${f.name}'`)
      const data = Buffer.from(String(f.dataBase64 || ''), 'base64')
      if (data.length > 16 * 1024 * 1024) throw new Error(`file '${name}' exceeds 16MiB`)
      writeFileSync(join(workdir, name), data)
      inHashes[name] = sha256Hex(data)
    }
    const [c, a] = wrap(cmd, args)
    const { code, stdout, stderr } = await new Promise((res, rej) => {
      const ch = spawn(c, a, {
        cwd: workdir, shell: false,
        env: { PATH: process.env.PATH, HOME: workdir, CI: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: parseInt(PROVE_TIMEOUT_MS, 10), killSignal: 'SIGKILL',
      })
      let o = Buffer.alloc(0), e = Buffer.alloc(0)
      const cap = 512 * 1024
      ch.stdout.on('data', (d) => { if (o.length < cap) o = Buffer.concat([o, d]).subarray(0, cap) })
      ch.stderr.on('data', (d) => { if (e.length < cap) e = Buffer.concat([e, d]).subarray(0, cap) })
      ch.on('error', rej)
      ch.on('close', (k) => res({ code: k, stdout: o.toString('utf8'), stderr: e.toString('utf8') }))
    })
    const artifacts = {}
    for (const name of readdirSync(workdir)) {
      const p = join(workdir, name)
      if (!statSync(p).isFile() || name in inHashes) continue
      const d = readFileSync(p)
      if (d.length <= 16 * 1024 * 1024) artifacts[name] = sha256Hex(d)
    }
    const expectExit = spec?.expectExit === undefined ? 0 : Number(spec.expectExit)
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

// Engine-matched inference replay. The result record carries the engine
// the node claimed ('ollama'|'onnx'); replaying on a different engine would
// legitimately produce different bytes and false-flag honest results, so
// the prover honors it. Cross-engine *semantic* equivalence is a separate
// (unsolved) question — replay is same-engine only.
async function reexecInferOllama(spec, prompt) {
  const model = spec?.ollamaModel || (spec?.model && !spec.model.includes('/') ? spec.model : null) || OLLAMA_MODEL
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model, prompt, stream: false,
      options: { num_predict: Math.min(Number(spec?.maxTokens) || 256, 1024), temperature: 0 },
    }),
    signal: AbortSignal.timeout(parseInt(PROVE_TIMEOUT_MS, 10)),
  })
  if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const body = await res.json()
  if (typeof body.response !== 'string' || !body.response) throw new Error('empty ollama generation')
  // Same shape as the onnx path: generated text includes the prompt.
  return prompt + body.response
}

let pipe = null, pipeModel = null
async function reexecInferOnnx(spec, prompt) {
  const model = spec?.model || TRANSFORMERS_MODEL
  const tf = await import('@huggingface/transformers')
  if (!pipe || pipeModel !== model) {
    pipe = await tf.pipeline('text-generation', model, { dtype: 'q4' })
    pipeModel = model
  }
  const out = await pipe(prompt, {
    max_new_tokens: Math.min(Number(spec?.maxTokens) || 256, 1024),
    do_sample: false,
  })
  const text = Array.isArray(out) ? out[0]?.generated_text : out?.generated_text
  if (!text) throw new Error('empty generation')
  return String(text)
}

async function reexecInfer(payload, engine) {
  let spec = payload
  if (typeof spec === 'string') {
    try { spec = JSON.parse(spec) } catch { spec = { prompt: spec } }
  }
  const prompt = String(spec?.prompt ?? spec?.input ?? '')
  if (!prompt) throw new Error('SWARM_INFER payload needs prompt')
  const eff = spec?.engine || engine || 'onnx'
  if (eff === 'ollama') return reexecInferOllama(spec, prompt)
  return reexecInferOnnx(spec, prompt)
}

// Field-level comparison — structured results can differ in provably benign
// fields (e.g. which sandbox backend wrapped the call); compare what the
// result actually claims.
function fieldCompare(original, recomputed) {
  try {
    const o = JSON.parse(original), r = JSON.parse(recomputed)
    const diffs = {}
    for (const k of ['ok', 'exitCode', 'stdoutHash', 'stderrHash']) {
      if (JSON.stringify(o[k]) !== JSON.stringify(r[k])) diffs[k] = { original: o[k], recomputed: r[k] }
    }
    if (JSON.stringify(o.artifacts ?? {}) !== JSON.stringify(r.artifacts ?? {})) {
      diffs.artifacts = { original: o.artifacts, recomputed: r.artifacts }
    }
    return { diffs, semanticMatch: Object.keys(diffs).length === 0 }
  } catch {
    return { diffs: null, semanticMatch: original === recomputed }
  }
}

const server = createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(obj))
  }
  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, did: proverDid, isolation })
  if (req.method !== 'POST' || !req.url?.startsWith('/prove')) return send(404, { error: 'not found' })
  let body = ''
  for await (const c of req) body += c
  let reqObj
  try { reqObj = JSON.parse(body) } catch { return send(400, { error: 'bad json' }) }
  const { jobId, taskType, inputHash, outputHash, nodeDid, jobUrl } = reqObj ?? {}
  const reqEngine = typeof reqObj?.engine === 'string' ? reqObj.engine.slice(0, 32) : undefined
  if (!jobId || taskType === undefined) return send(400, { error: 'jobId + taskType required' })

  const t0 = Date.now()
  try {
    // Fetch the I/O through the resultToken-gated URL — scoped read.
    const ioUrl = jobUrl ? `${coord}${jobUrl}` : `${coord}/results/${jobId}?token=${reqObj.resultToken ?? ''}`
    const rec = await fetch(ioUrl, { signal: AbortSignal.timeout(15000) })
    if (!rec.ok) return send(502, { error: `job fetch failed: ${rec.status}` })
    const job = await rec.json()
    if (sha256Hex(String(job.payload ?? '')) !== inputHash) {
      return send(422, { error: 'payload hash mismatch — prover saw different input', inputHash, seen: sha256Hex(String(job.payload ?? '')) })
    }
    let recomputed, usedEngine
    if (taskType === 301) recomputed = await reexecBuildVerify(job.payload)
    else if (taskType === 300) {
      // The stored record's engine claim is authoritative — it IS what the
      // node declared. Replaying on a different engine would legitimately
      // produce different bytes and false-flag honest work.
      usedEngine = job.engine || reqEngine
      recomputed = await reexecInfer(job.payload, usedEngine)
    }
    else return send(200, { type: 'deterministic-replay', supported: false, jobId, taskType, note: 'no re-executor for this task type' })

    const recomputedHash = sha256Hex(recomputed)
    const fc = fieldCompare(String(job.result ?? ''), recomputed)
    const reproduced = recomputedHash === outputHash || fc.semanticMatch
    const proof = {
      type: 'deterministic-replay',
      jobId, taskType, inputHash,
      claimedOutputHash: outputHash,
      outputHash: recomputedHash,   // hash of OUR recomputed output
      recomputedOutputHash: recomputedHash,
      reproduced,
      fieldDiffs: fc.diffs,
      // Audit aid — bounded excerpt of what the prover actually produced.
      recomputedTail: recomputed.slice(-500),
      originalTail: String(job.result ?? '').slice(-500),
      nodeDid: nodeDid ?? null,
      ...(usedEngine ? { engine: usedEngine } : {}),
      isolation,
      tookMs: Date.now() - t0,
      proverDid,
    }
    proof.proverSig = sign(`chimera-proof:${jobId}:${recomputedHash}:${reproduced}`)
    send(200, proof)
  } catch (e) {
    send(200, { type: 'deterministic-replay', supported: true, reproduced: false, error: String(e?.message || e), jobId, taskType })
  }
})
server.listen(parseInt(PROVER_PORT, 10), () => {
  console.log(`[prover] :${PROVER_PORT} did=${proverDid} isolation=${isolation} coord=${coord}`)
})
