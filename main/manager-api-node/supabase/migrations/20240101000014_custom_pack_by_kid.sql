-- Migration: Key custom content packs by kid_id, store S3 key instead of URL
-- Description: Parents upload custom audio before an admin assigns the physical card,
--              so the pack can no longer hang off rfid_uid. The tap lookup now goes
--              custom_card.rfid_uid -> custom_card.kid_id -> custom_content_pack.kid_id.
--              Both tables are empty, so no backfill is required.

-- =============================================
-- custom_card - rfid_uid becomes nullable (admin assigns it after the parent uploads)
-- =============================================
ALTER TABLE custom_card ALTER COLUMN rfid_uid DROP NOT NULL;

COMMENT ON COLUMN custom_card.rfid_uid IS 'Custom RFID card UID, assigned by admin after creation; NULL until then. Store uppercase with no separators.';

-- =============================================
-- custom_content_pack - keyed by kid_id, one active pack per kid
-- =============================================

-- rfid_uid is no longer the join key; drop it so a stale copy can never diverge
-- from custom_card.rfid_uid once the admin assigns the card.
ALTER TABLE custom_content_pack DROP CONSTRAINT IF EXISTS custom_content_pack_rfid_uid_fkey;
DROP INDEX IF EXISTS idx_custom_content_pack_rfid;
ALTER TABLE custom_content_pack DROP COLUMN IF EXISTS rfid_uid;

ALTER TABLE custom_content_pack ADD COLUMN kid_id BIGINT NOT NULL REFERENCES kid_profile(id) ON DELETE CASCADE;
CREATE INDEX idx_custom_content_pack_kid ON custom_content_pack(kid_id);

-- Soft retire: a new upload deactivates the previous pack rather than deleting it.
ALTER TABLE custom_content_pack ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX idx_custom_content_pack_kid_active ON custom_content_pack(kid_id, is_active);

-- Persist the S3 object key, never a URL. A stored signed URL would expire and
-- the card would stop playing with no server-side signal that anything changed.
ALTER TABLE custom_content_pack DROP COLUMN IF EXISTS file_url;
ALTER TABLE custom_content_pack ADD COLUMN file_key VARCHAR(500) NOT NULL;
ALTER TABLE custom_content_pack ADD COLUMN duration_seconds DOUBLE PRECISION;

COMMENT ON TABLE custom_content_pack IS 'Parent-uploaded custom audio, keyed by kid_id; at most one row with is_active = true per kid';
COMMENT ON COLUMN custom_content_pack.kid_id IS 'FK to kid_profile.id — the join key used by the tap lookup';
COMMENT ON COLUMN custom_content_pack.file_key IS 'S3 object key. Signed into a playable URL at lookup time; never store a URL here.';
COMMENT ON COLUMN custom_content_pack.is_active IS 'False once a newer upload replaces this pack';
