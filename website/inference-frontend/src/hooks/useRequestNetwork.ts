import { useState, useEffect, useCallback } from 'react';

const REQUEST_CLIENT_URL = 'https://unpkg.com/@requestnetwork/request-client.js@0.58.0/dist/requestnetwork.min.js';
const WEB3_SIGNATURE_URL = 'https://unpkg.com/@requestnetwork/web3-signature@0.8.0/dist/web3-signature.min.js';

let loadPromise: Promise<any> | null = null;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing && (window as any).RequestNetwork) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function loadRequestNetwork() {
  if (!loadPromise) {
    loadPromise = Promise.all([loadScript(REQUEST_CLIENT_URL), loadScript(WEB3_SIGNATURE_URL)]);
  }
  return loadPromise;
}

export function useRequestNetwork() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    loadRequestNetwork()
      .then(() => setReady(true))
      .catch((e) => setError(e.message || 'Failed to load Request Network'));
  }, []);

  const createRequest = useCallback(async (provider: any, params: any) => {
    const win = window as any;
    if (!win.RequestNetwork || !win.Web3Signature) {
      throw new Error('Request Network not loaded');
    }
    const signatureProvider = new win.Web3Signature.Web3SignatureProvider(provider);
    const requestNetwork = new win.RequestNetwork.RequestNetwork({
      nodeConnectionConfig: { baseURL: 'https://sepolia.gateway.request.network/' },
      signatureProvider,
    });
    const request = await requestNetwork.createRequest(params);
    const confirmed = await request.waitForConfirmation();
    return confirmed;
  }, []);

  return { ready, error, createRequest };
}

export async function payRequest(requestId: string, payerAddress: string, provider: any) {
  const win = window as any;
  if (!win.RequestNetwork) throw new Error('Request Network not loaded');
  const requestNetwork = new win.RequestNetwork.RequestNetwork({
    nodeConnectionConfig: { baseURL: 'https://sepolia.gateway.request.network/' },
  });
  const request = await requestNetwork.fromRequestId(requestId);
  const data = request.getData();
  if (data.state === 'paid') return { status: 'already paid' };
  // Build payment transaction via viem wallet client
  const { createWalletClient, custom, parseEther } = await import('viem');
  const eip1193 = provider?.provider || provider?.getEthereumProvider?.() || provider?.getProvider?.() || provider;
  const walletClient = createWalletClient({ transport: custom(eip1193) });
  const [account] = await walletClient.getAddresses();
  const paymentNetwork = data.extensions?.find((e: any) => e?.id);
  if (!paymentNetwork?.values?.paymentAddress) throw new Error('No payment address');
  const hash = await walletClient.sendTransaction({
    account,
    to: paymentNetwork.values.paymentAddress,
    value: parseEther(data.expectedAmount),
  });
  return { status: 'paid', txHash: hash };
}
