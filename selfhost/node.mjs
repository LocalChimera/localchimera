#!/usr/bin/env node
/**
 * Chimera durable node — selfhosted volunteer daemon (RPi/NAS/VPS).
 * Registers as a durable volunteer (swarm-tier groundwork), serves
 * WEB_FETCH / STORAGE-pin / CANARY jobs. No deps — Node ≥22 (global
 * WebSocket + fetch). Infer lanes need the extension or browser node.
 *
 * Usage:
 *   CHIMERA_COORDINATOR=wss://coordinator.example.com \
 *   CHIMERA_TOKEN=widespread-volunteer \
 *   CHIMERA_PROJECT=my-project \
 *   node node.mjs
 *
 * State dir: $CHIMERA_STATE (default ~/.chimera-node) holds volunteerId +
 * pins. Revoke/wipe = delete the dir + the coordinator-side ledger entry.
 */
import { createHash } from 'node:crypto'
import { writeFile, readFile, mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const COORD = process.env.CHIMERA_COORDINATOR || ''
const TOKEN = process.env.CHIMERA_TOKEN || 'widespread-volunteer'
const PROJECT = process.env.CHIMERA_PROJECT || ''
const SITE = process.env.CHIMERA_SITE || ''
const SHARD_CAPACITY = Number(process.env.CHIMERA_SHARD_CAPACITY || '1')
const STATE = process.env.CHIMERA_STATE || join(homedir(), '.chimera-node')
const MAX_PIN_MB = Number(process.env.CHIMERA_MAX_PIN_MB || '64')

if (!COORD) { console.error('CHIMERA_COORDINATOR required'); process.exit(1) }

await mkdir(STATE, { recursive: true })
await mkdir(join(STATE, 'pins'), { recursive: true })
const IDFILE = join(STATE, 'volunteer-id')
let volunteerId
try { volunteerId = (await readFile(IDFILE, 'utf8')).trim() } catch { volunteerId = crypto.randomUUID(); await writeFile(IDFILE, volunteerId) }

const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex')
let ws = null, heartbeat = null, jobsDone = 0

function send(m) { ws?.readyState === 1 && ws.send(JSON.stringify(m)) }

async function webFetch(payload, jobId) {
  const spec = JSON.parse(payload)
  if (spec.inject) {
    // Brokered fetch — coordinator attaches sealed creds at the boundary.
    const r = await fetch(`${COORD.replace(/^ws/, 'http')}/proxy/fetch`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId, volunteerId }),
    }).then((x) => x.json())
    if (r.error) throw new Error(`proxy: ${r.error}`)
    return JSON.stringify({ bodyHash: r.bodyHash, bytes: r.bytes })
  }
  const u = new URL(spec.url)
  if (u.protocol !== 'https:') throw new Error('https-only')
  const res = await fetch(u, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`http ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > 1_048_576) throw new Error('body >1MB')
  return JSON.stringify({ bodyHash: sha256hex(buf), bytes: buf.byteLength })
}

async function pinJob(payload) {
  const { url, expectHash } = JSON.parse(payload)
  const u = new URL(url)
  if (u.protocol !== 'https:') throw new Error('https-only')
  const res = await fetch(u)
  if (!res.ok) throw new Error(`http ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > MAX_PIN_MB * 1_048_576) throw new Error('pin too large')
  const cid = sha256hex(buf)
  if (expectHash && expectHash !== cid) throw new Error('hash mismatch')
  await writeFile(join(STATE, 'pins', cid), buf)
  return JSON.stringify({ cid, verified: true })
}

async function onJob(msg) {
  try {
    let result
    if (msg.taskType === 206) result = JSON.parse(msg.requestHash).nonce
    else if (msg.taskType === 205) result = await webFetch(msg.requestHash, msg.jobId)
    else if (msg.taskType === 1) result = await pinJob(msg.requestHash)
    else throw new Error(`unsupported taskType ${msg.taskType}`)
    jobsDone++
    send({ type: 'JOB_RESULT', jobId: msg.jobId, result })
    console.log(`[node] job ${msg.jobId.slice(0, 18)} done (${jobsDone} total)`)
  } catch (e) {
    send({ type: 'JOB_REJECTED', jobId: msg.jobId, reason: String(e).slice(0, 120) })
  }
}

function connect() {
  ws = new WebSocket(`${COORD}?token=${encodeURIComponent(TOKEN)}`)
  ws.onopen = () => {
    send({
      type: 'REGISTER', volunteerId,
      site: SITE || undefined, project: PROJECT || undefined,
      taskTypes: [1, 205, 206],
      capabilities: { cpuCores: 4, ramGb: 4 },
      durable: true, shardCapacity: SHARD_CAPACITY,
    })
    console.log(`[node] registered ${volunteerId} (durable, capacity=${SHARD_CAPACITY})`)
    heartbeat = setInterval(() => send({ type: 'HEARTBEAT' }), 25_000)
  }
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.type === 'JOB_DISPATCH') onJob(msg)
    if (msg.type === 'REGISTERED') volunteerId = msg.volunteerId
  }
  ws.onclose = () => { clearInterval(heartbeat); setTimeout(connect, 5000) }
  ws.onerror = () => ws.close()
}

connect()
console.log(`[node] chimera durable node — coordinator=${COORD} project=${PROJECT || 'global'} state=${STATE}`)
