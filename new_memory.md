# Cheeko Memory System — Exact Flow

## Architecture Overview

```
                         ESP32 Device
                              │
                    MQTT/UDP audio stream
                              │
                              ▼
                      mqtt-gateway
                     (WebSocket bridge)
                              │
                              ▼
                    LiveKit Cloud (room)
                              │
                              ▼
                     cheeko_worker.py
                              │
              ┌───────────────┼───────────────────┐
              │               │                   │
        AgentSession    MemoryService        entrypoint_utils
        (Gemini LLM)    (singleton)         (session lifecycle)
              │               │                   │
              │        ┌──────┴──────┐            │
              │        │             │            │
              │    Embedder     SqliteBackend     │
              │  (MiniLM-L6)   (per-device DB)   │
              │        │             │            │
              │        └──────┬──────┘            │
              │               │                   │
              └───────────────┼───────────────────┘
                              │
           On session end:    │
              ┌───────────────┼──────────────┐
              │               │              │
       flush_session    fact_extractor    curator
       (extract facts)  (Groq LLM)     (merge to profile)
```

---

## Flow 1: Session Start (Worker Boot)

```
cheeko_worker.py → entrypoint()
│
├─ 1. ConfigLoader.get_memory_config()           # Read config.yaml memory: section
├─ 2. get_memory_service(config)                  # Create or get singleton MemoryService
│      └─ MemoryService.__init__()
│           ├─ SqliteBackend(base_path)           # OR QdrantBackend if config says "qdrant"
│           ├─ Embedder(embedding_config)         # Wraps sentence-transformers model
│           └─ Reads search/chunking/flush config
│
├─ 3. Parse room name → extract device_mac
├─ 4. Parallel API calls to manager-api:
│      ├─ get_agent_id(mac)
│      ├─ get_prompt_and_config(room, mac)
│      └─ get_child_profile_by_mac(mac)
│
├─ 5. memory_service.initialize(device_mac, child_profile)
│      ├─ SqliteBackend.initialize(mac)
│      │    ├─ mkdir memory/db/ and memory/files/
│      │    ├─ CREATE TABLE chunks (text, embedding BLOB, content_hash UNIQUE...)
│      │    └─ CREATE VIRTUAL TABLE chunks_fts USING fts5(text)
│      └─ If child_profile and no existing profile:
│           ├─ _format_profile(dict) → markdown text
│           ├─ backend.write_file(mac, "profile", markdown)  # → memory/files/{mac}/profile.md
│           ├─ chunk_markdown(text) → [{text, start_line, end_line}]
│           ├─ embedder.embed_batch(texts) → [[384 floats], ...]
│           └─ backend.upsert_chunks(mac, chunks)  # INSERT INTO chunks + FTS rebuild
│
├─ 6. memory_service.load_context(device_mac)
│      ├─ backend.read_file(mac, "daily_log", date=today)  # Today's log
│      ├─ backend.read_file(mac, "profile")                 # Profile markdown
│      └─ service.search(mac, "What is known about this person...?", limit=6)
│           ├─ embedder.embed(query) → [384 floats]
│           ├─ backend.search(mac, embedding, limit=12)     # Cosine similarity scan
│           ├─ backend.fts_search(mac, query, limit=12)     # FTS5 keyword match
│           ├─ Merge + deduplicate
│           └─ hybrid_search(query, results)                # BM25 + cosine combined score
│              Returns → {long_term_memories: [...], today_context: "..."}
│
├─ 7. Supplement dispatch_memories with local memories (deduplicated)
├─ 8. render_prompt_with_profile(prompt, profile, all_memories)  # Jinja2 template
│
├─ 9. AgentSession(llm=gemini_model, tools=ALL_AGENT_TOOLS)
│      ALL_AGENT_TOOLS = MODE_SWITCH_TOOLS + OPENCLAW_TOOLS + MEMORY_TOOLS
│      MEMORY_TOOLS = [memory_search, memory_write]   # @function_tool decorated
│      session.userdata["device_mac"] = device_mac     # For tool context
│
└─ 10. session.start(room, agent)  →  Agent is LIVE!
```

---

## Flow 2: During Conversation — LLM Tool Calls

The Gemini LLM can autonomously call these tools during conversation:

### `memory_search(query)` — when child mentions past events/preferences

```
LLM decides to call memory_search("dog's name")
│
├─ context.userdata["device_mac"] → "68:25:dd:bb:f3:a0"
├─ get_memory_service()  (singleton, already created)
├─ service.search(mac, "dog's name", limit=5)
│   ├─ Embedder.embed("dog's name") → [384 floats]           # sentence-transformers
│   ├─ SqliteBackend.search(mac, embedding, limit=10)          # cosine scan over all chunks
│   ├─ SqliteBackend.fts_search(mac, "dog's name", limit=10)  # FTS5 keyword match
│   ├─ Merge + dedup
│   └─ hybrid_search("dog's name", merged_results)
│       ├─ BM25 text score (IDF × term frequency)
│       ├─ Normalized vector cosine score
│       ├─ Combined = 0.7 × vector + 0.3 × text
│       └─ Filter by min_score=0.35, sort descending
│
└─ Returns "Found memories:\n- Has a dog named Rocky"
   → LLM uses this in its response to the child
```

