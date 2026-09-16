-- prisma/migrations/20260913000000_realtime_providers_gptlive_voice/migration.sql
-- Speech-to-speech (GPT-Live) provider settings for the cheeko-gptlive worker, and a
-- per-character GPT-Live voice. Additive only.
CREATE TABLE IF NOT EXISTS "realtime_providers" (
    "id"            BIGSERIAL PRIMARY KEY,
    "provider_name" VARCHAR(100) NOT NULL,
    "api_key"       TEXT NOT NULL DEFAULT '',
    "model"         VARCHAR(120) NOT NULL DEFAULT '',
    "backend_model" VARCHAR(120),
    "voice"         VARCHAR(100),
    "api_base"      TEXT,
    "is_active"     BOOLEAN NOT NULL DEFAULT false,
    "priority"      INTEGER NOT NULL DEFAULT 0,
    "config_json"   JSONB,
    "created_at"    TIMESTAMPTZ(6) DEFAULT now(),
    "updated_at"    TIMESTAMPTZ(6) DEFAULT now(),
    CONSTRAINT "realtime_providers_provider_name_key" UNIQUE ("provider_name")
);

CREATE INDEX IF NOT EXISTS "idx_realtime_active" ON "realtime_providers" ("is_active");
CREATE INDEX IF NOT EXISTS "idx_realtime_priority" ON "realtime_providers" ("priority" DESC);

-- Starts active with an empty key: the worker falls back to its OPENAI_API_KEY env until an
-- admin pastes a key in Runtime Providers, so behaviour is unchanged by this migration.
INSERT INTO "realtime_providers" ("provider_name", "model", "backend_model", "voice", "is_active", "priority") VALUES
    ('openai-gpt-live', 'gpt-live-1', 'gpt-5.6-luna', 'marin', true, 100)
ON CONFLICT ("provider_name") DO NOTHING;

-- NULL = use the active realtime provider's voice
ALTER TABLE "ai_agent_template" ADD COLUMN IF NOT EXISTS "gptlive_voice" VARCHAR(100);
