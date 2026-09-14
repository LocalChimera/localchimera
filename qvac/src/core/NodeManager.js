import { Logger } from './Logger.js';
import { AuditLogger } from './AuditLogger.js';
import { ContentAddress } from './ContentAddress.js';
import { DeploymentLifecycle } from './DeploymentLifecycle.js';
import { promises as fsp } from 'fs';
import path from 'path';
import Docker from 'dockerode';
import { QVACInferenceLayer } from '../inference/QVACInferenceLayer.js';
import { ProofOfInference } from '../inference/ProofOfInference.js';
import { InferenceQueue } from '../inference/InferenceQueue.js';
import { CircuitBreakerManager as CircuitBreaker } from '../inference/CircuitBreaker.js';
import { ModelRegistry } from '../inference/ModelRegistry.js';
import { SLAEnforcer } from '../inference/SLAEnforcer.js';
import { EscrowChannel } from '../inference/EscrowChannel.js';
import { HypercoreStore } from '../storage/HypercoreStore.js';
import { CryptoVault } from '../storage/CryptoVault.js';
import { ContentPinner } from '../p2p/ContentPinner.js';
import { PearP2P } from '../p2p/PearP2P.js';
import { CapabilityManifest } from '../p2p/CapabilityManifest.js';
import { PeerReputation } from '../p2p/PeerReputation.js';
import { MinerManager } from '../miners/MinerManager.js';
import { AuthService } from '../auth/AuthService.js';
import { InferenceApiKeyManager } from '../auth/InferenceApiKeyManager.js';
import { InferenceAccessManager } from '../auth/InferenceAccessManager.js';
import { TaskMonitor } from '../scheduler/TaskMonitor.js';
import { WebServer } from '../web/server.js';
import { WalletManager } from './WalletManager.js';
import { MultisigManager } from './MultisigManager.js';
import { MonthlyDistributor } from '../payout/MonthlyDistributor.js';
import { EmbeddingService } from '../inference/EmbeddingService.js';
import { VoicePipeline } from '../inference/VoicePipeline.js';
import { VisionCaptioner } from '../inference/VisionCaptioner.js';
import { SemanticDedup } from '../inference/SemanticDedup.js';
import { LocalLLM } from '../inference/LocalLLM.js';
import { AgentLoop } from '../inference/AgentLoop.js';
import { DocumentChunker } from '../inference/DocumentChunker.js';
import { MemoryManager } from '../inference/MemoryManager.js';
import { HybridRetriever } from '../inference/HybridRetriever.js';
import { TaskDecomposer } from '../inference/TaskDecomposer.js';
import { ConversationBrancher } from '../inference/ConversationBrancher.js';
import { AutoTagger } from '../inference/AutoTagger.js';
import { ConversationExporter } from '../inference/ConversationExporter.js';
import { ConfidenceRouter } from '../inference/ConfidenceRouter.js';
import { SpendPolicy } from '../inference/SpendPolicy.js';
import { MemoryExtractor } from '../inference/MemoryExtractor.js';
import { MemoryCompactor } from '../inference/MemoryCompactor.js';
import { KnowledgeGraph } from '../inference/KnowledgeGraph.js';
import { AutoLinker } from '../inference/AutoLinker.js';
import { CitationRegistry } from '../inference/CitationRegistry.js';
import { MCPClient } from '../inference/MCPClient.js';
import { CapabilityProber } from '../inference/CapabilityProber.js';
import { ToolResultCache } from '../inference/ToolResultCache.js';
import { LinkMetadataCache } from '../inference/LinkMetadataCache.js';
import { EvidenceExporter } from '../inference/EvidenceExporter.js';
import { ReceiptGossip } from '../inference/ReceiptGossip.js';
import { MarketplaceBroadcaster } from '../inference/MarketplaceBroadcaster.js';
import { DynamicPricing } from '../inference/DynamicPricing.js';
import { PromptGuard } from '../inference/PromptGuard.js';
import { PromptBudgeter } from '../inference/PromptBudgeter.js';
import { TokenMeter } from '../inference/TokenMeter.js';
import { EnrichmentQueue } from '../inference/EnrichmentQueue.js';
import { EscrowRegistrar } from '../inference/EscrowRegistrar.js';
import { InferenceRouter } from '../inference/InferenceRouter.js';
import { marketApi } from '../api/marketApi.js';
import { CHIMERA_CONTRACTS } from '../config/chains.js';

