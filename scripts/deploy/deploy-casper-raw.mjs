import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sdk from 'casper-js-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CHAIN_NAME = 'casper-test';
const RPC_URL = 'https://node.testnet.casper.network/rpc';
const PAYMENT = 10000000000; // 10 CSPR per deploy
const GAS_TOLERANCE = 1;
const WASM_DIR = join(__dirname, '../contracts-casper/target/wasm32-unknown-unknown/release');

function loadKey() {
  const pemPath = process.env.CSPR_PEM_PATH || '/tmp/casper-keys/Account 1_secret_key.pem';
  const pem = readFileSync(pemPath, 'utf-8');
  return sdk.PrivateKey.fromPem(pem, sdk.KeyAlgorithm.SECP256K1);
}

function clAccount(key) {
  return sdk.CLValue.newCLByteArray(key.publicKey.accountHash().hashBytes);
}

async function sendRawTransaction(json) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  });
  return res.json();
}

async function deployContract(name, key, args) {
  const wasmPath = join(WASM_DIR, `${name}.wasm`);
  const wasmBytes = new Uint8Array(readFileSync(wasmPath));

  const tx = new sdk.SessionBuilder()
    .wasm(wasmBytes)
    .installOrUpgrade()
    .runtimeArgs(args)
    .from(key.publicKey)
    .chainName(CHAIN_NAME)
    .payment(PAYMENT, GAS_TOLERANCE)
    .build();

  tx.sign(key);

  const wrapper = tx.getTransactionWrapper();
  const rawJson = JSON.parse(JSON.stringify(wrapper, (k, v) => {
    if (v instanceof Uint8Array) return Array.from(v);
    if (typeof v === 'bigint') return v.toString();
    return v;
  }));

  const payload = rawJson.transactionV1.payload;
  const fields = payload.fields;
  const serializedArgs = sdk.serializeArgs(args);

  const fixedPayload = {
    initiator_addr: payload.initiatorAddr.PublicKey
      ? { PublicKey: payload.initiatorAddr.PublicKey }
      : payload.initiatorAddr,
    timestamp: payload.timestamp,
    ttl: payload.ttl,
    chain_name: payload.chainName,
    pricing_mode: {
      PaymentLimited: {
        standard_payment: payload.pricingMode.paymentLimited.standardPayment,
        payment_amount: Number(payload.pricingMode.paymentLimited.paymentAmount),
        gas_price_tolerance: Number(payload.pricingMode.paymentLimited.gasPriceTolerance),
      }
    },
    fields: {
      args: { Named: serializedArgs },
      target: fields.target,
      entry_point: fields.entryPoint,
      scheduling: fields.scheduling,
    }
  };

  const fixedJson = {
    hash: rawJson.transactionV1.hash,
    payload: fixedPayload,
    approvals: rawJson.transactionV1.approvals,
  };

  const request = {
    jsonrpc: '2.0',
    method: 'account_put_transaction',
    params: {
      transaction: {
        Version1: fixedJson,
      },
    },
    id: 1,
  };

  console.log(`Sending ${name} deployment...`);
  const result = await sendRawTransaction(request);

  if (result.error) {
    throw new Error(`RPC Error ${result.error.code}: ${result.error.message} - ${result.error.data}`);
  }

  const txHash = result.result?.transaction_hash?.Version1 || result.result?.transaction_hash;
  console.log(`${name} transaction hash:`, txHash);
  return txHash;
}

async function waitForTransaction(client, txHash, timeoutMinutes = 30) {
  console.log(`Waiting for transaction ${txHash}...`);
  const iterations = timeoutMinutes * 60 / 5;
  for (let i = 0; i < iterations; i++) {
    try {
      const info = await client.getTransaction(txHash);
      if (info.transaction?.executionInfo) {
        console.log(`Transaction ${txHash} executed`);
        return info;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error(`Transaction ${txHash} did not finalize in time`);
}

async function getContractHash(client, accountHash, namedKey) {
  const entity = await client.getLatestEntity(accountHash);
  const nk = entity.entity.namedKeys.find((n) => n.name === namedKey);
  if (!nk) throw new Error(`Named key ${namedKey} not found`);
  return nk.key.toString();
}

async function main() {
  const key = loadKey();
  const client = new sdk.RpcClient(new sdk.HttpHandler(RPC_URL));
  const accountHash = key.publicKey.accountHash().toPrefixedString();
  console.log('Deploying from account:', accountHash);

  const owner = clAccount(key);
  const configPath = join(__dirname, '../config/chimera-testnet.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  // 1. Deploy ComputeRegistry
  const computeRegistryHash = await deployContract('compute_registry', key, sdk.Args.fromMap({
    owner,
    fee_recipient: owner,
    minimum_stake: sdk.CLValue.newCLUInt512('1000000000000000000'),
  }));
  await waitForTransaction(client, computeRegistryHash);
  const computeRegistryContract = await getContractHash(client, accountHash, 'compute_registry_hash');
  console.log('ComputeRegistry contract hash:', computeRegistryContract);
  config.contracts.computeRegistry = computeRegistryContract;

  // 2. Deploy Reputation
  const reputationHash = await deployContract('reputation', key, sdk.Args.fromMap({
    owner,
  }));
  await waitForTransaction(client, reputationHash);
  const reputationContract = await getContractHash(client, accountHash, 'reputation_hash');
  console.log('Reputation contract hash:', reputationContract);
  config.contracts.reputation = reputationContract;

  // 3. Deploy EscrowVault
  const escrowHash = await deployContract('escrow_vault', key, sdk.Args.fromMap({
    owner,
  }));
  await waitForTransaction(client, escrowHash);
  const escrowContract = await getContractHash(client, accountHash, 'escrow_vault_hash');
  console.log('EscrowVault contract hash:', escrowContract);
  config.contracts.escrowVault = escrowContract;

  // 4. Deploy OrderBook
  const orderBookHash = await deployContract('order_book', key, sdk.Args.fromMap({
    owner,
  }));
  await waitForTransaction(client, orderBookHash);
  const orderBookContract = await getContractHash(client, accountHash, 'order_book_hash');
  console.log('OrderBook contract hash:', orderBookContract);
  config.contracts.orderBook = orderBookContract;

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log('Updated config:', configPath);
  console.log('All contracts deployed successfully!');
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
