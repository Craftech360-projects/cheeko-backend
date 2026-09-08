-- Character card artwork: the four conversation sprites an AI card can carry.
--
-- The columns themselves already exist on every deployed database — they
-- reached them through `prisma db push` from schema.prisma, which copies
-- columns but not raw-SQL constraints. So this migration is mostly here to add
-- the two guards that never landed, and to make the schema reproducible from
-- the migration history instead of only from a push.
--
-- Everything is IF NOT EXISTS / idempotent: on a database that already has the
-- columns this adds only the index and the check, and on a fresh one it builds
-- the lot.
--
-- SAFE ON A LIVE DATABASE:
--   * every column is NULLable with no default backfill, so this is a
--     metadata-only change - Postgres does not rewrite the table
--   * existing rows get NULL, and the API only emits `character` when all four
--     URLs are present, so every card that exists today behaves as it does now
--   * no column is dropped, renamed or retyped
--
-- Reverting: see migrations/001_character_card_art_down.sql at the repo root.

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
