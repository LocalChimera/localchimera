#!/usr/bin/env python3
"""QVAC → LLM Wiki bridge.

Generates wiki pages via the local QVAC AI node and writes them into an
llmwiki workspace with proper frontmatter, citations, and cross-references.

Usage:
    python bridge.py <workspace_path> <topic> [--category concepts|entities]
"""

import argparse
import json
import sqlite3
import subprocess
import sys
from datetime import date
from pathlib import Path
import uuid
from uuid import uuid4

QVAC_API_URL = "http://localhost:3002/api/ai-write"
MAX_SOURCE_CHARS = 15_000

GUIDE_OVERVIEW = """# Overview

This wiki follows the [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf). It is maintained by QVAC — a local AI node that generates and updates pages from prompts.

## Key Findings

- QVAC local inference (SmolLM2 360M) powers all wiki generation
- Content is markdown with YAML frontmatter, stored on disk + indexed in SQLite
- Cross-references link concepts ↔ entities and back to sources
- OKF bundle structure: index.md, log.md, and categorized concept documents

## Recent Updates

"""


# ── Pure helpers ─────────────────────────────────────────────────────────────

def _slugify(title: str) -> str:
    return "-".join(w.lower() for w in title.replace("_", " ").replace("-", " ").split() if w)


def _sanitize_filename(title: str) -> str:
    return _slugify(title) or "page"


def _build_frontmatter(concept_id: str, title: str, description: str, tags: list[str]) -> str:
    today = date.today().isoformat()
    return (
        f"---\n"
        f"id: {concept_id}\n"
        f"title: {title}\n"
        f"description: {description}\n"
        f"tags: {json.dumps(tags)}\n"
        f"created: {today}\n"
        f"modified: {today}\n"
        f"---\n\n"
    )


# ── PromptBuilder — pure, no I/O ─────────────────────────────────────────────

class PromptBuilder:
    """Assembles the final generation prompt from structured inputs."""

    def __init__(self, topic: str, custom_prompt: str = "", links: list[str] | None = None):
        self.topic = topic
        self.custom_prompt = custom_prompt
        self.links = links or []
        self._source_text: str = ""

    def load_source_file(self, file_source: str) -> "PromptBuilder":
        """Read a source file and attach its content (truncated if needed)."""
        if not file_source:
            return self
        try:
            src_path = Path(file_source)
            if src_path.exists():
                text = src_path.read_text(encoding="utf-8", errors="ignore")
                self._source_text = text[:MAX_SOURCE_CHARS] + ("\n\n[truncated]" if len(text) > MAX_SOURCE_CHARS else "")
        except Exception as exc:
            print(f"[bridge] Warning: could not read source file: {exc}")
        return self

    def build(self) -> str:
        parts = [self.custom_prompt if self.custom_prompt else f"Write a comprehensive wiki page about: {self.topic}"]
        if self.links:
            parts.append("\n\nReference these links:\n" + "\n".join(f"- {l}" for l in self.links))
        if self._source_text:
            parts.append(f"\n\nUse the following source material:\n\n{self._source_text}")
        return "".join(parts)


# ── QVAC API call ─────────────────────────────────────────────────────────────

def _call_qvac(prompt: str, title: str, timeout: int = 420) -> str:
    """POST to QVAC /api/ai-write via curl and return the generated body text."""
    payload = json.dumps({"prompt": prompt, "title": title})
    cmd = ["curl", "-s", "-X", "POST", QVAC_API_URL,
           "-H", "Content-Type: application/json",
           "-d", payload, "--max-time", str(timeout)]
    print(f"[bridge] Calling QVAC (max-time={timeout}s)...")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 30)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"QVAC timed out after {timeout + 30}s")
    except Exception as exc:
        raise RuntimeError(f"QVAC curl failed: {exc}")

    if result.returncode != 0:
        raise RuntimeError(f"QVAC curl error (rc={result.returncode}): {result.stderr}")
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"QVAC returned invalid JSON: {exc}\n{result.stdout[:500]}")
    if not data.get("success"):
        raise RuntimeError(f"QVAC generation failed: {data.get('error', 'unknown')}")
    return data["data"]["body"]


# ── WikiWriter — all I/O (disk + db + meta-docs) ─────────────────────────────

