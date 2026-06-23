import { useState } from 'react';
import { callEntryPoint, callEntryPointWithWallet, getDeployStatus } from '../casper-client';
import { Card } from './ui';
import { Loader2 } from 'lucide-react';
import type { TxRecord } from '../types';

export default function EntryPointCard({
  title,
  contract,
  contractHash,
  privateKey,
  provider,
  publicKeyHex,
  onTx,
  children,
}: {
  title: string;
  contract: string;
  contractHash: string;
  privateKey?: any;
  provider?: any;
  publicKeyHex?: string;
  onTx: (tx: TxRecord) => void;
  children: (args: { submit: (entryPoint: string, args: Record<string, any>, payment?: string) => Promise<void> }) => React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);

  const submit = async (entryPoint: string, argsMap: Record<string, any>, payment = '10000000000') => {
    const hasSigner = privateKey || (provider && publicKeyHex);
    if (!hasSigner) return;
    setLoading(true);
    const result = privateKey
      ? await callEntryPoint(privateKey, contractHash, entryPoint, argsMap, payment)
      : await callEntryPointWithWallet(provider!, publicKeyHex!, contractHash, entryPoint, argsMap, payment);
    const tx: TxRecord = {
      id: Date.now().toString(),
      deployHash: result.deployHash,
      entryPoint,
      contract,
      status: result.error ? 'error' : 'pending',
      error: result.error,
    };
    onTx(tx);
    setLoading(false);

    if (!result.error && result.deployHash) {
      const poll = async () => {
        const status = await getDeployStatus(result.deployHash);
        if (status.executed) {
          onTx({ ...tx, status: status.error ? 'error' : 'success', error: status.error, blockHeight: status.blockHeight });
        } else {
          setTimeout(poll, 5000);
        }
      };
      setTimeout(poll, 5000);
    }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm">{title}</h4>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      </div>
      {children({ submit })}
    </Card>
  );
}
