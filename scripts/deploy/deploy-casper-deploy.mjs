import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sdk from 'casper-js-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CHAIN_NAME = 'casper-test';
const RPC_URL = 'http://65.109.89.88:7777/rpc';
const PAYMENT = '10000000000'; // 10 CSPR
const WASM_DIR = join(__dirname, '../contracts-casper/target/wasm32-unknown-unknown/release');

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
  console.log(`${name} putDeploy result:`, result.deployHash.toHex());
  return deploy.hash.toHex();
}

async function waitForDeploy(client, deployHash, timeoutMinutes = 30) {
  console.log(`Waiting for deploy ${deployHash}...`);
  const iterations = timeoutMinutes * 60 / 5;
  for (let i = 0; i < iterations; i++) {
    try {
      const info = await client.getDeploy(deployHash);
      if (info.deploy?.executionInfo) {
        const exec = info.deploy.executionInfo;
        console.log(`Deploy ${deployHash} executed at block ${exec.blockHeight}`);
        if (exec.executionResult?.Version2?.errorMessage) {
          throw new Error(`Deploy failed: ${exec.executionResult.Version2.errorMessage}`);
        }
        return info;
      }
    } catch (e) {
      if (e.message?.includes('failed')) throw e;
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error(`Deploy ${deployHash} did not finalize in time`);
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
  const computeRegistryContract = await getContractHash(client, accountHash, 'compute_registry_hash');
  console.log('ComputeRegistry contract hash:', computeRegistryContract);
  config.contracts.computeRegistry = computeRegistryContract;

  // 2. Deploy Reputation
  const reputationHash = await deployContract('reputation', key, sdk.Args.fromMap({
    owner,
  }));
  await waitForDeploy(client, reputationHash);
  const reputationContract = await getContractHash(client, accountHash, 'reputation_hash');
  console.log('Reputation contract hash:', reputationContract);
  config.contracts.reputation = reputationContract;

  // 3. Deploy EscrowVault
  const escrowHash = await deployContract('escrow_vault', key, sdk.Args.fromMap({
    owner,
  }));
  await waitForDeploy(client, escrowHash);
  const escrowContract = await getContractHash(client, accountHash, 'escrow_vault_hash');
  console.log('EscrowVault contract hash:', escrowContract);
  config.contracts.escrowVault = escrowContract;

  // 4. Deploy OrderBook
  const orderBookHash = await deployContract('order_book', key, sdk.Args.fromMap({
    owner,
  }));
  await waitForDeploy(client, orderBookHash);
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
