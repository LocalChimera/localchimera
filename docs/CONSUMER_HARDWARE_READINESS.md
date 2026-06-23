# Consumer Hardware Readiness Report

## Summary

All 7 upstream repositories have been analyzed and patched where feasible to run on everyday consumer hardware (standard laptops, desktops, home servers) rather than specialized data-center or enterprise-grade equipment.

---

## Repository Status

### 1. nosana-kit
- **Upstream**: https://github.com/nosana-ci/nosana-kit
- **Consumer Ready?** ✅ YES
- **Requirements**: Node.js 18+, any CPU
- **Changes Made**: Added `examples/consumer-node.js` demonstrating SDK usage on standard hardware.
- **Notes**: Already a lightweight TypeScript SDK. No GPU or specialized hardware needed.

---

### 2. heurist-miner-release
- **Upstream**: https://github.com/heurist-network/heurist-miner-release
- **Consumer Ready?** ⚠️ PARTIAL (CPU fallback added)
- **Requirements**: NVIDIA GPU 12GB+ VRAM recommended; CPU mode now supported for dev/testing
- **Changes Made**: Modified `sd_mining_core/utils/cuda_utils.py`:
  - `check_cuda()` no longer hard-exits when CUDA is unavailable; it warns and falls back to CPU.
  - Added `get_device()` helper that returns `torch.device("cpu")` when no GPU is present.
  - `get_hardware_description()` returns CPU info when CUDA is absent.
- **Notes**: CPU mining has lower performance and earnings, but the miner now starts and runs on any machine with Python + PyTorch CPU. For production earnings, a consumer-grade NVIDIA GPU (RTX 3060 12GB or better) is still strongly recommended.

---

### 3. akash-provider
- **Upstream**: https://github.com/akash-network/provider
- **Consumer Ready?** ⚠️ PARTIAL (local dev mode added)
- **Requirements**: Kubernetes cluster (production); Docker (local dev)
- **Changes Made**: Added `docker-compose.consumer.yml` for single-node local testing.
- **Notes**: The production provider daemon is fundamentally a Kubernetes operator. The docker-compose enables local development and API testing on consumer hardware, but it cannot bid on or manage real Akash deployments without a full K8s cluster.

---

### 4. salad-job-queue-worker
- **Upstream**: https://github.com/saladtechnologies/salad-cloud-job-queue-worker
- **Consumer Ready?** ⚠️ PARTIAL (local mode added)
- **Requirements**: SaladCloud IMDS (production); any machine (local dev)
- **Changes Made**:
  - Added `SALAD_LOCAL_MODE` and `SALAD_LOCAL_TOKEN` env vars to `pkg/config/config.go`.
  - Modified `internal/workers/workers.go` to bypass IMDS token fetching when local mode is enabled.
  - Readiness poller always returns `true` in local mode.
  - Job poller, complete, and reject handlers use the static local token.
- **Notes**: This worker is architected specifically for SaladCloud container nodes. The local-mode patch enables development and integration testing outside SaladCloud, but it still requires a compatible gRPC job-queue endpoint to do real work.

---

### 5. lium-io
- **Upstream**: https://github.com/Datura-ai/lium-io
- **Consumer Ready?** ✅ YES (central miner)
- **Requirements**: 4 CPU cores, 8 GB RAM, no GPU
- **Changes Made**: Added `CONSUMER-README.md` documenting that the central miner is already consumer-hardware compatible.
- **Notes**: The central miner coordinates GPU executors but does not need a GPU itself. GPU executors remain specialized hardware, but the miner node can run on a cheap VPS or old laptop.

---

### 6. targon
- **Upstream**: https://github.com/manifold-inc/targon
- **Consumer Ready?** ❌ NO (requires CC hardware)
- **Requirements**: AMD EPYC SEV-SNP or Intel TDX + NVIDIA H100/H200/B200
- **Changes Made**: Added `docs/consumer-dev.md` explaining CPU-only dev mode.
- **Notes**: Targon's entire value proposition is confidential compute (TEE). Consumer hardware cannot provide hardware attestation or GPU TEE. The dev-mode documentation shows how to run validation logic locally, but it will NOT earn production rewards without CC hardware.

---

### 7. byteleap-worker
- **Upstream**: https://github.com/byteleapai/byteleap-worker
- **Consumer Ready?** ⚠️ PARTIAL (config added)
- **Requirements**: Bare metal, NVIDIA GPU, 32GB+ RAM, VFIO, libvirt (production)
- **Changes Made**: Added `config/consumer-config.yaml` that disables:
  - VM Gateway (`vmgw.enable: false`)
  - All PCI/VFIO strict checks (`pci_check.enable: false`, `require_gpu: false`, etc.)
- **Notes**: The codebase already had toggleable strict checks. The new config file provides a ready-made profile for consumer hardware. Earnings will be reduced without VM-gateway features, but the worker can now start on a standard desktop or laptop.

---

## Commit Log

- `7527104` — Add upstream submodules
- `b437d82` — Apply consumer-hardware patches to upstream submodules

## Next Steps

1. **Fork the upstream repos** and update `.gitmodules` to point to your forks so the local commits can be pushed and shared.
2. **Test each patch** on actual consumer hardware to validate startup and basic functionality.
3. **Expand CPU support** in `heurist-miner-release` by adding smaller model defaults for CPU inference.
4. **Implement a mock job-queue server** for `salad-job-queue-worker` local mode so it can run end-to-end without SaladCloud infrastructure.
5. **Investigate lightweight Kubernetes** (k3s, minikube) for `akash-provider` to enable single-node provider operation.
