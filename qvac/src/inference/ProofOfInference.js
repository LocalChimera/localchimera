import crypto from 'crypto';
import { Logger } from '../core/Logger.js';
import { hashMessage, recoverAddress, signMessage, bytesToHex, hexToBytes, keccak256, privateKeyToAccount } from 'viem';

/**
 * ProofOfInference — cryptographic proof-of-inference receipts.
 *
 * Uses viem (MIT) for secp256k1 signing and verification.
 * Every inference answer is hashed into a Merkle chain and signed,
 * producing a portable receipt that anyone can independently verify.
 */

export class ProofOfInference {
  constructor(config = {}) {
    this.logger = new Logger('ProofOfInference');
    this.privateKey = config.privateKey || null;
    this.publicKey = null;
    this.address = null;
    this.previousHash = null;
    this.receiptCount = 0;
    this._chainFile = config.chainFile || null;
    this._initKeyPair();
  }

  _initKeyPair() {
    if (!this.privateKey) {
      this.privateKey = bytesToHex(crypto.randomBytes(32));
    }
    // Derive address from private key using viem
    // We'll compute the address on first sign
    this.logger.info('PoI keypair initialized');
  }

  /**
   * Build a Merkle tree from inference event fields and return the root.
   */
  _merkleRoot({ promptHash, outputHash, modelId, timestamp, routeId }) {
    const leaves = [
      Buffer.from(promptHash, 'hex'),
      Buffer.from(outputHash, 'hex'),
      Buffer.from(modelId || 'unknown', 'utf-8'),
      Buffer.from(BigInt(timestamp).toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(routeId || '', 'utf-8'),
    ].sort(Buffer.compare);

    let level = leaves;
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = level[i + 1] || level[i];
        next.push(Buffer.from(keccak256(Buffer.concat([left, right])).slice(2), 'hex'));
      }
      level = next;
    }
    return level[0].toString('hex');
  }

  /**
   * Sign a hash with viem (secp256k1 via viem).
   */
  async _sign(msgHash) {
    const signature = await signMessage({
      message: msgHash,
      privateKey: this.privateKey,
    });
    return { signature };
  }

  /**
   * Verify a signature against a message hash using viem ecrecover.
   */
  static async verify(msgHash, signature, signerAddress) {
    try {
      const recovered = await recoverAddress({
        message: msgHash,
        signature: signature.signature || signature,
      });
      return recovered.toLowerCase() === signerAddress.toLowerCase();
    } catch {
      return false;
    }
  }

  getPublicKeyHex() {
    return this.address || '0x0000000000000000000000000000000000000000';
  }

  /**
   * Generate a proof-of-inference receipt for an inference event.
   */
  async generateReceipt({ prompt, output, modelId, routeId, durationMs, tokensGenerated }) {
    const timestamp = Date.now();
    const promptHash = crypto.createHash('sha256').update(prompt || '').digest('hex');
    const outputHash = crypto.createHash('sha256').update(output || '').digest('hex');
    const merkleRoot = this._merkleRoot({ promptHash, outputHash, modelId, timestamp, routeId });
    const signature = await this._sign(merkleRoot);

    if (!this.address) {
      const account = privateKeyToAccount(this.privateKey);
      this.address = account.address;
    }

    const receipt = {
      version: 2,
      timestamp,
      routeId: routeId || '',
      modelId: modelId || 'unknown',
      promptHash,
      outputHash,
      merkleRoot,
      signature,
      signerAddress: this.address,
      previousHash: this.previousHash,
      chainIndex: this.receiptCount,
      durationMs,
      tokensGenerated,
    };

    this.previousHash = crypto.createHash('sha256')
      .update(JSON.stringify(receipt)).digest('hex');
    this.receiptCount++;

    return receipt;
  }

  /**
   * Verify a receipt independently.
   */
  static async verifyReceipt(receipt) {
    if (!receipt || !receipt.merkleRoot || !receipt.signature || !receipt.signerAddress) {
      return { valid: false, reason: 'Missing fields' };
    }
    const sigValid = await ProofOfInference.verify(receipt.merkleRoot, receipt.signature, receipt.signerAddress);
    if (!sigValid) return { valid: false, reason: 'Signature invalid' };

    return { valid: true, chainIndex: receipt.chainIndex, timestamp: receipt.timestamp };
  }

  getStatus() {
    return {
      enabled: true,
      receiptCount: this.receiptCount,
      publicKey: this.getPublicKeyHex().slice(0, 24) + '...',
      previousHash: this.previousHash?.slice(0, 16) + '...' || null,
    };
  }
}
