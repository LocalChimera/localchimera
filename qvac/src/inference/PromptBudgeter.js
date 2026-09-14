import { encode } from 'gpt-tokenizer';

export class PromptBudgeter {
  constructor(config = {}) {
    this.config = config;
    this.maxTokens = config.maxTokens || 4096;
    this.reserveTokens = config.reserveTokens || 512;
    this.started = false;
  }

  async initialize() {}
  async start() { this.started = true; }
  async stop() { this.started = false; }

  countTokens(text) {
    return encode(text).length;
  }

  getAvailableBudget(context = []) {
    const used = context.reduce((sum, msg) => sum + this.countTokens(msg.content || msg.text || ''), 0);
    return Math.max(0, this.maxTokens - this.reserveTokens - used);
  }

  truncate(text, maxTokens) {
    const tokens = encode(text);
    if (tokens.length <= maxTokens) return text;
    return tokens.slice(0, maxTokens).map(t => String.fromCharCode(t)).join('');
  }

  build({ systemPrompt, documents = [], history = [], userQuery }) {
    const systemTokens = this.countTokens(systemPrompt);
    const queryTokens = this.countTokens(userQuery);
    let budget = this.maxTokens - this.reserveTokens - systemTokens - queryTokens;

    const builtHistory = [{ role: 'system', content: systemPrompt }];

    for (const msg of history) {
      const msgTokens = this.countTokens(msg.content || '');
      if (budget - msgTokens < 0) break;
      builtHistory.push(msg);
      budget -= msgTokens;
    }

    for (const doc of documents) {
      const text = typeof doc === 'string' ? doc : doc.content || '';
      const docTokens = this.countTokens(text);
      if (budget - docTokens < 0) {
        const truncated = this.truncate(text, Math.max(0, budget));
        if (truncated) builtHistory.push({ role: 'system', content: truncated });
        break;
      }
      builtHistory.push({ role: 'system', content: text });
      budget -= docTokens;
    }

    builtHistory.push({ role: 'user', content: userQuery });
    return { history: builtHistory };
  }

  getStatus() {
    return { started: this.started, maxTokens: this.maxTokens, reserveTokens: this.reserveTokens };
  }
}
