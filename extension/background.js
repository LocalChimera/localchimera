// Chimera Compute extension — durable-ish volunteer node for MV3.
// Store-compliant: no remotely-hosted code executes (CSP forbids it), so all
// job logic is bundled here. The infer lane (taskType 200) activates iff the
// build step produced vendor/transformers.js (esbuild bundle of
// @huggingface/transformers); without it the node serves fetch/pin/canary.
//
// Consent: off by default; chrome.storage.local.consent must be true (set by
// the popup toggle). Wipe = extension uninstall or popup "Forget me".
//
// Identity: an ed25519 keypair is generated once into chrome.storage.local
// and self-encoded as did:key:z… — REGISTER binds it with a signature over
// chimera-bind:<id>, and every JOB_RESULT carries a proof signature over
// chimera-result:<jobId>:<sha256(result)> so the node earns verified rep.
// Ed25519 needs Chrome/Edge ≥137; on older builds the node still registers
// but results are anonymous (unverified) — degrade, don't break.

const COORD = 'wss://coordinator.widespread.fyi';
const TOKEN = 'widespread-volunteer';
const TASK_TYPES = [1, 205, 206]; // STORAGE pin, WEB_FETCH, CANARY

let ws = null, heartbeat = null, volunteerId = null;
let idKey = null, idDid = null;
let transformers = null;

// Infer lane — AGENT_INFER (200) prefers the wllama lane (llama.cpp →
// WASM/WebGPU in a cross-origin-isolated offscreen document; GGUF weights) and
// falls back to vendored transformers.js. MV3 CSP forbids remote code, so both
// engines must be produced at pack time by build.mjs → vendor/*. If neither
// artifact is in the package the lane isn't claimed — the node still serves
// fetch/pin/canary.
const WLLAMA_MODEL =
  'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf';

async function loadInfer() {
  if (transformers) return true;
  try {
    const m = await import('./vendor/transformers.js');
    transformers = m.pipeline ? m : m.default;
    return !!transformers?.pipeline;
  } catch { return false; }
}

let wllamaAssets = null;
async function wllamaAvailable() {
  wllamaAssets ??= typeof chrome.offscreen === 'object'
    && await fetch(chrome.runtime.getURL('vendor/wllama-page.js')).then((r) => r.ok).catch(() => false);
  return wllamaAssets;
}

async function claimInfer() {
  if (!TASK_TYPES.includes(200) && ((await wllamaAvailable()) || (await loadInfer())))
    TASK_TYPES.push(200);
}

async function wllamaInfer(prompt, maxTokens) {
  if (!(await wllamaAvailable())) throw new Error('wllama lane unavailable');
  if (!(await chrome.offscreen.hasDocument?.().catch(() => false))) {
    await chrome.offscreen.createDocument({
      url: 'wllama-page.html',
      reasons: ['WORKERS'],
      justification: 'Local LLM inference (wllama / llama.cpp in WASM) for pool jobs',
    });
  }
  const { wllamaModel } = await chrome.storage.local.get('wllamaModel');
  const res = await chrome.runtime.sendMessage({
    cmd: 'wllama-infer', prompt, maxTokens,
    modelUrl: wllamaModel || WLLAMA_MODEL,
  });
  if (!res?.ok) throw new Error(res?.error || 'wllama empty response');
  return res.text;
}

let inferPipe = null;
async function runInfer(payload) {
  const { prompt, model, maxTokens } = JSON.parse(payload);
  try {
    return { text: await wllamaInfer(prompt, maxTokens), engine: 'wllama' };
  } catch { /* wllama page/engine unavailable → ONNX lane */ }
  if (!(await loadInfer())) throw new Error('infer lane unavailable');
  // Small instruct model; weights fetch+cache via transformers.js Cache API.
  inferPipe ??= await transformers.pipeline(
    'text-generation',
    model || 'HuggingFaceTB/SmolLM2-135M-Instruct',
    { dtype: 'q4' },
  );
  const out = await inferPipe(prompt, { max_new_tokens: maxTokens || 256, do_sample: false });
  const text = out?.[0]?.generated_text ?? '';
  if (!text) throw new Error('empty generation');
  return { text: text.slice(prompt.length).trim() || text, engine: 'transformers.js' };
}

