# Cheeko Personalized Memory Integration Plan (Mem0)

> **Status**: Ready for Implementation
> **Created**: 2026-01-03
> **Decision**: Use Mem0 (already partially implemented, best benchmark score 94.4)

---

## 1. Executive Summary

Transform Cheeko into a companion-grade AI by integrating **Mem0 Knowledge Graph** for long-term memory and personalized context. This enables Cheeko to remember user traits, family members, pets, interests, and learning progress across sessions.

### Key Objectives
- **Persistent Memory**: Remember facts across sessions (e.g., "has a dog named Max")
- **Low Latency**: Fetch-at-Start, Sync-at-End architecture (~0ms runtime impact)
- **Shared Brain**: All agents (Cheeko, Math, Riddle, Word Ladder) share the same memory
- **Graceful Degradation**: Works without memory if Mem0 is unavailable

---

## 2. Current State Analysis

### Issues Identified

| Problem | Location | Impact |
|---------|----------|--------|
| **Redundant API calls** | Agent re-fetches child_profile despite it being in dispatch metadata | +200ms latency |
| **mem0-client.js unused** | Exists in `mqtt-gateway/core/` but not wired | No memory features |
| **No Python Mem0 client** | Only cleanup script exists | Can't save memories |
| **Metadata ignored** | Agent doesn't read dispatch metadata | Wasted Gateway work |

### Current Architecture (With Problems)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          CURRENT FLOW (BROKEN)                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Device ──► MQTT Gateway ──► LiveKit Dispatch ──► Cheeko Worker         │
│                  │                   │                  │               │
│                  ▼                   ▼                  ▼               │
│         [Fetches profile]    [Passes metadata]   [IGNORES metadata!]    │
│         [mem0-client.js]     [child_profile]     [Re-fetches from DB]   │
│          (UNUSED!)           (SENT BUT LOST)      (REDUNDANT!)          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Target Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           TARGET FLOW (FIXED)                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  SESSION START:                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Device ──► MQTT Gateway ─────────────────► LiveKit ──► Worker    │   │
│  │                 │                               │          │     │   │
│  │      ┌─────────┴─────────┐                     │          │     │   │
│  │      ▼                   ▼                     ▼          ▼     │   │
│  │  [child_profile]   [Mem0 memories]     [metadata]   [Use both]  │   │
│  │   (from DB)         (from API)          (passed)    (no refetch)│   │
│  │      │                   │                                      │   │
│  │      └───────┬───────────┘                                      │   │
│  │              ▼                                                  │   │
│  │   { child_profile, long_term_memories } ──► Prompt Injection    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  SESSION END:                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Worker ──► Extract Transcript ──► Mem0 API (fire-and-forget)     │   │
│  │                                        ▼                         │   │
│  │                              [Auto-extract facts]                │   │
│  │                              [Update knowledge graph]            │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Implementation Phases

### Phase 1: MQTT Gateway - Wire Mem0 into Session Start

**Files to modify:**
- `main/mqtt-gateway/gateway/virtual-connection.js` (minimal changes only)
- `main/mqtt-gateway/core/mem0-client.js` (update search method)
- `main/mqtt-gateway/core/mem0-integration.js` (**NEW FILE** - orchestration layer)

---

#### Task 1.1: Create mem0-integration.js (NEW FILE)

