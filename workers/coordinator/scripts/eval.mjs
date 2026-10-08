#!/usr/bin/env node
/**
 * Eval harness — measures real coordinator throughput/latency so docs cite
 * measured numbers, not estimates. Fires N AGENT_INFER jobs at /jobs (which
 * resolves inline with the result once a node completes), times each, then
 * reports percentiles + accept rate.
 *
 * Usage:
 *   COORDINATOR_URL=https://coordinator.example.com \
 *   DISPATCH_AUTH_TOKEN=... \
 *   node scripts/eval.mjs [count] [timeoutSec] [concurrency] [taskType] [payloadTemplate]
 *
 * payloadTemplate is a JSON-string template — `{i}` interpolates the job
 * index. Defaults to an AGENT_INFER-shaped {prompt}. For BUILD_VERIFY:
 *   node eval.mjs 10 60 4 301 '{"cmd":"node","args":["-e","console.log({i})"]}'
 *
 * Caveat: each /jobs call holds until result-or-timeout (coordinator's
 * JOB_RESULT_TIMEOUT_MS), so per-job latency includes queue wait.
 */
const COORD = (process.env.COORDINATOR_URL || 'http://localhost:8787').replace(/\/$/, '')
const TOKEN = process.env.DISPATCH_AUTH_TOKEN
const N = Number(process.argv[2]) || 10
const TIMEOUT_S = Number(process.argv[3]) || 120
const CONC = Number(process.argv[4]) || N
const TASK_TYPE = Number(process.argv[5]) || 200
const PAYLOAD_TPL = process.argv[6] || '{"prompt":"eval-{i}: reply with the single word ok"}'

if (!TOKEN) { console.error('DISPATCH_AUTH_TOKEN required'); process.exit(1) }

const auth = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }

async function oneJob(i) {
  const t0 = Date.now()
  try {
    const r = await fetch(`${COORD}/jobs`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        taskType: TASK_TYPE,
        payload: PAYLOAD_TPL.replaceAll('{i}', String(i)),
        priority: 'batch',
      }),
      signal: AbortSignal.timeout(TIMEOUT_S * 1000),
    })
    const ms = Date.now() - t0
    if (!r.ok) return { i, ms, ok: false, status: r.status }
    const j = await r.json()
    return { i, ms, ok: !!j.accepted && j.result != null, accepted: !!j.accepted }
  } catch (e) {
    return { i, ms: Date.now() - t0, ok: false, error: String(e).slice(0, 80) }
  }
}

const t0 = Date.now()
const results = []
for (let off = 0; off < N; off += CONC) {
  results.push(...await Promise.all(
    Array.from({ length: Math.min(CONC, N - off) }, (_, k) => oneJob(off + k))))
}
const elapsed = Date.now() - t0

const ok = results.filter((r) => r.ok)
const lat = ok.map((r) => r.ms).sort((a, b) => a - b)
const pct = (p) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * p / 100))] : null
const status = await fetch(`${COORD}/status`).then((r) => r.json()).catch(() => null)

console.log('\n=== eval results ===')
console.log(`jobs: ${N}  concurrency: ${CONC}  timeout: ${TIMEOUT_S}s`)
console.log(`completed: ${ok.length}  accepted: ${results.filter((r) => r.accepted).length}  failed: ${results.length - ok.length}`)
if (lat.length) {
  console.log(`latency ms — p50: ${pct(50)}  p95: ${pct(95)}  min: ${lat[0]}  max: ${lat[lat.length - 1]}`)
}
console.log(`wall: ${(elapsed / 1000).toFixed(1)}s  throughput: ${(ok.length / (elapsed / 1000)).toFixed(2)} jobs/s`)
if (status) console.log('status:', JSON.stringify(status))
const fails = results.filter((r) => !r.ok).slice(0, 5)
if (fails.length) console.log('sample failures:', JSON.stringify(fails))
