# MQTT Gateway (Go) - Product Requirements Document

## Overview

Rewrite of the Cheeko MQTT Gateway from Node.js to Go for improved scalability, lower memory footprint, and cleaner architecture. The gateway bridges ESP32 IoT devices to LiveKit AI agents by converting MQTT/UDP protocols to WebSocket, handling real-time audio transcoding (Opus encode/decode), encryption, and device lifecycle management.

**This is a drop-in replacement** — same MQTT topics, same UDP packet format, same Manager API calls, same LiveKit room behavior. Nothing upstream or downstream needs to change.

## Target Audience

Internal Cheeko engineering team. This is an infrastructure component, not user-facing.

## Core Features

### 1. MQTT Protocol Handler
- Connect to EMQX broker (MQTT 5.0)
- Subscribe to `internal/server-ingest` for all device messages
- Parse client ID format: `GID_{groupId}@@@{mac_address}@@@{uuid}`
- Publish to `devices/p2p/{clientId}` and `app/p2p/{appId}`
- Auto-reconnect with 1-second interval

### 2. UDP Audio Server
- Listen on configurable port (default 1883)
- 16-byte packet header: type(1) + reserved(1) + length(2) + connectionId(4) + timestamp(4) + sequence(4)
- AES-128-CTR encryption/decryption using session keys
- Sequence number tracking (drop out-of-order packets)
- Per-session cipher caching (LRU, max 20)

### 3. LiveKit Integration
- Room management: create, delete, list rooms via `livekit-server-sdk-go`
- Room naming: `{uuid}_{mac}_{roomType}`
- Publish device audio as `LocalAudioTrack` (16kHz mono PCM)
- Subscribe to agent audio tracks (48kHz → resample to 24kHz)
- Data channel: receive agent events (`lk.agent.events`, `lk.transcription`)
- Agent dispatch: `cheeko-agent`, `math-tutor-agent`, `riddle-solver-agent`, `word-ladder-agent`
- Agent join timeout: 30 seconds

### 4. Audio Processing Pipeline

#### Incoming (ESP32 → LiveKit):
1. UDP receive → decrypt (AES-128-CTR)
2. Entropy detection (>=6.0 = Opus, <6.0 = PCM)
3. Opus decode → 16kHz mono PCM (via goroutine per device)
4. Silence detection (amplitude < 10 → skip)
5. Frame buffering: 960 samples / 60ms frames
6. Push to LiveKit `AudioSource`

#### Outgoing (LiveKit → ESP32):
1. Subscribe to agent audio stream (48kHz)
2. Resample 48kHz → 24kHz mono
3. Frame buffering: 1440 samples / 60ms frames
4. Silence detection (amplitude < 10 → skip)
5. Opus encode → compressed (via goroutine per device)
6. Build 16-byte UDP header
7. Encrypt (AES-128-CTR) → UDP send

#### Audio Constants:
```
INCOMING_SAMPLE_RATE  = 16000 Hz
OUTGOING_SAMPLE_RATE  = 24000 Hz
CHANNELS              = 1 (mono)
FRAME_DURATION        = 60 ms
INCOMING_FRAME_SAMPLES = 960   (16000 * 60 / 1000)
OUTGOING_FRAME_SAMPLES = 1440  (24000 * 60 / 1000)
INCOMING_FRAME_BYTES   = 1920  (960 * 2)
OUTGOING_FRAME_BYTES   = 2880  (1440 * 2)
```

### 5. Device Lifecycle Management

#### Hello Sequence:
1. Receive `hello` via MQTT → extract MAC, UUID from clientId
2. Query Manager API for device mode, PTT mode, character
3. Generate session: UUID, AES key, nonce, connection ID
4. Create LiveKit room → dispatch agent (if conversation mode)
5. Send `hello` response with UDP connection details

#### Goodbye Sequence:
1. Triggered by: inactivity (2 min), max session (60 min), or device request
2. Agent sends goodbye TTS → wait for completion
3. Send `goodbye` MQTT message with reason
4. Close UDP + LiveKit connections → cleanup session

