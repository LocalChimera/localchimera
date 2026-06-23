import { useState, useEffect, useCallback } from 'react';
import EntryPointCard from './EntryPointCard';
import { Button, Input, Card, Badge } from './ui';
import { Send, Shield, Clock, RefreshCw, AlertCircle } from 'lucide-react';
import type { TxRecord } from '../types';
import * as sdk from 'casper-js-sdk';
import { getContractNamedKeys, queryDictionary } from '../casper-client';

function accountHashToBytes(hashStr: string): Uint8Array {
  const bytes = new Uint8Array(32);
  const hex = hashStr.replace('account-hash-', '');
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

interface Job {
  id: string;
  consumer: string;
  provider: string;
  amount: string;
  state: string;
  validUntil: number;
  createdAt: number;
  responseHash: string;
  responseText: string;
}

async function fetchInferenceText(jobId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.localchimera.com/result?job_id=${encodeURIComponent(jobId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.text || null;
  } catch { return null; }
}

const STATE_LABELS: Record<string, string> = {
  '0': 'pending', '1': 'assigned', '2': 'in_progress', '3': 'provider_done',
  '4': 'consumer_confirm', '5': 'settled', '6': 'refunded', '7': 'disputed',
  '8': 'consumer_won', '9': 'provider_won',
};

export default function EscrowVaultTab({ provider, publicKeyHex, contractHash, accountHash, contractKeys, onTx }: {
  provider: any; publicKeyHex: string; contractHash: string; accountHash: string;
  contractKeys: Record<string, { name: string; key: string }[]>;
  onTx: (tx: TxRecord) => void;
}) {
  const canSign = !!provider && !!publicKeyHex;
  const ownerKey = contractKeys['escrowVault']?.find(k => k.name === 'owner')?.key || '';
  const isAdmin = ownerKey === accountHash;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [localJobs, setLocalJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);

  const loadJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const keys = await getContractNamedKeys(contractHash);
      const jobsUref = keys['jobs_dict'];
      const pendingUref = keys['pending_jobs'];
      const consumerUref = keys['consumer_jobs'];
      const providerUref = keys['provider_jobs'];
      if (!jobsUref || !pendingUref) { setJobs([]); return; }

      const myHash = accountHash.replace('account-hash-', '');

      // Gather job IDs from all lists (pending, consumer's jobs, provider's jobs)
      const allJobIds = new Set<string>();
      const pendingList: string[] = await queryDictionary(pendingUref, 'list') || [];
      pendingList.forEach(id => allJobIds.add(id));

      // Get consumer's jobs
      if (consumerUref) {
        const consumerList: string[] = await queryDictionary(consumerUref, myHash) || [];
        consumerList.forEach(id => allJobIds.add(id));
      }
      // Get provider's jobs (router)
      if (providerUref) {
        const routerHash = 'f227d4fb7c50164d363c5461ad0044ef8f3b8ad5ee7072b87384e101a2a4263d';
        const providerList: string[] = await queryDictionary(providerUref, routerHash) || [];
        providerList.forEach(id => allJobIds.add(id));
      }

      const loaded: Job[] = [];
      for (const jobId of allJobIds) {
        const consumer = await queryDictionary(jobsUref, `${jobId}:consumer`);
        if (!consumer) continue;
        const providerAddr = await queryDictionary(jobsUref, `${jobId}:provider`);
        const amount = await queryDictionary(jobsUref, `${jobId}:amount`);
        const stateRaw = await queryDictionary(jobsUref, `${jobId}:state`);
        const validUntil = await queryDictionary(jobsUref, `${jobId}:valid_until`);
        const createdAt = await queryDictionary(jobsUref, `${jobId}:created_at`);
        const responseHash = await queryDictionary(jobsUref, `${jobId}:response_hash`);
        const text = await fetchInferenceText(jobId);
        loaded.push({
          id: jobId,
          consumer: String(consumer || ''),
          provider: String(providerAddr || ''),
          amount: String(amount || '0'),
          state: STATE_LABELS[String(stateRaw ?? '')] || String(stateRaw ?? 'unknown'),
          validUntil: Number(validUntil || 0),
          createdAt: Number(createdAt || 0),
          responseHash: String(responseHash || ''),
          responseText: text || '',
        });
      }
      // Only show jobs where the connected wallet is the consumer
      const myJobs = loaded.filter(job => job.consumer === myHash);
      myJobs.sort((a, b) => b.createdAt - a.createdAt);
      setJobs(myJobs);
    } catch (e) {
      console.error('Failed to load jobs:', e);
    } finally {
      setLoadingJobs(false);
    }
  }, [contractHash, accountHash]);

  useEffect(() => {
    loadJobs();
    const id = setInterval(loadJobs, 30000);
    return () => clearInterval(id);
  }, [loadJobs]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h2 className="text-2xl font-bold">Escrow Vault</h2><p className="text-muted-foreground text-sm">{contractHash}</p></div>
      </div>

      {/* Time-gated release explanation */}
      <Card className="p-4">
        <h3 className="font-semibold mb-2 flex items-center gap-2"><Clock className="h-4 w-4" />Time-Gated Release Flow</h3>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal pl-4">
          <li>Order placed and funds enter escrow automatically (create_job).</li>
          <li>Provider acknowledges the job (provider_ack).</li>
          <li>Provider submits results (provider_complete).</li>
          <li>Consumer has a 1-hour window from provider_complete to confirm (consumer_confirm) or dispute (dispute_job).</li>
          <li>If consumer confirms → funds settle, provider claims payment.</li>
          <li>If no action within 1 hour → anyone can call auto_release to send funds to provider.</li>
          <li>If dispute is opened → funds freeze in escrow until admin resolves (resolve_dispute), then winner claims (claim_resolution).</li>
        </ol>
      </Card>

      {/* Job Status Board */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold flex items-center gap-2"><Shield className="h-4 w-4" />Job Status Board</h3>
          <button onClick={loadJobs} disabled={loadingJobs} className="text-xs flex items-center gap-1 text-blue-600 hover:underline">
            <RefreshCw className={`h-3 w-3 ${loadingJobs ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
        {(() => {
          const allJobs = [...localJobs, ...jobs];
          const seen = new Set<string>();
          const merged = allJobs.filter(j => { if (seen.has(j.id)) return false; seen.add(j.id); return true; });
          if (merged.length === 0) return <p className="text-sm text-muted-foreground">No active jobs found on chain.</p>;
          return (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {merged.map((job) => (
                <div key={job.id} className="text-xs bg-muted p-2 rounded space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={job.state === 'pending' ? 'warning' : job.state === 'settled' ? 'success' : job.state === 'refunded' ? 'default' : job.state === 'disputed' ? 'error' : 'default'}>{job.state}</Badge>
                      <span className="font-mono truncate max-w-[120px]">{job.id}</span>
                    </div>
                    <div className="text-muted-foreground">{(Number(job.amount || 0) / 1e9).toFixed(4)} CSPR</div>
                  </div>
                  {job.responseText && (
                    <div className="text-green-700 text-xs mt-1" title={job.responseText}>
                      <span className="font-semibold">Response:</span> {job.responseText.length > 100 ? job.responseText.slice(0, 100) + '...' : job.responseText}
                    </div>
                  )}
                  {!job.responseText && job.responseHash && (
                    <div className="text-muted-foreground truncate text-xs mt-1" title={job.responseHash}>
                      Hash: {job.responseHash}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })()}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <EntryPointCard title="Create Job" contract="EscrowVault" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [consumer, setConsumer] = useState(accountHash);
            const [amountCSPR, setAmountCSPR] = useState('2.5');
            const [feeBps, setFeeBps] = useState('100');
            const [orderId, setOrderId] = useState('order-1');
            // Router auto-assign address — default for network routing
            const ROUTER_PROVIDER = 'f227d4fb7c50164d363c5461ad0044ef8f3b8ad5ee7072b87384e101a2a4263d';
            const urlParams = new URLSearchParams(window.location.search);
            const urlProvider = urlParams.get('provider');
            const providerAddr = urlProvider || ROUTER_PROVIDER;
            const amountMotes = Math.floor(parseFloat(amountCSPR || '0') * 1e9).toString();
            return <form onSubmit={(e) => { e.preventDefault(); const jobId = `job:${consumer.replace('account-hash-','')}:0`; setLocalJobs(prev => [{ id: jobId, consumer, provider: providerAddr, amount: amountMotes, state: 'pending', validUntil: Math.floor(Date.now()/1000) + 3600, createdAt: Math.floor(Date.now()/1000), responseHash: '', responseText: '' }, ...prev]); submit('create_job', {
              consumer: sdk.CLValue.newCLByteArray(accountHashToBytes(consumer)),
              provider: sdk.CLValue.newCLByteArray(accountHashToBytes(providerAddr)),
              amount: sdk.CLValue.newCLUInt512(amountMotes), provider_fee_bps: sdk.CLValue.newCLUint64(feeBps), order_id: sdk.CLValue.newCLString(orderId),
            }); }} className="space-y-2">
              <Input label="Consumer Account Hash" value={consumer} onChange={setConsumer} />
              <Input label="Amount (CSPR)" value={amountCSPR} onChange={setAmountCSPR} />
              <Input label="Provider Fee BPS" value={feeBps} onChange={setFeeBps} />
              <Input label="Prompt / Order ID" value={orderId} onChange={setOrderId} />
              {urlProvider ? (
                <div className="text-xs text-[#00e5ff]">Routing to custom provider: <span className="font-mono">{urlProvider}</span></div>
              ) : (
                <div className="text-xs text-muted-foreground">Routing to inference router (VPS). Add <code>?provider=ADDRESS</code> to URL to override.</div>
              )}
              <Button type="submit" disabled={!canSign} className="w-full"><Send className="h-4 w-4 mr-1" />Create Job</Button>
            </form>;
          }}
        </EntryPointCard>
        {isAdmin && (
          <>
            <EntryPointCard title="Provider Ack" contract="EscrowVault" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
              {({ submit }) => {
                const [jobId, setJobId] = useState('');
                return <form onSubmit={(e) => { e.preventDefault(); submit('provider_ack', { job_id: sdk.CLValue.newCLString(jobId) }); }} className="space-y-2">
                  <Input label="Job ID" value={jobId} onChange={setJobId} />
                  <Button type="submit" disabled={!canSign} className="w-full"><Send className="h-4 w-4 mr-1" />Ack</Button>
                </form>;
              }}
            </EntryPointCard>
            <EntryPointCard title="Provider Complete" contract="EscrowVault" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
              {({ submit }) => {
                const [jobId, setJobId] = useState(''); const [responseHash, setResponseHash] = useState('');
                return <form onSubmit={(e) => { e.preventDefault(); submit('provider_complete', { job_id: sdk.CLValue.newCLString(jobId), response_hash: sdk.CLValue.newCLString(responseHash) }); }} className="space-y-2">
                  <Input label="Job ID" value={jobId} onChange={setJobId} />
                  <Input label="Response Hash" value={responseHash} onChange={setResponseHash} />
                  <Button type="submit" disabled={!canSign} className="w-full"><Send className="h-4 w-4 mr-1" />Complete</Button>
                </form>;
              }}
            </EntryPointCard>
            <EntryPointCard title="Consumer Confirm" contract="EscrowVault" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
              {({ submit }) => {
                const [jobId, setJobId] = useState(''); const [rating, setRating] = useState('5');
                return <form onSubmit={(e) => { e.preventDefault(); submit('consumer_confirm', {
                  job_id: sdk.CLValue.newCLString(jobId), rating: sdk.CLValue.newCLUint64(rating),
                }); }} className="space-y-2">
                  <Input label="Job ID" value={jobId} onChange={setJobId} />
                  <Input label="Rating (1-10)" value={rating} onChange={setRating} />
                  <Button type="submit" disabled={!canSign} className="w-full"><Send className="h-4 w-4 mr-1" />Confirm & Release</Button>
                </form>;
              }}
            </EntryPointCard>
            <EntryPointCard title="Claim Payment" contract="EscrowVault" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
              {({ submit }) => {
                const [jobId, setJobId] = useState('');
                return <form onSubmit={(e) => { e.preventDefault(); submit('claim_payment', { job_id: sdk.CLValue.newCLString(jobId) }); }} className="space-y-2">
                  <Input label="Job ID" value={jobId} onChange={setJobId} />
                  <Button type="submit" disabled={!canSign} className="w-full"><Send className="h-4 w-4 mr-1" />Claim</Button>
                </form>;
              }}
            </EntryPointCard>
            <EntryPointCard title="Auto Release" contract="EscrowVault" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
              {({ submit }) => {
                const [jobId, setJobId] = useState('');
                return <form onSubmit={(e) => { e.preventDefault(); submit('auto_release', { job_id: sdk.CLValue.newCLString(jobId) }); }} className="space-y-2">
                  <div className="text-xs text-muted-foreground">Callable only after provider_complete. If consumer hasn't confirmed or disputed within 1 hour, funds auto-release to provider.</div>
                  <Input label="Job ID" value={jobId} onChange={setJobId} />
                  <Button type="submit" disabled={!canSign} className="w-full"><Send className="h-4 w-4 mr-1" />Auto Release</Button>
                </form>;
              }}
            </EntryPointCard>
            <EntryPointCard title="Resolve Dispute" contract="EscrowVault" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
              {({ submit }) => {
                const [jobId, setJobId] = useState(''); const [consumerPayout, setConsumerPayout] = useState('50'); const [providerPayout, setProviderPayout] = useState('50');
                return <form onSubmit={(e) => { e.preventDefault(); submit('resolve_dispute', {
                  job_id: sdk.CLValue.newCLString(jobId), consumer_payout_pct: sdk.CLValue.newCLUint64(consumerPayout), provider_payout_pct: sdk.CLValue.newCLUint64(providerPayout),
                }); }} className="space-y-2">
                  <div className="text-xs text-amber-400">Admin only. Resolves a disputed job by setting payout split.</div>
                  <Input label="Job ID" value={jobId} onChange={setJobId} />
                  <Input label="Consumer Payout %" value={consumerPayout} onChange={setConsumerPayout} />
                  <Input label="Provider Payout %" value={providerPayout} onChange={setProviderPayout} />
                  <Button type="submit" disabled={!canSign} variant="danger" className="w-full">Resolve</Button>
                </form>;
              }}
            </EntryPointCard>
            <EntryPointCard title="Claim Resolution" contract="EscrowVault" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
              {({ submit }) => {
                const [jobId, setJobId] = useState('');
                return <form onSubmit={(e) => { e.preventDefault(); submit('claim_resolution', { job_id: sdk.CLValue.newCLString(jobId) }); }} className="space-y-2">
                  <div className="text-xs text-muted-foreground">Winner of a resolved dispute claims their payout.</div>
                  <Input label="Job ID" value={jobId} onChange={setJobId} />
                  <Button type="submit" disabled={!canSign} className="w-full"><Send className="h-4 w-4 mr-1" />Claim Resolution</Button>
                </form>;
              }}
            </EntryPointCard>
            <EntryPointCard title="Withdraw Protocol Fees" contract="EscrowVault" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
              {({ submit }) => {
                const [amountCSPR, setAmountCSPR] = useState('0');
                const amountMotes = Math.floor(parseFloat(amountCSPR || '0') * 1e9).toString();
                return <form onSubmit={(e) => { e.preventDefault(); submit('withdraw_protocol_fees', { amount: sdk.CLValue.newCLUInt512(amountMotes) }); }} className="space-y-2">
                  <Input label="Amount (CSPR, 0 for all)" value={amountCSPR} onChange={setAmountCSPR} />
                  <Button type="submit" disabled={!canSign} className="w-full"><Send className="h-4 w-4 mr-1" />Withdraw Fees</Button>
                </form>;
              }}
            </EntryPointCard>
          </>
        )}
        <EntryPointCard title="Dispute Job" contract="EscrowVault" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [jobId, setJobId] = useState(''); const [evidenceHash, setEvidenceHash] = useState('');
            return <form onSubmit={(e) => { e.preventDefault(); submit('dispute_job', {
              job_id: sdk.CLValue.newCLString(jobId), evidence_hash: sdk.CLValue.newCLString(evidenceHash),
            }); }} className="space-y-2">
              <div className="text-xs text-muted-foreground">Open a dispute within 1 hour of provider completion. Funds freeze until admin resolves.</div>
              <Input label="Job ID" value={jobId} onChange={setJobId} />
              <Input label="Evidence Hash" value={evidenceHash} onChange={setEvidenceHash} />
              <Button type="submit" disabled={!canSign} variant="danger" className="w-full"><AlertCircle className="h-4 w-4 mr-1" />Open Dispute</Button>
            </form>;
          }}
        </EntryPointCard>
      </div>
    </div>
  );
}
