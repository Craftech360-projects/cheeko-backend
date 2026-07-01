# AI Imagine — Device ⇄ Server Wire Contract (MQTT + UDP)

The full message contract to implement **AI Imagine** on the device. It reuses the
existing **AI-Chat** transport unchanged — **MQTT** for JSON control, **UDP** for Opus
audio. Only two things are new: the `feature:"ai_imagine"` flag on the `hello`, and the
`image` / `image_status` / `image_error` server→device messages.

Legend: **(existing)** = same as AI Chat, unchanged. **(NEW)** = added for AI Imagine.

---

## 0. Transport & topics

- **Control plane:** JSON text over **MQTT**.
  - **Server → Device:** topic `devices/p2p/<client_id>` where
    `client_id = GID_<group>@@@<MAC>@@@<uuid>` (e.g. `GID_test@@@3C_0F_02_D3_6A_E8@@@<uuid>`).
  - **Device → Server:** the device publishes to its uplink topic; the gateway ingests it
    and every message carries the device's `session_id` (below). This is unchanged from AI Chat.
- **Audio plane:** **Opus** frames over **UDP**, encrypted **AES-128-CTR** (§3).
- `session_id` (from the server `hello`) is echoed on **every** device→server message.

---

## 1. Session handshake

### 1.1 Device → Server — `hello`  (feature field is **NEW**)

```json
{
  "type": "hello",
  "version": 3,
  "transport": "udp",
  "feature": "ai_imagine",
  "features": { "mcp": true },
  "audio_params": { "format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60 }
}
```

| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `type` | string | yes | `"hello"` |
| `version` | int | yes | protocol version, `3` |
| `transport` | string | yes | `"udp"` |
| **`feature`** | string | **NEW** | **`"ai_imagine"`** → whole session is image-mode (spec Option A). Omit for AI Chat / AI Printer. |
| `features` | object | yes | capability flags, unchanged |
| `audio_params` | object | yes | mic audio: Opus, 16 kHz, mono, 60 ms frames |

> The `feature` flag is **session-level**: every utterance in this session is an image
> request. To do normal chat again, the device opens a **new** session without the flag.

### 1.2 Server → Device — `hello` (grants UDP channel)  **(existing)**

```json
{
  "type": "hello",
  "version": 3,
  "mode": "conversation",
  "session_id": "179213e8-…_3C0F02D36AE8_conversation",
  "transport": "udp",
  "udp": {
    "server": "192.168.0.193",
    "port": 8884,
    "encryption": "aes-128-ctr",
    "key": "d856c7fa16ca45fbce6d297981c35271",
    "nonce": "010000005495ea740000000000000000",
    "connection_id": 1419111028,
    "cookie": 1419111028
  },
  "audio_params": { "sample_rate": 24000, "channels": 1, "frame_duration": 60, "format": "opus" }
}
```

- `session_id` — echo on every subsequent device→server message.
- `udp.key` — 16-byte AES key (hex). `udp.nonce` — 16-byte header template (hex); the
  `connection_id` is bytes 4–7 of the nonce.
- Return audio is 24 kHz, but **AI Imagine sends no TTS**, so the device does not need the
  speaker/playback path for this feature.

---

## 2. Device → Server control messages

### 2.1 `listen` / `start` — begin capturing  **(existing)**
Sent when the child presses the knob to talk.
```json
{ "session_id": "…", "type": "listen", "state": "start", "mode": "manual" }
```
- `mode` is `"manual"` (Cheeko press-to-talk). No `feature` needed here (Option A).
- Server side: a fresh `listen/start` **resets** the utterance buffer.

### 2.2 Audio frames — Opus over UDP  **(existing)** — see §3.

### 2.3 `speech_end` — finished speaking  **(existing, = the image trigger)**
Sent when the child releases the knob.
```json
{ "type": "speech_end", "session_id": "…" }
```
This is what triggers image generation. (`listen`/`state:"stop"` is also accepted as the trigger.)

### 2.4 `listen` / `stop`, `abort`, `goodbye`  **(existing)**
```json
{ "session_id": "…", "type": "listen", "state": "stop" }
{ "session_id": "…", "type": "abort" }
{ "session_id": "…", "type": "goodbye" }
```
- **Do NOT send `goodbye` between `speech_end` and the terminal `image`/`image_error`** —
  it ends the session and the result is dropped. `goodbye` is for leaving Imagine entirely.

---

## 3. UDP audio plane  **(existing)**

Each UDP datagram = **16-byte header** + **AES-128-CTR-encrypted Opus payload**.

### 3.1 Header (16 bytes, big-endian) — struct `>BBHIII`

