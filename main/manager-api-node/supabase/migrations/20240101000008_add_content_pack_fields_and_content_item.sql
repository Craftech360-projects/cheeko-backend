-- Migration: Add missing content pack fields and content_item table
-- Description: Adds cached_audio_urls, version, content_hash columns to rfid_content_pack
--              and creates the content_item table for unified content delivery

-- =============================================
-- Add missing columns to rfid_content_pack
-- =============================================
ALTER TABLE rfid_content_pack
    ADD COLUMN IF NOT EXISTS cached_audio_urls TEXT,
    ADD COLUMN IF NOT EXISTS version VARCHAR(50),
    ADD COLUMN IF NOT EXISTS content_hash VARCHAR(255);

COMMENT ON COLUMN rfid_content_pack.cached_audio_urls IS 'JSON mapping sequence number to CDN audio URLs';
COMMENT ON COLUMN rfid_content_pack.version IS 'Content version for client-side cache validation';
COMMENT ON COLUMN rfid_content_pack.content_hash IS 'Content hash for client-side cache validation';

-- =============================================
-- content_item - Unified content items (rhymes, habit steps, etc.)
-- =============================================
CREATE TABLE IF NOT EXISTS content_item (
    id BIGSERIAL PRIMARY KEY,
    content_pack_id BIGINT REFERENCES rfid_content_pack(id) ON DELETE CASCADE,
    item_number INTEGER NOT NULL,
    title VARCHAR(255),
    description TEXT,
    audio_url VARCHAR(500),
    audio_size_bytes BIGINT,
    audio_duration_ms BIGINT,
    images_json JSONB,
    lyrics_text TEXT,
    active BOOLEAN DEFAULT TRUE,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_content_item_pack ON content_item(content_pack_id);
CREATE INDEX IF NOT EXISTS idx_content_item_number ON content_item(content_pack_id, item_number);
CREATE INDEX IF NOT EXISTS idx_content_item_active ON content_item(active);

COMMENT ON TABLE content_item IS 'Unified content items for content packs (rhymes, habits, stories)';
COMMENT ON COLUMN content_item.content_pack_id IS 'FK to rfid_content_pack';
COMMENT ON COLUMN content_item.item_number IS '1-based sequence number within the pack';
COMMENT ON COLUMN content_item.audio_url IS 'Audio file CDN URL';
COMMENT ON COLUMN content_item.audio_size_bytes IS 'Audio file size in bytes';
COMMENT ON COLUMN content_item.audio_duration_ms IS 'Audio duration in milliseconds';
COMMENT ON COLUMN content_item.images_json IS 'JSON array of images [{url, sizeBytes, sequence}]';
COMMENT ON COLUMN content_item.lyrics_text IS 'Lyrics or content text (for rhymes)';
