-- Migration: Switch custom_card to kid_id, allow multiple uploads per custom_content_pack
-- Description: custom_card now keys off kid_profile instead of device mac_address.
--              custom_content_pack drops the per-file split table and instead allows
--              multiple rows (uploads) per rfid_uid, one row per uploaded file.

-- =============================================
-- custom_card - kid_id instead of mac_address
-- =============================================
ALTER TABLE custom_card DROP CONSTRAINT IF EXISTS custom_card_mac_address_key;
DROP INDEX IF EXISTS idx_custom_card_mac;
ALTER TABLE custom_card DROP COLUMN IF EXISTS mac_address;

ALTER TABLE custom_card ADD COLUMN kid_id BIGINT UNIQUE NOT NULL REFERENCES kid_profile(id) ON DELETE CASCADE;
CREATE INDEX idx_custom_card_kid ON custom_card(kid_id);

COMMENT ON TABLE custom_card IS 'One-to-one pairing between a kid profile and its custom RFID card uid';
COMMENT ON COLUMN custom_card.kid_id IS 'FK to kid_profile.id (key)';
COMMENT ON COLUMN custom_card.rfid_uid IS 'Custom RFID card UID, unique per kid profile (value)';

-- =============================================
-- custom_content_pack_file - no longer needed
-- =============================================
DROP TABLE IF EXISTS custom_content_pack_file;

-- =============================================
-- custom_content_pack - one row per upload, many uploads per rfid_uid
-- =============================================
ALTER TABLE custom_content_pack DROP CONSTRAINT IF EXISTS custom_content_pack_rfid_uid_key;

ALTER TABLE custom_content_pack ADD COLUMN file_url VARCHAR(500) NOT NULL;
ALTER TABLE custom_content_pack ADD COLUMN file_name VARCHAR(255);
ALTER TABLE custom_content_pack ADD COLUMN file_type VARCHAR(100);
ALTER TABLE custom_content_pack ADD COLUMN file_size_bytes BIGINT;

CREATE INDEX idx_custom_content_pack_rfid ON custom_content_pack(rfid_uid);

COMMENT ON TABLE custom_content_pack IS 'Uploaded file records for a custom RFID card; multiple uploads (rows) allowed per rfid_uid';
COMMENT ON COLUMN custom_content_pack.rfid_uid IS 'FK to custom_card.rfid_uid, not unique — a card can have many uploads';
COMMENT ON COLUMN custom_content_pack.file_url IS 'Storage URL of the uploaded file';
COMMENT ON COLUMN custom_content_pack.file_type IS 'MIME type of the uploaded file';