export class NodeManager {
  constructor(config) {
    this.config = config;
    this.logger = new Logger('NodeManager');
    this.inferenceLayer = null;
    this.localLLM = null;
    this.embeddingService = null;
    this.dataStore = null;
    this.p2pNetwork = null;
    this.minerManager = null;
    this.authService = null;
    this.taskMonitor = null;
    this.webServer = null;
    this.walletManager = null;
    this.multisigManager = null;
    this.monthlyDistributor = null;
    // New modules
    this.proofOfInference = null;
    this.inferenceQueue = null;
    this.promptGuard = null;
    this.promptBudgeter = null;
    this.tokenMeter = null;
    this.voicePipeline = null;
    this.agentLoop = null;
    this.documentChunker = null;
    this.citationRegistry = null;
    this.contentAddress = null;
    this.capabilityManifest = null;
    this.deploymentLifecycle = null;
    this.circuitBreaker = null;
    this.peerReputation = null;
    this.memoryCompactor = null;
    this.knowledgeGraph = null;
    this.cryptoVault = null;
    this.receiptGossip = null;
    this.dynamicPricing = null;
    this.modelRegistry = null;
    this.toolResultCache = null;
    this.semanticDedup = null;
    this.slaEnforcer = null;
    this.contentPinner = null;
    this.taskDecomposer = null;
    this.conversationBrancher = null;
    this.autoTagger = null;
    this.conversationExporter = null;
    this.confidenceRouter = null;
    this.spendPolicy = null;
    this.escrowChannel = null;
    this.memoryManager = null;
    this.hybridRetriever = null;
    this.enrichmentQueue = null;
    this.linkMetadataCache = null;
    this.visionCaptioner = null;
    this.evidenceExporter = null;
    this.mcpClient = null;
    this.autoLinker = null;
    this.capabilityProber = null;
    this.marketplaceBroadcaster = null;
    this.memoryExtractor = null;
    this.escrowRegistrar = null;
    this.docker = null;
    this.inferenceApiKeyManager = null;
    this.inferenceAccessManager = null;
    this.isRunning = false;
    this.privacyMode = this.config.node?.privacyMode === true || process.env.CHIMERA_PRIVACY_MODE === 'true';
    this.anonymizeId = this.config.node?.anonymizeId === true || process.env.CHIMERA_ANONYMIZE_ID === 'true';
    this._anonymousId = this._generateAnonymousId();

    // v2 tokenomics: CHIMERA staking state for this node
    this.chimeraStakingEnabled = this.config.chimeraStaking?.enabled !== false;
    this.providerStakeStatus = null; // populated after initialize()
    this.providerPremiumStatus = null;
    this.requireStakeForRegistration = this.config.chimeraStaking?.requireStakeForRegistration !== false;
  }

  _generateAnonymousId() {
    return `anon-${Math.random().toString(36).substring(2, 10)}-${Math.random().toString(36).substring(2, 10)}`;
  }

  _displayNodeId() {
    if (this.privacyMode || this.anonymizeId) return this._anonymousId;
    return this.config.node?.id || 'unknown';
  }

