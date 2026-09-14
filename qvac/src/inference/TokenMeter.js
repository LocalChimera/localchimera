import { encode } from 'gpt-tokenizer';

export class TokenMeter {
  constructor(config = {}) {
    this.config = config;
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.costPerInputToken = config.costPerInputToken || 0;
    this.costPerOutputToken = config.costPerOutputToken || 0;
    this.started = false;
  }

  async initialize() {}
  async start() { this.started = true; }
  async stop() { this.started = false; }

  countInput(text) {
    const count = encode(text).length;
    this.inputTokens += count;
    return count;
  }

  countOutput(text) {
    const count = encode(text).length;
    this.outputTokens += count;
    return count;
  }

  recordUsage(input, output) {
    this.countInput(input);
    this.countOutput(output);
  }

  meter(source, { promptTokens = 0, completionTokens = 0 } = {}) {
    const maxTokens = this.config.maxTokensPerSource || 100000;
    const currentUsage = (this.sourceUsage || {})[source] || 0;
    const newUsage = currentUsage + promptTokens + completionTokens;

    if (newUsage > maxTokens) {
      return { allowed: false, reason: `Token budget exceeded for ${source}: ${newUsage} > ${maxTokens}` };
    }

    if (!this.sourceUsage) this.sourceUsage = {};
    this.sourceUsage[source] = newUsage;

    if (promptTokens > 0) this.inputTokens += promptTokens;
    if (completionTokens > 0) this.outputTokens += completionTokens;

    return { allowed: true, usage: newUsage };
  }

  getTotalCost() {
    return this.inputTokens * this.costPerInputToken + this.outputTokens * this.costPerOutputToken;
  }

  reset() {
    this.inputTokens = 0;
    this.outputTokens = 0;
  }

  getStatus() {
    return {
      started: this.started,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalCost: this.getTotalCost(),
    };
  }
}
