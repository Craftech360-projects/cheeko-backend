# MQTT Gateway - Architecture Overview

A Node.js gateway that bridges ESP32 IoT devices with LiveKit real-time audio infrastructure for the Cheeko AI toy.

---

## Quick Start

### Prerequisites
- Node.js 18+
- EMQX MQTT Broker
- LiveKit Server
- Cerebrium API access (for music/story bots)

### Installation
```bash
cd main/mqtt-gateway
npm install
```

### Environment Variables
Create a `.env` file:
```env
PUBLIC_IP=your.server.ip
UDP_PORT=1883
MANAGER_API_URL=http://your-api/toy
CEREBRIUM_API_TOKEN=your_cerebrium_token
```

### Configuration
Edit `config/mqtt.json`:
```json
{
  "livekit": {
    "url": "wss://your-livekit-server",
    "api_key": "your_api_key",
    "api_secret": "your_api_secret"
  },
  "mqtt_broker": {
    "protocol": "mqtt",
    "host": "your-emqx-host",
    "port": 1883
  }
}
```

### Run
```bash
node app.js
# or with PM2
pm2 start ecosystem.config.js
```

---

## Folder Structure (After Refactoring)

```
mqtt-gateway/
├── app.js                    # Entry point (~150 lines)
├── audio-worker.js           # Worker thread for Opus encoding/decoding
├── mqtt-protocol.js          # MQTT protocol parsing
│
├── constants/
│   └── audio.js              # Audio sample rates, frame sizes, durations
│
├── core/
│   ├── streaming-crypto.js   # AES-128-CTR encryption with cipher caching
│   ├── performance-monitor.js# CPU, memory, latency tracking
│   ├── worker-pool-manager.js# Worker thread pool (4-8 workers, auto-scaling)
│   ├── media-api-client.js   # Cerebrium API configuration
│   └── opus-initializer.js   # Opus codec setup
│
├── livekit/
│   ├── livekit-bridge.js     # LiveKit room connection per device
│   ├── audio-processor.js    # Opus/PCM format detection
│   ├── message-handlers.js   # TTS, STT, emotion event handlers
│   └── mcp-handler.js        # MCP protocol + volume control
│
├── mqtt/
│   ├── virtual-connection.js # Per-device MQTT session management
│   └── message-parser.js     # Hello, goodbye, abort message parsing
│
├── gateway/
│   ├── mqtt-gateway.js       # Main orchestrator class
│   ├── emqx-broker.js        # EMQX broker connection
│   ├── udp-server.js         # UDP audio server
│   ├── device-handlers.js    # Device hello, mode change handlers
│   └── playback-control.js   # Next/previous/start controls
│
├── utils/
│   ├── config-manager.js     # Config file loader with hot reload
│   ├── mqtt_config_v2.js     # MQTT credential validation
│   └── debug-logger.js       # Debug module configuration
│
├── config/
│   ├── mqtt.json             # Active configuration
│   └── mqtt.json.example     # Configuration template
│
├── audio/
│   ├── mode_change/          # PCM audio for mode switching
│   └── character_change/     # PCM audio for character changes
│
└── Documentation/            # Additional docs
```

---

## Module Descriptions

### Entry Point
| File | Responsibility |
|------|----------------|
| `app.js` | Initializes Opus codec, creates MQTTGateway, handles signals |

### Constants
| File | Responsibility |
|------|----------------|
| `constants/audio.js` | Sample rates (16kHz/24kHz), frame sizes, durations |

### Core Layer
| File | Responsibility |
|------|----------------|
| `streaming-crypto.js` | AES-128-CTR encryption/decryption with LRU cipher cache |
| `performance-monitor.js` | CPU usage, memory tracking, latency metrics |
| `worker-pool-manager.js` | 4-8 worker threads for parallel Opus processing |
| `media-api-client.js` | Cerebrium API token and axios configuration |
| `opus-initializer.js` | Initialize @discordjs/opus encoder (24kHz) and decoder (16kHz) |