  async initialize() {
    this.logger.info('Initializing node components...');

    // Initialize Docker client for container-based deployments
    try {
      this.docker = new Docker();
      this.logger.info('Docker client initialized (dockerode)');
    } catch (e) {
      this.logger.warn(`Docker not available: ${e.message}`);
      this.docker = null;
    }

    this.audit = new AuditLogger(this.config.audit || {});
    this.authService = new AuthService(this.config.auth);
    await this.authService.initialize();

    this.dataStore = new HypercoreStore(this.config.p2p?.hypercore);
    await this.dataStore.initialize();

    if (this.config.p2p?.enabled !== false) {
      this.p2pNetwork = new PearP2P(this.config.p2p.pear);
      await this.p2pNetwork.initialize();
    } else {
      this.logger.info('P2P swarm disabled (privacy/SDK mode)');
    }

    if (this.config.multisig?.enabled) {
      this.multisigManager = new MultisigManager(this.config.multisig);
      await this.multisigManager.initialize();
      const msStatus = this.multisigManager.getStatus();
      this.logger.info(`Protocol multisig system active: ${Object.keys(msStatus.protocolMultisigs).length} multisigs`);
    }

    this.walletManager = new WalletManager(this.config.miners);
    await this.walletManager.initialize();

    this.taskMonitor = new TaskMonitor();
    await this.taskMonitor.initialize();

    this.inferenceLayer = new QVACInferenceLayer(this.config.inference, this.taskMonitor, this.audit);
    await this.inferenceLayer.initialize();

    this.minerManager = new MinerManager(this.config.miners, this.dataStore, this.taskMonitor, this.inferenceLayer);
    this.minerManager._topConfig = this.config;
    await this.minerManager.initialize();

    // Initialize retained modules
    this.proofOfInference = new ProofOfInference(this.config.proofOfInference || {});
    this.inferenceQueue = new InferenceQueue(this.config.inference?.queue || {});
    this.circuitBreaker = new CircuitBreaker(this.config.circuitBreaker || {});
    this.contentAddress = new ContentAddress(this.config.contentAddress || {});
    this.capabilityManifest = new CapabilityManifest(this.config.capabilityManifest || {});
    this.deploymentLifecycle = new DeploymentLifecycle(this.config.deploymentLifecycle || {});
    this.peerReputation = new PeerReputation(this.config.peerReputation || {});
    this.peerReputation.start();
    this.cryptoVault = new CryptoVault(this.config.cryptoVault || {});
    this.modelRegistry = new ModelRegistry(this.config.modelRegistry || {});
    this.slaEnforcer = new SLAEnforcer(this.config.slaEnforcer || {});
    this.contentPinner = new ContentPinner(this.config.contentPinner || {});
    if (this.p2pNetwork) {
      this.contentPinner.setP2P(this.p2pNetwork);
      this.contentPinner.setCryptoVault(this.cryptoVault);
      this.contentPinner.start();
    }
    this.escrowChannel = new EscrowChannel(this.config.escrowChannel || {});
    this.escrowChannel.setWalletManager(this.walletManager);

    // Register known models in registry
    const qvacCfg = this.config.inference?.qvac || {};
    if (qvacCfg.models) {
      for (const modelName of qvacCfg.models) {
        this.modelRegistry.register({
          name: modelName,
          type: 'llm',
          contextLength: 4096,
          quantization: 'q4_0',
          modelConst: qvacCfg.modelConst,
        });
      }
    }
    if (this.config.inference?.embedding?.model) {
      this.modelRegistry.register({
        name: this.config.inference.embedding.model,
        type: 'embedding',
        contextLength: 2048,
        quantization: 'q4_0',
        modelConst: this.config.inference.embedding.qvacModelConst,
      });
    }
    if (this.config.voicePipeline?.whisperModel) {
      this.modelRegistry.register({
        name: this.config.voicePipeline.whisperModel,
        type: 'stt',
        contextLength: 0,
        quantization: 'q5_1',
      });
    }

    // Inject inference queue into inference layer for serialized execution
    this.inferenceLayer.setQueue(this.inferenceQueue);
    this.inferenceLayer.setProofOfInference(this.proofOfInference);
    this.inferenceLayer.setCircuitBreaker(this.circuitBreaker);

    this.webServer = new WebServer(this.config, this);
    await this.webServer.initialize();

    this.monthlyDistributor = new MonthlyDistributor(this.webServer.payoutRouter);

    this.inferenceApiKeyManager = new InferenceApiKeyManager();
    await this.inferenceApiKeyManager.initialize();

    this.inferenceAccessManager = new InferenceAccessManager({
      escrowChannel: this.escrowChannel,
    });
    this.logger.info('Inference access manager initialized (paid session tokens)');

    // Initialize OSS-backed modules (Phase A1)
    this.embeddingService = new EmbeddingService(this.config.inference?.embedding || {});
    this.localLLM = new LocalLLM(this.config.inference?.localLLM || {});
    this.voicePipeline = new VoicePipeline(this.config.voicePipeline || {});
    this.visionCaptioner = new VisionCaptioner(this.config.visionCaptioner || {});
    this.semanticDedup = new SemanticDedup(this.config.semanticDedup || {});
    this.promptGuard = new PromptGuard(this.config.promptGuard || {});
    this.promptBudgeter = new PromptBudgeter(this.config.promptBudgeter || {});
    this.tokenMeter = new TokenMeter(this.config.tokenMeter || {});
    this.agentLoop = new AgentLoop(this.config.agentLoop || {});
    this.documentChunker = new DocumentChunker(this.config.documentChunker || {});
    this.memoryManager = new MemoryManager(this.config.memoryManager || {});
    this.hybridRetriever = new HybridRetriever(this.config.hybridRetriever || {});
    this.taskDecomposer = new TaskDecomposer(this.config.taskDecomposer || {});
    this.conversationBrancher = new ConversationBrancher(this.config.conversationBrancher || {});
    this.autoTagger = new AutoTagger(this.config.autoTagger || {});
    this.conversationExporter = new ConversationExporter(this.config.conversationExporter || {});
    this.confidenceRouter = new ConfidenceRouter(this.config.confidenceRouter || {});
    this.spendPolicy = new SpendPolicy(this.config.spendPolicy || {});
    this.memoryExtractor = new MemoryExtractor(this.config.memoryExtractor || {});
    this.memoryCompactor = new MemoryCompactor(this.config.memoryCompactor || {});
    this.knowledgeGraph = new KnowledgeGraph(this.config.knowledgeGraph || {});
    this.citationRegistry = new CitationRegistry(this.config.citationRegistry || {});
    this.autoLinker = new AutoLinker(this.config.autoLinker || {});
    this.mcpClient = new MCPClient(this.config.mcpClient || {});
    this.capabilityProber = new CapabilityProber(this.config.capabilityProber || {});
    this.toolResultCache = new ToolResultCache(this.config.toolResultCache || {});
    this.linkMetadataCache = new LinkMetadataCache(this.config.linkMetadataCache || {});
    this.evidenceExporter = new EvidenceExporter(this.config.evidenceExporter || {});
    this.receiptGossip = new ReceiptGossip(this.config.receiptGossip || {});
    this.marketplaceBroadcaster = new MarketplaceBroadcaster(this.config.marketplaceBroadcaster || {});
    this.dynamicPricing = new DynamicPricing(this.config.dynamicPricing || {});
    this.enrichmentQueue = new EnrichmentQueue(this.config.enrichmentQueue || {});
    this.escrowRegistrar = new EscrowRegistrar(this.config.escrowRegistrar || {});
    this.inferenceRouter = new InferenceRouter(this.config.inferenceRouter || {});

    // Wire modules that need P2P
    if (this.p2pNetwork) {
      this.receiptGossip.initialize({ p2p: this.p2pNetwork });
      this.marketplaceBroadcaster.initialize({ p2p: this.p2pNetwork });
    }

    // Wire knowledge graph to auto-linker
    this.autoLinker.initialize({ knowledgeGraph: this.knowledgeGraph });

    // Inject modules into inference layer
    this.inferenceLayer.setPromptGuard(this.promptGuard);
    this.inferenceLayer.setPromptBudgeter(this.promptBudgeter);
    this.inferenceLayer.setTokenMeter(this.tokenMeter);

    this.logger.info('All 31 OSS-backed modules initialized: EmbeddingService, LocalLLM, VoicePipeline, VisionCaptioner, SemanticDedup, PromptGuard, PromptBudgeter, TokenMeter, AgentLoop, DocumentChunker, MemoryManager, HybridRetriever, TaskDecomposer, ConversationBrancher, AutoTagger, ConversationExporter, ConfidenceRouter, SpendPolicy, MemoryExtractor, MemoryCompactor, KnowledgeGraph, CitationRegistry, AutoLinker, MCPClient, CapabilityProber, ToolResultCache, LinkMetadataCache, EvidenceExporter, ReceiptGossip, MarketplaceBroadcaster, DynamicPricing, EnrichmentQueue, EscrowRegistrar, InferenceRouter');

    // v2 tokenomics: fetch this provider's staking and premium status
    if (this.chimeraStakingEnabled) {
      await this.refreshStakingStatus();
    }
  }

