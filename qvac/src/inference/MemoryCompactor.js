export class MemoryCompactor {
  constructor(config = {}) {
    this.config = config;
    this.llm = null;
    this.maxMessages = config.maxMessages || 50;
    this.started = false;
  }

  initialize({ llm }) {
    this.llm = llm;
  }

  async start() { this.started = true; }
  async stop() { this.started = false; }

  async compact(messages) {
    if (messages.length <= this.maxMessages) return messages;
    if (!this.llm) return messages.slice(-this.maxMessages);
    const toCompact = messages.slice(0, messages.length - this.maxMessages);
    const toKeep = messages.slice(-this.maxMessages);
    const prompt = `Summarize this conversation history concisely:\n${JSON.stringify(toCompact).slice(0, 4000)}`;
    const result = await this.llm.invoke(prompt);
    const summary = { role: 'system', content: `Conversation summary: ${result.content || result}` };
    return [summary, ...toKeep];
  }

  getStats() {
    return { started: this.started, maxMessages: this.maxMessages, hasLLM: !!this.llm };
  }
}
