import crypto from 'crypto';
import { Logger } from '../core/Logger.js';
import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';

/**
 * ContentPinner — replicates important content to N peers via P2P + IPFS.
 *
 * Uses helia (MIT/Apache-2.0) for IPFS-based content pinning.
 * Critical data (inference receipts, wiki pages, RAG documents) is pinned
 * to multiple peers for durability via both P2P broadcast and IPFS.
 */

export class ContentPinner {
  constructor(config = {}) {
    this.logger = new Logger('ContentPinner');
    this.enabled = config.enabled !== false;
    this.replicationFactor = config.replicationFactor || 3;
    this.ttl = config.ttl || 86400000; // 24 hours
    this._pinned = new Map(); // hash → { data, acks, pinnedAt, ttl }
    this._remotePinned = new Map(); // hash → { data, from, pinnedAt }
    this._p2p = null;
    this._cryptoVault = null;
    this._helia = null;
    this._fs = null;
    this._stats = {
      totalPinned: 0,
      totalUnpinned: 0,
      totalAcks: 0,
      remoteStored: 0,
      remoteEvicted: 0,
      ipfsPins: 0,
    };
    this._cleanupTimer = null;
  }

  /**
   * Initialize helia IPFS node.
   */
  async start() {
    if (this._cleanupTimer) return;
    try {
      this._helia = await createHelia();
      this._fs = unixfs(this._helia);
      this.logger.info('Helia IPFS node started');
    } catch (e) {
      this.logger.warn(`Helia init failed, falling back to P2P-only: ${e.message}`);
    }
    this._cleanupTimer = setInterval(() => this.cleanup(), 300000);
    this._cleanupTimer.unref?.();
  }

  /**
   * Set P2P instance for broadcasting.
   */
  setP2P(p2p) {
    this._p2p = p2p;
    if (p2p && p2p.onMessage) {
      p2p.onMessage((msg, peerId) => this._handleMessage(msg, peerId));
    }
  }

  /**
   * Set CryptoVault for encryption.
   */
  setCryptoVault(vault) {
    this._cryptoVault = vault;
  }

  /**
   * Pin content to peers.
   * @param {string} hash - content hash (for dedup)
   * @param {*} data - data to pin
   * @param {object} options - { ttl, encrypt, workspace }
   * @returns pin status
   */
  async pin(hash, data, options = {}) {
    if (!this.enabled) return { pinned: false, reason: 'disabled' };
    if (!this._p2p) return { pinned: false, reason: 'no P2P' };

    const contentHash = hash || this._hash(data);
    const ttl = options.ttl || this.ttl;

    // Encrypt if vault is available and requested
    let payload = data;
    if (options.encrypt && this._cryptoVault && options.workspace) {
      const text = typeof data === 'string' ? data : JSON.stringify(data);
      payload = this._cryptoVault.encrypt(options.workspace, text);
    }

    const entry = {
      hash: contentHash,
      data: payload,
      acks: new Set(),
      pinnedAt: Date.now(),
      ttl,
      encrypted: !!options.encrypt,
      replicationFactor: this.replicationFactor,
    };
    this._pinned.set(contentHash, entry);

    // Broadcast pin request to peers
    await this._p2p.broadcast({
      type: 'content-pin',
      hash: contentHash,
      data: payload,
      ttl,
      encrypted: entry.encrypted,
      from: this._peerId,
    });

    this.logger.info(`Pinning content ${contentHash.slice(0, 16)}... to ${this.replicationFactor} peers`);

    // Also pin to IPFS via helia if available
    let ipfsCid = null;
    if (this._fs) {
      try {
        const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
        ipfsCid = await this._fs.addBytes(Buffer.from(text, 'utf-8'));
        this._stats.ipfsPins++;
        this.logger.debug(`IPFS pin: ${ipfsCid.toString()}`);
      } catch (e) {
        this.logger.warn(`IPFS pin failed: ${e.message}`);
      }
    }

    return { pinned: true, hash: contentHash, acks: 0, required: this.replicationFactor, ipfsCid: ipfsCid?.toString() || null };
  }

  /**
   * Unpin content from peers.
   */
  async unpin(hash) {
    if (!this._p2p) return;
    const entry = this._pinned.get(hash);
    if (!entry) return;

    await this._p2p.broadcast({
      type: 'content-unpin',
      hash,
      from: this._peerId,
    });

    this._pinned.delete(hash);
    this._stats.totalUnpinned++;
    this.logger.info(`Unpinned content ${hash.slice(0, 16)}...`);
  }

