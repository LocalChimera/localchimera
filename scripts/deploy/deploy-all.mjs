import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sdk from 'casper-js-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CHAIN_NAME = 'casper-test';
const RPC_URL = 'https://node.testnet.casper.network/rpc';
const PAYMENT = '10000000000'; // 10 CSPR
const WASM_DIR = join(__dirname, '../contracts-casper/target/wasm32-unknown-unknown/release');

function loadKey() {
  const pem = readFileSync('/tmp/casper-wallet/Account 7_secret_key.pem', 'utf-8');
  return sdk.PrivateKey.fromPem(pem, sdk.KeyAlgorithm.SECP256K1);
}

function clAccount(key) {
  return sdk.CLValue.newCLByteArray(key.publicKey.accountHash().hashBytes);
}

async function deployContract(name, key, args) {
  const wasmPath = join(WASM_DIR, `${name}.wasm`);
  const wasmBytes = new Uint8Array(readFileSync(wasmPath));

  const session = sdk.ExecutableDeployItem.newModuleBytes(wasmBytes, args);
  const payment = sdk.ExecutableDeployItem.standardPayment(PAYMENT);

  const header = sdk.DeployHeader.default();
  header.account = key.publicKey;
  header.chainName = CHAIN_NAME;

  const deploy = sdk.Deploy.makeDeploy(header, payment, session);
  deploy.sign(key);

  console.log(`Sending ${name} deploy, hash:`, deploy.hash.toHex());

  const client = new sdk.RpcClient(new sdk.HttpHandler(RPC_URL));
  const result = await client.putDeploy(deploy);
  console.log(`${name} accepted:`, result.deployHash.toHex());
  return deploy.hash.toHex();
}

async function waitForDeploy(client, deployHash, timeoutMinutes = 10) {
  console.log(`Waiting for deploy ${deployHash}...`);
  const iterations = timeoutMinutes * 60 / 5;
  for (let i = 0; i < iterations; i++) {
    try {
      const info = await client.getDeploy(deployHash);
      if (info.deploy?.executionInfo) {
        const ei = info.deploy.executionInfo;
        console.log(`Deploy ${deployHash} has execution info`);
        return info;
      }
    } catch (e) {
      // Ignore errors
    }
    if (i % 12 === 0) {
      console.log(`  ... waited ${i * 5 / 60} minutes`);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  console.log(`Deploy ${deployHash} timed out waiting for execution`);
  return null;
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
  await waitForDeploy(client, computeRegistryHash);

  // 2. Deploy Reputation
  const reputationHash = await deployContract('reputation', key, sdk.Args.fromMap({ owner }));
  await waitForDeploy(client, reputationHash);

  // 3. Deploy EscrowVault
  const escrowHash = await deployContract('escrow_vault', key, sdk.Args.fromMap({ owner }));
  await waitForDeploy(client, escrowHash);

  // 4. Deploy OrderBook
  const orderBookHash = await deployContract('order_book', key, sdk.Args.fromMap({ owner }));
  await waitForDeploy(client, orderBookHash);

  // Try to get contract hashes from named keys
  try {
    const computeRegistryContract = await getContractHash(client, accountHash, 'compute_registry_hash');
    console.log('ComputeRegistry contract hash:', computeRegistryContract);
    config.contracts.computeRegistry = computeRegistryContract;
  } catch (e) {
    console.log('Could not get compute_registry_hash:', e.message);
  }

  try {
    const reputationContract = await getContractHash(client, accountHash, 'reputation_hash');
    console.log('Reputation contract hash:', reputationContract);
    config.contracts.reputation = reputationContract;
  } catch (e) {
    console.log('Could not get reputation_hash:', e.message);
  }

  try {
    const escrowContract = await getContractHash(client, accountHash, 'escrow_vault_hash');
    console.log('EscrowVault contract hash:', escrowContract);
    config.contracts.escrowVault = escrowContract;
  } catch (e) {
    console.log('Could not get escrow_vault_hash:', e.message);
  }

  try {
    const orderBookContract = await getContractHash(client, accountHash, 'order_book_hash');
    console.log('OrderBook contract hash:', orderBookContract);
    config.contracts.orderBook = orderBookContract;
  } catch (e) {
    console.log('Could not get order_book_hash:', e.message);
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log('Updated config:', configPath);
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
