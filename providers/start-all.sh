#!/bin/bash
# localchimera — Production Provider Startup Script
# CPU-only optimized launcher (GPU providers commented out)

set -e
LOGDIR="/home/user/CascadeProjects/qvac-chimera/providers/logs"
mkdir -p "$LOGDIR"

echo "======================================"
echo " localchimera Provider Launcher"
echo " CPU-Only Mode"
echo "======================================"

# --- 1. AKASH PROVIDER (BEST CPU EARNER) ---
echo "[1/3] Akash Provider (RECOMMENDED CPU earner)..."
if provider-services version >/dev/null 2>&1; then
  echo "  provider-services installed: $(provider-services version)"
  echo "  k3s status:"
  sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get nodes 2>/dev/null || echo "  kubectl failed"
  echo ""
  echo "  TO START: provider-services run --from <your-key> --node https://rpc.akashnet.net:443"
  echo "  (needs AKT wallet + on-chain registration)"
else
  echo "  provider-services not found"
fi

# --- 2. NOSANA CPU NODE ---
echo ""
echo "[2/3] Nosana Node (CPU mode, existing Solana wallet)..."
cd /home/user/CascadeProjects/qvac-chimera/upstream/nosana-cli
if [ -f dist/src/index.js ]; then
  NODE_ADDR=$(node dist/src/index.js address 2>/dev/null | tail -1 || echo "unknown")
  echo "  Wallet: $NODE_ADDR"
  echo "  Config: ~/.nosana/nosana_key.json"
  echo "  TO START: node dist/src/index.js node start mainnet --provider docker"
  echo "  (needs SOL for gas + NOS for staking)"
else
  echo "  Nosana binary not built"
fi

# --- 3. TARGON CPU PROVIDER ---
echo ""
echo "[3/3] Targon CPU Provider (reduced rewards)..."
cd /home/user/CascadeProjects/qvac-chimera/upstream/targon
if [ -x tvm/install ]; then
  echo "  tvm/install binary present"
  echo "  TO START: TARGON_SKIP_HW_ATTESTATION=1 TARGON_SKIP_GPU_CHECK=1 ./tvm/install -node-type CPU"
  echo "  (needs hotkey phrase + on-chain registration)"
else
  echo "  tvm/install not found"
fi

echo ""
echo "======================================"
echo " Skipped (require GPU to earn):"
echo "   - heurist-miner-release"
echo "   - lium-io (executor needs GPU)"
echo "   - byteleap-worker"
echo "   - salad-job-queue-worker (not provider software)"
echo "======================================"
echo ""
echo "--- Next Steps ---"
echo "1. Provide AKT wallet for Akash (best CPU earner)"
echo "2. Fund Nosana wallet with SOL + NOS"
echo "3. Provide Targon hotkey if you want reduced CPU rewards"
echo ""
