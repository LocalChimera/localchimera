# Production Deployment Status

## Machine Specs

| Component | Value |
|-----------|-------|
| CPU | 8 cores |
| RAM | 10 GB |
| GPU | None |
| Disk | 20 GB (13 GB free) |
| OS | Fedora Linux 42 |
| Docker | 29.4.2 ✅ |
| k3s | v1.35.5+k3s1 ✅ |
| Go | 1.25.10 ✅ |
| Node.js | Available ✅ |
| Python | 3.13 (system), 3.11 (uv) |

---

## Provider-by-Provider Status

### 1. nosana-cli (Nosana Grid Provider)
- **Status**: ✅ Binary built and functional
- **Wallet**: Auto-generated at `~/.nosana/nosana_key.json`
- **Address**: `NOSANA_ADDRESS_REDACTED`
- **Balance**: 0 SOL, 0 NOS
- **Can start?** Yes, but registration fails without SOL for gas
- **Can earn?** ❌ No — needs GPU + staked NOS tokens

### 2. heurist-miner-release (Heurist AI Miner)
- **Status**: ✅ Python environment fully working in Python 3.11 venv
- **Packages**: torch 2.4.0+cpu, diffusers, transformers, web3, and all deps installed
- **Import test**: ✅ Passes
- **Miner start**: Reaches wallet validation, then fails because no wallet is configured
- **Root cause fixed**: Used Python 3.11 venv with exact pinned package versions
- **Can earn?** ❌ No — needs NVIDIA GPU + zkSync wallet with staked ETH

### 3. akash-provider (Akash Network Provider)
- **Status**: ✅ provider-services CLI v0.14.0 installed
- **k3s**: ✅ Single-node cluster running (`personal` Ready)
- **Can start?** Yes, with `provider-services run --from <key>`
- **Can earn?** ❌ No — needs AKT wallet + on-chain provider registration + bids

### 4. salad-job-queue-worker (SaladCloud Workload Worker)
- **Status**: ✅ Go binary built (18 MB)
- **Local mode**: ✅ IMDS bypass works
- **Issue**: Without a real gRPC job-queue backend, the worker polls aggressively
- **Can earn?** ❌ No — this is the *job worker*, not the provider node software.
  SaladCloud provider nodes run a proprietary container host.

### 5. lium-io (Lium Bittensor Subnet 51)
- **Status**: ✅ Python packages installed in Python 3.11 venv
- **Packages**: `compute-subnet`, `datura`, `miners` all installed
- **Import test**: ✅ Passes
- **Can start?** Yes, central miner runs on CPU
- **Can earn?** ❌ No — needs Bittensor wallet + subnet 51 registration + GPU executor

### 6. targon (Confidential Compute)
- **Status**: ❌ `tvm/install` binary requires hotkey phrase
- **CPU mode**: Documented but not executable without wallet
- **Can earn?** ❌ No — requires AMD EPYC SEV-SNP + NVIDIA H100 for full rewards.
  CPU mode earns reduced rates but still needs registration.

### 7. byteleap-worker (ByteLeap Compute Worker)
- **Status**: ✅ Go binary built with `CGO_ENABLED=0` (no NVML dependency)
- **Config**: `config/provider-consumer-config.yaml` ready
- **Issue**: Connects to placeholder `ws://your-miner-ip:7799`
- **Can earn?** ❌ No — needs real ByteLeap Miner URL + wallet registration

---

## What Is Actually Running Right Now

```
Process          Status
-------------------------------------------
k3s-server       ✅ Running (475 MB RAM)
salad-worker     ⚠️ Not running (needs backend)
byteleap-worker  ❌ Not running (needs miner URL)
nosana node      ❌ Not running (needs SOL)
heurist miner    ❌ Not running (needs wallet keys)
akash provider   ❌ Not running (needs AKT wallet)
lium miner       ❌ Not running (needs Bittensor wallet)
targon miner     ❌ Not running (needs hotkey)
```

