const INJECTION_PATTERNS = [
  /\b(ignore|forget|disregard|override)\s+(all|previous|prior|the)\b/i,
  /\b(system|developer|admin)\s+(prompt|instruction|message)\b/i,
  /\b(new|updated)\s+instructions?\b/i,
  /\b(you\s+are\s+now|act\s+as\s+if|pretend\s+you\s+are)\b/i,
  /\b(reveal|show|print|output)\s+(your|the)\s+(system|initial|original)\b/i,
  /\b(DAN|jailbreak|bypass|unrestricted)\s+mode\b/i,
];

export class PromptGuard {
  constructor(config = {}) {
    this.config = config;
    this.threshold = config.threshold || 0.5;
    this.started = false;
    this.blocked = 0;
  }

  async initialize() {}
  async start() { this.started = true; }
  async stop() { this.started = false; }

  detectInjection(input) {
    const text = typeof input === 'string' ? input : input.content || input.text || '';
    let score = 0;
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(text)) score += 0.3;
    }
    score = Math.min(1, score);
    const injectionDetected = score >= this.threshold;
    if (injectionDetected) this.blocked++;
    return { injectionDetected, score };
  }

  async isSafe(input) {
    const result = this.detectInjection(input);
    return !result.injectionDetected;
  }

  buildSafePrompt({ systemPrompt, documents = [], userQuery, history = [] }) {
    const fence = '\n---UNTRUSTED---\n';
    const fencedDocs = documents.map(d => `${fence}${typeof d === 'string' ? d : d.content || ''}${fence}`).join('\n');
    const builtHistory = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: `${fencedDocs}\n\nQuery: ${userQuery}` },
    ];
    const injectionSuspected = /\b(ignore|forget|disregard|override|system prompt|new instructions)\b/i.test(userQuery);
    if (injectionSuspected) this.blocked++;
    return { history: builtHistory, injectionSuspected };
  }

  getStats() {
    return { started: this.started, blocked: this.blocked };
  }
}
