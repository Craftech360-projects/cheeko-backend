---
id: protocols
sidebar_position: 2
---

# Protocol Reference

Cheeko devices communicate with the backend over two channels:

- **MQTT** — control plane (JSON messages, bidirectional)
- **UDP** — audio plane (AES-128-CTR encrypted Opus frames, bidirectional)

## MQTT Topics

| Direction | Topic | Notes |
|-----------|-------|-------|
| Device → Gateway | `device-server` | Default publish topic from OTA response (`mqtt.publish_topic`) |
| Gateway → Device | `devices/p2p/<client_id>` | Fallback subscribe topic when OTA returns `subscribe_topic = "null"` |

`client_id` format: `GID_test@@@<MAC_no_colon>@@@<uuid>`

:::note
The OTA response `mqtt.subscribe_topic` field often contains the string `"null"`. When this is the case, the firmware must subscribe to `devices/p2p/<client_id>` instead.
:::

---

## MQTT Messages: Device → Gateway (Uplink)

### `hello`

Sent immediately after MQTT connect. Requests a UDP audio channel.

```json
{
  "type": "hello",
  "version": 3,
  "transport": "udp",
  "features": { "mcp": true },
  "audio_params": {
    "format": "opus",
    "sample_rate": 16000,
    "channels": 1,
    "frame_duration": 60
  }
}
```

| Field | Value | Notes |
|-------|-------|-------|
| `version` | `3` | Current protocol version |
| `transport` | `"udp"` | Requests UDP audio channel |
| `features.mcp` | `true` | Device supports MCP tool calls (volume, LED, etc.) |
| `audio_params.sample_rate` | `16000` | Device records at 16kHz; gateway resamples to 24kHz for LiveKit |
| `audio_params.frame_duration` | `60` | 60ms Opus frames |

### `listen` — start

```json
{
  "session_id": "abc123_AABBCCDDEEFF_conversation",
  "type": "listen",
  "state": "start",
  "mode": "manual"
}
```

`mode` values: `manual` (PTT button held) | `auto` (VAD-based) | `realtime` (continuous)

### `listen` — stop

```json
{
  "session_id": "...",
  "type": "listen",
  "state": "stop"
}
```

### `listen` — detect (wake word)

```json
{
  "session_id": "...",
  "type": "listen",
  "state": "detect",
  "text": "hey cheeko"
}
```

### `speech_end`

Sent when PTT is released or VAD detects end of speech. Firmware stops UDP uplink.

```json
{
  "session_id": "...",
  "type": "speech_end"
}
```

### `abort`

Sent to interrupt the assistant mid-speech (e.g., wake word or button press during `speaking` state).

```json
{
  "session_id": "...",
  "type": "abort",
  "reason": "wake_word_detected"
}
```

`reason` values: `wake_word_detected` | `button_pressed` | `user_interrupt`

:::warning
After sending `abort`, firmware must NOT do a full reconnect. Reuse the existing session and UDP channel, then immediately send a new `listen start`.
:::

### `goodbye`

```json
{
  "session_id": "...",
  "type": "goodbye"
}
```

### `mcp` (tool call)

Used when the AI agent invokes a device-side tool (volume, LED control, etc.).

```json
{
  "session_id": "...",
  "type": "mcp",
  "payload": {
    "id": "call_001",
    "function": "self.audio_speaker.set_volume",
    "params": { "volume": 80 }
  }
}
```

### `card_lookup`

Sent when an RFID card is tapped and the UID is not in the local SD cache.

```json
{
  "session_id": "...",
  "type": "card_lookup",
  "rfid_uid": "04A1B2C3D4"
}
```

---

## MQTT Messages: Gateway → Device (Downlink)

### `hello` (server hello)

Response to device hello. Contains UDP channel credentials.

