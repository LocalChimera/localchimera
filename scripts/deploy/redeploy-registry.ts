/**
 * Redeploy ComputeRegistry with 1 CSPR minimum stake.
 * Usage: npx tsx scripts/redeploy-registry.ts
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sdk from 'casper-js-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CHAIN_NAME = 'casper-test';
const RPC_URL = 'http://localhost:7778/rpc';
const PAYMENT = '50000000000';
const WASM_DIR = join(__dirname, '../contracts-casper/target/wasm32v1-none/release');

function loadKey(): any {
  const pemPath = '/tmp/casper-wallet/Account 1_secret_key.pem';
  const pem = readFileSync(pemPath, 'utf-8');
  return sdk.PrivateKey.fromPem(pem, sdk.KeyAlgorithm.SECP256K1);
}

function clAccount(key: any): any {
  return sdk.CLValue.newCLByteArray(key.publicKey.accountHash().hashBytes);
}

async function main() {
  const key = loadKey();
  const client = new sdk.RpcClient(new sdk.HttpHandler(RPC_URL));
  const accountHash = key.publicKey.accountHash().toPrefixedString();
  console.log('Account:', accountHash);

  const owner = clAccount(key);
  const args = sdk.Args.fromMap({
    owner,
    fee_recipient: owner,
    minimum_stake: sdk.CLValue.newCLUInt512('1000000000'), // 1 CSPR
  });

  const wasmBytes = readFileSync(join(WASM_DIR, 'compute_registry.wasm'));
  const session = sdk.ExecutableDeployItem.newModuleBytes(wasmBytes, args);

  const payment = sdk.ExecutableDeployItem.standardPayment(PAYMENT);
  const header = sdk.DeployHeader.default();
  header.account = key.publicKey;
  header.chainName = CHAIN_NAME;
  header.timestamp = new Date() as any;

  const deploy = sdk.Deploy.makeDeploy(header, payment, session);
  deploy.sign(key);

  const result = await client.putDeploy(deploy);
  const deployHash = result.deployHash.toHex();
  console.log('Deploy hash:', deployHash);
  console.log('Explorer: https://testnet.cspr.live/deploy/' + deployHash);

  console.log('Waiting for execution...');
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const res = await client.getDeploy(sdk.DeployHash.fromHex(deployHash));
      const v2 = res.executionInfo?.executionResult?.Version2;
      if (v2) {
        if (v2.errorMessage) {
          console.error('Deploy failed:', v2.errorMessage);
          process.exit(1);
        }
        console.log('Deploy succeeded!');
        break;
      }
    } catch {}
  }

  // Query new contract hash via RPC
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'state_get_entity',
      params: { entity_identifier: { AccountHash: accountHash } },
    }),
  }).then(r => r.json());

  const keys: any[] = res.result?.addressable_entity?.Account?.named_keys || [];
  const nk = keys.find((k: any) => k.name === 'compute_registry_hash');
  if (nk) {
    const hash = nk.key.replace('hash-', '');
    console.log('\nNew ComputeRegistry hash:', hash);
    console.log('\nUpdate casper-client.ts:');
    console.log(`  computeRegistry: '${hash}',`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
