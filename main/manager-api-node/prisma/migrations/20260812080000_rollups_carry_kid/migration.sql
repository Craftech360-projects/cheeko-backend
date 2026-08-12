-- The parent progress screens belong to the Child.
--
-- The daily rollups are keyed on mac_address, so a child who changed toys saw
-- their charts reset to zero and a sibling inherited their totals.
--
-- Only the six live tables. rfid_card_tap_log already has kid_id AND already
-- populates it, so it needs nothing. The analytics_* tables, game_session and
-- kid_activity_log are deliberately absent: a survey on 2026-08-12 found all of
-- them at zero rows and zero lifetime inserts, with no writer in any of the
-- three repos. They are removed from the schema in 009 rather than migrated.
ALTER TABLE device_usage_daily           ADD COLUMN IF NOT EXISTS kid_id BIGINT;
ALTER TABLE device_card_taps_daily       ADD COLUMN IF NOT EXISTS kid_id BIGINT;
ALTER TABLE device_ai_interactions_daily ADD COLUMN IF NOT EXISTS kid_id BIGINT;
ALTER TABLE device_games_played          ADD COLUMN IF NOT EXISTS kid_id BIGINT;
ALTER TABLE device_radio_played          ADD COLUMN IF NOT EXISTS kid_id BIGINT;
ALTER TABLE device_analytics_event       ADD COLUMN IF NOT EXISTS kid_id BIGINT;

-- Every parent-facing read is "this child, over this date range".
CREATE INDEX IF NOT EXISTS idx_device_usage_daily_kid_date
  ON device_usage_daily (kid_id, date);
CREATE INDEX IF NOT EXISTS idx_device_card_taps_daily_kid_date
  ON device_card_taps_daily (kid_id, date);
CREATE INDEX IF NOT EXISTS idx_device_ai_interactions_daily_kid_date
  ON device_ai_interactions_daily (kid_id, date);
CREATE INDEX IF NOT EXISTS idx_device_games_played_kid_date
  ON device_games_played (kid_id, activity_date);
CREATE INDEX IF NOT EXISTS idx_device_radio_played_kid_date
  ON device_radio_played (kid_id, activity_date);
CREATE INDEX IF NOT EXISTS idx_device_analytics_event_kid_ts
  ON device_analytics_event (kid_id, event_timestamp DESC);

UPDATE device_usage_daily a           SET kid_id = d.kid_id FROM ai_device d WHERE lower(d.mac_address) = lower(a.mac_address) AND d.kid_id IS NOT NULL AND a.kid_id IS NULL;
UPDATE device_card_taps_daily a       SET kid_id = d.kid_id FROM ai_device d WHERE lower(d.mac_address) = lower(a.mac_address) AND d.kid_id IS NOT NULL AND a.kid_id IS NULL;
UPDATE device_ai_interactions_daily a SET kid_id = d.kid_id FROM ai_device d WHERE lower(d.mac_address) = lower(a.mac_address) AND d.kid_id IS NOT NULL AND a.kid_id IS NULL;
UPDATE device_games_played a          SET kid_id = d.kid_id FROM ai_device d WHERE lower(d.mac_address) = lower(a.mac_address) AND d.kid_id IS NOT NULL AND a.kid_id IS NULL;
UPDATE device_radio_played a          SET kid_id = d.kid_id FROM ai_device d WHERE lower(d.mac_address) = lower(a.mac_address) AND d.kid_id IS NOT NULL AND a.kid_id IS NULL;
UPDATE device_analytics_event a       SET kid_id = d.kid_id FROM ai_device d WHERE lower(d.mac_address) = lower(a.mac_address) AND d.kid_id IS NOT NULL AND a.kid_id IS NULL;

-- mac_address stays on every row. The founder dashboard is fleet analytics and
-- is device-oriented on purpose; it is untouched by this and keeps reading MACs.
