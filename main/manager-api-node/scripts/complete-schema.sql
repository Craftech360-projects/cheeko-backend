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
-- SEED DATA - Dictionary Types (sys_dict_type)
-- =====================================================
INSERT INTO sys_dict_type (id, dict_type, dict_name, remark, sort) VALUES
(101, 'FIRMWARE_TYPE', 'Firmware Type', 'Firmware types dictionary', 0),
(102, 'MOBILE_AREA', 'Mobile Area', 'Mobile area codes dictionary', 0)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- SEED DATA - Dictionary Data (sys_dict_data)
-- =====================================================
-- FIRMWARE_TYPE entries
INSERT INTO sys_dict_data (id, dict_type_id, dict_type, dict_label, dict_value, remark, sort) VALUES
(101001, 101, 'FIRMWARE_TYPE', 'Bread Compact WiFi', 'bread-compact-wifi', 'Bread Compact WiFi', 1),
(101002, 101, 'FIRMWARE_TYPE', 'Bread Compact WiFi + LCD', 'bread-compact-wifi-lcd', 'Bread Compact WiFi + LCD', 2),
(101003, 101, 'FIRMWARE_TYPE', 'Bread Compact ML307 AT', 'bread-compact-ml307', 'Bread Compact ML307 AT', 3),
(101004, 101, 'FIRMWARE_TYPE', 'Bread WiFi ESP32 DevKit', 'bread-compact-esp32', 'Bread WiFi ESP32 DevKit', 4),
(101005, 101, 'FIRMWARE_TYPE', 'Bread WiFi + LCD ESP32 DevKit', 'bread-compact-esp32-lcd', 'Bread WiFi + LCD ESP32 DevKit', 5),
(101006, 101, 'FIRMWARE_TYPE', 'DFRobot Beetle K10', 'df-k10', 'DFRobot Beetle K10', 6),
(101007, 101, 'FIRMWARE_TYPE', 'ESP32 CGC', 'esp32-cgc', 'ESP32 CGC', 7),
(101008, 101, 'FIRMWARE_TYPE', 'ESP BOX 3', 'esp-box-3', 'ESP BOX 3', 8),
(101009, 101, 'FIRMWARE_TYPE', 'ESP BOX', 'esp-box', 'ESP BOX', 9),
(101010, 101, 'FIRMWARE_TYPE', 'ESP BOX Lite', 'esp-box-lite', 'ESP BOX Lite', 10),
(101011, 101, 'FIRMWARE_TYPE', 'Kevin Box 1', 'kevin-box-1', 'Kevin Box 1', 11),
(101012, 101, 'FIRMWARE_TYPE', 'Kevin Box 2', 'kevin-box-2', 'Kevin Box 2', 12),
(101013, 101, 'FIRMWARE_TYPE', 'Kevin C3', 'kevin-c3', 'Kevin C3', 13),
(101014, 101, 'FIRMWARE_TYPE', 'Kevin SP V3 Dev Board', 'kevin-sp-v3-dev', 'Kevin SP V3 Dev Board', 14),
(101015, 101, 'FIRMWARE_TYPE', 'Kevin SP V4 Dev Board', 'kevin-sp-v4-dev', 'Kevin SP V4 Dev Board', 15),
(101016, 101, 'FIRMWARE_TYPE', 'Yuying 3.13 LCD Dev Board', 'kevin-yuying-313lcd', 'Yuying 3.13 LCD Dev Board', 16),
(101017, 101, 'FIRMWARE_TYPE', 'LiChuang ESP32-S3 Dev Board', 'lichuang-dev', 'LiChuang ESP32-S3 Dev Board', 17),
(101018, 101, 'FIRMWARE_TYPE', 'LiChuang ESP32-C3 Dev Board', 'lichuang-c3-dev', 'LiChuang ESP32-C3 Dev Board', 18),
(101019, 101, 'FIRMWARE_TYPE', 'Magiclick 2.4', 'magiclick-2p4', 'Magiclick 2.4', 19),
(101020, 101, 'FIRMWARE_TYPE', 'Magiclick 2.5', 'magiclick-2p5', 'Magiclick 2.5', 20),
(101021, 101, 'FIRMWARE_TYPE', 'Magiclick C3', 'magiclick-c3', 'Magiclick C3', 21),
(101022, 101, 'FIRMWARE_TYPE', 'Magiclick C3 V2', 'magiclick-c3-v2', 'Magiclick C3 V2', 22),
(101023, 101, 'FIRMWARE_TYPE', 'M5Stack CoreS3', 'm5stack-core-s3', 'M5Stack CoreS3', 23),
(101024, 101, 'FIRMWARE_TYPE', 'AtomS3 + Echo Base', 'atoms3-echo-base', 'AtomS3 + Echo Base', 24),
(101025, 101, 'FIRMWARE_TYPE', 'AtomS3R + Echo Base', 'atoms3r-echo-base', 'AtomS3R + Echo Base', 25),
(101026, 101, 'FIRMWARE_TYPE', 'AtomS3R CAM/M12 + Echo Base', 'atoms3r-cam-m12-echo-base', 'AtomS3R CAM/M12 + Echo Base', 26),
(101027, 101, 'FIRMWARE_TYPE', 'AtomMatrix + Echo Base', 'atommatrix-echo-base', 'AtomMatrix + Echo Base', 27),
(101028, 101, 'FIRMWARE_TYPE', 'X Mini C3', 'xmini-c3', 'X Mini C3', 28),
(101029, 101, 'FIRMWARE_TYPE', 'ESP32S3 KORVO2 V3 Dev Board', 'esp32s3-korvo2-v3', 'ESP32S3 KORVO2 V3 Dev Board', 29),
(101030, 101, 'FIRMWARE_TYPE', 'ESP SparkBot Dev Board', 'esp-sparkbot', 'ESP SparkBot Dev Board', 30),
(101031, 101, 'FIRMWARE_TYPE', 'ESP-Spot-S3', 'esp-spot-s3', 'ESP-Spot-S3', 31),
(101032, 101, 'FIRMWARE_TYPE', 'Waveshare ESP32-S3-Touch-AMOLED-1.8', 'esp32-s3-touch-amoled-1.8', 'Waveshare ESP32-S3-Touch-AMOLED-1.8', 32),
(101033, 101, 'FIRMWARE_TYPE', 'Waveshare ESP32-S3-Touch-LCD-1.85C', 'esp32-s3-touch-lcd-1.85c', 'Waveshare ESP32-S3-Touch-LCD-1.85C', 33),
(101034, 101, 'FIRMWARE_TYPE', 'Waveshare ESP32-S3-Touch-LCD-1.85', 'esp32-s3-touch-lcd-1.85', 'Waveshare ESP32-S3-Touch-LCD-1.85', 34),
(101035, 101, 'FIRMWARE_TYPE', 'Waveshare ESP32-S3-Touch-LCD-1.46', 'esp32-s3-touch-lcd-1.46', 'Waveshare ESP32-S3-Touch-LCD-1.46', 35),
(101036, 101, 'FIRMWARE_TYPE', 'Waveshare ESP32-S3-Touch-LCD-3.5', 'esp32-s3-touch-lcd-3.5', 'Waveshare ESP32-S3-Touch-LCD-3.5', 36),
(101037, 101, 'FIRMWARE_TYPE', 'Tudouzi', 'tudouzi', 'Tudouzi', 37),
(101038, 101, 'FIRMWARE_TYPE', 'LILYGO T-Circle-S3', 'lilygo-t-circle-s3', 'LILYGO T-Circle-S3', 38),
(101039, 101, 'FIRMWARE_TYPE', 'LILYGO T-CameraPlus-S3', 'lilygo-t-cameraplus-s3', 'LILYGO T-CameraPlus-S3', 39),
(101040, 101, 'FIRMWARE_TYPE', 'Movecall Moji AI Dev Board', 'movecall-moji-esp32s3', 'Movecall Moji AI Dev Board', 40),
(101041, 101, 'FIRMWARE_TYPE', 'Movecall CuiCan AI Board', 'movecall-cuican-esp32s3', 'Movecall CuiCan AI Board', 41),
(101042, 101, 'FIRMWARE_TYPE', 'Alientek DNESP32S3 Dev Board', 'atk-dnesp32s3', 'Alientek DNESP32S3 Dev Board', 42),
(101043, 101, 'FIRMWARE_TYPE', 'Alientek DNESP32S3-BOX', 'atk-dnesp32s3-box', 'Alientek DNESP32S3-BOX', 43),
(101044, 101, 'FIRMWARE_TYPE', 'DuDu CHATX (WiFi)', 'du-chatx', 'DuDu CHATX (WiFi)', 44),
(101045, 101, 'FIRMWARE_TYPE', 'TaiJi Pi ESP32S3', 'taiji-pi-s3', 'TaiJi Pi ESP32S3', 45),
(101046, 101, 'FIRMWARE_TYPE', 'XingZhi Cube 0.85 (WiFi)', 'xingzhi-cube-0.85tft-wifi', 'XingZhi Cube 0.85 (WiFi)', 46),
(101047, 101, 'FIRMWARE_TYPE', 'XingZhi Cube 0.85 (ML307)', 'xingzhi-cube-0.85tft-ml307', 'XingZhi Cube 0.85 (ML307)', 47),
(101048, 101, 'FIRMWARE_TYPE', 'XingZhi Cube 0.96 (WiFi)', 'xingzhi-cube-0.96oled-wifi', 'XingZhi Cube 0.96 (WiFi)', 48),
(101049, 101, 'FIRMWARE_TYPE', 'XingZhi Cube 0.96 (ML307)', 'xingzhi-cube-0.96oled-ml307', 'XingZhi Cube 0.96 (ML307)', 49),
(101050, 101, 'FIRMWARE_TYPE', 'XingZhi Cube 1.54 (WiFi)', 'xingzhi-cube-1.54tft-wifi', 'XingZhi Cube 1.54 (WiFi)', 50),
(101051, 101, 'FIRMWARE_TYPE', 'XingZhi Cube 1.54 (ML307)', 'xingzhi-cube-1.54tft-ml307', 'XingZhi Cube 1.54 (ML307)', 51),
(101052, 101, 'FIRMWARE_TYPE', 'SenseCAP Watcher', 'sensecap-watcher', 'SenseCAP Watcher', 52),
(101053, 101, 'FIRMWARE_TYPE', 'DoIT AI Voice Box', 'doit-s3-aibox', 'DoIT AI Voice Box', 53),
(101054, 101, 'FIRMWARE_TYPE', 'MixGo Nova', 'mixgo-nova', 'MixGo Nova', 54),
(101055, 101, 'FIRMWARE_TYPE', 'DoIT AI 01 Kit', 'doit-ai-01-kit', 'DoIT AI 01 Kit', 55)
ON CONFLICT (id) DO NOTHING;

