import { Logger } from '../core/Logger.js';
import { createServer } from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { MarkdownIndexer } from '../llmwiki/MarkdownIndexer.js';
import { NodeOrchestrator } from '../orchestrator/NodeOrchestrator.js';
import { matchRoute } from './router.js';
import { ok, accepted, badRequest, serverError, serviceUnavailable, parseBody } from './reply.js';
import { extractBoundary, readBody, parseMultipart } from './multipart.js';
import { repoToMarkdown } from './repoDigest.js';
import { PayoutRouter } from '../payout/PayoutRouter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve built React frontend from project root
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'frontend', 'dist');

export class WebServer {
  constructor(config, nodeManager = null) {
    this.config = config;
    this.nodeManager = nodeManager;
    this.logger = new Logger('WebServer');
    this.server = null;
    this.port = process.env.PORT || 3002;
    this.indexer = new MarkdownIndexer();
    this.orchestrator = new NodeOrchestrator();
    this.payoutRouter = new PayoutRouter();
  }

  async initialize() {
    this.logger.info('Initializing web server...');
    try {
      await this.indexer.index();
    } catch (e) {
      this.logger.warn(`Initial llmwiki index failed: ${e.message}`);
    }
    // Create default welcome page if wiki is empty
    await this.ensureDefaultWelcomePage();
    this.logger.info('Web server initialized');
    await this.payoutRouter.store._ensureDir();
  }

  async ensureDefaultWelcomePage() {
    try {
      const wikiDir = path.join(process.cwd(), 'llmwiki-data', 'wiki', 'concepts');
      const welcomePath = path.join(wikiDir, 'welcome-to-chimera.md');
      try { await fs.access(welcomePath); return; } catch {}
      await fs.mkdir(wikiDir, { recursive: true });
      const content = `---
title: Welcome to Chimera
description: Getting started with your distributed AI wiki
date: ${new Date().toISOString().split('T')[0]}
tags: ["welcome","chimera","getting-started"]
---

# Welcome to Chimera

**Chimera** is a distributed AI wiki powered by QVAC, Hypercore, and Pear P2P.

## What you can do here

- **Generate** — Use AI to write wiki pages from prompts
- **Edit** — Rewrite, improve, or expand existing content
- **Draft** — Create structured outlines before writing
- **Analyze** — Check tone, readability, and weaknesses
- **Ingest** — Drag and drop PDFs, links, and files to convert to markdown
- **Auto** — Enable continuous AI research on a topic

## P2P Sharing

Create scoped swarms to collaborate:
- **Wiki Swarm** — Share your entire wiki with peers
- **Page Swarm** — Share only a specific page

Copy the topic hex and invite others to join.

## Getting Started

1. Click **+ New Page** or use the **Generate** tab in the AI panel
2. Write with AI assistance, save your work
3. Share via Hyperswarm P2P with your team

---

*Built with QVAC inference, Hypercore storage, and Pear P2P mesh networking.*
`;
      await fs.writeFile(welcomePath, content, 'utf-8');
      this.logger.info(`Created default welcome page: ${welcomePath}`);
      await this.indexer.index();
    } catch (e) {
      this.logger.warn(`Failed to create welcome page: ${e.message}`);
    }
  }
  
  async start() {
    this.logger.info('Starting web server...');
    
    this.server = createServer(async (req, res) => {
      // CORS for all responses
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      await this.handleRequest(req, res);
    });

    // Increase server timeout for long AI generation (10 min)
    this.server.timeout = 600000;
    this.server.keepAliveTimeout = 620000;
    
    this.server.listen(this.port, () => {
      this.logger.info(`Web server listening on port ${this.port}`);
    });
  }
  
  async stop() {
    this.logger.info('Stopping web server...');
    
    if (this.server) {
      this.server.close();
    }
    
    if (this.relay) {
      await this.relay.stop();
      this.logger.info('Relay server stopped');
    }
    
    this.logger.info('Web server stopped');
  }
  
  async handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    this.logger.debug(`${req.method} ${url.pathname}`);

