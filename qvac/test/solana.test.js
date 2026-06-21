/**
 * EarnidleMiner — Solana SPL wallet tests.
 *
 * Earnidle is the only Solana miner. It holds the project's shared Solana SPL
 * collection address; funds sweep weekly into the EVM multisig for monthly
 * distribution to each machine operator's EVM address.
 *
 * Run: node --test test/solana.test.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EarnidleMiner } from '../src/miners/EarnidleMiner.js';

const VALID_ADDR = '4R5d695FM5AiVjTkbadrjU4wr9ayK7ajeMdqgLd9muQA';

describe('EarnidleMiner — Solana wallet', () => {
  it('accepts a valid 44-char base58 Solana address', () => {
    const m = new EarnidleMiner({ walletAddress: VALID_ADDR });
    assert.ok(m.validateWalletAddress(VALID_ADDR));
  });

  it('accepts a valid 32-char base58 Solana address', () => {
    const m = new EarnidleMiner({});
    assert.ok(m.validateWalletAddress('11111111111111111111111111111112'));
  });

  it('rejects addresses that are too short', () => {
    const m = new EarnidleMiner({});
    assert.ok(!m.validateWalletAddress('bad'));
    assert.ok(!m.validateWalletAddress('short123'));
  });

  it('rejects empty and null inputs', () => {
    const m = new EarnidleMiner({});
    assert.ok(!m.validateWalletAddress(''));
    assert.ok(!m.validateWalletAddress(null));
    assert.ok(!m.validateWalletAddress(undefined));
  });

  it('rejects addresses containing invalid base58 chars (0, O, I, l)', () => {
    const m = new EarnidleMiner({});
    assert.ok(!m.validateWalletAddress('0ovcKVxdNHH1LradUS8T5gmYiYUGQPW8xtPhfp9ZhPXw'));
    assert.ok(!m.validateWalletAddress('OovcKVxdNHH1LradUS8T5gmYiYUGQPW8xtPhfp9ZhPXw'));
  });

  it('masks address showing first 6 and last 4 chars', () => {
    const m = new EarnidleMiner({});
    assert.equal(m.maskAddress(VALID_ADDR), '4R5d69...muQA');
  });

  it('masks short or empty address as ***', () => {
    const m = new EarnidleMiner({});
    assert.equal(m.maskAddress(''), '***');
    assert.equal(m.maskAddress(null), '***');
    assert.equal(m.maskAddress('short'), '***');
  });

  it('stores wallet address and reports walletConfigured correctly', () => {
    const configured = new EarnidleMiner({ walletAddress: VALID_ADDR });
    const unconfigured = new EarnidleMiner({});
    assert.equal(configured.walletAddress, VALID_ADDR);
    assert.equal(configured.getStatus().walletConfigured, true);
    assert.equal(unconfigured.getStatus().walletConfigured, false);
  });

  it('does not make network calls when walletAddress is absent', async () => {
    const m = new EarnidleMiner({});
    let fetched = false;
    const origFetch = global.fetch;
    global.fetch = async () => { fetched = true; };
    await m._pollAndRun();
    global.fetch = origFetch;
    assert.equal(fetched, false);
  });

  it('network is solana', () => {
    const m = new EarnidleMiner({ network: 'solana' });
    assert.equal(m.network, 'solana');
    assert.equal(m.getStatus().network, 'solana');
  });
});
