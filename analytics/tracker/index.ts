/**
 * Chimera Analytics Tracker — advanced privacy-first analytics + resource sharing.
 *
 * Analytics:
 *   - Pageview tracking with SPA route detection (pushState/replaceState/popstate)
 *   - Click tracking (links, buttons, outbound detection)
 *   - Scroll depth tracking (25/50/75/100%)
 *   - Engagement time tracking (visibility-aware, activity-based)
 *   - Session tracking via sessionStorage
 *   - Unique visitor fingerprint via localStorage + crypto
 *   - Device capability detection (CPU, RAM, GPU, WebGPU, WebRTC, storage)
 *   - Error tracking (uncaught exceptions + unhandled rejections)
 *   - Performance metrics (page load, DOM ready, TTFB, DNS)
 *   - Batched event sending with sendBeacon
 *
 * Resource sharing:
 *   - Auto-loads @localchimera/browser-sdk from CDN (esm.sh)
 *   - Runs BrowserNode in relay mode (no wallet needed to start)
 *   - Wallet connection UI (injected EVM provider, Robinhood Chain)
 *   - Real-time status (jobs, earnings, capabilities, throttle)
 *   - Dismissable badge with localStorage persistence
 *
 * Embed:
 *   <script src="https://analytics.localchimera.com/tracker.js"
 *     data-site-id="YOUR_SITE_ID"
 *     data-chimera="true"
 *     defer></script>
 *
 * Optional attributes:
 *   data-endpoint="https://custom-endpoint/api/events"
 *   data-sdk-url="https://custom-cdn/browser-sdk.js"
 */

interface TrackerConfig {
  siteId: string;
  endpoint?: string;
  chimera?: boolean;
  sdkUrl?: string;
}

interface TrackerEvent {
  type: string;
  siteId: string;
  ts: number;
  sessionId: string;
  visitorId: string;
  url: string;
  ref?: string;
  [key: string]: unknown;
}

const SDK_CDN_URL = 'https://esm.sh/@localchimera/browser-sdk@1.0.5';
const SCROLL_MARKS = [25, 50, 75, 100];
const ENGAGEMENT_INTERVAL = 15000;
const MAX_QUEUE = 100;

class ChimeraTracker {
  private config: TrackerConfig;
  private endpoint: string;
  private queue: TrackerEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private chimeraDismissed: boolean;
  private sessionId: string;
  private visitorId: string;
  private maxScroll = 0;
  private scrollMarksHit = new Set<number>();
  private engagementTime = 0;
  private engagementTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivity = Date.now();
  private node: any = null;
  private badge: HTMLDivElement | null = null;
  private capabilities: any = null;

  constructor(config: TrackerConfig) {
    this.config = config;
    this.endpoint = config.endpoint || 'https://analytics.localchimera.com/api/events';
    this.chimeraDismissed = localStorage.getItem('oas_chimera_dismissed') === 'true';
    this.sessionId = this.getOrCreateSession();
    this.visitorId = this.getOrCreateVisitorId();
  }

  // ─── Lifecycle ───

