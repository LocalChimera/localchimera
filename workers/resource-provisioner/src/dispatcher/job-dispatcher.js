import { BotchainClient, BOTCHAIN_JOB_STATE, TASK_POLICY } from '../contracts/botchain-client.js';
import { CasperClient, CASPER_JOB_STATE } from '../contracts/casper-client.js';
import { executeViaTaskingNetwork } from './execution-router.js';
import { VolunteerCoordinator } from '../coordinator/server.js';
import { normalizeTaskType } from '../coordinator/task-types.js';
import { zeroAddress } from 'viem';

const VOLUNTEER_DISPATCH_MS = Number(process.env.VOLUNTEER_DISPATCH_MS || '10000');
const VOLUNTEER_DISPATCH_RETRIES = Number(process.env.VOLUNTEER_DISPATCH_RETRIES || '2');
const FALLBACK_POLL_INTERVAL_MS = Number(process.env.FALLBACK_POLL_INTERVAL_MS || '15000');
const MAX_PENDING_AGE_MS = Number(process.env.MAX_PENDING_AGE_MS || '300000'); // 5 min

/**
 * JobDispatcher watches Casper and Botchain escrow contracts for pending jobs.
 *
 * Flow:
 *   1. Detect pending job.
 *   2. Try to actively dispatch the job to a connected volunteer via the
 *      VolunteerCoordinator (volunteers register with task types and capabilities).
 *   3. If the volunteer accepts and returns a result, submit it on-chain.
 *   4. If no volunteer is connected/capable/available, fall back to an external
 *      tasking network (Golem, Mysterium, BTFS, BTT AI, etc.) and submit that result.
 */
export class JobDispatcher {
  constructor(config = {}) {
    this.config = config;
    this.botchain = null;
    this.casper = null;
    this.coordinator = null;
    this.isRunning = false;
    this.pollTimer = null;
    this.seenJobs = new Map(); // key -> { network, firstSeen, handled }
    this.pendingResults = new Map(); // jobKey -> promise helpers

    if (process.env.BOTCHAIN_PRIVATE_KEY) {
      this.botchain = new BotchainClient(process.env.BOTCHAIN_PRIVATE_KEY);
    } else {
      console.log('[dispatcher] Botchain private key not configured; Botchain fallback disabled');
    }

    if (process.env.CASPER_PROVIDER_KEY_PEM || process.env.CASPER_PROVIDER_KEY_PEM_PATH) {
      this.casper = new CasperClient({
        rpcUrl: process.env.CASPER_RPC_URL,
        chainName: process.env.CASPER_CHAIN_NAME,
        providerKeyPem: process.env.CASPER_PROVIDER_KEY_PEM,
        providerKeyPemPath: process.env.CASPER_PROVIDER_KEY_PEM_PATH,
        contracts: {
          escrowVault: process.env.CASPER_ESCROW_VAULT,
          computeRegistry: process.env.CASPER_COMPUTE_REGISTRY,
        },
      });
    } else {
      console.log('[dispatcher] Casper provider key not configured; Casper fallback disabled');
    }
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[dispatcher] starting job dispatcher');

    this.coordinator = new VolunteerCoordinator();
    this.coordinator.on('job:result', (payload) => this.handleVolunteerResult(payload));
    this.coordinator.on('job:rejected', (payload) => this.handleVolunteerRejected(payload));
    this.coordinator.start();

    if (this.botchain?.coordinator) {
      this.botchain.onCoordinatorEvent('FallbackBridged', (jobId, jobAddress, taskType, policy, amount, bridgeDispatcher) => {
        this.handleCoordinatorFallbackBridged(jobAddress, taskType, policy, amount);
      });
      console.log(`[dispatcher] listening to FallbackBridged from coordinator ${this.botchain.coordinator.address}`);
    }

    await this.poll();
    this.pollTimer = setInterval(() => this.poll(), FALLBACK_POLL_INTERVAL_MS);
  }

