# Full Working Flow: ESP32 Client → MQTT Gateway → Cheeko Agent

## Overview

This document describes the complete end-to-end flow of how an ESP32 device connects to the Cheeko AI companion system, establishes a voice conversation session, and handles mode switching and cleanup.

### Components

| Component | Location | Role |
|-----------|----------|------|
| ESP32 Client | `main/livekit-server/client.py` | Device simulator (mimics real ESP32 hardware) |
| MQTT Gateway | `main/mqtt-gateway/` | Protocol bridge: MQTT/UDP ↔ LiveKit WebSocket |
| Cheeko Agent | `main/livekit-server/workers/cheeko_worker.py` | AI conversation agent (Gemini Realtime) |
| Manager API | `main/manager-api-node/` | Backend REST API for config, devices, content |
| Media API | `main/livekit-server/media_api.py` | Music/Story bot streaming service |

---

## Phase 1: OTA Config (STEP 1)

```
ESP32 Client                    Manager API (port 8002)
  │                                    │
  ├── POST /toy/ota/ ────────────────►│
  │   Header: {device-id: MAC}         │
  │   Body: {application: {version,    │
  │     name}, board: {type},          │
  │     client_id}                     │
  │                                    │
  │◄── Response: ──────────────────────┤
  │    {server_time: {timestamp,       │
  │       timeZone, timezone_offset},  │
  │     firmware?: {version, url,      │
  │       force},                      │
  │     websocket: {url},              │
  │     mqtt: {broker, port, endpoint, │
  │       client_id, username,         │
  │       password, keepalive_interval,│
  │       ssl_enabled},                │
  │     activation?: {code, message,   │
  │       challenge}}                  │
```

- Client gets MQTT credentials (broker, port, client_id, username, password), WebSocket URL, and server time
- If activation required, calls `POST /toy/ota/activate` (with `Device-Id` header) until response is `"success"`

---

## Phase 2: MQTT Connect (STEP 2)

```
ESP32 Client                    MQTT Gateway (EMQX Broker)
  │                                    │
  ├── MQTT CONNECT ───────────────────►│
  │   client_id from OTA               │
  │                                    │
  ├── SUBSCRIBE ──────────────────────►│
  │   topic: devices/p2p/{client_id}   │
  │                                    │
  │◄── CONNACK ────────────────────────┤
```

- Client connects using credentials from OTA
- Subscribes to its P2P topic for receiving messages from gateway

---

## Phase 3: Hello Handshake (STEP 3)

```
ESP32 Client              MQTT Gateway                LiveKit Cloud       Manager API
  │                            │                           │                   │
  ├── PUBLISH ────────────────►│                           │                   │
  │   topic: device-server     │                           │                   │
  │   {type: "hello",          │                           │                   │
  │    version: 3,             │                           │                   │
  │    transport: "mqtt",      │                           │                   │
  │    audio_params: {         │                           │                   │
  │      sample_rate: 24000,   │                           │                   │
  │      channels: 1,          │                           │                   │
  │      frame_duration: 20,   │                           │                   │
  │      format: "pcm"},       │                           │                   │
  │    features:               │                           │                   │
  │      ["tts","asr","vad"]}  │                           │                   │
  │                            │                           │                   │
  │                            ├── GET /device/{mac}/mode ─┼──────────────────►│
  │                            │◄── {mode} ────────────────┼──────────────────┤
  │                            ├── GET /device/{mac}/      │                   │
  │                            │   device-mode (PTT) ──────┼──────────────────►│
  │                            │◄── {deviceMode} ──────────┼──────────────────┤
  │                            │                           │                   │
  │                            ├── Fetch character, child ─┼──────────────────►│
  │                            │   profile, Mem0 memories  │                   │
  │                            │◄──────────────────────────┼──────────────────┤
  │                            │                           │                   │
  │                            ├── Create room ───────────►│                   │
  │                            │   {uuid}_{MAC}_{mode}     │                   │
  │                            │                           │                   │
  │                            ├── LiveKitBridge joins ───►│                   │
  │                            │   (gateway as audio proxy)│                   │
  │                            │                           │                   │
  │◄── {type: "mode_update"} ──┤                           │                   │
  │    {mode, character,       │                           │                   │
  │     listening_mode}        │                           │                   │
  │                            │                           │                   │
  │◄── {type: "hello",  ──────┤                           │                   │
  │     session_id,            │                           │                   │
  │     udp: {server, port,    │                           │                   │
  │           key, nonce},     │                           │                   │
  │     audio_params}          │                           │                   │
  │                            │                           │                   │
  │                            ├── Dispatch agent ────────►│                   │
  │                            │   "cheeko-agent" to room  │                   │
  │                            │   (immediately after      │                   │
  │                            │    hello response)        │                   │
  │                            │                           │                   │
  │── UDP ping ───────────────►│                           │                   │
  │   "ping:{session_id}"     │   (parallel, not a        │                   │
  │                            │    dispatch trigger)      │                   │
```

