-- Custom-card pack codes are written to the RFID card, whose field is 8 bytes.
-- CUSTOM_KID_<kidId> is 13-14 characters and does not fit, so it becomes
-- CK<kidId padded to 6> — exactly 8, fixed width for every child.
--
-- rfid_card_mapping.pack_code carries the same string and is migrated with it:
-- it is a plain varchar reference, not a foreign key, so nothing would have
-- told us the mapping had stopped resolving.
--
-- rfid_card_tap_log.content_pack_code is deliberately NOT rewritten. It records
-- what was on the card at the time of the tap, and rewriting it would falsify
-- history for tap analytics.

-- Six digits caps this at 999999. A larger id would silently produce a
-- 9-character code the card truncates — and a truncated code still parses,
-- resolving to the wrong child. Refuse the migration instead.
DO $$
DECLARE oversized bigint;
BEGIN
  SELECT count(*) INTO oversized
  FROM rfid_content_pack
  WHERE pack_code ~ '^CUSTOM_KID_[0-9]+$'
    AND substring(pack_code FROM '^CUSTOM_KID_([0-9]+)$')::bigint > 999999;

  IF oversized > 0 THEN
    RAISE EXCEPTION
      'cannot migrate % custom pack code(s): kid id exceeds 999999 and will not fit an 8-character card field',
      oversized;
  END IF;
END $$;

UPDATE rfid_card_mapping
SET pack_code = 'CK' || lpad(substring(pack_code FROM '^CUSTOM_KID_([0-9]+)$'), 6, '0')
WHERE pack_code ~ '^CUSTOM_KID_[0-9]+$';

-- pack_code is UNIQUE here, so a collision with an already-migrated row aborts
-- the migration rather than merging two children's packs.
UPDATE rfid_content_pack
SET pack_code = 'CK' || lpad(substring(pack_code FROM '^CUSTOM_KID_([0-9]+)$'), 6, '0')
WHERE pack_code ~ '^CUSTOM_KID_[0-9]+$';
