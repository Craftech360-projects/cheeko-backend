# AI Printer Integration Plan

> Wiring `line_art` service into `mqtt-gateway` via `board_type` routing.
>
> **Status:** Draft — pending team review and approval
>
> **Date:** 2026-03-24

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Current Architecture](#2-current-architecture)
3. [Proposed Architecture](#3-proposed-architecture)
4. [board_type Routing](#4-board_type-routing)
5. [Protocol & Message Spec](#5-protocol--message-spec)
6. [Implementation Details](#6-implementation-details)
7. [Files Changed](#7-files-changed)
8. [Alternatives Considered](#8-alternatives-considered)
9. [Scaling Strategy](#9-scaling-strategy)
10. [Cost Analysis](#10-cost-analysis)
11. [Risks & Mitigations](#11-risks--mitigations)
12. [Open Questions](#12-open-questions)
13. [Rollout Plan](#13-rollout-plan)

---

## 1. Problem Statement

We have a standalone `line_art` service (FastAPI + WebSocket) that generates 1-bit monochrome
line art from voice/text input. It currently runs independently on port 8000.

We need to integrate it into the existing Cheeko infrastructure so that:

- ESP32 devices with `board_type: "ai_printer"` connect through the **same mqtt-gateway**
- The device lifecycle (MQTT connect, manager-api registration, OTA, UDP audio) stays identical
- Line art generation replaces the LiveKit AI agent pipeline for these devices
- **No LiveKit rooms** are created for ai_printer devices (cost savings)

---

## 2. Current Architecture

### Cheeko Device Flow (today)

```
ESP32 (board_type: "cheeko")
  |
  |-- MQTT (TCP 1883) --> EMQX Broker --> mqtt-gateway     [control plane]
  |-- Raw UDP (1883)  -----------------> mqtt-gateway      [audio plane]
  |                                          |
  |                                          |--> LiveKit Cloud (WebSocket)
  |                                          |        |
  |                                          |        v
  |                                          |    AI Agent (Python)
  |                                          |    - STT (Deepgram/Whisper)
  |                                          |    - LLM (Groq/Google)
  |                                          |    - TTS (ElevenLabs/Edge)
  |                                          |        |
  |                                          |<-- TTS audio stream
  |<-- UDP: Opus TTS audio --------------- |
  |<-- MQTT: stt/emotion/control --------- |
```

### line_art Service (today, standalone)

```
Browser/Device
  |-- WebSocket --> ws://localhost:8000/ws
  |                    |
  |                    |--> Groq Whisper (STT): 1-2s
  |                    |--> HuggingFace FLUX (image gen): 5-20s
  |                    |--> Pillow (1-bit conversion): ~100ms
  |                    |
  |<-- JSON: {raw_mono, width, height}
```

---

## 3. Proposed Architecture

### Key Insight

Cheeko is a **streaming** use case (continuous bidirectional audio — needs LiveKit).
AI Printer is a **request-response** use case (send audio, get image back — HTTP is sufficient).

### Proposed Flow

```
ESP32 (board_type: "ai_printer")
  |
  |-- MQTT hello {board_type:"ai_printer"} --> EMQX --> mqtt-gateway
  |<-- hello response (UDP keys)                          |
  |                                                       |
  |-- UDP: Opus audio frames --------------------------> |
  |-- UDP: Opus audio frames --------------------------> | accumulates
  |-- UDP: Opus audio frames --------------------------> | in buffer
  |                                                       |
  |-- MQTT: {type:"audio_end"} -----------------------> | triggers processing
  |   (or 1.5s silence timeout)                           |
  |                                                       v
  |                                              Decode Opus --> WAV
  |                                              (existing worker pool)
  |                                                       |
  |                                              HTTP POST /generate
  |                                                       |
  |                                    +------------------v-------------------+
  |                                    |     line_art HTTP API (stateless)    |
  |                                    |   +----------+  +----------+        |
  |                                    |   | worker 1 |  | worker 2 | (PM2)  |
  |                                    |   +----------+  +----------+        |
  |                                    |   - Groq Whisper STT (1-2s)         |
  |                                    |   - HuggingFace FLUX (5-20s)        |
  |                                    |   - Pillow 1-bit convert (~100ms)   |
  |                                    +------------------+-------------------+
  |                                                       |
  |                                              HTTP response
  |                                              {raw_mono, width, height}
  |                                                       |
  |<-- MQTT: {type:"line_art", raw_mono, width, height} --+
  |
  +-- ESP32 renders bitmap on e-ink/LCD display
```

### What's Shared Between Cheeko and AI Printer

| Component | Cheeko | AI Printer | Shared? |
|-----------|--------|------------|---------|
| MQTT connect/disconnect | Yes | Yes | Yes |
| Hello/goodbye lifecycle | Yes | Yes | Yes |
| UDP transport + AES encryption | Yes | Yes | Yes |
| Manager-API (device config, OTA) | Yes | Yes | Yes |
| Inactivity timeout | Yes | Yes | Yes |
| Worker pool (Opus decode) | Yes | Yes | Yes |
| LiveKit room creation | Yes | **No** | No |
| Agent dispatch | Yes | **No** | No |
| Audio resampling (48kHz->24kHz) | Yes | **No** | No |
| TTS audio back to device | Yes | **No** | No |
| line_art HTTP call | **No** | Yes | No |

---

## 4. board_type Routing

The `board_type` field in the hello message determines which pipeline runs.

### Hello Message (device sends)

```json
{
  "type": "hello",
  "version": 3,
  "board_type": "ai_printer",
  "audio_params": {
    "sample_rate": 16000,
    "channels": 1,
    "codec": "opus"
  },
  "features": {}
}
```

### Routing Logic (in `virtual-connection.js`)

```
hello received
  |
  +-- store boardType = json.board_type || "cheeko"
  |
  +-- send hello response (same for both — UDP keys, encryption)
  |
  +-- _deferredSetup():
       |
       +-- parallel DB queries (device mode, character, profile) — same for both
       |
       +-- if boardType === "ai_printer":
       |     - skip LiveKit room creation
       |     - skip agent dispatch
       |     - init audio accumulator
       |     - send {type: "ready", board_type: "ai_printer"}
       |     - RETURN
       |
       +-- else (cheeko, default):
             - create LiveKit room (existing code)
             - dispatch agent (existing code)
```

### Audio Routing (in `virtual-connection.js::onUdpMessage`)

```
UDP audio received
  |
  +-- decrypt (same for both)
  |
  +-- if boardType === "ai_printer":
  |     - accumulate in printerBuffer
  |     - reset silence timer (1.5s)
  |     - on silence/audio_end: processLineArtRequest()
  |     - RETURN
  |
  +-- else (cheeko, default):
        - bridge.sendAudio() (existing LiveKit path)
```

---

## 5. Protocol & Message Spec

### Device --> Gateway (MQTT)

| Message Type | board_type | Payload | Description |
|-------------|------------|---------|-------------|
| `hello` | both | `{type, version, board_type, audio_params}` | Connection init |
| `goodbye` | both | `{type, session_id}` | Disconnect |
| `audio_end` | ai_printer | `{type: "audio_end"}` | Signal: done speaking, process now |
| `draw` | ai_printer | `{type: "draw", text: "cat"}` | Text-based draw request (skip STT) |

### Gateway --> Device (MQTT)

| Message Type | board_type | Payload | Description |
|-------------|------------|---------|-------------|
| `hello` | both | `{type, version, session_id, udp, audio_params}` | Connection ack + UDP keys |
| `mode_update` | both | `{type, mode, board_type}` | Confirm device config |
| `ready` | ai_printer | `{type: "ready", board_type: "ai_printer"}` | Server ready for requests |
| `line_art_progress` | ai_printer | `{type, stage, message}` | Progress update |
| `line_art_transcription` | ai_printer | `{type, text}` | What the device said (STT result) |
| `line_art` | ai_printer | `{type, raw_mono, width, height}` | The bitmap result |
| `line_art_error` | ai_printer | `{type, stage, message}` | Error during processing |
| `goodbye` | both | `{type, session_id, reason}` | Server disconnect |

### Device --> Gateway (UDP)

Same as Cheeko — Opus audio frames with 16-byte header + AES-128-CTR encryption.

For ai_printer, audio frames are **accumulated** in the gateway until `audio_end` or silence timeout, then sent as a single batch to the line_art API.

### Raw Bitmap Format (`raw_mono` in `line_art` result)

| Property | Value |
|----------|-------|
| Width | 384 pixels (always) |
| Height | Variable (aspect ratio preserved) |
| Color depth | 1-bit (black = 1, white = 0) |
| Bit order | MSB first (leftmost pixel = bit 7) |
| Row order | Top-down |
| Bytes/row | 48 (384 / 8) |
| Encoding | Base64 |
| Header | None |
| Compression | None |

ESP32 decodes base64, writes directly to display framebuffer.

---

## 6. Implementation Details

### 6.1 line_art: Add HTTP POST Endpoint

**File:** `line_art/app/main.py`

Add `POST /generate` alongside existing WebSocket. Reuses same `stt.py` and `image_gen.py`.

```python
from fastapi import UploadFile, File, Form

@app.post("/generate")
async def generate_endpoint(
    file: UploadFile = File(None),
    text: str = Form(None),
):
    """Generate line art from audio (WAV) or text input."""
    if not file and not text:
        raise HTTPException(400, "Provide either 'file' (WAV audio) or 'text'")

    transcription = text
    if file:
        audio_bytes = await file.read()
        transcription = await transcribe(audio_bytes)
        if not transcription:
            raise HTTPException(422, "Could not transcribe speech from audio")

    image_data_uri, prompt_used, raw_mono, height = await generate_line_art(
        transcription, HF_TOKEN
    )

    return {
        "transcription": transcription,
        "raw_mono": raw_mono,           # base64 encoded
        "width": 384,
        "height": height,
        "prompt_used": prompt_used,
    }
```

**Why HTTP over WebSocket for gateway integration:**
- Request-response pattern (not streaming)
- Stateless — trivially load-balanced
- Simple error handling (HTTP status codes)
- No connection management, no reconnect logic
- Gateway already uses `axios` for all service calls

Existing WebSocket endpoint stays for `static/index.html` browser testing.

### 6.2 Gateway: Line Art HTTP Client

**New file:** `mqtt-gateway/core/line-art-client.js`

```javascript
const axios = require("axios");
const FormData = require("form-data");
const logger = require("../utils/logger");

class LineArtClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl || process.env.LINE_ART_URL || "http://localhost:8000";
    logger.info(`[LINE-ART] Client initialized: ${this.baseUrl}`);
  }

  async generateFromAudio(wavBuffer) {
    const form = new FormData();
    form.append("file", wavBuffer, {
      filename: "audio.wav",
      contentType: "audio/wav",
    });

    const response = await axios.post(`${this.baseUrl}/generate`, form, {
      headers: form.getHeaders(),
      timeout: 60000,  // image gen can be slow (up to 30s)
    });
    return response.data;
  }

  async generateFromText(text) {
    const form = new FormData();
    form.append("text", text);

    const response = await axios.post(`${this.baseUrl}/generate`, form, {
      headers: form.getHeaders(),
      timeout: 60000,
    });
    return response.data;
  }
}

module.exports = { LineArtClient };
```

### 6.3 Gateway: WAV Writer Utility

**New file:** `mqtt-gateway/utils/wav-writer.js`

Wraps raw PCM samples into a valid WAV file buffer (44-byte header + PCM data).

```javascript
function createWavBuffer(pcmBuffer, sampleRate = 16000, channels = 1, bitDepth = 16) {
  const dataLength = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);                          // ChunkID
  header.writeUInt32LE(36 + dataLength, 4);          // ChunkSize
  header.write("WAVE", 8);                           // Format
  header.write("fmt ", 12);                          // Subchunk1ID
  header.writeUInt32LE(16, 16);                      // Subchunk1Size (PCM)
  header.writeUInt16LE(1, 20);                       // AudioFormat (PCM = 1)
  header.writeUInt16LE(channels, 22);                // NumChannels
  header.writeUInt32LE(sampleRate, 24);              // SampleRate
  header.writeUInt32LE(sampleRate * channels * bitDepth / 8, 28); // ByteRate
  header.writeUInt16LE(channels * bitDepth / 8, 32); // BlockAlign
  header.writeUInt16LE(bitDepth, 34);                // BitsPerSample
  header.write("data", 36);                          // Subchunk2ID
  header.writeUInt32LE(dataLength, 40);              // Subchunk2Size

  return Buffer.concat([header, pcmBuffer]);
}

module.exports = { createWavBuffer };
```

### 6.4 Gateway: Virtual Connection Changes

**File:** `mqtt-gateway/mqtt/virtual-connection.js`

#### 6.4a — Store board_type in `parseHelloMessage()` (~line 349)

```javascript
// After: this.language = json.language || null;
this.boardType = json.board_type || "cheeko";
```

#### 6.4b — Fork in `_deferredSetup()` (after DB queries, ~line 517)

```javascript
// ── board_type fork: ai_printer skips LiveKit entirely ──
if (this.boardType === "ai_printer") {
  this.printerBuffer = {
    frames: [],
    silenceTimer: null,
    processing: false,
  };
  this.deferredSetupInProgress = false;

  this.sendMqttMessage(JSON.stringify({
    type: "ready",
    board_type: "ai_printer",
    session_id: this.udp.session_id,
    timestamp: Date.now(),
  }));

  console.log(`🎨 [AI-PRINTER] Ready for device ${this.deviceId}`);
  return; // Skip LiveKit room, agent dispatch, everything below
}

// ── Step 2: LiveKit room setup (cheeko only from here) ──
// ... existing code unchanged ...
```

#### 6.4c — Audio routing in `onUdpMessage()` (~line 1490, after decryption)

```javascript
// After payload decryption, before bridge.sendAudio():

if (this.boardType === "ai_printer") {
  if (!this.printerBuffer || this.printerBuffer.processing) return;

  this.printerBuffer.frames.push(Buffer.from(payload));

  // Reset silence timer (1.5s of silence = done speaking)
  if (this.printerBuffer.silenceTimer) {
    clearTimeout(this.printerBuffer.silenceTimer);
  }
  this.printerBuffer.silenceTimer = setTimeout(() => {
    this.processLineArtRequest();
  }, 1500);

  return; // Don't send to LiveKit bridge
}

// existing: this.bridge.sendAudio(payload, timestamp);
```

#### 6.4d — Handle MQTT messages from ai_printer in `handlePublish()` (~line 200)

```javascript
// After parsing json.type:

if (json.type === "audio_end" && this.boardType === "ai_printer") {
  if (this.printerBuffer?.silenceTimer) {
    clearTimeout(this.printerBuffer.silenceTimer);
  }
  this.processLineArtRequest();
  return;
}

if (json.type === "draw" && this.boardType === "ai_printer") {
  this.processLineArtTextRequest(json.text);
  return;
}
```

#### 6.4e — New methods on VirtualMQTTConnection

```javascript
async processLineArtRequest() {
  if (!this.printerBuffer || this.printerBuffer.frames.length === 0) return;
  if (this.printerBuffer.processing) return;

  this.printerBuffer.processing = true;
  const frames = this.printerBuffer.frames.splice(0);

  try {
    // Progress: processing
    this.sendMqttMessage(JSON.stringify({
      type: "line_art_progress",
      stage: "processing",
      message: "Processing audio...",
    }));

    // Decode all Opus frames to PCM using existing worker pool
    const pcmChunks = [];
    for (const frame of frames) {
      const pcm = await this.workerPool.decodeOpus(this.udp.session_id, frame);
      pcmChunks.push(pcm);
    }
    const pcmBuffer = Buffer.concat(pcmChunks);

    // Wrap as WAV
    const { createWavBuffer } = require("../utils/wav-writer");
    const wavBuffer = createWavBuffer(pcmBuffer, 16000, 1, 16);

    // Progress: generating
    this.sendMqttMessage(JSON.stringify({
      type: "line_art_progress",
      stage: "generating",
      message: "Generating line art...",
    }));

    // Call line_art HTTP API
    const result = await this.gateway.lineArtClient.generateFromAudio(wavBuffer);

    // Send transcription
    if (result.transcription) {
      this.sendMqttMessage(JSON.stringify({
        type: "line_art_transcription",
        text: result.transcription,
      }));
    }

    // Send result
    this.sendMqttMessage(JSON.stringify({
      type: "line_art",
      raw_mono: result.raw_mono,
      width: result.width,
      height: result.height,
    }));

    console.log(`🎨 [AI-PRINTER] Generated ${result.width}x${result.height} for "${result.transcription}"`);
  } catch (error) {
    console.error(`❌ [AI-PRINTER] Generation failed:`, error.message);
    this.sendMqttMessage(JSON.stringify({
      type: "line_art_error",
      stage: "generation",
      message: error.message,
    }));
  } finally {
    this.printerBuffer.processing = false;
  }
}

async processLineArtTextRequest(text) {
  if (!text?.trim()) return;

  try {
    this.sendMqttMessage(JSON.stringify({
      type: "line_art_progress",
      stage: "generating",
      message: `Generating line art for '${text}'...`,
    }));

    const result = await this.gateway.lineArtClient.generateFromText(text);

    this.sendMqttMessage(JSON.stringify({
      type: "line_art",
      raw_mono: result.raw_mono,
      width: result.width,
      height: result.height,
    }));

    console.log(`🎨 [AI-PRINTER] Generated ${result.width}x${result.height} for "${text}"`);
  } catch (error) {
    console.error(`❌ [AI-PRINTER] Text generation failed:`, error.message);
    this.sendMqttMessage(JSON.stringify({
      type: "line_art_error",
      stage: "generation",
      message: error.message,
    }));
  }
}
```

### 6.5 Gateway: Initialize LineArtClient

**File:** `mqtt-gateway/gateway/mqtt-gateway.js`

In the MQTTGateway constructor or `start()`:

```javascript
const { LineArtClient } = require("../core/line-art-client");

// In constructor or start():
this.lineArtClient = new LineArtClient(process.env.LINE_ART_URL);
```

### 6.6 PM2 Configuration

**File:** `ecosystem.config.js`

Add line_art service entry:

```javascript
{
  name: "line-art",
  script: "uvicorn",
  args: "app.main:app --host 0.0.0.0 --port 8000",
  cwd: "./line_art",
  instances: 2,           // horizontal scaling via PM2 cluster
  exec_mode: "fork",      // each is a separate uvicorn process
  env: {
    GROQ_API_KEY: "...",
    HF_TOKEN: "...",
  },
}
```

---

## 7. Files Changed

| File | Action | Lines (approx) | Description |
|------|--------|----------------|-------------|
| `line_art/app/main.py` | Edit | +25 | Add `POST /generate` endpoint |
| `mqtt-gateway/core/line-art-client.js` | **New** | ~45 | HTTP client to line_art |
| `mqtt-gateway/utils/wav-writer.js` | **New** | ~25 | PCM-to-WAV header utility |
| `mqtt-gateway/mqtt/virtual-connection.js` | Edit | ~100 | board_type routing + audio accumulator |
| `mqtt-gateway/gateway/mqtt-gateway.js` | Edit | ~5 | Init LineArtClient |
| `mqtt-gateway/mqtt/message-parser.js` | Edit | ~3 | Parse board_type in hello |
| `ecosystem.config.js` | Edit | ~10 | Add line-art PM2 entry |

**Total new code: ~210 lines**

### Dependencies Added

| Package | Where | Purpose |
|---------|-------|---------|
| `form-data` | mqtt-gateway | Multipart HTTP POST for audio upload |
| `python-multipart` | line_art | FastAPI file upload support |

---

## 8. Alternatives Considered

### Option A: LiveKit Agent for AI Printer

Route ai_printer through LiveKit like Cheeko — create room, dispatch a `printer-agent`.

| Pros | Cons |
|------|------|
| Minimal gateway changes (~5 lines) | **LiveKit room cost per device per session** |
| LiveKit handles scaling | Overkill for request-response pattern |
| Follows existing pattern | Room creation overhead for single request |

**Rejected:** Cost. LiveKit rooms are billed per participant-minute. AI printer generates
one image per session — paying for a full room is like renting a conference hall to pass a note.

### Option B: Gateway as WebSocket Proxy

Gateway opens WebSocket to `ws://localhost:8000/ws`, proxies audio through.

| Pros | Cons |
|------|------|
| No changes to line_art | Persistent WS connection per device |
| Works today | Reconnect logic, state management |
| | Hard to load-balance WebSocket |
| | Gateway becomes a stateful proxy |

**Rejected:** Complexity. WebSocket connections need lifecycle management, reconnect handling,
and sticky sessions for load balancing. HTTP is stateless and trivially scalable.

### Option C: Direct Device-to-line_art Connection

ESP32 connects directly to line_art WebSocket, bypassing gateway entirely.

| Pros | Cons |
|------|------|
| Simplest server-side | ESP32 needs WebSocket client |
| No gateway changes | Device sends Opus, line_art expects WAV |
| | Bypasses encryption, auth, OTA |
| | Two different connection paths to manage |

**Rejected:** Firmware complexity and security. Bypasses the entire gateway infrastructure.

### Chosen: Option D — HTTP Microservice (this plan)

Gateway accumulates audio, makes HTTP POST to line_art. Best of all worlds:
- Gateway stays thin (audio accumulator + one HTTP call)
- line_art stays stateless (horizontal scaling via PM2)
- No LiveKit cost
- Same device connection path as Cheeko

---

## 9. Scaling Strategy

### Bottleneck Analysis

| Stage | Time | Scalable? |
|-------|------|-----------|
| Opus decode (gateway) | ~10ms | Yes — existing worker pool |
| Groq Whisper STT | 1-2s | Yes — Groq handles scaling |
| HuggingFace FLUX image gen | 5-20s | **Bottleneck** — API rate limits |
| Pillow 1-bit conversion | ~100ms | Yes — CPU-bound, trivial |

### Scaling Levels

**Level 1: Single Instance (0-10 concurrent devices)**
```
line_art (1 process, port 8000)
```
Sufficient for initial rollout and testing.

**Level 2: PM2 Cluster (10-50 concurrent devices)**
```
PM2 cluster mode:
  line_art:8000 (instance 1)
  line_art:8001 (instance 2)
  line_art:8002 (instance 3)
  line_art:8003 (instance 4)

Gateway round-robins across instances.
```

**Level 3: Load Balancer (50+ concurrent devices)**
```
nginx upstream:
  server line-art-1:8000;
  server line-art-2:8000;
  server line-art-3:8000;

Gateway hits nginx → distributes to instances.
Can run on separate machines.
```

**Level 4: Queue-Based (100+ concurrent, strict ordering)**
```
Gateway → Redis/BullMQ queue → N line_art workers
  - Priority queues (paid tier gets faster processing)
  - Job status tracking
  - Retry on failure
  - Rate limit protection for HuggingFace API
```

Each level builds on the previous — no rearchitecture needed, just configuration changes.

### HuggingFace Rate Limit Mitigation

If HuggingFace becomes a bottleneck:
1. **Self-hosted FLUX model** on GPU server (eliminates rate limits)
2. **Multiple HF API tokens** with round-robin
3. **Image caching** — cache results for common prompts (Redis key: prompt hash → raw_mono)
4. **Fallback model** — use a faster/cheaper model if primary is overloaded

---

## 10. Cost Analysis

### Per AI Printer Session

| Component | Cost |
|-----------|------|
| LiveKit room | **$0** (not used) |
| Groq Whisper STT | **$0** (free tier: 7,200 req/day) |
| HuggingFace FLUX | **$0** (free tier: ~1,000 images/day) |
| Server compute | Negligible (shared with gateway) |
| **Total per session** | **$0** |

### Comparison: If We Used LiveKit

| Component | Cost |
|-----------|------|
| LiveKit room (~30s session) | ~$0.004 per session |
| At 1,000 sessions/day | ~$4/day = **$120/month** |
| At 10,000 sessions/day | ~$40/day = **$1,200/month** |

### Infrastructure Cost

No new infrastructure. line_art runs on the same server as mqtt-gateway via PM2.

---

## 11. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| HuggingFace API downtime | HIGH | Add health check endpoint; fallback to cached/placeholder image |
| Image generation timeout (>30s) | MEDIUM | 60s HTTP timeout; device shows "generating..." animation; cancel on disconnect |
| Audio too short / silence only | LOW | Minimum frame count check (reject < 5 frames); send helpful error |
| Gateway memory from audio accumulation | LOW | Cap buffer at 250 frames (~5s audio, same as cheeko buffer); reject excess |
| MQTT message too large for bitmap | MEDIUM | Base64 of 384x384 1-bit = ~7KB; well within MQTT 256KB limit |
| Concurrent requests from same device | LOW | `processing` flag prevents duplicate submissions |
| line_art service crash | MEDIUM | PM2 auto-restart; gateway returns error to device on HTTP failure |
| Opus decode failure | LOW | Existing worker pool handles this; error propagates cleanly |

---

## 12. Open Questions

> These need team input before implementation.

### Q1: Firmware — How does the device signal "done speaking"?
- **Option A:** Device sends `{type: "audio_end"}` MQTT message when button is released
- **Option B:** Gateway detects 1.5s silence (no UDP frames) and auto-triggers
- **Option C:** Both (button release sends explicit signal, silence is fallback)
- **Recommendation:** Option C

### Q2: Should ai_printer devices support text-only input?
- If device has a keypad/touchscreen, it could send `{type: "draw", text: "cat"}` directly
- This skips STT entirely — faster response
- **Recommendation:** Yes, support both audio and text paths

### Q3: Should we cache generated images?
- Same prompt (e.g., "cat") generates different images each time (FLUX is non-deterministic)
- Caching would return the same image for repeated prompts
- **Recommendation:** No caching initially; add later if HuggingFace rate limits become an issue

### Q4: Display resolution — is 384px always correct?
- Current line_art hardcodes `TARGET_WIDTH = 384`
- Different ai_printer hardware might have different display sizes
- Should width be configurable per device (stored in manager-api)?
- **Recommendation:** Start with 384px; add device-specific resolution later via manager-api config

### Q5: Should the hello response include `board_type` in the reply?
- Helps firmware confirm the gateway recognized its board type
- **Recommendation:** Yes, include `board_type: "ai_printer"` in hello response and `ready` message

### Q6: Environment variable naming
- `LINE_ART_URL` vs `AI_PRINTER_API_URL` vs `LINE_ART_SERVICE_URL`?
- **Recommendation:** `LINE_ART_URL` (matches the service name)

---

## 13. Rollout Plan

### Phase 1: line_art HTTP Endpoint (1 day)

- [ ] Add `POST /generate` to `line_art/app/main.py`
- [ ] Add `python-multipart` to `requirements.txt`
- [ ] Test with curl: `curl -F "text=cat" http://localhost:8000/generate`
- [ ] Test with audio: `curl -F "file=@test.wav" http://localhost:8000/generate`
- [ ] Verify existing WebSocket still works (backward compatible)

### Phase 2: Gateway Integration (2 days)

- [ ] Create `core/line-art-client.js`
- [ ] Create `utils/wav-writer.js`
- [ ] Add `board_type` parsing in `virtual-connection.js::parseHelloMessage()`
- [ ] Add ai_printer fork in `_deferredSetup()` (skip LiveKit)
- [ ] Add audio accumulator in `onUdpMessage()`
- [ ] Add `audio_end` and `draw` handlers in `handlePublish()`
- [ ] Add `processLineArtRequest()` and `processLineArtTextRequest()` methods
- [ ] Init `LineArtClient` in `mqtt-gateway.js`
- [ ] Add `form-data` to `package.json`

### Phase 3: Testing (1 day)

- [ ] Test with mock ESP32 (send MQTT hello with `board_type: "ai_printer"`)
- [ ] Verify no LiveKit room is created
- [ ] Send Opus audio over UDP, verify image comes back over MQTT
- [ ] Test `draw` text command
- [ ] Test silence timeout triggers processing
- [ ] Test `audio_end` explicit trigger
- [ ] Test error cases (empty audio, line_art service down)
- [ ] Verify cheeko devices still work unchanged

### Phase 4: Firmware (parallel with Phase 2-3)

- [ ] Add `board_type: "ai_printer"` to hello message in ESP32 firmware
- [ ] Handle `ready` message (server is ready for requests)
- [ ] Handle `line_art` message (decode base64, render on display)
- [ ] Handle `line_art_progress` message (show animation/status)
- [ ] Handle `line_art_error` message (show error on display)
- [ ] Send `audio_end` on button release
- [ ] (Optional) Send `draw` text command if device has text input

### Phase 5: Deploy & Monitor

- [ ] Add line_art to `ecosystem.config.js`
- [ ] Deploy to staging environment
- [ ] Monitor: request latency, error rate, HuggingFace API usage
- [ ] Deploy to production
- [ ] Monitor for 1 week before scaling

---

## Appendix: Sequence Diagram

```
ai_printer           EMQX            mqtt-gateway          line_art API
    |                  |                    |                     |
    |--MQTT CONNECT--->|                    |                     |
    |--hello---------->|--server-ingest---->|                     |
    |  {board_type:    |                    |                     |
    |   "ai_printer"}  |                    |                     |
    |                  |                    |--DB queries-------->|
    |<-hello response--|<-------------------|  (manager-api)      |
    |  (UDP keys)      |                    |                     |
    |                  |<-------------------|                     |
    |<-ready-----------|  {board_type:      |                     |
    |                  |   "ai_printer"}    |                     |
    |                  |                    |                     |
    |==UDP:Opus=======>|===================>| accumulate          |
    |==UDP:Opus=======>|===================>| accumulate          |
    |==UDP:Opus=======>|===================>| accumulate          |
    |                  |                    |                     |
    |--audio_end------>|--server-ingest---->| decode Opus->WAV    |
    |                  |                    |                     |
    |<-progress--------|<-------------------| POST /generate      |
    |  "processing"    |                    |--WAV body---------->|
    |                  |                    |                     |
    |                  |                    |                  STT (1-2s)
    |                  |                    |              FLUX gen (5-20s)
    |                  |                    |              1-bit convert
    |                  |                    |                     |
    |<-progress--------|<-------------------|<---HTTP 200---------|
    |  "generating"    |                    | {raw_mono,w,h}      |
    |                  |                    |                     |
    |<-line_art--------|<-------------------|                     |
    |  {raw_mono,      |                    |                     |
    |   width, height} |                    |                     |
    |                  |                    |                     |
    +--render on       |                    |                     |
       display         |                    |                     |
```
