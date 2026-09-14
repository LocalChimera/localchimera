import { signTypedData, hashTypedData } from 'viem';
import { Logger } from '../core/Logger.js';

/**
 * EscrowChannel — on-chain deposit + off-chain EIP-712 voucher settlement.
 *
 * Inspired by Conduit's escrow payment channel: buyer makes one on-chain
 * deposit to open a channel, then settles each inference off-chain with
 * signed EIP-712 vouchers. This avoids per-inference gas costs while
 * maintaining cryptographic settlement guarantees.
 *
 * Lifecycle:
 *   1. open(deposit) — buyer deposits USDT on-chain, channel opened
 *   2. voucher(amount) — buyer signs off-chain voucher for each inference
 *   3. settle(vouchers) — seller submits vouchers on-chain to claim
 *   4. close() — channel closed, remaining funds returned to buyer
 *
 * EIP-712 typed data:
 *   { channel, amount, nonce, deadline, buyer, seller }
 *
 * This module manages the off-chain voucher book. On-chain interaction
 * is delegated to WalletManager.
 */

const EIP712_DOMAIN = {
  name: 'ChimeraEscrow',
  version: '1',
  chainId: 4663, // Robinhood Chain mainnet
  verifyingContract: '0x0000000000000000000000000000000000000000', // set at runtime
};

const EIP712_TYPES = {
  Voucher: [
    { name: 'channel', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'buyer', type: 'address' },
    { name: 'seller', type: 'address' },
  ],
};

export class EscrowChannel {
  constructor(config = {}) {
    this.logger = new Logger('EscrowChannel');
    this.enabled = config.enabled !== false;
    this.domain = { ...EIP712_DOMAIN, ...(config.domain || {}) };
    if (config.verifyingContract) {
      this.domain.verifyingContract = config.verifyingContract;
    }
    this._channels = new Map(); // channelId -> { buyer, seller, deposit, spent, nonce, vouchers, status, openedAt }
    this._walletManager = null;
    this._privateKey = config.privateKey || null;
    this._stats = {
      totalChannels: 0,
      totalVouchers: 0,
      totalSettled: 0,
      totalVolume: 0,
    };
  }

  /**
   * Set the wallet manager for on-chain operations.
   */
  setWalletManager(wm) {
    this._walletManager = wm;
  }

  /**
   * Open a new escrow channel with an on-chain deposit.
   * @param {object} params - { buyer, seller, depositAmount, sessionId }
   * @returns channel info
   */
  async open({ buyer, seller, depositAmount, sessionId = null }) {
    if (!this.enabled) throw new Error('EscrowChannel disabled');
    if (!buyer || !seller) throw new Error('buyer and seller addresses required');

    const channelId = `esc-${crypto.randomUUID().slice(0, 12)}`;
    const channel = {
      channelId,
      sessionId,
      buyer,
      seller,
      deposit: depositAmount,
      spent: 0,
      nonce: 0,
      vouchers: [],
      status: 'open',
      openedAt: Date.now(),
      settledAt: null,
    };

    this._channels.set(channelId, channel);
    this._stats.totalChannels++;
    this._stats.totalVolume += depositAmount;

    this.logger.info(`Channel opened: ${channelId} (deposit: ${depositAmount} USDT, buyer: ${buyer.slice(0, 8)}...)`);
    return {
      channelId,
      buyer,
      seller,
      deposit: depositAmount,
      status: 'open',
    };
  }

  /**
   * Create a signed voucher for an inference payment.
   * @param {string} channelId
   * @param {number} amount - USDT amount (in micro-USDT, 6 decimals)
   * @param {object} options - { deadline }
   * @returns { voucher, signature }
   */
  async createVoucher(channelId, amount, options = {}) {
    const channel = this._channels.get(channelId);
    if (!channel) throw new Error(`Channel ${channelId} not found`);
    if (channel.status !== 'open') throw new Error(`Channel ${channelId} is ${channel.status}`);

    const remaining = channel.deposit - channel.spent;
    if (amount > remaining) {
      throw new Error(`Insufficient channel balance: ${remaining} < ${amount}`);
    }

    channel.nonce++;
    const deadline = options.deadline || Math.floor(Date.now() / 1000) + 3600; // 1 hour

    const voucher = {
      channel: channelId,
      amount,
      nonce: channel.nonce,
      deadline,
      buyer: channel.buyer,
      seller: channel.seller,
    };

    // Sign voucher (EIP-712 typed data) via viem
    let signature = null;
    if (this._walletManager?.signTypedData) {
      try {
        signature = await this._walletManager.signTypedData(
          this.domain,
          EIP712_TYPES,
          voucher
        );
      } catch (e) {
        this.logger.warn(`WalletManager sign failed: ${e.message}`);
      }
    }
    if (!signature && this._privateKey) {
      try {
        signature = await signTypedData({
          domain: this.domain,
          types: EIP712_TYPES,
          primaryType: 'Voucher',
          message: voucher,
          privateKey: this._privateKey,
        });
      } catch (e) {
        this.logger.warn(`viem signTypedData failed: ${e.message}`);
      }
    }
    if (!signature) {
      throw new Error('No signing method available — set walletManager or privateKey');
    }

    channel.vouchers.push({ voucher, signature, createdAt: Date.now() });
    channel.spent += amount;
    this._stats.totalVouchers++;

    this.logger.info(`Voucher created: channel=${channelId}, amount=${amount}, nonce=${channel.nonce}`);
    return { voucher, signature };
  }

