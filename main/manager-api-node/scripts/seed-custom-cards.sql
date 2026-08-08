-- Custom card allowlist: migration + dummy issued cards (dev seed).
-- Safe to re-run.

-- 1. The allowlist of issued custom-card UIDs. kid_id is legacy and nullable:
--    an issued card is registered before any kid or device is involved.
CREATE TABLE IF NOT EXISTS custom_card (
  id          BIGSERIAL PRIMARY KEY,
  kid_id      BIGINT UNIQUE REFERENCES kid_profile(id) ON DELETE CASCADE,
  rfid_uid    VARCHAR(50) UNIQUE,
  creator     BIGINT,
  create_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updater     BIGINT,
  update_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_custom_card_kid ON custom_card(kid_id);
CREATE INDEX IF NOT EXISTS idx_custom_card_rfid ON custom_card(rfid_uid);

-- Databases that already had the table carry kid_id NOT NULL; drop it there too.
ALTER TABLE custom_card ALTER COLUMN kid_id DROP NOT NULL;

-- 2. Dummy issued cards. Membership in this table is what makes a UID a custom
--    card; there is no device binding, so no other column is needed.
INSERT INTO custom_card (rfid_uid, create_date, update_date)
VALUES
  ('04C1A20B', NOW(), NOW()),
  ('04C1A20C', NOW(), NOW()),
  ('04C1A20D', NOW(), NOW()),
  ('04D45E71', NOW(), NOW()),
  ('04D45E72', NOW(), NOW()),
  ('04E9F133', NOW(), NOW())
ON CONFLICT (rfid_uid) DO NOTHING;

-- 3. A dummy pack for the most recently seen device, so the Custom Packs tab has
--    something to render. No-op when the DB has no devices.
INSERT INTO rfid_content_pack (pack_code, name, content_type, total_items, version, content_hash, active, create_date, update_date)
SELECT
  'CUSTOM_' || UPPER(REPLACE(REPLACE(d.mac_address, ':', ''), '-', '')),
  COALESCE(d.alias, 'Toy') || ' — Custom Card',
  'rfidcontent',
  1,
  '1',
  'seed0000000000000000000000000000000000000000000000000000000000ab',
  true,
  NOW(),
  NOW()
FROM ai_device d
ORDER BY d.last_connected_at DESC NULLS LAST, d.create_date DESC
LIMIT 1
ON CONFLICT (pack_code) DO NOTHING;

INSERT INTO content_item (content_pack_id, item_number, title, audio_url, active, create_date, update_date)
SELECT p.id, 1, 'sample-recording.mp3',
       'https://dsmzc13oafp54.cloudfront.net/' || LOWER(REPLACE(p.pack_code, 'CUSTOM_', 'customcard_')) || '/sample-recording.mp3',
       true, NOW(), NOW()
FROM rfid_content_pack p
WHERE p.pack_code LIKE 'CUSTOM=_%' ESCAPE '='
  AND NOT EXISTS (SELECT 1 FROM content_item i WHERE i.content_pack_id = p.id);
