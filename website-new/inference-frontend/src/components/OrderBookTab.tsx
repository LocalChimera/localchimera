import { useState, useEffect, useCallback } from 'react';
import EntryPointCard from './EntryPointCard';
import { Button, Input, Card, Badge } from './ui';
import { Send, List, Zap, AlertCircle, RefreshCw } from 'lucide-react';
import type { TxRecord } from '../types';
import * as sdk from 'casper-js-sdk';
import { getContractNamedKeys, queryDictionary, callEntryPointWithWallet } from '../casper-client';

function accountHashToBytes(hashStr: string): Uint8Array {
  const bytes = new Uint8Array(32);
  const hex = hashStr.replace('account-hash-', '');
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function publicKeyToAccountHashHex(publicKeyHex: string): string {
  try {
    const pk = sdk.PublicKey.fromHex(publicKeyHex);
    return pk.accountHash().toHex();
  } catch {
    return '';
  }
}

interface OpenOrder {
  id: string;
  orderType: string;
  price: string;
  amount: string;
  taskType: string;
  modelId: string;
  status: string;
}

const STATUS_LABELS: Record<string, string> = {
  '0': 'open', '1': 'partial', '2': 'filled', '3': 'cancelled',
};

export default function OrderBookTab({ provider, publicKeyHex, contractHash, escrowVaultHash, accountHash: _accountHash, onTx }: {
  provider: any; publicKeyHex: string; contractHash: string; escrowVaultHash: string; accountHash: string; onTx: (tx: TxRecord) => void;
}) {
  const canSign = !!provider && !!publicKeyHex;
  const [autoFill, setAutoFill] = useState(true);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [localOrders, setLocalOrders] = useState<OpenOrder[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);

  const loadOrders = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const keys = await getContractNamedKeys(contractHash);
      const ordersUref = keys['orders_dict'];
      const counterUref = keys['order_counter'];
      if (!ordersUref || !counterUref) { setOrders([]); return; }

      const counter = Number(await queryDictionary(counterUref, '') || 0);
      const loaded: OpenOrder[] = [];
      for (let i = 0; i < counter; i++) {
        const orderId = `order-${i}`;
        const statusRaw = await queryDictionary(ordersUref, `${orderId}:status`);
        if (statusRaw === null || statusRaw === undefined) continue;
        const status = STATUS_LABELS[String(statusRaw)] || String(statusRaw);
        if (status !== 'open' && status !== 'partial') continue;
        const side = await queryDictionary(ordersUref, `${orderId}:side`);
        const price = await queryDictionary(ordersUref, `${orderId}:price`);
        const quantity = await queryDictionary(ordersUref, `${orderId}:quantity`);
        const taskType = await queryDictionary(ordersUref, `${orderId}:task_type`);
        const modelId = await queryDictionary(ordersUref, `${orderId}:model_id`);
        loaded.push({
          id: orderId,
          orderType: String(side === 0 ? 'bid' : side === 1 ? 'ask' : String(side || '')),
          price: String(price || '0'),
          amount: String(quantity || '0'),
          taskType: String(taskType || ''),
          modelId: String(modelId || ''),
          status,
        });
      }
      setOrders(loaded);
    } catch (e) {
      console.error('Failed to load orders:', e);
    } finally {
      setLoadingQueue(false);
    }
  }, [contractHash]);

  useEffect(() => {
    loadOrders();
    const id = setInterval(loadOrders, 30000);
    return () => clearInterval(id);
  }, [loadOrders]);

  return (
    <div className="space-y-4">
      <div><h2 className="text-2xl font-bold">Order Book</h2><p className="text-muted-foreground text-sm">{contractHash}</p></div>

      {/* Task Queue */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold flex items-center gap-2"><List className="h-4 w-4" />Task Queue</h3>
          <button onClick={loadOrders} disabled={loadingQueue} className="text-xs flex items-center gap-1 text-blue-600 hover:underline">
            <RefreshCw className={`h-3 w-3 ${loadingQueue ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
        {(() => {
          const allOrders = [...localOrders, ...orders];
          const seen = new Set<string>();
          const merged = allOrders.filter(o => { if (seen.has(o.id)) return false; seen.add(o.id); return true; });
          if (loadingQueue) return <p className="text-xs text-muted-foreground">Loading open orders...</p>;
          if (merged.length === 0) return <p className="text-xs text-muted-foreground">No open orders in queue.</p>;
          return (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {merged.map((o) => (
                <div key={o.id} className="flex items-center justify-between text-xs bg-muted p-2 rounded">
                  <div className="flex items-center gap-2">
                    <Badge variant={o.status === 'open' ? 'default' : o.status === 'filled' ? 'success' : 'error'}>{o.status}</Badge>
                    <span className="font-mono">{o.id}</span>
                    <span className="text-muted-foreground">{o.taskType}/{o.modelId}</span>
                  </div>
                  <div className="text-muted-foreground">{(Number(o.price || 0) / 1e9).toFixed(4)} CSPR</div>
                </div>
              ))}
            </div>
          );
        })()}
      </Card>

      {/* Provider Auto-fill Toggle */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Zap className="h-4 w-4" /><h3 className="font-semibold text-sm">Provider Auto-Fill Mode</h3></div>
          <button onClick={() => setAutoFill(!autoFill)} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${autoFill ? 'bg-primary' : 'bg-muted'}`}>
            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${autoFill ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
        </div>
        {autoFill && (
          <div className="mt-2 text-xs text-muted-foreground">
            When enabled, your provider will automatically fill matching open orders.
            <div className="mt-1 text-yellow-700">Requires an off-chain event listener or smart contract routing logic to fully automate.</div>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Prompt-based Order */}
        <EntryPointCard title="Place Prompt Order" contract="EscrowVault" contractHash={escrowVaultHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {() => {
            const [prompt, setPrompt] = useState('');
            const [fundsCSPR, setFundsCSPR] = useState('10');
            const [taskType, setTaskType] = useState('phi-3-mini');
            const fundsMotes = Math.floor(parseFloat(fundsCSPR || '0') * 1e9).toString();
            const handleSubmit = async (e: any) => {
              e.preventDefault();
              const orderId = 'order-' + Date.now().toString(36);
              const urlParams = new URLSearchParams(window.location.search);
              const customProvider = urlParams.get('provider');
              const providerAddr = customProvider || 'f227d4fb7c50164d363c5461ad0044ef8f3b8ad5ee7072b87384e101a2a4263d';
              setLocalOrders(prev => [{ id: orderId, orderType: 'bid', price: fundsMotes, amount: '1', taskType, modelId: taskType, status: 'open' }, ...prev]);
              // Single transaction: create escrow job directly on EscrowVault
              if (escrowVaultHash && provider && publicKeyHex) {
                try {
                  const walletAccountHash = publicKeyToAccountHashHex(publicKeyHex);
                  const escrowAccountHash = '7e00d7dd02ea921ad3271811d6c0f8928f2e83d91c6f4a5b89048e23683cdf6c';
                  const result = await callEntryPointWithWallet(provider, publicKeyHex, escrowVaultHash, 'create_job', {
                    consumer: sdk.CLValue.newCLByteArray(accountHashToBytes(walletAccountHash)),
                    provider: sdk.CLValue.newCLByteArray(accountHashToBytes(providerAddr)),
                    amount: sdk.CLValue.newCLUInt512(fundsMotes),
                    provider_fee_bps: sdk.CLValue.newCLUint64('100'),
                    order_id: sdk.CLValue.newCLString(prompt || orderId),
                    escrow_account: sdk.CLValue.newCLByteArray(accountHashToBytes(escrowAccountHash)),
                    contract_hash: sdk.CLValue.newCLByteArray(accountHashToBytes(escrowVaultHash)),
                  });
                  if (result.deployHash) {
                    onTx({ id: Date.now().toString() + '-escrow', deployHash: result.deployHash, entryPoint: 'create_job', contract: 'EscrowVault', status: result.error ? 'error' : 'pending', error: result.error });
                  }
                } catch (err: any) {
                  console.error('Escrow create failed:', err.message);
                }
              }
            };
            const urlProvider = new URLSearchParams(window.location.search).get('provider');
            return <form onSubmit={handleSubmit} className="space-y-2">
              <div className="text-xs text-muted-foreground">Submit a prompt with funds. The order is automatically escrowed.</div>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Enter your prompt here..." rows={3}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
              <Input label="Funds (CSPR)" value={fundsCSPR} onChange={setFundsCSPR} />
              <Input label="Model / Task Type" value={taskType} onChange={setTaskType} />
              {urlProvider ? (
                <div className="text-xs text-[#00e5ff]">Routing to custom provider: <span className="font-mono">{urlProvider}</span></div>
              ) : (
                <div className="text-xs text-muted-foreground">Routing to inference router (VPS). Add <code>?provider=ADDRESS</code> to URL to override.</div>
              )}
              <Button type="submit" disabled={!canSign || !prompt.trim()} className="w-full"><Send className="h-4 w-4 mr-1" />Submit Prompt + Fund</Button>
            </form>;
          }}
        </EntryPointCard>

        {/* Cancel Order */}
        <EntryPointCard title="Cancel Order" contract="OrderBook" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [orderId, setOrderId] = useState('');
            return <form onSubmit={(e) => { e.preventDefault(); submit('cancel_order', { order_id: sdk.CLValue.newCLString(orderId) }); }} className="space-y-2">
              <div className="text-xs text-muted-foreground">Cancel an unfilled order to retrieve escrowed funds.</div>
              <Input label="Order ID" value={orderId} onChange={setOrderId} />
              <Button type="submit" disabled={!canSign} variant="danger" className="w-full">Cancel Order</Button>
            </form>;
          }}
        </EntryPointCard>

        {!autoFill && (
          <EntryPointCard title="Manual Fill Order" contract="OrderBook" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
            {({ submit }) => {
              const [orderId, setOrderId] = useState(''); const [providerAddr, setProviderAddr] = useState('f227d4fb7c50164d363c5461ad0044ef8f3b8ad5ee7072b87384e101a2a4263d');
              return <form onSubmit={(e) => { e.preventDefault(); submit('fill_order', {
                order_id: sdk.CLValue.newCLString(orderId), provider: sdk.CLValue.newCLByteArray(accountHashToBytes(providerAddr)),
              }); }} className="space-y-2">
                <div className="text-xs text-amber-400 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Auto-fill is disabled. Use this to manually assign a provider.</div>
                <Input label="Order ID" value={orderId} onChange={setOrderId} />
                <Input label="Provider Account Hash" value={providerAddr} onChange={setProviderAddr} />
                <Button type="submit" disabled={!canSign} className="w-full"><Send className="h-4 w-4 mr-1" />Fill Order</Button>
              </form>;
            }}
          </EntryPointCard>
        )}
      </div>
    </div>
  );
}
