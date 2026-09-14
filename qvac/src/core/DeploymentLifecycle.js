import { Logger } from '../core/Logger.js';
import { promises as fsp } from 'fs';
import path from 'path';
import EventEmitter from 'eventemitter3';

/**
 * DeploymentLifecycle — phase-based deployment tracking with SSE streaming.
 *
 * Uses eventemitter3 (MIT) for event emission.
 * Tracks the lifecycle of worker node deployments, P2P peer provisioning,
 * and model distribution across the mesh.
 */

const PHASES = [
  'uploaded',
  'prepared',
  'submitted',
  'matching',
  'matched',
  'ack',
  'env-set',
  'started',
  'model_loading',
  'model_ready',
  'error',
  'rolled_back',
];

const PHASE_LABELS = {
  uploaded: 'Code bundle uploaded',
  prepared: 'Deployment prepared',
  submitted: 'Submitted to network',
  matching: 'Matching with workers',
  matched: 'Worker matched',
  ack: 'Worker acknowledged',
  'env-set': 'Environment configured',
  started: 'Worker process started',
  model_loading: 'Loading AI model',
  model_ready: 'Model ready — inference available',
  error: 'Deployment error',
  rolled_back: 'Deployment rolled back to previous state',
};

export class DeploymentLifecycle extends EventEmitter {
  constructor(config = {}) {
    super();
    this.logger = new Logger('DeploymentLifecycle');
    this.dataDir = config.dataDir || path.join(process.cwd(), 'data', 'deployments');
    this._deployments = new Map();
    this._subscribers = new Map(); // deploymentId -> Set<res>
    this._etas = config.etas || {};
    this._initDataDir();
  }

  async _initDataDir() {
    try {
      await fsp.mkdir(this.dataDir, { recursive: true });
    } catch {}
  }