#### Mode Change:
1. Receive `mode-change` → call Manager API to update
2. Destroy old LiveKit bridge → create new room + bridge
3. Dispatch new agent (if conversation mode)
4. Send `mode_update` confirmation

#### Character Change:
1. Receive `character-change` → validate + update via Manager API
2. Destroy old bridge/room → create new session
3. Fetch child profile + memories → dispatch agent with metadata
4. Send character change confirmation

### 6. MCP (Model Context Protocol) Handler
- Bridge agent function calls to ESP32 device commands
- Agent → Gateway (LiveKit data channel) → Device (MQTT) → response back
- Supported: `self.audio_speaker.set_volume`, `mute`, `unmute`, `self.led.*`, `self.get_device_status`
- Volume debouncing: 300ms batch window
- Request tracking with auto-incrementing IDs

### 7. Media Bot Integration
- Music/Story mode: dispatch `music-bot` or `story-bot` via Cerebrium API
- Playback controls: `next`, `previous` (music + story modes)
- RFID card lookup via Manager API → trigger content playback

### 8. Connection Health & Cleanup

#### Timers:
| Timer | Interval | Purpose |
|-------|----------|---------|
| Keepalive check | 15s | Detect inactive connections |
| Ghost cleanup | 5 min | Remove orphaned rooms/sessions |
| Inactivity timeout | 2 min | Trigger goodbye for idle devices |
| Max session | 60 min | Force-close long sessions |
| Audio stuck detection | 90s | Clear stuck audio flags |
| Agent join timeout | 30s | Warn if agent doesn't join |
| Worker scale check | 10s | Auto-scale goroutine pool |

#### Ghost Cleanup Rules:
- Empty rooms > 2 min → delete
- Agent-only rooms > 5 min → delete
- Any room > 60 min → force delete
- Stale connections > 5 min → cleanup

## Tech Stack