  init() {
    this.detectCapabilities();
    this.trackPageview();
    this.bindAnalytics();
    this.startEngagementTracking();
    this.flushTimer = setInterval(() => this.flush(), 10000);

    if (this.config.chimera && !this.chimeraDismissed) {
      this.initChimera();
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.trackEngagement();
        this.flush(true);
      } else {
        this.lastActivity = Date.now();
      }
    });

    window.addEventListener('pagehide', () => {
      this.trackEngagement();
      this.flush(true);
    });
  }

  // ─── Session & Visitor ───

  private getOrCreateSession(): string {
    let id = sessionStorage.getItem('oas_session_id');
    if (!id) {
      id = this.generateId();
      sessionStorage.setItem('oas_session_id', id);
    }
    return id;
  }

  private getOrCreateVisitorId(): string {
    let id = localStorage.getItem('oas_visitor_id');
    if (!id) {
      id = this.generateId();
      localStorage.setItem('oas_visitor_id', id);
    }
    return id;
  }

  private generateId(): string {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ─── Event sending ───

  private send(event: Omit<TrackerEvent, 'siteId' | 'ts' | 'sessionId' | 'visitorId'>) {
    const fullEvent: TrackerEvent = {
      ...event,
      siteId: this.config.siteId,
      ts: Date.now(),
      sessionId: this.sessionId,
      visitorId: this.visitorId,
      url: location.href,
      ref: document.referrer || undefined,
    };

    this.queue.push(fullEvent);
    if (this.queue.length > MAX_QUEUE) this.queue.shift();

    if (event.type === 'pageview' || event.type === 'error') {
      this.flush();
    }
  }

  private flush(useBeacon = false) {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0);
    const payload = JSON.stringify(batch);

    if (navigator.sendBeacon) {
      navigator.sendBeacon(this.endpoint, payload);
    } else {
      fetch(this.endpoint, {
        method: 'POST',
        body: payload,
        headers: { 'content-type': 'application/json' },
        keepalive: true,
      }).catch(() => {
        this.queue.unshift(...batch);
      });
    }
  }

  // ─── Analytics: Pageview ───

  private trackPageview() {
    const perf = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    this.send({
      type: 'pageview',
      loadTime: perf ? Math.round(perf.loadEventEnd - perf.startTime) : 0,
      domReady: perf ? Math.round(perf.domContentLoadedEventEnd - perf.startTime) : 0,
      ttfb: perf ? Math.round(perf.responseStart - perf.startTime) : 0,
      dnsTime: perf ? Math.round(perf.domainLookupEnd - perf.domainLookupStart) : 0,
    });
  }

  // ─── Analytics: SPA route detection ───

  private patchHistory() {
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    const self = this;

    history.pushState = function (...args: any[]) {
      const ret = origPush.apply(this, args as any);
      setTimeout(() => self.onRouteChange(), 0);
      return ret;
    };
    history.replaceState = function (...args: any[]) {
      const ret = origReplace.apply(this, args as any);
      setTimeout(() => self.onRouteChange(), 0);
      return ret;
    };
    window.addEventListener('popstate', () => this.onRouteChange());
  }

  private onRouteChange() {
    this.maxScroll = 0;
    this.scrollMarksHit.clear();
    this.engagementTime = 0;
    this.trackPageview();
  }

  // ─── Analytics: Click tracking ───

  private bindClicks() {
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a') as HTMLAnchorElement | null;
      const btn = target.closest('button') as HTMLButtonElement | null;

      if (link) {
        const href = link.getAttribute('href') || '';
        const isOutbound = href.startsWith('http') && !href.includes(location.hostname);
        this.send({
          type: 'click',
          tag: 'a',
          href,
          text: (link.textContent || '').slice(0, 120),
          outbound: isOutbound,
        });
      } else if (btn) {
        this.send({
          type: 'click',
          tag: 'button',
          text: (btn.textContent || '').slice(0, 120),
          id: btn.id || undefined,
        });
      }
    }, { passive: true });
  }

  // ─── Analytics: Scroll depth ───

  private bindScroll() {
    window.addEventListener('scroll', () => {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollHeight <= 0) return;
      const scrollPercent = Math.round((window.scrollY / scrollHeight) * 100);
      if (scrollPercent > this.maxScroll) this.maxScroll = scrollPercent;

      for (const mark of SCROLL_MARKS) {
        if (scrollPercent >= mark && !this.scrollMarksHit.has(mark)) {
          this.scrollMarksHit.add(mark);
          this.send({ type: 'scroll', depth: mark });
        }
      }
    }, { passive: true });
  }

  // ─── Analytics: Engagement time ───

  private startEngagementTracking() {
    this.lastActivity = Date.now();

    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
      document.addEventListener(evt, () => {
        this.lastActivity = Date.now();
      }, { passive: true });
    });

    this.engagementTimer = setInterval(() => {
      if (!document.hidden && Date.now() - this.lastActivity < 60000) {
        this.engagementTime += ENGAGEMENT_INTERVAL;
      }
    }, ENGAGEMENT_INTERVAL);
  }

  private trackEngagement() {
    if (this.engagementTime > 0) {
      this.send({
        type: 'engagement',
        timeMs: this.engagementTime,
        maxScroll: this.maxScroll,
      });
      this.engagementTime = 0;
    }
  }

  // ─── Analytics: Error tracking ───

  private bindErrors() {
    window.addEventListener('error', (e) => {
      this.send({
        type: 'error',
        message: (e.message || '').slice(0, 500),
        filename: (e.filename || '').slice(0, 200),
        lineno: e.lineno,
        colno: e.colno,
      });
    });
    window.addEventListener('unhandledrejection', (e) => {
      this.send({
        type: 'error',
        message: `Unhandled rejection: ${String(e.reason)?.slice(0, 500)}`,
      });
    });
  }

  // ─── Analytics: Device capabilities ───

  private detectCapabilities() {
    this.capabilities = {
      cpuCores: navigator.hardwareConcurrency || 0,
      ramGb: (navigator as any).deviceMemory || 0,
      platform: navigator.platform || 'unknown',
      language: navigator.language,
      screenResolution: `${screen.width}x${screen.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      dpr: window.devicePixelRatio,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      hasWebGPU: !!(navigator as any).gpu,
      hasWebRTC: typeof RTCPeerConnection !== 'undefined',
      hasIndexedDB: typeof indexedDB !== 'undefined',
      hasServiceWorker: 'serviceWorker' in navigator,
      connectionType: (navigator as any).connection?.effectiveType || 'unknown',
      saveData: (navigator as any).connection?.saveData || false,
    };

    this.send({ type: 'device', ...this.capabilities });
  }

  // ─── Bind all analytics ───

  private bindAnalytics() {
    this.patchHistory();
    this.bindClicks();
    this.bindScroll();
    this.bindErrors();
  }

  // ─── Resource sharing (Chimera) ───

  private async initChimera() {
    this.injectBadge('loading');

    try {
      const sdkUrl = this.config.sdkUrl || SDK_CDN_URL;
      const sdk = await import(/* @vite-ignore */ sdkUrl);
      this.injectBadge(sdk);
    } catch {
      this.injectBadge(null);
    }
  }

  private injectBadge(sdk: any) {
    this.badge?.remove();

    const badge = document.createElement('div');
    badge.id = 'chimera-badge';
    badge.style.cssText = this.badgeCSS();
    this.badge = badge;

    if (sdk === 'loading') {
      badge.innerHTML = this.loadingHTML();
    } else if (sdk && sdk.quickStart) {
      badge.innerHTML = this.readyHTML(this.capabilities);
      this.bindBadgeActions(sdk, badge);
    } else {
      badge.innerHTML = this.unavailableHTML();
    }

    document.body.appendChild(badge);
  }

  private bindBadgeActions(sdk: any, badge: HTMLDivElement) {
    badge.querySelector('#chimera-start')?.addEventListener('click', async () => {
      badge.innerHTML = this.startingHTML();
      try {
        this.node = await sdk.quickStart(undefined, undefined, undefined, {
          onStatus: (status: any) => this.updateBadgeStatus(badge, status),
        });
        badge.innerHTML = this.runningHTML();
        this.bindStopAction(sdk, badge);
      } catch (e: any) {
        badge.innerHTML = this.errorHTML(`Start failed: ${e.message}`);
      }
    });

    badge.querySelector('#chimera-connect')?.addEventListener('click', async () => {
      const provider = (window as any).ethereum;
      if (!provider) {
        badge.innerHTML = this.errorHTML('No Web3 wallet found. Install MetaMask.');
        return;
      }
      try {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1237' }] });
      } catch {
        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0x1237',
              chainName: 'Robinhood Chain',
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
              blockExplorerUrls: ['https://robinhoodchain.blockscout.com'],
            }],
          });
        } catch {}
      }
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      badge.innerHTML = this.connectingHTML();
      try {
        this.node = await sdk.quickStart(provider, undefined, undefined, {
          onStatus: (status: any) => this.updateBadgeStatus(badge, status),
        });
        badge.innerHTML = this.earningHTML(accounts[0]);
        this.bindStopAction(sdk, badge);
      } catch (e: any) {
        badge.innerHTML = this.errorHTML(`Wallet connect failed: ${e.message}`);
      }
    });

    badge.querySelector('#chimera-dismiss')?.addEventListener('click', () => {
      localStorage.setItem('oas_chimera_dismissed', 'true');
      badge.remove();
    });
  }

  private bindStopAction(sdk: any, badge: HTMLDivElement) {
    badge.querySelector('#chimera-stop')?.addEventListener('click', async () => {
      if (this.node) { try { await this.node.stop(); } catch {} }
      badge.innerHTML = this.readyHTML(this.capabilities);
      this.bindBadgeActions(sdk, badge);
    });
  }

  private updateBadgeStatus(badge: HTMLDivElement, status: any) {
    const el = badge.querySelector('#chimera-status');
    if (!el) return;
    const jobs = status.jobsProcessed || 0;
    const earnings = BigInt(status.earningsMotes || '0');
    const running = status.running ? '🟢 Active' : '🔴 Stopped';
    const paused = status.resourcePaused ? ' ⏸ Throttled' : '';
    el.textContent = `${running}${paused} · Jobs: ${jobs} · Earnings: ${earnings.toString()} motes`;
  }

  // ─── Tokenomics Event Tracking ───

  /**
   * Track a CHIMERA staking event.
   * Called when a provider stakes or unstakes CHIMERA.
   */
  trackStakingEvent(action: 'stake' | 'unstake' | 'claim_unstake' | 'claim_rewards', amount: string, lockPeriodDays?: number) {
    this.send({
      type: 'tokenomics_staking',
      action,
      amount,
      lockPeriodDays: lockPeriodDays ?? 0,
    });
  }

  /**
   * Track a slashing event.
   * Called when a provider is slashed by the coordinator.
   */
  trackSlashEvent(provider: string, slashAmount: string, refundAmount: string, burnedAmount: string, offenseCount: number) {
    this.send({
      type: 'tokenomics_slash',
      provider,
      slashAmount,
      refundAmount,
      burnedAmount,
      offenseCount,
    });
  }

  /**
   * Track a governance event.
   * Called when a proposal is created, voted on, or executed.
   */
  trackGovernanceEvent(action: 'propose' | 'vote' | 'execute' | 'cancel', proposalId: number, support?: boolean, description?: string) {
    this.send({
      type: 'tokenomics_governance',
      action,
      proposalId,
      support,
      description,
    });
  }

  /**
   * Track a premium feature burn.
   * Called when a provider burns CHIMERA to unlock a premium feature.
   */
  trackPremiumBurn(provider: string, featureId: number, burnAmount: string) {
    this.send({
      type: 'tokenomics_premium_burn',
      provider,
      featureId,
      burnAmount,
    });
  }

  /**
   * Track a consumer boost stake/unstake.
   * Called when a consumer stakes CHIMERA for job priority boost.
   */
  trackConsumerBoost(action: 'stake' | 'unstake', amount: string) {
    this.send({
      type: 'tokenomics_consumer_boost',
      action,
      amount,
    });
  }

  /**
   * Track a Proof-of-Inference settlement burn.
   * Called when PoI settlement burns 10% of the settlement amount.
   */
  trackPoIBurn(merkleRoot: string, settlementAmount: string, burnAmount: string) {
    this.send({
      type: 'tokenomics_poi_burn',
      merkleRoot,
      settlementAmount,
      burnAmount,
    });
  }

  /**
   * Track a circuit breaker status change.
   * Called when the circuit breaker is triggered or reset.
   */
  trackCircuitBreaker(triggered: boolean, slashVolume24h: string, totalStaked: string) {
    this.send({
      type: 'tokenomics_circuit_breaker',
      triggered,
      slashVolume24h,
      totalStaked,
    });
  }

  /**
   * Track a buyback and burn event.
   * Called when the coordinator executes a buyback and burns CHIMERA.
   */
  trackBuybackBurn(chimeraBurned: string, wethSpent: string) {
    this.send({
      type: 'tokenomics_buyback_burn',
      chimeraBurned,
      wethSpent,
    });
  }

  /**
   * Track a referral bonus payment.
   * Called when a referral bonus is paid to a referrer.
   */
  trackReferralBonus(referrer: string, referee: string, amount: string) {
    this.send({
      type: 'tokenomics_referral',
      referrer,
      referee,
      amount,
    });
  }

  // ─── Badge HTML ───

  private badgeCSS(): string {
    return [
      'position:fixed', 'bottom:16px', 'right:16px', 'z-index:99999',
      'font-family:system-ui,-apple-system,sans-serif',
      'background:linear-gradient(135deg,#0f0e17,#1a1a2e)',
      'color:#e8e2d8', 'border-radius:14px', 'padding:0',
      'box-shadow:0 8px 32px rgba(0,0,0,0.4)',
      'max-width:300px', 'overflow:hidden',
      'border:1px solid rgba(255,255,255,0.08)',
    ].join(';');
  }

  private loadingHTML(): string {
    return `<div style="padding:16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:1.3rem;">⬡</span>
        <strong style="font-size:0.85rem;">Chimera</strong>
      </div>
      <p style="font-size:0.75rem;opacity:0.6;margin:0;">Loading resource sharing…</p>
    </div>`;
  }

  private readyHTML(caps: any): string {
    const gpu = caps?.hasWebGPU ? '✅ WebGPU' : '❌ WebGPU';
    const cpu = caps?.cpuCores ? `${caps.cpuCores} CPU` : 'CPU?';
    const ram = caps?.ramGb ? `${caps.ramGb}GB RAM` : 'RAM?';
    return `<div style="padding:16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:1.3rem;">⬡</span>
        <strong style="font-size:0.85rem;flex:1;">Chimera Resource Sharing</strong>
        <span id="chimera-dismiss" style="cursor:pointer;opacity:0.4;font-size:1rem;padding:0 4px;">✕</span>
      </div>
      <p style="font-size:0.75rem;opacity:0.7;margin:0 0 10px;">Share idle compute, storage, bandwidth & AI inference. Earn on Robinhood Chain.</p>
      <div style="font-size:0.7rem;opacity:0.5;margin-bottom:10px;font-family:ui-monospace,monospace;">${cpu} · ${ram} · ${gpu}</div>
      <div style="display:flex;gap:8px;">
        <button id="chimera-start" style="flex:1;padding:8px 14px;border:none;border-radius:8px;background:linear-gradient(135deg,#00e5ff,#a855f7);color:#000;font-size:0.8rem;font-weight:600;cursor:pointer;">Start Earning</button>
        <button id="chimera-connect" style="padding:8px 14px;border:1px solid rgba(255,255,255,0.15);border-radius:8px;background:transparent;color:#e8e2d8;font-size:0.8rem;cursor:pointer;">Connect Wallet</button>
      </div>
    </div>`;
  }

  private startingHTML(): string {
    return `<div style="padding:16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:1.3rem;">⬡</span>
        <strong style="font-size:0.85rem;">Starting…</strong>
      </div>
      <p style="font-size:0.75rem;opacity:0.6;margin:0;">Initializing browser node, detecting capabilities, connecting to network…</p>
      <div style="margin-top:8px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:40%;background:linear-gradient(90deg,#00e5ff,#a855f7);animation:oas-pulse 1.5s ease-in-out infinite;"></div>
      </div>
      <style>@keyframes oas-pulse{0%,100%{width:30%}50%{width:80%}}</style>
    </div>`;
  }

  private connectingHTML(): string {
    return `<div style="padding:16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:1.3rem;">⬡</span>
        <strong style="font-size:0.85rem;">Connecting wallet…</strong>
      </div>
      <p style="font-size:0.75rem;opacity:0.6;margin:0;">Approve the transaction in your wallet to start earning.</p>
    </div>`;
  }

  private runningHTML(): string {
    return `<div style="padding:16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="font-size:1.3rem;">⬡</span>
        <strong style="font-size:0.85rem;flex:1;">Relay Active</strong>
        <span id="chimera-stop" style="cursor:pointer;opacity:0.4;font-size:0.8rem;padding:2px 8px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;">Stop</span>
      </div>
      <p style="font-size:0.75rem;opacity:0.7;margin:0 0 8px;">Relay is running. Connect wallet to earn on-chain.</p>
      <div id="chimera-status" style="font-size:0.75rem;opacity:0.85;font-family:ui-monospace,monospace;">🟢 Active · Jobs: 0 · Earnings: 0</div>
    </div>`;
  }

  private earningHTML(address: string): string {
    const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
    return `<div style="padding:16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="font-size:1.3rem;">⬡</span>
        <strong style="font-size:0.85rem;flex:1;">Earning</strong>
        <span id="chimera-stop" style="cursor:pointer;opacity:0.4;font-size:0.8rem;padding:2px 8px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;">Stop</span>
      </div>
      <p style="font-size:0.75rem;opacity:0.7;margin:0 0 6px;">Resource sharing active. Earnings settle on Robinhood Chain.</p>
      <div style="font-size:0.7rem;opacity:0.5;margin-bottom:6px;font-family:ui-monospace,monospace;">Wallet: ${short}</div>
      <div id="chimera-status" style="font-size:0.75rem;opacity:0.85;font-family:ui-monospace,monospace;">🟢 Active · Jobs: 0 · Earnings: 0</div>
    </div>`;
  }

  private errorHTML(msg: string): string {
    return `<div style="padding:16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:1.3rem;">⬡</span>
        <strong style="font-size:0.85rem;flex:1;">Error</strong>
        <span id="chimera-dismiss" style="cursor:pointer;opacity:0.4;font-size:1rem;">✕</span>
      </div>
      <p style="font-size:0.75rem;opacity:0.6;margin:0 0 10px;color:#f87171;">${msg}</p>
      <button id="chimera-dismiss" style="padding:6px 14px;border:1px solid rgba(255,255,255,0.15);border-radius:8px;background:transparent;color:#e8e2d8;font-size:0.8rem;cursor:pointer;">Dismiss</button>
    </div>`;
  }

  private unavailableHTML(): string {
    return `<div style="padding:16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:1.3rem;">⬡</span>
        <strong style="font-size:0.85rem;flex:1;">Chimera</strong>
        <span id="chimera-dismiss" style="cursor:pointer;opacity:0.4;font-size:1rem;">✕</span>
      </div>
      <p style="font-size:0.75rem;opacity:0.6;margin:0;">Resource sharing SDK unavailable. Analytics still active.</p>
    </div>`;
  }
}

// ─── Auto-init ───

const script = document.currentScript as HTMLScriptElement;
if (script) {
  const siteId = script.getAttribute('data-site-id');
  const chimera = script.getAttribute('data-chimera') === 'true';
  const sdkUrl = script.getAttribute('data-sdk-url') || undefined;
  const endpoint = script.getAttribute('data-endpoint') || undefined;
  if (siteId) {
    const tracker = new ChimeraTracker({ siteId, chimera, sdkUrl, endpoint });
    tracker.init();
    (window as any).ChimeraTracker = ChimeraTracker;
    (window as any).chimera = tracker;
  }
}

export { ChimeraTracker };
