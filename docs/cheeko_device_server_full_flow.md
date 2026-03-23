# Cheeko Device End-to-End Integration Flow

## Scope
This document maps the **actual runtime flow** across:
- Firmware: `D:\cheekov2-hardware`
- Manager API: `D:\cheeko-backend\main\manager-api-node`
- MQTT/UDP Gateway: `D:\cheeko-backend\main\mqtt-gateway`
- LiveKit Worker: `D:\cheeko-backend\main\livekit-server\workers\cheeko_worker.py`

It covers:
- API calls
- MQTT message contracts
- UDP handshake and packet format
- state changes (idle/listening/speaking/etc.)
- RFID branches (local SD, server lookup, AI/prompt routing)

---

## 1) High-Level Runtime Sequence

### 1.1 Boot -> OTA -> Activation -> Protocol Init
1. Device boots and connects Wi-Fi.
2. Firmware enters `activating` and calls OTA check:
   - `POST /toy/ota/`
   - headers include `Activation-Version`, `Device-Id`, `Client-Id`, optional `Serial-Number`.
3. OTA response may include:
   - `activation` (if unregistered/unbound)
   - `firmware` (if update available)
   - `mqtt` (broker + credentials + topics)
   - `websocket` (fallback transport)
   - `server_time`
4. If activation challenge exists, firmware loops `POST /toy/ota/activate` until success.
5. Firmware initializes protocol:
   - prefer MQTT when OTA contains `mqtt`
   - else WebSocket

### 1.2 MQTT hello + UDP channel setup
1. Device MQTT-connects using OTA credentials.
2. Device sends MQTT `{"type":"hello", ... "transport":"udp"}`.
3. Gateway immediately returns MQTT `hello` with:
   - `session_id`
   - UDP server/port
   - AES-CTR key/nonce
   - `audio_params`
4. Device opens UDP channel and starts encrypted audio packet exchange.

### 1.3 Deferred setup in gateway
After fast hello, gateway resolves in background:
- device mode (`conversation|music|story`)
- listening mode (`auto|manual`)
- current character
- child profile
- memories

Then it sends `mode_update` to device and dispatches LiveKit agent/bot.

### 1.4 Conversation loop
- Device enters listening and sends `listen start`.
- Device streams mic audio over UDP.
- On PTT end (or logic end), device sends `speech_end`.
- Gateway/LiveKit returns:
  - `tts start` -> device enters speaking
  - `stt`/`llm` text updates for display
  - `tts stop` -> device returns idle or listening depending on mode

---

## 2) API Contracts

## 2.1 Device Firmware -> Manager API

### A) OTA check
- **Endpoint**: `POST /toy/ota/`
- **Headers used by server**:
  - `Device-Id` (MAC)
  - `Client-Id`
- **Response format**: raw JSON (not `{code,msg,data}`)

Example response:
```json
{
  "server_time": {
    "timestamp": 1710000000000,
    "timeZone": "Asia/Kolkata",
    "timezone_offset": 330
  },
  "firmware": {
    "version": "1.2.3",
    "url": "http://.../toy/otaMag/download/<id>",
    "force": 0
  },
  "websocket": { "url": "ws://..." },
  "mqtt": {
    "broker": "...",
    "port": 1883,
    "endpoint": "host:port",
    "client_id": "GID_test@@@AA_BB_CC_DD_EE_FF@@@<uuid>",
    "username": "...",
    "password": "...",
    "publish_topic": "device-server",
    "subscribe_topic": "null"
  },
  "activation": {
    "code": "123456",
    "message": "<frontend_url>\n123456",
    "challenge": "AA:BB:CC:DD:EE:FF"
  }
}
```

### B) Activation check
- **Endpoint**: `POST /toy/ota/activate`
- **Behavior**:
  - HTTP `200` + body `"success"` => activated/known device
  - HTTP `202` => not activated yet (firmware retries)

### C) Firmware binary download
- OTA response gives URL under `/toy/otaMag/download/<id>`.
- Firmware has OTA upgrade implementation, but current activation flow logs new version and skips auto-upgrade unless upgrade path is explicitly invoked.

---

## 2.2 MQTT Gateway -> Manager API (device context)

All below are called by gateway while handling device hello/mode/rfid flows:

1. `GET /toy/device/:mac/mode`
- returns `{code:0,data:"conversation|music|story"}`