-- MOBILE_AREA entries
INSERT INTO sys_dict_data (id, dict_type_id, dict_type, dict_label, dict_value, remark, sort) VALUES
(102001, 102, 'MOBILE_AREA', 'China', '+86', 'China', 1),
(102002, 102, 'MOBILE_AREA', 'Hong Kong', '+852', 'Hong Kong', 2),
(102003, 102, 'MOBILE_AREA', 'Macau', '+853', 'Macau', 3),
(102004, 102, 'MOBILE_AREA', 'Taiwan', '+886', 'Taiwan', 4),
(102005, 102, 'MOBILE_AREA', 'USA/Canada', '+1', 'USA/Canada', 5),
(102006, 102, 'MOBILE_AREA', 'United Kingdom', '+44', 'United Kingdom', 6),
(102007, 102, 'MOBILE_AREA', 'France', '+33', 'France', 7),
(102008, 102, 'MOBILE_AREA', 'Italy', '+39', 'Italy', 8),
(102009, 102, 'MOBILE_AREA', 'Germany', '+49', 'Germany', 9),
(102010, 102, 'MOBILE_AREA', 'Poland', '+48', 'Poland', 10),
(102011, 102, 'MOBILE_AREA', 'Switzerland', '+41', 'Switzerland', 11),
(102012, 102, 'MOBILE_AREA', 'Spain', '+34', 'Spain', 12),
(102013, 102, 'MOBILE_AREA', 'Denmark', '+45', 'Denmark', 13),
(102014, 102, 'MOBILE_AREA', 'Malaysia', '+60', 'Malaysia', 14),
(102015, 102, 'MOBILE_AREA', 'Australia', '+61', 'Australia', 15),
(102016, 102, 'MOBILE_AREA', 'Indonesia', '+62', 'Indonesia', 16),
(102017, 102, 'MOBILE_AREA', 'Philippines', '+63', 'Philippines', 17),
(102018, 102, 'MOBILE_AREA', 'New Zealand', '+64', 'New Zealand', 18),
(102019, 102, 'MOBILE_AREA', 'Singapore', '+65', 'Singapore', 19),
(102020, 102, 'MOBILE_AREA', 'Thailand', '+66', 'Thailand', 20),
(102021, 102, 'MOBILE_AREA', 'Japan', '+81', 'Japan', 21),
(102022, 102, 'MOBILE_AREA', 'South Korea', '+82', 'South Korea', 22),
(102023, 102, 'MOBILE_AREA', 'Vietnam', '+84', 'Vietnam', 23),
(102024, 102, 'MOBILE_AREA', 'India', '+91', 'India', 24),
(102025, 102, 'MOBILE_AREA', 'Pakistan', '+92', 'Pakistan', 25),
(102026, 102, 'MOBILE_AREA', 'Nigeria', '+234', 'Nigeria', 26),
(102027, 102, 'MOBILE_AREA', 'Bangladesh', '+880', 'Bangladesh', 27),
(102028, 102, 'MOBILE_AREA', 'Saudi Arabia', '+966', 'Saudi Arabia', 28),
(102029, 102, 'MOBILE_AREA', 'UAE', '+971', 'United Arab Emirates', 29),
(102030, 102, 'MOBILE_AREA', 'Brazil', '+55', 'Brazil', 30),
(102031, 102, 'MOBILE_AREA', 'Mexico', '+52', 'Mexico', 31),
(102032, 102, 'MOBILE_AREA', 'Chile', '+56', 'Chile', 32),
(102033, 102, 'MOBILE_AREA', 'Argentina', '+54', 'Argentina', 33),
(102034, 102, 'MOBILE_AREA', 'Egypt', '+20', 'Egypt', 34),
(102035, 102, 'MOBILE_AREA', 'South Africa', '+27', 'South Africa', 35),
(102036, 102, 'MOBILE_AREA', 'Kenya', '+254', 'Kenya', 36),
(102037, 102, 'MOBILE_AREA', 'Tanzania', '+255', 'Tanzania', 37),
(102038, 102, 'MOBILE_AREA', 'Russia', '+7', 'Russia', 38)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- SEED DATA - System Parameters (sys_params)
-- =====================================================
INSERT INTO sys_params (id, param_code, param_value, value_type, param_type, remark) VALUES
(102, 'server.secret', 'da11d988-f105-4e71-b095-da62ada82189', 'string', 1, 'Server secret key for authentication'),
(103, 'server.allow_user_register', 'true', 'boolean', 1, 'Allow user self-registration'),
(104, 'server.fronted_url', 'http://localhost:8001', 'string', 1, 'Frontend URL for device binding QR code'),
(106, 'server.websocket', 'ws://localhost:8000/xiaozhi/v1/', 'string', 1, 'WebSocket server URLs (semicolon separated)'),
(107, 'server.ota', 'http://localhost:8002/toy/ota/', 'string', 1, 'OTA firmware update URL'),
(108, 'server.name', 'cheeko-esp32-server', 'string', 1, 'Server name'),
(302, 'close_connection_no_voice_time', '120', 'number', 1, 'Time to disconnect when no voice input (seconds)'),
(305, 'enable_greeting', 'true', 'boolean', 1, 'Enable greeting message on connection'),
(309, 'cheeko', '{
  "type": "hello",
  "version": 1,
  "transport": "websocket",
  "audio_params": {
    "format": "opus",
    "sample_rate": 16000,
    "channels": 1,
    "frame_duration": 60
  }
}', 'json', 1, 'Protocol configuration JSON'),
(310, 'wakeup_words', 'hello cheeko;hey cheeko;cheeko cheeko;hey assistant;hello assistant;wake up;listen to me;hey buddy', 'array', 1, 'Wake word list for wake word recognition'),
(500, 'end_prompt.enable', 'true', 'boolean', 1, 'Enable end prompt feature'),
(501, 'end_prompt.prompt', 'Goodbye! Looking forward to chatting with you again!', 'string', 1, 'End prompt message template'),
(600, 'mqtt.broker', 'localhost', 'string', 1, 'MQTT broker IP address or hostname'),
(601, 'mqtt.port', '1883', 'string', 1, 'MQTT broker port'),
(602, 'mqtt.signature_key', 'test-signature-key-12345', 'string', 1, 'MQTT password signature key for HMAC-SHA256'),
(701, 'server.enable_mobile_register', 'false', 'boolean', 1, 'Enable mobile registration'),
(702, 'server.beian_icp_num', '', 'string', 1, 'ICP registration number'),
(703, 'server.beian_ga_num', '', 'string', 1, 'GA registration number')
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- SEED DATA - Admin User (sys_user)
-- =====================================================
INSERT INTO sys_user (id, username, password, nickname, gender, status, role) VALUES
(2009521127141888000, 'admin', '$2a$10$UaqDQlwQWgEz9pi76AHc/.8FZkVyQkIyHooQClEGplGjOAagtRPi', 'Administrator', 0, 1, 'admin')
ON CONFLICT (id) DO NOTHING;

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
-- SEED DATA - Agent Templates (ai_agent_template)
-- Note: UUIDs are deterministically generated from template names
-- Model IDs are NULL (can be configured via Template Management UI)
-- =====================================================
INSERT INTO ai_agent_template (id, agent_code, agent_name, asr_model_id, vad_model_id, llm_model_id, vllm_model_id, tts_model_id, tts_voice_id, mem_model_id, intent_model_id, chat_history_conf, system_prompt, summary_memory, lang_code, language, is_visible, sort, created_at, updated_at) VALUES
('5482b215-8701-4319-8f0b-53e325aafa64', 'Cheeko', 'Cheeko', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 'You are CHEEKO, a fun, witty, and slightly mischievous AI friend for kids. Be energetic, dramatic, and expressive. Use Indian cultural references and expressions. Always be supportive and warm.', NULL, 'en', 'English', 1, 0, NOW(), NOW()),
('b00cb68d-b69b-4a04-8f4f-84bf4ef10f7b', 'math_tutor', 'Math Tutor', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 'You are CHEEKO the Math Commander. Create fun math adventures with story-based problems. Use Indian contexts like cricket, festivals, and food. Celebrate correct answers enthusiastically!', NULL, 'en', 'English', 1, 10, NOW(), NOW()),
('4a6780d2-3ed0-419b-bb23-736c4a8f9df3', 'word_ladder', 'Word Ladder', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 'You are CHEEKO the Word Engine Pilot. Play word chain games where each word must start with the last letter of the previous word. Build chains of 10 words to win!', NULL, 'en', 'English', 1, 11, NOW(), NOW()),
('3b4001ef-03df-4f6e-8ee7-392399356e01', 'riddle_solver', 'Riddle Solver', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 'You are CHEEKO the Master of Mysteries. Present riddles in mysterious locations. Use Indian objects and cultural references. Celebrate when riddles are solved!', NULL, 'en', 'English', 1, 12, NOW(), NOW()),
('8ce4a93a-8937-4167-a1e0-d7598e1270da', 'storyteller', 'StoryTeller', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 2, 'You are CHEEKO the Storyteller. Read stories expressively with different voices for characters. Use sound effects and dramatic pauses. Also recite shlokas and mantras peacefully.', NULL, 'en', 'English', 1, 13, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  agent_code = EXCLUDED.agent_code,
  agent_name = EXCLUDED.agent_name,
  chat_history_conf = EXCLUDED.chat_history_conf,
  system_prompt = EXCLUDED.system_prompt,
  summary_memory = EXCLUDED.summary_memory,
  lang_code = EXCLUDED.lang_code,
  language = EXCLUDED.language,
  is_visible = EXCLUDED.is_visible,
  sort = EXCLUDED.sort,
  updated_at = NOW();

-- =====================================================
-- DONE!
-- =====================================================
SELECT 'Schema migration completed successfully!' as status;
