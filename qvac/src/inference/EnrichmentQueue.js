import PQueue from 'p-queue';

export class EnrichmentQueue {
  constructor(config = {}) {
    this.config = config;
    this.queue = new PQueue({
      concurrency: config.concurrency || 3,
      timeout: config.timeout || 30000,
    });
    this.started = false;
  }

  async initialize() {}
  async start() { this.started = true; }
  async stop() {
    this.queue.pause();
    this.started = false;
  }

  add(fn, options = {}) {
    return this.queue.add(fn, options);
  }

  addAll(fns, options = {}) {
    return this.queue.addAll(fns, options);
  }

  onIdle() {
    return this.queue.onIdle();
  }

  clear() {
    this.queue.clear();
  }

  getStats() {
    return {
      started: this.started,
      pending: this.queue.pending,
      size: this.queue.size,
      concurrency: this.queue.concurrency,
    };
  }
}
