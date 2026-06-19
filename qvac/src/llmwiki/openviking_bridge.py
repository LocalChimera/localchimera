#!/usr/bin/env python3
"""OpenViking Bridge — Plain HTTP Edition

Talks to an OpenViking-compatible server over plain HTTP.
Does NOT import anything from the openviking package, so no compiled
Rust extension (pyagfs) is needed on the client side.

Works with:
  - The real OpenViking server (ghcr.io/volcengine/openviking:latest)
  - The OpenViking Shim Server (openviking_shim_server.py)

Upstream: https://github.com/volcengine/OpenViking
"""

import json
import os
import urllib.request
import urllib.error

DEFAULT_URL = os.environ.get("OPENVIKING_URL", "http://127.0.0.1:1933")
API_KEY = os.environ.get("OPENVIKING_API_KEY", "chimera-local-dev-key")


def _request(method: str, path: str, payload: dict | None = None) -> dict:
    url = f"{DEFAULT_URL.rstrip('/')}{path}"
    data = json.dumps(payload).encode("utf-8") if payload else None
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-API-Key": API_KEY,
    }
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
            return {"success": False, "error": body.get("error", str(e)), "status": e.code}
        except Exception:
            return {"success": False, "error": str(e), "status": e.code}
    except Exception as e:
        return {"success": False, "error": str(e)}


def store_memory(content: str, session_id: str = "chimera-default", role: str = "assistant") -> dict:
    """Store a memory entry as a message in a session."""
    # Ensure session exists first
    create_session(session_id)
    resp = _request("POST", f"/api/v1/sessions/{session_id}/messages", {"role": role, "content": content})
    if "error" in resp and not resp.get("result"):
        return {"success": False, "error": resp.get("error", "Failed to store memory")}
    return {"success": True, "result": resp.get("result", resp)}


def search_memory(query: str, session_id: str = "chimera-default") -> dict:
    """Retrieve session context (all messages). No vector search — just returns recent context."""
    resp = _request("GET", f"/api/v1/sessions/{session_id}/context?token_budget=128000")
    if "error" in resp and not resp.get("result"):
        return {"success": False, "error": resp.get("error", "Failed to search memory")}
    return {"success": True, "context": resp.get("result", {})}


def create_session(session_id: str = "chimera-default") -> dict:
    """Create a session if it doesn't exist."""
    resp = _request("POST", "/api/v1/sessions", {"session_id": session_id})
    # 409 / already exists is fine
    return {"success": True, "result": resp.get("result", resp)}


def get_context_for_prompt(query: str, session_id: str = "chimera-default") -> dict:
    """Get assembled context text to prepend to an AI prompt."""
    resp = _request("GET", f"/api/v1/sessions/{session_id}/context?token_budget=128000")
    result = resp.get("result", {})
    messages = result.get("messages", [])
    context_text = "\n\n".join(
        f"{m.get('role', 'system')}: {m.get('content', '')}" for m in messages
    )
    return {"success": True, "context": context_text, "raw": result}


# CLI entrypoint for Node.js server to call via subprocess
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["store", "search", "create_session", "get_context"])
    parser.add_argument("--content", default="")
    parser.add_argument("--query", default="")
    parser.add_argument("--session-id", default="chimera-default")
    parser.add_argument("--role", default="assistant")
    args = parser.parse_args()

    if args.action == "store":
        result = store_memory(args.content, args.session_id, args.role)
    elif args.action == "search":
        result = search_memory(args.query, args.session_id)
    elif args.action == "create_session":
        result = create_session(args.session_id)
    elif args.action == "get_context":
        result = get_context_for_prompt(args.query, args.session_id)
    else:
        result = {"success": False, "error": "Unknown action"}

    print(json.dumps(result))
