import { useState, useCallback, useEffect } from 'react';
import { queryContractNamedKeys, CONTRACTS } from './casper-client';
import { connectWallet, disconnectWallet, isWalletInstalled } from './casper-wallet';
import { Wallet } from 'lucide-react';
import { Button, Badge } from './components/ui';
import OverviewTab from './components/OverviewTab';
import ComputeRegistryTab from './components/ComputeRegistryTab';
import OrderBookTab from './components/OrderBookTab';
import EscrowVaultTab from './components/EscrowVaultTab';
import ReputationTab from './components/ReputationTab';
import type { TxRecord } from './types';

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="h-px flex-1 bg-white/5" />
      <h2 className="text-sm font-semibold tracking-wide uppercase text-[#7a7468]">{children}</h2>
      <div className="h-px flex-1 bg-white/5" />
    </div>
  );
}

export default function App() {
  const [provider, setProvider] = useState<any>(null);
  const [publicKeyHex, setPublicKeyHex] = useState('');
  const [accountHash, setAccountHash] = useState('');
  const [txHistory, setTxHistory] = useState<TxRecord[]>([]);
  const [contractKeys, setContractKeys] = useState<Record<string, { name: string; key: string }[]>>({});
  const [walletError, setWalletError] = useState('');
  const [walletDetected, setWalletDetected] = useState(false);

  useEffect(() => {
    // Poll for Casper Wallet since extensions inject asynchronously
    const check = () => setWalletDetected(isWalletInstalled());
    check();
    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, []);

  const connect = useCallback(async () => {
    setWalletError('');
    const res = await connectWallet();
    if (res.connected && res.provider) {
      setProvider(res.provider);
      setPublicKeyHex(res.publicKey);
      const pk = (await import('casper-js-sdk')).PublicKey.fromHex(res.publicKey);
      setAccountHash(pk.accountHash().toPrefixedString());
      Object.entries(CONTRACTS).forEach(([name, hash]) => {
        queryContractNamedKeys(hash).then((keys) => {
          setContractKeys((prev) => ({ ...prev, [name]: keys }));
        }).catch(() => {
          // Silently ignore RPC errors to avoid NetworkError pop-ups
        });
      });
    } else {
      setWalletError('Could not connect to Casper Wallet. Make sure the extension is installed and unlocked.');
    }
  }, []);

  const disconnect = useCallback(async () => {
    await disconnectWallet();
    setProvider(null); setPublicKeyHex(''); setAccountHash(''); setContractKeys({}); setWalletError('');
  }, []);

  const updateTx = useCallback((tx: TxRecord) => {
    setTxHistory((prev) => {
      const existing = prev.find((t) => t.deployHash === tx.deployHash);
      if (existing) return prev.map((t) => (t.deployHash === tx.deployHash ? { ...t, ...tx } : t));
      return [tx, ...prev];
    });
  }, []);

  const isConnected = !!provider && !!publicKeyHex;

  return (
    <div className="min-h-screen bg-[#030308] text-[#e8e2d8]">
      {/* Glass blur header matching localchimera.com */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-[#030308]/88 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <img src="/chimeralogo-header.png" alt="Chimera" className="w-8 h-8 rounded-lg object-cover" />
            <div>
              <h1 className="text-base font-bold tracking-wide text-[#e8e2d8]">Chimera</h1>
              <p className="text-[10px] text-[#7a7468] -mt-0.5">Casper Testnet</p>
            </div>
          </a>
          {/* Navigation Tabs */}
          <nav className="hidden md:flex items-center gap-1">
            <a href="/"
              className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/5 hover:text-[#00e5ff] text-[#7a7468]">
              Home
            </a>
            {[
              { id: 'orderbook', label: 'Task Marketplace' },
              { id: 'escrow', label: 'Task Escrow' },
              { id: 'overview', label: 'Network Status' },
              { id: 'compute', label: 'Compute Providers' },
              { id: 'reputation', label: 'Provider Reputation' },
            ].map((tab) => (
              <a key={tab.id} href={`#${tab.id}`}
                className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/5 hover:text-[#00e5ff] text-[#7a7468]">
                {tab.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            {isConnected ? (
              <>
                <div className="text-right">
                  <div className="text-[10px] font-mono text-[#7a7468]">{accountHash.slice(0, 14)}...{accountHash.slice(-6)}</div>
                </div>
                <Button variant="outline" onClick={disconnect} className="text-[10px] h-7 px-2 border-white/10 hover:bg-white/5">Disconnect</Button>
              </>
            ) : (
              <>
                {walletError && <div className="text-[10px] text-red-400">{walletError}</div>}
                <Button onClick={connect} className="text-[10px] h-7 px-3 bg-[#00e5ff]/10 text-[#00e5ff] border border-[#00e5ff]/20 hover:bg-[#00e5ff]/20"><Wallet className="h-3 w-3 mr-1" />Connect Casper Wallet</Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Spacer for fixed header */}
      <div className="h-16" />

      {/* Main Content — Single Page with all sections */}
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-10">
        {!walletDetected && !isConnected && (
          <div className="space-y-3">
            <div className="text-sm text-red-400 bg-red-500/5 border border-red-500/10 p-3 rounded-lg">
              <strong>Casper Wallet extension not detected.</strong>
              <a href="https://chromewebstore.google.com/detail/casper-wallet/" target="_blank" rel="noopener noreferrer" className="underline ml-1 text-[#00e5ff]">Install it here</a>.
            </div>
            <div className="text-sm text-amber-400 bg-amber-500/5 border border-amber-500/10 p-3 rounded-lg">
              <strong>Wallet compatibility:</strong> Only Casper Wallet works on this page. MetaMask, Phantom, Trust Wallet, and other EVM/Solana wallets <strong>will not work</strong> because this app signs Casper-specific deploys. Install the Casper Wallet browser extension to connect.
            </div>
          </div>
        )}

        {walletDetected && !isConnected && (
          <div className="text-sm text-green-400 bg-green-500/5 border border-green-500/10 p-3 rounded-lg">
            <strong>Casper Wallet detected.</strong> Click <strong>Connect</strong> in the header to sign in. This app only supports Casper Wallet — MetaMask, Phantom, and other wallets will not work because they cannot sign Casper deploys.
          </div>
        )}

        {/* Section: Order Book */}
        <section id="orderbook" className="space-y-4">
          <SectionTitle>Task Marketplace</SectionTitle>
          <OrderBookTab provider={provider} publicKeyHex={publicKeyHex} contractHash={CONTRACTS.orderBook} escrowVaultHash={CONTRACTS.escrowVault} accountHash={accountHash} onTx={updateTx} />
        </section>

        {/* Section: Escrow Vault (Inference) */}
        <section id="escrow" className="space-y-4">
          <SectionTitle>Task Escrow</SectionTitle>
          <EscrowVaultTab provider={provider} publicKeyHex={publicKeyHex} contractHash={CONTRACTS.escrowVault} accountHash={accountHash} contractKeys={contractKeys} onTx={updateTx} />
        </section>

        {/* Section: Overview */}
        <section id="overview" className="space-y-4">
          <SectionTitle>Network Status</SectionTitle>
          <OverviewTab contractKeys={contractKeys} txHistory={txHistory} publicKeyStr={publicKeyHex} accountHash={accountHash} />
        </section>

        {/* Section: Compute Registry */}
        <section id="compute" className="space-y-4">
          <SectionTitle>Compute Providers</SectionTitle>
          <ComputeRegistryTab provider={provider} publicKeyHex={publicKeyHex} contractHash={CONTRACTS.computeRegistry} onTx={updateTx} />
        </section>

        {/* Section: Reputation */}
        <section id="reputation" className="space-y-4">
          <SectionTitle>Provider Reputation</SectionTitle>
          <ReputationTab provider={provider} publicKeyHex={publicKeyHex} contractHash={CONTRACTS.reputation} onTx={updateTx} />
        </section>

        {/* Recent Transactions */}
        <section id="transactions" className="space-y-3">
          <SectionTitle>Recent Transactions</SectionTitle>
          {txHistory.length === 0 ? <p className="text-sm text-[#7a7468]">No transactions yet</p> : (
            <div className="space-y-2">
              {txHistory.slice(0, 5).map((tx) => (
                <div key={tx.id} className="flex items-center justify-between text-xs bg-white/[0.03] border border-white/5 p-3 rounded-lg hover:bg-white/[0.05] transition-colors">
                  <div className="flex items-center gap-2">
                    <div>
                      <div className="font-medium text-[#e8e2d8]">{tx.contract} :: {tx.entryPoint}</div>
                      <a href={`https://testnet.cspr.live/deploy/${tx.deployHash}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[#7a7468] hover:text-[#00e5ff] transition-colors">
                        {tx.deployHash}
                      </a>
                    </div>
                  </div>
                  <Badge variant={tx.status === 'success' ? 'success' : tx.status === 'error' ? 'error' : 'warning'}>{tx.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 mt-12">
        <div className="max-w-5xl mx-auto px-6 py-6 text-center text-xs text-[#7a7468]">
          Chimera · Decentralised LLM infrastructure · Casper Testnet
        </div>
      </footer>
    </div>
  );
}
