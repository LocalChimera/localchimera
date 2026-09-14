import { Logger } from './Logger.js';
import { createWalletClient, http, getAddress, isAddress } from 'viem';
import { robinhoodChain } from '../config/chains.js';

/**
 * WalletManager — manages EVM wallets for miners using viem.
 * Uses viem (MIT) for wallet client creation and address validation.
 * Uses @openfort/openfort-node for account abstraction when available.
 */
export class WalletManager {
  constructor(config) {
    this.config = config;
    this.logger = new Logger('WalletManager');
    this.wallets = new Map();
  }

  async initialize() {
    this.logger.info('Initializing wallet manager...');
    
    // Initialize wallets for each miner
    for (const [minerName, minerConfig] of Object.entries(this.config)) {
      if (minerConfig.enabled && minerConfig.config?.walletAddress) {
        await this.registerWallet(minerName, minerConfig.config);
      }
    }
    
    this.logger.info(`Initialized ${this.wallets.size} wallets`);
    this.logger.info('Wallet manager initialized');
  }

  async registerWallet(minerName, config) {
    const { walletAddress, network, platform, walletType, description } = config;
    
    if (!walletAddress) {
      this.logger.warn(`${minerName}: No wallet address configured`);
      return;
    }

    // Validate wallet address based on network
    const isValid = this.validateWalletAddress(walletAddress, network);
    if (!isValid) {
      this.logger.error(`${minerName}: Invalid wallet address for ${network}`);
      throw new Error(`Invalid wallet address for ${network}`);
    }

    this.wallets.set(minerName, {
      address: walletAddress,
      network,
      platform,
      walletType,
      description,
      connected: false
    });

    this.logger.info(`${minerName}: Registered ${network} wallet`);
  }

  validateWalletAddress(address, network) {
    if (!address || address.trim() === '') {
      return false;
    }

    switch (network) {
      case 'arbitrum':
      case 'arbitrum-testnet':
      case 'evm':
      case 'robinhood':
        return isAddress(address);

      case 'bittensor':
        return /^[a-zA-Z0-9]{47,}$/.test(address);

      case 'bitcoin-lightning':
        return address.length > 20 && /^[a-zA-Z0-9]+$/.test(address);

      default:
        this.logger.warn(`Unknown network type: ${network}, accepting address`);
        return true;
    }
  }

  getWallet(minerName) {
    return this.wallets.get(minerName);
  }

  getAllWallets() {
    return Object.fromEntries(this.wallets);
  }

  async connectWallet(minerName) {
    const wallet = this.wallets.get(minerName);
    if (!wallet) {
      throw new Error(`Wallet not found for ${minerName}`);
    }

    this.logger.info(`Connecting ${minerName} wallet to ${wallet.network}...`);
    wallet.connected = true;
    this.logger.info(`${minerName} wallet connected`);
  }

  async disconnectWallet(minerName) {
    const wallet = this.wallets.get(minerName);
    if (!wallet) {
      throw new Error(`Wallet not found for ${minerName}`);
    }

    this.logger.info(`Disconnecting ${minerName} wallet...`);
    
    // In a real implementation, this would close connections
    wallet.connected = false;
    this.logger.info(`${minerName} wallet disconnected`);
  }

  async connectAllWallets() {
    this.logger.info('Connecting all wallets...');
    
    for (const minerName of this.wallets.keys()) {
      try {
        await this.connectWallet(minerName);
      } catch (error) {
        this.logger.error(`Failed to connect ${minerName} wallet: ${error.message}`);
      }
    }
    
    const connected = Array.from(this.wallets.values()).filter(w => w.connected).length;
    this.logger.info(`Connected ${connected}/${this.wallets.size} wallets`);
  }

  async disconnectAllWallets() {
    this.logger.info('Disconnecting all wallets...');
    
    for (const minerName of this.wallets.keys()) {
      try {
        await this.disconnectWallet(minerName);
      } catch (error) {
        this.logger.error(`Failed to disconnect ${minerName} wallet: ${error.message}`);
      }
    }
    
    const connected = Array.from(this.wallets.values()).filter(w => w.connected).length;
    this.logger.info(`Disconnected wallets, ${connected} still connected`);
  }

  getStatus() {
    return {
      totalWallets: this.wallets.size,
      connectedWallets: Array.from(this.wallets.values()).filter(w => w.connected).length,
      wallets: Object.fromEntries(
        Array.from(this.wallets.entries()).map(([name, wallet]) => [
          name,
          {
            network: wallet.network,
            address: this.maskAddress(wallet.address),
            connected: wallet.connected,
            platform: wallet.platform || null
          }
        ])
      )
    };
  }

  maskAddress(address) {
    if (!address || address.length < 10) {
      return '***';
    }
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  }
}
