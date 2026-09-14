/**
 * Chimera Fingerprint Module — served from new.localchimera.com
 *
 * SECURITY MODEL:
 *   This code is NOT trusted to be on the machine. It is fetched from
 *   new.localchimera.com on demand and executed inside a Node.js VM sandbox
 *   on the target machine. The sandbox provides limited access to `os`,
 *   `crypto`, and `child_process` (for hw-fingerprint style probes).
 *
 *   The machine's /api/fingerprint endpoint:
 *     1. Fetches this script from https://new.localchimera.com/fingerprint-module.js
 *     2. Runs it in a vm.createContext() sandbox
 *     3. Returns the fingerprint result to the caller
 *
 *   The caller then sends the fingerprint to new.localchimera.com for signing,
 *   creating a verifiable attestation that the machine cannot forge.
 *
 * This module exports a single async function: run(sandbox) → { fingerprint, trustScore, components }
 */

async function run(ctx) {
  const { os, crypto, execSync, logger } = ctx;
  const components = {};

  // ─── Hardware fingerprint ───
  try {
    components.hardware = {
      arch: os.arch(),
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || 'unknown',
      cpuSpeed: os.cpus()[0]?.speed || 0,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      platform: os.platform(),
      release: os.release(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      endianness: os.endianness(),
      userInfo: os.userInfo()?.username || 'unknown',
    };
  } catch (e) {
    if (logger) logger.warn('hardware collection failed: ' + e.message);
    components.hardware = { error: e.message };
  }

  // ─── CPU timing benchmark ───
  try {
    const N = 256;
    const A = new Float64Array(N * N);
    const B = new Float64Array(N * N);
    const C = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) { A[i] = Math.random(); B[i] = Math.random(); }

    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        let sum = 0;
        for (let k = 0; k < N; k++) sum += A[i * N + k] * B[k * N + j];
        C[i * N + j] = sum;
      }
    }
    const matrixTime = Date.now() - t0;

    // Sorting benchmark
    const arr = [];
    for (let i = 0; i < 50000; i++) arr.push(Math.random());
    const t1 = Date.now();
    arr.sort((a, b) => a - b);
    const sortTime = Date.now() - t1;

    // Hash benchmark
    const data = Buffer.alloc(1024 * 1024, 42);
    const t2 = Date.now();
    crypto.createHash('sha256').update(data).digest();
    const hashTime = Date.now() - t2;

    components.cpu = { matrixTime, sortTime, hashTime, cpuModel: components.hardware?.cpuModel || 'unknown' };
  } catch (e) {
    components.cpu = { error: e.message };
  }

  // ─── System probes via execSync (sandboxed) ───
  try {
    const probes = {};
    try { probes.dmi = execSync('dmidecode -t system 2>/dev/null | head -20', { timeout: 3000 }).toString().trim(); } catch {}
    try { probes.cpuinfo = execSync('cat /proc/cpuinfo 2>/dev/null | head -30', { timeout: 2000 }).toString().trim(); } catch {}
    try { probes.meminfo = execSync('cat /proc/meminfo 2>/dev/null | head -10', { timeout: 2000 }).toString().trim(); } catch {}
    try { probes.uuid = execSync('cat /sys/class/dmi/id/product_uuid 2>/dev/null || cat /etc/machine-id 2>/dev/null', { timeout: 2000 }).toString().trim(); } catch {}
    try { probes.disk = execSync('lsblk -d -o NAME,MODEL,SERIAL 2>/dev/null | head -10', { timeout: 2000 }).toString().trim(); } catch {}
    try { probes.mac = execSync('ip link show 2>/dev/null | grep ether | head -3', { timeout: 2000 }).toString().trim(); } catch {}
    try { probes.cgroup = execSync('cat /proc/1/cgroup 2>/dev/null | head -5', { timeout: 2000 }).toString().trim(); } catch {}
    try { probes.uname = execSync('uname -a 2>/dev/null', { timeout: 2000 }).toString().trim(); } catch {}
    components.systemProbes = probes;
  } catch (e) {
    components.systemProbes = { error: e.message };
  }

  // ─── VM / container detection ───
  try {
    const vmSignals = [];
    const cgroup = components.systemProbes?.cgroup || '';
    if (cgroup.includes('docker') || cgroup.includes('lxc') || cgroup.includes('containerd')) vmSignals.push('container-cgroup');
    if (cgroup.includes('kubepods')) vmSignals.push('kubernetes');
    if (components.hardware?.hostname?.match(/^[0-9a-f]{12}$/)) vmSignals.push('docker-hostname');
    if (components.systemProbes?.dmi?.includes('VirtualBox')) vmSignals.push('virtualbox');
    if (components.systemProbes?.dmi?.includes('VMware')) vmSignals.push('vmware');
    if (components.systemProbes?.dmi?.includes('KVM')) vmSignals.push('kvm');
    if (components.systemProbes?.dmi?.includes('QEMU')) vmSignals.push('qemu');
    if (components.systemProbes?.dmi?.includes('Xen')) vmSignals.push('xen');
    if (components.systemProbes?.dmi?.includes('Hyper-V')) vmSignals.push('hyperv');

    components.vmDetection = {
      isVM: vmSignals.length > 0,
      signals: vmSignals,
    };
  } catch (e) {
    components.vmDetection = { error: e.message };
  }

  // ─── Bot / automation detection ───
  try {
    const botSignals = [];
    if (process.env.DISPLAY === ':99') botSignals.push('headless-display');
    if (process.env.XVFB_ARGS) botSignals.push('xvfb');
    if (!process.env.TERM) botSignals.push('no-term');
    if (process.env.CHIMERA_HEADLESS === '1') botSignals.push('headless-flag');

    components.botDetection = {
      isBot: botSignals.length > 0,
      signals: botSignals,
    };
  } catch (e) {
    components.botDetection = { error: e.message };
  }

  // ─── Compute fingerprint hash ───
  const fingerprintData = JSON.stringify({
    h: components.hardware,
    c: components.cpu,
    s: {
      uuid: components.systemProbes?.uuid || '',
      dmi: components.systemProbes?.dmi || '',
      mac: components.systemProbes?.mac || '',
    },
  });
  const fingerprint = crypto.createHash('sha256').update(fingerprintData).digest('hex');

  // ─── Trust score ───
  let trustScore = 1.0;
  if (components.vmDetection?.isVM) trustScore -= 0.2;
  if (components.botDetection?.isBot) trustScore -= 0.3;
  if (components.hardware?.cpus <= 1) trustScore -= 0.1;
  if (components.hardware?.totalMemory < 1_073_741_824) trustScore -= 0.1;
  trustScore = Math.max(0, Math.min(1, trustScore));

  return {
    fingerprint,
    trustScore,
    components: {
      hardware: components.hardware,
      cpu: components.cpu,
      vmDetection: components.vmDetection,
      botDetection: components.botDetection,
      systemProbes: {
        uuid: components.systemProbes?.uuid || '',
        dmi: components.systemProbes?.dmi || '',
        uname: components.systemProbes?.uname || '',
      },
    },
  };
}

// Export for VM sandbox — the sandbox will call module.exports.run(ctx)
module.exports = { run };
