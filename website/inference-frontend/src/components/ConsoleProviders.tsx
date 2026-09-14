import { useState, useEffect, useCallback } from 'react';
import { Search, X, Briefcase, Server, HardDrive, Zap, Radio, Cloud, Cpu, Box } from 'lucide-react';
import { Button } from './ui';
import ProviderMap from './ProviderMap';

type Provider = {
  id: string;
  name: string;
  resource: string;
  location?: string;
  specs?: string;
  status: string;
  source: 'First party' | 'Second party';
  attrs?: { key: string; val: string }[];
};

const NETWORK_APIS = [
  { id: 'akash', resource: 'GPU', api: '/api/providers/akash' },
  { id: 'golem', resource: 'CPU', api: '/api/providers/golem' },
  { id: 'mysterium', resource: 'Bandwidth', api: '/api/providers/mysterium' },
  { id: 'anyone', resource: 'Bandwidth', api: '/api/providers/anyone' },
  { id: 'storj', resource: 'Storage', api: '/api/providers/storj' },
];

const RESOURCES = [
  { id: 'GPU', icon: Server, color: '#ff4141' },
  { id: 'CPU', icon: Cpu, color: '#001d9c' },
  { id: 'Bandwidth', icon: Radio, color: '#d61f69' },
  { id: 'Storage', icon: Cloud, color: '#0052ff' },
] as const;

function formatBytes(bytes: number | undefined, decimals = 2): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function satelliteRegion(satellite: string): { country?: string; region?: string; city?: string } {
  const host = satellite.split('@')[1]?.split(':')[0]?.toLowerCase() || '';
  if (host.includes('ap1')) return { country: 'Singapore', region: 'Asia-Pacific', city: 'Singapore' };
  if (host.includes('us1')) return { country: 'United States', region: 'North America', city: 'US East' };
  if (host.includes('eu1')) return { country: 'Germany', region: 'Europe', city: 'EU Central' };
  if (host.includes('saltlake')) return { country: 'United States', region: 'North America', city: 'Salt Lake City' };
  return {};
}

