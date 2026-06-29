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

tx.sign(key);

const wrapper = tx.getTransactionWrapper();
const rawJson = JSON.parse(JSON.stringify(wrapper, (k, v) => {
  if (v instanceof Uint8Array) return Array.from(v);
  if (typeof v === 'bigint') return v.toString();
  return v;
}));

console.log('hash type:', typeof rawJson.transactionV1.hash);
console.log('hash value:', rawJson.transactionV1.hash);
console.log('Is array:', Array.isArray(rawJson.transactionV1.hash));
