# LiveKit Agent Optimization Plan

## Overview

This document outlines the optimization strategy for Cheeko LiveKit agents to improve response time, reduce costs, and enhance overall performance.

**Current State:**
- Total initialization time: ~1800-2200ms
- Prompt length: ~6500 chars
- First response time: ~2-4 seconds

**Target State:**
- Total initialization time: <1200ms
- Prompt length: ~2500 chars
- First response time: <2 seconds

---

## Phase 1: Quick Wins (Week 1)

### 1.1 Trim Prompt Length

**Priority:** HIGH
**Effort:** Low
**Impact:** 300-800ms saved

| Section | Current | Target | Action |
|---------|---------|--------|--------|
| `<communication_length_constraint>` | ~500 chars | ~50 chars | Condense to single rule |
| `<emotion>` | ~400 chars | ~150 chars | Remove verbose examples |
| `<tool_calling>` | ~800 chars | ~300 chars | Keep essential rules only |
| `<speaker_recognition>` | ~200 chars | 0 chars | Remove if unused |
| `<music_and_story_tools>` | ~600 chars | ~200 chars | Condense instructions |

**Before:**
```
<communication_length_constraint>
【Core Goal】All long text content output (stories, news, knowledge explanations, etc.),
**single reply length must not exceed 300 characters**, using segmented guidance approach.
- **Segmented Narration:**
  - Basic segment: 200-250 characters core content + 30 characters guidance
  - When content exceeds 300 characters, prioritize telling the beginning...
  [... 400 more chars ...]
</communication_length_constraint>
```

**After:**
```
<length_rule>
Keep responses under 300 chars. For longer content, segment and ask "Want me to continue?"
</length_rule>
```

---

### 1.2 Lazy-Load Music Service

**Priority:** HIGH
**Effort:** Low
**Impact:** 100-200ms saved

**Current:** Music service initializes on every session start
```python
music_service = MusicService()
asyncio.create_task(music_service.initialize())  # Blocks Qdrant connection
```

**Optimized:** Initialize only when music is requested
```python
# In cheeko_worker.py
music_service = None  # Lazy init

async def get_music_service():
    global music_service
    if music_service is None:
        music_service = MusicService()
        await music_service.initialize()
    return music_service
```

---

### 1.3 Shorter Greeting Instruction

**Priority:** MEDIUM
**Effort:** Low
**Impact:** 50-100ms saved

**Current:**
```python
GREETING_INSTRUCTION = "Greet the user warmly. Keep it brief and friendly."
```

**Optimized (with personalization):**
```python
GREETING_INSTRUCTION = "Say hi to {child_name}!"  # Inject at runtime
```

---

### 1.4 Reduce Greeting Retries

**Priority:** LOW
**Effort:** Low
**Impact:** Faster failure recovery

**Current:** 3 retries with 2s delay each
```python
max_retries = 3
await asyncio.sleep(2.0)
```

**Optimized:** 2 retries with 1s delay
```python
max_retries = 2
await asyncio.sleep(1.0)
```

---

## Phase 2: Prompt Optimization (Week 2)

### 2.1 Optimized Prompt Structure

**Target: ~2500 characters**

```
<identity>                    (~300 chars)
- Name, personality, age range
- Core character traits

<behavior>                    (~400 chars)
- Communication style
- Response length rules
- Emotional expressions

<tools>                       (~400 chars)
- Music playback
- Mode switching
- Device controls

<safety>                      (~200 chars)
- Content guidelines
- Boundaries

<context>                     (~200 chars)
- Current time: {{current_time}}
- Child: {{child_name}}, age {{child_age}}

Total: ~1500 chars base + ~500 dynamic = ~2000 chars
```

### 2.2 Remove Unused Sections

Review and remove if not actively used:
- [ ] `<speaker_recognition>` - Multi-speaker detection
- [ ] `<memory>` - If not implemented
- [ ] Lunar calendar references - If not used in India

### 2.3 Consolidate Tool Instructions

**Before:** Separate sections for each tool type
**After:** Single `<tools>` section with concise descriptions

---

## Phase 3: Code Optimizations (Week 3)

### 3.1 Production Logging

**File:** `src/utils/loki_agent_logger.py`

```python
# Add environment check
import os

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

if LOG_LEVEL == "DEBUG":
    logger.setLevel(logging.DEBUG)
else:
    logger.setLevel(logging.INFO)
    # Disable debug logs in production
```

