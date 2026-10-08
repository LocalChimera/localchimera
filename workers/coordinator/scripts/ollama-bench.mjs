#!/usr/bin/env node
/**
 * ollama-bench.mjs — external baseline for the swarm's inference lane.
 *
 * Measures the SAME workload (same prompt, same max_new_tokens, greedy
 * decode, ~0.5B instruct model) through three paths:
 *   1. Ollama        — the incumbent local-inference daemon (GGUF, /api/generate)
 *   2. direct        — transformers.js ONNX in-process (what a swarm node runs)
 *   3. pool          — the same model dispatched through the coordinator's
 *                      taskType-300 lane (queue + WS dispatch + result return)
 *
 *   node scripts/ollama-bench.mjs            # all three legs
 *   SKIP_POOL=1 …                            # offline-coordinator runs
 */
import { performance } from 'node:perf_hooks'

const {
  OLLAMA_URL = 'http://localhost:11434',
  OLLAMA_MODEL = 'qwen2.5:0.5b',
  COORDINATOR_URL = 'http://localhost:8787',
  DISPATCH_AUTH_TOKEN = '',
  RUNS = '6',
  PROMPT = 'Say hi in 3 words',
  MAX_TOKENS = '8',
  SKIP_POOL = '',
  SKIP_DIRECT = '',
} = process.env

const N = parseInt(RUNS, 10)
const ms = (t0) => Math.round(performance.now() - t0)
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return { n: s.length, min: s[0], p50: s[Math.floor(s.length / 2)], max: s[s.length - 1], mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length) }
}

// ── 1. Ollama ──────────────────────────────────────────────────────────
async function ollamaRun(keepAlive) {
  const t0 = performance.now()
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL, prompt: PROMPT, stream: false,
      keep_alive: keepAlive, // '0' forces a cold load each call
      options: { num_predict: parseInt(MAX_TOKENS, 10), temperature: 0 },
    }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`ollama ${res.status}: ${JSON.stringify(body)}`)
  return { ms: ms(t0), text: body.response, evalCount: body.eval_count, evalMs: (body.eval_duration ?? 0) / 1e6, loadMs: (body.load_duration ?? 0) / 1e6 }
}

// ── 2. Direct transformers.js (the executor a durable node runs) ───────
async function directRuns() {
  const tf = await import('@huggingface/transformers')
  const t0 = performance.now()
  const pipe = await tf.pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct', { dtype: 'q4' })
  const loadMs = ms(t0)
  const out = []
  for (let i = 0; i < N; i++) {
    const s = performance.now()
    const r = await pipe(PROMPT, { max_new_tokens: parseInt(MAX_TOKENS, 10), do_sample: false })
    out.push({ ms: ms(s), text: r[0]?.generated_text })
  }
  return { loadMs, runs: out }
}

// ── 3. Pool dispatch (coordinator → durable node → result) ─────────────
async function poolRun() {
  const t0 = performance.now()
  const res = await fetch(`${COORDINATOR_URL}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${DISPATCH_AUTH_TOKEN}` },
    body: JSON.stringify({ taskType: 300, payload: JSON.stringify({ prompt: PROMPT, maxTokens: parseInt(MAX_TOKENS, 10) }) }),
  })
  const body = await res.json()
  return { ms: ms(t0), accepted: body.accepted, text: body.result?.result }
}

console.log(`[bench] model≈Qwen2.5-0.5B instruct, prompt=${JSON.stringify(PROMPT)}, max_tokens=${MAX_TOKENS}, N=${N}\n`)

// Ollama cold start — keep_alive:0 unloads, so the first call pays load.
console.log('── ollama ──')
const cold = await ollamaRun('0')
console.log(`cold  ${cold.ms}ms (load ${Math.round(cold.loadMs)}ms + eval ${Math.round(cold.evalMs)}ms) → ${JSON.stringify(cold.text?.slice(0, 60))}`)
const oWarm = []
for (let i = 0; i < N; i++) oWarm.push(await ollamaRun('5m'))
console.log('warm ', JSON.stringify(stats(oWarm.map((r) => r.ms))))
console.log(`      text=${JSON.stringify(oWarm[0].text?.slice(0, 60))} evalCount=${oWarm[0].evalCount}`)

if (!SKIP_DIRECT) {
  console.log('── direct transformers.js (swarm executor, in-process) ──')
  const d = await directRuns()
  console.log(`model load ${d.loadMs}ms`)
  console.log('warm ', JSON.stringify(stats(d.runs.map((r) => r.ms))))
  console.log(`      text=${JSON.stringify(d.runs[0].text?.slice(0, 60))}`)
}

if (!SKIP_POOL) {
  console.log('── pool dispatch (taskType 300) ──')
  const p = []
  for (let i = 0; i < N; i++) {
    const r = await poolRun()
    if (!r.accepted) { console.log(`      job ${i} not accepted — queue empty?`); break }
    p.push(r)
  }
  if (p.length) {
    console.log('warm ', JSON.stringify(stats(p.map((r) => r.ms))))
    console.log(`      text=${JSON.stringify(p[0].text?.slice(0, 60))}`)
  }
}