2. `GET /toy/device/:mac/device-mode`
- returns `{code:0,data:"auto|manual"}`

3. `POST /toy/device/:mac/cycle-mode`
- returns `{code:0,data:{mode,previousMode}}`

4. `GET /toy/agent/device/:mac/current-character`
- returns `{code:0,data:{characterName:"..."}}`

5. `POST /toy/agent/device/:mac/set-character`
- body `{characterName:"..."}`
- returns `{code:0,data:{success:true,newModeName:"..."}}`

6. `POST /toy/agent/device/:mac/cycle-character`
- returns `{code:0,data:{success:true,newModeName:"..."}}`

7. `POST /toy/config/child-profile-by-mac`
- body `{macAddress:"..."}`

8. `GET /toy/device/:mac/playlist/music`
9. `GET /toy/device/:mac/playlist/story`

10. `GET /toy/admin/rfid/card/lookup/:rfidUid`
- card metadata/prompt/content-pack items

11. `GET /toy/admin/rfid/card/content/download/:rfidUid`
- download manifest for full content pack

---

## 3) MQTT Topics and Message Contracts

## 3.1 Topics

### Device publish topic
- from OTA: usually `device-server`

### Device subscribe topic
- from OTA: often `"null"`
- firmware fallback builds: `devices/p2p/{client_id}`

### EMQX internal republish ingress to gateway
- gateway subscribes: `internal/server-ingest`
- expected envelope keys:
  - `sender_client_id`
  - `orginal_payload` (typo in key is used as-is)

### Gateway -> device publish topic
- `devices/p2p/{clientId}`

---

## 3.2 Device -> Gateway MQTT messages

1. `hello`
```json
{
  "type": "hello",
  "version": 3,
  "transport": "udp",
  "features": { "mcp": true },
  "audio_params": { "format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60 }
}
```

2. `listen` (speech state)
```json
{"session_id":"...","type":"listen","state":"start","mode":"realtime|auto|manual"}
{"session_id":"...","type":"listen","state":"stop"}
{"session_id":"...","type":"listen","state":"detect","text":"<wake_word>"}
```

3. `speech_end`
```json
{"session_id":"...","type":"speech_end"}
```

4. `abort`
```json
{"session_id":"...","type":"abort","reason":"wake_word_detected"}
```

5. `goodbye`
```json
{"session_id":"...","type":"goodbye"}
```

6. `mcp`
```json
{"session_id":"...","type":"mcp","payload":{...}}
```

7. `card_lookup`
```json
{"session_id":"...","type":"card_lookup","rfid_uid":"<UID>"}
```

---

## 3.3 Gateway -> Device MQTT messages

1. `hello` (server hello)
```json
{
  "type": "hello",
  "version": 3,
  "mode": "conversation|music|story",
  "session_id": "<uuid>_<macNoColon>_<mode>",
  "transport": "udp",
  "udp": {
    "server": "<public-ip>",
    "port": 1883,
    "encryption": "aes-128-ctr",
    "key": "<hex>",
    "nonce": "<hex>",
    "connection_id": 123,
    "cookie": 123
  },
  "audio_params": { "sample_rate": 24000, "channels": 1, "frame_duration": 60, "format": "opus" }
}
```

2. `mode_update`
```json
{
  "type": "mode_update",
  "mode": "conversation|music|story",
  "listening_mode": "auto|manual",
  "character": "Cheeko",
  "session_id": "...",
  "timestamp": 1710000000000
}
```

3. TTS/STT/LLM/UI messages
```json
{"type":"tts","state":"start","session_id":"...","text":"optional"}
{"type":"tts","state":"sentence_start","session_id":"...","text":"..."}
{"type":"tts","state":"stop","session_id":"..."}
{"type":"stt","text":"...","session_id":"..."}
{"type":"llm","state":"think","session_id":"..."}
{"type":"llm","text":"...","session_id":"..."}
{"type":"llm","text":":)","emotion":"happy","session_id":"..."}
```

4. Session/control
```json
{"type":"goodbye","session_id":"...","reason":"inactivity_timeout"}
{"type":"alert","status":"error","message":"...","emotion":"circle_xmark","session_id":"..."}
{"type":"agent_ready"}
```

5. RFID responses
```json
{"type":"card_unknown","rfid_uid":"..."}
{"type":"card_ai","rfid_uid":"..."}
{
  "type":"card_content",
  "rfid_uid":"...",
  "skill_id":"...",
  "skill_name":"...",
  "version":1,
  "audio":[{"index":1,"url":"..."}],
  "images":[{"index":1,"url":"..."}]
}
```