- Gateway fetches device mode (room type) and device-mode (PTT: auto/manual), character, child profile from Manager API
- Creates LiveKit room named `{uuid}_{MAC}_{mode}` and joins as audio bridge
- Sends `mode_update` and `hello` response (with UDP session details) back to device
- Gateway dispatches Cheeko agent **immediately after hello response** (AUTO-DEPLOY, does NOT wait for UDP ping)
- Client creates UDP socket, sends ping to establish UDP path (happens in parallel, not a trigger)

---

## Phase 4: Agent Startup & Greeting

```
LiveKit Cloud                Cheeko Agent                    Manager API
  │                              │                               │
  ├── Job assigned ─────────────►│                               │
  │                              ├── Read dispatch metadata:     │
  │                              │   childProfile, memoryData    │
  │                              │   (passed from gateway)       │
  │                              │                               │
  │                              ├── Parallel API fetches: ─────►│
  │                              │   GET /agent/device/{mac}/    │
  │                              │       agent-id                │
  │                              │   POST /config/agent-prompt   │
  │                              │       {macAddress}            │
  │                              │   POST /config/agent-models   │
  │                              │       {macAddress}            │
  │                              │◄── agentId, prompt, models ───┤
  │                              │                               │
  │                              ├── Render Jinja2 prompt        │
  │                              │   (child_name, age, Mem0      │
  │                              │    from dispatch metadata)    │
  │                              │                               │
  │                              ├── Create Gemini Realtime      │
  │                              │   + GoogleSearch (ProviderTool)│
  │                              │   + ElevenLabs TTS            │
  │                              │   + Mode switching tools      │
  │                              │                               │
  │                              ├── Check for duplicate agents  │
  │                              │   in room (exit if found)     │
  │                              │                               │
  │◄── Agent joins room ────────┤                               │
```

```
ESP32 Client              MQTT Gateway                    Cheeko Agent
  │                            │                               │
  │                            │   Agent joins room            │
  │                            │◄── ParticipantConnected ──────┤
  │                            │                               │
  │                            ├── Data channel: ─────────────►│
  │                            │   {type:                      │
  │                            │    "ready_for_greeting"}      │
  │                            │   (auto-sent on agent join)   │
  │                            │                               │
  │                            │       session.generate_reply() │
  │                            │◄── TTS audio ────────────────┤
  │                            │   "Hey Rahul! How are you?"   │
  │◄── MQTT {tts: "start"} ───┤                               │
  │◄── UDP audio frames ──────┤   (48kHz→24kHz resample)      │
  │◄── MQTT {tts: "stop"} ────┤                               │
```