  /**
   * Get pin status for a content hash.
   */
  getPinStatus(hash) {
    const entry = this._pinned.get(hash);
    if (!entry) return { pinned: false };
    return {
      pinned: entry.acks.size >= this.replicationFactor,
      hash,
      acks: entry.acks.size,
      required: this.replicationFactor,
      pinnedAt: entry.pinnedAt,
      ttl: entry.ttl,
      age: Date.now() - entry.pinnedAt,
    };
  }

  /**
   * Handle incoming P2P messages.
   */
  _handleMessage(msg, peerId) {
    if (msg.type === 'content-pin') {
      this._handleRemotePin(msg, peerId);
    } else if (msg.type === 'content-pin-ack') {
      this._handlePinAck(msg, peerId);
    } else if (msg.type === 'content-unpin') {
      this._handleRemoteUnpin(msg, peerId);
    }
  }

  /**
   * Store remotely pinned content and send ack.
   */
  _handleRemotePin(msg, peerId) {
    const { hash, data, ttl, encrypted } = msg;
    this._remotePinned.set(hash, {
      data,
      from: peerId,
      pinnedAt: Date.now(),
      ttl: ttl || this.ttl,
      encrypted,
    });
    this._stats.remoteStored++;

    // Send ack back to the pinner
    if (this._p2p) {
      this._p2p.broadcast({
        type: 'content-pin-ack',
        hash,
        from: this._peerId,
      });
    }
    this.logger.debug(`Stored remote pin ${hash.slice(0, 16)}... from ${peerId}`);
  }

  /**
   * Record a pin acknowledgement from a peer.
   */
  _handlePinAck(msg, peerId) {
    const { hash } = msg;
    const entry = this._pinned.get(hash);
    if (entry) {
      entry.acks.add(peerId);
      this._stats.totalAcks++;
      if (entry.acks.size >= this.replicationFactor) {
        this._stats.totalPinned++;
        this.logger.info(`Content ${hash.slice(0, 16)}... fully pinned (${entry.acks.size}/${this.replicationFactor})`);
      }
    }
  }

  /**
   * Remove remotely pinned content.
   */
  _handleRemoteUnpin(msg, peerId) {
    const { hash } = msg;
    if (this._remotePinned.has(hash)) {
      this._remotePinned.delete(hash);
      this._stats.remoteEvicted++;
      this.logger.debug(`Removed remote pin ${hash.slice(0, 16)}... from ${peerId}`);
    }
  }

  /**
   * Retrieve pinned content (local or remote).
   */
  retrieve(hash) {
    // Check local pins first
    const local = this._pinned.get(hash);
    if (local) return { data: local.data, source: 'local', encrypted: local.encrypted };

    // Check remote pins
    const remote = this._remotePinned.get(hash);
    if (remote) return { data: remote.data, source: 'remote', encrypted: remote.encrypted };

    return null;
  }

  /**
   * Clean up expired pins.
   */
  cleanup() {
    const now = Date.now();
    let removed = 0;

    for (const [hash, entry] of this._pinned) {
      if (now - entry.pinnedAt > entry.ttl) {
        this._pinned.delete(hash);
        removed++;
      }
    }

    for (const [hash, entry] of this._remotePinned) {
      if (now - entry.pinnedAt > entry.ttl) {
        this._remotePinned.delete(hash);
        removed++;
      }
    }

    if (removed > 0) this.logger.debug(`Cleaned up ${removed} expired pins`);
  }

  stop() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    if (this._helia) {
      this._helia.stop().catch(() => {});
    }
  }

  _hash(data) {
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  getStats() {
    return {
      enabled: this.enabled,
      replicationFactor: this.replicationFactor,
      localPins: this._pinned.size,
      fullyPinned: Array.from(this._pinned.values()).filter(e => e.acks.size >= this.replicationFactor).length,
      remotePins: this._remotePinned.size,
      totalPinned: this._stats.totalPinned,
      totalUnpinned: this._stats.totalUnpinned,
      totalAcks: this._stats.totalAcks,
      remoteStored: this._stats.remoteStored,
      remoteEvicted: this._stats.remoteEvicted,
      ipfsPins: this._stats.ipfsPins,
    };
  }
}
