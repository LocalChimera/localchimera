/**
 * TargonProvider — Auto-setup and run Targon CPU provider.
 *
 * Security: never stores or transmits the hotkey mnemonic.
 * The hotkey lives in ~/.config/.targon.json (user-owned, 0600).
 * The SDK only passes the config file path to the miner binary.
 */

import { spawn } from 'child_process';
import { execSync } from 'child_process';
import path from 'path';
import os from 'os';
import { KeyringManager } from './KeyringManager.js';

const TARGON_DIR = path.join(os.homedir(), 'CascadeProjects', 'qvac-chimera', 'upstream', 'targon');
const TARGON_CLI = path.join(TARGON_DIR, 'targon-cli');

function hasNvidiaGpu() {
  try {
    execSync('nvidia-smi -L', { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function detectGpuArchitecture() {
  try {
    const output = execSync('nvidia-smi -q', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (output.includes('H100') || output.includes('H200')) return 'HOPPER';
    if (output.includes('B100') || output.includes('B200')) return 'BLACKWELL';
    return 'GPU'; // generic GPU
  } catch { return null; }
}

export class TargonProvider {
  constructor(opts = {}) {
    this.configPath = null;
    this.gpuMode = opts.gpuMode ?? hasNvidiaGpu(); // auto-detect unless overridden
    this.gpuArch = opts.gpuArch ?? detectGpuArchitecture();
    this.nodeType = opts.nodeType ?? (this.gpuMode ? (this.gpuArch || 'GPU') : 'CPU');
    this.process = null;
    this.running = false;
    this.logs = [];
  }

  async init() {
    this.configPath = await KeyringManager.targonConfigPath();
  }

  async start() {
    if (this.running) return { success: true, alreadyRunning: true };
    if (!this.configPath) await this.init();

    return new Promise((resolve) => {
      const env = {
        ...process.env,
        TARGON_SKIP_HW_ATTESTATION: this.gpuMode ? '0' : '1',
        TARGON_SKIP_GPU_CHECK: this.gpuMode ? '0' : '1'
      };

      // For CPU mode use targon-cli (miner binary); for GPU use tvm/install
      const binary = this.gpuMode ? path.join(TARGON_DIR, 'tvm', 'install') : TARGON_CLI;
      const args = this.gpuMode
        ? ['-node-type', this.nodeType, '-output', `/tmp/targon-${this.nodeType.toLowerCase()}-report.json`]
        : [];

      this.process = spawn(binary, args, {
        cwd: TARGON_DIR,
        env,
        detached: true
      });

      this.running = true;

      this.process.stdout.on('data', (data) => {
        const line = data.toString().trim();
        this.logs.push({ ts: Date.now(), level: 'info', msg: line });
        if (this.logs.length > 500) this.logs.shift();
      });

      this.process.stderr.on('data', (data) => {
        const line = data.toString().trim();
        this.logs.push({ ts: Date.now(), level: 'error', msg: line });
        if (this.logs.length > 500) this.logs.shift();
      });

      this.process.on('exit', (code) => {
        this.running = false;
      });

      setTimeout(() => {
        if (this.process && !this.process.killed) {
          resolve({ success: true, pid: this.process.pid, provider: 'targon' });
        } else {
          resolve({ success: false, error: 'Targon provider exited immediately. Check logs.' });
        }
      }, 3000);
    });
  }

  async stop() {
    if (!this.process || !this.running) return { success: true, alreadyStopped: true };
    this.process.kill('SIGTERM');
    this.running = false;
    return { success: true, provider: 'targon' };
  }

  status() {
    return {
      provider: 'targon',
      running: this.running,
      pid: this.process?.pid || null,
      configPath: this.configPath,
      gpuMode: this.gpuMode,
      nodeType: this.nodeType,
      resources: this.gpuMode ? `CPU + ${this.nodeType}` : 'CPU only',
      recentLogs: this.logs.slice(-10)
    };
  }
}