- Agent reads child profile and Mem0 memories from dispatch metadata (passed by gateway during agent dispatch, avoiding duplicate API calls)
- Fetches agent-id, prompt, and model config (TTS provider) from Manager API via `asyncio.gather()`
- Falls back to fetching child profile from API if dispatch metadata is missing
- Checks for duplicate agents in room — exits if another agent already present
- Renders personalized Jinja2 prompt with child's name/age/interests/memories
- Creates Gemini Realtime model + AgentSession with tools
- Waits for `ready_for_greeting` via LiveKit data channel
- Gateway auto-sends `ready_for_greeting` when agent joins the room (detected via `ParticipantConnected` event)
- Agent generates personalized greeting, streams TTS back through gateway

> **Note:** `start_greeting` from device is a legacy path (no-op for conversation mode). The gateway now auto-triggers greeting when the agent joins the LiveKit room.

---

## Phase 5: Conversation Loop (STEP 4-5)

```
ESP32 Client              MQTT Gateway                    Cheeko Agent
  │                            │                               │
  │── UDP mic audio ──────────►│                               │
  │   (16kHz Opus, 60ms frames)├── LiveKit audio track ──────►│
  │   Header: [type, flags,    │                               │
  │    len, connId, ts, seq]   │     Gemini Realtime:          │
  │                            │     STT → LLM → TTS          │
  │                            │                               │
  │◄── MQTT {tts: "start"} ───┤◄── LiveKit TTS audio ────────┤
  │◄── UDP audio frames ──────┤   (48kHz→24kHz resample)      │
  │   (plays on speaker)       │                               │
  │◄── MQTT {tts: "stop"} ────┤                               │
  │                            │                               │
  │   (client starts mic       │                               │
  │    recording again)        │                               │
  │── UDP mic audio ──────────►│   ...repeat...               │
```

### Audio Path Detail

- **Device → Agent**: Mic audio (16kHz Opus) → UDP packet (16B header + payload) → Gateway Opus decode → LiveKit audio track (16kHz mono) → Gemini Realtime STT
- **Agent → Device**: Gemini Realtime LLM → Gemini TTS → LiveKit audio (48kHz) → Gateway resample 48kHz→24kHz → Opus encode → UDP → Speaker
- MQTT signals `tts:start/stop` control when device listens vs plays
- Client tracks packet sequences, detects gaps/loss for quality monitoring

### MQTT Control Messages During Conversation

| Message | Direction | Purpose |
|---------|-----------|---------|
| `{type: "tts", state: "start"}` | Gateway → Device | Agent started speaking, device should play audio |
| `{type: "tts", state: "stop"}` | Gateway → Device | Agent finished speaking, device can start mic |
| `{type: "stt", text: "..."}` | Gateway → Device | Server transcription of user speech |
| `{type: "record_stop"}` | Gateway → Device | Stop microphone recording |
| `{type: "abort"}` | Device → Gateway | User interrupted (button press), cancel current TTS |

### Mid-Conversation Memory Recall (Mem0 Search Only)

```
Cheeko Agent                                    Mem0 Cloud
  │                                                │
  ├── user_speech_committed event                  │
  │   text matches trigger pattern?                │
  │   (story/remember/family/question)             │
  │                                                │
  │   YES (debounced: skip if <5s since last)      │
  ├── search_relevant_memories(mac, query) ───────►│
  │◄── [memory1, memory2, memory3] ────────────────┤
  │                                                │
  ├── session.generate_reply(                      │
  │     instructions=formatted_memories + query)   │
  │   (injects memory context into next response)  │
```

- **Read-only**: only searches Mem0 during conversation, never writes. Writing to Mem0 happens only during cleanup (Phase 7)
- Triggered by `user_speech_committed` event when user's speech matches keyword patterns
- Debounced: skips if another injection happened < 5s ago or one is in progress
- Searches Mem0 for up to 3 relevant memories using user's text as semantic query
- Injects memory context via `session.generate_reply()` to guide the agent's response
- Non-blocking: runs as async task, catches exceptions if model is already responding

### Agent State Emissions

