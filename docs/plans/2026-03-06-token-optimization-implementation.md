# Cheeko Agent Token Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce Cheeko's per-turn token usage by ~30-57% through ReMe-inspired token-ratio compaction and on-demand prompt sections — with zero added latency to the agent.

**Architecture:** A `ContextCompactionManager` uses ReMe's token-ratio trigger (estimate tokens via `len(text)/4`, trigger at 60% of effective context budget) with two zero-delay compaction levels: Level 1 trims tool outputs head+tail (OpenClaw pattern), Level 2 truncates old items via LiveKit's `ChatContext.truncate()`. An `OnDemandPromptManager` injects specialized prompt sections (storytelling, spelling, rhymes, phonics) only when user speech matches trigger keywords. Both systems hook into existing session events in `cheeko_worker.py` with zero latency impact.

**Key Design Decisions (from research):**
- **ReMe token-ratio trigger** over fixed item count — adapts to varying message lengths (short voice turns vs long story responses)
- **No LLM summarization** in this phase — avoids API call latency entirely
- **OpenClaw head+tail trimming** for tool outputs — preserves key info from Google Search results
- **LiveKit `truncate()` preserves system instruction** — first message always kept, orphan function calls cleaned up
- **`session.history` is separate from `chat_ctx`** — truncation does NOT affect chat history saving (verified in `entrypoint_utils.py:488`)

**Tech Stack:** Python 3.11, LiveKit Agents SDK (`ChatContext.truncate()`), Jinja2 templates, YAML config

**Reference Docs:**
- Design: `docs/plans/2026-03-06-token-optimization-design.md`
- Research: `docs/plans/2026-03-06-industry-context-management-research.md`
- Edge Cases: `docs/plans/2026-03-06-cheeko-agent-edge-cases.md` (Issue 6.13)

---

## Task 1: Create ContextCompactionManager with Token-Ratio Trigger

**Files:**
- Create: `main/livekit-server/src/context/compaction_manager.py`
- Create: `main/livekit-server/src/context/__init__.py`
- Create: `main/livekit-server/tests/test_compaction_manager.py`

Core module implementing ReMe's token-ratio compaction with two zero-delay levels.

**Step 1: Create the test file**

