#!/usr/bin/env python3
"""
Device Verification Script for Compute Registry Provider Registration.

Checks:
1. Local QVAC inference node is running and healthy
2. Machine capabilities (CPU cores, RAM, GPU, disk)
3. On-chain provider status via Casper dictionary queries
4. Minimum stake requirement
5. Overall readiness for provider registration

Usage:
    python3 verify-device.py [--account-hash <hash>] [--rpc-url <url>]

Outputs JSON readiness report to stdout.
"""

import argparse
import json
import os
import platform
import subprocess
import sys
import urllib.request
from typing import Any, Dict, Optional

# ──────────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────────

DEFAULT_RPC_URL = "http://localhost:7778/rpc"
QVAC_STATUS_URL = "http://localhost:3002/api/status"
CONTRACT_HASH = "f8c969bfa7553a23deab0f77fb43210d4810156a977e0cc2695b23182e5b41d0"

# Named keys known from contract deployment (will be looked up dynamically)
DICT_NAMES = [
    "providers_status",
    "providers_peer_id",
    "providers_name",
    "providers_task_types",
    "providers_registered_at",
    "providers_updated_at",
    "stakes",
    "peer_id_to_provider",
]


# ──────────────────────────────────────────────────────────────────────────────
# QVAC Health Check
# ──────────────────────────────────────────────────────────────────────────────

def check_qvac() -> Dict[str, Any]:
    """Check if local QVAC node is running and healthy."""
    result = {"reachable": False, "running": False, "inference_available": False, "details": {}}
    try:
        req = urllib.request.Request(QVAC_STATUS_URL, method="GET")
        req.add_header("Accept", "application/json")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            result["reachable"] = True
            result["details"] = data
            result["running"] = data.get("running", False)
            inference = data.get("inference", {})
            result["inference_available"] = inference.get("qvacAvailable", False) and inference.get("modelLoaded", False)
    except Exception as e:
        result["error"] = str(e)
    return result


# ──────────────────────────────────────────────────────────────────────────────
# Machine Capability Detection
# ──────────────────────────────────────────────────────────────────────────────

def detect_cpu() -> Dict[str, Any]:
    """Detect CPU info."""
    info = {
        "cores_physical": os.cpu_count(),
        "architecture": platform.machine(),
        "processor": platform.processor() or "unknown",
    }
    # Try to get more detailed info from /proc/cpuinfo on Linux
    if os.path.exists("/proc/cpuinfo"):
        try:
            with open("/proc/cpuinfo") as f:
                content = f.read()
            model = [line for line in content.split("\n") if "model name" in line]
            if model:
                info["model"] = model[0].split(":", 1)[1].strip()
        except Exception:
            pass
    return info


def detect_memory() -> Dict[str, Any]:
    """Detect RAM."""
    info = {"total_mb": 0, "available_mb": 0}
    try:
        # Use free -m on Linux
        out = subprocess.check_output(["free", "-m"], text=True)
        lines = out.strip().split("\n")
        for line in lines:
            if line.startswith("Mem:"):
                parts = line.split()
                info["total_mb"] = int(parts[1])
                info["available_mb"] = int(parts[6]) if len(parts) > 6 else int(parts[3])
                break
    except Exception:
        # Fallback: /proc/meminfo
        try:
            with open("/proc/meminfo") as f:
                for line in f:
                    if line.startswith("MemTotal:"):
                        info["total_mb"] = int(line.split()[1]) // 1024
                    elif line.startswith("MemAvailable:"):
                        info["available_mb"] = int(line.split()[1]) // 1024
        except Exception:
            pass
    return info


def detect_gpu() -> Dict[str, Any]:
    """Detect GPU(s)."""
    info = {"available": False, "devices": []}
    # Try nvidia-smi
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        for line in out.strip().split("\n"):
            if line:
                parts = line.split(", ")
                info["devices"].append({
                    "name": parts[0].strip(),
                    "memory": parts[1].strip() if len(parts) > 1 else "unknown",
                })
        info["available"] = len(info["devices"]) > 0
    except Exception:
        pass

    # Try ROCm (AMD)
    if not info["available"]:
        try:
            out = subprocess.check_output(["rocminfo"], text=True, stderr=subprocess.DEVNULL)
            names = [line.split(":")[1].strip() for line in out.split("\n") if "Name:" in line and "gfx" not in line.lower()]
            if names:
                info["devices"] = [{"name": n, "memory": "unknown"} for n in names]
                info["available"] = True
        except Exception:
            pass
    return info


def detect_disk() -> Dict[str, Any]:
    """Detect disk space."""
    info = {"total_gb": 0, "free_gb": 0}
    try:
        stat = os.statvfs(".")
        info["total_gb"] = round((stat.f_blocks * stat.f_frsize) / (1024**3), 2)
        info["free_gb"] = round((stat.f_bavail * stat.f_frsize) / (1024**3), 2)
    except Exception:
        pass
    return info


def detect_os() -> str:
    """Detect OS."""
    return f"{platform.system()} {platform.release()}"


