export interface TxRecord {
  id: string;
  deployHash: string;
  entryPoint: string;
  contract: string;
  status: 'pending' | 'success' | 'error';
  error?: string;
  blockHeight?: number;
}
