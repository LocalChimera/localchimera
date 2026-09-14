import { LRUCache } from 'lru-cache';

export class ToolResultCache {
  constructor(config = {}) {
    this.config = config;
    this.cache = new LRUCache({
      max: config.maxEntries || 500,
      ttl: config.ttl || 1000 * 60 * 30,
    });
    this.started = false;
  }

  async initialize() {}
  async start() { this.started = true; }
  async stop() {
    this.cache.clear();
    this.started = false;
  }

  get(key) {
    return this.cache.get(key);
  }

  set(key, value) {
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  clear() {
    this.cache.clear();
  }

  getStats() {
    return {
      started: this.started,
      size: this.cache.size,
      max: this.cache.max,
    };
  }
}
