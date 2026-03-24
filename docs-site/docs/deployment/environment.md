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

### LiveKit

| Variable | Required | Default | Description |
|---|---|---|---|
| `LIVEKIT_URL` | **Yes** | — | LiveKit server WebSocket URL (e.g., `wss://your-project.livekit.cloud`) |
| `LIVEKIT_API_KEY` | **Yes** | — | LiveKit API key. **Sensitive.** |
| `LIVEKIT_API_SECRET` | **Yes** | — | LiveKit API secret. **Sensitive.** |

### Manager API

| Variable | Required | Default | Description |
|---|---|---|---|
| `MANAGER_API_URL` | **Yes** | `http://localhost:8002/toy` | Manager API base URL |
| `MANAGER_API_SECRET` | **Yes** | — | Shared secret sent with internal calls to manager-api. **Sensitive.** |

### LLM

| Variable | Required | Default | Description |
|---|---|---|---|
| `LLM_PROVIDER` | No | `groq` | LLM provider (`groq`, `openai`) |
| `LLM_MODEL` | No | `openai/gpt-oss-120b` | LLM model name |
| `GROQ_API_KEY` | No | — | Groq API key for LLM and STT inference. **Sensitive.** Required if `LLM_PROVIDER=groq`. |
| `GOOGLE_API_KEY` | No | — | Google AI API key for Gemini. **Sensitive.** Can also be set via `config.yaml` `api_keys.google`. |
| `OPENAI_API_KEY` | No | — | OpenAI API key. **Sensitive.** Required if `LLM_PROVIDER=openai`. |
| `FALLBACK_ENABLED` | No | `false` | Enable LLM fallback model on failure |
| `FALLBACK_LLM_MODEL` | No | `llama-3.1-8b-instant` | Fallback LLM model name |

### STT

| Variable | Required | Default | Description |
|---|---|---|---|
| `STT_PROVIDER` | No | `groq` | STT provider (`groq`, `deepgram`, `funasr`) |
| `STT_MODEL` | No | `whisper-large-v3-turbo` | STT model name |
| `STT_LANGUAGE` | No | `en` | STT language code |
| `DEEPGRAM_API_KEY` | No | — | Deepgram API key. **Sensitive.** Required if `STT_PROVIDER=deepgram`. |
| `DEEPGRAM_MODEL` | No | `nova-3` | Deepgram model to use when `STT_PROVIDER=deepgram` |
| `FUNASR_HOST` | No | `127.0.0.1` | FunASR WebSocket STT server host |
| `FUNASR_PORT` | No | `10096` | FunASR WebSocket STT server port |
| `FUNASR_USE_SSL` | No | `false` | Enable SSL for FunASR connection |
| `FUNASR_MODE` | No | `2pass` | FunASR recognition mode (`offline`, `online`, `2pass`) |
| `FUNASR_USE_ITN` | No | `true` | Enable Inverse Text Normalization in FunASR |
| `FUNASR_HOTWORDS` | No | `` | Space-separated hotwords for FunASR |

### TTS

| Variable | Required | Default | Description |
|---|---|---|---|
| `TTS_PROVIDER` | No | `edge` | TTS provider (`groq`, `elevenlabs`, `edge`) |
| `TTS_MODEL` | No | `playai-tts` | TTS model name (used when `TTS_PROVIDER=groq`) |
| `TTS_VOICE` | No | `Aaliyah-PlayAI` | TTS voice (used when `TTS_PROVIDER=groq`) |
| `TTS_FALLBACK_ENABLED` | No | `false` | Enable TTS fallback provider on failure |
| `ELEVENLABS_API_KEY` | No | — | ElevenLabs TTS API key (also accepted as `ELEVEN_API_KEY`). **Sensitive.** |
| `ELEVENLABS_VOICE_ID` | No | — | ElevenLabs voice ID. Overrides `config.yaml` value. |
| `ELEVENLABS_MODEL_ID` | No | `eleven_turbo_v2_5` | ElevenLabs TTS model (also accepted as `ELEVENLABS_TTS_MODEL`) |
| `EDGE_TTS_VOICE` | No | `en-US-AnaNeural` | Edge TTS voice name |
| `EDGE_TTS_RATE` | No | `+0%` | Edge TTS speaking rate |
| `EDGE_TTS_VOLUME` | No | `+0%` | Edge TTS volume |
| `EDGE_TTS_PITCH` | No | `+0Hz` | Edge TTS pitch |
| `EDGE_TTS_SAMPLE_RATE` | No | `24000` | Edge TTS output sample rate in Hz |
| `EDGE_TTS_CHANNELS` | No | `1` | Edge TTS output channel count |

### Realtime voice (Gemini / OpenAI)

| Variable | Required | Default | Description |
|---|---|---|---|
| `REALTIME_PROVIDER` | No | `gemini` | Realtime voice provider (`gemini`, `openai`) |
| `GEMINI_REALTIME_MODEL` | No | `gemini-2.5-flash-native-audio-preview-09-2025` | Gemini realtime model ID |
| `GEMINI_REALTIME_VOICE` | No | `Zephyr` | Gemini realtime voice name |
| `GEMINI_REALTIME_TEMPERATURE` | No | `0.6` | Gemini realtime sampling temperature |
| `GEMINI_VAD_DISABLED` | No | `true` | Disable Gemini built-in VAD (enables PTT mode) |
| `GEMINI_START_SENSITIVITY` | No | `high` | Gemini VAD start-of-speech sensitivity (`high`, `medium`, `low`) |
| `GEMINI_END_SENSITIVITY` | No | `high` | Gemini VAD end-of-speech sensitivity (`high`, `medium`, `low`) |
| `GEMINI_PREFIX_PADDING_MS` | No | `10` | Gemini VAD prefix padding in milliseconds |
| `GEMINI_SILENCE_DURATION_MS` | No | `200` | Gemini VAD silence duration threshold in milliseconds |
| `GEMINI_ENABLE_GOOGLE_SEARCH` | No | `true` | Enable Google Search grounding for Gemini |
| `OPENAI_REALTIME_MODEL` | No | `gpt-4o-realtime-preview` | OpenAI realtime model ID |
| `OPENAI_REALTIME_VOICE` | No | `alloy` | OpenAI realtime voice name |

