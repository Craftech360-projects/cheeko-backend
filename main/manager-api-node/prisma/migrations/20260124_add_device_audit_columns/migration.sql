-- Add missing audit columns to ai_device table
ALTER TABLE ai_device ADD COLUMN IF NOT EXISTS creator BIGINT;
ALTER TABLE ai_device ADD COLUMN IF NOT EXISTS updater BIGINT;
ALTER TABLE ai_device ADD COLUMN IF NOT EXISTS sort INTEGER DEFAULT 0;
