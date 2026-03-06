# Token Optimization & Context Truncation Strategy

**Date:** 2026-03-06
**Status:** Design
**Component:** livekit-server (cheeko_worker.py, prompt templates)
**Related:** [Edge Cases Doc](2026-03-06-cheeko-agent-edge-cases.md) - Issues 6.13

---

## Problem Statement

Production metrics for a single Gemini Realtime turn show:

```
input=9,702 (audio=252, text=9,450, cached=0)
output=186 (audio=186, text=0)
total=9,888, ttft=1.01s, duration=8.17s, tokens/s=22.8
```

Two problems compound each other:

1. **Static overhead is high** — The system prompt (~5,100 tokens) plus tool definitions (~1,000 tokens) consume ~6,100 tokens before any conversation begins
2. **History grows without bound** — No `truncate()` or `_summarize()` is applied, so each turn adds to the context linearly

After ~10 turns of conversation, the context approaches 10K+ text tokens per turn. Long sessions (30+ turns) will hit 20K+ tokens, increasing cost and degrading TTFT.

---

## Token Budget Breakdown (Current)

| Component | Tokens | % of 9,450 | Growth |
|-----------|--------|-------------|--------|
| System prompt (rendered) | ~5,100 | 54% | Static |
| Tool definitions (Google Search) | ~1,000 | 11% | Static |
| Conversation history | ~3,100+ | 33% | Unbounded |
| Audio tokens | 252 | 3% | Per-turn |

### System Prompt Anatomy

The Cheeko prompt is a Jinja2 template stored in the `ai_agent.system_prompt` database field. It contains 15 XML sections:

| Section | Est. Tokens | Used When |
|---------|-------------|-----------|
| `<identity>` + child profile | ~400 | Every session (core personality) |
| `<ownership_and_secrets>` | ~150 | When child asks "who made you" |
| `<sensitive_topics>` | ~250 | When child mentions sensitive content |
| `<child_context>` | ~100 | Every session (personalization) |
| `<age_based_adaptation>` | ~200 | Every session (tone calibration) |
| `<core_directive_no_boring_answers>` | ~150 | Every session (response style) |
| `<language_and_culture>` | ~200 | Every session (cultural context) |
| `<personality_guidelines>` | ~100 | Every session (character traits) |
| `<google_search_directive>` | ~100 | Every session (tool usage rules) |
| `<voice_and_tone>` | ~80 | Every session (speech style) |
| **Always-included but rarely used:** | | |
| `<storytelling_rules>` | ~250 | Only when child asks for a story |
| `<spelling_accuracy>` | ~170 | Only when child asks to spell |
| `<rhymes_and_songs>` | ~200 | Only when child asks for songs |
| `<phonics_instruction>` | ~300 | Only when child asks for phonics |
| `<example_dialogues>` | ~150 | Never triggered (training examples) |
| **Mem0 memories** (if injected) | ~200-500 | When memories exist for child |

### What Is NOT A Problem

**Age group conditionals are efficient.** The Jinja2 template uses `{% if child_age|int <= 6 %}` blocks — only the matching age bracket renders. A 7-year-old's prompt includes only "Curious Spark Mode", not the 4-6 or 10-12 sections. No tokens are wasted on unused age groups.

---

## Strategy: Two-Pronged Optimization

### Prong 1: Runtime Context Truncation

**Goal:** Cap conversation history growth to prevent unbounded token accumulation.

#### Available LiveKit APIs

1. **`ChatContext.truncate(max_items=N)`** (public API)
   - Keeps the last N items in the chat context
   - Preserves the first system/developer instruction message
   - Removes leading orphan function calls (tool calls without responses)
   - Mutates in-place, returns nothing

2. **`ChatContext._summarize(llm, keep_last_turns=N)`** (private API)
   - Uses an LLM to compress older conversation turns into a summary
   - Keeps the last N turns untouched for recency
   - Marks summaries with `extra={"is_summary": True}` to avoid re-summarizing
   - Useful for very long sessions where raw truncation loses too much context

#### Safety: Chat History Saving Is Unaffected

