# MQTT Gateway - API Reference

**Port:** 1883 (MQTT/UDP) | 8000 (HTTP Forwarder)
**Protocols:** MQTT, UDP, WebSocket (LiveKit), HTTP
**Total Endpoints/Handlers:** ~102

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [1. ESP32 Device Communication](#1-esp32-device-communication)
- [2. Mobile App Communication](#2-mobile-app-communication)
- [3. RFID Card Handling](#3-rfid-card-handling)
- [4. LiveKit Agent Integration](#4-livekit-agent-integration)
- [5. Media Bot Control (Music/Story)](#5-media-bot-control-musicstory)
- [6. HTTP Endpoints](#6-http-endpoints)
- [7. UDP Audio Protocol](#7-udp-audio-protocol)
- [8. Data Flow Diagrams](#8-data-flow-diagrams)
- [Endpoint Count Summary](#endpoint-count-summary)
- [Environment Variables](#environment-variables)

---

## Architecture Overview

```
ESP32 Device
  ├─ MQTT (control messages) ──► EMQX Broker ──► mqtt-gateway
  └─ UDP  (audio stream)    ──────────────────► mqtt-gateway
                                                    │
                            ┌───────────────────────┤
                            ▼                       ▼
                    Manager API Node          LiveKit Cloud
                   (config, RFID, profiles)   (AI voice agents)
                                                    │
Mobile App ──► MQTT ──► EMQX ──► mqtt-gateway       ▼
                                              Media API (Cerebrium)
                                             (music/story bots)
```

---

## 1. ESP32 Device Communication

All device communication flows through MQTT (control) and UDP (audio).

### 1.1 MQTT Topics — Device ↔ Gateway

| Topic | Direction | Description |
|-------|-----------|-------------|
| `internal/server-ingest` | Device → Gateway | All device messages (EMQX republishes here with clientId metadata) |
| `devices/p2p/{clientId}` | Gateway → Device | Responses back to specific device |
| `cheeko/{mac}/playback_control/next` | Device → Gateway | Next track control |
| `cheeko/{mac}/playback_control/previous` | Device → Gateway | Previous track control |

### 1.2 Device → Gateway Messages (Inbound)

| Message Type | Description | Key Fields |
|-------------|-------------|------------|
| `hello` | Device connection init | `client_id`, `audio_params`, `features`, `protocol_version` |
| `goodbye` | Device disconnection | `client_id`, `session_id`, `reason` |
| `abort` | Abort current operation | `client_id`, `reason` |
| `ready_for_greeting` | Device ready for greeting | `session_id` |
| `listen` | Push-to-talk state change | `state` (start/stop), `mode` (manual/vad) |
| `mode_change` / `mode-change` | Switch mode (conversation/music/story) | `new_mode`, `old_mode`, `is_mode_switch` |
| `character_change` / `character-change` | Switch AI character | `characterName`, `oldCharacter` |
| `playback_control` | Media playback (next/previous) | subtype: `next`, `previous` |
| `mcp` | MCP response from device | `payload.jsonrpc`, `payload.method`, `payload.params` |

### 1.3 Gateway → Device Messages (Outbound)

| Message Type | Description | Key Fields |
|-------------|-------------|------------|
| `hello_response` | Connection established | `mode`, `session_id`, `udp` (IP, port, encryption_key), `features` |
| `mode_update` | Mode change confirmed | `mode`, `listening_mode`, `character` |
| `tts` | TTS audio state | `state` (start/sentence_start/stop), `text` |
| `stt` | Speech-to-text transcript | `text`, `timestamp` |
| `emotion` | Emotion/LLM response | `text`, `emotion` |
| `llm_thinking` | LLM thinking indicator | `timestamp` |
| `error` | Error notification | `message`, `code` |
| `ready_for_greeting` | Greeting ready signal | `session_id` |

### 1.4 Outbound Calls to Manager API (Device Config)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/agent/device/{mac}/current-character` | Get current character for device |
| POST | `/agent/device/{mac}/set-character` | Set specific character |
| POST | `/agent/device/{mac}/cycle-character` | Cycle to next character |
| POST | `/config/child-profile-by-mac` | Get child profile by MAC |
| GET | `/device/{mac}/device-mode` | Get current PTT mode |
| POST | `/device/{mac}/mode-change/{newMode}` | Trigger mode change |

---

## 2. Mobile App Communication

The mobile app communicates via MQTT through the EMQX broker. Messages arrive on `internal/server-ingest` like device messages but with `source: "app"`.

### 2.1 MQTT Topics — App ↔ Gateway

| Topic | Direction | Description |
|-------|-----------|-------------|
| `internal/server-ingest` | App → Gateway | App messages (same ingest topic as devices) |
| `app/p2p/{deviceId}` | Gateway → App | Responses back to mobile app |

### 2.2 App → Gateway Messages (Inbound)

| Message Type | Description | Key Fields |
|-------------|-------------|------------|
| `function_call` | Execute MCP function (volume, play, mode switch, etc.) | `function_call.name`, `function_call.arguments`, `source: "app"` |
| `mobile_music_request` | Request specific music/story | `song_name`, `content_type`, `language` |
| `mode_change` / `mode-change` | Switch device mode from app | `new_mode`, `old_mode` |
| `character_change` / `character-change` | Switch character from app | `characterName` |
| `playback_control` | Media control from app | subtype: `next`, `previous` |

### 2.3 Gateway → App Messages (Outbound)

| Message Type | Description | Key Fields |
|-------------|-------------|------------|
| `success` | Operation success response | `message`, `action` |
| `error` | Operation error response | `message`, `code` |
| `mode_update` | Mode change confirmation | `mode`, `character` |

### 2.4 Supported Function Calls (via `function_call` message)

The app sends `function_call` messages to control the device remotely:

| Function Name | Description | Arguments |
|--------------|-------------|-----------|
| `set_volume` | Set device volume | `level` (0-100) |
| `play_music` | Play specific song | `song_name`, `language` |
| `play_story` | Play specific story | `story_name`, `language` |
| `next_track` | Skip to next track | — |
| `previous_track` | Go to previous track | — |
| `pause` | Pause playback | — |
| `resume` | Resume playback | — |
| `stop` | Stop playback | — |
| `switch_mode` | Switch device mode | `mode` (conversation/music/story) |
| `switch_character` | Switch AI character | `character_name` |

---

## 3. RFID Card Handling

When an ESP32 device scans an RFID card, the gateway looks up the card content from the Manager API and routes accordingly.

### 3.1 RFID Messages (Device → Gateway)

| Message Type | Description | Key Fields |
|-------------|-------------|------------|
| `start_greeting` | RFID card scanned (trigger greeting) | `rfid_uid`, `sequence` |
| `start_greeting_text` | RFID card scanned (text mode) | `rfid_uid`, `sequence` |
| `card_lookup` | Direct RFID card lookup | `rfid_uid` |
| `download_request` | Download card content pack | `rfid_uid`, `current_version` |
| `habit_download_request` | Download habit card content | `rfid_uid`, `current_version` |
| `rhyme_download_request` | Download rhyme card content | `rfid_uid`, `current_version` |

### 3.2 RFID Messages (Gateway → Device)

| Message Type | Description | Key Fields |
|-------------|-------------|------------|
| `download_response` | Content download manifest | `status`, `rfid_uid`, `content_type`, `files`, `version` |
| `card_unknown` | Unknown/unregistered card | `rfid_uid` |

### 3.3 Outbound Calls to Manager API (RFID)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/rfid/card/lookup/{rfidUid}` | Lookup card content by UID |
| GET | `/admin/rfid/card/content/download/{rfidUid}` | Get content download manifest |

### 3.4 RFID Content Types & Routing

When a card is looked up, the gateway routes based on `contentType`:

| Content Type | Action | Description |
|-------------|--------|-------------|
| `read_only` | Send TTS text to agent | Card text is read aloud via AI agent |
| `prompt` | Send prompt to agent | Card prompt triggers AI conversation |
| `pack` | Iterate through items | Card contains a pack of items (habits, rhymes, etc.) |
| `music` | Start music playback | Card triggers specific music |
| `story` | Start story playback | Card triggers specific story |

### 3.5 RFID Data Flow

```
ESP32 scans card
    ↓
MQTT: card_lookup { rfid_uid: "ABC123" }
    ↓
Gateway: GET /admin/rfid/card/lookup/ABC123
    ↓
Manager API returns: { contentType, title, contentText, promptText, items, audioUrl }
    ↓
┌──────────────────────────────────────────────┐
│ contentType = "read_only"                    │
│   → Send contentText as TTS to agent         │
│                                              │
│ contentType = "prompt"                       │
│   → Send promptText to agent as instruction  │
│                                              │
│ contentType = "pack"                         │
│   → Iterate items[], send each to agent      │
│                                              │
│ contentType = "music" / "story"              │
│   → Switch mode, start media bot             │
└──────────────────────────────────────────────┘
    ↓
Gateway → Device: TTS audio / mode_update / download_response
```

---

## 4. LiveKit Agent Integration

The gateway bridges ESP32 devices to LiveKit rooms where AI agents process voice.

### 4.1 Room Management (RoomServiceClient)

| Operation | Description |
|-----------|-------------|
| `createRoom({ name, empty_timeout, max_participants })` | Create room for device session |
| `removeParticipant(roomName, identity)` | Remove participant from room |
| `listRooms()` | List all active rooms |
| `listParticipants(roomName)` | List participants in room |

### 4.2 Agent Dispatch (AgentDispatchClient)

| Operation | Description |
|-----------|-------------|
| `create({ room, participant_identity, options })` | Dispatch AI agent to room |

### 4.3 Room Participation

| Operation | Description |
|-----------|-------------|
| `room.connect(url, token)` | Connect to LiveKit room |
| `room.disconnect()` | Disconnect from room |
| `localParticipant.publishTrack(track)` | Publish device audio to room |
| `localParticipant.publishData(buffer)` | Send control data to agent (PTT, MCP, etc.) |

### 4.4 Room Events Handled

| Event | Description |
|-------|-------------|
| `ParticipantConnected` | Agent joined room |
| `ParticipantDisconnected` | Agent left room |
| `TrackSubscribed` | Agent TTS audio available |
| `TrackUnsubscribed` | Agent audio removed |
| `DataReceived` | Control message from agent (tts state, stt, emotion) |
| `Disconnected` | Room disconnected |

### 4.5 Data Messages Forwarded to Agent

| Message | Direction | Description |
|---------|-----------|-------------|
| `ptt_event` | Gateway → Agent | Push-to-talk press/release |
| `mcp` | Gateway → Agent | MCP request forwarding |
| `rfid_content` | Gateway → Agent | RFID card content for TTS/prompt |
| `mode_update` | Gateway → Agent | Mode change notification |

### 4.6 Access Token

```
Identity: gateway_<mac>
Grants: roomJoin, roomCreate, canPublish, canSubscribe
Attributes: device_mac, device_uuid, room_type
```

---

## 5. Media Bot Control (Music/Story)

When the device switches to music/story mode, the gateway controls bots via the Cerebrium Media API.

**Base URL:** `${MEDIA_API_BASE}`

### 5.1 Music Bot

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/music-bot/{roomName}/start` | Start music playback |
| POST | `/music-bot/{roomName}/stop` | Stop music playback |
| POST | `/music-bot/{roomName}/next` | Next track |
| POST | `/music-bot/{roomName}/previous` | Previous track |
| POST | `/music-bot/{roomName}/pause` | Pause music |
| POST | `/music-bot/{roomName}/resume` | Resume music |

### 5.2 Story Bot

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/story-bot/{roomName}/start` | Start story playback |
| POST | `/story-bot/{roomName}/stop` | Stop story playback |
| POST | `/story-bot/{roomName}/next` | Next story |
| POST | `/story-bot/{roomName}/previous` | Previous story |
| POST | `/story-bot/{roomName}/pause` | Pause story |
| POST | `/story-bot/{roomName}/resume` | Resume story |

### 5.3 Bot Lifecycle

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/start-music-bot` | Spawn music bot for room |
| POST | `/start-story-bot` | Spawn story bot for room |
| POST | `/stop-bot` | Stop any active bot |

---

## 6. HTTP Endpoints

### 6.1 UDP Forwarder Service (Port 8000)

| Method | Endpoint | Description | Headers |
|--------|----------|-------------|---------|
| GET | `/health` | Health check | None |
| POST | `/udp/forward` | Receive forwarded UDP packets | `x-udp-source`, `x-connection-id` |

**Health Response:**
```json
{
  "status": "healthy",
  "stats": {
    "packetsReceived": 12345,
    "packetsProcessed": 12340,
    "errors": 5
  }
}
```

---

## 7. UDP Audio Protocol

### 7.1 Connection Setup

1. Device sends MQTT `hello` message
2. Gateway responds with UDP connection params:
   ```json
   {
     "udp": {
       "ip": "<PUBLIC_IP>",
       "port": 1883,
       "encryption_key": "<16-byte AES key>",
       "session_id": "<uuid>"
     }
   }
   ```
3. Device begins sending encrypted audio via UDP

### 7.2 Packet Format

| Component | Size | Description |
|-----------|------|-------------|
| IV (Header) | 16 bytes | AES initialization vector |
| Encrypted Payload | Variable | AES-128-CTR encrypted Opus audio |

### 7.3 Audio Pipeline — Inbound (Device → Agent)

```
ESP32 (Opus 16kHz, 40-60ms frames)
    ↓
UDP receive (encrypted)
    ↓
AES-128-CTR decrypt (StreamingCrypto)
    ↓
Opus decode → PCM 16kHz (Worker Pool)
    ↓
AudioFrame (Int16Array)
    ↓
LiveKit publishTrack → Agent (48kHz)
```

### 7.4 Audio Pipeline — Outbound (Agent → Device)

```
LiveKit Agent TTS (48kHz)
    ↓
AudioStream reader
    ↓
Resample 48kHz → 24kHz (AudioResampler)
    ↓
Buffer 1440 samples (60ms frame)
    ↓
Opus encode (Worker Pool)
    ↓
AES-128-CTR encrypt
    ↓
UDP send → ESP32 Device
```

---

## 8. Data Flow Diagrams

### 8.1 Device Connection (Conversation Mode)

```
ESP32                    EMQX              Gateway           Manager API        LiveKit
  │                       │                   │                  │                 │
  ├── MQTT CONNECT ──────►│                   │                  │                 │
  ├── PUBLISH hello ─────►│── republish ─────►│                  │                 │
  │                       │                   ├── GET character ─►│                 │
  │                       │                   ├── POST profile ──►│                 │
  │                       │                   ├── createRoom() ──────────────────►  │
  │                       │                   ├── dispatch() ────────────────────►  │
  │◄── hello_response ───│◄── PUBLISH ───────┤                  │                 │
  │                       │                   │                  │                 │
  ├── UDP audio ─────────────────────────────►├── publishTrack() ───────────────►  │
  │                       │                   │                  │       Agent AI   │
  │◄── UDP audio (TTS) ──────────────────────┤◄── AudioStream ─────────────────── │
```

### 8.2 Mobile App → Device Control

```
Mobile App              EMQX              Gateway              Device
  │                       │                   │                   │
  ├── function_call ─────►│── republish ─────►│                   │
  │   (source: "app")     │                   ├── route by name   │
  │                       │                   │                   │
  │   [set_volume]        │                   ├── MCP to agent ──►│
  │   [play_music]        │                   ├── start music bot  │
  │   [switch_mode]       │                   ├── mode change ───►│
  │                       │                   │                   │
  │◄── success/error ────│◄── app/p2p ───────┤                   │
```

### 8.3 RFID Card Scan

```
ESP32                    Gateway              Manager API
  │                        │                      │
  ├── card_lookup ────────►│                      │
  │  (rfid_uid)            ├── GET /rfid/lookup ──►│
  │                        │◄── card content ─────┤
  │                        │                      │
  │  [contentType=read_only]                      │
  │◄── TTS text to agent ─┤                      │
  │                        │                      │
  │  [contentType=prompt]                         │
  │◄── prompt to agent ───┤                      │
  │                        │                      │
  │  [contentType=pack]                           │
  │◄── iterate items ─────┤                      │
  │                        │                      │
  │  [contentType=music]                          │
  │◄── mode_update ───────┤── start-music-bot ──►Media API
```

### 8.4 Mode Change (Conversation → Music)

```
ESP32                    Gateway              Media API          LiveKit
  │                        │                      │                │
  ├── mode_change ────────►│                      │                │
  │                        ├── stop agent ────────────────────────►│
  │                        ├── deleteRoom() ─────────────────────►│
  │                        ├── createRoom() ─────────────────────►│
  │                        ├── /start-music-bot ──►│               │
  │◄── mode_update ───────┤                      │                │
  │◄── UDP music audio ──┤◄── music stream ─────┤                │
```

---

## Endpoint Count Summary

| Category | Type | Count |
|----------|------|-------|
| **ESP32 Device** | | |
| ├ MQTT Topics (subscribed) | MQTT | 3 |
| ├ Device → Gateway messages | MQTT | 9 |
| ├ Gateway → Device messages | MQTT | 8 |
| └ Manager API calls (device config) | HTTP outbound | 6 |
| **Mobile App** | | |
| ├ App → Gateway messages | MQTT | 5 |
| ├ Gateway → App messages | MQTT | 3 |
| └ Function call types | MQTT | 10 |
| **RFID Card** | | |
| ├ RFID messages (inbound) | MQTT | 6 |
| ├ RFID messages (outbound) | MQTT | 2 |
| ├ Manager API calls (RFID) | HTTP outbound | 2 |
| └ Content type routes | Internal | 5 |
| **LiveKit Agent** | | |
| ├ Room management ops | WebSocket | 4 |
| ├ Agent dispatch | WebSocket | 1 |
| ├ Room participation | WebSocket | 4 |
| ├ Room events handled | WebSocket | 6 |
| └ Data messages forwarded | WebSocket | 4 |
| **Media Bot** | | |
| ├ Music bot endpoints | HTTP outbound | 6 |
| ├ Story bot endpoints | HTTP outbound | 6 |
| └ Bot lifecycle | HTTP outbound | 3 |
| **HTTP** | REST | 2 |
| **UDP** | UDP | 2 |
| **Total** | | **~102** |

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MQTT_PORT` | MQTT broker port | 1883 |
| `UDP_PORT` | UDP server port | 1883 |
| `PUBLIC_IP` | Server public IP for device callbacks | 127.0.0.1 |
| `LIVEKIT_URL` | LiveKit server URL | — |
| `LIVEKIT_API_KEY` | LiveKit API key | — |
| `LIVEKIT_API_SECRET` | LiveKit API secret | — |
| `MANAGER_API_URL` | Manager API base URL | — |
| `MANAGER_API_SECRET` | Manager API auth secret | — |
| `CEREBRIUM_API_KEY` | Cerebrium auth for Media API | — |
| `MEDIA_API_BASE` | Media API base URL | — |
| `NODE_ENV` | Environment | development |
| `LOKI_HOST` | Grafana Loki endpoint | — |