  /**
   * v2 tokenomics: Refresh this node's CHIMERA staking and premium status from
   * the ChimeraStaking contract. Called during initialize() and periodically.
   */
  async refreshStakingStatus() {
    if (!this.chimeraStakingEnabled) return;
    const providerAddress = this.config.chimeraStaking?.providerAddress
      || this.walletManager?.getAddress?.()
      || this.config.node?.evmAddress;
    if (!providerAddress) {
      this.logger.warn('CHIMERA staking: no provider address configured');
      this.providerStakeStatus = null;
      this.providerPremiumStatus = null;
      return;
    }
    try {
      this.providerStakeStatus = await marketApi.getStakeInfo(providerAddress);
      this.providerPremiumStatus = await marketApi.getPremiumStatus(providerAddress);
      this.logger.info(`CHIMERA staking status: staked=${this.providerStakeStatus.staked} weight=${this.providerStakeStatus.weight} lockMult=${this.providerStakeStatus.lockMultiplier}`);
      this.logger.info(`CHIMERA premium: priority=${this.providerPremiumStatus.priorityRouting} throughput=${this.providerPremiumStatus.higherThroughput} customPricing=${this.providerPremiumStatus.customPricing}`);
    } catch (e) {
      this.logger.warn(`CHIMERA staking status unavailable: ${e.message}`);
      this.providerStakeStatus = null;
      this.providerPremiumStatus = null;
    }
  }

