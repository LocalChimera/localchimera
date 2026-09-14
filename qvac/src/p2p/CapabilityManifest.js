import crypto from 'crypto';
import { Logger } from '../core/Logger.js';
import { signMessage, recoverAddress, bytesToHex } from 'viem';

/**
 * CapabilityManifest — signed peer capability advertisements.
 *
 * Uses viem (MIT) for secp256k1 signing and verification.
 * Peers advertise their model inventory, dataset opt-ins, and provider
 * availability via signed capability manifests.
 */

export class CapabilityManifest {
  constructor(config = {}) {
    this.logger = new Logger('CapabilityManifest');
    this.privateKey = config.privateKey || bytesToHex(crypto.randomBytes(32));
    this.address = null;
    this.ourManifest = null;
    this.peerManifests = new Map();
    this.logger.info('CapabilityManifest keypair initialized');
  }

  /**
   * Build and sign our capability manifest.
   */
  async createManifest({ peerId, models = [], datasets = [], provider = false, capacity = {} }) {
    const manifest = {
      peerId: peerId || this.address || 'unknown',
      models,
      datasets,
      provider,
      capacity: {
        maxConcurrent: capacity.maxConcurrent || 1,
        avgLatencyMs: capacity.avgLatencyMs || 5000,
        ...capacity,
      },
      timestamp: Date.now(),
      version: 2,
    };

    const manifestHash = crypto.createHash('sha256')
      .update(JSON.stringify(manifest)).digest('hex');
    const signature = await signMessage({ message: manifestHash, privateKey: this.privateKey });
    manifest.signature = signature;
    manifest.manifestHash = manifestHash;
    manifest.signerAddress = this.address;

    this.ourManifest = manifest;
    return manifest;
  }

  /**
   * Verify a peer's manifest signature.
   */
  static async verifyManifest(manifest) {
    if (!manifest || !manifest.signature || !manifest.manifestHash) {
      return { valid: false, reason: 'Missing signature or hash' };
    }

    const { signature, manifestHash, signerAddress, ...rest } = manifest;
    const computedHash = crypto.createHash('sha256')
      .update(JSON.stringify(rest)).digest('hex');

    if (computedHash !== manifestHash) {
      return { valid: false, reason: 'Hash mismatch — manifest tampered' };
    }

    try {
      const recovered = await recoverAddress({ message: manifestHash, signature });
      if (signerAddress && recovered.toLowerCase() !== signerAddress.toLowerCase()) {
        return { valid: false, reason: 'Signature does not match signer address' };
      }
    } catch {
      return { valid: false, reason: 'Signature verification failed' };
    }

    return { valid: true, timestamp: manifest.timestamp };
  }

  /**
   * Store a peer's manifest.
   */
  async storePeerManifest(peerId, manifest) {
    const verification = await CapabilityManifest.verifyManifest(manifest);
    if (!verification.valid) {
      this.logger.warn(`Rejected manifest from ${peerId}: ${verification.reason}`);
      return false;
    }
    this.peerManifests.set(peerId, manifest);
    this.logger.info(`Stored manifest from ${peerId} (${manifest.models?.length || 0} models, provider: ${manifest.provider})`);
    return true;
  }

  /**
   * Find peers that can provide a specific model.
   */
  findProviders(modelName) {
    const providers = [];
    for (const [peerId, manifest] of this.peerManifests) {
      if (manifest.provider && manifest.models.some(m => m.name === modelName || m.type === modelName)) {
        providers.push({
          peerId,
          models: manifest.models,
          capacity: manifest.capacity,
          timestamp: manifest.timestamp,
        });
      }
    }
    return providers.sort((a, b) => a.capacity.avgLatencyMs - b.capacity.avgLatencyMs);
  }

  /**
   * Find peers willing to share a specific dataset type.
   */
  findDatasetProviders(datasetType) {
    const providers = [];
    for (const [peerId, manifest] of this.peerManifests) {
      if (manifest.datasets.includes(datasetType)) {
        providers.push({ peerId, datasets: manifest.datasets });
      }
    }
    return providers;
  }

  /**
   * Serialize manifest for P2P broadcast.
   */
  serializeForBroadcast() {
    return this.ourManifest ? JSON.stringify(this.ourManifest) : null;
  }

  /**
   * Deserialize a manifest from a P2P message.
   */
  static deserialize(data) {
    try {
      return JSON.parse(typeof data === 'string' ? data : data.toString());
    } catch {
      return null;
    }
  }

  getPeerManifests() {
    return Array.from(this.peerManifests.entries()).map(([peerId, m]) => ({ peerId, ...m }));
  }

  getStatus() {
    return {
      ourManifest: this.ourManifest ? {
        peerId: this.ourManifest.peerId,
        models: this.ourManifest.models.length,
        provider: this.ourManifest.provider,
      } : null,
      peerCount: this.peerManifests.size,
      totalProviders: Array.from(this.peerManifests.values()).filter(m => m.provider).length,
    };
  }
}
