/**
 * @localchimera/browser-sdk — Main entry point
 *
 * Run a tasker network node entirely in the browser. No download required.
 *
 * Supports Web3Auth (EVM/Robinhood Chain) wallets.
 *
 * Usage (Web3Auth / EVM):
 *   import { BrowserNode, connectWeb3Auth } from '@localchimera/browser-sdk';
 *
 *   const { provider, address } = await connectWeb3Auth({ clientId: '...' });
 *   const node = new BrowserNode({ evmProvider: provider, evmAddress: address });
 *   await node.start();
 *
 * Heavy libraries (WebLLM, Helia, Wasmer) are dynamically imported
 * and only loaded when the corresponding task type is needed.
 */

export { BrowserNode, quickStart } from './browser-node';
export type { BrowserNodeStatus, BrowserCapabilities, LogEntry, BrowserNodeOptions } from './browser-node';

export { createWeb3Auth, connectWeb3Auth, createWeb3AuthCoreKit, connectWeb3AuthCoreKit, connectWeb3AuthSocial, connectWeb3AuthMpc } from './web3auth';
export type { Web3AuthConfig, Web3AuthCoreKitConfig, Web3AuthSocialConfig, Web3AuthMpcConfig, Web3AuthWallet } from './web3auth';
export { Web3Auth, CHAIN_NAMESPACES, WEB3AUTH_NETWORK, EthereumPrivateKeyProvider } from './web3auth';

export {
  BOTCHAIN_TESTNET,
  BOTCHAIN_CONTRACTS,
  JOB_STATE,
  TASK_POLICY,
  getProviderFromWallet,
  getSignerFromWallet,
  getBotchainContracts,
  getBotchainContractsWithSigner,
  switchToBotchain,
  botchainExplorerLink,
} from './botchain-client';

export {
  TASK_TYPE,
  TASK_TYPE_BOTCHAIN,
  TASK_TYPE_NAME,
  normalizeTaskType,
  toBotchainTaskType,
} from './task-types';

export {
  GolemNetworkAdapter,
  MysteriumNetworkAdapter,
  AnyoneNetworkAdapter,
  BtfsNetworkAdapter,
  BttAiNetworkAdapter,
  createAllAdapters,
} from './network-adapters';
export type { NetworkAdapter, NetworkAdapterStatus } from './network-adapters';

export { CoordinatorClient } from './coordinator-client';
export type { CoordinatorClientOptions } from './coordinator-client';

export { RomaRouter, createRomaApiHandler } from './roma-router';
export type { RomaSubTask, RomaTaskType, RomaExecutionResult } from './roma-router';