async function fetchProviders(networkId: string, apiPath: string | null): Promise<Provider[]> {
  if (!apiPath) return [];
  try {
    const res = await fetch(apiPath);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (networkId === 'akash') {
      return (data || []).map((p: any) => {
        const city = p.city || p.ipRegion || null;
        const region = p.ipRegion || p.locationRegion || null;
        const country = p.ipCountry || p.country || null;
        const stats = p.stats || {};
        const cpuTotal = stats.cpu?.total ? (stats.cpu.total / 1000).toFixed(1) : '?';
        const memoryTotal = stats.memory?.total ? Math.round(stats.memory.total / (1024 ** 3)) : '?';
        const storageTotal = stats.storage?.total?.total ? Math.round(stats.storage.total.total / (1024 ** 4)) : '?';
        const gpuCount = stats.gpu?.total || 0;
        const gpuModels = p.gpuModels?.map((g: any) => `${g.vendor || ''} ${g.model} ${g.ram || ''}`.trim()).join(', ') || 'none';
        return {
          id: p.owner || p.name,
          name: p.name || p.owner?.slice(0, 12) || 'Unknown',
          resource: 'GPU',
          location: [city, region, country].filter(Boolean).join(', ') || undefined,
          specs: `CPU ${cpuTotal} cores · RAM ${memoryTotal} GB · Storage ${storageTotal} TB · GPU ${gpuCount > 0 ? gpuModels : 'none'}`,
          status: p.isOnline ? 'online' : 'offline',
          source: 'Second party',
          attrs: [
            { key: 'host', val: p.hostUri || '-' },
            { key: 'city', val: city || '-' },
            { key: 'region', val: region || '-' },
            { key: 'country', val: country || '-' },
            { key: 'geo', val: (p.ipLat && p.ipLon) ? `${p.ipLat}, ${p.ipLon}` : '-' },
            { key: 'cpu_cores', val: cpuTotal },
            { key: 'memory_gb', val: String(memoryTotal) },
            { key: 'storage_tb', val: String(storageTotal) },
            { key: 'gpu', val: gpuCount > 0 ? gpuModels : '-' },
            { key: 'network', val: (p.networkSpeedUp && p.networkSpeedDown) ? `${p.networkSpeedUp}/${p.networkSpeedDown} Mbps` : '-' },
            { key: 'online', val: p.isOnline ? 'yes' : 'no' },
            { key: 'audited', val: p.isAudited ? 'yes' : 'no' },
          ],
        };
      });
    }

    if (networkId === 'golem') {
      const providers = Array.isArray(data) ? data : (data?.providers || data?.online || []);
      return providers.map((p: any) => {
        const nodeId = p.node_id || p.id;
        // v2 response has runtimes object with properties; fall back to flat data for v1 compatibility
        const runtimeName = Object.keys(p.runtimes || {})[0];
        const info = p.runtimes?.[runtimeName]?.properties || p.data || p;
        const name = info['golem.node.id.name'] || nodeId?.slice(0, 12) || 'Unknown';
        const cpu = info['golem.inf.cpu.cores'] || info['golem.inf.cpu.threads'] || '?';
        const mem = info['golem.inf.mem.gib'] || '?';
        const storage = info['golem.inf.storage.gib'] || '?';
        const subnet = info['golem.node.debug.subnet'] || p.network || '-';
        const runtimes = Object.keys(p.runtimes || {}).join(', ') || info['golem.runtime.name'] || '-';
        return {
          id: nodeId,
          name,
          resource: 'CPU',
          location: subnet,
          specs: `CPU ${cpu} · Mem ${mem}Gi · Storage ${storage}Gi`,
          status: p.online ? 'online' : 'offline',
          source: 'Second party',
          attrs: [
            { key: 'node_id', val: nodeId || '-' },
            { key: 'subnet', val: subnet },
            { key: 'cpu_cores', val: String(cpu) },
            { key: 'memory_gib', val: String(mem) },
            { key: 'storage_gib', val: String(storage) },
            { key: 'runtimes', val: runtimes },
            { key: 'version', val: p.version || '-' },
            { key: 'wallet', val: p.wallet || '-' },
          ],
        };
      });
    }

    if (networkId === 'mysterium') {
      return (data || []).map((p: any) => {
        const loc = p.location || {};
        const q = p.quality || {};
        const city = loc.city || null;
        const region = loc.region || null;
        const country = loc.country || null;
        return {
          id: p.provider_id || p.id,
          name: p.provider_id?.slice(0, 12) || 'Unknown',
          resource: 'Bandwidth',
          location: [city, region, country].filter(Boolean).join(', ') || undefined,
          specs: `Bandwidth ${q.bandwidth ? q.bandwidth.toFixed(1) + ' Mbps' : '?'} · Latency ${q.latency ? q.latency.toFixed(1) + ' ms' : '?'} · Quality ${q.quality || '?'}`,
          status: 'online',
          source: 'Second party',
          attrs: [
            { key: 'provider_id', val: p.provider_id || '-' },
            { key: 'city', val: city || '-' },
            { key: 'region', val: region || '-' },
            { key: 'country', val: country || '-' },
            { key: 'isp', val: loc.isp || '-' },
            { key: 'bandwidth_mbps', val: q.bandwidth ? q.bandwidth.toFixed(1) : '-' },
            { key: 'latency_ms', val: q.latency ? q.latency.toFixed(1) : '-' },
            { key: 'packet_loss', val: q.packetLoss ? q.packetLoss.toFixed(2) + '%' : '-' },
            { key: 'service_type', val: p.service_type || '-' },
            { key: 'price_per_gib', val: p.price_per_gib || '-' },
          ],
        };
      });
    }

    if (networkId === 'anyone') {
      // The relay-map endpoint returns hex cells with relayCount per cell
      const cells = Array.isArray(data) ? data : (data?.cells || []);
      return cells.map((c: any) => ({
        id: c.index || c.id,
        name: c.index?.slice(0, 12) || c.id?.slice(0, 12) || 'Unknown',
        resource: 'Bandwidth',
        location: c.geo ? `Lat ${c.geo[0]?.toFixed(2)}, Lon ${c.geo[1]?.toFixed(2)}` : undefined,
        specs: `${c.relayCount || 0} relays in cell`,
        status: (c.relayCount || 0) > 0 ? 'online' : 'offline',
        source: 'Second party',
        attrs: [
          { key: 'cell_index', val: c.index || '-' },
          { key: 'relay_count', val: String(c.relayCount || 0) },
          { key: 'geo', val: c.geo ? `${c.geo[0]?.toFixed(4)}, ${c.geo[1]?.toFixed(4)}` : '-' },
        ],
      }));
    }

    if (networkId === 'storj') {
      return (data || []).map((s: any) => {
        const satellite = s.satellite || 'unknown';
        const label = satellite.split('@')[1]?.split(':')[0] || satellite;
        const geo = satelliteRegion(satellite);
        const active = s.active_nodes ?? 0;
        const total = s.total_nodes ?? 0;
        const vetted = s.vetted_nodes ?? 0;
        const free = s.storage_free_capacity_estimate_bytes ?? 0;
        const used = s.storage_remote_bytes ?? 0;
        return {
          id: satellite,
          name: label,
          resource: 'Storage',
          location: [geo.city, geo.region, geo.country].filter(Boolean).join(', ') || label,
          specs: `${active.toLocaleString()} active · ${formatBytes(used)} stored · ${formatBytes(free)} free`,
          status: active > 0 ? 'online' : 'offline',
          source: 'Second party',
          attrs: [
            { key: 'satellite', val: satellite },
            { key: 'city', val: geo.city || '-' },
            { key: 'region', val: geo.region || '-' },
            { key: 'country', val: geo.country || '-' },
            { key: 'active_nodes', val: active.toLocaleString() },
            { key: 'total_nodes', val: total.toLocaleString() },
            { key: 'vetted_nodes', val: vetted.toLocaleString() },
            { key: 'storage_used', val: formatBytes(used) },
            { key: 'storage_free', val: formatBytes(free) },
            { key: 'bandwidth_uploaded', val: formatBytes(s.bandwidth_bytes_uploaded) },
            { key: 'bandwidth_downloaded', val: formatBytes(s.bandwidth_bytes_downloaded) },
          ],
        };
      });
    }

    return [];
  } catch (e) {
    console.warn(`[providers] failed to fetch ${networkId}:`, e);
    return [];
  }
}

