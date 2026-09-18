# Child Memory Storage Review

Date: 2026-09-18
Scope: `D:\cheeko-backend` (manager API, Postgres) and `D:\picoclaw` (production LiveKit voice agent)

## 1. Should we adopt a graph database or OpenViking?

**No, not now. Stay on Postgres.**

- No verified production use of a graph database for voice-agent or companion memory was found. Zep, Neo4j, FalkorDB and Memgraph offer vendor claims and demos only, with no named voice customer.
- Mem0, the best-known "graph memory" product, dropped its external graph store in April 2026. It now uses entity extraction plus hybrid search on a regular vector store, which can be pgvector.
- Every memory benchmark (LoCoMo, LongMemEval, DMR) was run by a vendor, and Zep and Mem0 publicly disputed each other's scores.
- OpenViking is a context store (a virtual filesystem with vector search), not a graph database. It would add:
  - a separate Python server
  - a VLM plus embedding models
  - model calls for every session
  - an AGPLv3 licence to review
  - a second store of children's data

  No production voice deployment of it was found.

## 2. How the current memory works (picoclaw)

- After each session, a one-line summary is appended to the device's `memory/MEMORY.md` (`pkg/livekit/post_session_persistence.go:329`). The file is shared by all characters on the device.
- The prompt sees only the **10 newest** summaries (`pkg/agent/memory.go:136`), so older memories are effectively forgotten.
- On disk the file is capped to its last 64KB (`post_session_persistence.go:342`). The cut can land mid-UTF-8 character.
- The summary prompt is generic ("concise summary"), not "facts worth remembering about the child".
- There is no structured fact extraction. The server side guesses name, age and interests with regexes and hard-coded keyword lists (`manager-api-node/src/services/agent.service.js:546`).
- There is no pgvector. Qdrant is used only for RFID content search.

## 3. Why each summary is stored four times

| # | Where | Written by | Read by |
|---|---|---|---|
| 1 | `MEMORY.md` on the agent's disk | picoclaw at session end | **The prompt**: the only copy the toy "remembers" from |
| 2 | `device_workspace_artifacts`, a copy of the whole `MEMORY.md` file | workspace sync upload | picoclaw when a session starts on another worker |
| 3 | `voice_session_summaries`, one row per session | `saveVoiceSessionSummary` (`agent.service.js:975`) | Founder dashboard |
| 4 | `device_memory_documents` / `device_memory_chunks`: a rolling summary plus one episode document per session | `saveVoiceSessionSummary` (`:1007`) **and again** in `consolidateDeviceMemoryForSession` (`:862`) | Nothing live. Picoclaw's only reader, `fetchManagerWorkspaceBootstrap`, is called only from a test |

**Likely cause:** all four were added in two days, 22–23 April 2026 ("Add LiveKit session persistence tables", "Add device workspace artifact API", "Distill rolling voice memory summaries"). Each copy was built for a different reader, and none was declared the source of truth.

- Copy 1 follows picoclaw's file-based design.
- Copy 2 exists because LiveKit workers are temporary, so the next session may run on another machine.
- Copy 3 gives the dashboard one queryable row per session.
- Copy 4 was meant as server-managed memory (probably a Mem0 replacement) but was never connected to the prompt.
- The double merge into copy 4 is likely a safety net for the race between the summary upload and the session-end call.

**Cost:**

- The copies drift apart, and only copy 1 affects the child's experience.
- Copy 3 has no `kid_id`.
- Every copy is another place a child's data must be deleted from.

## 4. Plan to remove the duplication

### Step 1: Stop writing copy 4 (delete code)

- Remove the `saveRollingOverallMemory` call in `saveVoiceSessionSummary` (`agent.service.js:1007`).
- Remove `consolidateDeviceMemoryForSession` and its call in `endVoiceSession` (`:922`).
- Remove `buildRollingOverallMemory` and its regex and keyword lists.
- Then delete the existing `device_memory_documents` / `device_memory_chunks` rows.
- **Check first:** `GET /device/:mac/memory` (`agent.routes.js:644`) returns this data. Nothing in these two repos calls it, but the mobile app or admin dashboard might. Search the app code or the API request logs for that path before deleting anything.

### Step 2: Make `voice_session_summaries` the official record

- Add a `kid_id` column and fill it for existing rows from `voice_sessions.kid_id`.
- Have picoclaw send the model name with each summary (today `model` is always null).

### Step 3 (later, together with `child_facts`): make `MEMORY.md` a cache

- Copies 1 and 2 are one file plus its server backup, and that part works. Leave it for now.
- When the `child_facts` work lands, the server generates the memory section from the database at session start, and picoclaw stops appending to the file.

**Result:** one table plus one synced file. Deleting a child means removing their `voice_session_summaries` rows and their `device_workspace_artifacts` rows.

## 5. Why deletion is a legal problem, not a feature

