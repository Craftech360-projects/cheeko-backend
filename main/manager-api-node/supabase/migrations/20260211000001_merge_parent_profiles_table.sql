-- Migration: Merge parent_profile (backend) and parent_profiles (mobile app) into single parent_profiles table
-- This migration:
-- 1. Creates the new merged parent_profiles table
-- 2. Migrates data from old parent_profile table if it exists
-- 3. Drops the old parent_profile table
-- 4. Sets up RLS policies, indexes, and triggers

-- =====================================================
-- Step 1: Create new parent_profiles table (if not exists)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.parent_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    sys_user_id BIGINT,
    parent_name TEXT,
    display_name VARCHAR(255),
    email VARCHAR(255),
    phone_number VARCHAR(50),
    avatar_url VARCHAR(500),
    preferred_language VARCHAR(10) DEFAULT 'en',
    timezone VARCHAR(100) DEFAULT 'UTC',
    notification_preferences JSONB DEFAULT '{"push": true, "email": true, "daily_summary": true}'::jsonb,
    email_notifications BOOLEAN DEFAULT true,
    push_notifications BOOLEAN DEFAULT true,
    weekly_report BOOLEAN DEFAULT true,
    onboarding_completed BOOLEAN DEFAULT false,
    terms_accepted_at TIMESTAMPTZ,
    terms_version VARCHAR(20),
    privacy_policy_accepted_at TIMESTAMPTZ,
    java_user_id INTEGER,
    java_token TEXT,
    generated_password_hash TEXT,
    fcm_token TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT parent_profiles_user_id_key UNIQUE(user_id)
);

-- =====================================================
-- Step 2: Migrate data from old parent_profile if it exists
-- =====================================================
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'parent_profile') THEN
        -- Migrate existing data from parent_profile to parent_profiles
        INSERT INTO parent_profiles (
            sys_user_id,
            parent_name,
            email,
            phone_number,
            preferred_language,
            timezone,
            notification_preferences,
            onboarding_completed,
            terms_accepted_at,
            privacy_policy_accepted_at,
            created_at,
            updated_at
        )
        SELECT
            user_id,
            full_name,
            email,
            phone_number,
            COALESCE(preferred_language, 'en'),
            timezone,
            COALESCE(notification_preferences, '{"push": true, "email": true, "daily_summary": true}'::jsonb),
            COALESCE(onboarding_completed, false),
            terms_accepted_at,
            privacy_policy_accepted_at,
            COALESCE(create_date, NOW()),
            COALESCE(update_date, NOW())
        FROM parent_profile
        ON CONFLICT DO NOTHING;

        -- Drop old table
        DROP TABLE IF EXISTS parent_profile CASCADE;

        RAISE NOTICE 'Migrated data from parent_profile to parent_profiles and dropped old table';
    END IF;
END $$;

-- =====================================================
-- Step 3: Create Indexes
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_parent_profiles_user_id ON parent_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_sys_user_id ON parent_profiles(sys_user_id);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_email ON parent_profiles(email);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_created_at ON parent_profiles(created_at DESC);

-- =====================================================
-- Step 4: Add Foreign Key (sys_user_id -> sys_user)
-- =====================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'parent_profiles_sys_user_id_fkey'
        AND table_name = 'parent_profiles'
    ) THEN
        ALTER TABLE parent_profiles
            ADD CONSTRAINT parent_profiles_sys_user_id_fkey
            FOREIGN KEY (sys_user_id) REFERENCES sys_user(id) ON DELETE SET NULL;
    END IF;
END $$;

-- =====================================================
-- Step 5: Create updated_at trigger
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_parent_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_parent_profiles_updated_at ON parent_profiles;
CREATE TRIGGER trigger_update_parent_profiles_updated_at
    BEFORE UPDATE ON parent_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_parent_profiles_updated_at();

-- =====================================================
-- Step 6: Enable RLS and create policies
-- =====================================================
ALTER TABLE parent_profiles ENABLE ROW LEVEL SECURITY;

-- Users can view their own profile (via auth.uid matching user_id)
DROP POLICY IF EXISTS "Users can view own parent profile" ON parent_profiles;
CREATE POLICY "Users can view own parent profile"
    ON parent_profiles FOR SELECT
    USING (auth.uid() = user_id);

-- Users can insert their own profile
DROP POLICY IF EXISTS "Users can insert own parent profile" ON parent_profiles;
CREATE POLICY "Users can insert own parent profile"
    ON parent_profiles FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own profile
DROP POLICY IF EXISTS "Users can update own parent profile" ON parent_profiles;
CREATE POLICY "Users can update own parent profile"
    ON parent_profiles FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Users can delete their own profile
DROP POLICY IF EXISTS "Users can delete own parent profile" ON parent_profiles;
CREATE POLICY "Users can delete own parent profile"
    ON parent_profiles FOR DELETE
    USING (auth.uid() = user_id);

-- Service role has full access (for backend operations)
DROP POLICY IF EXISTS "Service role full access parent profiles" ON parent_profiles;
CREATE POLICY "Service role full access parent profiles"
    ON parent_profiles FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

-- =====================================================
-- Step 7: Grant permissions
-- =====================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON parent_profiles TO authenticated;

-- =====================================================
-- Done
-- =====================================================
DO $$
BEGIN
    RAISE NOTICE 'Migration complete: parent_profiles merged table created successfully';
END $$;
