import Graph from 'graphology';

export class CitationRegistry {
  constructor(config = {}) {
    this.config = config;
    this.graph = new Graph({ multi: true, type: 'directed' });
    this.counter = 0;
    this.started = false;
  }

  async initialize() {}
  async start() { this.started = true; }
  async stop() { this.started = false; }

  register(source, target, metadata = {}) {
    const citationId = `cite-${++this.counter}`;
    if (!this.graph.hasNode(source)) this.graph.addNode(source, { type: 'source' });
    if (!this.graph.hasNode(target)) this.graph.addNode(target, { type: 'target' });
    this.graph.addEdge(source, target, { id: citationId, ...metadata });
    return citationId;
  }

  getCitations(source) {
    if (!this.graph.hasNode(source)) return [];
    return this.graph.outEdges(source).map(eid => {
      const edge = this.graph.getEdgeAttributes(eid);
      const target = this.graph.target(eid);
      return { id: eid, source, target, ...edge };
    });
  }

  getStats() {
    return { started: this.started, citations: this.counter };
  }
}