def detect_capabilities() -> Dict[str, Any]:
    """Full capability detection."""
    return {
        "os": detect_os(),
        "cpu": detect_cpu(),
        "memory": detect_memory(),
        "gpu": detect_gpu(),
        "disk": detect_disk(),
        "python": platform.python_version(),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Casper On-Chain Queries
# ──────────────────────────────────────────────────────────────────────────────

def rpc_post(rpc_url: str, method: str, params: Any) -> Any:
    """Make a JSON-RPC POST call."""
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(rpc_url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if "error" in data:
        raise RuntimeError(f"RPC error: {data['error']}")
    return data["result"]


def get_contract_named_keys(rpc_url: str, contract_hash: str) -> Dict[str, str]:
    """Fetch all named keys from contract."""
    result = rpc_post(
        rpc_url,
        "state_get_entity",
        {"entity_identifier": {"ContractHash": f"contract-{contract_hash}"}},
    )
    keys = result["entity"]["Contract"]["contract"]["named_keys"]
    return {k["name"]: k["key"] for k in keys}


def query_dictionary(rpc_url: str, seed_uref: str, key: str, state_root: Optional[str] = None) -> Any:
    """Query a single dictionary item by key."""
    params: Dict[str, Any] = {
        "dictionary_identifier": {
            "URef": {"seed_uref": seed_uref, "dictionary_item_key": key}
        }
    }
    if state_root:
        params["state_root_hash"] = state_root
    result = rpc_post(rpc_url, "state_get_dictionary_item", params)
    return result.get("stored_value", {}).get("CLValue", {}).get("parsed")


def query_provider_on_chain(rpc_url: str, account_hash: str, named_keys: Dict[str, str]) -> Dict[str, Any]:
    """Query all provider data for an account from on-chain dictionaries."""
    # Account hash without prefix for dictionary key
    dict_key = account_hash.replace("account-hash-", "") if account_hash.startswith("account-hash-") else account_hash

    result = {}
    for name in DICT_NAMES:
        uref = named_keys.get(name)
        if not uref:
            result[name] = None
            continue
        try:
            value = query_dictionary(rpc_url, uref, dict_key)
            result[name] = value
        except Exception as e:
            result[name] = {"error": str(e)}
    return result


def get_minimum_stake(rpc_url: str, named_keys: Dict[str, str]) -> int:
    """Fetch minimum_stake from contract."""
    uref = named_keys.get("minimum_stake")
    if not uref:
        return 0
    try:
        result = rpc_post(rpc_url, "state_get_item", {"key": uref, "path": []})
        parsed = result.get("stored_value", {}).get("CLValue", {}).get("parsed")
        return int(parsed) if parsed else 0
    except Exception:
        return 0


# ──────────────────────────────────────────────────────────────────────────────
# Main Report
# ──────────────────────────────────────────────────────────────────────────────

def build_report(args) -> Dict[str, Any]:
    """Build the full verification report."""
    report = {
        "timestamp": subprocess.check_output(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], text=True).strip(),
        "account_hash": args.account_hash,
        "contract_hash": CONTRACT_HASH,
    }

    # 1. QVAC Health
    report["qvac"] = check_qvac()

    # 2. Machine Capabilities
    report["machine"] = detect_capabilities()

    # 3. On-Chain Status
    on_chain = {"connected": False, "provider_exists": False, "stake_amount": 0, "minimum_stake": 0, "dictionaries": {}}
    try:
        named_keys = get_contract_named_keys(args.rpc_url, CONTRACT_HASH)
        on_chain["connected"] = True
        on_chain["minimum_stake"] = get_minimum_stake(args.rpc_url, named_keys)
        on_chain["dictionaries"] = query_provider_on_chain(args.rpc_url, args.account_hash, named_keys)

        # Determine if provider exists
        status = on_chain["dictionaries"].get("providers_status")
        if status is not None and not isinstance(status, dict):
            on_chain["provider_exists"] = True
            on_chain["stake_amount"] = on_chain["dictionaries"].get("stakes", 0)
    except Exception as e:
        on_chain["error"] = str(e)
    report["on_chain"] = on_chain

    # 4. Readiness Assessment
    readiness = {
        "overall": False,
        "checks": {},
        "action_items": [],
    }

    # Check 1: QVAC running
    qvac_ok = report["qvac"]["reachable"] and report["qvac"]["running"]
    readiness["checks"]["qvac_running"] = qvac_ok
    if not qvac_ok:
        readiness["action_items"].append("Start local QVAC node on port 3002")

    # Check 2: Inference available
    inf_ok = report["qvac"].get("inference_available", False)
    readiness["checks"]["inference_ready"] = inf_ok
    if not inf_ok:
        readiness["action_items"].append("Initialize QVAC inference layer / load model")

    # Check 3: Minimum resources
    cpu_ok = report["machine"]["cpu"]["cores_physical"] >= 2
    ram_ok = report["machine"]["memory"]["total_mb"] >= 4096
    disk_ok = report["machine"]["disk"]["free_gb"] >= 10
    readiness["checks"]["cpu_sufficient"] = cpu_ok
    readiness["checks"]["ram_sufficient"] = ram_ok
    readiness["checks"]["disk_sufficient"] = disk_ok
    if not cpu_ok:
        readiness["action_items"].append("CPU cores < 2 — may not meet provider requirements")
    if not ram_ok:
        readiness["action_items"].append("RAM < 4GB — may not meet provider requirements")
    if not disk_ok:
        readiness["action_items"].append("Free disk < 10GB — may not meet provider requirements")

    # Check 4: On-chain connection
    chain_ok = report["on_chain"]["connected"]
    readiness["checks"]["blockchain_reachable"] = chain_ok
    if not chain_ok:
        readiness["action_items"].append("Cannot reach Casper RPC — check proxy or network")

    # Check 5: Not already registered (or stake sufficient)
    if report["on_chain"]["provider_exists"]:
        stake = report["on_chain"]["stake_amount"]
        min_stake = report["on_chain"]["minimum_stake"]
        if isinstance(stake, dict):
            stake = 0
        if isinstance(min_stake, dict):
            min_stake = 0
        stake_ok = int(stake) >= int(min_stake)
        readiness["checks"]["stake_sufficient"] = stake_ok
        if not stake_ok:
            readiness["action_items"].append(f"Stake below minimum ({stake} < {min_stake}) — deposit more")
    else:
        readiness["checks"]["stake_sufficient"] = False
        readiness["action_items"].append("Provider not yet registered on chain")

    # Overall
    readiness["overall"] = all(readiness["checks"].values())
    report["readiness"] = readiness

    return report


def main():
    parser = argparse.ArgumentParser(description="Verify device readiness for compute registry provider registration")
    parser.add_argument("--account-hash", default="account-hash-e39ac4daa9a8fe88d9f074cecfd537d18eb0fbf1196c1b4dd85749bcc50723e9", help="Casper account hash")
    parser.add_argument("--rpc-url", default=DEFAULT_RPC_URL, help="Casper RPC URL")
    parser.add_argument("--json", action="store_true", help="Output raw JSON only")
    args = parser.parse_args()

    report = build_report(args)

    if args.json:
        print(json.dumps(report, indent=2))
        sys.exit(0 if report["readiness"]["overall"] else 1)

    # Pretty print
    print("=" * 70)
    print("   Device Verification Report")
    print("=" * 70)
    print(f"Timestamp: {report['timestamp']}")
    print(f"Account:   {report['account_hash']}")
    print()

    print("─" * 70)
    print("1. LOCAL QVAC NODE")
    print("─" * 70)
    qvac = report["qvac"]
    print(f"  Reachable:        {qvac['reachable']}")
    print(f"  Running:            {qvac.get('running', False)}")
    print(f"  Inference Ready:    {qvac.get('inference_available', False)}")
    if "error" in qvac:
        print(f"  Error:              {qvac['error']}")
    print()

    print("─" * 70)
    print("2. MACHINE CAPABILITIES")
    print("─" * 70)
    m = report["machine"]
    print(f"  OS:                 {m['os']}")
    print(f"  CPU:                {m['cpu'].get('model', m['cpu']['processor'])}")
    print(f"  CPU Cores:          {m['cpu']['cores_physical']}")
    print(f"  Total RAM:          {m['memory']['total_mb']} MB")
    print(f"  Available RAM:      {m['memory']['available_mb']} MB")
    print(f"  Disk Total:         {m['disk']['total_gb']} GB")
    print(f"  Disk Free:          {m['disk']['free_gb']} GB")
    if m["gpu"]["available"]:
        for i, gpu in enumerate(m["gpu"]["devices"]):
            print(f"  GPU {i}:              {gpu['name']} ({gpu['memory']})")
    else:
        print(f"  GPU:                None detected")
    print()

    print("─" * 70)
    print("3. ON-CHAIN STATUS")
    print("─" * 70)
    oc = report["on_chain"]
    print(f"  Blockchain Reachable: {oc['connected']}")
    print(f"  Provider Exists:        {oc['provider_exists']}")
    print(f"  Current Stake:          {oc['stake_amount']}")
    print(f"  Minimum Stake:          {oc['minimum_stake']}")
    if "error" in oc:
        print(f"  Error:                  {oc['error']}")
    print()

    print("─" * 70)
    print("4. READINESS ASSESSMENT")
    print("─" * 70)
    for check, ok in report["readiness"]["checks"].items():
        status = "✅ PASS" if ok else "❌ FAIL"
        print(f"  {check:25s} {status}")
    print()

    if report["readiness"]["overall"]:
        print("✅ DEVICE IS READY FOR PROVIDER REGISTRATION")
    else:
        print("❌ DEVICE NOT READY")
        print("\nAction Items:")
        for item in report["readiness"]["action_items"]:
            print(f"  • {item}")

    print("=" * 70)
    sys.exit(0 if report["readiness"]["overall"] else 1)


if __name__ == "__main__":
    main()