```python
# tests/test_compaction_manager.py
import pytest
from unittest.mock import MagicMock, patch
from src.context.compaction_manager import ContextCompactionManager, CompactionConfig


class TestCompactionConfig:
    def test_default_config(self):
        config = CompactionConfig()
        assert config.effective_context_budget == 20000
        assert config.level1_ratio == 0.6
        assert config.level2_ratio == 0.7
        assert config.max_items_after_truncation == 30
        assert config.tool_output_max_chars == 700
        assert config.head_chars == 500
        assert config.tail_chars == 200

    def test_custom_config(self):
        config = CompactionConfig(effective_context_budget=32000, level1_ratio=0.5)
        assert config.effective_context_budget == 32000
        assert config.level1_ratio == 0.5


class TestTokenEstimation:
    """ReMe pattern: estimate tokens via len(text)/4 — zero delay, no tokenizer"""

    def test_estimate_empty(self):
        manager = ContextCompactionManager()
        assert manager.estimate_tokens("") == 0

    def test_estimate_short_text(self):
        manager = ContextCompactionManager()
        # "hello world" = 11 chars / 4 = 2.75 -> 3
        assert manager.estimate_tokens("hello world") == 3

    def test_estimate_context_items(self):
        manager = ContextCompactionManager()
        items = [MagicMock(text_content="hello " * 100)]  # 600 chars
        estimate = manager.estimate_context_tokens(items)
        assert estimate == 150  # 600 / 4


class TestTokenRatioTrigger:
    """ReMe pattern: trigger compaction at ratio of context budget, not fixed item count"""

    def test_no_compaction_below_level1(self):
        config = CompactionConfig(effective_context_budget=20000, level1_ratio=0.6)
        manager = ContextCompactionManager(config)
        # 11,000 tokens = 55% < 60% level1
        assert manager.get_compaction_level(11000) == 0

    def test_level1_at_60_percent(self):
        config = CompactionConfig(effective_context_budget=20000, level1_ratio=0.6)
        manager = ContextCompactionManager(config)
        # 12,000 tokens = 60% of 20,000
        assert manager.get_compaction_level(12000) == 1

    def test_level2_at_70_percent(self):
        config = CompactionConfig(effective_context_budget=20000, level2_ratio=0.7)
        manager = ContextCompactionManager(config)
        # 14,000 tokens = 70% of 20,000
        assert manager.get_compaction_level(14000) == 2

    def test_level2_above_70_percent(self):
        config = CompactionConfig(effective_context_budget=20000, level2_ratio=0.7)
        manager = ContextCompactionManager(config)
        assert manager.get_compaction_level(18000) == 2


class TestToolOutputTrimming:
    """OpenClaw/ForgeCode pattern: keep first N + last M chars"""

    def test_short_output_unchanged(self):
        manager = ContextCompactionManager()
        text = "Short result"
        result = manager.trim_tool_output(text)
        assert result == text

    def test_long_output_trimmed_head_tail(self):
        manager = ContextCompactionManager()
        text = "A" * 500 + "B" * 500 + "C" * 200
        result = manager.trim_tool_output(text)
        assert result.startswith("A" * 500)
        assert result.endswith("C" * 200)
        assert "[...trimmed" in result
        assert len(result) < len(text)

    def test_output_at_threshold_unchanged(self):
        manager = ContextCompactionManager(CompactionConfig(tool_output_max_chars=700))
        text = "X" * 700
        result = manager.trim_tool_output(text)
        assert result == text


class TestCompact:
    def test_truncate_called_with_max_items(self):
        manager = ContextCompactionManager(CompactionConfig(max_items_after_truncation=30))
        mock_chat_ctx = MagicMock()
        mock_chat_ctx.items = [MagicMock()] * 40
        manager.compact(mock_chat_ctx)
        mock_chat_ctx.truncate.assert_called_once_with(max_items=30)


class TestMetrics:
    def test_metrics_initial_state(self):
        manager = ContextCompactionManager()
        metrics = manager.get_metrics()
        assert metrics["total_items_seen"] == 0
        assert metrics["compaction_count"] == 0
        assert metrics["tool_outputs_trimmed"] == 0
        assert metrics["last_compaction_level"] == 0

    def test_metrics_after_compaction(self):
        manager = ContextCompactionManager()
        mock_ctx = MagicMock()
        mock_ctx.items = [MagicMock()] * 30
        manager.compact(mock_ctx)
        metrics = manager.get_metrics()
        assert metrics["compaction_count"] == 1

    def test_metrics_after_tool_trimming(self):
        manager = ContextCompactionManager()
        manager.trim_tool_output("X" * 1000)
        metrics = manager.get_metrics()
        assert metrics["tool_outputs_trimmed"] == 1

    def test_metrics_no_trim_for_short_output(self):
        manager = ContextCompactionManager()
        manager.trim_tool_output("short")
        metrics = manager.get_metrics()
        assert metrics["tool_outputs_trimmed"] == 0
```

**Step 2: Run tests to verify they fail**

Run: `cd /root/xiaozhi-esp32-server/main/livekit-server && python -m pytest tests/test_compaction_manager.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.context'`

**Step 3: Create the `__init__.py` and implementation**

```python
# src/context/__init__.py
from .compaction_manager import ContextCompactionManager, CompactionConfig

__all__ = ["ContextCompactionManager", "CompactionConfig"]
```

