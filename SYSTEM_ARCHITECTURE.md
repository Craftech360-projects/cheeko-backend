# Cheeko System Architecture & Data Flow

## Table of Contents
1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Components](#3-components)
4. [Connection Flow](#4-connection-flow)
5. [Audio Flow](#5-audio-flow)
6. [Mode Flows](#6-mode-flows)
7. [Message Reference](#7-message-reference)
8. [Error Handling](#8-error-handling)
9. [Key Files Reference](#9-key-files-reference)

---

## 1. System Overview

**Cheeko** is a multi-mode AI companion for ESP32 devices with three operational modes:

| Mode | Description | Handler |
|------|-------------|---------|
| **Conversation** | Real-time voice AI interaction | LiveKit Agent (Python) |
| **Music** | Streamed music playback from CDN | Music Bot (media_api.py) |
| **Story** | Streamed story content from CDN | Story Bot (media_api.py) |

### Tech Stack
- **Device**: ESP32 with microphone/speaker
- **Messaging**: MQTT via EMQX broker
- **Real-time Audio**: LiveKit (WebRTC)
- **AI Agent**: Python (livekit-agents SDK) on Cerebrium
- **Backend API**: Java Spring Boot (Manager API)
- **Gateway**: Node.js (mqtt-gateway)

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                    CLOUD                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │  LiveKit Cloud  │  │    Cerebrium    │  │         External APIs           │  │
│  │  (WebRTC SFU)   │  │  (Agent Host)   │  │  - Groq (LLM)                   │  │
│  │                 │  │                 │  │  - Deepgram (STT)               │  │
│  │  - Rooms       │  │  - main.py      │  │  - Edge TTS / ElevenLabs        │  │
│  │  - Tracks      │  │  - media_api.py │  │  - Mem0 (Memory)                │  │
│  │  - Data Channel│  │                 │  │  - Qdrant (Vector DB)           │  │
│  └────────┬────────┘  └────────┬────────┘  └─────────────────────────────────┘  │
│           │                    │                                                 │
└───────────┼────────────────────┼─────────────────────────────────────────────────┘
            │ WebSocket          │ HTTP/WebSocket
            │                    │
┌───────────┼────────────────────┼─────────────────────────────────────────────────┐
│           │              SERVER (VM/VPS)                                         │
│  ┌────────▼────────────────────▼────────┐  ┌─────────────────────────────────┐  │
│  │         MQTT-GATEWAY (Node.js)       │  │      MANAGER-API (Java)         │  │
│  │                                      │  │                                 │  │
│  │  ┌──────────────────────────────┐    │  │  - Device Management            │  │
│  │  │  VirtualMQTTConnection       │    │  │  - Child Profiles               │  │
│  │  │  - MQTT message handling     │    │  │  - Prompts & Characters         │  │
│  │  │  - UDP audio encryption      │    │  │  - Chat History                 │  │
│  │  │  - Mode management           │    │  │  - Analytics                    │  │
│  │  └──────────────────────────────┘    │  │  - Playlists                    │  │
│  │  ┌──────────────────────────────┐    │  │                                 │  │
│  │  │  LiveKitBridge               │    │  └─────────────────────────────────┘  │
│  │  │  - Room connection           │    │                                       │
│  │  │  - Audio track handling      │    │  ┌─────────────────────────────────┐  │
│  │  │  - Agent dispatch            │    │  │      EMQX BROKER (MQTT)         │  │
│  │  │  - Data channel messaging    │    │  │  - Device connections           │  │
│  │  └──────────────────────────────┘    │  │  - Message republishing         │  │
│  │  ┌──────────────────────────────┐    │  │  - Topic routing                │  │
│  │  │  WorkerPool (Opus codec)     │    │  └─────────────────────────────────┘  │
│  │  │  - Encode/decode audio       │    │                                       │
│  │  │  - 4-N workers (dynamic)     │    │  ┌─────────────────────────────────┐  │
│  │  └──────────────────────────────┘    │  │      REDIS                      │  │
│  └──────────────────────────────────────┘  │  - Session state                │  │
│                                            │  - Caching                      │  │
└────────────────────────────────────────────┴─────────────────────────────────────┘
            │ MQTT              │ UDP (encrypted)
            │                   │
┌───────────┼───────────────────┼──────────────────────────────────────────────────┐
│           │      DEVICE       │                                                  │
│  ┌────────▼───────────────────▼────────┐                                         │
│  │         ESP32 DEVICE                │                                         │
│  │                                     │                                         │
│  │  - Microphone input (16kHz mono)    │                                         │
│  │  - Speaker output (24kHz mono)      │                                         │
│  │  - Button for mode/interaction      │                                         │
│  │  - LED status indicators            │                                         │
│  │  - WiFi connectivity                │                                         │
│  │  - Opus codec (hardware)            │                                         │
│  └─────────────────────────────────────┘                                         │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Components

### 3.1 ESP32 Device (Firmware)
**Location**: External firmware repository

| Function | Details |
|----------|---------|
| Audio Capture | 16kHz mono, Opus encoded |
| Audio Playback | 24kHz mono, Opus decoded |
| Communication | MQTT for control, UDP for audio |
| Encryption | AES-128-CTR for UDP packets |

### 3.2 MQTT Gateway (Node.js)
**Location**: `main/mqtt-gateway/app.js`

| Class | Responsibility |
|-------|----------------|
| `VirtualMQTTConnection` | Handles MQTT messages, manages device sessions |
| `LiveKitBridge` | Connects to LiveKit rooms, handles audio tracks |
| `WorkerPool` | Opus encoding/decoding with worker threads |
| `AudioStateManager` | Tracks audio playback state |

### 3.3 LiveKit Agent (Python)
**Location**: `main/livekit-server/main.py`

| Component | Responsibility |
|-----------|----------------|
| `entrypoint()` | Main agent entry, session setup |
| `Assistant` | AI conversation handler with tools |
| `ProviderFactory` | Creates LLM, STT, TTS, VAD providers |
| `ChatHistoryService` | Stores conversation history |
| `AnalyticsService` | Tracks usage metrics |

### 3.4 Media API (Python)
**Location**: `main/livekit-server/media_api.py`

| Endpoint | Function |
|----------|----------|
| `POST /start-music-bot` | Start music bot in room |
| `POST /start-story-bot` | Start story bot in room |
| `POST /stop-bot` | Stop any bot |
| `POST /music-bot/{room}/next` | Next track |
| `POST /music-bot/{room}/previous` | Previous track |

### 3.5 Manager API (Java)
**Location**: `main/manager-api/`

| Endpoint | Function |
|----------|----------|
| `GET /toy/device/{mac}/mode` | Get device mode |
| `POST /toy/device/{mac}/cycle-mode` | Switch mode |
| `GET /toy/agent/prompt` | Get agent prompt |
| `GET /toy/child/profile/{mac}` | Get child profile |
| `POST /toy/chat/history` | Save chat history |

---

## 4. Connection Flow

### 4.1 Fresh Boot (Device Startup)

```
┌─────────┐          ┌─────────┐          ┌─────────┐          ┌─────────┐
│  ESP32  │          │  EMQX   │          │ Gateway │          │ LiveKit │
└────┬────┘          └────┬────┘          └────┬────┘          └────┬────┘
     │                    │                    │                    │
     │ 1. CONNECT         │                    │                    │
     │───────────────────>│                    │                    │
     │                    │                    │                    │
     │ 2. MQTT: hello     │                    │                    │
     │───────────────────>│ 3. Republish      │                    │
     │                    │───────────────────>│                    │
     │                    │                    │                    │
     │                    │                    │ 4. Query mode (API)│
     │                    │                    │───────────────────>│
     │                    │                    │<───────────────────│
     │                    │                    │                    │
     │                    │                    │ 5. Create room     │
     │                    │                    │───────────────────>│
     │                    │                    │<───────────────────│
     │                    │                    │                    │
     │                    │                    │ 6. Gateway joins   │
     │                    │                    │───────────────────>│
     │                    │                    │                    │
     │ 7. MQTT: hello response (UDP config)   │                    │
     │<───────────────────────────────────────│                    │
     │                    │                    │                    │
     │ 8. MQTT: mode_update                   │                    │
     │<───────────────────────────────────────│                    │
     │                    │                    │                    │
     │ 9. MQTT: ready_for_greeting            │                    │
     │<───────────────────────────────────────│                    │
     │                    │                    │                    │
     │ 10. UDP: First packet (establish)      │                    │
     │───────────────────────────────────────>│                    │
     │                    │                    │                    │
```

### 4.2 Start Agent (Button Press)

```
┌─────────┐          ┌─────────┐          ┌─────────┐          ┌─────────┐
│  ESP32  │          │ Gateway │          │ LiveKit │          │  Agent  │
└────┬────┘          └────┬────┘          └────┬────┘          └────┬────┘
     │                    │                    │                    │
     │ 1. MQTT: playback_control              │                    │
     │    action=start_agent                  │                    │
     │───────────────────>│                    │                    │
     │                    │                    │                    │
     │                    │ 2. Check if agent in room              │
     │                    │───────────────────>│                    │
     │                    │<───────────────────│                    │
     │                    │                    │                    │
     │                    │ 3. Dispatch agent (if needed)          │
     │                    │───────────────────>│                    │
     │                    │                    │ 4. Agent joins     │
     │                    │                    │<───────────────────│
     │                    │                    │                    │
     │                    │ 5. Data channel: start_greeting        │
     │                    │───────────────────────────────────────>│
     │                    │                    │                    │
     │                    │                    │ 6. Agent speaks    │
     │                    │<───────────────────────────────────────│
     │                    │                    │                    │
     │ 7. MQTT: tts state=start               │                    │
     │<───────────────────│                    │                    │
     │                    │                    │                    │
     │ 8. UDP: Audio packets                  │                    │
     │<───────────────────│                    │                    │
     │                    │                    │                    │
```

### 4.3 Mode Switch

```
┌─────────┐          ┌─────────┐          ┌─────────┐          ┌─────────┐
│  ESP32  │          │ Gateway │          │ LiveKit │          │MediaAPI │
└────┬────┘          └────┬────┘          └────┬────┘          └────┬────┘
     │                    │                    │                    │
     │ 1. MQTT: mode-change                   │                    │
     │───────────────────>│                    │                    │
     │                    │                    │                    │
     │                    │ 2. Clear audio buffers                 │
     │                    │────────────────────│                    │
     │                    │                    │                    │
     │                    │ 3. Stop old bot    │                    │
     │                    │───────────────────────────────────────>│
     │                    │<───────────────────────────────────────│
     │                    │                    │                    │
     │                    │ 4. Delete old room │                    │
     │                    │───────────────────>│                    │
     │                    │<───────────────────│                    │
     │                    │                    │                    │
     │                    │ 5. Update mode (API)                   │
     │                    │────────────────────│                    │
     │                    │                    │                    │
     │                    │ 6. Create new room │                    │
     │                    │───────────────────>│                    │
     │                    │<───────────────────│                    │
     │                    │                    │                    │
     │                    │ 7. Gateway joins new room              │
     │                    │───────────────────>│                    │
     │                    │                    │                    │
     │                    │ 8. Start new bot   │                    │
     │                    │───────────────────────────────────────>│
     │                    │                    │                    │
     │ 9. MQTT: mode_update (new UDP config)  │                    │
     │<───────────────────│                    │                    │
     │                    │                    │                    │
```

---

## 5. Audio Flow

### 5.1 Incoming Audio (ESP32 → Agent)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        INCOMING AUDIO PIPELINE                                │
└──────────────────────────────────────────────────────────────────────────────┘

ESP32 Microphone (16kHz mono PCM)
         │
         ▼
┌─────────────────┐
│  Opus Encoder   │  (ESP32 hardware)
│  60ms frames    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  AES-128-CTR    │  Encrypt with session key
│  Encryption     │
└────────┬────────┘
         │
         ▼ UDP Packet (16-byte header + encrypted payload)
         │
┌────────▼────────┐
│  MQTT-GATEWAY   │
│                 │
│  1. Decrypt     │  AES-128-CTR with session key
│  2. Worker Pool │  Opus decode → PCM (16kHz)
│  3. Forward     │  To LiveKit room
└────────┬────────┘
         │
         ▼ LiveKit Audio Track (16kHz mono)
         │
┌────────▼────────┐
│  LIVEKIT CLOUD  │
│                 │
│  WebRTC SFU     │  Routes to agent
└────────┬────────┘
         │
         ▼
┌────────▼────────┐
│  PYTHON AGENT   │
│                 │
│  1. VAD         │  Silero (voice detection)
│  2. STT         │  Deepgram/Groq (transcription)
│  3. LLM         │  Groq (response generation)
└─────────────────┘
```

### 5.2 Outgoing Audio (Agent → ESP32)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        OUTGOING AUDIO PIPELINE                                │
└──────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐
│  PYTHON AGENT   │
│                 │
│  1. LLM         │  Generate text response
│  2. TTS         │  Edge TTS / ElevenLabs
│  3. Output      │  48kHz mono PCM
└────────┬────────┘
         │
         ▼ LiveKit Audio Track (48kHz mono)
         │
┌────────▼────────┐
│  LIVEKIT CLOUD  │
│                 │
│  WebRTC SFU     │  Routes to gateway
└────────┬────────┘
         │
         ▼
┌────────▼────────┐
│  MQTT-GATEWAY   │
│                 │
│  1. Resample    │  48kHz → 24kHz
│  2. Buffer      │  Accumulate 60ms frames
│  3. Worker Pool │  PCM → Opus encode
│  4. Encrypt     │  AES-128-CTR
└────────┬────────┘
         │
         ▼ UDP Packet (16-byte header + encrypted payload)
         │
┌────────▼────────┐
│  ESP32 DEVICE   │
│                 │
│  1. Decrypt     │  AES-128-CTR
│  2. Opus Decode │  Hardware decoder
│  3. Play        │  24kHz mono speaker
└─────────────────┘
```

### 5.3 Audio Specifications

| Direction | Sample Rate | Channels | Format | Frame Duration |
|-----------|-------------|----------|--------|----------------|
| ESP32 → Agent | 16,000 Hz | 1 (mono) | Opus | 60ms |
| Agent → ESP32 | 24,000 Hz | 1 (mono) | Opus | 60ms |
| LiveKit Internal | 48,000 Hz | 1 (mono) | PCM | 20ms |

### 5.4 UDP Packet Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                    UDP PACKET (encrypted)                        │
├─────────────────┬───────────────────────────────────────────────┤
│  Header (16B)   │            Encrypted Payload                   │
├─────────────────┼───────────────────────────────────────────────┤
│  Bytes 0-3:     │                                               │
│    Reserved     │  Opus-encoded audio frame                     │
│  Bytes 4-7:     │  (variable length, typically 100-300 bytes)   │
│    Timestamp    │                                               │
│  Bytes 8-11:    │  Encrypted with:                              │
│    Reserved     │  - Algorithm: AES-128-CTR                     │
│  Bytes 12-15:   │  - Key: 16 bytes (from hello response)        │
│    Sequence#    │  - IV: Header itself (16 bytes)               │
└─────────────────┴───────────────────────────────────────────────┘
```

---

## 6. Mode Flows

### 6.1 Conversation Mode

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         CONVERSATION MODE FLOW                                │
└──────────────────────────────────────────────────────────────────────────────┘

User speaks → ESP32 captures audio
                    │
                    ▼
            ┌───────────────┐
            │  UDP Audio    │  To mqtt-gateway
            └───────┬───────┘
                    │
                    ▼
            ┌───────────────┐
            │  LiveKit Room │  Room: {uuid}_{mac}_conversation
            └───────┬───────┘
                    │
                    ▼
            ┌───────────────┐
            │  VAD (Silero) │  Detect speech start/end
            └───────┬───────┘
                    │
                    ▼
            ┌───────────────┐
            │  STT          │  Deepgram Nova-3 / Groq Whisper
            │  Transcribe   │  "Play some music"
            └───────┬───────┘
                    │
                    ▼
            ┌───────────────┐
            │  LLM (Groq)   │  Llama 3.1 / GPT-4o-mini
            │  + Tools      │
            └───────┬───────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
┌───────────────┐       ┌───────────────┐
│  Text Reply   │       │  Tool Call    │
│               │       │  play_music() │
└───────┬───────┘       └───────┬───────┘
        │                       │
        ▼                       ▼
┌───────────────┐       ┌───────────────┐
│  TTS          │       │  Mode Switch  │
│  Edge/11Labs  │       │  via Gateway  │
└───────┬───────┘       └───────────────┘
        │
        ▼
┌───────────────┐
│  Audio Output │  Via LiveKit → Gateway → UDP → ESP32
└───────────────┘
```

### 6.2 Music Mode

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            MUSIC MODE FLOW                                    │
└──────────────────────────────────────────────────────────────────────────────┘

Mode activated → Gateway starts Music Bot
                        │
                        ▼
                ┌───────────────┐
                │  Music Bot    │  Joins room: {uuid}_{mac}_music
                │  (media_api)  │
                └───────┬───────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│  Playlist     │ │  Random Song  │ │  Search       │
│  from DB      │ │  by Language  │ │  by Query     │
└───────┬───────┘ └───────┬───────┘ └───────┬───────┘
        │               │               │
        └───────────────┴───────────────┘
                        │
                        ▼
                ┌───────────────┐
                │  Qdrant       │  Vector search for songs
                │  (if search)  │
                └───────┬───────┘
                        │
                        ▼
                ┌───────────────┐
                │  CDN Download │  CloudFront / S3
                │  MP3 file     │
                └───────┬───────┘
                        │
                        ▼
                ┌───────────────┐
                │  FFmpeg       │  MP3 → PCM (48kHz mono)
                │  Conversion   │
                └───────┬───────┘
                        │
                        ▼
                ┌───────────────┐
                │  Stream to    │  20ms frames to LiveKit
                │  LiveKit      │
                └───────┬───────┘
                        │
                        ▼
                ┌───────────────┐
                │  Gateway      │  Resample 48→24kHz, encode Opus
                └───────┬───────┘
                        │
                        ▼
                ┌───────────────┐
                │  ESP32        │  Play audio
                └───────────────┘

CONTROLS:
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│    NEXT      │  │   PREVIOUS   │  │    STOP      │
│  (button)    │  │   (button)   │  │ (mode-change)│
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       ▼                 ▼                 ▼
  POST /next        POST /previous    POST /stop-bot
```

### 6.3 Story Mode

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            STORY MODE FLOW                                    │
└──────────────────────────────────────────────────────────────────────────────┘

Mode activated → Gateway starts Story Bot
                        │
                        ▼
                ┌───────────────┐
                │  Story Bot    │  Joins room: {uuid}_{mac}_story
                │  (media_api)  │
                └───────┬───────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│  By Category  │ │  Random Story │ │  By Age Group │
│  (adventure)  │ │               │ │  (3-5 years)  │
└───────┬───────┘ └───────┬───────┘ └───────┬───────┘
        │               │               │
        └───────────────┴───────────────┘
                        │
                        ▼
                ┌───────────────┐
                │  Qdrant       │  Vector search for stories
                │  (if search)  │
                └───────┬───────┘
                        │
                        ▼
                ┌───────────────┐
                │  CDN Download │  CloudFront / S3
                │  Audio file   │
                └───────┬───────┘
                        │
                        ▼
                (Same streaming flow as Music Mode)
```

---

## 7. Message Reference

### 7.1 MQTT Messages (Device ↔ Gateway)

#### Device → Gateway (via internal/server-ingest)

```json
// Hello (Session Init)
{
  "sender_client_id": "GID_test@@@68_25_dd_ba_fb_44@@@uuid",
  "orginal_payload": {
    "type": "hello",
    "version": 3,
    "transport": "udp",
    "language": "en",
    "features": { "mcp": true },
    "audio_params": {
      "format": "opus",
      "sample_rate": 16000,
      "channels": 1,
      "frame_duration": 60
    }
  }
}

// Playback Control - Start Agent
{
  "sender_client_id": "GID_test@@@68_25_dd_ba_fb_44@@@uuid",
  "orginal_payload": {
    "type": "playback_control",
    "action": "start_agent",
    "session_id": "abc123_6825ddbafb44_conversation"
  }
}

// Playback Control - Next/Previous
{
  "sender_client_id": "...",
  "orginal_payload": {
    "type": "playback_control",
    "action": "next" | "previous",
    "session_id": "..."
  }
}

// Mode Change
{
  "sender_client_id": "...",
  "orginal_payload": {
    "type": "mode-change",
    "session_id": "..."
  }
}

// Goodbye
{
  "sender_client_id": "...",
  "orginal_payload": {
    "type": "goodbye",
    "session_id": "..."
  }
}

// Abort (Stop current operation)
{
  "sender_client_id": "...",
  "orginal_payload": {
    "type": "abort",
    "session_id": "..."
  }
}
```

#### Gateway → Device (via devices/p2p/{clientId})

```json
// Hello Response
{
  "type": "hello",
  "version": 3,
  "mode": "conversation",
  "character": "Cheeko",
  "session_id": "abc123_6825ddbafb44_conversation",
  "timestamp": 1234567890,
  "transport": "udp",
  "udp": {
    "server": "139.59.7.72",
    "port": 8884,
    "encryption": "aes-128-ctr",
    "key": "b183ba9963fee353a92b8d5e3a6a910b",
    "nonce": "01000000ec32eb9c0000000000000000",
    "connection_id": 3962760092,
    "cookie": 3962760092
  },
  "audio_params": {
    "sample_rate": 24000,
    "channels": 1,
    "frame_duration": 60,
    "format": "opus"
  }
}

// Mode Update
{
  "type": "mode_update",
  "mode": "conversation" | "music" | "story",
  "character": "Cheeko",
  "session_id": "...",
  "timestamp": 1234567890
}

// Ready for Greeting
{
  "type": "ready_for_greeting",
  "session_id": "...",
  "timestamp": 1234567890
}

// TTS State
{
  "type": "tts",
  "state": "start" | "stop",
  "session_id": "..."
}

// Error
{
  "type": "error",
  "code": "AGENT_DISPATCH_FAILED",
  "message": "Failed to dispatch agent"
}

// Goodbye Acknowledgment
{
  "type": "goodbye",
  "session_id": "..."
}
```

### 7.2 LiveKit Data Channel Messages

#### Gateway → Agent

```json
// Start Greeting
{
  "type": "start_greeting",
  "session_id": "abc123_6825ddbafb44_conversation",
  "is_mode_switch": false,
  "timestamp": 1234567890
}

// Disconnect Agent
{
  "type": "disconnect_agent",
  "session_id": "..."
}
```

#### Agent → Gateway

```json
// Emotion
{
  "type": "emotion",
  "emotion": "happy" | "confused" | "thinking" | "excited",
  "session_id": "..."
}

// Function Call (to music/story bot)
{
  "type": "function_call",
  "function_call": {
    "name": "play_music" | "next_song" | "play_story",
    "arguments": {
      "song_name": "...",
      "language": "en"
    }
  }
}
```

### 7.3 Manager API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/toy/device/{mac}/mode` | Get current device mode |
| POST | `/toy/device/{mac}/cycle-mode` | Switch to next mode |
| GET | `/toy/agent/prompt?mac={mac}` | Get agent prompt & TTS config |
| GET | `/toy/child/profile/mac/{mac}` | Get child profile |
| POST | `/toy/chat/history` | Save chat history |
| GET | `/toy/agent/{mac}` | Get agent ID for device |
| GET | `/toy/device/{mac}/character` | Get current character |
| POST | `/toy/analytics/session/start` | Start analytics session |
| POST | `/toy/analytics/session/end` | End analytics session |

---

## 8. Error Handling

### 8.1 Agent Errors

```python
# Error types handled in main.py
- STT errors → Fallback to secondary STT provider
- LLM errors → Fallback to secondary LLM model
- TTS errors → Fallback to Edge TTS
- Memory errors → Continue without memory
- API timeouts → Default values used
```

### 8.2 Gateway Errors

```javascript
// Error handling in app.js
- MQTT connection lost → Auto-reconnect
- LiveKit room error → Retry with backoff
- Agent dispatch timeout → Send error to device
- UDP packet loss → Sequence tracking
- Worker pool timeout → Reject and continue
```

### 8.3 Recovery Flows

```
┌─────────────────────────────────────────────────────────────────┐
│                    ERROR RECOVERY FLOWS                          │
└─────────────────────────────────────────────────────────────────┘

1. Agent Not Responding (30s timeout)
   └─> Gateway sends end_prompt
       └─> Wait 30s
           └─> Close session
               └─> Device reconnects with hello

2. Network Disconnection
   └─> ESP32 detects UDP timeout
       └─> ESP32 sends new hello
           └─> Gateway creates new session

3. Mode Switch Failure
   └─> Stop old bot fails
       └─> Continue anyway
           └─> Create new room
               └─> Spawn new bot

4. Agent Dispatch Failure
   └─> Retry 3 times with backoff
       └─> If still fails, send error to device
           └─> Device can retry with start_agent
```

---

## 9. Key Files Reference

### 9.1 MQTT Gateway

| File | Purpose |
|------|---------|
| `main/mqtt-gateway/app.js` | Main gateway server |
| `main/mqtt-gateway/config/mqtt.json` | MQTT/LiveKit config |
| `main/mqtt-gateway/.env` | Environment variables |

**Key Functions in app.js:**

| Function | Line | Purpose |
|----------|------|---------|
| `parseHelloMessage()` | 3494 | Handle device hello, create room |
| `handleStartAgentControl()` | 5589 | Dispatch agent on button press |
| `handleDeviceModeChange()` | 6385 | Switch between modes |
| `handleNextControl()` | 5245 | Next track in music/story |
| `handlePreviousControl()` | 5420 | Previous track |
| `onAudioFrame()` | 1736 | Process incoming LiveKit audio |
| `onUdpMessage()` | 4200 | Process incoming UDP audio |

### 9.2 LiveKit Agent

| File | Purpose |
|------|---------|
| `main/livekit-server/main.py` | Agent entrypoint |
| `main/livekit-server/media_api.py` | Music/story bot API |
| `main/livekit-server/src/agent/main_agent.py` | Assistant class |
| `main/livekit-server/src/providers/` | LLM/STT/TTS providers |
| `main/livekit-server/src/services/` | Music, story, analytics |
| `main/livekit-server/.env` | Environment variables |

**Key Functions in main.py:**

| Function | Line | Purpose |
|----------|------|---------|
| `prewarm()` | 256 | Preload models (VAD, embeddings) |
| `entrypoint()` | 291 | Main agent setup |
| `cleanup_room_and_session()` | 848 | Cleanup on disconnect |
| `on_data_received()` | 1023 | Handle data channel messages |

### 9.3 Manager API

| Path | Purpose |
|------|---------|
| `main/manager-api/src/main/java/xiaozhi/modules/device/` | Device management |
| `main/manager-api/src/main/java/xiaozhi/modules/agent/` | Agent prompts |
| `main/manager-api/src/main/java/xiaozhi/modules/content/` | Playlists |

### 9.4 Configuration Files

| File | Contains |
|------|----------|
| `main/mqtt-gateway/.env` | MQTT, LiveKit, Manager API URLs |
| `main/livekit-server/.env` | All API keys, provider configs |
| `main/mqtt-gateway/config/mqtt.json` | MQTT broker settings |

---

## 10. Quick Reference: Room Name Format

```
{UUID}_{MAC_WITHOUT_COLONS}_{MODE}

Examples:
- abc123-def456_6825ddbafb44_conversation
- xyz789-uvw012_6825ddbafb44_music
- qrs345-mno678_6825ddbafb44_story

Parsing:
parts = room_name.split('_')
uuid = parts[0]        # First part
mac = parts[-2]        # Second to last
mode = parts[-1]       # Last part (conversation/music/story)
```

---

## 11. Quick Reference: Client ID Format

```
{GROUP_ID}@@@{MAC_WITH_UNDERSCORES}@@@{UUID}

Example:
GID_test@@@68_25_dd_ba_fb_44@@@c71ff444-2c41-46b8-8353-fe1f64d02144

Parsing:
parts = client_id.split('@@@')
group_id = parts[0]    # "GID_test"
mac = parts[1]         # "68_25_dd_ba_fb_44" → convert to "68:25:dd:ba:fb:44"
uuid = parts[2]        # Session UUID
```

---

*Document generated for Cheeko ESP32 Server Project*
