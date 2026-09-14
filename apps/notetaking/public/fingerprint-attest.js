/**
 * ChimeraDeviceAttestor — browser-based device fingerprinting served by new.localchimera.com
 *
 * SECURITY MODEL:
 *   Machines cannot be trusted to fingerprint themselves. This script is served
 *   from new.localchimera.com and runs in the device's browser/webview context.
 *   The website controls the fingerprinting code, collects the fingerprint, signs
 *   it, and reports it to the on-chain coordinator. The machine never generates
 *   its own fingerprint.
 *
 * USAGE (from any page or app webview):
 *   <script src="https://new.localchimera.com/fingerprint-attest.js"></script>
 *   const attestation = await ChimeraDeviceAttestor.attest();
 *   // → { fingerprint, trustScore, attestation, signedBy, timestamp }
 *   // Pass this to your /api/start as attestedFingerprint
 *
 * The script collects:
 *   - Browser fingerprint (canvas, WebGL, audio, fonts, navigator, screen, timezone)
 *   - CPU timing profile (matrix multiply, FFT, sorting benchmarks)
 *   - GPU fingerprint (WebGL renderer, vendor, shader precision)
 *   - Bot/automation detection (Puppeteer, Selenium, headless indicators)
 *   - VM/container indicators (where detectable from browser)
 *
 * Upstream: FingerprintJS, cispa/browser-cpu-fingerprinting, LockedApart, Drawn Apart
 */

const ATTEST_API = 'https://new.localchimera.com/api/attest-device';

