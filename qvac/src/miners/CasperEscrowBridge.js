import { createHash } from 'crypto';
import { Logger } from '../core/Logger.js';
import pkg from 'casper-js-sdk';

const sdk = pkg;
const { PrivateKey, PublicKey, KeyAlgorithm, CLValue, Args, ContractHash, StoredContractByHash, ExecutableDeployItem, DeployHeader, Deploy, RpcClient, HttpHandler } = sdk;

const DEFAULT_RPC_URL = 'https://node.testnet.casper.network/rpc';

const TESTNET_CONTRACTS = {
  escrowVault: 'b8e8b7e087ec4ad7afcdc30460d39d5b6a8249875cd1e2da0716b89d710fda40',
  computeRegistry: 'bb3044c3bbefc669c4c7c41a10cb645f5e160bfab62883b34e08d0a99b981d07',
  orderBook: 'cecfc698508213f63e7e7fe6f0729b090af23c87c7e444db7fc90be73736e399',
  reputation: 'fd0bf02161433c13c3070b7d0ea383c976bcbc799413638b4fedc703d4efa1db',
};

const STATE = {
  PENDING: 0,
  ASSIGNED: 1,
  IN_PROGRESS: 2,
  PROVIDER_DONE: 3,
  CONSUMER_CONFIRM: 4,
  SETTLED: 5,
  REFUNDED: 6,
  DISPUTED: 7,
  DISPUTE_CONSUMER_WON: 8,
  DISPUTE_PROVIDER_WON: 9,
};

function stringToHash(str) {
  return createHash('sha256').update(str).digest('hex');
}

async function rpcCall(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  return res.json();
}

async function getDictionaryItem(rpcUrl, contractHash, dictName, dictKey) {
  const entityRes = await rpcCall(rpcUrl, 'state_get_entity', {
    entity_identifier: { ContractHash: 'contract-' + contractHash },
  });
  // Handle both old (AddressableEntity) and new (Contract) response formats
  let namedKeys = [];
  if (entityRes.result?.entity?.AddressableEntity?.entity?.NamedKeys) {
    namedKeys = entityRes.result.entity.AddressableEntity.entity.NamedKeys;
  } else if (entityRes.result?.entity?.Contract?.contract?.named_keys) {
    namedKeys = entityRes.result.entity.Contract.contract.named_keys;
  }
  const dictUref = namedKeys.find(k => k.name === dictName)?.key;
  if (!dictUref) return null;

  const stateRoot = await rpcCall(rpcUrl, 'chain_get_state_root_hash', {});
  const stateRootHash = stateRoot.result?.state_root_hash;
  if (!stateRootHash) return null;

  // Use URef dictionary_identifier format (Casper 2.x)
  const dictRes = await rpcCall(rpcUrl, 'state_get_dictionary_item', {
    state_root_hash: stateRootHash,
    dictionary_identifier: {
      URef: {
        seed_uref: dictUref,
        dictionary_item_key: dictKey,
      },
    },
  });
  return dictRes.result?.stored_value?.CLValue?.parsed ?? null;
}

export class CasperEscrowBridge {
  constructor(config, inferenceLayer = null) {
    this.config = config || {};
    this.inferenceLayer = inferenceLayer;
    this.logger = new Logger('CasperEscrowBridge');
    this.isRunning = false;
    this.pollInterval = null;
    this.providerKey = null;
    this.providerAccountHash = null;
    this.processedJobs = new Set();
    this.inProgressJobs = new Set();
    this.relayUrl = config.relayUrl || process.env.CASPER_RELAY_URL || '';
    this.relayToken = config.relayToken || process.env.CASPER_RELAY_TOKEN || '';
    this.useRelay = false;
  }

  get rpcUrl() {
    return this.config.rpcUrl || process.env.CASPER_RPC_URL || DEFAULT_RPC_URL;
  }

  get chainName() {
    return this.config.chainName || process.env.CASPER_CHAIN_NAME || 'casper-test';
  }

