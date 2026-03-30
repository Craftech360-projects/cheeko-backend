---
id: integration-guide
sidebar_position: 1
---

# Firmware Integration Guide

![Firmware](/img/firmware-header.jpeg)

**Audience:** Firmware engineers implementing the Cheeko protocol on ESP32 devices.

**Covers:** Every HTTP API call, every MQTT message (both directions), every UDP packet contract, all state machine transitions, all RFID flows.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Full Boot-to-Conversation Flow](#2-full-boot-to-conversation-flow)
3. [Phase 1 — OTA Check](#3-phase-1--ota-check)
4. [Phase 2 — Activation Loop](#4-phase-2--activation-loop)
5. [Phase 3 — MQTT Connect and Hello Handshake](#5-phase-3--mqtt-connect-and-hello-handshake)
6. [Phase 4 — UDP Channel Setup](#6-phase-4--udp-channel-setup)
7. [Phase 5 — Mode Update (Deferred)](#7-phase-5--mode-update-deferred)
8. [Phase 6 — Conversation Loop](#8-phase-6--conversation-loop)
9. [Phase 7 — Abort / Interrupt](#9-phase-7--abort--interrupt)
10. [Phase 8 — Session End](#10-phase-8--session-end)
11. [RFID Card Flow](#11-rfid-card-flow)
12. [Device State Machine](#12-device-state-machine)
13. [MQTT Message Reference](#13-mqtt-message-reference)
14. [UDP Packet Format](#14-udp-packet-format)
15. [Manager API Endpoints](#15-manager-api-endpoints)
16. [Gateway Internal API Calls](#16-gateway-internal-api-calls)
17. [LiveKit Data Channel Messages](#17-livekit-data-channel-messages)
18. [Timeouts and Retries](#18-timeouts-and-retries)
19. [Persistence Keys](#19-persistence-keys)
20. [Minimal Conformance Checklist](#20-minimal-conformance-checklist)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ESP32 Device (Firmware)                      │
│  - State machine (idle/connecting/listening/speaking/...)           │
│  - MQTT client                                                       │
│  - UDP socket (AES-128-CTR encrypted Opus audio)                    │
│  - SD card (RFID skill cache)                                       │
│  - RFID reader                                                       │
└──────────────┬──────────────────────────────┬───────────────────────┘
               │ MQTT (publish/subscribe)      │ UDP (audio packets)
               ▼                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   MQTT/UDP Gateway (Node.js)                        │
│  main/mqtt-gateway/                                                  │
│  - EMQX MQTT broker bridge                                           │
│  - UDP server (AES-128-CTR encrypted Opus audio)                    │
│  - VirtualMQTTConnection per device                                  │
│  - LiveKitBridge (per device session)                               │
│  - Calls Manager API for device config/RFID lookups                 │
└──────────────┬──────────────────────────────┬───────────────────────┘
               │ REST HTTP                     │ LiveKit SDK (WebRTC)
               ▼                              ▼
┌─────────────────────────┐      ┌────────────────────────────────────┐
│   Manager API (Node.js) │      │   LiveKit Cloud + livekit-server   │
│   main/manager-api-node │      │   workers/cheeko_worker.py         │
│   - Device registry      │      │   workers/math_tutor_worker.py    │
│   - OTA check/activate   │      │   workers/riddle_solver_worker.py │
│   - RFID card lookup     │      │   workers/word_ladder_worker.py   │
│   - Agent config/prompts │      └────────────────────────────────────┘
│   - Content manifest     │
│   - Child profiles       │
│   - Analytics            │
└─────────────────────────┘
```

All device-to-server communication starts with the Manager API (OTA check), then shifts to the MQTT Gateway for all real-time protocol traffic.

### What the Firmware Must Implement

At minimum, implement these flows:

1. Boot and network bring-up.
2. OTA check (`/toy/ota/`) and optional activation loop (`/toy/ota/activate`).
3. MQTT connect using OTA-provided credentials.
4. MQTT `hello` exchange and UDP channel setup.
5. Audio conversation loop:
   - send `listen` states
   - stream encrypted audio over UDP
   - handle `tts`/`stt`/`llm` messages
   - send `speech_end` and `abort` when required
6. RFID flow:
   - local SD lookup first
   - if unknown, send `card_lookup`
   - on `card_content`, download assets to SD then play
   - on `card_ai`, switch to conversation behavior
7. Session lifecycle and recovery:
   - handle `goodbye`
   - handle timeouts
   - recover after disconnects

### External Interfaces Firmware Uses

**Manager API** — base context path `/toy`:
- `POST /toy/ota/`
- `POST /toy/ota/activate`
- OTA binary URL from OTA response: `/toy/otaMag/download/<id>`

**MQTT Gateway** — firmware publishes and subscribes:
- Publish to `publish_topic` from OTA response (currently `device-server`)
- Subscribe to `subscribe_topic` from OTA response
- If `subscribe_topic` is `"null"` (string) or empty, fall back to `devices/p2p/<client_id>`

**UDP Audio Channel** — negotiated via MQTT `hello` / server `hello` response.

---

## 2. Full Boot-to-Conversation Flow

```
Device Boot
    │
    ▼
[Phase 1] POST /toy/ota/
    │   ← Returns: mqtt creds, firmware info, activation status, server_time
    │
    ├─ If firmware update available → download firmware → reboot
    │
    ├─ If not activated → [Phase 2] POST /toy/ota/activate (loop)
    │
    ▼
[Phase 3] MQTT CONNECT (using OTA credentials)
    │
    ▼
Firmware publishes: {"type":"hello", ...}  →  Gateway
    │
    ▼
[Phase 4] Gateway returns: {"type":"hello", "udp":{server,port,key,nonce,...}, ...}
    │
    ▼
Firmware opens UDP socket to server:port
    │
    ▼
[Phase 5] Gateway sends (deferred): {"type":"mode_update", ...}
    │   (after querying Manager API for device mode/character/profile)
    │
    ▼
[Phase 6] Conversation loop begins
    │
    ├─ Firmware: {"type":"listen","state":"start","mode":"auto|manual|realtime"}
    ├─ Firmware→Gateway: UDP encrypted Opus audio packets (uplink)
    ├─ Firmware: {"type":"speech_end"}
    ├─ Gateway→Firmware: {"type":"llm","state":"think"}
    ├─ Gateway→Firmware: {"type":"tts","state":"start"}
    ├─ Gateway→Firmware: UDP encrypted Opus audio packets (downlink, 24kHz)
    ├─ Gateway→Firmware: {"type":"stt","text":"..."}  (user transcript)
    ├─ Gateway→Firmware: {"type":"llm","text":"...","emotion":"..."}
    └─ Gateway→Firmware: {"type":"tts","state":"stop"}
```

---

## 3. Phase 1 — OTA Check

### Request

**Endpoint:** `POST /toy/ota/`

**Headers (required):**

```
Device-Id: AA:BB:CC:DD:EE:FF      ← MAC address (used as device identifier)
Client-Id: GID_test@@@AA_BB_CC_DD_EE_FF@@@<uuid>
Activation-Version: <string>
Serial-Number: <string>            ← if available
Content-Type: application/json
User-Agent: <firmware user agent>
Accept-Language: en-US
```

**Body:**

```json
{
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "version": "1.0.5",
  "flash_size": 4194304,
  "chip_model_name": "ESP32-S3",
  "chip_info": {
    "model": 9,
    "cores": 2,
    "revision": 0,
    "features": 18
  },
  "application": {
    "name": "cheeko",
    "compile_time": "Jan 01 2025 00:00:00",
    "idf_version": "v5.1.2"
  },
  "board": "jiuchuan-s3",
  "ota": {
    "label": "factory",
    "state": "VALID"
  }
}
```

### Response

Returns **raw JSON** (not wrapped in `{code, msg, data}`):

```json
{
  "server_time": {
    "timestamp": 1710000000000,
    "timeZone": "Asia/Kolkata",
    "timezone_offset": 330
  },
  "firmware": {
    "version": "1.2.3",
    "url": "http://<host>/toy/otaMag/download/<id>",
    "force": 0,
    "size": 1234567,
    "name": "cheeko_v1.2.3.bin",
    "remark": "Stability improvements"
  },
  "websocket": {
    "url": "ws://<host>/ws"
  },
  "mqtt": {
    "broker": "<emqx-host>",
    "port": 1883,
    "endpoint": "<host>:<port>",
    "client_id": "GID_test@@@AA_BB_CC_DD_EE_FF@@@<uuid>",
    "username": "<mqtt-username>",
    "password": "<mqtt-password>",
    "publish_topic": "device-server",
    "subscribe_topic": "null"
  },
  "activation": {
    "code": "123456",
    "message": "https://app.cheeko.ai/activate\n123456",
    "challenge": "AA:BB:CC:DD:EE:FF"
  }
}
```

### Response Field Reference

| Field | Type | Notes |
|---|---|---|
| `server_time.timestamp` | number | Unix epoch milliseconds; use to sync device clock |
| `server_time.timeZone` | string | IANA timezone name |
| `server_time.timezone_offset` | number | UTC offset in minutes |
| `firmware` | object | **May be absent** — if absent, no update needed |
| `firmware.version` | string | New firmware version string |
| `firmware.url` | string | Full URL to download OTA binary |
| `firmware.force` | number | `1` = must update before connecting; `0` = optional |
| `firmware.size` | number | Binary size in bytes |
| `websocket.url` | string | WebSocket fallback URL (persist to NVS) |
| `mqtt.endpoint` | string | `<host>:<port>` TCP address for MQTT broker |
| `mqtt.client_id` | string | Format: `GID_test@@@<MAC_no_colon>@@@<uuid>` |
| `mqtt.publish_topic` | string | Topic firmware publishes all messages to |
| `mqtt.subscribe_topic` | string | `"null"` (literal string) → use fallback topic |
| `activation` | object | **May be absent** — if absent, device is already activated |
| `activation.code` | string | Display this code to user during activation |
| `activation.challenge` | string | MAC address used in HMAC activation |

### Firmware Rules

- `firmware` field may be absent → no update needed.
- `activation` field may be absent → device already activated.
- `subscribe_topic = "null"` (string) → firmware falls back to `devices/p2p/<client_id>`.
- Persist `mqtt`, `websocket`, and `server_time` to NVS for reconnect after reboot.
- If `firmware.force = 1`, must update immediately before connecting to MQTT.
- OTA check retry: up to 10 times with exponential backoff starting at 10s.

---

## 4. Phase 2 — Activation Loop

**Endpoint:** `POST /toy/ota/activate`

**Headers:**

```
Device-Id: AA:BB:CC:DD:EE:FF
Content-Type: application/json
```

**Body (with serial-number HMAC flow):**

```json
{
  "algorithm": "hmac-sha256",
  "serial_number": "<serial>",
  "challenge": "AA:BB:CC:DD:EE:FF",
  "hmac": "<hex-hmac>"
}
```

### Responses

| HTTP Status | Body | Meaning |
|---|---|---|
| `200` | `success` (plain text) | Device is activated — proceed to MQTT connect |
| `202` | (empty) | Not activated yet — retry after ~3s |
| `202` | (empty) | Any error condition also returns 202 |

### Firmware Rules

- Loop polling until `200 success`.
- Retry up to 10 times per cycle, ~3s between each attempt.
- Display activation code (`activation.code` from OTA response) to user during the loop.
- Only after activation success: proceed to MQTT connect.

```
activating state:
    │
    ├─ POST /toy/ota/activate
    │   ├─ 200 "success" → proceed to MQTT connect
    │   └─ 202 → wait 3s → retry (up to 10 times)
    │
    └─ After 10 failures → wait ~10s → retry full cycle
```

---

## 5. Phase 3 — MQTT Connect and Hello Handshake

### 5.1 MQTT Connection Parameters

Use values from the OTA response `mqtt` object:

| Field | Usage |
|---|---|
| `endpoint` | `<host>:<port>` — TCP address for MQTT broker |
| `client_id` | MQTT client ID: format `GID_test@@@<MAC_no_colon>@@@<uuid>` |
| `username` | MQTT username |
| `password` | MQTT password |
| `publish_topic` | Topic firmware publishes to — usually `device-server` |
| `subscribe_topic` | Topic firmware subscribes to — usually `"null"` (string) → use fallback |

**Subscribe topic fallback** (when `subscribe_topic` is `"null"` or empty):

```
devices/p2p/<client_id>
```

### 5.2 Device Hello Message

After MQTT connect, firmware immediately publishes a `hello` message.

**Firmware publishes to:** `device-server` (or `publish_topic` from OTA)

```json
{
  "type": "hello",
  "version": 3,
  "transport": "udp",
  "features": {
    "mcp": true
  },
  "audio_params": {
    "format": "opus",
    "sample_rate": 16000,
    "channels": 1,
    "frame_duration": 60
  }
}
```

**Field notes:**

| Field | Value | Notes |
|---|---|---|
| `version` | `3` | Current protocol version |
| `transport` | `"udp"` | Requests UDP audio channel |
| `features.mcp` | `true` | Device supports MCP tool calls (volume, LED, etc.) |
| `audio_params.format` | `"opus"` | Codec |
| `audio_params.sample_rate` | `16000` | Device records at 16kHz; gateway resamples to 24kHz for LiveKit |
| `audio_params.channels` | `1` | Mono |
| `audio_params.frame_duration` | `60` | 60ms Opus frames |

### 5.3 Gateway Processing on Hello

When the gateway receives hello from the device:

1. Parses `client_id` → extracts MAC, UUID, GID.
2. Generates `session_id` = `<uuid>_<macNoColon>_<mode>`.
3. Generates UDP encryption key/nonce.
4. Generates `connection_id` (random 32-bit).
5. Immediately sends server hello (see 5.4 below).
6. In background: queries Manager API for device mode, character, child profile.
7. After background queries complete: sends `mode_update` and dispatches LiveKit agent.

### 5.4 Gateway Server Hello (Response)

**Gateway publishes to:** `devices/p2p/<client_id>`

```json
{
  "type": "hello",
  "version": 3,
  "mode": "conversation",
  "session_id": "<uuid>_<macNoColon>_conversation",
  "transport": "udp",
  "udp": {
    "server": "<public-ip>",
    "port": 1883,
    "encryption": "aes-128-ctr",
    "key": "<32-hex-chars>",
    "nonce": "<32-hex-chars>",
    "connection_id": 123456789,
    "cookie": 123456789
  },
  "audio_params": {
    "sample_rate": 24000,
    "channels": 1,
    "frame_duration": 60,
    "format": "opus"
  }
}
```

**Server hello field notes:**

| Field | Notes |
|---|---|
| `session_id` | Must be included in all subsequent MQTT messages from firmware |
| `audio_params.sample_rate` | `24000` — server sends 24kHz downlink audio (different from device uplink 16kHz) |
| `udp.key` | AES-128-CTR encryption key (hex string, 16 bytes = 32 hex chars) |
| `udp.nonce` | AES-128-CTR nonce (hex string, 16 bytes = 32 hex chars) |
| `udp.connection_id` | Used in every UDP packet header |
| `udp.cookie` | Same as `connection_id` — duplicate field for compatibility |

**Timeout:** Firmware must wait max 10s for server hello. If not received, retry or fall back.

---

## 6. Phase 4 — UDP Channel Setup

After receiving server hello, firmware must:

1. Open a UDP socket to `udp.server` : `udp.port`.
2. Configure AES-128-CTR cipher with `udp.key` (hex-decoded to 16 bytes) and `udp.nonce` (hex-decoded to 16 bytes).
3. Start listening for downlink audio from the gateway.

**Uplink (firmware → gateway):** Mic audio encoded as 16kHz Opus, AES-128-CTR encrypted.
**Downlink (gateway → firmware):** Assistant TTS audio at 24kHz Opus, AES-128-CTR encrypted.

See [Section 14](#14-udp-packet-format) for the exact byte layout of each packet.

---

## 7. Phase 5 — Mode Update (Deferred)

After hello, the gateway queries the Manager API in background before sending `mode_update`. This happens asynchronously — firmware may receive `mode_update` a moment after the server hello.

### Gateway API Calls on Hello

| API Call | Purpose |
|---|---|
| `GET /toy/device/:mac/mode` | Get device mode (`conversation`/`music`/`story`) |
| `GET /toy/device/:mac/device-mode` | Get listening mode (`auto`/`manual`) |
| `GET /toy/agent/device/:mac/current-character` | Get current character name |
| `POST /toy/config/child-profile-by-mac` | Get child profile (age, name, preferences) |

### mode_update Message

**Gateway → Firmware (MQTT):**

```json
{
  "type": "mode_update",
  "mode": "conversation",
  "listening_mode": "auto",
  "character": "Cheeko",
  "session_id": "<session_id>",
  "timestamp": 1710000000000
}
```

**`mode` values:** `conversation` | `music` | `story`

**`listening_mode` values:** `auto` | `manual` | `realtime`

**`character` values and their corresponding LiveKit agents:**

| `character` | LiveKit Agent Dispatched |
|---|---|
| `Cheeko` | `cheeko-agent` |
| `Math Tutor` | `math-tutor-agent` |
| `Riddle Solver` | `riddle-solver-agent` |
| `Word Ladder` | `word-ladder-agent` |

After sending `mode_update`, the gateway dispatches the appropriate LiveKit agent worker for the session.

---

## 8. Phase 6 — Conversation Loop

### 8.1 User Starts Speaking (PTT or Wake Word)

**Firmware → Gateway (MQTT):**

```json
{"session_id":"...","type":"listen","state":"start","mode":"manual"}
```

- `mode`: `manual` (PTT button held), `auto` (VAD-based), `realtime` (continuous)
- Firmware simultaneously starts sending UDP audio packets (mic uplink).

### 8.2 Wake Word Detection Event

**Firmware → Gateway (MQTT):**

```json
{"session_id":"...","type":"listen","state":"detect","text":"hey cheeko"}
```

Used to log/surface wake word detection event. This is separate from `listen start`.

### 8.3 User Stops Speaking (PTT Release)

**Firmware → Gateway (MQTT):**

```json
{"session_id":"...","type":"speech_end"}
```

- Firmware stops mic/UDP uplink.
- Firmware enters "thinking" UI state (waiting for TTS).
- Thinking timeout: 20s with no `tts start` → close session, go idle.

### 8.4 Gateway Thinking Indicator

**Gateway → Firmware (MQTT):**

```json
{"type":"llm","state":"think","session_id":"..."}
```

Firmware should show thinking/loading animation.

### 8.5 Gateway Starts Speaking

**Gateway → Firmware (MQTT):**

```json
{"type":"tts","state":"start","session_id":"...","text":"Hello! How can I help you today?"}
```

- `text` is optional (may be empty string or absent).
- On this message, firmware transitions to `speaking` state.
- Firmware starts playing downlink UDP audio.

### 8.6 Gateway Sentence Start (Text Update)

**Gateway → Firmware (MQTT):**

```json
{"type":"tts","state":"sentence_start","session_id":"...","text":"Hello! How can I help you today?"}
```

Optional — used for on-screen transcript of assistant speech. No state transition required.

### 8.7 User Transcript from STT

**Gateway → Firmware (MQTT):**

```json
{"type":"stt","text":"Tell me a story about a fox","session_id":"..."}
```

- Carries recognized user speech text.
- No `stt start/stop` states exist — just text update messages.
- Firmware uses this for on-screen display only; no transport state change.

### 8.8 LLM Text and Emotion

**Gateway → Firmware (MQTT):**

```json
{"type":"llm","text":"Once upon a time...","session_id":"..."}
{"type":"llm","text":"I'm so happy you asked!","emotion":"happy","session_id":"..."}
```

**Known emotion values:** `happy` | `sad` | `thinking` | `excited` | `circle_xmark`

Used for facial animation / LED / display updates. No transport state change required.

### 8.9 Gateway Stops Speaking

**Gateway → Firmware (MQTT):**

```json
{"type":"tts","state":"stop","session_id":"..."}
```

**Firmware state transition on `tts stop`:**

| Listening mode | Next state |
|---|---|
| `manual` | → `idle` |
| `auto` | → `listening` (send `listen start` automatically) |
| `realtime` | → `listening` (send `listen start` automatically) |

### 8.10 Alert Message

**Gateway → Firmware (MQTT):**

```json
{
  "type": "alert",
  "status": "error",
  "message": "Connection to AI service failed",
  "emotion": "circle_xmark",
  "session_id": "..."
}
```

Used for error conditions. Firmware should show error UI.

### 8.11 Agent Ready Signal

**Gateway → Firmware (MQTT):**

```json
{"type":"agent_ready"}
```

Sent when the LiveKit agent has joined the room and is ready to process audio. Firmware can use this to know the AI is ready.

### 8.12 Conversation Timing Diagram

```
Firmware              Gateway/LiveKit
   │                       │
   │── listen(start) ──────►│
   │══ UDP audio uplink ═══►│
   │── speech_end ──────────►│
   │                        │  (STT + LLM processing)
   │◄── llm(think) ─────────│
   │◄── tts(start) ─────────│
   │◄══ UDP audio downlink ═│
   │◄── stt(text) ──────────│  (user transcript)
   │◄── llm(text/emotion) ──│  (assistant text)
   │◄── tts(stop) ──────────│
   │                        │
   │  (manual) → idle       │
   │  (auto/realtime) ──────►│── listen(start) again
```

---

## 9. Phase 7 — Abort / Interrupt

### 9.1 Firmware Interrupts During Speaking

**Firmware → Gateway (MQTT):**

```json
{"session_id":"...","type":"abort","reason":"wake_word_detected"}
```

**`reason` values:** `wake_word_detected` | `button_pressed` | `user_interrupt`

### 9.2 Firmware Behavior on Sending Abort

1. Clear pending UDP uplink buffers.
2. Immediately start a new `listen start`.
3. Do NOT full reconnect — reuse the existing session and UDP channel.

### 9.3 Gateway Behavior on Receiving Abort

- Sends `abort` event to LiveKit data channel → agent stops TTS generation.
- Stops sending downlink audio.
- Waits for next `listen start`.

---

## 10. Phase 8 — Session End

### 10.1 Device Initiates Goodbye

**Firmware → Gateway (MQTT):**

```json
{"session_id":"...","type":"goodbye"}
```

### 10.2 Gateway Initiates Goodbye (Inactivity Timeout)

**Gateway → Firmware (MQTT):**

```json
{"type":"goodbye","session_id":"...","reason":"inactivity_timeout"}
```

**`reason` values:** `inactivity_timeout` | `error` | `disconnect` | `mode_change`

### 10.3 Firmware Behavior on Receiving Goodbye

1. Close UDP channel.
2. Reset session variables (`session_id`, crypto state).
3. Transition to `idle`.
4. Do NOT MQTT disconnect — stay connected for the next session.

---

## 11. RFID Card Flow

### 11.1 Card Tapped — Local SD Cache Check

```
Card tapped
    │
    ▼
Check SD: /sdcard/cheeko/cardmap.jsn  →  UID present?
    │
    ├─ Yes: check /sdcard/cheeko/skills/<skill_id>/manifest.jsn  →  exists?
    │           │
    │           ├─ Yes → Play immediately (offline, no network needed)
    │           │         audio: /sdcard/cheeko/skills/<skill_id>/audio/*.mp3
    │           │         images: /sdcard/cheeko/skills/<skill_id>/images/*
    │           │
    │           └─ No (incomplete download) → treat as unknown, send card_lookup
    │
    └─ No → send card_lookup to gateway
```

- Local-first path must be fast and offline-capable.
- Keep a persistent `UID -> skill_id` map in `cardmap.jsn`.
- Consider a skill valid only if `manifest.jsn` exists (completion marker).

### 11.2 Card Lookup Request (Unknown Card)

**Firmware → Gateway (MQTT):**

```json
{"session_id":"...","type":"card_lookup","rfid_uid":"04A1B2C3D4"}
```

**Gateway processing:**
1. Calls Manager API: `GET /toy/admin/rfid/card/lookup/<rfidUid>`
2. Returns one of three responses (see 11.3–11.5 below).

**Timeout:** 10s waiting for card response. If no response, show "card not recognized".

### 11.3 Response A — Unknown Card

**Gateway → Firmware (MQTT):**

```json
{"type":"card_unknown","rfid_uid":"04A1B2C3D4"}
```

**Firmware:** Show "card not recognized" UX.

### 11.4 Response B — AI Card

**Gateway → Firmware (MQTT):**

```json
{"type":"card_ai","rfid_uid":"04A1B2C3D4"}
```

**Firmware behavior:**
1. Store UID → AI mapping locally.
2. If device is idle: prewarm conversation channel (send `hello` if not already connected).
3. On user action (button/wake word): start conversation immediately from prewarmed state.
4. On card removal: cancel prewarm, do not enter deep sleep while prewarmed.

**Prewarm flow:**

```
card_ai received
    │
    ├─ Already connected (hello done) → keep channel, mark as prewarmed
    │
    └─ Not connected → send hello → wait for server hello → open UDP → stay in prewarm state

User presses talk button:
    │
    └─ Send listen(start) immediately (channel already open)
```

### 11.5 Response C — Content Card (Story/Song/Habit/Rhyme Pack)

**Gateway → Firmware (MQTT):**

```json
{
  "type": "card_content",
  "rfid_uid": "04A1B2C3D4",
  "skill_id": "skill_abc123",
  "skill_name": "The Hungry Fox Story",
  "version": 1,
  "audio": [
    {"index": 1, "url": "https://cdn.cheeko.ai/skills/abc123/audio/track1.mp3"},
    {"index": 2, "url": "https://cdn.cheeko.ai/skills/abc123/audio/track2.mp3"}
  ],
  "images": [
    {"index": 1, "url": "https://cdn.cheeko.ai/skills/abc123/images/page1.jpg"},
    {"index": 2, "url": "https://cdn.cheeko.ai/skills/abc123/images/page2.jpg"}
  ]
}
```

**Firmware download and play flow:**

```
card_content received
    │
    ▼
Background download task:
    1. Create dir: /sdcard/cheeko/skills/<skill_id>/
    2. Download each audio URL → /sdcard/cheeko/skills/<skill_id>/audio/track<n>.mp3
    3. Download each image URL → /sdcard/cheeko/skills/<skill_id>/images/page<n>.jpg
    4. Write manifest.jsn LAST (marks download complete)
    5. Update cardmap.jsn: UID → skill_id
    │
    ▼
Play content from SD
```

**Important firmware rules:**
- Write `manifest.jsn` **last** — it is the completion marker. If firmware crashes mid-download, the next boot will retry the download (manifest absent = incomplete).
- If card is removed during download → abort download, do NOT auto-play when download finishes.
- Download must run in a background task — main event loop must stay responsive.

### 11.6 Card Types from Manager API

The Manager API `card/lookup` response `contentType` field determines gateway routing:

| `contentType` | Gateway behavior |
|---|---|
| `story_pack` / `rhyme_pack` / `habit_pack` | Send `card_content` to firmware |
| `prompt` | Route `promptText` to LiveKit agent as `user_text` (no SD download) |
| `prompt_pack` | Route prompt to LiveKit as `user_text` |
| `read_only` | Send `contentText` directly as TTS without LLM (via `user_text` with read_only flag) |

For `prompt` and `read_only` cards, firmware may receive a `tts start` and audio response without having sent a `listen start` — this is the gateway routing a scripted response.

### 11.7 Legacy Download Response (Backward Compatibility)

Gateway also handles older `download_response` format for legacy firmware:

```json
{"type":"download_response","status":"not_found","rfid_uid":"04A1B2C3D4"}
{"type":"download_response","status":"up_to_date","rfid_uid":"04A1B2C3D4","pack_code":"fox_story","version":"2"}
{"type":"download_response","status":"download_required","rfid_uid":"04A1B2C3D4","pack_code":"fox_story","files":{...}}
{"type":"download_response","status":"error","rfid_uid":"04A1B2C3D4","message":"Server error"}
```

New firmware should use `card_content` / `card_ai` / `card_unknown` instead.

---

## 12. Device State Machine

### 12.1 State List

| State | Description |
|---|---|
| `starting` | Boot, hardware init |
| `wifi_configuring` | Wi-Fi provisioning |
| `activating` | OTA check + activation loop |
| `idle` | Fully connected, waiting for user action |
| `connecting` | Opening MQTT hello + UDP channel |
| `listening` | Mic active, streaming audio uplink |
| `speaking` | Playing TTS downlink audio |
| `upgrading` | Downloading and flashing OTA firmware |
| `audio_testing` | Audio hardware test mode |
| `fatal_error` | Unrecoverable error |

### 12.2 State Transitions

```
starting
  └─ Wi-Fi connected → wifi_configuring (if no creds) | activating (if creds stored)

activating
  └─ OTA check done, firmware update needed → upgrading
  └─ Need activation → loop /ota/activate until 200
  └─ Activated → idle

idle
  └─ User presses button / wake word → connecting
  └─ AI card tapped (prewarm) → connecting (background, silent)
  └─ Content card known on SD → play from SD (stays idle after playback)

connecting
  └─ hello sent, server hello received, UDP open → listening
  └─ User cancels (button in connecting state) → idle
  └─ Timeout (no server hello in 10s) → idle

listening
  ├─ Sending: listen(state=start), UDP audio uplink
  ├─ Button/PTT release → send speech_end → stays in listening until tts start
  ├─ listen(state=stop) sent → idle (manual stop)
  ├─ 30s silence timeout → idle (close session)
  └─ Receive tts(state=start) → speaking

speaking
  ├─ Receiving: UDP audio downlink, tts/stt/llm MQTT messages
  ├─ Wake word detected → send abort → send listen(start) → listening
  ├─ Button press → send abort → send listen(start) → listening
  └─ Receive tts(state=stop):
        manual mode → idle
        auto/realtime → listening

upgrading
  └─ Flash complete → reboot → starting

fatal_error
  └─ Manual reset only
```

### 12.3 Encoder Button Behavior (jiuchuan board)

| Current State | Button Action | Firmware Behavior |
|---|---|---|
| `listening` | Press | Send `speech_end` (end user turn) |
| `speaking` | Press | Send `abort` (interrupt assistant) |
| `connecting` | Press | Cancel connection attempt → `idle` |
| `idle` + prewarmed | Press | Send `listen start` (instant conversation) |
| `idle` + content card | Press | Play/pause/next track on SD |
| `idle` | Press | Start connecting → `connecting` |

---

## 13. MQTT Message Reference

### 13.1 Firmware → Gateway (Uplink)

#### `hello`

```json
{
  "type": "hello",
  "version": 3,
  "transport": "udp",
  "features": { "mcp": true },
  "audio_params": {
    "format": "opus",
    "sample_rate": 16000,
    "channels": 1,
    "frame_duration": 60
  }
}
```

#### `listen` — start

```json
{
  "session_id": "abc123_AABBCCDDEEFF_conversation",
  "type": "listen",
  "state": "start",
  "mode": "manual"
}
```

`mode` values: `manual` | `auto` | `realtime`

#### `listen` — stop

```json
{
  "session_id": "...",
  "type": "listen",
  "state": "stop"
}
```

#### `listen` — detect (wake word)

```json
{
  "session_id": "...",
  "type": "listen",
  "state": "detect",
  "text": "hey cheeko"
}
```

#### `speech_end`

```json
{
  "session_id": "...",
  "type": "speech_end"
}
```

#### `abort`

```json
{
  "session_id": "...",
  "type": "abort",
  "reason": "wake_word_detected"
}
```

`reason` values: `wake_word_detected` | `button_pressed` | `user_interrupt`

#### `goodbye`

```json
{
  "session_id": "...",
  "type": "goodbye"
}
```

#### `mcp` (tool call from device to agent)

```json
{
  "session_id": "...",
  "type": "mcp",
  "payload": {
    "id": "call_001",
    "function": "self.audio_speaker.set_volume",
    "params": { "volume": 80 }
  }
}
```

#### `card_lookup`

```json
{
  "session_id": "...",
  "type": "card_lookup",
  "rfid_uid": "04A1B2C3D4"
}
```

---

### 13.2 Gateway → Firmware (Downlink)

#### `hello` (server hello)

```json
{
  "type": "hello",
  "version": 3,
  "mode": "conversation",
  "session_id": "abc123_AABBCCDDEEFF_conversation",
  "transport": "udp",
  "udp": {
    "server": "192.168.1.100",
    "port": 1883,
    "encryption": "aes-128-ctr",
    "key": "0102030405060708090a0b0c0d0e0f10",
    "nonce": "101112131415161718191a1b1c1d1e1f",
    "connection_id": 987654321,
    "cookie": 987654321
  },
  "audio_params": {
    "sample_rate": 24000,
    "channels": 1,
    "frame_duration": 60,
    "format": "opus"
  }
}
```

#### `mode_update`

```json
{
  "type": "mode_update",
  "mode": "conversation",
  "listening_mode": "auto",
  "character": "Cheeko",
  "session_id": "...",
  "timestamp": 1710000000000
}
```

`mode` values: `conversation` | `music` | `story`
`listening_mode` values: `auto` | `manual` | `realtime`
`character` values: `Cheeko` | `Math Tutor` | `Riddle Solver` | `Word Ladder`

#### `tts` — start

```json
{
  "type": "tts",
  "state": "start",
  "session_id": "...",
  "text": "Hello! I'm Cheeko."
}
```

`text` is optional and may be absent.

#### `tts` — sentence_start

```json
{
  "type": "tts",
  "state": "sentence_start",
  "session_id": "...",
  "text": "Once upon a time..."
}
```

#### `tts` — stop

```json
{
  "type": "tts",
  "state": "stop",
  "session_id": "..."
}
```

#### `stt` (user transcript)

```json
{
  "type": "stt",
  "text": "Tell me a story about a fox",
  "session_id": "..."
}
```

#### `llm` — thinking indicator

```json
{
  "type": "llm",
  "state": "think",
  "session_id": "..."
}
```

#### `llm` — text response

```json
{
  "type": "llm",
  "text": "Once upon a time, there was a clever fox...",
  "session_id": "..."
}
```

#### `llm` — text with emotion

```json
{
  "type": "llm",
  "text": "I'm so happy you asked!",
  "emotion": "happy",
  "session_id": "..."
}
```

`emotion` values: `happy` | `sad` | `thinking` | `excited` | `circle_xmark`

#### `alert`

```json
{
  "type": "alert",
  "status": "error",
  "message": "Connection to AI service failed",
  "emotion": "circle_xmark",
  "session_id": "..."
}
```

#### `agent_ready`

```json
{
  "type": "agent_ready"
}
```

#### `goodbye` (server-initiated)

```json
{
  "type": "goodbye",
  "session_id": "...",
  "reason": "inactivity_timeout"
}
```

`reason` values: `inactivity_timeout` | `error` | `disconnect` | `mode_change`

#### `card_unknown`

```json
{
  "type": "card_unknown",
  "rfid_uid": "04A1B2C3D4"
}
```

#### `card_ai`

```json
{
  "type": "card_ai",
  "rfid_uid": "04A1B2C3D4"
}
```

#### `card_content`

```json
{
  "type": "card_content",
  "rfid_uid": "04A1B2C3D4",
  "skill_id": "skill_abc123",
  "skill_name": "The Hungry Fox Story",
  "version": 1,
  "audio": [
    {"index": 1, "url": "https://cdn.cheeko.ai/skills/abc123/audio/track1.mp3"},
    {"index": 2, "url": "https://cdn.cheeko.ai/skills/abc123/audio/track2.mp3"}
  ],
  "images": [
    {"index": 1, "url": "https://cdn.cheeko.ai/skills/abc123/images/page1.jpg"},
    {"index": 2, "url": "https://cdn.cheeko.ai/skills/abc123/images/page2.jpg"}
  ]
}
```

### 13.3 Message Semantics — Required Firmware Behavior

| Incoming Message | Required Firmware Action |
|---|---|
| `listen state=start` | Enter listening behavior; start mic capture and UDP uplink |
| `listen state=stop` | Stop mic capture; return to idle |
| `speech_end` | Stop mic capture immediately; show thinking UI; wait for `tts start` |
| `tts state=start` | Enter speaking behavior; start playing UDP downlink audio |
| `tts state=sentence_start` | Optional: update on-screen transcript |
| `tts state=stop` | End speaking; transition by mode: manual→idle, auto/realtime→listening |
| `stt` | Update user transcript text on display/log; no state transition |
| `llm state=think` | Show thinking indicator (before TTS starts) |
| `llm text/emotion` | Update assistant text/emotion UI; no transport change |
| `abort` (sent by firmware) | Use for interrupting speaking or playback; send immediately on wake-word interruption during speaking |
| `goodbye` | Close current session; reset local session variables |
| `card_content` | Download audio/images to SD; write manifest last; update card map |
| `card_ai` | Mark UID as AI card; trigger/prewarm conversation behavior |
| `card_unknown` | Show card-not-recognized UX and stop waiting |

---

## 14. UDP Packet Format

### 14.1 Header (16 bytes, big-endian)

```
Offset  Size  Type      Field           Notes
------  ----  --------  --------------- -----------------------------------------
0       1     uint8     packet_type     1 = audio packet
1       1     uint8     flags           reserved, currently 0
2-3     2     uint16be  payload_length  length of encrypted payload in bytes
4-7     4     uint32be  connection_id   from server hello udp.connection_id
8-11    4     uint32be  timestamp       milliseconds (local clock, for jitter calc)
12-15   4     uint32be  sequence        monotonically increasing per sender
```

### 14.2 Payload (bytes 16 onward)

Encrypted Opus audio using **AES-128-CTR**.

- **Key:** `udp.key` from server hello (hex string, hex-decode to 16 bytes)
- **Nonce/IV:** `udp.nonce` from server hello (hex string, hex-decode to 16 bytes)
- Each packet uses the nonce, modified by sequence number for counter mode

### 14.3 Uplink (Firmware → Gateway)

| Parameter | Value |
|---|---|
| Sample rate | 16000 Hz |
| Channels | 1 (mono) |
| Codec | Opus |
| Frame duration | 60ms |
| Frame size | 16000 × 0.060 = 960 samples per frame |

### 14.4 Downlink (Gateway → Firmware)

| Parameter | Value |
|---|---|
| Sample rate | 24000 Hz |
| Channels | 1 (mono) |
| Codec | Opus |
| Frame duration | 60ms |

**Note:** Firmware records at 16kHz; gateway resamples uplink from 16kHz to 24kHz before sending to LiveKit. Assistant audio comes back at 24kHz and is sent as-is to firmware. Firmware DAC must support 24kHz playback.

### 14.5 Validation Rules

1. Ignore packets where `packet_type != 1`.
2. Ignore packets where total length < 16 (malformed header).
3. Track remote `sequence` number; reject stale out-of-order packets.
4. Keep local `sequence` counter for uplink; increment per packet sent.

---

## 15. Manager API Endpoints

Base path: `/toy` (all endpoints below are relative to it).

### 15.1 Firmware Uses Directly

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `POST` | `/ota/` | None (public) | Boot OTA check, get MQTT credentials |
| `POST` | `/ota/activate` | None (public) | Activation polling loop |
| `GET` | `/otaMag/download/<id>` | None | Firmware binary download |

### 15.2 Gateway Uses (on behalf of device)

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/device/:mac/mode` | Get device mode (`conversation`/`music`/`story`) |
| `GET` | `/device/:mac/device-mode` | Get listening mode (`auto`/`manual`) |
| `POST` | `/device/:mac/cycle-mode` | Cycle to next mode |
| `GET` | `/agent/device/:mac/current-character` | Get current character name |
| `POST` | `/agent/device/:mac/set-character` | Set specific character |
| `POST` | `/agent/device/:mac/cycle-character` | Cycle to next character |
| `POST` | `/config/child-profile-by-mac` | Get child profile (age, name, preferences) |
| `GET` | `/device/:mac/playlist/music` | Get music playlist |
| `GET` | `/device/:mac/playlist/story` | Get story playlist |
| `GET` | `/admin/rfid/card/lookup/:rfidUid` | RFID card lookup |
| `GET` | `/admin/rfid/card/content/download/:rfidUid` | Content pack download manifest |

### 15.3 Standard Response Format

Most Manager API endpoints return:

```json
{
  "code": 0,
  "msg": "success",
  "data": { ... }
}
```

**Exceptions:**
- `/toy/ota/` returns raw JSON (no wrapper).
- `/toy/ota/activate` returns plain text `success` or empty body.

---

## 16. Gateway Internal API Calls

This section describes what the gateway does internally after receiving device messages — firmware does not call these directly, but understanding them explains timing and behavior.

### 16.1 On Device Hello

```
Gateway receives hello from device
    │
    ├─ GET /toy/device/:mac/mode
    │   Response: {code:0, data:"conversation"}
    │
    ├─ GET /toy/device/:mac/device-mode
    │   Response: {code:0, data:"auto"}
    │
    ├─ GET /toy/agent/device/:mac/current-character
    │   Response: {code:0, data:{characterName:"Cheeko"}}
    │
    └─ POST /toy/config/child-profile-by-mac
        Body: {"macAddress":"AA:BB:CC:DD:EE:FF"}
        Response: {code:0, data:{name:"Aria", age:6, language:"en"}}
```

After all four complete, gateway:
1. Sends `mode_update` to device.
2. Dispatches appropriate LiveKit agent worker.

### 16.2 On RFID Card Lookup

```
Gateway receives card_lookup from device
    │
    └─ GET /toy/admin/rfid/card/lookup/:rfidUid
        Response:
        {
          "code": 0,
          "data": {
            "contentType": "story_pack|rhyme_pack|habit_pack|prompt|prompt_pack|read_only",
            "title": "The Hungry Fox",
            "packName": "Fox Adventures Vol 1",
            "packCode": "fox_vol1",
            "contentText": "Once upon a time...",   ← for read_only
            "promptText": "Tell me about a fox",    ← for prompt
            "language": "en",
            "items": [
              {
                "index": 1,
                "audioUrl": "https://...",
                "imageUrl": "https://..."
              }
            ]
          }
        }
```

Gateway then decides:
- `story_pack` / `rhyme_pack` / `habit_pack` → also calls `GET /toy/admin/rfid/card/content/download/:rfidUid` → sends `card_content` to firmware
- `prompt` / `prompt_pack` → sends `promptText` as `user_text` to LiveKit agent data channel
- `read_only` → sends `contentText` as `user_text` with read_only flag to agent

---

## 17. LiveKit Data Channel Messages

These are internal messages between the MQTT Gateway and the LiveKit Python agent workers. Firmware does not see these directly — they drive the AI behavior. Included here for completeness.

### 17.1 Gateway → Agent

| Message | Trigger | Purpose |
|---|---|---|
| `ptt_event` | Device sends `listen start` | Start recording user audio in agent |
| `speech_end` | Device sends `speech_end` | End user turn, trigger AI response |
| `abort` | Device sends `abort` | Stop current AI generation |
| `disconnect_agent` | Device sends `goodbye` | Clean up agent session |
| `ready_for_greeting` | Agent joins room | Trigger initial greeting |
| `end_prompt` | Session ending | Tell agent to wrap up |
| `user_text` | RFID prompt/read_only card | Inject text as if user said it |
| `mcp` | Device sends `mcp` | Forward tool call to agent |

### 17.2 Agent → Gateway

| Event | Meaning | Gateway Action |
|---|---|---|
| `agent_state_changed` | speaking/listening state change | Send `tts start/stop` to device |
| `speech_created` | Agent audio ready | Stream audio to device via UDP |
| `lk.transcription` | User/agent transcription stream | Send `stt`/`llm text` to device |
| `lk.agent.events` | Agent lifecycle events | Track agent join/leave |

### 17.3 `cheeko_worker.py` Handled Message Types

The Python agent worker explicitly handles:
- `ready_for_greeting` → sends greeting to child
- `end_prompt` → graceful session end
- `shutdown_request` → hard shutdown
- `user_text` → inject as user message (for RFID prompt routing)

**Known gap:** `ptt_event`, `speech_end`, and `abort` are sent by the gateway to the agent but the worker does not have explicit handlers for these — they are handled by the LiveKit SDK's built-in agent session flow.

---

## 18. Timeouts and Retries

Use these values for compatibility with current backend behavior:

| Timeout | Duration | Action |
|---|---|---|
| Server hello wait | 10s | Retry or fall back |
| Listening inactivity | 30s | Send goodbye, go idle |
| Thinking (after speech_end) | 20s | Close session, go idle |
| Unknown RFID response | 10s | Show "not recognized" |
| Activation retry interval | ~3s | Retry `/ota/activate` |
| OTA check retry | 10s (exponential) | Retry `/ota/` up to 10 times |
| RFID API call (gateway) | 5s | Gateway timeout on Manager API call |

---

## 19. Persistence Keys

Persist these settings so firmware can reconnect after reboot without re-running OTA check:

**MQTT (store to NVS):**
- `endpoint`
- `client_id`
- `username`
- `password`
- `publish_topic`
- `subscribe_topic`

**WebSocket fallback:**
- `websocket.url`

**RFID local metadata (store to SD card):**
- `UID -> skill_id` map (`cardmap.jsn`)
- Per-skill manifest marker (`skills/<skill_id>/manifest.jsn`)

---

## 20. Minimal Conformance Checklist

A firmware build is integration-ready when all checks pass:

| # | Check |
|---|---|
| 1 | Can complete OTA check and parse `activation`/`mqtt`/`firmware`/`server_time` |
| 2 | Can activate with `/ota/activate` retry behavior |
| 3 | Can MQTT connect with OTA credentials |
| 4 | Can perform `hello` handshake and open UDP channel |
| 5 | Can send uplink audio and play downlink audio via UDP |
| 6 | Can process `tts start/stop` and maintain speaking/listening transitions |
| 7 | Can send `speech_end` and receive response turn correctly |
| 8 | Can send `abort` during speaking and recover to listening |
| 9 | RFID local cache path works fully offline |
| 10 | RFID unknown path works via `card_lookup` → `card_content`/`card_ai`/`card_unknown` |
| 11 | Card removal properly stops playback/session |
| 12 | Handles `goodbye` cleanly and can start a new session |

---

## Appendix A: MQTT Topic Summary

| Direction | Topic | Notes |
|---|---|---|
| Device → Gateway | `device-server` | From OTA `publish_topic`; all device messages go here |
| Gateway → Device | `devices/p2p/<client_id>` | Derived from OTA `client_id` |
| EMQX → Gateway | `internal/server-ingest` | Internal EMQX republish; envelope has `sender_client_id` + `orginal_payload` (typo intentional in field name) |

---

## Appendix B: Session ID Format

```
<uuid>_<mac_without_colons>_<mode>

Examples:
  abc123def456_AABBCCDDEEFF_conversation
  abc123def456_AABBCCDDEEFF_music
```

---

## Appendix C: Source Code Anchors

**Firmware side:**

| File | Contents |
|---|---|
| `main/ota.cc` | OTA check and activation loop |
| `main/application.cc` | Top-level application state machine |
| `main/protocols/protocol.cc` | Base protocol interface |
| `main/protocols/mqtt_protocol.cc` | MQTT protocol implementation |
| `main/device_state_machine.cc` | Device state machine |
| `main/boards/common/content_manager.cc` | RFID and content management |
| `main/boards/jiuchuan-s3/jiuchuan_dev_board.cc` | Board-specific I/O (button, encoder) |

**Gateway and API side (interfaces consumed by firmware):**

| File | Contents |
|---|---|
| `main/manager-api-node/src/routes/ota.routes.js` | OTA endpoint handlers |
| `main/manager-api-node/src/services/device.service.js` | Device config service |
| `main/mqtt-gateway/mqtt/virtual-connection.js` | Per-device virtual connection |
| `main/mqtt-gateway/gateway/mqtt-gateway.js` | MQTT message routing |
| `main/mqtt-gateway/livekit/livekit-bridge.js` | LiveKit audio and data bridge |
