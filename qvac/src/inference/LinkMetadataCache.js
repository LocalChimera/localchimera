import { LRUCache } from 'lru-cache';

export class LinkMetadataCache {
  constructor(config = {}) {
    this.config = config;
    this.cache = new LRUCache({
      max: config.maxEntries || 1000,
      ttl: config.ttl || 1000 * 60 * 60 * 24,
    });
    this.started = false;
  }

  async initialize() {}
  async start() { this.started = true; }
  async stop() {
    this.cache.clear();
    this.started = false;
  }

  async fetch(url) {
    const cached = this.cache.get(url);
    if (cached) return cached;

    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Chimera/1.0' } });
      const html = await res.text();
      const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || url;
      const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] || '';
      const metadata = { url, title, description, fetchedAt: Date.now() };
      this.cache.set(url, metadata);
      return metadata;
    } catch {
      return { url, title: url, description: '', fetchedAt: Date.now() };
    }
  }

  get(url) {
    return this.cache.get(url);
  }

  getStats() {
    return {
      started: this.started,
      size: this.cache.size,
    };
  }
}
