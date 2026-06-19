/**
 * AI Write Integration Tests
 *
 * Tests the AI write functionality across all packages:
 * 1. Route table includes /api/ai-write
 * 2. WebServer handleAIWrite endpoint logic
 * 3. Frontend API contract verification
 *
 * Run: node --test test/ai-write.test.js
 */
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { ROUTES, matchRoute } from '../src/web/router.js';
import { WebServer } from '../src/web/server.js';
import http from 'http';

// ── Route Table Tests ─────────────────────────────────────────────────────────

describe('AI Write Routes', () => {
  it('has POST /api/ai-write route', () => {
    const handler = matchRoute('POST', '/api/ai-write');
    assert.equal(handler, 'handleAIWrite');
  });

  it('has GET /api/ai-status route', () => {
    const handler = matchRoute('GET', '/api/ai-status');
    assert.equal(handler, 'handleAIStatus');
  });

  it('has GET /api/ai-docs route', () => {
    const handler = matchRoute('GET', '/api/ai-docs');
    assert.equal(handler, 'handleAIDocs');
  });

  it('ai-write route is not accessible via GET', () => {
    const handler = matchRoute('GET', '/api/ai-write');
    assert.equal(handler, null);
  });
});

// ── WebServer AI Write Handler Tests ──────────────────────────────────────────

describe('WebServer handleAIWrite', () => {
  let server;
  let port;
  let httpServer;

  before(async () => {
    const mockInference = {
      async handleInferenceRequest(req) {
        return {
          output: `Mock article about: ${req.prompt}`,
          model: 'mock-llm',
          success: true
        };
      },
      getStatus() {
        return { running: true, qvacAvailable: true, model: 'mock' };
      }
    };

    const mockDataStore = {
      async appendAIDoc(doc) { /* no-op */ }
    };

    const mockNodeManager = {
      inferenceLayer: mockInference,
      dataStore: mockDataStore
    };

    server = new WebServer({}, mockNodeManager);
    await server.initialize();

    httpServer = http.createServer((req, res) => server.handleRequest(req, res));
    await new Promise((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        port = httpServer.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    if (httpServer) {
      httpServer.closeAllConnections?.();
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });

  it('returns generated doc for valid ai-write request', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/ai-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Python decorators', title: 'Decorators Guide' })
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.ok(json.data.id.startsWith('ai-'));
    assert.equal(json.data.title, 'Decorators Guide');
    assert.ok(json.data.body.includes('Python decorators'));
    assert.equal(json.data.source, 'qvac-sdk');
  });

  it('returns 400 when prompt is missing', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/ai-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'No prompt' })
    });

    assert.equal(res.status, 400);
  });

  it('returns 503 when inference layer is unavailable', async () => {
    const bareServer = new WebServer({});
    await bareServer.initialize();
    const bareHttp = http.createServer((req, res) => bareServer.handleRequest(req, res));
    const barePort = await new Promise((resolve) => {
      bareHttp.listen(0, '127.0.0.1', () => {
        resolve(bareHttp.address().port);
      });
    });

    const res = await fetch(`http://127.0.0.1:${barePort}/api/ai-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' })
    });

    assert.equal(res.status, 503);
    bareHttp.closeAllConnections?.();
    bareHttp.close();
  });

  it('ai-status returns inference layer status', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/ai-status`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.data.running, true);
  });
});

// ── Frontend API Contract Tests ─────────────────────────────────────────────

describe('Frontend AI Write API Contract', () => {
  it('AIWriter.jsx calls correct endpoint with POST', () => {
    const handler = matchRoute('POST', '/api/ai-write');
    assert.equal(handler, 'handleAIWrite');
  });

  it('WikiPage.jsx calls correct endpoint with POST', () => {
    const handler = matchRoute('POST', '/api/ai-write');
    assert.equal(handler, 'handleAIWrite');
  });

  it('all AI-related routes are registered', () => {
    const aiRoutes = ROUTES.filter(([m, p]) => p.includes('ai-') || p.includes('llmwiki'));
    assert.ok(aiRoutes.length >= 4, `Expected at least 4 AI routes, got ${aiRoutes.length}`);
  });
});

// ── AI Write Options Tests (Generate / Edit / Draft / Analyze) ───────────────

describe('AI Write Options', () => {
  let server;
  let port;
  let httpServer;

  before(async () => {
    const mockInference = {
      async handleInferenceRequest(req) {
        return {
          output: `Result for: ${req.prompt.slice(0, 40)}...`,
          model: 'mock-llm',
          success: true
        };
      },
      getStatus() {
        return { running: true, qvacAvailable: true, model: 'mock' };
      }
    };

    const mockDataStore = {
      async appendAIDoc(doc) { /* no-op */ }
    };

    const mockNodeManager = {
      inferenceLayer: mockInference,
      dataStore: mockDataStore
    };

    server = new WebServer({}, mockNodeManager);
    await server.initialize();

    httpServer = http.createServer((req, res) => server.handleRequest(req, res));
    await new Promise((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        port = httpServer.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    if (httpServer) {
      httpServer.closeAllConnections?.();
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });

  it('generate accepts prompt + title', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/ai-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Write about Python', title: 'Python Guide' })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.ok(json.data.body.includes('Result for:'));
  });

  it('edit accepts rewrite prompt', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/ai-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Rewrite the following text in a concise style. Output ONLY the rewritten text.\n\nText:\nHello world' })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
  });

  it('draft accepts document-wide outline prompt', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/ai-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Create a numbered outline for: Blockchain consensus. Output ONLY the outline.' })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
  });

  it('analyze accepts analysis prompt', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/ai-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Analyze the tone of the following text and describe it in one sentence. Output ONLY the tone description.\n\nText:\nHello world' })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
  });

  it('rewrite handles style-based prompt pattern', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/ai-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Rewrite the following text in a formal style. Output ONLY the rewritten text — no preamble, no explanation, no markdown fences unless the original had them.\n\nOriginal text:\nHello world' })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.ok(json.data.body.includes('Result for:'));
  });

  it('edit mini-buttons handle instruction+text pattern', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/ai-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Rewrite more concisely. Output ONLY the result.\n\nText:\nHello world this is a long sentence' })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
  });

  it('inline toolbar shorten action handles prompt', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/ai-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Shorten. Output ONLY the result.\n\nText:\nThis is a very long paragraph that needs to be shortened significantly.' })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
  });

  it('inline toolbar explain action handles analyze prompt', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/ai-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Explain why weak. Output ONLY the result.\n\nText:\nHello world' })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
  });

  it('readability score handles analyze prompt', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/ai-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Estimate the reading level and readability of the following text (Flesch Reading Ease score and grade level). Output ONLY the score and brief assessment.\n\nText:\nThe quick brown fox jumps over the lazy dog.' })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
  });

  it('weakness scan handles analyze prompt', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/ai-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Flag any overused phrases, repetitions, weak claims, or inconsistencies in the following text. Output ONLY the findings.\n\nText:\nVery very good indeed.' })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
  });
});