### LiveKit Layer
| File | Responsibility |
|------|----------------|
| `livekit-bridge.js` | Manages LiveKit room per device, audio resampling 48kHz→24kHz |
| `audio-processor.js` | Detect Opus vs PCM format, entropy calculation |
| `message-handlers.js` | Handle TTS start/stop, STT transcription, emotions |
| `mcp-handler.js` | MCP protocol for device control, debounced volume adjustment |

### MQTT Layer
| File | Responsibility |
|------|----------------|
| `virtual-connection.js` | Per-device virtual MQTT session, UDP handling |
| `message-parser.js` | Parse hello/goodbye/abort, spawn music/story bots |

### Gateway Layer
| File | Responsibility |
|------|----------------|
| `mqtt-gateway.js` | Main orchestrator, connection tracking, LiveKit clients |
| `emqx-broker.js` | Connect to EMQX, subscribe to topics |
| `udp-server.js` | UDP audio reception and transmission |
| `device-handlers.js` | Handle device hello, mode change, character change |
| `playback-control.js` | Handle next/previous/start media controls |

---

## Data Flow

### Audio Flow: ESP32 → AI Agent → ESP32

```
┌─────────────┐      MQTT hello      ┌──────────────┐
│   ESP32     │ ──────────────────►  │   Gateway    │
│   Device    │                      │              │
└─────────────┘                      └──────────────┘
       │                                    │
       │  UDP (Opus 16kHz, encrypted)       │  Create LiveKit Room
       ▼                                    ▼
┌─────────────┐                      ┌──────────────┐
│   Gateway   │  ◄─────────────────  │   LiveKit    │
│  (Decrypt)  │                      │    Room      │
└─────────────┘                      └──────────────┘
       │                                    │
       │  Decode Opus → PCM                 │  Dispatch Agent
       ▼                                    ▼
┌─────────────┐      Audio Track     ┌──────────────┐
│  AudioSource│ ──────────────────►  │  AI Agent    │
│   16kHz     │                      │ (cheeko-agent)
└─────────────┘                      └──────────────┘
                                            │
                   Audio Track (48kHz)      │  TTS Response
                   ◄────────────────────────┘
       │
       │  Resample 48kHz → 24kHz
       │  Encode PCM → Opus
       │  Encrypt (AES-128-CTR)
       ▼
┌─────────────┐      UDP (Opus)      ┌─────────────┐
│   Gateway   │ ──────────────────►  │   ESP32     │
│             │                      │   Device    │
└─────────────┘                      └─────────────┘
```

### MQTT Message Flow

```
Device                    EMQX Broker              Gateway
   │                           │                      │
   │──── hello ───────────────►│                      │
   │     (devices/{mac}/hello) │                      │
   │                           │──── republish ──────►│
   │                           │ (internal/server-    │
   │                           │  ingest)             │
   │                           │                      │
   │                           │◄──── response ───────│
   │                           │ (devices/p2p/{mac})  │
   │◄──────────────────────────│                      │
   │                           │                      │
```

---

## Modes

The gateway supports three room types:

| Mode | Description | Bot Type |
|------|-------------|----------|
| `conversation` | AI chat with voice | LiveKit Agent (cheeko-agent) |
| `music` | Music playback | Cerebrium Music Bot |
| `story` | Story narration | Cerebrium Story Bot |

Mode is determined by querying the Manager API on device hello.

---

## Audio Parameters

| Direction | Sample Rate | Channels | Frame Duration | Format |
|-----------|-------------|----------|----------------|--------|
| ESP32 → Gateway | 16 kHz | Mono | 60 ms | Opus |
| Gateway → ESP32 | 24 kHz | Mono | 60 ms | Opus |
| LiveKit Internal | 48 kHz | Mono | 10 ms | PCM |

---

## Key Classes

### MQTTGateway
Main orchestrator that manages:
- EMQX broker connection
- UDP audio server
- Device connection tracking
- LiveKit RoomServiceClient
- AgentDispatchClient

