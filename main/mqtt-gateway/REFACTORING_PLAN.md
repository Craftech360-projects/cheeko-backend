# MQTT Gateway Refactoring Plan

## Executive Summary

This document outlines the plan to split the monolithic `app.js` file (~6,579 lines, ~222KB) into well-organized, maintainable modules.

---

## 1. Current State Analysis

### 1.1 File Statistics
- **File**: `app.js`
- **Total Lines**: 6,579
- **File Size**: ~222KB
- **Classes**: 6 major classes
- **Complexity**: High - single file handles MQTT, UDP, LiveKit, audio processing, encryption

### 1.2 Identified Components

| Component | Line Range | Lines | Responsibility |
|-----------|------------|-------|----------------|
| Imports & Config | 1-141 | ~141 | Environment setup, dependencies, Opus encoder init, Media API config |
| StreamingCrypto | 142-218 | ~77 | AES-128-CTR encryption with cipher caching |
| PerformanceMonitor | 226-466 | ~241 | CPU, memory, latency metrics tracking |
| WorkerPoolManager | 479-968 | ~490 | Worker thread pool with auto-scaling |
| LiveKitBridge | 969-3152 | ~2,184 | LiveKit room connection, audio streaming |
| VirtualMQTTConnection | 3153-4354 | ~1,202 | MQTT device connection handling |
| MQTTGateway | 4355-6542 | ~2,188 | Main gateway, EMQX broker, message routing |
| Server Startup | 6544-6579 | ~36 | Entry point, error handlers |

### 1.3 Current Dependencies

```
External Packages:
├── dotenv
├── json5
├── net, crypto, dgram, events (Node.js built-in)
├── debug
├── @discordjs/opus
├── livekit-server-sdk (AccessToken, RoomServiceClient, AgentDispatchClient)
├── @livekit/rtc-node (Room, RoomEvent, AudioSource, AudioFrame, etc.)
├── mqtt
├── axios
├── worker_threads, path (Node.js built-in)
└── inspector/promises (Session)

Internal:
└── utils/config-manager.js (ConfigManager)
```

---

## 2. Proposed Module Structure

### 2.1 Directory Layout

```
mqtt-gateway/
├── app.js                        # Entry point (slim ~80 lines)
├── audio-worker.js               # Keep as-is (worker thread)
├── lib/
│   ├── index.js                  # Central exports
│   ├── constants.js              # Shared constants & config
│   ├── media-api.js              # Media API (Cerebrium) utilities
│   ├── streaming-crypto.js       # StreamingCrypto class
│   ├── performance-monitor.js    # PerformanceMonitor class
│   ├── worker-pool.js            # WorkerPoolManager class
│   ├── livekit-bridge.js         # LiveKitBridge class
│   ├── virtual-connection.js     # VirtualMQTTConnection class
│   └── mqtt-gateway.js           # MQTTGateway class
├── utils/
│   └── config-manager.js         # Keep as-is
├── config/
│   └── mqtt.json                 # Keep as-is
└── audio/                        # Keep as-is
```

### 2.2 Module Responsibilities

---

## 3. Module Specifications

### 3.1 `lib/constants.js`

**Purpose**: Centralize all constants and configuration values.

**Source Lines**: 96-108 (audio params), scattered throughout file

**Exports**:
```javascript
module.exports = {
  // Audio Parameters
  OUTGOING_SAMPLE_RATE: 24000,      // Hz - LiveKit → ESP32
  INCOMING_SAMPLE_RATE: 16000,      // Hz - ESP32 → LiveKit
  CHANNELS: 1,                       // Mono
  OUTGOING_FRAME_DURATION_MS: 60,
  INCOMING_FRAME_DURATION_MS: 60,
  OUTGOING_FRAME_SIZE_SAMPLES: 1440, // 24000 * 60 / 1000
  INCOMING_FRAME_SIZE_SAMPLES: 960,  // 16000 * 60 / 1000
  OUTGOING_FRAME_SIZE_BYTES: 2880,   // 1440 * 2
  INCOMING_FRAME_SIZE_BYTES: 1920,   // 960 * 2

  // Validation
  MacAddressRegex: /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/,

  // Timeouts
  INACTIVITY_TIMEOUT_MS: 2 * 60 * 1000, // 2 minutes
  KEEPALIVE_CHECK_INTERVAL: 15000,       // 15 seconds
  AGENT_JOIN_TIMEOUT_MS: 4000,           // 4 seconds
};
```

