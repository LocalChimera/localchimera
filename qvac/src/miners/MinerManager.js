import { Logger } from '../core/Logger.js';
import { SdkProviderMiner } from './SdkProviderMiner.js';
import { GenericProcessProvider } from '../../../sdk/src/miners/GenericProcessProvider.js';
import { BtfsStorageProvider } from '../../../sdk/src/miners/BtfsStorageProvider.js';

export class MinerManager {
  constructor(config, dataStore, taskMonitor = null, inferenceLayer = null) {
    this.config = config;
    this.dataStore = dataStore;
    this.taskMonitor = taskMonitor;
    this.inferenceLayer = inferenceLayer;
    this.logger = new Logger('MinerManager');
    this.miners = new Map();
    this.currentMiner = null;
    this.isRunning = false;
    this.switchInterval = null;
    this.parallelMode = config.parallelMode || false;
    this.evmAddress = config.evmAddress || null;
  }

  async initialize() {
    this.logger.info('Initializing miner manager...');
    if (this.evmAddress) {
      this.logger.info(`EVM address configured: ${this.evmAddress.slice(0, 10)}...`);
    }

    // Initialize miners based on config

    // ─── Provider definitions (config-driven, replaces 8 individual provider classes) ───
    const PROVIDER_DEFS = {
      golem: {
        mode: 'process',
        binary: 'yagna',
        dockerImage: 'golemprovider/golem-provider:latest',
        dockerName: 'golem-provider',
        dockerArgs: ['-v', '/var/run/docker.sock:/var/run/docker.sock'],
        inlineArgs: ['service', 'run'],
        envVars: { GOLEM_SUBNET: this.config.golem?.config?.subnet || 'public' },
        requires: ['docker'],
        resources: 'CPU + optional GPU',
      },
      mysterium: {
        mode: 'process',
        binary: 'myst',
        dockerImage: 'mysteriumnetwork/myst:latest',
        dockerName: 'mysterium-node',
        dockerArgs: ['--cap-add', 'NET_ADMIN', '-p', '5252:5252'],
        inlineArgs: ['service', '--agreed-terms-and-conditions', '--data-dir', ''],
        requires: ['docker'],
        resources: 'Bandwidth (VPN relay)',
      },
      'anyone-protocol': {
        mode: 'process',
        binary: 'anyone-relay',
        dockerImage: 'anyoneprotocol/relay:latest',
        dockerName: 'anyone-relay',
        dockerArgs: ['-p', '9001:9001'],
        inlineArgs: ['--port', '9001'],
        requires: ['docker'],
        resources: 'Bandwidth + CPU',
        rewardToken: 'ANYONE',
        rewardChain: 'ethereum',
      },
      'btt-ai': {
        mode: 'process',
        binary: 'miner-cli',
        inlineArgs: ['up', '-f', ''],
        requires: ['nvidia-smi', 'python3'],
        requiresDir: false,
        startupTimeout: 10000,
        resources: 'GPU required (NVIDIA)',
      },
      sentinel: {
        mode: 'api',
        requires: ['apiKey'],
        resources: 'Bandwidth relay (WebRTC + WireGuard)',
      },
      spheron: {
        mode: 'api',
        requires: ['apiKey'],
        resources: 'Consumer GPU compute (Fizz Nodes)',
      },
      crust: {
        mode: 'api',
        apiUrl: 'https://api.crust.network',
        requiresDir: false,
        resources: 'IPFS pinning + storage incentive layer',
      },
      infernet: {
        mode: 'api',
        apiUrl: 'https://api.infernet.protocol',
        requires: ['apiKey'],
        requiresDir: false,
        resources: 'Open inference (Ollama/vLLM, any-token payments)',
      },
    };

    for (const [name, def] of Object.entries(PROVIDER_DEFS)) {
      if (this.config[name]?.enabled) {
        const cfg = { ...def, ...(this.config[name].config || {}) };
        const provider = new GenericProcessProvider(name, cfg);
        const miner = new SdkProviderMiner(name, null, cfg, this.inferenceLayer, this.evmAddress);
        miner.provider = provider;
        await miner.initialize();
        this.miners.set(name, miner);
      }
    }

    // BTFS has its own complex provider class (daemon, RPC, on-chain jobs)
    if (this.config.btfs?.enabled) {
      const btfsConfig = { ...(this.config.btfs.config || {}) };
      if (this._topConfig?.btfs) {
        Object.assign(btfsConfig, this._topConfig.btfs);
      }
      const miner = new SdkProviderMiner('btfs', BtfsStorageProvider, btfsConfig, this.inferenceLayer, this.evmAddress);
      await miner.initialize();
      this.miners.set('btfs', miner);
    }

    this.logger.info(`Initialized ${this.miners.size} miners`);
    this.logger.info('Miner manager initialized');
  }
  
