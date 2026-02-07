# Cheeko Memory System

Self-hosted memory module for Cheeko agents. Per-device memory stored in local SQLite + Markdown files with sentence-transformer embeddings and hybrid (vector + BM25) search.

---

## Status

### Phase 1: Memory Service Core - DONE

| File | Status | Description |
|------|--------|-------------|
| `__init__.py` | Done | Exports `MemoryService`, `get_memory_service`, `MEMORY_TOOLS` |
| `embedder.py` | Done | Async wrapper around `sentence-transformers` (all-MiniLM-L6-v2, 384-dim). Reuses `model_cache` singleton. |
| `chunker.py` | Done | Markdown-aware chunker. Splits on headings, then paragraphs, with configurable overlap. |
| `hybrid_search.py` | Done | BM25-style text scoring merged with cosine vector similarity. Configurable weights. |
| `backends/base.py` | Done | Abstract `MemoryBackend` ABC (initialize, search, upsert, read/write files). |
| `backends/sqlite_backend.py` | Done | Per-device SQLite DB with FTS5 keyword index + numpy cosine vector search. |
| `memory_service.py` | Done | Main service: `initialize`, `load_context`, `search`, `write_fact`, `flush_session`, `reindex`. Singleton via `get_memory_service()`. |
| `memory_tools.py` | Done | `@function_tool` decorated `memory_search` and `memory_write` for LiveKit agent registration. |
| `config.yaml` | Done | Added `memory:` section (backend, embedding model, search params, chunking, flush). |
| `config_loader.py` | Done | Added `ConfigLoader.get_memory_config()` static method. |

### Phase 2: LiveKit Agent Integration - DONE

| Task | Status | Description |
|------|--------|-------------|
| Modify `cheeko_worker.py` | Done | Uses `get_memory_service` + `MEMORY_TOOLS`. Memory initialized at session start, `load_context()` supplements dispatch memories, `on_user_speech` handler uses local search. |
| Modify `math_tutor_worker.py` | Done | Added `MEMORY_TOOLS` to `GAME_TOOLS`, set `session.userdata["device_mac"]`. |
| Modify `riddle_solver_worker.py` | Done | Same pattern as math_tutor. |
| Modify `word_ladder_worker.py` | Done | Same pattern as math_tutor. |
| Update prompt templates | Done | Verified `render_prompt_with_profile()` already accepts `long_term_memories` list — no changes needed. |
| Pass `device_mac` in `userdata` | Done | All 4 workers set `session.userdata["device_mac"] = device_mac`. |
| Modify `entrypoint_utils.py` | Done | Uses `memory_service.flush_session()` in `extract_and_send_chat_history()`. |

### Phase 3: Session Flush & Fact Extraction - DONE

| Task | Status | Description |
|------|--------|-------------|
| `fact_extractor.py` | Done | LLM fact extraction via Groq (`llama-3.1-8b-instant`). Extracts categorized facts (PREFERENCE, PERSONAL, ACHIEVEMENT, etc.) from conversation text. |
| Wire `extract_with_llm` | Done | `entrypoint_utils.py` now passes `create_extractor()` callback to `flush_session()`, enabling LLM-based extraction on every session end. |
| `curator.py` | Done | Daily log curation module. Reads last 3 days of logs, uses LLM to merge new facts into profile markdown, then calls `reindex()`. |
| Re-index on file change | Done | `curator.py` calls `memory_service.reindex(mac)` after updating the profile. Triggered automatically after successful flush. |

### Phase 4: Qdrant Backend (Scale) - DONE

| Task | Status | Description |
|------|--------|-------------|
| `backends/qdrant_backend.py` | Done | `AsyncQdrantClient` with single `cheeko_memories` collection, `mac_id` payload filter, deterministic UUID5 point IDs for dedup. FTS via client-side keyword matching. |
| Supabase table | Done | `device_memories` migration SQL (`mac_id`, `file_type`, `file_date`, `content`). Supabase REST API for read/write with local filesystem fallback. |
| `migrate_to_qdrant.py` | Done | Migration script reads all SQLite DBs + markdown files, upserts into Qdrant + Supabase. Supports `--dry-run`. |
| Config toggle | Done | `MemoryService.__init__` selects backend via `backend: "sqlite" \| "qdrant"`. Qdrant config nested under `memory.qdrant:` in config.yaml. Falls back to sqlite if qdrant_client unavailable. |

### Phase 5: Testing & Rollout - DONE

