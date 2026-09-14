# Upstream Tracking — Device Fingerprinting

This document tracks the upstream repositories whose code and approaches are used in `qvac/src/auth/DeviceFingerprinter.js` for fingerprinting untrusted devices that contribute resources via the in-app mining interface.

## Hardware Fingerprinting

| Project | Upstream Repo | License | How We Consume | What We Use |
|---|---|---|---|---|
| **hw-fingerprint** | `github.com/andsmedeiros/hw-fingerprint` | MIT | npm dependency | Node.js hardware fingerprinting via `systeminformation`. Produces a 512-bit signature from CPU, BIOS, motherboard, HDD, and OS info. Used as the primary hardware fingerprint component. Falls back to `os` module info if unavailable. |

## CPU Fingerprinting

| Project | Upstream Repo | License | How We Consume | What We Use |
|---|---|---|---|---|
| **browser-cpu-fingerprinting** | `github.com/cispa/browser-cpu-fingerprinting` | MIT | Ported approach | CPU identification via benchmark timing profiles. We port their profiler approach with 3 benchmark kernels (matrix multiply, FFT, sorting) and 5 trials each. Relative timing ratios between kernels identify CPU families. |

## LLM Fingerprinting

| Project | Upstream Repo | License | How We Consume | What We Use |
|---|---|---|---|---|
| **llm-fingerprint** | `github.com/S1M0N38/llm-fingerprint` | MIT | Ported approach | LLM identification via semantic similarity patterns across standardized prompts. We port their prompt-based fingerprinting with multiple response samples per prompt. |
| **LLM-Fingerprinter** | `github.com/litemars/LLM-Fingerprinter` | MIT | Ported approach | LLM model family identification via layered prompts. We use their 3-layer approach: discriminative (identity, knowledge, reasoning) → behavioral (safety, policy) → stylistic (formatting, creativity). Ensemble fingerprint across all layers. |
| **julius** | `github.com/praetorian-inc/julius` | MIT | Adapted approach | LLM service fingerprinting via probe matching. We adapt their probe-based identification for quick single-output verification during job submission. |

## Trust Scoring (Reference)

| Project | Upstream Repo | License | How We Consume | Notes |
|---|---|---|---|---|
| **DeviceFingerprinting** | `github.com/Johnsonajibi/DeviceFingerprinting` | MIT | Reference only | Python library for device fingerprinting with TPM support. Not directly usable in Node.js. Used as reference for trust scoring model and anomaly detection patterns. |
| **hardware-fingerprint** | `github.com/topics/hardware-fingerprint` | Various | Reference only | GitHub topic page listing hardware fingerprinting projects. Used for research and approach validation. |

## Browser SDK Fingerprinting (separate module)

The browser SDK (`volunteer-map/frontend/js/chimera-fingerprint.js`) uses additional repos not applicable to the Node.js backend:

| Project | Upstream Repo | License | How We Consume | What We Use |
|---|---|---|---|---|
| **FingerprintJS** | `github.com/fingerprintjs/fingerprintjs` | MIT | CDN import (browser only) | Canvas, WebGL, audio, fonts, navigator, screen, timezone fingerprinting in the browser SDK. |
| **LockedApart** | `github.com/LockedApart/LockedApart` | MIT | Ported approach (browser only) | GPU fingerprinting via WebGPU compute API timing in the browser SDK. |
| **Drawn Apart** | `github.com/drawnapart/drawnapart` | MIT | Ported approach (browser only) | GPU fingerprinting via WebGL rendering differences in the browser SDK. |

## Integration Architecture