```json
{
  "type": "hello",
  "version": 3,
  "mode": "conversation",
  "session_id": "abc123_AABBCCDDEEFF_conversation",
  "transport": "udp",
  "udp": {
    "server": "192.168.1.100",
    "port": 1883,
    "encryption": "aes-128-ctr",
    "key": "0102030405060708090a0b0c0d0e0f10",
    "nonce": "101112131415161718191a1b1c1d1e1f",
    "connection_id": 987654321,
    "cookie": 987654321
  },
  "audio_params": {
    "sample_rate": 24000,
    "channels": 1,
    "frame_duration": 60,
    "format": "opus"
  }
}
```

| Field | Notes |
|-------|-------|
| `udp.key` | AES-128-CTR key — hex string, 16 bytes (32 hex chars) |
| `udp.nonce` | AES-128-CTR nonce — hex string, 16 bytes (32 hex chars) |
| `udp.connection_id` | Included in every UDP packet header |
| `udp.cookie` | Same value as `connection_id`; duplicate for compatibility |
| `audio_params.sample_rate` | `24000` — downlink audio is 24kHz (different from 16kHz uplink) |
| `session_id` | Must be included in all subsequent MQTT messages from firmware |

:::warning
Firmware must wait a maximum of 10 seconds for the server hello. If not received, retry the hello or fall back to idle.
:::

### `mode_update`

Sent after gateway queries Manager API for device mode and character. Sent after server hello (deferred).

```json
{
  "type": "mode_update",
  "mode": "conversation",
  "listening_mode": "auto",
  "character": "Cheeko",
  "session_id": "...",
  "timestamp": 1710000000000
}
```

`mode` values: `conversation` | `music` | `story`

`listening_mode` values: `auto` | `manual` | `realtime`

`character` values: `Cheeko` | `Math Tutor` | `Riddle Solver` | `Word Ladder`

### `tts` — start

Signals firmware to transition to `speaking` state and start playing downlink UDP audio.

```json
{
  "type": "tts",
  "state": "start",
  "session_id": "...",
  "text": "Hello! I'm Cheeko."
}
```

`text` is optional and may be an empty string.

### `tts` — sentence_start

Optional. Used for on-screen transcript of assistant speech.

```json
{
  "type": "tts",
  "state": "sentence_start",
  "session_id": "...",
  "text": "Once upon a time..."
}
```

### `tts` — stop

Signals end of assistant speech. Triggers state transition based on listening mode.

```json
{
  "type": "tts",
  "state": "stop",
  "session_id": "..."
}
```

| Listening mode | Next firmware state after `tts stop` |
|----------------|--------------------------------------|
| `manual` | `idle` |
| `auto` | `listening` (auto-sends `listen start`) |
| `realtime` | `listening` (auto-sends `listen start`) |

### `stt` (user transcript)

Carries recognized speech text for on-screen display. No state change required.

```json
{
  "type": "stt",
  "text": "Tell me a story about a fox",
  "session_id": "..."
}
```

### `llm` — thinking indicator

```json
{
  "type": "llm",
  "state": "think",
  "session_id": "..."
}
```

### `llm` — text response

```json
{
  "type": "llm",
  "text": "Once upon a time, there was a clever fox...",
  "session_id": "..."
}
```

### `llm` — text with emotion

Used for facial animation, LED, or display updates.

```json
{
  "type": "llm",
  "text": "I'm so happy you asked!",
  "emotion": "happy",
  "session_id": "..."
}
```

`emotion` values: `happy` | `sad` | `thinking` | `excited` | `circle_xmark`

### `alert`

```json
{
  "type": "alert",
  "status": "error",
  "message": "Connection to AI service failed",
  "emotion": "circle_xmark",
  "session_id": "..."
}
```

### `agent_ready`

Sent when the LiveKit agent has joined the room and is ready to process audio.

```json
{
  "type": "agent_ready"
}
```

### `goodbye` (server-initiated)

```json
{
  "type": "goodbye",
  "session_id": "...",
  "reason": "inactivity_timeout"
}
```

`reason` values: `inactivity_timeout` | `error` | `disconnect` | `mode_change`

On receiving `goodbye`, firmware must: close UDP channel, reset session variables (`session_id`, crypto state), transition to `idle`, and stay MQTT-connected for the next session.