- **Language**: Go 1.22+
- **MQTT**: `github.com/eclipse/paho.mqtt.golang` (v1.5+, MQTT 5.0)
- **Opus Codec**: `github.com/hraban/opus` (CGo bindings to libopus)
- **LiveKit SDK**: `github.com/livekit/server-sdk-go` (official Go SDK)
- **Audio Resampling**: `github.com/zaf/resample` (CGo, libsoxr) or pure Go alternative
- **UDP**: Standard library `net` package
- **Encryption**: Standard library `crypto/aes` + `crypto/cipher` (AES-128-CTR)
- **HTTP Client**: Standard library `net/http` (for Manager API calls)
- **Logging**: `log/slog` (structured logging, stdlib)
- **Configuration**: `github.com/ilyakaznacheev/cleanenv` (YAML + env vars)
- **Graceful Shutdown**: `os/signal` + `context` (stdlib)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Go Gateway                        │
│                                                      │
│  ┌─────────────┐    ┌──────────────┐                │
│  │ MQTT Handler │    │  UDP Server  │                │
│  │  (EMQX)     │    │  (port 1883) │                │
│  └──────┬──────┘    └──────┬───────┘                │
│         │                   │                        │
│         ▼                   ▼                        │
│  ┌──────────────────────────────────┐               │
│  │       Session Manager            │               │
│  │  (per-device goroutines)         │               │
│  │                                  │               │
│  │  Device 1: [mqtt] [udp] [lk]   │               │
│  │  Device 2: [mqtt] [udp] [lk]   │               │
│  │  Device N: [mqtt] [udp] [lk]   │               │
│  └──────────────┬───────────────────┘               │
│                  │                                   │
│  ┌───────────────▼──────────────────┐               │
│  │       LiveKit Client             │               │
│  │  (rooms, tracks, data channels)  │               │
│  └───────────────┬──────────────────┘               │
│                  │                                   │
│  ┌───────────────▼──────────────────┐               │
│  │       Audio Pipeline             │               │
│  │  Opus encode/decode (goroutines) │               │
│  │  Resample 48kHz ↔ 24kHz/16kHz  │               │
│  │  AES-128-CTR encrypt/decrypt     │               │
│  └──────────────────────────────────┘               │
│                                                      │
│  ┌──────────────┐  ┌───────────────┐                │
│  │ MCP Handler  │  │ Manager API   │                │
│  │ (agent↔device)│  │ Client (HTTP) │                │
│  └──────────────┘  └───────────────┘                │
│                                                      │
│  ┌──────────────────────────────────┐               │
│  │       Health & Cleanup           │               │
│  │  Keepalive | Ghost cleanup       │               │
│  │  Metrics   | Graceful shutdown   │               │
│  └──────────────────────────────────┘               │
└─────────────────────────────────────────────────────┘
```

### Key Go Design Patterns:
- **Per-device goroutines** instead of shared worker pool — no queue contention
- **Channels** for inter-goroutine communication (replacing EventEmitter)
- **`context.Context`** for cancellation propagation (replacing manual timer cleanup)
- **`sync.Pool`** for buffer reuse (reducing GC pressure)
- **Interface-based** dependencies for testability

## Data Model

### Session (per device):
```go
type Session struct {
    ID            string          // UUID
    DeviceMAC     string          // e.g., "00:16:3E:XX:XX:XX"
    ClientID      string          // MQTT client ID
    UUID          string          // Device UUID
    GroupID       string          // Device group ID
    Mode          string          // "conversation" | "music" | "story"
    Character     string          // Current character name

    // UDP
    ConnectionID  uint32
    AESKey        []byte          // 16 bytes
    AESNonce      []byte          // 16 bytes
    LocalSeq      uint32
    RemoteSeq     uint32

    // LiveKit
    Room          *lksdk.Room
    RoomName      string
    AudioSource   *lksdk.AudioSource
    AgentIdentity string

    // State
    IsEnding      bool
    IsClosing     bool
    IsAudioPlaying bool
    LastActivity  time.Time
    CreatedAt     time.Time

    // Channels
    incomingAudio chan []byte     // UDP → Opus decode → LiveKit
    outgoingAudio chan []byte     // LiveKit → Opus encode → UDP
    control       chan ControlMsg // Mode change, character change, etc.
    done          chan struct{}   // Session shutdown signal
}
```

### Configuration:
```go
type Config struct {
    Server struct {
        UDPPort   int    `yaml:"udp_port" env:"UDP_PORT" env-default:"1883"`
        PublicIP  string `yaml:"public_ip" env:"PUBLIC_IP" env-default:"127.0.0.1"`
        LogLevel  string `yaml:"log_level" env:"LOG_LEVEL" env-default:"info"`
    } `yaml:"server"`

    MQTT struct {
        Host             string `yaml:"host" env:"EMQX_HOST"`
        Port             int    `yaml:"port" env:"EMQX_PORT" env-default:"1883"`
        Protocol         string `yaml:"protocol" env:"EMQX_PROTOCOL" env-default:"mqtt"`
        Keepalive        int    `yaml:"keepalive" env-default:"60"`
        ReconnectPeriod  int    `yaml:"reconnect_period" env-default:"1000"`
        ConnectTimeout   int    `yaml:"connect_timeout" env-default:"30000"`
    } `yaml:"mqtt"`

    LiveKit struct {
        URL       string `yaml:"url" env:"LIVEKIT_URL"`
        APIKey    string `yaml:"api_key" env:"LIVEKIT_API_KEY"`
        APISecret string `yaml:"api_secret" env:"LIVEKIT_API_SECRET"`
    } `yaml:"livekit"`

    ManagerAPI struct {
        URL    string `yaml:"url" env:"MANAGER_API_URL"`
        Secret string `yaml:"secret" env:"MANAGER_API_SECRET"`
    } `yaml:"manager_api"`

    MediaAPI struct {
        BaseURL string `yaml:"base_url" env:"MEDIA_API_BASE"`
        Token   string `yaml:"token" env:"CEREBRIUM_API_TOKEN"`
    } `yaml:"media_api"`

    Mem0 struct {
        APIKey    string `yaml:"api_key" env:"MEM0_API_KEY"`
        APIURL    string `yaml:"api_url" env:"MEM0_API_URL"`
        TimeoutMs int    `yaml:"timeout_ms" env:"MEM0_TIMEOUT_MS" env-default:"15000"`
    } `yaml:"mem0"`

    Logging struct {
        LokiHost     string `yaml:"loki_host" env:"LOKI_HOST"`
        LokiUser     string `yaml:"loki_user" env:"LOKI_USER"`
        LokiPassword string `yaml:"loki_password" env:"LOKI_PASSWORD"`
    } `yaml:"logging"`
}
```

## Manager API Client

### Endpoints to implement:
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/device/{mac}/mode` | Get device mode |
| GET | `/device/{mac}/device-mode` | Get PTT mode |
| GET | `/device/{mac}/playlist/{mode}` | Get playlist |
| POST | `/device/{mac}/cycle-mode` | Cycle mode |
| GET | `/agent/device/{mac}/current-character` | Get character |
| POST | `/agent/device/{mac}/set-character` | Set character |
| POST | `/agent/device/{mac}/cycle-character` | Cycle character |
| GET | `/admin/rfid/card/lookup/{rfidUid}` | RFID lookup |
| GET | `/admin/rfid/card/content/download/{rfidUid}` | Content download |
| GET | `/config/child-profile-by-mac?macAddress={mac}` | Child profile |

