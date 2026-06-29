import sdk from 'casper-js-sdk';
import { readFileSync } from 'fs';

const pem = readFileSync('/tmp/casper-keys/Account 1_secret_key.pem', 'utf-8');
const key = sdk.PrivateKey.fromPem(pem, sdk.KeyAlgorithm.SECP256K1);

const tx = new sdk.SessionBuilder()
  .wasm(new Uint8Array([0, 97, 115, 109]))
  .installOrUpgrade()
  .runtimeArgs(sdk.Args.fromMap({}))
  .from(key.publicKey)
  .chainName('casper-test')
  .payment(100000000)
  .build();

const wrapper = tx.getTransactionWrapper();
const rawJson = JSON.parse(JSON.stringify(wrapper, (k, v) => {
  if (v instanceof Uint8Array) return Array.from(v);
  return v;
}));

console.log('fields:', JSON.stringify(rawJson.transactionV1.payload.fields, null, 2));
