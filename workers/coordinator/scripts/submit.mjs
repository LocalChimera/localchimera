#!/usr/bin/env node
/**
 * submit.mjs — generic job submitter for daemons (trading bots, cron agents).
 *
 * Reads a JSON job spec on stdin or from --file, dispatches it to the
 * coordinator, then polls for the result with the returned resultToken and
 * prints it to stdout. This is the minimal demand-side integration: any
 * daemon that can write JSON and read stdout can use the pool.
 *
 * Spec shape:
 *   { "taskType": 200,                      // AGENT_INFER (default)
 *     "payload": "<string or object>",      // object → JSON.stringify'd
 *     "project": "my-project",              // optional pool slug
 *     "amountWei": "1000",                  // optional micro-USDC
 *     "priority": "batch",                  // optional; default interactive
 *     "domain": "code",                     // optional lane tag
 *     "classification": "PUBLIC" }          // only PUBLIC is accepted
 *
 * Usage:
 *   COORDINATOR_URL=https://coordinator.example.com \
 *   DISPATCH_AUTH_TOKEN=... \
 *   node scripts/submit.mjs --file job.json
 *   echo '{"payload":{"prompt":"hi"}}' | node scripts/submit.mjs
 *
 * Exit codes: 0 = result on stdout, 1 = submission/result error.
 */
import { readFileSync } from 'node:fs'

const COORD = (process.env.COORDINATOR_URL || 'http://localhost:8787').replace(/\/$/, '')
const TOKEN = process.env.DISPATCH_AUTH_TOKEN
const POLL_MS = 3000
const TIMEOUT_MS = Number(process.env.RESULT_TIMEOUT_MS || 300_000)

if (!TOKEN) { console.error('DISPATCH_AUTH_TOKEN required'); process.exit(1) }

const fileIdx = process.argv.indexOf('--file')
const raw = fileIdx >= 0 ? readFileSync(process.argv[fileIdx + 1], 'utf8')
  : await new Promise((res) => {
      let d = ''
      process.stdin.on('data', (c) => (d += c))
      process.stdin.on('end', () => res(d))
    })
const spec = JSON.parse(raw)
const payload = typeof spec.payload === 'string' ? spec.payload : JSON.stringify(spec.payload ?? {})

const auth = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }
const sub = await fetch(`${COORD}/jobs`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    payload,
    taskType: spec.taskType ?? 200,
    project: spec.project,
    amountWei: spec.amountWei,
    priority: spec.priority,
    domain: spec.domain,
    classification: spec.classification || 'PUBLIC',
  }),
}).then((r) => r.json())

if (!sub.jobId) { console.error('submit failed:', JSON.stringify(sub)); process.exit(1) }
console.error(`dispatched ${sub.jobId}`)

// Result polling — the submit response carries a per-job resultToken; the
// coordinator serves /results/<jobId>?token= to that holder (or ADMIN_TOKEN).
const deadline = Date.now() + TIMEOUT_MS
while (Date.now() < deadline) {
  const r = await fetch(
    `${COORD}/results/${sub.jobId}?token=${encodeURIComponent(sub.resultToken)}`)
  if (r.ok) {
    const body = await r.json().catch(() => null)
    console.log(typeof body?.result === 'string' ? body.result : JSON.stringify(body))
    process.exit(0)
  }
  if (r.status !== 404) {
    console.error(`result fetch: HTTP ${r.status}`); process.exit(1)
  }
  await new Promise((res) => setTimeout(res, POLL_MS))
}
console.error('result timeout')
process.exit(1)
