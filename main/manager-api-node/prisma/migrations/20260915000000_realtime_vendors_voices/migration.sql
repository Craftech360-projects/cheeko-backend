-- prisma/migrations/20260915000000_realtime_vendors_voices/migration.sql
-- Which realtime implementation a provider row uses, starter rows for Gemini Live and Grok Voice,
-- and a per-character voice for each. Additive only.
ALTER TABLE "realtime_providers" ADD COLUMN IF NOT EXISTS "vendor" VARCHAR(20) NOT NULL DEFAULT 'openai';

-- Inactive with empty keys: nothing changes until an admin pastes a key and activates one.
INSERT INTO "realtime_providers" ("provider_name", "vendor", "model", "backend_model", "voice", "is_active", "priority") VALUES
    ('google-gemini-live', 'google', 'gemini-2.5-flash-native-audio-preview-12-2025', 'gemini-2.5-flash', 'Puck', false, 50),
    ('xai-grok-voice',     'xai',    'grok-voice-think-fast-1.0',                     'grok-4-1-fast-non-reasoning', 'ara', false, 40)
ON CONFLICT ("provider_name") DO NOTHING;

-- NULL = use the realtime provider row's voice
ALTER TABLE "ai_agent_template" ADD COLUMN IF NOT EXISTS "gemini_voice" VARCHAR(100);
ALTER TABLE "ai_agent_template" ADD COLUMN IF NOT EXISTS "xai_voice" VARCHAR(100);
