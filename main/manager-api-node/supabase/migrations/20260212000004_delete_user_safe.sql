-- Migration: Safe delete_user_account function that checks table existence
-- Only deletes from tables that actually exist

DROP FUNCTION IF EXISTS public.delete_user_account(TEXT);

CREATE OR REPLACE FUNCTION public.delete_user_account(deletion_reason TEXT DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    current_user_id UUID;
    deleted_data JSONB;
    kid_count INTEGER := 0;
    device_count INTEGER := 0;
    agent_count INTEGER := 0;
    sys_user_count INTEGER := 0;
BEGIN
    -- Get the current authenticated user's ID
    current_user_id := auth.uid();

    -- Check if user is authenticated
    IF current_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Initialize result object
    deleted_data := jsonb_build_object(
        'user_id', current_user_id,
        'deletion_reason', deletion_reason,
        'deleted_at', NOW()
    );

    -- Count and delete kid profiles (if table exists)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'kid_profile') THEN
        SELECT COUNT(*) INTO kid_count FROM kid_profile WHERE user_id::UUID = current_user_id;
        DELETE FROM kid_profile WHERE user_id::UUID = current_user_id;
        RAISE NOTICE 'Deleted % kid profiles', kid_count;
    END IF;

    -- Delete parent profile (if table exists)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'parent_profiles') THEN
        DELETE FROM parent_profiles WHERE user_id = current_user_id;
        RAISE NOTICE 'Deleted parent profile';
    END IF;

    -- Count and delete AI agents (if table exists)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_agent') THEN
        SELECT COUNT(*) INTO agent_count FROM ai_agent WHERE user_id::UUID = current_user_id;
        DELETE FROM ai_agent WHERE user_id::UUID = current_user_id;
        RAISE NOTICE 'Deleted % AI agents', agent_count;
    END IF;

    -- Count and delete devices (if table exists)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'device') THEN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sys_user') THEN
            SELECT COUNT(*) INTO device_count FROM device WHERE user_id IN (
                SELECT id FROM sys_user WHERE supabase_user_id::UUID = current_user_id
            );
            DELETE FROM device WHERE user_id IN (
                SELECT id FROM sys_user WHERE supabase_user_id::UUID = current_user_id
            );
            RAISE NOTICE 'Deleted % devices', device_count;
        END IF;
    END IF;

    -- Delete from user_states (if table exists)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_states') THEN
        DELETE FROM user_states WHERE user_id = current_user_id;
        RAISE NOTICE 'Deleted user_states entry';
    END IF;

    -- Delete sys_user record (if table exists)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sys_user') THEN
        SELECT COUNT(*) INTO sys_user_count FROM sys_user WHERE supabase_user_id::UUID = current_user_id;
        DELETE FROM sys_user WHERE supabase_user_id::UUID = current_user_id;
        RAISE NOTICE 'Deleted % sys_user records', sys_user_count;
    END IF;

    -- Add counts to result
    deleted_data := deleted_data || jsonb_build_object(
        'deleted_kids', kid_count,
        'deleted_devices', device_count,
        'deleted_agents', agent_count,
        'deleted_sys_users', sys_user_count
    );

    -- Finally, delete the auth user (this will cascade to related auth tables)
    DELETE FROM auth.users WHERE id = current_user_id;
    RAISE NOTICE 'Deleted auth user';

    RAISE NOTICE 'Successfully deleted account for user: %', current_user_id;

    RETURN deleted_data;

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Error deleting account: %', SQLERRM;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.delete_user_account(TEXT) TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.delete_user_account IS 'Safely deletes all user data and auth account, checking table existence first';

DO $$
BEGIN
    RAISE NOTICE 'Created safe delete_user_account function';
END $$;
