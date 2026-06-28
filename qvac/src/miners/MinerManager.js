import { Logger } from '../core/Logger.js';
import { ChutesMiner } from './ChutesMiner.js';
import { RoutstrMiner } from './RoutstrMiner.js';
import { CasperEscrowBridge } from './CasperEscrowBridge.js';

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
    if (this.config.chutes.enabled) {
      const miner = new ChutesMiner(this.config.chutes.config, this.inferenceLayer, this.evmAddress);
      await miner.initialize();
      this.miners.set('chutes', miner);
    }

    if (this.config.routstr.enabled) {
      const miner = new RoutstrMiner(this.config.routstr.config, this.inferenceLayer, this.evmAddress);
      await miner.initialize();
      this.miners.set('routstr', miner);
    }

    if (this.config.casper?.enabled) {
      const miner = new CasperEscrowBridge(this.config.casper.config, this.inferenceLayer);
      await miner.initialize();
      this.miners.set('casper', miner);
    }

    if (this.config.casperUnified?.enabled) {
      const layers = {
        inference: this.inferenceLayer,
        compute: this.config.casperUnified.config?.computeLayer || null,
        bandwidth: this.config.casperUnified.config?.bandwidthLayer || null,
      };
      const { CasperUnifiedBridge } = await import('./CasperUnifiedBridge.js');
      const miner = new CasperUnifiedBridge(this.config.casperUnified.config, layers);
      await miner.initialize();
      this.miners.set('casperUnified', miner);
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
