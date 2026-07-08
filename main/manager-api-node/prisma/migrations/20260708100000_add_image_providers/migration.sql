-- prisma/migrations/20260708100000_add_image_providers/migration.sql
CREATE TABLE IF NOT EXISTS "image_providers" (
    "id"            BIGSERIAL PRIMARY KEY,
    "provider_name" TEXT NOT NULL,
    "api_key"       TEXT NOT NULL DEFAULT '',
    "model"         TEXT NOT NULL DEFAULT '',
    "is_active"     BOOLEAN NOT NULL DEFAULT false,
    "priority"      INTEGER NOT NULL DEFAULT 0,
    "config_json"   JSONB,
    "created_at"    TIMESTAMPTZ(6) DEFAULT now(),
    "updated_at"    TIMESTAMPTZ(6) DEFAULT now(),
    CONSTRAINT "image_providers_provider_name_key" UNIQUE ("provider_name")
);

CREATE INDEX IF NOT EXISTS "idx_image_active" ON "image_providers" ("is_active");
CREATE INDEX IF NOT EXISTS "idx_image_priority" ON "image_providers" ("priority" DESC);

-- hf starts active with empty key: line_art skips key-less active providers and
-- falls to its env HF token, so behavior is unchanged until the admin switches.
INSERT INTO "image_providers" ("provider_name", "model", "is_active", "priority") VALUES
    ('hf',      'black-forest-labs/FLUX.1-schnell', true,  100),
    ('runware', 'runware:400@4',                    false, 50),
    ('fal',     'fal-ai/flux/schnell',              false, 40)
ON CONFLICT ("provider_name") DO NOTHING;
