-- Migration: Create Custom Card Table
-- Description: Key-value pairing between a kid profile (kid_id) and its custom RFID card (rfid_uid)

-- =============================================
-- custom_card - Kid profile <-> custom RFID card pairing
-- =============================================
CREATE TABLE IF NOT EXISTS custom_card (
    id BIGSERIAL PRIMARY KEY,
    kid_id BIGINT UNIQUE NOT NULL REFERENCES kid_profile(id) ON DELETE CASCADE,
    rfid_uid VARCHAR(50) UNIQUE NOT NULL,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_custom_card_kid ON custom_card(kid_id);
CREATE INDEX idx_custom_card_rfid ON custom_card(rfid_uid);

COMMENT ON TABLE custom_card IS 'One-to-one pairing between a kid profile and its custom RFID card uid';
COMMENT ON COLUMN custom_card.kid_id IS 'FK to kid_profile.id (key)';
COMMENT ON COLUMN custom_card.rfid_uid IS 'Custom RFID card UID, unique per kid profile (value)';
