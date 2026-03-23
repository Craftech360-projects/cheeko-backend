---
id: mqtt-protocol
sidebar_position: 2
---

# MQTT Protocol

The gateway implements MQTT 3.1.1. The protocol is asymmetric:

- **Inbound (device → gateway):** Devices publish to EMQX. EMQX republishes all device messages to `internal/server-ingest`, which the gateway subscribes to.
- **Outbound (gateway → device):** The gateway publishes directly to `devices/p2p/<fullClientId>` on EMQX, which delivers it straight to the subscribed device. No republish step.

---

## Topic Patterns

| Direction | Topic | Description |
|---|---|---|
| Device → Gateway (EMQX republishes here) | `internal/server-ingest` | All inbound device messages arrive here; the original sender client ID and payload are embedded in the envelope |
| Gateway → Device (direct, no republish) | `devices/p2p/<fullClientId>` | Gateway publishes directly to this topic; EMQX delivers straight to the device |
| Mobile app → Device (via gateway) | `app/p2p/<deviceId>` | Error/status messages forwarded from gateway to mobile app |
| Playback control (mobile/app) | `cheeko/<macAddress>/playback_control/next` | Next track control subscribed by gateway |
| Playback control (mobile/app) | `cheeko/<macAddress>/playback_control/previous` | Previous track control subscribed by gateway |

### EMQX republish envelope

All device messages arrive at `internal/server-ingest` wrapped in this envelope:

```js
{
  "sender_client_id": "GID_test@@@68_25_dd_bb_f3_a0@@@<uuid>",
  "orginal_payload": { /* original JSON message from device */ }
}
```

The gateway extracts `sender_client_id` to identify the device and `orginal_payload` as the actual message.

### Client ID format

```
GID_test@@@68_25_dd_bb_f3_a0@@@<uuid>
  │              │                 │
  group ID       MAC address       session UUID
               (underscores)
```

The MAC address uses underscores instead of colons. The gateway converts them: `parts[1].replace(/_/g, ":")`.

---

## Device → Gateway Messages

### hello

Sent when the device first connects or reconnects. Must have `"version": 3`; any other version causes the connection to close.

```js
{
  "type": "hello",
  "version": 3,
  "language": "en",          // optional; used for music/story filtering
  "audio_params": {           // optional
    "sample_rate": 16000,
    "channels": 1,
    "format": "opus"
  },
  "features": {},             // optional capability flags
  "timestamp": 1700000000000
}
```

**Gateway action:** Creates a `VirtualMQTTConnection`, sends a `hello` response immediately (< 50 ms), then starts deferred setup in the background (DB queries, LiveKit room, agent dispatch).

---

### goodbye

Sent when the device is powering off or ending the session.

```js
{
  "type": "goodbye",
  "session_id": "<uuid>_<mac>_<roomType>",
  "reason": "user_initiated",   // optional
  "timestamp": 1700000000000
}
```

**Gateway action:** Sends `disconnect_agent` to the LiveKit agent via data channel, closes the `LiveKitBridge`, and removes the device from tracking maps.

---

### abort

Sent when the device wants to interrupt current TTS playback (e.g., the user pressed the button mid-speech).

```js
{
  "type": "abort",
  "session_id": "<uuid>_<mac>_<roomType>",
  "timestamp": 1700000000000
}
```

**Gateway action:** Calls `bridge.sendAbortSignal(session_id)` to forward the abort to the LiveKit agent via data channel, then sends `tts_stop` to the device.

---

### mode-change

Sent when the user presses the mode button on the device to cycle or switch to a specific mode.

```js
{
  "type": "mode-change",
  "mode": "music"            // "conversation" | "music" | "story"
                             // omit to cycle: conversation → music → story → conversation
}
```

**Gateway action:** Cleans up the existing LiveKit room and agent, creates a new room with the new mode suffix, dispatches the appropriate agent or media bot, and sends `mode_update` back to the device.

---

### character-change

Sent when the user taps a character change button.

```js
{
  "type": "character-change",
  "characterName": "Math Tutor"   // omit to cycle to next character
}
```

**Gateway action:** Updates the character in the database via manager API, closes the old agent, dispatches the new agent (e.g., `math-tutor-agent`), streams a character-change audio cue via UDP, and sends `mode_update` with the new character name.

---

### mcp (device → gateway, response)

Sent by the device in response to an MCP tool call. Contains a JSON-RPC 2.0 result or error.

