import { useState, useEffect, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import EntryPointCard from './EntryPointCard';
import { Button, Input, TextArea, StarRating } from './ui';
import { Send, Brain, HardDrive, Cpu, Wifi, Star, Gavel, AlertTriangle, Trash2, CheckCircle } from 'lucide-react';
import * as sdk from 'casper-js-sdk';
import { CONTRACTS, getContractNamedKeys, queryDictionary, callEntryPointWithWallet } from '../casper-client';
import { createKlerosDispute, hasEthereumWallet, SUBCOURT_IDS } from '../kleros-client';
import type { TxRecord } from '../types';

const JOB_STATUS: Record<string, string> = {
  '0': 'pending', '1': 'acknowledged', '2': 'completed', '3': 'confirmed',
  '4': 'paid', '5': 'refunded', '6': 'disputed', '7': 'resolved',
};

const SESSION_STATUS: Record<string, string> = {
  '0': 'pending', '1': 'confirmed', '2': 'closed', '3': 'disputed', '4': 'resolved',
};

function CategoryHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 mb-4 mt-8 first:mt-0">
      <div className="text-[#00e5ff]">{icon}</div>
      <div>
        <h3 className="text-lg font-bold text-[#e8e2d8]">{title}</h3>
        <p className="text-xs text-[#7a7468]">{subtitle}</p>
      </div>
    </div>
  );
}

type Resource = 'inference' | 'storage' | 'compute' | 'bandwidth';
type Category = 'request' | 'manage' | 'rate' | 'disputes';

const RESOURCES: { id: Resource; label: string; icon: React.ReactNode }[] = [
  { id: 'inference', label: 'Inference', icon: <Brain className="h-4 w-4" /> },
  { id: 'storage', label: 'Storage', icon: <HardDrive className="h-4 w-4" /> },
  { id: 'compute', label: 'Compute', icon: <Cpu className="h-4 w-4" /> },
  { id: 'bandwidth', label: 'Bandwidth', icon: <Wifi className="h-4 w-4" /> },
];

const CATEGORIES: { id: Category; label: string; icon: React.ReactNode; subtitle: string }[] = [
  { id: 'request', label: 'Request', icon: <Send className="h-4 w-4" />, subtitle: 'Submit a new task for the selected resource.' },
  { id: 'manage', label: 'Manage', icon: <HardDrive className="h-4 w-4" />, subtitle: 'Cancel, remove, or modify your active tasks.' },
  { id: 'rate', label: 'Confirm & Rate', icon: <CheckCircle className="h-4 w-4" />, subtitle: 'Confirm completed tasks and rate providers. Recorded on-chain.' },
  { id: 'disputes', label: 'Disputes', icon: <Gavel className="h-4 w-4" />, subtitle: 'Raise disputes within 1 hour of completion to prevent automatic payout.' },
];

const RESOURCE_BY_CATEGORY: Record<Category, Resource[]> = {
  request: ['inference', 'storage', 'compute', 'bandwidth'],
  manage: ['inference', 'storage', 'compute', 'bandwidth'],
  rate: ['inference', 'storage', 'compute', 'bandwidth'],
  disputes: ['inference', 'storage', 'compute', 'bandwidth'],
};

