/**
 * @localchimera/sdk — Main entry point
 *
 * Tasking network provider SDK. Exports only the providers and orchestrator
 * needed to participate in decentralized compute, storage, bandwidth, and
 * inference networks. Wallet connection uses ConnectKit (EVM) and Solana Wallet
 * Adapter (Solana) via wagmi, plus the @localchimera/browser-sdk for Web3Auth MPC.
 *
 * React hook: import { useChimera } from '@localchimera/sdk'
 */

export { ChimeraSDK } from './ChimeraSDK.js';
export { PrivacyContainer } from './runtime/PrivacyContainer.js';
export { useChimera, ChimeraWeb3AuthProvider } from './useChimera.js';
export { fetchWeb3AuthConfig, fetchWalletJwt, createMpcWalletFromJwt } from './web3auth-helpers.js';
export { ChimeraButton } from './ChimeraButton.js';
export { checkForUpdates, onUpdateAvailable, getSDKVersion } from './core/update-checker.js';
export { ResourceMonitor } from './core/resource-monitor.js';
export {
  BttAiMinerProvider,
  GolemProvider,
  AnyoneProtocolProvider,
  MysteriumProvider,
  BtfsStorageProvider,
  SentinelProvider,
  SpheronProvider,
  CrustProvider,
  InfernetProvider,
  getProtocolPayoutAddress,
  DEFAULT_PROTOCOL_PAYOUT_ADDRESS,
} from './miners/index.js';
export { BtfsClient } from './storage/index.js';
export { TASK_TYPE, TASK_TYPE_NAME, TASK_TYPE_BOTCHAIN, normalizeTaskType, toBotchainTaskType } from './core/task-types.js';
