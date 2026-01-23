-- Add missing tables for auth and RFID

-- sys_user_token - Authentication tokens
CREATE TABLE IF NOT EXISTS sys_user_token (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL,
    expire_date TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sys_user_token_user_id ON sys_user_token(user_id);
CREATE INDEX IF NOT EXISTS idx_sys_user_token_token ON sys_user_token(token);
CREATE INDEX IF NOT EXISTS idx_sys_user_token_expire ON sys_user_token(expire_date);

-- rfid_card_mapping - RFID card to content mapping
CREATE TABLE IF NOT EXISTS rfid_card_mapping (
    id BIGSERIAL PRIMARY KEY,
    rfid_uid VARCHAR(100) NOT NULL,
    content_pack_id BIGINT,
    question_ids JSONB DEFAULT '[]',
    action_type VARCHAR(50) DEFAULT 'content',
    action_data JSONB DEFAULT '{}',
    emotions JSONB DEFAULT '[]',
    priority INTEGER DEFAULT 0,
    status INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rfid_card_mapping_uid ON rfid_card_mapping(rfid_uid);
CREATE INDEX IF NOT EXISTS idx_rfid_card_mapping_pack ON rfid_card_mapping(content_pack_id);

-- rfid_pack - RFID content packs
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

-- rfid_series - RFID UID ranges
CREATE TABLE IF NOT EXISTS rfid_series (
    id BIGSERIAL PRIMARY KEY,
    series_name VARCHAR(255) NOT NULL,
    start_uid VARCHAR(100) NOT NULL,
    end_uid VARCHAR(100) NOT NULL,
    content_pack_id BIGINT REFERENCES rfid_pack(id),
    priority INTEGER DEFAULT 0,
    status INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- game_session - Analytics sessions
CREATE TABLE IF NOT EXISTS game_session (
    id BIGSERIAL PRIMARY KEY,
    mac_address VARCHAR(50) NOT NULL,
    game_type VARCHAR(50) NOT NULL,
    session_id VARCHAR(100),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    total_attempts INTEGER DEFAULT 0,
    correct_attempts INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_game_session_mac ON game_session(mac_address);
CREATE INDEX IF NOT EXISTS idx_game_session_type ON game_session(game_type);

-- sys_params - System parameters
CREATE TABLE IF NOT EXISTS sys_params (
    id BIGSERIAL PRIMARY KEY,
    param_code VARCHAR(100) UNIQUE NOT NULL,
    param_value TEXT,
    value_type VARCHAR(50) DEFAULT 'string',
    param_type INTEGER DEFAULT 1,
    remark VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- sys_dict_type - Dictionary types
CREATE TABLE IF NOT EXISTS sys_dict_type (
    id BIGSERIAL PRIMARY KEY,
    dict_type VARCHAR(100) UNIQUE NOT NULL,
    dict_name VARCHAR(255) NOT NULL,
    remark VARCHAR(500),
    sort INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- sys_dict_data - Dictionary values
CREATE TABLE IF NOT EXISTS sys_dict_data (
    id BIGSERIAL PRIMARY KEY,
    dict_type_id BIGINT REFERENCES sys_dict_type(id) ON DELETE CASCADE,
    dict_type VARCHAR(100),
    dict_label VARCHAR(255) NOT NULL,
    dict_value VARCHAR(255) NOT NULL,
    remark VARCHAR(500),
    sort INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sys_dict_data_type ON sys_dict_data(dict_type);

-- kid_profile - Child profiles
CREATE TABLE IF NOT EXISTS kid_profile (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES sys_user(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    date_of_birth DATE,
    gender VARCHAR(20),
    interests JSONB DEFAULT '[]',
    avatar_url VARCHAR(500),
    primary_language VARCHAR(10) DEFAULT 'en',
    additional_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kid_profile_user_id ON kid_profile(user_id);

-- content_library - Unified content library
CREATE TABLE IF NOT EXISTS content_library (
    id BIGSERIAL PRIMARY KEY,
    content_type VARCHAR(50) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    url VARCHAR(1000),
    thumbnail_url VARCHAR(500),
    duration_seconds INTEGER,
    category VARCHAR(100),
    tags JSONB DEFAULT '[]',
    age_min INTEGER,
    age_max INTEGER,
    language VARCHAR(50) DEFAULT 'en',
    metadata JSONB DEFAULT '{}',
    status INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_content_library_type ON content_library(content_type);
CREATE INDEX IF NOT EXISTS idx_content_library_category ON content_library(category);

-- device_playlist - Device playlists
CREATE TABLE IF NOT EXISTS device_playlist (
    id BIGSERIAL PRIMARY KEY,
    device_id BIGINT,
    mac_address VARCHAR(50),
    content_id BIGINT REFERENCES content_library(id) ON DELETE CASCADE,
    playlist_type VARCHAR(50) DEFAULT 'music',
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_device_playlist_mac ON device_playlist(mac_address);
CREATE INDEX IF NOT EXISTS idx_device_playlist_type ON device_playlist(playlist_type);