```python
# src/context/compaction_manager.py
"""
Context Compaction Manager for Cheeko Agent

Implements tiered context management with ZERO added latency:

  Level 0: No action (context within budget)
  Level 1 (60% budget): Trim tool outputs head+tail (OpenClaw pattern)
  Level 2 (70% budget): Truncate old items via ChatContext.truncate() (LiveKit API)

Token estimation uses ReMe's len(text)/4 heuristic — no tokenizer, no API call,
no delay. Adapts to actual token pressure instead of fixed item counts.

Future (Level 3): Async background summarization (ReMe pattern) — see Future Plan.

Inspired by:
- CoPaw/ReMe: Token-ratio trigger, incremental summarization (future)
- OpenClaw: Head+tail tool output trimming
- Google ADK: Sliding window compaction
- LiveKit: ChatContext.truncate() API
"""

from dataclasses import dataclass, field
from typing import List, Optional
import logging

logger = logging.getLogger("cheeko-agent")


@dataclass
class CompactionConfig:
    # Token budget (Gemini Realtime effective limit)
    effective_context_budget: int = 20000  # ~20K effective tokens for Gemini Realtime

    # ReMe-style ratio triggers (percentage of effective_context_budget)
    level1_ratio: float = 0.6   # 60% -> trim tool outputs
    level2_ratio: float = 0.7   # 70% -> truncate old items

    # Level 2: Truncation settings
    max_items_after_truncation: int = 30  # Keep last 30 items (~14 turn pairs + system)

    # Level 1: Tool output trimming (OpenClaw pattern)
    tool_output_max_chars: int = 700  # Trim outputs longer than this
    head_chars: int = 500             # Keep first N chars
    tail_chars: int = 200             # Keep last N chars


class ContextCompactionManager:
    def __init__(self, config: Optional[CompactionConfig] = None):
        self.config = config or CompactionConfig()
        self.item_count: int = 0
        self._compaction_count: int = 0
        self._tool_outputs_trimmed: int = 0
        self._last_compaction_level: int = 0

    # ── Token Estimation (ReMe pattern: len/4, zero delay) ──

    def estimate_tokens(self, text: str) -> int:
        if not text:
            return 0
        return len(text) // 4 + (1 if len(text) % 4 else 0)

    def estimate_context_tokens(self, items: list) -> int:
        total = 0
        for item in items:
            text = getattr(item, 'text_content', '') or ''
            total += self.estimate_tokens(text)
        return total

    # ── Compaction Level (ReMe token-ratio trigger) ──

    def get_compaction_level(self, estimated_tokens: int) -> int:
        budget = self.config.effective_context_budget
        if estimated_tokens >= budget * self.config.level2_ratio:
            return 2
        if estimated_tokens >= budget * self.config.level1_ratio:
            return 1
        return 0

    # ── Level 1: Tool Output Trimming (OpenClaw pattern) ──

    def trim_tool_output(self, text: str) -> str:
        if len(text) <= self.config.tool_output_max_chars:
            return text

        head = text[:self.config.head_chars]
        tail = text[-self.config.tail_chars:]
        trimmed_count = len(text) - self.config.head_chars - self.config.tail_chars
        self._tool_outputs_trimmed += 1
        return f"{head}\n\n[...trimmed {trimmed_count} chars...]\n\n{tail}"

    # ── Level 2: Truncation (LiveKit API) ──

    def compact(self, chat_ctx) -> None:
        item_count_before = len(getattr(chat_ctx, 'items', []))
        chat_ctx.truncate(max_items=self.config.max_items_after_truncation)
        item_count_after = len(getattr(chat_ctx, 'items', []))
        self._compaction_count += 1
        logger.info(
            f"[COMPACTION-L2] Truncated: {item_count_before} -> {item_count_after} items "
            f"(max={self.config.max_items_after_truncation}, total_seen={self.item_count})"
        )

    # ── Event Hook ──

    def on_item_added(self):
        self.item_count += 1

    def run_compaction(self, chat_ctx) -> int:
        """
        Check token pressure and run appropriate compaction level.
        Returns the compaction level applied (0 = none, 1 = tool trim, 2 = truncate).
        All operations are zero-delay (in-memory only).
        """
        items = getattr(chat_ctx, 'items', [])
        estimated = self.estimate_context_tokens(items)
        level = self.get_compaction_level(estimated)
        self._last_compaction_level = level

        if level >= 2:
            self.compact(chat_ctx)
            logger.info(f"[COMPACTION] Level 2 triggered at ~{estimated} tokens "
                       f"({estimated * 100 // self.config.effective_context_budget}% of budget)")
        elif level >= 1:
            logger.info(f"[COMPACTION] Level 1 — tool trimming active at ~{estimated} tokens "
                       f"({estimated * 100 // self.config.effective_context_budget}% of budget)")

        return level

    # ── Metrics ──

    def get_metrics(self) -> dict:
        return {
            "total_items_seen": self.item_count,
            "compaction_count": self._compaction_count,
            "tool_outputs_trimmed": self._tool_outputs_trimmed,
            "last_compaction_level": self._last_compaction_level,
        }
```