### `card_unknown`

```json
{
  "type": "card_unknown",
  "rfid_uid": "04A1B2C3D4"
}
```

### `card_ai`

```json
{
  "type": "card_ai",
  "rfid_uid": "04A1B2C3D4"
}
```

On receiving `card_ai`, firmware should prewarm the conversation channel (send `hello` if not already connected) so the session is ready before the user presses the button.

### `card_content`

Sent when a content card (story, song, habit, rhyme pack) is looked up. Firmware downloads assets to SD card.

```json
{
  "type": "card_content",
  "rfid_uid": "04A1B2C3D4",
  "skill_id": "skill_abc123",
  "skill_name": "The Hungry Fox Story",
  "version": 1,
  "audio": [
    {"index": 1, "url": "https://cdn.cheeko.ai/skills/abc123/audio/track1.mp3"},
    {"index": 2, "url": "https://cdn.cheeko.ai/skills/abc123/audio/track2.mp3"}
  ],
  "images": [
    {"index": 1, "url": "https://cdn.cheeko.ai/skills/abc123/images/page1.jpg"},
    {"index": 2, "url": "https://cdn.cheeko.ai/skills/abc123/images/page2.jpg"}
  ]
}
```

:::warning
Firmware must write `manifest.jsn` **last** after downloading all files — it is the completion marker. If the device crashes mid-download, the incomplete skill will be re-downloaded on the next tap. Download must run in a background task to keep the event loop responsive.
:::

---

## UDP Packet Format

### Header (16 bytes, big-endian)

```
Offset  Size  Type      Field           Notes
------  ----  --------  --------------- -----------------------------------------
0       1     uint8     packet_type     1 = audio packet
1       1     uint8     flags           reserved, currently 0
2-3     2     uint16be  payload_length  length of encrypted payload in bytes
4-7     4     uint32be  connection_id   from server hello udp.connection_id
8-11    4     uint32be  timestamp       milliseconds (local clock, for jitter calc)
12-15   4     uint32be  sequence        monotonically increasing per sender
```

### Payload (bytes 16 onward)

Encrypted Opus audio using **AES-128-CTR**.

- **Key:** `udp.key` from server hello (16 bytes, hex-decoded)
- **Nonce/IV:** `udp.nonce` from server hello (16 bytes, hex-decoded)
- Each packet uses the nonce modified by the sequence number for counter mode

### Uplink: Firmware → Gateway

| Parameter | Value |
|-----------|-------|
| Sample rate | 16000 Hz |
| Channels | 1 (mono) |
| Codec | Opus |
| Frame duration | 60ms |
| Frame size | 960 samples (16000 × 0.060) |

### Downlink: Gateway → Firmware

| Parameter | Value |
|-----------|-------|
| Sample rate | 24000 Hz |
| Channels | 1 (mono) |
| Codec | Opus |
| Frame duration | 60ms |

:::note
Firmware records at 16kHz. The gateway resamples uplink audio from 16kHz to 24kHz before sending to LiveKit. Assistant TTS audio comes back from LiveKit at 24kHz and is forwarded as-is to the firmware. The firmware DAC must support 24kHz playback.
:::

### Validation Rules

1. Ignore packets where `packet_type != 1`.
2. Ignore packets where the header is shorter than 16 bytes.
3. Track the remote `sequence` number; reject stale out-of-order packets.
4. Keep a local `sequence` counter for uplink; increment per packet.

---

## AES-128-CTR Encryption Notes

- Algorithm: AES-128 in CTR (counter) mode
- Key length: 128 bits (16 bytes), provided as 32 hex characters in `udp.key`
- Nonce/IV length: 128 bits (16 bytes), provided as 32 hex characters in `udp.nonce`
- The nonce is modified per packet using the `sequence` field as the counter block input
- Both uplink (device → gateway) and downlink (gateway → device) use the same key and nonce from the server hello

:::tip
The key and nonce are session-scoped — they are generated fresh by the gateway for each device hello and delivered in the server hello response. A new hello exchange produces new credentials.
:::