### `memory_write(fact, category)` — when child shares new information

```
LLM decides to call memory_write("Birthday is March 15", "personal")
│
├─ context.userdata["device_mac"] → "68:25:dd:bb:f3:a0"
├─ service.write_fact(mac, "Birthday is March 15", "personal")
│   ├─ Read existing daily log for today
│   ├─ Append "- Birthday is March 15" to daily log
│   ├─ backend.write_file(mac, "daily_log", updated_log, date=today)
│   │   → memory/files/6825ddbbf3a0/daily_log_2026-02-07.md
│   ├─ embedder.embed("Birthday is March 15") → [384 floats]
│   ├─ MD5 content_hash for dedup
│   └─ backend.upsert_chunks(mac, [{text, embedding, hash, category}])
│       → INSERT INTO chunks ... ON CONFLICT(content_hash) DO UPDATE
│       → FTS5 rebuild
│
└─ Returns "Remembered: Birthday is March 15"
```

---

## Flow 3: During Conversation — Keyword-Triggered Memory Injection

Separate from tool calls, the `on_user_speech_committed` handler proactively injects memory:

```
Child says: "Tell me a story about my dog"
│
├─ on_user_speech(msg)
│   ├─ should_inject_memory("tell me a story about my dog")
│   │   └─ Matches "story" trigger → (True, "story")
│   ├─ Check debounce (5-second cooldown)
│   └─ asyncio.create_task(inject_memory_context(...))
│
├─ inject_memory_context("tell me a story about my dog", mac, "story")
│   ├─ await asyncio.sleep(0.3)  # Let automatic response start
│   ├─ memory_service.search(mac, "tell me a story about my dog", limit=3)
│   │   → ["Has a dog named Rocky", "Loves playing fetch in the park"]
│   ├─ format_memories_for_injection(query, memories)
│   │   → "🧠 RELEVANT MEMORIES: - Has a dog named Rocky\n- Loves playing fetch..."
│   └─ session.generate_reply(instructions=memory_context + user_query)
│       → Gemini generates a personalized story using Rocky's name
```

### Trigger Patterns

| Category | Patterns |
|----------|----------|
| story | "story about", "tell me a story", "tell a story" |
| remember | "do you remember", "remember my", "remember when" |
| family | "my dog", "my pet", "my brother", "my sister", "my mom", "my dad", "my family", "about my" |
| question | "what's my", "who is my", "what is my" |

---

## Flow 4: Session End — Flush + Extract + Curate

```
Participant disconnects → cleanup_room_and_session()
│
└─ extract_and_send_chat_history(session, chat_history_service, device_mac)
    │
    ├─ 1. Extract messages from session.history
    │      ├─ Filter out Gemini thinking ("**Developing...", "I'm imagining...")
    │      └─ Format as [{chatType: 1, content: "..."}, {chatType: 2, content: "..."}]
    │
    ├─ 2. Send to Manager API (chat_history_service.cleanup())
    │
    ├─ 3. Flush to local memory (in parallel with API):
    │      │
    │      ├─ create_extractor()
    │      │   └─ Returns extract_facts_with_groq function (or None if no API key)
    │      │
    │      └─ memory_service.flush_session(mac, chat_history, extract_with_llm=extractor)
    │          │
    │          ├─ Format conversation:
    │          │   "Child: I love playing cricket with my brother Rahul\n
    │          │    Cheeko: That sounds fun!\n
    │          │    Child: My favorite player is Virat Kohli\n..."
    │          │
    │          ├─ LLM Fact Extraction (if extractor available):
    │          │   │
    │          │   └─ extract_facts_with_groq(conversation_text)
    │          │       ├─ Groq API (llama-3.1-8b-instant, temp=0.3)
    │          │       ├─ Prompt: "Extract durable facts... PREFERENCE, PERSONAL,
    │          │       │           ACHIEVEMENT, LEARNING, ROUTINE"
    │          │       ├─ Truncate conversation to 4000 chars
    │          │       └─ Returns:
    │          │           ["[PERSONAL] Has a brother named Rahul",
    │          │            "[PREFERENCE] Favorite cricket player is Virat Kohli",
    │          │            "[LEARNING] Interested in the solar system"]
    │          │
    │          ├─ Fallback (if LLM unavailable):
    │          │   └─ Take user messages with >3 words as raw facts
    │          │
    │          └─ For each fact → write_fact(mac, fact, "session")
    │              ├─ Append to daily_log_2026-02-07.md
    │              ├─ Embed → 384-dim vector
    │              └─ Upsert into SQLite chunks table
    │
    ├─ 4. On successful flush → Trigger Curation (fire-and-forget):
    │      │
    │      └─ asyncio.create_task(curate_device_memory(device_mac))
    │          │
    │          ├─ Read existing profile.md
    │          ├─ Read last 3 days of daily_log_*.md
    │          │
    │          ├─ _llm_curate(profile, logs)
    │          │   ├─ Groq API (llama-3.1-8b-instant, temp=0.2)
    │          │   ├─ Prompt: "Merge new facts from logs into profile markdown.
    │          │   │           Sections: About, Preferences, Important Facts,
    │          │   │           Learning Progress, Notes"
    │          │   └─ Returns updated markdown profile
    │          │
    │          ├─ backend.write_file(mac, "profile", updated_markdown)
    │          │   → memory/files/6825ddbbf3a0/profile.md (overwritten)
    │          │
    │          └─ memory_service.reindex(mac)
    │              ├─ Read profile.md → chunk → embed
    │              ├─ Read last 30 days of daily logs → chunk → embed
    │              ├─ backend.replace_all_chunks(mac, all_new_chunks)
    │              │   → DELETE FROM chunks; INSERT all; FTS5 rebuild
    │              └─ Full index rebuilt with updated profile + all logs
    │
    └─ 5. Cleanup: close session, disconnect room, delete LiveKit room
```

