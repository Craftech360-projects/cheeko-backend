-- Complete Schema Migration for Manager API Node
-- Run this in Supabase SQL Editor to enable ALL endpoints

-- =====================================================
-- OTA / FIRMWARE TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_ota (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firmware_name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    version VARCHAR(50) NOT NULL,
    size INTEGER,
    remark TEXT,
    firmware_path VARCHAR(500),
    force_update INTEGER DEFAULT 0,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(type, version)
);

CREATE INDEX IF NOT EXISTS idx_ai_ota_type ON ai_ota(type);
CREATE INDEX IF NOT EXISTS idx_ai_ota_version ON ai_ota(version);

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
    avg_ttft_seconds DECIMAL(10,3) DEFAULT 0,
    message_count INTEGER DEFAULT 0,
    total_response_duration_seconds DECIMAL(10,3) DEFAULT 0,
    session_count INTEGER DEFAULT 0,
    usage_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(mac_address, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_device_token_usage_mac ON device_token_usage(mac_address);
CREATE INDEX IF NOT EXISTS idx_device_token_usage_date ON device_token_usage(usage_date);

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
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    interaction_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_mac ON analytics_game_sessions(mac_address);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_started ON analytics_game_sessions(started_at);

-- Game Attempts
CREATE TABLE IF NOT EXISTS analytics_game_attempts (
    id BIGSERIAL PRIMARY KEY,
    session_id VARCHAR(100) NOT NULL,
    mac_address VARCHAR(50) NOT NULL,
    game_type VARCHAR(50) NOT NULL,
    question TEXT,
    user_answer TEXT,
    correct_answer TEXT,
    is_correct BOOLEAN,
    attempt_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    response_time_ms INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_attempts_session ON analytics_game_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_analytics_attempts_mac ON analytics_game_attempts(mac_address);

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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_media_mac ON analytics_media_playback(mac_address);

-- Streaks
CREATE TABLE IF NOT EXISTS analytics_streaks (
    id BIGSERIAL PRIMARY KEY,
    mac_address VARCHAR(50) NOT NULL,
    streak_type VARCHAR(50) NOT NULL,
    streak_date DATE NOT NULL,
    streak_count INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(mac_address, streak_type, streak_date)
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
    last_activity_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- PLAYLIST TABLES
-- =====================================================

CREATE TABLE IF NOT EXISTS music_playlist (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID NOT NULL,
    content_id BIGINT NOT NULL,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_id, content_id)
);

CREATE TABLE IF NOT EXISTS story_playlist (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID NOT NULL,
    content_id BIGINT NOT NULL,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_id, content_id)
);

-- =====================================================
-- RFID TABLES (if not exist)
-- =====================================================

CREATE TABLE IF NOT EXISTS rfid_pack (
    id BIGSERIAL PRIMARY KEY,
    pack_name VARCHAR(255) NOT NULL,
    pack_code VARCHAR(100),
    description TEXT,
    age_min INTEGER,
    age_max INTEGER,
    language VARCHAR(50) DEFAULT 'en',
    status INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rfid_card_mapping (
    id BIGSERIAL PRIMARY KEY,
    rfid_uid VARCHAR(100) NOT NULL UNIQUE,
    content_pack_id BIGINT REFERENCES rfid_pack(id),
    pack_id BIGINT,
    question_id BIGINT,
    question_ids JSONB DEFAULT '[]',
    action_type VARCHAR(50) DEFAULT 'content',
    action_data JSONB DEFAULT '{}',
    emotions JSONB DEFAULT '[]',
    priority INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT true,
    status INTEGER DEFAULT 1,
    creator BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rfid_series (
    id BIGSERIAL PRIMARY KEY,
    series_name VARCHAR(255) NOT NULL,
    start_uid VARCHAR(100) NOT NULL,
    end_uid VARCHAR(100) NOT NULL,
    content_pack_id BIGINT REFERENCES rfid_pack(id),
    pack_id BIGINT,
    question_id BIGINT,
    priority INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT true,
    status INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rfid_scan_log (
    id BIGSERIAL PRIMARY KEY,
    mac_address VARCHAR(50) NOT NULL,
    rfid_uid VARCHAR(100) NOT NULL,
    action_taken VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Legacy RFID tags table
CREATE TABLE IF NOT EXISTS rfid_tags (
    id BIGSERIAL PRIMARY KEY,
    uid VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(255),
    description TEXT,
    content_type VARCHAR(50),
    content_id BIGINT,
    status INTEGER DEFAULT 1,
    creator BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- PARENT PROFILE TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS parent_profile (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT UNIQUE REFERENCES sys_user(id) ON DELETE CASCADE,
    email VARCHAR(255),
    phone_number VARCHAR(50),
    display_name VARCHAR(255),
    avatar_url VARCHAR(500),
    timezone VARCHAR(50),
    language VARCHAR(10) DEFAULT 'en',
    email_notifications BOOLEAN DEFAULT true,
    push_notifications BOOLEAN DEFAULT true,
    weekly_report BOOLEAN DEFAULT true,
    onboarding_completed BOOLEAN DEFAULT false,
    terms_accepted_at TIMESTAMP WITH TIME ZONE,
    terms_version VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- CONTENT LIBRARY (if not exists)
-- =====================================================

CREATE TABLE IF NOT EXISTS content_library (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    romanized VARCHAR(500),
    filename VARCHAR(500),
    content_type VARCHAR(50) NOT NULL,
    category VARCHAR(100),
    alternatives JSONB DEFAULT '[]',
    aws_s3_url VARCHAR(1000),
    duration_seconds INTEGER,
    file_size_bytes BIGINT,
    status INTEGER DEFAULT 1,
    creator BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_content_library_type ON content_library(content_type);
CREATE INDEX IF NOT EXISTS idx_content_library_category ON content_library(category);

-- =====================================================
-- SAMPLE DATA (Optional - safe to skip if data exists)
-- =====================================================

-- Sample music for random content test
-- Using DO block to handle duplicates gracefully
DO $$
BEGIN
    -- Only insert if no test music exists
    IF NOT EXISTS (SELECT 1 FROM ai_music WHERE title = 'Twinkle Twinkle' AND artist = 'Kids Music') THEN
        INSERT INTO ai_music (title, artist, category, language, status, sort)
        VALUES ('Twinkle Twinkle', 'Kids Music', 'nursery', 'en', 1, 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM ai_music WHERE title = 'ABC Song' AND artist = 'Kids Music') THEN
        INSERT INTO ai_music (title, artist, category, language, status, sort)
        VALUES ('ABC Song', 'Kids Music', 'educational', 'en', 1, 1);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM ai_music WHERE title = 'Baby Shark' AND artist = 'Kids Music') THEN
        INSERT INTO ai_music (title, artist, category, language, status, sort)
        VALUES ('Baby Shark', 'Kids Music', 'fun', 'en', 1, 2);
    END IF;
END $$;

-- Sample RFID card (safe insert with duplicate check)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM rfid_card_mapping WHERE rfid_uid = '04A3B2C1D00000') THEN
        INSERT INTO rfid_card_mapping (rfid_uid, action_type, action_data, status)
        VALUES ('04A3B2C1D00000', 'content', '{"message": "Test card"}', 1);
    END IF;
END $$;

-- =====================================================
-- DONE!
-- =====================================================
SELECT 'Schema migration completed successfully!' as status;
