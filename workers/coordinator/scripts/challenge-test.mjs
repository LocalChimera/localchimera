#!/usr/bin/env node
/**
 * challenge-test.mjs — deterministic-replay proof + dispute game, live.
 *
 * Requires: coordinator at COORDINATOR_URL with PROVER_URL set, and the
 * prover running (scripts/prover.mjs). Two did:key nodes register; one is
 * a LIAR (fabricates a BUILD_VERIFY result without executing), one is an
 * honest CHALLENGER (runs a real echo). The coordinator auto-proves each
 * completed job via PROVER_URL. Then:
 *   1. challenger disputes the liar's job → prover re-executes, mismatch →
 *      challenger-wins, liar slashed.
 *   2. challenger disputes an honest durable-node job → result-stands,
 *      challenger slashed.
 *
 *   COORDINATOR_URL=http://localhost:8787 VOLUNTEER_TOKEN=… \
 *   DISPATCH_AUTH_TOKEN=… node scripts/challenge-test.mjs
 */
import { createHash, generateKeyPairSync, sign as edSign, createPublicKey, createPrivateKey } from 'node:crypto'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { COORDINATOR_URL = 'http://localhost:8787', VOLUNTEER_TOKEN = '', DISPATCH_AUTH_TOKEN = '', ADMIN_TOKEN = '' } = process.env
const base = COORDINATOR_URL.replace(/\/$/, '')
const wsBase = COORDINATOR_URL.replace(/^http/, 'ws')

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const b58 = (bytes) => {
  let num = 0n
  for (const x of bytes) num = num * 256n + BigInt(x)
  let enc = ''
  while (num > 0n) { enc = B58[Number(num % 58n)] + enc; num /= 58n }
  for (const x of bytes) { if (x === 0) enc = '1' + enc; else break }
  return enc
}
function makeNode(id, liar) {
  const { privateKey } = generateKeyPairSync('ed25519')
  const priv = createPrivateKey({ key: privateKey.export({ type: 'pkcs8', format: 'pem' }), format: 'pem', type: 'pkcs8' })
  const raw = createPublicKey(priv).export({ type: 'spki', format: 'der' }).subarray(-32)
  const did = `did:key:z${b58(new Uint8Array([0xed, 0x01, ...raw]))}`
  return { id, liar, did, priv, sign: (m) => Buffer.from(edSign(null, Buffer.from(m, 'utf8'), priv)).toString('hex') }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256Hex = (s) => createHash('sha256').update(s).digest('hex')

const jobsDone = new Map() // jobId -> node.id
function connect(node) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/?token=${encodeURIComponent(VOLUNTEER_TOKEN)}`)
    const t = setTimeout(() => reject(new Error('register timeout')), 15000)
    ws.onopen = () => ws.send(JSON.stringify({
      type: 'REGISTER', volunteerId: node.id, did: node.did,
      sig: node.sign(`chimera-bind:${node.id}`),
      taskTypes: [301], durable: true, networks: ['base'],
    }))
    ws.onmessage = async (ev) => {
      const env = JSON.parse(ev.data)
      if (env.type === 'REGISTERED') { clearTimeout(t); resolve(ws) }
      else if (env.type === 'JOB_DISPATCH') {
        await sleep(300)
        // LIAR fabricates without executing; honest nodes echo a marker.
        const result = node.liar
          ? JSON.stringify({ ok: true, exitCode: 0, artifacts: { 'fake.out': 'deadbeef' }, fabricated: `${node.id}:${env.jobId}` })
          : JSON.stringify({ ok: true, exitCode: 0, echo: `${node.id}:${env.jobId}` })
        ws.send(JSON.stringify({
          type: 'JOB_RESULT', jobId: env.jobId, result,
          resultSig: node.sign(`chimera-result:${env.jobId}:${sha256Hex(result)}`),
        }))
        jobsDone.set(env.jobId, node.id)
      }
    }
    ws.onerror = () => reject(new Error('ws error'))
    node.ws = ws
  })
}

const api = async (path, opts = {}) => {
  const res = await fetch(`${base}${path}`, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
const authed = (b) => ({ method: 'POST', headers: { authorization: `Bearer ${DISPATCH_AUTH_TOKEN}` }, body: JSON.stringify(b) })
const adminGet = { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } }

let pass = 0, fail = 0
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ` — ${x}` : ''}`); ok ? pass++ : fail++ }

const tag = Math.random().toString(36).slice(2, 7)
const liar = makeNode(`liar-${tag}`, true)
const challenger = makeNode(`chal-${tag}`, false)
await connect(liar); await connect(challenger)
console.log('[test] liar + challenger registered')

// Burst concurrent dispatches — idle-first selection spreads the burst
// across all claimants (a durable node may take some; that's leg 2's point).
const spec = { cmd: 'node', args: ['-e', 'console.log(42)'] }
let liarJob, chalJob
for (let round = 0; round < 4 && !(liarJob && chalJob); round++) {
  await Promise.all([0, 1, 2, 3].map((i) =>
    api('/jobs', authed({ taskType: 301, payload: JSON.stringify({ ...spec, tag: `${tag}-r${round}-${i}` }) }))
      .then((r) => { if (r.body.accepted !== true) console.log('[test] not accepted:', JSON.stringify(r.body).slice(0, 80)) })))
  liarJob = [...jobsDone.entries()].find(([, v]) => v === liar.id)?.[0]
  chalJob = [...jobsDone.entries()].find(([, v]) => v === challenger.id)?.[0]
}
check('liar got a job', !!liarJob, `liarJob=${liarJob}`)
check('challenger got a job', !!chalJob, `chalJob=${chalJob}`)