6. Legacy content download response path (gateway supported)
```json
{"type":"download_response","status":"not_found","rfid_uid":"..."}
{"type":"download_response","status":"up_to_date","rfid_uid":"...","pack_code":"...","version":"..."}
{"type":"download_response","status":"download_required","rfid_uid":"...","pack_code":"...","files":{...}}
{"type":"download_response","status":"error","rfid_uid":"...","message":"..."}
```

---

## 3.4 Gateway <-> LiveKit Data Channel (internal)

Gateway publishes to agent:
- `ptt_event` (mapped from device `listen`)
- `speech_end`
- `abort`
- `disconnect_agent`
- `ready_for_greeting`
- `end_prompt`
- `user_text` (RFID Q&A/prompt routing)
- `mcp` (forwarded tool payloads)

Agent/worker publishes back events (consumed by gateway bridge):
- `agent_state_changed` (e.g. speaking -> listening)
- `speech_created`
- user/agent transcription streams (`lk.transcription`, `lk.agent.events`)

Worker `cheeko_worker.py` explicitly handles `data_received` types:
- `ready_for_greeting`
- `end_prompt`
- `shutdown_request`
- `user_text`

---

## 4) UDP Audio Transport

## 4.1 Negotiation
- Negotiated via MQTT `hello`/`hello` response.
- Encryption: `aes-128-ctr`.
- Key + nonce supplied in server hello.

## 4.2 Packet format (16-byte header + encrypted payload)
- byte 0: `type` (audio = `1`)
- byte 1: flags/reserved
- bytes 2-3: payload length (uint16 BE)
- bytes 4-7: connection_id (uint32 BE)
- bytes 8-11: timestamp (uint32 BE)
- bytes 12-15: sequence (uint32 BE)
- bytes 16..: encrypted opus payload

Both firmware and gateway use this same header structure.

---

## 5) RFID + SD Card Flow

## 5.1 Local-first behavior
1. Card tapped.
2. Firmware ContentManager checks local `cardmap.jsn`.
3. If mapped and skill downloaded (`manifest.jsn` exists), plays from SD immediately:
   - audio from `/sdcard/cheeko/skills/<skill_id>/audio/*.mp3`
   - images from `/sdcard/cheeko/skills/<skill_id>/images/*`

## 5.2 Unknown card -> server lookup -> download -> play
1. Unknown card triggers `card_lookup` MQTT.
2. Gateway calls manager `GET /toy/admin/rfid/card/lookup/:uid`.
3. Gateway returns one of:
   - `card_unknown`
   - `card_ai`
   - `card_content`
4. On `card_content`, firmware downloads files to SD, writes `manifest.jsn` last, updates `cardmap.jsn`, then plays.

## 5.3 AI card behavior
- If known AI card: firmware prewarms channel in idle.
- If server marks card as AI (`card_ai`), firmware stores AI mapping and can start conversation flow.

## 5.4 Prompt/Q&A routing
- Gateway may route RFID prompt/Q&A as `user_text` to LiveKit agent (instead of direct SD playback) depending on card shape/content.

---

## 6) Device State Machine and Runtime Behavior

State names in firmware:
- `unknown`, `starting`, `wifi_configuring`, `idle`, `connecting`, `listening`, `speaking`, `upgrading`, `activating`, `audio_testing`, `fatal_error`

Important runtime behaviors:

1. `idle -> connecting -> listening`
- when chat starts and channel not open

2. `listening -> speaking`
- on inbound `tts start`

3. `speaking -> idle or listening`
- on inbound `tts stop`
- manual mode => `idle`
- auto/realtime => `listening`

4. Push-to-talk end
- in listening, button triggers `speech_end`
- firmware stops mic processing and shows "thinking" while waiting for reply

5. Timeouts
- listening timeout: 30s no voice => close channel + idle
- thinking timeout: 20s no server reply after `speech_end` => close channel + idle

6. Card removal
- stops media playback
- clears playlist/images
- cancels prewarm or AI session as applicable

7. Encoder button behavior (jiuchuan board)
- in `listening`: sends `speech_end` (end user turn)
- in `speaking`: sends `abort` (interrupt assistant)
- in `connecting`: cancels chat attempt
- in `idle` + prewarmed: starts instant chat
- in `idle` + content card: MP3 play/pause/next