```
qvac/src/auth/DeviceFingerprinter.js (Node.js backend)
├── hw-fingerprint (npm) ────── hardware fingerprint (CPU, BIOS, motherboard, HDD)
├── cispa approach ──────────── CPU timing profile (matrix multiply, FFT, sort)
├── S1M0N38 approach ────────── LLM fingerprint (discriminative prompts)
├── litemars approach ───────── LLM fingerprint (layered: disc → behav → style)
├── praetorian approach ─────── LLM quick fingerprint (probe-based)
└── Our code ─────────────────── VM detection, bot detection, trust scoring

volunteer-map/frontend/js/chimera-fingerprint.js (browser SDK)
├── FingerprintJS v5 (CDN) ─── browser fingerprint (canvas, WebGL, audio, fonts)
├── LockedApart approach ────── GPU compute timing (WebGPU WGSL shader)
├── Drawn Apart approach ────── GPU render fingerprint (WebGL pixel sampling)
├── cispa approach ──────────── CPU timing profile (matrix multiply, FFT, sort)
├── S1M0N38 approach ────────── LLM fingerprint (discriminative prompts)
├── litemars approach ───────── LLM fingerprint (layered: disc → behav → style)
├── praetorian approach ─────── LLM quick fingerprint (probe-based)
└── Our code ─────────────────── bot detection, trust scoring, on-chain registration
```

## Integration Points

- **`server.js` `handleStart()`**: Generates device fingerprint before miners start, logs trust score, includes fingerprint in escrow registration `deviceProfile`, returns fingerprint in API response.
- **`server.js` `handleStatus()`**: Includes device fingerprint hash + trust score in status response.
- **Desktop `Dashboard.tsx`**: Shows "Device Identity" panel with fingerprint hash and trust score badge.
- **Web `WikiPage.jsx`**: Shows device fingerprint hash and trust score in miner node section.

## Updating

To update `hw-fingerprint`:
```bash
cd qvac && npm update hw-fingerprint
```

To update ported approaches (cispa, LLM fingerprinting), review the upstream repos for new techniques and update the corresponding methods in `qvac/src/auth/DeviceFingerprinter.js`.

## Resource Monitoring (SDK)

The SDK dynamically monitors system resources to ensure mining doesn't affect the machine's function. Providers are paused when CPU/memory exceeds thresholds and resumed when load normalizes.

| Project | Upstream Repo | License | How We Consume | What We Use |
|---|---|---|---|---|
| **system-resource-monitor** | `github.com/pfaciana/system-resource-monitor` | MIT | npm dependency (optional) | CPU usage, memory usage, per-thread monitoring, threshold checks. Used in Node.js (machine app) mode via `sdk/src/core/resource-monitor.js`. Falls back to `os` module if not installed. |
| **PerformanceObserver API** | W3C standard | N/A | Native browser API | Long task detection, main thread pressure monitoring. Used in browser mode via `browser-sdk/src/browser-node.ts`. No external library needed. |
| **Network Information API** | W3C standard | N/A | Native browser API | `navigator.connection.saveData`, `effectiveType` for bandwidth-aware throttling in browser mode. |

### Throttle thresholds

| Mode | CPU Pause | CPU Resume | Memory Pause | Memory Resume | Disk Pause | Disk Resume | Bandwidth Pause | Bandwidth Resume |
|------|-----------|------------|-------------|---------------|-----------|------------|-----------------|-----------------|
| **Node.js (machine)** | 80% | 60% | 85% | 70% | 90% | 80% | 85% utilization | 60% utilization |
| **Browser** | 70% | 50% | 80% | 60% | 85% | 70% | < 2 Mbps | ≥ 5 Mbps |

Browser thresholds are stricter to ensure the user's browsing experience is never affected.

**Node.js bandwidth monitoring**: reads `/proc/net/dev` (Linux) or `netstat -ib` (macOS) to measure actual network throughput. Pauses at 85% of assumed link capacity (1000 Mbps default).

**Browser bandwidth monitoring**: uses `navigator.connection.downlink` (Network Information API) for effective bandwidth, `navigator.connection.rtt` for latency, and `navigator.connection.saveData` for data-saver mode. Pauses if bandwidth drops below 2 Mbps, RTT exceeds 500ms, or saveData is enabled on 2g/slow-2g.

**Storage monitoring**:
- Node.js: `fs.statfs()` (Node 18+ built-in) checks disk usage of `~/.chimera` data directory. Falls back to `df` command.
- Browser: `navigator.storage.estimate()` (Storage API) checks browser storage quota usage.

To update `system-resource-monitor`:
```bash
npm update system-resource-monitor
```
