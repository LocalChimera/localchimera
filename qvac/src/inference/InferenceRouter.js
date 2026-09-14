export class InferenceRouter {
  constructor(config = {}) {
    this.config = config;
    this.routes = new Map();
    this.defaultRoute = null;
    this.started = false;
  }

  async initialize() {}
  async start() { this.started = true; }
  async stop() { this.started = false; }

  register(condition, handler) {
    this.routes.set(condition, handler);
  }

  setDefault(handler) {
    this.defaultRoute = handler;
  }

  async route(input, context = {}) {
    for (const [condition, handler] of this.routes) {
      if (typeof condition === 'function' && condition(input, context)) {
        return handler(input, context);
      }
      if (typeof condition === 'string' && input.toLowerCase().includes(condition.toLowerCase())) {
        return handler(input, context);
      }
    }
    if (this.defaultRoute) return this.defaultRoute(input, context);
    return { error: 'No matching route', input };
  }

  getStats() {
    return { started: this.started, routes: this.routes.size, hasDefault: !!this.defaultRoute };
  }
}
