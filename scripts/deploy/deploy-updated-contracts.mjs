import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sdk from 'casper-js-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CHAIN_NAME = 'casper-test';
const RPC_URL = 'https://node.testnet.casper.network/rpc';
const PAYMENT = '50000000000'; // 50 CSPR for deploy
const WASM_DIR = join(__dirname, '../contracts-casper/target/wasm32-unknown-unknown/release');

function loadKey() {
  const pem = readFileSync('/tmp/casper-wallet/Account 7_secret_key.pem', 'utf-8');
  return sdk.PrivateKey.fromPem(pem, sdk.KeyAlgorithm.SECP256K1);
}

function clAccount(key) {
  return sdk.CLValue.newCLByteArray(key.publicKey.accountHash().hashBytes);
}

async function sendDeploy(client, key, wasmBytes, args) {
  const session = sdk.ExecutableDeployItem.newModuleBytes(wasmBytes, args);
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
      const res = await client.getDeploy(sdk.DeployHash.fromHex(deployHash));
      const info = res.executionInfo;
      if (info) {
        const v2 = info.executionResult?.Version2;
        if (v2) {
          if (v2.errorMessage) {
            throw new Error(`Deploy failed: ${v2.errorMessage}`);
          }
          console.log(`Deploy ${deployHash} executed successfully`);
          return true;
        }
      }
    } catch (e) {
      if (e.message?.includes('failed')) throw e;
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error(`Deploy ${deployHash} timed out`);
}

async function getNamedKeys(accountHash) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'state_get_account_info',
      params: { public_key: accountHash },
    }),
  }).then(r => r.json());
  return res.result?.account?.named_keys || [];
}

async function main() {
  const key = loadKey();
  const client = new sdk.RpcClient(new sdk.HttpHandler(RPC_URL));
  const accountHash = key.publicKey.toHex();
  const accountHashStr = key.publicKey.accountHash().toPrefixedString();
  console.log('Deploying from public key:', accountHash);
  console.log('Account hash:', accountHashStr);

  const owner = clAccount(key);
  const ownerAccountHash = key.publicKey.accountHash();

  // Get existing contract hashes for compute_registry and reputation
  const existingKeys = await getNamedKeys(accountHash);
  const computeRegistryKey = existingKeys.find(k => k.name === 'compute_registry_hash');
  const reputationKey = existingKeys.find(k => k.name === 'reputation_hash');

  // Use existing compute_registry and reputation hashes, or owner if not found
  const computeRegistryHash = computeRegistryKey
    ? Uint8Array.from(Buffer.from(computeRegistryKey.key.replace('hash-', ''), 'hex'))
    : ownerAccountHash.hashBytes;
  const reputationHash = reputationKey
    ? Uint8Array.from(Buffer.from(reputationKey.key.replace('hash-', ''), 'hex'))
    : ownerAccountHash.hashBytes;

  console.log('Using compute_registry:', Buffer.from(computeRegistryHash).toString('hex'));
  console.log('Using reputation:', Buffer.from(reputationHash).toString('hex'));

  const results = {};

  // 1. Deploy ComputeRegistry
  console.log('\n=== Deploying ComputeRegistry ===');
  const crWasm = new Uint8Array(readFileSync(join(WASM_DIR, 'compute_registry.wasm')));
  const crArgs = sdk.Args.fromMap({
    owner,
    fee_recipient: owner,
    minimum_stake: sdk.CLValue.newCLUInt512('1000000000'),
  });
  const crHash = await sendDeploy(client, key, crWasm, crArgs);
  console.log('ComputeRegistry deploy hash:', crHash);
  await waitForDeploy(client, crHash);
  const keysAfterCR = await getNamedKeys(accountHash);
  const crNamedKey = keysAfterCR.find(k => k.name === 'compute_registry_hash');
  if (crNamedKey) {
    results.computeRegistry = crNamedKey.key.replace('hash-', '');
    console.log('New ComputeRegistry hash:', results.computeRegistry);
  }

  // 2. Deploy EscrowVault 4 times for each market
  const evWasm = new Uint8Array(readFileSync(join(WASM_DIR, 'escrow_vault.wasm')));
  const evArgs = sdk.Args.fromMap({
    owner,
    compute_registry: sdk.CLValue.newCLByteArray(computeRegistryHash),
    reputation: sdk.CLValue.newCLByteArray(reputationHash),
    protocol_fee_recipient: owner,
  });

  const markets = [
    { name: 'inference_market', label: 'InferenceMarket' },
    { name: 'storage_market', label: 'StorageMarket' },
    { name: 'compute_market', label: 'ComputeMarket' },
    { name: 'bandwidth_market', label: 'BandwidthMarket' },
  ];

  for (const market of markets) {
    console.log(`\n=== Deploying ${market.label} (escrow-vault) ===`);
    const deployHash = await sendDeploy(client, key, evWasm, evArgs);
    console.log(`${market.label} deploy hash:`, deployHash);
    await waitForDeploy(client, deployHash);

    // The contract creates escrow_vault_hash named key, but we need to find it
    // Actually each deploy overwrites the same named key, so we need to query the contract directly
    // Let's get the deploy info to find the contract hash
    const deployInfo = await client.getDeploy(sdk.DeployHash.fromHex(deployHash));
    const transforms = deployInfo.executionInfo?.executionResult?.Version2?.effects?.transforms || [];
    let contractHash = null;
    for (const t of transforms) {
      if (t.transform === 'WriteContract' && t.key?.startsWith('hash-')) {
        contractHash = t.key.replace('hash-', '');
        break;
      }
    }
    if (contractHash) {
      results[market.name] = contractHash;
      console.log(`New ${market.label} hash:`, contractHash);
    } else {
      // Fallback: check named keys
      const keysAfter = await getNamedKeys(accountHash);
      const evKey = keysAfter.find(k => k.name === 'escrow_vault_hash');
      if (evKey) {
        results[market.name] = evKey.key.replace('hash-', '');
        console.log(`${market.label} hash (from named key):`, results[market.name]);
      }
    }
  }

  console.log('\n\n=== DEPLOYMENT RESULTS ===');
  console.log('Update casper-client.ts with:');
  console.log(`  inferenceMarket: '${results.inference_market || 'MISSING'}',`);
  console.log(`  storageMarket: '${results.storage_market || 'MISSING'}',`);
  console.log(`  computeMarket: '${results.compute_market || 'MISSING'}',`);
  console.log(`  bandwidthMarket: '${results.bandwidth_market || 'MISSING'}',`);
  console.log(`  computeRegistry: '${results.computeRegistry || 'MISSING'}',`);
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
