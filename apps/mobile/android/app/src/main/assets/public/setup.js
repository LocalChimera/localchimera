#!/usr/bin/env node

/**
 * QVAC-Pear Miner Node Setup Wizard
 *
 * Run: node setup.js
 *
 * This script:
 * 1. Checks prerequisites (Node.js 18+, optional Docker)
 * 2. Guides you through configuration
 * 3. Installs dependencies
 * 4. Starts the node
 * 5. Opens the dashboard in your browser
 */

import { execSync, spawn } from 'child_process';
import { createServer } from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (q) => new Promise((resolve) => rl.question(q, resolve));

function log(step, msg) {
  const colors = {
    info: '\x1b[36m',
    success: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    reset: '\x1b[0m'
  };
  const prefix = step === 'ok' ? `${colors.success}✓${colors.reset}` :
                 step === 'warn' ? `${colors.warn}⚠${colors.reset}` :
                 step === 'err' ? `${colors.error}✗${colors.reset}` :
                 `${colors.info}→${colors.reset}`;
  console.log(`${prefix} ${msg}`);
}

async function main() {
  console.log('\n🍐 QVAC-Pear Miner Node Setup\n');

  // Step 1: Check Node.js
  log('info', 'Checking Node.js version...');
  let nodeVersion;
  try {
    nodeVersion = execSync('node --version', { encoding: 'utf-8' }).trim();
    const major = parseInt(nodeVersion.slice(1).split('.')[0]);
    if (major < 18) {
      log('err', `Node.js ${nodeVersion} found. Version 18+ required.`);
      process.exit(1);
    }
    log('ok', `Node.js ${nodeVersion}`);
  } catch {
    log('err', 'Node.js not found. Please install Node.js 18+ from https://nodejs.org');
    process.exit(1);
  }

  // Step 2: Check npm
  try {
    const npmVersion = execSync('npm --version', { encoding: 'utf-8' }).trim();
    log('ok', `npm v${npmVersion}`);
  } catch {
    log('err', 'npm not found.');
    process.exit(1);
  }

  // Step 3: Check Docker (optional)
  let hasDocker = false;
  try {
    execSync('docker --version', { stdio: 'ignore' });
    hasDocker = true;
    log('ok', 'Docker available');
  } catch {
    log('warn', 'Docker not found. Will use native Node.js mode.');
  }

  // Step 4: Choose install method
  console.log('');
  let method = 'npm';
  if (hasDocker) {
    const choice = await question('Install with (d)ocker or (n)ative? [n] ');
    method = choice.trim().toLowerCase().startsWith('d') ? 'docker' : 'npm';
  }
  log('ok', `Selected: ${method === 'docker' ? 'Docker' : 'Native Node.js'}`);

  // Step 5: Configure EVM address
  console.log('');
  log('info', 'Enter your EVM payout address (0x...)');
  let evm = '';
  while (!/^0x[a-fA-F0-9]{40}$/.test(evm)) {
    evm = await question('EVM Address: ');
    if (!/^0x[a-fA-F0-9]{40}$/.test(evm)) {
      log('err', 'Invalid EVM address. Must be 0x followed by 40 hex chars.');
    }
  }
  log('ok', `Payout: ${evm.slice(0, 10)}...${evm.slice(-6)}`);

  // Step 6: App ID
  const appId = await question('App ID (optional, press Enter for default): ');
  const finalAppId = appId.trim() || 'protocol-default';
  log('ok', `App ID: ${finalAppId}`);

  // Step 7: Install dependencies
  console.log('');
  if (method === 'npm') {
    log('info', 'Installing dependencies...');
    try {
      execSync('npm install', { stdio: 'inherit' });
      log('ok', 'Dependencies installed');
    } catch {
      log('err', 'npm install failed.');
      process.exit(1);
    }
  }

  // Step 8: Write config
  log('info', 'Writing configuration...');
  const configPath = path.join(__dirname, 'config.json');
  let config = {};
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(raw);
  } catch {}
  config.multisig = config.multisig || {};
  config.multisig.machineOwnerAddress = evm;
  config.multisig.evmMultisigAddress = evm;
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  log('ok', 'Configuration saved');

  // Step 9: Start node
  console.log('');
  log('info', 'Starting QVAC-Pear Miner Node...');

  const env = { ...process.env, MACHINE_OWNER_EVM: evm, APP_ID: finalAppId };

  if (method === 'docker') {
    try {
      execSync('docker-compose up -d', { stdio: 'inherit', env });
      log('ok', 'Docker container started');
    } catch {
      log('err', 'docker-compose up failed. Is docker-compose.yml present?');
      process.exit(1);
    }
  } else {
    // Start node in background
    const child = spawn('node', ['src/index.js'], {
      env,
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    log('ok', `Node started (PID ${child.pid})`);
  }

  // Step 10: Wait for server and open browser
  log('info', 'Waiting for dashboard...');
  await waitForServer(3000, 30);
  log('ok', 'Dashboard ready at http://localhost:3000');

  // Open browser
  try {
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
    execSync(`${cmd} http://localhost:3000`, { stdio: 'ignore' });
    log('ok', 'Browser opened');
  } catch {
    log('warn', 'Could not open browser automatically. Visit http://localhost:3000');
  }

  console.log('\n' + '='.repeat(50));
  console.log('🍐 QVAC-Pear Miner is running!');
  console.log('   Dashboard: http://localhost:3000');
  console.log('   API:       http://localhost:3000/api/status');
  console.log('='.repeat(50) + '\n');

  rl.close();
}

function waitForServer(port, maxSeconds) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const req = createServer().listen(0); // dummy to import http module
      // Actually try to connect
      import('net').then(({ createConnection }) => {
        const conn = createConnection(port, '127.0.0.1');
        conn.on('connect', () => {
          conn.end();
          clearInterval(interval);
          resolve();
        });
        conn.on('error', () => {
          if (attempts >= maxSeconds) {
            clearInterval(interval);
            reject(new Error('Server did not start in time'));
          }
        });
      });
    }, 1000);
  });
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