```js
{
  "type": "mcp",
  "session_id": "<uuid>_<mac>_<roomType>",
  "payload": {
    "jsonrpc": "2.0",
    "id": 42,
    "result": {
      "content": [{ "type": "text", "text": "75" }]
    }
  }
}
```

**Gateway action:** If a pending promise exists for this `id` (e.g., from a volume adjust), it resolves or rejects the promise. Otherwise, the response is forwarded to the LiveKit agent via data channel.

---

### card_lookup / start_greeting_text

Sent when the user places an RFID card on the device.

```js
{
  "type": "card_lookup",        // or "start_greeting_text"
  "rfid_uid": "A1B2C3D4",
  "sequence": 1                 // optional; which item in a pack to play
}
```

**Gateway action:** Looks up the card via `GET /toy/admin/rfid/card/lookup/{rfidUid}` on the manager API, then routes based on card type:

| Card type | Response sent |
|---|---|
| Content pack (items with `audioUrl`) | `card_content` manifest via MQTT |
| AI prompt card (no active session) | `card_ai` via MQTT |
| AI prompt card (active session) | Text forwarded to LiveKit agent |
| Q&A pack | Text forwarded to LiveKit agent |
| Unknown card | `card_unknown` via MQTT |

---

### download_request

Requests SD-card content download manifest. Legacy aliases `habit_download_request` and `rhyme_download_request` are also handled.

```js
{
  "type": "download_request",
  "rfid_uid": "A1B2C3D4",
  "current_version": "2"   // optional; gateway skips download if version matches
}
```

**Gateway action:** Fetches manifest via `GET /toy/admin/rfid/card/content/download/{rfidUid}` and responds with `download_response`.

---

### playback_control

Sent by the device or mobile app to control music/story playback.

```js
{
  "type": "playback_control",
  "action": "next"      // "next" | "previous" | "start_agent"
}
```

**Gateway action for `next`/`previous`:** Sends `tts stop`, sends a `playback_control` data channel message to the LiveKit media bot, then sends `tts start`.

**Gateway action for `start_agent`:** Dispatches or re-dispatches the agent/bot for the current mode.

---

## Gateway → Device Messages

### hello (response)

Sent immediately (< 50 ms) after receiving the device hello.

```js
{
  "type": "hello",
  "version": 3,
  "mode": "conversation",
  "session_id": "<uuid>_<mac>_conversation",
  "timestamp": 1700000000000,
  "transport": "udp",
  "udp": {
    "server": "1.2.3.4",
    "port": 1883,
    "encryption": "aes-128-ctr",
    "key": "0102030405060708090a0b0c0d0e0f10",   // hex, 32 chars
    "nonce": "0102030405060708090a0b0c0d0e0f10",  // hex, 32 chars
    "connection_id": 3735928559,
    "cookie": 3735928559
  },
  "audio_params": {
    "sample_rate": 24000,
    "channels": 1,
    "frame_duration": 60,
    "format": "opus"
  }
}
```

---

### mode_update

Sent after deferred setup completes (DB queries done) and after any mode/character change. Gives the device its authoritative mode and character.

```js
{
  "type": "mode_update",
  "mode": "conversation",          // "conversation" | "music" | "story"
  "listening_mode": "manual",      // "manual" | "auto"
  "character": "Math Tutor",       // only present in conversation mode
  "agent": "math-tutor-agent",     // only present on character change
  "session_id": "<uuid>_<mac>_conversation",
  "timestamp": 1700000000000,
  "transport": "udp",              // only present on character change
  "udp": {                         // only present on character change
    "server": "1.2.3.4",
    "port": 1883,
    "encryption": "aes-128-ctr"
  }
}
```

---

### tts

Signals TTS (text-to-speech / audio playback) state changes.

```js
// TTS starting — device should stop mic capture, light up speaker LED
{
  "type": "tts",
  "state": "start",
  "session_id": "<uuid>_<mac>_<mode>",
  "text": "Hello!",           // optional; the text being spoken
  "timestamp": 1700000000000
}

// TTS stopping — device should re-enable mic
{
  "type": "tts",
  "state": "stop",
  "timestamp": 1700000000000
}
```

---

### stt

Carries the speech-to-text transcript of what the child said (from the LiveKit agent).

```js
{
  "type": "stt",
  "text": "What is two plus two?",
  "timestamp": 1700000000000
}
```

---

### llm_thinking

Sent while the LLM is generating a response so the device can show a "thinking" animation.

```js
{
  "type": "llm_thinking",
  "timestamp": 1700000000000
}
```

---

### emotion

Carries an emotion label paired with the spoken text, used to drive LED or display animations.