**Step 4: Run tests to verify they pass**

Run: `cd /root/xiaozhi-esp32-server/main/livekit-server && python -m pytest tests/test_compaction_manager.py -v`
Expected: All 16 tests PASS

**Step 5: Commit**

```bash
git add main/livekit-server/src/context/__init__.py main/livekit-server/src/context/compaction_manager.py main/livekit-server/tests/test_compaction_manager.py
git commit -m "feat: add ContextCompactionManager with ReMe token-ratio trigger"
```

---

## Task 2: Create OnDemandPromptManager Module

**Files:**
- Create: `main/livekit-server/src/context/on_demand_prompts.py`
- Create: `main/livekit-server/tests/test_on_demand_prompts.py`
- Modify: `main/livekit-server/src/context/__init__.py`

Manages prompt sections injected only when user speech matches trigger keywords. Saves ~1,070 tokens/turn when these features are not triggered.

**Step 1: Write the failing tests**

```python
# tests/test_on_demand_prompts.py
import pytest
from src.context.on_demand_prompts import OnDemandPromptManager


class TestKeywordMatching:
    def test_story_keywords_match(self):
        manager = OnDemandPromptManager()
        matches = manager.get_matching_sections("tell me a story")
        assert "storytelling" in matches

    def test_spell_keywords_match(self):
        manager = OnDemandPromptManager()
        matches = manager.get_matching_sections("can you spell elephant")
        assert "spelling" in matches

    def test_rhyme_keywords_match(self):
        manager = OnDemandPromptManager()
        matches = manager.get_matching_sections("sing twinkle twinkle")
        assert "rhymes" in matches

    def test_phonics_keywords_match(self):
        manager = OnDemandPromptManager()
        matches = manager.get_matching_sections("teach me phonics")
        assert "phonics" in matches

    def test_no_match_for_generic_message(self):
        manager = OnDemandPromptManager()
        matches = manager.get_matching_sections("how are you today")
        assert len(matches) == 0

    def test_case_insensitive(self):
        manager = OnDemandPromptManager()
        matches = manager.get_matching_sections("TELL ME A STORY")
        assert "storytelling" in matches

    def test_hindi_keyword_kahani(self):
        manager = OnDemandPromptManager()
        matches = manager.get_matching_sections("mujhe kahani sunao")
        assert "storytelling" in matches


class TestSectionContent:
    def test_storytelling_section_has_content(self):
        manager = OnDemandPromptManager()
        content = manager.get_section_content("storytelling")
        assert "<storytelling_rules>" in content
        assert "</storytelling_rules>" in content

    def test_unknown_section_returns_none(self):
        manager = OnDemandPromptManager()
        content = manager.get_section_content("nonexistent")
        assert content is None


class TestDeduplication:
    def test_already_injected_not_repeated(self):
        manager = OnDemandPromptManager()
        manager.get_matching_sections("tell me a story")
        manager.mark_injected("storytelling")
        matches = manager.get_matching_sections("another story please")
        assert "storytelling" not in matches

    def test_reset_clears_injected(self):
        manager = OnDemandPromptManager()
        manager.mark_injected("storytelling")
        manager.reset()
        matches = manager.get_matching_sections("tell me a story")
        assert "storytelling" in matches
```

**Step 2: Run tests to verify they fail**

Run: `cd /root/xiaozhi-esp32-server/main/livekit-server && python -m pytest tests/test_on_demand_prompts.py -v`
Expected: FAIL with `ModuleNotFoundError`

**Step 3: Write the implementation**

