import { createHash } from 'crypto';
import { promises as fs, readFileSync } from 'fs';
import { Logger } from '../core/Logger.js';
import pkg from 'casper-js-sdk';

const sdk = pkg;
const { PrivateKey, PublicKey, KeyAlgorithm, CLValue, Args, ContractHash, StoredContractByHash, ExecutableDeployItem, DeployHeader, Deploy, Transaction, TransactionWrapper } = sdk;

const RPC_URL = process.env.CASPER_RPC_URL || 'https://node.testnet.casper.network/rpc';
const CHAIN_NAME = process.env.CASPER_CHAIN_NAME || 'casper-test';
const ESCROW_VAULT = process.env.ESCROW_VAULT_HASH || 'b8e8b7e087ec4ad7afcdc30460d39d5b6a8249875cd1e2da0716b89d710fda40';
const COMPUTE_REGISTRY = process.env.COMPUTE_REGISTRY_HASH || 'bb3044c3bbefc669c4c7c41a10cb645f5e160bfab62883b34e08d0a99b981d07';

const logger = new Logger('MarketAPI');

async function rpcCall(method, params) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  return res.json();
}

async function getDictionaryItem(contractHash, dictName, dictKey) {
  const entityRes = await rpcCall('state_get_entity', {
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

  const stateRoot = await rpcCall('chain_get_state_root_hash', {});
  const stateRootHash = stateRoot.result?.state_root_hash;
  if (!stateRootHash) return null;

  const dictRes = await rpcCall('state_get_dictionary_item', {
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

function buildDeploy(publicKey, contractHash, entryPoint, argsMap, payment = '10000000000') {
  const args = Args.fromMap(argsMap);
  const contractHashObj = ContractHash.newContract(contractHash);
  const storedContract = new StoredContractByHash(contractHashObj, entryPoint, args);
  const session = new ExecutableDeployItem();
  session.storedContractByHash = storedContract;
  const paymentItem = ExecutableDeployItem.standardPayment(payment);
  const header = DeployHeader.default();
  header.account = publicKey;
  header.chainName = CHAIN_NAME;
  return Deploy.makeDeploy(header, paymentItem, session);
}

function loadPrivateKey(pemOrPath) {
  if (pemOrPath.includes('BEGIN PRIVATE KEY') || pemOrPath.includes('BEGIN EC PRIVATE KEY')) {
    return PrivateKey.fromPem(pemOrPath, KeyAlgorithm.SECP256K1);
  }
  const pem = readFileSync(pemOrPath, 'utf8');
  return PrivateKey.fromPem(pem, KeyAlgorithm.SECP256K1);
}

async function submitDeploy(privateKey, contractHash, entryPoint, argsMap, payment) {
  const publicKey = privateKey.publicKey;
  const deploy = buildDeploy(publicKey, contractHash, entryPoint, argsMap, payment);
  // Casper 2.0 uses transactions instead of deploys
  const transaction = Transaction.fromDeploy(deploy);
  transaction.sign(privateKey);
  const txJSON = transaction.toJSON();
  const wrapper = transaction.getTransactionWrapper();
  const wrapperJSON = TransactionWrapper.toJSON(wrapper);
  const res = await rpcCall('account_put_transaction', { transaction: wrapperJSON });
  if (res.error) throw new Error(`Transaction failed: ${res.error.message}`);
  return res.result?.transaction_hash || res.result?.deploy_hash;
}

function csprToMotes(cspr) {
  return Math.floor(parseFloat(cspr) * 1e9).toString();
}

function makeZeroHash() {
  return new Uint8Array(32);
}

function makeConsumerHash(publicKeyHex) {
  const pk = PublicKey.fromHex(publicKeyHex);
  return pk.accountHash().toBytes();
}

const marketApi = {
  async createInferenceJob({ privateKeyPem, prompt, amountCSPR = '10' }) {
    const privateKey = loadPrivateKey(privateKeyPem);
    const consumerBytes = privateKey.publicKey.accountHash().toBytes();
    const args = {
      consumer: CLValue.newCLByteArray(consumerBytes),
      provider: CLValue.newCLByteArray(makeZeroHash()),
      amount: CLValue.newCLUInt512(csprToMotes(amountCSPR)),
      provider_fee_bps: CLValue.newCLUint64('0'),
      order_id: CLValue.newCLString(prompt),
    };
    const deployHash = await submitDeploy(privateKey, ESCROW_VAULT, 'create_job', args);
    return { deployHash, order_id: prompt, resource_type: 'inference', amount: amountCSPR };
  },

  async createStorageAllocation({ privateKeyPem, spaceName, sizeMb, amountCSPR = '10' }) {
    const privateKey = loadPrivateKey(privateKeyPem);
    const consumerBytes = privateKey.publicKey.accountHash().toBytes();
    const orderId = `STORAGE:ALLOC:${spaceName}:${sizeMb}MB`;
    const args = {
      consumer: CLValue.newCLByteArray(consumerBytes),
      provider: CLValue.newCLByteArray(makeZeroHash()),
      amount: CLValue.newCLUInt512(csprToMotes(amountCSPR)),
      provider_fee_bps: CLValue.newCLUint64('0'),
      order_id: CLValue.newCLString(orderId),
    };
    const deployHash = await submitDeploy(privateKey, ESCROW_VAULT, 'create_job', args);
    return { deployHash, order_id: orderId, resource_type: 'storage', sub_type: 'allocation', space_name: spaceName, size_mb: sizeMb, amount: amountCSPR };
  },

  async createStorageFile({ privateKeyPem, spaceName, fileHash, fileSizeMb, amountCSPR = '5' }) {
    const privateKey = loadPrivateKey(privateKeyPem);
    const consumerBytes = privateKey.publicKey.accountHash().toBytes();
    const orderId = `STORAGE:FILE:${spaceName}:${fileHash}:${fileSizeMb}MB`;
    const args = {
      consumer: CLValue.newCLByteArray(consumerBytes),
      provider: CLValue.newCLByteArray(makeZeroHash()),
      amount: CLValue.newCLUInt512(csprToMotes(amountCSPR)),
      provider_fee_bps: CLValue.newCLUint64('0'),
      order_id: CLValue.newCLString(orderId),
    };
    const deployHash = await submitDeploy(privateKey, ESCROW_VAULT, 'create_job', args);
    return { deployHash, order_id: orderId, resource_type: 'storage', sub_type: 'file', space_name: spaceName, file_hash: fileHash, file_size_mb: fileSizeMb, amount: amountCSPR };
  },

  async retrieveFile({ privateKeyPem, spaceName, fileHash, amountCSPR = '1' }) {
    const privateKey = loadPrivateKey(privateKeyPem);
    const consumerBytes = privateKey.publicKey.accountHash().toBytes();
    const orderId = `STORAGE:RETRIEVE:${spaceName}:${fileHash}`;
    const args = {
      consumer: CLValue.newCLByteArray(consumerBytes),
      provider: CLValue.newCLByteArray(makeZeroHash()),
      amount: CLValue.newCLUInt512(csprToMotes(amountCSPR)),
      provider_fee_bps: CLValue.newCLUint64('0'),
      order_id: CLValue.newCLString(orderId),
    };
    const deployHash = await submitDeploy(privateKey, ESCROW_VAULT, 'create_job', args);
    return { deployHash, order_id: orderId, resource_type: 'storage', sub_type: 'retrieve', space_name: spaceName, file_hash: fileHash, amount: amountCSPR };
  },

  async createComputeJob({ privateKeyPem, runtime = 'shell', code, cpuCores = '2', ramMb = '512', gpu = false, timeoutSec = '30', amountCSPR = '10' }) {
    const privateKey = loadPrivateKey(privateKeyPem);
    const consumerBytes = privateKey.publicKey.accountHash().toBytes();
    const orderId = `COMPUTE:${runtime}:${cpuCores}:${ramMb}:${gpu ? '1' : '0'}:${timeoutSec}:${code}`;
    const args = {
      consumer: CLValue.newCLByteArray(consumerBytes),
      provider: CLValue.newCLByteArray(makeZeroHash()),
      amount: CLValue.newCLUInt512(csprToMotes(amountCSPR)),
      provider_fee_bps: CLValue.newCLUint64('0'),
      order_id: CLValue.newCLString(orderId),
    };
    const deployHash = await submitDeploy(privateKey, ESCROW_VAULT, 'create_job', args);
    return { deployHash, order_id: orderId, resource_type: 'compute', runtime, cpu_cores: cpuCores, ram_mb: ramMb, gpu, timeout_sec: timeoutSec, amount: amountCSPR };
  },

  async createBandwidthJob({ privateKeyPem, durationHours = '1', dataAllowanceGb = '1', amountCSPR = '5' }) {
    const privateKey = loadPrivateKey(privateKeyPem);
    const consumerBytes = privateKey.publicKey.accountHash().toBytes();
    const orderId = `BANDWIDTH:${durationHours}h:${dataAllowanceGb}GB`;
    const args = {
      consumer: CLValue.newCLByteArray(consumerBytes),
      provider: CLValue.newCLByteArray(makeZeroHash()),
      amount: CLValue.newCLUInt512(csprToMotes(amountCSPR)),
      provider_fee_bps: CLValue.newCLUint64('0'),
      order_id: CLValue.newCLString(orderId),
    };
    const deployHash = await submitDeploy(privateKey, ESCROW_VAULT, 'create_job', args);
    return { deployHash, order_id: orderId, resource_type: 'bandwidth', duration_hours: durationHours, data_allowance_gb: dataAllowanceGb, amount: amountCSPR };
  },

  async getJobStatus(jobId) {
    const state = await getDictionaryItem(ESCROW_VAULT, 'jobs_dict', `${jobId}:state`);
    const requestHash = await getDictionaryItem(ESCROW_VAULT, 'jobs_dict', `${jobId}:request_hash`);
    const responseHash = await getDictionaryItem(ESCROW_VAULT, 'jobs_dict', `${jobId}:response_hash`);
    const amount = await getDictionaryItem(ESCROW_VAULT, 'jobs_dict', `${jobId}:amount`);
    const taskType = await getDictionaryItem(ESCROW_VAULT, 'jobs_dict', `${jobId}:task_type`);
    const STATES = ['pending', 'assigned', 'in_progress', 'provider_done', 'consumer_confirmed', 'settled', 'refunded', 'disputed', 'dispute_consumer_won', 'dispute_provider_won'];
    return {
      job_id: jobId,
      state: state !== null ? STATES[state] || `unknown(${state})` : 'not_found',
      state_code: state,
      request_hash: requestHash || '',
      response_hash: responseHash || '',
      amount: amount || '0',
      task_type: taskType !== null ? taskType : null,
    };
  },

  async getJobResult(jobId) {
    const status = await this.getJobStatus(jobId);
    if (status.state_code === null || status.state_code < 3) {
      return { ...status, result: null, message: 'Job not yet completed' };
    }
    return { ...status, result: status.response_hash };
  },
};

export { marketApi };