### VirtualMQTTConnection
Per-device session that handles:
- Client ID parsing (GID@@@MAC@@@UUID)
- UDP encryption key generation
- Inactivity timeout (2 minutes)
- Mode/character switching

### LiveKitBridge
Per-room connection that manages:
- LiveKit room lifecycle
- Audio track subscription
- Frame buffering and resampling
- Agent join waiting
- MCP request tracking

### WorkerPoolManager
Thread pool for audio processing:
- 4-8 workers (auto-scaling)
- Opus encoding/decoding
- Load balancing (least-loaded selection)
- Performance monitoring

---

## Dependency Graph

```
app.js
  └── gateway/mqtt-gateway.js
        ├── gateway/emqx-broker.js
        ├── gateway/udp-server.js
        ├── gateway/device-handlers.js
        │     └── mqtt/virtual-connection.js
        │           ├── mqtt/message-parser.js
        │           ├── livekit/livekit-bridge.js
        │           │     ├── livekit/audio-processor.js
        │           │     ├── livekit/message-handlers.js
        │           │     ├── livekit/mcp-handler.js
        │           │     └── core/worker-pool-manager.js
        │           │           └── core/performance-monitor.js
        │           └── core/streaming-crypto.js
        └── gateway/playback-control.js

Shared:
  ├── constants/audio.js
  ├── core/media-api-client.js
  ├── core/opus-initializer.js
  └── utils/debug-logger.js
```

---

## MQTT Topics

| Topic | Direction | Purpose |
|-------|-----------|---------|
| `devices/+/hello` | Device → Gateway | Device connection request |
| `devices/+/data` | Device → Gateway | Device data messages |
| `internal/server-ingest` | EMQX → Gateway | Republished with client metadata |
| `devices/p2p/{mac}` | Gateway → Device | Commands to device |
| `app/p2p/{mac}` | Gateway → Mobile | Status to mobile app |

---

## MCP Protocol

The gateway implements MCP (Model Context Protocol) for device control:

```json
{
  "type": "mcp",
  "payload": {
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "self.audio_speaker.set_volume",
      "arguments": { "volume": 75 }
    },
    "id": 12345
  }
}
```

Supported tools:
- `self.audio_speaker.set_volume`
- `self.audio_speaker.mute/unmute`
- `self.get_device_status`
- `self.led.set_color`
- `self.led.set_mode`

---

## Docker Support

Build and run with Docker:

```bash
docker build -t mqtt-gateway .
docker-compose up -d
```

See `docker-compose.yml` for configuration.

---

## Troubleshooting

### Common Issues

1. **"CEREBRIUM_API_TOKEN not set"**
   - Add token to `.env` file

2. **"@discordjs/opus not available"**
   - Run `npm install @discordjs/opus`
   - May need build tools for native compilation

3. **"Room already exists"**
   - Normal behavior - room reuse is expected

4. **UDP audio not working**
   - Check `PUBLIC_IP` is correct
   - Ensure UDP port is open in firewall

### Debug Mode

Enable debug logging:
```bash
DEBUG=mqtt-server node app.js
```

---

## Refactoring Status

This document describes the **target architecture** after refactoring the monolithic `app.js` (6,963 lines) into modular files.

### Extraction Order
1. `constants/audio.js`
2. `utils/debug-logger.js`
3. `core/media-api-client.js`
4. `core/opus-initializer.js`
5. `core/streaming-crypto.js`
6. `core/performance-monitor.js`
7. `core/worker-pool-manager.js`
8. `livekit/audio-processor.js`
9. `livekit/mcp-handler.js`
10. `livekit/message-handlers.js`
11. `livekit/livekit-bridge.js`
12. `mqtt/message-parser.js`
13. `mqtt/virtual-connection.js`
14. `gateway/udp-server.js`
15. `gateway/emqx-broker.js`
16. `gateway/device-handlers.js`
17. `gateway/playback-control.js`
18. `gateway/mqtt-gateway.js`
19. Refactor `app.js` to thin entry point

---

## License

See `Documentation/LICENSE`
