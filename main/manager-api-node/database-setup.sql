
-- =====================================================
-- CHEEKO MANAGER API - DATABASE SETUP
-- Run this SQL in Supabase Dashboard > SQL Editor
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- SYSTEM TABLES
-- =====================================================

-- System Users Table
CREATE TABLE IF NOT EXISTS sys_user (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE,
  password VARCHAR(255),
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(50),
  nickname VARCHAR(100),
  avatar VARCHAR(500),
  gender INTEGER DEFAULT 0,
  status INTEGER DEFAULT 1,
  role VARCHAR(50) DEFAULT 'user',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- AI MODEL TABLES
-- =====================================================

-- AI Models Table
CREATE TABLE IF NOT EXISTS ai_model (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_type VARCHAR(50) NOT NULL,
  model_name VARCHAR(200) NOT NULL,
  model_code VARCHAR(100),
  provider VARCHAR(100),
  api_key TEXT,
  api_url VARCHAR(500),
  config JSONB DEFAULT '{}',
  description TEXT,
  sort INTEGER DEFAULT 0,
  status INTEGER DEFAULT 1,
  creator BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- TTS Voices Table
CREATE TABLE IF NOT EXISTS ai_tts_voice (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tts_model_id UUID REFERENCES ai_model(id),
  voice_name VARCHAR(200) NOT NULL,
  voice_code VARCHAR(100) NOT NULL,
  gender VARCHAR(20),
  language VARCHAR(50),
  accent VARCHAR(100),
  age_group VARCHAR(50),
  style VARCHAR(100),
  preview_url VARCHAR(500),
  config JSONB DEFAULT '{}',
  sort INTEGER DEFAULT 0,
  status INTEGER DEFAULT 1,
  creator BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- AGENT TABLES
-- =====================================================

-- AI Agents Table
CREATE TABLE IF NOT EXISTS ai_agent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT REFERENCES sys_user(id),
  agent_code VARCHAR(100),
  agent_name VARCHAR(200) NOT NULL,
  asr_model_id UUID,
  vad_model_id UUID,
  llm_model_id UUID,
  vllm_model_id UUID,
  tts_model_id UUID,
  tts_voice_id UUID,
  mem_model_id UUID,
  intent_model_id UUID,
  chat_history_conf INTEGER DEFAULT 0,
  system_prompt TEXT,
  summary_memory TEXT,
  lang_code VARCHAR(10) DEFAULT 'en',
  language VARCHAR(50) DEFAULT 'English',
  sort INTEGER DEFAULT 0,
  status INTEGER DEFAULT 1,
  creator BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat History Table
CREATE TABLE IF NOT EXISTS ai_agent_chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mac_address VARCHAR(20),
  agent_id UUID REFERENCES ai_agent(id),
  session_id VARCHAR(100) NOT NULL,
  chat_type INTEGER NOT NULL,
  content TEXT,
  audio_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- KID PROFILE TABLES
-- =====================================================

-- Kid Profiles Table
CREATE TABLE IF NOT EXISTS kid_profile (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES sys_user(id),
  name VARCHAR(100) NOT NULL,
  nickname VARCHAR(100),
  avatar_url VARCHAR(500),
  birth_date DATE,
  gender VARCHAR(20),
  grade VARCHAR(50),
  school VARCHAR(200),
  interests TEXT[],
  language VARCHAR(10) DEFAULT 'en',
  timezone VARCHAR(50),
  preferences JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Kid Learning Progress Table
CREATE TABLE IF NOT EXISTS kid_learning_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kid_id BIGINT REFERENCES kid_profile(id),
  subject VARCHAR(100) NOT NULL,
  topic VARCHAR(200) NOT NULL,
  score INTEGER,
  time_spent INTEGER,
  completed BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(kid_id, subject, topic)
);

-- Kid Activity Log Table
CREATE TABLE IF NOT EXISTS kid_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kid_id BIGINT REFERENCES kid_profile(id),
  activity_type VARCHAR(50) NOT NULL,
  content_type VARCHAR(50),
  content_id UUID,
  duration INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- DEVICE TABLES
-- =====================================================

-- AI Devices Table
CREATE TABLE IF NOT EXISTS ai_device (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mac_address VARCHAR(20) NOT NULL UNIQUE,
  user_id BIGINT REFERENCES sys_user(id),
  agent_id UUID REFERENCES ai_agent(id),
  kid_id BIGINT REFERENCES kid_profile(id),
  alias VARCHAR(200),
  board VARCHAR(100),
  app_version VARCHAR(50),
  mode VARCHAR(50) DEFAULT 'conversation',
  device_mode VARCHAR(50) DEFAULT 'auto',
  auto_update INTEGER DEFAULT 1,
  last_connected_at TIMESTAMPTZ,
  create_date TIMESTAMPTZ DEFAULT NOW(),
  update_date TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- CONTENT TABLES
-- =====================================================

-- Music Table
CREATE TABLE IF NOT EXISTS ai_music (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(300) NOT NULL,
  artist VARCHAR(200),
  album VARCHAR(200),
  category VARCHAR(100),
  language VARCHAR(50),
  duration INTEGER,
  file_url VARCHAR(500),
  cover_url VARCHAR(500),
  lyrics TEXT,
  sort INTEGER DEFAULT 0,
  status INTEGER DEFAULT 1,
  creator BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Story Table
CREATE TABLE IF NOT EXISTS ai_story (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(300) NOT NULL,
  author VARCHAR(200),
  category VARCHAR(100),
  language VARCHAR(50),
  age_group VARCHAR(50),
  duration INTEGER,
  content TEXT,
  audio_url VARCHAR(500),
  cover_url VARCHAR(500),
  sort INTEGER DEFAULT 0,
  status INTEGER DEFAULT 1,
  creator BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Textbook Table
CREATE TABLE IF NOT EXISTS ai_textbook (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(300) NOT NULL,
  subject VARCHAR(100),
  grade VARCHAR(50),
  language VARCHAR(50),
  publisher VARCHAR(200),
  cover_url VARCHAR(500),
  description TEXT,
  sort INTEGER DEFAULT 0,
  status INTEGER DEFAULT 1,
  creator BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Textbook Chapters Table
CREATE TABLE IF NOT EXISTS ai_textbook_chapter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  textbook_id UUID REFERENCES ai_textbook(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  content TEXT,
  audio_url VARCHAR(500),
  sort INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- RFID TABLES
-- =====================================================

-- RFID Tags Table
CREATE TABLE IF NOT EXISTS ai_rfid_tag (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(200),
  description TEXT,
  content_type VARCHAR(50),
  content_id UUID,
  action_type VARCHAR(50),
  action_params JSONB,
  device_mac VARCHAR(20),
  status INTEGER DEFAULT 1,
  creator BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RFID Scan Log Table
CREATE TABLE IF NOT EXISTS ai_rfid_scan_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mac_address VARCHAR(20),
  rfid_uid VARCHAR(50),
  tag_id UUID REFERENCES ai_rfid_tag(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_ai_device_mac ON ai_device(mac_address);
CREATE INDEX IF NOT EXISTS idx_ai_device_user ON ai_device(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_user ON ai_agent(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_session ON ai_agent_chat_history(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_agent ON ai_agent_chat_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_rfid_uid ON ai_rfid_tag(uid);
CREATE INDEX IF NOT EXISTS idx_kid_profile_user ON kid_profile(user_id);

-- =====================================================
-- SEED DATA
-- =====================================================

-- Insert default AI models
INSERT INTO ai_model (model_type, model_name, model_code, provider, description, sort) VALUES
('asr', 'Deepgram Nova-2', 'nova-2', 'deepgram', 'Deepgram Nova-2 speech recognition', 1),
('asr', 'Whisper Large V3', 'whisper-large-v3', 'groq', 'OpenAI Whisper via Groq', 2),
('asr', 'Google Speech-to-Text', 'google-stt', 'google', 'Google Cloud Speech-to-Text', 3),
('vad', 'Silero VAD', 'silero', 'silero', 'Silero Voice Activity Detection', 1),
('llm', 'GPT-4o Mini', 'gpt-4o-mini', 'openai', 'OpenAI GPT-4o Mini', 1),
('llm', 'Claude 3.5 Sonnet', 'claude-3-5-sonnet-20241022', 'anthropic', 'Anthropic Claude 3.5 Sonnet', 2),
('llm', 'Llama 3.3 70B', 'llama-3.3-70b-versatile', 'groq', 'Meta Llama 3.3 via Groq', 3),
('llm', 'Gemini 2.0 Flash', 'gemini-2.0-flash-exp', 'google', 'Google Gemini 2.0 Flash', 4),
('tts', 'ElevenLabs', 'elevenlabs', 'elevenlabs', 'ElevenLabs Text-to-Speech', 1),
('tts', 'Edge TTS', 'edge-tts', 'microsoft', 'Microsoft Edge TTS (Free)', 2),
('tts', 'Google TTS', 'google-tts', 'google', 'Google Cloud Text-to-Speech', 3),
('mem', 'Mem0', 'mem0', 'mem0', 'Mem0 Memory System', 1)
ON CONFLICT DO NOTHING;

-- Create demo user
INSERT INTO sys_user (username, email, password, nickname, role) VALUES
('demo', 'demo@cheeko.ai', 'demo123', 'Demo User', 'admin')
ON CONFLICT (username) DO NOTHING;

-- Create default agent for demo user
INSERT INTO ai_agent (user_id, agent_code, agent_name, system_prompt, lang_code, language, creator)
SELECT id, 'cheeko', 'Cheeko',
  'You are Cheeko, a friendly AI companion for children. You are warm, encouraging, and educational. You help children learn through conversation, stories, and games. Always be age-appropriate, patient, and supportive.',
  'en', 'English', id
FROM sys_user WHERE username = 'demo'
ON CONFLICT DO NOTHING;

-- =====================================================
-- DONE!
-- =====================================================
SELECT 'Database setup complete!' as status;
