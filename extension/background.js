// Chimera Compute extension — durable-ish volunteer node for MV3.
// Store-compliant: no remotely-hosted code executes (CSP forbids it), so all
// job logic is bundled here. Infer lanes are intentionally NOT claimed —
// bundling transformers.js + OPFS weight shards is the P6 follow-up; this
// build serves fetch/pin/canary lanes so the extension ships useful.
//
// Consent: off by default; chrome.storage.local.consent must be true (set by
// the popup toggle). Wipe = extension uninstall or popup "Forget me".

const COORD = 'wss://coordinator.widespread.fyi';
const TOKEN = 'widespread-volunteer';
const TASK_TYPES = [1, 205, 206]; // STORAGE pin, WEB_FETCH, CANARY

let ws = null, heartbeat = null, volunteerId = null;

async function ensureId() {
  if (volunteerId) return volunteerId;
  const { id } = await chrome.storage.local.get('id');
  volunteerId = id || crypto.randomUUID();
  await chrome.storage.local.set({ id: volunteerId });
  return volunteerId;
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
    let result;
    if (msg.taskType === 206) result = JSON.parse(msg.requestHash).nonce;
    else if (msg.taskType === 205) result = await webFetch(msg.requestHash, msg.jobId);
    else if (msg.taskType === 1) result = await pin(msg.requestHash);
    else throw new Error(`unsupported taskType ${msg.taskType}`);
    ws.send(JSON.stringify({ type: 'JOB_RESULT', jobId: msg.jobId, result }));
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
  ws = new WebSocket(`${COORD}?token=${encodeURIComponent(TOKEN)}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'REGISTER', volunteerId: id, taskTypes: TASK_TYPES,
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
  if (ch.consent?.newValue === false) { ws?.close(); }
});
chrome.runtime.onInstalled.addListener(connect);
