---
id: overview
sidebar_position: 1
---

# Architecture Overview

![Architecture](/img/architecture-header.jpeg)

## System Diagram

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

All device-to-server communication starts with the Manager API (OTA), then shifts to the MQTT Gateway for real-time protocol.

## Service Port Map

| Service | Language | Port | Base Path | Notes |
|---------|----------|------|-----------|-------|
| manager-api-node | Node.js / Express | 8002 | `/toy` | Active implementation |
| mqtt-gateway | Node.js | — | — | MQTT + UDP bridge |
| livekit-server | Python | — | — | LiveKit agent workers |
| manager-web | Vue.js | — | — | Admin dashboard |
| MQTT broker (EMQX) | — | 1883 | — | Device MQTT endpoint |
| Swagger / API Docs | — | 8002 | `/toy/doc.html` | OpenAPI UI |

## Boot-to-Conversation Flow: 8 Phases

| Phase | Name | Description |
|-------|------|-------------|
| 1 | OTA Check | Device POSTs to `/toy/ota/` — gets MQTT credentials, firmware info, activation status, server time |
| 2 | Activation Loop | If not activated, device polls `POST /toy/ota/activate` until it receives `200 success` |
| 3 | MQTT Connect + Hello | Device connects to EMQX broker and publishes `{"type":"hello"}` — gateway responds with server hello containing UDP credentials |
| 4 | UDP Channel Setup | Device opens UDP socket to the address in server hello; configures AES-128-CTR cipher |
| 5 | Mode Update (Deferred) | Gateway queries Manager API for device mode, character, and child profile; sends `{"type":"mode_update"}` to device |
| 6 | Conversation Loop | Bidirectional voice: device streams mic audio uplink (UDP), gateway streams TTS audio downlink (UDP); MQTT carries control messages |
| 7 | Abort / Interrupt | Device sends `{"type":"abort"}` to interrupt the assistant mid-speech; gateway stops TTS and waits for next listen |
| 8 | Session End | Either side sends `{"type":"goodbye"}`; device closes UDP channel and returns to idle without disconnecting MQTT |

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

## Component Responsibilities

### ESP32 Firmware
- Implements the device state machine (`starting` → `activating` → `idle` → `connecting` → `listening` → `speaking`)
- Manages MQTT connection lifecycle and publishes/subscribes to control topics
- Sends mic audio as AES-128-CTR encrypted Opus frames over UDP (16kHz uplink)
- Plays TTS audio received over UDP (24kHz downlink)
- Handles RFID card tap events; maintains local SD card cache of content skills

### mqtt-gateway
The gateway is the real-time protocol hub. It is organized into layers under `main/mqtt-gateway/`:

| Layer | Directory | Purpose |
|-------|-----------|---------|
| Protocol handlers | `gateway/` | MQTT/UDP handlers: `mqtt-gateway.js`, `udp-server.js`, `emqx-broker.js` |
| LiveKit integration | `livekit/` | `livekit-bridge.js`, `audio-processor.js`, `mcp-handler.js` |
| Shared utilities | `core/` | `opus-initializer.js`, `worker-pool-manager.js` |
| Config / logging | `utils/` | Logging, config management |

For each device session the gateway maintains a `VirtualMQTTConnection` and a `LiveKitBridge`. It resamples uplink audio from 16kHz to 24kHz before forwarding to LiveKit.

### manager-api-node
REST API serving both the gateway (config lookups) and the firmware (OTA). Base path `/toy`. Modules:

| Module | Path | Role |
|--------|------|------|
| agent | `src/routes/agent.routes.js` | Agent config and prompts per MAC |
| device | `src/routes/device.routes.js` | Device registry, mode, character |
| content | `src/routes/content.routes.js` | Music, stories, textbooks |
| rfid | `src/routes/rfid.routes.js` | RFID card lookup and content manifest |
| security / auth | `src/routes/auth.routes.js` | User authentication (Supabase Auth) |
| analytics | `src/routes/analytics.routes.js` | Game sessions, media playback, usage stats |
| profile | `src/routes/profile.routes.js` | Child profiles (mobile API) |

### livekit-server
Python-based LiveKit agent workers. Each worker handles a specific mode:

| Worker | Character | Triggered by |
|--------|-----------|--------------|
| `cheeko_worker.py` | Cheeko | Default / `conversation` mode |
| `math_tutor_worker.py` | Math Tutor | Character set to `Math Tutor` |
| `riddle_solver_worker.py` | Riddle Solver | Character set to `Riddle Solver` |
| `word_ladder_worker.py` | Word Ladder | Character set to `Word Ladder` |

The gateway resolves the active character (from Manager API) and dispatches the corresponding agent worker into the LiveKit room.

## External Services

| Service | Purpose |
|---------|---------|
| LiveKit Cloud | Real-time voice/video WebRTC infrastructure |
| Groq / Google | LLM providers for conversation |
| ElevenLabs / Edge-TTS | Text-to-speech synthesis |
| Deepgram / Whisper | Speech-to-text transcription |
| Qdrant | Vector search for semantic content matching |
| Mem0 | Memory and personalization across sessions |
| Grafana Loki | Centralized log aggregation |
| Supabase | PostgreSQL database and auth for manager-api-node |
| EMQX | MQTT broker for device-to-gateway messaging |

:::tip CI/CD
CircleCI (`.circleci/config.yml`) handles branch-specific deployments, Docker builds for each component, and EMQX broker deployment.
:::
