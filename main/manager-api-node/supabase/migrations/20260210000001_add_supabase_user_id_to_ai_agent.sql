-- Migration: Add supabase_user_id to ai_agent
-- Description: Add Supabase Auth user UUID column to ai_agent table for Supabase Auth migration

-- Add supabase_user_id column to ai_agent table
ALTER TABLE ai_agent
ADD COLUMN IF NOT EXISTS supabase_user_id VARCHAR(100);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_ai_agent_supabase_user_id ON ai_agent(supabase_user_id);

-- Update comment
COMMENT ON COLUMN ai_agent.supabase_user_id IS 'Supabase Auth user UUID (replaces user_id for Supabase Auth users)';

-- Note: user_id (BIGINT) is kept for backward compatibility with legacy sys_user system
-- New agents should use supabase_user_id, old agents can continue using user_id
