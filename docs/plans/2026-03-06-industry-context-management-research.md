# Industry Research: Context Management & Token Optimization in AI Assistants

**Date:** 2026-03-06
**Purpose:** Survey how open-source personal AI assistants handle context growth, token optimization, and memory management. Identify techniques applicable to Cheeko.
**Related:** [Token Optimization Design](2026-03-06-token-optimization-design.md)

---

## 1. OpenClaw (135K+ GitHub Stars)

OpenClaw is the most popular open-source AI assistant (2026). It faces the same core problem as Cheeko: every request sends the entire conversation history to the LLM, causing token costs to balloon.

### How OpenClaw Handles Context

**Auto-Compaction (triggered automatically):**
- When a session nears or exceeds the model's context window, OpenClaw triggers auto-compaction
- Older conversation history is summarized into a compact summary entry
- Recent messages are kept intact (recency buffer)
- The compacted summary typically uses **40% or less** of the original token count
- After compaction, the original request is retried with the smaller context

**Manual `/compact` command:**
- Users can trigger compaction on demand
- Preserves: key decisions, file locations, important context
- Discards: verbose intermediate steps, redundant tool outputs

**Tool Output Pruning:**
- Tool results exceeding 4,000 characters are soft-trimmed
- Default strategy: keep first 1,500 chars (head) + last 1,500 chars (tail)
- Older tool outputs beyond a protection window (~40K tokens) are replaced with short placeholders
- At least ~20K tokens must be removable before pruning activates

**Configuration (`openclaw.json`):**
```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "mode": "auto",
        "targetTokens": 150000
      }
    }
  }
}
```

**Key Insight for Cheeko:** OpenClaw's head+tail tool output trimming is directly applicable. Cheeko's Google Search results could be trimmed the same way — keep the first and last N chars, discard the middle.

