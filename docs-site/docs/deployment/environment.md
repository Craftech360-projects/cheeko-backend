---
id: environment
sidebar_position: 1
---

# Environment Variables

This page documents all environment variables for each Cheeko service. Copy the relevant sections into `.env` files in each service directory.

---

## manager-api-node

File: `main/manager-api-node/.env`

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `8002` | HTTP server port |
| `NODE_ENV` | No | `development` | Runtime environment (`development` / `production`) |
| `CONTEXT_PATH` | No | `/toy` | URL context path prefix |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection pooler URL (pgbouncer/transaction mode, port 6543). **Sensitive.** |
| `DIRECT_URL` | **Yes** | — | Direct PostgreSQL URL for Prisma migrations (port 5432). **Sensitive.** |
| `SUPABASE_URL` | **Yes** | — | Supabase project URL — used for legacy admin dashboard token auth only. |
| `SUPABASE_ANON_KEY` | **Yes** | — | Supabase anon/public key. **Sensitive.** |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | — | Supabase service role key (bypasses RLS). **Sensitive — keep server-side only.** |
| `SERVICE_SECRET_KEY` | **Yes** | — | Shared secret for backend-to-backend calls (livekit-server → manager-api). **Sensitive.** |
| `QDRANT_URL` | No | — | Qdrant Cloud cluster URL (e.g., `https://xxx.qdrant.io`) |
| `QDRANT_API_KEY` | No | — | Qdrant API key. **Sensitive.** |
| `QDRANT_COLLECTION_NAME` | No | `rfid_content` | Qdrant collection name for RFID RAG |
| `MEM0_API_KEY` | No | — | Mem0 memory/personalization API key. **Sensitive.** |
| `CORS_ORIGINS` | No | `http://localhost:8080,http://localhost:3000` | Comma-separated list of allowed CORS origins |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate limit window in milliseconds (15 minutes) |
| `RATE_LIMIT_MAX_REQUESTS` | No | `5000` | Max requests per window |
| `LOG_LEVEL` | No | `debug` | Winston log level (`error`, `warn`, `info`, `http`, `debug`) |
| `JWT_SECRET` | No | — | JWT secret if not using Supabase default. **Sensitive.** |
| `JWT_EXPIRES_IN` | No | `7d` | JWT token expiry duration |

> The primary database is DigitalOcean Managed PostgreSQL, accessed via Prisma. Supabase credentials are used only for the admin dashboard custom token verification system and will be removed in a future cleanup.

---

## mqtt-gateway

File: `main/mqtt-gateway/.env`

| Variable | Required | Default | Description |
|---|---|---|---|
| `LIVEKIT_URL` | **Yes** | — | LiveKit server WebSocket URL (e.g., `wss://your-project.livekit.cloud`) |
| `LIVEKIT_API_KEY` | **Yes** | — | LiveKit API key. **Sensitive.** |
| `LIVEKIT_API_SECRET` | **Yes** | — | LiveKit API secret. **Sensitive.** |
| `MANAGER_API_URL` | **Yes** | — | URL of the manager-api-node service (e.g., `http://localhost:8002/toy`) |
| `MANAGER_API_SECRET` | **Yes** | — | Secret header value sent with internal calls to manager-api. **Sensitive.** |
| `CEREBRIUM_API_TOKEN` | **Yes** | — | Cerebrium platform token for music/story media API. **Sensitive.** Required at startup — process exits if missing. |
| `MEDIA_API_BASE` | No | `https://api.aws.us-east-1.cerebrium.ai/v4/p-89052e36/livekit-server-simple` | Media API base URL |
| `UDP_PORT` | No | `1883` | UDP server port for ESP32 device connections |
| `PUBLIC_IP` | No | `127.0.0.1` | Public IP address reported to connecting devices |
| `EMQX_HOST` | No | — | EMQX MQTT broker host (overrides config file value) |
| `EMQX_PORT` | No | — | EMQX MQTT broker port |
| `EMQX_PROTOCOL` | No | — | EMQX connection protocol (e.g., `mqtt`, `mqtts`) |
| `LOKI_HOST` | No | — | Grafana Loki host URL for centralized logging (e.g., `https://logs-prod.grafana.net`) |
| `LOKI_USER` | No | — | Loki basic auth username. **Sensitive.** |
| `LOKI_PASSWORD` | No | — | Loki basic auth password/token. **Sensitive.** |
| `CAPTURE_CONSOLE_LOGS` | No | — | Set to `true` to forward `console.log` output to Loki |
| `LOG_LEVEL` | No | `info` | Winston log level |

> MQTT broker connection details (host, port, credentials, topics) are also configurable via `main/mqtt-gateway/config/mqtt.json` which the ConfigManager watches for live-reload.

---

## livekit-server

File: `main/livekit-server/.env`