**Dependencies**: None

**Estimated Lines**: ~60

---

### 3.2 `lib/media-api.js`

**Purpose**: Encapsulate Media API (Cerebrium) configuration and utilities.

**Source Lines**: 33-68

**Exports**:
```javascript
module.exports = {
  MEDIA_API_BASE,           // Base URL
  CEREBRIUM_TOKEN,          // Auth token
  mediaAxiosConfig,         // Axios config factory
  validateMediaApiConfig,   // Startup validation
};
```

**Dependencies**: None (uses `process.env`)

**Estimated Lines**: ~50

---

### 3.3 `lib/streaming-crypto.js`

**Purpose**: AES encryption/decryption with cipher caching for UDP audio.

**Source Lines**: 142-218

**Exports**:
```javascript
class StreamingCrypto {
  constructor(maxCacheSize = 20)
  encrypt(data, algorithm, key, iv) → Buffer
  decrypt(data, algorithm, key, iv) → Buffer
  clearCache()
}

module.exports = { StreamingCrypto };
```

**Dependencies**: `crypto` (Node.js built-in)

**Estimated Lines**: ~80

---

### 3.4 `lib/performance-monitor.js`

**Purpose**: Track CPU, memory, latency, and throughput metrics.

**Source Lines**: 226-466

**Exports**:
```javascript
class PerformanceMonitor {
  constructor()
  startResourceMonitoring()
  recordCpuUsage() → number
  recordMemoryUsage() → object
  recordProcessingTime(startTime) → number
  recordFrame()
  recordError()
  recordQueueSize(size)
  getStats() → object
  getDetailedStats() → object
  shouldDowngrade() → boolean
  reset()
  stop()
}

module.exports = { PerformanceMonitor };
```

**Dependencies**: None (uses `process` global)

**Estimated Lines**: ~250

---

### 3.5 `lib/worker-pool.js`

**Purpose**: Manage worker thread pool for parallel Opus encoding/decoding.

**Source Lines**: 479-968

**Exports**:
```javascript
class WorkerPoolManager {
  constructor(workerCount = 2)
  initializeWorkers()
  restartWorker(index)
  initializeWorker(type, params) → Promise
  encodeOpus(pcmData, frameSize) → Promise<Buffer>
  decodeOpus(opusData) → Promise<Buffer>
  getNextWorker() → { worker, index }
  getStats() → object
  getDetailedStats() → object

  // Auto-scaling
  startAutoScaling()
  stopAutoScaling()
  checkAndScale()
  scaleUp(targetCount) → Promise
  scaleDown(targetCount) → Promise

  terminate() → Promise
}

module.exports = { WorkerPoolManager };
```

**Dependencies**:
- `worker_threads` (Node.js)
- `path` (Node.js)
- `./performance-monitor.js`

**Estimated Lines**: ~500

---

### 3.6 `lib/livekit-bridge.js`

**Purpose**: Handle LiveKit room connections, audio streaming, and agent communication.

**Source Lines**: 969-3152

**Exports**:
```javascript
class LiveKitBridge extends EventEmitter {
  constructor(connection, protocolVersion, macAddress, uuid, userData)

  // Initialization
  initializeLiveKit()
  connect(audio_params, features, roomService) → Promise<{ session_id, audio_params }>

  // Audio Processing
  processBufferedFrames(timestamp, frameCount)
  sendAudio(opusData, timestamp) → Promise
  safeCaptureFrame(frame) → Promise

  // Audio Format Detection
  checkOpusFormat(data) → boolean
  checkPCMFormat(data) → boolean
  analyzeAudioFormat(audioData, timestamp)

  // Message Handling
  sendTtsStartMessage(text)
  sendTtsSentenceStartMessage(text)
  sendTtsStopMessage()
  sendLLMThinkMessage()
  sendSttMessage(text)
  sendEmotionMessage(emoji, emotion)
  sendLlmMessage(text)
  sendRecordStopMessage()

  // Function Calls & MCP
  convertDeviceControlToMcp(controlData)
  handleFunctionCall(functionData) → Promise
  handleMobileMusicRequest(requestData) → Promise
  sendMcpMessage(toolName, toolArgs)
  sendMcpAndWait(toolName, args, timeout) → Promise
  forwardMcpResponse(mcpPayload, sessionId, requestId) → Promise<boolean>
  adjustVolume(action, step) → Promise<number>

  // Agent Communication
  sendReadyForGreeting() → Promise
  sendInitialGreeting() → Promise
  waitForAgentJoin(timeoutMs) → Promise<boolean>
  sendAbortSignal(sessionId) → Promise
  sendEndPrompt(sessionId) → Promise

  // Lifecycle
  isAlive() → boolean
  close() → Promise

  // Static
  static cleanupOldSessionsForDevice(macAddress, roomService, currentRoomName) → Promise
}

module.exports = { LiveKitBridge };
```

