import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { marketApi } from '../api/marketApi.js';

const DEFAULT_HEARTBEAT_MS = 30000;

/**
 * CoordinatorClient (Node.js) — connects a QVAC miner to the volunteer coordinator.
 *
 * Volunteers register their supported task types and capabilities; the coordinator
 * pushes matching jobs to them via WebSocket. The miner executes the job and returns
 * the result, which the coordinator then submits on-chain.
 *
 * v2 tokenomics: supports CHIMERA-based job creation, stake-weighted provider
 * selection, consumer boost, and slash evidence reporting.
 */
export class CoordinatorClient extends EventEmitter {
  constructor(options) {
    super();
    this.url = options.url;
    this.token = options.token || 'development-token';
    this.volunteerId = options.volunteerId;
    this.address = options.address || '';
    this.taskTypes = options.taskTypes || [];
    this.networks = options.networks || ['botchain'];
    this.capabilities = options.capabilities || {};
    this.heartbeatMs = options.heartbeatMs || DEFAULT_HEARTBEAT_MS;
    this.ws = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;

    // v2 tokenomics
    this.chimeraStakingEnabled = options.chimeraStakingEnabled !== false;
    this.providerTier = options.providerTier || 2;
    this.stakeWeight = options.stakeWeight || '0';
    this.premiumStatus = options.premiumStatus || { priorityRouting: false, higherThroughput: false, customPricing: false };
    this.consumerBoostStaked = options.consumerBoostStaked || '0';
    this.privateKeyPem = options.privateKeyPem || null;
  }

  connect() {
    if (this.ws) return;
    const fullUrl = `${this.url}?token=${encodeURIComponent(this.token)}`;
    this.ws = new WebSocket(fullUrl);

    this.ws.on('open', () => {
      this.send({
        type: 'REGISTER',
        volunteerId: this.volunteerId,
        address: this.address,
        taskTypes: this.taskTypes,
        networks: this.networks,
        capabilities: this.capabilities,
        network: this.networks[0] || 'qvac',
        // v2 tokenomics: include staking tier, weight, and premium status
        providerTier: this.providerTier,
        stakeWeight: this.stakeWeight,
        premiumStatus: this.premiumStatus,
        chimeraStakingEnabled: this.chimeraStakingEnabled,
      });
      this.startHeartbeat();
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      try {
        const envelope = JSON.parse(data.toString());
        this.handleMessage(envelope);
      } catch (e) {
        this.emit('error', new Error(`Message parse error: ${e.message}`));
      }
    });

    this.ws.on('close', () => {
      this.cleanup();
      this.emit('disconnected');
      this.reconnectTimer = setTimeout(() => this.connect(), 5000);
    });

    this.ws.on('error', (err) => {
      this.emit('error', err);
    });
  }

