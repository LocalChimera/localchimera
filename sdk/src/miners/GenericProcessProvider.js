/**
 * GenericProcessProvider — Replaces individual Docker/inline and API-only miner providers.
 *
 * Two modes:
 *   - 'process': spawns a binary or Docker container, collects logs, manages lifecycle
 *   - 'api': lightweight flag-based provider for API-key-gated networks
 *
 * Security guarantee: no private keys. Uses protocol payout address only.
 */

import { spawn, execSync } from 'child_process';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { getProtocolPayoutAddress } from './protocol-address.js';

export class GenericProcessProvider {
  constructor(name, config = {}) {
    this.name = name;
    this.mode = config.mode || 'process'; // 'process' | 'api'
    this.process = null;
    this.running = false;
    this.logs = [];
    this.payoutAddress = getProtocolPayoutAddress(config);

    // API mode config
    this.apiKey = config.apiKey || process.env[`${name.toUpperCase().replace(/-/g, '_')}_API_KEY`] || '';
    this.apiUrl = config.apiUrl || '';

    // Process mode config
    this.binary = config.binary || null;          // inline binary name (e.g. 'yagna')
    this.dockerImage = config.dockerImage || null; // docker image (e.g. 'golemprovider/golem-provider:latest')
    this.dockerName = config.dockerName || `chimera-${name}`;
    this.dockerArgs = config.dockerArgs || [];     // extra docker args (ports, caps, volumes)
    this.inlineArgs = config.inlineArgs || [];     // args for inline binary
    this.envVars = config.envVars || {};           // extra env vars
    this.dataDir = config.dataDir || path.join(os.homedir(), '.chimera', name);
    this.upstreamDir = config.upstreamDir || path.join(os.homedir(), '.chimera', 'upstream', name);
    this.startupTimeout = config.startupTimeout || 5000;
    this.resources = config.resources || '';
    this.rewardToken = config.rewardToken || null;
    this.rewardChain = config.rewardChain || null;

    // Prerequisites to check in init()
    this.requires = config.requires || []; // e.g. ['docker', 'nvidia-smi', 'python3']
    this.requiresDir = config.requiresDir !== false; // check upstreamDir exists (host mode)
  }

  async init() {
    if (this.mode === 'api') {
      if (this.apiKey === '' && this.requires.includes('apiKey')) {
        throw new Error(`${this.name}: API key not set`);
      }
      return;
    }

    this.inContainer = process.env.CHIMERA_PRIVACY_MODE === 'true';

    if (this.inContainer && this.binary) {
      try {
        execSync(`which ${this.binary}`, { stdio: 'ignore' });
      } catch {
        throw new Error(`${this.binary} binary not found in container. Install in Dockerfile.`);
      }
      if (this.dataDir) {
        await fs.mkdir(this.dataDir, { recursive: true });
      }
      return;
    }

    if (this.requiresDir) {
      const exists = await fs.access(this.upstreamDir).then(() => true).catch(() => false);
      if (!exists) {
        throw new Error(`${this.name} not found at ${this.upstreamDir}`);
      }
    }

    for (const req of this.requires) {
      try {
        execSync(`which ${req}`, { stdio: 'ignore' });
      } catch {
        throw new Error(`${this.name}: prerequisite '${req}' not available`);
      }
    }
  }

  async start() {
    if (this.running) return { success: true, alreadyRunning: true };

    if (this.mode === 'api') {
      this.running = true;
      return { success: true, provider: this.name, mode: 'api', apiUrl: this.apiUrl, payoutAddress: this.payoutAddress };
    }

    return new Promise((resolve) => {
      const env = { ...process.env, ...this.envVars };

      if (this.inContainer && this.binary) {
        this.process = spawn(this.binary, this.inlineArgs, {
          cwd: this.dataDir,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } else if (this.dockerImage) {
        const args = [
          'run', '-d',
          '--name', this.dockerName,
          '--restart', 'unless-stopped',
          ...this.dockerArgs,
        ];
        for (const [k, v] of Object.entries(this.envVars)) {
          args.push('-e', `${k}=${v}`);
        }
        args.push(this.dockerImage);
        if (this.inlineArgs.length) args.push(...this.inlineArgs);
        this.process = spawn('docker', args, { cwd: this.upstreamDir, env });
      } else {
        resolve({ success: false, error: `${this.name}: no binary or dockerImage configured` });
        return;
      }

      this.running = true;

      this.process.stdout?.on('data', (data) => {
        const line = data.toString().trim();
        if (line) {
          this.logs.push({ ts: Date.now(), level: 'info', msg: line });
          if (this.logs.length > 500) this.logs.shift();
        }
      });

      this.process.stderr?.on('data', (data) => {
        const line = data.toString().trim();
        if (line) {
          this.logs.push({ ts: Date.now(), level: 'error', msg: line });
          if (this.logs.length > 500) this.logs.shift();
        }
      });

      this.process.on('exit', () => {
        this.running = false;
      });

      setTimeout(() => {
        if (this.process && !this.process.killed) {
          resolve({
            success: true,
            pid: this.process.pid,
            provider: this.name,
            mode: this.inContainer ? 'inline' : 'docker',
          });
        } else {
          resolve({ success: false, error: `${this.name} exited immediately. Check logs.` });
        }
      }, this.startupTimeout);
    });
  }

  async stop() {
    if (!this.running) return { success: true, alreadyStopped: true };

    if (this.mode === 'api') {
      this.running = false;
      return { success: true, provider: this.name };
    }

    if (!this.inContainer && this.dockerImage) {
      try {
        execSync(`docker stop ${this.dockerName}`, { stdio: 'ignore' });
        execSync(`docker rm ${this.dockerName}`, { stdio: 'ignore' });
      } catch {}
    }

    if (this.process) {
      this.process.kill('SIGTERM');
    }

    this.running = false;
    return { success: true, provider: this.name };
  }

  status() {
    const s = {
      provider: this.name,
      running: this.running,
      payoutAddress: this.payoutAddress,
      recentLogs: this.logs.slice(-10),
    };

    if (this.mode === 'api') {
      s.mode = 'api';
      if (this.apiUrl) s.apiUrl = this.apiUrl;
    } else {
      s.pid = this.process?.pid || null;
      s.mode = this.inContainer ? 'inline' : 'docker';
    }

    if (this.resources) s.resources = this.resources;
    if (this.rewardToken) s.rewardToken = this.rewardToken;
    if (this.rewardChain) s.rewardChain = this.rewardChain;

    return s;
  }
}