  /**
   * v2 tokenomics: Check whether this provider is allowed to register as Tier 1.
   * If requireStakeForRegistration is true, the provider must have at least the
   * minimum stake in ChimeraStaking.
   */
  async checkProviderStakeEligibility() {
    if (!this.chimeraStakingEnabled || !this.requireStakeForRegistration) {
      return { eligible: true, tier: 'tier1', reason: 'staking not required' };
    }
    if (!this.providerStakeStatus) {
      await this.refreshStakingStatus();
    }
    if (!this.providerStakeStatus) {
      return { eligible: false, tier: 'tier2', reason: 'staking status unavailable' };
    }
    const staked = BigInt(this.providerStakeStatus.staked || '0');
    if (staked > 0n) {
      return { eligible: true, tier: 'tier1', reason: 'staked', staked: this.providerStakeStatus.staked };
    }
    return { eligible: false, tier: 'tier2', reason: 'no stake — Tier 2 only' };
  }

  /**
   * v2 tokenomics: Get the provider's premium status for routing decisions.
   */
  getPremiumStatus() {
    return this.providerPremiumStatus || { priorityRouting: false, higherThroughput: false, customPricing: false };
  }

  /**
   * v2 tokenomics: Get the provider's staking tier (1 or 2).
   */
  getProviderTier() {
    if (!this.providerStakeStatus) return 2;
    return BigInt(this.providerStakeStatus.staked || '0') > 0n ? 1 : 2;
  }
  