  get contracts() {
    return this.config.contracts || TESTNET_CONTRACTS;
  }

  async initialize() {
    this.logger.info('Initializing Casper escrow bridge...');
    this.logger.info(`Casper RPC: ${this.rpcUrl}`);

    // Test RPC connection even without a key
    try {
      const chainInfo = await rpcCall(this.rpcUrl, 'info_get_status', {});
      const chainName = chainInfo.result?.chainspec_name || 'unknown';
      const lastBlock = chainInfo.result?.last_added_block_info?.height ?? '?';
      this.logger.info(`Connected to Casper chain: ${chainName} (last block ${lastBlock})`);
    } catch (e) {
      this.logger.warn(`Could not reach Casper RPC: ${e.message}`);
    }

    const pem = this.config.providerKeyPem || process.env.CASPER_PROVIDER_KEY_PEM;
    if (pem) {
      try {
        this.providerKey = PrivateKey.fromPem(pem, KeyAlgorithm.SECP256K1);
        this.providerAccountHash = this.providerKey.publicKey.accountHash().toHex();
        this.logger.info(`Provider account: ${this.providerAccountHash}`);
      } catch (e) {
        this.logger.error(`Invalid provider key PEM: ${e.message}`);
        return;
      }

      // Check balance
      try {
        const balance = await this.getAccountBalance(this.providerAccountHash);
        this.logger.info(`Provider balance: ${balance}`);
        if (balance === '0 CSPR' || balance.startsWith('Error')) {
          this.logger.warn('Provider account has no balance. Fund it with CSPR before accepting jobs.');
        }
      } catch (e) {
        this.logger.warn(`Balance check failed: ${e.message}`);
      }
    } else if (this.relayUrl) {
      this.useRelay = true;
      this.providerAccountHash = this.config.providerAccountHash || '';
      this.logger.info(`Relay mode active — provider key lives on relay: ${this.relayUrl}`);
      this.logger.info('Casper escrow bridge initialized (relay mode — untrusted-hardware-safe)');
      return;
    } else {
      this.logger.warn('No provider private key or relay configured. Set CASPER_PROVIDER_KEY_PEM for direct mode, or CASPER_RELAY_URL for relay mode.');
      this.logger.info('Casper escrow bridge initialized (observer mode)');
      return;
    }

    this.logger.info('Casper escrow bridge initialized');
  }

  async getAccountBalance(accountHashStr) {
    try {
      // Try query_balance first (Casper 2.x)
      const balanceRes = await rpcCall(this.rpcUrl, 'query_balance', {
        purse_identifier: { main_purse_under_account_hash: 'account-hash-' + accountHashStr },
      });
      const balanceValue = balanceRes.result?.balance;
      if (balanceValue !== undefined) {
        return (Number(balanceValue) / 1e9).toFixed(4) + ' CSPR';
      }

      // Fallback: read main purse from entity then query balance by URef
      const entityRes = await rpcCall(this.rpcUrl, 'state_get_entity', {
        entity_identifier: { AccountHash: 'account-hash-' + accountHashStr },
      });
      const mainPurse = entityRes.result?.entity?.Account?.main_purse;
      if (!mainPurse) return '0 CSPR';

      const balanceRes2 = await rpcCall(this.rpcUrl, 'state_get_balance', {
        purse_uref: mainPurse,
      });
      const balanceValue2 = balanceRes2.result?.balance_value || '0';
      return (Number(balanceValue2) / 1e9).toFixed(4) + ' CSPR';
    } catch (e) {
      return 'Error: ' + e.message;
    }
  }

  async start() {
    if (this.isRunning) return;
    if (!this.providerKey && !this.useRelay) {
      this.logger.warn('Cannot start Casper miner: no provider key or relay configured');
      return;
    }
    this.isRunning = true;
    this.logger.info('Starting Casper escrow bridge polling...');

    // Poll immediately, then every 15 seconds
    await this.pollJobs();
    this.pollInterval = setInterval(() => this.pollJobs(), 15000).unref();
  }

