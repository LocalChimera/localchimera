# LLM Wiki Integration

The QVAC node (Openviking) powers an [llmwiki](https://github.com/lucasastorian/llmwiki)-style workspace. **Openviking** handles indexing, search, and graph queries. **LLMwiki** handles AI generation and file organization.

## Separation of Concerns

| Layer | Responsibility | Component |
|-------|----------------|-----------|
| **Openviking** | Indexing, search, graph queries | QVAC Node (port 3000) |
| **LLMwiki** | AI generation + file sorting/organization | `bridge.py` + `llmwiki-data/wiki/` |

## Services (PM2)

Managed by `ecosystem.config.cjs`:

```bash
./node_modules/.bin/pm2 list
```

| Service | Port | Purpose |
|---------|------|---------|
| qvac-node | 3002 | AI inference + llmwiki index/search/graph endpoints |
| joplin-wiki | 8082 | Existing Joplin wiki server |

## Generate a Wiki Page

### Via HTTP API (non-blocking)

```bash
curl -X POST http://localhost:3002/api/llmwiki-create \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "raft consensus algorithm",
    "category": "entities",
    "tags": ["raft", "consensus", "algorithm"]
  }'
```

Returns `202 Accepted` immediately. A background job calls QVAC (6–8 min), writes the file with YAML frontmatter, and sorts it into the correct folder.

### Via CLI

```bash
python3 src/llmwiki/bridge.py llmwiki-data "topic here" \
  --category concepts \
  --tags tag1 tag2
```

## Search & Graph (Openviking)

All indexing, search, and graph queries are served directly by the QVAC node:

### List Documents
```bash
curl -s http://localhost:3002/api/llmwiki-docs
```

### Search
```bash
curl -s "http://localhost:3002/api/llmwiki-search?q=consensus"
curl -s "http://localhost:3002/api/llmwiki-search?q=raft&tags=consensus&category=entities"
```

### Graph / Links
```bash
# Global stats
curl -s "http://localhost:3002/api/llmwiki-graph"

# Per-node graph (outgoing + incoming links)
curl -s "http://localhost:3002/api/llmwiki-graph?id=concepts/distributed-systems-consensus.md"
```

## Wiki Structure

Files are organized on disk under `llmwiki-data/wiki/`:

- `overview.md` — hub page, auto-updated on each creation
- `log.md` — chronological record
- `concepts/` — theoretical topics
- `entities/` — concrete things (people, products, algorithms, etc.)

Each page follows the [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) and includes YAML frontmatter:

```yaml
---
id: concepts/getting-started
title: Page Title
description: Short summary
tags:
  - tag1
  - tag2
created: 2026-06-16
modified: 2026-06-16
---
```

- `id` — Concept ID (path without `.md` suffix, e.g. `concepts/getting-started`)
- `title` — Human-readable title
- `description` — Short summary
- `tags` — YAML list of tags
- `created` / `modified` — ISO-8601 dates

Files are organized on disk under `llmwiki-data/wiki/` as an OKF bundle:

```
llmwiki-data/wiki/
├── index.md                 # Bundle root listing
├── log.md                   # Update history
├── concepts/
│   ├── index.md             # Directory listing
│   └── getting-started.md   # Concept document
└── entities/
    ├── index.md
    └── example.md
```

The `MarkdownIndexer` inside the QVAC node parses these files at startup (and refreshes when the directory changes), building an in-memory index for search and link-graph queries.
