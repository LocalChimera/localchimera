import sdk from 'casper-js-sdk';
import { readFileSync } from 'fs';

const pem = readFileSync('/tmp/casper-keys/Account 1_secret_key.pem', 'utf-8');
const key = sdk.PrivateKey.fromPem(pem, sdk.KeyAlgorithm.SECP256K1);

const args = sdk.Args.fromMap({
  owner: sdk.CLValue.newCLByteArray(key.publicKey.accountHash().hashBytes),
  fee_recipient: sdk.CLValue.newCLByteArray(key.publicKey.accountHash().hashBytes),
  minimum_stake: sdk.CLValue.newCLUInt512('1000000000000000000'),
});

const wasmBytes = new Uint8Array(readFileSync('/home/user/CascadeProjects/chimera-fortytwo-node/contracts-casper/target/wasm32-unknown-unknown/release/compute_registry.wasm'));
const session = sdk.ExecutableDeployItem.newModuleBytes(wasmBytes, args);
const payment = sdk.ExecutableDeployItem.standardPayment('10000000000');

const header = sdk.DeployHeader.default();
header.account = key.publicKey;
header.chainName = 'casper-test';

const deploy = sdk.Deploy.makeDeploy(header, payment, session);
deploy.sign(key);

console.log('Deploy hash:', deploy.hash.toHex());

// Try multiple nodes
const nodes = [
  'http://65.109.89.88:7777/rpc',
  'http://65.109.35.210:7777/rpc',
  'http://37.27.110.49:7777/rpc',
  'http://135.181.17.229:7777/rpc',
];

for (const node of nodes) {
  try {
    const client = new sdk.RpcClient(new sdk.HttpHandler(node));
    const result = await client.putDeploy(deploy);
    console.log(`Sent to ${node}:`, result.deployHash.toHex());
  } catch (e) {
    console.error(`Failed ${node}:`, e.message);
  }
}

// Wait for execution on first node
const client = new sdk.RpcClient(new sdk.HttpHandler(nodes[0]));
console.log('Waiting for execution...');
for (let i = 0; i < 120; i++) {
  await new Promise(r => setTimeout(r, 5000));
  try {
    const info = await client.getDeploy(deploy.hash.toHex());
    if (info.deploy?.executionInfo) {
      const ei = info.deploy.executionInfo;
      console.log('Executed at block:', ei.blockHeight);
      const er = ei.executionResult?.Version2;
      if (er) {
        console.log('Error:', er.errorMessage || 'None');
        console.log('Consumed:', er.consumed);
      }
      break;
    }
  } catch {}
}