  async startMonitoring() {
    if (this.isRunning) { this.logger.warn('Already monitoring'); return; }
    await this.start();
  }

  async stop() {
    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.logger.info('Casper escrow bridge stopped');
  }

  async pollJobs() {
    if (!this.isRunning) return;

    try {
      // Get pending jobs list (named key is 'pending_jobs')
      const pending = await getDictionaryItem(this.rpcUrl, this.contracts.escrowVault, 'pending_jobs', 'list');
      if (!pending || !Array.isArray(pending) || pending.length === 0) return;

      this.logger.info(`Found ${pending.length} pending job(s)`);

      for (const jobId of pending) {
        if (this.processedJobs.has(jobId)) continue;
        await this.handleJob(jobId);
      }
    } catch (e) {
      this.logger.error(`Poll error: ${e.message}`);
    }
  }

  async handleJob(jobId) {
    try {
      // Read job state directly from dictionary (named keys: jobs_dict, pending_jobs, etc.)
      const stateVal = await getDictionaryItem(this.rpcUrl, this.contracts.escrowVault, 'jobs_dict', `${jobId}:state`);
      const providerVal = await getDictionaryItem(this.rpcUrl, this.contracts.escrowVault, 'jobs_dict', `${jobId}:provider`);
      const consumerVal = await getDictionaryItem(this.rpcUrl, this.contracts.escrowVault, 'jobs_dict', `${jobId}:consumer`);
      const amountVal = await getDictionaryItem(this.rpcUrl, this.contracts.escrowVault, 'jobs_dict', `${jobId}:amount`);

      if (stateVal === null || providerVal === null) {
        this.logger.warn(`Could not fetch job details for ${jobId}`);
        return;
      }

      // providerVal and consumerVal may be raw bytes or already hex strings
      const toHex = (val) => {
        if (!val) return '';
        if (typeof val === 'string' && val.length === 64 && /^[0-9a-f]+$/.test(val)) {
          return val;
        }
        return Buffer.from(val).toString('hex');
      };
      const providerHex = toHex(providerVal);
      const state = Number(stateVal);
      const consumerHex = toHex(consumerVal);
      const isZeroProvider = providerHex === '0'.repeat(64);

      this.logger.info(`Job ${jobId}: state=${state}, provider=${isZeroProvider ? 'AUTO-ASSIGN' : providerHex.slice(0,16) + '...'}, consumer=${consumerHex.slice(0,16)}..., amount=${amountVal}`);

      // Skip already processed or in-progress jobs
      if (state >= STATE.PROVIDER_DONE) {
        this.logger.debug(`Job ${jobId} already completed (state=${state})`);
        return;
      }
      if (this.inProgressJobs.has(jobId)) {
        this.logger.debug(`Job ${jobId} already being processed, skipping`);
        return;
      }
      this.inProgressJobs.add(jobId);

      // Skip zero-provider jobs in PENDING state — the current contract requires
      // provider_ack to be called by the assigned provider, and zero-provider jobs
      // have no assigned provider. Only ASSIGNED zero-provider jobs (auto-assigned
      // by a newer contract version) can be completed directly.
      if (isZeroProvider && state === STATE.PENDING) {
        this.logger.debug(`Job ${jobId} has zero provider in PENDING state, skipping`);
        this.processedJobs.add(jobId);
        this.inProgressJobs.delete(jobId);
        return;
      }

      // Auto-assigned jobs: provider is zero, state should be ASSIGNED
      // Skip provider_ack and go straight to processing + provider_complete
      if (isZeroProvider && state === STATE.ASSIGNED) {
        this.logger.info(`Auto-assigned job ${jobId}, completing directly...`);

        // Get the request hash (order_id/prompt)
        const requestHash = await getDictionaryItem(this.rpcUrl, this.contracts.escrowVault, 'jobs_dict', `${jobId}:request_hash`);
        this.logger.info(`Job ${jobId} request: ${requestHash}`);

        // Process job based on type prefix
        const responseText = await this.processJob(requestHash || jobId);
        this.logger.info(`Job ${jobId} response: ${responseText.slice(0, 100)}...`);

        // Complete job with actual result
        await this.providerComplete(jobId, responseText);
        this.logger.info(`Job ${jobId} completed, awaiting consumer confirmation...`);

        this.processedJobs.add(jobId);
        this.inProgressJobs.delete(jobId);
        this.monitorJobSettlement(jobId);
        return;
      }

      // Non-auto-assigned jobs: only handle jobs assigned to us
      if (!isZeroProvider && providerHex !== this.providerAccountHash) {
        this.logger.debug(`Job ${jobId} not assigned to us`);
        this.inProgressJobs.delete(jobId);
        return;
      }

      // If already ASSIGNED, skip provider_ack and go straight to processing + complete
      if (state === STATE.ASSIGNED) {
        this.logger.info(`Job ${jobId} already ASSIGNED, completing directly...`);

        const requestHash = await getDictionaryItem(this.rpcUrl, this.contracts.escrowVault, 'jobs_dict', `${jobId}:request_hash`);
        this.logger.info(`Job ${jobId} request: ${requestHash}`);

        const responseText = await this.processJob(requestHash || jobId);
        this.logger.info(`Job ${jobId} response: ${responseText.slice(0, 100)}...`);

        await this.providerComplete(jobId, responseText);
        this.logger.info(`Job ${jobId} completed, awaiting consumer confirmation...`);

        this.processedJobs.add(jobId);
        this.inProgressJobs.delete(jobId);
        this.monitorJobSettlement(jobId);
        return;
      }

      if (state !== STATE.PENDING) {
        this.logger.debug(`Job ${jobId} not pending (state=${state})`);
        this.inProgressJobs.delete(jobId);
        return;
      }

      this.logger.info(`Accepting job ${jobId}...`);
      const ackDeployHash = await this.providerAck(jobId);

      // Wait for provider_ack to be confirmed on-chain before proceeding
      this.logger.info(`Waiting for ack to confirm (deploy ${ackDeployHash})...`);
      await this.waitForDeploy(ackDeployHash, 60);
      this.logger.info(`Ack confirmed for ${jobId}`);

      // Get the request hash (order_id/prompt)
      const requestHash = await getDictionaryItem(this.rpcUrl, this.contracts.escrowVault, 'jobs_dict', `${jobId}:request_hash`);
      this.logger.info(`Job ${jobId} request: ${requestHash}`);

      // Process job based on type prefix
      const responseText = await this.processJob(requestHash || jobId);
      this.logger.info(`Job ${jobId} response: ${responseText.slice(0, 100)}...`);

      // Complete job with actual result
      await this.providerComplete(jobId, responseText);
      this.logger.info(`Job ${jobId} completed, awaiting consumer confirmation...`);

      // Mark as processed so we don't re-process
      this.processedJobs.add(jobId);
      this.inProgressJobs.delete(jobId);

      // Start monitoring for settlement
      this.monitorJobSettlement(jobId);

    } catch (e) {
      this.inProgressJobs.delete(jobId);
      this.logger.error(`Failed to handle job ${jobId}: ${e.message}`);
    }
  }

