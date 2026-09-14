import { Logger } from '../core/Logger.js';
import pTimeout from 'p-timeout';

/**
 * SLAEnforcer — per-request timeout enforcement with automatic refund.
 *
 * Uses p-timeout (MIT) for timeout enforcement.
 *
 * SLA levels:
 *   - standard: 30s timeout (default)
 *   - priority: 10s timeout
 *   - batch: 120s timeout
 *   - custom: caller-specified
 */

const SLA_LEVELS = {
  standard: 30000,
  priority: 10000,
  batch: 120000,
};

export class SLAEnforcer {
  constructor(config = {}) {
    this.logger = new Logger('SLAEnforcer');
    this.enabled = config.enabled !== false;
    this.defaultTimeout = config.defaultTimeout || SLA_LEVELS.standard;
    this.levels = { ...SLA_LEVELS, ...(config.levels || {}) };
    this._activeTimers = new Map();
    this._stats = {
      totalRequests: 0,
      timeouts: 0,
      avgDurationMs: 0,
      slaBreaches: 0,
    };
  }

  /**
   * Get timeout for a given SLA level.
   */
  getTimeout(level = 'standard') {
    return this.levels[level] || this.defaultTimeout;
  }

  /**
   * Execute a function with an SLA timeout.
   * If the function doesn't resolve within the timeout, rejects with a timeout error.
   *
   * @param {string} requestId - unique request ID
   * @param {function} fn - async function to execute
   * @param {object} options - { level, timeoutMs, onTimeout }
   * @returns result of fn, or throws TimeoutError
   */
  async execute(requestId, fn, options = {}) {
    if (!this.enabled) return fn();

    const timeout = options.timeoutMs || this.getTimeout(options.level);
    this._stats.totalRequests++;
    const startedAt = Date.now();
    this._activeTimers.set(requestId, { startedAt, timeout });

    try {
      const result = await pTimeout(fn(), { milliseconds: timeout });
      this._activeTimers.delete(requestId);
      const duration = Date.now() - startedAt;
      this._updateAvgDuration(duration);

      if (duration > timeout * 0.8) {
        this.logger.warn(`SLA near-miss for ${requestId}: ${duration}ms / ${timeout}ms`);
      }

      return result;
    } catch (err) {
      this._activeTimers.delete(requestId);
      if (err.name === 'TimeoutError') {
        this._stats.timeouts++;
        this._stats.slaBreaches++;
        const error = new Error(`SLA timeout: request ${requestId} exceeded ${timeout}ms`);
        error.code = 'SLA_TIMEOUT';
        error.requestId = requestId;
        error.timeoutMs = timeout;
        this.logger.warn(`SLA timeout for ${requestId} (${timeout}ms)`);
        if (options.onTimeout) {
          try { options.onTimeout(error); } catch (e) { this.logger.error(`onTimeout callback error: ${e.message}`); }
        }
        throw error;
      }
      throw err;
    }
  }

  /**
   * Cancel a pending request (without timeout penalty).
   */
  cancel(requestId) {
    const entry = this._activeTimers.get(requestId);
    if (entry) {
      clearTimeout(entry.timer);
      this._activeTimers.delete(requestId);
      this.logger.info(`Cancelled SLA timer for ${requestId}`);
      return true;
    }
    return false;
  }

  /**
   * Get active request count.
   */
  getActiveCount() {
    return this._activeTimers.size;
  }

  /**
   * Get info about an active request.
   */
  getActive(requestId) {
    const entry = this._activeTimers.get(requestId);
    if (!entry) return null;
    return {
      requestId,
      elapsed: Date.now() - entry.startedAt,
      timeout: entry.timeout,
      remaining: Math.max(0, entry.timeout - (Date.now() - entry.startedAt)),
    };
  }

  _updateAvgDuration(duration) {
    if (this._stats.avgDurationMs === 0) {
      this._stats.avgDurationMs = duration;
    } else {
      this._stats.avgDurationMs = this._stats.avgDurationMs * 0.9 + duration * 0.1;
    }
  }

  getStats() {
    return {
      enabled: this.enabled,
      activeRequests: this._activeTimers.size,
      totalRequests: this._stats.totalRequests,
      timeouts: this._stats.timeouts,
      avgDurationMs: Math.round(this._stats.avgDurationMs),
      slaBreaches: this._stats.slaBreaches,
      timeoutRate: this._stats.totalRequests > 0
        ? Math.round((this._stats.timeouts / this._stats.totalRequests) * 100) / 100
        : 0,
      levels: this.levels,
    };
  }
}
