-- Migration: Create Model Configuration Tables
-- Description: AI model providers and configurations

-- =============================================
-- ai_model_provider - Model provider registry
-- =============================================
CREATE TABLE IF NOT EXISTS ai_model_provider (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    model_type VARCHAR(50) NOT NULL,
    provider_code VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    fields JSONB DEFAULT '[]',
    sort INTEGER DEFAULT 0,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(model_type, provider_code)
);

CREATE INDEX idx_ai_model_provider_type ON ai_model_provider(model_type);
CREATE INDEX idx_ai_model_provider_code ON ai_model_provider(provider_code);

COMMENT ON TABLE ai_model_provider IS 'AI model provider definitions';
COMMENT ON COLUMN ai_model_provider.model_type IS 'Memory, ASR, VAD, LLM, VLLM, TTS, Intent';
COMMENT ON COLUMN ai_model_provider.fields IS 'JSON schema for provider configuration fields';

-- =============================================
-- ai_model_config - Model configurations
-- =============================================
CREATE TABLE IF NOT EXISTS ai_model_config (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    model_type VARCHAR(50) NOT NULL,
    model_code VARCHAR(100) NOT NULL,
    model_name VARCHAR(255) NOT NULL,
    is_default SMALLINT DEFAULT 0,
    is_enabled SMALLINT DEFAULT 1,
    config_json JSONB DEFAULT '{}',
    doc_link VARCHAR(500),
    remark VARCHAR(500),
    sort INTEGER DEFAULT 0,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_model_config_type ON ai_model_config(model_type);
CREATE INDEX idx_ai_model_config_code ON ai_model_config(model_code);
CREATE INDEX idx_ai_model_config_default ON ai_model_config(is_default);

COMMENT ON TABLE ai_model_config IS 'AI model configurations';
COMMENT ON COLUMN ai_model_config.model_type IS 'Memory, ASR, VAD, LLM, VLLM, TTS, Intent';
COMMENT ON COLUMN ai_model_config.is_default IS '0=no, 1=yes';
COMMENT ON COLUMN ai_model_config.is_enabled IS '0=disabled, 1=enabled';
COMMENT ON COLUMN ai_model_config.config_json IS 'Model-specific configuration (API keys, endpoints, etc.)';

-- =============================================
-- ai_tts_voice - Text-to-Speech voice configurations
-- =============================================
CREATE TABLE IF NOT EXISTS ai_tts_voice (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tts_model_id VARCHAR(36) REFERENCES ai_model_config(id) ON DELETE SET NULL,
    tts_voice VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    languages VARCHAR(255),
    remark VARCHAR(500),
    reference_audio VARCHAR(500),
    reference_text TEXT,
    voice_demo VARCHAR(500),
    sort INTEGER DEFAULT 0,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_tts_voice_model ON ai_tts_voice(tts_model_id);
CREATE INDEX idx_ai_tts_voice_name ON ai_tts_voice(name);

COMMENT ON TABLE ai_tts_voice IS 'TTS voice/timbre configurations';
COMMENT ON COLUMN ai_tts_voice.languages IS 'Comma-separated language codes';
COMMENT ON COLUMN ai_tts_voice.tts_voice IS 'Voice identifier in TTS provider';
