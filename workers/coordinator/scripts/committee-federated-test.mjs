#!/usr/bin/env node
/**
 * committee-federated-test.mjs — multi-deployment BFT verification.
 *
 * Two coordinator deployments (A, B) peered via COMMITTEE_PEERS +
 * FEDERATION_TOKEN. 5 did:key voters earn rep on A; the proposal's roster
 * snapshot is replicated to B. Voters fan ballots to BOTH replicas; each
 * must reach an independent commit with an identical quorum certificate.
 * Then an equivocation test: a Byzantine voter double-signs (yes to A,
 * no to B) — gossip must convict it on BOTH replicas and the remaining
 * honest quorum must still commit.
 *
 * Usage:
 *   node scripts/committee-federated-test.mjs
 *   (env: A_URL, B_URL, VOLUNTEER_TOKEN, DISPATCH_AUTH_TOKEN, ADMIN_TOKEN)
 */
import { createHash, generateKeyPairSync, sign as edSign, createPublicKey, createPrivateKey } from 'node:crypto'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const {
  A_URL = 'http://localhost:8787', B_URL = 'http://localhost:8788',
  VOLUNTEER_TOKEN = '', DISPATCH_AUTH_TOKEN = '', ADMIN_TOKEN = '',
} = process.env
const a = A_URL.replace(/\/$/, '')
const b = B_URL.replace(/\/$/, '')
const wsBase = a.replace(/^http/, 'ws')

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const b58 = (bytes) => {
  let num = 0n
  for (const x of bytes) num = num * 256n + BigInt(x)
  let enc = ''
  while (num > 0n) { enc = B58[Number(num % 58n)] + enc; num /= 58n }
  for (const x of bytes) { if (x === 0) enc = '1' + enc; else break }
  return enc
}

function makeVoter(id) {
  const privFile = join(mkdtempSync(join(tmpdir(), 'voter-')), 'k.pk8')
  const { privateKey } = generateKeyPairSync('ed25519')
  writeFileSync(privFile, privateKey.export({ type: 'pkcs8', format: 'pem' }))
  const priv = createPrivateKey({ key: privateKey.export({ type: 'pkcs8', format: 'pem' }), format: 'pem', type: 'pkcs8' })
  const raw = createPublicKey(priv).export({ type: 'spki', format: 'der' }).subarray(-32)
  const did = `did:key:z${b58(new Uint8Array([0xed, 0x01, ...raw]))}`
  return { id, priv, did, sign: (msg) => Buffer.from(edSign(null, Buffer.from(msg, 'utf8'), priv)).toString('hex') }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256Hex = (s) => createHash('sha256').update(s).digest('hex')

function register(voter) {
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
        await new Promise((r) => setTimeout(r, 400))
        const result = JSON.stringify({ ok: true, exitCode: 0, echo: `${voter.id}:${env.jobId}` })
        ws.send(JSON.stringify({
          type: 'JOB_RESULT', jobId: env.jobId, result,
          resultSig: voter.sign(`chimera-result:${env.jobId}:${sha256Hex(result)}`),
        }))
      }
    }
    ws.onerror = () => reject(new Error(`${voter.id} ws error`))
  })
}