```javascript
// NEW FILE: main/mqtt-gateway/core/mem0-integration.js
/**
 * Mem0 Integration Layer
 *
 * Handles memory fetching with timeout and graceful degradation.
 * Keeps virtual-connection.js clean.
 */

const mem0Client = require('./mem0-client');
const logger = require('../utils/logger');

// Configuration
const MEM0_TIMEOUT_MS = 2000;  // 2 second timeout
const MEM0_MEMORY_LIMIT = 20;  // ~500 tokens

/**
 * Fetch memories for a device with timeout protection
 * @param {string} deviceId - Device MAC address
 * @returns {Promise<string[]>} Array of memory strings (empty on failure)
 */
async function fetchMemoriesWithTimeout(deviceId) {
  if (!deviceId) {
    return [];
  }

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Mem0 fetch timeout')), MEM0_TIMEOUT_MS)
    );

    const memories = await Promise.race([
      mem0Client.getMemories(deviceId),
      timeoutPromise
    ]);

    const result = memories || [];
    if (result.length > 0) {
      logger.info(`[MEM0-INT] Retrieved ${result.length} memories for ${deviceId}`);
    }
    return result;

  } catch (error) {
    // Graceful degradation - log and return empty array
    logger.warn(`[MEM0-INT] Fetch failed for ${deviceId}: ${error.message}`);
    return [];
  }
}

/**
 * Build enhanced context by merging child profile with Mem0 memories
 * @param {string} deviceId - Device MAC address
 * @param {object} childProfile - Child profile from database
 * @returns {Promise<object>} Enhanced context with memories
 */
async function buildEnhancedContext(deviceId, childProfile) {
  const memories = await fetchMemoriesWithTimeout(deviceId);

  return {
    child_profile: childProfile || null,
    long_term_memories: memories,
    memory_count: memories.length
  };
}

/**
 * Build dispatch metadata with memories included
 * @param {object} params - Parameters for metadata
 * @returns {string} JSON string for dispatch metadata
 */
function buildDispatchMetadata({ macAddress, deviceId, character, childProfile, memories }) {
  return JSON.stringify({
    device_mac: macAddress,
    device_uuid: deviceId,
    character: character || "Cheeko",
    child_profile: childProfile || null,
    long_term_memories: memories || [],
    timestamp: Date.now(),
  });
}

module.exports = {
  fetchMemoriesWithTimeout,
  buildEnhancedContext,
  buildDispatchMetadata,
  MEM0_TIMEOUT_MS,
  MEM0_MEMORY_LIMIT
};
```

---

#### Task 1.2: Update mem0-client.js (use semantic search)

```javascript
// mem0-client.js - update getMemories method to use semantic search
async getMemories(userId) {
  if (!this.client || !userId) return [];

  try {
    const cleanUserId = userId.replace(/:/g, "").toLowerCase();
    logger.info(`[MEM0] Searching memories for user: ${cleanUserId}`);

    // Use semantic search to get top 20 relevant memories (~500 tokens)
    const results = await this.client.search(
      "What is known about this person, their family, pet, interests, and learning progress?",
      {
        user_id: cleanUserId,
        limit: 20
      }
    );

    if (results && Array.isArray(results)) {
      const facts = results.map(m => m.memory);
      logger.info(`[MEM0] Retrieved ${facts.length} memories`);
      return facts;
    }
    return [];
  } catch (error) {
    logger.error(`[MEM0] Search Error: ${error.message}`);
    return [];
  }
}
```

---

#### Task 1.3: Update virtual-connection.js (minimal changes)

```javascript
// virtual-connection.js - MINIMAL CHANGES ONLY

// 1. Add import at top of file
const { fetchMemoriesWithTimeout, buildDispatchMetadata } = require('../core/mem0-integration');

// 2. Update parallel fetch (~line 400, in handleHello)
// BEFORE:
const [character, childProfile] = await Promise.all([
  this.fetchCurrentCharacter(this.deviceId),
  this.fetchChildProfile(this.deviceId)
]);

// AFTER (add one more parallel call):
const [character, childProfile, mem0Memories] = await Promise.all([
  this.fetchCurrentCharacter(this.deviceId),
  this.fetchChildProfile(this.deviceId),
  fetchMemoriesWithTimeout(this.deviceId)  // NEW - from mem0-integration
]);
this.mem0Memories = mem0Memories;

// 3. Update dispatch metadata (~line 611, in autoDeployAgent)
// BEFORE:
metadata: JSON.stringify({
  device_mac: this.macAddress,
  ...
}),

// AFTER (use helper function):
metadata: buildDispatchMetadata({
  macAddress: this.macAddress,
  deviceId: this.deviceId,
  character: this.currentCharacter,
  childProfile: this.childProfile,
  memories: this.mem0Memories
}),
```

**Total changes to virtual-connection.js: ~10 lines** (import + 2 small modifications)

---

### Phase 2: Python Worker - Receive & Use Memories

**Files to modify:**
- `main/livekit-server/workers/cheeko_worker.py`
- `main/livekit-server/src/shared/entrypoint_utils.py`