```python
# src/context/on_demand_prompts.py
"""
On-Demand Prompt Section Manager

Sections like storytelling rules, spelling protocol, rhymes/songs, and phonics
are only injected when user speech matches trigger keywords. Saves ~1,070
tokens/turn when these features are not being used.

Zero delay — keyword matching is simple string containment.
"""

from typing import Dict, List, Optional, Set
import logging

logger = logging.getLogger("cheeko-agent")

SECTIONS: Dict[str, dict] = {
    "storytelling": {
        "keywords": ["story", "kahani", "tell me a story", "storytime"],
        "content": """<storytelling_rules>
CRITICAL: How to tell stories

ALWAYS TELL MORAL STORIES:
- When a child asks for a story, ALWAYS tell a story with a moral/lesson
- The moral should be woven naturally into the story, not preachy
- End with a simple, clear moral that kids can understand

NEVER PAUSE MID-STORY:
- Tell the COMPLETE story in ONE stretch - do NOT stop and ask "Should I continue?"
- Do NOT break the story into parts
- Finish the entire story including the moral in a single response

STORY THEMES (Indian context preferred):
- Panchatantra-style animal stories
- Stories about festivals (Diwali, Holi, Eid)
- Brave kids helping others
- Magical adventures in Indian settings
- Stories featuring cricket, mango trees, monsoon rain, etc.
</storytelling_rules>"""
    },
    "spelling": {
        "keywords": ["spell", "spelling", "how do you spell"],
        "content": """<spelling_accuracy>
CRITICAL: SPELLING PROTOCOL - ZERO TOLERANCE FOR ERRORS

The 3 Rules for Spelling:
1. NEVER RUSH: Do not rattle off the letters quickly.
2. USE HYPHENS: You MUST output letters with hyphens (A-P-P-L-E).
3. THE "CHUNKING" METHOD: For words longer than 6 letters, break into groups of 3-4 letters.

Correct Speaking Format:
User: "Spell Environment"
Cheeko: "Let's break it down! E-N-V... I-R-O-N... M-E-N-T. Environment! E-N-V-I-R-O-N-M-E-N-T."

Only use Google Search if it's a very rare or scientific word.
</spelling_accuracy>"""
    },
    "rhymes": {
        "keywords": ["sing", "song", "rhyme", "poem", "nursery"],
        "content": """<rhymes_and_songs>
CRITICAL: Rhyme lyrics must be accurate - USE GOOGLE SEARCH

When a child asks to play/sing a rhyme or song:
- ALWAYS use Google Search to find accurate lyrics BEFORE singing
- Search for: "nursery rhyme [name] lyrics"
- NEVER rely on memory for lyrics - they may be incorrect
- Sing/recite the rhyme enthusiastically with rhythm
- After the rhyme, engage the child: "Want to sing it together?"

NEVER guess lyrics from memory. NEVER mix up verses. Always verify before singing.
</rhymes_and_songs>"""
    },
    "phonics": {
        "keywords": ["phonics", "teach me letters", "letter sounds", "how to read"],
        "content": """<phonics_instruction>
CRITICAL: How to teach Phonics

Teaching Order (Jolly Phonics Sequence):
- Group 1: s, a, t, i, p, n
- Group 2: c, k, e, h, r, m, d
- Group 3: g, o, u, l, f, b
- Group 4: ai, j, oa, ie, ee, or
- Group 5: z, w, ng, v, oo, oo
- Group 6: y, x, ch, sh, th, th
- Group 7: qu, ou, oi, ue, er, ar

The "One-Stretch" Rule: NEVER PAUSE during a group. Teach entire group in one flow.

Method: 1. Sound (pure sound, not "puh" just "p") 2. Action (fun action) 3. Words (1-2 examples)
</phonics_instruction>"""
    },
}


class OnDemandPromptManager:
    def __init__(self, sections: Optional[Dict[str, dict]] = None):
        self._sections = sections or SECTIONS
        self._injected: Set[str] = set()

    def get_matching_sections(self, user_text: str) -> List[str]:
        text_lower = user_text.lower()
        matches = []
        for section_name, section in self._sections.items():
            if section_name in self._injected:
                continue
            if any(kw in text_lower for kw in section["keywords"]):
                matches.append(section_name)
        return matches

    def get_section_content(self, section_name: str) -> Optional[str]:
        section = self._sections.get(section_name)
        if not section:
            return None
        return section["content"]

    def mark_injected(self, section_name: str):
        self._injected.add(section_name)
        logger.info(f"[ON-DEMAND] Marked '{section_name}' as injected (won't repeat)")

    def reset(self):
        self._injected.clear()

    @property
    def injected_sections(self) -> Set[str]:
        return self._injected.copy()
```

Update `__init__.py`:

