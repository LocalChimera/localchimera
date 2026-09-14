export class ConfidenceRouter {
  constructor(config = {}) {
    this.config = config;
    this.threshold = config.threshold || 0.7;
    this.started = false;
  }

  async initialize() {}
  async start() { this.started = true; }
  async stop() { this.started = false; }

  route(responses) {
    const scored = responses.map(r => ({
      ...r,
      confidence: r.confidence ?? this._score(r),
    }));
    scored.sort((a, b) => b.confidence - a.confidence);
    if (scored[0]?.confidence >= this.threshold) return scored[0];
    return scored;
  }

  _score(response) {
    const text = typeof response === 'string' ? response : response.content || response.text || '';
    const hasHedge = /\b(maybe|perhaps|might|possibly|unsure|not certain)\b/i.test(text);
    const hasDefinite = /\b(definitely|certainly|absolutely|clearly)\b/i.test(text);
    let score = 0.5;
    if (hasDefinite) score += 0.2;
    if (hasHedge) score -= 0.2;
    return Math.max(0, Math.min(1, score));
  }

  getStats() {
    return { started: this.started, threshold: this.threshold };
  }
}
