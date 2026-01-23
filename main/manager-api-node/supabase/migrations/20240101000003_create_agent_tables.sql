-- Migration: Create Agent Tables
-- Description: AI agent configurations, templates, and chat history

-- =============================================
-- ai_agent - Agent configurations
-- =============================================
CREATE TABLE IF NOT EXISTS ai_agent (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id BIGINT REFERENCES sys_user(id) ON DELETE SET NULL,
    agent_code VARCHAR(100),
    agent_name VARCHAR(255) NOT NULL,
    asr_model_id VARCHAR(36),
    vad_model_id VARCHAR(36),
    llm_model_id VARCHAR(36),
    vllm_model_id VARCHAR(36),
    tts_model_id VARCHAR(36),
    tts_voice_id VARCHAR(36),
    mem_model_id VARCHAR(36),
    intent_model_id VARCHAR(36),
    chat_history_conf SMALLINT DEFAULT 0,
    system_prompt TEXT,
    summary_memory TEXT,
    lang_code VARCHAR(10) DEFAULT 'en',
    language VARCHAR(50) DEFAULT 'English',
    sort INTEGER DEFAULT 0,
    creator BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_agent_user_id ON ai_agent(user_id);
CREATE INDEX idx_ai_agent_code ON ai_agent(agent_code);

COMMENT ON TABLE ai_agent IS 'AI agent configurations';
COMMENT ON COLUMN ai_agent.chat_history_conf IS '0=no record, 1=text only, 2=text+audio';
COMMENT ON COLUMN ai_agent.system_prompt IS 'Role and behavior instructions for the LLM';

-- =============================================
-- ai_agent_template - Agent templates
-- =============================================
CREATE TABLE IF NOT EXISTS ai_agent_template (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    agent_code VARCHAR(100),
    agent_name VARCHAR(255) NOT NULL,
    asr_model_id VARCHAR(36),
    vad_model_id VARCHAR(36),
    llm_model_id VARCHAR(36),
    vllm_model_id VARCHAR(36),
    tts_model_id VARCHAR(36),
    tts_voice_id VARCHAR(36),
    mem_model_id VARCHAR(36),
    intent_model_id VARCHAR(36),
    chat_history_conf SMALLINT DEFAULT 0,
    system_prompt TEXT,
    summary_memory TEXT,
    lang_code VARCHAR(10) DEFAULT 'en',
    language VARCHAR(50) DEFAULT 'English',
    is_visible SMALLINT DEFAULT 1,
    sort INTEGER DEFAULT 0,
    creator BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_agent_template_code ON ai_agent_template(agent_code);
CREATE INDEX idx_ai_agent_template_visible ON ai_agent_template(is_visible);

COMMENT ON TABLE ai_agent_template IS 'Predefined agent templates';
COMMENT ON COLUMN ai_agent_template.is_visible IS '0=hidden, 1=visible';

-- =============================================
-- ai_agent_chat_history - Chat records
-- =============================================
CREATE TABLE IF NOT EXISTS ai_agent_chat_history (
    id BIGSERIAL PRIMARY KEY,
    mac_address VARCHAR(20) NOT NULL,
    agent_id VARCHAR(36) REFERENCES ai_agent(id) ON DELETE SET NULL,
    session_id VARCHAR(100) NOT NULL,
    chat_type SMALLINT NOT NULL,
    content TEXT,
    audio_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_agent_chat_history_mac ON ai_agent_chat_history(mac_address);
CREATE INDEX idx_ai_agent_chat_history_agent ON ai_agent_chat_history(agent_id);
CREATE INDEX idx_ai_agent_chat_history_session ON ai_agent_chat_history(session_id);
CREATE INDEX idx_ai_agent_chat_history_created ON ai_agent_chat_history(created_at);

COMMENT ON TABLE ai_agent_chat_history IS 'Agent conversation history';
COMMENT ON COLUMN ai_agent_chat_history.chat_type IS '1=User message, 2=Agent response';
COMMENT ON COLUMN ai_agent_chat_history.audio_id IS 'Reference to audio file if recorded';

-- =============================================
-- ai_agent_plugin_mapping - Agent to plugin mappings
-- =============================================
CREATE TABLE IF NOT EXISTS ai_agent_plugin_mapping (
    id BIGSERIAL PRIMARY KEY,
    agent_id VARCHAR(36) NOT NULL REFERENCES ai_agent(id) ON DELETE CASCADE,
    plugin_id VARCHAR(100) NOT NULL,
    param_info JSONB DEFAULT '{}',
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_agent_plugin_agent ON ai_agent_plugin_mapping(agent_id);
CREATE INDEX idx_ai_agent_plugin_plugin ON ai_agent_plugin_mapping(plugin_id);

COMMENT ON TABLE ai_agent_plugin_mapping IS 'Agent to plugin/tool mappings';
COMMENT ON COLUMN ai_agent_plugin_mapping.param_info IS 'Plugin-specific configuration';

-- =============================================
-- ai_agent_mcp_access_point - MCP integration points
-- =============================================
CREATE TABLE IF NOT EXISTS ai_agent_mcp_access_point (
    id BIGSERIAL PRIMARY KEY,
    agent_id VARCHAR(36) REFERENCES ai_agent(id) ON DELETE CASCADE,
    mcp_server_url VARCHAR(500),
    mcp_server_name VARCHAR(255),
    is_enabled SMALLINT DEFAULT 1,
    config_json JSONB DEFAULT '{}',
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_agent_mcp_agent ON ai_agent_mcp_access_point(agent_id);

COMMENT ON TABLE ai_agent_mcp_access_point IS 'Model Context Protocol access points';
