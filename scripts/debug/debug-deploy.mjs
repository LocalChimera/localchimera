import sdk from 'casper-js-sdk';
import { readFileSync } from 'fs';

const pem = readFileSync('/tmp/casper-keys/Account 1_secret_key.pem', 'utf-8');
const key = sdk.PrivateKey.fromPem(pem, sdk.KeyAlgorithm.SECP256K1);

const args = sdk.Args.fromMap({
  owner: sdk.CLValue.newCLByteArray(key.publicKey.accountHash().hashBytes),
});

const sessionItem = new sdk.SessionBuilder()
  .wasm(new Uint8Array([0, 97, 115, 109]))
  .installOrUpgrade()
  .runtimeArgs(args)
  .buildFor1_5();

console.log('sessionItem type:', sessionItem.constructor.name);
console.log('sessionItem keys:', Object.keys(sessionItem));

const paymentItem = sdk.ExecutableDeployItem.standardPayment('100000000');
console.log('paymentItem type:', paymentItem.constructor.name);

const header = sdk.DeployHeader.default();
console.log('header type:', header.constructor.name);
header.account = key.publicKey;
header.timestamp = sdk.Timestamp.from(new Date());
header.ttl = sdk.TTL.from('30m');
header.chainName = 'casper-test';
header.gasPrice = 1;
header.dependencies = [];

console.log('About to makeDeploy...');
const deploy = sdk.Deploy.makeDeploy(header, paymentItem, sessionItem);
console.log('deploy type:', deploy?.constructor?.name || 'undefined');
