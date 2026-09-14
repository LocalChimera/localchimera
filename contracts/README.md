# Contracts

Smart contracts for the Localchimera ecosystem.

## EVM Contracts

Located in this directory and deployed primarily on Robinhood Chain (4663) / EVM-compatible chains.

### v1 Contracts (deprecated — ETH-based)

- `EscrowChannel.sol` — ERC-8184 streaming micropayment channel (ETH payments)
- `ChimeraCoordinator.sol` — Job router with bridge dispatch (ETH payments)
- `ProofOfInferenceVerifier.sol` — On-chain inference receipt verification (USDT settlement)

### v2 Tokenomics Contracts (CHIMERA-based)

- `ChimeraToken.sol` — Fixed-supply ERC-20 (1B CHIMERA, burnable, no mint)
- `ChimeraStaking.sol` — Two-tier provider staking, gradient slashing (3%→50%), reward vesting (25% immediate / 75% vests 90 days), consumer priority boost, premium-feature burns, referral tracking, circuit breaker
- `ChimeraCoordinatorV2.sol` — CHIMERA payment job router with two-tier selection (premium > Tier 1 staked > Tier 2 unstaked), reputation-weighted scoring, sliding-scale fees (3%→1.5% by stake), auto-buyback and burn, WETH fee conversion, emergency pause, circuit breaker
- `ProofOfInferenceVerifierV2.sol` — CHIMERA settlement with 10% burn (deflationary)
- `ChimeraGovernance.sol` — On-chain governance with timelocked execution (48h) and juror-based dispute resolution for slash appeals
- `EscrowChannel.sol` (v2 deployment) — New instance with CHIMERA as paymentToken

### Other Contracts

- `ChimeraBridgeDispatcher.sol` — Li.Fi bridge integration for cross-chain job routing
- `ChimeraReactive.sol` — Reactive Network integration

## Casper Contracts

See `../contracts-casper/` for Casper Network smart contracts (vault, escrow, provider registry).

## Deployment

Use the Foundry deployment scripts in `../scripts/deploy/`.

```bash
# Deploy v1 contracts (deprecated)
forge script scripts/deploy/DeployChimera.s.sol:DeployChimera --rpc-url $CHIMERA_RPC_URL --private-key $PRIVATE_KEY --broadcast

# Deploy v2 tokenomics contracts
forge script scripts/deploy/DeployChimeraTokenomics.s.sol:DeployChimeraTokenomics \
  --rpc-url https://rpc.mainnet.chain.robinhood.com \
  --private-key $PRIVATE_KEY --broadcast
```

## Security

- Never commit private keys or `.env` files.
- Use `PAYOUT_SIGNING_KEY` and similar env vars only at runtime.