**Task 2.1: Use dispatch metadata instead of re-fetching**
```python
# cheeko_worker.py (~line 107-148, in entrypoint)
# Replace current metadata handling with:

dispatch_child_profile = None
dispatch_memories = []

# Extract from dispatch metadata (passed from MQTT gateway)
try:
    if hasattr(ctx, 'job') and ctx.job and ctx.job.metadata:
        dispatch_metadata = json.loads(ctx.job.metadata)
        dispatch_child_profile = dispatch_metadata.get('child_profile')
        dispatch_memories = dispatch_metadata.get('long_term_memories', [])

        if dispatch_child_profile:
            logger.info(f"Using child profile from dispatch: {dispatch_child_profile.get('name')}, age: {dispatch_child_profile.get('age')}")
        if dispatch_memories:
            logger.info(f"Received {len(dispatch_memories)} long-term memories from dispatch")
except Exception as e:
    logger.debug(f"No dispatch metadata or error parsing: {e}")

# Use dispatch data if available, otherwise fetch (fallback)
if dispatch_child_profile:
    child_profile = dispatch_child_profile
else:
    # Existing fetch code as fallback
    child_profile = await db_helper.get_child_profile_by_mac(device_mac)
```

**Task 2.2: Update render_prompt_with_profile signature**
```python
# entrypoint_utils.py (~line 164)
def render_prompt_with_profile(
    agent_prompt: str,
    child_profile: dict = None,
    long_term_memories: list = None  # NEW PARAMETER
) -> str:
    """
    Render a Jinja2 prompt template with child profile and memories.

    Args:
        agent_prompt: The prompt template with Jinja2 placeholders
        child_profile: Child profile dict (name, age, interests, etc.)
        long_term_memories: List of memory strings from Mem0

    Returns:
        Rendered prompt string
    """
```

**Task 2.3: Add memories to template variables**
```python
# entrypoint_utils.py (~line 203)
template_vars = {
    'child_name': child_profile.get('name', ''),
    'child_age': child_profile.get('age', ''),
    'age_group': child_profile.get('ageGroup', ''),
    'child_gender': child_profile.get('gender', ''),
    'child_interests': interests,
    'primary_language': child_profile.get('primaryLanguage', 'English'),
    'additional_notes': child_profile.get('additionalNotes', ''),
    'long_term_memories': long_term_memories or [],  # NEW
}
```

**Task 2.4: Call render with memories**
```python
# cheeko_worker.py (~line 187)
if child_profile:
    agent_prompt = render_prompt_with_profile(
        agent_prompt,
        child_profile,
        long_term_memories=dispatch_memories  # NEW
    )
```

---

### Phase 3: Python Worker - Save Memories at Session End

**Files to create/modify:**
- `main/livekit-server/src/services/mem0_service.py` (NEW FILE)
- `main/livekit-server/src/shared/entrypoint_utils.py`