```python
# src/context/__init__.py
from .compaction_manager import ContextCompactionManager, CompactionConfig
from .on_demand_prompts import OnDemandPromptManager

__all__ = ["ContextCompactionManager", "CompactionConfig", "OnDemandPromptManager"]
```

**Step 4: Run tests to verify they pass**

Run: `cd /root/xiaozhi-esp32-server/main/livekit-server && python -m pytest tests/test_on_demand_prompts.py -v`
Expected: All 10 tests PASS

**Step 5: Commit**

```bash
git add main/livekit-server/src/context/on_demand_prompts.py main/livekit-server/src/context/__init__.py main/livekit-server/tests/test_on_demand_prompts.py
git commit -m "feat: add OnDemandPromptManager for keyword-triggered section injection"
```

---

## Task 3: Add Compaction Config to config.yaml

**Files:**
- Modify: `main/livekit-server/config.yaml` (after `agent:` section, around line 57)
- Create: `main/livekit-server/tests/test_config_loading.py`

**Step 1: Write the failing test**

```python
# tests/test_config_loading.py
import pytest
import yaml
import os


class TestCompactionConfig:
    def test_config_yaml_has_compaction_section(self):
        config_path = os.path.join(os.path.dirname(__file__), "..", "config.yaml")
        with open(config_path) as f:
            config = yaml.safe_load(f)
        assert "context_compaction" in config

    def test_compaction_has_reme_ratio_settings(self):
        config_path = os.path.join(os.path.dirname(__file__), "..", "config.yaml")
        with open(config_path) as f:
            config = yaml.safe_load(f)
        compaction = config["context_compaction"]
        assert compaction["effective_context_budget"] == 20000
        assert compaction["level1_ratio"] == 0.6
        assert compaction["level2_ratio"] == 0.7
        assert compaction["max_items_after_truncation"] == 30
        assert compaction["tool_output_max_chars"] == 700
```

**Step 2: Run test to verify it fails**

Run: `cd /root/xiaozhi-esp32-server/main/livekit-server && python -m pytest tests/test_config_loading.py -v`
Expected: FAIL with `KeyError: 'context_compaction'`

**Step 3: Add compaction section to config.yaml**

Add after the `agent:` section (around line 57):

```yaml
# Context compaction settings (ReMe-inspired token-ratio trigger)
# See docs/plans/2026-03-06-token-optimization-implementation.md
context_compaction:
  effective_context_budget: 20000     # Effective token budget for Gemini Realtime
  level1_ratio: 0.6                   # 60% -> Level 1: trim tool outputs (head+tail)
  level2_ratio: 0.7                   # 70% -> Level 2: truncate old items
  max_items_after_truncation: 30      # Keep last 30 items after Level 2 truncation
  tool_output_max_chars: 700          # Trim tool outputs longer than this
```

**Step 4: Run test to verify it passes**

Run: `cd /root/xiaozhi-esp32-server/main/livekit-server && python -m pytest tests/test_config_loading.py -v`
Expected: All 2 tests PASS

**Step 5: Commit**

```bash
git add main/livekit-server/config.yaml main/livekit-server/tests/test_config_loading.py
git commit -m "feat: add ReMe-style context_compaction config to config.yaml"
```

---

## Task 4: Integrate into cheeko_worker.py

**Files:**
- Modify: `main/livekit-server/workers/cheeko_worker.py:56` (add import)
- Modify: `main/livekit-server/workers/cheeko_worker.py:368-398` (after AgentSession creation)
- Modify: `main/livekit-server/workers/cheeko_worker.py:399-421` (existing `on_user_speech_committed`)

**Step 1: Add import at line 56**

After the `mem0_service` import at `cheeko_worker.py:56`:

```python
from src.context import ContextCompactionManager, CompactionConfig, OnDemandPromptManager
```

**Step 2: Initialize compaction after AgentSession creation**

At `cheeko_worker.py:369` (after `logger.info(f"AgentSession created...")`), add:

