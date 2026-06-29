import sdk from 'casper-js-sdk';
import { readFileSync } from 'fs';

const pem = readFileSync('/tmp/casper-keys/Account 1_secret_key.pem', 'utf-8');
const key = sdk.PrivateKey.fromPem(pem, sdk.KeyAlgorithm.SECP256K1);

const args = sdk.Args.fromMap({
  owner: sdk.CLValue.newCLByteArray(key.publicKey.accountHash().hashBytes),
});

const builder = new sdk.SessionBuilder()
  .from(key.publicKey)
  .wasm(new Uint8Array([0, 97, 115, 109]))
  .installOrUpgrade()
  .runtimeArgs(args)
  .chainName('casper-test')
  .payment(100000000);

console.log('builder publicKey:', builder._publicKey ? 'yes' : 'no');
console.log('builder from:', typeof builder.from);

const sessionItem = builder.buildFor1_5();
console.log('sessionItem type:', sessionItem.constructor.name);
