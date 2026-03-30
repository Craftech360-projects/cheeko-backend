---
id: cheeko-agent
sidebar_position: 2
---

# Cheeko Agent (Main Conversation Worker)

`workers/cheeko_worker.py` is the primary conversational agent. It handles free-form voice conversation, RFID card interactions (rhymes, animal sounds, story prompts), and mode switching to game workers. It runs as a LiveKit agent worker registered under the name `cheeko-agent` on port 8081.

## Agent Class

```python
class CheekoAssistant(BaseAssistant):
    GREETING_INSTRUCTION = "Greet the user warmly as Cheeko, a friendly AI companion. Keep it brief and playful."
```

`CheekoAssistant` extends `BaseAssistant` (from `src/shared/base_assistant.py`). The only feature enabled at runtime is mode switching:

```python
assistant.enable_mode_switching()
```

Battery tools and volume tools are present in the base class but are commented out in cheeko_worker. Music service is also disabled (commented out throughout).

## Entrypoint and Prewarm

The `prewarm(proc)` function runs once per worker process at startup. In cheeko_worker it is minimal — it only sets `proc.userdata["ready"] = True` and logs. (The game workers also cache `yaml_config`, `realtime_config`, and a `DatabaseHelper` instance in prewarm to avoid re-parsing per job.)

The `entrypoint(ctx: JobContext)` function runs for each incoming job (one LiveKit room connection). The initialization sequence is:

1. Load `GOOGLE_API_KEY` from `config.yaml` if not already in environment
2. Parse room name to extract `device_mac` and `room_type` via `parse_room_name()`
3. Read dispatch metadata from `ctx.job.metadata` (JSON) — child profile and Mem0 memories injected by MQTT gateway
4. Make parallel API calls with `asyncio.gather()`:
   - `db_helper.get_agent_id(device_mac)` — fetch agent ID
   - `prompt_service.get_prompt_and_config(room_name, device_mac)` — fetch prompt + TTS config
   - `db_helper.get_child_profile_by_mac(device_mac)` — fetch child profile (skipped if already in dispatch metadata)
5. Render prompt with child profile and memories using Jinja2 via `render_prompt_with_profile()`
6. Instantiate `google.realtime.RealtimeModel` with the rendered prompt
7. Attach `elevenlabs.TTS` and `google.tools.GoogleSearch` to the `AgentSession`
8. Register event handlers, usage tracker, and error handler
9. Duplicate agent check: if another agent is already in the room, disconnect and exit
10. `await ctx.connect()` then `await ctx.wait_for_participant()`
11. `await session.start()` with 16 kHz mono audio input

## Config Fetched from Manager API

| API Endpoint | What is fetched |
|-------------|-----------------|
| `POST /config/agent-prompt` | Agent system prompt text for this device |
| `POST /config/agent-models` | Model config: TTS provider/voice, LLM settings |
| `GET /agent/id/{mac}` | `agent_id` used for analytics and chat history |
| `GET /device/child-profile/{mac}` | Child name, age, preferences for prompt personalization |

The prompt is rendered as a Jinja2 template using child profile fields (`child_name`, `child_age`, etc.) and Mem0 memories injected as template variables.

## Data Channel Message Handling

All data channel messages arrive via the `data_received` room event and are decoded as JSON. The `type` field determines the handler:

| `type` value | Payload fields | What it triggers |
|-------------|----------------|-----------------|
| `ready_for_greeting` | — | Calls `assistant.play_greeting()` — agent delivers its opening line |
| `end_prompt` | `prompt` (string) | Calls `session.generate_reply(instructions=prompt_text)` with 10s timeout, then cleanup begins |
| `shutdown_request` | `require_ack` (bool), `session_id` | Optionally publishes `shutdown_ack` back to gateway, then calls `cleanup_room_and_session()` |
| `user_text` | `content_type`, `text`, `title`, `content_text`, `rfid_uid`, `sequence`, `audio_file` | RFID card interaction — see below |
| `playback_control` | `action` (`next`) | Stops current audio player (music skip — currently commented out) |

### `user_text` Content Types

The `user_text` message is sent by the MQTT gateway when an RFID card is scanned. The `content_type` field selects the handling path:

| `content_type` | Behaviour |
|---------------|-----------|
| `animal` | Generates ElevenLabs TTS for the description, plays it; then plays a local MP3 animal sound (derived from `title` or `audio_file` field) on the same audio track |
| `read_only` | Generates ElevenLabs TTS for `content_text` (e.g. a nursery rhyme); optionally caches the audio to S3 via `rhyme_cache_service` and sends a `rhyme_cached` data channel notification to firmware |
| `prompt` | Sends `text` directly to Gemini via `session.generate_reply(instructions=text)` |

ElevenLabs failures in all paths fall back to Gemini via `session.generate_reply()`.

## LLM Pipeline