// Wait for rep to post (challenger needs rep>0 to have slashing skin).
const repOf = async (id) => (await api(`/rep?id=${encodeURIComponent(id)}`)).body?.points ?? 0
let chalRep = 0, liarRep = 0
for (let i = 0; i < 30; i++) {
  chalRep = await repOf(challenger.id); liarRep = await repOf(liar.id)
  if (chalRep > 0 && liarRep > 0) break
  await sleep(1000)
}
check('both nodes hold rep', chalRep > 0 && liarRep > 0, `chal=${chalRep} liar=${liarRep}`)

// Wait for the auto-prove to land on the liar's result record.
let liarRec = null
for (let i = 0; i < 40; i++) {
  const r = await api(`/results/${liarJob}`, adminGet)
  if (r.body?.execProof) { liarRec = r.body; break }
  await sleep(1000)
}
check('liar job auto-proved', !!liarRec?.execProof, JSON.stringify(liarRec?.execProof ?? {}).slice(0, 120))
check('prover reported MISMATCH (liar did not execute)',
  liarRec?.execProof?.reproduced === false,
  `reproduced=${liarRec?.execProof?.reproduced}`)

// Challenger disputes the liar's job.
const counterHash = sha256Hex('whatever-the-challenger-computed')
const ch = await api('/challenge', { method: 'POST', body: JSON.stringify({
  jobId: liarJob, challenger: challenger.id, counterHash,
  sig: challenger.sign(`chimera-challenge:${liarJob}:${counterHash}`),
}) })
check('challenge on liar → challenger-wins', ch.body?.outcome === 'challenger-wins', JSON.stringify(ch.body).slice(0, 120))

// Liar slashed to 0.
await sleep(500)
const liarRepAfter = await repOf(liar.id)
check('liar slashed', liarRepAfter < liarRep, `liar rep ${liarRep} → ${liarRepAfter}`)

// ── Leg 2: honest-positive — a REAL durable node executes a build, the
//    prover reproduces it, and the challenger's wrong dispute is slashed.
//    Requires durable-node.mjs running and claiming taskType 301.
try { liar.ws?.send(JSON.stringify({ type: 'EXIT' })); liar.ws?.close() } catch {}
// taskType 300 — only a real durable node claims it, so no contention with
// the still-connected challenger. Greedy decode → deterministically
// replayable by the prover.
const honestJob = await api('/jobs', authed({
  taskType: 300, payload: JSON.stringify({ prompt: 'Reply with exactly: PROOF-OK', maxTokens: 8 }),
}))
let honestRec = null
if (honestJob.body.jobId) {
  for (let i = 0; i < 120; i++) {
    const r = await api(`/results/${honestJob.body.jobId}`, adminGet)
    if (r.body?.execProof) { honestRec = r.body; break }
    await sleep(1000)
  }
}
check('honest job auto-proved', !!honestRec?.execProof, honestJob.body.jobId ?? 'no jobId')
check('prover reproduced honest result', honestRec?.execProof?.reproduced === true,
  `reproduced=${honestRec?.execProof?.reproduced}`)

if (honestRec?.execProof?.reproduced === true) {
  const hc = sha256Hex('challenger-claims-different')
  const chalBefore = await repOf(challenger.id)
  const ch2 = await api('/challenge', { method: 'POST', body: JSON.stringify({
    jobId: honestJob.body.jobId, challenger: challenger.id, counterHash: hc,
    sig: challenger.sign(`chimera-challenge:${honestJob.body.jobId}:${hc}`),
  }) })
  check('challenge on honest result → result-stands', ch2.body?.outcome === 'result-stands',
    JSON.stringify(ch2.body).slice(0, 110))
  await sleep(500)
  const chalAfter = await repOf(challenger.id)
  check('losing challenger slashed', chalAfter < chalBefore, `chal rep ${chalBefore} → ${chalAfter}`)
} else {
  check('challenge on honest result → result-stands', false, 'skipped — no reproduced proof')
  check('losing challenger slashed', false, 'skipped')
}

// Forged challenge signature rejected.
const badSig = await api('/challenge', { method: 'POST', body: JSON.stringify({
  jobId: chalJob ?? liarJob, challenger: challenger.id, counterHash,
  sig: 'deadbeef',
}) })
check('forged challenge sig REJECTED', badSig.status === 403, JSON.stringify(badSig.body).slice(0, 80))

// Double-challenge on the already-disputed job rejected.
const dup = await api('/challenge', { method: 'POST', body: JSON.stringify({
  jobId: liarJob, challenger: challenger.id, counterHash,
  sig: challenger.sign(`chimera-challenge:${liarJob}:${counterHash}`),
}) })
check('double-challenge REJECTED', dup.status === 409, JSON.stringify(dup.body).slice(0, 80))

console.log(`\n[test] ${pass} passed, ${fail} failed — deterministic-replay dispute game`)
try { liar.ws?.send(JSON.stringify({ type: 'EXIT' })); liar.ws?.close() } catch {}
try { challenger.ws?.send(JSON.stringify({ type: 'EXIT' })); challenger.ws?.close() } catch {}
process.exit(fail ? 1 : 0)