**Dependencies**:
- `events` (Node.js)
- `livekit-server-sdk`
- `@livekit/rtc-node`
- `json5`
- `./constants.js`
- `./worker-pool.js`
- `../utils/config-manager.js`

**Estimated Lines**: ~2,200

---

### 3.7 `lib/virtual-connection.js`

**Purpose**: Handle individual MQTT device connections via EMQX.

**Source Lines**: 3153-4354

**Exports**:
```javascript
class VirtualMQTTConnection {
  constructor(deviceId, connectionId, gateway, helloPayload)

  // Activity Tracking
  updateActivityTime(messageType)

  // Message Handling
  handlePublish(publishData)
  parseHelloMessage(json) → Promise
  parseOtherMessage(json) → Promise

  // Communication
  sendMqttMessage(payload)
  sendUdpMessage(payload, timestamp)
  generateUdpHeader(length, timestamp, sequence) → Buffer
  forwardMcpResponse(mcpPayload, sessionId, requestId) → Promise<boolean>

  // Bot Management
  fetchPlaylist(mode) → Promise<Array>
  spawnMusicBot(roomName, playlist) → Promise
  spawnStoryBot(roomName, playlist) → Promise

  // UDP Handling
  onUdpMessage(rinfo, message, payloadLength, timestamp, sequence)

  // Lifecycle
  checkKeepAlive() → Promise
  close() → Promise
  isAlive() → boolean
}

module.exports = { VirtualMQTTConnection };
```

**Dependencies**:
- `crypto` (Node.js)
- `axios`
- `./constants.js`
- `./streaming-crypto.js`
- `./livekit-bridge.js`
- `./media-api.js`

**Estimated Lines**: ~1,210

---

### 3.8 `lib/mqtt-gateway.js`

**Purpose**: Main gateway orchestration - EMQX broker, UDP server, connection management.

**Source Lines**: 4355-6542

**Exports**:
```javascript
class MQTTGateway {
  constructor()

  // Lifecycle
  start()
  stop() → Promise

  // EMQX Connection
  connectToEmqxBroker()
  handleMqttMessage(topic, message) → Promise
  publishToDevice(clientIdOrDeviceId, message)

  // Connection Management
  generateNewConnectionId() → number
  addConnection(connection)
  removeConnection(connection)
  setupKeepAliveTimer()
  clearKeepAliveTimer()

  // Device Handling
  handleDeviceHello(deviceId, payload)
  handleDeviceData(deviceId, payload)
  handleDeviceCharacterChange(deviceId, payload) → Promise
  handleDeviceModeChange(deviceId, payload) → Promise

  // Playback Control
  setupControlTopics(macAddress)
  handleNextControl(topic, clientId) → Promise
  handlePreviousControl(topic, clientId) → Promise
  handleSpecificMusicRequest(deviceId, payload, clientId) → Promise
  handleSpecificStoryRequest(deviceId, payload, clientId) → Promise

  // Response Helpers
  sendSuccessResponse(clientId, message, macAddress) → Promise
  sendErrorResponse(clientId, errorMessage, macAddress) → Promise

  // Audio Streaming
  streamAudioViaUdp(deviceId, audioFilePath, modeName, sendGoodbye) → Promise

  // UDP Server
  sendUdpMessage(message, remoteAddress)
  onUdpMessage(message, rinfo)
}

module.exports = { MQTTGateway };
```

**Dependencies**:
- `dgram` (Node.js)
- `mqtt`
- `axios`
- `livekit-server-sdk`
- `@discordjs/opus`
- `./constants.js`
- `./streaming-crypto.js`
- `./virtual-connection.js`
- `./livekit-bridge.js`
- `./media-api.js`
- `../utils/config-manager.js`

**Estimated Lines**: ~2,200

---

