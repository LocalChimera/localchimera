import { createHash } from 'crypto';
import { promises as fs, readFileSync } from 'fs';
import { Logger } from '../core/Logger.js';
import { createWalletClient, createPublicClient, http, parseEther, encodeFunctionData, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { robinhoodChain, CHIMERA_CONTRACTS } from '../config/chains.js';

const RPC_URL = process.env.CHIMERA_RPC_URL || robinhoodChain.rpcUrls.default.http[0];

const ESCROW_VAULT = process.env.ESCROW_VAULT_ADDRESS || '';
const COMPUTE_REGISTRY = process.env.COMPUTE_REGISTRY_ADDRESS || '';

// v2 tokenomics contract addresses
const CHIMERA_TOKEN = CHIMERA_CONTRACTS.chimeraToken;
const CHIMERA_STAKING = CHIMERA_CONTRACTS.chimeraStaking;
const CHIMERA_COORDINATOR = CHIMERA_CONTRACTS.coordinator;
const CHIMERA_GOVERNANCE = CHIMERA_CONTRACTS.chimeraGovernance;
const POI_VERIFIER = CHIMERA_CONTRACTS.proofOfInference;

const logger = new Logger('MarketAPI');

const ESCROW_VAULT_ABI = [
  {
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'orderId', type: 'string' },
    ],
    name: 'createJob',
    outputs: [{ name: 'jobId', type: 'bytes32' }],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ name: 'jobId', type: 'bytes32' }],
    name: 'getJobState',
    outputs: [{ name: 'state', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'jobId', type: 'bytes32' }],
    name: 'getJobAmount',
    outputs: [{ name: 'amount', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

const STATES = ['pending', 'assigned', 'in_progress', 'provider_done', 'consumer_confirmed', 'settled', 'refunded', 'disputed', 'dispute_consumer_won', 'dispute_provider_won'];

// ───────────────────────── v2 Tokenomics ABIs ─────────────────────────

const CHIMERA_TOKEN_ABI = [
  { inputs: [], name: 'name', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'symbol', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ name: '', type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalSupply', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'transfer', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'approve', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], name: 'allowance', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'amount', type: 'uint256' }], name: 'burn', outputs: [], stateMutability: 'nonpayable', type: 'function' },
];

const CHIMERA_STAKING_ABI = [
  { inputs: [{ name: 'amount', type: 'uint256' }, { name: 'lockPeriodDays', type: 'uint256' }], name: 'stake', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'amount', type: 'uint256' }], name: 'unstake', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'claimUnstake', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'claimVestedRewards', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'amount', type: 'uint256' }], name: 'consumerBoostStake', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'amount', type: 'uint256' }], name: 'consumerBoostUnstake', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'provider', type: 'address' }, { name: 'featureId', type: 'uint8' }], name: 'burnForPremium', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'referrer', type: 'address' }], name: 'setReferrer', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'provider', type: 'address' }], name: 'getStake', outputs: [{ name: 'staked', type: 'uint256' }, { name: 'weight', type: 'uint256' }, { name: 'lockMultiplier', type: 'uint256' }, { name: 'unlockAt', type: 'uint256' }, { name: 'unstakeAvailableAt', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'provider', type: 'address' }], name: 'getPremiumStatus', outputs: [{ name: 'priorityRouting', type: 'bool' }, { name: 'higherThroughput', type: 'bool' }, { name: 'customPricing', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'user', type: 'address' }], name: 'getReferralInfo', outputs: [{ name: 'referrer', type: 'address' }, { name: 'jobsCounted', type: 'uint256' }, { name: 'totalEarned', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'staker', type: 'address' }], name: 'getVestingInfo', outputs: [{ name: 'totalVested', type: 'uint256' }, { name: 'claimed', type: 'uint256' }, { name: 'available', type: 'uint256' }, { name: 'vestStart', type: 'uint256' }, { name: 'vestEnd', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'getCircuitBreakerStatus', outputs: [{ name: 'slashVolume24h', type: 'uint256' }, { name: 'totalStaked', type: 'uint256' }, { name: 'triggered', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalStaked', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'minStake', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'consumer', type: 'address' }], name: 'consumerBoostBalance', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
];

const CHIMERA_COORDINATOR_V2_ABI = [
  { inputs: [{ name: 'requestHash', type: 'bytes32' }, { name: 'nonce', type: 'uint64' }, { name: 'taskType', type: 'uint64' }, { name: 'amount', type: 'uint256' }, { name: 'policy', type: 'uint8' }], name: 'createJob', outputs: [{ name: 'jobAddress', type: 'address' }, { name: 'jobId', type: 'bytes32' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'jobAddress', type: 'address' }, { name: 'responseHash', type: 'bytes32' }], name: 'payProvider', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'jobAddress', type: 'address' }], name: 'triggerFallback', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'user', type: 'address' }], name: 'getPlatformFeeBps', outputs: [{ name: '', type: 'uint16' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: '_maxSlippageBps', type: 'uint256' }], name: 'executeBuyback', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: '_maxSlippageBps', type: 'uint256' }], name: 'executeFeeSwap', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'distributeFees', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'accumulatedPlatformFees', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'buybackAccumulated', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'paused', outputs: [{ name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
];

const CHIMERA_GOVERNANCE_ABI = [
  { inputs: [{ name: 'targets', type: 'address[]' }, { name: 'values', type: 'uint256[]' }, { name: 'calldatas', type: 'bytes[]' }, { name: 'description', type: 'string' }], name: 'propose', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'proposalId', type: 'uint256' }, { name: 'support', type: 'bool' }], name: 'castVote', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'proposalId', type: 'uint256' }], name: 'executeProposal', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'proposalId', type: 'uint256' }], name: 'cancelProposal', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'proposalId', type: 'uint256' }], name: 'getProposalState', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'amount', type: 'uint256' }], name: 'lockForDisputes', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'amount', type: 'uint256' }], name: 'unlockFromDisputes', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'slashId', type: 'uint256' }, { name: 'slashAmount', type: 'uint256' }], name: 'createSlashAppeal', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'appealId', type: 'uint256' }, { name: 'guilty', type: 'bool' }], name: 'voteOnAppeal', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'appealId', type: 'uint256' }], name: 'resolveAppeal', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'juror', type: 'address' }], name: 'jurors', outputs: [{ name: 'lockedAmount', type: 'uint256' }, { name: 'active', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'appealCount', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'proposalCount', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
];

function loadPrivateKey(pemOrPath) {
  let pem;
  if (pemOrPath.includes('BEGIN') && pemOrPath.includes('PRIVATE KEY')) {
    pem = pemOrPath.includes('\\n') ? pemOrPath.replace(/\\n/g, '\n') : pemOrPath;
  } else {
    pem = readFileSync(pemOrPath, 'utf8');
  }
  const rawKey = pem
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, '')
    .replace(/-----END [A-Z ]*PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  return Buffer.from(rawKey, 'base64').toString('hex');
}

function getWalletClient(privateKeyHex) {
  const account = privateKeyToAccount(`0x${privateKeyHex}`);
  return createWalletClient({
    account,
    chain: robinhoodChain,
    transport: http(RPC_URL),
  });
}

function getPublicClient() {
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(RPC_URL),
  });
}