```python
    # ============================================================================
    # CONTEXT COMPACTION: ReMe-inspired token-ratio trigger (zero delay)
    # Level 1 (60%): Trim tool outputs | Level 2 (70%): Truncate old items
    # ============================================================================
    compaction_yaml = ConfigLoader.load_config().get('context_compaction', {})
    compaction_config = CompactionConfig(
        effective_context_budget=compaction_yaml.get('effective_context_budget', 20000),
        level1_ratio=compaction_yaml.get('level1_ratio', 0.6),
        level2_ratio=compaction_yaml.get('level2_ratio', 0.7),
        max_items_after_truncation=compaction_yaml.get('max_items_after_truncation', 30),
        tool_output_max_chars=compaction_yaml.get('tool_output_max_chars', 700),
    )
    compaction_manager = ContextCompactionManager(compaction_config)
    on_demand_prompts = OnDemandPromptManager()
    logger.info(f"[COMPACTION] Initialized: budget={compaction_config.effective_context_budget}, "
                f"L1={compaction_config.level1_ratio}, L2={compaction_config.level2_ratio}")
```

**Step 3: Add `conversation_item_added` handler**

After the compaction initialization:

```python
    @session.on("conversation_item_added")
    def on_conversation_item_added(item):
        """ReMe-style: track items and run token-ratio compaction check"""
        compaction_manager.on_item_added()
        # Check every 5 items to avoid overhead on every single item
        if compaction_manager.item_count % 5 == 0:
            compaction_manager.run_compaction(session.chat_ctx)
```

**Step 4: Add on-demand injection to existing `on_user_speech_committed`**

At `cheeko_worker.py:399-421`, modify the existing handler. After the text extraction line (`text = getattr(msg, ...)` at line 404), add:

```python
        # On-demand prompt injection (zero delay — keyword matching)
        matching_sections = on_demand_prompts.get_matching_sections(text)
        for section_name in matching_sections:
            content = on_demand_prompts.get_section_content(section_name)
            if content:
                session.chat_ctx.add_message(role="developer", content=content)
                on_demand_prompts.mark_injected(section_name)
                logger.info(f"[ON-DEMAND] Injected '{section_name}' ({len(content)} chars)")
```

Keep the rest of the existing memory injection logic unchanged.

**Step 5: Verify imports work**

Run: `cd /root/xiaozhi-esp32-server/main/livekit-server && python -c "from src.context import ContextCompactionManager, OnDemandPromptManager; print('Import OK')"`
Expected: `Import OK`

**Step 6: Commit**

```bash
git add main/livekit-server/workers/cheeko_worker.py
git commit -m "feat: integrate ReMe token-ratio compaction and on-demand prompts into cheeko_worker"
```

---

## Task 5: Remove On-Demand Sections from Prompt Template

**Files:**
- Modify: `main/livekit-server/src/prompts/cheeko.yaml`

Remove 5 sections now managed by `OnDemandPromptManager`: `<storytelling_rules>`, `<spelling_accuracy>`, `<rhymes_and_songs>`, `<phonics_instruction>`, `<example_dialogues>`. Saves ~1,220 tokens/turn.

**Step 1: Remove the five sections from cheeko.yaml**

Delete these blocks:
- `<example_dialogues>...</example_dialogues>` (lines 347-359) — redundant, never needed
- `<storytelling_rules>...</storytelling_rules>` (lines 162-199) — now on-demand
- `<spelling_accuracy>...</spelling_accuracy>` (lines 247-270) — now on-demand
- `<rhymes_and_songs>...</rhymes_and_songs>` (lines 272-297) — now on-demand
- `<phonics_instruction>...</phonics_instruction>` (lines 299-326) — now on-demand

**Step 2: Verify the YAML is still valid**

Run: `cd /root/xiaozhi-esp32-server/main/livekit-server && python -c "import yaml; yaml.safe_load(open('src/prompts/cheeko.yaml')); print('YAML valid')"`
Expected: `YAML valid`

**Step 3: Commit**

```bash
git add main/livekit-server/src/prompts/cheeko.yaml
git commit -m "refactor: move storytelling/spelling/rhymes/phonics/examples to on-demand (-1220 tokens/turn)"
```

**DATABASE NOTE:** The `ai_agent.system_prompt` field in the database also needs these sections removed. This is a manual step — update via the manager-web agent editor when deploying.

---

## Task 6: Run All Tests and Final Verification

**Files:** None (verification only)

