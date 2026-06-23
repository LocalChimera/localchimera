# Wallet & Earnings Status Update

## 1. Akash API Key Analysis

**Your key**: `ac.sk.production.4587d8c020ed9f4cb691220fbf6cdc6de21a399f74950d09ad60b2e28d0ad7ae`

**Verdict**: ❌ This is a **Cloudmos Console API key** (formerly Akash Console), NOT an Akash blockchain wallet key.

**What this means**:
- Cloudmos API keys are used for the web dashboard, deployment management, and API access to the Cloudmos platform.
- **On-chain provider registration requires a wallet seed phrase (mnemonic) or private key**, not an API key.
- `provider-services` CLI operates directly on the Akash blockchain. It needs:
  - A locally stored keypair (`provider-services keys list`)
  - A funded AKT balance for the provider deposit
  - An on-chain provider transaction (signed with your private key)

**What you need to provide instead**:
- Your **Akash wallet mnemonic (seed phrase)** or
- The **key name** if you've already imported it into `provider-services`

**If you only have the Cloudmos API key**:
1. Log into Cloudmos Console
2. Export your wallet mnemonic from the settings
3. Import it: `provider-services keys add <name> --recover`
4. Then we can register the provider

---

## 2. Nosana Staking Requirements

**Your wallet**: `~/.nosana/nosana_key.json` (ready)

**How much NOS do you need?**

Nosana uses a **dynamic, cost-indexed minimum stake** formula:

```
S_min = (C * H * β) / P_NOS
```

Where:
- `C` = your advertised hourly cost in USD
- `H` = collateral window in hours (336–720 hours = 14–30 days)
- `β` = collateral fraction of revenue (governance-set, typically ~0.5)
- `P_NOS` = current NOS price in USD
- `G` = grace period to top up if stake drops (360 hours)

**Rough estimate for CPU-only node**:
- If you list at ~$0.10/hr (CPU compute)
- H = 336 hours, β = 0.5, NOS = ~$0.10
- **S_min ≈ 168 NOS**

**For GPU nodes** (more realistic for earnings):
- If you list at ~$1.00/hr (GPU compute)
- **S_min ≈ 1,680 NOS**

**Important**: The stake is **not APR-bearing**. You earn via job fees + Host Base Incentive Rewards. Stake just acts as collateral.

**You also need**:
- **SOL for gas**: ~0.005 SOL minimum for transactions
- The wallet address: `BJhZTv7s4TwGTGvLTVrjUYGu3P5ur2TxweYCGUCcbGhX`

---

## 3. Targon Hotkey Issue

**Your key**: `sn4_j90izu5sm4wo4bpoi1ix0rpv7klt`

**Verdict**: ❌ **Not a valid Targon hotkey phrase.**

**Why it failed**:
- Targon expects a standard **BIP39 mnemonic seed phrase** (12–24 English words like `abandon ability able...`).
- `sn4_j90izu5sm4wo4bpoi1ix0rpv7klt` is a single token/key string, not a mnemonic.
- The `targon-cli` binary rejected it: `"Invalid mnemonic"`
- The `tvm/install` binary also rejected it: `"hotkey phrase not passed"`

**What you need to provide**:
- Your actual **Bittensor/Targon wallet mnemonic** (12 or 24 words)
- Or the **hotkey phrase** in BIP39 format

**Targon also requires**:
- On-chain registration (min stake = 1000 TAO for miners, per `config.go`)
- `config.json` with `ip`, `port`, `hotkey_phrase`, `min_stake`
- For CPU mode: reduced rewards vs GPU TEE (AMD EPYC SEV-SNP / Intel TDX + NVIDIA Hopper)

---

## 4. GPU Enforcement Changes (CPU-Only Earnings Blocked)

Code changes were made to **explicitly prevent** Heurist, Lium, Salad, and ByteLeap from starting without a GPU:

### Heurist (`upstream/heurist-miner-release/sd-miner.py`)
- **Added** at line 250-253:
```python
if torch.cuda.device_count() == 0:
    print("ERROR: No NVIDIA GPU detected. Heurist miner requires a CUDA-capable GPU to earn rewards. CPU-only operation is not supported for earnings. Exiting...")
    sys.exit(1)
```
- **Effect**: The miner now exits immediately if no CUDA devices are found.

### ByteLeap (`upstream/byteleap-worker/internal/worker/service.go`)
- **Added** at line 153-158:
```go
if _, err := os.Stat("/dev/nvidia0"); os.IsNotExist(err) {
    if _, err := exec.LookPath("nvidia-smi"); err != nil {
        return fmt.Errorf("ERROR: No NVIDIA GPU detected. ByteLeap worker requires a CUDA-capable GPU to earn rewards. CPU-only operation is not supported for earnings")
    }
}
```
- **Effect**: The worker refuses to start if `/dev/nvidia0` is missing AND `nvidia-smi` is not in PATH.
- Binary rebuilt with `CGO_ENABLED=0`.

### Lium (`upstream/lium-io/neurons/miners/src/core/miner.py`)
- **Added** at line 308-324:
```python
import subprocess
try:
    subprocess.run(["nvidia-smi"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
except (subprocess.CalledProcessError, FileNotFoundError):
    logger.error("ERROR: No NVIDIA GPU detected. Lium miner requires a CUDA-capable GPU executor to earn rewards. CPU-only operation is not supported for earnings.")
    exit()
```
- **Effect**: The central miner exits immediately if `nvidia-smi` fails.

### Salad
- Already **not provider software** — the `salad-job-queue-worker` is a job executor that runs *inside* SaladCloud containers.
- Cannot earn as a standalone binary. No code change needed.

---

## 5. Summary: What Can Earn on This Machine (CPU-Only)

| Network | Can Start? | Can Earn? | Blocker |
|---------|-----------|-----------|---------|
| **Akash** | ✅ k3s ready | ✅ **YES** — best CPU earner | Need wallet mnemonic, not API key |
| **Nosana** | ✅ Binary ready | ⚠️ Minimal — CPU jobs pay little | Need SOL + NOS stake (~168 NOS for CPU) |
| **Targon** | ✅ tvm/install present | ⚠️ Reduced — CPU mode exists | Need valid BIP39 hotkey + on-chain registration |
| **Heurist** | ❌ Blocked by code | ❌ No | GPU required (enforced) |
| **Lium** | ❌ Blocked by code | ❌ No | GPU required (enforced) |
| **ByteLeap** | ❌ Blocked by code | ❌ No | GPU required (enforced) |
| **Salad** | N/A | ❌ No | Not provider software |

---

## 6. What You Need to Provide Now

1. **Akash**: Your wallet **mnemonic phrase** (not the Cloudmos API key)
2. **Nosana**: Send **SOL** (0.005+) and **NOS** (~168+ for CPU) to `BJhZTv7s4TwGTGvLTVrjUYGu3P5ur2TxweYCGUCcbGhX`
3. **Targon**: Your actual **BIP39 mnemonic** (12/24 words), not a single key string

Once you provide these, I can:
- Register the Akash provider on-chain
- Start the Nosana node in mainnet
- Run Targon CPU attestation and submit the report

---

## Files Modified

- `upstream/heurist-miner-release/sd-miner.py` — GPU enforcement check
- `upstream/byteleap-worker/internal/worker/service.go` — GPU enforcement check + rebuilt binary
- `upstream/lium-io/neurons/miners/src/core/miner.py` — GPU enforcement check
- `upstream/targon/config.json` — created with hotkey (invalid, needs replacement)