| Off | Size | Field | Value |
|-----|------|-------|-------|
| 0 | 1 | `packet_type` | `0x01` (audio) |
| 1 | 1 | `flags` | `0x00` |
| 2 | 2 | `payload_len` | length of the Opus payload |
| 4 | 4 | `connection_id` | from server `hello` (nonce bytes 4–7) |
| 8 | 4 | `timestamp` | sender timestamp |
| 12 | 4 | `sequence` | incrementing per packet |

### 3.2 Encryption
- Cipher: **AES-128-CTR**, key = `udp.key`. **The 16-byte header is used as the CTR
  IV/counter block.**
- `encrypted = AES_CTR(key, iv=header).encrypt(opus_frame)`
- Wire datagram = `header || encrypted`.
- First packet after the server `hello` is a `ping:<session_id>` (encrypted the same way)
  to open the NAT path; then Opus frames flow at the 60 ms cadence.

---

## 4. Server → Device messages

### 4.1 `image_status` — progress  **(NEW)**
```json
{ "type": "image_status", "session_id": "…", "request_id": "img_ab12cd34", "state": "generating" }
```
- Sent shortly after `speech_end`. Show a "still imagining…" screen and keep waiting.
- `state` ∈ `queued | generating | uploading` (currently only `generating` is emitted).

### 4.2 `image` — the generated picture  **(NEW, terminal-success)**
```json
{
  "type": "image",
  "session_id": "…",
  "request_id": "img_ab12cd34",
  "url": "https://cdn.cheekoai.in/imagine/<uuid>.jpg",
  "mime": "image/jpeg",
  "width": 320,
  "height": 240,
  "caption": "a beautiful cat"
}
```
- **HTTPS GET `url`** → decode baseline JPEG (≤320×240, ≤~200 KB, 24-bit RGB) → display
  full-screen. Fetch promptly (the object may expire ~1 day).
- `caption` optional.

### 4.3 `image_error` — generation failed  **(NEW, terminal-failure)**
```json
{ "type": "image_error", "session_id": "…", "request_id": "img_ab12cd34",
  "code": "no_speech", "message": "…" }
```
| `code` | Meaning | Suggested device copy |
|--------|---------|-----------------------|
| `no_speech` | no audio / empty transcription | "I didn't hear you — try again!" |
| `safety_block` | prompt not child-safe | "Let's imagine something else!" |
| `generation_failed` | model/internal/timeout | "Hmm, that didn't work. Try again!" |
| `rate_limited` | too fast / upstream 429 | "One at a time — try again in a moment." |

---

## 5. End-to-end sequence

```
1.  Child selects "IMAGINE" in the menu.
2.  Device → Server (MQTT): hello { feature:"ai_imagine" }
3.  Server → Device (MQTT): hello { session_id, udp:{…} }
4.  Device → Server (UDP):  ping:<session_id>            (open NAT)
5.  Child presses knob:
    Device → Server (MQTT): listen { state:"start", mode:"manual" }
6.  Child speaks:
    Device → Server (UDP):  Opus frames (AES-128-CTR)
7.  Child releases knob:
    Device → Server (MQTT): speech_end                   ← trigger
8.  Server → Device (MQTT): image_status { generating }  (optional)
9.  Server → Device (MQTT): image { url }  |  image_error { code }
10. Device: HTTPS GET url → decode JPEG → display full-screen + caption.
11. Press knob → back to step 5 for another image, or goodbye to exit.
```

---

## 6. Rules the server enforces (device must respect)

- **Session-level mode:** `feature:"ai_imagine"` on the `hello` fixes the whole session to
  image mode. One session = one mode.
- **One image at a time:** a new `speech_end` while an image is still generating is ignored.
  Disable the capture control until `image`/`image_error` (or timeout).
- **Cooldown:** requests <2 s apart return `image_error{code:"rate_limited"}`.
- **Timeout:** server budget is ~90 s (config `IMAGINE_TIMEOUT_MS`). The device should wait
  **≥ the server budget** and show progress via `image_status`. Do not `goodbye` while waiting.
- **Fresh utterance:** each `listen/start` clears buffered audio; a knob-press with no speech
  yields `image_error{code:"no_speech"}`.

---

## 7. What's new vs AI Chat (summary)

| Message | Change |
|---------|--------|
| `hello` (device→server) | add `feature:"ai_imagine"` |
| `image` (server→device) | NEW — §4.2 |
| `image_status` (server→device) | NEW — §4.3 (4.1) |
| `image_error` (server→device) | NEW — §4.3 |
| everything else (udp/opus/listen/speech_end/goodbye) | unchanged |
