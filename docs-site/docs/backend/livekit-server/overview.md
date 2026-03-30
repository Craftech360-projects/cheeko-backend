---
id: overview
sidebar_position: 1
---

# LiveKit Server Overview

![AI Agent](/img/ai-agent-header.jpeg)

The livekit-server component contains Python AI agent workers that run inside LiveKit rooms. Each worker is an autonomous process that handles voice input from an ESP32 device, runs it through an LLM, and streams TTS audio back — all in real time. Workers are dispatched by the MQTT gateway when a device connects or switches mode.

## Workers

| File | Agent Name | Port | Character / Mode |
|------|-----------|------|-----------------|
| `workers/cheeko_worker.py` | `cheeko-agent` | 8081 | Main conversational companion (Cheeko) |
| `workers/math_tutor_worker.py` | `math-tutor-agent` | 8082 | Math Tutor game — arithmetic Q&A with Indian-themed stories |
| `workers/riddle_solver_worker.py` | `riddle-solver-agent` | 8085 | Riddle Solver game — riddles with hints |
| `workers/word_ladder_worker.py` | `word-ladder-agent` | 8086 | Word Ladder game — chain words by last/first letter |

## Services (`src/services/`)

| File | Purpose |
|------|---------|
| `prompt_service.py` | Fetches agent prompts from Manager API (`/config/agent-prompt`) or falls back to `config.yaml`; also fetches model config (`/config/agent-models`) and extracts TTS configuration |
| `analytics_service.py` | Sends session start/end, game attempts, streaks, and media playback events to Manager API analytics endpoints |
| `elevenlabs_tts_service.py` | Generates TTS audio via ElevenLabs API; used by cheeko_worker for rhyme/animal card playback |
| `animal_audio_service.py` | Resolves local MP3 animal sound files by name (e.g. "Cow" → `cow.mp3`) |
| `rhyme_cache_service.py` | Caches ElevenLabs-generated rhyme audio to S3 and notifies firmware via data channel |
| `mem0_service.py` | Interfaces with Mem0 for long-term memory search and injection during conversation |
| `unified_audio_player.py` | Plays audio streams through the LiveKit session (used by game workers) |

## External AI Providers

| Category | Provider / Package | Notes |
|----------|--------------------|-------|
| LLM + Voice (realtime) | Google Gemini (`livekit-plugins-google`) | `gemini-2.5-flash-native-audio-preview-12-2025`, voice `Zephyr` by default; all workers use `google.realtime.RealtimeModel` |
| Web Search | Google Search (`google.tools.GoogleSearch`) | Attached to cheeko-agent session only |
| TTS (pre-synthesized) | ElevenLabs (`livekit-plugins-elevenlabs`) | Used in cheeko_worker for `session.say()` playback of rhymes and animal descriptions |
| TTS (configurable) | Edge-TTS, OpenAI TTS, Groq TTS | Selected per device via Manager API model config; handled in `prompt_service.extract_tts_config()` |
| STT | Deepgram (`livekit-plugins-deepgram`) | Available as plugin; actual STT in production is handled natively by Gemini Realtime |
| Vector Search | Qdrant (`qdrant-client`) + `sentence-transformers` | For semantic content matching |
| Memory | Mem0 (`mem0ai==1.0.0`) | Long-term per-child memory storage and retrieval |
| VAD | Silero VAD (`silero-vad==6.2.0`) | Voice activity detection |
| Logging | Grafana Loki (`python-logging-loki`) | Centralized log shipping |

## Run Commands

```bash
cd main/livekit-server
pip install -r requirements.txt

# Main conversation agent
python workers/cheeko_worker.py dev

# Game workers
python workers/math_tutor_worker.py dev
python workers/riddle_solver_worker.py dev
python workers/word_ladder_worker.py dev

# Media API (music/story bots, separate FastAPI process)
python media_api.py
```

Each worker registers with the LiveKit SFU under its `agent_name`. The MQTT gateway dispatches jobs to the correct worker using the `CHARACTER_AGENT_MAP` in `mqtt-gateway.js`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_API_KEY` | Yes | Gemini Realtime API key (can also be set in `config.yaml`) |
| `MANAGER_API_URL` | Yes | Base URL of Manager API (e.g. `http://localhost:8002/toy`) |
| `MANAGER_API_SECRET` | Yes | Bearer token for Manager API authentication |
| `LIVEKIT_URL` | Yes | LiveKit server WebSocket URL |
| `LIVEKIT_API_KEY` | Yes | LiveKit API key |
| `LIVEKIT_API_SECRET` | Yes | LiveKit API secret |
| `ELEVENLABS_API_KEY` | Yes* | ElevenLabs API key (*required if using ElevenLabs TTS) |
| `ELEVENLABS_VOICE_ID` | No | Defaults to `ecp3DWciuUyW7BYM7II1` |
| `MEM0_API_KEY` | No | Mem0 memory service API key |
| `QDRANT_URL` | No | Qdrant cluster URL |
| `QDRANT_API_KEY` | No | Qdrant API key |
| `CHEEKO_PORT` | No | Override port for cheeko-agent (default 8081) |
| `MATH_TUTOR_PORT` | No | Override port for math-tutor-agent (default 8082) |
| `RIDDLE_SOLVER_PORT` | No | Override port for riddle-solver-agent (default 8085) |
| `WORD_LADDER_PORT` | No | Override port for word-ladder-agent (default 8086) |
