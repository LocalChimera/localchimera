/**
 * BtfsStorageProvider — Walletless decentralized storage provider for untrusted machines.
 *
 * Each provider runs a local go-btfs daemon. Files are stored on the BTFS
 * network, not on a central server. The provider only pins and serves files
 * that correspond to on-chain storage jobs it has accepted.
 *
 * Security / no-local-key guarantee:
 *   - The SDK never asks for, stores, or requires a BTT wallet mnemonic.
 *   - The BTFS daemon's wallet is unfunded and unused; BTT storage-host mode
 *     is disabled so the daemon never signs cheques or storage contracts.
 *   - The only key material on the provider is the libp2p peer identity
 *     needed to join the BTFS swarm. It does not hold funds.
 *   - On-chain proof submission is done via a trusted relay OR a signer
 *     callback supplied by the app (e.g. a Web3Auth wallet bridge). The provider
 *     never holds the blockchain private key.
 */

import { spawn, execSync } from 'child_process';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { BtfsClient } from '../storage/BtfsClient.js';
import { Logger } from '../core/Logger.js';

const logger = new Logger('BtfsStorageProvider');
const DEFAULT_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const DEFAULT_CHAIN_NAME = 'robinhood';
const DEFAULT_REPO = path.join(os.homedir(), '.btfs-chimera');
const BTFS_IMAGE = 'bittorrent/go-btfs:latest';

const STATE = {
  PENDING: 0,
  ASSIGNED: 1,
  IN_PROGRESS: 2,
  PROVIDER_DONE: 3,
  CONSUMER_CONFIRM: 4,
  SETTLED: 5,
  REFUNDED: 6,
  DISPUTED: 7,
};

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
  const dictRes = await rpcCall(rpcUrl, 'state_get_dictionary_item', {
    state_root_hash: stateRootHash,
    dictionary_identifier: { URef: { seed_uref: dictUref, dictionary_item_key: dictKey } },
  });
  return dictRes.result?.stored_value?.CLValue?.parsed ?? null;
}

export class BtfsStorageProvider {
  constructor(opts = {}) {
    this.apiUrl = opts.apiUrl || 'http://127.0.0.1:5001';
    this.repoPath = opts.repoPath || DEFAULT_REPO;
    this.client = new BtfsClient({ apiUrl: this.apiUrl });
    this.process = null;
    this.running = false;
    this.daemonReady = false;
    this.logs = [];
    this.processedJobs = new Set();
    this.inProgressJobs = new Set();
    this.pollInterval = null;

    this.rpcUrl = opts.rpcUrl || process.env.CHIMERA_RPC_URL || DEFAULT_RPC_URL;
    this.chainName = opts.chainName || process.env.CHIMERA_CHAIN_NAME || DEFAULT_CHAIN_NAME;
    this.contracts = opts.contracts || { escrowVault: 'b8e8b7e087ec4ad7afcdc30460d39d5b6a8249875cd1e2da0716b89d710fda40' };
    this.relayUrl = opts.relayUrl || process.env.CHIMERA_RELAY_URL || '';
    this.relayToken = opts.relayToken || process.env.CHIMERA_RELAY_TOKEN || '';
    this.providerAccountHash = opts.providerAccountHash || process.env.CHIMERA_PROVIDER_ACCOUNT_HASH || '';
    this.signer = opts.signer || null;

    if (opts.providerKeyPem || process.env.CHIMERA_PROVIDER_KEY_PEM || process.env.CHIMERA_PROVIDER_KEY_PEM_PATH) {
      throw new Error('BtfsStorageProvider is relay/signer-only. Do not pass providerKeyPem.');
    }
  }

  async init() {
    this.inContainer = process.env.CHIMERA_PRIVACY_MODE === 'true';

    if (this.inContainer) {
      try {
        execSync('which btfs', { stdio: 'ignore' });
      } catch {
        throw new Error('btfs binary not found in container. Install in Dockerfile.');
      }
    } else {
      try {
        execSync('docker --version', { stdio: 'ignore' });
      } catch {
        throw new Error('Docker not available. BTFS provider requires Docker to run the go-btfs daemon.');
      }
    }
    if (!this.relayUrl && !this.signer) {
      throw new Error('CHIMERA_RELAY_URL or a signer callback is required. The provider never holds the private key.');
    }
    if (!this.providerAccountHash) {
      throw new Error('CHIMERA_PROVIDER_ACCOUNT_HASH is required (public, safe to share).');
    }
    logger.info('BTFS walletless storage provider initialized');
  }

  async start() {
    if (this.running) return { success: true, alreadyRunning: true };
    const daemon = await this._ensureDaemon();
    if (!daemon.success) return daemon;
    this.running = true;
    logger.info('Starting BTFS storage job polling...');
    await this._pollJobs();
    this.pollInterval = setInterval(() => this._pollJobs(), 15000).unref();
    return { success: true, provider: 'btfs-storage', mode: this.signer ? 'signer' : 'relay' };
  }

