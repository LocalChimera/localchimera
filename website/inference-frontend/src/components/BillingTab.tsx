import { useEffect, useState } from 'react';
import { Button } from './ui';
import { CheckCircle, Server } from 'lucide-react';


export default function BillingTab({ evmAddress }: {
  evmAddress: string;
}) {
  const [amount, setAmount] = useState('10');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ txHash: string; network: string } | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [hasNode, setHasNode] = useState(false);
  const [nodeCheckLoading, setNodeCheckLoading] = useState(false);

  const connected = !!evmAddress;
  const DISCOUNT_RATE = 0.10;
  const walletAddress = evmAddress;

  useEffect(() => {
    let cancelled = false;
    if (evmAddress) {
      fetch(`/api/billing/balance/${evmAddress}`)
        .then(r => r.json())
        .then(data => { if (!cancelled) setBalance(data.balance || '0'); })
        .catch(() => { if (!cancelled) setBalance(null); });
    } else {
      setBalance(null);
    }
    return () => { cancelled = true; };
  }, [evmAddress, success]);

  useEffect(() => {
    let cancelled = false;
    setNodeCheckLoading(true);
    async function checkNode() {
      try {
        if (evmAddress) {
          const res = await fetch(`/api/billing/node-status/${evmAddress}`);
          const data = await res.json().catch(() => ({}));
          if (!cancelled) setHasNode(!!data.hasNode);
        } else {
          if (!cancelled) setHasNode(false);
        }
      } catch {
        if (!cancelled) setHasNode(false);
      } finally {
        if (!cancelled) setNodeCheckLoading(false);
      }
    }
    checkNode();
    return () => { cancelled = true; };
  }, [evmAddress]);

  const handleAddFunds = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(null);
    if (!connected) {
      setError('Connect your wallet first to add funds.');
      return;
    }
    const value = Number(amount);
    if (!value || value <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/billing/fund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: value, walletAddress: evmAddress }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to add funds');
      setSuccess({ txHash: data.txHash || '', network: 'EVM' });
    } catch (err: any) {
      setError(err.message || 'Failed to add funds');
    }
    setLoading(false);
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(null);
    if (!connected) {
      setError('Connect your wallet first to withdraw funds.');
      return;
    }
    const value = Number(amount);
    if (!value || value <= 0) {
      setError('Enter a valid amount to withdraw.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/billing/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: value, walletAddress: evmAddress }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to withdraw funds');
      setSuccess({ txHash: data.txHash || '', network: 'EVM' });
    } catch (err: any) {
      setError(err.message || 'Failed to withdraw funds');
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6 max-w-[720px]">
      <div className="bg-white rounded-2xl shadow-sm p-6 text-slate-800">
        <h2 className="text-xl font-bold text-slate-800 mb-2">Billing</h2>
        <p className="text-sm text-slate-500 mb-4">
          Add funds to your personal Chimera account. These funds are tied to your connected wallet and can only be used by you to pay for your own deployments, rentals, storage, and inference workloads. No one else can access or spend them.
        </p>
        {!walletAddress && (
          <p className="text-[13px] text-amber-600 mt-3">Connect your wallet to add funds to your account.</p>
        )}
        {walletAddress && (
          <p className="text-[13px] text-slate-500 mt-3">Connected wallet: <span className="font-mono text-[11px]">{walletAddress}</span></p>
        )}
        <div className="mt-4 p-3 rounded-[10px] bg-amber-50 border border-amber-100 text-[12px] text-amber-800">
          <strong>Personal funds only.</strong> Deposits are non-transferable and can only be spent by this wallet address. The protocol uses them exclusively to pay for workloads you create.
        </div>

        {connected && !nodeCheckLoading && (
          <div className={`mt-4 p-4 rounded-[10px] border ${hasNode ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-center gap-2">
              {hasNode ? (
                <><CheckCircle className="w-5 h-5 text-emerald-600" /><span className="text-[13px] font-semibold text-emerald-700">Node running — 10% discount active</span></>
              ) : (
                <><Server className="w-5 h-5 text-slate-400" /><span className="text-[13px] font-semibold text-slate-600">No active node detected</span></>
              )}
            </div>
            <p className="text-[12px] text-slate-500 mt-1.5">
              {hasNode
                ? 'Your wallet has an active provider node. You receive a 10% discount on all workload costs. Funds deposited are charged at the discounted rate when paying for deployments, inference, storage, and compute.'
                : 'Run a Chimera provider node to get a 10% discount on all workload costs. Register as a provider to activate your discount.'}
            </p>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6 text-slate-800">
        <h3 className="font-semibold text-slate-800 mb-4">Add funds</h3>
        <form onSubmit={handleAddFunds} className="space-y-4">
          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-1">Amount</label>
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2 rounded-[10px] border border-[#e5e5e5] text-[13px]"
            />
          </div>
          <div className="flex items-center justify-between text-[13px] text-slate-600 bg-[#f5f5f7] rounded-[10px] px-4 py-3">
            <span>Total to add</span>
            <span className="font-semibold text-slate-800">{amount}</span>
          </div>
          {hasNode && (
            <div className="flex items-center justify-between text-[13px] bg-emerald-50 rounded-[10px] px-4 py-3 border border-emerald-200">
              <span className="text-emerald-700">Effective cost (10% node discount)</span>
              <span className="font-semibold text-emerald-700">{(Number(amount) * (1 - DISCOUNT_RATE)).toFixed(4)}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={loading || !connected} className="text-[13px] h-9 px-4 bg-[#111111] text-white hover:opacity-85">
              {loading ? 'Processing...' : 'Add funds'}
            </Button>
            <Button type="button" onClick={handleWithdraw} disabled={loading || !connected} className="text-[13px] h-9 px-4 border border-[#111111] text-[#111111] hover:bg-[#f5f5f7]">
              {loading ? 'Processing...' : 'Withdraw'}
            </Button>
          </div>
        </form>
        {error && <p className="text-[13px] text-red-500 mt-4">{error}</p>}
        {success && (
          <div className="mt-4 p-4 rounded-[10px] bg-green-50 text-green-800 text-[13px]">
            <p className="font-semibold mb-2">Transaction submitted on {success.network}</p>
            <p className="font-mono text-[11px] break-all">{success.txHash}</p>
          </div>
        )}
      </div>
    </div>
  );
}
