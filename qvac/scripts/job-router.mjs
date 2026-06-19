import pkg from 'casper-js-sdk';
const sdk = pkg;
const { PrivateKey, KeyAlgorithm, CLValue, Args, ExecutableDeployItem, DeployHeader, Deploy } = sdk;
import { createHash } from 'crypto';

const RPC_URL = 'http://localhost:7778/rpc';
const CHAIN_NAME = 'casper-test';

// Provider/worker key
const PROVIDER_PEM = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIBJLNm8sYi/pVIcbF2soCZTxr9wO3EGtlEtkA2X5bOQvoAcGBSuBBAAK
oUQDQgAE7jl1qDI712D51EeKgfIZ974LmOYjjwkjQ3mHFrpLpL/mbwQ7mz/zmBjf
Rm6VsWCs2wbZAkjyLfzmUUrmzvWIhQ==
-----END EC PRIVATE KEY-----`;

const CONTRACT_HASH = 'a2b36559e7da9f0a3fc10afc23eceb54022ab41649ad976c52802e37ad26700b';
const GAS_PAYMENT = '10000000000';
const POLL_INTERVAL_MS = 15000;

// Inference nodes registry (real GPT-2 inference server)
const INFERENCE_NODES = [
  { id: 'gpt2-local', url: 'http://localhost:3005/infer', capacity: 2, currentJobs: 0 },
  // Fallback to Chimera AI Write API if inference server is down:
  // { id: 'chimera-api', url: 'http://localhost:3002/api/ai-write', capacity: 1, currentJobs: 0 },
];

const providerPk = PrivateKey.fromPem(PROVIDER_PEM, KeyAlgorithm.SECP256K1);
const PROVIDER_HASH = providerPk.publicKey.accountHash().toHex();

let JOBS_DICT = '';
let PENDING_DICT = '';

// In-memory job assignment tracking
const activeAssignments = new Map(); // jobId -> { nodeId, startTime }
const completedJobs = new Set();
const failedJobs = new Set(); // jobs where provider_ack or inference failed — don't retry

async function getStateRoot() {
  const res = await fetch(RPC_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain_get_state_root_hash', params: null })
  });
  return (await res.json()).result?.state_root_hash;
}

async function getNamedKeys() {
  const res = await fetch(RPC_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'state_get_entity', params: { entity_identifier: { ContractHash: 'contract-' + CONTRACT_HASH } } })
  });
  return (await res.json()).result?.entity?.Contract?.contract?.named_keys || [];
}

async function queryDict(uref, key) {
  const stateRoot = await getStateRoot();
  const res = await fetch(RPC_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'state_get_dictionary_item',
      params: { state_root_hash: stateRoot, dictionary_identifier: { URef: { seed_uref: uref, dictionary_item_key: key } } }
    })
  });
  return (await res.json()).result?.stored_value?.CLValue?.parsed;
}

async function submit(entryPoint, argsMap) {
  const pk = PrivateKey.fromPem(PROVIDER_PEM, KeyAlgorithm.SECP256K1);
  const args = Args.fromMap(argsMap);
  const hashObj = sdk.ContractHash.newContract(CONTRACT_HASH);
  const stored = new sdk.StoredContractByHash(hashObj, entryPoint, args);
  const session = new ExecutableDeployItem();
  session.storedContractByHash = stored;
  const payment = ExecutableDeployItem.standardPayment(GAS_PAYMENT);
  const header = DeployHeader.default();
  header.account = pk.publicKey;
  header.chainName = CHAIN_NAME;
  const deploy = Deploy.makeDeploy(header, payment, session);
  deploy.sign(pk);
  const res = await fetch(RPC_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'account_put_deploy', params: { deploy: Deploy.toJSON(deploy) } })
  });
  const data = await res.json();
  if (data.error) {
    console.log(`[${entryPoint}] ERROR:`, data.error.message || JSON.stringify(data.error));
    return { hash: '', status: 'ERROR' };
  }
  await new Promise(r => setTimeout(r, 25000));
  const info = await fetch(RPC_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'info_get_deploy', params: { deploy_hash: data.result.deploy_hash } })
  }).then(r => r.json());
  const exec = info.result?.execution_info?.execution_result?.Version2;
  const status = exec?.error_message || 'SUCCESS';
  if (status !== 'SUCCESS') {
    console.log(`[${entryPoint}] FAILED:`, status);
  } else {
    console.log(`[${entryPoint}] SUCCESS hash=${data.result.deploy_hash.slice(0,16)}...`);
  }
  return { hash: data.result.deploy_hash, status };
}

// Router: find the best available node
function routeJob(jobId) {
  const available = INFERENCE_NODES.filter(n => n.currentJobs < n.capacity);
  if (available.length === 0) return null;
  // Simple round-robin: pick the node with fewest current jobs
  available.sort((a, b) => a.currentJobs - b.currentJobs);
  const chosen = available[0];
  chosen.currentJobs++;
  activeAssignments.set(jobId, { nodeId: chosen.id, startTime: Date.now() });
  return chosen;
}

function releaseNode(jobId) {
  const assignment = activeAssignments.get(jobId);
  if (assignment) {
    const node = INFERENCE_NODES.find(n => n.id === assignment.nodeId);
    if (node) node.currentJobs = Math.max(0, node.currentJobs - 1);
    activeAssignments.delete(jobId);
  }
}

async function callInference(node, jobId, requestHash) {
  console.log(`[router] Routing job ${jobId} to ${node.id} at ${node.url}`);
  try {
    const res = await fetch(node.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: requestHash, max_new_tokens: 20 }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    // The inference endpoint returns { output: "...", model: "...", success: true }
    const body = data.output || data.body || data.result || '';
    const responseHash = hashString(body || JSON.stringify(data));
    console.log(`[router] ${node.id} returned ${body.length} chars, hash: ${responseHash}`);
    // Cache full text for frontend display
    inferenceCache.set(jobId, { text: body, timestamp: Date.now() });
    console.log(`[router] Cached result for ${jobId} (${body.length} chars)`);
    return { success: true, responseHash };
  } catch (e) {
    console.error(`[router] ${node.id} failed: ${e.message}`);
    return { success: false, error: e.message };
  }
}

function hashString(str) {
  return createHash('sha256').update(str).digest('hex').slice(0, 64);
}

async function processJob(jobId) {
  // Step 1: Acknowledge
  const ackResult = await submit('provider_ack', { job_id: CLValue.newCLString(jobId) });
  if (ackResult.status !== 'SUCCESS') {
    console.log(`[router] provider_ack failed for ${jobId}`);
    return false;
  }

  // Step 2: Get request hash for inference input
  const requestHash = await queryDict(JOBS_DICT, `${jobId}:request_hash`);
  console.log(`[router] Job ${jobId} request_hash: ${requestHash}`);

  // Step 3: Route to inference node
  const node = routeJob(jobId);
  if (!node) {
    console.log(`[router] No available inference nodes for ${jobId}`);
    return false;
  }

  const inferenceResult = await callInference(node, jobId, requestHash);

  if (!inferenceResult.success) {
    releaseNode(jobId);
    console.log(`[router] Inference failed for ${jobId}, node released`);
    return false;
  }

  // Step 4: Submit completion
  const completeResult = await submit('provider_complete', {
    job_id: CLValue.newCLString(jobId),
    response_hash: CLValue.newCLString(inferenceResult.responseHash),
  });

  releaseNode(jobId);

  if (completeResult.status !== 'SUCCESS') {
    console.log(`[router] provider_complete failed for ${jobId}`);
    return false;
  }

  completedJobs.add(jobId);
  console.log(`[router] Job ${jobId} fully processed via ${node.id}`);
  return true;
}

async function pollAndRoute() {
  try {
    // Init dictionaries
    if (!JOBS_DICT || !PENDING_DICT) {
      const keys = await getNamedKeys();
      for (const k of keys) {
        if (k.name === 'jobs_dict') JOBS_DICT = k.key;
        if (k.name === 'pending_jobs') PENDING_DICT = k.key;
      }
      if (!JOBS_DICT || !PENDING_DICT) {
        console.log('[router] Could not find dictionary URefs');
        return;
      }
    }

    const pendingList = await queryDict(PENDING_DICT, 'list') || [];
    if (pendingList.length === 0) {
      console.log('[router] No pending jobs');
      return;
    }

    console.log(`[router] ${pendingList.length} job(s) in queue`);

    for (const jobId of pendingList) {
      // Skip already completed, in-progress, or previously failed
      if (completedJobs.has(jobId)) continue;
      if (failedJobs.has(jobId)) {
        console.log(`[router] Job ${jobId} previously failed, skipping`);
        continue;
      }
      if (activeAssignments.has(jobId)) {
        console.log(`[router] Job ${jobId} already assigned to node`);
        continue;
      }

      const state = await queryDict(JOBS_DICT, `${jobId}:state`);
      if (state !== 0) {
        console.log(`[router] Job ${jobId} state=${state}, skipping`);
        continue;
      }

      const provider = await queryDict(JOBS_DICT, `${jobId}:provider`);
      if (provider !== PROVIDER_HASH) {
        console.log(`[router] Job ${jobId} provider mismatch (${provider} != ${PROVIDER_HASH}), skipping`);
        continue;
      }

      console.log(`[router] Processing job ${jobId}...`);
      const ok = await processJob(jobId);
      if (!ok) failedJobs.add(jobId);
    }
  } catch (e) {
    console.error('[router] Error:', e.message);
  }
}

// Inference result cache: jobId -> { text, timestamp }
const inferenceCache = new Map();

// Start lightweight result server for frontend queries
import { createServer } from 'http';
const RESULT_PORT = 3006;
createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'GET') { res.writeHead(405); res.end('Method not allowed'); return; }

  const url = new URL(req.url, `http://localhost:${RESULT_PORT}`);
  if (url.pathname === '/result') {
    const jobId = url.searchParams.get('job_id');
    const entry = inferenceCache.get(jobId);
    if (entry) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jobId, text: entry.text, timestamp: entry.timestamp }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Result not found', jobId }));
    }
    return;
  }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, cached: inferenceCache.size }));
    return;
  }
  res.writeHead(404); res.end('Not found');
}).listen(RESULT_PORT, () => {
  console.log(`[router] Result cache server: http://localhost:${RESULT_PORT}/result?job_id=...`);
});

async function main() {
  console.log('=== Job Router / Dispatcher ===');
  console.log('Provider:', PROVIDER_HASH);
  console.log('Contract:', CONTRACT_HASH);
  console.log('Nodes:', INFERENCE_NODES.map(n => `${n.id} (${n.url}, capacity=${n.capacity})`).join(', '));
  console.log(`Polling every ${POLL_INTERVAL_MS}ms`);
  console.log('Press Ctrl+C to stop\n');

  await pollAndRoute();
  setInterval(pollAndRoute, POLL_INTERVAL_MS);
}

main().catch(console.error);
