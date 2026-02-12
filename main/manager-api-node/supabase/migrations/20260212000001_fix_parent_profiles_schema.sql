-- Fix parent_profiles table schema to match backend requirements
-- This handles the case where the table was created by the mobile app with old schema

-- Step 1: Add missing columns if they don't exist
DO $$
BEGIN
    -- Add sys_user_id if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'parent_profiles' AND column_name = 'sys_user_id') THEN
        ALTER TABLE parent_profiles ADD COLUMN sys_user_id BIGINT;
    END IF;

    -- Add display_name if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'parent_profiles' AND column_name = 'display_name') THEN
        ALTER TABLE parent_profiles ADD COLUMN display_name VARCHAR(255);
    END IF;

    -- Add avatar_url if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'parent_profiles' AND column_name = 'avatar_url') THEN
        ALTER TABLE parent_profiles ADD COLUMN avatar_url VARCHAR(500);
    END IF;

    -- Add terms_version if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'parent_profiles' AND column_name = 'terms_version') THEN
        ALTER TABLE parent_profiles ADD COLUMN terms_version VARCHAR(20);
    END IF;

    -- Add java_user_id if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'parent_profiles' AND column_name = 'java_user_id') THEN
        ALTER TABLE parent_profiles ADD COLUMN java_user_id INTEGER;
    END IF;

    -- Add java_token if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'parent_profiles' AND column_name = 'java_token') THEN
        ALTER TABLE parent_profiles ADD COLUMN java_token TEXT;
    END IF;

    -- Add generated_password_hash if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'parent_profiles' AND column_name = 'generated_password_hash') THEN
        ALTER TABLE parent_profiles ADD COLUMN generated_password_hash TEXT;
    END IF;
END $$;

-- Step 2: Rename old columns if they exist
DO $$
BEGIN
    -- Drop old index on parent_email before renaming
    DROP INDEX IF EXISTS idx_parent_profiles_email;

    -- Rename parent_email to email if parent_email exists
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'parent_profiles' AND column_name = 'parent_email') THEN
        ALTER TABLE parent_profiles RENAME COLUMN parent_email TO email;
        RAISE NOTICE 'Renamed parent_email to email';
    END IF;

    -- Rename parent_phone_number to phone_number if parent_phone_number exists
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'parent_profiles' AND column_name = 'parent_phone_number') THEN
        ALTER TABLE parent_profiles RENAME COLUMN parent_phone_number TO phone_number;
        RAISE NOTICE 'Renamed parent_phone_number to phone_number';
    END IF;
END $$;

-- Step 3: Create missing indexes
CREATE INDEX IF NOT EXISTS idx_parent_profiles_user_id ON parent_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_sys_user_id ON parent_profiles(sys_user_id);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_email ON parent_profiles(email);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_created_at ON parent_profiles(created_at DESC);

-- Step 4: Add foreign key constraint if it doesn't exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sys_user') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'parent_profiles_sys_user_id_fkey'
            AND table_name = 'parent_profiles'
        ) THEN
            ALTER TABLE parent_profiles
                ADD CONSTRAINT parent_profiles_sys_user_id_fkey
                FOREIGN KEY (sys_user_id) REFERENCES sys_user(id) ON DELETE SET NULL;
        END IF;
    END IF;
END $$;

-- Step 5: Ensure updated_at trigger exists
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

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Fixed parent_profiles table schema successfully';
END $$;