  async start() {
    this.logger.info('Starting miner manager...');
    
    if (this.parallelMode) {
      this.logger.info('Starting in parallel monitoring mode...');
      await this.startParallelMonitoring();
    } else {
      // Start miner switching logic
      this.startMinerSwitching();
    }
    
    this.isRunning = true;
    this.logger.info('Miner manager started');
  }
  
  async stop() {
    this.logger.info('Stopping miner manager...');
    
    if (this.parallelMode) {
      // Stop all miners in parallel mode
      for (const [name, miner] of this.miners) {
        await miner.stop();
      }
    } else {
      // Stop current miner
      if (this.currentMiner) {
        await this.currentMiner.stop();
        this.currentMiner = null;
      }
      
      // Stop switching interval
      if (this.switchInterval) {
        clearInterval(this.switchInterval);
      }
    }
    
    this.isRunning = false;
    this.logger.info('Miner manager stopped');
  }
  
  async startParallelMonitoring() {
    this.logger.info('Starting parallel monitoring mode...');
    
    // Register miners with task monitor for immediate inference detection
    if (this.taskMonitor) {
      for (const [name, miner] of this.miners) {
        this.taskMonitor.registerMinerListener((notification) => {
          if (notification.type === 'inference-task') {
            this.logger.info(`Miner ${name} detected inference task: ${notification.taskId}`);
            miner.onInferenceTask(notification.task);
          }
        });
      }
    }
    
    // Start all miners in monitoring mode
    for (const [name, miner] of this.miners) {
      await miner.startMonitoring();
      this.logger.info(`Started ${name} in monitoring mode`);
    }
    
    this.logger.info('All miners running in parallel monitoring mode');
  }
  
  startMinerSwitching() {
    this.logger.info('Starting miner switching logic...');
    
    let currentIndex = 0;
    
    const switchMiner = async () => {
      if (!this.isRunning) return;
      
      const priority = this.config.priority.filter(m => this.miners.has(m));
      
      if (priority.length === 0) {
        this.logger.warn('No enabled miners');
        return;
      }
      
      const minerName = priority[currentIndex % priority.length];
      currentIndex++;
      
      await this.switchToMiner(minerName);
    };
    
    // Switch miners at configured interval
    this.switchInterval = setInterval(switchMiner, this.config.switchInterval).unref();
    
    // Start first miner immediately
    switchMiner();
  }
  
  async switchToMiner(minerName) {
    if (this.currentMiner && this.currentMiner.name === minerName) {
      return;
    }
    
    this.logger.info(`Switching to miner: ${minerName}`);
    
    // Stop current miner
    if (this.currentMiner) {
      await this.currentMiner.stop();
      await this.dataStore.append({
        type: 'miner-stop',
        miner: this.currentMiner.name,
        timestamp: Date.now()
      });
    }
    
    // Start new miner
    const miner = this.miners.get(minerName);
    if (miner) {
      await miner.start();
      this.currentMiner = miner;
      
      await this.dataStore.append({
        type: 'miner-start',
        miner: minerName,
        timestamp: Date.now()
      });
      
      this.logger.info(`Now running: ${minerName}`);
    }
  }
  
  getStatus() {
    return {
      running: this.isRunning,
      currentMiner: this.currentMiner?.name || null,
      availableMiners: Array.from(this.miners.keys()),
      minerStatus: Object.fromEntries(
        Array.from(this.miners.entries()).map(([name, miner]) => [
          name,
          miner.getStatus()
        ])
      )
    };
  }
}
