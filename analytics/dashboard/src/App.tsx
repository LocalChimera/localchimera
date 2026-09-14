import React, { useState, useEffect } from 'react';
import { ChimeraWeb3AuthProvider, useChimera } from './lib/chimera-provider';
import { robinhoodChain } from './lib/chains';
import { formatUnits } from 'viem';
import './styles.css';

type NavKey = 'overview' | 'pageviews' | 'clicks' | 'referrers' | 'engagement' | 'devices' | 'errors' | 'resources' | 'staking' | 'governance';

const navItems: { icon: string; label: string; key: NavKey }[] = [
  { icon: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z', label: 'Overview', key: 'overview' },
  { icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z', label: 'Pageviews', key: 'pageviews' },
  { icon: 'M13 3l-1.9 5.8L5 10l6.1 1.9L13 18l1.9-6.1L21 10l-6.1-1.2L13 3z', label: 'Clicks', key: 'clicks' },
  { icon: 'M3 12h18M12 3l9 9-9 9', label: 'Referrers', key: 'referrers' },
  { icon: 'M12 2v10l6 3M2 12a10 10 0 1020 0', label: 'Engagement', key: 'engagement' },
  { icon: 'M4 4h16v12H4zM2 20h20M6 8h12M6 12h8', label: 'Devices', key: 'devices' },
  { icon: 'M12 2L1 21h22L12 2zm0 4l7 12H5l7-12zm-1 4v4h2v-4h-2zm0 6v2h2v-2h-2z', label: 'Errors', key: 'errors' },
  { icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', label: 'Earn', key: 'resources' },
  { icon: 'M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18L19.82 7 12 9.82 4.18 7 12 4.18z', label: 'Staking', key: 'staking' },
  { icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3', label: 'Governance', key: 'governance' },
];

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

interface AnalyticsData {
  pageviews: { url: string; count: number; ts: number }[];
  clicks: { href: string; text: string; count: number }[];
  referrers: { ref: string; count: number }[];
  scrollDepth: { depth: number; count: number }[];
  engagement: { avgTimeMs: number; maxScrollAvg: number; sessions: number };
  devices: { platform: string; cpuCores: number; hasWebGPU: boolean; count: number }[];
  errors: { message: string; count: number; lastTs: number }[];
  totals: { pageviews: number; clicks: number; uniqueVisitors: number; avgEngagementMs: number; errorCount: number };
}

function aggregatePageviews(events: any[]) {
  const map = new Map<string, { url: string; count: number; ts: number }>();
  for (const e of events) {
    if (e.type !== 'pageview') continue;
    const existing = map.get(e.url);
    if (existing) { existing.count++; existing.ts = Math.max(existing.ts, e.ts); }
    else map.set(e.url, { url: e.url, count: 1, ts: e.ts });
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function aggregateClicks(events: any[]) {
  const map = new Map<string, { href: string; text: string; count: number }>();
  for (const e of events) {
    if (e.type !== 'click') continue;
    const key = e.href || '';
    const existing = map.get(key);
    if (existing) existing.count++;
    else map.set(key, { href: key, text: e.text || '', count: 1 });
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function aggregateReferrers(events: any[]) {
  const map = new Map<string, { ref: string; count: number }>();
  for (const e of events) {
    if (e.type !== 'pageview' || !e.ref) continue;
    const existing = map.get(e.ref);
    if (existing) existing.count++;
    else map.set(e.ref, { ref: e.ref, count: 1 });
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

const EMPTY_DATA: AnalyticsData = {
  pageviews: [],
  clicks: [],
  referrers: [],
  scrollDepth: [],
  engagement: { avgTimeMs: 0, maxScrollAvg: 0, sessions: 0 },
  devices: [],
  errors: [],
  totals: { pageviews: 0, clicks: 0, uniqueVisitors: 0, avgEngagementMs: 0, errorCount: 0 },
};

function aggregateScrollDepth(events: any[]) {
  const map = new Map<number, number>();
  for (const e of events) {
    if (e.type !== 'scroll') continue;
    const depth = e.depth || 0;
    map.set(depth, (map.get(depth) || 0) + 1);
  }
  return Array.from(map.entries()).sort((a, b) => a[0] - b[0]).map(([depth, count]) => ({ depth, count }));
}

function aggregateDevices(events: any[]) {
  const map = new Map<string, { platform: string; cpuCores: number; hasWebGPU: boolean; count: number }>();
  for (const e of events) {
    if (e.type !== 'device') continue;
    const key = `${e.platform || 'unknown'}-${e.cpuCores || 0}-${e.hasWebGPU ? 1 : 0}`;
    const existing = map.get(key);
    if (existing) existing.count++;
    else map.set(key, { platform: e.platform || 'unknown', cpuCores: e.cpuCores || 0, hasWebGPU: !!e.hasWebGPU, count: 1 });
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function aggregateErrors(events: any[]) {
  const map = new Map<string, { message: string; count: number; lastTs: number }>();
  for (const e of events) {
    if (e.type !== 'error') continue;
    const msg = (e.message || 'Unknown').slice(0, 200);
    const existing = map.get(msg);
    if (existing) { existing.count++; existing.lastTs = Math.max(existing.lastTs, e.ts || 0); }
    else map.set(msg, { message: msg, count: 1, lastTs: e.ts || 0 });
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function useAnalytics(siteId?: string): AnalyticsData {
  const [data, setData] = useState<AnalyticsData>(EMPTY_DATA);
  useEffect(() => {
    if (!siteId) {
      setData(EMPTY_DATA);
      return;
    }
    let cancelled = false;
    fetch(`/api/events?siteId=${encodeURIComponent(siteId)}`)
      .then(r => {
        if (!r.ok) throw new Error('Not found');
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Not JSON');
        return r.json();
      })
      .then((d: any) => {
        if (cancelled) return;
        const events = d.events || [];
        const uniqueVisitors = new Set(events.map((e: any) => e.visitorId || e.siteId)).size;
        const engagementEvents = events.filter((e: any) => e.type === 'engagement');
        const avgEngagementMs = engagementEvents.length > 0
          ? Math.round(engagementEvents.reduce((s: number, e: any) => s + (e.timeMs || 0), 0) / engagementEvents.length)
          : 0;
        const errorEvents = events.filter((e: any) => e.type === 'error');
        setData({
          pageviews: aggregatePageviews(events),
          clicks: aggregateClicks(events),
          referrers: aggregateReferrers(events),
          scrollDepth: aggregateScrollDepth(events),
          engagement: {
            avgTimeMs: avgEngagementMs,
            maxScrollAvg: engagementEvents.length > 0
              ? Math.round(engagementEvents.reduce((s: number, e: any) => s + (e.maxScroll || 0), 0) / engagementEvents.length)
              : 0,
            sessions: new Set(engagementEvents.map((e: any) => e.sessionId)).size,
          },
          devices: aggregateDevices(events),
          errors: aggregateErrors(errorEvents),
          totals: {
            pageviews: events.filter((e: any) => e.type === 'pageview').length,
            clicks: events.filter((e: any) => e.type === 'click').length,
            uniqueVisitors,
            avgEngagementMs,
            errorCount: errorEvents.length,
          },
        });
      })
      .catch(() => { if (!cancelled) setData(EMPTY_DATA); });
    return () => { cancelled = true; };
  }, [siteId]);
  return data;
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">
        <span>{label}</span>
        <div className="stat-icon"><Icon d={icon} /></div>
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function OverviewSection({ data }: { data: AnalyticsData }) {
  const fmtTime = (ms: number) => {
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };
  return (
    <>
      <div className="page-title">Overview</div>
      <p className="page-subtitle">Privacy-first analytics — no cookies, no personal data.</p>
      <div className="stat-grid">
        <StatCard label="Pageviews" value={data.totals.pageviews.toLocaleString()} icon="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 110-10 5 5 0 010 10z" />
        <StatCard label="Clicks" value={data.totals.clicks.toLocaleString()} icon="M13 3l-1.9 5.8L5 10l6.1 1.9L13 18l1.9-6.1L21 10l-6.1-1.2L13 3z" />
        <StatCard label="Unique Visitors" value={data.totals.uniqueVisitors.toLocaleString()} icon="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
        <StatCard label="Avg Engagement" value={fmtTime(data.totals.avgEngagementMs)} sub={`Max scroll: ${data.engagement.maxScrollAvg}%`} icon="M12 2v10l6 3M2 12a10 10 0 1020 0" />
        <StatCard label="Errors" value={data.totals.errorCount.toLocaleString()} sub={data.errors.length > 0 ? `${data.errors.length} unique` : 'No errors'} icon="M12 2L1 21h22L12 2zm0 4l7 12H5l7-12z" />
      </div>
      {data.scrollDepth.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title">Scroll Depth Distribution</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', height: 120, padding: '16px 0' }}>
            {data.scrollDepth.map((s) => (
              <div key={s.depth} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{s.count}</span>
                <div style={{
                  width: '100%',
                  height: `${Math.max(4, (s.count / Math.max(...data.scrollDepth.map(d => d.count))) * 80)}px`,
                  background: 'linear-gradient(180deg, hsl(var(--primary)), hsl(var(--accent, 280)))',
                  borderRadius: '4px 4px 0 0',
                }} />
                <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{s.depth}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function PageviewsSection({ data }: { data: AnalyticsData }) {
  return (
    <>
      <div className="page-title">Pageviews</div>
      <p className="page-subtitle">Pageviews by URL across all tracked sites.</p>
      <div className="card">
        {data.pageviews.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Icon d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5z" /></div>
            <h3>No pageviews yet</h3>
            <p>Embed the tracker script on your site to start collecting data.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>URL</th>
                <th>Views</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {data.pageviews.slice(0, 50).map((pv, i) => (
                <tr key={i}>
                  <td className="truncate text-mono">{pv.url}</td>
                  <td><span className="badge badge-blue">{pv.count}</span></td>
                  <td className="text-xs text-muted">{new Date(pv.ts).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function ClicksSection({ data }: { data: AnalyticsData }) {
  return (
    <>
      <div className="page-title">Clicks</div>
      <p className="page-subtitle">Click events tracked across your sites.</p>
      <div className="card">
        {data.clicks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Icon d="M13 3l-1.9 5.8L5 10l6.1 1.9L13 18l1.9-6.1L21 10l-6.1-1.2L13 3z" /></div>
            <h3>No clicks tracked yet</h3>
            <p>Embed the tracker script to start collecting click events.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Link Text</th>
                <th>URL</th>
                <th>Clicks</th>
              </tr>
            </thead>
            <tbody>
              {data.clicks.slice(0, 50).map((c, i) => (
                <tr key={i}>
                  <td>{c.text || '(no text)'}</td>
                  <td className="truncate-sm text-mono text-muted">{c.href}</td>
                  <td><span className="badge badge-green">{c.count}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function ReferrersSection({ data }: { data: AnalyticsData }) {
  return (
    <>
      <div className="page-title">Referrers</div>
      <p className="page-subtitle">Top referring sources for your traffic.</p>
      <div className="card">
        {data.referrers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Icon d="M3 12h18M12 3l9 9-9 9" /></div>
            <h3>No referrers yet</h3>
            <p>Referrer data will appear once visitors arrive from external links.</p>
          </div>
        ) : (
          data.referrers.slice(0, 20).map((r, i) => (
            <div key={i} className="list-item">
              <span className="truncate text-mono">{r.ref || '(direct)'}</span>
              <span className="badge badge-purple">{r.count}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function EngagementSection({ data }: { data: AnalyticsData }) {
  const fmtTime = (ms: number) => {
    if (ms < 60000) return `${Math.round(ms / 1000)} seconds`;
    return `${(ms / 60000).toFixed(1)} minutes`;
  };
  return (
    <>
      <div className="page-title">Engagement</div>
      <p className="page-subtitle">Time on page and scroll depth across sessions.</p>
      <div className="stat-grid">
        <StatCard label="Avg Time on Page" value={fmtTime(data.engagement.avgTimeMs)} icon="M12 2v10l6 3M2 12a10 10 0 1020 0" />
        <StatCard label="Avg Max Scroll" value={`${data.engagement.maxScrollAvg}%`} icon="M3 12h18M12 3l9 9-9 9" />
        <StatCard label="Engaged Sessions" value={data.engagement.sessions.toLocaleString()} icon="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
      </div>
      {data.scrollDepth.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title">Scroll Depth Distribution</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', height: 120, padding: '16px 0' }}>
            {data.scrollDepth.map((s) => (
              <div key={s.depth} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{s.count}</span>
                <div style={{
                  width: '100%',
                  height: `${Math.max(4, (s.count / Math.max(...data.scrollDepth.map(d => d.count))) * 80)}px`,
                  background: 'linear-gradient(180deg, hsl(var(--primary)), hsl(var(--accent, 280)))',
                  borderRadius: '4px 4px 0 0',
                }} />
                <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{s.depth}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function DevicesSection({ data }: { data: AnalyticsData }) {
  return (
    <>
      <div className="page-title">Devices</div>
      <p className="page-subtitle">Device capabilities reported by visitors' browsers.</p>
      <div className="card">
        {data.devices.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Icon d="M4 4h16v12H4zM2 20h20M6 8h12M6 12h8" /></div>
            <h3>No device data yet</h3>
            <p>Device capability data will appear once visitors load the tracker.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Platform</th>
                <th>CPU Cores</th>
                <th>WebGPU</th>
                <th>Visitors</th>
              </tr>
            </thead>
            <tbody>
              {data.devices.slice(0, 50).map((d, i) => (
                <tr key={i}>
                  <td className="text-mono">{d.platform}</td>
                  <td><span className="badge badge-blue">{d.cpuCores}</span></td>
                  <td>{d.hasWebGPU ? <span className="badge badge-green">✅</span> : <span className="badge">❌</span>}</td>
                  <td><span className="badge badge-purple">{d.count}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function ErrorsSection({ data }: { data: AnalyticsData }) {
  return (
    <>
      <div className="page-title">Errors</div>
      <p className="page-subtitle">JavaScript errors captured from visitor browsers.</p>
      <div className="card">
        {data.errors.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Icon d="M12 2L1 21h22L12 2zm0 4l7 12H5l7-12z" /></div>
            <h3>No errors tracked</h3>
            <p>Error events will appear here when visitors encounter JavaScript errors.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Message</th>
                <th>Count</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {data.errors.slice(0, 50).map((e, i) => (
                <tr key={i}>
                  <td className="text-mono text-sm" style={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.message}</td>
                  <td><span className="badge" style={{ background: 'hsl(0 80% 50%)' }}>{e.count}</span></td>
                  <td className="text-xs text-muted">{new Date(e.lastTs).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function ResourceSharingSection() {
  const chimera = useChimera();
  const [copied, setCopied] = useState(false);

  const trackerUrl = 'https://analytics.localchimera.com/tracker.js';
  const siteId = chimera.address || '';
  const embedScript = siteId
    ? `<script src="${trackerUrl}" data-site-id="${siteId}" data-chimera="true" defer></script>`
    : '';

  const copyScript = () => {
    if (!embedScript) return;
    navigator.clipboard.writeText(embedScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div className="page-title">Earn</div>
      <p className="page-subtitle">Connect your wallet to generate an embeddable script that tracks analytics and enables resource earning on your website.</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title">Step 1 — Connect Wallet</div>
        <p className="text-muted" style={{ marginBottom: 16 }}>
          Connect your EVM wallet on Robinhood Chain. Your wallet address becomes your site ID for both analytics tracking and resource earning.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="badge badge-green">Chain: {robinhoodChain.name} (ID: {robinhoodChain.id})</span>
          {chimera.address ? (
            <>
              <span className="badge badge-blue">Connected: {chimera.address.slice(0, 6)}...{chimera.address.slice(-4)}</span>
              <button className="btn-primary" onClick={() => chimera.disconnect()} style={{ background: 'hsl(var(--secondary))', color: 'hsl(var(--foreground))' }}>Disconnect</button>
            </>
          ) : (
            <button className="btn-primary btn-gradient" onClick={() => chimera.connect()}>Connect Wallet</button>
          )}
        </div>
      </div>

      {chimera.address && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title">Step 2 — Embed This Script</div>
          <p className="text-muted" style={{ marginBottom: 12 }}>
            Add this script tag to the {'<head>'} of your website. It tracks pageviews and clicks (analytics) and shows a floating badge allowing visitors to share device resources and earn — no cookies, no personal data.
          </p>
          <div style={{ position: 'relative' }}>
            <pre style={{
              background: 'hsl(var(--background))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 10,
              padding: 16,
              overflowX: 'auto',
              fontSize: 13,
              fontFamily: 'JetBrains Mono, monospace',
              color: 'hsl(var(--foreground))',
              margin: 0,
            }}>
              {embedScript}
            </pre>
            <button
              onClick={copyScript}
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                padding: '4px 12px',
                borderRadius: 8,
                border: '1px solid hsl(var(--border))',
                background: 'hsl(var(--card))',
                color: 'hsl(var(--foreground))',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {chimera.address && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title">Contract Addresses</div>
          <div className="text-sm text-muted" style={{ marginBottom: 4 }}>Escrow</div>
          <div className="text-mono text-muted" style={{ marginBottom: 12 }}>{chimera.escrowAddress}</div>
          <div className="text-sm text-muted" style={{ marginBottom: 4 }}>Coordinator</div>
          <div className="text-mono text-muted">{chimera.coordinatorAddress}</div>
        </div>
      )}
    </>
  );
}

function StakingSection() {
  const chimera = useChimera();
  const fmt = (v: bigint) => formatUnits(v, 18);

  return (
    <>
      <div className="page-title">Staking</div>
      <p className="page-subtitle">Stake CHIMERA to become a Tier 1 provider, earn rewards, and unlock premium features.</p>

      {!chimera.address ? (
        <div className="card">
          <div className="empty-state">
            <h3>Connect your wallet</h3>
            <p>Connect your EVM wallet on Robinhood Chain to view your staking status.</p>
            <button className="btn-primary btn-gradient" onClick={() => chimera.connect()} style={{ marginTop: 12 }}>Connect Wallet</button>
          </div>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard label="CHIMERA Balance" value={fmt(chimera.chimeraBalance)} icon="M12 2L2 7l10 5 10-5-10-5z" />
            <StatCard label="Staked" value={chimera.stakeInfo ? fmt(chimera.stakeInfo.staked) : '0'} sub={`Tier ${chimera.providerTier}`} icon="M12 2L2 7v10l10 5 10-5V7L12 2z" />
            <StatCard label="Voting Power" value={fmt(chimera.votingPower)} sub="1 CHIMERA = 1 vote" icon="M3 12l2-2 7-7 7 7" />
            <StatCard label="Vested Rewards" value={chimera.vestingInfo ? fmt(chimera.vestingInfo.available) : '0'} sub="Available to claim" icon="M12 2v10l6 3" />
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-title">Stake Status</div>
            {chimera.stakeInfo ? (
              <table>
                <tbody>
                  <tr><td>Staked</td><td className="text-mono">{fmt(chimera.stakeInfo.staked)} CHIMERA</td></tr>
                  <tr><td>Weight</td><td className="text-mono">{fmt(chimera.stakeInfo.weight)}</td></tr>
                  <tr><td>Lock Multiplier</td><td className="text-mono">{(Number(chimera.stakeInfo.lockMultiplier) / 10000).toFixed(2)}x</td></tr>
                  <tr><td>Unlock At</td><td className="text-xs text-muted">{chimera.stakeInfo.unlockAt > 0n ? new Date(Number(chimera.stakeInfo.unlockAt) * 1000).toLocaleString() : 'No lock'}</td></tr>
                  <tr><td>Unstake Available</td><td className="text-xs text-muted">{chimera.stakeInfo.unstakeAvailableAt > 0n ? new Date(Number(chimera.stakeInfo.unstakeAvailableAt) * 1000).toLocaleString() : 'Not pending'}</td></tr>
                </tbody>
              </table>
            ) : (
              <p className="text-muted">No staking data available. Staking contract may not be deployed yet.</p>
            )}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-title">Premium Features</div>
            {chimera.premiumStatus ? (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span className={`badge ${chimera.premiumStatus.priorityRouting ? 'badge-green' : ''}`}>Priority Routing: {chimera.premiumStatus.priorityRouting ? '✅' : '❌'}</span>
                <span className={`badge ${chimera.premiumStatus.higherThroughput ? 'badge-green' : ''}`}>Higher Throughput: {chimera.premiumStatus.higherThroughput ? '✅' : '❌'}</span>
                <span className={`badge ${chimera.premiumStatus.customPricing ? 'badge-green' : ''}`}>Custom Pricing: {chimera.premiumStatus.customPricing ? '✅' : '❌'}</span>
              </div>
            ) : (
              <p className="text-muted">Premium status unavailable.</p>
            )}
          </div>

          {chimera.circuitBreaker && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="section-title">Circuit Breaker</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span className={`badge ${chimera.circuitBreaker.triggered ? '' : 'badge-green'}`}>
                  {chimera.circuitBreaker.triggered ? '⚠️ TRIGGERED' : '✅ Normal'}
                </span>
                <span className="text-muted text-sm">
                  24h slash volume: {fmt(chimera.circuitBreaker.slashVolume24h)} / {fmt(chimera.circuitBreaker.totalStaked)} staked
                </span>
              </div>
            </div>
          )}

          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-title">Contract Addresses</div>
            <div className="text-sm text-muted" style={{ marginBottom: 4 }}>CHIMERA Token</div>
            <div className="text-mono text-muted" style={{ marginBottom: 12 }}>{chimera.chimeraTokenAddress}</div>
            <div className="text-sm text-muted" style={{ marginBottom: 4 }}>Staking</div>
            <div className="text-mono text-muted" style={{ marginBottom: 12 }}>{chimera.stakingAddress}</div>
            <div className="text-sm text-muted" style={{ marginBottom: 4 }}>Coordinator (v2)</div>
            <div className="text-mono text-muted" style={{ marginBottom: 12 }}>{chimera.coordinatorAddress}</div>
            <div className="text-sm text-muted" style={{ marginBottom: 4 }}>Governance</div>
            <div className="text-mono text-muted">{chimera.governanceAddress}</div>
          </div>
        </>
      )}
    </>
  );
}

function GovernanceSection() {
  const chimera = useChimera();
  const fmt = (v: bigint) => formatUnits(v, 18);

  return (
    <>
      <div className="page-title">Governance</div>
      <p className="page-subtitle">Vote on protocol parameters and participate in slash dispute resolution.</p>

      {!chimera.address ? (
        <div className="card">
          <div className="empty-state">
            <h3>Connect your wallet</h3>
            <p>Connect your EVM wallet on Robinhood Chain to participate in governance.</p>
            <button className="btn-primary btn-gradient" onClick={() => chimera.connect()} style={{ marginTop: 12 }}>Connect Wallet</button>
          </div>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard label="Voting Power" value={fmt(chimera.votingPower)} sub="Staked CHIMERA" icon="M3 12l2-2 7-7 7 7" />
            <StatCard label="Provider Tier" value={`Tier ${chimera.providerTier}`} sub={chimera.providerTier === 1 ? 'Staked' : 'Unstaked'} icon="M12 2L2 7v10l10 5 10-5V7L12 2z" />
            <StatCard label="CHIMERA Balance" value={fmt(chimera.chimeraBalance)} icon="M12 2L2 7l10 5 10-5-10-5z" />
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-title">Governance Parameters</div>
            <table>
              <tbody>
                <tr><td>Proposal Threshold</td><td className="text-mono">100,000 CHIMERA</td></tr>
                <tr><td>Voting Period</td><td className="text-mono">3 days</td></tr>
                <tr><td>Timelock Delay</td><td className="text-mono">48 hours</td></tr>
                <tr><td>Quorum</td><td className="text-mono">5% of total staked</td></tr>
                <tr><td>Min Jurors</td><td className="text-mono">7</td></tr>
                <tr><td>Juror Lock Min</td><td className="text-mono">1,000 CHIMERA</td></tr>
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-title">Dispute Resolution</div>
            <p className="text-muted" style={{ marginBottom: 12 }}>
              Slash appeals require a minimum of 7 jurors who lock CHIMERA to participate.
              Winning jurors split the appeal payment; losing jurors forfeit 10% of their locked stake.
            </p>
            <div className="text-sm text-muted" style={{ marginBottom: 4 }}>Governance Contract</div>
            <div className="text-mono text-muted">{chimera.governanceAddress}</div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-title">Tokenomics Summary</div>
            <table>
              <tbody>
                <tr><td>Token</td><td>CHIMERA (ERC-20)</td></tr>
                <tr><td>Total Supply</td><td className="text-mono">1,000,000,000 CHIMERA</td></tr>
                <tr><td>Decimals</td><td className="text-mono">18</td></tr>
                <tr><td>Transfer Tax</td><td>None</td></tr>
                <tr><td>Minting</td><td>Disabled (fixed supply)</td></tr>
                <tr><td>Chain</td><td>Robinhood Chain (4663)</td></tr>
                <tr><td>Min Tier 1 Stake</td><td className="text-mono">10,000 CHIMERA</td></tr>
                <tr><td>Slashing</td><td>3% → 5% → 10% → 20% → 50%</td></tr>
                <tr><td>Reward Vesting</td><td>25% immediate, 75% over 90 days</td></tr>
                <tr><td>PoI Burn</td><td>10% of settlement</td></tr>
                <tr><td>Buyback Allocation</td><td>20% of platform fees</td></tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Dashboard() {
  const [activeKey, setActiveKey] = useState<NavKey>('overview');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const chimera = useChimera();
  const data = useAnalytics(chimera.address ?? undefined);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <div className="app">
      <aside className="sidebar">
        <a href="/" className="sidebar-logo">
          <img src="/chimeralogo-header.png" alt="Chimera" />
          <span>Chimera</span>
        </a>
        <nav className="sidebar-nav">
          <div className="nav-group-label">Analytics</div>
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveKey(item.key)}
              className={`nav-btn ${activeKey === item.key ? 'active' : ''}`}
            >
              <Icon d={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-footer-text">Chimera Analytics</div>
        </div>
      </aside>
      <div className="main">
        <header className="header">
          <span className="header-title">{navItems.find((n) => n.key === activeKey)?.label}</span>
          <div className="header-actions">
            <button
              className="icon-btn"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <Icon d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0a.996.996 0 000-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z" />
              ) : (
                <Icon d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 00-7.92 12.446a9 9 0 118.316-12.446z" />
              )}
            </button>
          </div>
        </header>
        <main className="content">
          {activeKey === 'overview' && <OverviewSection data={data} />}
          {activeKey === 'pageviews' && <PageviewsSection data={data} />}
          {activeKey === 'clicks' && <ClicksSection data={data} />}
          {activeKey === 'referrers' && <ReferrersSection data={data} />}
          {activeKey === 'engagement' && <EngagementSection data={data} />}
          {activeKey === 'devices' && <DevicesSection data={data} />}
          {activeKey === 'errors' && <ErrorsSection data={data} />}
          {activeKey === 'resources' && <ResourceSharingSection />}
          {activeKey === 'staking' && <StakingSection />}
          {activeKey === 'governance' && <GovernanceSection />}
        </main>
      </div>
    </div>
  );
}

function Root() {
  return (
    <ChimeraWeb3AuthProvider>
      <Dashboard />
    </ChimeraWeb3AuthProvider>
  );
}

export default Root;