**Task 3.1: Create mem0_service.py**
```python
# NEW FILE: main/livekit-server/src/services/mem0_service.py
"""
Mem0 Service - Long-term memory management for Cheeko agents
"""

import os
import logging
import asyncio
from typing import List, Dict, Any, Optional

logger = logging.getLogger("mem0_service")

class Mem0Service:
    """
    Service for interacting with Mem0 API for persistent memory.
    Handles conversation storage and fact extraction.
    """

    def __init__(self):
        self.api_key = os.getenv("MEM0_API_KEY")
        self.client = None

        if not self.api_key:
            logger.warning("[MEM0] MEM0_API_KEY not set. Memory features disabled.")
        else:
            try:
                from mem0 import MemoryClient
                self.client = MemoryClient(api_key=self.api_key)
                logger.info("[MEM0] Service initialized successfully")
            except ImportError:
                logger.error("[MEM0] mem0 package not installed. Run: pip install mem0ai")
            except Exception as e:
                logger.error(f"[MEM0] Failed to initialize: {e}")

    def _normalize_user_id(self, user_id: str) -> str:
        """Normalize MAC address to consistent format"""
        return user_id.replace(":", "").replace("-", "").lower()

    async def add_conversation(
        self,
        user_id: str,
        messages: List[Dict[str, Any]],
        session_id: str = None
    ) -> bool:
        """
        Send conversation transcript to Mem0 for fact extraction.
        This is called at session end (fire-and-forget).

        Args:
            user_id: Device MAC address
            messages: List of {chatType: 1|2, content: str, timestamp: int}
            session_id: Optional session identifier

        Returns:
            bool: True if successful, False otherwise
        """
        if not self.client:
            return False

        if not messages:
            logger.debug("[MEM0] No messages to add")
            return True

        try:
            clean_user_id = self._normalize_user_id(user_id)

            # Format messages for Mem0 API
            # chatType: 1 = user, 2 = agent
            formatted_messages = []
            for msg in messages:
                content = msg.get("content", "").strip()
                if content:
                    role = "user" if msg.get("chatType") == 1 else "assistant"
                    formatted_messages.append({
                        "role": role,
                        "content": content
                    })

            if not formatted_messages:
                return True

            # Add to Mem0 (synchronous call wrapped for async)
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: self.client.add(
                    formatted_messages,
                    user_id=clean_user_id,
                    metadata={"session_id": session_id} if session_id else None
                )
            )

            logger.info(f"[MEM0] Added {len(formatted_messages)} messages for user {clean_user_id}")
            return True

        except Exception as e:
            logger.error(f"[MEM0] Failed to add conversation: {e}")
            return False

    async def get_memories(self, user_id: str, limit: int = 20) -> List[str]:
        """
        Retrieve memories for a user using semantic search.

        Args:
            user_id: Device MAC address
            limit: Maximum number of memories to retrieve

        Returns:
            List of memory strings
        """
        if not self.client:
            return []

        try:
            clean_user_id = self._normalize_user_id(user_id)

            # Use semantic search for relevant memories
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(
                None,
                lambda: self.client.search(
                    "What is known about this person, their family, pets, interests, and learning?",
                    user_id=clean_user_id,
                    limit=limit
                )
            )

            if results and isinstance(results, list):
                memories = [m.get('memory', '') for m in results if m.get('memory')]
                logger.info(f"[MEM0] Retrieved {len(memories)} memories for {clean_user_id}")
                return memories

            return []

        except Exception as e:
            logger.error(f"[MEM0] Failed to get memories: {e}")
            return []


# Singleton instance
mem0_service = Mem0Service()
```

**Task 3.2: Integrate into session cleanup**
```python
# entrypoint_utils.py - update extract_and_send_chat_history
import asyncio
from src.services.mem0_service import mem0_service

async def extract_and_send_chat_history(
    session,
    chat_history_service,
    device_mac: str = None  # NEW PARAMETER
):
    """
    Extract chat history from session and send to Manager API and Mem0.
    """
    # ... existing extraction code ...

    # Send to Manager API (existing)
    if chat_history_service:
        await chat_history_service.send_history_on_close()

    # NEW: Also send to Mem0 for fact extraction (fire-and-forget)
    if device_mac and chat_history_service and chat_history_service.conversation_history:
        # Non-blocking - don't wait for Mem0
        asyncio.create_task(
            mem0_service.add_conversation(
                user_id=device_mac,
                messages=chat_history_service.conversation_history,
                session_id=chat_history_service.session_id
            )
        )
        logger.info(f"[MEM0] Queued {len(chat_history_service.conversation_history)} messages for memory extraction")
```

**Task 3.3: Pass device_mac to cleanup in worker**
```python
# cheeko_worker.py (~line 305, in cleanup_room_and_session)
await extract_and_send_chat_history(
    session,
    chat_history_service,
    device_mac=device_mac  # NEW
)
```

---

### Phase 4: Update Prompt Templates

**Files to modify:**
- `main/livekit-server/src/prompts/cheeko.yaml`
- `main/livekit-server/src/prompts/math_tutor.yaml`
- `main/livekit-server/src/prompts/riddle_solver.yaml`
- `main/livekit-server/src/prompts/word_ladder.yaml`

**Add memory section to each prompt template:**
```yaml
# Add after the child profile section in each prompt:

{% if long_term_memories %}

## WHAT YOU REMEMBER ABOUT {{ child_name }}:
These are facts you've learned from previous conversations. Use them naturally:
{% for memory in long_term_memories %}
- {{ memory }}
{% endfor %}

{% endif %}
```

---

## 5. Files Summary