### 3.9 `lib/index.js`

**Purpose**: Central export point for all lib modules.

**Exports**:
```javascript
module.exports = {
  // Constants
  ...require('./constants'),

  // Media API
  mediaApi: require('./media-api'),

  // Classes
  StreamingCrypto: require('./streaming-crypto').StreamingCrypto,
  PerformanceMonitor: require('./performance-monitor').PerformanceMonitor,
  WorkerPoolManager: require('./worker-pool').WorkerPoolManager,
  LiveKitBridge: require('./livekit-bridge').LiveKitBridge,
  VirtualMQTTConnection: require('./virtual-connection').VirtualMQTTConnection,
  MQTTGateway: require('./mqtt-gateway').MQTTGateway,
};
```

**Estimated Lines**: ~25

---

### 3.10 `app.js` (Refactored Entry Point)

**Purpose**: Slim entry point - initialize Opus, start gateway.

**Structure**:
```javascript
require('dotenv').config();
const debugModule = require('debug');
const debug = debugModule('mqtt-server');

// Opus initialization (must stay in main thread)
const { initializeOpus } = require('./lib/opus-init');
const { opusEncoder, opusDecoder } = initializeOpus();

// Import gateway
const { MQTTGateway } = require('./lib');

// Create and start gateway
const gateway = new MQTTGateway();
gateway.start();

// Error handlers
process.on('uncaughtException', (error) => { /* ... */ });
process.on('unhandledRejection', (reason, promise) => { /* ... */ });
process.on('SIGINT', () => { gateway.stop(); });
```

**Estimated Lines**: ~100

---

## 4. Dependency Graph

```
                                    ┌─────────────────┐
                                    │     app.js      │
                                    │  (Entry Point)  │
                                    └────────┬────────┘
                                             │
                                             ▼
                                    ┌─────────────────┐
                                    │  mqtt-gateway   │
                                    └────────┬────────┘
                     ┌───────────────────────┼───────────────────────┐
                     │                       │                       │
                     ▼                       ▼                       ▼
            ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
            │virtual-connection│    │  livekit-bridge │    │   media-api     │
            └────────┬────────┘    └────────┬────────┘    └─────────────────┘
                     │                       │
        ┌────────────┼────────────┐          │
        │            │            │          │
        ▼            ▼            ▼          ▼
┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
│ streaming │ │  livekit  │ │  media    │ │  worker   │
│  crypto   │ │  bridge   │ │   api     │ │   pool    │
└───────────┘ └─────┬─────┘ └───────────┘ └─────┬─────┘
                    │                           │
                    │                           ▼
                    │                    ┌───────────┐
                    │                    │performance│
                    │                    │  monitor  │
                    │                    └───────────┘
                    │
            ┌───────┴───────┐
            │               │
            ▼               ▼
      ┌───────────┐  ┌───────────┐
      │ constants │  │  worker   │
      └───────────┘  │   pool    │
                     └───────────┘

All modules may depend on: constants.js
External: config-manager.js (utils/)
```

---

## 5. Implementation Steps

### Phase 1: Setup (No Breaking Changes)
1. Create `lib/` directory
2. Create `lib/constants.js` - extract all constants
3. Create `lib/media-api.js` - extract Media API config

### Phase 2: Utility Classes
4. Create `lib/streaming-crypto.js` - extract StreamingCrypto (lines 142-218)
5. Create `lib/performance-monitor.js` - extract PerformanceMonitor (lines 226-466)
6. Create `lib/worker-pool.js` - extract WorkerPoolManager (lines 479-968)

### Phase 3: Core Classes
7. Create `lib/livekit-bridge.js` - extract LiveKitBridge (lines 969-3152)
8. Create `lib/virtual-connection.js` - extract VirtualMQTTConnection (lines 3153-4354)
9. Create `lib/mqtt-gateway.js` - extract MQTTGateway (lines 4355-6542)

### Phase 4: Integration
10. Create `lib/index.js` - central exports
11. Refactor `app.js` to import from lib/
12. Remove original class definitions from app.js

### Phase 5: Validation
13. Test all MQTT connections
14. Test UDP audio streaming
15. Test LiveKit room creation and agent dispatch
16. Test mode changes (conversation/music/story)
17. Test playback controls (next/previous)

---

## 6. Circular Dependency Prevention