const ChimeraDeviceAttestor = {
  async attest() {
    const components = await this._collectAll();
    const fingerprint = await this._hashComponents(components);
    const trustScore = this._computeTrustScore(components);

    // Send to website for attestation — the website signs and reports to coordinator
    const response = await fetch(ATTEST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fingerprint,
        trustScore,
        components: this._sanitizeComponents(components),
        timestamp: Date.now(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Attestation failed: ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Attestation rejected');
    }

    return {
      fingerprint: result.data.fingerprint,
      trustScore: result.data.trustScore,
      attestation: result.data.attestation,
      signedBy: result.data.signedBy,
      timestamp: result.data.timestamp,
      expiresAt: result.data.expiresAt,
    };
  },

  async _collectAll() {
    const [browser, cpu, gpu, bot, network] = await Promise.all([
      this._browserFingerprint(),
      this._cpuFingerprint(),
      this._gpuFingerprint(),
      this._botDetection(),
      this._networkFingerprint(),
    ]);

    return { browser, cpu, gpu, bot, network };
  },

  async _browserFingerprint() {
    const nav = navigator;
    const screen = window.screen;

    // Canvas fingerprint
    let canvasHash = '';
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 60;
      const ctx = canvas.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(0, 0, 100, 30);
      ctx.fillStyle = '#069';
      ctx.fillText('Chimera fingerprint 🦎', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('Chimera fingerprint 🦎', 4, 17);
      canvasHash = canvas.toDataURL();
    } catch {}

    // Audio fingerprint
    let audioHash = '';
    try {
      const AudioCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx(1, 5000, 44100);
        const oscillator = ctx.createOscillator();
        oscillator.type = 'triangle';
        oscillator.frequency.value = 1000;
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -50;
        compressor.knee.value = 40;
        compressor.ratio.value = 12;
        compressor.attack.value = 0;
        compressor.release.value = 0.25;
        oscillator.connect(compressor);
        compressor.connect(ctx.destination);
        oscillator.start(0);
        const buffer = await ctx.startRendering();
        const samples = buffer.getChannelData(0);
        let sum = 0;
        for (let i = 4500; i < 5000; i++) sum += Math.abs(samples[i]);
        audioHash = sum.toString();
      }
    } catch {}

    // Font detection
    const fonts = this._detectFonts();

    return {
      userAgent: nav.userAgent,
      language: nav.language,
      languages: (nav.languages || []).join(','),
      platform: nav.platform,
      hardwareConcurrency: nav.hardwareConcurrency || 0,
      deviceMemory: nav.deviceMemory || 0,
      maxTouchPoints: nav.maxTouchPoints || 0,
      screenResolution: `${screen.width}x${screen.height}`,
      screenColorDepth: screen.colorDepth,
      screenPixelRatio: window.devicePixelRatio,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezoneOffset: new Date().getTimezoneOffset(),
      canvasHash: canvasHash.slice(0, 100),
      audioHash: audioHash.slice(0, 50),
      fonts: fonts,
      cookieEnabled: nav.cookieEnabled,
      doNotTrack: nav.doNotTrack,
      vendor: nav.vendor,
      webDriver: nav.webdriver,
      pdfViewerEnabled: nav.pdfViewerEnabled,
      connectionType: nav.connection?.effectiveType || '',
      connectionDownlink: nav.connection?.downlink || 0,
    };
  },

  _detectFonts() {
    const testFonts = ['Arial', 'Courier New', 'Georgia', 'Helvetica', 'Impact', 'Times New Roman', 'Verdana', 'Comic Sans MS', 'monospace', 'sans-serif', 'serif'];
    const testString = 'mmmmmmmmmmlli';
    const testSize = '72px';
    const baselineFonts = ['monospace', 'sans-serif', 'serif'];
    const detected = [];

    const getDimensions = (font) => {
      const span = document.createElement('span');
      span.style.position = 'absolute';
      span.style.left = '-9999px';
      span.style.fontSize = testSize;
      span.style.fontFamily = font;
      span.textContent = testString;
      document.body.appendChild(span);
      const dims = { w: span.offsetWidth, h: span.offsetHeight };
      document.body.removeChild(span);
      return dims;
    };

    const baselines = {};
    for (const bf of baselineFonts) baselines[bf] = getDimensions(bf);

    for (const font of testFonts) {
      for (const bf of baselineFonts) {
        const dims = getDimensions(`"${font}", ${bf}`);
        if (dims.w !== baselines[bf].w || dims.h !== baselines[bf].h) {
          if (!detected.includes(font)) detected.push(font);
          break;
        }
      }
    }
    return detected;
  },

  async _cpuFingerprint() {
    const benchmarks = {
      matrixMultiply: this._benchMatrixMultiply(),
      fft: this._benchFFT(),
      sorting: this._benchSorting(),
    };
    return benchmarks;
  },

  _benchMatrixMultiply() {
    const N = 64;
    const A = new Float64Array(N * N);
    const B = new Float64Array(N * N);
    const C = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) { A[i] = Math.random(); B[i] = Math.random(); }

    const start = performance.now();
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        let sum = 0;
        for (let k = 0; k < N; k++) sum += A[i * N + k] * B[k * N + j];
        C[i * N + j] = sum;
      }
    }
    return performance.now() - start;
  },

  _benchFFT() {
    const N = 1024;
    const real = new Float64Array(N);
    const imag = new Float64Array(N);
    for (let i = 0; i < N; i++) real[i] = Math.random();

    const start = performance.now();
    for (let step = 1; step < N; step *= 2) {
      for (let i = 0; i < N; i += 2 * step) {
        for (let j = 0; j < step; j++) {
          const angle = -2 * Math.PI * j / (2 * step);
          const wr = Math.cos(angle);
          const wi = Math.sin(angle);
          const tr = wr * real[i + j + step] - wi * imag[i + j + step];
          const ti = wr * imag[i + j + step] + wi * real[i + j + step];
          real[i + j + step] = real[i + j] - tr;
          imag[i + j + step] = imag[i + j] - ti;
          real[i + j] += tr;
          imag[i + j] += ti;
        }
      }
    }
    return performance.now() - start;
  },

  _benchSorting() {
    const N = 10000;
    const arr = new Float64Array(N);
    for (let i = 0; i < N; i++) arr[i] = Math.random();

    const start = performance.now();
    const sorted = Array.from(arr).sort((a, b) => a - b);
    return performance.now() - start;
  },

  async _gpuFingerprint() {
    const result = { vendor: '', renderer: '', vendorUnmasked: '', rendererUnmasked: '', precision: '' };
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return result;

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        result.vendorUnmasked = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '';
        result.rendererUnmasked = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
      }
      result.vendor = gl.getParameter(gl.VENDOR) || '';
      result.renderer = gl.getParameter(gl.RENDERER) || '';

      const shaderPrecision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      if (shaderPrecision) {
        result.precision = `${shaderPrecision.precision}:${shaderPrecision.rangeMin}:${shaderPrecision.rangeMax}`;
      }

      // Shader benchmark — render a gradient and sample pixels
      const vs = 'attribute vec4 pos; void main() { gl_Position = pos; }';
      const fs = 'precision highp float; void main() { gl_FragColor = vec4(0.5, 0.3, 0.8, 1.0); }';
      const program = gl.createProgram();
      const vsh = gl.createShader(gl.VERTEX_SHADER);
      const fsh = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(vsh, vs);
      gl.shaderSource(fsh, fs);
      gl.compileShader(vsh);
      gl.compileShader(fsh);
      gl.attachShader(program, vsh);
      gl.attachShader(program, fsh);
      gl.linkProgram(program);
      gl.useProgram(program);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, 'pos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      const pixels = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      result.pixelHash = Array.from(pixels).join(',');
    } catch {}
    return result;
  },

  _botDetection() {
    const signals = [];
    const nav = navigator;

    if (nav.webdriver) signals.push('navigator.webdriver=true');
    if (!nav.languages || nav.languages.length === 0) signals.push('no-languages');
    if (nav.userAgent.includes('HeadlessChrome')) signals.push('headless-chrome');
    if (nav.userAgent.includes('PhantomJS')) signals.push('phantomjs');
    if (nav.userAgent.includes('SlimerJS')) signals.push('slimerjs');
    if (nav.userAgent.includes('nightmare')) signals.push('nightmare');
    if (window.outerWidth === 0 && window.outerHeight === 0) signals.push('zero-outer-dimensions');
    if (!window.chrome && /Chrome/.test(nav.userAgent)) signals.push('chrome-without-window.chrome');
    if (nav.plugins && nav.plugins.length === 0 && /Firefox/.test(nav.userAgent)) signals.push('firefox-no-plugins');

    // Check for automation frameworks
    if (window.__nightmare) signals.push('nightmare-global');
    if (window.callPhantom) signals.push('phantom-global');
    if (window._phantom) signals.push('phantom-global-2');
    if (window.domAutomationController) signals.push('dom-automation');
    if (window.document.$cdc_asdjflasutopfhvcZLmcfl_) signals.push('chrome-devtools-protocol');

    // Permissions check — headless browsers often have weird permission behavior
    try {
      const notif = window.Notification;
      if (notif && notif.permission === 'denied' && nav.permissions) {
        // In headless, permission API may disagree with Notification API
      }
    } catch {}

    // Check for Selenium
    if (document.documentElement.getAttribute('selenium') !== null) signals.push('selenium-attribute');
    if (document.documentElement.getAttribute('webdriver') !== null) signals.push('webdriver-attribute');

    return {
      isBot: signals.length > 0,
      signals,
      botCount: signals.length,
    };
  },

  _networkFingerprint() {
    return {
      protocol: window.location.protocol,
      host: window.location.hostname,
      port: window.location.port,
      online: navigator.onLine,
      connectionType: navigator.connection?.effectiveType || 'unknown',
      rtt: navigator.connection?.rtt || 0,
      downlink: navigator.connection?.downlink || 0,
      saveData: navigator.connection?.saveData || false,
    };
  },

  _computeTrustScore(components) {
    let score = 1.0;

    // Bot detection — major penalty
    if (components.bot.isBot) {
      score -= 0.5 * Math.min(components.bot.botCount, 3);
    }

    // Headless browser — major penalty
    if (components.browser.webDriver) score -= 0.3;

    // No WebGL — likely headless
    if (!components.gpu.renderer) score -= 0.2;

    // No canvas — likely headless
    if (!components.browser.canvasHash) score -= 0.2;

    // Very low hardware — possible VM
    if (components.browser.hardwareConcurrency <= 1) score -= 0.1;
    if (components.browser.deviceMemory <= 1) score -= 0.1;

    // No audio — likely headless
    if (!components.browser.audioHash) score -= 0.1;

    // No fonts detected — likely headless
    if (components.browser.fonts.length < 3) score -= 0.1;

    return Math.max(0, Math.min(1, score));
  },

  _sanitizeComponents(components) {
    // Only send what the attestation server needs — strip raw hashes for privacy
    return {
      browser: {
        platform: components.browser.platform,
        hardwareConcurrency: components.browser.hardwareConcurrency,
        deviceMemory: components.browser.deviceMemory,
        screenResolution: components.browser.screenResolution,
        timezone: components.browser.timezone,
        vendor: components.browser.vendor,
        webDriver: components.browser.webDriver,
        fontsCount: components.browser.fonts.length,
        hasCanvas: !!components.browser.canvasHash,
        hasAudio: !!components.browser.audioHash,
      },
      cpu: components.cpu,
      gpu: {
        vendor: components.gpu.vendor,
        renderer: components.gpu.renderer,
        vendorUnmasked: components.gpu.vendorUnmasked,
        rendererUnmasked: components.gpu.rendererUnmasked,
        hasPrecision: !!components.gpu.precision,
      },
      bot: components.bot,
      network: {
        online: components.network.online,
        connectionType: components.network.connectionType,
        rtt: components.network.rtt,
      },
    };
  },

  async _hashComponents(components) {
    const data = JSON.stringify({
      b: components.browser,
      c: components.cpu,
      g: components.gpu,
      bt: components.bot,
      n: components.network,
    });
    const encoder = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },
};

// Auto-attach to window for non-module usage
if (typeof window !== 'undefined') {
  window.ChimeraDeviceAttestor = ChimeraDeviceAttestor;
}

// Also support ES module import
export default ChimeraDeviceAttestor;
