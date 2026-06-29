# scripts/utils

Utility and helper scripts for Localchimera development and operations.

## Files

- `check-balance.ts` — Check token balances
- `check-hash.mjs` — Check/verify hashes
- `check-target.mjs` — Check target addresses or values
- `cleanup-keys.ts` — Cleanup key files and sensitive material
- `generate-wallet.ts` — Generate new wallets
- `gen-casper-key.mjs` — Generate Casper keys
- `verify-device.py` — Device verification helper
- `patch-*.py` — WASM binary patching utilities

## Usage

```bash
npx tsx scripts/utils/check-balance.ts
npx tsx scripts/utils/generate-wallet.ts
python3 scripts/utils/verify-device.py
```
