#!/bin/bash
# localchimera — Production Provider Startup Script
# Starts all consumer-hardware-compatible provider nodes

set -e
LOGDIR="/home/user/CascadeProjects/qvac-chimera/providers/logs"
mkdir -p "$LOGDIR"

echo "======================================"
echo " localchimera Provider Launcher"
echo "======================================"

# 1. ByteLeap Worker (soft provider mode)
echo "[1/7] Starting ByteLeap Worker..."
cd /home/user/CascadeProjects/qvac-chimera/upstream/byteleap-worker
nohup ./byteleap-worker -config config/provider-consumer-config.yaml \
  > "$LOGDIR/byteleap.log" 2>&1 &
echo $! > "$LOGDIR/byteleap.pid"

# 2. Salad Job Queue Worker (local dev mode)
echo "[2/7] Starting Salad Worker (local mode)..."
cd /home/user/CascadeProjects/qvac-chimera/upstream/salad-job-queue-worker
SALAD_LOCAL_MODE=true SALAD_LOCAL_TOKEN=dev-token \
  nohup ./salad-worker > "$LOGDIR/salad.log" 2>&1 &
echo $! > "$LOGDIR/salad.pid"

# 3. Nosana CLI Node (CPU-only)
echo "[3/7] Starting Nosana Node (CPU-only, needs wallet)..."
cd /home/user/CascadeProjects/qvac-chimera/upstream/nosana-cli
# Requires: nosana node start mainnet --provider docker
# Wallet must be configured first. Placeholder for now.
echo "NOSANA: nosana node start mainnet --provider docker" >> "$LOGDIR/nosana.log"

# 4. Akash Provider (via k3s)
echo "[4/7] Akash Provider (k3s running)."
echo "AKASH: provider-services run --from <key> --kubeconfig /etc/rancher/k3s/k3s.yaml" >> "$LOGDIR/akash.log"

# 5. Lium Central Miner
echo "[5/7] Lium Central Miner (Python venv)."
source /home/user/.venvs/lium-py311/bin/activate
cd /home/user/CascadeProjects/qvac-chimera/upstream/lium-io
# python neurons/miner.py --netuid 51
# Requires: Bittensor wallet setup
echo "LIUM: python neurons/miner.py --netuid 51" >> "$LOGDIR/lium.log"

# 6. Targon CPU Provider
echo "[6/7] Targon CPU Provider."
cd /home/user/CascadeProjects/qvac-chimera/upstream/targon
echo "TARGON: ./tvm/install -node-type CPU (needs hotkey)" >> "$LOGDIR/targon.log"

# 7. Heurist Miner
echo "[7/7] Heurist Miner (CPU fallback)."
cd /home/user/CascadeProjects/qvac-chimera/upstream/heurist-miner-release
source /home/user/.venvs/heurist/bin/activate
# python sd-miner.py --config config.consumer.toml
# Requires: wallet, models (needs GPU for earnings)
echo "HEURIST: python sd-miner.py --config config.consumer.toml" >> "$LOGDIR/heurist.log"

echo ""
echo "======================================"
echo " Providers launched (where possible)"
echo " Logs: $LOGDIR"
echo "======================================"
echo ""
echo "BYTELEAP: pid $(cat $LOGDIR/byteleap.pid 2>/dev/null || echo 'not started')"
echo "SALAD:    pid $(cat $LOGDIR/salad.pid 2>/dev/null || echo 'not started')"
echo ""
echo "The following need wallet credentials to earn:"
echo "  - nosana-cli:   ~/.nosana/nosana_key.json"
echo "  - akash:        AKT wallet + provider registration"
echo "  - lium-io:      Bittensor wallet + subnet 51 registration"
echo "  - targon:       hotkey phrase for tvm/install"
echo "  - heurist:      Ethereum wallet on zkSync Sepolia"
echo ""
echo "This machine has NO GPU. GPU providers will not earn."
echo "Add an NVIDIA GPU (RTX 3060+) for real earnings."