---

## On-Disk Storage Layout

```
memory/
├── db/
│   ├── 6825ddbbf3a0.sqlite          # Device 1 vector store
│   │   ├── chunks (table)            # text, embedding BLOB, content_hash, category
│   │   └── chunks_fts (FTS5)         # Full-text search index
│   └── aabb11223344.sqlite           # Device 2 vector store
│
└── files/
    ├── 6825ddbbf3a0/
    │   ├── profile.md                 # Curated child profile (updated by curator)
    │   ├── daily_log_2026-02-07.md    # Today's session facts
    │   ├── daily_log_2026-02-06.md    # Yesterday's facts
    │   └── daily_log_2026-02-05.md    # ...
    └── aabb11223344/
        └── ...
```

### SQLite Schema (per device)

```sql
CREATE TABLE chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    file_path TEXT,
    start_line INTEGER,
    end_line INTEGER,
    embedding BLOB,              -- 384 floats packed as bytes
    category TEXT DEFAULT 'general',
    timestamp TEXT,
    content_hash TEXT UNIQUE      -- MD5 hash for dedup
);

CREATE INDEX idx_chunks_category ON chunks(category);
CREATE INDEX idx_chunks_hash ON chunks(content_hash);

CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content=chunks, content_rowid=id);
```

---

## Component Files

```
src/memory/
├── __init__.py              # Public API exports
├── embedder.py              # sentence-transformers wrapper (384-dim vectors)
├── chunker.py               # Markdown → chunks with overlap
├── hybrid_search.py         # BM25 + cosine vector merge
├── memory_service.py        # Main service (singleton)
├── memory_tools.py          # @function_tool for LiveKit agents
├── fact_extractor.py        # LLM fact extraction via Groq
├── curator.py               # Daily log → profile curation
├── migrate_to_qdrant.py     # SQLite → Qdrant migration script
└── backends/
    ├── __init__.py
    ├── base.py              # Abstract MemoryBackend ABC
    ├── sqlite_backend.py    # Tier 1: Per-device SQLite + FTS5
    └── qdrant_backend.py    # Tier 2: Qdrant collection + Supabase files
```

---

## Data Flow Summary

| Stage | When | What Happens | Storage Affected |
|-------|------|-------------|------------------|
| **Init** | Session start | Create SQLite DB + tables, seed profile.md, embed+index profile | `{mac}.sqlite`, `profile.md` |
| **Load** | Session start | Broad search for context, return to prompt template | Read-only |
| **Tool: Search** | Mid-conversation | Vector + FTS5 → hybrid score → return top matches | Read-only |
| **Tool: Write** | Mid-conversation | Append to daily log + embed+upsert chunk | `daily_log_{date}.md`, `chunks` table |
| **Keyword inject** | Mid-conversation | Proactive search on trigger phrases → inject into LLM context | Read-only |
| **Flush** | Session end | Format chat → Groq extracts facts → write each fact | `daily_log_{date}.md`, `chunks` table |
| **Curate** | After flush | Groq merges logs → updates profile → full reindex | `profile.md`, `chunks` table (full rebuild) |

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
    supabase_url: "https://your-project.supabase.co"
    supabase_key: "your-service-role-key"
```

---

## Scalability Path

| Tier | Devices | Backend | Latency | Cost |
|------|---------|---------|---------|------|
| 1 (current) | < 500 | SQLite per device | < 50ms | $0 |
| 2 (ready) | 500 - 10K | Qdrant + Supabase | < 100ms | $25-100/mo |
| 3 (future) | 10K+ | Sharded Qdrant + Redis cache | < 100ms | Scales with infra |

Switch tiers by changing `backend: "sqlite"` to `backend: "qdrant"` in config. The `MemoryBackend` abstraction ensures zero code changes in workers or tools.
