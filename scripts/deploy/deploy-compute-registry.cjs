/**
 * Deploy ComputeRegistry contract to Casper testnet with 1 CSPR minimum stake.
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const sdk = require('casper-js-sdk');

const CHAIN_NAME = 'casper-test';
const RPC_URL = 'http://localhost:7778/rpc';
const PAYMENT = '50000000000';
const WASM_DIR = join(__dirname, '../contracts-casper/target/wasm32v1-none/release');

function loadKey() {
  const pemPath = '/tmp/casper-wallet/Account 1_secret_key.pem';
  const pem = readFileSync(pemPath, 'utf-8');
  return sdk.PrivateKey.fromPem(pem, sdk.KeyAlgorithm.SECP256K1);
}

function createClient() {
  return new sdk.RpcClient(new sdk.HttpHandler(RPC_URL));
}

function clAccount(key) {
  return sdk.CLValue.newCLByteArray(key.publicKey.accountHash().toBytes());
}

async function sendDeploy(client, key, session) {
  const payment = sdk.ExecutableDeployItem.standardPayment(PAYMENT);
  const header = sdk.DeployHeader.default();
  header.account = key.publicKey;
  header.chainName = CHAIN_NAME;

  const deploy = sdk.Deploy.makeDeploy(header, payment, session);
  deploy.sign(key);

  const result = await client.putDeploy(deploy);
  return result.deployHash.toHex();
}

async function waitForDeploy(client, deployHash) {
  console.log(`Waiting for deploy ${deployHash}...`);
  for (let i = 0; i < 30; i++) {
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
          return;
        }
      }
    } catch (e) {
      if (e.message?.includes('failed')) throw e;
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error(`Deploy ${deployHash} did not finalize in time`);
}

async function getNamedKey(accountHash, namedKey) {
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'state_get_entity',
        params: { entity_identifier: { AccountHash: accountHash } },
      }),
    }).then(r => r.json());
    const keys = res.result?.addressable_entity?.Account?.named_keys || [];
    const nk = keys.find((k) => k.name === namedKey);
    return nk ? nk.key : null;
  } catch (e) {
    console.error('Error getting named key:', e.message);
    return null;
  }
}

async function main() {
  const key = loadKey();
  const client = createClient();
  const accountHash = key.publicKey.accountHash().toPrefixedString();
  console.log('Deploying from account:', accountHash);

  const owner = clAccount(key);

  const wasmPath = join(WASM_DIR, 'compute_registry.wasm');
  const wasmBytes = readFileSync(wasmPath);
  const args = new sdk.Args([
    ['owner', owner],
    ['fee_recipient', owner],
    ['minimum_stake', sdk.CLValue.newCLUInt512('1000000000')],
  ]);
  const session = sdk.ExecutableDeployItem.newModuleBytes(wasmBytes, args);

  const deployHash = await sendDeploy(client, key, session);
  console.log('Deploy hash:', deployHash);
  console.log('Explorer: https://testnet.cspr.live/deploy/' + deployHash);

  await waitForDeploy(client, deployHash);

  const contractKey = await getNamedKey(accountHash, 'compute_registry_hash');
  if (contractKey) {
    const hash = contractKey.replace('hash-', '');
    console.log('New ComputeRegistry contract hash:', hash);
    console.log('');
    console.log('Update casper-client.ts with:');
    console.log(`  computeRegistry: '${hash}',`);
  } else {
    console.log('Could not find compute_registry_hash named key');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
