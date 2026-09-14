export class AutoTagger {
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

  async tag(text, maxTags = 5) {
    if (!this.llm) return [];
    const prompt = `Extract ${maxTags} relevant tags from this text as a JSON array:\n${text}`;
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