- A feature adds something that doesn't exist yet. The app already has a "delete child" action, and it doesn't do what it promises.
- The three delete-child paths (`mobile.service.deleteKid`, `profile.service.deleteKid`, `admin.service.deleteKidProfile`) delete only the profile.
- They leave behind:
  - rows keyed `owner_key = 'kid:<id>'` (orphaned, because the FK sets `kid_id` to null but the owner key still names the child)
  - transcripts and answer logs
  - `kid_content_seen`, `kid_wonder_question`, character state and progress
  - S3 images
- No retention or expiry job exists for transcripts or sessions.
- Summary text is written to info-level logs (`agent.routes.js:757`, `agent.service.js:1005`).

The law (not legal advice; confirm with counsel for your markets):

- **COPPA (US):** the amended rule has been fully enforceable since 22 April 2026. It requires a written retention policy with a specific deletion timeframe, bans indefinite retention, and gives parents the right to have their child's data deleted. The FTC fines per violation.
- **DPDP Act (India):** children's data needs verifiable parental consent, and data must be erased on request or once it is no longer needed. The rules are being phased in, so check the dates.

Fixing this first also gives every later memory design a deletion path from day one.

## 6. What good Postgres memory looks like (industry practice)

| Technique | Used by | Cheeko today |
|---|---|---|
| Extract individual facts as rows, merge duplicates | Mem0, ChatGPT saved memories, Character.ai Facts | Regex and keyword lists |
| A small profile always in the prompt, loaded at session start | Letta core memory, ChatGPT | `USER.md` plus the 10 newest summaries |
| Search older memory by meaning, with pgvector | Letta, Mem0 | None |
| Dated facts, so newer facts replace older ones | Mem0 2026, Zep | Summaries are dated, facts are not |
| Retention policy, auto-expiry, parent deletion | Curio (90-day auto-delete) | None |

## 7. The `child_facts` table

### The problem it solves

Today memory is free-text summaries such as:

> "2026-08-02 [Cheeko]: Aarav talked about his dog Bruno and asked why the sky is blue. He was excited about his birthday next week."

- The prompt sees only the newest 10 summaries. After 11 sessions, "dog Bruno" is gone.
- The same fact repeats across many summaries, which wastes prompt space.
- Nothing notices when a fact changes, such as a renamed pet or "loves dinosaurs" becoming "loves space now".

With `child_facts`, "has a dog named Bruno" is stored **once**, with a date, and stays until it is out of date.

### Schema

```sql
create table child_facts (
  id             bigserial primary key,
  kid_id         bigint not null references kid_profile(id) on delete cascade,
  category       text not null,        -- 'family' | 'pet' | 'likes' | 'dislikes' | 'school' | 'event' | 'other'
  subject        text not null,        -- short key used for de-dup: 'dog', 'favourite_colour', 'sister'
  fact           text not null,        -- the sentence the prompt sees: 'Has a dog named Bruno'
  first_seen     timestamptz not null default now(),
  last_seen      timestamptz not null default now(),
  source_session text,                 -- session_id it came from, for debugging and parent view
  expires_at     timestamptz,          -- null = keep; set for time-bound facts ('birthday next week')
  unique (kid_id, category, subject)
);
```

- **`on delete cascade`:** deleting the child removes their facts automatically.
- **`unique (kid_id, category, subject)`:** removes duplicates. Each child has one row for "pet/dog". A new mention updates that row or refreshes its date and never adds a second row.
- **`last_seen`:** how recently the child mentioned it. The prompt picks the most recently mentioned facts first.
- **`expires_at`:** time-bound facts such as "my birthday is next Friday" drop out once they no longer apply.

### Example rows

| category | subject | fact | last_seen |
|---|---|---|---|
| pet | dog | Has a dog named Bruno | 2026-09-15 |
| family | sister | Has a younger sister, Meera | 2026-09-10 |
| likes | topic | Loves space and rockets (used to love dinosaurs) | 2026-09-17 |
| school | teacher | Teacher is Mrs. Rao | 2026-08-20 |
| event | birthday | Birthday on 25 Sept | 2026-09-12 (expires 2026-09-26) |

### Write path (after each session)

The manager API has no LLM client, so the model call lives in picoclaw next to the session summary (`pkg/livekit/child_facts.go`). The API owns validation and storage (`src/services/child-facts.service.js`).

1. The session ends and picoclaw writes the summary. On a preempted handoff both are skipped.
2. picoclaw reads the child's known facts (`GET /agent/device/:mac/facts`). An unpaired device has no child, so it stops here and makes no model call.
3. picoclaw makes **one** model call with the summary, the remaining turns and the known facts:
   > "Here is what we know about the child, and today's conversation. Return JSON of facts to add or update: `{category, subject, fact, expires_at?}`. Only lasting personal facts the child said about themselves. Do not store anything about other people's private details, health, or location."
