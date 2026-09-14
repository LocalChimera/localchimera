import { SignJWT, importPKCS8, jwtVerify, createRemoteJWKSet } from 'jose';
import { recoverAddress } from 'viem';
import { ed25519 } from '@noble/curves/ed25519';
import { utf8ToBytes } from '@noble/hashes/utils.js';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58ToBytes(str) {
  const alphabetMap = new Map(Array.from(BASE58_ALPHABET).map((c, i) => [c, BigInt(i)]));
  let num = 0n;
  for (const char of str) {
    const val = alphabetMap.get(char);
    if (val === undefined) throw new Error('Invalid base58 character');
    num = num * 58n + val;
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const bytes = new Uint8Array(hex.match(/.{2}/g)?.map(b => parseInt(b, 16)) || []);
  const leadingZeros = (str.match(/^[1]+/)?.[0]?.length) || 0;
  const result = new Uint8Array(leadingZeros + bytes.length);
  result.set(bytes, leadingZeros);
  return result;
}

function base64ToBytes(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function onRequest(context) {
  const clientId = context.env?.VITE_WEB3AUTH_CLIENT_ID;
  const privateKeyPem = context.env?.WEB3AUTH_JWT_PRIVATE_KEY;
  const issuer = context.env?.WEB3AUTH_JWT_ISSUER || 'https://new.localchimera.com';
  const supabaseUrl = context.env?.SUPABASE_URL;
  const supabaseJwksUrl = context.env?.SUPABASE_JWKS_URL;

  let supabaseJwks;
  if (supabaseJwksUrl) {
    try {
      supabaseJwks = createRemoteJWKSet(new URL(supabaseJwksUrl));
    } catch (e) {
      console.error('Invalid SUPABASE_JWKS_URL:', e);
    }
  }

  if (!clientId || !privateKeyPem) {
    return new Response(JSON.stringify({ error: 'Web3Auth JWT credentials not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  let body = {};
  try {
    body = await context.request.json();
  } catch (e) {}

  let sub, email, name;

  if (body.supabaseAccessToken) {
    if (!supabaseUrl || !supabaseJwks) {
      return new Response(JSON.stringify({ error: 'Supabase JWKS URL not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    try {
      const { payload } = await jwtVerify(body.supabaseAccessToken, supabaseJwks, {
        issuer: `${supabaseUrl}/auth/v1`,
        audience: 'authenticated',
      });
      sub = payload.sub;
      email = payload.email || `${sub}@supabase.user`;
      name = payload.user_metadata?.full_name || payload.user_metadata?.name || payload.email || sub;
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid Supabase access token', details: e.message }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else if (body.walletAddress && body.signature && body.message && body.chain === 'evm') {
    try {
      const recovered = await recoverAddress({ message: body.message, signature: body.signature });
      if (recovered.toLowerCase() !== body.walletAddress.toLowerCase()) {
        throw new Error('Signature does not match wallet address');
      }
      sub = body.walletAddress.toLowerCase();
      email = `${sub}@wallet.user`;
      name = sub;
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid EVM wallet signature', details: e.message }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else if (body.walletAddress && body.signature && body.message && body.chain === 'solana') {
    try {
      const pubKeyBytes = base58ToBytes(body.walletAddress);
      const sigBytes = base64ToBytes(body.signature);
      const msgBytes = utf8ToBytes(body.message);
      if (!ed25519.verify(sigBytes, msgBytes, pubKeyBytes)) {
        throw new Error('Solana signature verification failed');
      }
      sub = body.walletAddress;
      email = `${sub}@wallet.user`;
      name = sub;
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid Solana wallet signature', details: e.message }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    sub = body.sub || body.email || `user-${Date.now()}`;
    email = body.email || `${sub}@example.com`;
    name = body.name || sub;
  }

  const privateKey = await importPKCS8(privateKeyPem, 'RS256');
  const jwt = await new SignJWT({ sub, email, name })
    .setProtectedHeader({ alg: 'RS256', kid: 'web3auth-jwt-key-1', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(clientId)
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(privateKey);

  return new Response(JSON.stringify({ jwt, sub }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
