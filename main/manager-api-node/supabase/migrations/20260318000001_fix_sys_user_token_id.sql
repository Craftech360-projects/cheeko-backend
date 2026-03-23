-- Migration: Fix sys_user_token id column to auto-generate
-- Description: The id column may not have a default sequence if the table
--              was imported from MySQL. This ensures BIGSERIAL behavior.

-- Create sequence if it doesn't exist
DO $$
BEGIN
    -- Check if the column already has a default
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sys_user_token'
          AND column_name = 'id'
          AND column_default IS NOT NULL
    ) THEN
        -- Create a sequence and set it as default
        CREATE SEQUENCE IF NOT EXISTS sys_user_token_id_seq;

        -- Set the sequence to start after the max existing id
        PERFORM setval('sys_user_token_id_seq', COALESCE((SELECT MAX(id) FROM sys_user_token), 0) + 1, false);

        -- Set the default
        ALTER TABLE sys_user_token ALTER COLUMN id SET DEFAULT nextval('sys_user_token_id_seq');

        -- Own the sequence to the column (so it gets dropped if column is dropped)
        ALTER SEQUENCE sys_user_token_id_seq OWNED BY sys_user_token.id;
    END IF;
END
$$;
