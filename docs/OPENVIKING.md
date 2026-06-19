# OpenViking Integration

## The Real OpenViking Server Requires Embeddings

The real `ghcr.io/volcengine/openviking:latest` server was pulled and attempted to start.
It **cannot run without an embedding provider** — this is an architectural requirement, not a configuration option.

From the upstream README (`upstream/openviking/README.md:96-99`):

> OpenViking requires the following model capabilities:
> - **VLM Model**: For image and content understanding
> - **Embedding Model**: For vectorization and semantic retrieval

The storage layer (`queuefs`) creates a `TextEmbeddingHandler` at startup.
Even with `embedding.dense: null`, the server falls back to local embedding and
immediately crashes with:

```
EmbeddingConfigurationError: Local embedding is enabled but 'llama-cpp-python'
is not installed. Install it with: pip install "openviking[local-embed]".
If you prefer a remote provider, set embedding.dense.provider explicitly in ov.conf.
```

**There is no configuration that disables embeddings entirely.**

## What We Provide Instead: The OpenViking Shim

`qvac/src/llmwiki/openviking_shim_server.py` implements the same HTTP API surface:

| Endpoint | Real OpenViking | Shim |
|---|---|---|
| `GET /health` | ✅ | ✅ |
| `POST /api/v1/sessions` | ✅ | ✅ |
| `GET /api/v1/sessions/{id}` | ✅ | ✅ |
| `GET /api/v1/sessions/{id}/context` | ✅ | ✅ |
| `POST /api/v1/sessions/{id}/messages` | ✅ | ✅ |
| `GET /api/v1/sessions/{id}/messages` | ✅ | ✅ |
| `DELETE /api/v1/sessions/{id}` | ✅ | ✅ |

**Differences:**
- Stores data in SQLite instead of the full RAGFS storage layer
- No embeddings / vector search — context retrieval returns all messages in chronological order
- No L0/L1/L2 tiered context — no automatic summarization
- No filesystem paradigm — pure session-based message storage

For Chimera's use case (wiki page memory), this is sufficient.

## If You Want the Real Server Anyway

You have three options, all of which require embeddings:

### Option 1: Local CPU Embedding (No API Key)

Installs `llama-cpp-python` and downloads a small embedding model (~100MB).
Runs entirely on CPU, no GPU required, no cloud API needed.

```bash
# Inside the OpenViking container
podman exec -it openviking-chimera bash
pip install "openviking[local-embed]"
# Then create ov.conf with local embedding config
```

### Option 2: Cloud Embedding Provider (Requires API Key)

Use VolcEngine, OpenAI, or another provider that hosts embedding models.

```json
{
  "embedding": {
    "dense": {
      "provider": "openai",
      "model": "text-embedding-3-small",
      "api_key": "sk-..."
    }
  }
}
```

### Option 3: Use the Shim (Recommended for Chimera)

Already running. Start/stop:

```bash
./scripts/start-openviking-shim.sh
```

The bridge (`qvac/src/llmwiki/openviking_bridge.py`) uses plain HTTP and works
with **either** the real server or the shim — no code changes needed.

## Current Status

- **Shim server**: Running on `http://127.0.0.1:1933` ✅
- **Bridge**: `openviking_bridge.py` connects via plain urllib ✅
- **Integration**: `server.js` stores wiki pages as memory on every save ✅