export default function ConsoleProviders() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Provider | null>(null);
  const [activeResource, setActiveResource] = useState<string | 'all'>('all');
  const [providerFilter, setProviderFilter] = useState<'all' | 'first'>('all');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;
  const [firstPartyProviders, setFirstPartyProviders] = useState<Provider[]>([]);
  const [machinesLoading, setMachinesLoading] = useState(false);

  const loadMachines = useCallback(async () => {
    setMachinesLoading(true);
    try {
      const res = await fetch('/api/providers/first-party');
      const data = await res.json().catch(() => ({}));
      const all: Provider[] = (data.providers || []).map((p: any) => ({
        id: p.id,
        name: p.name || 'Unknown',
        resource: p.resource || 'CPU',
        specs: p.specs || '',
        status: p.status || 'offline',
        source: 'First party' as const,
        attrs: p.attrs || [],
      }));
      setFirstPartyProviders(all);
    } catch (e) {
      console.error('Failed to load machines:', e);
    } finally {
      setMachinesLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(NETWORK_APIS.map((n) => fetchProviders(n.id, n.api))).then((results) => {
      if (cancelled) return;
      setProviders(results.flat());
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    loadMachines();
    const id = setInterval(loadMachines, 30000);
    return () => clearInterval(id);
  }, [loadMachines]);

  const allProviders = [...providers, ...firstPartyProviders];
  const filtered = allProviders.filter((p) => {
    const matchesSearch = [p.name, p.resource, p.location, p.specs].some((s) =>
      (s || '').toLowerCase().includes(search.toLowerCase())
    );
    const matchesResource = activeResource === 'all' || p.resource === activeResource;
    const matchesSource = providerFilter === 'all' || p.source === 'First party';
    const isOnline = p.status === 'online';
    return matchesSearch && matchesResource && matchesSource && isOnline;
  });
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageStart = page * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;
  const paged = filtered.slice(pageStart, pageEnd);

  return (
    <div className="max-w-[1200px]">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-foreground">Providers</h1>
        <p className="text-[13px] text-muted-foreground">Real providers from decentralized compute, storage, and bandwidth networks.</p>
      </div>

      <ProviderMap externalResource={activeResource} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 mt-6">
        {RESOURCES.map((r) => {
          const Icon = r.icon;
          const count = allProviders.filter((p) => p.resource === r.id && p.status === 'online').length;
          return (
            <button
              key={r.id}
              onClick={() => { setActiveResource(activeResource === r.id ? 'all' : r.id); setPage(0); }}
              className={`text-left border rounded-[14px] p-4 transition ${activeResource === r.id ? 'border-primary bg-secondary' : 'border-border hover:bg-secondary'}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-4 h-4" style={{ color: r.color }} />
                <span className="text-[13px] font-semibold text-foreground">{r.id}</span>
              </div>
              <div className="text-[11px] text-muted-foreground">{count} providers</div>
            </button>
          );
        })}
      </div>

      <div className="bg-card border border-border rounded-[14px] p-5 mb-4">
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-foreground" />
            <h3 className="text-[16px] font-bold text-foreground">Live Providers</h3>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1.5">
              <button
                onClick={() => { setProviderFilter('all'); setPage(0); }}
                className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border transition ${providerFilter === 'all' ? 'bg-foreground text-background border-foreground' : 'bg-card text-muted-foreground border-border hover:bg-secondary'}`}
              >
                All Providers
              </button>
              <button
                onClick={() => { setProviderFilter('first'); setPage(0); }}
                className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border transition ${providerFilter === 'first' ? 'bg-foreground text-background border-foreground' : 'bg-card text-muted-foreground border-border hover:bg-secondary'}`}
              >
                First Party Only
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                placeholder="Search providers"
                className="pl-9 pr-4 py-2 border border-border rounded-[10px] text-[14px] w-[240px] outline-none focus:border-primary bg-card text-foreground"
              />
            </div>
          </div>
        </div>
        {loading && <p className="text-[13px] text-muted-foreground mb-3">Loading live provider data…</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted-foreground text-[12px] border-b border-border">
                <th className="pb-3 font-semibold">Provider</th>
                <th className="pb-3 font-semibold">Resource</th>
                <th className="pb-3 font-semibold">Location</th>
                <th className="pb-3 font-semibold">Specs</th>
                <th className="pb-3 font-semibold">Source</th>
                <th className="pb-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((p) => (
                <tr key={`${p.source}:${p.id}`} className="border-b border-border last:border-0 hover:bg-secondary">
                  <td className="py-3">
                    <button onClick={() => setSelected(p)} className="font-semibold text-foreground hover:text-primary text-left">
                      {p.name}
                    </button>
                  </td>
                  <td className="py-3 text-muted-foreground">{p.resource}</td>
                  <td className="py-3 text-muted-foreground">{p.location || '-'}</td>
                  <td className="py-3 text-muted-foreground">{p.specs || '-'}</td>
                  <td className="py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-secondary text-muted-foreground border-border">
                      {p.source}
                    </span>
                  </td>
                  <td className="py-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border ${p.status === 'online' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-secondary text-muted-foreground border-border'}`}>
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[13px] text-muted-foreground">
                    No providers match your search. Try a different network or clear the filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
            <span className="text-[12px] text-muted-foreground">
              Showing {pageStart + 1}–{Math.min(pageEnd, filtered.length)} of {filtered.length} providers
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold border border-border bg-card text-foreground hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-[12px] text-muted-foreground">Page {page + 1} of {totalPages}</span>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold border border-border bg-card text-foreground hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-card border border-border rounded-[14px] w-full max-w-[560px] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-bold text-foreground">Provider Details</h3>
              <button onClick={() => setSelected(null)} className="p-1 rounded-full hover:bg-secondary">
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <div className="text-[13px] text-muted-foreground mb-3">
              Resource: <span className="font-semibold text-foreground">{selected.resource}</span>
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-secondary text-muted-foreground border-border">{selected.source}</span>
            </div>
            <div className="space-y-3">
              {(selected.attrs || []).map((a) => (
                <div key={a.key} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                  <div className="text-[13px] font-semibold text-foreground">{a.key}</div>
                  <div className="text-[13px] text-muted-foreground text-right">{a.val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