    const handlerName = matchRoute(req.method, url.pathname);
    if (handlerName) {
      try {
        await this[handlerName](req, res);
      } catch (error) {
        this.logger.error(`${handlerName} threw:`, error);
        serverError(res, error);
      }
      return;
    }

    await this.serveStatic(res, url.pathname);
  }

  async serveStatic(res, pathname) {
    try {
      let filePath;
      let contentType = 'application/octet-stream';

      if (pathname === '/' || pathname === '/index.html') {
        filePath = path.join(PUBLIC_DIR, 'index.html');
        contentType = 'text/html';
      } else if (pathname.startsWith('/assets/')) {
        filePath = path.join(PUBLIC_DIR, pathname);
        try {
          await fs.access(filePath);
        } catch {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }
        if (pathname.endsWith('.js')) contentType = 'application/javascript';
        else if (pathname.endsWith('.css')) contentType = 'text/css';
      } else {
        // Try to serve other files from dist, fall back to index.html for SPA routing
        filePath = path.join(PUBLIC_DIR, pathname);
        try {
          await fs.access(filePath);
          if (pathname.endsWith('.html')) contentType = 'text/html';
          else if (pathname.endsWith('.css')) contentType = 'text/css';
          else if (pathname.endsWith('.js')) contentType = 'application/javascript';
          else if (pathname.endsWith('.json')) contentType = 'application/json';
          else if (pathname.endsWith('.png')) contentType = 'image/png';
          else if (pathname.endsWith('.svg')) contentType = 'image/svg+xml';
        } catch {
          // Don't fallback for known asset extensions — return 404 so browser knows to refresh
          if (/\.(js|css|png|svg|json|woff|woff2|ttf|eot)$/i.test(pathname)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
          }
          // SPA fallback: serve index.html for unknown routes (no extension or .html)
          filePath = path.join(PUBLIC_DIR, 'index.html');
          contentType = 'text/html';
        }
      }

      const content = await fs.readFile(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch (error) {
      this.logger.error(`Error serving ${pathname}:`, error);
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }
  
  async handleConsent(req, res) {
    const body = await parseBody(req);
    const consentPath = path.join(process.cwd(), 'data', 'consent.json');
    await fs.mkdir(path.dirname(consentPath), { recursive: true });
    await fs.writeFile(consentPath, JSON.stringify({
      accepted: body.accepted,
      timestamp: Date.now(),
      userAgent: req.headers['user-agent'],
    }, null, 2));
    ok(res, { accepted: body.accepted });
  }
  
  async handleSignIn(req, res) {
    const body = await parseBody(req);
    ok(res, { method: body.method || 'email', email: body.email, timestamp: Date.now() });
  }
  
  async handleDownload(req, res) {
    const consentPath = path.join(process.cwd(), 'data', 'consent.json');
    try { await fs.access(consentPath); }
    catch { badRequest(res, 'Consent required'); return; }
    ok(res, { downloadUrl: '/install/qvac-chimera-installer.sh' });
  }
  
  async handleStatus(req, res) {
    if (!this.nodeManager) { serviceUnavailable(res, 'Node manager not available'); return; }
    ok(res, this.nodeManager.getStatus());
  }
  
  async handleAIWrite(req, res) {
    const body = await parseBody(req);
    const prompt = body.prompt?.trim();
    const title = body.title?.trim();
    if (!prompt) { badRequest(res, 'Prompt is required'); return; }

    // Use QVAC inference layer (@qvac/sdk) for AI writing
    const inference = this.nodeManager?.inferenceLayer;
    if (!inference) { serviceUnavailable(res, 'QVAC inference not initialized'); return; }

    this.logger.info(`AI write request: ${title || prompt}`);
    const result = await inference.handleInferenceRequest({
      prompt: `Write a wiki article${title ? ` titled "${title}"` : ''} about: ${prompt}`,
      maxTokens: 1024,
      temperature: 0.7,
      source: 'llmwiki-ai-write'
    });

    const docId = `ai-${Date.now()}`;
    const generatedTitle = title || result.output.split('\n')[0].replace(/^#\s*/, '').slice(0, 100);
    const doc = {
      id: docId,
      title: generatedTitle,
      body: result.output,
      source: 'qvac-sdk',
      model: result.model || 'llama',
      prompt,
      createdAt: Date.now()
    };

    if (this.nodeManager?.dataStore) await this.nodeManager.dataStore.appendAIDoc(doc);

    const docPath = path.join(process.cwd(), 'data', 'ai-docs', `${docId}.md`);
    await fs.mkdir(path.dirname(docPath), { recursive: true });
    await fs.writeFile(docPath, `# ${doc.title}\n\n${doc.body}\n\n<!-- source: qvac-sdk | model: ${doc.model} | prompt: ${prompt} -->\n`);

    ok(res, doc);
  }

  async handleAIStatus(req, res) {
    const inference = this.nodeManager?.inferenceLayer;
    ok(res, inference ? inference.getStatus() : { available: false });
  }

  async handleAIDocs(req, res) {
    const docsDir = path.join(process.cwd(), 'data', 'ai-docs');
    const files = [];
    try {
      const entries = await fs.readdir(docsDir);
      for (const entry of entries.filter(e => e.endsWith('.md'))) {
        const full = path.join(docsDir, entry);
        const content = await fs.readFile(full, 'utf-8');
        const titleMatch = content.match(/^#\s(.+)$/m);
        files.push({ id: entry.replace('.md', ''), title: titleMatch?.[1] ?? entry, createdAt: (await fs.stat(full)).mtime.getTime() });
      }
    } catch { /* directory may not exist */ }
    ok(res, files.sort((a, b) => b.createdAt - a.createdAt));
  }

  async handleLLMWikiCreate(req, res) {
    const body = await parseBody(req);
    const { topic = '', prompt: customPrompt = '', category = 'concepts', tags = [], description = '', links = [] } = body;
    if (!topic && !customPrompt) { badRequest(res, 'topic or prompt is required'); return; }

    const jobId = await this._spawnBridgeJob({ topic, customPrompt, category, tags, description, links });
    accepted(res, { jobId, topic: customPrompt || topic, category, status: 'started',
      message: `Wiki page generation started for category '${category}'.` });
  }

  async handleLLMWikiUpload(req, res) {
    const boundary = extractBoundary(req);
    if (!boundary) { badRequest(res, 'Missing multipart boundary'); return; }

    const data = await readBody(req);
    const parts = parseMultipart(data, boundary);
    const filePart = parts.find(p => p.filename);
    if (!filePart) { badRequest(res, 'No file uploaded'); return; }

    const fields = Object.fromEntries(parts.filter(p => !p.filename).map(p => [p.name, p.value]));
    const category = fields.category || 'concepts';
    const tags = (fields.tags || '').split(',').map(t => t.trim()).filter(Boolean);

    const sourcesDir = path.join(process.cwd(), 'llmwiki-data', 'sources');
    await fs.mkdir(sourcesDir, { recursive: true });
    const destPath = path.join(sourcesDir, filePart.filename);
    await fs.writeFile(destPath, filePart.data);

    const jobId = await this._spawnBridgeJob({
      topic: filePart.filename,
      customPrompt: 'Analyze the following document and write a comprehensive wiki page summarizing its key concepts, findings, and structure.',
      category,
      tags,
      description: fields.title || '',
      fileSource: destPath,
    });
    accepted(res, { jobId, filename: filePart.filename, category, status: 'started',
      message: `File saved. Wiki page generation started for category '${category}'.` });
  }

  async handleConvertToMd(req, res) {
    const boundary = extractBoundary(req);
    if (!boundary) { badRequest(res, 'Missing multipart boundary'); return; }

    const data = await readBody(req);
    const parts = parseMultipart(data, boundary);
    const filePart = parts.find(p => p.filename);
    if (!filePart) { badRequest(res, 'No file uploaded'); return; }

    const tmpDir = path.join(process.cwd(), 'tmp-uploads');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpPath = path.join(tmpDir, `${Date.now()}-${filePart.filename}`);
    await fs.writeFile(tmpPath, filePart.data);

    try {
      this.logger.info(`[markitdown] Converting ${filePart.filename}...`);
      const { spawn } = await import('child_process');
      const py = spawn('/usr/bin/python3', ['-c', `
from markitdown import MarkItDown
md = MarkItDown()
result = md.convert("${tmpPath.replace(/"/g, '\\"')}")
print(result.text_content)
`], { timeout: 60000 });

      let out = '', err = '';
      py.stdout.on('data', d => { out += d; });
      py.stderr.on('data', d => { err += d; });

      await new Promise((resolve, reject) => {
        py.on('close', code => {
          if (code !== 0) reject(new Error(err || 'markitdown failed'));
          else resolve();
        });
      });

      // cleanup temp file
      try { await fs.unlink(tmpPath); } catch (_) {}

      ok(res, { filename: filePart.filename, markdown: out.trim() });
    } catch (e) {
      this.logger.error(`[markitdown] Failed: ${e.message}`);
      try { await fs.unlink(tmpPath); } catch (_) {}
      serverError(res, e);
    }
  }

  async handleLLMWikiDocs(req, res) {
    await this.indexer.ensureFresh();
    ok(res, this.indexer.listDocuments());
  }

  async handleLLMWikiSearch(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const query = url.searchParams.get('q') || '';
    const tags = (url.searchParams.get('tags') || '').split(',').filter(Boolean);
    const category = url.searchParams.get('category') || '';
    await this.indexer.ensureFresh();
    ok(res, this.indexer.search(query, { tags, category }));
  }

  async handleWikiStatus(req, res) {
    const store = this.nodeManager?.dataStore;
    const p2p = this.nodeManager?.p2pNetwork;
    const llm = this.nodeManager?.localLLM;
    ok(res, {
      qvac: llm ? { available: true, ...llm.getStatus() } : { available: false },
      hypercore: store ? { available: true, ...store.getStatus() } : { available: false },
      pear: p2p ? { available: true, running: p2p.isRunning, peers: p2p.peers?.size || 0 } : { available: false },
      wikiDir: path.join(process.cwd(), 'llmwiki-data')
    });
  }

  async handleLLMWikiGraph(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const nodeId = url.searchParams.get('id') || '';
    await this.indexer.ensureFresh();
    const result = nodeId
      ? this.indexer.graph(nodeId)
      : { nodes: this.indexer.documents.length, links: this.indexer.links.length };
    ok(res, result);
  }

  async handleLLMWikiDelete(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const id = url.searchParams.get('id') || '';
    if (!id) { badRequest(res, 'id is required'); return; }
    const removed = await this.indexer.removeDocument(id);
    if (removed) ok(res, { deleted: true });
    else badRequest(res, 'Document not found');
  }

  async handleRepoToMd(req, res) {
    const body = await parseBody(req);
    const result = await repoToMarkdown(body);
    if (result.success) ok(res, result.data);
    else badRequest(res, result.error);
  }

  async handleLLMWikiSave(req, res) {
    const body = await parseBody(req);
    const { content = '', title = 'Untitled', category = 'concepts', tags = [] } = body;
    if (!content.trim()) { badRequest(res, 'content is required'); return; }

    const slug = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const fileName = `${slug || 'untitled'}.md`;
    const wikiDir = path.join(process.cwd(), 'llmwiki-data', 'wiki', category);
    const filePath = path.join(wikiDir, fileName);
    const conceptId = `${category}/${slug || 'untitled'}`;
    const today = new Date().toISOString().split('T')[0];

    const frontmatter = `---\nid: ${conceptId}\ntitle: ${title}\ndescription: AI-generated wiki page\ntags: ${JSON.stringify(tags)}\ncreated: ${today}\nmodified: ${today}\n---\n\n`;

    try {
      await fs.mkdir(wikiDir, { recursive: true });
      await fs.writeFile(filePath, frontmatter + content, 'utf-8');
      this.logger.info(`[llmwiki] Saved ${filePath}`);

      // ─── Hypercore persistence ───
      if (this.nodeManager?.dataStore) {
        const seq = await this.nodeManager.dataStore.append({
          type: 'wiki-page',
          title,
          category,
          tags,
          content: frontmatter + content,
          filePath,
          createdAt: Date.now()
        });
        this.logger.info(`[llmwiki] Hypercore append seq ${seq}`);
      }

      // ─── Pear P2P broadcast ───
      const p2p = this.nodeManager?.p2pNetwork;
      if (p2p) {
        const pageId = conceptId;
        const msg = { type: 'wiki-new-page', title, category, fileName, content: frontmatter + content, tags, timestamp: Date.now() };

        // Broadcast to wiki-wide swarms
        const wikiTopics = p2p.getTopicsByScope('wiki');
        if (wikiTopics.length > 0) {
          await p2p.broadcastToTopics(msg, { scope: 'wiki', pageId });
          this.logger.info(`[llmwiki] Broadcast to ${wikiTopics.length} wiki swarm(s): ${title}`);
        }

        // Broadcast to page-specific swarms
        const pageTopics = p2p.getTopicsByScope('page', pageId);
        if (pageTopics.length > 0) {
          await p2p.broadcastToTopics(msg, { scope: 'page', pageId });
          this.logger.info(`[llmwiki] Broadcast to ${pageTopics.length} page swarm(s): ${title}`);
        }
      }

      // Refresh index so it appears immediately
      await this.indexer.index();
      ok(res, { id: conceptId, title, path: `/${category}/${fileName}`, category, tags });
    } catch (e) {
      this.logger.error(`[llmwiki] Save failed: ${e.message}`);
      serverError(res, e);
    }
  }

  /* ─── Swarm / P2P Handlers ─── */

  async handleSwarmCreate(req, res) {
    const p2p = this.nodeManager?.p2pNetwork;
    if (!p2p) { serviceUnavailable(res, 'P2P not initialized'); return; }

    const body = await parseBody(req);
    const scope = body.scope || 'wiki'; // 'wiki' | 'page'
    const pageId = body.pageId || null;
    const pageTitle = body.pageTitle || null;

    const topic = p2p.generateTopic();
    const topicHex = await p2p.joinTopic(topic, { scope, pageId, title: pageTitle });
    const inviteUrl = `${req.headers.origin || `http://${req.headers.host}`}/api/swarm/join?topic=${topicHex}`;

    ok(res, {
      topic: topicHex,
      shortTopic: topicHex.slice(0, 16) + '...',
      scope,
      pageId,
      inviteUrl,
      message: scope === 'page'
        ? `Share the topic hex to collaborate on this page only.`
        : `Share the topic hex to sync the entire wiki.`
    });
  }

  async handleSwarmJoin(req, res) {
    const p2p = this.nodeManager?.p2pNetwork;
    if (!p2p) { serviceUnavailable(res, 'P2P not initialized'); return; }

    const body = await parseBody(req);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const topicHex = body.topic || url.searchParams.get('topic') || '';
    if (!topicHex || topicHex.length !== 64) { badRequest(res, 'Valid 64-char topic hex required'); return; }

    try {
      const joinedHex = await p2p.joinTopic(Buffer.from(topicHex, 'hex'), { scope: body.scope || 'wiki', pageId: body.pageId || null });
      ok(res, { topic: joinedHex, status: 'joined', peers: p2p.peers.size });
    } catch (e) {
      this.logger.error(`[swarm] Join failed: ${e.message}`);
      serverError(res, e);
    }
  }

  async handleSwarmStatus(req, res) {
    const p2p = this.nodeManager?.p2pNetwork;
    if (!p2p) { ok(res, { available: false }); return; }
    ok(res, {
      available: true,
      running: p2p.isRunning,
      peers: p2p.peers.size,
      topics: p2p.getTopicList()
    });
  }

  /* ─── Orchestrator Handlers ─── */

  async handleCommanderRegister(req, res) {
    const { workerUrl } = await parseBody(req);
    const result = this.orchestrator.registerWorker(workerUrl);
    ok(res, result);
  }

  async handleCommanderWorkers(req, res) {
    ok(res, this.orchestrator.getWorkers());
  }

  async handleCommanderStats(req, res) {
    ok(res, this.orchestrator.getFleetStats());
  }

  async handleCommanderJobs(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    ok(res, this.orchestrator.claimJob(url.searchParams.get('worker') || ''));
  }

  async handleCommanderComplete(req, res) {
    const { jobId, workerUrl, pagesGenerated = 1 } = await parseBody(req);
    this.orchestrator.completeJob(jobId, workerUrl, pagesGenerated);
    ok(res, { completed: jobId });
  }

  async handleCommanderDistribute(req, res) {
    const { jobs = [] } = await parseBody(req);
    const result = this.orchestrator.addJobs(jobs);
    ok(res, result);
  }

  async handleCommanderStop(req, res) {
    ok(res, this.orchestrator.stopFleet());
  }

  async handleCommanderStart(req, res) {
    ok(res, this.orchestrator.startFleet());
  }

  async handleWorkerStop(req, res) {
    this.orchestrator.receiveStop();
    ok(res, { message: 'Worker will halt after current job' });
  }

  async handleStart(req, res) {
    if (!this.nodeManager) { serviceUnavailable(res, 'Node manager not available'); return; }
    const body = await parseBody(req);
    if (!this.nodeManager.isRunning) await this.nodeManager.start();
    if (this.nodeManager.minerManager) {
      // User EVM addresses for monthly distribution
      if (body.machineOwnerEVM) {
        this.nodeManager.minerManager.machineOwnerEVM = body.machineOwnerEVM;
        this.logger.info(`[miner] Machine owner EVM: ${body.machineOwnerEVM}`);
      }
      if (body.appDeveloperEVM) {
        this.nodeManager.minerManager.appDeveloperEVM = body.appDeveloperEVM;
        this.logger.info(`[miner] App developer EVM: ${body.appDeveloperEVM}`);
      }
      if (body.revenueSplit) {
        this.nodeManager.minerManager.revenueSplit = body.revenueSplit;
        this.logger.info(`[miner] Revenue split — machine owner: ${(body.revenueSplit.machineOwner * 100).toFixed(0)}%, app developer: ${(body.revenueSplit.appDeveloper * 100).toFixed(0)}%`);
      }
    }
    ok(res, { message: 'Mining started', running: true });
  }

  async handleStop(req, res) {
    if (!this.nodeManager) { serviceUnavailable(res, 'Node manager not available'); return; }
    if (this.nodeManager.isRunning) await this.nodeManager.stop();
    ok(res, { message: 'Mining stopped', running: false });
  }

  async handleMinerTest(req, res) {
    if (!this.nodeManager?.minerManager) { serviceUnavailable(res, 'Miner manager not available'); return; }
    const mm = this.nodeManager.minerManager;
    const results = [];
    const testTask = { id: `test-${Date.now()}`, prompt: 'What is 2+2?', maxTokens: 32, temperature: 0.5 };

    for (const [name, miner] of mm.miners) {
      const started = Date.now();
      try {
        const result = await miner.onInferenceTask(testTask);
        results.push({
          miner: name,
          success: result.success,
          output: result.result?.output?.slice(0, 200) || result.output?.slice(0, 200) || null,
          latency: Date.now() - started,
          fallback: result.result?.fallback || result.fallback || false,
          error: result.error || null
        });
      } catch (err) {
        results.push({ miner: name, success: false, latency: Date.now() - started, error: err.message });
      }
    }

    const allPassed = results.every(r => r.success);
    ok(res, {
      tested: results.length,
      passed: results.filter(r => r.success).length,
      allPassed,
      task: testTask.id,
      results
    });
  }

  // ─── Payout Router ───

  async handlePayoutRegisterApp(req, res) {
    const body = await parseBody(req);
    const result = await this.payoutRouter.registerApp(body);
    if (result.success) ok(res, result);
    else badRequest(res, result.error);
  }

  async handlePayoutGetApps(req, res) {
    ok(res, await this.payoutRouter.getApps());
  }

  async handlePayoutRegisterUser(req, res) {
    const body = await parseBody(req);
    const result = await this.payoutRouter.registerUser(body);
    if (result.success) ok(res, result);
    else badRequest(res, result.error);
  }

  async handlePayoutGetUsers(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const appId = url.searchParams.get('appId');
    ok(res, await this.payoutRouter.getUsers(appId));
  }

  async handlePayoutRecordOrder(req, res) {
    const body = await parseBody(req);
    const result = await this.payoutRouter.recordOrder(body);
    if (result.success) ok(res, result);
    else badRequest(res, result.error);
  }

  async handlePayoutGetOrders(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const userId = url.searchParams.get('userId');
    const appId = url.searchParams.get('appId');
    const year = parseInt(url.searchParams.get('year') || '0', 10) || undefined;
    const month = parseInt(url.searchParams.get('month') || '0', 10) || undefined;
    ok(res, await this.payoutRouter.getOrders({ userId, appId, year, month }));
  }

  async handlePayoutCalculate(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const year = parseInt(url.searchParams.get('year') || String(new Date().getUTCFullYear()), 10);
    const month = parseInt(url.searchParams.get('month') || String(new Date().getUTCMonth() + 1), 10);
    const result = await this.payoutRouter.calculateMonthlyPayout(year, month);
    if (result.success) ok(res, result);
    else badRequest(res, result.error);
  }

  async handlePayoutGetManifest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const year = parseInt(url.searchParams.get('year') || String(new Date().getUTCFullYear()), 10);
    const month = parseInt(url.searchParams.get('month') || String(new Date().getUTCMonth() + 1), 10);
    ok(res, await this.payoutRouter.getPayoutManifest(year, month));
  }

  async handlePayoutMarkDistributed(req, res) {
    const body = await parseBody(req);
    const { year, month, txHash } = body;
    ok(res, await this.payoutRouter.markDistributed(year, month, txHash));
  }

  async handlePayoutDeny(req, res) {
    const body = await parseBody(req);
    const { year, month, memberId, reason } = body;
    const result = await this.payoutRouter.denyDistribution(year, month, { memberId, reason });
    if (result.success) ok(res, result);
    else badRequest(res, result.error);
  }

  async handlePayoutConfirm(req, res) {
    const body = await parseBody(req);
    const { year, month, txHash } = body;
    const result = await this.payoutRouter.confirmDistribution(year, month, txHash);
    if (result.success) ok(res, result);
    else badRequest(res, result.error);
  }

  async handlePayoutStats(req, res) {
    ok(res, await this.payoutRouter.getStats());
  }

  /* ─── Private helpers ─── */

  async _spawnBridgeJob({ topic, customPrompt, category, tags, description, links = [], fileSource = '' }) {
    const workspace = path.join(process.cwd(), 'llmwiki-data');
    const bridge = path.join(process.cwd(), 'src', 'llmwiki', 'bridge.py');
    const args = [bridge, workspace, topic || 'Untitled', '--category', category];
    if (tags.length)       args.push('--tags', ...tags);
    if (description)       args.push('--description', description);
    if (customPrompt)      args.push('--prompt', customPrompt);
    if (links.length)      args.push('--links', ...links);
    if (fileSource)        args.push('--file-source', fileSource);

    const jobId = `lw-${Date.now()}`;
    this.logger.info(`[llmwiki] Job ${jobId}: ${customPrompt || topic} (${category})`);

    const proc = spawn('/usr/bin/python3', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.unref();
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.on('close', code => {
      if (code !== 0) this.logger.error(`[llmwiki] Job ${jobId} failed: ${err || out}`);
      else this.logger.info(`[llmwiki] Job ${jobId} completed`);
    });
    return jobId;
  }
}
