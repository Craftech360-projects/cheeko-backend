-- Migration: Create Device Tables
-- Description: ESP32 device management and OTA updates

-- =============================================
-- ai_device - Device information
-- =============================================
CREATE TABLE IF NOT EXISTS ai_device (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id BIGINT REFERENCES sys_user(id) ON DELETE SET NULL,
    mac_address VARCHAR(20) UNIQUE NOT NULL,
    last_connected_at TIMESTAMP WITH TIME ZONE,
    auto_update SMALLINT DEFAULT 1,
    board VARCHAR(100),
    alias VARCHAR(255),
    agent_id VARCHAR(36) REFERENCES ai_agent(id) ON DELETE SET NULL,
    kid_id BIGINT REFERENCES kid_profile(id) ON DELETE SET NULL,
    mode VARCHAR(50) DEFAULT 'conversation',
    device_mode VARCHAR(50) DEFAULT 'auto',
    app_version VARCHAR(50),
    sort INTEGER DEFAULT 0,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_device_user_id ON ai_device(user_id);
CREATE INDEX idx_ai_device_mac ON ai_device(mac_address);
CREATE INDEX idx_ai_device_agent ON ai_device(agent_id);
CREATE INDEX idx_ai_device_kid ON ai_device(kid_id);

COMMENT ON TABLE ai_device IS 'ESP32 device information';
COMMENT ON COLUMN ai_device.mode IS 'conversation, music, story';
COMMENT ON COLUMN ai_device.device_mode IS 'auto (VAD) or manual (PTT)';
COMMENT ON COLUMN ai_device.auto_update IS '0=off, 1=on';

-- =============================================
-- device_token_usage - Token usage tracking
-- =============================================
CREATE TABLE IF NOT EXISTS device_token_usage (
    id BIGSERIAL PRIMARY KEY,
    mac_address VARCHAR(20) NOT NULL,
    session_id VARCHAR(100),
    usage_date DATE NOT NULL,
    input_tokens BIGINT DEFAULT 0,
    output_tokens BIGINT DEFAULT 0,
    total_tokens BIGINT GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
    input_audio_tokens BIGINT DEFAULT 0,
    input_text_tokens BIGINT DEFAULT 0,
    input_cached_tokens BIGINT DEFAULT 0,
    output_audio_tokens BIGINT DEFAULT 0,
    output_text_tokens BIGINT DEFAULT 0,
    session_duration_seconds DOUBLE PRECISION DEFAULT 0,
    avg_ttft_seconds DOUBLE PRECISION DEFAULT 0,
    message_count INTEGER DEFAULT 0,
    total_response_duration_seconds DOUBLE PRECISION DEFAULT 0,
    session_count INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_device_token_usage_mac ON device_token_usage(mac_address);
CREATE INDEX idx_device_token_usage_date ON device_token_usage(usage_date);
CREATE INDEX idx_device_token_usage_session ON device_token_usage(session_id);

COMMENT ON TABLE device_token_usage IS 'LLM token usage tracking per device';
COMMENT ON COLUMN device_token_usage.avg_ttft_seconds IS 'Average time-to-first-token (latency)';

-- =============================================
-- ai_ota - Over-The-Air firmware updates
-- =============================================
CREATE TABLE IF NOT EXISTS ai_ota (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    firmware_name VARCHAR(255) NOT NULL,
    type VARCHAR(100),
    version VARCHAR(50) NOT NULL,
    size BIGINT,
    remark TEXT,
    firmware_path VARCHAR(500),
    force_update SMALLINT DEFAULT 0,
    sort INTEGER DEFAULT 0,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_ota_version ON ai_ota(version);
CREATE INDEX idx_ai_ota_type ON ai_ota(type);

COMMENT ON TABLE ai_ota IS 'Firmware update packages';
COMMENT ON COLUMN ai_ota.force_update IS '0=optional, 1=forced update';
COMMENT ON COLUMN ai_ota.size IS 'File size in bytes';
