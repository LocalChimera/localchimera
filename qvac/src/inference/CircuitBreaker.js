import { Logger } from '../core/Logger.js';
import CircuitBreaker from 'opossum';

/**
 * CircuitBreaker — protects inference routing from repeat failures.
 *
 * Uses opossum (MIT) for circuit breaker pattern. If a device/peer/miner
 * fails N times consecutively, the circuit "trips" and stops routing to
 * it for a cooldown period. After cooldown, a half-open probe is sent.
 *
 * States: CLOSED → OPEN → HALF_OPEN → CLOSED
 */

const STATES = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open',
};

const STATE_MAP = {
  0: STATES.CLOSED,
  1: STATES.OPEN,
  2: STATES.HALF_OPEN,
};

export class CircuitBreakerManager {
  constructor(config = {}) {
    this.logger = new Logger('CircuitBreaker');
    this.failureThreshold = config.failureThreshold || 3;
    this.cooldownMs = config.cooldownMs || 60000;
    this.halfOpenMaxCalls = config.halfOpenMaxCalls || 1;
    this._circuits = new Map();
    this.enabled = config.enabled !== false;
  }

  _getOrCreate(targetId) {
    if (!this._circuits.has(targetId)) {
      const breaker = new CircuitBreaker(async (fn) => fn(), {
        timeout: false,
        errorThresholdPercentage: 100,
        resetTimeout: this.cooldownMs,
        rollingCountTimeout: this.cooldownMs * 5,
        volumeThreshold: this.failureThreshold,
        capacity: this.halfOpenMaxCalls,
        enabled: this.enabled,
      });

      const circuit = {
        targetId,
        breaker,
        consecutiveFailures: 0,
        lastFailureTime: null,
        totalTrips: 0,
        totalRejected: 0,
      };
      this._circuits.set(targetId, circuit);
    }
    return this._circuits.get(targetId);
  }

  canRequest(targetId) {
    if (!this.enabled) return { allowed: true, state: STATES.CLOSED };
    const circuit = this._getOrCreate(targetId);
    const state = STATE_MAP[circuit.breaker.status] || STATES.CLOSED;

    if (circuit.breaker.opened) {
      circuit.totalRejected++;
      return { allowed: false, state: STATES.OPEN, reason: `Circuit open` };
    }

    return { allowed: true, state };
  }

  async execute(targetId, fn) {
    if (!this.enabled) return fn();
    const circuit = this._getOrCreate(targetId);
    try {
      const result = await circuit.breaker.fire(fn);
      this.recordSuccess(targetId);
      return result;
    } catch (err) {
      this.recordFailure(targetId, err.message);
      throw err;
    }
  }

  recordSuccess(targetId) {
    if (!this.enabled) return;
    const circuit = this._getOrCreate(targetId);
    if (circuit.consecutiveFailures > 0) {
      this.logger.info(`Circuit ${targetId} → CLOSED (recovered)`);
    }
    circuit.consecutiveFailures = 0;
  }

  recordFailure(targetId, reason = '') {
    if (!this.enabled) return;
    const circuit = this._getOrCreate(targetId);
    circuit.consecutiveFailures++;
    circuit.lastFailureTime = Date.now();

    if (circuit.breaker.opened) {
      circuit.totalTrips++;
      this.logger.warn(`Circuit ${targetId} → OPEN (${reason}, cooldown: ${this.cooldownMs / 1000}s)`);
    }
  }

  reset(targetId) {
    const circuit = this._circuits.get(targetId);
    if (circuit) {
      circuit.breaker.close();
      circuit.consecutiveFailures = 0;
      this.logger.info(`Circuit ${targetId} manually reset → CLOSED`);
    }
  }

  resetAll() {
    for (const circuit of this._circuits.values()) {
      circuit.breaker.close();
      circuit.consecutiveFailures = 0;
    }
    this.logger.info('All circuits reset → CLOSED');
  }

  getCircuit(targetId) {
    return this._circuits.get(targetId) || null;
  }

  getAllCircuits() {
    return Array.from(this._circuits.values());
  }

  getStatus() {
    const circuits = Array.from(this._circuits.values());
    return {
      enabled: this.enabled,
      totalCircuits: circuits.length,
      closed: circuits.filter(c => !c.breaker.opened).length,
      open: circuits.filter(c => c.breaker.opened).length,
      halfOpen: 0,
      totalTrips: circuits.reduce((s, c) => s + c.totalTrips, 0),
      totalRejected: circuits.reduce((s, c) => s + c.totalRejected, 0),
      failureThreshold: this.failureThreshold,
      cooldownMs: this.cooldownMs,
    };
  }
}

export { STATES as CIRCUIT_STATES };
