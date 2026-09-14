export class CapabilityProber {
  constructor(config = {}) {
    this.config = config;
    this.capabilities = new Map();
    this.started = false;
  }

  async initialize() {}
  async start() { this.started = true; }
  async stop() { this.started = false; }

  async probe(endpoint) {
    try {
      const url = new URL('/.well-known/capabilities', endpoint);
      const res = await fetch(url.toString());
      if (!res.ok) return null;
      const caps = await res.json();
      this.capabilities.set(endpoint, caps);
      return caps;
    } catch {
      return null;
    }
  }

  getCapabilities(endpoint) {
    return this.capabilities.get(endpoint);
  }

  listProbed() {
    return Array.from(this.capabilities.keys());
  }

  getStats() {
    return { started: this.started, probed: this.capabilities.size };
  }
}
