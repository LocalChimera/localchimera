import crypto from 'crypto';
import { Logger } from '../core/Logger.js';
import _sodium from 'libsodium-wrappers';

/**
 * CryptoVault — per-workspace encryption for sensitive RAG documents.
 *
 * Uses libsodium-wrappers (MIT/ISC) for AEAD encryption (XChaCha20-Poly1305).
 * Each workspace gets its own derived encryption key. Documents are encrypted
 * at rest before being stored in HypercoreStore, and decrypted on read.
 *
 * Key hierarchy:
 *   masterKey (node secret, 32 bytes)
 *     └── workspaceKey = HKDF(masterKey, workspaceName)
 *           └── per-document: XChaCha20-Poly1305(workspaceKey, nonce, plaintext)
 */

export class CryptoVault {
  constructor(config = {}) {
    this.logger = new Logger('CryptoVault');
    this.enabled = config.enabled !== false;
    this._masterKey = config.masterKey
      ? Buffer.from(config.masterKey, 'hex')
      : Buffer.from(crypto.randomBytes(32));
    this._workspaceKeys = new Map();
    this._encryptedCount = 0;
    this._decryptedCount = 0;
    this._sodium = null;
    this._initSodium();
  }

  async _initSodium() {
    await _sodium.ready;
    this._sodium = _sodium;
  }

  /**
   * Derive a workspace-specific key using HKDF.
   */
  _getWorkspaceKey(workspace) {
    if (this._workspaceKeys.has(workspace)) {
      return this._workspaceKeys.get(workspace);
    }
    const info = Buffer.from(`chimera-workspace:${workspace}`, 'utf-8');
    const derived = crypto.hkdfSync('sha256', this._masterKey, Buffer.alloc(0), info, 32);
    const key = Buffer.from(derived);
    this._workspaceKeys.set(workspace, key);
    return key;
  }

  /**
   * Encrypt a document for a workspace using XChaCha20-Poly1305.
   * Returns { encrypted, nonce, tag } as hex strings.
   */
  encrypt(workspace, plaintext) {
    if (!this.enabled) return { data: plaintext, encrypted: false };
    if (!this._sodium) return this._encryptFallback(workspace, plaintext);

    const key = this._getWorkspaceKey(workspace);
    const nonce = this._sodium.randombytes_buf(this._sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const message = this._sodium.from_string(plaintext);
    const ciphertext = this._sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(message, null, null, nonce, key);

    this._encryptedCount++;
    return {
      data: this._sodium.to_hex(ciphertext),
      nonce: this._sodium.to_hex(nonce),
      tag: '',
      encrypted: true,
    };
  }

  /**
   * Decrypt a document from a workspace using XChaCha20-Poly1305.
   * Returns the plaintext string.
   */
  decrypt(workspace, { data, nonce, tag }) {
    if (!this.enabled || !nonce) return data;
    if (!this._sodium) return this._decryptFallback(workspace, { data, nonce, tag });

    const key = this._getWorkspaceKey(workspace);
    const nonceBytes = this._sodium.from_hex(nonce);
    const ciphertext = this._sodium.from_hex(data);
    const decrypted = this._sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, null, nonceBytes, key);

    this._decryptedCount++;
    return this._sodium.to_string(decrypted);
  }

  /**
   * Fallback encryption using Node crypto AES-256-GCM if sodium not ready.
   */
  _encryptFallback(workspace, plaintext) {
    const key = this._getWorkspaceKey(workspace);
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    this._encryptedCount++;
    return { data: encrypted.toString('hex'), nonce: nonce.toString('hex'), tag: tag.toString('hex'), encrypted: true };
  }

  /**
   * Fallback decryption using Node crypto AES-256-GCM.
   */
  _decryptFallback(workspace, { data, nonce, tag }) {
    const key = this._getWorkspaceKey(workspace);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]);
    this._decryptedCount++;
    return decrypted.toString('utf-8');
  }

  /**
   * Encrypt a batch of documents for RAG ingestion.
   * Returns array of { id, encryptedContent, nonce, tag, metadata }.
   */
  encryptDocuments(workspace, documents) {
    return documents.map(doc => {
      const text = typeof doc === 'string' ? doc : (doc.text || doc.content || '');
      const enc = this.encrypt(workspace, text);
      return {
        id: doc.id || `doc-${Math.random().toString(36).slice(2, 8)}`,
        encryptedContent: enc.data,
        nonce: enc.nonce,
        tag: enc.tag,
        encrypted: enc.encrypted,
        metadata: doc.metadata || {},
      };
    });
  }

  /**
   * Decrypt a batch of documents.
   */
  decryptDocuments(workspace, documents) {
    return documents.map(doc => {
      if (!doc.encrypted) return doc;
      const plaintext = this.decrypt(workspace, {
        data: doc.encryptedContent || doc.data,
        nonce: doc.nonce,
        tag: doc.tag,
      });
      return {
        id: doc.id,
        text: plaintext,
        metadata: doc.metadata || {},
      };
    });
  }

  /**
   * Get the master key hex (for backup/migration).
   */
  getMasterKeyHex() {
    return this._masterKey.toString('hex');
  }

  /**
   * Rotate the master key (re-encrypts all cached workspace keys).
   * Note: documents encrypted with the old key must be re-encrypted.
   */
  rotateMasterKey(newMasterKey) {
    const oldKey = this._masterKey;
    this._masterKey = Buffer.from(newMasterKey, 'hex');
    this._workspaceKeys.clear();
    this.logger.info('Master key rotated — workspace keys will be re-derived on next access');
    return oldKey.toString('hex');
  }

  /**
   * Check if a workspace has been initialized (key derived).
   */
  hasWorkspaceKey(workspace) {
    return this._workspaceKeys.has(workspace);
  }

  /**
   * Clear cached workspace keys (forces re-derivation on next access).
   */
  clearWorkspaceKeys() {
    this._workspaceKeys.clear();
  }

  getStats() {
    return {
      enabled: this.enabled,
      cachedWorkspaceKeys: this._workspaceKeys.size,
      totalEncrypted: this._encryptedCount,
      totalDecrypted: this._decryptedCount,
      algorithm: 'XChaCha20-Poly1305',
    };
  }
}