  async start() {
    if (this.isRunning) {
      this.logger.warn('Node is already running');
      return;
    }
    
    this.logger.info('Starting node...');
    
    // Start data store
    await this.dataStore.start();
    
    // Start P2P network only when enabled
    if (this.p2pNetwork) {
      await this.p2pNetwork.start();

      this.p2pNetwork.onMessage('wiki-sync', async (msg, peerId) => {
      if (msg.type !== 'wiki-new-page') return;

      const swarmScope = msg._swarmScope || 'wiki';
      const msgPageId = msg._pageId || `${msg.category}/${msg.fileName}`;
      if (swarmScope === 'page') {
        const pageTopics = this.p2pNetwork.getTopicsByScope('page', msgPageId);
        if (pageTopics.length === 0) {
          this.logger.debug(`[swarm] Ignoring page-scoped message for ${msgPageId} — not in swarm`);
          return;
        }
      }

      this.logger.info(`[swarm] Received wiki page from peer ${peerId}: ${msg.title} (scope: ${swarmScope})`);
      const { title, category = 'concepts', content, tags = [] } = msg;
      try {
        const slug = (title || 'untitled').toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const fileName = `${slug || 'untitled'}.md`;
        const conceptId = `${category}/${slug || 'untitled'}`;
        const today = new Date().toISOString().split('T')[0];
        const wikiDir = path.join(process.cwd(), 'llmwiki-data', 'wiki', category);
        await fsp.mkdir(wikiDir, { recursive: true });
        const filePath = path.join(wikiDir, fileName);
        const frontmatter = `---\nid: ${conceptId}\ntitle: ${title}\ndescription: AI-generated wiki page\ntags: ${JSON.stringify(tags)}\ncreated: ${today}\nmodified: ${today}\n---\n\n`;
        await fsp.writeFile(filePath, frontmatter + (content || ''), 'utf-8');
        this.logger.info(`[swarm] Saved ${filePath}`);
        if (this.webServer?.indexer) await this.webServer.indexer.index();
      } catch (e) {
        this.logger.error(`[swarm] Failed to save incoming page: ${e.message}`);
      }
    });
    }

    // Connect wallet manager
    await this.walletManager.connectAllWallets();
    
    // Start task monitor
    await this.taskMonitor.start();
    
    // Start inference layer
    await this.inferenceLayer.start();

    // Start embedding service (loads model on first use)
    await this.embeddingService.start();

    // Start OSS-backed modules
    await this.promptGuard.start();
    await this.promptBudgeter.start();
    await this.tokenMeter.start();
    await this.documentChunker.start();
    await this.memoryManager.start();
    await this.taskDecomposer.start();
    await this.conversationBrancher.start();
    await this.autoTagger.start();
    await this.conversationExporter.start();
    await this.confidenceRouter.start();
    await this.spendPolicy.start();
    await this.memoryExtractor.start();
    await this.memoryCompactor.start();
    await this.knowledgeGraph.start();
    await this.citationRegistry.start();
    await this.toolResultCache.start();
    await this.linkMetadataCache.start();
    await this.evidenceExporter.start();
    await this.enrichmentQueue.start();
    await this.inferenceRouter.start();
    await this.dynamicPricing.start();
    await this.escrowRegistrar.start();
    if (this.p2pNetwork) {
      await this.receiptGossip.start();
      await this.marketplaceBroadcaster.start();
    }
    await this.mcpClient.start();
    await this.capabilityProber.start();
    await this.semanticDedup.start();
    await this.visionCaptioner.start();
    await this.voicePipeline.start();
    await this.localLLM.start();
    await this.agentLoop.start();
    await this.autoLinker.start();

    // NOTE: Miners are initialized but NOT auto-started.
    // The user must explicitly start them via the frontend
    // (POST /api/start with their EVM wallet address) after the node is running.
    // this.minerManager.start() is called from handleStart in WebServer.
    this.logger.info('Miners initialized but not started — waiting for user wallet + consent');

    // Start web server for dashboard API
    await this.webServer.start();

    // Start monthly distributor
    this.monthlyDistributor.start();

    this.isRunning = true;
    this.logger.info(`Node started — ID: ${this._displayNodeId()} | API: http://localhost:${process.env.PORT || 3002}/api/status`);
  }
  
  async stop() {
    if (!this.isRunning) {
      return;
    }
    
    this.logger.info('Stopping node...');
    
    // Stop components in reverse order
    await this.webServer.stop();
    await this.audit.stop();
    await this.minerManager.stop();
    await this.embeddingService.stop?.();
    await this.inferenceLayer.stop();
    await this.taskMonitor.stop();
    await this.walletManager.disconnectAllWallets();
    if (this.p2pNetwork) await this.p2pNetwork.stop();
    await this.dataStore.stop();

    // Stop monthly distributor
    if (this.monthlyDistributor) this.monthlyDistributor.stop();

    // Stop inference queue
    if (this.inferenceQueue) this.inferenceQueue.reset();

    // Stop peer reputation decay timer
    if (this.peerReputation) this.peerReputation.stop();

    // Persist knowledge graph
    if (this.knowledgeGraph) this.knowledgeGraph.persist();

    // Stop OSS-backed modules
    if (this.toolResultCache) this.toolResultCache.stop();
    if (this.linkMetadataCache) this.linkMetadataCache.stop();
    if (this.enrichmentQueue) this.enrichmentQueue.stop();
    if (this.inferenceRouter) this.inferenceRouter.stop();
    if (this.dynamicPricing) this.dynamicPricing.stop();
    if (this.escrowRegistrar) this.escrowRegistrar.stop();
    if (this.receiptGossip) this.receiptGossip.stop();
    if (this.marketplaceBroadcaster) this.marketplaceBroadcaster.stop();
    if (this.mcpClient) this.mcpClient.stop();
    if (this.capabilityProber) this.capabilityProber.stop();
    if (this.semanticDedup) this.semanticDedup.stop();
    if (this.visionCaptioner) this.visionCaptioner.stop();
    if (this.voicePipeline) this.voicePipeline.stop();
    if (this.localLLM) this.localLLM.stop();
    if (this.agentLoop) this.agentLoop.stop();
    if (this.autoLinker) this.autoLinker.stop();
    if (this.promptGuard) this.promptGuard.stop();
    if (this.promptBudgeter) this.promptBudgeter.stop();
    if (this.tokenMeter) this.tokenMeter.stop();
    if (this.documentChunker) this.documentChunker.stop();
    if (this.memoryManager) this.memoryManager.stop();
    if (this.taskDecomposer) this.taskDecomposer.stop();
    if (this.conversationBrancher) this.conversationBrancher.stop();
    if (this.autoTagger) this.autoTagger.stop();
    if (this.conversationExporter) this.conversationExporter.stop();
    if (this.confidenceRouter) this.confidenceRouter.stop();
    if (this.spendPolicy) this.spendPolicy.stop();
    if (this.memoryExtractor) this.memoryExtractor.stop();
    if (this.memoryCompactor) this.memoryCompactor.stop();
    if (this.knowledgeGraph) this.knowledgeGraph.stop();
    if (this.citationRegistry) this.citationRegistry.stop();
    if (this.evidenceExporter) this.evidenceExporter.stop();

    // Stop timers
    if (this.contentPinner) this.contentPinner.stop();

    this.isRunning = false;
    this.logger.info('Node stopped successfully');
  }
  
