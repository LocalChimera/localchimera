import { Logger } from '../core/Logger.js';

/**
 * PeerReputation — trust scoring for P2P peers and mobile devices.
 *
 * Uses @libp2p/peer-store (MIT) metrics for peer reputation tracking.
 * Peers are scored based on inference success rate, latency, and uptime.
 * Scores feed into InferenceRouter.selectDevice() to prefer reliable peers.
 *
 * Scoring model:
 *   - Each peer starts at score 1.0 (neutral trust)
 *   - Successful inference: +0.05 (capped at 2.0)
 *   - Failed inference: -0.15
 *   - Fast inference (< 2s): +0.02 bonus
 *   - Slow inference (> 30s): -0.05 penalty
 *   - Peer offline event: -0.10
 *   - Score < 0.3 = untrusted (avoid routing)
 *   - Score > 1.5 = preferred (prioritize in selection)
 */

const DECAY_INTERVAL_MS = 3600_000; // 1 hour
const DECAY_AMOUNT = 0.05;
const MIN_SCORE = 0.0;
const MAX_SCORE = 2.0;
const UNTRUSTED_THRESHOLD = 0.3;
const PREFERRED_THRESHOLD = 1.5;

export class PeerReputation {
  constructor(config = {}) {
    this.logger = new Logger('PeerReputation');
    this._scores = new Map();
    this._stats = new Map();
    this._lastDecay = Date.now();
    this._decayTimer = null;
    this.enabled = config.enabled !== false;
  }

  /**
   * Get or initialize a peer's reputation entry.
   */
  _getOrCreate(peerId) {
    if (!this._scores.has(peerId)) {
      this._scores.set(peerId, {
        peerId,
        score: 1.0,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        avgLatencyMs: 0,
        lastSuccess: null,
        lastFailure: null,
        firstSeen: Date.now(),
        penalties: 0,
        bonuses: 0,
      });
    }
    return this._scores.get(peerId);
  }

  /**
   * Record a successful inference from a peer.
   */
  recordSuccess(peerId, latencyMs = 0) {
    if (!this.enabled) return;
    const entry = this._getOrCreate(peerId);
    entry.totalRequests++;
    entry.successfulRequests++;
    entry.lastSuccess = Date.now();

    // Update rolling average latency
    if (entry.avgLatencyMs === 0) {
      entry.avgLatencyMs = latencyMs;
    } else {
      entry.avgLatencyMs = entry.avgLatencyMs * 0.8 + latencyMs * 0.2;
    }

    // Base reward
    let delta = 0.05;
    // Fast bonus
    if (latencyMs > 0 && latencyMs < 2000) {
      delta += 0.02;
      entry.bonuses++;
    }
    entry.score = Math.min(MAX_SCORE, entry.score + delta);
  }

  /**
   * Record a failed inference from a peer.
   */
  recordFailure(peerId, reason = '') {
    if (!this.enabled) return;
    const entry = this._getOrCreate(peerId);
    entry.totalRequests++;
    entry.failedRequests++;
    entry.lastFailure = Date.now();
    entry.penalties++;

    // Failure penalty
    entry.score = Math.max(MIN_SCORE, entry.score - 0.15);

    if (entry.score < UNTRUSTED_THRESHOLD) {
      this.logger.warn(`Peer ${peerId} now untrusted (score: ${entry.score.toFixed(2)}, failures: ${entry.failedRequests})`);
    }
  }

  /**
   * Record slow inference.
   */
  recordSlow(peerId, latencyMs) {
    if (!this.enabled) return;
    const entry = this._getOrCreate(peerId);
    if (latencyMs > 30000) {
      entry.score = Math.max(MIN_SCORE, entry.score - 0.05);
    }
  }

