-- Category table for RFID content packs
CREATE TABLE IF NOT EXISTS rfid_category (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon_url VARCHAR(500),
    display_order INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT TRUE,
    creator BIGINT,
    create_date TIMESTAMPTZ DEFAULT NOW(),
    updater BIGINT,
    update_date TIMESTAMPTZ DEFAULT NOW()
);

-- Add category_id to content packs
ALTER TABLE rfid_content_pack
    ADD COLUMN IF NOT EXISTS category_id BIGINT REFERENCES rfid_category(id) ON DELETE SET NULL;

-- Add story_number and story_title to content_item
ALTER TABLE content_item
    ADD COLUMN IF NOT EXISTS story_number INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS story_title VARCHAR(255);

-- Index for category lookups
CREATE INDEX IF NOT EXISTS idx_rfid_category_code ON rfid_category(code);
CREATE INDEX IF NOT EXISTS idx_rfid_category_active ON rfid_category(active);
CREATE INDEX IF NOT EXISTS idx_rfid_content_pack_category ON rfid_content_pack(category_id);
CREATE INDEX IF NOT EXISTS idx_content_item_story ON content_item(content_pack_id, story_number);
