#!/bin/bash
# localchimera — Provider Startup Script
# Active providers: Akash, Salad, Targon

set -e
LOGDIR="/home/user/CascadeProjects/qvac-chimera/providers/logs"
mkdir -p "$LOGDIR"

echo "======================================"
echo " localchimera Provider Launcher"
echo " Active: Akash, Salad, Targon"
echo "======================================"

# 1. AKASH PROVIDER (best CPU earner)
echo "[1/3] Akash Provider..."
if provider-services version >/dev/null 2>&1; then
  echo "  Wallet: mykey -> AKASH_ADDRESS_REDACTED"
  echo "  k3s:"
  sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get nodes 2>/dev/null || echo "  kubectl failed"
  echo "  TO START: provider-services run --from mykey --node https://rpc.akashnet.net:443"
  echo "  (needs AKT wallet funding + on-chain registration)"
else
  echo "  provider-services not found"
fi

# 2. SALAD JOB QUEUE WORKER (local dev mode)
echo ""
echo "[2/3] Salad Worker (local mode)..."
cd /home/user/CascadeProjects/qvac-chimera/upstream/salad-job-queue-worker
if [ -f ./salad-worker ]; then
  SALAD_LOCAL_MODE=true SALAD_LOCAL_TOKEN=dev-token \
    nohup ./salad-worker > "$LOGDIR/salad.log" 2>&1 &
  echo $! > "$LOGDIR/salad.pid"
  echo "  Salad PID: $!"
else
  echo "  Salad binary not found."
fi

# 3. TARGON CPU PROVIDER
echo ""
echo "[3/3] Targon CPU Provider..."
cd /home/user/CascadeProjects/qvac-chimera/upstream/targon
if [ -f ./targon-cli ]; then
  echo "  Hotkey configured in config.json"
  echo "  TO START: ./targon-cli"
  echo "  (needs 1000 TAO stake + on-chain registration)"
else
  echo "  targon-cli not found. Build: cd targon && go build -o targon-cli ./cmd/targon-cli"
fi

echo ""
echo "======================================"
echo " Removed providers (require GPU):"
echo "   - nosana-cli"
echo "   - lium-io"
echo "   - heurist-miner-release"
echo "   - byteleap-worker"
echo "======================================"
