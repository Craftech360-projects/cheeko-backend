-- Complete Schema Migration for Manager API Node
-- Run this in Supabase SQL Editor to enable ALL endpoints

-- =====================================================
-- OTA / FIRMWARE TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_ota (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    firmware_name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    version VARCHAR(50) NOT NULL,
    size INTEGER,
    remark TEXT,
    firmware_path VARCHAR(500),
    force_update INTEGER DEFAULT 0,
    creator BIGINT,
    create_date TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        update_date TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (type, version)
);

CREATE INDEX IF NOT EXISTS idx_ai_ota_type ON ai_ota(type);

CREATE INDEX IF NOT EXISTS idx_ai_ota_version ON ai_ota (version);

-- =====================================================
-- TOKEN USAGE TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS device_token_usage (
    id BIGSERIAL PRIMARY KEY,
    mac_address VARCHAR(50) NOT NULL,
    session_id VARCHAR(100),
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    avg_ttft_seconds DECIMAL(10, 3) DEFAULT 0,
    message_count INTEGER DEFAULT 0,
    total_response_duration_seconds DECIMAL(10, 3) DEFAULT 0,
    session_count INTEGER DEFAULT 0,
    usage_date DATE NOT NULL,
    created_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        update_date TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (mac_address, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_device_token_usage_mac ON device_token_usage (mac_address);

CREATE INDEX IF NOT EXISTS idx_device_token_usage_date ON device_token_usage (usage_date);

-- =====================================================
-- ANALYTICS TABLES
-- =====================================================

-- Game Sessions
CREATE TABLE IF NOT EXISTS analytics_game_sessions (
    id BIGSERIAL PRIMARY KEY,
    session_id VARCHAR(100) UNIQUE NOT NULL,
    mac_address VARCHAR(50) NOT NULL,
    agent_id UUID,
    mode_type VARCHAR(50) NOT NULL,
    started_at TIMESTAMP
    WITH
        TIME ZONE NOT NULL,
        ended_at TIMESTAMP
    WITH
        TIME ZONE,
        duration_seconds INTEGER,
        interaction_count INTEGER DEFAULT 0,
        completion_status VARCHAR(50) DEFAULT 'completed',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_mac ON analytics_game_sessions (mac_address);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_started ON analytics_game_sessions (started_at);

-- Game Attempts
CREATE TABLE IF NOT EXISTS analytics_game_attempts (
    id BIGSERIAL PRIMARY KEY,
    session_id VARCHAR(100) NOT NULL,
    mac_address VARCHAR(50) NOT NULL,
    game_type VARCHAR(50) NOT NULL,
    question_text TEXT,
    question_type VARCHAR(100),
    difficulty_level VARCHAR(20),
    correct_answer VARCHAR(500),
    user_answer VARCHAR(500),
    is_correct BOOLEAN,
    attempt_number SMALLINT DEFAULT 1,
    response_time_ms INTEGER,
    answered_at TIMESTAMP
    WITH
        TIME ZONE,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_attempts_session ON analytics_game_attempts (session_id);

CREATE INDEX IF NOT EXISTS idx_analytics_attempts_mac ON analytics_game_attempts (mac_address);

CREATE INDEX IF NOT EXISTS idx_analytics_attempts_game ON analytics_game_attempts (game_type);

CREATE INDEX IF NOT EXISTS idx_analytics_attempts_correct ON analytics_game_attempts (is_correct);

-- Media Playback
CREATE TABLE IF NOT EXISTS analytics_media_playback (
    id BIGSERIAL PRIMARY KEY,
    mac_address VARCHAR(50) NOT NULL,
    content_id BIGINT,
    content_type VARCHAR(50) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    position_seconds INTEGER DEFAULT 0,
    duration_seconds INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_media_mac ON analytics_media_playback (mac_address);

-- Streaks
CREATE TABLE IF NOT EXISTS analytics_streaks (
    id BIGSERIAL PRIMARY KEY,
    mac_address VARCHAR(50) NOT NULL,
    streak_type VARCHAR(50) NOT NULL,
    streak_date DATE NOT NULL,
    streak_count INTEGER DEFAULT 1,
    created_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (
            mac_address,
            streak_type,
            streak_date
        )
);

-- User Progress
CREATE TABLE IF NOT EXISTS analytics_user_progress (
    id BIGSERIAL PRIMARY KEY,
    mac_address VARCHAR(50) UNIQUE NOT NULL,
    kid_id BIGINT,
    total_sessions INTEGER DEFAULT 0,
    total_duration_seconds INTEGER DEFAULT 0,
    total_games_played INTEGER DEFAULT 0,
    total_correct_answers INTEGER DEFAULT 0,
    total_wrong_answers INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_activity_at TIMESTAMP
    WITH
        TIME ZONE,
        created_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- PLAYLIST TABLES
-- =====================================================

CREATE TABLE IF NOT EXISTS music_playlist (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID NOT NULL,
    content_id BIGINT NOT NULL,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (device_id, content_id)
);

CREATE TABLE IF NOT EXISTS story_playlist (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID NOT NULL,
    content_id BIGINT NOT NULL,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (device_id, content_id)
);

-- =====================================================
-- RFID TABLES (Refined for Smart Routing)
-- =====================================================

-- rfid_pack - The Physical/Product Pack (unchanged base, added status)
CREATE TABLE IF NOT EXISTS rfid_pack (
    id BIGSERIAL PRIMARY KEY,
    pack_name VARCHAR(255) NOT NULL,
    pack_code VARCHAR(100) UNIQUE,
    description TEXT,
    age_min INTEGER,
    age_max INTEGER,
    language VARCHAR(50) DEFAULT 'en',
    active BOOLEAN DEFAULT TRUE,
    status INTEGER DEFAULT 1,
    creator BIGINT,
    create_date TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updater BIGINT,
        update_date TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rfid_pack_code ON rfid_pack (pack_code);

CREATE INDEX IF NOT EXISTS idx_rfid_pack_active ON rfid_pack (active);

-- rfid_question - Question templates (Enhanced for Q&A Smart Routing)
CREATE TABLE IF NOT EXISTS rfid_question (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    prompt_text TEXT NOT NULL,
    system_prompt_override TEXT, -- NEW: For specific personas
    allow_caching BOOLEAN DEFAULT TRUE, -- NEW: Smart Caching Flag
    cached_audio_url VARCHAR(500), -- NEW: Auto-Cache URL
    language VARCHAR(10) DEFAULT 'en',
    category VARCHAR(100),
    difficulty INTEGER DEFAULT 1,
    active BOOLEAN DEFAULT TRUE,
    creator BIGINT,
    create_date TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updater BIGINT,
        update_date TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rfid_question_code ON rfid_question (code);

CREATE INDEX IF NOT EXISTS idx_rfid_question_active ON rfid_question (active);

-- rfid_content_pack - The Content Collection (Optimized for Downloads)
DROP TABLE IF EXISTS rfid_content_pack CASCADE;

CREATE TABLE IF NOT EXISTS rfid_content_pack (
    id BIGSERIAL PRIMARY KEY,
    pack_code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    content_type VARCHAR(50) DEFAULT 'prompt', -- 'story', 'rhyme', 'habit'
    total_items INTEGER DEFAULT 0,
    language VARCHAR(10) DEFAULT 'en',
    version INTEGER DEFAULT 1, -- CHANGED: Int for easier comparison
    status VARCHAR(20) DEFAULT 'draft', -- NEW: draft/published
    age_range VARCHAR(20), -- NEW: Metadata
    thumbnail_url VARCHAR(500), -- NEW: Pack Cover
    content_md TEXT,
    cached_audio_urls TEXT,
    content_hash VARCHAR(100),
    active BOOLEAN DEFAULT TRUE,
    creator BIGINT,
    create_date TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updater BIGINT,
        update_date TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rfid_content_pack_code ON rfid_content_pack (pack_code);

-- content_item - Unified Items (Refined for 10-item limit)
DROP TABLE IF EXISTS content_item CASCADE;

CREATE TABLE IF NOT EXISTS content_item (
    id BIGSERIAL PRIMARY KEY,
    content_pack_id BIGINT REFERENCES rfid_content_pack (id) ON DELETE CASCADE,
    item_number INTEGER NOT NULL, -- 1-10 Sequence
    title VARCHAR(255),
    description TEXT,
    audio_url VARCHAR(500),
    image_url VARCHAR(500), -- NEW: Item Thumbnail
    content_text TEXT, -- NEW: Read-along text
    audio_duration_ms BIGINT,
    active BOOLEAN DEFAULT TRUE,
    creator BIGINT,
    create_date TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updater BIGINT,
        update_date TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (content_pack_id, item_number) -- NEW: Ensure sequence integrity
);

CREATE INDEX IF NOT EXISTS idx_content_item_pack ON content_item (content_pack_id);

-- rfid_question_pack - Q&A Pack Collections (NEW: Reusable Question Sets)
DROP TABLE IF EXISTS rfid_question_pack CASCADE;

CREATE TABLE IF NOT EXISTS rfid_question_pack (
    id BIGSERIAL PRIMARY KEY,
    pack_code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    question_ids JSONB DEFAULT '[]', -- Array of question IDs (max 10)
    language VARCHAR(10) DEFAULT 'en',
    category VARCHAR(100),
    version INTEGER DEFAULT 1,
    status VARCHAR(20) DEFAULT 'draft', -- draft/published
    active BOOLEAN DEFAULT TRUE,
    creator BIGINT,
    create_date TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updater BIGINT,
        update_date TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rfid_question_pack_code ON rfid_question_pack (pack_code);

CREATE INDEX IF NOT EXISTS idx_rfid_question_pack_active ON rfid_question_pack (active);

-- rfid_card_mapping - The Linker
DROP TABLE IF EXISTS rfid_card_mapping CASCADE;

CREATE TABLE IF NOT EXISTS rfid_card_mapping (
    id BIGSERIAL PRIMARY KEY,
    rfid_uid VARCHAR(100) NOT NULL UNIQUE,
    content_pack_id BIGINT REFERENCES rfid_content_pack (id) ON DELETE SET NULL,
    pack_id BIGINT REFERENCES rfid_pack (id) ON DELETE SET NULL,
    question_id BIGINT REFERENCES rfid_question (id) ON DELETE SET NULL,
    question_pack_id BIGINT REFERENCES rfid_question_pack (id) ON DELETE SET NULL,
    question_ids JSONB DEFAULT '[]', -- NEW: List of questions for "Q&A Pack"
    pack_code VARCHAR(100),
    action_type VARCHAR(50) DEFAULT 'content', -- 'pack', 'qna'
    action_data JSONB DEFAULT '{}',
    notes TEXT,
    active BOOLEAN DEFAULT true,
    status INTEGER DEFAULT 1,
    creator BIGINT,
    create_date TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updater BIGINT,
        update_date TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rfid_card_mapping_uid ON rfid_card_mapping (rfid_uid);

-- rfid_series - Bulk Ranges

DROP TABLE IF EXISTS rfid_series CASCADE;

CREATE TABLE IF NOT EXISTS rfid_series (
    id BIGSERIAL PRIMARY KEY,
    series_name VARCHAR(255),
    start_uid VARCHAR(100) NOT NULL,
    end_uid VARCHAR(100) NOT NULL,
    content_pack_id BIGINT REFERENCES rfid_content_pack (id) ON DELETE SET NULL,
    priority INTEGER DEFAULT 0,
    status INTEGER DEFAULT 1,
    created_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rfid_series_range ON rfid_series (start_uid, end_uid);

-- =====================================================
-- MIGRATION COMMANDS (Updates to existing tables)
-- =====================================================

-- Update rfid_content_pack
ALTER TABLE rfid_content_pack
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft';

ALTER TABLE rfid_content_pack
ADD COLUMN IF NOT EXISTS age_range VARCHAR(20);

ALTER TABLE rfid_content_pack
ADD COLUMN IF NOT EXISTS thumbnail_url VARCHAR(500);

-- Update content_item
ALTER TABLE content_item
ADD COLUMN IF NOT EXISTS image_url VARCHAR(500);

ALTER TABLE content_item ADD COLUMN IF NOT EXISTS content_text TEXT;
-- Add constraint ensuring uniqueness of item_number within a pack
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'content_item_pack_sequence_key'
    ) THEN
        ALTER TABLE content_item ADD CONSTRAINT content_item_pack_sequence_key UNIQUE (content_pack_id, item_number);
    END IF;
END $$;

-- Update rfid_question
ALTER TABLE rfid_question
ADD COLUMN IF NOT EXISTS system_prompt_override TEXT;

ALTER TABLE rfid_question
ADD COLUMN IF NOT EXISTS allow_caching BOOLEAN DEFAULT TRUE;

ALTER TABLE rfid_question
ADD COLUMN IF NOT EXISTS cached_audio_url VARCHAR(500);

-- Update rfid_card_mapping
ALTER TABLE rfid_card_mapping
ADD COLUMN IF NOT EXISTS question_pack_id BIGINT REFERENCES rfid_question_pack (id) ON DELETE SET NULL;

-- =====================================================
-- DONE!
-- =====================================================
SELECT 'Schema migration completed successfully!' as status;