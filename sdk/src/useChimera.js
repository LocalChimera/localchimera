/**
 * useChimera — React hook for Chimera SDK.
 *
 * Wallet connection now uses the same adapter + JWT flow as the example page:
 *   - EVM: ConnectKit (wagmi + injected connector) -> sign message -> backend JWT -> Web3Auth MPC
 *   - Solana: Solana Wallet Adapter -> sign message -> backend JWT -> Web3Auth MPC
 *
 * The backend verifies the wallet signature and issues a JWT. Web3Auth MPC Core Kit
 * consumes that JWT to create a seedless MPC wallet.
 */

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  createContext,
  useContext,
  createElement,
  Component,
} from 'react';

import { WagmiProvider, createConfig, useAccount, useSignMessage, useDisconnect, useConnect, useWalletClient, usePublicClient } from 'wagmi';
import { mainnet, sepolia } from 'wagmi/chains';
import { walletConnect } from 'wagmi/connectors';
import { http, getContract, keccak256, toUtf8Bytes, parseEther, zeroAddress, decodeEventLog, parseAbi } from 'viem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectKitProvider } from 'connectkit';
import { fetchWeb3AuthConfig, fetchWalletJwt, createMpcWalletFromJwt } from './web3auth-helpers.js';
import { checkForUpdates, onUpdateAvailable, getSDKVersion } from './core/update-checker.js';
import { TASK_TYPE_BOTCHAIN } from './core/task-types.js';

const CHIMERA_COORDINATOR_ABI = parseAbi([
  'function createJob(bytes32 requestHash, uint64 nonce, uint64 taskType, uint64 validUntil, bytes quoteSignature, address paymentMint, bytes16 refId, uint8 policy) payable returns (address jobAddress, bytes32 jobId)',
  'event JobRouted(bytes32 indexed jobId, address indexed jobAddress, address indexed provider, uint64 taskType, uint8 policy)',
]);

export const TASK_POLICY = {
  HYBRID: 0,
  FIRST_PARTY_ONLY: 1,
  SECOND_PARTY_ONLY: 2,
};

const API_BASE = (() => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE;
  }
  if (typeof process !== 'undefined' && process.env?.VITE_API_BASE) {
    return process.env.VITE_API_BASE;
  }
  if (typeof window !== 'undefined' && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
    return '/api';
  }
  return 'http://localhost:3002/api';
})();

const WALLET_CONNECT_PROJECT_ID = '403f10c4cf2104d36c5bbb71b261d44a';

const WAGMI_CONFIG = createConfig({
  chains: [mainnet, sepolia],
  connectors: [
    walletConnect({
      projectId: WALLET_CONNECT_PROJECT_ID,
      metadata: {
        name: 'LocalChimera',
        description: 'Chimera mobile wallet connect',
        url: 'https://new-localchimera.pages.dev',
        icons: [],
        redirect: {
          native: 'io.chimera.mobile://wallet',
          universal: 'https://new-localchimera.pages.dev/wallet',
        },
      },
    }),
  ],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
});

const QUERY_CLIENT = new QueryClient();

const ChimeraWalletContext = createContext(null);

