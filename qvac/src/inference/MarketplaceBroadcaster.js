import { EventEmitter } from 'events';

export class MarketplaceBroadcaster extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.p2p = null;
    this.listings = new Map();
    this.started = false;
  }

  initialize({ p2p }) {
    this.p2p = p2p;
  }

  async start() {
    if (this.p2p) {
      this.p2p.onMessage('marketplace-listing', (msg, peerId) => {
        this._handleListing(msg, peerId);
      });
      this.p2p.onMessage('marketplace-unlist', (msg) => {
        this.listings.delete(msg.id);
        this.emit('unlist', msg.id);
      });
    }
    this.started = true;
  }

  async stop() {
    this.started = false;
  }

  list(item) {
    this.listings.set(item.id, item);
    if (this.p2p) {
      this.p2p.broadcast('marketplace-listing', item);
    }
    this.emit('list', item);
  }

  unlist(itemId) {
    this.listings.delete(itemId);
    if (this.p2p) {
      this.p2p.broadcast('marketplace-unlist', { id: itemId });
    }
    this.emit('unlist', itemId);
  }

  _handleListing(item, peerId) {
    if (this.listings.has(item.id)) return;
    this.listings.set(item.id, item);
    this.emit('listing', item, peerId);
  }

  getListings() {
    return Array.from(this.listings.values());
  }

  getStats() {
    return { started: this.started, listings: this.listings.size };
  }
}
