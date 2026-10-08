#!/usr/bin/env node
/**
 * committee-test.mjs — Byzantine-resilience check for signed committee votes.
 *
 * Registers 5 ephemeral did:key voter nodes, has each complete one real
 * BUILD_VERIFY job to earn rep weight, then runs a motion: 4 honest ballots
 * + 1 forged ballot (signed by a different key). Asserts the forged ballot
 * is rejected, the honest four are counted with rep weight, and the motion
 * closes. Usage:
 *   COORDINATOR_URL=http://localhost:8787 VOLUNTEER_TOKEN=… DISPATCH_AUTH_TOKEN=… node scripts/committee-test.mjs
 */
import { createHash, generateKeyPairSync, sign as edSign, createPublicKey, createPrivateKey } from 'node:crypto'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { COORDINATOR_URL = 'http://localhost:8787', VOLUNTEER_TOKEN = '', DISPATCH_AUTH_TOKEN = '', ADMIN_TOKEN = '' } = process.env
const base = COORDINATOR_URL.replace(/\/$/, '').replace(/^ws/, 'http')
const wsBase = COORDINATOR_URL.replace(/\/$/, '').replace(/^http/, 'ws')

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const b58 = (bytes) => {
  let num = 0n
  for (const b of bytes) num = num * 256n + BigInt(b)
  let enc = ''
  while (num > 0n) { enc = B58[Number(num % 58n)] + enc; num /= 58n }
  for (const b of bytes) { if (b === 0) enc = '1' + enc; else break }
  return enc
}

function makeVoter(id) {
  const privFile = join(mkdtempSync(join(tmpdir(), 'voter-')), 'k.pk8')
  const { privateKey } = generateKeyPairSync('ed25519')
  writeFileSync(privFile, privateKey.export({ type: 'pkcs8', format: 'pem' }))
  const priv = createPrivateKey({ key: privateKey.export({ type: 'pkcs8', format: 'pem' }), format: 'pem', type: 'pkcs8' })
  const raw = createPublicKey(priv).export({ type: 'spki', format: 'der' }).subarray(-32)
  const did = `did:key:z${b58(new Uint8Array([0xed, 0x01, ...raw]))}`
  return {
    id, priv, did,
    sign: (msg) => Buffer.from(edSign(null, Buffer.from(msg, 'utf8'), priv)).toString('hex'),
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256Hex = (s) => createHash('sha256').update(s).digest('hex')

/** Register a voter over WS, then stay connected long enough to run one job. */
function register(voter, resolveDispatch) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/?token=${encodeURIComponent(VOLUNTEER_TOKEN)}`)
    const timeout = setTimeout(() => reject(new Error(`${voter.id} register timeout`)), 15000)
    ws.onopen = () => ws.send(JSON.stringify({
      type: 'REGISTER', volunteerId: voter.id, did: voter.did,
      sig: voter.sign(`chimera-bind:${voter.id}`),
      taskTypes: [301], durable: true, networks: ['base'],
    }))
    ws.onmessage = async (ev) => {
      const env = JSON.parse(ev.data)
      if (env.type === 'REGISTERED') { clearTimeout(timeout); resolve(ws) }
      else if (env.type === 'JOB_DISPATCH') {
        // Test voter — echoes a small structured result after a short hold.
        // The hold keeps the node 'busy' long enough for concurrent job
        // dispatches to fan out across all five voters (selectVolunteer is
        // idle-first, deterministic best-score).
        const spec = JSON.parse(env.requestHash)
        await new Promise((r) => setTimeout(r, 400))
        // Unique per voter+job — the coordinator's seen: content-hash dedup
        // (correctly) withholds credit for repeated identical results.
        const result = JSON.stringify({ ok: true, exitCode: 0, echo: `${voter.id}:${env.jobId}` })
        ws.send(JSON.stringify({
          type: 'JOB_RESULT', jobId: env.jobId, result,
          resultSig: voter.sign(`chimera-result:${env.jobId}:${sha256Hex(result)}`),
        }))
        resolveDispatch?.(env.jobId)
      }
    }
    ws.onerror = (e) => reject(new Error(`${voter.id} ws error`))
  })
}

async function api(path, opts = {}) {
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

const authed = (body) => ({ method: 'POST', headers: { authorization: `Bearer ${DISPATCH_AUTH_TOKEN}` }, body: JSON.stringify(body) })
const admin = (body) => ({ method: 'POST', headers: { authorization: `Bearer ${ADMIN_TOKEN}` }, body: JSON.stringify(body) })

let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`)
  ok ? pass++ : fail++
}

