-- Fix kid_profile table schema to work with Supabase Auth
-- This migration updates the table to use UUIDs and correct column names

-- Drop the old kid_profile table if it exists
DROP TABLE IF EXISTS kid_profile CASCADE;

-- Create new kid_profile table with correct schema for Supabase
CREATE TABLE kid_profile (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    nickname VARCHAR(255),
    birth_date DATE,  -- Changed from date_of_birth to match service
    gender VARCHAR(20),
    grade VARCHAR(50),
    school VARCHAR(255),
    interests JSONB DEFAULT '[]',
    avatar_url VARCHAR(500),
    language VARCHAR(10) DEFAULT 'en',  -- Changed from primary_language
    timezone VARCHAR(50),
    preferences JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_kid_profile_user_id ON kid_profile(user_id);
CREATE INDEX idx_kid_profile_created_at ON kid_profile(created_at DESC);

-- Enable Row Level Security
ALTER TABLE kid_profile ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view their own kid profiles"
    ON kid_profile FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own kid profiles"
    ON kid_profile FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own kid profiles"
    ON kid_profile FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own kid profiles"
    ON kid_profile FOR DELETE
    USING (auth.uid() = user_id);

-- Service role has full access
CREATE POLICY "Service role has full access to kid profiles"
    ON kid_profile FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_kid_profile_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_kid_profile_updated_at
    BEFORE UPDATE ON kid_profile
    FOR EACH ROW
    EXECUTE FUNCTION update_kid_profile_updated_at();

-- Add comments for documentation
COMMENT ON TABLE kid_profile IS 'Child profile information for Supabase Auth users';
COMMENT ON COLUMN kid_profile.user_id IS 'UUID from auth.users table';
COMMENT ON COLUMN kid_profile.birth_date IS 'Child''s date of birth';
COMMENT ON COLUMN kid_profile.gender IS 'Child''s gender (male, female, other)';
COMMENT ON COLUMN kid_profile.interests IS 'JSON array of child''s interests';
COMMENT ON COLUMN kid_profile.preferences IS 'JSON object storing user preferences';
