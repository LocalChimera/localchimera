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
if [ -f ./byteleap-worker ]; then
  nohup ./byteleap-worker -config config/provider-consumer-config.yaml \
    > "$LOGDIR/byteleap.log" 2>&1 &
  echo $! > "$LOGDIR/byteleap.pid"
  echo "ByteLeap PID: $!"
else
  echo "ByteLeap binary not found. Run: cd upstream/byteleap-worker && CGO_ENABLED=0 go build -o byteleap-worker ./cmd/worker"
fi

# 2. Salad Job Queue Worker (local dev mode)
echo "[2/7] Starting Salad Worker (local mode)..."
cd /home/user/CascadeProjects/qvac-chimera/upstream/salad-job-queue-worker
if [ -f ./salad-worker ]; then
  SALAD_LOCAL_MODE=true SALAD_LOCAL_TOKEN=dev-token \
    nohup ./salad-worker > "$LOGDIR/salad.log" 2>&1 &
  echo $! > "$LOGDIR/salad.pid"
  echo "Salad PID: $!"
else
  echo "Salad binary not found. Run: cd upstream/salad-job-queue-worker && go build -o salad-worker ./cmd/salad-http-job-queue-worker"
fi

# 3. Heurist Miner (CPU fallback)
echo "[3/7] Starting Heurist Miner (CPU mode)..."
cd /home/user/CascadeProjects/qvac-chimera/upstream/heurist-miner-release
if [ -f sd-miner.py ]; then
  source /home/user/.venvs/heurist-py311/bin/activate
  # NOTE: This runs in CPU mode. For GPU mining, install CUDA and use default config.
  nohup python sd-miner.py --config config.consumer.toml \
    > "$LOGDIR/heurist.log" 2>&1 &
  echo $! > "$LOGDIR/heurist.pid"
  echo "Heurist PID: $!"
else
  echo "Heurist miner not found."
fi

# 4. Nosana CLI Node (CPU-only)
echo "[4/7] Nosana Node (manual start required)..."
echo "  Run: cd upstream/nosana-cli && node dist/src/index.js node start mainnet --provider docker"
echo "  Wallet: ~/.nosana/nosana_key.json"
echo "  Needs: SOL for gas, NOS for staking, NVIDIA GPU for GPU jobs"

# 5. Akash Provider (via k3s)
echo "[5/7] Akash Provider (manual start required)..."
echo "  k3s is running. Run: provider-services run --from <key> --kubeconfig /etc/rancher/k3s/k3s.yaml"
echo "  Needs: AKT wallet + on-chain provider registration"

# 6. Lium Central Miner
echo "[6/7] Lium Central Miner (manual start required)..."
echo "  Run: source ~/.venvs/lium-py311/bin/activate && cd upstream/lium-io && python neurons/miner.py --netuid 51"
echo "  Needs: Bittensor wallet + subnet 51 registration + GPU executor for earnings"

# 7. Targon CPU Provider
echo "[7/7] Targon CPU Provider (manual start required)..."
echo "  Run: cd upstream/targon && ./tvm/install -node-type CPU"
echo "  Needs: hotkey phrase, registration on Targon network"

echo ""
echo "======================================"
echo " Background providers launched"
echo " Logs: $LOGDIR"
echo "======================================"
echo ""
echo "BYTELEAP: pid $(cat $LOGDIR/byteleap.pid 2>/dev/null || echo 'not started')"
echo "SALAD:    pid $(cat $LOGDIR/salad.pid 2>/dev/null || echo 'not started')"
echo "HEURIST:  pid $(cat $LOGDIR/heurist.pid 2>/dev/null || echo 'not started')"
echo ""
echo "--- Credentials Required for Earnings ---"
echo "NOSANA:   ~/.nosana/nosana_key.json needs SOL + NOS"
echo "AKASH:    AKT wallet + provider deposit"
echo "HEURIST:  Ethereum wallet on zkSync Sepolia"
echo "LIUM:     Bittensor wallet + subnet 51 registration"
echo "TARGON:   hotkey phrase for tvm/install"
echo "BYTELEAP: real Miner URL + enrollment token"
echo "SALAD:    gRPC job-queue backend or SaladCloud container host"
echo ""
echo "--- Hardware Upgrade for Earnings ---"
echo "This machine has NO GPU. Add NVIDIA GPU (RTX 3060+) for real earnings."