Agent publishes state changes to LiveKit data channel (forwarded to device by gateway):

| State | Meaning |
|-------|---------|
| `listening` | Agent is waiting for user speech |
| `speaking` | Agent is outputting TTS audio |

> **Note:** There is no `thinking` state with Gemini Realtime — it processes audio-to-audio directly without a separate thinking phase.

### LiveKit Data Channel Messages (Gateway → Agent)

| Message Type | Purpose |
|-------------|---------|
| `ready_for_greeting` | Trigger initial greeting (auto-sent on agent join) |
| `end_prompt` | Say goodbye with custom prompt before shutdown |
| `shutdown_request` | Clean shutdown (agent sends `shutdown_ack` if `require_ack`) |
| `user_text` (content_type: `animal`) | Play animal description via ElevenLabs TTS + animal sound MP3 |
| `user_text` (content_type: `read_only`) | Play RAG/RFID content via ElevenLabs TTS (with optional S3 caching) |
| `user_text` (content_type: `prompt`) | Inject prompt into conversation via `session.generate_reply()` |

---

## Phase 5.5: Character Switching (Agent-Initiated)

```
Cheeko Agent              MQTT Gateway                    Manager API
  │                            │                               │
  │  (user says "let's do      │                               │
  │   some math")              │                               │
  │                            │                               │
  ├── Tool: update_agent_mode  │                               │
  │   ("Math Tutor")           │                               │
  │                            │                               │
  ├── Data channel: ──────────►│                               │
  │   {type: "character-change"│                               │
  │    characterName:          │                               │
  │    "Math Tutor"}           │                               │
  │                            ├── Stop current agent           │
  │                            ├── Delete old LiveKit room      │
  │                            ├── Create new room              │
  │                            ├── Dispatch math-tutor-agent ──►│ LiveKit
  │                            │                               │
  │◄── Agent shutdown ─────────┤                               │
```

- Agent has a function tool `update_agent_mode(mode_name)` callable by the LLM
- Character names are normalized via aliases (e.g., "math" → "Math Tutor", "riddle" → "Riddle Solver")
- Agent publishes `character-change` message via LiveKit data channel to gateway
- Gateway handles the actual worker swap: stops old agent, creates new room, dispatches new agent
- Available characters: **Cheeko** (default), **Math Tutor**, **Riddle Solver**, **Word Ladder**

---

## Phase 6: Mode Switching (Device-Initiated)

```
ESP32 Client              MQTT Gateway                    Manager API
  │                            │                               │
  ├── {type: "mode-change"} ──►│                               │
  │   (no mode = cycle)        │                               │
  │                            ├── POST /device/{mac}/        │
  │                            │   cycle-mode ───────────────►│
  │                            │◄── {mode: "music",  ─────────┤
  │                            │     previousMode: "conv"}     │
  │                            │                               │
  │                            ├── Stop old agent/bot          │
  │                            ├── Delete old LiveKit room     │
  │                            ├── Create new room (_music)    │
  │                            ├── POST /start-music-bot ─────►│ Media API :8003
  │                            │                               │
  │◄── {type: "mode_update"} ──┤                               │
  │    {mode: "music"}         │                               │
```

- Button press with no mode specified cycles: **conversation → music → story → conversation**
- If mode is specified in payload, switches directly to that mode
- Gateway performs robust cleanup: stop audio, shutdown agent, delete old room
- Creates new room and starts appropriate service:
  - **conversation**: Dispatch AI agent (cheeko-agent, math-tutor, etc.)
  - **music**: Start music bot via Media API
  - **story**: Start story bot via Media API

### Playback Controls (Music/Story modes)

| Control | MQTT Message | Action |
|---------|-------------|--------|
| Next | `{type: "next"}` | Skip to next song/story via LiveKit data channel |
| Previous | `{type: "previous"}` | Go to previous song/story via LiveKit data channel |

---

## Phase 7: Disconnect & Cleanup (STEP 6)

