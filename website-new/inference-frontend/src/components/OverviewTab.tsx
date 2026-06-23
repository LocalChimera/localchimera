import { Card, Badge } from './ui';
import { CheckCircle, XCircle, Loader2, ExternalLink } from 'lucide-react';
import type { TxRecord } from '../types';
import { CONTRACTS } from '../casper-client';

export default function OverviewTab({ contractKeys, txHistory, publicKeyStr, accountHash }: {
  contractKeys: Record<string, { name: string; key: string }[]>;
  txHistory: TxRecord[];
  publicKeyStr: string;
  accountHash: string;
}) {
  return (
    <div className="space-y-6">
      <div><h2 className="text-2xl font-bold">Network Status</h2><p className="text-muted-foreground">Live contract state across the inference protocol.</p></div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(CONTRACTS).map(([name, hash]) => (
          <Card key={name} className="p-4">
            <div className="text-xs font-medium text-muted-foreground uppercase">{name}</div>
            <a href={`https://testnet.cspr.live/contract/hash-${hash}`} target="_blank" rel="noopener noreferrer" className="text-xs font-mono mt-1 break-all text-blue-600 hover:underline flex items-center gap-1">
              {hash} <ExternalLink className="h-3 w-3" />
            </a>
            <div className="text-xs text-muted-foreground mt-1">{contractKeys[name]?.length ?? 0} named keys</div>
          </Card>
        ))}
      </div>
      {publicKeyStr && (
        <Card className="p-4">
          <h3 className="font-semibold mb-2">Account Info</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div><span className="text-muted-foreground">Public Key:</span><div className="font-mono break-all">{publicKeyStr}</div></div>
            <div><span className="text-muted-foreground">Account Hash:</span>
              <a href={`https://testnet.cspr.live/account/${accountHash}`} target="_blank" rel="noopener noreferrer" className="font-mono break-all text-blue-600 hover:underline flex items-center gap-1">
                {accountHash} <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </Card>
      )}
      <Card className="p-4">
        <h3 className="font-semibold mb-2">Named Keys</h3>
        {Object.entries(contractKeys).map(([name, keys]) => (
          <div key={name} className="mb-4">
            <div className="text-sm font-medium mb-1 capitalize">{name}</div>
            <div className="space-y-1">
              {keys.map((k) => (
                <div key={k.name} className="flex items-center justify-between text-xs bg-muted p-2 rounded">
                  <span className="font-mono">{k.name}</span>
                  <span className="font-mono text-muted-foreground">{k.key}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Card>
      <Card className="p-4">
        <h3 className="font-semibold mb-2">Recent Transactions</h3>
        {txHistory.length === 0 ? <p className="text-sm text-muted-foreground">No transactions yet</p> : (
          <div className="space-y-2">
            {txHistory.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between text-xs bg-muted p-2 rounded">
                <div className="flex items-center gap-2">
                  {tx.status === 'success' ? <CheckCircle className="h-4 w-4 text-green-600" /> : tx.status === 'error' ? <XCircle className="h-4 w-4 text-red-600" /> : <Loader2 className="h-4 w-4 animate-spin" />}
                  <div>
                    <div className="font-medium">{tx.contract} :: {tx.entryPoint}</div>
                    <a href={`https://testnet.cspr.live/deploy/${tx.deployHash}`} target="_blank" rel="noopener noreferrer" className="font-mono text-muted-foreground hover:text-blue-600 hover:underline flex items-center gap-1">
                      {tx.deployHash} <ExternalLink className="h-3 w-3" />
                    </a>
                    {tx.error && <div className="text-red-600">{tx.error}</div>}
                  </div>
                </div>
                <Badge variant={tx.status === 'success' ? 'success' : tx.status === 'error' ? 'error' : 'warning'}>{tx.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
