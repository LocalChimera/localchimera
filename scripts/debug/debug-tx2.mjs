import sdk from 'casper-js-sdk';
import { readFileSync } from 'fs';

const CHAIN_NAME = 'casper-test';
const pem = readFileSync('/tmp/casper-keys/Account 1_secret_key.pem', 'utf-8');
const key = sdk.PrivateKey.fromPem(pem, sdk.KeyAlgorithm.SECP256K1);

const tx = new sdk.NativeTransferBuilder()
  .from(key.publicKey)
  .target(key.publicKey)
  .amount('1000')
  .id(Date.now())
  .chainName(CHAIN_NAME)
  .payment(100_000_000)
  .build();

tx.sign(key);

// Get the transaction wrapper
const wrapper = tx.getTransactionWrapper();
console.log('Wrapper type:', wrapper.constructor.name);
console.log('Wrapper keys:', Object.keys(wrapper));
console.log('Wrapper JSON:', JSON.stringify(wrapper.toJSON ? wrapper.toJSON() : wrapper, (k, v) => {
  if (v instanceof Uint8Array) return Array.from(v);
  if (typeof v === 'bigint') return v.toString();
  return v;
}, 2));
