import pkg from 'casper-js-sdk';
const { PrivateKey, KeyAlgorithm } = pkg;

const escrowKey = PrivateKey.generate(KeyAlgorithm.SECP256K1);
console.log('Escrow Public Key:', escrowKey.publicKey.toHex());
console.log('Escrow Account Hash:', escrowKey.publicKey.accountHash().toHex());
console.log('Escrow PEM:');
console.log(escrowKey.toPem());