| Variable | Required | Default | Description |
|---|---|---|---|
| `LIVEKIT_URL` | **Yes** | — | LiveKit server WebSocket URL |
| `LIVEKIT_API_KEY` | **Yes** | — | LiveKit API key. **Sensitive.** |
| `LIVEKIT_API_SECRET` | **Yes** | — | LiveKit API secret. **Sensitive.** |
| `MANAGER_API_URL` | **Yes** | — | Manager API base URL (e.g., `http://localhost:8002/toy`) |
| `GROQ_API_KEY` | No | — | Groq API key for LLM and STT inference. **Sensitive.** Required if using Groq provider. |
| `GOOGLE_API_KEY` | No | — | Google AI API key for Gemini LLM. **Sensitive.** Can also be set via `config.yaml`. |
| `OPENAI_API_KEY` | No | — | OpenAI API key. **Sensitive.** Required if using OpenAI provider. |
| `ELEVENLABS_API_KEY` | No | — | ElevenLabs TTS API key (also accepted as `ELEVEN_API_KEY`). **Sensitive.** |
| `ELEVENLABS_VOICE_ID` | No | — | ElevenLabs voice ID to use for TTS |
| `ELEVENLABS_MODEL_ID` | No | `eleven_turbo_v2_5` | ElevenLabs TTS model |
| `MEM0_API_KEY` | No | — | Mem0 memory API key for personalization. **Sensitive.** |
| `DEEPGRAM_API_KEY` | No | — | Deepgram API key for STT. **Sensitive.** Required if `STT_PROVIDER=deepgram`. |
| `LLM_PROVIDER` | No | `groq` | LLM provider (`groq`, `openai`) |
| `LLM_MODEL` | No | `openai/gpt-oss-120b` | LLM model name |
| `STT_PROVIDER` | No | `groq` | STT provider (`groq`, `deepgram`, `funasr`) |
| `STT_MODEL` | No | `whisper-large-v3-turbo` | STT model name |
| `STT_LANGUAGE` | No | `en` | STT language code |
| `DEEPGRAM_MODEL` | No | `nova-3` | Deepgram model to use when STT provider is deepgram |
| `TTS_PROVIDER` | No | `edge` | TTS provider (`groq`, `elevenlabs`, `edge`) |
| `TTS_MODEL` | No | `playai-tts` | TTS model name (Groq) |
| `TTS_VOICE` | No | `Aaliyah-PlayAI` | TTS voice (Groq) |
| `EDGE_TTS_VOICE` | No | `en-US-AnaNeural` | Edge TTS voice name |
| `EDGE_TTS_RATE` | No | `+0%` | Edge TTS speaking rate |
| `EDGE_TTS_VOLUME` | No | `+0%` | Edge TTS volume |
| `EDGE_TTS_PITCH` | No | `+0Hz` | Edge TTS pitch |
| `REALTIME_PROVIDER` | No | `gemini` | Realtime voice provider (`gemini`, `openai`) |
| `GEMINI_REALTIME_MODEL` | No | `gemini-2.5-flash-native-audio-preview-09-2025` | Gemini realtime model |
| `GEMINI_REALTIME_VOICE` | No | `Zephyr` | Gemini realtime voice |
| `GEMINI_REALTIME_TEMPERATURE` | No | `0.6` | Gemini realtime temperature |
| `GEMINI_VAD_DISABLED` | No | `true` | Disable Gemini built-in VAD (use PTT mode) |
| `GEMINI_ENABLE_GOOGLE_SEARCH` | No | `true` | Enable Google Search grounding for Gemini |
| `OPENAI_REALTIME_MODEL` | No | `gpt-4o-realtime-preview` | OpenAI realtime model |
| `OPENAI_REALTIME_VOICE` | No | `alloy` | OpenAI realtime voice |
| `VAD_PROVIDER` | No | `silero` | Voice activity detection provider (`silero`, `ten`) |
| `VAD_MIN_SPEECH_DURATION` | No | `0.1` | Minimum speech duration in seconds |
| `VAD_MIN_SILENCE_DURATION` | No | `1.2` | Minimum silence duration before end-of-speech |
| `VAD_ACTIVATION_THRESHOLD` | No | `0.08` | VAD activation threshold |
| `NOISE_CANCELLATION` | No | `true` | Enable noise cancellation |
| `PREEMPTIVE_GENERATION` | No | `false` | Enable preemptive LLM response generation |
| `FALLBACK_ENABLED` | No | `false` | Enable LLM fallback model on failure |
| `FALLBACK_LLM_MODEL` | No | `llama-3.1-8b-instant` | Fallback LLM model name |
| `FUNASR_HOST` | No | `127.0.0.1` | FunASR WebSocket STT server host |
| `FUNASR_PORT` | No | `10096` | FunASR WebSocket STT server port |
| `FUNASR_USE_SSL` | No | `false` | Enable SSL for FunASR connection |
| `FUNASR_MODE` | No | `2pass` | FunASR recognition mode (`offline`, `online`, `2pass`) |
| `LOKI_HOST` | No | — | Grafana Loki host for centralized logging |

> API keys and model selection can also be configured via `main/livekit-server/config.yaml` which takes precedence for some settings. See that file for `manager_api`, `gemini_realtime`, and `api_keys` sections.

---

## manager-web

File: `main/manager-web/.env.local`

| Variable | Required | Default | Description |
|---|---|---|---|
| `VUE_APP_API_BASE_URL` | No | — | Backend API base URL (e.g., `http://localhost:8002/toy`). If unset, relative URLs are used. |
| `VUE_APP_PUBLIC_PATH` | No | `/` | Vue Router base path (useful when deployed to a subdirectory) |
| `VUE_APP_USE_CDN` | No | `false` | Set to `true` to load assets from CDN |