```js
{
  "type": "emotion",
  "text": "That is correct!",
  "emotion": "happy",
  "timestamp": 1700000000000
}
```

---

### mcp (gateway → device, request)

Carries a JSON-RPC 2.0 tool call for the device firmware to execute (volume, LED control, status query).

```js
{
  "type": "mcp",
  "payload": {
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "self.audio_speaker.set_volume",
      "arguments": { "volume": 75 }
    },
    "id": 42
  }
}
```

Supported MCP function names:

| Function name | Arguments |
|---|---|
| `self.audio_speaker.set_volume` | `{ "volume": <0-100> }` |
| `self.audio_speaker.mute` | `{}` |
| `self.audio_speaker.unmute` | `{}` |
| `self.led.set_color` | `{ "color": "<hex>" }` |
| `self.led.set_mode` | `{ "mode": "<string>" }` |
| `self.get_device_status` | `{}` |

Volume changes are debounced at 300 ms to coalesce rapid adjustments.

---

### goodbye

Sent when the session ends due to error, inactivity timeout, or agent timeout.

```js
{
  "type": "goodbye",
  "session_id": "<uuid>_<mac>_<mode>",
  "reason": "inactivity_timeout",   // "inactivity_timeout" | "agent_timeout" | "setup_failed"
  "timestamp": 1700000000000
}
```

---

### card_content

Sent in response to a `card_lookup` for a content pack (items with audio URLs).

```js
{
  "type": "card_content",
  "rfid_uid": "A1B2C3D4",
  "skill_id": "RHYME_PACK_001",
  "skill_name": "Nursery Rhymes Vol. 1",
  "version": 3,
  "audio": [
    { "index": 1, "url": "https://cdn.example.com/rhyme1.mp3" },
    { "index": 2, "url": "https://cdn.example.com/rhyme2.mp3" }
  ],
  "images": [
    { "index": 1, "url": "https://cdn.example.com/img1.jpg" }
  ]
}
```

---

### card_unknown / card_ai

```js
// Card not found in database
{ "type": "card_unknown", "rfid_uid": "A1B2C3D4" }

// AI prompt card — device should enter conversation mode
{ "type": "card_ai", "rfid_uid": "A1B2C3D4" }
```

---

### download_response

Sent in response to a `download_request`.

```js
// Content available for download
{
  "type": "download_response",
  "status": "download_required",
  "rfid_uid": "A1B2C3D4",
  "pack_code": "HABIT_PACK_001",
  "pack_name": "Good Habits",
  "version": "3",
  "total_items": 7,
  "files": {
    "audio_1": "https://cdn.example.com/habit1.mp3",
    "audio_2": "https://cdn.example.com/habit2.mp3",
    "image_1": "https://cdn.example.com/img1.jpg"
  }
}

// Device already has this version
{ "type": "download_response", "status": "up_to_date", "rfid_uid": "A1B2C3D4", "version": "3" }

// No content linked to card
{ "type": "download_response", "status": "not_found", "rfid_uid": "A1B2C3D4" }
```

---

## Message Type Summary

### Device → Gateway

| `type` | Trigger | Gateway action |
|---|---|---|
| `hello` | Device boot or reconnect | Create session, send hello response, start deferred setup |
| `goodbye` | Device shutdown | Notify agent, close bridge, remove from maps |
| `abort` | User interrupts TTS | Forward abort to LiveKit agent, send tts stop |
| `mode-change` | Mode button pressed | Cleanup old session, create new room/agent |
| `character-change` | Character button pressed | Swap agent, send audio cue, send mode_update |
| `mcp` (response) | Reply to a tool call | Resolve pending promise or forward to agent |
| `card_lookup` / `start_greeting_text` | RFID card scanned | Lookup card, route to device or agent |
| `download_request` | Device requests SD content | Fetch manifest, send download_response |
| `playback_control` | Next/previous/start | Forward to media bot or dispatch agent |

### Gateway → Device

| `type` | When sent |
|---|---|
| `hello` | Immediately on connection (< 50 ms) |
| `mode_update` | After deferred setup completes; after mode/character change |
| `tts` (start/stop) | When AI agent begins or ends speaking |
| `stt` | When speech transcript is available |
| `llm_thinking` | While LLM is generating |
| `emotion` | Paired with spoken text |
| `mcp` (request) | To invoke device firmware functions |
| `goodbye` | On timeout, error, or session end |
| `card_content` | RFID content pack manifest |
| `card_unknown` / `card_ai` | RFID card not found or prompt card |
| `download_response` | SD card content download manifest |
