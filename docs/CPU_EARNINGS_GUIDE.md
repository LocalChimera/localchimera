# CPU-Only Earnings Guide

## Existing Wallets Found

| Network | Wallet Location | Address / Identifier | Status |
|---------|----------------|---------------------|--------|
| **Solana** | `~/.nosana/nosana_key.json` | Auto-generated keypair (64 bytes) | Needs SOL + NOS |
| **Bittensor** | `~/.bittensor/wallets/chimera/` | ss58: `5DWeA7fMsWpNHwsY7KemPTxqdQKo5h47yBRwhNr1KKVW2JC1` | Hotkey: `default` |
| **EVM** | *Not found on disk* | — | **Need location** |

> **Note**: You said you have an EVM wallet. `cast wallet list` returned empty and no keystore was found under `~/.foundry/`. Please provide the path or private key/keystore location.

---

## Which Networks Earn with CPU-Only?

### ✅ YES — Akash Provider
- **Earnings**: AKT tokens
- **How**: Your k3s cluster is already running. You list CPU compute and tenants bid on it.
- **GPU needed?** No — CPU-only bids exist (web servers, databases, batch jobs).
- **Wallet needed**: AKT address + on-chain provider registration
- **Realistic earnings**: Moderate. CPU bids are common for lightweight workloads.
- **Startup command**:
  ```bash
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
  provider-services run --from <your-akash-key> --node https://rpc.akashnet.net:443
  ```

### ⚠️ MINIMAL — Nosana CPU Jobs
- **Earnings**: NOS tokens
- **How**: Run `nosana node start` with `--provider docker`. The network assigns CPU-only jobs.
- **GPU needed?** No — CPU mode works, but GPU jobs pay much more.
- **Wallet needed**: SOL for gas + NOS for staking (already have keypair)
- **Realistic earnings**: Low on CPU. Most grid demand is for GPU inference.
- **Startup command**:
  ```bash
  cd /home/user/CascadeProjects/qvac-chimera/upstream/nosana-cli
  node dist/src/index.js node start mainnet --provider docker
  ```

### ⚠️ REDUCED — Targon CPU Mode
- **Earnings**: Targon tokens
- **How**: `./tvm/install -node-type CPU` with hotkey
- **GPU needed?** No — CPU attestation exists but rewards are reduced vs GPU TEE.
- **Wallet needed**: Hotkey phrase for `tvm/install` + on-chain registration
- **Realistic earnings**: Low. Full rewards require AMD EPYC SEV-SNP + NVIDIA H100.
- **Startup command**:
  ```bash
  cd /home/user/CascadeProjects/qvac-chimera/upstream/targon
  export TARGON_SKIP_HW_ATTESTATION=1
  export TARGON_SKIP_GPU_CHECK=1
  ./tvm/install -node-type CPU
  ```

### ❌ NO — Heurist
- **Why**: CPU fallback exists (config.consumer.toml) but the network only rewards GPU miners for image generation. CPU mode will not receive jobs or rewards.
- **Wallet needed**: ETH on zkSync Sepolia (for staking)
- **Verdict**: Do not run on this machine for earnings.

### ❌ NO — Lium (Bittensor Subnet 51)
- **Why**: The **central miner** runs on CPU, but the **executor** performs actual inference and requires a GPU. Without a GPU executor, the subnet will not validate your work and you will not earn TAO.
- **Wallet needed**: Bittensor wallet + subnet 51 registration (already have wallet)
- **Verdict**: Do not run on this machine for earnings.

### ❌ NO — SaladCloud Job Queue Worker
- **Why**: This repository is the **job worker** that runs *inside* SaladCloud containers. It is not the provider/host software. SaladCloud providers run proprietary container host software.
- **Verdict**: This binary will not earn anything as a standalone provider.

### ❌ NO — ByteLeap Worker
- **Why**: The soft provider config exists, but the ByteLeap network rewards GPU compute. CPU-only workers do not receive meaningful job assignments.
- **Wallet needed**: ByteLeap enrollment token + real Miner WebSocket URL
- **Verdict**: Do not run on this machine for earnings.

---

## Summary Table

| Network | CPU Earn? | Wallet Status | Needs From You |
|---------|-----------|---------------|----------------|
| **Akash** | ✅ YES | ❌ Missing | AKT wallet + registration |
| **Nosana** | ⚠️ Minimal | ✅ Have keypair | SOL for gas + NOS tokens |
| **Targon** | ⚠️ Reduced | ❌ Missing | Hotkey phrase + registration |
| **Heurist** | ❌ No | ⚠️ EVM not found | zkSync Sepolia wallet + ETH |
| **Lium** | ❌ No | ✅ Have Bittensor | TAO for subnet 51 registration |
| **Salad** | ❌ No | N/A | Proprietary host software |
| **ByteLeap** | ❌ No | ❌ Missing | Miner URL + enrollment token |

---

## Honest Recommendation for This Machine

**Best CPU-only earner: Akash Provider**

Your k3s cluster is already running. With an AKT wallet and provider registration, you can list this 8-core CPU / 10 GB RAM machine and start receiving bids for lightweight containers, databases, and web services.

**Nosana** can also run in CPU mode and will use your existing Solana keypair, but earnings will be minimal without GPU.

**Targon** CPU mode is technically possible but the reward rate makes it unlikely to be worthwhile.

**Do not expect meaningful earnings** from Heurist, Lium, Salad, or ByteLeap without an NVIDIA GPU.

---

## What You Need to Provide

1. **EVM wallet location or private key** (for Heurist — even though CPU won't earn, good to have ready)
2. **AKT wallet** (for Akash — best CPU earner)
3. **Targon hotkey phrase** (if you want to test reduced CPU rewards)
4. **ByteLeap Miner URL + enrollment token** (only if you add a GPU later)

---

## Quick-Start for Akash (Recommended)

```bash
# 1. Create or import AKT wallet
provider-services keys add <key-name> --recover  # if you have mnemonic
# OR
provider-services keys add <key-name>            # generate new

# 2. Fund the wallet with AKT
#    Send AKT to the address shown

# 3. Register as a provider on-chain
#    (requires provider manifest YAML)

# 4. Start the provider
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
provider-services run --from <key-name> --node https://rpc.akashnet.net:443
```

---

## Quick-Start for Nosana (Existing Wallet)

```bash
# 1. Send SOL to the node address for gas
cd /home/user/CascadeProjects/qvac-chimera/upstream/nosana-cli
node dist/src/index.js address
# Address: (shown above)

# 2. Send NOS tokens for staking

# 3. Start the node
cd /home/user/CascadeProjects/qvac-chimera/upstream/nosana-cli
node dist/src/index.js node start mainnet --provider docker
```

---

## Files Updated

- `/home/user/CascadeProjects/qvac-chimera/docs/CPU_EARNINGS_GUIDE.md` — this guide
