-- Migration: Split Custom Content Pack Files
-- Description: Move file columns off custom_content_pack into a child table so a pack can hold multiple uploaded files

-- =============================================
-- custom_content_pack - drop single-file columns (now a plain pack record)
-- =============================================
ALTER TABLE custom_content_pack DROP COLUMN IF EXISTS file_url;
ALTER TABLE custom_content_pack DROP COLUMN IF EXISTS file_name;
ALTER TABLE custom_content_pack DROP COLUMN IF EXISTS file_type;
ALTER TABLE custom_content_pack DROP COLUMN IF EXISTS file_size_bytes;

-- =============================================
-- custom_content_pack_file - one row per uploaded file
-- =============================================
CREATE TABLE IF NOT EXISTS custom_content_pack_file (
    id BIGSERIAL PRIMARY KEY,
    content_pack_id BIGINT NOT NULL REFERENCES custom_content_pack(id) ON DELETE CASCADE,
    file_url VARCHAR(500) NOT NULL,
    file_name VARCHAR(255),
    file_type VARCHAR(100),
    file_size_bytes BIGINT,
    sort INTEGER DEFAULT 0,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_custom_content_pack_file_pack ON custom_content_pack_file(content_pack_id);

COMMENT ON TABLE custom_content_pack_file IS 'Uploaded files belonging to a custom_content_pack (multiple files per pack)';
COMMENT ON COLUMN custom_content_pack_file.content_pack_id IS 'FK to custom_content_pack.id';
COMMENT ON COLUMN custom_content_pack_file.file_url IS 'Storage URL of the uploaded file';
COMMENT ON COLUMN custom_content_pack_file.file_type IS 'MIME type of the uploaded file';
