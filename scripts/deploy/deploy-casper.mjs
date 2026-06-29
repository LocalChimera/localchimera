import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sdk from 'casper-js-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CHAIN_NAME = 'casper-test';
const RPC_URL = 'https://node.testnet.casper.network/rpc';
const PAYMENT = '500000000000'; // 500 CSPR in motes
const WASM_DIR = join(__dirname, '../contracts-casper/target/wasm32-unknown-unknown/release');

function loadKey() {
  const pemPath = process.env.CSPR_PEM_PATH || '/tmp/casper-keys/Account 1_secret_key.pem';
  const pem = readFileSync(pemPath, 'utf-8');
  return sdk.PrivateKey.fromPem(pem, sdk.KeyAlgorithm.SECP256K1);
}

function createClient() {
  return new sdk.RpcClient(new sdk.HttpHandler(RPC_URL));
}

function accountHashBytes(key) {
  return key.publicKey.accountHash().hashBytes;
}

function clAccount(key) {
  return sdk.CLValue.newCLByteArray(accountHashBytes(key));
}

async function sendDeploy(client, key, session) {
  const payment = sdk.ExecutableDeployItem.standardPayment(PAYMENT);
  const header = sdk.DeployHeader.default();
  header.account = key.publicKey;
  header.chainName = CHAIN_NAME;
  header.timestamp = new Date();

  const deploy = sdk.Deploy.makeDeploy(header, payment, session);
  deploy.sign(key);

  const result = await client.putDeploy(deploy);
  return result.deployHash.toHex();
}

async function waitForDeploy(client, deployHash) {
  console.log(`Waiting for deploy ${deployHash}...`);
  for (let i = 0; i < 60; i++) {
    try {
      const info = await client.getDeploy(deployHash);
      if (info.deploy?.executionResults && info.deploy.executionResults.length > 0) {
        console.log(`Deploy ${deployHash} executed`);
        return info;
      }
    } catch {
      // not yet available
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

async function deployContract(name, client, key, args) {
  const wasmPath = join(WASM_DIR, `${name}.wasm`);
  const wasmBytes = readFileSync(wasmPath);
  const session = sdk.ExecutableDeployItem.newModuleBytes(wasmBytes, args);

  const hash = await sendDeploy(client, key, session);
  console.log(`${name} deploy hash: ${hash}`);
  const info = await waitForDeploy(client, hash);
  
  // Check execution result
  const er = info.deploy.executionResults[0];
  const result = er.result?.ExecutionResult;
  if (result?.Failure) {
    throw new Error(`Deploy failed: ${result.Failure.error_message}`);
  }
  console.log(`Deploy succeeded, cost: ${result?.Success?.cost || 'unknown'}`);

  const accountHash = key.publicKey.accountHash().toPrefixedString();
  const contractHash = await getContractHash(client, accountHash, `${name}_hash`);
  console.log(`${name} contract hash: ${contractHash}`);
  return contractHash;
}

async function main() {
  console.log('Loading key...');
  const key = loadKey();
  console.log('Creating RPC client...');
  const client = createClient();
  const accountHash = key.publicKey.accountHash().toPrefixedString();
  console.log('Deploying from account:', accountHash);

  const owner = clAccount(key);

  console.log('Deploying ComputeRegistry...');
  const computeRegistryHash = await deployContract('compute_registry', client, key, sdk.Args.fromMap({
    owner,
    fee_recipient: owner,
    minimum_stake: sdk.CLValue.newCLUInt512('1000000000000000000'),
  }));

  console.log('Deploying Reputation...');
  const reputationHash = await deployContract('reputation', client, key, sdk.Args.fromMap({
    owner,
    compute_registry: owner,
    escrow_vault: owner,
  }));

  console.log('Deploying EscrowVault...');
  const escrowVaultHash = await deployContract('escrow_vault', client, key, sdk.Args.fromMap({
    compute_registry: owner,
    reputation: owner,
    owner,
    protocol_fee_recipient: owner,
  }));

  console.log('Deploying OrderBook...');
  const orderBookHash = await deployContract('order_book', client, key, sdk.Args.fromMap({
    owner,
    compute_registry: owner,
  }));

  const configPath = join(__dirname, '../config/chimera-testnet.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  config.contracts = {
    computeRegistry: computeRegistryHash,
    orderBook: orderBookHash,
    escrowVault: escrowVaultHash,
    reputation: reputationHash,
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('Config updated with deployed contract hashes');
  console.log('');
  console.log('Deployed contracts:');
  console.log('  ComputeRegistry:', computeRegistryHash);
  console.log('  OrderBook:      ', orderBookHash);
  console.log('  EscrowVault:    ', escrowVaultHash);
  console.log('  Reputation:     ', reputationHash);
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
