export class ConversationBrancher {
  constructor(config = {}) {
    this.config = config;
    this.branches = new Map();
    this.started = false;
  }

  async initialize() {}
  async start() { this.started = true; }
  async stop() { this.started = false; }

  createBranch(parentId, branchId, messages = []) {
    this.branches.set(branchId, { parentId, messages: [...messages] });
    return branchId;
  }

  addMessage(branchId, message) {
    if (!this.branches.has(branchId)) {
      this.branches.set(branchId, { parentId: null, messages: [] });
    }
    this.branches.get(branchId).messages.push(message);
  }

  getBranch(branchId) {
    return this.branches.get(branchId);
  }

  listBranches() {
    return Array.from(this.branches.keys());
  }

  getStats() {
    return { started: this.started, branches: this.branches.size };
  }
}