function toWei(amount) {
  return parseEther(String(amount));
}

function makeOrderId(prefix, parts) {
  return `${prefix}:${parts.join(':')}`;
}

function keccak256Id(str) {
  return '0x' + createHash('sha256').update(str).digest('hex');
}

const marketApi = {
  async createInferenceJob({ privateKeyPem, prompt, amountCSPR = '10' }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const orderId = makeOrderId('INFERENCE', [prompt.slice(0, 64)]);
    const tx = await client.writeContract({
      address: ESCROW_VAULT,
      abi: ESCROW_VAULT_ABI,
      functionName: 'createJob',
      args: ['0x0000000000000000000000000000000000000000', toWei(amountCSPR), orderId],
      value: toWei(amountCSPR),
    });
    return { txHash: tx, order_id: orderId, resource_type: 'inference', amount: amountCSPR };
  },

  async createStorageAllocation({ privateKeyPem, spaceName, sizeMb, amountCSPR = '10' }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const orderId = makeOrderId('STORAGE:ALLOC', [spaceName, `${sizeMb}MB`]);
    const tx = await client.writeContract({
      address: ESCROW_VAULT,
      abi: ESCROW_VAULT_ABI,
      functionName: 'createJob',
      args: ['0x0000000000000000000000000000000000000000', toWei(amountCSPR), orderId],
      value: toWei(amountCSPR),
    });
    return { txHash: tx, order_id: orderId, resource_type: 'storage', sub_type: 'allocation', space_name: spaceName, size_mb: sizeMb, amount: amountCSPR };
  },

  async createStorageFile({ privateKeyPem, spaceName, fileHash, fileSizeMb, amountCSPR = '5', mode = 'file', anonymous = false, encrypted = false, tags = '', description = '' }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const upperMode = String(mode).toUpperCase();
    const orderId = makeOrderId(`STORAGE:${upperMode}`, [spaceName, fileHash, `${fileSizeMb}MB`]);
    const tx = await client.writeContract({
      address: ESCROW_VAULT,
      abi: ESCROW_VAULT_ABI,
      functionName: 'createJob',
      args: ['0x0000000000000000000000000000000000000000', toWei(amountCSPR), orderId],
      value: toWei(amountCSPR),
    });
    return { txHash: tx, order_id: orderId, resource_type: 'storage', sub_type: upperMode.toLowerCase(), space_name: spaceName, file_hash: fileHash, file_size_mb: fileSizeMb, amount: amountCSPR, mode: upperMode, anonymous, encrypted, tags, description };
  },

  async retrieveFile({ privateKeyPem, spaceName, fileHash, amountCSPR = '1' }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const orderId = makeOrderId('STORAGE:RETRIEVE', [spaceName, fileHash]);
    const tx = await client.writeContract({
      address: ESCROW_VAULT,
      abi: ESCROW_VAULT_ABI,
      functionName: 'createJob',
      args: ['0x0000000000000000000000000000000000000000', toWei(amountCSPR), orderId],
      value: toWei(amountCSPR),
    });
    return { txHash: tx, order_id: orderId, resource_type: 'storage', sub_type: 'retrieve', space_name: spaceName, file_hash: fileHash, amount: amountCSPR };
  },

  async createComputeJob({ privateKeyPem, runtime = 'shell', code, cpuCores = '2', ramMb = '512', gpu = false, timeoutSec = '30', amountCSPR = '10' }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const orderId = makeOrderId('COMPUTE', [runtime, cpuCores, ramMb, gpu ? '1' : '0', timeoutSec, code.slice(0, 32)]);
    const tx = await client.writeContract({
      address: ESCROW_VAULT,
      abi: ESCROW_VAULT_ABI,
      functionName: 'createJob',
      args: ['0x0000000000000000000000000000000000000000', toWei(amountCSPR), orderId],
      value: toWei(amountCSPR),
    });
    return { txHash: tx, order_id: orderId, resource_type: 'compute', runtime, cpu_cores: cpuCores, ram_mb: ramMb, gpu, timeout_sec: timeoutSec, amount: amountCSPR };
  },

  async createBandwidthJob({ privateKeyPem, durationHours = '1', dataAllowanceGb = '1', amountCSPR = '5' }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const orderId = makeOrderId('BANDWIDTH', [`${durationHours}h`, `${dataAllowanceGb}GB`]);
    const tx = await client.writeContract({
      address: ESCROW_VAULT,
      abi: ESCROW_VAULT_ABI,
      functionName: 'createJob',
      args: ['0x0000000000000000000000000000000000000000', toWei(amountCSPR), orderId],
      value: toWei(amountCSPR),
    });
    return { txHash: tx, order_id: orderId, resource_type: 'bandwidth', duration_hours: durationHours, data_allowance_gb: dataAllowanceGb, amount: amountCSPR };
  },

  async getJobStatus(jobId) {
    const publicClient = getPublicClient();
    const jobIdHash = keccak256Id(jobId);
    const state = await publicClient.readContract({
      address: ESCROW_VAULT,
      abi: ESCROW_VAULT_ABI,
      functionName: 'getJobState',
      args: [jobIdHash],
    });
    const amount = await publicClient.readContract({
      address: ESCROW_VAULT,
      abi: ESCROW_VAULT_ABI,
      functionName: 'getJobAmount',
      args: [jobIdHash],
    });
    return {
      job_id: jobId,
      state: state !== null ? STATES[state] || `unknown(${state})` : 'not_found',
      state_code: state,
      amount: amount?.toString() || '0',
    };
  },

  async getJobResult(jobId) {
    const status = await this.getJobStatus(jobId);
    if (status.state_code === null || status.state_code < 3) {
      return { ...status, result: null, message: 'Job not yet completed' };
    }
    return { ...status, result: 'completed' };
  },

  // ───────────────────────── v2 Tokenomics Methods ─────────────────────────

  /**
   * Get CHIMERA token balance for an address.
   */
  async getChimeraBalance(address) {
    const publicClient = getPublicClient();
    const balance = await publicClient.readContract({
      address: CHIMERA_TOKEN,
      abi: CHIMERA_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [address],
    });
    return balance?.toString() || '0';
  },

  /**
   * Approve CHIMERA spending by a spender contract.
   */
  async approveChimera({ privateKeyPem, spender, amount }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const tx = await client.writeContract({
      address: CHIMERA_TOKEN,
      abi: CHIMERA_TOKEN_ABI,
      functionName: 'approve',
      args: [spender, toWei(amount)],
    });
    return { txHash: tx, spender, amount };
  },

  /**
   * Stake CHIMERA as a Tier 1 provider.
   * @param {string} privateKeyPem - Provider's private key PEM
   * @param {string} amount - CHIMERA amount to stake
   * @param {number} lockPeriodDays - 0, 30, 90, or 365
   */
  async stakeChimera({ privateKeyPem, amount, lockPeriodDays = 0 }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    // Approve staking to pull CHIMERA
    await client.writeContract({
      address: CHIMERA_TOKEN,
      abi: CHIMERA_TOKEN_ABI,
      functionName: 'approve',
      args: [CHIMERA_STAKING, toWei(amount)],
    });
    const tx = await client.writeContract({
      address: CHIMERA_STAKING,
      abi: CHIMERA_STAKING_ABI,
      functionName: 'stake',
      args: [toWei(amount), BigInt(lockPeriodDays)],
    });
    return { txHash: tx, action: 'stake', amount, lockPeriodDays };
  },

  /**
   * Unstake CHIMERA (initiates 7-day delay; 10% penalty if lock not mature).
   */
  async unstakeChimera({ privateKeyPem, amount }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const tx = await client.writeContract({
      address: CHIMERA_STAKING,
      abi: CHIMERA_STAKING_ABI,
      functionName: 'unstake',
      args: [toWei(amount)],
    });
    return { txHash: tx, action: 'unstake', amount };
  },

  /**
   * Claim unstaked CHIMERA after the 7-day delay.
   */
  async claimUnstake({ privateKeyPem }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const tx = await client.writeContract({
      address: CHIMERA_STAKING,
      abi: CHIMERA_STAKING_ABI,
      functionName: 'claimUnstake',
    });
    return { txHash: tx, action: 'claimUnstake' };
  },

  /**
   * Claim vested staking rewards.
   */
  async claimVestedRewards({ privateKeyPem }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const tx = await client.writeContract({
      address: CHIMERA_STAKING,
      abi: CHIMERA_STAKING_ABI,
      functionName: 'claimVestedRewards',
    });
    return { txHash: tx, action: 'claimVestedRewards' };
  },

  /**
   * Get staking info for a provider.
   */
  async getStakeInfo(providerAddress) {
    const publicClient = getPublicClient();
    const result = await publicClient.readContract({
      address: CHIMERA_STAKING,
      abi: CHIMERA_STAKING_ABI,
      functionName: 'getStake',
      args: [providerAddress],
    });
    return {
      staked: result?.[0]?.toString() || '0',
      weight: result?.[1]?.toString() || '0',
      lockMultiplier: result?.[2]?.toString() || '0',
      unlockAt: result?.[3]?.toString() || '0',
      unstakeAvailableAt: result?.[4]?.toString() || '0',
    };
  },

  /**
   * Get vesting info for a staker.
   */
  async getVestingInfo(stakerAddress) {
    const publicClient = getPublicClient();
    const result = await publicClient.readContract({
      address: CHIMERA_STAKING,
      abi: CHIMERA_STAKING_ABI,
      functionName: 'getVestingInfo',
      args: [stakerAddress],
    });
    return {
      totalVested: result?.[0]?.toString() || '0',
      claimed: result?.[1]?.toString() || '0',
      available: result?.[2]?.toString() || '0',
      vestStart: result?.[3]?.toString() || '0',
      vestEnd: result?.[4]?.toString() || '0',
    };
  },

  /**
   * Get premium status for a provider.
   */
  async getPremiumStatus(providerAddress) {
    const publicClient = getPublicClient();
    const result = await publicClient.readContract({
      address: CHIMERA_STAKING,
      abi: CHIMERA_STAKING_ABI,
      functionName: 'getPremiumStatus',
      args: [providerAddress],
    });
    return {
      priorityRouting: result?.[0] || false,
      higherThroughput: result?.[1] || false,
      customPricing: result?.[2] || false,
    };
  },

  /**
   * Burn CHIMERA to unlock a premium feature.
   * @param {number} featureId - 0=priority routing, 1=higher throughput, 2=custom pricing
   */
  async burnForPremium({ privateKeyPem, provider, featureId }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    // Approve staking to pull CHIMERA for burn
    await client.writeContract({
      address: CHIMERA_TOKEN,
      abi: CHIMERA_TOKEN_ABI,
      functionName: 'approve',
      args: [CHIMERA_STAKING, toWei('100000')], // approve enough for any premium
    });
    const tx = await client.writeContract({
      address: CHIMERA_STAKING,
      abi: CHIMERA_STAKING_ABI,
      functionName: 'burnForPremium',
      args: [provider, BigInt(featureId)],
    });
    return { txHash: tx, action: 'burnForPremium', provider, featureId };
  },

  /**
   * Stake CHIMERA as a consumer for job priority boost.
   */
  async consumerBoostStake({ privateKeyPem, amount }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    await client.writeContract({
      address: CHIMERA_TOKEN,
      abi: CHIMERA_TOKEN_ABI,
      functionName: 'approve',
      args: [CHIMERA_STAKING, toWei(amount)],
    });
    const tx = await client.writeContract({
      address: CHIMERA_STAKING,
      abi: CHIMERA_STAKING_ABI,
      functionName: 'consumerBoostStake',
      args: [toWei(amount)],
    });
    return { txHash: tx, action: 'consumerBoostStake', amount };
  },

  /**
   * Withdraw consumer boost stake after job completion.
   */
  async consumerBoostUnstake({ privateKeyPem, amount }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const tx = await client.writeContract({
      address: CHIMERA_STAKING,
      abi: CHIMERA_STAKING_ABI,
      functionName: 'consumerBoostUnstake',
      args: [toWei(amount)],
    });
    return { txHash: tx, action: 'consumerBoostUnstake', amount };
  },

  /**
   * Set a referrer for referral bonus eligibility.
   */
  async setReferrer({ privateKeyPem, referrer }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const tx = await client.writeContract({
      address: CHIMERA_STAKING,
      abi: CHIMERA_STAKING_ABI,
      functionName: 'setReferrer',
      args: [referrer],
    });
    return { txHash: tx, action: 'setReferrer', referrer };
  },

  /**
   * Create a job using the v2 CHIMERA coordinator.
   * @param {string} privateKeyPem - Consumer's private key PEM
   * @param {string} requestHash - Hash of the request payload
   * @param {number} taskType - 1=compute, 2=storage, 4=inference, 8=bandwidth
   * @param {string} amount - CHIMERA amount to pay
   * @param {number} policy - 0=hybrid, 1=first-party-only, 2=second-party-only
   */
  async createChimeraJob({ privateKeyPem, requestHash, taskType, amount, policy = 0 }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    // Approve coordinator to pull CHIMERA
    await client.writeContract({
      address: CHIMERA_TOKEN,
      abi: CHIMERA_TOKEN_ABI,
      functionName: 'approve',
      args: [CHIMERA_COORDINATOR, toWei(amount)],
    });
    const nonce = Math.floor(Date.now() / 1000);
    const tx = await client.writeContract({
      address: CHIMERA_COORDINATOR,
      abi: CHIMERA_COORDINATOR_V2_ABI,
      functionName: 'createJob',
      args: [`0x${createHash('sha256').update(requestHash).digest('hex')}`, BigInt(nonce), BigInt(taskType), toWei(amount), BigInt(policy)],
    });
    return { txHash: tx, action: 'createChimeraJob', requestHash, taskType, amount, policy };
  },

  /**
   * Provider claims payment after completing a job (v2 coordinator).
   */
  async payProvider({ privateKeyPem, jobAddress, responseHash }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const tx = await client.writeContract({
      address: CHIMERA_COORDINATOR,
      abi: CHIMERA_COORDINATOR_V2_ABI,
      functionName: 'payProvider',
      args: [jobAddress, `0x${createHash('sha256').update(responseHash).digest('hex')}`],
    });
    return { txHash: tx, action: 'payProvider', jobAddress };
  },

  /**
   * Trigger fallback for an expired job (v2 coordinator).
   */
  async triggerFallback({ privateKeyPem, jobAddress }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const tx = await client.writeContract({
      address: CHIMERA_COORDINATOR,
      abi: CHIMERA_COORDINATOR_V2_ABI,
      functionName: 'triggerFallback',
      args: [jobAddress],
    });
    return { txHash: tx, action: 'triggerFallback', jobAddress };
  },

  /**
   * Get the platform fee in bps for a user (sliding scale by stake).
   */
  async getPlatformFeeBps(userAddress) {
    const publicClient = getPublicClient();
    const result = await publicClient.readContract({
      address: CHIMERA_COORDINATOR,
      abi: CHIMERA_COORDINATOR_V2_ABI,
      functionName: 'getPlatformFeeBps',
      args: [userAddress],
    });
    return Number(result?.toString() || '0');
  },

  /**
   * Get circuit breaker status.
   */
  async getCircuitBreakerStatus() {
    const publicClient = getPublicClient();
    const result = await publicClient.readContract({
      address: CHIMERA_STAKING,
      abi: CHIMERA_STAKING_ABI,
      functionName: 'getCircuitBreakerStatus',
    });
    return {
      slashVolume24h: result?.[0]?.toString() || '0',
      totalStaked: result?.[1]?.toString() || '0',
      triggered: result?.[2] || false,
    };
  },

  /**
   * Create a governance proposal.
   */
  async createProposal({ privateKeyPem, targets, values, calldatas, description }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const tx = await client.writeContract({
      address: CHIMERA_GOVERNANCE,
      abi: CHIMERA_GOVERNANCE_ABI,
      functionName: 'propose',
      args: [targets, values.map(v => BigInt(v)), calldatas, description],
    });
    return { txHash: tx, action: 'createProposal', description };
  },

  /**
   * Vote on a governance proposal.
   */
  async castVote({ privateKeyPem, proposalId, support }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const tx = await client.writeContract({
      address: CHIMERA_GOVERNANCE,
      abi: CHIMERA_GOVERNANCE_ABI,
      functionName: 'castVote',
      args: [BigInt(proposalId), support],
    });
    return { txHash: tx, action: 'castVote', proposalId, support };
  },

  /**
   * Execute a passed governance proposal.
   */
  async executeProposal({ privateKeyPem, proposalId }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const tx = await client.writeContract({
      address: CHIMERA_GOVERNANCE,
      abi: CHIMERA_GOVERNANCE_ABI,
      functionName: 'executeProposal',
      args: [BigInt(proposalId)],
    });
    return { txHash: tx, action: 'executeProposal', proposalId };
  },

  /**
   * Get governance proposal state.
   */
  async getProposalState(proposalId) {
    const publicClient = getPublicClient();
    const result = await publicClient.readContract({
      address: CHIMERA_GOVERNANCE,
      abi: CHIMERA_GOVERNANCE_ABI,
      functionName: 'getProposalState',
      args: [BigInt(proposalId)],
    });
    return result;
  },

  /**
   * Lock CHIMERA to become an eligible dispute juror.
   */
  async lockForDisputes({ privateKeyPem, amount }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    await client.writeContract({
      address: CHIMERA_TOKEN,
      abi: CHIMERA_TOKEN_ABI,
      functionName: 'approve',
      args: [CHIMERA_GOVERNANCE, toWei(amount)],
    });
    const tx = await client.writeContract({
      address: CHIMERA_GOVERNANCE,
      abi: CHIMERA_GOVERNANCE_ABI,
      functionName: 'lockForDisputes',
      args: [toWei(amount)],
    });
    return { txHash: tx, action: 'lockForDisputes', amount };
  },

  /**
   * Create a slash appeal (dispute resolution).
   */
  async createSlashAppeal({ privateKeyPem, slashId, slashAmount }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    await client.writeContract({
      address: CHIMERA_TOKEN,
      abi: CHIMERA_TOKEN_ABI,
      functionName: 'approve',
      args: [CHIMERA_GOVERNANCE, toWei(slashAmount)],
    });
    const tx = await client.writeContract({
      address: CHIMERA_GOVERNANCE,
      abi: CHIMERA_GOVERNANCE_ABI,
      functionName: 'createSlashAppeal',
      args: [BigInt(slashId), toWei(slashAmount)],
    });
    return { txHash: tx, action: 'createSlashAppeal', slashId, slashAmount };
  },

  /**
   * Vote on a slash appeal as a juror.
   */
  async voteOnAppeal({ privateKeyPem, appealId, guilty }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const tx = await client.writeContract({
      address: CHIMERA_GOVERNANCE,
      abi: CHIMERA_GOVERNANCE_ABI,
      functionName: 'voteOnAppeal',
      args: [BigInt(appealId), guilty],
    });
    return { txHash: tx, action: 'voteOnAppeal', appealId, guilty };
  },

  /**
   * Resolve a slash appeal after sufficient jurors have voted.
   */
  async resolveAppeal({ privateKeyPem, appealId }) {
    const pkHex = loadPrivateKey(privateKeyPem);
    const client = getWalletClient(pkHex);
    const tx = await client.writeContract({
      address: CHIMERA_GOVERNANCE,
      abi: CHIMERA_GOVERNANCE_ABI,
      functionName: 'resolveAppeal',
      args: [BigInt(appealId)],
    });
    return { txHash: tx, action: 'resolveAppeal', appealId };
  },
};

export { marketApi };
