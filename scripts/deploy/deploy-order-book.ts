import { readFileSync } from 'fs';
import sdk from 'casper-js-sdk';

const CHAIN_NAME = 'casper-test';
const RPC_URL = 'http://localhost:7778/rpc';
const PAYMENT = '200000000000';
const WASM_PATH = '/home/user/CascadeProjects/chimera-fortytwo-node/contracts-casper/target/wasm32v1-none/release/order_book.wasm';

const key = sdk.PrivateKey.fromPem(readFileSync('/tmp/casper-wallet/Account 1_secret_key.pem', 'utf-8'), sdk.KeyAlgorithm.SECP256K1);
const client = new sdk.RpcClient(new sdk.HttpHandler(RPC_URL));
const accountHash = key.publicKey.accountHash().toPrefixedString();
console.log('Account:', accountHash);

const owner = sdk.CLValue.newCLByteArray(key.publicKey.accountHash().hashBytes);
const computeRegistry = sdk.CLValue.newCLByteArray(
  Uint8Array.from(Buffer.from('f8c969bfa7553a23deab0f77fb43210d4810156a977e0cc2695b23182e5b41d0', 'hex'))
);
const args = sdk.Args.fromMap({
  owner,
  compute_registry: computeRegistry,
});

const wasmBytes = readFileSync(WASM_PATH);
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

const entityRes = await fetch(RPC_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1,
    method: 'state_get_entity',
    params: { entity_identifier: { AccountHash: accountHash } },
  }),
}).then(r => r.json());

const keys: any[] = entityRes.result?.addressable_entity?.Account?.named_keys || [];
const nk = keys.find((k: any) => k.name === 'order_book_hash');
if (nk) {
  const hash = nk.key.replace('hash-', '');
  console.log('\nNew OrderBook hash:', hash);
  console.log('\nUpdate casper-client.ts:');
  console.log(`  orderBook: '${hash}',`);
}