export default function TaskerTab({ provider, publicKeyHex, accountHash, onTx }: {
  provider: any; publicKeyHex: string; accountHash: string; onTx: (tx: TxRecord) => void;
}) {
  const { user, authenticated, login } = usePrivy();
  const evmWallet = user?.wallet;
  const canSign = !!provider && !!publicKeyHex;
  const [category, setCategory] = useState<Category | null>(null);
  const [resource, setResource] = useState<Resource | null>(null);

  // Data loaded from contracts
  const [jobs, setJobs] = useState<any[]>([]);
  const [allocations, setAllocations] = useState<any[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  const [agreements, setAgreements] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);

  const loadData = useCallback(async () => {
    try {
      // Inference jobs - query by consumer's account hash
      const imKeys = await getContractNamedKeys(CONTRACTS.inferenceMarket);
      const jobsUref = imKeys['jobs_dict'] || '';
      if (jobsUref && accountHash) {
        const loaded: any[] = [];
        const ahStr = accountHash.replace('account-hash-', '');
        const pendingUref = imKeys['pending_jobs'] || '';
        let jobIds: string[] = [];
        if (pendingUref) {
          const pendingList = await queryDictionary(pendingUref, 'list');
          console.log('[tasker] pending_jobs list:', pendingList);
          if (Array.isArray(pendingList)) jobIds = pendingList as string[];
        } else {
          console.log('[tasker] no pending_jobs named key found');
        }
        for (const jobId of jobIds) {
          if (!jobId.includes(ahStr)) continue;
          const state = await queryDictionary(jobsUref, `${jobId}:state`);
          if (state === null || state === undefined) continue;
          const responseHash = await queryDictionary(jobsUref, `${jobId}:response_hash`);
          loaded.push({
            id: jobId, state: Number(state),
            status: JOB_STATUS[String(state)] || String(state),
            amount: String(await queryDictionary(jobsUref, `${jobId}:amount`) || '0'),
            responseHash: responseHash || '',
          });
        }
        console.log('[tasker] loaded jobs:', loaded.length, loaded);
        setJobs(loaded);
      } else {
        console.log('[tasker] missing jobsUref or accountHash', { jobsUref: !!jobsUref, accountHash: !!accountHash });
      }

      // Storage allocations + files
      const smKeys = await getContractNamedKeys(CONTRACTS.storageMarket);
      const allocsUref = smKeys['sm_allocations'] || '';
      if (allocsUref) {
        const loaded: any[] = [];
        for (let i = 0; i < 20; i++) {
          const id = `alloc-${i}`;
          const status = await queryDictionary(allocsUref, `${id}:status`);
          if (status === null || status === undefined) continue;
          loaded.push({
            id, status: String(status),
            sizeMb: String(await queryDictionary(allocsUref, `${id}:size`) || '0'),
          });
        }
        setAllocations(loaded);
      }
      const filesUref = smKeys['sm_files'] || '';
      if (filesUref) {
        const loaded: any[] = [];
        for (let i = 0; i < 20; i++) {
          const id = `file-${i}`;
          const status = await queryDictionary(filesUref, `${id}:status`);
          if (status === null || status === undefined) continue;
          loaded.push({ id, status: String(status) });
        }
        setFiles(loaded);
      }

      // Compute agreements
      const cmKeys = await getContractNamedKeys(CONTRACTS.computeMarket);
      const agreementsUref = cmKeys['cm_agreements'] || '';
      if (agreementsUref) {
        const loaded: any[] = [];
        for (let i = 0; i < 20; i++) {
          const id = `agreement-${i}`;
          const status = await queryDictionary(agreementsUref, `${id}:status`);
          if (status === null || status === undefined) continue;
          loaded.push({ id, status: String(status) });
        }
        setAgreements(loaded);
      }

      // Bandwidth sessions
      const bmKeys = await getContractNamedKeys(CONTRACTS.bandwidthMarket);
      const sessionsUref = bmKeys['bm_sessions'] || '';
      if (sessionsUref) {
        const loaded: any[] = [];
        for (let i = 0; i < 20; i++) {
          const id = `session-${i}`;
          const status = await queryDictionary(sessionsUref, `${id}:status`);
          if (status === null || status === undefined) continue;
          loaded.push({ id, status: SESSION_STATUS[String(status)] || String(status) });
        }
        setSessions(loaded);
      }
    } catch (e) {
      console.error('Failed to load tasker data:', e);
    }
  }, [accountHash]);

  useEffect(() => {
    if (accountHash) loadData();
    const id = accountHash ? setInterval(loadData, 15000) : undefined;
    return () => { if (id) clearInterval(id); };
  }, [loadData, accountHash]);

  return (
    <div className="space-y-6">
      {/* STEP 1: CATEGORY SELECTOR */}
      <div>
        <div className="text-xs text-[#7a7468] mb-3">Select a category to get started.</div>
        <div className="flex items-center gap-2 flex-wrap">
          {CATEGORIES.map((c) => (
            <button key={c.id} onClick={() => { setCategory(c.id); setResource(null); }}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${category === c.id ? 'bg-[#00e5ff]/15 border border-[#00e5ff]/30 text-[#00e5ff]' : 'bg-white/[0.03] border border-white/10 text-[#7a7468] hover:bg-white/[0.06] hover:text-[#e8e2d8]'}`}>
              {c.icon}{c.label}
            </button>
          ))}
        </div>
      </div>

      {/* STEP 2: RESOURCE SELECTOR */}
      {category && (
        <div>
          <div className="text-xs text-[#7a7468] mb-3">Select a resource.</div>
          <div className="flex items-center gap-2 flex-wrap">
            {RESOURCE_BY_CATEGORY[category].map((rId) => {
              const r = RESOURCES.find((x) => x.id === rId)!;
              return (
                <button key={r.id} onClick={() => setResource(r.id)}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${resource === r.id ? 'bg-[#00e5ff]/15 border border-[#00e5ff]/30 text-[#00e5ff]' : 'bg-white/[0.03] border border-white/10 text-[#7a7468] hover:bg-white/[0.06] hover:text-[#e8e2d8]'}`}>
                  {r.icon}{r.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* STEP 3: PANEL */}
      {category && resource && (() => {
        const cat = CATEGORIES.find((c) => c.id === category)!;
        return <CategoryHeader icon={cat.icon} title={cat.label} subtitle={cat.subtitle} />;
      })()}

      {category === 'request' && resource && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {resource === 'inference' && (
        <EntryPointCard title="Inference" contract="InferenceMarket" contractHash={CONTRACTS.inferenceMarket} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {() => {
            const [amount, setAmount] = useState('10');
            const [promptText, setPromptText] = useState('');
            const amountMotes = Math.floor(parseFloat(amount || '0') * 1e9).toString();
            const handleSubmit = async (e: any) => {
              e.preventDefault();
              if (!canSign || !promptText.trim()) return;
              const consumerHash = sdk.PublicKey.fromHex(publicKeyHex).accountHash();
              const providerHash = new Uint8Array(32);
              const providerHex = '710891d723070984750be87eb1b5349b68d3ecf75d4070bb9e76b224b33c4e90';
              for (let i = 0; i < 32; i++) providerHash[i] = parseInt(providerHex.substr(i * 2, 2), 16);
              const orderId = `order-${Date.now()}`;
              const result = await callEntryPointWithWallet(provider, publicKeyHex, CONTRACTS.inferenceMarket, 'create_job', {
                consumer: sdk.CLValue.newCLByteArray(consumerHash.toBytes()),
                provider: sdk.CLValue.newCLByteArray(providerHash),
                amount: sdk.CLValue.newCLUInt512(amountMotes),
                provider_fee_bps: sdk.CLValue.newCLUint64('0'),
                order_id: sdk.CLValue.newCLString(orderId),
              });
              if (result.deployHash) {
                onTx({ id: Date.now().toString(), deployHash: result.deployHash, entryPoint: 'create_job', contract: 'InferenceMarket', status: result.error ? 'error' : 'pending', error: result.error });
              }
            };
            const completedJobs = jobs.filter(j => j.state >= 3 && j.responseHash);
            return <div className="space-y-3">
              <form onSubmit={handleSubmit} className="space-y-2">
                <div className="text-xs text-muted-foreground flex items-center gap-1"><Brain className="h-3 w-3 text-[#00e5ff]" />Submit a prompt for inference. Router auto-assigns provider and model.</div>
                <TextArea label="Prompt" value={promptText} onChange={setPromptText} placeholder="Enter your inference prompt..." rows={3} />
                <Input label="Funds (CSPR)" value={amount} onChange={setAmount} />
                <Button type="submit" disabled={!canSign || !promptText.trim()} className="w-full"><Send className="h-4 w-4 mr-1" />Request Inference</Button>
              </form>
              {completedJobs.length > 0 && (
                <div className="space-y-2 mt-3 border-t border-white/10 pt-3">
                  <div className="text-xs font-semibold text-[#00e5ff] flex items-center gap-1"><CheckCircle className="h-3 w-3" />Inference Results</div>
                  {completedJobs.map((job) => (
                    <div key={job.id} className="bg-white/[0.03] border border-white/10 rounded-lg p-3 space-y-1">
                      <div className="text-[10px] text-[#7a7468] font-mono">{job.id}</div>
                      <div className="text-xs text-[#e8e2d8] whitespace-pre-wrap break-words">{job.responseHash}</div>
                      <div className="text-[10px] text-[#7a7468]">Status: {job.status}</div>
                    </div>
                  ))}
                </div>
              )}
              {jobs.length > 0 && jobs.filter(j => j.state < 3).length > 0 && (
                <div className="space-y-1 mt-3 border-t border-white/10 pt-3">
                  <div className="text-xs font-semibold text-[#7a7468]">Pending Jobs</div>
                  {jobs.filter(j => j.state < 3).map((job) => (
                    <div key={job.id} className="flex items-center justify-between text-xs bg-white/[0.02] rounded p-2">
                      <span className="font-mono text-[10px] text-[#7a7468]">{job.id}</span>
                      <span className="text-[#00e5ff]">{job.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>;
          }}
        </EntryPointCard>
        )}

        {resource === 'storage' && (
        <EntryPointCard title="Storage" contract="StorageMarket" contractHash={CONTRACTS.storageMarket} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [sizeGb, setSizeGb] = useState('1');
            const [durationDays, setDurationDays] = useState('30');
            const [redundancy, setRedundancy] = useState('standard');
            const [amount, setAmount] = useState('10');
            const sizeMb = Math.floor(parseFloat(sizeGb || '0') * 1024).toString();
            const expiryMs = String(Date.now() + parseInt(durationDays || '30') * 24 * 60 * 60 * 1000);
            const shardConfig: Record<string, { data: string; parity: string }> = {
              standard: { data: '3', parity: '1' }, high: { data: '5', parity: '2' }, minimal: { data: '2', parity: '1' },
            };
            const shards = shardConfig[redundancy] || shardConfig.standard;
            const amountMotes = Math.floor(parseFloat(amount || '0') * 1e9).toString();
            return <form onSubmit={(e) => { e.preventDefault(); submit('create_allocation', {
              data_shards: sdk.CLValue.newCLUint64(shards.data),
              parity_shards: sdk.CLValue.newCLUint64(shards.parity),
              size_mb: sdk.CLValue.newCLUint64(sizeMb),
              expiry_ms: sdk.CLValue.newCLUint64(expiryMs),
              amount: sdk.CLValue.newCLUInt512(amountMotes),
            }); }} className="space-y-2">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><HardDrive className="h-3 w-3 text-[#00e5ff]" />Reserve decentralized storage. Files are encrypted and sharded across providers.</div>
              <Input label="Storage Size (GB)" value={sizeGb} onChange={setSizeGb} />
              <Input label="Duration (days)" value={durationDays} onChange={setDurationDays} />
              <div className="space-y-1">
                <label className="text-sm font-medium">Redundancy</label>
                <div className="flex gap-2">
                  {Object.entries(shardConfig).map(([key]) => (
                    <button key={key} type="button" onClick={() => setRedundancy(key)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${redundancy === key ? 'bg-[#00e5ff]/15 border-[#00e5ff]/30 text-[#00e5ff]' : 'bg-white/5 border-white/10 text-[#7a7468] hover:bg-white/10'}`}>
                      {key === 'standard' ? 'Standard (3+1)' : key === 'high' ? 'High (5+2)' : 'Minimal (2+1)'}
                    </button>
                  ))}
                </div>
              </div>
              <Input label="Funds (CSPR)" value={amount} onChange={setAmount} />
              <Button type="submit" disabled={!canSign} className="w-full"><HardDrive className="h-4 w-4 mr-1" />Reserve Storage</Button>
            </form>;
          }}
        </EntryPointCard>
        )}

        {resource === 'storage' && (
        <EntryPointCard title="Store File" contract="StorageMarket" contractHash={CONTRACTS.storageMarket} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [allocId, setAllocId] = useState('');
            const [selectedFile, setSelectedFile] = useState<File | null>(null);
            const [uploading, setUploading] = useState(false);
            const amountMotes = Math.floor(parseFloat('1') * 1e9).toString();
            const activeAllocations = allocations.filter(a => a.status === '0' || a.status === '1');
            const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
              const f = e.target.files?.[0] || null;
              setSelectedFile(f);
            };
            const handleSubmit = async (e: any) => {
              e.preventDefault();
              if (!canSign || !allocId.trim() || !selectedFile) return;
              setUploading(true);
              try {
                const fileBuffer = await selectedFile.arrayBuffer();
                const hashBuffer = await crypto.subtle.digest('SHA-256', fileBuffer);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                const fileHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                const sizeMb = String(Math.ceil(selectedFile.size / (1024 * 1024)));
                submit('store_file', {
                  alloc_id: sdk.CLValue.newCLString(allocId),
                  file_hash: sdk.CLValue.newCLString(fileHash),
                  size_mb: sdk.CLValue.newCLUint64(sizeMb),
                  amount: sdk.CLValue.newCLUInt512(amountMotes),
                });
              } finally {
                setUploading(false);
              }
            };
            return <form onSubmit={handleSubmit} className="space-y-2">
              <div className="text-xs text-muted-foreground">Upload a file to your storage allocation. Hash is computed automatically.</div>
              {activeAllocations.length > 0 && (
                <div className="space-y-1">
                  <label className="text-sm font-medium">Select Allocation</label>
                  <div className="flex flex-wrap gap-1">
                    {activeAllocations.map(a => (
                      <button key={a.id} type="button" onClick={() => setAllocId(a.id)}
                        className={`text-[10px] px-2 py-1 rounded font-mono ${allocId === a.id ? 'bg-[#00e5ff]/20 text-[#00e5ff]' : 'bg-white/5 text-[#7a7468] hover:bg-white/10'}`}>
                        {a.id} ({a.sizeMb} MB)
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {activeAllocations.length === 0 && (
                <div className="text-xs text-amber-400">No active allocations. Reserve storage space first.</div>
              )}
              <div className="space-y-1">
                <label className="text-sm font-medium">Upload File</label>
                <div className="border border-white/10 rounded-lg p-4 text-center hover:border-[#00e5ff]/30 transition-colors">
                  <input type="file" onChange={handleFileChange} className="hidden" id="file-upload" />
                  <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-2">
                    <HardDrive className="h-6 w-6 text-[#7a7468]" />
                    {selectedFile ? (
                      <span className="text-xs text-[#00e5ff]">{selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)</span>
                    ) : (
                      <span className="text-xs text-[#7a7468]">Click to select a file</span>
                    )}
                  </label>
                </div>
              </div>
              <Button type="submit" disabled={!canSign || !allocId.trim() || !selectedFile || uploading} className="w-full"><Send className="h-4 w-4 mr-1" />{uploading ? 'Processing...' : 'Store File'}</Button>
            </form>;
          }}
        </EntryPointCard>
        )}

        {resource === 'compute' && (
        <EntryPointCard title="Compute" contract="ComputeMarket" contractHash={CONTRACTS.computeMarket} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [runtime, setRuntime] = useState('docker://ubuntu:latest');
            const [maxCost, setMaxCost] = useState('100');
            const [duration, setDuration] = useState('3600');
            const [requiresGpu, setRequiresGpu] = useState(false);
            const [minVram, setMinVram] = useState('0');
            const maxCostMotes = Math.floor(parseFloat(maxCost || '0') * 1e9).toString();
            return <form onSubmit={(e) => { e.preventDefault(); submit('create_demand', {
              task_type: sdk.CLValue.newCLString('compute'),
              runtime: sdk.CLValue.newCLString(runtime),
              max_cost: sdk.CLValue.newCLUInt512(maxCostMotes),
              duration_sec: sdk.CLValue.newCLUint64(duration),
              requires_gpu: sdk.CLValue.newCLValueBool(requiresGpu),
              min_vram_mb: sdk.CLValue.newCLUint64(minVram),
            }); }} className="space-y-2">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><Cpu className="h-3 w-3 text-[#00e5ff]" />Request compute resources. Router auto-matches you with a provider.</div>
              <Input label="Runtime (e.g. docker://ubuntu:latest)" value={runtime} onChange={setRuntime} />
              <Input label="Max Cost (CSPR)" value={maxCost} onChange={setMaxCost} />
              <Input label="Duration (seconds)" value={duration} onChange={setDuration} />
              <div className="flex items-center gap-2">
                <label className="text-sm flex items-center gap-2">
                  <input type="checkbox" checked={requiresGpu} onChange={(e) => setRequiresGpu(e.target.checked)} className="rounded" />
                  Requires GPU
                </label>
                {requiresGpu && <Input label="Min VRAM (MB)" value={minVram} onChange={setMinVram} />}
              </div>
              <Button type="submit" disabled={!canSign || !runtime.trim()} className="w-full"><Send className="h-4 w-4 mr-1" />Create Demand</Button>
            </form>;
          }}
        </EntryPointCard>
        )}

        {resource === 'bandwidth' && (
        <EntryPointCard title="Bandwidth" contract="BandwidthMarket" contractHash={CONTRACTS.bandwidthMarket} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {() => {
            const [durationHours, setDurationHours] = useState('1');
            const [dataGb, setDataGb] = useState('1');
            const [amount, setAmount] = useState('10');
            const maxDuration = String(parseInt(durationHours || '0') * 3600);
            const maxData = String(Math.floor(parseFloat(dataGb || '0') * 1024));
            const amountMotes = Math.floor(parseFloat(amount || '0') * 1e9).toString();
            const handleSubmit = async (e: any) => {
              e.preventDefault();
              if (!canSign) return;
              const result = await callEntryPointWithWallet(provider, publicKeyHex, CONTRACTS.bandwidthMarket, 'create_session', {
                consumer_pubkey: sdk.CLValue.newCLString(publicKeyHex),
                max_duration_sec: sdk.CLValue.newCLUint64(maxDuration),
                max_data_mb: sdk.CLValue.newCLUint64(maxData),
                amount: sdk.CLValue.newCLUInt512(amountMotes),
              });
              if (result.deployHash) {
                onTx({ id: Date.now().toString(), deployHash: result.deployHash, entryPoint: 'create_session', contract: 'BandwidthMarket', status: result.error ? 'error' : 'pending', error: result.error });
              }
            };
            return <form onSubmit={handleSubmit} className="space-y-2">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><Wifi className="h-3 w-3 text-[#00e5ff]" />Purchase bandwidth. Higher-paying requests get routed first.</div>
              <Input label="Duration (hours)" value={durationHours} onChange={setDurationHours} />
              <Input label="Data Allowance (GB)" value={dataGb} onChange={setDataGb} />
              <Input label="Funds (CSPR)" value={amount} onChange={setAmount} />
              <Button type="submit" disabled={!canSign} className="w-full"><Wifi className="h-4 w-4 mr-1" />Get Bandwidth</Button>
            </form>;
          }}
        </EntryPointCard>
        )}
      </div>
      )}

      {category === 'manage' && resource && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {resource === 'storage' && (<>
          <EntryPointCard title="Remove File" contract="StorageMarket" contractHash={CONTRACTS.storageMarket} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
            {({ submit }) => {
              const [fileId, setFileId] = useState('');
              return <form onSubmit={(e) => { e.preventDefault(); submit('remove_file', {
                file_id: sdk.CLValue.newCLString(fileId),
              }); }} className="space-y-2">
                <div className="text-xs text-muted-foreground">Remove a stored file.</div>
                <Input label="File ID" value={fileId} onChange={setFileId} />
                <Button type="submit" disabled={!canSign || !fileId.trim()} variant="danger" className="w-full"><Trash2 className="h-4 w-4 mr-1" />Remove</Button>
              </form>;
            }}
          </EntryPointCard>

          <EntryPointCard title="Cancel Allocation" contract="StorageMarket" contractHash={CONTRACTS.storageMarket} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
            {({ submit }) => {
              const [allocId, setAllocId] = useState('');
              return <form onSubmit={(e) => { e.preventDefault(); submit('cancel_allocation', {
                alloc_id: sdk.CLValue.newCLString(allocId),
              }); }} className="space-y-2">
                <div className="text-xs text-muted-foreground">Cancel an unfilled allocation to retrieve funds.</div>
                <Input label="Allocation ID" value={allocId} onChange={setAllocId} />
                <Button type="submit" disabled={!canSign || !allocId.trim()} variant="danger" className="w-full">Cancel Allocation</Button>
              </form>;
            }}
          </EntryPointCard>
        </>)}

        {resource === 'compute' && (
          <EntryPointCard title="Cancel Demand" contract="ComputeMarket" contractHash={CONTRACTS.computeMarket} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
            {({ submit }) => {
              const [demandId, setDemandId] = useState('');
              return <form onSubmit={(e) => { e.preventDefault(); submit('cancel_demand', {
                demand_id: sdk.CLValue.newCLString(demandId),
              }); }} className="space-y-2">
                <div className="text-xs text-muted-foreground">Cancel an open compute demand.</div>
                <Input label="Demand ID" value={demandId} onChange={setDemandId} />
                <Button type="submit" disabled={!canSign || !demandId.trim()} variant="danger" className="w-full">Cancel Demand</Button>
              </form>;
            }}
          </EntryPointCard>
        )}

        {resource === 'inference' && (
          <EntryPointCard title="Cancel Job" contract="InferenceMarket" contractHash={CONTRACTS.inferenceMarket} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
            {({ submit }) => {
              const [jobId, setJobId] = useState('');
              const pendingJobs = jobs.filter(j => j.status === 'pending' || j.status === 'acknowledged');
              return <form onSubmit={(e) => { e.preventDefault(); submit('cancel_job', {
                job_id: sdk.CLValue.newCLString(jobId),
              }); }} className="space-y-2">
                <div className="text-xs text-muted-foreground">Cancel a pending or acknowledged inference job.</div>
                {pendingJobs.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {pendingJobs.map(j => (
                      <button key={j.id} type="button" onClick={() => setJobId(j.id)}
                        className={`text-[10px] px-2 py-1 rounded font-mono ${jobId === j.id ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-[#7a7468] hover:bg-white/10'}`}>
                        {j.id}
                      </button>
                    ))}
                  </div>
                )}
                <Input label="Job ID" value={jobId} onChange={setJobId} />
                <Button type="submit" disabled={!canSign || !jobId.trim()} variant="danger" className="w-full"><Trash2 className="h-4 w-4 mr-1" />Cancel Job</Button>
              </form>;
            }}
          </EntryPointCard>
        )}

        {resource === 'bandwidth' && (
          <EntryPointCard title="Close Session" contract="BandwidthMarket" contractHash={CONTRACTS.bandwidthMarket} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
            {({ submit }) => {
              const [sessionId, setSessionId] = useState('');
              const activeSessions = sessions.filter(s => s.status === 'pending' || s.status === 'confirmed');
              return <form onSubmit={(e) => { e.preventDefault(); submit('close_session', {
                session_id: sdk.CLValue.newCLString(sessionId),
              }); }} className="space-y-2">
                <div className="text-xs text-muted-foreground">Close an active bandwidth session.</div>
                {activeSessions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {activeSessions.map(s => (
                      <button key={s.id} type="button" onClick={() => setSessionId(s.id)}
                        className={`text-[10px] px-2 py-1 rounded font-mono ${sessionId === s.id ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-[#7a7468] hover:bg-white/10'}`}>
                        {s.id}
                      </button>
                    ))}
                  </div>
                )}
                <Input label="Session ID" value={sessionId} onChange={setSessionId} />
                <Button type="submit" disabled={!canSign || !sessionId.trim()} variant="danger" className="w-full"><Trash2 className="h-4 w-4 mr-1" />Close Session</Button>
              </form>;
            }}
          </EntryPointCard>
        )}
      </div>
      )}

      {category === 'rate' && resource && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {resource === 'inference' && (
        <EntryPointCard title="Inference" contract="InferenceMarket" contractHash={CONTRACTS.inferenceMarket} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [jobId, setJobId] = useState('');
            const [rating, setRating] = useState(0);
            const pendingJobs = jobs.filter(j => j.status === 'completed');
            return <form onSubmit={(e) => { e.preventDefault(); submit('consumer_confirm', {
              job_id: sdk.CLValue.newCLString(jobId),
              rating: sdk.CLValue.newCLUint64(String(rating)),
            }); }} className="space-y-2">
              <div className="text-xs text-muted-foreground">Confirm job completion and rate the provider. Payment auto-releases after 1 hour if no dispute.</div>
              {pendingJobs.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {pendingJobs.map(j => (
                    <button key={j.id} type="button" onClick={() => setJobId(j.id)}
                      className={`text-[10px] px-2 py-1 rounded font-mono ${jobId === j.id ? 'bg-[#00e5ff]/20 text-[#00e5ff]' : 'bg-white/5 text-[#7a7468] hover:bg-white/10'}`}>
                      {j.id}
                    </button>
                  ))}
                </div>
              )}
              <Input label="Job ID" value={jobId} onChange={setJobId} />
              <div className="space-y-1">
                <label className="text-sm font-medium">Provider Rating</label>
                <StarRating value={rating} onChange={setRating} />
              </div>
              <Button type="submit" disabled={!canSign || !jobId.trim() || rating === 0} className="w-full"><Send className="h-4 w-4 mr-1" />Confirm & Rate</Button>
            </form>;
          }}
        </EntryPointCard>
        )}

        {resource === 'storage' && (
        <EntryPointCard title="Storage" contract="StorageMarket" contractHash={CONTRACTS.storageMarket} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [fileId, setFileId] = useState('');
            const [rating, setRating] = useState(0);
            const confirmedFiles = files.filter(f => f.status === '1');
            return <form onSubmit={(e) => { e.preventDefault(); submit('rate_provider', {
              file_id: sdk.CLValue.newCLString(fileId),
              rating: sdk.CLValue.newCLUint64(String(rating)),
            }); }} className="space-y-2">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><Star className="h-3 w-3 text-[#00e5ff]" />Rate the storage provider after file confirmation.</div>
              {confirmedFiles.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {confirmedFiles.map(f => (
                    <button key={f.id} type="button" onClick={() => setFileId(f.id)}
                      className={`text-[10px] px-2 py-1 rounded font-mono ${fileId === f.id ? 'bg-[#00e5ff]/20 text-[#00e5ff]' : 'bg-white/5 text-[#7a7468] hover:bg-white/10'}`}>
                      {f.id}
                    </button>
                  ))}
                </div>
              )}
              <Input label="File ID" value={fileId} onChange={setFileId} />
              <div className="space-y-1">
                <label className="text-sm font-medium">Provider Rating</label>
                <StarRating value={rating} onChange={setRating} />
              </div>
              <Button type="submit" disabled={!canSign || !fileId.trim() || rating === 0} className="w-full"><Star className="h-4 w-4 mr-1" />Rate Provider</Button>
            </form>;
          }}
        </EntryPointCard>
        )}

        {resource === 'compute' && (
        <EntryPointCard title="Compute" contract="ComputeMarket" contractHash={CONTRACTS.computeMarket} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [agreementId, setAgreementId] = useState('');
            const [rating, setRating] = useState(0);
            const completedAgreements = agreements.filter(a => a.status === '4');
            return <form onSubmit={(e) => { e.preventDefault(); submit('rate_provider', {
              agreement_id: sdk.CLValue.newCLString(agreementId),
              rating: sdk.CLValue.newCLUint64(String(rating)),
            }); }} className="space-y-2">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><Star className="h-3 w-3 text-[#00e5ff]" />Rate the compute provider after agreement completion.</div>
              {completedAgreements.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {completedAgreements.map(a => (
                    <button key={a.id} type="button" onClick={() => setAgreementId(a.id)}
                      className={`text-[10px] px-2 py-1 rounded font-mono ${agreementId === a.id ? 'bg-[#00e5ff]/20 text-[#00e5ff]' : 'bg-white/5 text-[#7a7468] hover:bg-white/10'}`}>
                      {a.id}
                    </button>
                  ))}
                </div>
              )}
              <Input label="Agreement ID" value={agreementId} onChange={setAgreementId} />
              <div className="space-y-1">
                <label className="text-sm font-medium">Provider Rating</label>
                <StarRating value={rating} onChange={setRating} />
              </div>
              <Button type="submit" disabled={!canSign || !agreementId.trim() || rating === 0} className="w-full"><Star className="h-4 w-4 mr-1" />Rate Provider</Button>
            </form>;
          }}
        </EntryPointCard>
        )}

        {resource === 'bandwidth' && (
        <EntryPointCard title="Bandwidth" contract="BandwidthMarket" contractHash={CONTRACTS.bandwidthMarket} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [sessionId, setSessionId] = useState('');
            const [rating, setRating] = useState(0);
            const closedSessions = sessions.filter(s => s.status === 'closed' || s.status === 'resolved');
            return <form onSubmit={(e) => { e.preventDefault(); submit('rate_provider', {
              session_id: sdk.CLValue.newCLString(sessionId),
              rating: sdk.CLValue.newCLUint64(String(rating)),
            }); }} className="space-y-2">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><Star className="h-3 w-3 text-[#00e5ff]" />Rate the bandwidth provider after session completion.</div>
              {closedSessions.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {closedSessions.map(s => (
                    <button key={s.id} type="button" onClick={() => setSessionId(s.id)}
                      className={`text-[10px] px-2 py-1 rounded font-mono ${sessionId === s.id ? 'bg-[#00e5ff]/20 text-[#00e5ff]' : 'bg-white/5 text-[#7a7468] hover:bg-white/10'}`}>
                      {s.id}
                    </button>
                  ))}
                </div>
              )}
              <Input label="Session ID" value={sessionId} onChange={setSessionId} />
              <div className="space-y-1">
                <label className="text-sm font-medium">Provider Rating</label>
                <StarRating value={rating} onChange={setRating} />
              </div>
              <Button type="submit" disabled={!canSign || !sessionId.trim() || rating === 0} className="w-full"><Star className="h-4 w-4 mr-1" />Rate Provider</Button>
            </form>;
          }}
        </EntryPointCard>
        )}
      </div>
      )}

      {category === 'disputes' && resource && (
      <div className="space-y-4">
        {/* Step 1: Casper wallet check */}
        <div className={`text-sm p-3 rounded-lg border ${canSign ? 'text-green-400 bg-green-500/5 border-green-500/10' : 'text-amber-400 bg-amber-500/5 border-amber-500/10'}`}>
          <strong>Step 1 — Casper Wallet:</strong> {canSign ? <>Connected ({publicKeyHex.slice(0, 12)}…)</> : <>Not connected. Connect your Casper wallet to continue.</>}
        </div>
        {/* Step 2: Transaction details (shown when Casper connected) */}
        {canSign && (
          <div className="text-sm text-[#7a7468] bg-white/5 border border-white/10 p-3 rounded-lg">
            <strong>Step 2 — Specify Transaction:</strong> Fill in the transaction details below (Job/Session/File/Agreement ID and evidence hash).
          </div>
        )}
        {/* Step 3: Privy connection (shown when Casper connected) */}
        {canSign && (
          <div className={`text-sm p-3 rounded-lg border ${evmWallet ? 'text-green-400 bg-green-500/5 border-green-500/10' : 'text-amber-400 bg-amber-500/5 border-amber-500/10'}`}>
            <strong>Step 3 — Connect Privy (EVM):</strong>{' '}
            {evmWallet
              ? <>Connected</>
              : authenticated
                ? <>Waiting for wallet creation…</>
                : <button onClick={() => login()} className="underline text-[#00e5ff]">Connect with Privy</button>}
            {' '}— required to pay the Kleros arbitration fee via Ethereum.
          </div>
        )}
        {/* Step 4: Dispute forms (shown when both wallets connected) */}
        {canSign && evmWallet && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {resource === 'inference' && (
        <EntryPointCard title="Inference" contract="InferenceMarket" contractHash={CONTRACTS.inferenceMarket} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [jobId, setJobId] = useState('');
            const [evidence, setEvidence] = useState('');
            const [klerosId, setKlerosId] = useState('');
            const [creating, setCreating] = useState(false);
            const [klerosError, setKlerosError] = useState('');
            const disputableJobs = jobs.filter(j => j.status === 'completed' || j.status === 'confirmed');
            const handleDispute = async (e: React.FormEvent) => {
              e.preventDefault();
              if (!evmWallet) { setKlerosError('Connect your Privy EVM wallet first (Step 3).'); return; }
              if (!jobId.trim()) { setKlerosError('Specify a Job ID (Step 2).'); return; }
              setCreating(true); setKlerosError('');
              try {
                const evmProvider = await evmWallet.getEthereumProvider();
                const result = await createKlerosDispute(SUBCOURT_IDS.TECHNICAL, 3, false, evmProvider);
                setKlerosId(String(result.disputeId));
                submit('dispute_job', {
                  job_id: sdk.CLValue.newCLString(jobId),
                  evidence_hash: sdk.CLValue.newCLString(evidence),
                });
              } catch (err: any) {
                setKlerosError('Kleros: ' + (err.message || String(err)));
              }
              setCreating(false);
            };
            return <form onSubmit={handleDispute} className="space-y-2">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-400" />Step 4 — Raise a dispute within 1 hour of completion. A Kleros Court dispute is created automatically — you pay the arbitration fee via ETH.</div>
              {disputableJobs.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {disputableJobs.map(j => (
                    <button key={j.id} type="button" onClick={() => setJobId(j.id)}
                      className={`text-[10px] px-2 py-1 rounded font-mono ${jobId === j.id ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-[#7a7468] hover:bg-white/10'}`}>
                      {j.id}
                    </button>
                  ))}
                </div>
              )}
              <Input label="Job ID" value={jobId} onChange={setJobId} />
              <Input label="Evidence Hash" value={evidence} onChange={setEvidence} />
              {klerosId && <div className="text-xs text-[#00e5ff]">Kleros Dispute #{klerosId} created</div>}
              {klerosError && <div className="text-xs text-amber-400">{klerosError}</div>}
              <Button type="submit" disabled={!canSign || !evmWallet || !jobId.trim() || creating} variant="danger" className="w-full">
                {creating ? <CheckCircle className="h-4 w-4 mr-1 animate-pulse" /> : <Gavel className="h-4 w-4 mr-1" />}
                Dispute (Kleros Auto)
              </Button>
            </form>;
          }}
        </EntryPointCard>
        )}

        {resource === 'bandwidth' && (
        <EntryPointCard title="Bandwidth" contract="BandwidthMarket" contractHash={CONTRACTS.bandwidthMarket} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [sessionId, setSessionId] = useState('');
            const [evidence, setEvidence] = useState('');
            const [creating, setCreating] = useState(false);
            const [klerosError, setKlerosError] = useState('');
            const handleDispute = async (e: React.FormEvent) => {
              e.preventDefault();
              if (!evmWallet) { setKlerosError('Connect your Privy EVM wallet first (Step 3).'); return; }
              if (!sessionId.trim()) { setKlerosError('Specify a Session ID (Step 2).'); return; }
              setCreating(true); setKlerosError('');
              try {
                const evmProvider = await evmWallet.getEthereumProvider();
                await createKlerosDispute(SUBCOURT_IDS.TECHNICAL, 3, false, evmProvider);
                submit('dispute_session', {
                  session_id: sdk.CLValue.newCLString(sessionId),
                  evidence_hash: sdk.CLValue.newCLString(evidence),
                });
              } catch (err: any) {
                setKlerosError('Kleros: ' + (err.message || String(err)));
              }
              setCreating(false);
            };
            return <form onSubmit={handleDispute} className="space-y-2">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-400" />Step 4 — Raise a dispute for a bandwidth session. A Kleros Court dispute is created automatically — you pay the arbitration fee via ETH.</div>
              <Input label="Session ID" value={sessionId} onChange={setSessionId} />
              <Input label="Evidence Hash" value={evidence} onChange={setEvidence} />
              {klerosError && <div className="text-xs text-amber-400">{klerosError}</div>}
              <Button type="submit" disabled={!canSign || !evmWallet || !sessionId.trim() || creating} variant="danger" className="w-full">
                {creating ? <CheckCircle className="h-4 w-4 mr-1 animate-pulse" /> : <Gavel className="h-4 w-4 mr-1" />}
                Dispute (Kleros Auto)
              </Button>
            </form>;
          }}
        </EntryPointCard>
        )}

        {resource === 'storage' && (
        <EntryPointCard title="Storage" contract="StorageMarket" contractHash={CONTRACTS.storageMarket} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [fileId, setFileId] = useState('');
            const [evidence, setEvidence] = useState('');
            const [creating, setCreating] = useState(false);
            const [klerosError, setKlerosError] = useState('');
            const handleDispute = async (e: React.FormEvent) => {
              e.preventDefault();
              if (!evmWallet) { setKlerosError('Connect your Privy EVM wallet first (Step 3).'); return; }
              if (!fileId.trim()) { setKlerosError('Specify a File ID (Step 2).'); return; }
              setCreating(true); setKlerosError('');
              try {
                const evmProvider = await evmWallet.getEthereumProvider();
                await createKlerosDispute(SUBCOURT_IDS.TECHNICAL, 3, false, evmProvider);
                submit('dispute_file', {
                  file_id: sdk.CLValue.newCLString(fileId),
                  evidence_hash: sdk.CLValue.newCLString(evidence),
                });
              } catch (err: any) {
                setKlerosError('Kleros: ' + (err.message || String(err)));
              }
              setCreating(false);
            };
            return <form onSubmit={handleDispute} className="space-y-2">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-400" />Step 4 — Raise a dispute for a stored file. A Kleros Court dispute is created automatically — you pay the arbitration fee via ETH.</div>
              <Input label="File ID" value={fileId} onChange={setFileId} />
              <Input label="Evidence Hash" value={evidence} onChange={setEvidence} />
              {klerosError && <div className="text-xs text-amber-400">{klerosError}</div>}
              <Button type="submit" disabled={!canSign || !evmWallet || !fileId.trim() || creating} variant="danger" className="w-full">
                {creating ? <CheckCircle className="h-4 w-4 mr-1 animate-pulse" /> : <Gavel className="h-4 w-4 mr-1" />}
                Dispute (Kleros Auto)
              </Button>
            </form>;
          }}
        </EntryPointCard>
        )}

        {resource === 'compute' && (
        <EntryPointCard title="Compute" contract="ComputeMarket" contractHash={CONTRACTS.computeMarket} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [agreementId, setAgreementId] = useState('');
            const [evidence, setEvidence] = useState('');
            const [creating, setCreating] = useState(false);
            const [klerosError, setKlerosError] = useState('');
            const handleDispute = async (e: React.FormEvent) => {
              e.preventDefault();
              if (!evmWallet) { setKlerosError('Connect your Privy EVM wallet first (Step 3).'); return; }
              if (!agreementId.trim()) { setKlerosError('Specify an Agreement ID (Step 2).'); return; }
              setCreating(true); setKlerosError('');
              try {
                const evmProvider = await evmWallet.getEthereumProvider();
                await createKlerosDispute(SUBCOURT_IDS.TECHNICAL, 3, false, evmProvider);
                submit('dispute_agreement', {
                  agreement_id: sdk.CLValue.newCLString(agreementId),
                  evidence_hash: sdk.CLValue.newCLString(evidence),
                });
              } catch (err: any) {
                setKlerosError('Kleros: ' + (err.message || String(err)));
              }
              setCreating(false);
            };
            return <form onSubmit={handleDispute} className="space-y-2">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-400" />Step 4 — Raise a dispute for a compute agreement. A Kleros Court dispute is created automatically — you pay the arbitration fee via ETH.</div>
              <Input label="Agreement ID" value={agreementId} onChange={setAgreementId} />
              <Input label="Evidence Hash" value={evidence} onChange={setEvidence} />
              {klerosError && <div className="text-xs text-amber-400">{klerosError}</div>}
              <Button type="submit" disabled={!canSign || !evmWallet || !agreementId.trim() || creating} variant="danger" className="w-full">
                {creating ? <CheckCircle className="h-4 w-4 mr-1 animate-pulse" /> : <Gavel className="h-4 w-4 mr-1" />}
                Dispute (Kleros Auto)
              </Button>
            </form>;
          }}
        </EntryPointCard>
        )}
        </div>
        )}
      </div>
      )}
    </div>
  );
}
