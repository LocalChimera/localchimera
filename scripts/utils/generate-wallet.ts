/**
 * Generate a new Casper/EVM compatible wallet.
 *
 * Usage:
 *   npx tsx scripts/generate-wallet.ts
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak256 } from 'ethers';

function generateWallet(): void {
  const priv = secp256k1.utils.randomPrivateKey();
  const privHex = '0x' + Buffer.from(priv).toString('hex');

  const pub = secp256k1.getPublicKey(priv, false);
  const pubCompressed = secp256k1.getPublicKey(priv, true);

  const pubNoPrefix = pub.slice(1);
  const hash = keccak256(new Uint8Array(pubNoPrefix));
  const evmAddress = '0x' + hash.slice(-40);

  console.log('=== NEW CASPER / EVM WALLET ===');
  console.log('Private Key:', privHex);
  console.log('Casper Public Key (compressed):', '0x' + Buffer.from(pubCompressed).toString('hex'));
  console.log('EVM Address:', evmAddress);
  console.log('=================================');
}

generateWallet();