class WikiWriter:
    """Persists a generated page to disk, SQLite, overview.md, and log.md."""

    def __init__(self, workspace: Path, category: str):
        self.workspace = workspace
        self.category = category
        db_path = workspace / ".llmwiki" / "index.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(db_path))
        row = self.conn.execute("SELECT id, user_id FROM workspace LIMIT 1").fetchone()
        if not row:
            raise RuntimeError("Workspace not initialized — run 'llmwiki init' first")
        self.kb_id, self.user_id = row

    def write(self, title: str, content: str, tags: list[str]) -> str:
        """Write page to disk and index. Returns doc_id."""
        slug = _sanitize_filename(title)
        filename = f"{slug}.md"
        rel_path = f"wiki/{self.category}/{filename}"
        disk_path = self.workspace / rel_path
        disk_path.parent.mkdir(parents=True, exist_ok=True)
        disk_path.write_text(content, encoding="utf-8")
        print(f"[bridge] Written to {disk_path}")

        doc_id = f"{self.category}/{slug}"
        self._index(doc_id, filename, title, rel_path, content, tags)
        self._update_overview(f"Created {self.category}/{filename} — {title}")
        self._append_log("generate", f"QVAC created {self.category}/{filename}")
        print(f"[bridge] Indexed. Doc ID: {doc_id}")
        return doc_id

    def close(self):
        self.conn.close()

    def _index(self, doc_id: str, filename: str, title: str, rel_path: str, content: str, tags: list[str]):
        self.conn.execute(
            """
            INSERT INTO documents (
                id, user_id, filename, title, path, relative_path,
                source_kind, file_type, status, content, tags, version,
                document_number, file_size, content_hash, mtime_ns, page_count, parser
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(relative_path) DO UPDATE SET
                id=excluded.id, content=excluded.content, title=excluded.title,
                tags=excluded.tags, version=version+1, updated_at=datetime('now')
            """,
            (doc_id, self.user_id, filename, title, f"/wiki/{self.category}/", rel_path,
             "wiki", "md", "ready", content, json.dumps(tags), 0, 1,
             len(content.encode("utf-8")), str(uuid.uuid4())[:16], 0, 0, "markdown"),
        )
        self.conn.commit()

    def _update_overview(self, entry: str):
        overview_path = self.workspace / "wiki" / "overview.md"
        text = overview_path.read_text(encoding="utf-8") if overview_path.exists() else GUIDE_OVERVIEW
        today = date.today().isoformat()
        new_line = f"- [{today}] {entry}"
        if "## Recent Updates" not in text:
            text += "\n## Recent Updates\n\n"
        before, _, after = text.partition("## Recent Updates")
        lines = after.splitlines()
        # find first non-blank line after heading
        insert = next((i for i, l in enumerate(lines[1:], 1) if l.strip()), 1)
        lines.insert(insert, new_line)
        overview_path.write_text(before + "## Recent Updates" + "\n".join(lines), encoding="utf-8")

    def _append_log(self, entry_type: str, summary: str):
        log_path = self.workspace / "wiki" / "log.md"
        today = date.today().isoformat()
        entry = f"\n## [{today}] {entry_type} | {summary}\n\n"
        existing = log_path.read_text(encoding="utf-8") if log_path.exists() else "# Log\n\n"
        log_path.write_text(existing + entry, encoding="utf-8")


# ── Public API ────────────────────────────────────────────────────────────────

def create_wiki_page(
    workspace: Path,
    topic: str = "",
    category: str = "concepts",
    tags: list[str] | None = None,
    description: str | None = None,
    custom_prompt: str = "",
    links: list[str] | None = None,
    file_source: str = "",
) -> str:
    """Generate a wiki page via QVAC and persist it into the llmwiki workspace."""
    title = (custom_prompt.strip() if custom_prompt else topic).replace("_", " ").title()
    effective_tags = tags or [category, "qvac-generated"]
    desc = description or f"QVAC-generated wiki page about {title}"

    gen_prompt = (
        PromptBuilder(topic, custom_prompt, links)
        .load_source_file(file_source)
        .build()
    )

    print(f"[bridge] Generating '{title}' via QVAC...")
    body = _call_qvac(gen_prompt, title)

    writer = WikiWriter(workspace, category)
    try:
        concept_id = f"{category}/{_sanitize_filename(title)}"
        doc_id = writer.write(title, _build_frontmatter(concept_id, title, desc, effective_tags) + body, effective_tags)
    finally:
        writer.close()
    return doc_id


def main():
    parser = argparse.ArgumentParser(description="QVAC → LLM Wiki bridge")
    parser.add_argument("workspace", help="Path to llmwiki workspace")
    parser.add_argument("topic", help="Topic to generate a wiki page about")
    parser.add_argument(
        "--category", choices=["concepts", "entities", "comparisons"],
        default="concepts", help="Wiki category folder"
    )
    parser.add_argument(
        "--tags", nargs="+", default=None, help="Frontmatter tags"
    )
    parser.add_argument(
        "--description", default=None, help="Short page description"
    )
    parser.add_argument(
        "--prompt", default="", help="Custom generation prompt (overrides topic)"
    )
    parser.add_argument(
        "--links", nargs="+", default=None, help="Reference URLs"
    )
    parser.add_argument(
        "--file-source", default="", help="Path to a source file to include in the prompt"
    )
    parser.add_argument(
        "--timeout", type=int, default=420, help="QVAC API timeout in seconds"
    )
    args = parser.parse_args()

    workspace = Path(args.workspace).resolve()
    if not (workspace / ".llmwiki" / "index.db").exists():
        print(f"Error: not an llmwiki workspace: {workspace}")
        print("Run: python llmwiki init <workspace>")
        sys.exit(1)

    try:
        doc_id = create_wiki_page(
            workspace,
            topic=args.topic,
            category=args.category,
            tags=args.tags,
            description=args.description,
            custom_prompt=args.prompt,
            links=args.links,
            file_source=args.file_source,
        )
        print(f"\n✓ Created wiki page: {doc_id}")
        target = args.prompt if args.prompt else args.topic
        print(f"  View: {workspace}/wiki/{args.category}/{_sanitize_filename(target)}.md")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
