export class SpendPolicy {
  constructor(config = {}) {
    this.config = config;
    this.dailyLimit = config.dailyLimit || 1000;
    this.monthlyLimit = config.monthlyLimit || 30000;
    this.dailySpend = 0;
    this.monthlySpend = 0;
    this.dailyResetAt = Date.now() + 86400000;
    this.started = false;
  }

  async initialize() {}
  async start() { this.started = true; }
  async stop() { this.started = false; }

  canSpend(amount) {
    this._maybeReset();
    return this.dailySpend + amount <= this.dailyLimit && this.monthlySpend + amount <= this.monthlyLimit;
  }

  recordSpend(amount) {
    this._maybeReset();
    this.dailySpend += amount;
    this.monthlySpend += amount;
  }

  _maybeReset() {
    if (Date.now() >= this.dailyResetAt) {
      this.dailySpend = 0;
      this.dailyResetAt = Date.now() + 86400000;
    }
  }

  getStats() {
    this._maybeReset();
    return {
      started: this.started,
      dailySpend: this.dailySpend,
      dailyLimit: this.dailyLimit,
      monthlySpend: this.monthlySpend,
      monthlyLimit: this.monthlyLimit,
    };
  }
}