---

## 7) Message Semantics for Speaking/Listening

1. `type: "tts", state: "start"`
- meaning: assistant audio begins
- device behavior: enter `speaking`

2. `type: "tts", state: "stop"`
- meaning: assistant audio complete/interrupted
- device behavior: return to `idle` or `listening` (by mode)

3. `type: "stt"`
- carries recognized user text for display
- **no `stt start/stop` state exists in current firmware handler**

4. `type: "llm", state: "think"`
- indicates agent thinking phase

5. `type: "listen", state: "start|stop|detect"` (device -> server)
- start listening / stop listening / wake-word detect event

6. `type: "speech_end"` (device -> server)
- explicit end-of-user-turn signal (especially for PTT)

7. Listening mode source in current firmware
- default mode is derived locally from AEC config:
  - AEC off -> `auto`
  - AEC on/server-side -> `realtime`
- manual stop mode is used by explicit button-driven `StartListening()`
- `mode_update.listening_mode` is sent by gateway but is not currently consumed in firmware incoming JSON handler

---

## 8) Observed Integration Gaps / Important Notes

1. `mode_update` consumption on firmware
- Gateway sends `mode_update`, but firmware incoming handler does not currently implement a `mode_update` branch.

2. Download-request path mismatch
- Gateway supports `download_request` / `download_response` flow.
- Current firmware code path shown here uses `card_lookup` + `card_content` download logic, not `download_request`.

3. LiveKit worker data-channel coverage
- Gateway emits `ptt_event`, `speech_end`, `abort`, `disconnect_agent`.
- `cheeko_worker.py` explicit handler currently processes only `ready_for_greeting`, `end_prompt`, `shutdown_request`, `user_text`.

4. OTA update behavior
- Firmware has upgrade implementation, but current activation flow logs new firmware availability and skips automatic upgrade by default.

---

## 9) Practical End-to-End Flow (Your Intended Behavior)

## 9.1 Boot and activation
1. Device checks OTA.
2. If not activated, shows activation code and retries activate.
3. After success, uses OTA `mqtt` config to connect gateway.

## 9.2 Start conversation
1. Device sends `hello`, receives UDP params.
2. Device enters listening and streams audio.
3. Agent response comes via `tts start` / `tts stop`.

## 9.3 RFID content
1. Tap card.
2. If content exists on SD: play immediately.
3. If not on SD: send `card_lookup`, gateway returns metadata/content.
4. Firmware downloads, saves under `/sdcard/cheeko/skills/<skill_id>/...`, updates map, then plays.

## 9.4 RFID AI/prompt
1. AI card triggers conversation mode/prewarm.
2. Prompt/Q&A cards can be routed to LiveKit as `user_text` for generated response.

---

## 10) Source Anchors (for verification)

Key files used:
- `D:\cheekov2-hardware\main\ota.cc`
- `D:\cheekov2-hardware\main\application.cc`
- `D:\cheekov2-hardware\main\protocols\protocol.cc`
- `D:\cheekov2-hardware\main\protocols\mqtt_protocol.cc`
- `D:\cheekov2-hardware\main\device_state_machine.cc`
- `D:\cheekov2-hardware\main\boards\common\content_manager.cc`
- `D:\cheekov2-hardware\main\boards\jiuchuan-s3\jiuchuan_dev_board.cc`
- `D:\cheeko-backend\main\manager-api-node\src\routes\ota.routes.js`
- `D:\cheeko-backend\main\manager-api-node\src\services\device.service.js`
- `D:\cheeko-backend\main\manager-api-node\src\routes\device.routes.js`
- `D:\cheeko-backend\main\manager-api-node\src\routes\agent.routes.js`
- `D:\cheeko-backend\main\manager-api-node\src\routes\config.routes.js`
- `D:\cheeko-backend\main\manager-api-node\src\routes\rfid.routes.js`
- `D:\cheeko-backend\main\mqtt-gateway\gateway\mqtt-gateway.js`
- `D:\cheeko-backend\main\mqtt-gateway\mqtt\virtual-connection.js`
- `D:\cheeko-backend\main\mqtt-gateway\livekit\livekit-bridge.js`
- `D:\cheeko-backend\main\livekit-server\workers\cheeko_worker.py`
- `D:\cheeko-backend\main\livekit-server\src\shared\entrypoint_utils.py`