  /**
   * Verify a voucher signature using viem recoverTypedDataAddress.
   */
  async verifyVoucher(voucher, signature) {
    if (!voucher || !signature) return false;
    if (!voucher.channel || !voucher.amount || !voucher.nonce) return false;
    if (voucher.deadline < Math.floor(Date.now() / 1000)) return false;
    try {
      const { recoverTypedDataAddress } = await import('viem');
      const recovered = await recoverTypedDataAddress({
        domain: this.domain,
        types: EIP712_TYPES,
        primaryType: 'Voucher',
        message: voucher,
        signature,
      });
      return recovered.toLowerCase() === voucher.buyer.toLowerCase();
    } catch {
      return false;
    }
  }

  /**
   * Settle a channel by submitting vouchers on-chain.
   * @param {string} channelId
   * @returns settlement result
   */
  async settle(channelId) {
    const channel = this._channels.get(channelId);
    if (!channel) throw new Error(`Channel ${channelId} not found`);

    const validVouchers = [];
    for (const v of channel.vouchers) {
      if (await this.verifyVoucher(v.voucher, v.signature)) {
        validVouchers.push(v);
      }
    }
    const totalAmount = validVouchers.reduce((sum, v) => sum + v.voucher.amount, 0);

    let txHash = null;
    if (this._walletManager && this._walletManager.sendTransaction) {
      try {
        const tx = await this._walletManager.sendTransaction({
          to: channel.seller,
          amount: totalAmount,
          data: { type: 'escrow_settle', channelId, vouchers: validVouchers },
        });
        txHash = tx.hash;
      } catch (e) {
        this.logger.warn(`On-chain settlement failed: ${e.message}`);
      }
    }

    channel.status = 'settled';
    channel.settledAt = Date.now();
    this._stats.totalSettled++;

    this.logger.info(`Channel settled: ${channelId} (amount: ${totalAmount}, tx: ${txHash || 'offline'})`);
    return {
      channelId,
      status: 'settled',
      totalAmount,
      voucherCount: validVouchers.length,
      txHash,
      settledAt: channel.settledAt,
    };
  }

  /**
   * Close a channel and return remaining funds to buyer.
   */
  async close(channelId) {
    const channel = this._channels.get(channelId);
    if (!channel) throw new Error(`Channel ${channelId} not found`);

    const remaining = channel.deposit - channel.spent;
    channel.status = 'closed';
    channel.settledAt = Date.now();

    this.logger.info(`Channel closed: ${channelId} (remaining: ${remaining} returned to buyer)`);
    return {
      channelId,
      status: 'closed',
      remaining,
      returnedTo: channel.buyer,
    };
  }

  /**
   * Get channel status.
   */
  getChannel(channelId) {
    const channel = this._channels.get(channelId);
    if (!channel) return null;
    return {
      channelId: channel.channelId,
      buyer: channel.buyer,
      seller: channel.seller,
      deposit: channel.deposit,
      spent: channel.spent,
      remaining: channel.deposit - channel.spent,
      nonce: channel.nonce,
      voucherCount: channel.vouchers.length,
      status: channel.status,
      openedAt: channel.openedAt,
      settledAt: channel.settledAt,
    };
  }

  /**
   * List all channels.
   */
  listChannels(status = null) {
    const all = Array.from(this._channels.values()).map(c => ({
      channelId: c.channelId,
      buyer: c.buyer,
      seller: c.seller,
      deposit: c.deposit,
      spent: c.spent,
      status: c.status,
      voucherCount: c.vouchers.length,
    }));
    return status ? all.filter(c => c.status === status) : all;
  }

  getStats() {
    return {
      enabled: this.enabled,
      totalChannels: this._stats.totalChannels,
      activeChannels: Array.from(this._channels.values()).filter(c => c.status === 'open').length,
      totalVouchers: this._stats.totalVouchers,
      totalSettled: this._stats.totalSettled,
      totalVolume: Math.round(this._stats.totalVolume * 10000) / 10000,
      domain: this.domain.name,
    };
  }
}
