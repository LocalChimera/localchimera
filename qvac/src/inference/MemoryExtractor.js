export class MemoryExtractor {
  constructor(config = {}) {
    this.config = config;
    this.llm = null;
    this.started = false;
  }

  initialize({ llm }) {
    this.llm = llm;
  }

  async start() { this.started = true; }
  async stop() { this.started = false; }

  async extract(conversation) {
    if (!this.llm) return [];
    const prompt = `Extract key facts/memories from this conversation as a JSON array of {type, content, importance}:\n${JSON.stringify(conversation).slice(0, 4000)}`;
    const result = await this.llm.invoke(prompt);
    try {
      return JSON.parse(result.content || result);
    } catch {
      return [];
    }
  }

  getStats() {
    return { started: this.started, hasLLM: !!this.llm };
  }
}