| File | Action | Description |
|------|--------|-------------|
| `mqtt-gateway/core/mem0-integration.js` | **Create** | Orchestration layer (timeout, helpers) |
| `mqtt-gateway/core/mem0-client.js` | Modify | Update to use semantic search |
| `mqtt-gateway/gateway/virtual-connection.js` | Modify | **~10 lines only** (import + 2 calls) |
| `livekit-server/src/services/mem0_service.py` | **Create** | Python Mem0 service wrapper |
| `livekit-server/src/shared/entrypoint_utils.py` | Modify | Add memories param, Mem0 save |
| `livekit-server/workers/cheeko_worker.py` | Modify | Use dispatch metadata |
| `livekit-server/workers/game_worker.py` | Modify | Same changes as cheeko_worker |
| `livekit-server/src/prompts/*.yaml` | Modify | Add memory Jinja2 block |

---

## 6. Performance Safeguards

| Safeguard | Implementation | Impact |
|-----------|---------------|--------|
| **2-second timeout** | `Promise.race()` in fetchMem0Memories | Prevents slow Mem0 blocking session |
| **Graceful degradation** | Return `[]` on error | Agent works without memories |
| **Fire-and-forget saves** | `asyncio.create_task()` | User not blocked on session end |
| **Parallel fetches** | `Promise.all()` | No additional latency |
| **Memory limit** | `limit: 20` in search | ~500 tokens max in prompt |

---

## 7. Knowledge Graph Schema

Mem0 supports **full knowledge graph** with entities, relations, and automatic extraction. Enable with `enable_graph=True`.

### Graph Memory Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     MEM0 KNOWLEDGE GRAPH LAYERS                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. SOCIAL & IDENTITY LAYER (Inner Circle)                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ Entities: Child, Family Member, Friend, Pet                     │    │
│  │ Relations: HAS_BROTHER, HAS_SISTER, HAS_PET, PLAYS_WITH         │    │
│  │                                                                 │    │
│  │ "My big brother Aarav is 10 years old"                          │    │
│  │    (Child) ──[HAS_BROTHER]──> (Aarav {age: 10, type: person})   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  2. INTERESTS & PREFERENCES LAYER (Favorites Map)                       │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ Entities: Topic, Activity, Media, Food                          │    │
│  │ Relations: LIKES, DISLIKES, ASPIRATION, SCARED_OF               │    │
│  │                                                                 │    │
│  │ "I want to be an astronaut but I'm afraid of the dark"          │    │
│  │    (Child) ──[ASPIRATION]──> (Astronaut {type: career})         │    │
│  │    (Child) ──[SCARED_OF]──> (Dark {type: fear})                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  3. LEARNING & COGNITIVE LAYER (Academic Progress)                      │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ Entities: Subject, Skill, Milestone                             │    │
│  │ Relations: MASTERED, LEARNING, STRUGGLES_WITH                   │    │
│  │                                                                 │    │
│  │ "I finally finished my 2-digit addition homework!"              │    │
│  │    (Child) ──[MASTERED]──> (2-Digit Addition {type: skill})     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  4. DAILY ROUTINE & HABIT LAYER (Rhythm)                                │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ Entities: Routine, TimeSlot, Event                              │    │
│  │ Relations: HAS_BEDTIME, ATTENDS_SCHOOL, HAS_HABIT               │    │
│  │                                                                 │    │
│  │ "Mom says I have to go to bed at 8:00 PM"                       │    │
│  │    (Child) ──[HAS_BEDTIME]──> (8:00 PM {type: time})            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  5. EMOTIONAL & PERSONALITY LAYER (Vibe)                                │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ Entities: Trait, EmotionalState                                 │    │
│  │ Relations: CHARACTERIZED_BY, CURRENTLY_FEELING                  │    │
│  │                                                                 │    │
│  │ "I'm feeling really happy today because it's Friday!"           │    │
│  │    (Child) ──[FEELING]──> (Happy {reason: "Friday"})            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Mem0 Graph Memory Response Format

When `enable_graph=True`, Mem0 returns both memories AND relations:

```json
{
  "results": [
    {
      "id": "memory-123",
      "memory": "Has a brother named Aarav who is 10 years old",
      "categories": ["personal_details"],
      "entities": [
        {"id": "e1", "name": "Aarav", "type": "person"},
        {"id": "e2", "name": "10", "type": "age"}
      ],
      "relations": [
        {"source": "child", "target": "Aarav", "relationship": "has_brother"}
      ]
    }
  ],
  "relations": [
    {"source": "child", "source_type": "person", "relationship": "has_brother", "target": "aarav", "target_type": "person"},
    {"source": "aarav", "source_type": "person", "relationship": "age", "target": "10", "target_type": "age"}
  ]
}
```