  getStatus() {
    return {
      running: this.isRunning,
      nodeId: this._displayNodeId(),
      inference: this.inferenceLayer?.getStatus(),
      localLLM: this.localLLM?.getStatus(),
      embedding: this.embeddingService?.getStatus(),
      mining: this.minerManager?.getStatus(),
      tasks: this.taskMonitor?.getStatus(),
      p2p: this.p2pNetwork?.getStatus(),
      wallets: this.walletManager?.getStatus(),
      multisig: this.multisigManager?.getStatus(),
      // New modules
      proofOfInference: this.proofOfInference?.getStatus(),
      inferenceQueue: this.inferenceQueue?.getStats(),
      promptGuard: this.promptGuard?.getStats(),
      promptBudgeter: this.promptBudgeter?.getStatus(),
      tokenMeter: this.tokenMeter?.getStatus(),
      voicePipeline: this.voicePipeline?.getStatus(),
      agentLoop: this.agentLoop?.getStatus(),
      contentAddress: this.contentAddress?.getStats(),
      capabilityManifest: this.capabilityManifest?.getStatus(),
      deploymentLifecycle: this.deploymentLifecycle?.getStatus(),
      citations: this.citationRegistry?.getStats(),
      circuitBreaker: this.circuitBreaker?.getStatus(),
      peerReputation: this.peerReputation?.getStatus(),
      memoryCompactor: this.memoryCompactor?.getStats(),
      knowledgeGraph: this.knowledgeGraph?.getStats(),
      cryptoVault: this.cryptoVault?.getStats(),
      receiptGossip: this.receiptGossip?.getStats(),
      dynamicPricing: this.dynamicPricing?.getStats(),
      modelRegistry: this.modelRegistry?.getStats(),
      toolResultCache: this.toolResultCache?.getStats(),
      semanticDedup: this.semanticDedup?.getStats(),
      slaEnforcer: this.slaEnforcer?.getStats(),
      contentPinner: this.contentPinner?.getStats(),
      taskDecomposer: this.taskDecomposer?.getStats(),
      conversationBrancher: this.conversationBrancher?.getStats(),
      autoTagger: this.autoTagger?.getStats(),
      conversationExporter: this.conversationExporter?.getStats(),
      confidenceRouter: this.confidenceRouter?.getStats(),
      spendPolicy: this.spendPolicy?.getStats(),
      escrowChannel: this.escrowChannel?.getStats(),
      memoryManager: this.memoryManager?.getStats(),
      hybridRetriever: this.hybridRetriever?.getStats(),
      enrichmentQueue: this.enrichmentQueue?.getStats(),
      linkMetadataCache: this.linkMetadataCache?.getStats(),
      visionCaptioner: this.visionCaptioner?.getStats(),
      evidenceExporter: this.evidenceExporter?.getStats(),
      mcpClient: this.mcpClient?.getStats(),
      autoLinker: this.autoLinker?.getStats(),
      capabilityProber: this.capabilityProber?.getStats(),
      marketplaceBroadcaster: this.marketplaceBroadcaster?.getStats(),
      memoryExtractor: this.memoryExtractor?.getStats(),
    };
  }
}
