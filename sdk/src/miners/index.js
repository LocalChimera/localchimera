/**
 * Chimera SDK — External Miner Providers
 *
 * Security guarantee: this module contains ZERO private key material.
 * Keys are referenced by name/path only, stored in OS-level secure storage.
 */

export { GenericProcessProvider } from './GenericProcessProvider.js';
export { BtfsStorageProvider } from './BtfsStorageProvider.js';
export { getProtocolPayoutAddress, DEFAULT_PROTOCOL_PAYOUT_ADDRESS } from './protocol-address.js';
