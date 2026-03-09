# Cheeko Agent: Edge Cases, Failure Points & Unexpected Behaviors

> Comprehensive audit of the ESP32 → MQTT Gateway → Cheeko Agent lifecycle.
> Generated from code analysis on 2026-03-06.

---

## Table of Contents

1. [Phase 1: OTA & Device Bootstrap](#1-ota--device-bootstrap)
2. [Phase 2: MQTT Connection & Hello Handshake](#2-mqtt-connection--hello-handshake)
3. [Phase 3: Room Creation & Agent Dispatch](#3-room-creation--agent-dispatch)
4. [Phase 4: Agent Startup](#4-agent-startup)
5. [Phase 5: Greeting](#5-greeting)
6. [Phase 6: Conversation Loop](#6-conversation-loop)
7. [Phase 7: Memory Injection (Mid-Conversation)](#7-memory-injection-mid-conversation)
8. [Phase 8: Mode Switching / Character Change](#8-mode-switching--character-change)
9. [Phase 9: Cleanup & Shutdown](#9-cleanup--shutdown)
10. [Cross-Cutting Concerns](#10-cross-cutting-concerns)
11. [Summary Table](#11-summary-table)

---

## 1. OTA & Device Bootstrap

### 1.1 Activation Code Race Condition
**File:** `manager-api-node/src/routes/ota.routes.js` (lines 488-501)
- No atomic check-before-insert for activation codes
- Two concurrent OTA requests for same MAC can generate duplicate codes
- Last code wins; earlier code becomes invalid
- **Impact:** User can't activate device with the code they received

### 1.2 Silent API Failures in OTA Response
**File:** `manager-api-node/src/routes/ota.routes.js` (lines 153-162)
- `checkOtaVersion()` failure is caught but only logged
- If database queries timeout (lines 437, 445, 467), device gets incomplete response
- Error responses return `{ error: error.message }` while success returns `{ code, msg, data }` — inconsistent format
- **Impact:** Device boots with invalid firmware config or fails to parse error

### 1.3 Hardcoded WebSocket Fallback
**File:** `manager-api-node/src/services/device.service.js` (lines 467-475)
- If `getSystemParam('server.websocket')` returns null, falls back to `ws://192.168.1.99:8000/`
- **Impact:** Production devices could connect to a dev/local address

---

## 2. MQTT Connection & Hello Handshake

### 2.1 Duplicate HELLO Race Condition (CRITICAL)
**File:** `mqtt-gateway/gateway/mqtt-gateway.js` (lines 2060-2099)
- Device sends HELLO twice rapidly (network retry, firmware bug)
- First HELLO: room created, agent dispatched
- Second HELLO arrives before first connection finishes
- Old connection marked `closing = true` but `oldConnection.close()` is NOT awaited
- New connection overwrites `deviceConnections[deviceId]`
- **Impact:** Audio misdirected to wrong session; device hears audio from stale session

### 2.2 Connection Cleanup Timer Race
**File:** `mqtt-gateway/mqtt/virtual-connection.js` (lines 1594-1607)
- Uses 2-second delayed deletion to avoid race with new connection
- If device reconnects in < 100ms, first cleanup timer still pending when second hello arrives
- **Impact:** New connection's `deviceConnections` entry deleted by old cleanup timer

### 2.3 Unguarded Parallel API Calls in Hello
**File:** `mqtt-gateway/mqtt/virtual-connection.js` (lines 408-415)
```javascript
const [character, childProfile, memoryData] = await Promise.all([
    this.fetchCurrentCharacter(this.deviceId),   // 5s timeout
    this.fetchChildProfile(this.deviceId),        // 5s timeout
    fetchMemoriesWithTimeout(this.deviceId)        // 2s timeout
]);
```
- Total hello time = max(5s, 5s, 2s) = 5s worst case
- No overall timeout wrapping the group
- **Impact:** Device may timeout waiting for `mode_update` response

### 2.4 Silent Mode Fallback
**File:** `mqtt-gateway/mqtt/virtual-connection.js` (lines 357-362, 392-394)
- Mode fetch failure defaults to `"conversation"`
- PTT mode fetch failure defaults to `"manual"`
- Device configured for `"music"` in database gets `"conversation"` silently
- **Impact:** Device connects to wrong agent type

### 2.5 Malformed clientId — No Error to Device
**File:** `mqtt-gateway/mqtt/virtual-connection.js` (lines 83-122)
- Expects format `GID@@@MAC@@@UUID`
- If malformed, `this.close()` called but no error message sent to device
- **Impact:** Device waits for `mode_update` forever; times out silently

### 2.6 Memory Fetch Timeout Doesn't Cancel Request
**File:** `mqtt-gateway/core/mem0-integration.js`
- `Promise.race` fires when timeout wins, but `mem0Client.getMemories()` keeps running in background
- **Impact:** Memory leak; background request completes after connection closed (use-after-close crash risk)

### 2.7 Child Profile Fetch Can Silently Fail
**File:** `mqtt-gateway/mqtt/virtual-connection.js` (lines 731-764)
- Fetch error returns `null`, passed to agent as `null`
- No validation that childProfile is non-null before dispatch
- **Impact:** Agent receives incomplete metadata, may generate age-inappropriate responses

### 2.8 UDP remoteAddress Never Initialized
**File:** `mqtt-gateway/mqtt/virtual-connection.js` (lines 425-433, 285-288)
- If device connects via MQTT but never sends a UDP audio packet, `udp.remoteAddress` stays null
- `sendUdpMessage` silently drops data if remoteAddress is null
- **Impact:** Device never receives audio (completely silent)

---

## 3. Room Creation & Agent Dispatch

### 3.1 Agent Deployment Flag Race (CRITICAL)
**File:** `mqtt-gateway/mqtt/virtual-connection.js` (lines 612-635)
```javascript
this.bridge.agentDeployed = true;  // SET BEFORE dispatch
await this.gateway.agentDispatchClient.createDispatch(...);  // ASYNC
```
- Flag set BEFORE dispatch call; if dispatch fails, flag is already `true`
- Flag reset on error (lines 632-633), but another check could happen between failure and reset
- **Impact:** If network hiccups during dispatch, retry is skipped, agent never joins

### 3.2 Duplicate Agents in Room
**File:** `mqtt-gateway/livekit/livekit-bridge.js` (lines 699-760)
- `removeParticipant()` on duplicate is NOT awaited (line 713)
- Uses `.then()/.catch()` pattern — fire and forget
- If removal fails, duplicate stays in room; code continues as if success
- **Impact:** Both agents send audio simultaneously; device hears corrupted audio mix

### 3.3 Audio Track Subscription Before Agent Joins
**File:** `mqtt-gateway/livekit/livekit-bridge.js` (lines 507-688)
- TrackSubscribed handler doesn't guard against missing agent
- If device sends audio before agent joins, LiveKit drops it
- **Impact:** Device's first utterance after connection may be lost

### 3.4 Agent Dispatch Doesn't Wait for Agent Ready
**File:** `mqtt-gateway/mqtt/virtual-connection.js` (lines 612-635), `livekit-bridge.js` (lines 744-759)
- Dispatch is async; no guarantee agent has joined when `ready_for_greeting` is sent
- `ready_for_greeting` sent on ParticipantConnected, but agent may not be initialized yet
- **Impact:** Greeting may fail on first attempt; relies on retry logic

---

## 4. Agent Startup

### 4.1 Missing Environment Variable Validation
**File:** `livekit-server/workers/cheeko_worker.py` (lines 260-262)
```python
manager_api_url = os.getenv("MANAGER_API_URL")
manager_api_secret = os.getenv("MANAGER_API_SECRET")
```
- No validation that these are non-empty
- DatabaseHelper constructor doesn't validate either
- **Impact:** All API calls fail silently with cryptic 400/404 errors instead of early startup failure

### 4.2 No Overall Timeout on Parallel API Calls
**File:** `livekit-server/workers/cheeko_worker.py` (lines 268-312)
- Each API call has 10s timeout, but combined could take 30+ seconds
- Worker timeout is 120s (line 918), but no timeout for the critical startup phase
- **Impact:** Device experiences long delay before agent is ready

### 4.3 Dispatch Metadata Ignored After Partial API Success
**File:** `livekit-server/workers/cheeko_worker.py` (lines 236-253, 269-277)
- Gateway pre-fetches child profile + Mem0 data in dispatch metadata
- If `dispatch_child_profile` exists, API call is skipped (good)
- But if the API call IS made and fails, code doesn't re-check dispatch metadata as fallback
- **Impact:** Child profile data is wasted when API fails

### 4.4 Jinja2 Template Fallback Is Incomplete
**File:** `livekit-server/src/shared/entrypoint_utils.py` (lines 184-256)
```python
except Exception as e:
    # Fallback: simple string replacement
    agent_prompt = agent_prompt.replace("{{ child_name }}", child_profile.get('name', ''))
```
- Only handles `{{ child_name }}` format
- Misses: `{{child_name}}`, `{{ child_age }}`, `{{ child_interests }}`, etc.
- If template has Jinja loops/conditionals, fallback breaks silently
- **Impact:** Agent prompt contains raw template syntax instead of child's info

### 4.5 Gemini API Key Validated Too Late
**File:** `livekit-server/workers/cheeko_worker.py` (lines 211-213, 350-359)
- API key loaded from config.yaml, but never validated until Gemini model creation
- No connectivity test during startup
- **Impact:** Runtime failure with cryptic Google API error instead of clear startup failure

### 4.6 No Fallback LLM
- Unlike game workers, Cheeko has no fallback if Gemini Realtime fails to initialize
- LiveKit's `FallbackAdapter` does NOT support RealtimeModel (only STT/LLM/TTS)
- **Impact:** Complete agent failure if Google API is down

### 4.7 Error Handler Mutates `ev.error.recoverable` (LiveKit Anti-Pattern)
**File:** `livekit-server/src/agent/error_handler.py` (lines 164, 189, 214)
```python
ev.error.recoverable = True  # MUTATING LiveKit's error state
```
- Error handler sets `recoverable = True` on errors LiveKit marked as unrecoverable
- This tells LiveKit "this error is fine, keep going" even when it may not be
- LiveKit framework behavior after mutation is undocumented — may mask cascading failures
- Additionally, `session.say()` inside error handler can itself fail (circular error)
- **Impact:** Errors suppressed; session continues in degraded state without user knowing

### 4.8 Error Handler Event Name Mismatch
**File:** `livekit-server/src/agent/error_handler.py` (lines 139-155)
```python
@session.on("agent_speech_committed")  # NOT a standard LiveKit event
@session.on("user_speech_committed")   # NOT a standard LiveKit event
```
- LiveKit docs list events: `user_input_transcribed`, `conversation_item_added`, `speech_created`, `agent_state_changed`, `user_state_changed`, `close`, `error`, `metrics_collected`
- `agent_speech_committed` and `user_speech_committed` are NOT in official LiveKit event docs
- These may be deprecated/renamed events from an older SDK version
- If events never fire, error counts never reset — max_retries exhausted prematurely
- **Impact:** Error recovery counts accumulate; agent declares "unrecoverable" too early

### 4.9 No `prewarm` for VAD or Gemini Model
**Ref:** LiveKit docs — `prewarm` for faster connections
- LiveKit recommends prewarming VAD and model instances in `setup_fnc`/`prewarm_fnc`
- Cheeko's `prewarm()` function (line 152) only initializes ConfigLoader
- Gemini RealtimeModel created fresh every session (line 351) — adds 1-3s latency
- Silero VAD not used (Gemini built-in), but ElevenLabs TTS also not prewarmed
- **Impact:** Slower agent startup; higher time-to-first-greeting

---

## 5. Greeting

### 5.1 Session Reference Race Condition (CRITICAL)
**File:** `livekit-server/src/shared/base_assistant.py`, `cheeko_worker.py` (line 653 vs 876)
```python
# Data channel handler (can fire early):
asyncio.create_task(assistant.play_greeting())  # line 653

# Session reference set later:
assistant.set_agent_session(session)  # line 876
```
- `ready_for_greeting` can arrive via data channel BEFORE `set_agent_session()` is called
- `play_greeting()` accesses `self.session.generate_reply()` which may be `None`
- **Impact:** `AttributeError` crash on greeting; agent becomes unresponsive

### 5.2 No Timeout on `await speech_handle`
**File:** `livekit-server/src/shared/base_assistant.py` (lines 100-105)
```python
speech_handle = self.session.generate_reply(instructions=self.GREETING_INSTRUCTION)
await speech_handle  # Could hang forever
```
- No `asyncio.wait_for()` wrapping the await
- **Impact:** Greeting hangs indefinitely if Gemini audio processing stalls

### 5.3 Greeting Duplication Race
**File:** `livekit-server/src/shared/base_assistant.py` (lines 84-87)
- `greeting_played` flag set only after successful greeting (line 114)
- If two `ready_for_greeting` messages arrive before first completes, both call `play_greeting()`
- No mutex/lock protection
- **Impact:** Device hears greeting twice

### 5.4 Fixed Retry Delay (No Exponential Backoff)
**File:** `livekit-server/src/shared/base_assistant.py` (lines 111, 120)
- Waits 2s between interrupt retries, 3s between RealtimeError retries
- All retries use same delay
- Initial 3s sleep before first attempt (line 93) wastes time if Gemini is already connected
- **Impact:** Slower recovery; first greeting attempt delayed unnecessarily

### 5.5 Gemini WebSocket Not Ready on Cold Start (CONFIRMED IN PRODUCTION)
**File:** `livekit-server/src/shared/base_assistant.py` (lines 93, 101-105)
**Error observed on Cerebrium:**
```
RealtimeError: generate_reply timed out waiting for generation_created event.
```
- `play_greeting()` uses a blind `await asyncio.sleep(3.0)` (line 93) before calling `generate_reply()`
- On serverless platforms (Cerebrium), cold start adds 5-15s container spin-up + Gemini WebSocket connection time
- 3s sleep is NOT enough — Gemini WebSocket still connecting when `generate_reply()` fires
- `generate_reply()` sends request to Gemini, waits for `generation_created` ACK, times out because WebSocket not ready
- Retry logic (line 96-128) catches the `RealtimeError` and retries after 3s more — greeting eventually works on attempt 2 or 3
- But first attempt always fails on cold starts, adding 3-6s unnecessary delay before child hears greeting
- **Root cause:** No readiness check — code guesses with a sleep instead of waiting for Gemini to signal it's connected
- **Fix:** Replace blind sleep with readiness polling (check `_rt_session` state), add `asyncio.wait_for()` timeout on `await speech_handle`, use exponential backoff (2s, 4s, 6s)
- **Impact:** First greeting always fails on cold start; 6+ second delay before child hears anything

---

## 6. Conversation Loop

### 6.1 Data Channel Message Errors Not Distinguished
**File:** `livekit-server/workers/cheeko_worker.py` (lines 643-821)
- All JSON parsing errors caught in single `except` block
- No distinction between malformed JSON (gateway bug), unknown msg_type, or missing fields
- Empty content messages silently ignored without notifying gateway
- **Impact:** Hard to debug communication issues between gateway and agent

### 6.2 ElevenLabs Fallback Has No Timeout
**File:** `livekit-server/workers/cheeko_worker.py` (lines 710-747)
- If ElevenLabs fails, falls back to `session.generate_reply()` with no timeout
- If Gemini fallback also fails, exception caught by outer try-except with generic error
- **Impact:** Agent hangs on TTS failure; no way to distinguish ElevenLabs vs Gemini failure

### 6.3 Audio Caching Race Condition
**File:** `livekit-server/workers/cheeko_worker.py` (lines 768-794)
- S3 cache write is non-blocking (`asyncio.create_task`)
- No deduplication if same content requested twice before first cache write completes
- **Impact:** Duplicate S3 writes; wasted bandwidth

### 6.4 No `user_away` Handling (LiveKit Feature Gap)
**Ref:** LiveKit docs — `user_away_timeout` defaults to 15s
- LiveKit emits `user_state_changed` → `away` when user is silent for 15s
- Cheeko agent does NOT listen for this event
- Child may walk away from device; agent keeps session open indefinitely
- No "are you still there?" prompt or auto-disconnect
- **Impact:** Zombie sessions consume resources; device stays "in call" forever

### 6.5 No `FallbackAdapter` for Gemini Realtime (LiveKit Feature Gap)
**Ref:** LiveKit docs — `FallbackAdapter` for STT/LLM/TTS
- LiveKit provides `FallbackAdapter` for automatic failover between providers
- Cheeko uses single Gemini Realtime with no fallback LLM
- LiveKit docs note: FallbackAdapter does NOT support RealtimeModel — only STT/LLM/TTS
- But ElevenLabs TTS also has no fallback; if ElevenLabs is down, `session.say()` fails
- **Impact:** Single point of failure for both LLM and TTS

### 6.6 `generate_reply()` Output Not Guaranteed for Scripted Content
**Ref:** LiveKit docs — "Realtime models don't offer a method to directly generate speech from a text script"
- `session.generate_reply(instructions=...)` used throughout for: greeting, memory injection, animal descriptions fallback, goodbye message
- LiveKit docs explicitly warn: "the output isn't guaranteed to precisely follow any provided script"
- For scripted content (animal facts, goodbye messages), agent may paraphrase or hallucinate
- **Recommendation:** Use `session.say()` with ElevenLabs TTS for scripted content (already done for animal audio, but not for goodbye/memory injection)

### 6.7 Interrupted Tool Calls Not Handled
**Ref:** LiveKit docs — tools can be interrupted when user speaks
- `update_agent_mode` tool (mode switching) is interruptible by default
- If user interrupts mid-mode-switch, tool is "removed from history and the result is ignored"
- But `character-change` data channel message may have already been sent to gateway
- Gateway starts agent swap; tool result is discarded; agent doesn't know swap is happening
- No `run_ctx.disallow_interruptions()` call in `update_agent_mode`
- **Impact:** Partial mode switch — gateway swaps agent but old agent doesn't know

### 6.8 `current_speech` Not Checked Before `generate_reply()`
**Ref:** LiveKit docs — `current_speech` property for coordinating with speaking state
- Memory injection calls `session.generate_reply()` without checking `session.current_speech`
- If agent is mid-speech, `generate_reply()` may queue or conflict
- LiveKit docs recommend checking `current_speech` to "prevent premature hangups"
- **Impact:** Overlapping speech generation; unpredictable behavior

### 6.9 No `conversation_item_added` Event Tracking
**Ref:** LiveKit docs — `conversation_item_added` event
- Cheeko doesn't listen to `conversation_item_added` events
- No way to track what's actually committed to chat context
- Interrupted responses are auto-truncated by LiveKit but Cheeko doesn't know
- Chat history extraction at cleanup may include items LiveKit already removed
- **Impact:** Chat history inconsistency; saved history may not match what user actually heard

### 6.10 Realtime Model Transcription Delay Not Handled
**Ref:** LiveKit docs — "user input transcriptions can be considerably delayed and often arrive after the agent's response"
- `user_speech_committed` event used for memory injection trigger
- But with Gemini Realtime, transcription arrives AFTER agent starts responding
- Memory injection triggered too late — agent already speaking
- The 0.3s delay in `inject_memory_context` doesn't account for this
- **Impact:** Memory context arrives after response already started; wasted API call

### 6.11 False Interruption Handling Not Configured
**Ref:** LiveKit docs — `resume_false_interruption` (default True), `false_interruption_timeout` (default 2s)
- Cheeko uses default settings for false interruption handling
- For children's device: background noise, TV, siblings talking → frequent false interruptions
- Default 2s timeout may be too long for children's attention span
- No custom `min_interruption_duration` or `min_interruption_words` tuning
- **Impact:** Agent stops mid-sentence for background noise; 2s pause before resuming feels unresponsive

### 6.12 `discard_audio_if_uninterruptible` Default Behavior
**Ref:** LiveKit docs — default `True`, drops buffered audio when agent can't be interrupted
- When `allow_interruptions=False` is used (e.g., error recovery messages), user audio is discarded
- Child may be speaking but audio is silently dropped
- No feedback to child that their speech was ignored
- **Impact:** Child thinks device is broken; speech silently lost during non-interruptible playback

### 6.13 Unbounded Chat Context Growth — No Truncation or Summarization
**Ref:** LiveKit `ChatContext.truncate()` and `ChatContext._summarize()` APIs
**Observed:** Production metrics show 9,450 text input tokens per turn (system prompt + tools + growing history)
- Chat context grows without bound as conversation progresses — no `truncate()` or summarization applied
- System prompt (~2-3K tokens) + tool definitions (~1-2K tokens) are constant overhead
- Conversation history accumulates unbounded: 10 turns ≈ 5K tokens, 30 turns ≈ 15K tokens
- Memory injection via `generate_reply(instructions=...)` adds context that persists in history
- LiveKit provides `ChatContext.truncate(max_items=N)` — preserves system instruction, removes leading orphan function calls
- LiveKit also provides `ChatContext._summarize(llm, keep_last_turns=N)` — LLM-powered compression of older turns
- Neither is used anywhere in Cheeko
- **Caveat:** `on_user_turn_completed` (ideal place for trimming) requires agent-side turn detection, not Gemini's built-in VAD
- Alternative trigger: `conversation_item_added` event with periodic `truncate()` call
- **Fix:** Add `chat_ctx.truncate(max_items=30)` triggered periodically (e.g., every 10 items via `conversation_item_added`); for richer context preservation, use `_summarize()` with a cheap LLM (e.g., `gemini-2.0-flash`)
- **Impact:** Token costs grow linearly per turn; TTFT increases as Gemini processes larger context; eventual context window overflow on long sessions

---

## 7. Memory Injection (Mid-Conversation)

### 7.1 Stale Debounce Timer
**File:** `livekit-server/workers/cheeko_worker.py` (lines 395-421)
```python
if memory_injection_in_progress or (current_time - last_memory_injection_time) < 5:
    return  # Timer NOT updated here if skipped!

memory_injection_in_progress = True
last_memory_injection_time = current_time  # Only updated if injection triggered
```
- Debounce timer only updated when injection is triggered, not when skipped
- If injection starts at T=0 and user speaks at T=3 (skipped), then at T=4 (also skipped — still within 5s of T=0)
- **Impact:** Memory searches blocked for unexpected durations

### 7.2 Pattern Matching Gaps
**File:** `livekit-server/workers/cheeko_worker.py` (lines 63-68)
- Substring matching: "my" appears in both "my dog" and "family name"
- Missing patterns: "Tell me about my cat" doesn't match "my cat" without "about" prefix
- Greedy matching could trigger for irrelevant queries
- **Impact:** False positives/negatives in memory retrieval

### 7.3 Mem0 Singleton Initialization — No Recovery
**File:** `livekit-server/src/services/mem0_service.py` (lines 24-40)
- Module-level singleton initialized on first import
- If `MEM0_API_KEY` is not set at import time, `is_ready()` returns False forever
- If `MemoryClient()` initialization fails once, no retry mechanism
- **Impact:** Memory features permanently disabled for entire worker process

### 7.4 No Timeout on Mem0 Search
**File:** `livekit-server/src/services/mem0_service.py` (lines 198-250)
```python
results = await loop.run_in_executor(None, lambda: self.client.search(...))
```
- Uses default `ThreadPoolExecutor` (limited to CPU count threads)
- No timeout on executor call
- **Impact:** If Mem0 API hangs, blocks a thread indefinitely; multiple hangs exhaust thread pool

### 7.5 Memory Injection vs Active Response Conflict
**File:** `livekit-server/workers/cheeko_worker.py` (lines 428-454)
- `session.generate_reply()` called for memory injection while model may be mid-response
- Only a 0.3s arbitrary delay before injection attempt
- No mechanism to detect if model has started responding
- **Impact:** Undefined behavior — could interrupt current response or silently fail

---

## 8. Mode Switching / Character Change

### 8.1 Global Singleton Overwrite (CRITICAL)
**File:** `livekit-server/src/features/mode_switching.py` (lines 12-73)
```python
_assistant_instance = None  # Module-level global

def inject_assistant_context(assistant):
    global _assistant_instance
    _assistant_instance = assistant
```
- New agent's `inject_assistant_context()` overwrites global before old agent fully cleans up
- Old agent's `update_agent_mode()` calls could reference NEW agent's session
- **Impact:** Session corruption; old agent operates on new agent's context

### 8.2 Audio Gap During Agent Swap
**File:** `mqtt-gateway/gateway/mqtt-gateway.js` (lines 2313-2520)
```
T=100ms: Old agent cleanup completes
T=150ms: New bridge connects to new room
T=160ms: New agent dispatch starts
T=400ms: User starts speaking
T=500ms: New agent finally ready (missed user speech)
```
- No buffering of audio during transition window
- `stopAudioForwarding = true` on old bridge but gap before new bridge starts
- **Impact:** Initial user speech after mode switch is lost

### 8.3 Deployment Flag Set Before Dispatch (Same as 3.1)
**File:** `mqtt-gateway/gateway/mqtt-gateway.js` (line 2440)
```javascript
newBridge.agentDeployed = true;  // BEFORE dispatch
await this.agentDispatchClient.createDispatch(...);
```
- If dispatch fails, `agentDeployed` remains `true` until error handler resets it
- Bridge reports agent is running when it actually failed
- **Impact:** Device thinks mode switch succeeded; gets silence

### 8.4 Manager API Partial Failure — Inconsistent State
**File:** `mqtt-gateway/gateway/mqtt-gateway.js` (lines 2331, 2424-2427)
- Character set succeeds in DB, but API times out during response
- Code thinks it failed; doesn't proceed with agent dispatch
- DB now says "Math Tutor" but device still has old agent
- **Impact:** Inconsistent state between database and runtime

### 8.5 No Agent Dispatch Retry
**File:** `mqtt-gateway/gateway/mqtt-gateway.js` (lines 2451-2456)
- Dispatch failure: no retry, no fallback, no notification to device
- Device is in new room with no agent
- **Impact:** User gets silence after mode switch; no recovery path

### 8.6 Audio Buffer Clearing Race
**File:** `mqtt-gateway/livekit/livekit-bridge.js` (lines 140-176)
- `clearAudioBuffers()` runs while worker threads may still be encoding Opus frames
- Encoded frame in pipeline could be sent to NEW agent's UDP socket
- **Impact:** New agent receives audio fragment from old conversation

### 8.7 Chat History Loss During Mode Switch
**File:** `livekit-server/src/shared/entrypoint_utils.py` (lines 472-583)
- Old agent's cleanup extracts history from `session.history`
- Gemini Realtime model's history may be partially cleared during state transition
- **Impact:** Only partial conversation saved; context lost between modes

---

## 9. Cleanup & Shutdown

### 9.1 Cleanup Race Condition (CRITICAL)
**File:** `livekit-server/workers/cheeko_worker.py` (lines 528-542)
```python
if cleanup_completed:
    return
# RACE WINDOW: Another task checks cleanup_completed (False) here
cleanup_completed = True
cleanup_task = current_t
```
- No lock/mutex; two concurrent tasks can both pass the check
- Cleanup called from 4 places: participant_disconnected, room_disconnected, shutdown_request, shutdown callback
- **Impact:** Double cleanup — session closed twice, API calls duplicated, potential crashes

### 9.2 asyncio.shield Misuse with Timeout
**File:** `livekit-server/workers/cheeko_worker.py` (lines 550-569)
```python
await asyncio.wait_for(
    asyncio.shield(usage_manager.log_session_summary()),
    timeout=5.0
)
```
- `asyncio.shield()` protects from cancellation but NOT from timeouts
- `wait_for()` will cancel the shield if timeout fires
- HTTP connection to Manager API may be left in-flight (socket leak)
- **Impact:** Usage data lost; potential resource leak

### 9.3 Usage Logging Timeout Too Aggressive
**File:** `livekit-server/workers/cheeko_worker.py` (lines 548-559)
- 5s timeout for usage logging; if Manager API is slow (>5s), data is lost
- No retry mechanism
- **Impact:** Usage metrics silently dropped

### 9.4 Chat History Extraction — No Loop Timeout
**File:** `livekit-server/src/shared/entrypoint_utils.py` (lines 472-582)
- No timeout on the extraction loop itself
- Session with 10,000+ messages: extraction could take 10+ seconds
- Combined with 15s overall timeout (line 564), may trigger before API call completes
- **Impact:** Chat history lost for very long conversations

### 9.5 Gemini Thinking Content Leakage
**File:** `livekit-server/src/shared/entrypoint_utils.py` (lines 427-469)
- Pattern matching for thinking detection:
  - Only checks first 200 characters (line 466)
  - False positives: User says "**I'm a wizard**" gets filtered
  - Misses new Gemini formats not covered by pattern list
- **Impact:** Internal model thinking saved to chat history, or user messages falsely filtered

### 9.6 Device Disconnect During Cleanup
- Device sends "goodbye" while cleanup is in progress
- Both `participant_disconnected` and explicit shutdown handlers fire
- First cleanup extracting chat history (slow due to API)
- Second cleanup calls `shield` on already-running first cleanup
- **Impact:** Multiple concurrent cleanup attempts; undefined behavior

### 9.7 Room Double-Delete Race + aiohttp Session Leak (CONFIRMED IN PRODUCTION)
**File:** `livekit-server/src/shared/entrypoint_utils.py` (lines 59-71)
**Errors observed on Cerebrium:**
```
Failed to delete room: TwirpError(code=not_found, message=requested room does not exist, status=404)
Unclosed client session: <aiohttp.client.ClientSession object at 0x70475d4860d0>
Unclosed connector connections: ['deque([(<aiohttp.client_proto.R...
```
- Gateway deletes the LiveKit room on disconnect
- Agent's `cleanup_room_and_session()` then calls `delete_livekit_room()` (line 579) → 404 because room already gone
- `delete_livekit_room()` creates `api.LiveKitAPI()` (line 59) which internally creates an `aiohttp.ClientSession`
- The `ClientSession` is NEVER closed — no `await lk_api.aclose()` or `async with` context manager
- On error (404), function exits via `except` block without closing the session
- Python GC detects the unclosed session and connector → logs warnings
- This happens on EVERY normal session end (gateway always deletes room first)
- **Root cause:** `LiveKitAPI` created without context manager, never cleaned up
- **Fix:** Use `async with api.LiveKitAPI(...) as lk_api:` or add `finally: await lk_api.aclose()`; also skip room delete if gateway already handles it
- **Impact:** aiohttp socket leak on every session; resource exhaustion over time

### 9.8 `shutdown()` vs `aclose()` Misuse (LiveKit Pattern Gap)
**Ref:** LiveKit docs — `shutdown(drain=True)` vs `aclose()`

- Cheeko calls `session.aclose()` directly (line 576) — immediate close, no draining
- LiveKit recommends `session.shutdown(drain=True)` for graceful close
- `shutdown()` waits for queued speech, commits transcripts, closes I/O connections
- `aclose()` skips all of that — currently playing speech is cut off mid-sentence
- **Impact:** Agent's final response (e.g., goodbye) may be cut mid-speech

### 9.9 Shutdown Hook Timeout — 10s Default May Be Insufficient
**Ref:** LiveKit docs — "Shutdown hooks should complete within a short amount of time. Default: 10 seconds"
- Cheeko's cleanup does: usage logging (5s timeout) + chat history (20s timeout) + Mem0 write
- Combined worst-case: 25+ seconds
- LiveKit's `shutdown_process_timeout` default is 10s — process forcefully terminated after that
- Cheeko sets `initialize_process_timeout=120s` (line 918) but does NOT set `shutdown_process_timeout`
- **Impact:** LiveKit kills process before cleanup finishes; usage data and chat history lost

### 9.10 `close` Event Not Handled
**Ref:** LiveKit docs — `CloseEvent` emitted when session closes with error info
- LiveKit emits `close` event with error details (LLMError, STTError, TTSError, RealtimeModelError)
- Cheeko does NOT listen for `session.on("close")` event
- If session closes due to unrecoverable Gemini error, no cleanup or notification
- Only `room.on("disconnected")` is handled, which fires for room-level disconnect, not session-level
- **Impact:** Session-level errors (Gemini crash) may not trigger cleanup

### 9.11 Cerebrium SIGTERM Container Recycling — Forced Exit (CONFIRMED IN PRODUCTION)
**File:** `livekit-server/workers/cheeko_worker.py` (lines 913-921)
**Errors observed on Cerebrium:**
```
watchfiles.main - WARNING - received signal 15, raising KeyboardInterrupt
worker AW_Ck4FShMKTcQo - WARNING - shutting down
worker AW_Ck4FShMKTcQo - WARNING - exiting forcefully
```
- Cerebrium sends SIGTERM (signal 15) to recycle idle/redeployed containers — this is normal serverless behavior
- All LiveKit workers (`AW_Ck4F...`, `AW_fBMr...`, `AW_Hjjv...`, `AW_vKVF...`) receive SIGTERM simultaneously
- Workers log "shutting down" → "exiting forcefully" — cleanup did NOT complete within Cerebrium's grace period
- Cerebrium's grace period is typically 5-10s; Cheeko's cleanup needs 25s+ (usage logging 5s + chat history 20s + Mem0 write)
- `WorkerOptions` does NOT set `shutdown_process_timeout` (line 918) — LiveKit defaults to 10s
- Combined with issue 9.9: cleanup exceeds both Cerebrium's and LiveKit's shutdown timeouts
- After SIGTERM, container is destroyed; ~6 minutes later, new cold-start container spins up
- Cold restart triggers issue 5.5: first greeting fails because Gemini WebSocket not ready
- **Cascade:** SIGTERM → forced exit (cleanup lost) → cold start → greeting failure → 6s+ delay
- **Root cause:** No SIGTERM signal handler; cleanup too slow for serverless grace periods
- **Fix:** (1) Register `signal.SIGTERM` handler that fast-tracks critical cleanup (skip room delete, prioritize usage log), (2) Set `shutdown_process_timeout` in WorkerOptions to match Cerebrium's grace period, (3) Reduce cleanup time by parallelizing API calls and skipping non-essential steps under SIGTERM
- **Impact:** Usage data lost, chat history lost, aiohttp sessions leaked on every container recycle; followed by cold-start greeting failure

---

## 10. Cross-Cutting Concerns

### 10.1 No Circuit Breaker for External APIs
- Manager API, Mem0, Gemini, ElevenLabs — all called without circuit breaker
- If any service is down, every request waits for timeout
- Cascading failures across all active sessions
- **Recommendation:** Implement circuit breaker (fail fast after N consecutive timeouts)

### 10.2 Thread Pool Exhaustion
- Mem0 search uses default `ThreadPoolExecutor` (threads = CPU count)
- Multiple concurrent agents all calling Mem0 simultaneously
- If Mem0 is slow, all threads blocked
- **Impact:** All agents freeze waiting for thread pool

### 10.3 PII in Logs
**File:** `mqtt-gateway/gateway/mqtt-gateway.js` (lines 2317-2450)
- Device MAC, session IDs, child profile data logged at info level
- Shipped to Grafana Loki
- **Impact:** Child data exposed in logging infrastructure

### 10.4 No Health Check Before Dispatch
- Agent dispatched without verifying room exists and is empty
- No pre-flight check for Gemini API connectivity
- **Impact:** Agent fails after dispatch instead of failing fast

### 10.5 Inconsistent Timeout Values
- Different handlers use different timeouts: 2s (Mem0), 5s (character/child), 10s (Manager API), 120s (worker)
- Some axios calls have no explicit timeout (defaults to 30s)
- **Impact:** Unpredictable behavior; some paths timeout fast, others hang

### 10.6 Memory Leak in Long-Running Gateway
- Mem0 background requests complete after connection closed
- Audio stream readers from old agents may not be cleaned up
- Dispatch metadata accumulates over 100+ mode switches
- Worker pool codec state cleanup races with in-flight encoding
- **Impact:** Gradual memory growth; eventual OOM in production

### 10.7 No Graceful Degradation Strategy
- Individual service failures (Mem0 down, ElevenLabs down) handled ad-hoc
- No unified degradation strategy (e.g., "if Mem0 is down, skip memory features globally")
- Each request independently discovers service is down
- **Impact:** Repeated timeout waits for known-down services

---

## 11. Summary Table

### CRITICAL
| # | Issue | Phase | Impact |
|---|-------|-------|--------|
| 2.1 | Duplicate HELLO race condition | Hello | Audio misdirected |
| 3.1 | Agent deployment flag race | Dispatch | Agent never joins |
| 5.1 | Session reference not set before greeting | Greeting | Agent crash |
| 6.7 | Interrupted tool call during mode switch | Conversation | Partial mode switch |
| 8.1 | Global singleton overwrite in mode_switching | Mode Switch | Session corruption |
| 9.1 | Cleanup race condition (no lock) | Cleanup | Double cleanup, crash |

### HIGH
| # | Issue | Phase | Impact |
|---|-------|-------|--------|
| 3.2 | Duplicate agents not properly removed | Dispatch | Audio corruption |
| 4.1 | Missing env var validation | Startup | Silent API failures |
| 4.7 | Error handler mutates `ev.error.recoverable` | Startup | Errors suppressed |
| 4.8 | Error handler event name mismatch | Startup | Error counts never reset |
| 6.4 | No `user_away` handling | Conversation | Zombie sessions |
| 6.5 | No FallbackAdapter for TTS | Conversation | Single point of failure |
| 6.13 | Unbounded chat context growth — no truncation | Conversation | Token cost grows per turn, TTFT degrades |
| 7.3 | Mem0 singleton — no recovery | Memory | Features permanently disabled |
| 7.4 | No timeout on Mem0 search | Memory | Thread pool exhaustion |
| 8.2 | Audio gap during agent swap | Mode Switch | Lost user speech |
| 8.5 | No agent dispatch retry | Mode Switch | Silent failure |
| 9.2 | asyncio.shield misuse with timeout | Cleanup | Usage data loss, socket leak |
| 9.7 | Room double-delete + aiohttp leak (confirmed) | Cleanup | Socket leak every session |
| 9.8 | `aclose()` instead of `shutdown(drain=True)` | Cleanup | Speech cut mid-sentence |
| 9.9 | Shutdown hook exceeds 10s default timeout | Cleanup | Process killed, data lost |
| 9.10 | `close` event not handled | Cleanup | Session errors miss cleanup |
| 9.11 | Cerebrium SIGTERM forced exit (confirmed) | Cleanup | Data lost + cold-start cascade |

### MEDIUM
| # | Issue | Phase | Impact |
|---|-------|-------|--------|
| 2.3 | No overall timeout on parallel hello fetches | Hello | Device timeout |
| 2.4 | Silent mode fallback to wrong mode | Hello | Wrong agent type |
| 4.4 | Jinja2 template fallback incomplete | Startup | Raw template in prompt |
| 4.9 | No prewarm for Gemini/TTS | Startup | Slower startup |
| 5.2 | No timeout on greeting await | Greeting | Greeting hangs forever |
| 5.3 | Greeting duplication race | Greeting | Double greeting |
| 5.5 | Gemini WebSocket not ready on cold start (confirmed) | Greeting | 6s+ greeting delay |
| 6.6 | `generate_reply()` not guaranteed for scripted content | Conversation | Hallucinated content |
| 6.8 | `current_speech` not checked before `generate_reply()` | Conversation | Overlapping speech |
| 6.9 | No `conversation_item_added` tracking | Conversation | Chat history inconsistency |
| 6.10 | Realtime transcription delay vs memory trigger | Conversation | Wasted memory API calls |
| 6.11 | False interruption not tuned for children | Conversation | Agent pauses on noise |
| 7.1 | Stale debounce timer | Memory | Blocked memory searches |
| 7.5 | Memory inject vs active response conflict | Memory | Interrupted responses |
| 8.4 | Manager API partial failure | Mode Switch | Inconsistent DB vs runtime |
| 9.4 | No loop timeout on history extraction | Cleanup | History lost for long sessions |
| 10.1 | No circuit breaker for external APIs | All | Cascading failures |
| 10.6 | Memory leaks in long-running processes | All | OOM in production |

### LOW
| # | Issue | Phase | Impact |
|---|-------|-------|--------|
| 1.1 | Activation code race condition | OTA | Activation failure |
| 2.8 | UDP remoteAddress never initialized | Hello | Silent audio loss |
| 6.3 | Audio caching race condition | Conversation | Duplicate S3 writes |
| 6.12 | `discard_audio_if_uninterruptible` drops child speech | Conversation | Silent speech loss |
| 10.3 | PII in logs | All | Privacy risk |

---

## Recommended Priority Fixes

### Immediate (CRITICAL)
1. **Add asyncio.Lock to cleanup** — Prevent double cleanup execution
2. **Guard greeting with session check** — Verify `self.session` is not None before `play_greeting()`
3. **Fix deployment flag timing** — Set `agentDeployed = true` AFTER successful dispatch
4. **Replace global singleton** — Pass assistant context via function parameters, not module globals
5. **Add `disallow_interruptions()` to mode switch tool** — Prevent partial character-change

### Short-Term (HIGH)
6. **Fix `delete_livekit_room()` aiohttp leak** — Use `async with api.LiveKitAPI()` or `finally: await lk_api.aclose()`; skip if gateway handles deletion
7. **Handle `session.on("close")` event** — Trigger cleanup on session-level errors
8. **Use `shutdown(drain=True)` instead of `aclose()`** — Let queued speech finish
9. **Set `shutdown_process_timeout` > 25s** in WorkerOptions — Prevent premature process kill
10. **Add SIGTERM handler for serverless** — Fast-track critical cleanup (usage log, skip room delete) within Cerebrium's grace period
11. **Add `user_away` handler** — Prompt idle child or auto-disconnect after timeout
12. **Fix error handler event names** — Use current LiveKit event names or remove stale handlers
13. **Stop mutating `ev.error.recoverable`** — Let LiveKit manage error recovery flow
14. Add timeout on Mem0 search (`asyncio.wait_for` wrapping `run_in_executor`)
15. Implement circuit breaker for Manager API and Mem0
16. Await `removeParticipant()` for duplicate agent removal
17. Validate environment variables at startup
18. **Add `ChatContext.truncate(max_items=30)`** — Cap context growth via `conversation_item_added` event; saves tokens and reduces TTFT

### Medium-Term (MEDIUM)
19. Tune `false_interruption_timeout` and `min_interruption_duration` for children's noise
20. Check `session.current_speech` before calling `generate_reply()` for memory injection
21. Listen to `conversation_item_added` for accurate chat history tracking
22. Prewarm ElevenLabs TTS in `prewarm_fnc` for faster startup
23. Use `session.say()` for scripted content (goodbye, animal facts) instead of `generate_reply()`
24. Implement exponential backoff for greeting retries
25. Add overall timeout for parallel hello API calls
26. Implement graceful degradation strategy for external services
