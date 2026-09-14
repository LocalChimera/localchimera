import { EventEmitter } from 'events';

export class ReceiptGossip extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.receipts = new Map();
    this.p2p = null;
    this.started = false;
  }

  initialize({ p2p }) {
    this.p2p = p2p;
  }

  async start() {
    if (this.p2p) {
      this.p2p.onMessage('receipt-gossip', (msg, peerId) => {
        this._handleReceipt(msg, peerId);
      });
    }
    this.started = true;
  }

  async stop() {
    this.started = false;
  }

  broadcast(receipt) {
    this.receipts.set(receipt.id, receipt);
    if (this.p2p) {
      this.p2p.broadcast('receipt-gossip', receipt);
    }
    this.emit('receipt', receipt);
  }

  _handleReceipt(receipt, peerId) {
    if (this.receipts.has(receipt.id)) return;
    this.receipts.set(receipt.id, receipt);
    this.emit('receipt', receipt);
  }

  getReceipts() {
    return Array.from(this.receipts.values());
  }

  getStats() {
    return { started: this.started, receipts: this.receipts.size };
  }
}
