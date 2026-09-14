/**
 * BTFS HTTP API client (walletless provider mode).
 *
 * Talks to a local go-btfs daemon at the standard API port (5001).
 * This client only performs storage/retrieval operations (add, cat, pin, unpin).
 * It does NOT interact with the BTT wallet, storage-host contracts, or cheques.
 * All payments and job authorization live on the Robinhood Chain.
 */

export class BtfsClient {
  constructor(opts = {}) {
    this.apiUrl = opts.apiUrl || 'http://127.0.0.1:5001';
    this.timeout = opts.timeout || 60000;
  }

  async _request(path, { method = 'GET', body = null, query = {} } = {}) {
    const url = new URL(`${this.apiUrl}/api/v0${path}`);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.append(k, v);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(url.toString(), {
        method,
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`BTFS ${path} failed (${res.status}): ${text}`);
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async id() {
    const res = await this._request('/id');
    return res.json();
  }

  async version() {
    const res = await this._request('/version');
    return res.json();
  }

  async isOnline() {
    try {
      await this.id();
      return true;
    } catch {
      return false;
    }
  }

  async add(file, { pin = true, wrapWithDirectory = false } = {}) {
    const form = new FormData();
    form.append('file', file);
    const res = await this._request('/add', {
      method: 'POST',
      body: form,
      query: {
        pin: pin ? 'true' : 'false',
        'wrap-with-directory': wrapWithDirectory ? 'true' : 'false',
      },
    });
    return res.json();
  }

  async cat(cid) {
    const res = await this._request('/cat', { query: { arg: cid } });
    return res.blob();
  }

  async pinAdd(cid) {
    const res = await this._request('/pin/add', { method: 'POST', query: { arg: cid } });
    return res.json();
  }

  async pinRm(cid) {
    const res = await this._request('/pin/rm', { method: 'POST', query: { arg: cid } });
    return res.json();
  }

  async pinLs() {
    const res = await this._request('/pin/ls');
    return res.json();
  }
}
