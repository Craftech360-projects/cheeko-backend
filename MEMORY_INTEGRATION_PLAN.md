# OpenClaw Memory Integration Plan for Cheeko LiveKit Agents (Python)

## Executive Summary

Replace Mem0 with a self-hosted, OpenClaw-inspired memory system inside the **Python LiveKit agent workers**. Memory is keyed by device MAC address, stored as Markdown + SQLite per device, with a clear scaling path from local files to Qdrant/Supabase when device count grows.

---

## Table of Contents

1. [Current State — What We're Replacing](#1-current-state)
2. [Target Architecture](#2-target-architecture)
3. [Scalability Strategy](#3-scalability-strategy)
4. [Per-MAC Memory Layout](#4-per-mac-memory-layout)
5. [Implementation Phases](#5-implementation-phases)
6. [Detailed Implementation](#6-detailed-implementation)
7. [Data Flow Diagrams](#7-data-flow-diagrams)
8. [Integration With Existing Code](#8-integration-with-existing-code)
9. [Configuration](#9-configuration)
10. [Testing & Rollout](#10-testing--rollout)

---

## 1. Current State

### What Exists Today (Python LiveKit Agents)

```
main/livekit-server/
├── workers/
│   ├── cheeko_worker.py          # Main agent   (Gemini Realtime, port 8081)
│   ├── math_tutor_worker.py      # Math game    (port 8082)
│   ├── riddle_solver_worker.py   # Riddle game  (port 8085)
│   └── word_ladder_worker.py     # Word game    (port 8086)
│
├── src/
│   ├── services/
│   │   └── mem0_service.py       # ← REPLACING THIS (Mem0 cloud dependency)
│   ├── shared/
│   │   └── entrypoint_utils.py   # parse_room_name(), render_prompt_with_profile()
│   └── prompts/
│       └── cheeko.yaml           # Jinja2 template with {{ long_term_memories }}
```

### How Memory Works Now

```
SESSION START
    │
    ├─ parse_room_name(room_name)
    │   └─ Extract device MAC: "6825ddbbf3a0" → "68:25:dd:bb:f3:a0"
    │
    ├─ Fetch from Manager API (or dispatch metadata):
    │   ├─ child_profile  (name, age, interests)
    │   ├─ long_term_memories  ← FROM MEM0 (cloud API)
    │   ├─ memory_relations    ← FROM MEM0 (graph)
    │   └─ memory_entities     ← FROM MEM0 (entities)
    │
    ├─ render_prompt_with_profile()
    │   └─ Jinja2: inject {{ long_term_memories }} into cheeko.yaml
    │
    ├─ AgentSession starts with Gemini Realtime
    │
    ├─ DURING CONVERSATION:
    │   └─ on("user_speech_committed") → MEMORY_TRIGGER_PATTERNS
    │       └─ mem0_service.search_relevant_memories(mac, query)
    │           └─ Inject via session.generate_reply(instructions=...)
    │
    └─ SESSION END:
        └─ mem0_service.add_conversation(mac, chat_history)
            └─ Fire-and-forget to Mem0 cloud
```

### Problems With Current Approach

| Problem | Impact |
|---------|--------|
| Mem0 is a **cloud dependency** | Latency, cost, vendor lock-in |
| No local fallback that actually works | `local_memory_provider.py` has no search |
| Memories are **opaque** | Can't audit what Mem0 extracted |
| No per-session daily logs | Can't see what was discussed today |
| All memory logic is **fire-and-forget** | No guarantee facts are saved |
| Single point of failure | If Mem0 API is down, no memory at all |

---

## 2. Target Architecture

### What We're Building

```
┌─────────────────────────────────────────────────────────────────────────────┐
│           CHEEKO LIVEKIT AGENT — OPENCLAW MEMORY INTEGRATION                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐        ┌─────────────────────────────────────────────┐   │
│  │ ESP32 Device │        │        MQTT Gateway (Node.js)               │   │
│  └──────┬───────┘        │  Extracts MAC, dispatches to LiveKit room   │   │
│         │ MQTT           └─────────────────┬───────────────────────────┘   │
│         └──────────────────────────────────┘                               │
│                                             │ WebRTC                       │
│                                             ▼                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │              LIVEKIT AGENT WORKER (Python)                          │   │
│  │              cheeko_worker.py / math_tutor / riddle / word_ladder   │   │
│  │                                                                     │   │
│  │  ┌───────────────────────────────────────────────────────────────┐ │   │
│  │  │                    SESSION LIFECYCLE                           │ │   │
│  │  │                                                               │ │   │
│  │  │  1. parse_room_name() → device_mac                            │ │   │
│  │  │  2. memory_service.load_context(device_mac) ← NEW             │ │   │
│  │  │  3. render_prompt_with_profile() + memory context             │ │   │
│  │  │  4. AgentSession(llm=Gemini, tools=[memory_tools])            │ │   │
│  │  │  5. Conversation loop (memory tools available)                │ │   │
│  │  │  6. memory_service.flush_session(device_mac, history)         │ │   │
│  │  └───────────────────────────────────────────────────────────────┘ │   │
│  │                              │                                      │   │
│  │                              ▼                                      │   │
│  │  ┌───────────────────────────────────────────────────────────────┐ │   │
│  │  │              MEMORY SERVICE (NEW — replaces mem0_service)     │ │   │
│  │  │              src/memory/memory_service.py                     │ │   │
│  │  │                                                               │ │   │
│  │  │  ┌──────────────────────────────────────────────────────┐    │ │   │
│  │  │  │           STORAGE BACKEND (per MAC)                   │    │ │   │
│  │  │  │                                                       │    │ │   │
│  │  │  │  ┌─ Tier 1: LOCAL (< 500 devices) ─────────────────┐│    │ │   │
│  │  │  │  │  Markdown workspace: ./memory/{mac}/              ││    │ │   │
│  │  │  │  │    ├─ MEMORY.md     (curated long-term facts)    ││    │ │   │
│  │  │  │  │    ├─ USER.md       (child profile cache)        ││    │ │   │
│  │  │  │  │    └─ daily/YYYY-MM-DD.md  (session logs)        ││    │ │   │
│  │  │  │  │  SQLite: ./memory/db/{mac}.sqlite                ││    │ │   │
│  │  │  │  │    ├─ chunks + embeddings (vector search)        ││    │ │   │
│  │  │  │  │    ├─ chunks_fts (FTS5 for BM25)                 ││    │ │   │
│  │  │  │  │    └─ embedding_cache                            ││    │ │   │
│  │  │  │  └──────────────────────────────────────────────────┘│    │ │   │
│  │  │  │                                                       │    │ │   │
│  │  │  │  ┌─ Tier 2: QDRANT (500–10K devices) ──────────────┐│    │ │   │
│  │  │  │  │  Qdrant collection: "cheeko_memories"            ││    │ │   │
│  │  │  │  │    ├─ Vectors with mac_id payload filter         ││    │ │   │
│  │  │  │  │    └─ Shared cluster (already deployed)          ││    │ │   │
│  │  │  │  │  Supabase: device_memories table                 ││    │ │   │
│  │  │  │  │    └─ Markdown content stored as rows            ││    │ │   │
│  │  │  │  └──────────────────────────────────────────────────┘│    │ │   │
│  │  │  │                                                       │    │ │   │
│  │  │  │  ┌─ Tier 3: MULTI-NODE (10K+ devices) ─────────────┐│    │ │   │
│  │  │  │  │  Qdrant sharded collection                       ││    │ │   │
│  │  │  │  │  Supabase with row-level security per device     ││    │ │   │
│  │  │  │  │  Redis cache for hot memories                    ││    │ │   │
│  │  │  │  └──────────────────────────────────────────────────┘│    │ │   │
│  │  │  └──────────────────────────────────────────────────────┘    │ │   │
│  │  │                                                               │ │   │
│  │  │  ┌──────────────────────────────────────────────────────┐    │ │   │
│  │  │  │           MEMORY TOOLS (registered with AgentSession) │    │ │   │
│  │  │  │                                                       │    │ │   │
│  │  │  │  @function_tool memory_search(query) → snippets      │    │ │   │
│  │  │  │  @function_tool memory_write(fact, category) → saved  │    │ │   │
│  │  │  │                                                       │    │ │   │
│  │  │  │  (Gemini calls these autonomously during conversation)│    │ │   │
│  │  │  └──────────────────────────────────────────────────────┘    │ │   │
│  │  └───────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Scalability Strategy

### The Question: "Per MAC ID — Does It Scale?"

**Short answer: Yes**, with a tiered approach.

### Tier Breakdown

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SCALABILITY TIERS                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  TIER 1: LOCAL SQLite (start here)                                          │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                                          │
│  Capacity:    Up to ~500 devices                                            │
│  Storage:     1 SQLite file per MAC  (~1–5 MB each)                         │
│  Disk total:  ~500 devices × 5 MB = 2.5 GB                                 │
│  Search:      Local cosine similarity + FTS5 BM25                           │
│  Latency:     <50ms per search (all in-process)                             │
│  Cost:        $0 (embeddings cached, only API cost on new text)             │
│  Pros:        Zero infrastructure, works offline, no vendor lock-in         │
│  Cons:        Single-server, no cross-node sharing                          │
│                                                                             │
│  When to move up:                                                           │
│  ├─ Disk usage > 5 GB                                                       │
│  ├─ Running multiple agent servers (horizontal scaling)                     │
│  └─ Need cross-server memory access                                         │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  TIER 2: QDRANT + SUPABASE (scale out)                                      │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                                      │
│  Capacity:    500 – 10,000 devices                                          │
│  Storage:     Single Qdrant collection, filtered by mac_id payload          │
│  Search:      Qdrant vector search + payload filtering                      │
│  Latency:     <100ms (network round-trip to Qdrant cloud)                   │
│  Cost:        Qdrant cloud tier ($25–100/mo) + Supabase free/pro            │
│  Pros:        Horizontal scaling, shared across agent servers               │
│  Cons:        Network dependency, slightly higher latency                   │
│                                                                             │
│  Qdrant collection schema:                                                  │
│  ┌───────────────────────────────────────────┐                              │
│  │  collection: "cheeko_memories"             │                              │
│  │  vector_size: 1536                         │                              │
│  │  distance: Cosine                          │                              │
│  │                                            │                              │
│  │  payload:                                  │                              │
│  │    mac_id:    "68:25:dd:bb:f3:a0"          │                              │
│  │    text:      "Loves dinosaurs..."         │                              │
│  │    file_path: "MEMORY.md"                  │                              │
│  │    category:  "preference"                 │                              │
│  │    timestamp: "2025-01-15T10:30:00Z"       │                              │
│  │    start_line: 5                           │                              │
│  │    end_line:   8                           │                              │
│  └───────────────────────────────────────────┘                              │
│                                                                             │
│  Query with MAC filter:                                                     │
│    qdrant.search(                                                           │
│      collection="cheeko_memories",                                          │
│      query_vector=embed(query),                                             │
│      query_filter=Filter(must=[                                             │
│          FieldCondition(key="mac_id", match=MatchValue(value=mac))          │
│      ]),                                                                    │
│      limit=6                                                                │
│    )                                                                        │
│                                                                             │
│  Supabase table for Markdown content:                                       │
│  ┌───────────────────────────────────────────┐                              │
│  │  device_memories                           │                              │
│  │    id          UUID PRIMARY KEY            │                              │
│  │    mac_id      TEXT NOT NULL (indexed)      │                              │
│  │    file_type   TEXT (memory/daily/user)     │                              │
│  │    file_date   DATE (for daily logs)        │                              │
│  │    content     TEXT                         │                              │
│  │    updated_at  TIMESTAMPTZ                  │                              │
│  └───────────────────────────────────────────┘                              │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  TIER 3: SHARDED (10K+ devices)                                             │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                                           │
│  Same as Tier 2 but with:                                                   │
│  ├─ Qdrant sharded collection (auto-scales)                                 │
│  ├─ Supabase with RLS (row-level security) per device                       │
│  ├─ Redis/Valkey cache for hot device memories (TTL: 30 min)                │
│  └─ Background job: nightly MEMORY.md curation per device                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Storage Math Per Device

```
Per child (1 year of daily use):
  MEMORY.md          ~  5 KB  (curated facts, stays small)
  USER.md            ~  1 KB  (profile)
  daily/*.md         ~ 365 files × 2 KB avg = 730 KB
  SQLite (chunks)    ~ 2 MB   (embeddings are ~6 KB per chunk)
  ─────────────────────────────
  Total per device   ~ 3 MB/year

At 1,000 devices:    ~ 3 GB/year   ← Tier 1 handles this fine
At 10,000 devices:   ~ 30 GB/year  ← Move to Tier 2 (Qdrant)
At 100,000 devices:  ~ 300 GB/year ← Tier 3 (sharded Qdrant)
```

### Backend Abstraction (swap without code changes)

```python
# src/memory/backends/base.py
class MemoryBackend(ABC):
    @abstractmethod
    async def search(self, mac_id: str, query_embedding: list, limit: int) -> list: ...

    @abstractmethod
    async def upsert_chunks(self, mac_id: str, chunks: list) -> None: ...

    @abstractmethod
    async def read_file(self, mac_id: str, file_type: str, date: str = None) -> str: ...

    @abstractmethod
    async def write_file(self, mac_id: str, file_type: str, content: str, ...) -> None: ...

# src/memory/backends/sqlite_backend.py   ← Tier 1
# src/memory/backends/qdrant_backend.py   ← Tier 2/3
```

Switch via config:
```yaml
# config.yaml
memory:
  backend: "sqlite"       # "sqlite" | "qdrant"
  sqlite:
    base_path: "./memory"
  qdrant:
    url: "https://your-cluster.qdrant.io"
    api_key: "..."
    collection: "cheeko_memories"
```

---

## 4. Per-MAC Memory Layout

### Tier 1 (Local) — Disk Structure

```
main/livekit-server/memory/
│
├── 6825ddbbf3a0/                     # MAC: 68:25:dd:bb:f3:a0
│   ├── MEMORY.md                     # Curated long-term facts
│   ├── USER.md                       # Child profile (synced from API)
│   └── daily/
│       ├── 2025-02-05.md             # Yesterday's session log
│       └── 2025-02-06.md             # Today's session log
│
├── aabb11223344/                     # Another device
│   ├── MEMORY.md
│   ├── USER.md
│   └── daily/
│       └── 2025-02-06.md
│
└── db/
    ├── 6825ddbbf3a0.sqlite           # Vector store for device 1
    └── aabb11223344.sqlite           # Vector store for device 2
```

### MEMORY.md Template (per device)

```markdown
# Cheeko's Memory — {child_name}

## About {child_name}
- Name: Sarah
- Age: 7
- Interests: dinosaurs, space, drawing

## Preferences
- Favorite color: purple
- Favorite animal: T-Rex
- Favorite game: riddles

## Important Facts
- Birthday: March 15
- Has a pet cat named Whiskers
- Best friend: Riya
- Brother's name: Aarav

## Learning Progress
- Knows multiplication tables up to 5
- Learning about planets

## Notes
- Gets shy with new topics, needs encouragement
- Loves when Cheeko makes funny voices
```

### daily/YYYY-MM-DD.md Template

```markdown
# Session Log — 2025-02-06

## 10:15 AM — Session Start
- Greeted Sarah, she asked about dinosaurs
- **[PREFERENCE]** Said she now likes Stegosaurus too (not just T-Rex)
- Played riddle game, scored 4/5

## 3:30 PM — Session Start
- Homework help: math multiplication (6×7, 8×4)
- **[ACHIEVEMENT]** Got all multiplication answers correct
- **[PERSONAL]** Mentioned she has a school play next Friday
```

---

## 5. Implementation Phases

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    IMPLEMENTATION PHASES (LiveKit Python)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PHASE 1: Memory Service Core (Week 1–2)                                    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                                   │
│  ├─ Create src/memory/ Python module                                        │
│  ├─ Implement MemoryService class (replaces mem0_service.py)                │
│  ├─ SQLite backend with FTS5 + vector search                                │
│  ├─ Embeddings via sentence-transformers (already installed)                │
│  ├─ Markdown workspace: read/write MEMORY.md, USER.md, daily logs          │
│  └─ Backend abstraction layer (for Tier 2 swap later)                       │
│                                                                             │
│  PHASE 2: LiveKit Agent Integration (Week 2–3)                              │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                              │
│  ├─ Create @function_tool memory_search and memory_write                    │
│  ├─ Modify cheeko_worker.py:                                                │
│  │   ├─ Replace mem0_service calls with memory_service                      │
│  │   ├─ Load memory context at session start                                │
│  │   ├─ Register memory tools with AgentSession                             │
│  │   └─ Flush session summary on disconnect                                 │
│  ├─ Update cheeko.yaml prompt template for new memory format                │
│  └─ Wire into all 4 workers (cheeko, math, riddle, word_ladder)             │
│                                                                             │
│  PHASE 3: Session Flush & Fact Extraction (Week 3–4)                        │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                        │
│  ├─ On session end: extract key facts from chat history                     │
│  ├─ Append session summary to daily/YYYY-MM-DD.md                           │
│  ├─ Periodic curation: LLM summarizes daily logs → MEMORY.md               │
│  └─ Re-index changed files into SQLite                                      │
│                                                                             │
│  PHASE 4: Qdrant Backend (Week 4–5) — For Scale                            │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                           │
│  ├─ Implement QdrantBackend (qdrant_backend.py)                             │
│  ├─ Single "cheeko_memories" collection, filtered by mac_id                 │
│  ├─ Supabase table for Markdown content (device_memories)                   │
│  ├─ Migration script: local SQLite → Qdrant + Supabase                     │
│  └─ Config toggle: backend = "sqlite" | "qdrant"                            │
│                                                                             │
│  PHASE 5: Testing & Rollout (Week 5–6)                                      │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                                      │
│  ├─ Unit tests (memory_service, search, write, flush)                       │
│  ├─ Integration test with real LiveKit session                              │
│  ├─ Remove mem0_service.py + mem0ai dependency                              │
│  ├─ Staged rollout: 5 test devices → 10% → 100%                            │
│  └─ Monitor search latency, embedding cost, disk usage                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Detailed Implementation

### New File Structure

```
main/livekit-server/
├── src/
│   ├── memory/                              # ← NEW MODULE
│   │   ├── __init__.py
│   │   ├── memory_service.py                # Main service (replaces mem0_service.py)
│   │   ├── memory_tools.py                  # @function_tool definitions for LiveKit
│   │   ├── chunker.py                       # Markdown → 400-token chunks
│   │   ├── embedder.py                      # sentence-transformers wrapper
│   │   ├── hybrid_search.py                 # BM25 + vector scoring
│   │   └── backends/
│   │       ├── __init__.py
│   │       ├── base.py                      # Abstract backend interface
│   │       ├── sqlite_backend.py            # Tier 1: local SQLite + FTS5
│   │       └── qdrant_backend.py            # Tier 2: Qdrant + Supabase
│   │
│   ├── services/
│   │   ├── mem0_service.py                  # ← DELETE after migration
│   │   └── ...
│
├── memory/                                   # ← NEW: on-disk workspaces
│   ├── {mac_normalized}/
│   │   ├── MEMORY.md
│   │   ├── USER.md
│   │   └── daily/
│   └── db/
│       └── {mac_normalized}.sqlite
```

### Key Classes

#### `memory_service.py` — Drop-in Replacement for mem0_service.py

```python
# src/memory/memory_service.py

"""
MemoryService — replaces mem0_service.py
Provides: load_context, search, write, flush_session
Keyed by device MAC address.
"""

import os, sqlite3, hashlib, json
from datetime import datetime, date
from pathlib import Path
from typing import Optional
from .chunker import chunk_markdown
from .embedder import Embedder
from .hybrid_search import hybrid_search
from .backends.base import MemoryBackend
from .backends.sqlite_backend import SQLiteBackend

class MemoryService:
    def __init__(self, config: dict):
        self.config = config
        self.base_path = Path(config.get("base_path", "./memory"))
        self.embedder = Embedder(config.get("embedding", {}))

        backend_type = config.get("backend", "sqlite")
        if backend_type == "qdrant":
            from .backends.qdrant_backend import QdrantBackend
            self.backend = QdrantBackend(config.get("qdrant", {}))
        else:
            self.backend = SQLiteBackend(self.base_path)

    def _mac_dir(self, mac: str) -> Path:
        """Normalize MAC to directory name: 68:25:dd:bb:f3:a0 → 6825ddbbf3a0"""
        normalized = mac.replace(":", "").replace("-", "").lower()
        return self.base_path / normalized

    async def initialize(self, mac: str, child_profile: dict = None):
        """Create workspace for device if first time."""
        workspace = self._mac_dir(mac)
        workspace.mkdir(parents=True, exist_ok=True)
        (workspace / "daily").mkdir(exist_ok=True)

        # Seed MEMORY.md if missing
        memory_file = workspace / "MEMORY.md"
        if not memory_file.exists():
            name = (child_profile or {}).get("name", "this child")
            memory_file.write_text(f"# Cheeko's Memory — {name}\n\n## Preferences\n\n## Important Facts\n\n## Learning Progress\n\n")

        # Seed or update USER.md from child_profile
        if child_profile:
            user_file = workspace / "USER.md"
            user_file.write_text(self._format_user_md(child_profile))

        # Initialize backend
        await self.backend.initialize(mac)

    # ─── CONTEXT LOADING (session start) ────────────────────────

    async def load_context(self, mac: str) -> dict:
        """Load memory context for Jinja2 prompt injection.
        Returns dict compatible with render_prompt_with_profile().
        """
        workspace = self._mac_dir(mac)

        # Read MEMORY.md → long_term_memories list
        memories = []
        memory_file = workspace / "MEMORY.md"
        if memory_file.exists():
            content = memory_file.read_text()
            memories = self._extract_bullet_points(content)

        # Read today + yesterday daily logs
        today_log = self._read_daily(workspace, date.today())
        # yesterday_log available if needed

        return {
            "long_term_memories": memories[:20],  # Cap for prompt size
            "memory_relations": [],                # Populated by search if needed
            "memory_entities": [],                 # Populated by search if needed
            "today_context": today_log[:2000],     # Recent session notes
        }

    # ─── SEARCH (during conversation) ───────────────────────────

    async def search(self, mac: str, query: str, limit: int = 5) -> list[str]:
        """Semantic + keyword search. Returns list of text snippets."""
        query_embedding = await self.embedder.embed(query)
        results = await self.backend.search(mac, query_embedding, limit * 4)

        # Hybrid re-rank: vector score + BM25
        scored = hybrid_search(query, results,
            vector_weight=0.7, text_weight=0.3)

        return [r["text"] for r in scored[:limit]]

    def format_memories_for_injection(self, query: str, memories: list[str]) -> str:
        """Format for session.generate_reply(instructions=...).
        Same interface as old mem0_service.format_relevant_memories_for_injection().
        """
        if not memories:
            return ""
        formatted = "\n".join(f"- {m}" for m in memories)
        return f"Relevant memories about this child:\n{formatted}\n\nUse these memories naturally when responding to: \"{query}\""

    # ─── WRITE (during or after conversation) ───────────────────

    async def write_fact(self, mac: str, content: str, category: str = "general"):
        """Append a fact to today's daily log and re-index."""
        workspace = self._mac_dir(mac)
        today = date.today().isoformat()
        daily_file = workspace / "daily" / f"{today}.md"

        timestamp = datetime.now().strftime("%I:%M %p")
        entry = f"\n## {timestamp}\n- **[{category.upper()}]** {content}\n"

        # Append
        with open(daily_file, "a") as f:
            f.write(entry)

        # Index the new chunk
        embedding = await self.embedder.embed(content)
        await self.backend.upsert_chunks(mac, [{
            "text": content,
            "file_path": f"daily/{today}.md",
            "embedding": embedding,
            "category": category,
            "timestamp": datetime.utcnow().isoformat(),
        }])

    # ─── SESSION FLUSH (on disconnect) ──────────────────────────

    async def flush_session(self, mac: str, chat_history: list[dict],
                            extract_with_llm=None):
        """Called on session end. Extracts key facts and saves to daily log.

        Args:
            mac: device MAC
            chat_history: list of {chatType: 1|2, content: str}
            extract_with_llm: optional async callable(prompt) → str
                              Pass the Gemini/Groq client for fact extraction.
                              If None, saves raw summary.
        """
        if not chat_history or len(chat_history) < 3:
            return

        # Format conversation
        conversation_text = "\n".join(
            f"{'Child' if m.get('chatType') == 1 else 'Cheeko'}: {m.get('content', '')}"
            for m in chat_history
            if m.get('content', '').strip()
        )

        if extract_with_llm:
            # Ask LLM to extract durable facts
            extraction_prompt = (
                "Review this conversation between Cheeko (AI) and a child. "
                "List only NEW facts worth remembering (preferences, achievements, "
                "personal info, learning progress). Format as bullet points. "
                "If nothing notable, respond with NONE.\n\n"
                f"Conversation:\n{conversation_text[:3000]}"
            )
            facts = await extract_with_llm(extraction_prompt)
            if facts and "NONE" not in facts.upper():
                await self.write_fact(mac, f"Session Summary\n{facts}", "session")
        else:
            # Save a brief raw summary
            msg_count = len(chat_history)
            await self.write_fact(mac, f"Session with {msg_count} messages", "session")

    # ─── RE-INDEX (periodic or on-demand) ───────────────────────

    async def reindex(self, mac: str):
        """Full re-index of all markdown files for a device."""
        workspace = self._mac_dir(mac)
        all_chunks = []

        for md_file in workspace.rglob("*.md"):
            content = md_file.read_text()
            rel_path = md_file.relative_to(workspace)
            chunks = chunk_markdown(content, max_tokens=400, overlap=80)

            for chunk in chunks:
                embedding = await self.embedder.embed(chunk["text"])
                all_chunks.append({
                    "text": chunk["text"],
                    "file_path": str(rel_path),
                    "start_line": chunk["start_line"],
                    "end_line": chunk["end_line"],
                    "embedding": embedding,
                })

        await self.backend.replace_all_chunks(mac, all_chunks)

    # ─── HELPERS ────────────────────────────────────────────────

    def _format_user_md(self, profile: dict) -> str:
        return (
            f"# Child Profile\n\n"
            f"- **Name:** {profile.get('name', 'Unknown')}\n"
            f"- **Age:** {profile.get('age', 'Unknown')}\n"
            f"- **Gender:** {profile.get('gender', '')}\n"
            f"- **Interests:** {profile.get('interests', '')}\n"
            f"- **Language:** {profile.get('primaryLanguage', 'English')}\n"
            f"- **Notes:** {profile.get('additionalNotes', '')}\n"
        )

    def _extract_bullet_points(self, markdown: str) -> list[str]:
        return [
            line.lstrip("- ").strip()
            for line in markdown.split("\n")
            if line.strip().startswith("- ") and len(line.strip()) > 4
        ]

    def _read_daily(self, workspace: Path, d: date) -> str:
        daily_file = workspace / "daily" / f"{d.isoformat()}.md"
        if daily_file.exists():
            return daily_file.read_text()
        return ""


# ─── SINGLETON ──────────────────────────────────────────────────
_instance: Optional[MemoryService] = None

def get_memory_service(config: dict = None) -> MemoryService:
    global _instance
    if _instance is None:
        _instance = MemoryService(config or {})
    return _instance
```

#### `memory_tools.py` — LiveKit @function_tool Definitions

```python
# src/memory/memory_tools.py

"""
LiveKit function tools for memory operations.
Register these with AgentSession so Gemini can call them autonomously.
"""

from livekit.agents import function_tool, RunContext
from .memory_service import get_memory_service

@function_tool
async def memory_search(context: RunContext, query: str) -> str:
    """Search your memory about this child. Use before answering questions
    about their preferences, past conversations, achievements, or personal info.

    Args:
        query: What to search for (e.g., "favorite animal", "birthday", "math progress")
    """
    mac = context.userdata.get("device_mac", "")
    if not mac:
        return "Memory not available for this session."

    svc = get_memory_service()
    results = await svc.search(mac, query, limit=5)

    if not results:
        return "No memories found for this query."

    formatted = "\n".join(f"- {r}" for r in results)
    return f"Found these memories:\n{formatted}"


@function_tool
async def memory_write(context: RunContext, fact: str, category: str = "general") -> str:
    """Remember an important fact about this child for future conversations.
    Use when the child shares preferences, achievements, family info, or anything
    worth remembering across sessions.

    Args:
        fact: The fact to remember (e.g., "Favorite dinosaur is Stegosaurus")
        category: One of: preference, achievement, personal, learning, game
    """
    mac = context.userdata.get("device_mac", "")
    if not mac:
        return "Memory not available for this session."

    svc = get_memory_service()
    await svc.write_fact(mac, fact, category)
    return f"Remembered: {fact}"


# Convenience: list of all memory tools for AgentSession registration
MEMORY_TOOLS = [memory_search, memory_write]
```

---

## 7. Data Flow Diagrams

### Complete Session Flow (LiveKit Agent)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                  LIVEKIT AGENT SESSION — WITH MEMORY                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │  1. SESSION START  (cheeko_worker.py entrypoint)                   │    │
│  │                                                                    │    │
│  │  room_name = "uuid_6825ddbbf3a0_conversation"                      │    │
│  │       │                                                            │    │
│  │       ▼                                                            │    │
│  │  device_mac = parse_room_name(room_name)                           │    │
│  │       │      → "68:25:dd:bb:f3:a0"                                 │    │
│  │       │                                                            │    │
│  │       ▼                                                            │    │
│  │  child_profile = get_child_profile_by_mac(mac)                     │    │
│  │       │      → { name: "Sarah", age: 7, interests: "dinosaurs" }   │    │
│  │       │                                                            │    │
│  │       ▼                                                            │    │
│  │  ┌─────────────────────────────────────────────────────────┐      │    │
│  │  │  memory_service.initialize(mac, child_profile)          │      │    │
│  │  │    ├─ Create ./memory/6825ddbbf3a0/ if first time       │      │    │
│  │  │    ├─ Write USER.md from child_profile                  │      │    │
│  │  │    └─ Open SQLite at ./memory/db/6825ddbbf3a0.sqlite    │      │    │
│  │  └─────────────────────────────────────────────────────────┘      │    │
│  │       │                                                            │    │
│  │       ▼                                                            │    │
│  │  ┌─────────────────────────────────────────────────────────┐      │    │
│  │  │  memory_context = memory_service.load_context(mac)      │      │    │
│  │  │    ├─ Read MEMORY.md → ["Loves T-Rex", "Cat: Whiskers"] │      │    │
│  │  │    ├─ Read daily/2025-02-06.md → today's earlier notes  │      │    │
│  │  │    └─ Return { long_term_memories, today_context }      │      │    │
│  │  └─────────────────────────────────────────────────────────┘      │    │
│  │       │                                                            │    │
│  │       ▼                                                            │    │
│  │  rendered_prompt = render_prompt_with_profile(                      │    │
│  │      agent_prompt = cheeko.yaml,                                   │    │
│  │      child_profile = child_profile,                                │    │
│  │      long_term_memories = memory_context["long_term_memories"],     │    │
│  │  )                                                                 │    │
│  │       │                                                            │    │
│  │       ▼                                                            │    │
│  │  session = AgentSession(                                           │    │
│  │      llm = GeminiRealtime(instructions=rendered_prompt),           │    │
│  │      tts = ElevenLabs(...),                                        │    │
│  │      tools = [update_agent_mode, memory_search, memory_write],     │    │
│  │      userdata = {"device_mac": device_mac},   ← tools need this    │    │
│  │  )                                                                 │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │  2. CONVERSATION LOOP                                              │    │
│  │                                                                    │    │
│  │  Child (voice) ──STT──▶ "Do you remember my favorite dinosaur?"    │    │
│  │       │                                                            │    │
│  │       ▼                                                            │    │
│  │  Gemini Realtime decides:                                          │    │
│  │  → tool_call: memory_search(query="favorite dinosaur")             │    │
│  │       │                                                            │    │
│  │       ▼                                                            │    │
│  │  memory_service.search("68:25:dd:bb:f3:a0", "favorite dinosaur")   │    │
│  │       │                                                            │    │
│  │       ├─ Embed query → [0.12, -0.45, ...]                          │    │
│  │       ├─ Vector search: cosine similarity on SQLite chunks          │    │
│  │       ├─ BM25 search: FTS5 keyword match                           │    │
│  │       ├─ Hybrid merge: 0.7 * vec + 0.3 * bm25                     │    │
│  │       └─ Return: ["Loves T-Rex because it's big and mighty"]       │    │
│  │       │                                                            │    │
│  │       ▼                                                            │    │
│  │  Gemini responds (voice):                                          │    │
│  │  "Of course! You told me you love the T-Rex! So big and mighty!"   │    │
│  │                                                                    │    │
│  │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │    │
│  │                                                                    │    │
│  │  Child: "My favorite color is now green, not purple!"              │    │
│  │       │                                                            │    │
│  │       ▼                                                            │    │
│  │  Gemini decides:                                                   │    │
│  │  → tool_call: memory_write(                                        │    │
│  │        fact="Favorite color changed from purple to green",         │    │
│  │        category="preference"                                       │    │
│  │    )                                                               │    │
│  │       │                                                            │    │
│  │       ▼                                                            │    │
│  │  memory_service.write_fact(mac, fact, "preference")                │    │
│  │       ├─ Append to daily/2025-02-06.md                             │    │
│  │       ├─ Embed and insert into SQLite                              │    │
│  │       └─ Return "Remembered: Favorite color changed..."            │    │
│  │       │                                                            │    │
│  │       ▼                                                            │    │
│  │  Gemini responds:                                                  │    │
│  │  "Green! That's a great color! I'll remember that!"                │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │  3. SESSION END  (on participant_disconnected)                     │    │
│  │                                                                    │    │
│  │  chat_history = extract_chat_history(session)                      │    │
│  │       │                                                            │    │
│  │       ▼                                                            │    │
│  │  memory_service.flush_session(                                     │    │
│  │      mac = device_mac,                                             │    │
│  │      chat_history = chat_history,                                  │    │
│  │      extract_with_llm = gemini_extract  # optional LLM call        │    │
│  │  )                                                                 │    │
│  │       │                                                            │    │
│  │       ├─ LLM extracts: "Favorite color now green. Got 4/5 riddles" │    │
│  │       ├─ Append to daily/2025-02-06.md as session summary          │    │
│  │       └─ Index new chunks in SQLite                                │    │
│  │                                                                    │    │
│  │  # Existing cleanup continues:                                     │    │
│  │  send_chat_history_to_api(...)                                     │    │
│  │  session.close()                                                   │    │
│  │  room.disconnect()                                                 │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Integration With Existing Code

### Files Modified

| File | What Changes |
|------|-------------|
| `workers/cheeko_worker.py` | Replace `mem0_service` imports with `memory_service`. Add `memory_tools` to AgentSession. Call `load_context()` at start, `flush_session()` at end. |
| `workers/math_tutor_worker.py` | Same pattern — memory tools available in game mode |
| `workers/riddle_solver_worker.py` | Same pattern |
| `workers/word_ladder_worker.py` | Same pattern |
| `src/shared/entrypoint_utils.py` | `render_prompt_with_profile()` already supports `long_term_memories` — no change needed |
| `src/prompts/cheeko.yaml` | Already has `{% for memory in long_term_memories %}` — works as-is |
| `config.yaml` | Add `memory:` section |
| `requirements.txt` | Remove `mem0ai==1.0.0`. Already has `sentence-transformers`, `qdrant-client`. |

### Files Deleted

| File | Why |
|------|-----|
| `src/services/mem0_service.py` | Replaced by `src/memory/memory_service.py` |

### Files Created

| File | Purpose |
|------|---------|
| `src/memory/__init__.py` | Module init |
| `src/memory/memory_service.py` | Core service (see code above) |
| `src/memory/memory_tools.py` | LiveKit `@function_tool` definitions |
| `src/memory/chunker.py` | Markdown → 400-token chunks |
| `src/memory/embedder.py` | sentence-transformers wrapper |
| `src/memory/hybrid_search.py` | BM25 + vector scoring logic |
| `src/memory/backends/base.py` | Abstract backend interface |
| `src/memory/backends/sqlite_backend.py` | Tier 1: local SQLite |
| `src/memory/backends/qdrant_backend.py` | Tier 2: Qdrant (for scale) |

### Prompt Compatibility (Zero Changes Needed)

The existing `cheeko.yaml` template already uses:
```jinja2
{% for memory in long_term_memories %}
- {{ memory }}
{% endfor %}
```

`memory_service.load_context()` returns `long_term_memories` as a list of strings — **same format** the prompt already expects. Drop-in replacement.

---

## 9. Configuration

### config.yaml Addition

```yaml
# ── Memory System ──────────────────────────────────
memory:
  enabled: true
  backend: "sqlite"                    # "sqlite" | "qdrant"
  base_path: "./memory"                # Local workspace root

  embedding:
    model: "all-MiniLM-L6-v2"         # sentence-transformers (already installed)
    # OR use OpenAI:
    # provider: "openai"
    # model: "text-embedding-3-small"
    cache_enabled: true

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
    extract_facts_with_llm: true       # Use Gemini to extract facts on session end

  # Tier 2 (only used if backend: "qdrant")
  qdrant:
    url: "${QDRANT_URL}"
    api_key: "${QDRANT_API_KEY}"
    collection: "cheeko_memories"
```

### requirements.txt Changes

```diff
  # REMOVE:
- mem0ai==1.0.0

  # ALREADY PRESENT (no changes):
  sentence-transformers
  qdrant-client
```

### Environment Variables

```bash
# Only needed for Tier 2 (Qdrant backend)
QDRANT_URL=https://your-cluster.qdrant.io
QDRANT_API_KEY=your-key

# Optional: Use OpenAI embeddings instead of local
# OPENAI_API_KEY=sk-...
```

---

## 10. Testing & Rollout

### Test Cases

| # | Test | Expected |
|---|------|----------|
| 1 | `memory_service.write_fact(mac, "Loves cats")` → `memory_service.search(mac, "pets")` | Returns "Loves cats" |
| 2 | Session end → `flush_session()` → next session `load_context()` | Previous facts appear in prompt |
| 3 | Device A writes → Device B searches | Device B finds **nothing** (isolation) |
| 4 | Write 1000 facts → search latency | < 200ms on SQLite |
| 5 | Switch `backend: "qdrant"` → same search/write behavior | Identical results |
| 6 | 50 concurrent sessions writing simultaneously | No SQLite lock errors |
| 7 | `cheeko.yaml` renders with `long_term_memories` from new service | Identical prompt format |

### Rollout Stages

```
Stage 1 (Week 1):  5 test devices, memory.enabled=true
                    Run alongside Mem0 (dual-write) for comparison
                    Verify: facts persist, search works, no crashes

Stage 2 (Week 2):  Disable Mem0, memory-only for test devices
                    Verify: no regressions, prompt quality same or better

Stage 3 (Week 3):  Enable for 50% of devices (feature flag by MAC hash)

Stage 4 (Week 4):  100% rollout, remove mem0_service.py, remove mem0ai dep
```

### Monitoring

| Metric | Source | Alert |
|--------|--------|-------|
| `memory.search_latency_ms` | Datadog / Loki | p99 > 500ms |
| `memory.write_latency_ms` | Datadog / Loki | p99 > 200ms |
| `memory.disk_usage_bytes` | OS metrics | > 5 GB total |
| `memory.embedding_cache_hit_rate` | Custom counter | < 50% (investigate) |
| `memory.search_empty_rate` | Custom counter | > 60% (search quality issue) |

---

## Summary

### What This Plan Achieves

| Before (Mem0) | After (OpenClaw-style) |
|---------------|----------------------|
| Cloud API dependency | Self-hosted, zero external calls |
| Opaque memory | Transparent Markdown files |
| ~200ms search latency (network) | ~50ms search (local SQLite) |
| $40+/mo for Mem0 API | $0 (local) or $25/mo (Qdrant at scale) |
| No daily logs | Full session history per day |
| Vendor lock-in | Open format, portable |
| Single backend | Tier 1 → Tier 2 → Tier 3 scaling path |

### Key Design Decisions

1. **Python only** — All code lives in `main/livekit-server/src/memory/`
2. **No Mem0** — Replaced entirely, dependency removed
3. **Per-MAC isolation** — Each device gets its own workspace + SQLite
4. **Scales via backend swap** — `sqlite` → `qdrant` with zero tool changes
5. **sentence-transformers** — Already installed, no new dependencies for Tier 1
6. **Existing prompt compatibility** — `long_term_memories` format unchanged
7. **LiveKit native tools** — `@function_tool` so Gemini calls them autonomously

---

*Review this plan and let me know any changes before we start implementing.*