  /**
   * Create a new deployment tracking record.
   */
  create({ template, params, public: isPublic = false }) {
    const id = `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const deployment = {
      id,
      template,
      params,
      public: isPublic,
      phase: 'uploaded',
      phaseHistory: [{ phase: 'uploaded', timestamp: Date.now() }],
      tunnelUrl: null,
      error: null,
      previousPhase: null,
      rollbackReason: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this._deployments.set(id, deployment);
    this._persist(deployment);
    this.logger.info(`Deployment created: ${id} (template: ${template})`);
    return deployment;
  }

  /**
   * Advance a deployment to the next phase.
   */
  advancePhase(deploymentId, phase, extra = {}) {
    const dep = this._deployments.get(deploymentId);
    if (!dep) {
      this.logger.warn(`Unknown deployment: ${deploymentId}`);
      return null;
    }

    if (!PHASES.includes(phase)) {
      this.logger.warn(`Unknown phase: ${phase}`);
      return null;
    }

    dep.phase = phase;
    dep.updatedAt = Date.now();
    if (phase !== 'error' && phase !== 'rolled_back') {
      dep.previousPhase = phase;
    }
    dep.phaseHistory.push({ phase, timestamp: Date.now(), ...extra });

    if (phase === 'started' && extra.tunnelUrl) {
      dep.tunnelUrl = extra.tunnelUrl;
    }

    if (phase === 'error' && extra.error) {
      dep.error = extra.error;
      // Auto-rollback on error if previous phase was healthy
      if (dep.previousPhase && dep.previousPhase !== 'error' && extra.autoRollback !== false) {
        this.rollback(deploymentId, extra.error);
        return dep;
      }
    }

    this._persist(dep);
    this._notifySubscribers(deploymentId, dep);
    this.emit('phaseChange', { deploymentId, phase, deployment: dep });
    this.logger.info(`Deployment ${deploymentId} → ${phase}`);
    return dep;
  }

  /**
   * Get a deployment by ID.
   */
  get(deploymentId) {
    return this._deployments.get(deploymentId) || null;
  }

  /**
   * List all deployments (optionally only public ones).
   */
  list({ publicOnly = false } = {}) {
    const all = Array.from(this._deployments.values());
    return publicOnly ? all.filter(d => d.public) : all;
  }

  /**
   * Get the estimated time remaining for a deployment.
   */
  getETA(deploymentId) {
    const dep = this._deployments.get(deploymentId);
    if (!dep) return null;
    const currentIdx = PHASES.indexOf(dep.phase);
    if (currentIdx < 0 || dep.phase === 'model_ready') return 0;

    let totalMs = 0;
    for (let i = currentIdx + 1; i < PHASES.length - 1; i++) {
      const phase = PHASES[i];
      totalMs += this._etas[phase] || 5000;
    }
    return totalMs;
  }

  /**
   * Subscribe to live deployment updates via SSE.
   * Returns a cleanup function.
   */
  subscribe(deploymentId, res) {
    if (!this._subscribers.has(deploymentId)) {
      this._subscribers.set(deploymentId, new Set());
    }
    this._subscribers.get(deploymentId).add(res);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const dep = this._deployments.get(deploymentId);
    if (dep) {
      res.write(`data: ${JSON.stringify({ type: 'phase', deploymentId, phase: dep.phase, ...dep })}\n\n`);
    }

    return () => {
      const subs = this._subscribers.get(deploymentId);
      if (subs) {
        subs.delete(res);
        if (subs.size === 0) this._subscribers.delete(deploymentId);
      }
      try { res.end(); } catch {}
    };
  }

  _notifySubscribers(deploymentId, dep) {
    const subs = this._subscribers.get(deploymentId);
    if (!subs || subs.size === 0) return;
    const data = JSON.stringify({
      type: 'phase',
      deploymentId,
      phase: dep.phase,
      phaseLabel: PHASE_LABELS[dep.phase] || dep.phase,
      tunnelUrl: dep.tunnelUrl,
      error: dep.error,
      eta: this.getETA(deploymentId),
      timestamp: Date.now(),
    });
    for (const res of subs) {
      try { res.write(`data: ${data}\n\n`); } catch {}
    }
  }

  /**
   * Rollback a deployment to its previous known-good phase.
   * Inspired by acurast-deployer-service: if a deployment fails mid-lifecycle,
   * automatically revert to the last healthy state.
   */
  rollback(deploymentId, reason = '') {
    const dep = this._deployments.get(deploymentId);
    if (!dep) {
      this.logger.warn(`Cannot rollback unknown deployment: ${deploymentId}`);
      return null;
    }

    const lastHealthy = dep.previousPhase || 'uploaded';
    this.logger.warn(`Rolling back ${deploymentId} from ${dep.phase} → ${lastHealthy} (${reason})`);

    dep.phase = 'rolled_back';
    dep.rollbackReason = reason;
    dep.rollbackFrom = dep.phase;
    dep.updatedAt = Date.now();
    dep.phaseHistory.push({
      phase: 'rolled_back',
      timestamp: Date.now(),
      reason,
      rolledBackTo: lastHealthy,
    });

    this._persist(dep);
    this._notifySubscribers(deploymentId, dep);

    // After rollback notification, restore to last healthy phase
    setTimeout(() => {
      dep.phase = lastHealthy;
      dep.updatedAt = Date.now();
      dep.phaseHistory.push({
        phase: lastHealthy,
        timestamp: Date.now(),
        restored: true,
      });
      this._persist(dep);
      this._notifySubscribers(deploymentId, dep);
      this.logger.info(`Deployment ${deploymentId} restored to ${lastHealthy}`);
    }, 1000);

    return dep;
  }

  /**
   * Get rollback history for a deployment.
   */
  getRollbackHistory(deploymentId) {
    const dep = this._deployments.get(deploymentId);
    if (!dep) return [];
    return dep.phaseHistory.filter(h => h.phase === 'rolled_back');
  }

  async _persist(dep) {
    const filePath = path.join(this.dataDir, 'deployments.jsonl');
    try {
      await fsp.appendFile(filePath, JSON.stringify(dep) + '\n', 'utf-8');
    } catch (e) {
      this.logger.warn(`Failed to persist deployment: ${e.message}`);
    }
  }

  getStatus() {
    return {
      activeDeployments: this._deployments.size,
      phases: PHASES,
      subscriberCount: Array.from(this._subscribers.values()).reduce((s, set) => s + set.size, 0),
    };
  }
}