Cheeko uses Google Gemini Realtime (`google.realtime.RealtimeModel`) with `modalities=["AUDIO"]`. There is no separate STT or TTS step — Gemini handles both natively in the realtime session. The pipeline is:

```
ESP32 mic audio (16kHz mono PCM)
  → MQTT gateway (Opus decode → 16kHz PCM)
  → LiveKit room (16kHz audio track)
  → AgentSession (Gemini Realtime)
  → Gemini native audio output (48kHz)
  → LiveKit room (agent audio track)
  → MQTT gateway (resample 48kHz → 24kHz, Opus encode)
  → ESP32 speaker
```

ElevenLabs TTS (`elevenlabs.TTS`) is attached to the session for use by `session.say()` only (pre-synthesized rhyme/animal audio). It does not replace Gemini's native voice output.

## MCP Tool Integration

MCP (Model Control Protocol) is used for device hardware control. The `src/mcp/mcp_handler.py` module provides the handler functions; the underlying client (`LiveKitMCPClient`) sends function calls as data channel messages to the MQTT gateway, which relays them to the ESP32.

Defined MCP function calls:

| Function | Arguments | Purpose |
|---------|-----------|---------|
| `self_set_volume` | `volume` (0–100) | Set device volume |
| `self_volume_up` | `step` | Increase volume by step |
| `self_volume_down` | `step` | Decrease volume by step |
| `self_get_volume` | — | Query current volume |
| `self_mute` / `self_unmute` | — | Mute/unmute device |
| `self_set_light_color` | `red`, `green`, `blue` | Set LED color |
| `self_set_light_mode` | `mode` | Set LED mode (rainbow, default, custom) |
| `set_rainbow_speed` | `speed_ms` | Set rainbow animation speed |
| `self_get_battery_status` | — | Query battery level |

In cheeko_worker, MCP tools are enabled through `BaseAssistant` but battery and volume tools are commented out at runtime. The `update_agent_mode` function tool (from `src/features/mode_switching.py`) is the only LLM-callable tool active in the cheeko session.

## Prompt Loading

`PromptService` in `src/services/prompt_service.py` manages prompt retrieval:

1. If `read_config_from_api: false` in `config.yaml`, the default prompt from `config.yaml` is used
2. Otherwise, prompts are fetched from Manager API using the device MAC address
3. Cache is always cleared at the start of a cheeko session (`prompt_service.clear_cache()`)
4. The prompt is a Jinja2 template; `render_prompt_with_profile()` injects `child_name`, `child_age`, long-term memories, memory relations, and memory entities

An enhanced template system (`PromptManager`) can fetch a `template_id` per device and render a structured prompt, but this falls back to the legacy method if the template system is not initialized.

## Mem0 Memory Injection

At runtime, cheeko_worker monitors each user speech turn for memory-relevant keywords. If a trigger is detected, it searches Mem0 asynchronously and injects the results into the conversation via `session.generate_reply()`:

```python
MEMORY_TRIGGER_PATTERNS = [
    ("story", ["story about", "tell me a story", "tell a story"]),
    ("remember", ["do you remember", "remember my", "remember when"]),
    ("family", ["about my", "my dog", "my cat", "my pet", ...]),
    ("question", ["what's my", "who is my", "what is my"]),
]
```

For `story`, `remember`, and `question` categories, the found memories are injected with `generate_reply(instructions=...)`. For other categories, the memories are logged but the response relies on the prompt-level context. A 5-second cooldown prevents concurrent injections.

## Analytics Logging

`UsageManager` (from `src/utils/helpers.py`) subscribes to the `metrics_collected` session event and accumulates token counts and TTFT (time to first token) per turn. On session close, it calls `usage_manager.log_session_summary()` which POSTs usage data to Manager API.

Chat history is extracted from the session at cleanup time via `extract_and_send_chat_history()`, which also sends new memories to Mem0 (hence the 20s timeout).

## Audio State Management

`AudioStateManager` (`src/utils/audio_state_manager.py`) is a singleton that tracks whether audio (music/media) is currently playing. Its key role is to suppress agent state transitions from `speaking` → `listening` while audio is playing, preventing the agent from cutting off playback. It has a 15-minute failsafe to force-clear stuck state.

Game workers use this more heavily than cheeko_worker (which has music disabled). The state manager exposes:

- `set_music_playing(is_playing, track_title)` — called by the audio player
- `should_suppress_agent_state_change(old_state, new_state)` — checked in state event handlers
- `force_listening_state()` — called when stopping audio to re-enable state transitions

## Session Cleanup

`cleanup_room_and_session()` is idempotent (guarded by `cleanup_completed` flag) and is called on:
- Last participant disconnect
- Room disconnect event
- `shutdown_request` data channel message
- `ctx.add_shutdown_callback()`

Cleanup sequence:
1. Log usage summary (5s timeout)
2. Extract and send chat history / Mem0 memories (20s timeout)
3. Close `AgentSession`
4. Disconnect from LiveKit room
5. Delete the LiveKit room via API
