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

// Serialize to JSON to see what we're sending
console.log('Transaction JSON:', JSON.stringify(tx.toJSON(), (key, value) => {
  if (value instanceof Uint8Array) return Array.from(value);
  if (typeof value === 'bigint') return value.toString();
  return value;
}, 2));