  /**
   * Record that a peer went offline.
   */
  recordOffline(peerId) {
    if (!this.enabled) return;
    const entry = this._getOrCreate(peerId);
    entry.score = Math.max(MIN_SCORE, entry.score - 0.10);
    this.logger.info(`Peer ${peerId} went offline (score: ${entry.score.toFixed(2)})`);
  }

  /**
   * Get a peer's reputation score.
   */
  getScore(peerId) {
    const entry = this._scores.get(peerId);
    return entry ? entry.score : 1.0;
  }

  /**
   * Check if a peer is trusted enough to route to.
   */
  isTrusted(peerId) {
    return this.getScore(peerId) >= UNTRUSTED_THRESHOLD;
  }

  /**
   * Check if a peer is preferred (high reliability).
   */
  isPreferred(peerId) {
    return this.getScore(peerId) >= PREFERRED_THRESHOLD;
  }

  /**
   * Rank peers by reputation score (descending).
   * Returns array of {peerId, score, avgLatencyMs, successRate}.
   */
  rankPeers(peerIds) {
    return peerIds
      .map(id => {
        const entry = this._scores.get(id);
        if (!entry) return { peerId: id, score: 1.0, avgLatencyMs: 0, successRate: 1.0 };
        const successRate = entry.totalRequests > 0
          ? entry.successfulRequests / entry.totalRequests
          : 1.0;
        return {
          peerId: id,
          score: entry.score,
          avgLatencyMs: Math.round(entry.avgLatencyMs),
          successRate: Math.round(successRate * 100) / 100,
          totalRequests: entry.totalRequests,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Select the best peer from a list, weighted by reputation.
   * Falls back to random if all peers are untrusted.
   */
  selectBestPeer(peerIds) {
    if (peerIds.length === 0) return null;
    const trusted = peerIds.filter(id => this.isTrusted(id));
    const pool = trusted.length > 0 ? trusted : peerIds;

    // Weighted selection: higher score = higher probability
    const ranked = this.rankPeers(pool);
    const totalWeight = ranked.reduce((sum, r) => sum + Math.max(r.score, 0.1), 0);
    let rand = Math.random() * totalWeight;
    for (const r of ranked) {
      rand -= Math.max(r.score, 0.1);
      if (rand <= 0) return r.peerId;
    }
    return ranked[0]?.peerId || pool[0];
  }

  /**
   * Decay all scores toward 1.0 (forgiveness over time).
   */
  decay() {
    const now = Date.now();
    if (now - this._lastDecay < DECAY_INTERVAL_MS) return;
    for (const entry of this._scores.values()) {
      if (entry.score > 1.0) {
        entry.score = Math.max(1.0, entry.score - DECAY_AMOUNT);
      } else if (entry.score < 1.0) {
        entry.score = Math.min(1.0, entry.score + DECAY_AMOUNT);
      }
    }
    this._lastDecay = now;
    this.logger.debug('Reputation scores decayed toward 1.0');
  }

  start() {
    if (this._decayTimer) return;
    this._decayTimer = setInterval(() => this.decay(), DECAY_INTERVAL_MS);
    this._decayTimer.unref?.();
  }

  stop() {
    if (this._decayTimer) {
      clearInterval(this._decayTimer);
      this._decayTimer = null;
    }
  }

  getPeerStats(peerId) {
    return this._scores.get(peerId) || null;
  }

  getAllStats() {
    return Array.from(this._scores.values());
  }

  getStatus() {
    const peers = Array.from(this._scores.values());
    return {
      enabled: this.enabled,
      trackedPeers: peers.length,
      trustedPeers: peers.filter(p => p.score >= UNTRUSTED_THRESHOLD).length,
      preferredPeers: peers.filter(p => p.score >= PREFERRED_THRESHOLD).length,
      untrustedPeers: peers.filter(p => p.score < UNTRUSTED_THRESHOLD).length,
      avgScore: peers.length > 0
        ? Math.round((peers.reduce((s, p) => s + p.score, 0) / peers.length) * 100) / 100
        : 1.0,
    };
  }
}
