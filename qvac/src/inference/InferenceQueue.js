import { Logger } from '../core/Logger.js';
import PQueue from 'p-queue';
import pTimeout from 'p-timeout';

/**
 * InferenceQueue — serializes inference requests through a single promise chain.
 *
 * Uses p-queue (MIT) for concurrency control. A single loaded model can only
 * run one completion at a time, so requests queue instead of colliding.
 * This prevents GPU/CPU contention and ensures predictable latency.
 */
export class InferenceQueue {
  constructor(config = {}) {
    this.logger = new Logger('InferenceQueue');
    this.maxConcurrent = config.maxConcurrent || 1;
    this._queue = new PQueue({ concurrency: this.maxConcurrent });
    this._totalQueued = 0;
    this._totalCompleted = 0;
  }

  /**
   * Enqueue a function for serialized execution.
   * Returns a promise that resolves with the function's result.
   */
  enqueue(fn) {
    this._totalQueued++;
    return this._queue.add(fn).then(
      (result) => {
        this._totalCompleted++;
        return result;
      },
      (err) => {
        this._totalCompleted++;
        throw err;
      }
    );
  }

  /**
   * Enqueue with a timeout. Rejects if the function doesn't complete in time.
   */
  enqueueWithTimeout(fn, timeoutMs = 300000) {
    return this.enqueue(() => pTimeout(fn(), { milliseconds: timeoutMs }));
  }

  /**
   * Get current queue statistics.
   */
  getStats() {
    return {
      activeCount: this._queue.pending,
      currentDepth: this._queue.size,
      maxDepth: this._queue.size,
      totalQueued: this._totalQueued,
      totalCompleted: this._totalCompleted,
      maxConcurrent: this.maxConcurrent,
    };
  }

  reset() {
    this._queue.clear();
  }
}
