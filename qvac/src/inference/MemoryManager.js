export class MemoryManager {
  constructor(config = {}) {
    this.config = config;
    this.sessions = new Map();
    this.started = false;
  }

  async initialize() {}
  async start() { this.started = true; }
  async stop() { this.started = false; }

  getMemory(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { messages: [] });
    }
    return this.sessions.get(sessionId);
  }

  async addMessage(sessionId, role, content) {
    const memory = this.getMemory(sessionId);
    memory.messages.push({ role, content, timestamp: Date.now() });
  }

  async getHistory(sessionId) {
    const memory = this.getMemory(sessionId);
    return memory.messages;
  }

  clearSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  getStats() {
    return { started: this.started, sessions: this.sessions.size };
  }
}
