CREATE TABLE IF NOT EXISTS "moderation_providers" (
    "id"            BIGSERIAL PRIMARY KEY,
    "provider_name" TEXT NOT NULL,
    "api_key"       TEXT NOT NULL DEFAULT '',
    "model"         TEXT NOT NULL DEFAULT '',
    "is_active"     BOOLEAN NOT NULL DEFAULT false,
    "priority"      INTEGER NOT NULL DEFAULT 0,
    "config_json"   JSONB,
    "created_at"    TIMESTAMPTZ(6) DEFAULT now(),
    "updated_at"    TIMESTAMPTZ(6) DEFAULT now(),
    CONSTRAINT "moderation_providers_provider_name_key" UNIQUE ("provider_name")
);

CREATE INDEX IF NOT EXISTS "idx_moderation_active" ON "moderation_providers" ("is_active");
CREATE INDEX IF NOT EXISTS "idx_moderation_priority" ON "moderation_providers" ("priority" DESC);

-- Seed the three chat judges + the free OpenAI classifier. Keys are filled by the
-- admin in the DB afterwards. groq starts active = current behavior preserved.
INSERT INTO "moderation_providers" ("provider_name", "model", "is_active", "priority") VALUES
    ('groq',              'llama-3.1-8b-instant',    true,  100),
    ('openai',            'gpt-4o-mini',             false, 50),
    ('openrouter',        'google/gemma-3-4b-it',    false, 40),
    ('openai_moderation', 'omni-moderation-latest',  false, 30)
ON CONFLICT ("provider_name") DO NOTHING;