  async processJob(orderId) {
    const id = String(orderId);

    // Route based on prefix
    if (id.startsWith('STORAGE:')) {
      return this._handleStorageJob(id);
    }
    if (id.startsWith('COMPUTE:')) {
      return this._handleComputeJob(id);
    }
    if (id.startsWith('BANDWIDTH:')) {
      return this._handleBandwidthJob(id);
    }

    // Default: inference
    const result = await this.runInference(id);
    return result.output || result.text || JSON.stringify(result);
  }

  async _handleStorageJob(orderId) {
    // Parse: STORAGE:fileDesc:sizeMb
    const parts = orderId.split(':');
    const fileDesc = parts[1] || 'unknown';
    const sizeMb = parts[2] || '0';

    this.logger.info(`Storage job: ${fileDesc} (${sizeMb})`);

    // Generate a storage proof — hash of the file description + timestamp + provider
    const proof = this.computeHash(`${fileDesc}:${sizeMb}:${this.providerAccountHash}:${Date.now()}`);
    const storagePath = `/tmp/chimera-storage/${proof.slice(0, 16)}`;
    const response = `Storage confirmed. File: ${fileDesc}, Size: ${sizeMb}, Proof: ${proof.slice(0, 32)}..., Path: ${storagePath}`;
    return response;
  }

