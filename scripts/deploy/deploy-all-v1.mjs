import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sdk from 'casper-js-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CHAIN_NAME = 'casper-test';
const RPC_URL = 'http://65.109.89.88:7777/rpc';
const PAYMENT = '500000000000'; // 500 CSPR per deploy
const WASM_DIR = join(__dirname, '../contracts-casper/target/wasm32v1-none/release');

function loadKey() {
  const pemPath = process.env.CSPR_PEM_PATH || '/tmp/casper-keys/Account 1_secret_key.pem';
  const pem = readFileSync(pemPath, 'utf-8');
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

async function waitForDeploy(client, deployHash, timeoutMinutes = 15) {
  console.log(`Waiting for deploy ${deployHash}...`);
  const iterations = timeoutMinutes * 60 / 5;
  for (let i = 0; i < iterations; i++) {
    try {
      const info = await client.getDeploy(deployHash);
      const ei = info.rawJSON?.result?.execution_info;
      if (ei) {
        console.log(`Deploy ${deployHash} executed at block ${ei.block_height}`);
        const er = ei.execution_result?.Version2;
        if (er) {
          if (er.error_message) {
            console.log(`  ERROR: ${er.error_message}`);
          } else {
            console.log(`  SUCCESS, consumed: ${er.consumed}`);
          }
        }
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
  const accountInfo = await client.getAccountInfo(accountHash);
  const namedKeys = accountInfo?.account?.namedKeys || [];
  const nk = namedKeys.find((n) => n.name === namedKey);
  if (!nk) throw new Error(`Named key ${namedKey} not found`);
  return nk.key;
}

async function main() {
  const key = loadKey();
  const client = new sdk.RpcClient(new sdk.HttpHandler(RPC_URL));
  const accountHash = key.publicKey.accountHash().toPrefixedString();
  console.log('Deploying from account:', accountHash);

  const configPath = join(__dirname, '../config/chimera-testnet.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  // 1. Deploy ComputeRegistry
  const computeRegistryArgs = sdk.Args.fromMap({
    owner: clAccount(key),
    fee_recipient: clAccount(key),
    minimum_stake: sdk.CLValue.newCLUInt512('1000000000000000000'),
  });
  const computeRegistryHash = await deployContract('compute_registry', key, computeRegistryArgs);
  const computeRegistryResult = await waitForDeploy(client, computeRegistryHash);

  // 2. Deploy Reputation (needs compute_registry)
  const reputationArgs = sdk.Args.fromMap({
    owner: clAccount(key),
    compute_registry: clAccount(key),
  });
  const reputationHash = await deployContract('reputation', key, reputationArgs);
  const reputationResult = await waitForDeploy(client, reputationHash);

  // 3. Deploy EscrowVault (needs compute_registry, reputation)
  const escrowArgs = sdk.Args.fromMap({
    compute_registry: clAccount(key),
    reputation: clAccount(key),
    owner: clAccount(key),
    protocol_fee_recipient: clAccount(key),
  });
  const escrowHash = await deployContract('escrow_vault', key, escrowArgs);
  const escrowResult = await waitForDeploy(client, escrowHash);

  // 4. Deploy OrderBook (needs compute_registry)
  const orderBookArgs = sdk.Args.fromMap({
    owner: clAccount(key),
    compute_registry: clAccount(key),
  });
  const orderBookHash = await deployContract('order_book', key, orderBookArgs);
  const orderBookResult = await waitForDeploy(client, orderBookHash);

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