**Step 1: Run all tests**

Run: `cd /root/xiaozhi-esp32-server/main/livekit-server && python -m pytest tests/ -v`
Expected: All tests PASS (test_compaction_manager: 16, test_on_demand_prompts: 10, test_config_loading: 2 = 28 total)

**Step 2: Verify full import chain**

Run: `cd /root/xiaozhi-esp32-server/main/livekit-server && python -c "from src.context import ContextCompactionManager, CompactionConfig, OnDemandPromptManager; print('All imports OK')"`
Expected: `All imports OK`

**Step 3: Log compaction metrics format**

Run: `cd /root/xiaozhi-esp32-server/main/livekit-server && python -c "
from src.context import ContextCompactionManager
m = ContextCompactionManager()
m.trim_tool_output('X' * 1000)
print(m.get_metrics())
"`
Expected: `{'total_items_seen': 0, 'compaction_count': 0, 'tool_outputs_trimmed': 1, 'last_compaction_level': 0}`

**Step 4: Commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address test failures from integration"
```

---

## Expected Results

| Scenario | Before | After | Savings | Delay Added |
|----------|--------|-------|---------|-------------|
| Turn 1 (no history) | ~6,100 tokens | ~4,880 tokens | 20% | 0ms |
| Turn 10 | ~9,100 tokens | ~5,500 tokens | 40% | 0ms |
| Turn 30 | ~15,100+ tokens | ~6,500 tokens | 57% | 0ms |
| Turn 30 + story request | ~15,100+ tokens | ~6,750 tokens | 55% | 0ms |

---

## Future Plan: Level 3 — Async Background Summarization (ReMe Pattern)

> This is NOT part of the current implementation. It is documented here for future reference.

When sessions regularly exceed 20 minutes, add Level 3 summarization using ReMe's async background pattern:

**How it works (zero delay to agent):**
1. When context hits 80% of budget, fire an **async background task** (not awaited)
2. The background task calls a cheap LLM (gemini-2.0-flash) to summarize older turns
3. The agent **never waits** — it continues the conversation immediately
4. The summary result is stored in `session.userdata["compaction_summary"]`
5. On the **next** compaction cycle, the stored summary is prepended to context as a developer message
6. Previous summary is passed as input to the new summarization call (**incremental**, like CoPaw/ReMe — avoids re-processing)

**CompactionState (stored in session.userdata):**
```python
@dataclass
class CompactionState:
    summary: str = ""                # Running conversation summary from last async summarization
    total_items_summarized: int = 0  # How many items were covered by the summary
    last_summary_at: float = 0       # Timestamp of last summarization
```

**Trigger:**
```python
# In run_compaction(), add after Level 2:
if level >= 3 and self.config.enable_summarization:
    # Fire and forget — agent never waits
    asyncio.create_task(self._async_summarize(chat_ctx, session))
```

**Why async (ReMe insight):** The summarization LLM call takes 500-2000ms. By running it in the background, the agent responds immediately. The summary is only used in the NEXT compaction cycle, so there's no latency impact on the current turn.

**When to implement:** Only if production monitoring shows sessions regularly exceeding 60 items (~30 turns, ~15 minutes) and the Level 1+2 compaction is insufficient.

---

## Deployment Checklist

1. **Database update required:** Remove `<example_dialogues>`, `<storytelling_rules>`, `<spelling_accuracy>`, `<rhymes_and_songs>`, `<phonics_instruction>` from `ai_agent.system_prompt` for Cheeko agent

2. **Rollback plan:** Delete the `context_compaction` section from `config.yaml` and restore the removed prompt sections to the database. The compaction code gracefully defaults to no-op when config is missing.

3. **Monitoring (look for these log lines):**
   - `[COMPACTION] Initialized:` — confirms startup
   - `[COMPACTION] Level 1` — tool trimming active
   - `[COMPACTION-L2] Truncated:` — truncation happened
   - `[ON-DEMAND] Injected` — section injected
   - `[METRICS-REALTIME]` — compare `input` token counts before/after

4. **Tuning:** If compaction triggers too early/late, adjust `effective_context_budget`, `level1_ratio`, `level2_ratio` in `config.yaml` — no code changes needed.
