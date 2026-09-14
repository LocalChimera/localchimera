/**
 * Declarative route table.
 * Each entry: [method, pathname, handlerName]
 * Matched in order; first match wins.
 */
export const ROUTES = [
  // Core
  ['GET',  '/health',                 'handleHealth'],
  ['GET',  '/api/audit/logs',          'handleAuditLogs'],
  ['POST', '/api/audit/run',           'handleAuditRun'],
  ['POST', '/api/consent',            'handleConsent'],
  ['POST', '/api/signin',             'handleSignIn'],
  ['POST', '/api/signout',            'handleSignOut'],
  ['GET',  '/api/download',           'handleDownload'],
  ['GET',  '/api/status',             'handleStatus'],
  // AI Writer
  ['POST', '/api/ai-write',           'handleAIWrite'],
  ['GET',  '/api/ai-status',          'handleAIStatus'],
  ['GET',  '/api/ai-docs',            'handleAIDocs'],
  // Embedding + RAG (QVAC SDK)
  ['POST', '/api/embedding',          'handleEmbedding'],
  ['POST', '/api/rag-ingest',         'handleRagIngest'],
  ['POST', '/api/rag-search',         'handleRagSearch'],
  ['GET',  '/api/rag-workspaces',     'handleRagWorkspaces'],
  // LLM Wiki
  ['POST', '/api/llmwiki-create',     'handleLLMWikiCreate'],
  ['POST', '/api/llmwiki-upload',     'handleLLMWikiUpload'],
  ['POST', '/api/convert-to-md',      'handleConvertToMd'],
  ['POST', '/api/repo-to-md',          'handleRepoToMd'],
  ['POST', '/api/llmwiki-save',       'handleLLMWikiSave'],
  ['GET',  '/api/llmwiki-docs',       'handleLLMWikiDocs'],
  ['GET',  '/api/llmwiki-search',     'handleLLMWikiSearch'],
  ['GET',  '/api/llmwiki-graph',      'handleLLMWikiGraph'],
  ['DELETE', '/api/llmwiki-delete',   'handleLLMWikiDelete'],
  ['GET',  '/api/wiki-status',        'handleWikiStatus'],
  // Swarm
  ['POST', '/api/swarm/create',        'handleSwarmCreate'],
  ['POST', '/api/swarm/join',          'handleSwarmJoin'],
  ['GET',  '/api/swarm/status',        'handleSwarmStatus'],
  // Fleet Orchestrator
  ['POST', '/api/commander/register', 'handleCommanderRegister'],
  ['GET',  '/api/commander/workers',  'handleCommanderWorkers'],
  ['GET',  '/api/commander/stats',    'handleCommanderStats'],
  ['GET',  '/api/commander/jobs',     'handleCommanderJobs'],
  ['POST', '/api/commander/complete', 'handleCommanderComplete'],
  ['POST', '/api/commander/distribute','handleCommanderDistribute'],
  ['POST', '/api/commander/stop',     'handleCommanderStop'],
  ['POST', '/api/commander/start',    'handleCommanderStart'],
  ['POST', '/api/worker/stop',        'handleWorkerStop'],
  // Miner
  ['POST', '/api/start',              'handleStart'],
  ['POST', '/api/stop',               'handleStop'],
  ['POST', '/api/miner-test',         'handleMinerTest'],
  ['GET',  '/api/escrow/status',      'handleEscrowStatus'],
  // Device Attestation (browser-based fingerprinting from new.localchimera.com)
  ['POST', '/api/attest-device',      'handleAttestDevice'],
  // Remote Fingerprinting — loads code from new.localchimera.com, runs in VM sandbox
  ['POST', '/api/fingerprint',        'handleFingerprint'],
  // OpenAI-compatible proxy
  ['POST', '/v1/chat/completions',          'handleOpenAIChat'],
  ['GET',  '/v1/models',                   'handleOpenAIModels'],

  // Inference API Keys
  ['POST', '/api/inference-keys',           'handleInferenceKeyCreate'],
  ['GET',  '/api/inference-keys',           'handleInferenceKeyList'],
  ['DELETE', '/api/inference-keys/:id',     'handleInferenceKeyRevoke'],
  ['GET',  '/api/inference-keys/info',      'handleInferenceKeyInfo'],

  // Inference Access (paid session tokens)
  ['POST', '/api/inference-access/purchase',  'handleInferenceAccessPurchase'],
  ['GET',  '/api/inference-access/pricing',   'handleInferenceAccessPricing'],
  ['GET',  '/api/inference-access/status',    'handleInferenceAccessStatus'],
  ['GET',  '/api/inference-access/sessions',  'handleInferenceAccessSessions'],
  ['POST', '/api/inference-access/revoke',    'handleInferenceAccessRevoke'],

  // Inference Swarm
  ['POST', '/api/swarm/infer',             'handleSwarmInfer'],

  // Proof of Inference
  ['GET',  '/api/proof/status',            'handleProofStatus'],
  ['POST', '/api/proof/verify',            'handleProofVerify'],
  // Prompt Guard
  ['GET',  '/api/prompt-guard/status',     'handlePromptGuardStatus'],
  ['POST', '/api/prompt-guard/check',      'handlePromptGuardCheck'],
  // Token Meter
  ['GET',  '/api/meter/status',            'handleMeterStatus'],
  ['GET',  '/api/meter/sessions',          'handleMeterSessions'],
  ['POST', '/api/meter/settle',            'handleMeterSettle'],
  // Voice Pipeline
  ['POST', '/api/voice/transcribe',        'handleVoiceTranscribe'],
  ['GET',  '/api/voice/status',            'handleVoiceStatus'],
  // Agent Loop
  ['POST', '/api/agent/query',             'handleAgentQuery'],
  ['GET',  '/api/agent/tools',             'handleAgentTools'],
  // Document Chunker
  ['POST', '/api/chunk',                   'handleChunkDocuments'],
  // Content Address
  ['GET',  '/api/content/status',          'handleContentStatus'],
  ['POST', '/api/content/register',        'handleContentRegister'],
  ['POST', '/api/content/verify',          'handleContentVerify'],
  // Capability Manifest
  ['GET',  '/api/capability/status',       'handleCapabilityStatus'],
  ['POST', '/api/capability/create',       'handleCapabilityCreate'],
  ['GET',  '/api/capability/peers',        'handleCapabilityPeers'],
  // Deployment Lifecycle
  ['POST', '/api/deployment/create',       'handleDeploymentCreate'],
  ['GET',  '/api/deployment/list',         'handleDeploymentList'],
  ['GET',  '/api/deployment/:id',          'handleDeploymentGet'],
  ['GET',  '/api/deployment/:id/events',   'handleDeploymentEvents'],
  // Circuit Breaker
  ['GET',  '/api/circuit/status',          'handleCircuitStatus'],
  ['GET',  '/api/circuit/list',            'handleCircuitList'],
  ['POST', '/api/circuit/reset',           'handleCircuitReset'],
  // Peer Reputation
  ['GET',  '/api/reputation/status',       'handleReputationStatus'],
  ['GET',  '/api/reputation/peers',        'handleReputationPeers'],
  // Model Hot-Swap
  ['POST', '/api/model/switch',            'handleModelSwitch'],
  ['GET',  '/api/model/current',           'handleModelCurrent'],
  // Memory Compactor
  // Knowledge Graph
  ['GET',  '/api/kg/status',               'handleKGStatus'],
  ['GET',  '/api/kg/search',               'handleKGSearch'],
  ['GET',  '/api/kg/entity',               'handleKGEntity'],
  ['GET',  '/api/kg/subgraph',             'handleKGSubgraph'],
  ['POST', '/api/kg/ingest',               'handleKGIngest'],
  // Crypto Vault
  ['GET',  '/api/vault/status',            'handleVaultStatus'],
  ['POST', '/api/vault/encrypt',           'handleVaultEncrypt'],
  ['POST', '/api/vault/decrypt',           'handleVaultDecrypt'],
  // Receipt Gossip
  ['GET',  '/api/gossip/status',           'handleGossipStatus'],
  ['GET',  '/api/gossip/receipts',         'handleGossipReceipts'],
  ['POST', '/api/gossip/broadcast',        'handleGossipBroadcast'],
  // Dynamic Pricing
  ['GET',  '/api/pricing/status',          'handlePricingStatus'],
  ['GET',  '/api/pricing/history',         'handlePricingHistory'],
  // Model Registry
  ['GET',  '/api/registry/status',         'handleRegistryStatus'],
  ['GET',  '/api/registry/list',           'handleRegistryList'],
  ['POST', '/api/registry/register',       'handleRegistryRegister'],
  // Tool Result Cache
  ['GET',  '/api/tool-cache/status',       'handleToolCacheStatus'],
  ['POST', '/api/tool-cache/invalidate',   'handleToolCacheInvalidate'],
  // Semantic Dedup
  ['GET',  '/api/dedup/status',            'handleDedupStatus'],
  // SLA Enforcer
  ['GET',  '/api/sla/status',              'handleSLAStatus'],
  // Content Pinner
  ['GET',  '/api/pinning/status',          'handlePinningStatus'],
  ['POST', '/api/pinning/pin',             'handlePinningPin'],
  ['POST', '/api/pinning/unpin',           'handlePinningUnpin'],
  ['GET',  '/api/pinning/status/:hash',    'handlePinningCheck'],
  // Deployment Rollback
  ['POST', '/api/deployment/rollback',     'handleDeploymentRollback'],
  // Task Decomposer
  ['GET',  '/api/decompose/status',        'handleDecomposeStatus'],
  ['POST', '/api/decompose/run',           'handleDecomposeRun'],
  // Conversation Brancher
  ['GET',  '/api/conversation/list',       'handleConversationList'],
  ['POST', '/api/conversation/create',     'handleConversationCreate'],
  ['POST', '/api/conversation/message',    'handleConversationMessage'],
  ['POST', '/api/conversation/branch',     'handleConversationBranch'],
  ['POST', '/api/conversation/switch',     'handleConversationSwitch'],
  ['GET',  '/api/conversation/:id/tree',   'handleConversationTree'],
  ['GET',  '/api/conversation/:id/history','handleConversationHistory'],
  ['DELETE', '/api/conversation/:id',      'handleConversationDelete'],
  // Auto Tagger
  ['GET',  '/api/tagger/status',           'handleTaggerStatus'],
  ['POST', '/api/tagger/tag',              'handleTaggerTag'],
  ['POST', '/api/tagger/batch',            'handleTaggerBatch'],
  // Conversation Export
  ['GET',  '/api/export/formats',          'handleExportFormats'],
  ['POST', '/api/export/conversation',     'handleExportConversation'],
  // Confidence Router
  ['GET',  '/api/confidence/status',       'handleConfidenceStatus'],
  ['POST', '/api/confidence/route',        'handleConfidenceRoute'],
  // Spend Policy
  ['GET',  '/api/spend/status',            'handleSpendStatus'],
  ['POST', '/api/spend/session/start',     'handleSpendSessionStart'],
  ['POST', '/api/spend/session/end',       'handleSpendSessionEnd'],
  ['GET',  '/api/spend/session',           'handleSpendSessionStatus'],
  // Escrow Channel
  ['GET',  '/api/escrow/status',           'handleEscrowStatus'],
  ['POST', '/api/escrow/open',             'handleEscrowOpen'],
  ['POST', '/api/escrow/voucher',          'handleEscrowVoucher'],
  ['POST', '/api/escrow/settle',           'handleEscrowSettle'],
  ['POST', '/api/escrow/close',            'handleEscrowClose'],
  ['GET',  '/api/escrow/list',             'handleEscrowList'],
  // Memory Manager
  ['GET',  '/api/memory/status',           'handleMemoryStatus'],
  ['POST', '/api/memory/add',              'handleMemoryAdd'],
  ['GET',  '/api/memory/search',           'handleMemorySearch'],
  ['POST', '/api/memory/update',           'handleMemoryUpdate'],
  ['DELETE', '/api/memory/delete',         'handleMemoryDelete'],
  ['GET',  '/api/memory/types',            'handleMemoryTypes'],
  // Hybrid Retriever
  ['GET',  '/api/hybrid/status',           'handleHybridStatus'],
  ['POST', '/api/hybrid/search',           'handleHybridSearch'],
  // Enrichment Queue
  ['GET',  '/api/enrichment/status',       'handleEnrichmentStatus'],
  ['POST', '/api/enrichment/save',         'handleEnrichmentSave'],
  // Link Metadata
  ['GET',  '/api/link-meta/status',        'handleLinkMetaStatus'],
  ['POST', '/api/link-meta/fetch',         'handleLinkMetaFetch'],
  // Vision Captioner
  ['GET',  '/api/vision/status',           'handleVisionStatus'],
  ['POST', '/api/vision/caption',          'handleVisionCaption'],
  // Evidence Exporter
  ['GET',  '/api/evidence/types',          'handleEvidenceTypes'],
  ['POST', '/api/evidence/export',         'handleEvidenceExport'],
  ['POST', '/api/evidence/export-all',     'handleEvidenceExportAll'],
  // MCP Client
  ['GET',  '/api/mcp/status',              'handleMCPStatus'],
  ['GET',  '/api/mcp/servers',             'handleMCPServers'],
  ['GET',  '/api/mcp/tools',               'handleMCPTools'],
  ['POST', '/api/mcp/connect',             'handleMCPConnect'],
  ['POST', '/api/mcp/call',                'handleMCPCall'],
  ['POST', '/api/mcp/disconnect',          'handleMCPDisconnect'],
  // Auto Linker
  ['GET',  '/api/auto-link/status',        'handleAutoLinkStatus'],
  ['POST', '/api/auto-link/build',         'handleAutoLinkBuild'],
  ['GET',  '/api/auto-link/related',       'handleAutoLinkRelated'],
  ['GET',  '/api/auto-link/graph',         'handleAutoLinkGraph'],
  ['GET',  '/api/auto-link/clusters',      'handleAutoLinkClusters'],
  // Capability Prober
  ['GET',  '/api/probe/status',            'handleProbeStatus'],
  ['POST', '/api/probe/run',               'handleProbeRun'],
  ['GET',  '/api/probe/profile',           'handleProbeProfile'],
  ['GET',  '/api/probe/offer',             'handleProbeOffer'],
  // Marketplace Broadcaster
  ['GET',  '/api/market/status',           'handleMarketStatus'],
  ['POST', '/api/market/start',            'handleMarketStart'],
  ['POST', '/api/market/stop',             'handleMarketStop'],
  ['GET',  '/api/market/sellers',          'handleMarketDiscoverSellers'],
  ['POST', '/api/market/quote',            'handleMarketRequestQuote'],
  ['POST', '/api/market/quote/accept',     'handleMarketAcceptQuote'],
  ['GET',  '/api/market/quote',            'handleMarketQuoteStatus'],
  ['GET',  '/api/market/offer',            'handleMarketMyOffer'],
  // Memory Extractor
  ['GET',  '/api/extract/status',          'handleExtractStatus'],
  ['POST', '/api/extract/run',             'handleExtractRun'],
  ['POST', '/api/extract/batch',           'handleExtractBatch'],

  // Payout Router
  ['POST', '/api/payout/register-app',     'handlePayoutRegisterApp'],
  ['GET',  '/api/payout/apps',            'handlePayoutGetApps'],
  ['POST', '/api/payout/register-user',    'handlePayoutRegisterUser'],
  ['GET',  '/api/payout/users',           'handlePayoutGetUsers'],
  ['POST', '/api/payout/record-order',     'handlePayoutRecordOrder'],
  ['GET',  '/api/payout/orders',           'handlePayoutGetOrders'],
  ['GET',  '/api/payout/calculate',        'handlePayoutCalculate'],
  ['GET',  '/api/payout/manifest',         'handlePayoutGetManifest'],
  ['POST', '/api/payout/mark-distributed', 'handlePayoutMarkDistributed'],
  ['POST', '/api/payout/deny',              'handlePayoutDeny'],
  ['POST', '/api/payout/confirm',            'handlePayoutConfirm'],
  ['POST', '/api/payout/execute',            'handlePayoutExecute'],
  ['GET',  '/api/payout/stats',            'handlePayoutStats'],

  // Domain Registrar — Njalla + Nicenic
  ['POST', '/api/domains/search',           'handleDomainSearch'],
  ['POST', '/api/domains/register',         'handleDomainRegister'],
  ['POST', '/api/domains/renew',            'handleDomainRenew'],
  ['GET',  '/api/domains/orders',          'handleDomainOrders'],
  ['POST', '/api/domains/contact',          'handleDomainSaveContact'],
  ['GET',  '/api/domains/contact',          'handleDomainGetContact'],
  ['POST', '/api/domains/ns',               'handleDomainUpdateNs'],
  ['GET',  '/api/domains/records',          'handleDomainListRecords'],
  ['POST', '/api/domains/records',          'handleDomainAddRecord'],
  ['POST', '/api/domains/records/edit',     'handleDomainEditRecord'],
  ['POST', '/api/domains/records/delete',   'handleDomainDeleteRecord'],
  ['GET',  '/api/domains/providers',        'handleDomainProviders'],
  ['GET',  '/api/domains/balance',          'handleDomainBalance'],

  // Market API — programmatic resource requests
  ['POST', '/api/market/inference',         'handleMarketInference'],
  ['POST', '/api/market/storage/allocate',  'handleMarketStorageAllocate'],
  ['POST', '/api/market/storage/store',     'handleMarketStorageStore'],
  ['POST', '/api/market/storage/retrieve',  'handleMarketStorageRetrieve'],
  ['POST', '/api/market/compute',           'handleMarketCompute'],
  ['POST', '/api/market/bandwidth',         'handleMarketBandwidth'],
  ['GET',  '/api/market/job/:jobId',        'handleMarketJobStatus'],
  ['GET',  '/api/market/job/:jobId/result', 'handleMarketJobResult'],
  ['GET',  '/api/market/docs',              'handleMarketDocs'],

  // Chimera Storage Hub (BTFS-inspired)
  ['POST', '/api/storage/upload',          'handleStorageUpload'],
  ['GET',  '/api/storage/download/:spaceName/:fileHash', 'handleStorageDownload'],
];