### Identified Potential Cycles:
1. `virtual-connection` ↔ `livekit-bridge` (both reference each other)
2. `mqtt-gateway` ↔ `virtual-connection` (gateway creates connections, connections reference gateway)

### Solutions:
1. **LiveKitBridge receives connection as constructor parameter** - no direct import needed
2. **VirtualMQTTConnection receives gateway as constructor parameter** - no direct import needed
3. **Use dependency injection pattern** - pass instances rather than importing classes

---

## 7. Shared State Management

### Global Singletons (to be managed in app.js or mqtt-gateway):
1. `configManager` - Configuration manager instance
2. `streamingCrypto` - Single crypto instance for cipher caching
3. `opusEncoder` / `opusDecoder` - Opus codec instances (must stay in main process)

### Instance-Level State:
- Each `VirtualMQTTConnection` has its own `LiveKitBridge`
- Each `LiveKitBridge` has its own `WorkerPoolManager` (if needed)
- `MQTTGateway` manages connection maps

---

## 8. Error Handling Strategy

### Per-Module Error Handling:
- Each module throws typed errors with context
- Caller decides whether to log, retry, or propagate

### Global Error Handlers (in app.js):
- `uncaughtException` - Log and exit (except known non-fatal like "InvalidState - failed to capture frame")
- `unhandledRejection` - Log warning
- `SIGINT` - Graceful shutdown

---

## 9. Testing Strategy

### Unit Tests (per module):
```
test/
├── lib/
│   ├── constants.test.js
│   ├── streaming-crypto.test.js
│   ├── performance-monitor.test.js
│   ├── worker-pool.test.js
│   ├── livekit-bridge.test.js
│   ├── virtual-connection.test.js
│   └── mqtt-gateway.test.js
```

### Integration Tests:
1. End-to-end MQTT message flow
2. UDP audio streaming roundtrip
3. LiveKit room lifecycle
4. Mode change flow

---

## 10. Rollback Plan

### If Issues Arise:
1. Keep original `app.js` as `app.js.backup`
2. If critical issues, rename back: `app.js.backup` → `app.js`
3. All new files can be safely deleted without affecting backup

### Version Control:
1. Create feature branch: `refactor/split-app-js`
2. Commit each phase separately
3. PR review before merge to main

---

## 11. File Size Estimates (Post-Refactor)

| File | Source Lines | Estimated Lines | Estimated Size |
|------|--------------|-----------------|----------------|
| app.js | 6544-6579 | ~100 | ~3 KB |
| lib/constants.js | 96-108 | ~60 | ~2 KB |
| lib/media-api.js | 33-68 | ~50 | ~1.5 KB |
| lib/streaming-crypto.js | 142-218 | ~80 | ~2.5 KB |
| lib/performance-monitor.js | 226-466 | ~250 | ~8 KB |
| lib/worker-pool.js | 479-968 | ~500 | ~16 KB |
| lib/livekit-bridge.js | 969-3152 | ~2,200 | ~73 KB |
| lib/virtual-connection.js | 3153-4354 | ~1,210 | ~40 KB |
| lib/mqtt-gateway.js | 4355-6542 | ~2,200 | ~73 KB |
| lib/index.js | new | ~25 | ~1 KB |
| **Total** | | **~6,675** | **~220 KB** |

---

## 12. Benefits

1. **Maintainability**: Each file has single responsibility
2. **Testability**: Modules can be tested in isolation
3. **Readability**: Easier to navigate and understand
4. **Collaboration**: Multiple developers can work on different modules
5. **Reusability**: Classes can be imported independently
6. **Debugging**: Errors point to specific modules

---

## 13. Class Line Reference (Quick Lookup)

| Class | Start Line | End Line | Lines |
|-------|------------|----------|-------|
| StreamingCrypto | 142 | 218 | 77 |
| PerformanceMonitor | 226 | 466 | 241 |
| WorkerPoolManager | 479 | 968 | 490 |
| LiveKitBridge | 969 | 3152 | 2,184 |
| VirtualMQTTConnection | 3153 | 4354 | 1,202 |
| MQTTGateway | 4355 | 6542 | 2,188 |

---

## 14. Next Steps

1. Review this plan
2. Approve directory structure
3. Begin Phase 1 implementation
4. Iterative testing after each phase

---

*Document Version: 2.0*
*Updated: 2025-11-25*
*Author: Claude Code Assistant*
*Total app.js lines: 6,579*
