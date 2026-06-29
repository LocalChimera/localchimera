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
const payment = sdk.ExecutableDeployItem.standardPayment('50000000000'); // 50 CSPR

const header = sdk.DeployHeader.default();
header.account = key.publicKey;
header.chainName = 'casper-test';
header.gasPrice = 2; // Try higher gas price

const deploy = sdk.Deploy.makeDeploy(header, payment, session);
deploy.sign(key);

console.log('Deploy hash:', deploy.hash.toHex());
console.log('Deploy size:', deploy.toBytes().length, 'bytes');

const client = new sdk.RpcClient(new sdk.HttpHandler('http://65.109.89.88:7777/rpc'));
const result = await client.putDeploy(deploy);
console.log('putDeploy result:', result.deployHash.toHex());

// Wait for execution
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
    if (i % 12 === 0) console.log(`Still waiting... (${i/12} min)`);
  } catch (e) {
    console.error('Error checking deploy:', e.message);
  }
}
