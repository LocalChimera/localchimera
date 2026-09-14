import { useState, useEffect } from 'react';
import { Rocket, FileCode, Upload, ChevronRight, HardDrive, Wifi, Brain } from 'lucide-react';
import { Button } from './ui';
import { saveDeployment, type Deployment } from '../lib/deployments';
import type { TxRecord } from '../types';

const TABS = ['builder', 'yaml', 'upload'] as const;

const TASKING_NETWORKS = [
  { id: 'akash', name: 'Akash Network', denom: 'uakt', placement: 'dcloud', supports: ['compute', 'gpu', 'storage'] },
  { id: 'golem', name: 'Golem Network', denom: 'glm', placement: 'golem', supports: ['compute', 'gpu', 'storage'] },
] as const;

type NetworkId = (typeof TASKING_NETWORKS)[number]['id'];

function buildYaml(
  network: NetworkId,
  serviceName: string,
  image: string,
  cpu: number,
  gpu: boolean,
  memory: number,
  storage: number,
  count: number,
  bandwidth: number,
  envVars: string,
  command: string,
  exposePort: number,
  exposeGlobal: boolean,
) {
  const n = TASKING_NETWORKS.find((x) => x.id === network) || TASKING_NETWORKS[0];
  const memoryStr = `${memory}Mi`;
  const storageStr = `${storage}Gi`;
  const envLines = envVars.trim()
    ? envVars.trim().split('\n').filter(l => l.trim()).map(l => `        ${l.split('=')[0]?.trim()}: ${l.split('=')[1]?.trim() ?? ''}`).join('\n')
    : '';
  const envBlock = envLines ? `\n      env:\n${envLines}` : '';
  const cmdBlock = command.trim() ? `\n      command: ["sh", "-c", "${command.trim().replace(/"/g, '\\"')}"]` : '';

  if (network === 'golem') {
    return `version: "1.0"
# Golem Network SDL (real, deployable)
payload:
  capsules:
    - name: ${serviceName}
      image: ${image}${cmdBlock}${envBlock}
      runtime:
        type: vm
      resources:
        cpu: { cores: ${Math.max(1, Math.round(cpu))} }
        memory: { size: ${memoryStr} }
        storage: { size: ${storageStr} }
      count: ${count}
  network: ${n.name}
  pricing:
    - name: ${serviceName}
      denom: ${n.denom}
      amount: "0.001"
`;
  }
  return `version: "2.0"
# Akash Network SDL (real, deployable)
services:
  ${serviceName}:
    image: ${image}${cmdBlock}${envBlock}
    expose:
      - port: ${exposePort}
        as: ${exposePort}
        to:
          - global: ${exposeGlobal}
    resources:
      cpu: { units: ${cpu.toFixed(1)} }
${gpu ? '      gpu: { units: 1 }\n' : ''}      memory: { size: ${memoryStr} }
      storage: { size: ${storageStr} }
profiles:
  compute:
    ${serviceName}:
      resources:
        cpu: { units: ${cpu.toFixed(1)} }
        memory: { size: ${memoryStr} }
        storage: { size: ${storageStr} }
  placement:
    ${n.placement}:
      pricing:
        ${serviceName}:
          denom: ${n.denom}
          amount: 10000
deployment:
  ${serviceName}:
    ${n.placement}:
      profile: ${serviceName}
      count: ${count}
`;
}

