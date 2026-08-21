-- Revert 001_character_card_art_up.sql.
-- Destructive: drops the artwork URLs. Export them first if any are in use.
--   SELECT id, agent_name, sd_folder, art_version,
--          art_connect_url, art_listen_url, art_think_url, art_talk_url
--     FROM ai_agent_template WHERE sd_folder IS NOT NULL;

BEGIN;

ALTER TABLE ai_agent_template DROP CONSTRAINT IF EXISTS chk_agent_template_sd_folder;
DROP INDEX IF EXISTS idx_agent_template_sd_folder;

ALTER TABLE ai_agent_template
  DROP COLUMN IF EXISTS art_talk_url,
  DROP COLUMN IF EXISTS art_think_url,
  DROP COLUMN IF EXISTS art_listen_url,
  DROP COLUMN IF EXISTS art_connect_url,
  DROP COLUMN IF EXISTS art_version,
  DROP COLUMN IF EXISTS sd_folder;

COMMIT;
