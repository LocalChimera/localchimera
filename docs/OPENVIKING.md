# OpenViking Integration

## Running the Real OpenViking Server

The real `ghcr.io/volcengine/openviking:latest` server **requires an embedding provider**.
This is an architectural requirement — the storage layer (`queuefs`) creates a
`TextEmbeddingHandler` at startup.

We provide a custom image (`openviking-chimera-local`) with `llama-cpp-python`
pre-installed and a local Chinese BGE embedding model (`bge-small-zh-v1.5-f16`).

### Quick Start

```bash
# Build the image (one time)
cd upstream/openviking
podman build -f Dockerfile.local -t openviking-chimera-local .

# Run the server
podman run -d --name openviking-chimera \
  -p 1933:1933 \
  -v openviking_data:/app/.openviking \
  openviking-chimera-local

# Get a user API key (run once)
podman exec openviking-chimera curl -s \
  -H "X-API-Key: chimera-local-dev-key" \
  http://127.0.0.1:1933/api/v1/admin/accounts/default/users
```

### Configuration

The server uses `upstream/openviking/ov.conf`:

```json
{
  "default_account": "default",
  "default_user": "default",
  "storage": { "workspace": "/app/.openviking/data" },
  "embedding": {
    "dense": {
      "provider": "local",
      "model": "bge-small-zh-v1.5-f16",
      "dimension": 512
    }
  },
  "vlm": { "model": null, "api_key": null, "api_base": null },
  "server": {
    "host": "0.0.0.0",
    "port": 1933,
    "auth_mode": "api_key",
    "root_api_key": "chimera-local-dev-key"
  }
}
```

### API Key Setup

The bridge needs a **user API key**, not the root key:

```bash
# List users to get the key
USER_KEY=$(podman exec openviking-chimera curl -s \
  -H "X-API-Key: chimera-local-dev-key" \
  http://127.0.0.1:1933/api/v1/admin/accounts/default/users | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['result'][0]['api_key'])")

# Export for the bridge
export OPENVIKING_API_KEY="$USER_KEY"
```

## OpenViking Shim (Fallback)

`qvac/src/llmwiki/openviking_shim_server.py` is a lightweight drop-in that
implements the same HTTP API but stores data in SQLite with **no embeddings**:

```bash
./scripts/start-openviking-shim.sh
```

The bridge (`qvac/src/llmwiki/openviking_bridge.py`) works with **either**
the real server or the shim — no code changes needed.

## Current Status

- **Real server**: Running on `http://127.0.0.1:1933` with local CPU embeddings ✅
- **Shim server**: Available as fallback ✅
- **Bridge**: `openviking_bridge.py` connects via plain urllib ✅
- **Integration**: `server.js` stores wiki pages as memory on every save ✅
