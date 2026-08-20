-- Catch the rollup rows that were written after 20260812080000 backfilled, but
-- before the writer learned to re-stamp kid_id on update.
--
-- A rollup row is keyed on (date, mac). The row a toy writes before the parent
-- picks a child is the same row it writes after, and only the create half
-- carried kid_id — so those rows stayed NULL for good. progressOwnerFilter
-- reads a paired toy by kid_id alone, so the parent's progress screens dropped
-- them: a ring that should have read the whole day read only the part that
-- happened after pairing.
--
-- Same shape as 20260812080000: NULL rows only, and only where the toy has a
-- child today. Rows on a toy nobody has paired keep their NULL, which is what
-- progressOwnerFilter matches them on. Re-running changes nothing.
UPDATE device_usage_daily a           SET kid_id = d.kid_id FROM ai_device d WHERE lower(d.mac_address) = lower(a.mac_address) AND d.kid_id IS NOT NULL AND a.kid_id IS NULL;
UPDATE device_card_taps_daily a       SET kid_id = d.kid_id FROM ai_device d WHERE lower(d.mac_address) = lower(a.mac_address) AND d.kid_id IS NOT NULL AND a.kid_id IS NULL;
UPDATE device_ai_interactions_daily a SET kid_id = d.kid_id FROM ai_device d WHERE lower(d.mac_address) = lower(a.mac_address) AND d.kid_id IS NOT NULL AND a.kid_id IS NULL;
UPDATE device_games_played a          SET kid_id = d.kid_id FROM ai_device d WHERE lower(d.mac_address) = lower(a.mac_address) AND d.kid_id IS NOT NULL AND a.kid_id IS NULL;
UPDATE device_radio_played a          SET kid_id = d.kid_id FROM ai_device d WHERE lower(d.mac_address) = lower(a.mac_address) AND d.kid_id IS NOT NULL AND a.kid_id IS NULL;
UPDATE device_analytics_event a       SET kid_id = d.kid_id FROM ai_device d WHERE lower(d.mac_address) = lower(a.mac_address) AND d.kid_id IS NOT NULL AND a.kid_id IS NULL;
