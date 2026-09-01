-- Custom card packs move from the toy to the child.
--
-- A pack was keyed CUSTOM_<MAC> and played on whichever toy tapped the card, so
-- a toy handed to a sibling played the previous child's recordings and a child
-- moving to a new toy lost theirs. The owner becomes the child: CUSTOM_KID_<id>.
--
-- version and content_hash are deliberately NOT bumped. The content did not
-- change, and bumping them would make every toy in the field re-download its
-- whole card on the next tap.
--
-- S3 objects are not moved. content_item stores absolute URLs, so the old
-- customcard_<mac>/ keys keep resolving and the orphan sweep still deletes them
-- by their own key. Only new uploads land under customcard_kid<id>/.

-- 1. Re-key every custom pack whose toy is paired to a child.
UPDATE rfid_content_pack p
   SET pack_code = 'CUSTOM_KID_' || d.kid_id,
       update_date = NOW()
  FROM ai_device d
 WHERE p.pack_code LIKE 'CUSTOM=_%' ESCAPE '='
   AND p.pack_code NOT LIKE 'CUSTOM=_KID=_%' ESCAPE '='
   AND UPPER(REPLACE(REPLACE(d.mac_address, ':', ''), '-', '')) = REPLACE(p.pack_code, 'CUSTOM_', '')
   AND d.kid_id IS NOT NULL
   -- One child, one pack. The invariant holds (releaseKidFromOtherDevices,
   -- device.service.js) but a duplicate pack_code would abort the migration.
   AND NOT EXISTS (
     SELECT 1 FROM rfid_content_pack q WHERE q.pack_code = 'CUSTOM_KID_' || d.kid_id
   );

-- 2. Park whatever is left: packs on toys with no child, and packs whose MAC no
--    longer matches a device. Renamed, never deleted — the recordings are a
--    parent's own voice and are recoverable with one UPDATE.
UPDATE rfid_content_pack
   SET pack_code = 'ORPHANED_' || pack_code,
       active = false,
       update_date = NOW()
 WHERE pack_code LIKE 'CUSTOM=_%' ESCAPE '='
   AND pack_code NOT LIKE 'CUSTOM=_KID=_%' ESCAPE '=';