### Response format:
```json
{ "code": 0, "msg": "success", "data": { ... } }
```

## MQTT Message Formats

### Hello Request (Device → Gateway):
```json
{
  "type": "hello",
  "version": 3,
  "language": "en",
  "audio_params": {},
  "features": {}
}
```

### Hello Response (Gateway → Device):
```json
{
  "type": "hello",
  "version": 3,
  "session_id": "uuid",
  "transport": "udp",
  "udp": {
    "server": "public_ip",
    "port": 1883,
    "encryption": "aes-128-ctr",
    "key": "hex_key",
    "nonce": "hex_nonce"
  },
  "audio_params": {}
}
```

### Goodbye (Gateway → Device):
```json
{
  "type": "goodbye",
  "session_id": "uuid",
  "reason": "inactivity_timeout" | "max_session_duration"
}
```

### MCP Request (Gateway → Device):
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
    "id": 123
  }
}
```

## Security Considerations

- AES-128-CTR encryption for all UDP audio packets
- Per-session encryption keys (generated on hello, never reused)
- Service-to-service auth via `MANAGER_API_SECRET` header
- LiveKit API key/secret for room management
- No direct device-to-internet path (gateway mediates all traffic)
- Cipher cache with LRU eviction (max 20 entries per direction)

## Constraints & Assumptions

- **Drop-in replacement**: Same external interfaces as Node.js version
- **CGo dependency**: Opus codec requires libopus-dev system library
- **LiveKit protocol**: Must match existing room naming and metadata format
- **EMQX compatibility**: Must work with existing EMQX broker config
- **PM2 compatible**: Initially run via PM2, later Docker/K8s
- **Single binary**: Go compiles to one binary (plus libopus shared lib)

## Success Criteria

1. **Integration tested**: ESP32 connects, audio flows bidirectionally, all modes work (conversation, music, story, games), character/mode switching works, RFID cards work
2. **Benchmarked**: Proven lower memory usage and higher device capacity vs Node.js in load tests
3. **Production deployed**: Running with real devices, handling real traffic

---

## Task List

```json
[
  {
    "category": "setup",
    "description": "Initialize Go module and project structure",
    "steps": [
      "Run go mod init github.com/Craftech360-projects/cheeko-backend/mqtt-gateway-go",
      "Create directory structure: cmd/, internal/ (config, mqtt, udp, livekit, audio, session, mcp, api, health), pkg/",
      "Add .gitignore for Go binaries",
      "Create config.yaml with all configuration fields",
      "Create Makefile with build, run, test, lint targets"
    ],
    "passes": false
  },
  {
    "category": "setup",
    "description": "Add Go dependencies and configuration loader",
    "steps": [
      "go get github.com/eclipse/paho.mqtt.golang",
      "go get github.com/hraban/opus",
      "go get github.com/livekit/server-sdk-go",
      "go get github.com/ilyakaznacheev/cleanenv",
      "Implement config struct with YAML + env var loading via cleanenv",
      "Implement structured logging with log/slog (JSON handler for prod, text for dev)",
      "Write unit tests for config loading"
    ],
    "passes": false
  },
  {
    "category": "feature",
    "description": "Implement UDP server with encryption",
    "steps": [
      "Create UDP listener on configurable port",
      "Implement 16-byte packet header parser (type, length, connectionId, timestamp, sequence)",
      "Implement AES-128-CTR encrypt/decrypt with cipher caching (LRU, max 20)",
      "Implement sequence number tracking and out-of-order packet dropping",
      "Implement session key/nonce generation for new connections",
      "Write unit tests for header parsing, encryption, sequence tracking"
    ],
    "passes": false
  },
  {
    "category": "feature",
    "description": "Implement Opus codec wrapper",
    "steps": [
      "Create Opus encoder wrapper (24kHz mono, 60ms frames, 1440 samples)",
      "Create Opus decoder wrapper (16kHz mono, 60ms frames, 960 samples)",
      "Implement per-session encoder/decoder lifecycle (create on hello, destroy on goodbye)",
      "Implement entropy detection (Shannon entropy >= 6.0 = Opus, < 6.0 = PCM)",
      "Implement silence detection (max amplitude < 10 = silent)",
      "Write unit tests for encode/decode round-trip, entropy, silence detection"
    ],
    "passes": false
  },
  {
    "category": "feature",
    "description": "Implement audio resampling",
    "steps": [
      "Implement 48kHz to 24kHz downsampling for outgoing audio (LiveKit → ESP32)",
      "Implement frame buffering: accumulate samples into 60ms frames",
      "Incoming: 960 samples (16kHz * 60ms) = 1920 bytes PCM",
      "Outgoing: 1440 samples (24kHz * 60ms) = 2880 bytes PCM",
      "Write unit tests for resampling quality and frame buffering"
    ],
    "passes": false
  },
  {
    "category": "feature",
    "description": "Implement Manager API HTTP client",
    "steps": [
      "Create HTTP client with configurable timeouts (5s default, 10s for downloads, 20s for media)",
      "Implement all endpoints: device mode, PTT mode, playlist, character, RFID, child profile",
      "Parse standard response format: {code: 0, msg, data}",
      "Implement graceful error handling: use defaults on failure (conversation mode, manual PTT)",
      "Add service auth header (secret: MANAGER_API_SECRET)",
      "Write unit tests with mock HTTP server"
    ],
    "passes": false
  },
  {
    "category": "feature",
    "description": "Implement MQTT handler",
    "steps": [
      "Connect to EMQX broker with auto-reconnect (1s interval, 30s timeout)",
      "Subscribe to internal/server-ingest topic",
      "Parse client ID: GID_{groupId}@@@{mac}@@@{uuid} (convert underscores to colons in MAC)",
      "Implement message routing: hello, goodbye, mode-change, character-change, mcp, audio controls",
      "Implement publish to devices/p2p/{clientId} and app/p2p/{appId}",
      "Write unit tests for client ID parsing and message routing"
    ],
    "passes": false
  },
  {
    "category": "feature",
    "description": "Implement LiveKit bridge",
    "steps": [
      "Create LiveKit room: name={uuid}_{mac}_{roomType}, emptyTimeout=60s, maxParticipants=2",
      "Join room as device participant (identity = MAC address)",
      "Create AudioSource (16kHz mono) and publish LocalAudioTrack",
      "Subscribe to agent audio tracks, create AudioStream (48kHz)",
      "Handle data channel: lk.agent.events (state changes), lk.transcription",
      "Implement agent dispatch via AgentDispatchClient with metadata (MAC, UUID, character, profile, memories)",
      "Implement agent join tracking with 30s timeout promise",
      "Write integration tests with mock LiveKit server"
    ],
    "passes": false
  },
  {
    "category": "feature",
    "description": "Implement session manager and device lifecycle",
    "steps": [
      "Create Session struct with all fields (UDP, LiveKit, state, channels)",
      "Implement hello sequence: parse → query API → create session → create room → dispatch agent → respond",
      "Implement goodbye sequence: TTS wait → send goodbye → close UDP + LiveKit → cleanup",
      "Implement mode change: destroy old bridge → create new room → dispatch agent → confirm",
      "Implement character change: validate → update API → new session → dispatch agent → confirm",
      "Use context.Context for per-session cancellation propagation",
      "Use sync.Map for concurrent session map access",
      "Write unit tests for lifecycle state machine"
    ],
    "passes": false
  },
  {
    "category": "feature",
    "description": "Implement full audio pipeline (incoming + outgoing)",
    "steps": [
      "Incoming: UDP recv → decrypt → entropy detect → Opus decode → silence check → frame buffer → LiveKit push",
      "Outgoing: LiveKit subscribe → resample 48→24kHz → frame buffer → silence check → Opus encode → encrypt → UDP send",
      "Use per-device goroutines (no shared worker pool)",
      "Use sync.Pool for buffer reuse (reduce GC pressure)",
      "Use channels for audio frame passing between pipeline stages",
      "Write integration test: send Opus frame in, verify PCM reaches LiveKit source"
    ],
    "passes": false
  },
  {
    "category": "feature",
    "description": "Implement MCP handler",
    "steps": [
      "Parse MCP requests from LiveKit data channel (agent → gateway)",
      "Forward as MQTT message to device: {type: mcp, payload: {jsonrpc, method, params, id}}",
      "Track pending requests with auto-incrementing ID per session",
      "Forward MCP responses from device (MQTT) back to agent (LiveKit data channel)",
      "Implement volume debouncing (300ms batch window)",
      "Cleanup pending requests on session close",
      "Write unit tests for request tracking and volume debouncing"
    ],
    "passes": false
  },
  {
    "category": "feature",
    "description": "Implement health monitoring and ghost cleanup",
    "steps": [
      "Keepalive checker: every 15s, check lastActivity, trigger goodbye if > 2 min inactive",
      "Max session enforcer: force goodbye if session > 60 min",
      "Ghost cleanup: every 5 min, delete empty rooms > 2 min, agent-only rooms > 5 min, any room > 60 min",
      "Audio stuck detection: clear isAudioPlaying if stuck > 90s",
      "Stale connection cleanup: remove sessions with no activity > 5 min",
      "Write unit tests for timer logic and cleanup rules"
    ],
    "passes": false
  },
  {
    "category": "feature",
    "description": "Implement media bot integration (music/story modes)",
    "steps": [
      "Implement Cerebrium API client for music-bot and story-bot dispatch",
      "Implement playback control forwarding: next, previous (both music + story modes)",
      "Implement RFID card lookup via Manager API → trigger content playback",
      "Handle card_unknown response for unregistered cards",
      "Write unit tests for media API client"
    ],
    "passes": false
  },
  {
    "category": "feature",
    "description": "Implement graceful shutdown",
    "steps": [
      "Use signal.NotifyContext for SIGINT/SIGTERM",
      "On shutdown: stop accepting new connections",
      "Send goodbye to all active sessions with 30s timeout",
      "Wait for all goroutines to complete (sync.WaitGroup)",
      "Close MQTT connection, UDP listener, LiveKit rooms",
      "Drain all channels before exit",
      "Write integration test for clean shutdown"
    ],
    "passes": false
  },
  {
    "category": "feature",
    "description": "Implement Loki logging integration",
    "steps": [
      "Create slog handler that ships logs to Grafana Loki",
      "Support basic auth (LOKI_USER, LOKI_PASSWORD)",
      "Batch log entries and flush periodically",
      "Fallback to stdout if Loki is unavailable",
      "Add structured fields: device_mac, session_id, room_name, mode"
    ],
    "passes": false
  },
  {
    "category": "setup",
    "description": "Create Dockerfile and deployment config",
    "steps": [
      "Create multi-stage Dockerfile: build stage (Go + CGo + libopus-dev) → runtime stage (minimal + libopus)",
      "Create docker-compose.yml for local development",
      "Add to PM2 ecosystem.config.js for initial deployment",
      "Create .env.example with all environment variables",
      "Document build instructions in README.md"
    ],
    "passes": false
  },
  {
    "category": "testing",
    "description": "End-to-end integration testing",
    "steps": [
      "Create mock ESP32 client that sends hello, audio frames, goodbye",
      "Test full audio round-trip: mock device → gateway → mock LiveKit → gateway → mock device",
      "Test mode change flow: conversation → music → story → conversation",
      "Test character change flow with Manager API mocks",
      "Test MCP flow: volume change, LED control",
      "Test ghost cleanup removes orphaned rooms",
      "Test graceful shutdown with active sessions"
    ],
    "passes": false
  },
  {
    "category": "testing",
    "description": "Load testing and benchmarking vs Node.js",
    "steps": [
      "Create load test harness: simulate N concurrent ESP32 devices",
      "Measure memory usage at 10, 50, 100, 200, 500 concurrent devices",
      "Measure audio latency (p50, p95, p99) at each scale",
      "Measure CPU usage at each scale",
      "Compare all metrics against Node.js gateway on same hardware",
      "Document results in benchmark report"
    ],
    "passes": false
  }
]
```

---

## Go Project Structure

```
main/mqtt-gateway-go/
├── cmd/
│   └── gateway/
│       └── main.go              # Entry point, wiring
├── internal/
│   ├── config/
│   │   └── config.go            # Config struct + loader
│   ├── mqtt/
│   │   ├── handler.go           # MQTT connection + message routing
│   │   └── parser.go            # Client ID parsing, message types
│   ├── udp/
│   │   ├── server.go            # UDP listener
│   │   ├── packet.go            # Header parse/build
│   │   └── crypto.go            # AES-128-CTR + cipher cache
│   ├── livekit/
│   │   ├── bridge.go            # Room management, track pub/sub
│   │   ├── dispatch.go          # Agent dispatch
│   │   └── data.go              # Data channel handling
│   ├── audio/
│   │   ├── opus.go              # Opus encode/decode wrapper
│   │   ├── resample.go          # 48kHz ↔ 24kHz
│   │   ├── pipeline.go          # Full incoming/outgoing pipeline
│   │   ├── detect.go            # Entropy + silence detection
│   │   └── buffer.go            # Frame accumulator
│   ├── session/
│   │   ├── manager.go           # Session lifecycle (hello/goodbye/mode/character)
│   │   └── session.go           # Session struct + state machine
│   ├── mcp/
│   │   └── handler.go           # MCP request/response bridge
│   ├── api/
│   │   └── manager.go           # Manager API HTTP client
│   ├── media/
│   │   └── client.go            # Cerebrium media bot API client
│   ├── health/
│   │   ├── keepalive.go         # Keepalive checker
│   │   └── cleanup.go           # Ghost room/session cleanup
│   └── logging/
│       └── loki.go              # Loki log shipper
├── config.yaml                  # Default config
├── .env.example                 # Environment variable template
├── Dockerfile                   # Multi-stage build
├── docker-compose.yml           # Local dev
├── Makefile                     # Build targets
├── go.mod
├── go.sum
├── prd.md                       # This document
└── README.md                    # Build & run instructions
```

## Agent Instructions

1. Read `activity.md` first to understand current state
2. Find next task with `"passes": false`
3. Complete all steps for that task
4. Verify compilation and tests pass
5. Update task to `"passes": true`
6. Log completion in `activity.md`
7. Repeat until all tasks pass

**Important:** Only modify the `passes` field. Do not remove or rewrite tasks.

---

## Completion Criteria
All tasks marked with `"passes": true`
