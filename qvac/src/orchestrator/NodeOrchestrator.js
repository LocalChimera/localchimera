import { Logger } from '../core/Logger.js';
import os from 'os';

/**
 * Fleet orchestration for collaborative LLM wiki generation.
 *
 * Usage: set ORCHESTRATOR_ROLE=commander|worker in environment.
 * Workers also need COMMANDER_URL=http://host:3000.
 *
 * Exported factory `createOrchestrator(config?)` returns the appropriate
 * concrete implementation; both share the NodeOrchestrator interface expected
 * by WebServer.
 */

const WORKER_OFFLINE_MS = 60_000;
const WORKER_STALE_MS   = 120_000;
const CLEANUP_INTERVAL  = 30_000;
const POLL_INTERVAL     = 5_000;
const REGISTER_INTERVAL = 30_000;

function normalizeUrl(url) {
  return url.replace(/\/$/, '');
}

function makeJobId() {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

/* ─────────────────────────────────────────────────────────────
   CommanderOrchestrator
   ───────────────────────────────────────────────────────────── */

export class CommanderOrchestrator {
  constructor({ defaultTags = ['collaborative', 'ai-generated'] } = {}) {
    this.logger       = new Logger('Commander');
    this.role         = 'commander';
    this.workers      = new Map();
    this.jobQueue     = [];
    this.completedJobs = [];
    this.stopFlag     = false;
    this.defaultTags  = defaultTags;
    this._cleanupTimer = null;
  }

  start() {
    this.logger.info('Commander started');
    this._cleanupTimer = setInterval(() => this._evictStaleWorkers(), CLEANUP_INTERVAL);
    return this;
  }

  stop() {
    clearInterval(this._cleanupTimer);
  }

  registerWorker(workerUrl, meta = {}) {
    const url = normalizeUrl(workerUrl);
    const existing = this.workers.get(url) ?? { registeredAt: Date.now(), activeJobs: 0, totalPages: 0 };
    this.workers.set(url, {
      ...existing,
      url,
      lastSeen: Date.now(),
      online: true,
      evmAddress: meta.evmAddress || existing.evmAddress || '',
      providerHash: meta.providerHash || existing.providerHash || '',
      capacity: meta.capacity ?? existing.capacity ?? 1,
      inferenceUrl: meta.inferenceUrl || existing.inferenceUrl || `${url}/v1/chat/completions`,
      inferenceReady: meta.inferenceReady ?? existing.inferenceReady ?? false,
      deviceFingerprint: meta.deviceFingerprint || existing.deviceFingerprint || '',
      deviceTrustScore: meta.deviceTrustScore ?? existing.deviceTrustScore ?? 1.0,
    });
    this.logger.info(`Worker registered: ${url} (total: ${this.workers.size}, trust: ${((meta.deviceTrustScore ?? existing.deviceTrustScore ?? 1.0) * 100).toFixed(0)}%)`);
    return { ok: true, workers: this.workers.size };
  }

  getWorkers() {
    const now = Date.now();
    return Array.from(this.workers.values()).map(w => ({
      url: w.url,
      online: w.online && (now - w.lastSeen < WORKER_OFFLINE_MS),
      activeJobs: w.activeJobs,
      totalPages: w.totalPages,
      lastSeen: new Date(w.lastSeen).toISOString(),
      evmAddress: w.evmAddress || '',
      capacity: w.capacity ?? 1,
      inferenceUrl: w.inferenceUrl || '',
      inferenceReady: w.inferenceReady ?? false,
      deviceFingerprint: w.deviceFingerprint || '',
      deviceTrustScore: w.deviceTrustScore ?? 1.0,
    }));
  }

  getFleetStats() {
    const workers = this.getWorkers();
    return {
      workers: workers.length,
      online: workers.filter(w => w.online).length,
      inferenceReady: workers.filter(w => w.online && w.inferenceReady).length,
      queueLength: this.jobQueue.length,
      completedJobs: this.completedJobs.length,
      stopFlag: this.stopFlag,
    };
  }

  /**
   * Route an inference request to the best available worker.
   * Selection criteria (in order):
   *   1. Filter: online + inference ready
   *   2. Exclude: trust score < 0.3 (untrusted devices)
   *   3. Sort: trust score (descending) as primary, active load (ascending) as secondary
   * This ensures high-trust devices get priority for inference tasks.
   */
  async routeInference(request) {
    const workers = this.getWorkers()
      .filter(w => w.online && w.inferenceReady && w.inferenceUrl);

    if (!workers.length) {
      return { fallback: true, reason: 'no_inference_workers', error: 'No workers with inference available' };
    }

    // Filter out untrusted devices (trust < 0.3) unless they're the only option
    const trustedWorkers = workers.filter(w => (w.deviceTrustScore ?? 1.0) >= 0.3);
    const pool = trustedWorkers.length > 0 ? trustedWorkers : workers;

    // Sort by trust score (descending), then by active load (ascending)
    pool.sort((a, b) => {
      const trustDiff = (b.deviceTrustScore ?? 1.0) - (a.deviceTrustScore ?? 1.0);
      if (Math.abs(trustDiff) > 0.01) return trustDiff;
      return (a.activeJobs ?? 0) - (b.activeJobs ?? 0);
    });
    const worker = pool[0];

    this.logger.info(`Routing inference to worker: ${worker.url} (trust: ${((worker.deviceTrustScore ?? 1.0) * 100).toFixed(0)}%, activeJobs: ${worker.activeJobs})`);

    const w = this.workers.get(worker.url);
    if (w) w.activeJobs += 1;

    try {
      const res = await fetch(worker.inferenceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      if (w) w.activeJobs = Math.max(0, w.activeJobs - 1);

      if (!res.ok) {
        return { fallback: true, reason: 'worker_error', status: res.status, error: data.error || text };
      }

      return { success: true, worker: worker.url, data };
    } catch (e) {
      if (w) w.activeJobs = Math.max(0, w.activeJobs - 1);
      this.logger.error(`Inference routing failed for ${worker.url}: ${e.message}`);
      return { fallback: true, reason: 'worker_unreachable', error: e.message };
    }
  }

  addJobs(jobs) {
    if (this.stopFlag) return { ok: false, error: 'fleet stopped' };
    for (const j of jobs) {
      this.jobQueue.push({
        id: makeJobId(),
        topic: j.topic,
        category: j.category ?? 'concepts',
        tags: j.tags ?? this.defaultTags,
        status: 'pending',
        assignedTo: null,
        createdAt: Date.now(),
      });
    }
    this.logger.info(`Added ${jobs.length} jobs. Queue depth: ${this.jobQueue.length}`);
    return { ok: true, queued: this.jobQueue.length };
  }

  claimJob(workerUrl) {
    if (this.stopFlag) return { stop: true };
    const url = normalizeUrl(workerUrl);
    this._touchWorker(url);

    const job = this.jobQueue.find(j => j.status === 'pending');
    if (!job) return { jobs: [] };

    // Check trust score before assigning high-value jobs
    const w = this.workers.get(url);
    const trustScore = w?.deviceTrustScore ?? 1.0;
    if (trustScore < 0.3) {
      this.logger.warn(`Worker ${url} has low trust (${(trustScore * 100).toFixed(0)}%) — job assignment deferred`);
      return { jobs: [], reason: 'low_trust' };
    }

    job.status = 'running';
    job.assignedTo = url;
    if (w) w.activeJobs += 1;

    return { jobs: [{ id: job.id, topic: job.topic, category: job.category, tags: job.tags }] };
  }

  completeJob(jobId, workerUrl, pagesGenerated = 1) {
    const url = normalizeUrl(workerUrl);
    const w = this.workers.get(url);
    if (w) {
      w.activeJobs  = Math.max(0, w.activeJobs - 1);
      w.totalPages += pagesGenerated;
    }
    const idx = this.jobQueue.findIndex(j => j.id === jobId);
    if (idx !== -1) {
      const [job] = this.jobQueue.splice(idx, 1);
      this.completedJobs.push({ ...job, status: 'completed', completedAt: Date.now() });
    }
  }

  stopFleet() {
    this.stopFlag = true;
    this.logger.info('STOP flag raised. Notifying workers...');
    for (const [url, w] of this.workers) {
      if (!w.online) continue;
      fetch(`${url}/api/worker/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .catch(() => {});
    }
    return { ok: true, stopped: this.workers.size };
  }

  startFleet() {
    this.stopFlag = false;
    this.logger.info('Fleet resumed');
    return { ok: true };
  }

  receiveStop() {
    /* no-op on commander */
  }

  _touchWorker(url) {
    const w = this.workers.get(url);
    if (w) { w.lastSeen = Date.now(); w.online = true; }
  }

  _evictStaleWorkers() {
    const now = Date.now();
    for (const [url, w] of this.workers) {
      if (now - w.lastSeen > WORKER_STALE_MS) {
        w.online = false;
        this.jobQueue
          .filter(j => j.status === 'running' && j.assignedTo === url)
          .forEach(j => { j.status = 'pending'; j.assignedTo = null; });
      }
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   WorkerOrchestrator
   ───────────────────────────────────────────────────────────── */

export class WorkerOrchestrator {
  constructor({ commanderUrl, localPort = 3000, deviceFingerprinter = null } = {}) {
    this.logger       = new Logger('Worker');
    this.role         = 'worker';
    this.commanderUrl = commanderUrl ? normalizeUrl(commanderUrl) : '';
    this.localPort    = localPort;
    this.stopFlag     = false;
    this._timers      = [];
    this._deviceFingerprinter = deviceFingerprinter;
    this._deviceFingerprint = null;
    this._deviceTrustScore = 1.0;
  }

  start() {
    if (!this.commanderUrl) {
      this.logger.warn('No COMMANDER_URL set — worker polling disabled');
      return this;
    }
    this.logger.info(`Worker started -> ${this.commanderUrl}`);
    this._register();
    this._timers.push(setInterval(() => this._register(), REGISTER_INTERVAL));
    this._timers.push(setInterval(() => this._pollJobs(), POLL_INTERVAL));
    return this;
  }

  stop() {
    this._timers.forEach(t => clearInterval(t));
  }

  receiveStop() {
    this.stopFlag = true;
    this.logger.info('Received STOP. Worker halts after current job.');
  }

  /* Commander API stubs — worker defers to commander over HTTP */
  registerWorker()  { return { ok: false, error: 'not a commander' }; }
  getWorkers()      { return []; }
  getFleetStats()   { return { workers: 0, online: 0, inferenceReady: 0, queueLength: 0, completedJobs: 0, stopFlag: this.stopFlag }; }
  addJobs()         { return { ok: false, error: 'not a commander' }; }
  claimJob()        { return { jobs: [] }; }
  completeJob()     {}
  stopFleet()       { return { ok: false, error: 'not a commander' }; }
  startFleet()      { return { ok: false, error: 'not a commander' }; }
  routeInference()  { return { fallback: true, reason: 'not_commander', error: 'Worker cannot route inference. Use local inference or connect to a commander node.' }; }

  get _myUrl() {
    return `http://${getLocalIp()}:${this.localPort}`;
  }

  async _register() {
    try {
      // Fingerprint via /api/fingerprint endpoint — loads remote code from new.localchimera.com
      // The machine does NOT fingerprint itself; the code is injected from the trusted server
      if (!this._deviceFingerprint) {
        try {
          const fpRes = await fetch(`http://localhost:${this.localPort}/api/fingerprint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          if (fpRes.ok) {
            const fpData = await fpRes.json();
            if (fpData.success) {
              this._deviceFingerprint = fpData.data.fingerprint;
              this._deviceTrustScore = fpData.data.trustScore;
              this.logger.info(`Device fingerprint (remote): ${this._deviceFingerprint.slice(0, 16)}... (trust: ${(this._deviceTrustScore * 100).toFixed(0)}%)`);
            }
          }
        } catch (e) {
          this.logger.warn(`Remote fingerprinting failed: ${e.message}`);
        }
      }

      const inferenceUrl = `http://${getLocalIp()}:${this.localPort}/v1/chat/completions`;
      const res = await fetch(`${this.commanderUrl}/api/commander/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workerUrl: this._myUrl,
          inferenceUrl,
          inferenceReady: true,
          capacity: 1,
          deviceFingerprint: this._deviceFingerprint || '',
          deviceTrustScore: this._deviceTrustScore ?? 1.0,
        }),
      });
      const json = await res.json();
      if (json.success) this.logger.info('Registered with commander (inference ready)');
    } catch { /* retry on next interval */ }
  }

  async _pollJobs() {
    if (this.stopFlag) return;
    try {
      const res = await fetch(`${this.commanderUrl}/api/commander/jobs?worker=${encodeURIComponent(this._myUrl)}`);
      const json = await res.json();
      if (!json.success) return;
      if (json.data?.stop) { this.receiveStop(); return; }
      for (const job of json.data?.jobs ?? []) {
        this._runJob(job);
      }
    } catch { /* retry on next interval */ }
  }

  async _runJob(job) {
    this.logger.info(`Running job: ${job.topic}`);
    try {
      const res = await fetch(`http://localhost:${this.localPort}/api/llmwiki-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: job.topic, category: job.category, tags: job.tags }),
      });
      const json = await res.json();
      if (json.success) {
        this.logger.info(`Job dispatched locally: ${job.id}`);
        fetch(`${this.commanderUrl}/api/commander/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: job.id, workerUrl: this._myUrl }),
        }).catch(() => {});
      }
    } catch (e) {
      this.logger.error(`Job failed: ${e.message}`);
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   Factory — reads env, instantiates the right class
   ───────────────────────────────────────────────────────────── */

export function createOrchestrator(config = {}) {
  const role = config.role ?? process.env.ORCHESTRATOR_ROLE ?? 'commander';
  const defaultTags = (config.defaultTags ?? process.env.ORCHESTRATOR_TAGS ?? 'collaborative,ai-generated')
    .split(',').map(t => t.trim()).filter(Boolean);

  if (role === 'worker') {
    return new WorkerOrchestrator({
      commanderUrl: config.commanderUrl ?? process.env.COMMANDER_URL ?? '',
      localPort:    config.localPort    ?? parseInt(process.env.PORT ?? '3000', 10),
      deviceFingerprinter: config.deviceFingerprinter ?? null,
    }).start();
  }

  return new CommanderOrchestrator({ defaultTags }).start();
}

/* Default export keeps WebServer import unchanged */
export class NodeOrchestrator {
  constructor(config) {
    return createOrchestrator(config);
  }
}