```
ESP32 Client              MQTT Gateway                    Cheeko Agent
  │                            │                               │
  ├── {type: "goodbye"} ──────►│                               │
  │                            ├── Disconnect bridge ─────────►│
  │                            │                               │
  │                            │   Agent cleanup:              │
  │                            │   ├── Extract chat history    │
  │                            │   ├── POST /agent/chat-       │
  │                            │   │   history/session ───────►│ Manager API
  │                            │   ├── Send to Mem0 ──────────►│ Mem0
  │                            │   ├── Log usage (tokens) ────►│ Manager API
  │                            │   └── Delete LiveKit room     │
  │                            │                               │
  ├── MQTT disconnect ────────►│                               │
```

**Cleanup triggers** (any of these):
- Device sends `goodbye` → gateway disconnects bridge → agent's participant disconnects
- Last participant disconnects from room (`participant_disconnected` event, count reaches 0)
- Room explicitly disconnected (`disconnected` event)
- `shutdown_request` received via data channel

**Cleanup sequence** (protected by `asyncio.shield()` from cancellation):
1. Log usage summary: session duration, avg TTFT, token breakdown (audio vs text) → `POST /device/token-usage` (5s timeout)
2. Extract chat history from `session.history`, filter out Gemini thinking/reasoning
3. Send chat history to Manager API (`POST /agent/chat-history/session`) AND Mem0 (`mem0.add()` with `enable_graph=True`) in parallel (20s timeout)
4. Close agent session (`session.aclose()`)
5. Disconnect from room
6. Delete LiveKit room via API

---

## Reference

### MQTT Topics

| Topic | Direction | Purpose |
|-------|-----------|---------|
| `device-server` | Device → Gateway | All device messages (hello, listen, abort, goodbye, mode-change) |
| `devices/p2p/{client_id}` | Gateway → Device | P2P responses (hello reply, tts start/stop, mode_update, stt) |

### Ports & Protocols

| Component | Protocol | Port |
|-----------|----------|------|
| Manager API | HTTP | 8002 |
| MQTT Broker (EMQX) | MQTT | 1883 (internal) / proxied externally |
| UDP Audio | UDP | 8884 |
| Media API | HTTP | 8003 |
| LiveKit Cloud | WebSocket | Cloud-hosted |

### UDP Packet Format

```
Header (16 bytes, big-endian):
  [type:1B] [flags:1B] [payload_len:2B] [connectionId:4B] [timestamp:4B] [sequence:4B]

Payload: Opus-encoded audio (mono, 16kHz from device, 24kHz to device)
```

### Key Files

| File | Purpose |
|------|---------|
| `main/livekit-server/client.py` | ESP32 test client simulator |
| `main/mqtt-gateway/gateway/mqtt-gateway.js` | Main MQTT message routing |
| `main/mqtt-gateway/mqtt/virtual-connection.js` | Virtual device connection (hello, room creation) |
| `main/mqtt-gateway/livekit/livekit-bridge.js` | LiveKit room bridge (audio proxy, data channel) |
| `main/livekit-server/workers/cheeko_worker.py` | Main Cheeko AI agent |
| `main/livekit-server/src/shared/base_assistant.py` | Base agent class (greeting, state) |
| `main/livekit-server/src/shared/entrypoint_utils.py` | Shared utilities (config, prompts, chat history) |
| `main/livekit-server/src/features/mode_switching.py` | Mode/character switching tool |
| `main/livekit-server/src/services/prompt_service.py` | Prompt + model config fetching |
| `main/livekit-server/src/services/mem0_service.py` | Mem0 memory search, add, graph extraction |
| `main/livekit-server/src/utils/database_helper.py` | Manager API helpers (agent-id, child profile) |
| `main/livekit-server/src/utils/helpers.py` | UsageManager, token tracking, metrics |
| `main/livekit-server/media_api.py` | Music/Story bot streaming service |