  async stop() {
    if (!this.running) return { success: true, alreadyStopped: true };
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.daemonReady = false;
    return { success: true, provider: 'btfs-storage' };
  }

  status() {
    return {
      provider: 'btfs-storage',
      running: this.running,
      daemonReady: this.daemonReady,
      apiUrl: this.apiUrl,
      repoPath: this.repoPath,
      pid: this.process?.pid || null,
      processedJobs: this.processedJobs.size,
      inProgressJobs: this.inProgressJobs.size,
      recentLogs: this.logs.slice(-10),
    };
  }

  getClient() { return this.client; }

  async storeFile(file, { wrapWithDirectory = false } = {}) {
    const result = await this.client.add(file, { pin: true, wrapWithDirectory });
    return result.Hash || result.hash || result.Cid || result.cid;
  }

  async pinByCid(cid) { return this.client.pinAdd(cid); }
  async retrieveFile(cid) { return this.client.cat(cid); }

  async _ensureDaemon() {
    const online = await this.client.isOnline();
    if (online) {
      this.daemonReady = true;
      return { success: true, mode: 'existing' };
    }
    await this._ensureRepo();
    return new Promise((resolve) => {
      if (this.inContainer) {
        logger.info('Starting BTFS daemon (inline)...');
        this.process = spawn('btfs', [
          'daemon',
          '--enable-storage-host=false',
        ], {
          env: { ...process.env, BTFS_PATH: this.repoPath },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } else {
        logger.info('Starting walletless BTFS daemon via Docker...');
        this.process = spawn('docker', [
          'run', '--rm',
          '-p', '5001:5001',
          '-p', '4001:4001',
          '-p', '4001:4001/udp',
          '-v', `${this.repoPath}:/data/btfs`,
          '-e', 'BTFS_PATH=/data/btfs',
          BTFS_IMAGE,
          'daemon',
          '--enable-storage-host=false',
        ]);
      }
      this.running = true;
      const appendLog = (level, data) => {
        const line = data.toString().trim();
        if (!line) return;
        this.logs.push({ ts: Date.now(), level, msg: line });
        if (this.logs.length > 500) this.logs.shift();
      };
      this.process.stdout.on('data', d => appendLog('info', d));
      this.process.stderr.on('data', d => appendLog('error', d));
      this.process.on('exit', code => { this.daemonReady = false; logger.warn(`BTFS daemon exited with code ${code}`); });
      const wait = async () => {
        for (let i = 0; i < 30; i++) {
          try {
            await this.client.id();
            this.daemonReady = true;
            logger.info('BTFS daemon online');
            resolve({ success: true, mode: 'spawned' });
            return;
          } catch { await new Promise(r => setTimeout(r, 1000)); }
        }
        resolve({ success: false, error: 'BTFS daemon did not become reachable within 30s' });
      };
      wait();
    });
  }

  async _ensureRepo() {
    await fs.mkdir(this.repoPath, { recursive: true });
    const initialized = await fs.access(path.join(this.repoPath, 'config')).then(() => true).catch(() => false);
    if (!initialized) {
      logger.info('Initializing BTFS repo...');
      try {
        if (this.inContainer) {
          execSync(`btfs init`, { stdio: 'ignore', env: { ...process.env, BTFS_PATH: this.repoPath } });
        } else {
          execSync(`docker run --rm -v "${this.repoPath}:/data/btfs" -e BTFS_PATH=/data/btfs ${BTFS_IMAGE} init`, { stdio: 'ignore' });
        }
      } catch {
        throw new Error('Failed to initialize BTFS repo. Ensure btfs binary or Docker image is available.');
      }
    }
  }

  async _pollJobs() {
    if (!this.running || !this.daemonReady) return;
    try {
      const pending = await getDictionaryItem(this.rpcUrl, this.contracts.escrowVault, 'pending_jobs', 'list');
      if (!pending || !Array.isArray(pending) || pending.length === 0) return;
      for (const jobId of pending) {
        if (this.processedJobs.has(jobId)) continue;
        await this._handleJob(jobId);
      }
    } catch (e) { logger.error(`BTFS poll error: ${e.message}`); }
  }

  async _handleJob(jobId) {
    if (this.inProgressJobs.has(jobId)) return;
    try {
      this.inProgressJobs.add(jobId);
      const stateVal = await getDictionaryItem(this.rpcUrl, this.contracts.escrowVault, 'jobs_dict', `${jobId}:state`);
      const providerVal = await getDictionaryItem(this.rpcUrl, this.contracts.escrowVault, 'jobs_dict', `${jobId}:provider`);
      const taskTypeVal = await getDictionaryItem(this.rpcUrl, this.contracts.escrowVault, 'jobs_dict', `${jobId}:task_type`);
      const requestHash = await getDictionaryItem(this.rpcUrl, this.contracts.escrowVault, 'jobs_dict', `${jobId}:request_hash`);

      const state = stateVal !== null ? Number(stateVal) : null;
      if (state === null || state >= STATE.PROVIDER_DONE) return;

      const toHex = (val) => {
        if (!val) return '';
        if (typeof val === 'string' && val.length === 64 && /^[0-9a-f]+$/.test(val)) return val;
        return Buffer.from(val).toString('hex');
      };
      const providerHex = toHex(providerVal);
      const isZeroProvider = providerHex === '0'.repeat(64);
      const tt = Number(taskTypeVal) || 0;
      const id = String(requestHash || jobId);
      if (!(id.startsWith('STORAGE:') || tt === 1)) {
        logger.debug(`Job ${jobId} is not a storage job, skipping`);
        return;
      }
      if (!isZeroProvider && providerHex !== this.providerAccountHash) {
        logger.debug(`Storage job ${jobId} not assigned to us`);
        return;
      }
      const responseHash = await this._processStorageJob(id);
      await this._sendToChain(this.contracts.escrowVault, 'provider_complete', {
        job_id: { cl_type: 'String', bytes: Buffer.from(jobId).toString('hex') },
        response_hash: { cl_type: 'String', bytes: Buffer.from(responseHash).toString('hex') },
      });
      logger.info(`Storage job ${jobId} completed and reported, CID: ${responseHash}`);
      this.processedJobs.add(jobId);
      this._monitorJobSettlement(jobId);
    } catch (e) { logger.error(`Failed to handle storage job ${jobId}: ${e.message}`); }
    finally { this.inProgressJobs.delete(jobId); }
  }

  async _processStorageJob(orderId) {
    const parts = orderId.split(':');
    const subType = parts[1] || 'ALLOC';
    const spaceName = parts[2] || 'unknown';
    if (subType === 'FILE' || subType === 'PIN') {
      const cid = parts[3] || '';
      if (!cid) throw new Error('Storage job missing CID');
      await this.pinByCid(cid);
      try {
        const blob = await this.retrieveFile(cid);
        return `PIN:${cid}:${spaceName}:${blob.size}`;
      } catch { return `PIN:${cid}:${spaceName}:0`; }
    }
    if (subType === 'RETRIEVE') {
      const cid = parts[3] || '';
      if (!cid) throw new Error('Storage job missing CID');
      const blob = await this.retrieveFile(cid);
      return `RETRIEVE:${cid}:${spaceName}:${blob.size}`;
    }
    const sizeMb = parts[3] || '0';
    return `ALLOC:${spaceName}:${sizeMb}`;
  }

  async _sendToChain(contractHash, entryPoint, argsMap, payment = '5000000000') {
    const ALLOWED_ENTRY_POINTS = new Set(['provider_ack', 'provider_complete', 'claim_payment']);
    const MAX_PAYMENT = '5000000000';
    if (!ALLOWED_ENTRY_POINTS.has(entryPoint)) throw new Error(`Blocked: entry point "${entryPoint}" is not in the whitelist`);
    if (BigInt(payment) > BigInt(MAX_PAYMENT)) throw new Error(`Blocked: payment ${payment} exceeds max ${MAX_PAYMENT}`);
    const payload = {
      contractHash,
      entryPoint,
      args: Object.fromEntries(Object.entries(argsMap).map(([k, v]) => [k, typeof v === 'object' ? v : String(v)])),
      payment,
      rpcUrl: this.rpcUrl,
      chainName: this.chainName,
    };
    if (this.signer) {
      const result = await this.signer(payload);
      if (result.error) throw new Error(`Signer error: ${result.error}`);
      return result.deployHash;
    }
    const res = await fetch(this.relayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.relayToken}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Relay deploy failed: ${res.status} ${errText}`);
    }
    const data = await res.json();
    if (data.error) throw new Error(`Relay deploy error: ${data.error}`);
    return data.deployHash;
  }

  async _monitorJobSettlement(jobId) {
    let attempts = 0;
    const maxAttempts = 40;
    const check = async () => {
      if (!this.running) return;
      attempts++;
      try {
        const stateVal = await getDictionaryItem(this.rpcUrl, this.contracts.escrowVault, 'jobs_dict', `${jobId}:state`);
        const state = stateVal !== null ? Number(stateVal) : null;
        if (state === null) return;
        if (state === STATE.SETTLED || state === STATE.CONSUMER_CONFIRM) {
          await this._sendToChain(this.contracts.escrowVault, 'claim_payment', {
            job_id: { cl_type: 'String', bytes: Buffer.from(jobId).toString('hex') },
          });
          return;
        }
        if (state === STATE.REFUNDED || state === STATE.DISPUTED) return;
        if (attempts < maxAttempts) setTimeout(check, 15000).unref();
      } catch (e) { if (attempts < maxAttempts) setTimeout(check, 15000).unref(); }
    };
    setTimeout(check, 15000).unref();
  }
}
