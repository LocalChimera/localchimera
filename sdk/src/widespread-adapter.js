/**
 * widespread-adapter — Chimera wallet connection via Widespread.
 *
 * Thin shim: all wallet logic lives in `widespread.fyi/embed.js`
 * (`Widespread.create().embedForChimera()`). This file only resolves the
 * provider — injected extension provider when present, lazily-loaded embed
 * script otherwise — and returns the `{ provider, address, jwt }` shape
 * `useChimera` consumes.
 *
 * No Web3Auth, no server-side verify endpoint, no clientId — the JWT is a
 * self-verifiable ES256K assertion (did:key) the caller can check offline.
 * Settlement is Logos-native; the returned provider is never attached to a
 * BrowserNode's EVM escrow path.
 */

const EMBED_URL = 'https://widespread.fyi/embed.js';
let embedPromise = null;

function loadEmbed() {
  if (window.Widespread) return Promise.resolve(window.Widespread);
  if (!embedPromise) {
    embedPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = EMBED_URL;
      s.onload = () => window.Widespread
        ? resolve(window.Widespread)
        : reject(new Error('Widespread embed failed to initialize'));
      s.onerror = () => reject(new Error('Could not load widespread.fyi/embed.js'));
      document.head.appendChild(s);
    });
  }
  return embedPromise;
}

/**
 * Connect via the Widespread embedded wallet / extension.
 * @param {{ appName?: string, embedOrigin?: string }} opts
 * @returns {Promise<{ provider: object, address: string, jwt: string, user: object }>}
 */
export async function connectWidespreadWallet(opts = {}) {
  // Extension fast-path — the injected provider is already connected-capable.
  const injected = typeof window !== 'undefined' ? window.ethereum : null;
  if (injected?.isWidespread) {
    const accounts = await injected.request({ method: 'eth_requestAccounts', params: [] });
    if (!accounts?.length) throw new Error('Widespread extension returned no accounts');
    return { provider: injected, address: accounts[0], jwt: '', user: { id: accounts[0], address: accounts[0] } };
  }

  const Widespread = await loadEmbed();
  const wsp = Widespread.create({ appName: opts.appName, origin: opts.embedOrigin });
  const { evmProvider, jwt, address } = await wsp.embedForChimera();
  return { provider: evmProvider, address, jwt, user: { id: address, address } };
}