  disconnect() {
    this.cleanup();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  cleanup() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this.send({
        type: 'HEARTBEAT',
        volunteerId: this.volunteerId,
        status: 'idle',
        taskTypes: this.taskTypes,
        capabilities: this.capabilities,
        network: this.networks[0] || 'qvac',
        // v2 tokenomics: keep coordinator informed of stake/premium status
        providerTier: this.providerTier,
        stakeWeight: this.stakeWeight,
        premiumStatus: this.premiumStatus,
      });
    }, this.heartbeatMs);
  }

  send(envelope) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope));
    }
  }

  handleMessage(envelope) {
    switch (envelope.type) {
      case 'REGISTERED':
        this.emit('registered', envelope.volunteerId);
        break;
      case 'JOB_DISPATCH':
        this.emit('job', envelope);
        break;
      case 'ERROR':
        this.emit('error', new Error(envelope.error));
        break;
      default:
        break;
    }
  }

  submitResult(jobId, jobAddress, network, result) {
    this.send({
      type: 'JOB_RESULT',
      jobId,
      jobAddress,
      network,
      volunteerId: this.volunteerId,
      result,
    });
  }

  rejectJob(jobId, jobAddress, network, reason) {
    this.send({
      type: 'JOB_REJECTED',
      jobId,
      jobAddress,
      network,
      volunteerId: this.volunteerId,
      reason,
    });
  }

  // ───────────────────────── v2 Tokenomics Methods ─────────────────────────

  /**
   * v2 tokenomics: Create a CHIMERA-based job via the v2 coordinator.
   * Requires privateKeyPem to be set on the client.
   * @param {string} requestHash - Hash of the request payload
   * @param {number} taskType - 1=compute, 2=storage, 4=inference, 8=bandwidth
   * @param {string} amount - CHIMERA amount to pay
   * @param {number} policy - 0=hybrid, 1=first-party-only, 2=second-party-only
   */
  async createChimeraJob(requestHash, taskType, amount, policy = 0) {
    if (!this.privateKeyPem) {
      throw new Error('createChimeraJob requires privateKeyPem to be set on CoordinatorClient');
    }
    const result = await marketApi.createChimeraJob({
      privateKeyPem: this.privateKeyPem,
      requestHash,
      taskType,
      amount,
      policy,
    });
    return result;
  }

  /**
   * v2 tokenomics: Claim payment after completing a job via the v2 coordinator.
   * @param {string} jobAddress - The job address
   * @param {string} responseHash - Hash of the response payload
   */
  async claimChimeraPayment(jobAddress, responseHash) {
    if (!this.privateKeyPem) {
      throw new Error('claimChimeraPayment requires privateKeyPem to be set on CoordinatorClient');
    }
    return await marketApi.payProvider({
      privateKeyPem: this.privateKeyPem,
      jobAddress,
      responseHash,
    });
  }

  /**
   * v2 tokenomics: Report slash evidence for a provider that failed a job.
   * The coordinator will trigger fallback and slash the provider's stake.
   * @param {string} jobAddress - The job address that failed
   */
  async reportSlashEvidence(jobAddress) {
    if (!this.privateKeyPem) {
      throw new Error('reportSlashEvidence requires privateKeyPem to be set on CoordinatorClient');
    }
    return await marketApi.triggerFallback({
      privateKeyPem: this.privateKeyPem,
      jobAddress,
    });
  }

  /**
   * v2 tokenomics: Stake CHIMERA as a provider to become Tier 1.
   * @param {string} amount - CHIMERA amount to stake
   * @param {number} lockPeriodDays - 0, 30, 90, or 365
   */
  async stakeAsProvider(amount, lockPeriodDays = 0) {
    if (!this.privateKeyPem) {
      throw new Error('stakeAsProvider requires privateKeyPem to be set on CoordinatorClient');
    }
    return await marketApi.stakeChimera({
      privateKeyPem: this.privateKeyPem,
      amount,
      lockPeriodDays,
    });
  }

  /**
   * v2 tokenomics: Stake CHIMERA as a consumer for job priority boost.
   * @param {string} amount - CHIMERA amount to stake
   */
  async consumerBoostStake(amount) {
    if (!this.privateKeyPem) {
      throw new Error('consumerBoostStake requires privateKeyPem to be set on CoordinatorClient');
    }
    return await marketApi.consumerBoostStake({
      privateKeyPem: this.privateKeyPem,
      amount,
    });
  }

  /**
   * v2 tokenomics: Update this client's staking status from the on-chain contract.
   * Called periodically to keep the coordinator informed.
   */
  async refreshStakingStatus() {
    if (!this.address) return;
    try {
      const stakeInfo = await marketApi.getStakeInfo(this.address);
      this.stakeWeight = stakeInfo.weight || '0';
      this.providerTier = BigInt(stakeInfo.staked || '0') > 0n ? 1 : 2;
      this.premiumStatus = await marketApi.getPremiumStatus(this.address);
    } catch (e) {
      // Staking contract may not be deployed yet; silently continue
    }
  }
}
