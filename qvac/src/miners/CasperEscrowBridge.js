import { createHash } from 'crypto';
import { Logger } from '../core/Logger.js';
import pkg from 'casper-js-sdk';

const sdk = pkg;
const { PrivateKey, PublicKey, KeyAlgorithm, CLValue, Args, ContractHash, StoredContractByHash, ExecutableDeployItem, DeployHeader, Deploy, RpcClient, HttpHandler } = sdk;

const DEFAULT_RPC_URL = 'https://node.testnet.casper.network/rpc';

const TESTNET_CONTRACTS = {
  escrowVault: '9d26a1353da754b478bd144b82b4642b562483da7565cd9f4e3e5dbb9e6b8afa',
  computeRegistry: 'bed17bda7a3597725a5d19531faae67bd2f68f08be17d02ea36a6830be2fc152',
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

      // Skip already processed jobs
      if (state >= STATE.PROVIDER_DONE) {
        this.logger.debug(`Job ${jobId} already completed (state=${state})`);
        return;
      }

      // Skip zero-provider jobs in PENDING state — the current contract requires
      // provider_ack to be called by the assigned provider, and zero-provider jobs
      // have no assigned provider. Only ASSIGNED zero-provider jobs (auto-assigned
      // by a newer contract version) can be completed directly.
      if (isZeroProvider && state === STATE.PENDING) {
        this.logger.debug(`Job ${jobId} has zero provider in PENDING state, skipping (no auto-assign in this contract version)`);
        this.processedJobs.add(jobId);
        return;
      }

      // Auto-assigned jobs: provider is zero, state should be ASSIGNED
      // Skip provider_ack and go straight to inference + provider_complete
      if (isZeroProvider && state === STATE.ASSIGNED) {
        this.logger.info(`Auto-assigned job ${jobId}, completing directly...`);

        // Get the request hash (order_id/prompt)
        const requestHash = await getDictionaryItem(this.rpcUrl, this.contracts.escrowVault, 'jobs_dict', `${jobId}:request_hash`);
        this.logger.info(`Job ${jobId} request: ${requestHash}`);

        // Run inference
        const inferenceResult = await this.runInference(requestHash || jobId);

        // Compute response hash
        const responseHash = stringToHash(JSON.stringify(inferenceResult));
        this.logger.info(`Job ${jobId} response hash: ${responseHash}`);

        // Complete job
        await this.providerComplete(jobId, responseHash);
        this.logger.info(`Job ${jobId} completed, awaiting consumer confirmation...`);

        this.processedJobs.add(jobId);
        this.monitorJobSettlement(jobId);
        return;
      }

      // Non-auto-assigned jobs: only handle jobs assigned to us
      if (!isZeroProvider && providerHex !== this.providerAccountHash) {
        this.logger.debug(`Job ${jobId} not assigned to us`);
        return;
      }

      // If already ASSIGNED, skip provider_ack and go straight to inference + complete
      if (state === STATE.ASSIGNED) {
        this.logger.info(`Job ${jobId} already ASSIGNED, completing directly...`);

        const requestHash = await getDictionaryItem(this.rpcUrl, this.contracts.escrowVault, 'jobs_dict', `${jobId}:request_hash`);
        this.logger.info(`Job ${jobId} request: ${requestHash}`);

        const inferenceResult = await this.runInference(requestHash || jobId);
        const responseHash = stringToHash(JSON.stringify(inferenceResult));
        this.logger.info(`Job ${jobId} response hash: ${responseHash}`);

        await this.providerComplete(jobId, responseHash);
        this.logger.info(`Job ${jobId} completed, awaiting consumer confirmation...`);

        this.processedJobs.add(jobId);
        this.monitorJobSettlement(jobId);
        return;
      }

      if (state !== STATE.PENDING) {
        this.logger.debug(`Job ${jobId} not pending (state=${state})`);
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

      // Run inference
      const inferenceResult = await this.runInference(requestHash || jobId);

      // Compute response hash
      const responseHash = stringToHash(JSON.stringify(inferenceResult));
      this.logger.info(`Job ${jobId} response hash: ${responseHash}`);

      // Complete job
      await this.providerComplete(jobId, responseHash);
      this.logger.info(`Job ${jobId} completed, awaiting consumer confirmation...`);

      // Mark as processed so we don't re-process
      this.processedJobs.add(jobId);

      // Start monitoring for settlement
      this.monitorJobSettlement(jobId);

    } catch (e) {
      this.logger.error(`Failed to handle job ${jobId}: ${e.message}`);
    }
  }

  async runInference(prompt) {
    if (!this.inferenceLayer) {
      this.logger.warn('No inference layer available, returning mock result');
      return { output: `Mock inference for: ${prompt}`, tokensGenerated: 0, durationMs: 0, fallback: true };
    }

    this.logger.info(`Routing inference request: "${String(prompt).slice(0, 80)}..."`);

    try {
      const result = await this.inferenceLayer.handleInferenceRequest({
        prompt: String(prompt),
        maxTokens: 512,
        temperature: 0.7,
        source: 'casper-escrow',
      });

      this.logger.info(`Inference completed: ${result.success ? 'success' : 'failed'}`);
      return result;
    } catch (e) {
      this.logger.error(`Inference error: ${e.message}`);
      return { output: `Error: ${e.message}`, tokensGenerated: 0, durationMs: 0, fallback: true };
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

  async sendDeploy(contractHash, entryPoint, argsMap, payment = '1000000000') {
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

  async sendViaRelay(contractHash, entryPoint, argsMap, payment = '10000000000') {
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