async function ensureId() {
  if (volunteerId) return volunteerId;
  const { id } = await chrome.storage.local.get('id');
  volunteerId = id || crypto.randomUUID();
  await chrome.storage.local.set({ id: volunteerId });
  return volunteerId;
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(bytes) {
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let enc = '';
  while (num > 0n) { enc = B58[Number(num % 58n)] + enc; num /= 58n; }
  for (const b of bytes) { if (b === 0) enc = '1' + enc; else break; }
  return enc;
}

async function ensureIdentity() {
  if (idKey && idDid) return;
  try {
    const stored = await chrome.storage.local.get(['idkeyPriv', 'idkeyPub']);
    if (stored.idkeyPriv && stored.idkeyPub) {
      idKey = await crypto.subtle.importKey('jwk', stored.idkeyPriv, 'Ed25519', false, ['sign']);
      const pub = await crypto.subtle.importKey('jwk', stored.idkeyPub, 'Ed25519', false, []);
      idDid = `did:key:z${base58Encode(new Uint8Array([0xed, 0x01, ...new Uint8Array(await crypto.subtle.exportKey('raw', pub))]))}`;
      return;
    }
    const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    await chrome.storage.local.set({
      idkeyPriv: await crypto.subtle.exportKey('jwk', pair.privateKey),
      idkeyPub: await crypto.subtle.exportKey('jwk', pair.publicKey),
    });
    idKey = pair.privateKey;
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    idDid = `did:key:z${base58Encode(new Uint8Array([0xed, 0x01, ...raw]))}`;
  } catch {
    // No Ed25519 in this browser — stay anonymous (unsigned results).
    idKey = null; idDid = null;
  }
}

async function signMsg(msg) {
  if (!idKey) return null;
  const sig = await crypto.subtle.sign('Ed25519', idKey, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function webFetch(payload, jobId) {
  const spec = JSON.parse(payload);
  if (spec.inject) {
    const r = await fetch(`${COORD.replace(/^ws/, 'http')}/proxy/fetch`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId, volunteerId }),
    }).then((x) => x.json());
    if (r.error) throw new Error(`proxy: ${r.error}`);
    return JSON.stringify({ bodyHash: r.bodyHash, bytes: r.bytes });
  }
  const u = new URL(spec.url);
  if (u.protocol !== 'https:') throw new Error('https-only');
  const res = await fetch(u, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 1_048_576) throw new Error('body >1MB');
  return JSON.stringify({ bodyHash: await sha256hex(buf), bytes: buf.byteLength });
}

async function pin(payload) {
  const { url, expectHash } = JSON.parse(payload);
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('https-only');
  const res = await fetch(u);
  if (!res.ok) throw new Error(`http ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 8_388_608) throw new Error('pin >8MB');
  const cid = await sha256hex(buf);
  if (expectHash && expectHash !== cid) throw new Error('hash mismatch');
  await caches.open('chimera-pins').then((c) => c.put(u.href, new Response(buf)));
  return JSON.stringify({ cid, verified: true });
}

async function onJob(msg) {
  try {
    let result, engine;
    if (msg.taskType === 206) result = JSON.parse(msg.requestHash).nonce;
    else if (msg.taskType === 205) result = await webFetch(msg.requestHash, msg.jobId);
    else if (msg.taskType === 1) result = await pin(msg.requestHash);
    else if (msg.taskType === 200) ({ text: result, engine } = await runInfer(msg.requestHash));
    else throw new Error(`unsupported taskType ${msg.taskType}`);
    const resultSig = await signMsg(`chimera-result:${msg.jobId}:${await sha256hex(new TextEncoder().encode(result))}`);
    ws.send(JSON.stringify({ type: 'JOB_RESULT', jobId: msg.jobId, result, ...(resultSig ? { resultSig } : {}), ...(engine ? { engine } : {}) }));
    const { jobs = 0 } = await chrome.storage.local.get('jobs');
    await chrome.storage.local.set({ jobs: jobs + 1 });
  } catch (e) {
    ws.send(JSON.stringify({ type: 'JOB_REJECTED', jobId: msg.jobId, reason: String(e).slice(0, 120) }));
  }
}

async function connect() {
  const { consent } = await chrome.storage.local.get('consent');
  if (!consent) return;
  const id = await ensureId();
  await ensureIdentity();
  await claimInfer(); // claims taskType 200 iff a vendored infer engine exists
  ws = new WebSocket(`${COORD}?token=${encodeURIComponent(TOKEN)}`);
  ws.onopen = async () => {
    const sig = await signMsg(`chimera-bind:${id}`);
    ws.send(JSON.stringify({
      type: 'REGISTER', volunteerId: id, taskTypes: TASK_TYPES,
      ...(idDid && sig ? { did: idDid, sig } : {}),
      capabilities: { cpuCores: navigator.hardwareConcurrency || 2 },
      durable: true, shardCapacity: 1,
    }));
    heartbeat = setInterval(() => ws?.send(JSON.stringify({ type: 'HEARTBEAT' })), 25_000);
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'JOB_DISPATCH') onJob(msg);
  };
  ws.onclose = () => {
    clearInterval(heartbeat);
    chrome.alarms.create('reconnect', { delayInMinutes: 0.1 });
  };
  ws.onerror = () => ws.close();
}

chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'reconnect') connect(); });
chrome.storage.onChanged.addListener((ch) => {
  if (ch.consent?.newValue === true) connect();
  if (ch.consent?.newValue === false) {
    // Honest exit — release in-flight assignments server-side before closing.
    try { ws?.send(JSON.stringify({ type: 'EXIT' })); } catch {}
    ws?.close();
  }
});
chrome.runtime.onInstalled.addListener(connect);
// MV3 service workers are ephemeral — on suspend there's no reliable hook,
// but onStartup/heartbeat reconnect keeps the node honest across restarts.
chrome.runtime.onStartup?.addListener(connect);