### Sources
- [OpenClaw Compaction Docs](https://docs.openclaw.ai/concepts/compaction)
- [OpenClaw Token Use Reference](https://docs.openclaw.ai/reference/token-use)
- [OpenClaw Cost Optimization Guide](https://blog.laozhang.ai/en/posts/openclaw-cost-optimization-token-management)

---

## 2. CoPaw / ReMe (Alibaba AgentScope)

CoPaw is Alibaba's open-source personal AI assistant with persistent memory, built on the **ReMe** (Remember Me, Refine Me) memory management kit.

### How CoPaw Handles Context

**Token-Ratio Compaction (ContextGuard):**
- CoPaw uses a `ContextGuard` middleware in its ReAct loop
- Configurable `memory_compact_ratio` (e.g., 0.7) triggers compaction when context reaches `max_input_length * ratio`
- Example: with 128K context window and 0.7 ratio, compaction triggers at ~90K tokens

**Summarizer Component (not raw deletion):**
- When history is too long, ReMe doesn't delete old parts
- Instead, a Summarizer component compresses history into concise "meeting minutes"
- The summary is **incremental** — previous summaries are passed as input to avoid re-processing
- Summaries are written to `memory/YYYY-MM-DD.md` files asynchronously (non-blocking)

**Multi-Level Compaction:**
- **Conversation level:** Completed dialogue turns compressed to key facts + decisions
- **Tool level:** Oversized tool outputs compacted independently to prevent overflow
- **Background tasks:** Summary tasks submitted asynchronously — the main conversation continues without waiting

**DoomLoop Detection:**
- CoPaw includes a sliding-window mechanism to detect when the agent is stuck in repetitive loops
- This prevents wasted tokens on circular reasoning

**Hybrid Memory Retrieval:**
- For long-term context, ReMe uses vector search (0.7 weight) combined with keyword search
- This replaces brute-force context inclusion with targeted retrieval

**Key Insight for Cheeko:** The token-ratio trigger is smarter than a fixed item count. Instead of `truncate(max_items=30)`, Cheeko could trigger compaction at 70% of Gemini's context window. Also, the incremental summarization pattern (passing previous summary as input) prevents re-processing overhead.

### Sources
- [ReMe GitHub](https://github.com/agentscope-ai/ReMe)
- [CoPaw Website](https://copaw.bot/)
- [CoPaw on MarkTechPost](https://www.marktechpost.com/2026/03/01/alibaba-team-open-sources-copaw-a-high-performance-personal-agent-workstation-for-developers-to-scale-multi-channel-ai-workflows-and-memory/)

---

## 3. Google ADK (Agent Development Kit)

Google's official ADK provides a built-in context compaction system designed for long-running agent workflows.

### How ADK Handles Context

**Sliding Window Summarization:**
- ADK summarizes every N invocations (`compaction_interval`)
- Each summary has overlap in coverage (`overlap_size`) to prevent information loss at boundaries
- The summary is written back into the Session as a new event with a "compaction" action

**Configurable Summarizer:**
- `LlmEventSummarizer` allows specifying a dedicated model for summarization
- This decouples the summarization model from the main agent model — use a cheap/fast model for summaries

**Multi-Level Operation:**
- **Conversation level:** Summarizes completed dialogue turns, keeping key facts and user preferences
- **Workflow level:** Compacts execution traces of completed subtasks, keeping only final results
- **Tool level:** Summarizes verbose tool outputs into concise representations

**Configuration:**
```python
EventsCompactionConfig(
    compaction_interval=10,    # Summarize every 10 invocations
    overlap_size=2,            # Keep 2 events overlap between windows
    summarizer=LlmEventSummarizer(model="gemini-2.0-flash")
)
```

**Key Insight for Cheeko:** ADK's overlap strategy prevents the "boundary amnesia" problem where important context at the edge of a compaction window gets lost. Cheeko's truncation should similarly keep a few items of overlap. Also, using a separate cheap model (gemini-2.0-flash) for summarization is the standard pattern.

### Sources
- [ADK Context Compaction Docs](https://google.github.io/adk-docs/context/compaction/)
- [ADK Context Engineering Guide](https://medium.com/@juanc.olamendy/context-engineering-in-google-adk-the-ultimate-guide-to-building-scalable-ai-agents-f8d7683f9c60)
- [ADK Compaction Discussion](https://github.com/google/adk-python/discussions/3374)

---

## 4. Compaction vs Summarization (Research)

A 2026 comparison from Morph identifies three distinct approaches:

| Approach | How It Works | Compression Ratio | Hallucination Risk | Best For |
|----------|-------------|-------------------|-------------------|----------|
| **Verbatim Compaction** | Deletes tokens, keeps surviving text character-for-character | 50-70% | Zero | Technical details, file paths, code |
| **LLM Summarization** | LLM rewrites history into natural language summary | 60-80% | Medium (paraphrasing) | Conversational context, decisions |
| **Opaque Compression** | Embedding-based compression into dense vectors | 80-95% | N/A (not human-readable) | Long-term memory retrieval |

**ACON (Adaptive Context Optimization)** research demonstrated:
- 26-54% peak token reduction while preserving 95%+ accuracy
- Performance degradation accelerates beyond 30,000 tokens
- Recommendation: trigger compaction when context utilization exceeds **70% of available budget**

**Preference hierarchy (industry consensus):**
> Raw context > Verbatim compaction > Summarization (only when compaction alone doesn't yield enough space)

### Sources
- [Compaction vs Summarization Compared](https://www.morphllm.com/compaction-vs-summarization)
- [ACON Research Paper](https://arxiv.org/html/2510.00615v1)
- [Context Engineering Part 2](https://www.philschmid.de/context-engineering-part-2)
- [Token Optimization Techniques](https://www.sitepoint.com/optimizing-token-usage-context-compression-techniques/)

---

## 5. ForgeCode / Codex CLI

Code-focused AI assistants have their own patterns:

**Head+Tail Tool Output Trimming:**
- First 128 lines + last 128 lines, hard limit 256 lines or 10 KiB
- Acknowledges limitation: line-based truncation doesn't correlate with token usage
- OpenAI Codex is migrating to token-based limits instead

**Protection Window:**
- Most recent ~40K tokens of tool outputs kept intact
- Only prunes if at least ~20K tokens can be removed
- "Skill" tool outputs excluded from pruning by default

### Sources
- [ForgeCode Context Compaction](https://forgecode.dev/docs/context-compaction/)
- [Codex Token-Based Limits Issue](https://github.com/openai/codex/issues/6426)

---

## 6. Comparison Matrix: What Each System Does

| Feature | OpenClaw | CoPaw/ReMe | Google ADK | ForgeCode | **Cheeko (Current)** |
|---------|----------|------------|------------|-----------|---------------------|
| Auto-compaction trigger | Token threshold | Token-ratio (70%) | Invocation count | Token threshold | **None** |
| Summarization | LLM-based | Incremental LLM | Sliding window LLM | LLM-based | **None** |
| Tool output trimming | Head+tail (1.5K each) | Per-tool compaction | Tool-level summary | Head+tail (128 lines) | **None** |
| Recency buffer | Recent messages kept | Configurable | Overlap window | Protection window | **None** |
| Background processing | No | Yes (async summaries) | No | No | **N/A** |
| DoomLoop detection | No | Yes (sliding window) | No | No | **None** |
| Long-term memory | Local JSONL | Vector DB + keyword | Session store | No | **Mem0 (separate)** |

---

## 7. New Approach Suggestion: Token-Ratio Compaction with Incremental Summary

Based on this research, here is a **third approach** not in the original design doc — combining the best patterns:

### Approach C: Hybrid Token-Ratio Compaction (CoPaw + ADK Pattern)

Instead of a fixed `truncate(max_items=30)`, implement a token-aware compaction system:

**Step 1: Token-Ratio Trigger**
```
When context_tokens > (model_context_window * 0.6):
    trigger compaction
```

For Gemini 2.0 Flash (1M context) this seems too generous. But for Gemini Realtime with practical limits (~32K effective), triggering at 60% = ~19K tokens makes sense. This is smarter than a fixed item count because it adapts to varying message lengths (short voice turns vs long story responses).

**Step 2: Tiered Compaction (not just truncation)**

```
Level 1 (60% utilization): Trim tool outputs
  - Google Search results: keep first 500 chars + last 200 chars
  - Replace trimmed content with "[search results trimmed]"

Level 2 (70% utilization): Verbatim compaction
  - Drop older assistant responses beyond last 10 turns
  - Keep all user messages (they're short voice turns)
  - Keep system instruction always

Level 3 (80% utilization): LLM summarization
  - Summarize turns 1-N into a "conversation so far" block
  - Use gemini-2.0-flash for cheap summarization
  - Pass previous summary as input (incremental, like CoPaw)
  - Keep last 5 turns verbatim
```

**Step 3: Incremental Summary Storage**

Store the running summary in `session.userdata` so it persists across compaction cycles:

```python
@dataclass
class CompactionState:
    summary: str = ""           # Running conversation summary
    total_items_seen: int = 0   # Total items processed
    last_compaction_at: int = 0 # Item count at last compaction
    level: int = 0              # Current compaction level
```

### Why This Is Better Than Simple Truncation

| Aspect | `truncate(max_items=30)` | Token-Ratio Compaction |
|--------|--------------------------|----------------------|
| Trigger | Fixed item count | Adapts to actual token pressure |
| Short messages | Wastes budget (30 short items = 3K tokens, could keep more) | Keeps more items when they're small |
| Long messages | May overflow (30 long items = 30K tokens) | Triggers earlier when items are large |
| Tool outputs | Kept or dropped entirely | Trimmed head+tail first (preserves key info) |
| Context loss | Abrupt (older items disappear) | Gradual (trim tools -> drop old responses -> summarize) |
| Cost | Free | Level 3 costs one cheap LLM call per trigger |

### Applicability to Cheeko's Voice Context

Cheeko's conversation is voice-based, so messages are typically short (voice turns are 1-3 sentences). This means:
- Level 1 (tool trimming) will be most frequently triggered — Google Search results are the biggest variable-size items
- Level 2 (verbatim compaction) handles long storytelling responses
- Level 3 (summarization) is rarely needed — most child sessions are under 15 minutes

### Implementation Complexity

This is more complex than simple `truncate()` but provides much better token efficiency. Recommended as a **Phase 2 upgrade** after the simple truncation proves the concept.

---

## 8. Recommendations for Cheeko

Based on industry research, the recommended evolution path:

### Immediate (Week 1): Simple Truncation
- `ChatContext.truncate(max_items=30)` via `conversation_item_added`
- This is what the original design doc proposes — proven pattern, zero risk
- Matches the "verbatim compaction" approach (drop old items, keep recent ones)

### Short-Term (Week 2-3): Tool Output Trimming
- **New finding from research:** Trim Google Search tool results using head+tail strategy
- Keep first 500 chars + last 200 chars of search results
- This alone could save 500-2000 tokens per search-heavy turn
- OpenClaw and ForgeCode both use this pattern

### Medium-Term (Month 1-2): Token-Ratio Trigger
- Replace fixed `max_items=30` with token-ratio trigger (60% of effective context)
- Adapts to varying message lengths automatically
- CoPaw and OpenClaw both use ratio-based triggers

### Long-Term (Month 2+): Incremental Summarization
- Add Level 3 summarization using gemini-2.0-flash
- Incremental summaries (pass previous summary as input, like CoPaw/ReMe)
- Only triggers on very long sessions
- Store summary in `session.userdata` for persistence