### 3.2 Reuse aiohttp Sessions

**Current:** New session per request
```python
async with aiohttp.ClientSession() as session:
    async with session.post(url) as response:
        ...
```

**Optimized:** Shared session with connection pooling
```python
# Global session (create once)
_http_session = None

async def get_http_session():
    global _http_session
    if _http_session is None:
        connector = aiohttp.TCPConnector(limit=10, keepalive_timeout=30)
        _http_session = aiohttp.ClientSession(connector=connector)
    return _http_session
```

### 3.3 Batch Data Channel Publishes

**Current:** Individual publish per state change
```python
await ctx.room.local_participant.publish_data(payload1)
await ctx.room.local_participant.publish_data(payload2)
```

**Optimized:** Batch when possible
```python
# Debounce rapid state changes
STATE_DEBOUNCE_MS = 350  # Already implemented ✓
```

---

## Phase 4: Architecture (Week 4+)

### 4.1 Prewarm Gemini Connection (Optional)

**Complexity:** HIGH
**Benefit:** 200-500ms
**Recommendation:** Only if other optimizations aren't enough

```python
def prewarm(proc: JobProcess):
    # Create but don't start the model
    realtime_model = google.realtime.RealtimeModel(
        model="gemini-2.0-flash-live",
        voice="Zephyr",
        instructions="",  # Empty for prewarm
    )
    proc.userdata["prewarmed_model"] = realtime_model
    logger.info("[PREWARM] Gemini connection prewarmed")
```

**Challenges:**
- Connection timeout after ~5-10 min idle
- Need reconnection logic
- Instructions must be updated when user joins

### 4.2 Edge Caching for Prompts

**Complexity:** HIGH
**Benefit:** 20-50ms per request

Cache prompt templates at edge (CloudFront/Cloudflare):
- Static parts cached
- Dynamic parts injected at runtime

---

## Phase 5: Cost Optimizations

### 5.1 Token Usage Reduction

| Optimization | Token Savings |
|--------------|---------------|
| Shorter prompt | ~2000 input tokens/session |
| Limit response length | ~500 output tokens/response |
| Remove verbose instructions | ~1000 input tokens/session |

**Estimated savings:** 20-30% per session

### 5.2 Model Selection

| Model | Speed | Cost | Use Case |
|-------|-------|------|----------|
| `gemini-2.5-flash-native-audio` | Slower | Higher | Current |
| `gemini-2.0-flash-live` | Faster | Lower | Recommended |

---

## Metrics & Monitoring

### Key Metrics to Track

```python
# Add to each worker
metrics = {
    "init_time_ms": 0,
    "first_response_ms": 0,
    "prompt_length": 0,
    "session_duration_s": 0,
    "messages_count": 0,
}
```

### Logging Checkpoints

```python
logger.info(f"[METRICS] Init: {init_time}ms, Prompt: {len(prompt)} chars")
logger.info(f"[METRICS] First response: {first_response_time}ms")
logger.info(f"[METRICS] Session end: {duration}s, {message_count} messages")
```

---

## Implementation Checklist

### Phase 1 (Week 1)
- [ ] Trim `<communication_length_constraint>` section
- [ ] Trim `<emotion>` section
- [ ] Trim `<tool_calling>` section
- [ ] Implement lazy music service loading
- [ ] Shorten greeting instruction
- [ ] Reduce greeting retries to 2

### Phase 2 (Week 2)
- [ ] Audit prompt for unused sections
- [ ] Remove `<speaker_recognition>` if unused
- [ ] Consolidate tool instructions
- [ ] Test with ~2500 char prompt

### Phase 3 (Week 3)
- [ ] Add LOG_LEVEL environment variable
- [ ] Implement shared aiohttp session
- [ ] Review and optimize API call patterns

### Phase 4 (Week 4+)
- [ ] Evaluate if prewarm is needed
- [ ] Consider edge caching if scaling

---

## Success Criteria

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Init time | ~2000ms | <1200ms | Pending |
| Prompt length | ~6500 chars | <3000 chars | Pending |
| First response | ~3-4s | <2s | Pending |
| Memory per worker | TBD | TBD | Pending |
| Cost per session | TBD | -20% | Pending |

---

## Notes

- Always test optimizations in staging before production
- Monitor for regressions in response quality
- Some optimizations may conflict (e.g., shorter prompt vs better context)
- Measure before and after each change

---

*Last updated: December 2025*
