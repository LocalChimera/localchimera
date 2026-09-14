import Graph from 'graphology';

export class AutoLinker {
  constructor(config = {}) {
    this.config = config;
    this.graph = null;
    this.started = false;
  }

  initialize({ knowledgeGraph }) {
    this.graph = knowledgeGraph?.graph || null;
  }

  async start() { this.started = true; }
  async stop() { this.started = false; }

  autoLink(nodeId, content, entities = []) {
    if (!this.graph) return;
    this.graph.addNode(nodeId, { content });
    for (const entity of entities) {
      const entityId = entity.toLowerCase().replace(/\s+/g, '_');
      if (!this.graph.hasNode(entityId)) this.graph.addNode(entityId, { label: entity });
      if (!this.graph.hasEdge(nodeId, entityId)) {
        this.graph.addEdge(nodeId, entityId, { type: 'mentions' });
      }
    }
  }

  getStats() {
    return { started: this.started, hasGraph: !!this.graph };
  }
}