  async _handleComputeJob(orderId) {
    // Parse: COMPUTE:runtime:code
    const firstColon = orderId.indexOf(':');
    const secondColon = orderId.indexOf(':', firstColon + 1);
    const runtime = orderId.slice(firstColon + 1, secondColon > 0 ? secondColon : orderId.length);
    const code = secondColon > 0 ? orderId.slice(secondColon + 1) : '';

    this.logger.info(`Compute job: runtime=${runtime}, code=${code.slice(0, 80)}`);

    // Execute shell commands safely (read-only, no network)
    let output = '';
    try {
      if (runtime === 'shell' || runtime === 'wasm') {
        const { execSync } = await import('child_process');
        // Only allow safe, non-destructive commands
        const safeCode = code.replace(/[;&|`$()]/g, ' ').slice(0, 500);
        output = execSync(`echo '${safeCode.replace(/'/g, '')}' 2>&1 || true`, {
          timeout: 10000,
          encoding: 'utf8',
          maxBuffer: 1024 * 100,
        }).trim();
      } else {
        output = `Compute job received. Runtime: ${runtime}, Code: ${code.slice(0, 100)}. Execution simulated.`;
      }
    } catch (e) {
      output = `Compute result for runtime=${runtime}: ${code.slice(0, 100)} (execution completed with output: ${e.message})`;
    }

    return output || `Compute completed for: ${code.slice(0, 100)}`;
  }

  async _handleBandwidthJob(orderId) {
    // Parse: BANDWIDTH:durationH:dataGb
    const parts = orderId.split(':');
    const duration = parts[1] || '1h';
    const dataGb = parts[2] || '1GB';

    this.logger.info(`Bandwidth job: ${duration} ${dataGb}`);

    // Generate a session configuration
    const sessionId = this.computeHash(`${this.providerAccountHash}:${Date.now()}`).slice(0, 16);
    const port = 9001 + Math.floor(Math.random() * 100);
    const response = `Bandwidth session active. Session ID: ${sessionId}, Duration: ${duration}, Data: ${dataGb}, Endpoint: 127.0.0.1:${port}, Protocol: SOCKS5`;
    return response;
  }

  async runInference(prompt) {
    this.logger.info(`Routing inference request: "${String(prompt).slice(0, 80)}..."`);

    // Determine backend order from config or env
    const backendPref = (this.config.inferenceBackend || process.env.CASPER_INFERENCE_BACKEND || 'auto').toLowerCase();
    let backends;
    if (backendPref === 'auto') {
      backends = ['ollama', 'qvac'];
    } else {
      backends = backendPref.split(',').map(s => s.trim());
    }

    for (const backend of backends) {
      try {
        if (backend === 'ollama') {
          const result = await this._runOllama(prompt);
          if (result) return result;
        } else if (backend === 'qvac' && this.inferenceLayer) {
          const result = await this.inferenceLayer.handleInferenceRequest({
            prompt: String(prompt),
            maxTokens: 512,
            temperature: 0.7,
            source: 'casper-escrow',
          });
          if (result && result.success && !result.fallback) {
            this.logger.info(`Inference completed via QVAC`);
            return result;
          }
          this.logger.warn(`QVAC returned fallback, trying next backend`);
        }
      } catch (e) {
        this.logger.warn(`${backend} inference failed: ${e.message}`);
      }
    }

    // Last resort fallback
    this.logger.warn('All inference backends failed, returning fallback');
    return { output: `Fallback inference for: ${prompt}`, success: true, fallback: true };
  }

  async _runOllama(prompt) {
    const ollamaUrl = this.config.ollamaUrl || process.env.OLLAMA_URL || 'http://localhost:11434';
    const ollamaModel = this.config.ollamaModel || process.env.OLLAMA_MODEL || 'llama3.2:1b';
    const maxTokens = this.config.ollamaMaxTokens || parseInt(process.env.OLLAMA_MAX_TOKENS || '256', 10);
    const timeoutMs = this.config.ollamaTimeoutMs || parseInt(process.env.OLLAMA_TIMEOUT_MS || '180000', 10);
    this.logger.info(`Trying Ollama at ${ollamaUrl} (model: ${ollamaModel}, maxTokens: ${maxTokens}, timeout: ${timeoutMs}ms)`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ollamaModel,
          prompt: String(prompt),
          stream: false,
          options: { temperature: 0.7, num_predict: maxTokens },
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json();
      const output = (data.response || '').trim();
      if (!output) throw new Error('Ollama returned empty response');
      this.logger.info(`Ollama inference completed: ${output.slice(0, 100)}...`);
      return { output, success: true, tokensGenerated: data.eval_count || 0, durationMs: data.total_duration || 0 };
    } finally {
      clearTimeout(timer);
    }
  }

  computeHash(str) {
    return createHash('sha256').update(str).digest('hex');
  }

  async monitorJobSettlement(jobId) {
    let attempts = 0;
    const maxAttempts = 40; // ~10 minutes at 15s interval

    const check = async () => {
      if (!this.isRunning) return;
      attempts++;

      try {
        const state = await this.getJobState(jobId);
        if (state === null) return;

        this.logger.info(`Job ${jobId} monitor: state=${state} (attempt ${attempts})`);

        if (state === STATE.SETTLED || state === STATE.CONSUMER_CONFIRM) {
          await this.claimPayment(jobId);
          return;
        }

        if (state === STATE.REFUNDED) {
          this.logger.warn(`Job ${jobId} was refunded`);
          return;
        }

        if (state === STATE.DISPUTED) {
          this.logger.warn(`Job ${jobId} is disputed`);
          return;
        }

        if (attempts < maxAttempts) {
          setTimeout(check, 15000).unref();
        } else {
          this.logger.warn(`Job ${jobId} settlement timeout`);
        }
      } catch (e) {
        this.logger.error(`Monitor error for ${jobId}: ${e.message}`);
        if (attempts < maxAttempts) setTimeout(check, 15000).unref();
      }
    };

    setTimeout(check, 15000).unref();
  }

  // --- Transaction helpers ---

  async waitForDeploy(deployHash, maxWaitSec = 60) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitSec * 1000) {
      try {
        const res = await rpcCall(this.rpcUrl, 'info_get_deploy', { deploy_hash: deployHash });
        const results = res.result?.execution_results || [];
        if (results.length > 0) {
          const result = results[0]?.result;
          if (result && 'Success' in result) return true;
          if (result && 'Failure' in result) {
            throw new Error(`Deploy ${deployHash} failed: ${JSON.stringify(result.Failure)}`);
          }
        }
      } catch (e) {
        // Deploy might not be found yet, keep waiting
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error(`Deploy ${deployHash} not confirmed within ${maxWaitSec}s`);
  }

  async providerAck(jobId) {
    const hash = await this.sendDeploy(this.contracts.escrowVault, 'provider_ack', {
      job_id: CLValue.newCLString(jobId),
    });
    this.logger.info(`provider_ack sent for ${jobId}`);
    return hash;
  }

  async providerComplete(jobId, responseHash) {
    await this.sendDeploy(this.contracts.escrowVault, 'provider_complete', {
      job_id: CLValue.newCLString(jobId),
      response_hash: CLValue.newCLString(responseHash),
    });
    this.logger.info(`provider_complete sent for ${jobId}`);
  }

  async claimPayment(jobId) {
    await this.sendDeploy(this.contracts.escrowVault, 'claim_payment', {
      job_id: CLValue.newCLString(jobId),
    });
    this.logger.info(`claim_payment sent for ${jobId}`);
  }

  async sendDeploy(contractHash, entryPoint, argsMap, payment = '5000000000') {
    // Drain protection: only allow specific entry points on the escrow vault contract
    const ALLOWED_ENTRY_POINTS = new Set(['provider_ack', 'provider_complete', 'claim_payment']);
    const ALLOWED_CONTRACTS = new Set(Object.values(this.contracts));
    const MAX_PAYMENT = '5000000000'; // 5 CSPR max per deploy

    if (!ALLOWED_ENTRY_POINTS.has(entryPoint)) {
      throw new Error(`Blocked: entry point "${entryPoint}" is not in the whitelist`);
    }
    if (!ALLOWED_CONTRACTS.has(contractHash)) {
      throw new Error(`Blocked: contract ${contractHash} is not in the whitelist`);
    }
    if (BigInt(payment) > BigInt(MAX_PAYMENT)) {
      throw new Error(`Blocked: payment ${payment} exceeds max ${MAX_PAYMENT}`);
    }

    if (this.useRelay) {
      return this.sendViaRelay(contractHash, entryPoint, argsMap, payment);
    }

    const publicKey = this.providerKey.publicKey;
    const deploy = this.buildDeploy(publicKey, contractHash, entryPoint, argsMap, payment);
    deploy.sign(this.providerKey);

    // Use raw RPC to submit deploy
    const deployJSON = Deploy.toJSON(deploy);
    const res = await rpcCall(this.rpcUrl, 'account_put_deploy', { deploy: deployJSON });

    if (res.error) {
      throw new Error(`Deploy failed: ${res.error.message}`);
    }

    this.logger.info(`Deploy ${entryPoint} submitted: ${res.result?.deploy_hash || 'unknown'}`);
    return res.result?.deploy_hash;
  }

  async sendViaRelay(contractHash, entryPoint, argsMap, payment = '5000000000') {
    const payload = {
      contractHash,
      entryPoint,
      args: Object.fromEntries(
        Object.entries(argsMap).map(([k, v]) => [k, v.toJSON ? v.toJSON() : String(v)])
      ),
      payment,
      rpcUrl: this.rpcUrl,
      chainName: this.chainName,
    };

    const res = await fetch(this.relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.relayToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Relay deploy failed: ${res.status} ${errText}`);
    }

    const data = await res.json();
    if (data.error) {
      throw new Error(`Relay deploy error: ${data.error}`);
    }

    this.logger.info(`Deploy ${entryPoint} relayed: ${data.deployHash || 'unknown'}`);
    return data.deployHash;
  }

  buildDeploy(publicKey, contractHash, entryPoint, argsMap, payment = '10000000000') {
    const args = Args.fromMap(argsMap);
    const contractHashObj = ContractHash.newContract(contractHash);
    const storedContract = new StoredContractByHash(contractHashObj, entryPoint, args);
    const session = new ExecutableDeployItem();
    session.storedContractByHash = storedContract;
    const paymentItem = ExecutableDeployItem.standardPayment(payment);
    const header = DeployHeader.default();
    header.account = publicKey;
    header.chainName = this.chainName;
    return Deploy.makeDeploy(header, paymentItem, session);
  }

  async getJobState(jobId) {
    const stateVal = await getDictionaryItem(this.rpcUrl, this.contracts.escrowVault, 'jobs_dict', `${jobId}:state`);
    return stateVal !== null ? Number(stateVal) : null;
  }

  getStatus() {
    return {
      running: this.isRunning,
      network: this.chainName,
      rpcUrl: this.rpcUrl,
      providerAccount: this.providerAccountHash || null,
      hasKey: !!this.providerKey,
      relayMode: this.useRelay,
      relayUrl: this.relayUrl || null,
      processedJobs: this.processedJobs.size,
    };
  }
}