The `extract_and_send_chat_history()` function in `entrypoint_utils.py` (line 488) uses `session.history`, NOT `session.chat_ctx`:

```python
chat_ctx = getattr(session, 'history', None)
items = getattr(chat_ctx, 'items', []) if chat_ctx else []
```

`session.history` is the complete record of all conversation items. `session.chat_ctx` is the working context sent to the LLM. Truncating `chat_ctx` does NOT affect `history`. Chat history saving is safe.

#### Trigger Mechanism

**Option A: `conversation_item_added` event (recommended)**
- Fires every time a new item is added to the chat context
- Check item count periodically (e.g., every 10 items) and call `truncate()`
- Works with Gemini's built-in VAD (no agent-side turn detection needed)

**Option B: `on_user_turn_completed` callback**
- Fires after each complete user turn
- More semantically correct (trim after a full exchange)
- **Caveat:** Requires agent-side turn detection. With Gemini Realtime's built-in VAD, turn boundaries are managed server-side, and this callback may not fire reliably

#### Recommended Configuration

```python
# In cheeko_worker.py, after session is created:

item_count = 0

@session.on("conversation_item_added")
def on_item_added(item):
    nonlocal item_count
    item_count += 1
    if item_count % 10 == 0:  # Every 10 items
        session.chat_ctx.truncate(max_items=30)
        logger.info(f"Truncated chat context to max 30 items (total added: {item_count})")
```

**Why `max_items=30`:**
- 1 system instruction + ~14 turn pairs (user + assistant) = ~29 items
- Keeps ~7 minutes of conversation context at typical pace
- Balances recency vs. context preservation

#### Optional: Summarization for Long Sessions

For sessions exceeding 20 minutes, raw truncation may lose important context. Add summarization as a second tier:

```python
# After truncation, if session is long:
if item_count > 60:  # ~30 turns, ~15 minutes
    await session.chat_ctx._summarize(
        llm=openai.LLM(model="gpt-4o-mini"),  # or gemini-2.0-flash
        keep_last_turns=5
    )
```

**Cost:** One cheap LLM call (~2K input tokens) every ~30 turns. Negligible vs. the savings.

---

### Prong 2: On-Demand Prompt Sections

**Goal:** Reduce static prompt size by loading specialized instructions only when needed.

#### Sections to Make On-Demand

These 5 sections total ~1,070 tokens and are only relevant when the child explicitly requests the feature:

| Section | Tokens | Trigger Keywords |
|---------|--------|------------------|
| `<storytelling_rules>` | ~250 | "story", "tell me a story", "kahani" |
| `<spelling_accuracy>` | ~170 | "spell", "spelling", "how do you spell" |
| `<rhymes_and_songs>` | ~200 | "sing", "song", "rhyme", "poem" |
| `<phonics_instruction>` | ~300 | "phonics", "teach me letters", "sounds" |
| `<example_dialogues>` | ~150 | Never needed at runtime (remove entirely) |

#### Sections That Must Stay in Base Prompt

These are needed on every turn for correct behavior:

- `<identity>` — Core personality (who Cheeko is)
- `<ownership_and_secrets>` — Must always be ready for "who made you" questions
- `<sensitive_topics>` — Must always be ready for safety filtering
- `<child_context>` — Personalization with child's name/age
- `<age_based_adaptation>` — Tone calibration
- `<core_directive_no_boring_answers>` — Response style
- `<language_and_culture>` — Cultural context
- `<personality_guidelines>` — Character traits
- `<google_search_directive>` — Tool usage rules
- `<voice_and_tone>` — Speech style

#### Implementation Approach

**Option A: Keyword-triggered injection via `conversation_item_added`**

When a user message contains trigger keywords, inject the relevant section into the chat context as a developer message before the LLM processes it:

```python
ON_DEMAND_SECTIONS = {
    "storytelling": {
        "keywords": ["story", "kahani", "tell me a story"],
        "content": "<storytelling_rules>...</storytelling_rules>"
    },
    "spelling": {
        "keywords": ["spell", "spelling"],
        "content": "<spelling_accuracy>...</spelling_accuracy>"
    },
    # ... etc
}

@session.on("conversation_item_added")
def on_item_added(item):
    if item.role == "user" and item.text_content:
        text_lower = item.text_content.lower()
        for section_name, section in ON_DEMAND_SECTIONS.items():
            if any(kw in text_lower for kw in section["keywords"]):
                session.chat_ctx.add_message(
                    role="developer",
                    content=section["content"]
                )
```

**Option B: Move sections to tool descriptions**

Define each specialized behavior as a "pseudo-tool" that Gemini can reference. This uses the existing tool definition mechanism and doesn't require keyword matching.

**Recommendation:** Option A is simpler and more predictable. Keyword matching is sufficient for these well-defined triggers.

#### `<example_dialogues>` — Remove Entirely

The example dialogues section (~150 tokens) serves no runtime purpose. These are few-shot examples that may have been useful during prompt engineering but add cost to every turn. The personality is already defined in `<identity>`, `<core_directive_no_boring_answers>`, and `<personality_guidelines>`. Remove from the database template.

---

## Expected Impact

### Token Savings Per Turn

| Scenario | Current | After Optimization | Savings |
|----------|---------|-------------------|---------|
| Turn 1 (no history) | ~6,100 | ~5,030 | ~1,070 (17%) |
| Turn 10 | ~9,100 | ~5,030 + capped history | ~3,000+ (33%) |
| Turn 30 | ~15,100+ | ~5,030 + capped history | ~9,000+ (60%) |
| Turn 30 + story request | ~15,100+ | ~5,280 + capped history | ~8,750+ (58%) |

### TTFT Improvement

Smaller context = faster first token. With Gemini Realtime:
- Current Turn 30: TTFT estimated ~2-3s (large context processing)
- After optimization Turn 30: TTFT estimated ~1-1.5s (capped context)

### Cost Reduction

At ~10 turns average per session:
- Current: ~9,450 text tokens/turn
- After: ~6,000-6,500 text tokens/turn
- **~30% reduction in per-session token cost**

---

## Implementation Priority

### Phase 1: Context Truncation (Low Risk, High Impact)
1. Add `conversation_item_added` listener with `truncate(max_items=30)`
2. Add logging to track context size before/after truncation
3. Test with real sessions — verify chat history saving still works

### Phase 2: Remove Example Dialogues (No Risk)
1. Remove `<example_dialogues>` section from database prompt template
2. Saves ~150 tokens/turn with zero behavior change

### Phase 3: On-Demand Sections (Medium Risk, Medium Impact)
1. Extract storytelling/spelling/rhymes/phonics sections from template
2. Store as on-demand content (config file or database)
3. Add keyword-triggered injection logic
4. Test each trigger path thoroughly — ensure sections inject correctly

### Phase 4: Summarization (Low Priority)
1. Add `_summarize()` call for sessions exceeding 60 items
2. Requires a cheap LLM endpoint (gpt-4o-mini or gemini-2.0-flash)
3. Only worth implementing if sessions regularly exceed 20 minutes

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Truncation removes important context | `max_items=30` keeps ~14 turn pairs; sufficient for conversational coherence |
| On-demand injection misses edge cases | Keep safety-critical sections (`<sensitive_topics>`) in base prompt always |
| Keyword matching is too simple | Start with exact substring matching; iterate based on production miss rate |
| `_summarize()` is a private API | It's well-documented in LiveKit source; pin the LiveKit agents version |
| Removing examples degrades quality | Personality is defined in 3 other sections; examples are redundant |

---

## Files to Modify

| File | Change |
|------|--------|
| `workers/cheeko_worker.py` | Add truncation listener, on-demand injection logic |
| `src/shared/entrypoint_utils.py` | Potentially add shared truncation helper |
| Database: `ai_agent.system_prompt` | Remove `<example_dialogues>`, extract on-demand sections |
| `src/prompts/cheeko.yaml` | Keep in sync with database template changes |
| `config.yaml` | Add truncation config (max_items, summarization threshold) |