function useChimeraInner(opts = {}) {
  const evm = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnectAsync: disconnectEvm } = useDisconnect();
  const { connect } = useConnect();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [web3AuthConfig, setWeb3AuthConfig] = useState(null);
  const [walletState, setWalletState] = useState({
    connected: false,
    walletAddress: null,
    provider: null,
    chain: null,
    walletAdapterAddress: null,
    user: null,
  });
  const [status, setStatus] = useState({ running: false, providers: [], consent: false, containerized: false });
  const [consentGiven, setConsentGiven] = useState(false);
  const [sdkUpdate, setSdkUpdate] = useState({ current: getSDKVersion(), latest: getSDKVersion(), updateAvailable: false });
  const [browserMode, setBrowserMode] = useState(false);
  const intervalRef = useRef(null);
  const browserNodeRef = useRef(null);
  const appDeveloperEVM = opts.appDeveloperEVM || null;
  const revenueSplit = opts.revenueSplit || { machineOwner: 0.70, appDeveloper: 0.30 };
  const mpcBaseUrl = opts.mpcBaseUrl || (typeof window !== 'undefined' ? `${window.location.origin}/serviceworker` : undefined);

  // Load Web3Auth config from backend
  useEffect(() => {
    let cancelled = false;
    fetchWeb3AuthConfig().then((cfg) => {
      if (!cancelled) setWeb3AuthConfig(cfg);
    }).catch((e) => console.warn('[useChimera] Web3Auth config load failed', e));
    return () => { cancelled = true; };
  }, []);

  // SDK auto-update check
  useEffect(() => {
    const unsub = onUpdateAvailable((info) => setSdkUpdate({ ...info, updateAvailable: true }));
    checkForUpdates().then((info) => setSdkUpdate(info)).catch(() => {});
    return unsub;
  }, []);

  // Detect backend availability
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/status`).then((res) => {
      if (res.ok && !cancelled) setBrowserMode(false);
    }).catch(() => {
      if (!cancelled) setBrowserMode(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Auto-revoke consent when wallet disconnects
  useEffect(() => {
    if (!walletState.connected && consentGiven) {
      setConsentGiven(false);
      setStatus(prev => ({ ...prev, consent: false, running: false }));
      try { fetch(`${API_BASE}/stop`, { method: 'POST' }); } catch (e) {}
      try { fetch(`${API_BASE}/consent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: false }) }); } catch (e) {}
    }
  }, [walletState.connected, consentGiven]);

  const fetchStatus = useCallback(async () => {
    if (browserMode) {
      if (browserNodeRef.current) {
        const node = browserNodeRef.current;
        const nodeStatus = node.getStatus ? node.getStatus() : {};
        setStatus(prev => ({
          ...prev,
          running: node.running || false,
          providers: [
            { provider: 'evm-escrow', running: node.running, jobsProcessed: node.jobsProcessed, jobsFailed: node.jobsFailed },
          ],
          containerized: false,
          browserMode: true,
          networkAdapters: nodeStatus.networkAdapters || [],
        }));
      }
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/status`);
      const json = await res.json();
      if (json.success) {
        setStatus(prev => ({
          ...prev,
          running: json.data?.running || false,
          providers: json.data?.providers || [],
          containerized: json.data?.containerized || false,
          consent: json.data?.consent || prev.consent,
        }));
      }
    } catch (e) { /* backend may not be running */ }
  }, [browserMode]);

  useEffect(() => {
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, 5000);
    return () => clearInterval(intervalRef.current);
  }, [fetchStatus]);

  const connectWallet = useCallback(async (chain = 'evm') => {
    if (!web3AuthConfig) return { success: false, error: 'Web3Auth config not loaded' };
    try {
      if (typeof window !== 'undefined') {
        try { window.focus(); } catch (e) {}
        try { document.body?.focus(); } catch (e) {}
      }
      // Open WalletConnect directly, skipping the ConnectKit connector list
      connect({ connector: WAGMI_CONFIG.connectors[0] });
      return { success: true, pending: true, chain: 'evm' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }, [web3AuthConfig, connect]);

  const connectWalletWithJwt = useCallback(async ({ jwt, sub, address, chain = 'evm' }) => {
    if (!web3AuthConfig) return { success: false, error: 'Web3Auth config not loaded' };
    try {
      const wallet = await createMpcWalletFromJwt({
        clientId: web3AuthConfig.clientId,
        verifier: web3AuthConfig.verifier,
        verifierId: sub,
        idToken: jwt,
        baseUrl: mpcBaseUrl,
      });
      setWalletState({
        connected: true,
        walletAddress: wallet.address,
        provider: null,
        chain,
        walletAdapterAddress: address,
        user: wallet.user,
      });
      return { success: true, address: wallet.address, chain };
    } catch (e) {
      setWalletState({ connected: false, walletAddress: null, provider: null, chain: null, walletAdapterAddress: null, user: null });
      return { success: false, error: e.message };
    }
  }, [web3AuthConfig, mpcBaseUrl]);

  const completeWalletConnection = useCallback(async (chain) => {
    if (!web3AuthConfig) return { success: false, error: 'Web3Auth config not loaded' };
    try {
      if (!evm.isConnected || !evm.address) throw new Error('EVM wallet not connected');
      const walletAddress = evm.address;
      const message = `Sign in to LocalChimera with ${walletAddress} at ${new Date().toISOString()}`;
      if (typeof window !== 'undefined') {
        try { window.focus(); } catch (e) {}
        try { document.body?.focus(); } catch (e) {}
      }
      const signature = await Promise.race([
        signMessageAsync({ message }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Wallet sign message timed out')), 30000)),
      ]);
      const { jwt, sub } = await fetchWalletJwt({ walletAddress, message, signature, chain: 'evm' });
      const wallet = await createMpcWalletFromJwt({
        clientId: web3AuthConfig.clientId,
        verifier: web3AuthConfig.verifier,
        verifierId: sub,
        idToken: jwt,
        baseUrl: mpcBaseUrl,
      });
      const connectorProvider = evm.connector ? await evm.connector.getProvider().catch(() => null) : null;
      setWalletState({
        connected: true,
        walletAddress: wallet.address,
        provider: connectorProvider,
        chain: 'evm',
        walletAdapterAddress: walletAddress,
        user: wallet.user,
      });
      return { success: true, address: wallet.address, chain: 'evm' };
    } catch (e) {
      setWalletState(prev => {
        console.log('[useChimera] completeWalletConnection catch preserving adapter', prev.walletAdapterAddress);
        return {
          connected: false,
          walletAddress: null,
          provider: null,
          chain: prev.walletAdapterAddress ? 'evm' : null,
          walletAdapterAddress: prev.walletAdapterAddress,
          user: null,
        };
      });
      return { success: false, error: e.message };
    }
  }, [web3AuthConfig, evm, signMessageAsync, mpcBaseUrl]);

  // Watch EVM connection and record the adapter address; MPC wallet completion is manual
  useEffect(() => {
    if (evm.isConnected && evm.address && !walletState.connected && !walletState.walletAdapterAddress && web3AuthConfig) {
      setWalletState(prev => ({
        ...prev,
        walletAdapterAddress: evm.address,
        chain: 'evm',
      }));
      console.log('[useChimera] EVM wallet connected', evm.address);
      // Try to return to the app after wallet connection
      if (typeof window !== 'undefined' && window.ReactNativeWebView) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'wallet-connected' }));
        } catch (e) {}
      }
    }
  }, [evm.isConnected, evm.address, walletState.connected, walletState.walletAdapterAddress, web3AuthConfig]);

  const disconnectWallet = useCallback(async () => {
    try {
      if (walletState.chain === 'evm') await disconnectEvm();
    } catch (e) {}
    setWalletState({ connected: false, walletAddress: null, provider: null, chain: null, walletAdapterAddress: null, user: null });
    setConsentGiven(false);
    setStatus(prev => ({ ...prev, consent: false }));
    try { await fetch(`${API_BASE}/stop`, { method: 'POST' }); } catch (e) {}
    try { await fetch(`${API_BASE}/consent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: false }) }); } catch (e) {}
    await fetchStatus();
    return { success: true };
  }, [walletState.chain, disconnectEvm, fetchStatus]);

  const ready = !!web3AuthConfig;
  const walletConnected = walletState.connected && !!walletState.walletAddress;
  const walletAddress = walletState.walletAddress;
  const provider = walletState.provider;

  const giveConsent = useCallback(async () => {
    if (!walletConnected) return { success: false, error: 'Connect wallet first' };
    setConsentGiven(true);
    setStatus(prev => ({ ...prev, consent: true }));
    try {
      await fetch(`${API_BASE}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: true }),
      });
    } catch (e) {}
    return { success: true };
  }, [walletConnected]);

  const revokeConsent = useCallback(async () => {
    setConsentGiven(false);
    setStatus(prev => ({ ...prev, consent: false }));
    try { await fetch(`${API_BASE}/stop`, { method: 'POST' }); } catch (e) {}
    try {
      await fetch(`${API_BASE}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: false }),
      });
    } catch (e) {}
    await fetchStatus();
    return { success: true };
  }, [fetchStatus]);

  const start = useCallback(async () => {
    if (!consentGiven) return { success: false, error: 'Consent required' };
    if (!walletAddress) return { success: false, error: 'Wallet not connected' };

    if (browserMode) {
      try {
        const { BrowserNode } = await import('@localchimera/browser-sdk');
        let node;
        if (walletState.chain === 'evm') {
          node = new BrowserNode({ evmProvider: walletState.provider, evmAddress: walletAddress });
        } else {
          return { success: false, error: 'Browser mode requires an EVM wallet' };
        }
        node.onStatusUpdate((nodeStatus) => {
          setStatus(prev => ({
            ...prev,
            running: nodeStatus.running,
            providers: [{
              provider: 'evm-escrow',
              running: nodeStatus.running,
              jobsProcessed: nodeStatus.jobsProcessed,
              jobsFailed: nodeStatus.jobsFailed,
              earningsMotes: nodeStatus.earningsMotes,
            }],
            containerized: false,
            browserMode: true,
            networkAdapters: nodeStatus.networkAdapters || [],
            marketRegistrations: nodeStatus.marketRegistrations || {},
          }));
        });
        await node.start();
        browserNodeRef.current = node;
        return { success: true, running: true, mode: 'browser' };
      } catch (e) {
        return { success: false, error: `Browser node failed: ${e.message}` };
      }
    }

    try {
      const res = await fetch(`${API_BASE}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machineOwnerEVM: walletAddress,
          appDeveloperEVM,
          revenueSplit,
          payoutModel: 'protocol-multisig-monthly-sweep',
        }),
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      await fetchStatus();
      return json;
    } catch (e) {
      return { success: false, error: e.message };
    }
  }, [consentGiven, walletAddress, walletState.chain, walletState.provider, walletState.walletAdapterAddress, appDeveloperEVM, revenueSplit, fetchStatus, browserMode]);

  const stop = useCallback(async () => {
    if (browserMode && browserNodeRef.current) {
      try {
        await browserNodeRef.current.stop();
        browserNodeRef.current = null;
        setStatus(prev => ({ ...prev, running: false }));
        return { success: true, running: false, mode: 'browser' };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    try {
      const res = await fetch(`${API_BASE}/stop`, { method: 'POST' });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      await fetchStatus();
      return json;
    } catch (e) {
      return { success: false, error: e.message };
    }
  }, [fetchStatus, browserMode]);

  const createInferenceKey = useCallback(async (keyOpts = {}) => {
    const res = await fetch(`${API_BASE}/inference-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(keyOpts),
    });
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }, []);

  const listInferenceKeys = useCallback(async () => {
    const res = await fetch(`${API_BASE}/inference-keys`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }, []);

  const revokeInferenceKey = useCallback(async (id) => {
    const res = await fetch(`${API_BASE}/inference-keys/${id}`, { method: 'DELETE' });
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }, []);

  const infer = useCallback(async (params = {}) => {
    if (browserMode && browserNodeRef.current) {
      try {
        return await browserNodeRef.current.infer({
          messages: params.messages || [],
          model: params.model || 'chimera-browser',
          maxTokens: params.maxTokens || 512,
          temperature: params.temperature ?? 0.7,
          stream: params.stream || false,
        });
      } catch (e) {
        return { error: e.message };
      }
    }
    const headers = { 'Content-Type': 'application/json' };
    const token = params.accessToken || params.apiKey;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE.replace('/api', '')}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: params.messages || [],
        model: params.model || 'chimera-local',
        max_tokens: params.maxTokens || 512,
        temperature: params.temperature || 0.7,
        stream: params.stream || false,
      }),
    });
    if (params.stream) return res.body;
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }, [browserMode]);

  const getInferenceEndpoint = useCallback(() => {
    if (browserMode) {
      return {
        url: 'chimera-browser://infer',
        modelsUrl: 'chimera-browser://models',
        authHeader: 'Not required (browser-local inference)',
        compatible: 'OpenAI-compatible',
        mode: 'browser',
        note: 'Inference runs locally in-browser via WebGPU (WebLLM) or WASM (transformers.js). No API key needed.',
      };
    }
    return {
      url: `${API_BASE.replace('/api', '')}/v1/chat/completions`,
      modelsUrl: `${API_BASE.replace('/api', '')}/v1/models`,
      authHeader: 'Authorization: Bearer chim_... or chim_access_...',
      compatible: 'OpenAI-compatible',
      mode: 'container',
    };
  }, [browserMode]);

  const solve = useCallback(async (goal, opts = {}) => {
    if (browserMode && browserNodeRef.current?.romaRouter) {
      try {
        const answer = await browserNodeRef.current.romaRouter.solve(goal, opts);
        return { success: true, answer, mode: 'browser' };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    try {
      const res = await fetch(`${API_BASE}/roma/solve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, ...opts }),
      });
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    } catch (e) {
      return { success: false, error: e.message };
    }
  }, [browserMode]);

  const sendTask = useCallback(async (task) => {
    if (!walletAddress || !provider) {
      return { success: false, error: 'Wallet not connected' };
    }
    if (walletState.chain === 'solana') {
      return { success: false, error: 'Solana task signing is not yet supported in this SDK version' };
    }
    const policy = typeof task.policy === 'number' ? task.policy : TASK_POLICY.HYBRID;
    if (policy === TASK_POLICY.FIRST_PARTY_ONLY) {
      if (!task.escrow) {
        return { success: false, error: 'First-party-only tasks require an escrow amount' };
      }
    }
    const coordinatorAddress = task.coordinator || process.env.CHIMERA_COORDINATOR_ADDRESS || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CHIMERA_COORDINATOR_ADDRESS);
    if (!coordinatorAddress) {
      return { success: false, error: 'No ChimeraCoordinator address configured. Set CHIMERA_COORDINATOR_ADDRESS.' };
    }
    try {
      if (!walletClient) throw new Error('No wallet client available');
      const coordinator = getContract({
        address: coordinatorAddress,
        abi: CHIMERA_COORDINATOR_ABI,
        client: walletClient,
      });
      const requestHash = task.requestHash || keccak256(toUtf8Bytes(JSON.stringify(task.payload || {})));
      const nonce = task.nonce || Math.floor(Math.random() * 1e9);
      const taskType = task.taskType || TASK_TYPE_BOTCHAIN.INFERENCE;
      const validUntil = task.validUntil || Math.floor(Date.now() / 1000) + 3600;
      const escrow = parseEther(String(task.escrow || '0.01'));
      const hash = await coordinator.write.createJob([
        requestHash,
        BigInt(nonce),
        BigInt(taskType),
        BigInt(validUntil),
        '0x',
        zeroAddress,
        '0x00000000000000000000000000000000',
        policy,
        0n,
      ], { value: escrow, account: walletClient.account });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const routed = receipt?.logs
        ?.map((log) => { try { return decodeEventLog({ abi: CHIMERA_COORDINATOR_ABI, data: log.data, topics: log.topics }); } catch { return null; } })
        ?.find((parsed) => parsed && parsed.eventName === 'JobRouted');
      return {
        success: true,
        policy,
        taskType,
        txHash: hash,
        jobAddress: routed?.args?.jobAddress,
        jobId: routed?.args?.jobId,
        provider: routed?.args?.provider,
        mode: policy === TASK_POLICY.SECOND_PARTY_ONLY ? 'second-party' : 'first-party-routed',
        note: policy === TASK_POLICY.FIRST_PARTY_ONLY
          ? 'Full Chimera escrow and dispute features enabled.'
          : policy === TASK_POLICY.SECOND_PARTY_ONLY
            ? 'No escrow or dispute features available for second-party-only tasks.'
            : 'Hybrid routing: volunteers first, tasking network fallback if needed.',
      };
    } catch (e) {
      return { success: false, error: e.message, policy };
    }
  }, [walletAddress, walletClient, publicClient, walletState.chain]);

  return {
    ready,
    walletConnected,
    walletAddress,
    walletAdapterAddress: walletState.walletAdapterAddress,
    walletChain: walletState.chain,
    connectWallet,
    connectWalletWithJwt,
    disconnectWallet,
    consentGiven,
    giveConsent,
    revokeConsent,
    status,
    start,
    stop,
    createInferenceKey,
    listInferenceKeys,
    revokeInferenceKey,
    infer,
    getInferenceEndpoint,
    solve,
    sendTask,
    sdkUpdate,
    browserMode,
  };
}

class ChimeraProviderErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[ChimeraWeb3AuthProvider] wallet adapter failed to initialize:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.children;
    }
    return this.props.children;
  }
}

const ChimeraWalletProvider = ({ children }) => {
  return createElement(
    QueryClientProvider,
    { client: QUERY_CLIENT },
    createElement(
      WagmiProvider,
      { config: WAGMI_CONFIG },
      createElement(
        ConnectKitProvider,
        {},
        createElement(ChimeraWalletContext.Provider, { value: true }, children)
      )
    )
  );
};

const ChimeraWeb3AuthProvider = ({ children }) => {
  if (typeof window !== 'undefined') window.__chimeraWeb3AuthProviderActive = true;
  const provider = createElement(
    ChimeraProviderErrorBoundary,
    null,
    createElement(ChimeraWalletProvider, null, children)
  );
  return provider;
};

export function useChimera(opts = {}) {
  const providerPresent = useContext(ChimeraWalletContext);
  const inner = useChimeraInner(opts);
  if (providerPresent) return inner;

  return useMemo(() => ({
    ready: false,
    walletConnected: false,
    walletAddress: null,
    walletAdapterAddress: null,
    walletChain: null,
    connectWallet: () => ({ success: false, error: 'Wrap your app in <ChimeraWeb3AuthProvider> first. See @localchimera/sdk docs.' }),
    disconnectWallet: () => ({ success: false, error: 'Wrap your app in <ChimeraWeb3AuthProvider> first.' }),
    consentGiven: false,
    giveConsent: () => ({ success: false, error: 'Wrap your app in <ChimeraWeb3AuthProvider> first.' }),
    revokeConsent: () => ({ success: false, error: 'Wrap your app in <ChimeraWeb3AuthProvider> first.' }),
    status: { running: false, providers: [], consent: false, containerized: false },
    start: () => ({ success: false, error: 'Wrap your app in <ChimeraWeb3AuthProvider> first.' }),
    stop: () => ({ success: false, error: 'Wrap your app in <ChimeraWeb3AuthProvider> first.' }),
    createInferenceKey: () => ({ success: false, error: 'Wrap your app in <ChimeraWeb3AuthProvider> first.' }),
    listInferenceKeys: () => ({ success: false, error: 'Wrap your app in <ChimeraWeb3AuthProvider> first.' }),
    revokeInferenceKey: () => ({ success: false, error: 'Wrap your app in <ChimeraWeb3AuthProvider> first.' }),
    infer: () => ({ success: false, error: 'Wrap your app in <ChimeraWeb3AuthProvider> first.' }),
    getInferenceEndpoint: () => ({ url: null, error: 'Wrap your app in <ChimeraWeb3AuthProvider> first.' }),
    solve: () => ({ success: false, error: 'Wrap your app in <ChimeraWeb3AuthProvider> first.' }),
    sendTask: () => ({ success: false, error: 'Wrap your app in <ChimeraWeb3AuthProvider> first.' }),
    sdkUpdate: { current: getSDKVersion(), latest: getSDKVersion(), updateAvailable: false },
    browserMode: false,
  }), []);
}

export { ChimeraWeb3AuthProvider };
