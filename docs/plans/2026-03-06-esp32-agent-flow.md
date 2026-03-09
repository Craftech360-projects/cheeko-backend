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
  │   Body: {version, board, client_id}│
  │                                    │
  │◄── Response: ──────────────────────┤
  │    {mqtt: {client_id, username,    │
  │     password},                     │
  │     mqtt_gateway: {broker, port},  │
  │     websocket: {url},             │
  │     activation?: {code}}           │
```

- Client gets MQTT credentials, broker address, and WebSocket URL
- If activation required, polls `/ota/active` until device is activated

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
  │      sample_rate: 48000,   │                           │                   │
  │      channels: 1,          │                           │                   │
  │      frame_duration: 20,   │                           │                   │
  │      format: "pcm"}}       │                           │                   │
  │                            │                           │                   │
  │                            ├── GET /device/{mac}/mode ─┼──────────────────►│
  │                            │◄── {mode, deviceMode} ────┼──────────────────┤
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
  │── UDP ping ───────────────►│                           │                   │
  │   "ping:{session_id}"     │                           │                   │
  │                            │                           │                   │
  │                            ├── Dispatch agent ────────►│                   │
  │                            │   "cheeko-agent" to room  │                   │
```

- Gateway fetches device mode, character, child profile from Manager API
- Creates LiveKit room named `{uuid}_{MAC}_{mode}` and joins as audio bridge
- Sends `mode_update` and `hello` response (with UDP session details) back to device
- Client creates UDP socket, sends ping to establish UDP path
- Gateway dispatches Cheeko agent to the LiveKit room

---

## Phase 4: Agent Startup & Greeting

```
LiveKit Cloud                Cheeko Agent                    Manager API
  │                              │                               │
  ├── Job assigned ─────────────►│                               │
  │                              ├── Parallel API fetches: ─────►│
  │                              │   /agent/config/{mac}         │
  │                              │   /agent/prompt/{mac}         │
  │                              │   /config/child-profile       │
  │                              │◄── config, prompt, child ─────┤
  │                              │                               │
  │                              ├── Render Jinja2 prompt        │
  │                              │   (child_name, age, Mem0)     │
  │                              │                               │
  │                              ├── Create Gemini Realtime      │
  │                              │   + GoogleSearch (ProviderTool)│
  │                              │   + ElevenLabs TTS            │
  │                              │   + Mode switching tools      │
  │                              │                               │
  │◄── Agent joins room ────────┤                               │
```

```
ESP32 Client              MQTT Gateway                    Cheeko Agent
  │                            │                               │
  │  (device plays default     │  Agent joined, waiting for    │
  │   connection audio ~4s)    │  start_greeting...            │
  │                            │                               │
  ├── {type:                   │                               │
  │    "start_greeting"} ─────►│                               │
  │                            │                               │
  │                            ├── Data channel: ─────────────►│
  │                            │   {type:                      │
  │                            │    "ready_for_greeting"}      │
  │                            │                               │
  │                            │       session.generate_reply() │
  │                            │◄── TTS audio ────────────────┤
  │                            │   "Hey Rahul! How are you?"   │
  │◄── MQTT {tts: "start"} ───┤                               │
  │◄── UDP audio frames ──────┤   (48kHz→24kHz resample)      │
  │◄── MQTT {tts: "stop"} ────┤                               │
```

- Agent loads config, renders personalized prompt with child's name/age/interests
- Creates Gemini Realtime model + AgentSession with tools
- Waits for `ready_for_greeting` via LiveKit data channel
- Device sends `start_greeting` after finishing its default connection audio
- Gateway forwards as `ready_for_greeting` to agent via data channel
- Agent generates personalized greeting, streams TTS back through gateway

> **Note:** The test client (`client.py`) currently does NOT send `start_greeting`. On real ESP32 hardware, the device plays a default connection sound first, then sends `start_greeting`.

---

## Phase 5: Conversation Loop (STEP 4-5)

```
ESP32 Client              MQTT Gateway                    Cheeko Agent
  │                            │                               │
  ├── MQTT {type: "listen",    │                               │
  │    state: "detect",        │                               │
  │    text: "hello baby"} ───►│                               │
  │                            │                               │
  │── UDP mic audio ──────────►│                               │
  │   (48kHz PCM, 20ms frames) ├── LiveKit audio track ──────►│
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

- **Device → Agent**: Mic PCM → UDP packet (16B header + payload) → Gateway → LiveKit audio track → Gemini STT
- **Agent → Device**: Gemini LLM → Gemini TTS → LiveKit audio → Gateway resample 48kHz→24kHz → UDP PCM → Speaker
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

---

## Phase 6: Mode Switching

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

- Device sends `goodbye` with session_id
- Gateway disconnects the LiveKit bridge
- Agent saves chat history to Manager API and Mem0 (in parallel)
- Logs token usage stats (prompt_tokens, completion_tokens, TTFT)
- Deletes the LiveKit room
- Uses `asyncio.shield()` to protect cleanup from cancellation

---

## Reference

### MQTT Topics

| Topic | Direction | Purpose |
|-------|-----------|---------|
| `device-server` | Device → Gateway | All device messages (hello, listen, abort, goodbye, mode-change, start_greeting) |
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

Payload: Raw PCM audio (int16, mono, 48kHz from device, 24kHz to device)
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
| `main/livekit-server/media_api.py` | Music/Story bot streaming service |