  stop() {
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.coordinator) {
      this.coordinator.stop();
      this.coordinator = null;
    }
    if (this.botchain) {
      this.botchain.removeCoordinatorListeners();
    }
  }

  async poll() {
    if (!this.isRunning) return;

    try {
      if (this.botchain) await this.pollBotchain();
    } catch (err) {
      console.error('[dispatcher] Botchain poll error:', err.message);
    }

    try {
      if (this.casper) await this.pollCasper();
    } catch (err) {
      console.error('[dispatcher] Casper poll error:', err.message);
    }
  }

  async pollBotchain() {
    const pending = await this.botchain.getPendingJobAddresses();
    if (!pending.length) return;

    const coordinatorAddress = this.botchain?.coordinator?.address?.toLowerCase();

    for (const { jobId, jobAddress } of pending) {
      const key = `botchain:${jobAddress}`;
      if (this.seenJobs.has(key)) continue;
      const job = await this.botchain.getJob(jobAddress);
      if (!job) continue;
      if (job.state !== BOTCHAIN_JOB_STATE.PENDING) continue;
      if (expired(job)) continue;

      const policy = await this.botchain.getJobPolicy(jobAddress);
      const isCoordinatorJob = coordinatorAddress && job.providerAuthority?.toLowerCase() === coordinatorAddress;

      // First-party-only jobs must be handled by the assigned volunteer; never fall back here.
      if (policy === TASK_POLICY.FIRST_PARTY_ONLY) continue;

      // Second-party-only and hybrid jobs assigned to the coordinator need tasking-network fallback.
      if (job.providerAuthority && job.providerAuthority !== zeroAddress && !isCoordinatorJob) continue;

      const canonicalTaskType = normalizeTaskType(job.taskType, 'botchain');
      this.seenJobs.set(key, { network: 'botchain', firstSeen: Date.now(), handled: false, policy });
      this.dispatchOrFallback('botchain', jobAddress, job, canonicalTaskType, ['botchain'], policy);
    }
  }

  async pollCasper() {
    const pending = await this.casper.getPendingJobs();
    if (!pending.length) return;

    for (const jobId of pending) {
      const key = `casper:${jobId}`;
      if (this.seenJobs.has(key)) continue;
      const job = await this.casper.getJob(jobId);
      if (!job || job.state !== CASPER_JOB_STATE.PENDING) continue;
      if (job.provider && !isZeroProvider(job.provider)) continue;
      if (expired(job)) continue;

      const canonicalTaskType = normalizeTaskType(job.taskType || 0, 'casper');
      this.seenJobs.set(key, { network: 'casper', firstSeen: Date.now(), handled: false });
      this.dispatchOrFallback('casper', jobId, job, canonicalTaskType, ['casper']);
    }
  }

  async dispatchOrFallback(network, jobId, job, taskType, supportedNetworks, policy = TASK_POLICY.HYBRID) {
    const key = `${network}:${jobId}`;
    const seen = this.seenJobs.get(key);
    if (!seen || seen.handled) return;

    // Second-party-only jobs are sent straight to tasking networks.
    if (policy === TASK_POLICY.SECOND_PARTY_ONLY) {
      console.log(`[dispatcher] ${network} job ${jobId} is second-party-only; using tasking network`);
      seen.handled = true;
      await this.fallbackToTaskingNetwork(network, jobId, job, taskType);
      return;
    }

    // Try to actively dispatch to a connected volunteer first
    let dispatched = false;
    for (let attempt = 0; attempt < VOLUNTEER_DISPATCH_RETRIES; attempt++) {
      const result = await this.coordinator.dispatchJob({
        jobId,
        jobAddress: network === 'botchain' ? jobId : undefined,
        taskType,
        requestHash: job.requestHash,
        amount: job.amount,
        validUntil: job.validUntil,
        networks: [network],
      }, network, VOLUNTEER_DISPATCH_MS);

      if (result.accepted) {
        console.log(`[dispatcher] ${network} job ${jobId} dispatched to volunteer ${result.volunteerId}`);
        // Wait for volunteer result via coordinator event
        const volunteerResult = await this.awaitVolunteerResult(key, VOLUNTEER_DISPATCH_MS * 3);
        if (volunteerResult) {
          seen.handled = true;
          await this.submitResult(network, jobId, job, volunteerResult);
          return;
        }
        dispatched = true;
        console.warn(`[dispatcher] volunteer ${result.volunteerId} accepted ${network} job ${jobId} but did not return a result; will retry/fallback`);
      } else {
        console.log(`[dispatcher] no volunteer accepted ${network} job ${jobId} (attempt ${attempt + 1})`);
      }
    }

    // No volunteer available — fall back to tasking network
    console.log(`[dispatcher] no volunteer available for ${network} job ${jobId}; falling back to tasking network`);
    seen.handled = true;
    await this.fallbackToTaskingNetwork(network, jobId, job, taskType);
  }

  async fallbackToTaskingNetwork(network, jobId, job, taskType) {
    try {
      if (network === 'botchain') {
        await this.botchain.providerAck(jobId, job.requestHash || '0x' + '0'.repeat(64));
      } else if (network === 'casper') {
        await this.casper.providerAck(jobId);
      }
    } catch (err) {
      console.warn(`[dispatcher] ${network} providerAck failed: ${err.message}; trying fallback anyway`);
    }

    try {
      const execution = await executeViaTaskingNetwork(taskType, job, this.config);
      if (!execution.success) {
        console.warn(`[dispatcher] tasking network execution failed for ${network} job ${jobId}`);
      }
      await this.submitResult(network, jobId, job, execution.responseHash);
      console.log(`[dispatcher] ${network} job ${jobId} completed via tasking network: ${execution.responseHash}`);
    } catch (err) {
      console.error(`[dispatcher] failed to complete ${network} job ${jobId}:`, err.message);
    }
  }

  async submitResult(network, jobId, job, result) {
    const responseHash = typeof result === 'string' ? result : (result.responseHash || result.result || '');
    if (network === 'botchain') {
      await this.botchain.providerComplete(jobId, responseHash, '0x');
    } else if (network === 'casper') {
      await this.casper.providerComplete(jobId, responseHash);
    }
  }

  awaitVolunteerResult(key, timeoutMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingResults.delete(key);
        resolve(null);
      }, timeoutMs);

      this.pendingResults.set(key, (result) => {
        clearTimeout(timer);
        this.pendingResults.delete(key);
        resolve(result);
      });
    });
  }

  handleVolunteerResult(payload) {
    const key = `${payload.network}:${payload.jobId}`;
    const resolver = this.pendingResults.get(key);
    if (resolver) {
      resolver(payload.result);
    } else {
      console.log(`[dispatcher] volunteer result for ${key} but no pending resolver`);
    }
  }

  handleVolunteerRejected(payload) {
    const key = `${payload.network}:${payload.jobId}`;
    const resolver = this.pendingResults.get(key);
    if (resolver) {
      resolver(null);
    }
    console.log(`[dispatcher] volunteer rejected ${key}: ${payload.reason}`);
  }

  async handleCoordinatorFallbackBridged(jobAddress, taskType, policy, amount) {
    if (policy === TASK_POLICY.FIRST_PARTY_ONLY) return;
    const key = `botchain:${jobAddress}`;
    if (this.seenJobs.has(key)) {
      const seen = this.seenJobs.get(key);
      if (seen.handled) return;
    }
    const job = await this.botchain.getJob(jobAddress);
    if (!job || job.state >= BOTCHAIN_JOB_STATE.PROVIDER_DONE) return;
    this.seenJobs.set(key, { network: 'botchain', firstSeen: Date.now(), handled: false, policy });
    const canonicalTaskType = normalizeTaskType(taskType, 'botchain');
    console.log(`[dispatcher] on-chain bridge completed for ${jobAddress}; executing tasking network with ${amount}`);
    await this.fallbackToTaskingNetwork('botchain', jobAddress, job, canonicalTaskType);
  }
}


function isZeroProvider(providerHex) {
  return !providerHex || providerHex === '0'.repeat(64);
}

function expired(job) {
  const createdAt = job.createdAt || (job.validUntil ? Math.min(job.createdAt || Infinity, job.validUntil || Infinity) : 0);
  if (!createdAt) return false;
  return (Date.now() - createdAt * 1000) > MAX_PENDING_AGE_MS;
}
