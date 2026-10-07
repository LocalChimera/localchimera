#!/usr/bin/env node
/**
 * market-research.mjs — cron-able demand submitter.
 *
 * Reads a topics list and submits MARKET_RESEARCH (taskType 201) jobs to the
 * coordinator, then fetches results with the per-job resultToken and writes a
 * dated report to disk. This is the demand-side analog of a trading daemon:
 * agents generate paid work; supporters execute; the report is the artifact.
 *
 * Usage:
 *   COORDINATOR=https://coord.example.com \
 *   DISPATCH_TOKEN=... \
 *   TOPICS_FILE=./topics.txt \
 *   PROJECT=my-project \
 *   node market-research.mjs
 *
 * topics.txt — one research question per line (# comments allowed).
 * Env: AMOUNT_WEI (per-job, default 1000 = $0.001 micro-USDC semantics),
 *      OUT_DIR (default ./reports), TIMEOUT_MS per result fetch (default 5m).
 *
 * Cron: 0 6 * * *  cd /path && node market-research.mjs >> run.log 2>&1
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'

const COORD = (process.env.COORDINATOR || 'http://localhost:8787').replace(/\/$/, '')
const TOKEN = process.env.DISPATCH_TOKEN || ''
const PROJECT = process.env.PROJECT
const AMOUNT = process.env.AMOUNT_WEI || '1000'
const OUT_DIR = process.env.OUT_DIR || './reports'
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 300_000)
const POLL_MS = 5000

const topicsFile = process.env.TOPICS_FILE
if (!topicsFile) {
  console.error('TOPICS_FILE required — one research question per line')
  process.exit(1)
}
const topics = readFileSync(topicsFile, 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
if (!topics.length) { console.error('no topics in', topicsFile); process.exit(1) }

const headers = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }
const post = (path, body) =>
  fetch(`${COORD}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
    .then((r) => r.json())

// One batch call for the whole topic list — results are fetched per-job with
// the issued resultToken, so no admin access is needed.
const { results } = await post('/jobs/batch', {
  jobs: topics.map((t) => ({
    taskType: 201, // MARKET_RESEARCH
    payload: JSON.stringify({ question: t }),
    amountWei: AMOUNT,
    project: PROJECT,
    priority: 'batch',
  })),
})

mkdirSync(OUT_DIR, { recursive: true })
const day = new Date().toISOString().slice(0, 10)
const report = { date: day, project: PROJECT ?? null, entries: [] }

for (const [i, item] of (results || []).entries()) {
  const topic = topics[i]
  if (!item?.jobId) { report.entries.push({ topic, error: item?.error ?? 'rejected' }); continue }
  const deadline = Date.now() + TIMEOUT_MS
  let result = null
  while (Date.now() < deadline) {
    const r = await fetch(`${COORD}/results/${item.jobId}?token=${item.resultToken}`)
    if (r.ok) { result = (await r.json()).result; break }
    await new Promise((r2) => setTimeout(r2, POLL_MS))
  }
  report.entries.push({
    topic, jobId: item.jobId,
    result: result ? JSON.parse(result) : null,
    timedOut: !result,
  })
  console.log(`${result ? '✓' : '✗'} ${topic}`)
}

const out = `${OUT_DIR}/research-${day}.json`
writeFileSync(out, JSON.stringify(report, null, 2))
console.log(`wrote ${out} — ${report.entries.filter((e) => e.result).length}/${topics.length} answered`)
