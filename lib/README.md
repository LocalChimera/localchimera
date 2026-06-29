# lib

Foundry and build-time libraries for Localchimera.

## Tracked Submodules

- `fhevm/` — Zama fhEVM Solidity library (git submodule)
- `forge-std/` — Foundry standard library (git submodule)

## Generated / Ignored

- `encrypted-types/` — Generated encrypted type bindings (ignored by `.gitignore`)
- `fhevm-sdk/` — Generated fhEVM SDK artifacts (ignored by `.gitignore`)
- `privy-types/` — Generated Privy type bindings (ignored by `.gitignore`)

Do not commit generated directories. Only the git submodules (`fhevm/`, `forge-std/`) should be tracked.