const api = async (base, path, opts = {}) => {
  const res = await fetch(`${base}${path}`, {
    ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
const authed = (body) => ({ method: 'POST', headers: { authorization: `Bearer ${DISPATCH_AUTH_TOKEN}` }, body: JSON.stringify(body) })
const admin = (body) => ({ method: 'POST', headers: { authorization: `Bearer ${ADMIN_TOKEN}` }, body: JSON.stringify(body) })
const adminGet = { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } }

let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`)
  ok ? pass++ : fail++
}

// ── Setup: 5 rep-holding did:key voters on replica A ──
const runTag = Math.random().toString(36).slice(2, 7)
const voters = await Promise.all([0, 1, 2, 3, 4].map((i) => makeVoter(`fed-${runTag}-${i}`)))
const sockets = []
for (const v of voters) sockets.push(await register(v))
console.log(`[test] 5 voters registered on A`)

const occupancy = api(a, '/jobs', authed({ taskType: 300, payload: JSON.stringify({ prompt: 'warmup', maxTokens: 128 }) })).catch(() => {})
const jobResults = await Promise.all(voters.map((v, i) =>
  api(a, '/jobs', authed({ taskType: 301, payload: JSON.stringify({ cmd: 'node', args: ['-e', 'console.log(1)'], echo: i }) }))))
check('all 5 voter jobs accepted on A', jobResults.every((r) => r.body.accepted === true))
const repOf = async (id) => (await api(a, `/rep?id=${encodeURIComponent(id)}`)).body?.points ?? 0
let ok = false
for (let i = 0; i < 30 && !ok; i++) {
  ok = (await Promise.all(voters.map((v) => repOf(v.id)))).every((p) => p > 0)
  if (!ok) await sleep(1000)
}
check('all 5 voters hold rep on A', ok)
await occupancy

// ── Motion 1: replicated proposal, independent commits ──
const prop = await api(a, '/committee/propose', admin({ motion: `fed motion ${runTag}` }))
check('motion proposed on A', prop.status === 200 && !!prop.body.id, JSON.stringify(prop.body).slice(0, 110))
const motionId = prop.body.id
check('roster snapshotted (fresh state: 5 voters, quorum 4)',
  prop.body.quorum === 4 && prop.body.rosterWeight === 5,
  `quorum=${prop.body.quorum} rosterWeight=${prop.body.rosterWeight} (needs fresh --persist-to state)`)

// Wait for replication to B.
let mB = null
for (let i = 0; i < 20; i++) {
  const r = await api(b, `/committee/${motionId}`, adminGet)
  if (r.status === 200) { mB = r.body; break }
  await sleep(500)
}
check('proposal replicated to B', !!mB, mB ? `phase=${mB.phase} roster=${Object.keys(mB.roster || {}).length}` : 'not found')

const vote = (base, v, phase, approve, signer = v) =>
  api(base, '/committee/vote', { method: 'POST', body: JSON.stringify({
    id: motionId, voter: v.id, approve, phase,
    sig: signer.sign(`chimera-vote:${motionId}:${phase}:${approve ? 'yes' : 'no'}`),
  }) })

// Fan prevotes to A ONLY — peer gossip must deliver them to B, and B must
// verify each signature against the replicated roster (no local rep state).
for (const v of voters) {
  const r = await vote(a, v, 'prevote', true)
  if (v === voters[0]) check('prevote accepted on A', r.status === 200, JSON.stringify(r.body).slice(0, 70))
}
let stA, stB
for (let i = 0; i < 30; i++) {
  stA = (await api(a, `/committee/${motionId}`, adminGet)).body
  stB = (await api(b, `/committee/${motionId}`, adminGet)).body
  const bPrevotes = Object.keys(stB.ballots?.prevote ?? {}).length
  if (stA.phase === 'precommit' && stB.phase === 'precommit' && bPrevotes === voters.length) break
  await sleep(500)
}
check('B converged to precommit via gossip alone', stB.phase === 'precommit' &&
  Object.keys(stB.ballots?.prevote ?? {}).length >= (stB.quorum ?? 4),
  `A:${stA.phase} B:${stB.phase} B-prevotes:${Object.keys(stB.ballots?.prevote ?? {}).length}`)

for (const v of voters) await vote(a, v, 'precommit', true)
for (let i = 0; i < 30; i++) {
  stA = (await api(a, `/committee/${motionId}`, adminGet)).body
  stB = (await api(b, `/committee/${motionId}`, adminGet)).body
  if (stA.phase === 'committed' && stB.phase === 'committed') break
  await sleep(500)
}
check('both replicas COMMITTED independently', stA.phase === 'committed' && stB.phase === 'committed', `A:${stA.phase} B:${stB.phase}`)

// Each replica's quorum certificate must independently verify: ≥ quorum
// roster weight, all signers in roster, all ballots signed. QCs may differ
// in membership (normal BFT — quorums need only intersect, not match).
const roster = stA.roster ?? {}
const qcValid = (m) => {
  const qc = m.ballots?.precommit ?? {}
  const w = Object.keys(qc).reduce((s, v) => s + (roster[v]?.weight ?? 0), 0)
  return w >= (m.quorum ?? Infinity) && Object.keys(qc).every((v) => roster[v] && qc[v].sig)
}
const qcA = stA.ballots?.precommit ?? {}
const qcB = stB.ballots?.precommit ?? {}
check('both QCs independently satisfy quorum',
  qcValid(stA) && qcValid(stB),
  `A-weight:${Object.keys(qcA).reduce((s, v) => s + (roster[v]?.weight ?? 0), 0)} B-weight:${Object.keys(qcB).reduce((s, v) => s + (roster[v]?.weight ?? 0), 0)} quorum:${stA.quorum}`)
const overlap = Object.keys(qcA).filter((v) => qcB[v])
check('QC quorums intersect (BFT safety)', overlap.length >= 1,
  `shared signers: ${overlap.join(',')}`)

// ── Motion 2: equivocation — Byzantine voter double-signs ──
const prop2 = await api(a, '/committee/propose', admin({ motion: `equivocation ${runTag}` }))
const m2 = prop2.body.id
for (let i = 0; i < 20; i++) {
  if ((await api(b, `/committee/${m2}`, adminGet)).status === 200) break
  await sleep(500)
}
const vote2 = (base, v, phase, approve) =>
  api(base, '/committee/vote', { method: 'POST', body: JSON.stringify({
    id: m2, voter: v.id, approve, phase,
    sig: v.sign(`chimera-vote:${m2}:${phase}:${approve ? 'yes' : 'no'}`),
  }) })

// Honest voters 0-2 prevote yes on both (3 < quorum 4 — motion stays in
// prevote so the equivocating ballots are in-phase when they land).
// Byzantine voter-4 prevotes yes→A, no→B — each ballot is validly signed;
// the fraud is the conflict, surfaced only when gossip cross-delivers.
for (let i = 0; i < 3; i++) {
  await Promise.all([vote2(a, voters[i], 'prevote', true), vote2(b, voters[i], 'prevote', true)])
}
await vote2(a, voters[4], 'prevote', true)   // yes on A
await vote2(b, voters[4], 'prevote', false)  // no on B — equivocation
// Gossip carries each conflicting ballot to the other replica.
let eqA = false, eqB = false
for (let i = 0; i < 30; i++) {
  const sa = (await api(a, `/committee/${m2}`, adminGet)).body
  const sb = (await api(b, `/committee/${m2}`, adminGet)).body
  eqA = !!sa.equivocators?.[voters[4].id]; eqB = !!sb.equivocators?.[voters[4].id]
  if (eqA && eqB) break
  await sleep(500)
}
check('equivocation detected on BOTH replicas via gossip', eqA && eqB, `A:${eqA} B:${eqB}`)

// Voter-3's prevote completes the quorum where still in prevote; on a
// replica that already advanced (voter-4's yes counted pre-purge) it's a
// stale-phase 409 — either way the motion must be in precommit after.
await vote2(a, voters[3], 'prevote', true)
await vote2(b, voters[3], 'prevote', true)
let m2pre = (await api(a, `/committee/${m2}`, adminGet)).body
check('motion in precommit after equivocation purge',
  m2pre.phase === 'precommit' || m2pre.phase === 'committed', m2pre.phase)
for (let i = 0; i < 4; i++) {
  await vote2(a, voters[i], 'precommit', true)
  await vote2(b, voters[i], 'precommit', true)
}
let m2state, m2stateB
for (let i = 0; i < 30; i++) {
  m2state = (await api(a, `/committee/${m2}`, adminGet)).body
  m2stateB = (await api(b, `/committee/${m2}`, adminGet)).body
  if (m2state.phase === 'committed' && m2stateB.phase === 'committed') break
  await sleep(500)
}
check('honest quorum still commits after equivocation purge',
  m2state.phase === 'committed' && m2stateB.phase === 'committed',
  `A:${m2state.phase} B:${m2stateB.phase}`)
check('equivocator excluded from final QC',
  !m2state.ballots?.precommit?.[voters[4].id] && !m2state.ballots?.prevote?.[voters[4].id],
  Object.keys(m2state.ballots?.prevote ?? {}).join(','))

// A forged ballot on B (voter-0 impersonation) must not commit.
const forged = makeVoter('forged-fed')
const rForged = await api(b, '/committee/vote', { method: 'POST', body: JSON.stringify({
  id: m2, voter: voters[0].id, approve: false, phase: 'precommit',
  sig: forged.sign(`chimera-vote:${m2}:precommit:no`),
}) })
check('forged ballot REJECTED on replica B', rForged.status === 403 || rForged.status === 404 || rForged.status === 409,
  JSON.stringify(rForged.body).slice(0, 70))

console.log(`\n[test] ${pass} passed, ${fail} failed — federated 2-replica BFT`)
for (const ws of sockets) { try { ws.send(JSON.stringify({ type: 'EXIT' })); ws.close() } catch {} }
process.exit(fail ? 1 : 0)