// voter[4] is the Byzantine node — it will sign its ballot with a forged key.
const runTag = Math.random().toString(36).slice(2, 7)
const voters = await Promise.all([0, 1, 2, 3, 4].map((i) => makeVoter(`voter-${runTag}-${i}`)))
const sockets = []
for (const v of voters) sockets.push(await register(v))
console.log(`[test] 5 voters registered with did:key bindings`)

// Earn rep: occupy the durable node with a slow infer (NOT awaited — it
// must still be busy when the 301s dispatch), then fire 5 concurrent 301s
// so they fan out across the 5 voter nodes.
const occupancy = api('/jobs', authed({ taskType: 300, payload: JSON.stringify({ prompt: 'warmup', maxTokens: 128 }) }))
  .catch(() => {}) // best-effort occupancy; fan-out below still works if it fails
const jobSpecs = voters.map((v, i) =>
  api('/jobs', authed({ taskType: 301, payload: JSON.stringify({ cmd: 'node', args: ['-e', 'console.log(1)'], echo: i }) })))
const jobResults = await Promise.all(jobSpecs)
check('all 5 voter jobs accepted', jobResults.every((r) => r.body.accepted === true))
// Rep posts asynchronously after the result credit — poll until all five
// voters hold weight (bounded so a stuck credit fails honestly).
const repOf = async (id) => (await api(`/rep?id=${encodeURIComponent(id)}`)).body?.points ?? 0
let repSummary = []
for (let i = 0; i < 30; i++) {
  repSummary = await Promise.all(voters.map(async (v) => `${v.id}:${await repOf(v.id)}`))
  if (repSummary.every((s) => !s.endsWith(':0'))) break
  await sleep(1000)
}
check('all 5 voters hold rep weight', repSummary.every((s) => !s.endsWith(':0')), repSummary.join(' '))
await occupancy

// Propose a motion.
const prop = await api('/committee/propose', admin({ motion: 'admit project x into lane 0' }))
check('motion proposed', prop.status === 200, JSON.stringify(prop.body).slice(0, 80))
const motionId = prop.body.id

const vote = (v, phase, approve, signer = v) =>
  api('/committee/vote', { method: 'POST', body: JSON.stringify({
    id: motionId, voter: v.id, approve, phase,
    sig: signer.sign(`chimera-vote:${motionId}:${phase}:${approve ? 'yes' : 'no'}`),
  }) })

// Phase 1 — 4 honest signed PREVOTES (yes). Quorum-3 weight + yes>2·no →
// motion must advance to precommit.
let phase = 'prevote'
for (let i = 0; i < 4; i++) {
  const r = await vote(voters[i], 'prevote', true)
  check(`voter-${i} prevote accepted`, r.status === 200 && r.body.ok === true, JSON.stringify(r.body).slice(0, 90))
  phase = r.body.phase ?? phase
}
check('motion advanced to precommit', phase === 'precommit', phase)

// Byzantine ballot — voter-4's precommit signed with a *different* key.
const forged = makeVoter('forged')
const r5 = await vote(voters[4], 'precommit', false, forged)
check('voter-4 forged precommit REJECTED', r5.status === 403, JSON.stringify(r5.body).slice(0, 80))

// Unsigned ballot rejected.
const r6 = await api('/committee/vote', { method: 'POST', body: JSON.stringify({ id: motionId, voter: voters[4].id, approve: false, phase: 'precommit' }) })
check('unsigned ballot REJECTED', r6.status === 400 || r6.status === 403)

// A late PREVOTE is rejected — the phase has moved on (cross-phase replay).
const late = await vote(voters[4], 'prevote', false)
check('late prevote REJECTED (phase moved on)', late.status === 409, JSON.stringify(late.body).slice(0, 80))

// Replay of an honest prevote ballot rejected (one vote per voter per phase).
const replay = await vote(voters[0], 'prevote', true)
check('replayed prevote REJECTED (409)', replay.status === 409, JSON.stringify(replay.body).slice(0, 80))

// Phase 2 — 4 honest PRECOMMITS (yes). Quorum → committed.
let committed = false
for (let i = 0; i < 4; i++) {
  const r = await vote(voters[i], 'precommit', true)
  check(`voter-${i} precommit accepted`, r.status === 200 && r.body.ok === true, JSON.stringify(r.body).slice(0, 90))
  if (r.body.phase === 'committed') committed = true
}
check('motion COMMITTED after 2-phase quorum', committed === true)

// Replay of an honest precommit rejected — the motion is closed.
const replay2 = await vote(voters[0], 'precommit', true)
check('post-commit ballot REJECTED (motion closed)', replay2.status === 404)

console.log(`\n[test] ${pass} passed, ${fail} failed — 2-phase committee survived 1 Byzantine voter`)
for (const ws of sockets) { try { ws.send(JSON.stringify({ type: 'EXIT' })); ws.close() } catch {} }
process.exit(fail ? 1 : 0)
