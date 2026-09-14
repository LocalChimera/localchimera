# sdk/src

Source for `@localchimera/sdk`.

## Subdirectories

- `miners/` — Provider implementations (BTT AI, Golem, Anyone Protocol, Mysterium, BTFS, Sentinel, Spheron, Crust, Infernet)
- `useChimera.js` — React hook for the SDK
- `ChimeraSDK.js` — Main SDK class

## Providers

All providers are designed to run on untrusted hardware:

- No local private keys or wallets
- Relay/worker split where needed
- Docker-based providers where possible

See `../README.md` for integration examples.