4. picoclaw sends the result (`PUT /agent/device/:mac/sessions/:sessionId/facts`). The API cleans every field, caps it at 20 facts, drops expired or unparseable dates, and upserts on `(kid_id, category, subject)`. A new fact inserts a row. A changed fact rewrites `fact` and moves `last_seen` forward, keeping `first_seen`.

This replaces the regex and keyword code that was in `agent.service.js`. It runs after the session ends, so the conversation never slows down. The "never store" list is enforced only by the prompt; the parent view is the backstop.

### Read path (at session start)

```sql
select fact from child_facts
where kid_id = $1 and (expires_at is null or expires_at > now())
order by last_seen desc
limit 20;
```

The result is added to the prompt as a short block:

```
## What you know about Aarav
- Has a dog named Bruno
- Has a younger sister, Meera
- Loves space and rockets (used to love dinosaurs)
- Birthday on 25 Sept
```

- About 150–300 tokens: smaller than 10 full summaries, and nothing is lost after 10 sessions.
- Fetched once at session start, together with the last 2–3 summaries for "what did we talk about last time".

### Deliberately left out

- **Embeddings / pgvector:** a child has roughly 20–100 facts, and the newest 20 cover almost everything. Add a vector column only if the toy still forgets things a child cares about.
- **Confidence scores or a history of old versions:** the bracketed note ("used to love dinosaurs") covers the one change that matters in conversation.
- **Per-character facts:** facts belong to the child, so Cheeko and Quizzy both know about Bruno. Add a `character` column only if a character should keep its own secrets.

### Decide before building

1. **What must never be stored:** health, full address, school location, other children's surnames. The extraction prompt refuses these, and the parent view shows everything that is stored.
2. **Parent view and delete:** list and delete per row. Build it early, because it is also what makes this acceptable under COPPA.
3. **Language:** children speak Hindi, English or a mix. Store facts in one language (English recommended) so duplicates still match.

## 8. Recommended order

1. **Deletion and retention:** one delete-child function covering every per-child table, `kid:<id>` rows, workspace files and S3, plus an expiry job for transcripts and old sessions.
2. **Remove duplicate summary storage:** Section 4, steps 1–2.
3. **`child_facts` table:** child, category, fact, first/last seen, source session. After each session, one model call extracts facts and merges duplicates. This replaces the regex code.
4. **Compact profile at session start:** top facts plus the last 2–3 sessions, fetched once per session and never per turn.
5. **pgvector on `child_facts`** only if forgetting persists after that. Consider a graph database only for real multi-step relationship questions, tested on your own transcripts.

### Status (branch `child-memory-cleanup`)

| Item | State |
|---|---|
| 1. Deletion | Done. `kid-data.service.js` `purgeKidData` runs inside every delete path (mobile kid, mobile account, web profile, admin). Deletes what the child said and progressed through, detaches usage counters and session rows, sweeps Imagine pictures from S3 after the commit. |
| 1. Retention | Built, **off**. Set `CHILD_DATA_RETENTION_DAYS` to enable a daily 03:30 expiry of transcripts, summaries, attempt transcripts, legacy chat history and facts not mentioned within the window. The number is a legal/product decision. |
| 2. Duplicate summaries | Steps 1–2 done. Step 3 (MEMORY.md as a DB cache) not started. |
| 3. `child_facts` | Done: table, API, extraction in picoclaw. |
| 4. Profile at session start | Done: picoclaw writes the newest 20 facts to `memory/state/child_facts.md` once per session; never synced back. |
| 5. pgvector | Not needed yet. |

Still open: a parent view to list and delete facts; worker-local workspace copies (`MEMORY.md` on LiveKit worker disks) are not reached by the server-side delete; old `device_memory_documents` rows and their read endpoints can be removed once confirmed unused.

## Sources

- Mem0 v3 algorithm: https://docs.mem0.ai/migration/platform-v2-to-v3 and https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm
- Mem0 paper: https://arxiv.org/abs/2504.19413
- Zep paper: https://arxiv.org/abs/2501.13956
- Zep scaling: https://blog.getzep.com/scaling-agent-memory-zep-30x/
- Zep LiveKit integration: https://blog.getzep.com/zep-livekit/
- Zep vs Mem0 dispute: https://github.com/getzep/zep-papers/issues/5
- Letta / MemGPT: https://docs.letta.com/letta-memgpt
- ChatGPT memory: https://openai.com/index/memory-and-new-controls-for-chatgpt/
- Character.ai memory: https://blog.character.ai/helping-characters-remember-what-matters-most/
- OpenViking: https://github.com/volcengine/OpenViking
- COPPA amended rule: https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule
- COPPA retention analysis: https://www.fenwick.com/insights/publications/what-the-amended-coppa-rule-means-for-data-retention-practices
- Curio: https://heycurio.com/blog/inside-curio-s-app-connected-ai-toys-how-the-technology-works
- Miko: https://www.nbcnews.com/tech/security/ai-toy-maker-exposed-thousands-responses-kids-senators-miko-rcna258326
