---
id: overview
sidebar_position: 1
---

# MQTT Gateway Overview

![MQTT Gateway](/img/gateway-header.jpeg)

The MQTT Gateway is a Node.js protocol bridge that sits between ESP32 Cheeko devices and the LiveKit WebRTC cloud. Devices communicate using MQTT over TCP and raw UDP; the gateway translates those into LiveKit room connections and WebRTC audio tracks so the AI agents running in `livekit-server` can talk to children in real time.

**MQTT (control messages)**
```
ESP32 Device ──publish──► EMQX Broker ──republish──► internal/server-ingest ──► MQTTGateway
ESP32 Device ◄──subscribe── EMQX Broker ◄──publish── devices/p2p/<clientId> ◄── MQTTGateway
                                            (gateway sends directly, no republish)
```

**UDP (audio)**
```
ESP32 Device ◄──► MQTTGateway  (AES-128-CTR encrypted Opus, bidirectional)
```

**Per-device internal structure**
```
MQTTGateway
  └── VirtualMQTTConnection  (one per connected device)
        ├── LiveKitBridge ──► LiveKit Cloud Room ◄──► AI Agent (livekit-server)
        └── UDP crypto layer ◄──► ESP32 Device (encrypted audio)
```

---

## Module Layer Table

| Layer | Directory | Files | Responsibility |
|---|---|---|---|
| Entry point | `/` | `app.js` | Environment validation, Opus init, `MQTTGateway` startup, signal handlers |
| Gateway | `gateway/` | `mqtt-gateway.js` | Main orchestrator; EMQX connection, UDP socket, per-device lifecycle |
| Gateway | `gateway/` | `device-handlers.js` | Hello/goodbye/mode-change/character-change handler helpers |
| Gateway | `gateway/` | `emqx-broker.js` | Standalone `EmqxBroker` class with wildcard topic matching |
| Gateway | `gateway/` | `udp-server.js` | `UdpServer` class; AES-128-CTR encrypted send |
| Gateway | `gateway/` | `udp-forwarder.js` | UDP forwarding utilities |
| Gateway | `gateway/` | `playback-control.js` | Next/previous track control helpers |
| LiveKit | `livekit/` | `livekit-bridge.js` | Per-device `LiveKitBridge`; room creation, agent dispatch, audio forwarding |
| LiveKit | `livekit/` | `audio-processor.js` | Entropy-based Opus/PCM detection, silence checking, frame validation |
| LiveKit | `livekit/` | `message-handlers.js` | `MessageHandlers`; TTS start/stop, STT, emotion, LLM-thinking MQTT messages |
| LiveKit | `livekit/` | `mcp-handler.js` | `McpHandler`; MCP JSON-RPC request/response, volume debouncing |
| MQTT | `mqtt/` | `message-parser.js` | Parsing helpers for hello/goodbye/abort/mode-change/character-change |
| MQTT | `mqtt/` | `virtual-connection.js` | `VirtualMQTTConnection`; per-device MQTT session state, UDP crypto, bridge lifecycle |
| MQTT | `/` | `mqtt-protocol.js` | Raw MQTT 3.1.1 parser/encoder (CONNECT, PUBLISH, SUBSCRIBE, PINGREQ, DISCONNECT) |
| Core | `core/` | `opus-initializer.js` | `@discordjs/opus` encoder/decoder init |
| Core | `core/` | `worker-pool-manager.js` | `WorkerPoolManager`; 4–8 worker threads for audio encoding/decoding |
| Core | `core/` | `media-api-client.js` | Cerebrium API base URL and axios config for music/story bots |
| Core | `core/` | `mem0-client.js`, `mem0-integration.js` | Mem0 long-term memory fetch for agent dispatch metadata |
| Core | `/` | `audio-worker.js` | Worker thread; Opus encode/decode per session |
| Constants | `constants/` | `audio.js` | Sample rates, frame sizes, channel count |
| Utils | `utils/` | `config-manager.js` | JSON config file loader (`mqtt.json`) |
| Utils | `utils/` | `logger.js` | Pino/Winston logger |
| Utils | `utils/` | `debug-logger.js`, `console-override.js` | Debug namespace setup |

---

## Connection Lifecycle

### 1. Device connects

The ESP32 connects to the **EMQX broker** via MQTT/TCP. The gateway does **not** receive device connections directly — EMQX republishes all device messages to the `internal/server-ingest` topic, which the gateway subscribes to.

The device's MQTT client ID uses the format:

```
GID_test@@@68_25_dd_bb_f3_a0@@@<uuid>
```

Where the three parts separated by `@@@` are the group ID, MAC address (underscores instead of colons), and a UUID.

### 2. Hello message received

EMQX republishes all device messages to `internal/server-ingest`. The gateway receives the message, extracts the MAC address from the client ID, and calls `handleDeviceHello`.

`handleDeviceHello` creates two objects stored in `MQTTGateway`:

| Map | Key | Value |
|---|---|---|
| `connections` | `connectionId` (random 32-bit int) | `VirtualMQTTConnection` instance |
| `deviceConnections` | device MAC address | `{ connectionId, connection }` |

### 3. Fast hello response (< 50 ms)

`VirtualMQTTConnection.parseHelloMessage` immediately:
- Generates a 16-byte AES key (`crypto.randomBytes(16)`) and a 16-byte nonce (from `generateUdpHeader`)
- Generates a `session_id` in the format `<uuid>_<mac>_<roomType>` (default room type: `conversation`)
- Sends a `hello` response back via MQTT on `devices/p2p/<fullClientId>` with UDP connection parameters

### 4. Deferred setup (background)