### VAD

| Variable | Required | Default | Description |
|---|---|---|---|
| `VAD_PROVIDER` | No | `silero` | Voice activity detection provider (`silero`, `ten`) |
| `VAD_MIN_SPEECH_DURATION` | No | `0.1` | Minimum speech duration in seconds to trigger detection |
| `VAD_MIN_SILENCE_DURATION` | No | `1.2` | Minimum silence duration in seconds before end-of-speech |
| `VAD_ACTIVATION_THRESHOLD` | No | `0.08` | VAD activation probability threshold |
| `VAD_PREFIX_PADDING_DURATION` | No | `0.3` | Audio padding before speech start in seconds |
| `VAD_MAX_BUFFERED_SPEECH` | No | `60.0` | Maximum buffered speech duration in seconds |
| `VAD_SAMPLE_RATE` | No | `16000` | VAD input sample rate in Hz |
| `VAD_HOP_SIZE` | No | `160` | VAD hop size in samples (TEN VAD only) |
| `NOISE_CANCELLATION` | No | `true` | Enable noise cancellation |
| `PREEMPTIVE_GENERATION` | No | `false` | Enable preemptive LLM response generation |

### Qdrant

| Variable | Required | Default | Description |
|---|---|---|---|
| `QDRANT_URL` | No | — | Qdrant Cloud cluster URL (e.g., `https://xxx.qdrant.io`) |
| `QDRANT_API_KEY` | No | — | Qdrant API key. **Sensitive.** |
| `QDRANT_COLLECTION_NAME` | No | — | Qdrant collection name used for semantic search |
| `EMBEDDING_MODEL` | No | `all-MiniLM-L6-v2` | Sentence-transformer model used to generate embeddings |
| `AUTO_PRELOAD_MODELS` | No | `true` | Preload embedding models at startup |
| `ALLOWED_MUSIC_LANGUAGES` | No | — | Comma-separated language codes to filter music search results |

### Mem0

| Variable | Required | Default | Description |
|---|---|---|---|
| `MEM0_API_KEY` | No | — | Mem0 memory/personalization API key. **Sensitive.** |

### Media (music / stories)

| Variable | Required | Default | Description |
|---|---|---|---|
| `CLOUDFRONT_DOMAIN` | No | — | CloudFront CDN domain for serving media files |
| `S3_BASE_URL` | No | — | S3 base URL used as fallback when CDN is disabled |
| `USE_CDN` | No | `true` | Serve media via CloudFront CDN when `true`, fall back to S3 URL when `false` |
| `AWS_ACCESS_KEY_ID` | No | — | AWS access key for S3 rhyme-cache bucket access. **Sensitive.** |
| `AWS_SECRET_ACCESS_KEY` | No | — | AWS secret access key. **Sensitive.** |
| `AWS_DEFAULT_REGION` | No | `us-east-1` | AWS region for S3 operations |

### Integrations

| Variable | Required | Default | Description |
|---|---|---|---|
| `WEATHER_API` | No | — | OpenWeatherMap (or compatible) API key for the weather tool. **Sensitive.** |

### Logging

| Variable | Required | Default | Description |
|---|---|---|---|
| `LOKI_HOST` | No | — | Grafana Loki host URL for centralized logging (e.g., `https://logs-prod.grafana.net`) |
| `LOKI_USER` | No | — | Loki basic auth username. **Sensitive.** |
| `LOKI_PASSWORD` | No | — | Loki basic auth password/token. **Sensitive.** |

### Worker ports

Each worker process binds to its own port so multiple workers can run concurrently.

| Variable | Required | Default | Description |
|---|---|---|---|
| `CHEEKO_PORT` | No | worker default | HTTP port for the main `cheeko_worker` |
| `MATH_TUTOR_PORT` | No | worker default | HTTP port for `math_tutor_worker` |
| `RIDDLE_SOLVER_PORT` | No | worker default | HTTP port for `riddle_solver_worker` |
| `WORD_LADDER_PORT` | No | worker default | HTTP port for `word_ladder_worker` |

> API keys and model selection can also be configured via `main/livekit-server/config.yaml`, which takes precedence for some settings. See that file for the `manager_api`, `gemini_realtime`, and `api_keys` sections.

---

## manager-web

File: `main/manager-web/.env.local`

| Variable | Required | Default | Description |
|---|---|---|---|
| `VUE_APP_API_BASE_URL` | No | — | Backend API base URL (e.g., `http://localhost:8002/toy`). If unset, relative URLs are used. |
| `VUE_APP_PUBLIC_PATH` | No | `/` | Vue Router base path (useful when deployed to a subdirectory) |
| `VUE_APP_USE_CDN` | No | `false` | Set to `true` to load assets from CDN |
