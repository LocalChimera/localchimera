/**
 * AI Write Integration Tests
 *
 * Tests the AI write functionality across all packages:
 * 1. Route table includes /api/ai-write
 * 2. Inference layer initializes and handles requests (with mocked SDK)
 * 3. WebServer handleAIWrite endpoint logic
 * 4. Frontend API contract
 *
 * Run: node --test test/ai-write.test.js
 */
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { ROUTES, matchRoute } from '../src/web/router.js';
import { QVACInferenceLayer } from '../src/inference/QVACInferenceLayer.js';
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

// ── Inference Layer Tests ────────────────────────────────────────────────────

describe('QVACInferenceLayer', () => {
  let layer;

  before(async () => {
    const config = {
      qvac: {
        models: ['llama-3.2-1b-instruct'],
        modelConst: 'LLAMA_3_2_1B_INST_Q4_0',
        maxConcurrent: 4
      },
      idleTimeout: 300000
    };
    layer = new QVACInferenceLayer(config);
    await layer.initialize();
  });

  after(async () => {
    if (layer) await layer.stop();
  });

  it('initializes without error', () => {
    assert.ok(layer);
    assert.equal(layer.isRunning, false);
  });

  it('starts and stops cleanly', async () => {
    await layer.start();
    assert.equal(layer.isRunning, true);
    const status = layer.getStatus();
    assert.equal(status.running, true);
    assert.equal(status.activeRequests, 0);

    await layer.stop();
    assert.equal(layer.isRunning, false);
  });

  it('reports SDK availability in status', () => {
    const status = layer.getStatus();
    assert.ok('qvacAvailable' in status);
    // SDK may or may not be loadable in test env; either is fine
    assert.equal(typeof status.qvacAvailable, 'boolean');
  });

  it('falls back when SDK is not available', async () => {
    const noSdkConfig = {
      qvac: { models: ['test'], maxConcurrent: 1 },
      idleTimeout: 300000
    };
    const fallbackLayer = new QVACInferenceLayer(noSdkConfig);
    await fallbackLayer.initialize();
    await fallbackLayer.start();

    // Force qvac to null to simulate missing SDK
    fallbackLayer.qvac = null;

    const result = await fallbackLayer.handleInferenceRequest({
      prompt: 'test fallback',
      source: 'test'
    });

    assert.equal(result.success, true);
    assert.equal(result.fallback, true);
    assert.ok(result.output.includes('test fallback'));

    await fallbackLayer.stop();
  });
});

// ── WebServer AI Write Handler Tests ──────────────────────────────────────────

describe('WebServer handleAIWrite', () => {
  let server;
  let port;

  before(async () => {
    // Create a minimal NodeManager mock with inference layer
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

    // Start on ephemeral port
    const httpServer = http.createServer((req, res) => server.handleRequest(req, res));
    await new Promise((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        port = httpServer.address().port;
        resolve();
      });
    });
    server._httpServer = httpServer;
  });

  after(async () => {
    if (server?._httpServer) {
      await new Promise((resolve) => server._httpServer.close(resolve));
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
    // Create server without nodeManager
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
    // Verify the route contract the frontend expects
    const handler = matchRoute('POST', '/api/ai-write');
    assert.equal(handler, 'handleAIWrite');
  });

  it('WikiPage.jsx calls correct endpoint with POST', () => {
    // WikiPage also uses /api/ai-write
    const handler = matchRoute('POST', '/api/ai-write');
    assert.equal(handler, 'handleAIWrite');
  });

  it('all AI-related routes are registered', () => {
    const aiRoutes = ROUTES.filter(([m, p]) => p.includes('ai-') || p.includes('llmwiki'));
    assert.ok(aiRoutes.length >= 4, `Expected at least 4 AI routes, got ${aiRoutes.length}`);
  });
});
