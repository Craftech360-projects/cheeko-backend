-- Migration: Change ai_agent.user_id to VARCHAR for Supabase Auth UUID support
-- Description: Change user_id from BIGINT to VARCHAR to support both legacy sys_user IDs and Supabase Auth UUIDs

-- Drop the foreign key constraint to sys_user (we'll handle user relationships via Supabase Auth)
ALTER TABLE ai_agent DROP CONSTRAINT IF EXISTS ai_agent_user_id_fkey;

-- Change user_id from BIGINT to VARCHAR(100) to accept UUID strings
ALTER TABLE ai_agent ALTER COLUMN user_id TYPE VARCHAR(100) USING user_id::VARCHAR;

-- Update index to reflect new column type
DROP INDEX IF EXISTS idx_ai_agent_user_id;
CREATE INDEX idx_ai_agent_user_id ON ai_agent(user_id);

-- Update comment
COMMENT ON COLUMN ai_agent.user_id IS 'User ID - can be Supabase Auth UUID (VARCHAR) or legacy sys_user ID (numeric string)';