| Task | Status | Description |
|------|--------|-------------|
| Unit tests | Done | 33 tests across `test_chunker.py`, `test_hybrid_search.py`, `test_memory_service.py` — all passing. |
| Integration test | Done | 5 tests in `test_integration.py`: full session lifecycle, device isolation, context loading, curator, reindex. |
| Remove `mem0_service.py` | Done | `mem0_service.py` kept as archive; all imports/references removed from active code. |
| Remove `mem0ai` dep | Done | Removed from `requirements.txt`, `pyproject.toml`, both Dockerfiles, `Cerebrium.toml`. |
| Staged rollout | Pending | 5 test devices -> 10% -> 100%. |
| Monitoring | Pending | Track search latency, disk usage, cache hit rates. |

---

## Architecture

```
src/memory/
├── __init__.py              # Public API exports
├── embedder.py              # sentence-transformers wrapper (384-dim vectors)
├── chunker.py               # Markdown -> chunks with overlap
├── hybrid_search.py         # BM25 + cosine vector merge
├── memory_service.py        # Main service (singleton)
├── memory_tools.py          # @function_tool for LiveKit agents
├── fact_extractor.py        # LLM fact extraction via Groq
├── curator.py               # Daily log -> profile curation
├── migrate_to_qdrant.py     # SQLite -> Qdrant migration script
└── backends/
    ├── __init__.py
    ├── base.py              # Abstract MemoryBackend ABC
    ├── sqlite_backend.py    # Tier 1: Per-device SQLite + FTS5
    └── qdrant_backend.py    # Tier 2: Qdrant collection + Supabase files
```

On-disk storage layout:
```
memory/
├── db/
│   ├── 6825ddbbf3a0.sqlite   # Device 1 vector store
│   └── aabb11223344.sqlite   # Device 2 vector store
└── files/
    ├── 6825ddbbf3a0/
    │   ├── profile.md
    │   ├── daily_log.md
    │   └── daily_log_2025-02-06.md
    └── aabb11223344/
        └── ...
```

---

## Usage

### Quick Start

```python
from src.config.config_loader import ConfigLoader
from src.memory import MemoryService, get_memory_service, MEMORY_TOOLS

# Initialize (uses config.yaml memory: section)
config = ConfigLoader.get_memory_config()
service = get_memory_service(config)

# Per-device setup
await service.initialize("68:25:dd:bb:f3:a0", {"name": "Riya", "age": 8})

# Write facts
await service.write_fact("68:25:dd:bb:f3:a0", "Has a dog named Rocky", "pet")

# Search
results = await service.search("68:25:dd:bb:f3:a0", "pet dog", limit=5)
# → ["Has a dog named Rocky"]

# Load full context for prompt injection
context = await service.load_context("68:25:dd:bb:f3:a0")
# → {"long_term_memories": [...], "today_context": "...", ...}

# Format for LLM
formatted = service.format_memories_for_injection("tell me about dogs", results)
```

### Registering Tools with LiveKit Agent

```python
from src.memory import MEMORY_TOOLS

session = AgentSession(
    llm=...,
    tools=[*other_tools, *MEMORY_TOOLS],
    userdata={"device_mac": "68:25:dd:bb:f3:a0"},
)
```

---

## Configuration

In `config.yaml`:

```yaml
memory:
  enabled: true
  backend: "sqlite"              # "sqlite" | "qdrant"
  base_path: "./memory"
  embedding:
    model: "all-MiniLM-L6-v2"
  search:
    max_results: 6
    min_score: 0.35
    hybrid:
      vector_weight: 0.7
      text_weight: 0.3
  chunking:
    max_tokens: 400
    overlap: 80
  flush:
    enabled: true
    extract_facts_with_llm: true
  # Tier 2 (only used when backend: "qdrant")
  qdrant:
    url: "https://your-cluster.qdrant.io"
    api_key: "your-key"
    collection: "cheeko_memories"
    vector_size: 384
    # Optional Supabase for file storage (falls back to local filesystem)
    supabase_url: "https://your-project.supabase.co"
    supabase_key: "your-service-role-key"
```

### Migration (SQLite → Qdrant)

```bash
cd main/livekit-server

# Preview what will be migrated
python -m src.memory.migrate_to_qdrant --dry-run

# Run migration
python -m src.memory.migrate_to_qdrant

# Then switch backend in config.yaml:
#   backend: "qdrant"
```

### Supabase Table

Apply migration: `supabase/migrations/20240101000009_create_device_memories.sql`

---

## Scalability Path

| Tier | Devices | Backend | Latency | Cost |
|------|---------|---------|---------|------|
| 1 (current) | < 500 | SQLite per device | < 50ms | $0 |
| 2 (ready) | 500 - 10K | Qdrant + Supabase | < 100ms | $25-100/mo |
| 3 (future) | 10K+ | Sharded Qdrant + Redis cache | < 100ms | Scales with infra |

Switch tiers by changing `backend: "sqlite"` to `backend: "qdrant"` in config. The `MemoryBackend` abstraction ensures zero code changes in workers or tools.
