import sdk from 'casper-js-sdk';
import { readFileSync } from 'fs';

const pem = readFileSync('/tmp/casper-keys/Account 1_secret_key.pem', 'utf-8');
const key = sdk.PrivateKey.fromPem(pem, sdk.KeyAlgorithm.SECP256K1);

const args = sdk.Args.fromMap({
  compute_registry: sdk.CLValue.newCLByteArray(key.publicKey.accountHash().hashBytes),
  reputation: sdk.CLValue.newCLByteArray(key.publicKey.accountHash().hashBytes),
  owner: sdk.CLValue.newCLByteArray(key.publicKey.accountHash().hashBytes),
  protocol_fee_recipient: sdk.CLValue.newCLByteArray(key.publicKey.accountHash().hashBytes),
});

const wasmBytes = new Uint8Array(readFileSync('/home/user/CascadeProjects/chimera-fortytwo-node/contracts-casper/target/wasm32v1-none/release/escrow_vault.wasm'));
const session = sdk.ExecutableDeployItem.newModuleBytes(wasmBytes, args);
const payment = sdk.ExecutableDeployItem.standardPayment('500000000000');

const header = sdk.DeployHeader.default();
header.account = key.publicKey;
header.chainName = 'casper-test';

const deploy = sdk.Deploy.makeDeploy(header, payment, session);
deploy.sign(key);

console.log('Deploy hash:', deploy.hash.toHex());

const client = new sdk.RpcClient(new sdk.HttpHandler('http://65.109.89.88:7777/rpc'));
const result = await client.putDeploy(deploy);
console.log('putDeploy result:', result.deployHash.toHex());