While the device starts streaming audio, the gateway runs parallel DB queries to fetch:
- Room type (`conversation` / `music` / `story`)
- PTT mode (`auto` / `manual`)
- Current character (e.g., `Cheeko`, `Math Tutor`)
- Child profile
- Mem0 long-term memories

After queries complete it:
1. Sends a `mode_update` MQTT message with the actual values
2. Creates a `LiveKitBridge` and connects to a LiveKit room named `<uuid>_<mac>_<roomType>`
3. Dispatches the appropriate AI agent via `AgentDispatchClient`

### 5. Audio streaming

UDP packets arrive at `MQTTGateway.onUdpMessage`. The 16-byte header is parsed to extract the `connectionId`, which looks up the `VirtualMQTTConnection`. The connection decrypts the payload and forwards decoded PCM audio to LiveKit. Audio coming back from LiveKit is encoded to Opus and sent as encrypted UDP to the device.

### 6. Cleanup

When a `goodbye` message is received (or an inactivity timeout fires), `VirtualMQTTConnection.parseOtherMessage` notifies the agent via a LiveKit data channel `disconnect_agent` message, then closes the `LiveKitBridge`. The entries are removed from both gateway maps. Ghost room cleanup also runs every 5 minutes to remove any LiveKit rooms that are empty, have only agents (no device), or are older than 60 minutes.

---

## Key Data Structures

### VirtualMQTTConnection

One instance per connected device, stored in `MQTTGateway.connections`.

| Field | Type | Description |
|---|---|---|
| `deviceId` | string | Device MAC address (`aa:bb:cc:dd:ee:ff`) |
| `connectionId` | number | Random 32-bit integer, used as UDP cookie |
| `macAddress` | string | Colon-separated MAC |
| `groupId` | string | First segment of MQTT client ID |
| `uuid` | string | Third segment of MQTT client ID |
| `bridge` | `LiveKitBridge` | LiveKit room bridge (null until deferred setup completes) |
| `roomType` | string | `conversation`, `music`, or `story` |
| `udp.key` | Buffer | 16-byte AES-128 encryption key |
| `udp.nonce` | Buffer | 16-byte AES-128-CTR IV |
| `udp.encryption` | string | Always `"aes-128-ctr"` |
| `udp.session_id` | string | LiveKit room name |
| `udp.remoteAddress` | Object | `{ address, port }` of device UDP endpoint |
| `lastActivityTime` | number | Unix ms; used for 2-minute inactivity timeout |
| `sessionStartTime` | number | Unix ms; max session duration 60 minutes |

### LiveKitBridge

One instance per active device session, held by `VirtualMQTTConnection.bridge`.

Connects the gateway as a participant in the LiveKit room, publishes device audio as a track, subscribes to agent audio tracks, and routes data channel messages in both directions.

---

## Running

```bash
cd main/mqtt-gateway
npm install
node app.js
```

---

## Configuration File (`config/mqtt.json`)

The gateway reads MQTT broker and LiveKit credentials from `config/mqtt.json`. The `ConfigManager` watches this file for live-reload — changes take effect without restarting the process.

```json
{
  "debug": false,
  "mqtt_broker": {
    "host": "YOUR_EMQX_HOST",
    "port": 1883,
    "protocol": "mqtt",
    "keepalive": 60,
    "clean": true,
    "reconnectPeriod": 1000,
    "connectTimeout": 30000
  },
  "livekit": {
    "url": "wss://your-project.livekit.cloud",
    "api_key": "YOUR_LIVEKIT_API_KEY",
    "api_secret": "YOUR_LIVEKIT_API_SECRET"
  }
}
```

| Field | Description |
|-------|-------------|
| `debug` | Enable verbose debug logging |
| `mqtt_broker.host` | EMQX broker hostname or IP |
| `mqtt_broker.port` | EMQX broker port (default 1883) |
| `mqtt_broker.protocol` | `mqtt` (plain) or `mqtts` (TLS) |
| `mqtt_broker.keepalive` | MQTT keepalive interval in seconds |
| `mqtt_broker.clean` | Start with a clean MQTT session |
| `mqtt_broker.reconnectPeriod` | Auto-reconnect interval in ms |
| `mqtt_broker.connectTimeout` | Connection timeout in ms |
| `livekit.url` | LiveKit Cloud WebSocket URL |
| `livekit.api_key` | LiveKit API key |
| `livekit.api_secret` | LiveKit API secret |

Environment variables (`EMQX_HOST`, `LIVEKIT_URL`, etc.) override the corresponding `mqtt.json` values when set.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `UDP_PORT` | `1883` | UDP port for device audio streaming |
| `PUBLIC_IP` | `127.0.0.1` | Public IP address returned to devices in hello response |
| `EMQX_HOST` | (from `mqtt.json`) | EMQX broker hostname |
| `EMQX_PORT` | (from `mqtt.json`) | EMQX broker port |
| `EMQX_PROTOCOL` | (from `mqtt.json`) | MQTT protocol (`mqtt`, `mqtts`) |
| `LIVEKIT_URL` | (from `mqtt.json`) | LiveKit server WebSocket URL |
| `LIVEKIT_API_KEY` | (from `mqtt.json`) | LiveKit API key |
| `LIVEKIT_API_SECRET` | (from `mqtt.json`) | LiveKit API secret |
| `MANAGER_API_URL` | — | Base URL for manager API, e.g. `http://localhost:3000/toy` |
| `MANAGER_API_SECRET` | — | Secret header value for internal manager API calls |
| `MEDIA_API_BASE` | Cerebrium endpoint | Base URL for music/story bot API |
| `CEREBRIUM_API_TOKEN` | — | **Required.** Bearer token for Cerebrium API. Process exits if unset. |
| `LOKI_HOST` | — | Optional Grafana Loki host for centralized logging |