/**
 * Match an incoming request against the route table.
 * Returns the handler name or null.
 */
export function matchRoute(method, pathname) {
  for (const [m, p, handler] of ROUTES) {
    if (m !== method) continue;
    if (p === pathname) return handler;
    // Check parameterized routes (e.g. /api/deployment/:id)
    if (p.includes(':')) {
      const pParts = p.split('/');
      const pathParts = pathname.split('/');
      if (pParts.length !== pathParts.length) continue;
      let matched = true;
      for (let i = 0; i < pParts.length; i++) {
        if (pParts[i].startsWith(':')) continue;
        if (pParts[i] !== pathParts[i]) { matched = false; break; }
      }
      if (matched) return handler;
    }
  }
  return null;
}

export function extractRouteParams(pathname) {
  for (const [m, p] of ROUTES) {
    if (p.includes(':')) {
      const pParts = p.split('/');
      const pathParts = pathname.split('/');
      if (pParts.length !== pathParts.length) continue;
      let matched = true;
      const params = {};
      for (let i = 0; i < pParts.length; i++) {
        if (pParts[i].startsWith(':')) {
          params[pParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
        } else if (pParts[i] !== pathParts[i]) {
          matched = false; break;
        }
      }
      if (matched) return params;
    }
  }
  return {};
}
