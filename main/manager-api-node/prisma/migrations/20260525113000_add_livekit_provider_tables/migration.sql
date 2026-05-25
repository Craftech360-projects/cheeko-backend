-- Reuse STT provider table used by voice worker runtime
CREATE TABLE IF NOT EXISTS "stt_providers" (
  "id" BIGSERIAL PRIMARY KEY,
  "provider_name" TEXT NOT NULL UNIQUE,
  "api_key" TEXT NOT NULL DEFAULT '',
  "model" TEXT NOT NULL DEFAULT '',
  "language" TEXT,
  "sample_rate" INTEGER DEFAULT 16000,
  "is_active" BOOLEAN NOT NULL DEFAULT FALSE,
  "priority" INTEGER DEFAULT 0,
  "config_json" JSONB,
  "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "stt_providers" ADD COLUMN IF NOT EXISTS "language" TEXT;
ALTER TABLE "stt_providers" ADD COLUMN IF NOT EXISTS "sample_rate" INTEGER DEFAULT 16000;
ALTER TABLE "stt_providers" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN DEFAULT FALSE;
ALTER TABLE "stt_providers" ADD COLUMN IF NOT EXISTS "priority" INTEGER DEFAULT 0;
ALTER TABLE "stt_providers" ADD COLUMN IF NOT EXISTS "config_json" JSONB;
ALTER TABLE "stt_providers" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "stt_providers" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "idx_stt_active" ON "stt_providers"("is_active");
CREATE INDEX IF NOT EXISTS "idx_stt_priority" ON "stt_providers"("priority" DESC);

-- Global active TTS provider runtime table
CREATE TABLE IF NOT EXISTS "tts_providers" (
  "id" BIGSERIAL PRIMARY KEY,
  "provider_name" VARCHAR(100) NOT NULL UNIQUE,
  "api_key" TEXT NOT NULL DEFAULT '',
  "voice_id" VARCHAR(120),
  "model_id" VARCHAR(120),
  "output_format" VARCHAR(80),
  "sample_rate_hz" INTEGER,
  "temperature" DECIMAL(4,2),
  "is_active" BOOLEAN NOT NULL DEFAULT FALSE,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "config_json" JSONB,
  "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_tts_active" ON "tts_providers"("is_active");
CREATE INDEX IF NOT EXISTS "idx_tts_priority" ON "tts_providers"("priority" DESC);

-- Global active LLM provider runtime table
CREATE TABLE IF NOT EXISTS "llm_providers" (
  "id" BIGSERIAL PRIMARY KEY,
  "model_name" VARCHAR(120) NOT NULL UNIQUE,
  "model" TEXT NOT NULL,
  "api_base" TEXT,
  "api_key" TEXT NOT NULL DEFAULT '',
  "is_active" BOOLEAN NOT NULL DEFAULT FALSE,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "config_json" JSONB,
  "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_llm_active" ON "llm_providers"("is_active");
CREATE INDEX IF NOT EXISTS "idx_llm_priority" ON "llm_providers"("priority" DESC);

-- Seed common STT providers when missing
INSERT INTO "stt_providers" ("provider_name", "api_key", "model", "is_active", "priority")
VALUES
  ('deepgram', '', 'nova-2', FALSE, 1),
  ('assemblyai', '', 'u3-rt-pro', FALSE, 2),
  ('groq', '', 'whisper-large-v3', FALSE, 5),
  ('openai', '', 'whisper-1', FALSE, 6),
  ('cartesia', '', 'ink-whisper', FALSE, 7),
  ('elevenlabs', '', 'scribe_v2', FALSE, 8),
  ('azure', '', 'latest', FALSE, 9),
  ('google', '', 'latest_long', FALSE, 10),
  ('aws', '', 'Conversational', FALSE, 11),
  ('soniox', '', 'standard_v2', FALSE, 12),
  ('speechmatics', '', '2.0-a', FALSE, 13),
  ('gladia', '', 'gladia-2', FALSE, 14),
  ('gradium', '', 'default', FALSE, 15),
  ('mistral', '', 'voxtral-mini-latest', FALSE, 16),
  ('voxtral', '', 'voxtral-mini-latest', FALSE, 17),
  ('sarvam', '', 'saaras:v3', FALSE, 18),
  ('xai', '', 'stt', FALSE, 19)
ON CONFLICT ("provider_name") DO NOTHING;

-- Seed empty defaults for LLM/TTS when missing
INSERT INTO "llm_providers" ("model_name", "model", "api_base", "api_key", "is_active", "priority")
VALUES ('openrouter', 'google/gemma-4-31b-it', 'https://openrouter.ai/api/v1', '', FALSE, 1)
ON CONFLICT ("model_name") DO NOTHING;

INSERT INTO "tts_providers" ("provider_name", "api_key", "voice_id", "model_id", "output_format", "sample_rate_hz", "temperature", "is_active", "priority")
VALUES ('elevenlabs', '', NULL, NULL, NULL, NULL, NULL, FALSE, 1)
ON CONFLICT ("provider_name") DO NOTHING;
