import { useState, useEffect } from 'react';
import EntryPointCard from './EntryPointCard';
import { Button, Input, Card } from './ui';
import { Send, Cpu, HardDrive, Monitor, RefreshCw, Users } from 'lucide-react';
import type { TxRecord } from '../types';
import * as sdk from 'casper-js-sdk';
import { getMinimumStake } from '../casper-client';

function modelToTaskTypeMask(model: string): number {
  if (model.includes('embedding')) return 2;
  return 1; // text generation
}

function detectDeviceInfo() {
  const ua = navigator.userAgent;
  const platform = (navigator as any).userAgentData?.platform || navigator.platform;
  const cores = navigator.hardwareConcurrency || 'unknown';
  const memory = (navigator as any).deviceMemory || 'unknown';
  const model = ua.match(/\(([^)]+)\)/)?.[1] || 'unknown';
  return {
    peerId: `${platform}-${cores}cores-${memory}gb`,
    name: `Provider-${platform}`,
    model,
    taskTypes: 'phi-3-mini,llama-3-8b,text-embedding',
  };
}

interface ProviderInfo {
  address: string;
  peerId: string;
  name: string;
  model: string;
  status: string;
  stake: string;
}

export default function ComputeRegistryTab({ provider, publicKeyHex, contractHash, onTx }: {
  provider: any; publicKeyHex: string; contractHash: string; onTx: (tx: TxRecord) => void;
}) {
  const canSign = !!provider && !!publicKeyHex;
  const [deviceInfo, setDeviceInfo] = useState(detectDeviceInfo());
  const [minStakeMotes, setMinStakeMotes] = useState<string>('0');
  const [registeredProviders, setRegisteredProviders] = useState<ProviderInfo[]>([]);

  useEffect(() => {
    if (contractHash) {
      getMinimumStake(contractHash).then(v => setMinStakeMotes(v));
    }
  }, [contractHash]);

  const minStakeCSPR = (Number(minStakeMotes) / 1e9).toFixed(4);
  const hasMinStake = Number(minStakeMotes) > 0;

  return (
    <div className="space-y-4">
      <div><h2 className="text-2xl font-bold">Compute Registry</h2><p className="text-muted-foreground text-sm">{contractHash}</p></div>

      <Card className="p-4">
        <h3 className="font-semibold mb-2 flex items-center gap-2"><Cpu className="h-4 w-4" />Auto-Detected Device Info</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1"><HardDrive className="h-3 w-3" /> Platform: <span className="font-mono">{deviceInfo.name}</span></div>
          <div className="flex items-center gap-1"><Monitor className="h-3 w-3" /> Model: <span className="font-mono">{deviceInfo.model}</span></div>
          <div className="flex items-center gap-1"><Cpu className="h-3 w-3" /> Peer ID: <span className="font-mono">{deviceInfo.peerId}</span></div>
          <div className="flex items-center gap-1">Tasks: <span className="font-mono">{deviceInfo.taskTypes}</span></div>
        </div>
      </Card>

      {/* Registration Flow Explanation */}
      <Card className="p-4 border-l-4 border-l-blue-500">
        <h3 className="font-semibold text-sm mb-1">Provider Registration Flow</h3>
        <p className="text-xs text-muted-foreground">
          Registration includes the initial stake deposit in a single transaction.<br/>
          After registering, use <strong>"Deposit Stake"</strong> to add more stake, or <strong>"Update Provider"</strong> to change your info.
        </p>
      </Card>

      {/* Registered Providers Board */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold flex items-center gap-2"><Users className="h-4 w-4" />Registered Providers</h3>
        </div>
        {registeredProviders.length === 0 ? (
          <p className="text-xs text-muted-foreground">No providers registered yet.</p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {registeredProviders.map((p) => (
              <div key={p.address} className="flex items-center justify-between text-xs bg-muted p-2 rounded">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${p.status === 'active' ? 'bg-green-500' : p.status === 'paused' ? 'bg-yellow-500' : 'bg-red-500'}`} />
                  <span className="font-mono truncate max-w-[120px]">{p.name}</span>
                </div>
                <div className="text-muted-foreground">{p.model} | {(Number(p.stake || 0) / 1e9).toFixed(4)} CSPR</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Register Provider (includes stake) */}
        <EntryPointCard title="Register Provider" contract="ComputeRegistry" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [peerName, setPeerName] = useState(deviceInfo.name);
            const [model, setModel] = useState('phi-3-mini');
            const [customModel, setCustomModel] = useState('');
            const [stakeCSPR, setStakeCSPR] = useState('0.1');
            const [step, setStep] = useState<'idle' | 'registering' | 'done'>('idle');
            const models = [
              { value: 'phi-3-mini', label: 'Phi-3 Mini (Microsoft)' },
              { value: 'llama-3-8b', label: 'Llama 3 8B (Meta)' },
              { value: 'llama-3-70b', label: 'Llama 3 70B (Meta)' },
              { value: 'mixtral-8x7b', label: 'Mixtral 8x7B (Mistral)' },
              { value: 'gemma-2b', label: 'Gemma 2B (Google)' },
              { value: 'text-embedding', label: 'Text Embedding' },
              { value: 'custom', label: 'Other (specify)' },
            ];
            const effectiveModel = model === 'custom' ? customModel : model;
            const stakeMotes = Math.floor(parseFloat(stakeCSPR || '0') * 1e9).toString();
            const handleSubmit = async (e: any) => {
              e.preventDefault();
              if (!canSign || parseFloat(stakeCSPR) <= 0) return;
              setStep('registering');
              await submit('register_provider', {
                qvac_peer_id: sdk.CLValue.newCLString(deviceInfo.peerId),
                name: sdk.CLValue.newCLString(peerName),
                task_types: sdk.CLValue.newCLUInt32(modelToTaskTypeMask(effectiveModel)),
                stake_amount: sdk.CLValue.newCLUInt512(stakeMotes),
              });
              setRegisteredProviders(prev => [...prev, {
                address: publicKeyHex ? sdk.PublicKey.fromHex(publicKeyHex).accountHash().toPrefixedString() : '',
                peerId: deviceInfo.peerId,
                name: peerName,
                model: effectiveModel,
                status: 'active',
                stake: stakeMotes,
              }]);
              setStep('done');
            };
            return <form onSubmit={handleSubmit} className="space-y-2">
              <Input label="Peer Name" value={peerName} onChange={setPeerName} />
              <div className="space-y-1">
                <label className="text-sm font-medium">Inference Model</label>
                <select value={model} onChange={(e) => setModel(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  {models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              {model === 'custom' && (
                <Input label="Custom Model Name" value={customModel} onChange={setCustomModel} placeholder="e.g. qwen-2-7b" />
              )}
              <Input label="Stake (CSPR)" value={stakeCSPR} onChange={setStakeCSPR} />
              {hasMinStake && (
                <div className="text-xs text-muted-foreground">
                  Minimum stake: <span className="font-semibold">{minStakeCSPR} CSPR</span>
                  {Number(stakeCSPR) < Number(minStakeCSPR) && (
                    <span className="text-red-600 ml-1">(below minimum!)</span>
                  )}
                </div>
              )}
              {step !== 'idle' && (
                <div className="text-xs text-blue-600">
                  {step === 'registering' && 'Registering provider...'}
                  {step === 'done' && 'Done! Check transactions for status.'}
                </div>
              )}
              <Button type="submit" disabled={!canSign || !effectiveModel || !peerName.trim() || step === 'registering' || (hasMinStake && Number(stakeCSPR) < Number(minStakeCSPR))} className="w-full">
                <Send className="h-4 w-4 mr-1" />Register Provider
              </Button>
            </form>;
          }}
        </EntryPointCard>

        {/* Just Deposit Stake */}
        <EntryPointCard title="Deposit Stake Only" contract="ComputeRegistry" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [cspr, setCspr] = useState('0.1');
            const motes = Math.floor(parseFloat(cspr || '0') * 1e9).toString();
            return <form onSubmit={(e) => { e.preventDefault(); submit('deposit_stake', { amount: sdk.CLValue.newCLUInt512(motes) }); }} className="space-y-2">
              <div className="text-xs text-muted-foreground">Add more stake to an existing provider.</div>
              <Input label="Amount (CSPR)" value={cspr} onChange={setCspr} />
              <div className="text-xs text-muted-foreground">{motes} motes</div>
              <Button type="submit" disabled={!canSign || parseFloat(cspr) <= 0} className="w-full"><Send className="h-4 w-4 mr-1" />Deposit Stake</Button>
            </form>;
          }}
        </EntryPointCard>

        {/* Update Provider Info */}
        <EntryPointCard title="Update Provider Info" contract="ComputeRegistry" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [peerName, setPeerName] = useState(deviceInfo.name);
            const [model, setModel] = useState('phi-3-mini');
            const [customModel, setCustomModel] = useState('');
            const models = [
              { value: 'phi-3-mini', label: 'Phi-3 Mini (Microsoft)' },
              { value: 'llama-3-8b', label: 'Llama 3 8B (Meta)' },
              { value: 'llama-3-70b', label: 'Llama 3 70B (Meta)' },
              { value: 'mixtral-8x7b', label: 'Mixtral 8x7B (Mistral)' },
              { value: 'gemma-2b', label: 'Gemma 2B (Google)' },
              { value: 'text-embedding', label: 'Text Embedding' },
              { value: 'custom', label: 'Other (specify)' },
            ];
            const effectiveModel = model === 'custom' ? customModel : model;
            return <form onSubmit={(e) => { e.preventDefault(); submit('update_provider', {
              name: sdk.CLValue.newCLString(peerName),
              task_types: sdk.CLValue.newCLUInt32(modelToTaskTypeMask(effectiveModel)),
            }); }} className="space-y-2">
              <div className="text-xs text-muted-foreground">Update your provider name and task types.</div>
              <Input label="Peer Name" value={peerName} onChange={setPeerName} />
              <div className="space-y-1">
                <label className="text-sm font-medium">Inference Model</label>
                <select value={model} onChange={(e) => setModel(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  {models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              {model === 'custom' && (
                <Input label="Custom Model Name" value={customModel} onChange={setCustomModel} placeholder="e.g. qwen-2-7b" />
              )}
              <Button type="submit" disabled={!canSign || !effectiveModel || !peerName.trim()} className="w-full"><Send className="h-4 w-4 mr-1" />Update Provider</Button>
            </form>;
          }}
        </EntryPointCard>

        <EntryPointCard title="Withdraw Stake" contract="ComputeRegistry" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [cspr, setCspr] = useState('1');
            const motes = Math.floor(parseFloat(cspr || '0') * 1e9).toString();
            return <form onSubmit={(e) => { e.preventDefault(); submit('withdraw_stake', { amount: sdk.CLValue.newCLUInt512(motes) }); }} className="space-y-2">
              <Input label="Amount (CSPR)" value={cspr} onChange={setCspr} />
              <Button type="submit" disabled={!canSign || parseFloat(cspr) <= 0} variant="outline" className="w-full">Withdraw Stake</Button>
            </form>;
          }}
        </EntryPointCard>


        <EntryPointCard title="Pause Provider" contract="ComputeRegistry" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            return <form onSubmit={(e) => { e.preventDefault(); submit('pause_provider', {}); }} className="space-y-2">
              <div className="text-xs text-muted-foreground">Pause your provider (no args needed).</div>
              <Button type="submit" disabled={!canSign} variant="danger" className="w-full">Pause</Button>
            </form>;
          }}
        </EntryPointCard>

        <EntryPointCard title="Resume Provider" contract="ComputeRegistry" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            return <form onSubmit={(e) => { e.preventDefault(); submit('resume_provider', {}); }} className="space-y-2">
              <div className="text-xs text-muted-foreground">Resume your provider (no args needed).</div>
              <Button type="submit" disabled={!canSign} className="w-full">Resume</Button>
            </form>;
          }}
        </EntryPointCard>
      </div>
    </div>
  );
}
