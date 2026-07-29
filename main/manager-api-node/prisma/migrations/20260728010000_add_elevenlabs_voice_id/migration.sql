ALTER TABLE ai_agent_template
ADD COLUMN IF NOT EXISTS elevenlabs_voice_id VARCHAR(100);
