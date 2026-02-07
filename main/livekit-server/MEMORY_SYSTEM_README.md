# Cheeko Memory System — Implementation Complete

> Self-hosted, per-device long-term memory for Cheeko AI agents.
> Replaces the Mem0 cloud dependency with local SQLite + sentence-transformer embeddings.

---

## Table of Contents

- [What Was Built](#what-was-built)
- [Why We Built It](#why-we-built-it)
- [Architecture Overview](#architecture-overview)
- [Implementation Phases](#implementation-phases)
- [Complete Flow Diagrams](#complete-flow-diagrams)
- [File Reference](#file-reference)
- [Runtime Fixes & Optimizations](#runtime-fixes--optimizations)
- [Configuration](#configuration)
- [Testing](#testing)
- [On-Disk Storage Layout](#on-disk-storage-layout)
- [Scalability Path](#scalability-path)

---

## What Was Built

A complete **5-phase memory system** that gives each Cheeko device its own persistent memory — the agent remembers the child's name, pets, preferences, and past conversations across sessions.

```
+------------------------------------------------------------------+
|                    MEMORY SYSTEM COMPONENTS                        |
+------------------------------------------------------------------+
|                                                                    |
|  Phase 1: Core Engine         Phase 2: Storage Backend            |
|  - Embedder (384-dim)         - SQLite per device                 |
|  - Chunker (markdown)         - FTS5 full-text search             |
|  - Hybrid Search (BM25+cos)   - Binary embedding blobs            |
|  - Memory Service (singleton) - Content hash dedup                |
|  - Memory Tools (LLM tools)                                      |
|                                                                    |
|  Phase 3: Intelligence        Phase 4: Qdrant Backend             |
|  - Fact Extractor (Groq LLM)  - Qdrant vector DB                 |
|  - Curator (profile builder)   - Supabase file storage            |
|  - Session flush pipeline      - Migration script                 |
|                                                                    |
|  Phase 5: Testing & Rollout                                       |
|  - 38 tests (unit + integration)                                  |
|  - Worker integration (all 4 workers)                             |
|  - mem0ai dependency fully removed                                |
|  - Runtime bug fixes & optimizations                              |
|                                                                    |
+------------------------------------------------------------------+
```

---

## Why We Built It

| Problem with Mem0 | Solution |
|---|---|
| Cloud dependency ($) | Local SQLite — $0 cost |
| API latency (~500ms) | In-process embedding — <50ms search |
| No control over data | All data stored on-disk per device |
| Single point of failure | Works offline, no external calls |
| No fact extraction | Groq LLM extracts structured facts |
| No profile curation | Automatic daily log to profile merging |

---

## Architecture Overview

```
                              ESP32 Device
                                   |
                         MQTT/UDP audio stream
                                   |
                                   v
                           mqtt-gateway
                          (WebSocket bridge)
                                   |
                                   v
                         LiveKit Cloud (room)
                                   |
                                   v
                          cheeko_worker.py
                                   |
                +------------------+-------------------+
                |                  |                    |
          AgentSession       MemoryService       entrypoint_utils
          (Gemini LLM)       (singleton)        (session lifecycle)
                |                  |                    |
                |           +------+------+            |
                |           |             |            |
                |       Embedder    SqliteBackend      |
                |     (MiniLM-L6)  (per-device DB)     |
                |           |             |            |
                |           +------+------+            |
                |                  |                    |
                +------------------+-------------------+
                                   |
                On session end:    |
                +------------------+-------------------+
                |                  |                    |
          flush_session     fact_extractor          curator
         (extract facts)     (Groq LLM)      (merge to profile)
```

### Module Dependency Graph

```
cheeko_worker.py
    |
    +--> src/memory/__init__.py
              |
              +--> memory_tools.py        (LiveKit @function_tool)
              |        |
              |        v
              +--> memory_service.py       (singleton orchestrator)
              |        |
              |        +--> embedder.py         --> model_cache (sentence-transformers)
              |        +--> chunker.py          (pure Python)
              |        +--> hybrid_search.py    (BM25 + cosine math)
              |        +--> backends/
              |                 +--> base.py           (ABC interface)
              |                 +--> sqlite_backend.py  (per-device SQLite + FTS5)
              |                 +--> qdrant_backend.py  (Qdrant + Supabase)
              |
              +--> fact_extractor.py   --> Groq API (llama-3.1-8b-instant)
              +--> curator.py          --> Groq API (llama-3.1-8b-instant)
```

---

## Implementation Phases

### Phase 1: Memory Service Core

**Created 9 files** in `src/memory/`:

| File | Purpose | Key API |
|------|---------|---------|
| `__init__.py` | Package exports | `MemoryService`, `get_memory_service`, `MEMORY_TOOLS` |
| `embedder.py` | Text to 384-dim vector | `Embedder.embed(text)`, `embed_batch(texts)` |
| `chunker.py` | Markdown-aware splitting | `chunk_markdown(text, max_tokens=400, overlap=80)` |
| `hybrid_search.py` | BM25 + cosine merge | `hybrid_search(query, results, vector_weight, text_weight)` |
| `memory_service.py` | Main orchestrator (singleton) | `initialize()`, `search()`, `write_fact()`, `flush_session()` |
| `memory_tools.py` | LiveKit function tools | `memory_search(query)`, `memory_write(fact, category)` |
| `backends/base.py` | Abstract backend interface | `MemoryBackend` (ABC) |
| `backends/sqlite_backend.py` | SQLite + FTS5 per device | `search()`, `fts_search()`, `upsert_chunks()` |
| `backends/__init__.py` | Package init | — |

**Modified 2 files:**
- `config.yaml` — added `memory:` section
- `src/config/config_loader.py` — added `get_memory_config()` static method

### Phase 2: Storage Backend (SQLite)

Per-device isolated storage with:
- **Vector search**: Cosine similarity over all chunk embeddings (numpy-accelerated)
- **Keyword search**: FTS5 virtual table for BM25-style matching
- **Deduplication**: MD5 `content_hash` unique constraint
- **File storage**: Markdown files (profile.md, daily_log_*.md) on disk
- **Thread safety**: All sync operations wrapped in `asyncio.run_in_executor()`

### Phase 3: Intelligence Layer

| Component | What It Does | LLM Used |
|-----------|-------------|----------|
| `fact_extractor.py` | Extracts structured facts from conversation text | Groq `llama-3.1-8b-instant` (temp=0.3) |
| `curator.py` | Merges daily logs into curated profile | Groq `llama-3.1-8b-instant` (temp=0.2) |

**Fact categories extracted:** `[PREFERENCE]`, `[PERSONAL]`, `[ACHIEVEMENT]`, `[LEARNING]`, `[ROUTINE]`

**Curation sections:** About, Preferences, Important Facts, Learning Progress, Notes

### Phase 4: Qdrant Backend (Tier 2)

| File | Purpose |
|------|---------|
| `backends/qdrant_backend.py` | Qdrant vector DB + Supabase file storage |
| `migrate_to_qdrant.py` | Migration script from SQLite to Qdrant |

Swap by changing `backend: "sqlite"` to `backend: "qdrant"` in config.yaml — zero code changes needed.

### Phase 5: Testing, Integration & Rollout

- **38 tests** across 4 test files — all passing
- **Worker integration** — all 4 workers (cheeko, math_tutor, riddle_solver, word_ladder)
- **mem0ai removed** — from requirements.txt, pyproject.toml, Dockerfiles, env vars, all code
- **Runtime bugs fixed** — startup crash, slow model load, curator shutdown, memory injection

---

## Complete Flow Diagrams

### Flow 1: Session Start (Agent Boot)

```
cheeko_worker.py --> entrypoint()
|
+-- 1. PREWARM (before any session)
|       |
|       +-- model_cache.get_embedding_model("all-MiniLM-L6-v2")
|           Preloads the 80MB sentence-transformer model
|           so it doesn't block session start later
|
+-- 2. CONFIG & SERVICE INIT
|       |
|       +-- ConfigLoader.get_memory_config()       <-- config.yaml memory: section
|       +-- get_memory_service(config)              <-- creates singleton MemoryService
|              +-- SqliteBackend(base_path)          <-- or QdrantBackend
|              +-- Embedder(embedding_config)        <-- wraps sentence-transformers
|
+-- 3. PARALLEL API CALLS
|       |
|       +-- db_helper.get_agent_id(mac)
|       +-- prompt_service.get_prompt_and_config(room, mac)
|       +-- db_helper.get_child_profile_by_mac(mac)
|
+-- 4. RENDER PROMPT
|       |
|       +-- render_prompt_with_profile(prompt, child_profile, memories)
|           Jinja2 template with {{ child_name }}, {{ child_age }}, etc.
|
+-- 5. CREATE SESSION
|       |
|       +-- AgentSession(
|       |       llm=gemini_realtime,
|       |       tools=MODE_SWITCH + OPENCLAW + MEMORY_TOOLS,
|       |       userdata={"device_mac": mac}
|       |   )
|       |
|       +-- session.start(room, agent)   --> AGENT IS LIVE!
|
+-- 6. BACKGROUND MEMORY INIT (non-blocking, runs after agent is live)
        |
        +-- memory_service.initialize(mac, child_profile)
        |     +-- Create SQLite DB + FTS5 tables
        |     +-- Seed profile.md if child_profile exists
        |
        +-- memory_service.load_context(mac)
        |     +-- Read today's daily_log
        |     +-- Read profile.md
        |     +-- Broad search: "What is known about this person?"
        |     +-- Returns {long_term_memories: [...], today_context: "..."}
        |
        +-- assistant.update_instructions(prompt + memory_block)
              Appends to live Gemini session:
              "## What you know about this child:
               - Has a dog named Harry
               - Loves dinosaurs
               ## Today's conversation log:
               - ..."
```

### Flow 2: During Conversation — LLM Tool Calls

The Gemini LLM can autonomously call these tools:

```
+----------------------------------------------------------------------+
|  memory_search(query)                                                 |
|                                                                       |
|  Child says: "What is my dog's name?"                                |
|  LLM decides to call memory_search("dog's name")                     |
|       |                                                               |
|       +-- context.userdata["device_mac"] --> "68:25:dd:bb:f3:a0"     |
|       +-- memory_service.search(mac, "dog's name", limit=5)          |
|       |       |                                                       |
|       |       +-- Embedder.embed("dog's name") --> [384 floats]      |
|       |       +-- SqliteBackend.search(mac, vector)  # cosine scan   |
|       |       +-- SqliteBackend.fts_search(mac, "dog's name") # FTS5 |
|       |       +-- Merge + dedup                                       |
|       |       +-- hybrid_search(query, results)                       |
|       |       |       score = 0.7 * cosine + 0.3 * BM25              |
|       |       |       filter by min_score=0.35                        |
|       |       +-- Returns top results                                |
|       |                                                               |
|       +-- Returns "Found memories:\n- Has a dog named Harry"         |
|           LLM uses this: "Your dog's name is Harry!"                 |
+----------------------------------------------------------------------+

+----------------------------------------------------------------------+
|  memory_write(fact, category)                                         |
|                                                                       |
|  Child says: "My birthday is March 15"                               |
|  LLM decides to call memory_write("Birthday is March 15", "personal")|
|       |                                                               |
|       +-- memory_service.write_fact(mac, fact, "personal")           |
|       |       |                                                       |
|       |       +-- Read existing daily_log_2026-02-07.md              |
|       |       +-- Append "- Birthday is March 15"                    |
|       |       +-- Write updated log file                             |
|       |       +-- Embed fact --> [384 floats]                        |
|       |       +-- MD5 content_hash for dedup                         |
|       |       +-- Upsert into SQLite chunks table                    |
|       |                                                               |
|       +-- Returns "Remembered: Birthday is March 15"                 |
+----------------------------------------------------------------------+
```

### Flow 3: Keyword-Triggered Memory Injection

Separate from tool calls — proactive memory injection on trigger phrases:

```
Child says: "Tell me about me"
|
+-- on_user_speech_committed(msg)
|       |
|       +-- should_inject_memory("tell me about me")
|       |       Matches "remember" trigger --> (True, "remember")
|       |
|       +-- Check debounce (5-second cooldown)
|       +-- asyncio.create_task(inject_memory_context(...))
|
+-- inject_memory_context("tell me about me", mac, "remember")
        |
        +-- await asyncio.sleep(0.3)   # Let any auto-response start
        +-- memory_service.search(mac, "tell me about me", limit=3)
        |       --> ["Name is Karthik", "Has a dog named Harry", "Loves dinosaurs"]
        |
        +-- format_memories_for_injection(query, memories)
        |       --> "RELEVANT MEMORIES:
        |           - Name is Karthik
        |           - Has a dog named Harry
        |           - Loves dinosaurs"
        |
        +-- session.generate_reply(instructions=memory_context + user_query)
            --> Gemini generates personalized response using all known facts
```

**Trigger Patterns:**

| Category | Patterns |
|----------|----------|
| story | "story about", "tell me a story", "tell a story" |
| remember | "do you remember", "remember my", "remember when", **"about me"**, **"tell me about me"**, **"you know me"**, **"know about me"**, **"know my name"** |
| family | "about my", "my dog", "my cat", "my pet", "my brother", "my sister", "my mom", "my dad", "my family" |
| question | "what's my", "who is my", "what is my", **"what do you know"** |

### Flow 4: Session End — Flush + Extract + Curate

```
Participant disconnects
|
+-- cleanup_room_and_session()
|
+-- extract_and_send_chat_history(session, service, mac)
        |
        +-- STEP 1: Extract messages from session.history
        |       Filter out Gemini thinking messages
        |       Format as [{chatType: 1, content: "..."}, ...]
        |
        +-- STEP 2: Parallel execution (15s timeout)
        |       |
        |       +-- Task A: chat_history_service.cleanup()
        |       |       Send to Manager API
        |       |
        |       +-- Task B: memory_service.flush_session(mac, history, extractor)
        |               |
        |               +-- Format conversation text:
        |               |       "Child: I love playing cricket
        |               |        Cheeko: That sounds fun!
        |               |        Child: MS Dhoni is my favorite"
        |               |
        |               +-- LLM Fact Extraction (Groq):
        |               |       extract_facts_with_groq(conversation)
        |               |       --> ["[PREFERENCE] Loves cricket",
        |               |            "[PREFERENCE] Favorite player is MS Dhoni"]
        |               |
        |               +-- For each fact:
        |                       write_fact(mac, fact, "session")
        |                       --> Append to daily_log + embed + upsert
        |
        +-- STEP 3: Curation (separate 30s timeout, runs after flush)
                |
                +-- curate_device_memory(mac, days=3)
                        |
                        +-- Read profile.md (existing profile)
                        +-- Read last 3 days of daily_log_*.md
                        |
                        +-- _llm_curate(profile, logs)  (Groq LLM)
                        |       Prompt: "Merge new facts into profile markdown"
                        |       Sections: About, Preferences, Important Facts,
                        |                 Learning Progress, Notes
                        |       --> Returns updated markdown profile
                        |
                        +-- Write updated profile.md
                        |
                        +-- memory_service.reindex(mac)
                                Read all files --> chunk --> embed
                                replace_all_chunks() --> full index rebuild
```

### Flow 5: Next Session — Memory Recall

```
Same device connects again (next day/session)
|
+-- memory_service.initialize(mac)
|       Already initialized? Skip (fast path)
|
+-- memory_service.load_context(mac)
|       |
|       +-- Read profile.md:
|       |       "# Child Profile
|       |        ## About
|       |        Name: Karthik, speaks Hindi and English
|       |        ## Preferences
|       |        Loves dinosaurs, cricket (MS Dhoni fan)
|       |        ## Important Facts
|       |        Has a dog named Harry who loves biryani"
|       |
|       +-- Read today's daily_log (empty for new day)
|       |
|       +-- Broad search returns profile chunks + recent log facts
|
+-- assistant.update_instructions(prompt + memories)
|       Agent now KNOWS: Karthik, Harry, dinosaurs, cricket, MS Dhoni
|
+-- Child says: "Hey Cheeko!"
    Agent responds: "Hey Karthik! How are you today?"
    (Uses remembered name from profile)
```

---

## File Reference

### Memory Module (`src/memory/`)

```
src/memory/
|-- __init__.py              Exports: MemoryService, get_memory_service,
|                            MEMORY_TOOLS, create_extractor, curate_device_memory
|
|-- embedder.py              class Embedder
|                              embed(text) -> List[float]      (384-dim)
|                              embed_batch(texts) -> List[List[float]]
|                              Uses: model_cache.get_embedding_model()
|
|-- chunker.py               chunk_markdown(text, max_tokens, overlap)
|                              -> [{text, start_line, end_line}]
|                              Split by ## headings, then paragraphs
|
|-- hybrid_search.py         hybrid_search(query, results, weights)
|                              BM25 keyword scoring + cosine vector scoring
|                              Combined: 0.7 * vector + 0.3 * text
|                              Filters by min_score=0.35
|
|-- memory_service.py        class MemoryService (singleton via get_memory_service)
|                              initialize(mac, child_profile)
|                              load_context(mac) -> {memories, today_context}
|                              search(mac, query, limit) -> List[str]
|                              write_fact(mac, content, category)
|                              flush_session(mac, history, extractor)
|                              reindex(mac)
|                              format_memories_for_injection(query, memories)
|
|-- memory_tools.py          @function_tool memory_search(context, query)
|                            @function_tool memory_write(context, fact, category)
|                            MEMORY_TOOLS = [memory_search, memory_write]
|
|-- fact_extractor.py        extract_facts_with_groq(conversation) -> List[str]
|                            create_extractor() -> callable or None
|                            Uses Groq llama-3.1-8b-instant
|
|-- curator.py               curate_device_memory(mac, days=3) -> bool
|                            _llm_curate(profile, logs) -> updated markdown
|                            Uses Groq llama-3.1-8b-instant
|
|-- migrate_to_qdrant.py     Migration script: SQLite -> Qdrant
|
|-- backends/
|   |-- __init__.py
|   |-- base.py              class MemoryBackend (ABC)
|   |                          initialize, search, upsert_chunks,
|   |                          replace_all_chunks, read_file, write_file
|   |
|   |-- sqlite_backend.py    class SqliteBackend(MemoryBackend)
|   |                          Per-device SQLite + FTS5
|   |                          Binary embedding storage (struct packing)
|   |                          Cosine similarity (numpy-accelerated)
|   |
|   |-- qdrant_backend.py    class QdrantBackend(MemoryBackend)
|                              Qdrant vector DB + Supabase file storage
```

### Modified Worker Files

| File | Changes |
|------|---------|
| `workers/cheeko_worker.py` | Memory init, trigger patterns, background context loading, prewarm |
| `workers/math_tutor_worker.py` | MEMORY_TOOLS registered, userdata in constructor |
| `workers/riddle_solver_worker.py` | MEMORY_TOOLS registered, userdata in constructor |
| `workers/word_ladder_worker.py` | MEMORY_TOOLS registered, userdata in constructor |
| `src/shared/entrypoint_utils.py` | Flush pipeline, curation trigger, cleanup lifecycle |
| `src/config/config_loader.py` | `get_memory_config()` static method |
| `config.yaml` | `memory:` configuration section |

### Removed Dependencies

| File | What Was Removed |
|------|-----------------|
| `requirements.txt` | `mem0ai==1.0.0` |
| `pyproject.toml` | `"mem0ai>=1.0.1"` |
| `Dockerfile` | `'mem0ai==1.0.0'` from pip install |
| `Dockerfile.cerebrium` | `'mem0ai==1.0.0'` from pip install |
| `Cerebrium.toml` | `MEM0_ENABLED`, `MEM0_API_KEY` env vars |

---

## Runtime Fixes & Optimizations

Issues discovered and fixed during production testing:

### 1. Slow Startup (90-second model load)

**Problem:** First `memory_service.load_context()` triggered lazy loading of the 80MB sentence-transformers model, blocking the agent from going live for ~90 seconds.

**Fix:**
- Added model preloading in `prewarm()` function (runs before any session)
- Moved memory initialization to background task after `session.start()`
- Agent goes live immediately; memory loads in ~2-5 seconds in background

### 2. AgentSession Userdata Crash

**Problem:** `ValueError: AgentSession userdata is not set` — LiveKit agents v1.3.6 requires userdata in constructor.

**Fix:** Changed from post-creation `session.userdata["device_mac"] = mac` to constructor: `AgentSession(userdata={"device_mac": mac})` in all 4 workers.

### 3. Memory Not Injected at Startup

**Problem:** Agent said "I don't know anything about you" even with daily logs full of data. Memory context was never loaded into the system prompt.

**Fix:**
- Background init now calls `load_context()` after `initialize()`
- Uses `await assistant.update_instructions(prompt + memory_block)` to inject memories into the live Gemini Realtime session
- Added trigger patterns for "about me", "tell me about me", "you know me", "know my name", "what do you know"

### 4. Curator Killed by Process Shutdown

**Problem:** `[CURATOR] LLM call failed: Executor shutdown has been called` — fire-and-forget `asyncio.create_task()` was getting killed when the worker process exits.

**Fix:**
- Moved curation outside the flush timeout block
- Changed to `await asyncio.wait_for(curate_device_memory(mac), timeout=30.0)` with its own independent timeout
- Flush gets 15s, curation gets 30s — separate, sequential

### 5. Prompt Service Dict Error

**Problem:** `'dict' object has no attribute 'strip'` — Manager API returning a dict instead of string for the prompt field.

**Fix:** Added `isinstance(prompt, dict)` check in `prompt_service.py` to extract the prompt string from dict keys.

---

## Configuration

In `config.yaml`:

```yaml
memory:
  enabled: true
  backend: "sqlite"              # "sqlite" or "qdrant"
  base_path: "./memory"

  embedding:
    model: "all-MiniLM-L6-v2"   # 384-dim, 80MB model

  search:
    max_results: 6               # Max results returned per search
    min_score: 0.35              # Minimum hybrid score threshold
    hybrid:
      vector_weight: 0.7        # Weight for semantic similarity
      text_weight: 0.3          # Weight for keyword matching

  chunking:
    max_tokens: 400              # Max words per chunk
    overlap: 80                  # Overlapping words between chunks

  flush:
    enabled: true                # Enable end-of-session fact extraction
    extract_facts_with_llm: true # Use Groq LLM (else fallback to raw messages)

  # Tier 2 only (when backend: "qdrant")
  qdrant:
    url: "https://your-cluster.qdrant.io"
    api_key: "your-key"
    collection: "cheeko_memories"
    vector_size: 384
    supabase_url: "https://your-project.supabase.co"
    supabase_key: "your-service-role-key"
```

### Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `GROQ_API_KEY` | For LLM extraction | Groq API key for fact extraction + curation |
| `QDRANT_URL` | For Qdrant backend | Qdrant cluster URL |
| `QDRANT_API_KEY` | For Qdrant backend | Qdrant API key |

---

## Testing

### Test Files

| File | Tests | What It Covers |
|------|-------|---------------|
| `tests/test_chunker.py` | 7 | Markdown splitting, overlap, headings, edge cases |
| `tests/test_hybrid_search.py` | 11 | BM25 scoring, hybrid merge, normalization, min_score filter |
| `tests/test_memory_service.py` | 15 | Init, search, write, flush, reindex, profile seeding |
| `tests/test_integration.py` | 5 | End-to-end: write → search → flush → curate → verify |

**Total: 38 tests — all passing**

### Running Tests

```bash
cd main/livekit-server

# Run all memory tests
python -m pytest tests/ -v --tb=short

# Run specific test file
python -m pytest tests/test_chunker.py -v

# Run integration tests only
python -m pytest tests/test_integration.py -v
```

### Verification Commands

```bash
# Test module imports
python -c "from src.memory import MemoryService, get_memory_service, MEMORY_TOOLS; print('Import OK')"

# Test embedding (should print 384)
python -c "
import asyncio
from src.memory.embedder import Embedder
e = Embedder({})
print(len(asyncio.run(e.embed('test'))))
"

# Test config loading
python -c "from src.config.config_loader import ConfigLoader; print(ConfigLoader.get_memory_config())"
```

---

## On-Disk Storage Layout

```
memory/
|-- db/
|   |-- 6825ddbbf3a0.sqlite              Device 1 database
|   |   |-- chunks (table)                text, embedding BLOB, content_hash, category
|   |   +-- chunks_fts (FTS5 virtual)     Full-text search index
|   |
|   +-- 206ef1a6d024.sqlite              Device 2 database
|
+-- files/
    |-- 6825ddbbf3a0/
    |   |-- profile.md                    Curated child profile (updated by curator)
    |   |-- daily_log_2026-02-07.md       Today's session facts
    |   |-- daily_log_2026-02-06.md       Yesterday's facts
    |   +-- daily_log_2026-02-05.md
    |
    +-- 206ef1a6d024/
        |-- daily_log_2026-02-07.md
        +-- ...
```

### SQLite Schema

```sql
CREATE TABLE chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    file_path TEXT,
    start_line INTEGER,
    end_line INTEGER,
    embedding BLOB,              -- 384 floats packed as binary (struct)
    category TEXT DEFAULT 'general',
    timestamp TEXT,
    content_hash TEXT UNIQUE      -- MD5 hash for dedup
);

CREATE INDEX idx_chunks_category ON chunks(category);
CREATE INDEX idx_chunks_hash ON chunks(content_hash);
CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content=chunks, content_rowid=id);
```

---

## Scalability Path

| Tier | Devices | Backend | Search Latency | Monthly Cost |
|------|---------|---------|---------------|--------------|
| **1 (current)** | < 500 | SQLite per device | < 50ms | $0 |
| **2 (ready)** | 500 - 10K | Qdrant + Supabase | < 100ms | $25-100 |
| **3 (future)** | 10K+ | Sharded Qdrant + Redis cache | < 100ms | Scales |

Switch tiers by changing `backend: "sqlite"` to `backend: "qdrant"` in config.yaml.
The `MemoryBackend` abstraction ensures **zero code changes** in workers or tools.

---

## Data Flow Summary

| Stage | When | What Happens | Storage Affected |
|-------|------|-------------|------------------|
| **Prewarm** | Process start | Preload embedding model | None (in-memory) |
| **Init** | Session start | Create DB, seed profile | `{mac}.sqlite`, `profile.md` |
| **Load Context** | After init | Search memories, inject into prompt | Read-only |
| **Tool: Search** | Mid-conversation | Vector + FTS5 hybrid search | Read-only |
| **Tool: Write** | Mid-conversation | Append daily log + embed chunk | `daily_log_*.md`, `chunks` table |
| **Keyword Inject** | Mid-conversation | Proactive search on trigger phrases | Read-only |
| **Flush** | Session end | Groq extracts facts from conversation | `daily_log_*.md`, `chunks` table |
| **Curate** | After flush | Groq merges logs into profile, reindex | `profile.md`, `chunks` (full rebuild) |

---

## Key Design Decisions

1. **Singleton pattern** — One `MemoryService` per agent process, reused across sessions
2. **Async wrappers** — All sync ops (SQLite, embedding) use `run_in_executor()` for asyncio
3. **Backend abstraction** — `MemoryBackend` ABC allows SQLite/Qdrant swap with zero code changes
4. **Lazy model loading** — Embedding model loaded on first use, preloaded in `prewarm()`
5. **Content deduplication** — MD5 `content_hash` prevents duplicate chunks
6. **Hybrid search** — Combines semantic (vector cosine) + lexical (BM25) for better recall
7. **Non-blocking startup** — Memory loads in background, agent goes live immediately
8. **Separate timeouts** — Flush (15s) and curation (30s) have independent timeout budgets
9. **Per-device isolation** — Each device gets its own SQLite DB and file directory
10. **LLM-enhanced curation** — Groq summarizes raw logs into structured profile facts
