# AI Printer — ESP32 Firmware Changes

> What the firmware team needs to implement for `board_type: "ai_printer"` devices.
>
> **Date:** 2026-03-24
>
> **Prerequisite:** Read `INTEGRATION_PLAN.md` for full architecture context.

---

## Table of Contents

1. [Summary](#1-summary)
2. [What Stays the Same (Reuse from Cheeko)](#2-what-stays-the-same-reuse-from-cheeko)
3. [What Changes](#3-what-changes)
4. [Hello Message Change](#4-hello-message-change)
5. [New MQTT Messages to Handle](#5-new-mqtt-messages-to-handle)
6. [Audio Recording Flow](#6-audio-recording-flow)
7. [Text Draw Command](#7-text-draw-command)
8. [Bitmap Rendering](#8-bitmap-rendering)
9. [State Machine](#9-state-machine)
10. [UDP Audio Spec (unchanged)](#10-udp-audio-spec-unchanged)
11. [Error Handling](#11-error-handling)
12. [Hardware Assumptions](#12-hardware-assumptions)

---

## 1. Summary

The ai_printer firmware is a **subset** of the Cheeko firmware. It reuses the same
MQTT + UDP connection layer but replaces the voice conversation UI with a
"speak → get image" flow.

**What the device does:**
1. Connect to gateway (same as Cheeko)
2. User presses button and speaks (e.g., "draw me a cat")
3. Audio streams to gateway over UDP (same as Cheeko)
4. User releases button → device sends `audio_end` over MQTT
5. Gateway processes audio → returns a 1-bit bitmap over MQTT
6. Device renders bitmap on e-ink/LCD display

**What the device does NOT do:**
- No TTS audio playback (no speaker needed)
- No UDP audio reception (gateway sends nothing back over UDP)
- No LiveKit interaction
- No emotion/llm_thinking/tts_start/tts_stop handling

---

## 2. What Stays the Same (Reuse from Cheeko)

These modules from the Cheeko firmware are reused **as-is**:

| Module | Purpose |
|--------|---------|
| WiFi connection | Connect to local network |
| MQTT client | Connect to EMQX broker (TCP port 1883) |
| MQTT message parsing | JSON parse/serialize for control messages |
| UDP socket | Send audio to gateway |
| AES-128-CTR encryption | Encrypt UDP audio payloads |
| UDP header construction | 16-byte header for audio packets |
| Opus encoder | Encode microphone PCM → Opus |
| Hello/goodbye handshake | Session lifecycle |
| OTA updates | Firmware updates via manager-api |
| Manager-API registration | Device registration, config fetch |
| Inactivity timeout | Auto-disconnect after idle period |
| Keep-alive / ping | `ping:` messages over UDP |

---

## 3. What Changes

| Change | Type | Description |
|--------|------|-------------|
| Add `board_type` to hello | **Modify** | Add `"board_type": "ai_printer"` to hello JSON |
| Handle `ready` message | **New** | Gateway confirms it's ready for ai_printer mode |
| Handle `line_art` message | **New** | Receive bitmap, decode base64, render on display |
| Handle `line_art_progress` message | **New** | Show status animation/text on display |
| Handle `line_art_transcription` message | **New** | Show what the device heard (optional) |
| Handle `line_art_error` message | **New** | Show error on display |
| Send `audio_end` message | **New** | Signal gateway to process accumulated audio |
| Send `draw` message | **New** | Text-based draw request (optional, if device has text input) |
| Button press → record → release flow | **New** | PTT-style audio capture for image requests |
| Bitmap rendering | **New** | Render 1-bit raw bitmap on display |
| Remove TTS playback | **Remove** | No speaker/audio output needed |
| Remove UDP audio reception | **Remove** | No incoming audio from gateway |
| Remove emotion/llm handlers | **Remove** | Not applicable for ai_printer |

---

## 4. Hello Message Change

### Current Cheeko Hello (device sends)

```json
{
  "type": "hello",
  "version": 3,
  "audio_params": {
    "sample_rate": 16000,
    "channels": 1,
    "codec": "opus"
  },
  "features": {}
}
```

### New AI Printer Hello (device sends)

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
  "features": {
    "display_width": 384,
    "display_height": 384
  }
}
```

**Changes:**
- Added `"board_type": "ai_printer"` — this is the routing key
- Added `display_width` and `display_height` in features (for future use if display sizes vary)
- `audio_params` stays the same — device still sends 16kHz mono Opus

### Hello Response (gateway sends back)

Same structure as Cheeko. Device parses it identically:

```json
{
  "type": "hello",
  "version": 3,
  "mode": "conversation",
  "session_id": "uuid_mac_conversation",
  "timestamp": 1711276800000,
  "transport": "udp",
  "udp": {
    "server": "192.168.1.100",
    "port": 1883,
    "encryption": "aes-128-ctr",
    "key": "a1b2c3d4e5f6...",
    "nonce": "00000000...",
    "connection_id": 12345,
    "cookie": 12345
  },
  "audio_params": {
    "sample_rate": 24000,
    "channels": 1,
    "frame_duration": 60,
    "format": "opus"
  }
}
```

**Firmware action:** Parse and store `udp.server`, `udp.port`, `udp.key`, `udp.nonce`,
`udp.connection_id` — same as Cheeko. These are needed for UDP audio sending.

> Note: `audio_params.sample_rate: 24000` is the **outgoing** (gateway→device) rate.
> AI Printer ignores this since it doesn't receive audio back.
> Device still **sends** at 16kHz as before.

---

## 5. New MQTT Messages to Handle

After hello handshake, the device subscribes to its MQTT topic and handles these messages:

### 5.1 `ready` — Server Ready

Sent by gateway after deferred setup completes. Device can now send audio.

```json
{
  "type": "ready",
  "board_type": "ai_printer",
  "session_id": "uuid_mac_conversation",
  "timestamp": 1711276800000
}
```

**Firmware action:**
- Transition from "Connecting" → "Ready" state
- Show "Ready" indicator on display (LED, icon, etc.)
- Enable the record button

### 5.2 `line_art_progress` — Processing Status

Sent while gateway/line_art is processing the request.

```json
{
  "type": "line_art_progress",
  "stage": "processing",
  "message": "Processing audio..."
}
```

```json
{
  "type": "line_art_progress",
  "stage": "generating",
  "message": "Generating line art..."
}
```

**Stage values:** `"processing"` | `"generating"`

**Firmware action:**
- Show loading animation or status text on display
- `processing` = audio is being transcribed (1-2 seconds)
- `generating` = image is being created (5-20 seconds)

### 5.3 `line_art_transcription` — What Device Said

Sent after STT completes, before image generation.

```json
{
  "type": "line_art_transcription",
  "text": "cat"
}
```

**Firmware action (optional):**
- Show the transcribed text on display (e.g., `Drawing: "cat"`)
- Helps user confirm the device heard them correctly

### 5.4 `line_art` — The Bitmap Result

The main result. Contains the 1-bit monochrome bitmap.

```json
{
  "type": "line_art",
  "raw_mono": "base64-encoded-raw-bitmap...",
  "width": 384,
  "height": 384
}
```

**Firmware action:**
- Base64 decode the `raw_mono` string into a byte array
- Render the bitmap on display (see [Section 8: Bitmap Rendering](#8-bitmap-rendering))
- Transition to "Idle" state (ready for next request)

**Payload size:** For a 384x384 image:
- Raw bitmap = 384 * 384 / 8 = 18,432 bytes
- Base64 encoded = ~24,576 characters
- Total MQTT message = ~24.7 KB (well within MQTT limits)

### 5.5 `line_art_error` — Error

Something went wrong during processing.

```json
{
  "type": "line_art_error",
  "stage": "generation",
  "message": "Image generation failed: API timeout"
}
```

**Stage values:** `"stt"` | `"generation"` | `"input"`

**Firmware action:**
- Show error message/icon on display
- Return to "Ready" state (user can try again)

### 5.6 `goodbye` — Server Disconnect (same as Cheeko)

```json
{
  "type": "goodbye",
  "session_id": "...",
  "reason": "setup_failed"
}
```

**Firmware action:** Same as Cheeko — clean up session, reconnect.

---

## 6. Audio Recording Flow

### Trigger: Button Press (Push-to-Talk)

```
User presses button
  |
  v
Start recording
  - Init Opus encoder (16kHz, mono)
  - Start capturing from microphone
  |
  v
Stream audio over UDP (same as Cheeko)
  - Encode PCM → Opus (60ms frames)
  - Build 16-byte UDP header
  - Encrypt payload with AES-128-CTR
  - Send UDP packet to gateway
  - Continue while button is held
  |
  v
User releases button
  |
  v
Stop recording
  - Stop microphone capture
  - Flush any remaining Opus frames
  |
  v
Send audio_end over MQTT
  {
    "type": "audio_end"
  }
  |
  v
Show "Processing..." on display
  - Wait for line_art_progress / line_art / line_art_error
```

### Important Notes

- **Do NOT wait for `ready` before streaming.** Audio can be buffered by gateway during
  deferred setup (same as Cheeko). But practically, user won't press button until
  the display shows "Ready".

- **Minimum recording duration:** Enforce at least ~0.5 seconds of audio.
  Very short recordings (accidental button taps) produce empty transcriptions.
  If button is held < 500ms, discard and don't send `audio_end`.

- **Maximum recording duration:** Cap at ~10 seconds. The line_art service rejects
  audio > 10MB. At Opus bitrate, 10 seconds is ~20KB — well within limits.
  Show a visual countdown or auto-stop at 10s.

---

## 7. Text Draw Command

If the device has a keypad, touchscreen, or other text input, it can skip audio entirely:

```json
{
  "type": "draw",
  "text": "cat"
}
```

Send this over MQTT. Gateway will skip STT and go directly to image generation.
Response flow is the same: `line_art_progress` → `line_art` or `line_art_error`.

---

## 8. Bitmap Rendering

### Raw Bitmap Format

The `raw_mono` field (after base64 decoding) is a headerless 1-bit monochrome bitmap:

| Property | Value |
|----------|-------|
| Width | 384 pixels (always, for now) |
| Height | Variable (from `height` field in message) |
| Color depth | 1-bit per pixel |
| Black | bit = 1 |
| White | bit = 0 |
| Bit order | MSB first (leftmost pixel = bit 7 of byte) |
| Row order | Top-down (first byte = top-left corner) |
| Bytes per row | 48 (384 pixels / 8 bits) |
| Padding | None |
| Header | None |
| Total size | `height * 48` bytes |

### Reading a Pixel

```c
// Check if pixel (x, y) is black
uint8_t byte = raw_data[y * 48 + x / 8];
bool is_black = (byte >> (7 - (x % 8))) & 1;
```

### Rendering to Display

#### For e-ink displays (SSD1680, GDEW0154M09, etc.)

Most e-ink controllers accept 1-bit packed format natively:

```c
// raw_mono is already in the correct format for most e-ink controllers
// Just write it directly to the display framebuffer
void render_line_art(const uint8_t* raw_mono, uint16_t width, uint16_t height) {
    // If display width matches (384px), write directly
    epd_set_window(0, 0, width, height);
    epd_write_data(raw_mono, height * (width / 8));
    epd_refresh();
}
```

#### For LCD/OLED displays (SSD1306, ST7789, ILI9341, etc.)

Convert 1-bit to display format:

```c
void render_line_art(const uint8_t* raw_mono, uint16_t width, uint16_t height) {
    for (uint16_t y = 0; y < height; y++) {
        for (uint16_t x = 0; x < width; x++) {
            uint8_t byte = raw_mono[y * 48 + x / 8];
            bool is_black = (byte >> (7 - (x % 8))) & 1;

            // For monochrome OLED (SSD1306):
            if (is_black) {
                display_set_pixel(x, y, WHITE);  // ink on
            } else {
                display_set_pixel(x, y, BLACK);  // ink off
            }

            // For color LCD (ST7789/ILI9341):
            // uint16_t color = is_black ? 0x0000 : 0xFFFF;
            // display_draw_pixel(x, y, color);
        }
    }
    display_update();
}
```

#### Display Size Mismatch

If the display is smaller than 384px wide, scale down:

```c
// Simple nearest-neighbor downscale
// Example: 384px source → 296px display (common e-ink size)
float scale = (float)DISPLAY_WIDTH / 384.0f;
for (uint16_t dy = 0; dy < DISPLAY_HEIGHT && dy < (uint16_t)(height * scale); dy++) {
    uint16_t sy = (uint16_t)(dy / scale);
    for (uint16_t dx = 0; dx < DISPLAY_WIDTH; dx++) {
        uint16_t sx = (uint16_t)(dx / scale);
        uint8_t byte = raw_mono[sy * 48 + sx / 8];
        bool is_black = (byte >> (7 - (sx % 8))) & 1;
        display_set_pixel(dx, dy, is_black);
    }
}
```

### Base64 Decoding on ESP32

```c
#include "mbedtls/base64.h"

// Decode base64 raw_mono from MQTT message
size_t decoded_len = 0;
// First pass: get required buffer size
mbedtls_base64_decode(NULL, 0, &decoded_len, raw_mono_b64, b64_len);

// Allocate and decode
uint8_t* bitmap = (uint8_t*)malloc(decoded_len);
mbedtls_base64_decode(bitmap, decoded_len, &decoded_len, raw_mono_b64, b64_len);

// bitmap is now ready to render
// decoded_len should equal height * 48
render_line_art(bitmap, 384, height);
free(bitmap);
```

---

## 9. State Machine

```
                    +------------------+
                    |    POWER ON      |
                    +--------+---------+
                             |
                    WiFi + MQTT connect
                             |
                    +--------v---------+
                    |   CONNECTING     |
                    |  (send hello)    |
                    +--------+---------+
                             |
                    hello response received
                             |
                    +--------v---------+
                    | WAITING_READY    |
                    | (deferred setup) |
                    +--------+---------+
                             |
                    "ready" message received
                             |
              +--------------v--------------+
              |           IDLE              |
              |  Display: "Ready" / last    |
              |  image / idle screen        |
              |  Record button: enabled     |
              +--------------+--------------+
                             |
                    Button pressed
                             |
              +--------------v--------------+
              |         RECORDING           |
              |  Display: recording icon    |
              |  Audio: streaming over UDP  |
              +--------------+--------------+
                             |
                    Button released (& duration >= 500ms)
                    Send "audio_end" MQTT
                             |
              +--------------v--------------+
              |        PROCESSING           |
              |  Display: "Processing..."   |
              |  Waiting for result         |
              +--------------+--------------+
                             |
              +---------+----+----+---------+
              |         |         |         |
        line_art   line_art  line_art   timeout
        received   _error    _progress  (60s)
              |         |         |         |
              v         v         |         v
        +---------+ +-------+    |    +---------+
        | DISPLAY | | ERROR |    |    | TIMEOUT |
        | RESULT  | |       |    |    | ERROR   |
        +---------+ +-------+    |    +---------+
              |         |        |         |
              +----+----+   (stay in       |
                   |      PROCESSING)      |
                   v                       v
              Back to IDLE            Back to IDLE
              (after 3s or button)    (show retry msg)
```

### State Details

| State | Display | Button Action | Timeout |
|-------|---------|---------------|---------|
| CONNECTING | "Connecting..." | Disabled | 30s → retry |
| WAITING_READY | "Setting up..." | Disabled | 15s → error |
| IDLE | Last image or "Ready" | Start recording | 2min inactivity → goodbye |
| RECORDING | Recording animation | Release → stop | 10s max → auto-stop |
| PROCESSING | "Processing..." / progress | Disabled (or cancel) | 60s → timeout error |
| DISPLAY_RESULT | Rendered bitmap | Press → new recording | None |
| ERROR | Error message | Press → back to IDLE | 5s → back to IDLE |

---

## 10. UDP Audio Spec (unchanged)

Identical to Cheeko. Reuse existing code.

### UDP Packet Format

```
Offset  Size    Field           Description
0       1       Version         Always 1
1       1       Flags           Always 0
2       2       Payload Length  Big-endian, Opus payload size in bytes
4       4       Connection ID   Big-endian, from hello response udp.connection_id
8       4       Timestamp       Big-endian, milliseconds since session start
12      4       Sequence        Big-endian, incrementing packet counter
16      N       Payload         AES-128-CTR encrypted Opus frame
```

Total packet size: 16 + N bytes (N is typically 50-100 for 60ms Opus frame)

### Encryption

- Algorithm: AES-128-CTR
- Key: 16 bytes from hello response `udp.key` (hex decoded)
- IV/Nonce: The 16-byte UDP header itself is used as the nonce
- Encrypt only the Opus payload (bytes 16+), not the header

### Audio Parameters (device sends)

| Parameter | Value |
|-----------|-------|
| Codec | Opus |
| Sample rate | 16000 Hz |
| Channels | 1 (mono) |
| Bit depth | 16-bit PCM (before Opus encoding) |
| Frame duration | 60ms |
| Frame size | 960 samples (16000 * 0.06) |

---

## 11. Error Handling

### Connection Errors

| Scenario | Firmware Action |
|----------|----------------|
| WiFi disconnect | Reconnect WiFi, then MQTT |
| MQTT disconnect | Reconnect to EMQX broker, re-send hello |
| Hello timeout (no response in 10s) | Retry hello, max 3 times, then show error |
| `goodbye` with `reason: "setup_failed"` | Show error, retry after 5s |
| `goodbye` with `reason: "agent_timeout"` | Show "Server busy", retry after 5s |

### Processing Errors

| Scenario | Firmware Action |
|----------|----------------|
| `line_art_error` with `stage: "stt"` | Show "Couldn't hear you, try again" |
| `line_art_error` with `stage: "generation"` | Show "Generation failed, try again" |
| `line_art_error` with `stage: "input"` | Show "Recording too short" |
| No response after 60s | Show "Timeout, try again", return to IDLE |
| `raw_mono` base64 decode fails | Show "Data error", return to IDLE |

### Audio Errors

| Scenario | Firmware Action |
|----------|----------------|
| Button held < 500ms | Discard audio, don't send `audio_end`, stay in IDLE |
| Microphone not available | Show hardware error |
| UDP send fails | Buffer locally, retry, or show connection error |

---

## 12. Hardware Assumptions

### Required Hardware

| Component | Purpose | Notes |
|-----------|---------|-------|
| ESP32 (any variant) | Main MCU | ESP32-S3 recommended for PSRAM |
| Microphone (I2S or analog) | Audio input | INMP441 or similar, 16kHz capable |
| Display (e-ink or LCD) | Bitmap rendering | Min 384px wide recommended |
| Button | Push-to-talk trigger | GPIO with pullup/debounce |
| WiFi antenna | Network connectivity | Built-in on most ESP32 modules |

### NOT Required (differs from Cheeko)

| Component | Why Not Needed |
|-----------|---------------|
| Speaker / DAC | No TTS audio playback |
| Amplifier (MAX98357A) | No audio output |
| LED ring | Optional — no emotion display needed |
| RFID reader | Not applicable |

### Memory Considerations

| Item | Size | Notes |
|------|------|-------|
| MQTT receive buffer | ~25 KB | For `line_art` message with base64 bitmap |
| Decoded bitmap | ~18 KB | 384 * 384 / 8 = 18,432 bytes |
| Opus encoder state | ~15 KB | Existing from Cheeko |
| Display framebuffer | Varies | Depends on display driver |
| **Total additional RAM** | **~60 KB** | On top of WiFi/MQTT/UDP stack |

ESP32 with PSRAM is recommended if display framebuffer is large.
ESP32 base (520KB SRAM) should be sufficient for 384x384 1-bit display.

---

## Appendix: Quick Reference — Messages

### Device Sends (MQTT)

```
hello           →  {type:"hello", version:3, board_type:"ai_printer", audio_params:{...}, features:{...}}
audio_end       →  {type:"audio_end"}
draw            →  {type:"draw", text:"cat"}
goodbye         →  {type:"goodbye", session_id:"..."}
```

### Device Sends (UDP)

```
[16-byte header][AES-encrypted Opus frame]    (while recording)
ping:timestamp                                 (keep-alive, same as Cheeko)
```

### Device Receives (MQTT)

```
hello           ←  {type:"hello", version:3, session_id:"...", udp:{...}, audio_params:{...}}
ready           ←  {type:"ready", board_type:"ai_printer", session_id:"..."}
line_art_progress    ←  {type:"line_art_progress", stage:"processing"|"generating", message:"..."}
line_art_transcription ←  {type:"line_art_transcription", text:"cat"}
line_art        ←  {type:"line_art", raw_mono:"base64...", width:384, height:384}
line_art_error  ←  {type:"line_art_error", stage:"stt"|"generation"|"input", message:"..."}
goodbye         ←  {type:"goodbye", session_id:"...", reason:"..."}
```

### Device Receives (UDP)

```
Nothing. AI Printer does not receive audio from gateway.
```