export default function ConsoleDeploy({
  onNavigate,
  walletId,
  onCreated,
  evmAddress,
  onTx,
}: {
  onNavigate?: (page: string) => void;
  walletId?: string | null;
  onCreated?: (deployment: Deployment) => void;
  evmAddress?: string;
  onTx?: (tx: TxRecord) => void;
}) {
  const [mode, setMode] = useState<'deploy' | 'storage' | 'bandwidth' | 'inference'>('deploy');
  const [tab, setTab] = useState<'builder' | 'yaml' | 'upload'>('builder');
  const [name, setName] = useState('my-deployment');
  const [image, setImage] = useState('library/ubuntu:22.04');
  const [cpu, setCpu] = useState(0.1);
  const [gpu, setGpu] = useState(false);
  const [memory, setMemory] = useState(512);
  const [storage, setStorage] = useState(1);
  const [bandwidth, setBandwidth] = useState(100);
  const [count, setCount] = useState(1);
  const [envVars, setEnvVars] = useState('');
  const [command, setCommand] = useState('');
  const [exposePort, setExposePort] = useState(80);
  const [exposeGlobal, setExposeGlobal] = useState(true);
  const [runtime, setRuntime] = useState('docker');
  const [timeout, setTimeout] = useState(30);
  const [code, setCode] = useState('');
  const [funds, setFunds] = useState('0.1');
  const network: NetworkId = gpu ? 'akash' : 'golem';
  const [networkStats, setNetworkStats] = useState<{ providers: number; gpu?: number; cpu?: number; bandwidth?: number; storage?: number } | null>(null);
  const [yaml, setYaml] = useState(() => buildYaml('akash', 'my-deployment', 'library/ubuntu:22.04', 0.1, false, 512, 1, 1, 100, '', '', 80, true));
  const [fileName, setFileName] = useState('');

  useEffect(() => {
    const apis = [
      { id: 'akash', resource: 'GPU', api: '/api/providers/akash' },
      { id: 'golem', resource: 'CPU', api: '/api/providers/golem' },
      { id: 'mysterium', resource: 'Bandwidth', api: '/api/providers/mysterium' },
      { id: 'anyone', resource: 'Bandwidth', api: '/api/providers/anyone' },
      { id: 'storj', resource: 'Storage', api: '/api/providers/storj' },
    ];
    let cancelled = false;
    Promise.all(apis.map((n) =>
      fetch(n.api).then((r) => r.json()).then((data) => {
        if (n.id === 'akash') return (data || []).map(() => ({ resource: 'GPU' }));
        if (n.id === 'golem') {
          const providers = Array.isArray(data) ? data : (data?.providers || data?.online || []);
          return providers.map(() => ({ resource: 'CPU' }));
        }
        if (n.id === 'storj') return (data || []).map(() => ({ resource: 'Storage' }));
        if (n.id === 'mysterium' || n.id === 'anyone') return (data || []).map(() => ({ resource: 'Bandwidth' }));
        return [];
      }).catch(() => [])
    )).then((results) => {
      if (cancelled) return;
      const all = results.flat();
      setNetworkStats({
        providers: all.length,
        gpu: all.filter((p) => p.resource === 'GPU').length,
        cpu: all.filter((p) => p.resource === 'CPU').length,
        bandwidth: all.filter((p) => p.resource === 'Bandwidth').length,
        storage: all.filter((p) => p.resource === 'Storage').length,
      });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setYaml(buildYaml(network, name, image, cpu, gpu, memory, storage, count, bandwidth, envVars, command, exposePort, exposeGlobal));
  }, [network, name, image, cpu, gpu, memory, storage, count, bandwidth, envVars, command, exposePort, exposeGlobal]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const imageParam = params.get('image');
    if (imageParam) setImage(imageParam);
    const tabParam = params.get('tab') as typeof TABS[number] | null;
    if (tabParam && TABS.includes(tabParam)) setTab(tabParam);
  }, []);

  const deployViaTasker = async (deployment: Deployment, fromAddress?: string) => {
    try {
      const res = await fetch('/api/deploy/' + network, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml, deployment, fromAddress, bridgeAmount: '200' }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.rocketX?.bridgeUrl && typeof window !== 'undefined') {
        window.open(data.rocketX.bridgeUrl, '_blank', 'noopener,noreferrer');
      }
      return { ok: res.ok, data };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Tasker network request failed' };
    }
  };

  const handleCreate = async () => {
    if (!walletId) {
      alert('Connect a wallet before creating a deployment.');
      return;
    }
    const id = `dpl-${Math.random().toString(36).slice(2, 8)}`;
    const net = TASKING_NETWORKS.find((n) => n.id === network);
    const deployment: Deployment = {
      id,
      name: name.trim() || 'my-deployment',
      image: image.trim() || 'library/ubuntu:22.04',
      status: 'pending',
      cpu: Number(cpu.toFixed(1)) || 0.1,
      gpu: gpu ? 1 : 0,
      memory: Math.round(memory / 1024 * 10) / 10 || 0.5,
      storage,
      created: 'just now',
      cost: `${funds || '0.1'} ${net?.denom.toUpperCase() || 'AKT'}/hr`,
      owner: walletId,
    };

    // Deploy via tasker network
    const taskerResult = await deployViaTasker(deployment, evmAddress);
    if (taskerResult.ok) {
      saveDeployment(walletId, deployment);
      if (onCreated) onCreated(deployment);
      else alert(`Fallback deployment ${deployment.name} (${deployment.id}) submitted to ${net?.name}.`);
    } else {
      alert(`Deployment failed: ${taskerResult.error || 'Tasker network unavailable'}`);
    }
  };

  return (
    <div className="max-w-[1200px]">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-[#00e5ff] to-[#a855f7] flex items-center justify-center text-black">
            <Rocket className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-[22px] font-bold text-foreground">Deploy</h1>
            <p className="text-[13px] text-muted-foreground">Create VMs and serverless containers on the Chimera network.</p>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-[14px] p-1.5 mb-6 inline-flex flex-wrap">
        <button
          onClick={() => setMode('deploy')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[13px] font-semibold transition ${mode === 'deploy' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-secondary'}`}
        >
          <Rocket className="w-4 h-4" /> Deploy
        </button>
        <button
          onClick={() => setMode('storage')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[13px] font-semibold transition ${mode === 'storage' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-secondary'}`}
        >
          <HardDrive className="w-4 h-4" /> Storage
        </button>
        <button
          onClick={() => setMode('bandwidth')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[13px] font-semibold transition ${mode === 'bandwidth' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-secondary'}`}
        >
          <Wifi className="w-4 h-4" /> Bandwidth
        </button>
        <button
          onClick={() => setMode('inference')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[13px] font-semibold transition ${mode === 'inference' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-secondary'}`}
        >
          <Brain className="w-4 h-4" /> Inference
        </button>
      </div>

      {mode === 'deploy' && (
        <>
          <div className="bg-card border border-border rounded-[14px] p-5 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-[10px] bg-primary/10 flex items-center justify-center text-primary">
                <Rocket className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-[16px] font-bold text-foreground">Deploy VMs & Serverless Containers</h2>
                <p className="text-[13px] text-muted-foreground">Create VMs and serverless containers on the Chimera network.</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-6">
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <span className="w-6 h-6 rounded-full bg-foreground text-background flex items-center justify-center text-[11px]">✓</span>
              <button onClick={() => onNavigate?.('templates')} className="hover:text-foreground">Choose Template</button>
            </div>
            <div className="w-6 h-[1px] bg-border" />
            <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
              <span className="w-6 h-6 rounded-full bg-foreground text-background flex items-center justify-center text-[11px]">2</span>
              Create Deployment
            </div>
            <div className="w-6 h-[1px] bg-border" />
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <span className="w-6 h-6 rounded-full border border-border text-muted-foreground flex items-center justify-center text-[11px]">3</span>
              Choose Providers
            </div>
          </div>

      <div className="bg-card border border-border rounded-[14px] p-5 mb-4">
        <label className="block text-[14px] font-semibold text-foreground mb-2">Name your deployment</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-deployment" className="w-full border border-border rounded-[10px] px-4 py-2.5 text-[14px] outline-none focus:border-primary bg-card text-foreground" />
        <p className="text-[12px] text-muted-foreground mt-2">
          {gpu ? 'GPU enabled — deploying on Akash Network.' : 'No GPU — deploying on Golem Network.'}
        </p>
      </div>

      {networkStats && (
        <div className="bg-card border border-border rounded-[14px] p-5 mb-4">
          <h3 className="text-[16px] font-bold text-foreground mb-3">Live Network Capacity</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-[13px]">
            <div><span className="text-muted-foreground">Providers</span> <div className="font-semibold text-foreground">{networkStats.providers}</div></div>
            <div><span className="text-muted-foreground">GPU</span> <div className="font-semibold text-foreground">{networkStats.gpu ?? 0}</div></div>
            <div><span className="text-muted-foreground">Compute</span> <div className="font-semibold text-foreground">{networkStats.cpu ?? 0}</div></div>
            <div><span className="text-muted-foreground">Bandwidth</span> <div className="font-semibold text-foreground">{networkStats.bandwidth ?? 0}</div></div>
            <div><span className="text-muted-foreground">Storage</span> <div className="font-semibold text-foreground">{networkStats.storage ?? 0}</div></div>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-[14px] p-1.5 mb-4 inline-flex">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition ${tab === t ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-secondary'}`}
          >
            {t === 'builder' && <Rocket className="w-4 h-4 inline-block mr-1.5" />}
            {t === 'yaml' && <FileCode className="w-4 h-4 inline-block mr-1.5" />}
            {t === 'upload' && <Upload className="w-4 h-4 inline-block mr-1.5" />}
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'builder' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="bg-card border border-border rounded-[14px] p-5 space-y-5">
              <div>
                <label className="block text-[14px] font-semibold text-foreground mb-2">Docker Image / OS</label>
                <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="mydockerimage:tag" className="w-full border border-border rounded-[10px] px-4 py-2.5 text-[14px] outline-none focus:border-primary bg-card text-foreground" />
              </div>
              <div>
                <label className="block text-[14px] font-semibold text-foreground mb-2">CPU</label>
                <input type="range" min="0.1" max="16" step="0.1" value={cpu} onChange={(e) => setCpu(parseFloat(e.target.value))} className="w-full" />
                <div className="text-[13px] text-foreground font-semibold mt-1">{cpu} units</div>
              </div>
              <div>
                <label className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
                  <input type="checkbox" checked={gpu} onChange={(e) => setGpu(e.target.checked)} className="rounded border-border" /> Enable GPU
                </label>
              </div>
              <div>
                <label className="block text-[14px] font-semibold text-foreground mb-2">Memory</label>
                <input type="range" min="128" max="32768" step="128" value={memory} onChange={(e) => setMemory(parseInt(e.target.value))} className="w-full" />
                <div className="text-[13px] text-foreground font-semibold mt-1">{memory} Mi</div>
              </div>
              <div>
                <label className="block text-[14px] font-semibold text-foreground mb-2">Ephemeral Storage</label>
                <input type="range" min="1" max="100" step="1" value={storage} onChange={(e) => setStorage(parseInt(e.target.value))} className="w-full" />
                <div className="text-[13px] text-foreground font-semibold mt-1">{storage} Gi</div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-[14px] p-5 space-y-5">
              <div>
                <label className="block text-[14px] font-semibold text-foreground mb-2">Runtime</label>
                <select value={runtime} onChange={(e) => setRuntime(e.target.value)} className="w-full border border-border rounded-[10px] px-4 py-2.5 text-[14px] outline-none focus:border-primary bg-card text-foreground">
                  <option value="docker">Docker Container</option>
                  <option value="shell">Shell Script</option>
                  <option value="python3">Python 3</option>
                  <option value="node">Node.js</option>
                </select>
              </div>
              <div>
                <label className="block text-[14px] font-semibold text-foreground mb-2">Environment Variables</label>
                <textarea value={envVars} onChange={(e) => setEnvVars(e.target.value)} placeholder={'KEY=value\nDEBUG=true'} rows={3} className="w-full border border-border rounded-[10px] px-4 py-2.5 text-[14px] outline-none focus:border-primary bg-card text-foreground font-mono" />
                <p className="text-[11px] text-muted-foreground mt-1">One per line, KEY=value format</p>
              </div>
              <div>
                <label className="block text-[14px] font-semibold text-foreground mb-2">Command</label>
                <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="e.g. python3 app.py" className="w-full border border-border rounded-[10px] px-4 py-2.5 text-[14px] outline-none focus:border-primary bg-card text-foreground font-mono" />
              </div>
              <div>
                <label className="block text-[14px] font-semibold text-foreground mb-2">Code / Script</label>
                <textarea value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. python3 -c 'print(sum(range(100)))'" rows={3} className="w-full border border-border rounded-[10px] px-4 py-2.5 text-[14px] outline-none focus:border-primary bg-card text-foreground font-mono" />
              </div>
              <div>
                <label className="block text-[14px] font-semibold text-foreground mb-2">Expose</label>
                <div className="flex items-center gap-3">
                  <input type="number" min="1" max="65535" value={exposePort} onChange={(e) => setExposePort(Math.max(1, Math.min(65535, parseInt(e.target.value) || 80)))} className="w-24 border border-border rounded-[10px] px-4 py-2.5 text-[14px] outline-none focus:border-primary bg-card text-foreground" />
                  <span className="text-[13px] text-muted-foreground">(http)</span>
                  <label className="flex items-center gap-2 text-[13px] text-foreground ml-auto">
                    <input type="checkbox" checked={exposeGlobal} onChange={(e) => setExposeGlobal(e.target.checked)} className="rounded border-border" /> Global
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[14px] font-semibold text-foreground mb-2">Service Count</label>
                  <input type="number" min="1" max="20" value={count} onChange={(e) => setCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))} className="w-full border border-border rounded-[10px] px-4 py-2.5 text-[14px] outline-none focus:border-primary bg-card text-foreground" />
                </div>
                <div>
                  <label className="block text-[14px] font-semibold text-foreground mb-2">Timeout (sec)</label>
                  <input type="number" min="1" max="3600" value={timeout} onChange={(e) => setTimeout(Math.max(1, Math.min(3600, parseInt(e.target.value) || 30)))} className="w-full border border-border rounded-[10px] px-4 py-2.5 text-[14px] outline-none focus:border-primary bg-card text-foreground" />
                </div>
              </div>
              <div>
                <label className="block text-[14px] font-semibold text-foreground mb-2">Funds</label>
                <input type="text" value={funds} onChange={(e) => setFunds(e.target.value)} placeholder="0.1" className="w-full border border-border rounded-[10px] px-4 py-2.5 text-[14px] outline-none focus:border-primary bg-card text-foreground" />
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-[14px] p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[16px] font-bold text-foreground">Placement</h3>
              <span className="text-[12px] text-muted-foreground">Edit</span>
            </div>
            <div className="text-[13px] text-muted-foreground space-y-1">
              <div><strong className="text-foreground">Network</strong> {TASKING_NETWORKS.find((n) => n.id === network)?.name}</div>
              <div><strong className="text-foreground">Placement</strong> {TASKING_NETWORKS.find((n) => n.id === network)?.placement}</div>
              <div><strong className="text-foreground">Pricing</strong> Max 0.1 {TASKING_NETWORKS.find((n) => n.id === network)?.denom.toUpperCase()} per block</div>
              <div><strong className="text-foreground">Attributes</strong> None</div>
            </div>
          </div>
        </>
      )}

      {tab === 'yaml' && (
        <div className="bg-card border border-border rounded-[14px] p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[16px] font-bold text-foreground">SDL (YAML)</h3>
            <Button className="bg-card border border-border text-foreground hover:bg-secondary" onClick={() => navigator.clipboard.writeText(yaml)}>Copy</Button>
          </div>
          <textarea value={yaml} onChange={(e) => setYaml(e.target.value)} className="w-full h-[400px] border border-border rounded-[10px] p-4 font-mono text-[13px] outline-none focus:border-primary bg-card text-foreground" />
        </div>
      )}

      {tab === 'upload' && (
        <div className="bg-card border border-border rounded-[14px] p-5 mb-4">
          <label className="block text-[14px] font-semibold text-foreground mb-2">Upload SDL file</label>
          <input
            type="file"
            accept=".yaml,.yml,.json"
            onChange={(e) => setFileName(e.target.files?.[0]?.name || '')}
            className="w-full border border-border rounded-[10px] px-4 py-2.5 text-[14px] outline-none focus:border-primary bg-card text-foreground"
          />
          {fileName && <div className="text-[13px] text-muted-foreground mt-2">Selected: {fileName}</div>}
        </div>
      )}

          <div className="flex items-center justify-end gap-3">
            <Button className="bg-card border border-border text-foreground hover:bg-secondary">Add Service</Button>
            <Button className="bg-foreground text-background hover:opacity-85" onClick={handleCreate}>Create Deployment</Button>
          </div>

        </>)}

      {mode === 'storage' && (
        <div className="bg-card border border-border rounded-[14px] p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-[10px] bg-primary/10 flex items-center justify-center text-primary">
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-[16px] font-bold text-foreground">Storage</h2>
              <p className="text-[13px] text-muted-foreground">Decentralized storage on the Chimera network.</p>
            </div>
          </div>
        </div>
      )}

      {mode === 'bandwidth' && (
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-[14px] p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-[10px] bg-primary/10 flex items-center justify-center text-primary">
                <Wifi className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-[16px] font-bold text-foreground">Bandwidth</h2>
                <p className="text-[13px] text-muted-foreground">Purchase proxy/relay sessions by duration and data allowance.</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-[14px] p-5">
            <p className="text-[13px] text-muted-foreground">Bandwidth configuration coming soon.</p>
          </div>
        </div>
      )}

      {mode === 'inference' && (
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-[14px] p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-[10px] bg-primary/10 flex items-center justify-center text-primary">
                <Brain className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-[16px] font-bold text-foreground">Inference</h2>
                <p className="text-[13px] text-muted-foreground">AI model prompts, streaming, and private FHE inference.</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-[14px] p-5">
            <p className="text-[13px] text-muted-foreground">Inference configuration coming soon.</p>
          </div>
        </div>
      )}
    </div>
  );
}
