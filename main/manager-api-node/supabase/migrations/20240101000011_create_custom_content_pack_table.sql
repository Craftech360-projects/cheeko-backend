-- Migration: Create Custom Content Pack Table
-- Description: Uploaded file content linked to a custom_card via rfid_uid

-- =============================================
-- custom_content_pack - Uploaded file for a custom card
-- =============================================
CREATE TABLE IF NOT EXISTS custom_content_pack (
    id BIGSERIAL PRIMARY KEY,
    rfid_uid VARCHAR(50) UNIQUE NOT NULL REFERENCES custom_card(rfid_uid) ON DELETE CASCADE,
    file_url VARCHAR(500) NOT NULL,
    file_name VARCHAR(255),
    file_type VARCHAR(100),
    file_size_bytes BIGINT,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE custom_content_pack IS 'Uploaded file content for a custom RFID card, one per rfid_uid';
COMMENT ON COLUMN custom_content_pack.rfid_uid IS 'FK to custom_card.rfid_uid';
COMMENT ON COLUMN custom_content_pack.file_url IS 'Storage URL of the uploaded file';
COMMENT ON COLUMN custom_content_pack.file_type IS 'MIME type of the uploaded file';
