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

// Use load-balanced URL
const client = new sdk.RpcClient(new sdk.HttpHandler('https://node.testnet.casper.network/rpc'));
const result = await client.putDeploy(deploy);
console.log('putDeploy result:', result.deployHash.toHex());

// Check immediately
await new Promise(r => setTimeout(r, 3000));
const info = await client.getDeploy(deploy.hash.toHex());
console.log('Has execution_info:', !!info.deploy?.executionInfo);
