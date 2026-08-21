-- Character card artwork: adds the four conversation sprites to an agent.
-- Additive and nullable throughout; see 001_character_card_art_down.sql to revert.
--
-- SAFE ON A LIVE DATABASE:
--   * every column is NULLable with no default backfill, so this is a metadata
--     -only change - Postgres does not rewrite the table
--   * existing rows get NULL, and the API only emits `character` when all four
--     URLs are present, so every card that exists today behaves exactly as it
--     does now
--   * no column is dropped, renamed or retyped

BEGIN;

ALTER TABLE ai_agent_template
  ADD COLUMN IF NOT EXISTS sd_folder       VARCHAR(8),
  ADD COLUMN IF NOT EXISTS art_version     INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS art_connect_url TEXT,
  ADD COLUMN IF NOT EXISTS art_listen_url  TEXT,
  ADD COLUMN IF NOT EXISTS art_think_url   TEXT,
  ADD COLUMN IF NOT EXISTS art_talk_url    TEXT;

-- sd_folder is a DIRECTORY NAME on a FAT card mounted without long-filename
-- support (CONFIG_FATFS_LFN_NONE). Longer than 8 characters is not slow, it is
-- invisible: mkdir/fopen fail and the character silently has no face, with no
-- error anywhere between the admin and the child. VARCHAR(8) makes the database
-- refuse it instead.
--
-- Unique because it is a path: two characters sharing one would overwrite each
-- other's sprites. Partial index so the many NULLs do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_template_sd_folder
  ON ai_agent_template (sd_folder)
  WHERE sd_folder IS NOT NULL;

-- Lowercase letters and digits only - the device builds a path from this.
ALTER TABLE ai_agent_template
  DROP CONSTRAINT IF EXISTS chk_agent_template_sd_folder;
ALTER TABLE ai_agent_template
  ADD CONSTRAINT chk_agent_template_sd_folder
  CHECK (sd_folder IS NULL OR sd_folder ~ '^[a-z0-9]{1,8}$');

COMMIT;

-- Verify
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'ai_agent_template'
--      AND column_name LIKE 'art%' OR column_name = 'sd_folder';
