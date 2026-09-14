import { test, expect } from '@playwright/test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';

const API_BASE = process.env.API_BASE || 'https://162f2483.new-localchimera.pages.dev/api';
const TEST_PAGE = process.env.SDK_TEST_PAGE || 'https://162f2483.new-localchimera.pages.dev/example/sdk-test/';

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

test('SDK creates EVM-backed MPC wallet via createMpcWalletFromJwt', async ({ page }) => {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const walletAddress = account.address;
  const message = `Sign in to LocalChimera with ${walletAddress} at ${new Date().toISOString()}`;
  const signature = await account.signMessage({ message });

  const { jwt, sub } = await fetchJwt({ walletAddress, message, signature, chain: 'evm' });
  expect(jwt).toBeTruthy();
  expect(sub.toLowerCase()).toBe(walletAddress.toLowerCase());

  await page.goto(TEST_PAGE);
  const result = await page.evaluate(async ({ jwt, sub }) => {
    return await window.testSdkMpc({ jwt, sub });
  }, { jwt, sub });

  expect(result.success).toBe(true);
  expect(result.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  console.log('SDK EVM MPC wallet address:', result.address);
});

test('SDK creates Solana-backed MPC wallet via createMpcWalletFromJwt', async ({ page }) => {
  const privKey = ed25519.utils.randomPrivateKey();
  const pubKey = ed25519.getPublicKey(privKey);
  const walletAddress = bs58.encode(pubKey);
  const message = `Sign in to LocalChimera with ${walletAddress} at ${new Date().toISOString()}`;
  const encoded = new TextEncoder().encode(message);
  const signed = ed25519.sign(encoded, privKey);
  const signature = Buffer.from(signed).toString('base64');

  const { jwt, sub } = await fetchJwt({ walletAddress, message, signature, chain: 'solana' });
  expect(jwt).toBeTruthy();
  expect(sub).toBe(walletAddress);

  await page.goto(TEST_PAGE);
  const result = await page.evaluate(async ({ jwt, sub }) => {
    return await window.testSdkMpc({ jwt, sub });
  }, { jwt, sub });

  expect(result.success).toBe(true);
  expect(result.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  console.log('SDK Solana MPC wallet address:', result.address);
});
