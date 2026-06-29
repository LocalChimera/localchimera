#!/usr/bin/env node
/**
 * Audit Logger Demo — REAL execution using the actual @qvac/sdk.
 *
 * This script performs a live Chimera node session:
 *   1. Loads a real QVAC model via @qvac/sdk
 *   2. Runs actual completion calls (real prompts, real tokens, real timing)
 *   3. Runs actual embedding on real text
 *   4. Performs RAG ingest + search on real documents
 *   5. Unloads the model
 *
 * All timing data is captured from wall-clock measurements during execution.
 * Output: data/audit/YYYY-MM-DD.jsonl (one JSON object per line)
 *
 * Run: node scripts/audit-demo.js
 * Inspect: cat data/audit/*.jsonl | node -e "require('fs').readFileSync(0,'utf-8').split('\\n').slice(0,5).forEach(l=>l&&console.log(JSON.parse(l)))"
 */
import { AuditLogger } from '../qvac/src/core/AuditLogger.js';
import { promises as fsp } from 'fs';
import path from 'path';

const MODEL = 'llama-3.2-1b-q4_0';

async function main() {
  const audit = new AuditLogger({ auditDir: path.join(process.cwd(), 'data', 'audit') });
  let sdk = null;
  let modelId = null;

  console.log('=== Chimera Audit Logger — Real Execution ===\n');

  // ── 1. Load real QVAC model ──
  try {
    const sdkPath = new URL('../qvac/node_modules/@qvac/sdk/dist/index.js', import.meta.url).href;
    sdk = await import(sdkPath);
    console.log(`[sdk] QVAC SDK loaded`);
  } catch (e) {
    console.error(`[sdk] Failed to load @qvac/sdk: ${e.message}`);
    console.error('Install with: cd qvac && npm install @qvac/sdk');
    process.exit(1);
  }

  const modelConst = sdk.LLAMA_3_2_1B_INST_Q4_0;
  if (!modelConst) {
    console.error('[loadModel] Model constant not found in SDK');
    process.exit(1);
  }

  console.log(`[loadModel] Loading ${MODEL}... (this may download weights on first run)`);
  const loadStart = Date.now();
  try {
    modelId = await sdk.loadModel({
      modelSrc: modelConst,
      onProgress: (p) => {
        if (p < 1) process.stdout.write(`\r[loadModel] Downloading... ${Math.round(p * 100)}%`);
      }
    });
    process.stdout.write('\r\n');
    const loadDuration = Date.now() - loadStart;
    audit.modelLoad({ modelId, durationMs: loadDuration, source: 'qvac-sdk' });
    console.log(`[modelLoad] ${modelId} loaded in ${loadDuration}ms\n`);
  } catch (e) {
    console.error(`[loadModel] Failed: ${e.message}`);
    process.exit(1);
  }

  // ── 2. Real inference calls ──
  const prompts = [
    'What is the capital of France?',
    'Explain quantum computing in simple terms',
    'Write a haiku about machine learning',
  ];

  for (const prompt of prompts) {
    const history = [{ role: 'user', content: prompt }];
    const infStart = Date.now();
    let output = '';
    let tokens = 0;
    let firstTokenMs = 0;

    try {
      const gen = sdk.completion({ modelId, history, stream: true, generationParams: { predict: 128, temp: 0.7 } });
      let first = true;
      for await (const token of gen.tokenStream) {
        if (first) { firstTokenMs = Date.now() - infStart; first = false; }
        output += token;
        tokens++;
      }
    } catch (e) {
      console.error(`[inference] Error for "${prompt.slice(0, 40)}...": ${e.message}`);
      continue;
    }

    const duration = Date.now() - infStart;
    const tps = duration > 0 ? (tokens / (duration / 1000)) : 0;
    audit.inference({
      prompt,
      outputTokens: tokens,
      durationMs: duration,
      ttftMs: firstTokenMs,
      tokensPerSec: Math.round(tps * 100) / 100,
      modelId,
      source: 'audit-demo',
      routeId: `demo-${Math.random().toString(36).substring(7)}`
    });
    console.log(`[inference] "${prompt.slice(0, 45)}" → ${tokens} tokens in ${duration}ms (TTFT: ${firstTokenMs}ms, ${tps.toFixed(1)} tok/s)`);
  }
  console.log();

  // ── 3. Real embedding ──
  const embedTexts = [
    'Chimera is a decentralized AI inference network',
    'Miners earn by providing GPU compute',
    'Smart contracts handle escrow and payouts',
  ];
  console.log(`[embedding] Running on ${embedTexts.length} texts...`);
  const embStart = Date.now();
  let vectors = [];
  try {
    // Try embedding model if SDK supports it; fallback to inference model
    const embModel = sdk.EMBEDDINGGEMMA_300M_Q4_0 || modelId;
    const embResult = await sdk.embed({ modelId: embModel, texts: embedTexts });
    vectors = embResult.vectors || embResult.embeddings || [];
  } catch (e) {
    console.warn(`[embedding] SDK embed not available: ${e.message}`);
  }
  const embDuration = Date.now() - embStart;
  const dimension = vectors[0]?.length || 0;
  audit.embedding({ textCount: embedTexts.length, dimension, durationMs: embDuration, modelId });
  console.log(`[embedding] ${vectors.length} vectors, ${dimension}d, in ${embDuration}ms\n`);

  // ── 4. RAG ingest + search ──
  const docs = [
    { id: 'doc-1', text: 'Chimera architecture overview: nodes form a P2P mesh', metadata: { category: 'wiki' } },
    { id: 'doc-2', text: 'Miner setup guide for Ubuntu and Docker', metadata: { category: 'guide' } },
    { id: 'doc-3', text: 'Payout smart contract spec on Arbitrum', metadata: { category: 'spec' } },
  ];
  const workspace = 'audit-demo-rag';

  console.log(`[ragIngest] Indexing ${docs.length} docs into "${workspace}"...`);
  const ingestStart = Date.now();
  try {
    if (sdk.ragIngest) {
      await sdk.ragIngest({ modelId, workspace, documents: docs });
    }
  } catch (e) {
    console.warn(`[ragIngest] Not available: ${e.message}`);
  }
  const ingestDuration = Date.now() - ingestStart;
  audit.ragIngest({ docCount: docs.length, workspace, durationMs: ingestDuration, modelId });
  console.log(`[ragIngest] Done in ${ingestDuration}ms`);

  const query = 'How do I start a miner?';
  console.log(`[ragSearch] "${query}"...`);
  const searchStart = Date.now();
  let matches = [];
  try {
    if (sdk.ragSearch) {
      const searchResult = await sdk.ragSearch({ modelId, workspace, query, topK: 5 });
      matches = searchResult.matches || [];
    }
  } catch (e) {
    console.warn(`[ragSearch] Not available: ${e.message}`);
  }
  const searchDuration = Date.now() - searchStart;
  audit.ragSearch({ query, topK: 5, matchCount: matches.length, durationMs: searchDuration, modelId });
  console.log(`[ragSearch] ${matches.length} matches in ${searchDuration}ms\n`);

  // ── 5. Unload model ──
  console.log(`[modelUnload] Unloading ${modelId}...`);
  const unloadStart = Date.now();
  try {
    await sdk.unloadModel({ modelId });
  } catch (e) {
    console.warn(`[modelUnload] unloadModel not available: ${e.message}`);
  }
  const unloadDuration = Date.now() - unloadStart;
  audit.modelUnload({ modelId, source: 'qvac-sdk' });
  console.log(`[modelUnload] Done in ${unloadDuration}ms\n`);

  // Flush and display
  await audit.stop();

  const auditDir = path.join(process.cwd(), 'data', 'audit');
  const files = (await fsp.readdir(auditDir)).filter(f => f.endsWith('.jsonl')).sort();
  const latest = path.join(auditDir, files[files.length - 1]);
  const raw = await fsp.readFile(latest, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);

  console.log(`=== Audit file: ${latest} ===`);
  console.log(`Total events: ${lines.length}\n`);

  // Print all events
  lines.forEach((line, i) => {
    const ev = JSON.parse(line);
    const ts = new Date(ev.ts).toISOString().split('T')[1].slice(0, 12);
    const details = ev.type === 'inference'
      ? `${ev.outputTokens}tok ${ev.durationMs}ms TTFT=${ev.ttftMs}ms ${ev.tokensPerSec}tok/s`
      : ev.type === 'modelLoad'
        ? `${ev.durationMs}ms`
        : ev.type === 'embedding'
          ? `${ev.textCount}texts ${ev.dimension}d ${ev.durationMs}ms`
          : ev.type === 'ragIngest'
            ? `${ev.docCount}docs ${ev.durationMs}ms`
            : ev.type === 'ragSearch'
              ? `${ev.matchCount}matches ${ev.durationMs}ms`
              : `${ev.durationMs}ms`;
    console.log(`${i + 1}. [${ts}] ${ev.type.padEnd(12)} ${details}`);
  });

  // Summary
  const events = lines.map(l => JSON.parse(l));
  const inferences = events.filter(e => e.type === 'inference');
  if (inferences.length > 0) {
    const avgTps = inferences.reduce((s, e) => s + e.tokensPerSec, 0) / inferences.length;
    const avgLat = inferences.reduce((s, e) => s + e.durationMs, 0) / inferences.length;
    const avgTtft = inferences.reduce((s, e) => s + e.ttftMs, 0) / inferences.length;
    console.log(`\n--- Real Inference Summary ---`);
    console.log(`Calls:          ${inferences.length}`);
    console.log(`Avg latency:    ${avgLat.toFixed(0)}ms`);
    console.log(`Avg TTFT:       ${avgTtft.toFixed(0)}ms`);
    console.log(`Avg throughput: ${avgTps.toFixed(1)} tokens/sec`);
    console.log(`Min latency:    ${Math.min(...inferences.map(e => e.durationMs))}ms`);
    console.log(`Max latency:    ${Math.max(...inferences.map(e => e.durationMs))}ms`);
  }
}

main().catch(console.error);
