import { useState } from 'react';
import EntryPointCard from './EntryPointCard';
import { Button, Input, Card } from './ui';
import { Send, AlertTriangle } from 'lucide-react';
import type { TxRecord } from '../types';
import * as sdk from 'casper-js-sdk';

export default function ReputationTab({ provider, publicKeyHex, contractHash, onTx }: {
  provider: any; publicKeyHex: string; contractHash: string; onTx: (tx: TxRecord) => void;
}) {
  const canSign = !!provider && !!publicKeyHex;
  return (
    <div className="space-y-4">
      <div><h2 className="text-2xl font-bold">Reputation</h2><p className="text-muted-foreground text-sm">{contractHash}</p></div>

      <Card className="p-4">
        <h3 className="font-semibold mb-2 flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Evaluation Gate</h3>
        <p className="text-xs text-muted-foreground">
          Only entities that have previously completed a transaction with a provider may submit an evaluation.
          The smart contract enforces this by checking the evaluator's transaction history in the escrow vault
          before accepting a reputation update.
        </p>
        <div className="mt-2 text-xs text-yellow-700">This validation must be implemented in the reputation contract's entry point logic.</div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <EntryPointCard title="Record Rating" contract="Reputation" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [peerId, setPeerId] = useState(''); const [rating, setRating] = useState('5');
            return <form onSubmit={(e) => { e.preventDefault(); submit('record_rating', {
              peer_id: sdk.CLValue.newCLString(peerId), rating: sdk.CLValue.newCLUint64(rating),
            }); }} className="space-y-2">
              <Input label="Peer ID" value={peerId} onChange={setPeerId} />
              <Input label="Rating (1-10)" value={rating} onChange={setRating} />
              <Button type="submit" disabled={!canSign} className="w-full"><Send className="h-4 w-4 mr-1" />Record</Button>
            </form>;
          }}
        </EntryPointCard>
        <EntryPointCard title="Update Weight" contract="Reputation" contractHash={contractHash} provider={provider} publicKeyHex={publicKeyHex} onTx={onTx}>
          {({ submit }) => {
            const [peerId, setPeerId] = useState(''); const [weight, setWeight] = useState('100');
            return <form onSubmit={(e) => { e.preventDefault(); submit('update_weight', {
              peer_id: sdk.CLValue.newCLString(peerId), new_weight: sdk.CLValue.newCLUint64(weight),
            }); }} className="space-y-2">
              <Input label="Peer ID" value={peerId} onChange={setPeerId} />
              <Input label="Weight" value={weight} onChange={setWeight} />
              <Button type="submit" disabled={!canSign} className="w-full"><Send className="h-4 w-4 mr-1" />Update</Button>
            </form>;
          }}
        </EntryPointCard>
      </div>
    </div>
  );
}
