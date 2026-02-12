-- Migration: Fix type casting in delete_user_account function
-- Fixes UUID vs TEXT comparison errors

-- Drop and recreate the function with proper type casting
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
    kid_count INTEGER;
    device_count INTEGER;
    agent_count INTEGER;
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

    -- Count related records before deletion (with proper type casting)
    SELECT COUNT(*) INTO kid_count FROM kid_profile WHERE user_id::UUID = current_user_id;
    SELECT COUNT(*) INTO device_count FROM device WHERE user_id IN (
        SELECT id FROM sys_user WHERE supabase_user_id::UUID = current_user_id
    );
    SELECT COUNT(*) INTO agent_count FROM ai_agent WHERE user_id::UUID = current_user_id;

    -- Add counts to result
    deleted_data := deleted_data || jsonb_build_object(
        'deleted_kids', kid_count,
        'deleted_devices', device_count,
        'deleted_agents', agent_count
    );

    -- Delete related data in correct order

    -- 1. Delete kid profiles
    DELETE FROM kid_profile WHERE user_id::UUID = current_user_id;

    -- 2. Delete parent profile
    DELETE FROM parent_profiles WHERE user_id = current_user_id;

    -- 3. Delete AI agents
    DELETE FROM ai_agent WHERE user_id::UUID = current_user_id;

    -- 4. Delete devices
    DELETE FROM device WHERE user_id IN (
        SELECT id FROM sys_user WHERE supabase_user_id::UUID = current_user_id
    );

    -- 5. Delete from user_states table (if exists)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_states') THEN
        DELETE FROM user_states WHERE user_id = current_user_id;
    END IF;

    -- 6. Delete sys_user record
    DELETE FROM sys_user WHERE supabase_user_id::UUID = current_user_id;

    -- 7. Finally, delete the auth user
    DELETE FROM auth.users WHERE id = current_user_id;

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
COMMENT ON FUNCTION public.delete_user_account IS 'Deletes all user data and auth account with proper type casting';

DO $$
BEGIN
    RAISE NOTICE 'Fixed delete_user_account function with proper type casting';
END $$;