### Implementation: Enable Graph Memory

**Task: Update mem0-client.js to use graph memory:**

```javascript
// mem0-client.js - enable graph memory
async getMemories(userId) {
  if (!this.client || !userId) return [];

  try {
    const cleanUserId = userId.replace(/:/g, "").toLowerCase();

    // Enable graph memory for rich entity/relation extraction
    const results = await this.client.search(
      "What is known about this person, their family, pets, interests, skills, and routines?",
      {
        user_id: cleanUserId,
        limit: 20,
        enable_graph: true  // ENABLE GRAPH MEMORY
      }
    );

    if (results) {
      // Return both memories and relations
      return {
        memories: results.results?.map(m => m.memory) || [],
        relations: results.relations || [],
        entities: this._extractEntities(results.results)
      };
    }
    return { memories: [], relations: [], entities: [] };
  } catch (error) {
    logger.error(`[MEM0] Search Error: ${error.message}`);
    return { memories: [], relations: [], entities: [] };
  }
}

_extractEntities(results) {
  const entities = new Map();
  for (const r of results || []) {
    for (const e of r.entities || []) {
      entities.set(e.name, { name: e.name, type: e.type });
    }
  }
  return Array.from(entities.values());
}
```

**Task: Update Python mem0_service.py to save with graph:**

```python
# mem0_service.py - enable graph on add
async def add_conversation(self, user_id: str, messages: list, session_id: str = None) -> bool:
    # ... format messages ...

    # Add with graph memory enabled
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        lambda: self.client.add(
            formatted_messages,
            user_id=clean_user_id,
            enable_graph=True,  # ENABLE GRAPH EXTRACTION
            metadata={"session_id": session_id} if session_id else None
        )
    )
```

### Example Graph Queries

Mem0 automatically extracts and organizes:

| Child Says | Mem0 Extracts |
|------------|---------------|
| "My brother Aarav is 10" | `(Child) --[HAS_BROTHER]--> (Aarav {age: 10})` |
| "I love dinosaurs!" | `(Child) --[LIKES]--> (Dinosaurs {type: topic})` |
| "I can do multiplication now" | `(Child) --[MASTERED]--> (Multiplication {type: skill})` |
| "My dog Max is fluffy" | `(Child) --[HAS_PET]--> (Max {type: dog})` |
| "I go to bed at 8pm" | `(Child) --[HAS_BEDTIME]--> (8:00 PM)` |

---

## 8. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Memory retrieval | Semantic search (top 20) | More relevant than get_all |
| Token budget | ~500 tokens | Balances context vs prompt size |
| Agent scope | All agents share memory | Unified "personality" across modes |
| Error handling | Graceful degradation | Never break session for memory |
| Save timing | Session end only | No runtime latency impact |

---

## 9. Success Criteria

- [ ] Agent mentions a fact from previous session within first 3 turns
- [ ] Room join time remains under 2.5 seconds (currently ~2s)
- [ ] No errors when Mem0 is unavailable (graceful fallback)
- [ ] Memories visible across all 4 agent types
- [ ] Facts consolidate over time (no duplicates)

---

## 10. Testing Plan

### Unit Tests
1. `test_mem0_service.py` - Test add_conversation, get_memories
2. `test_render_with_memories.py` - Test prompt rendering with memories

### Integration Tests
1. Session start with Mem0 available - memories in prompt
2. Session start with Mem0 timeout - graceful degradation
3. Session end - transcript sent to Mem0
4. Cross-agent memory - Math Tutor sees Cheeko's memories

### Manual Testing
1. Talk to Cheeko, mention facts (name, pet, interests)
2. End session, wait 30 seconds
3. Start new session - verify Cheeko remembers
4. Switch to Math Tutor - verify it also knows the facts

---

## 11. Rollback Plan

If issues arise:
1. Remove `long_term_memories` from dispatch metadata
2. Comment out Mem0 fetch in `virtual-connection.js`
3. Comment out Mem0 save in `entrypoint_utils.py`
4. Agent reverts to profile-only personalization
