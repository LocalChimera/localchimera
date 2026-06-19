"""
Unit tests for bridge.py — PromptBuilder and WikiWriter helpers.
Run: python -m pytest test/bridge_test.py -v
"""
import json
import sqlite3
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent / "src" / "llmwiki"))
from bridge import PromptBuilder, WikiWriter, _slugify, _sanitize_filename, _build_frontmatter, create_wiki_page


# ── Pure helper tests ─────────────────────────────────────────────────────────

def test_slugify_basic():
    assert _slugify("Hello World") == "hello-world"

def test_slugify_underscores():
    assert _slugify("hello_world") == "hello-world"

def test_slugify_empty():
    assert _slugify("") == ""

def test_sanitize_filename_fallback():
    assert _sanitize_filename("") == "page"

def test_build_frontmatter_contains_title():
    fm = _build_frontmatter("my-topic", "My Topic", "A description", ["tag1"])
    assert "title: My Topic" in fm
    assert "tag1" in fm


# ── PromptBuilder tests ───────────────────────────────────────────────────────

def test_prompt_builder_topic_only():
    pb = PromptBuilder(topic="Quantum Computing")
    assert "Quantum Computing" in pb.build()

def test_prompt_builder_custom_prompt_overrides():
    pb = PromptBuilder(topic="Ignored", custom_prompt="Write about AI ethics")
    assert "AI ethics" in pb.build()
    assert "Ignored" not in pb.build()

def test_prompt_builder_appends_links():
    pb = PromptBuilder(topic="Test", links=["https://example.com"])
    result = pb.build()
    assert "https://example.com" in result

def test_prompt_builder_loads_source_file():
    with tempfile.NamedTemporaryFile(suffix=".txt", mode="w", delete=False) as f:
        f.write("source content here")
        fname = f.name
    pb = PromptBuilder(topic="Test").load_source_file(fname)
    assert "source content here" in pb.build()

def test_prompt_builder_truncates_large_source(tmp_path):
    big = tmp_path / "big.txt"
    big.write_text("x" * 20_000)
    pb = PromptBuilder(topic="T").load_source_file(str(big))
    result = pb.build()
    assert "[truncated]" in result
    assert len(result) < 20_000 + 500  # prompt + truncation marker only


# ── WikiWriter tests ──────────────────────────────────────────────────────────

def _make_workspace(tmp_path: Path) -> Path:
    """Scaffold a minimal llmwiki workspace with a seeded SQLite DB."""
    ws = tmp_path / "wiki_ws"
    ws.mkdir()
    db_dir = ws / ".llmwiki"
    db_dir.mkdir()
    conn = sqlite3.connect(str(db_dir / "index.db"))
    conn.execute("""
        CREATE TABLE workspace (id TEXT, name TEXT, user_id TEXT)
    """)
    conn.execute("""
        CREATE TABLE documents (
            id TEXT, user_id TEXT, filename TEXT, title TEXT,
            path TEXT, relative_path TEXT UNIQUE, source_kind TEXT,
            file_type TEXT, status TEXT, content TEXT, tags TEXT,
            version INTEGER, document_number INTEGER, file_size INTEGER,
            content_hash TEXT, mtime_ns INTEGER, page_count INTEGER,
            parser TEXT, updated_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.execute("INSERT INTO workspace VALUES ('kb-1', 'test', 'user-1')")
    conn.commit()
    conn.close()
    (ws / "wiki").mkdir()
    return ws

def test_wiki_writer_creates_file(tmp_path):
    ws = _make_workspace(tmp_path)
    writer = WikiWriter(ws, "concepts")
    doc_id = writer.write("Test Page", "---\ntitle: Test Page\n---\n\nBody.", ["test"])
    writer.close()
    assert (ws / "wiki" / "concepts" / "test-page.md").exists()
    assert doc_id

def test_wiki_writer_upserts_on_conflict(tmp_path):
    ws = _make_workspace(tmp_path)
    writer = WikiWriter(ws, "concepts")
    writer.write("Dup Page", "v1 content", ["t"])
    writer.write("Dup Page", "v2 content", ["t"])  # should not raise
    writer.close()
    conn = sqlite3.connect(str(ws / ".llmwiki" / "index.db"))
    rows = conn.execute("SELECT content FROM documents WHERE relative_path='wiki/concepts/dup-page.md'").fetchall()
    conn.close()
    assert len(rows) == 1
    assert "v2" in rows[0][0]

def test_create_wiki_page_integration(tmp_path):
    ws = _make_workspace(tmp_path)
    with patch("bridge._call_qvac", return_value="Mock body text."):
        doc_id = create_wiki_page(ws, topic="AI Safety", category="concepts")
    assert doc_id
    assert (ws / "wiki" / "concepts" / "ai-safety.md").exists()
    assert (ws / "wiki" / "log.md").exists()
