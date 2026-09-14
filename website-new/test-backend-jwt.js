/**
 * End-to-end test for the Web3Auth backend JWT endpoint.
 *
 * Generates EVM and Solana wallets, signs the expected message, and verifies
 * the backend `/api/web3auth-jwt` endpoint returns a valid JWT.
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { jwtVerify, createLocalJWKSet } from 'jose';

const API_BASE = process.env.API_BASE || 'https://162f2483.new-localchimera.pages.dev/api';

async function fetchJwks() {
  const res = await fetch(`${API_BASE}/web3auth-jwks`);
  if (!res.ok) throw new Error(`JWKS endpoint failed: ${res.status}`);
  return res.json();
}

async function fetchJwt({ walletAddress, message, signature, chain }) {
  const res = await fetch(`${API_BASE}/web3auth-jwt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress, message, signature, chain }),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`JWT endpoint failed: ${res.status} ${json.error || text}`);
  return json;
}

async function testEvmJwt() {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const walletAddress = account.address;
  const message = `Sign in to LocalChimera with ${walletAddress} at ${new Date().toISOString()}`;
  const signature = await account.signMessage({ message });

  const { jwt, sub } = await fetchJwt({ walletAddress, message, signature, chain: 'evm' });
  if (!jwt) throw new Error('No JWT returned for EVM');
  if (sub.toLowerCase() !== walletAddress.toLowerCase()) throw new Error(`EVM sub mismatch: ${sub}`);
  console.log('EVM JWT issued:', jwt.slice(0, 20) + '...');
  return { jwt, sub };
}

async function testSolanaJwt() {
  const privKey = ed25519.utils.randomPrivateKey();
  const pubKey = ed25519.getPublicKey(privKey);
  const walletAddress = bs58.encode(pubKey);
  const message = `Sign in to LocalChimera with ${walletAddress} at ${new Date().toISOString()}`;
  const encoded = new TextEncoder().encode(message);
  const signed = ed25519.sign(encoded, privKey);
  const signature = Buffer.from(signed).toString('base64');

  const { jwt, sub } = await fetchJwt({ walletAddress, message, signature, chain: 'solana' });
  if (!jwt) throw new Error('No JWT returned for Solana');
  if (sub !== walletAddress) throw new Error(`Solana sub mismatch: ${sub}`);
  console.log('Solana JWT issued:', jwt.slice(0, 20) + '...');
  return { jwt, sub };
}

async function verifyJwt(jwt, jwks) {
  const jwksSet = createLocalJWKSet(jwks);
  const { payload } = await jwtVerify(jwt, jwksSet);
  console.log('Verified JWT payload:', payload);
  return payload;
}

async function main() {
  console.log('Testing backend JWT endpoint:', API_BASE);
  const jwks = await fetchJwks();
  console.log('JWKS loaded:', jwks.keys.length, 'key(s)');

  const evm = await testEvmJwt();
  await verifyJwt(evm.jwt, jwks);

  const solana = await testSolanaJwt();
  await verifyJwt(solana.jwt, jwks);

  console.log('All backend JWT tests passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