---

## What's Blocking Earnings

1. **NO GPU**: This machine has no NVIDIA GPU. Heurist, Lium, Nosana GPU jobs,
   ByteLeap full mode, and Targon GPU TEE all require one.
2. **NO WALLET FUNDS**: Every network needs staked tokens:
   - **Nosana**: SOL for gas + NOS for staking
   - **Heurist**: ETH on zkSync Sepolia for staking
   - **Akash**: AKT for provider deposit
   - **Lium**: Bittensor TAO for subnet registration
   - **Targon**: Targon network tokens for registration
   - **ByteLeap**: ByteLeap tokens for worker enrollment
3. **NO NETWORK REGISTRATION**: Each provider must be registered on-chain before
   accepting jobs.
4. **NO REAL BACKEND ENDPOINTS**: Salad (needs gRPC queue), ByteLeap (needs Miner
   WebSocket), and Akash (needs bid engine) need live backend connections.

---

## Quick Start Commands (copy-paste ready)

```bash
# 1. ByteLeap Worker
#    Replace your-miner-ip with a real ByteLeap Miner IP
cd /home/user/CascadeProjects/qvac-chimera/upstream/byteleap-worker
sed -i 's|your-miner-ip|192.168.1.100|' config/provider-consumer-config.yaml
./byteleap-worker -config config/provider-consumer-config.yaml

# 2. Salad Worker (local dev mode)
cd /home/user/CascadeProjects/qvac-chimera/upstream/salad-job-queue-worker
SALAD_LOCAL_MODE=true SALAD_LOCAL_TOKEN=dev-token ./salad-worker

# 3. Heurist Miner (CPU mode)
cd /home/user/CascadeProjects/qvac-chimera/upstream/heurist-miner-release
source /home/user/.venvs/heurist-py311/bin/activate
# Copy your wallet config into config.toml, then:
python sd-miner.py --auto-confirm yes

# 4. Nosana Node
cd /home/user/CascadeProjects/qvac-chimera/upstream/nosana-cli
node dist/src/index.js node start mainnet --provider docker
# Wallet: ~/.nosana/nosana_key.json

# 5. Akash Provider
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
provider-services run --from <key-name> --node $AKASH_NODE

# 6. Lium Central Miner
cd /home/user/CascadeProjects/qvac-chimera/upstream/lium-io
source /home/user/.venvs/lium-py311/bin/activate
python neurons/miner.py --netuid 51

# 7. Targon CPU Provider
cd /home/user/CascadeProjects/qvac-chimera/upstream/targon
export TARGON_SKIP_HW_ATTESTATION=1
export TARGON_SKIP_GPU_CHECK=1
./tvm/install -node-type CPU
```

---

## Next Steps to Actually Earn

1. **Add an NVIDIA GPU** (RTX 3060 12GB minimum recommended)
2. **Fund wallets** on each network:
   - `~/.nosana/nosana_key.json` — send SOL + NOS
   - Heurist — fund zkSync Sepolia wallet
   - Akash — fund AKT wallet and register provider
   - Lium — fund Bittensor wallet and register on subnet 51
   - Targon — fund Targon wallet and run tvm/install with hotkey
   - ByteLeap — obtain Miner URL and enrollment token
3. **Set up a real SaladCloud container host** (proprietary software) or connect the
   job-queue worker to a dev gRPC endpoint.
4. **Run the unified startup script**: `bash /home/user/CascadeProjects/qvac-chimera/providers/start-all.sh`

---

## Files Created

- `/home/user/CascadeProjects/qvac-chimera/providers/start-all.sh` — unified launcher
- `/home/user/CascadeProjects/qvac-chimera/providers/status.sh` — status dashboard
- `/home/user/CascadeProjects/qvac-chimera/docs/PRODUCTION_DEPLOYMENT_STATUS.md` — this file
