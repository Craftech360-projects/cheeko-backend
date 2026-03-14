-- Migration: Switch quota tracking from user_id to mac_address
-- Description: Each device (MAC) gets its own independent quota bucket.
--              Subscription/plan assignment stays on user_id.
--              Quota consumption is tracked per device (mac_address).

-- =============================================
-- 1. ALTER user_question_quota: add mac_address, drop user_id dependency
-- =============================================
ALTER TABLE user_question_quota ADD COLUMN IF NOT EXISTS mac_address VARCHAR(20);

-- Backfill mac_address from ai_device for existing rows
UPDATE user_question_quota q
SET mac_address = d.mac_address
FROM ai_device d
WHERE q.user_id = d.user_id
  AND q.mac_address IS NULL;

-- Drop old unique constraint and indexes
ALTER TABLE user_question_quota DROP CONSTRAINT IF EXISTS user_question_quota_user_id_month_key_key;
DROP INDEX IF EXISTS idx_user_question_quota_user_id;

-- Make mac_address NOT NULL (after backfill)
-- Delete any rows that couldn't be backfilled
DELETE FROM user_question_quota WHERE mac_address IS NULL;
ALTER TABLE user_question_quota ALTER COLUMN mac_address SET NOT NULL;

-- Make user_id nullable (kept for analytics joins)
ALTER TABLE user_question_quota ALTER COLUMN user_id DROP NOT NULL;

-- New unique constraint on mac_address + month_key
ALTER TABLE user_question_quota ADD CONSTRAINT uq_question_quota_mac_month UNIQUE (mac_address, month_key);
CREATE INDEX idx_question_quota_mac ON user_question_quota(mac_address);

-- =============================================
-- 2. ALTER user_token_quota: add mac_address, drop user_id dependency
-- =============================================
ALTER TABLE user_token_quota ADD COLUMN IF NOT EXISTS mac_address VARCHAR(20);

-- Backfill
UPDATE user_token_quota q
SET mac_address = d.mac_address
FROM ai_device d
WHERE q.user_id = d.user_id
  AND q.mac_address IS NULL;

-- Drop old constraints
ALTER TABLE user_token_quota DROP CONSTRAINT IF EXISTS user_token_quota_user_id_month_key_key;
DROP INDEX IF EXISTS idx_user_token_quota_user_id;

-- Clean up and enforce NOT NULL
DELETE FROM user_token_quota WHERE mac_address IS NULL;
ALTER TABLE user_token_quota ALTER COLUMN mac_address SET NOT NULL;
ALTER TABLE user_token_quota ALTER COLUMN user_id DROP NOT NULL;

-- New constraints
ALTER TABLE user_token_quota ADD CONSTRAINT uq_token_quota_mac_month UNIQUE (mac_address, month_key);
CREATE INDEX idx_token_quota_mac ON user_token_quota(mac_address);

-- =============================================
-- 3. ALTER game_session_protection: switch unique index to mac_address
-- =============================================
DROP INDEX IF EXISTS idx_game_session_protection_active;
CREATE UNIQUE INDEX idx_game_session_protection_active
    ON game_session_protection(mac_address, agent_type)
    WHERE status = 'active';

ALTER TABLE game_session_protection ALTER COLUMN user_id DROP NOT NULL;

-- =============================================
-- 4. Replace question quota RPCs: user_id → mac_address
-- =============================================
DROP FUNCTION IF EXISTS increment_question_quota(BIGINT, VARCHAR, INTEGER);

CREATE OR REPLACE FUNCTION increment_question_quota(
    p_mac_address VARCHAR(20),
    p_month_key VARCHAR(7),
    p_free_limit INTEGER
)
RETURNS TABLE(
    out_questions_used INTEGER,
    out_extra_purchased INTEGER,
    out_remaining INTEGER,
    out_is_exhausted BOOLEAN,
    out_month_key VARCHAR(7)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_questions_used INTEGER;
    v_extra_purchased INTEGER;
    v_total_allowed INTEGER;
    v_remaining INTEGER;
BEGIN
    INSERT INTO user_question_quota (mac_address, month_key, questions_used, extra_purchased)
    VALUES (p_mac_address, p_month_key, 1, 0)
    ON CONFLICT (mac_address, month_key)
    DO UPDATE SET
        questions_used = user_question_quota.questions_used + 1,
        updated_at = CURRENT_TIMESTAMP
    RETURNING
        user_question_quota.questions_used,
        user_question_quota.extra_purchased
    INTO v_questions_used, v_extra_purchased;

    v_total_allowed := p_free_limit + v_extra_purchased;
    v_remaining := GREATEST(0, v_total_allowed - v_questions_used);

    RETURN QUERY SELECT
        v_questions_used,
        v_extra_purchased,
        v_remaining,
        (v_remaining <= 0),
        p_month_key;
END;
$$;

DROP FUNCTION IF EXISTS grant_extra_quota(BIGINT, VARCHAR, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION grant_extra_quota(
    p_mac_address VARCHAR(20),
    p_month_key VARCHAR(7),
    p_amount INTEGER,
    p_free_limit INTEGER
)
RETURNS TABLE(
    out_questions_used INTEGER,
    out_extra_purchased INTEGER,
    out_remaining INTEGER,
    out_is_exhausted BOOLEAN,
    out_month_key VARCHAR(7)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_questions_used INTEGER;
    v_extra_purchased INTEGER;
    v_total_allowed INTEGER;
    v_remaining INTEGER;
BEGIN
    INSERT INTO user_question_quota (mac_address, month_key, questions_used, extra_purchased)
    VALUES (p_mac_address, p_month_key, 0, p_amount)
    ON CONFLICT (mac_address, month_key)
    DO UPDATE SET
        extra_purchased = user_question_quota.extra_purchased + p_amount,
        updated_at = CURRENT_TIMESTAMP
    RETURNING
        user_question_quota.questions_used,
        user_question_quota.extra_purchased
    INTO v_questions_used, v_extra_purchased;

    v_total_allowed := p_free_limit + v_extra_purchased;
    v_remaining := GREATEST(0, v_total_allowed - v_questions_used);

    RETURN QUERY SELECT
        v_questions_used,
        v_extra_purchased,
        v_remaining,
        (v_remaining <= 0),
        p_month_key;
END;
$$;

-- =============================================
-- 5. Replace token quota RPCs: user_id → mac_address
-- =============================================
DROP FUNCTION IF EXISTS consume_token_quota(BIGINT, VARCHAR, INTEGER, INTEGER, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION consume_token_quota(
    p_mac_address VARCHAR(20),
    p_month_key VARCHAR(7),
    p_weighted_tokens INTEGER,
    p_raw_input INTEGER,
    p_raw_output INTEGER,
    p_token_limit INTEGER
)
RETURNS TABLE(
    out_tokens_used INTEGER,
    out_extra_purchased INTEGER,
    out_remaining INTEGER,
    out_is_exhausted BOOLEAN,
    out_month_key VARCHAR(7)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_tokens_used INTEGER;
    v_extra_purchased INTEGER;
    v_total_allowed INTEGER;
    v_remaining INTEGER;
BEGIN
    INSERT INTO user_token_quota (mac_address, month_key, tokens_used, raw_input_tokens, raw_output_tokens, extra_purchased)
    VALUES (p_mac_address, p_month_key, p_weighted_tokens, p_raw_input, p_raw_output, 0)
    ON CONFLICT (mac_address, month_key)
    DO UPDATE SET
        tokens_used = user_token_quota.tokens_used + p_weighted_tokens,
        raw_input_tokens = user_token_quota.raw_input_tokens + p_raw_input,
        raw_output_tokens = user_token_quota.raw_output_tokens + p_raw_output,
        updated_at = CURRENT_TIMESTAMP
    RETURNING
        user_token_quota.tokens_used,
        user_token_quota.extra_purchased
    INTO v_tokens_used, v_extra_purchased;

    IF p_token_limit = -1 THEN
        v_remaining := -1;
        RETURN QUERY SELECT v_tokens_used, v_extra_purchased, v_remaining, FALSE, p_month_key;
        RETURN;
    END IF;

    v_total_allowed := p_token_limit + v_extra_purchased;
    v_remaining := GREATEST(0, v_total_allowed - v_tokens_used);

    RETURN QUERY SELECT
        v_tokens_used,
        v_extra_purchased,
        v_remaining,
        (v_remaining <= 0),
        p_month_key;
END;
$$;

DROP FUNCTION IF EXISTS grant_extra_tokens(BIGINT, VARCHAR, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION grant_extra_tokens(
    p_mac_address VARCHAR(20),
    p_month_key VARCHAR(7),
    p_amount INTEGER,
    p_token_limit INTEGER
)
RETURNS TABLE(
    out_tokens_used INTEGER,
    out_extra_purchased INTEGER,
    out_remaining INTEGER,
    out_is_exhausted BOOLEAN,
    out_month_key VARCHAR(7)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_tokens_used INTEGER;
    v_extra_purchased INTEGER;
    v_total_allowed INTEGER;
    v_remaining INTEGER;
BEGIN
    INSERT INTO user_token_quota (mac_address, month_key, tokens_used, raw_input_tokens, raw_output_tokens, extra_purchased)
    VALUES (p_mac_address, p_month_key, 0, 0, 0, p_amount)
    ON CONFLICT (mac_address, month_key)
    DO UPDATE SET
        extra_purchased = user_token_quota.extra_purchased + p_amount,
        updated_at = CURRENT_TIMESTAMP
    RETURNING
        user_token_quota.tokens_used,
        user_token_quota.extra_purchased
    INTO v_tokens_used, v_extra_purchased;

    IF p_token_limit = -1 THEN
        v_remaining := -1;
        RETURN QUERY SELECT v_tokens_used, v_extra_purchased, v_remaining, FALSE, p_month_key;
        RETURN;
    END IF;

    v_total_allowed := p_token_limit + v_extra_purchased;
    v_remaining := GREATEST(0, v_total_allowed - v_tokens_used);

    RETURN QUERY SELECT
        v_tokens_used,
        v_extra_purchased,
        v_remaining,
        (v_remaining <= 0),
        p_month_key;
END;
$$;

-- =============================================
-- 6. Replace start_game_session RPC: remove user_id, use mac_address
-- =============================================
DROP FUNCTION IF EXISTS start_game_session(BIGINT, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION start_game_session(
    p_mac_address VARCHAR(20),
    p_agent_type VARCHAR(50),
    p_session_id VARCHAR(200),
    p_free_limit INTEGER,
    p_stale_minutes INTEGER DEFAULT 60
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing_id BIGINT;
    v_quota RECORD;
    v_total_allowed INTEGER;
    v_remaining INTEGER;
BEGIN
    -- 1. Close stale sessions for this device
    UPDATE game_session_protection
    SET status = 'abandoned', ended_at = NOW(), updated_at = NOW()
    WHERE mac_address = p_mac_address
      AND status = 'active'
      AND started_at < NOW() - (p_stale_minutes || ' minutes')::INTERVAL;

    -- 2. Check for existing active session
    SELECT id INTO v_existing_id
    FROM game_session_protection
    WHERE mac_address = p_mac_address
      AND agent_type = p_agent_type
      AND status = 'active';

    IF v_existing_id IS NOT NULL THEN
        RETURN json_build_object(
            'allowed', FALSE,
            'reason', 'active_session_exists',
            'session_id', p_session_id,
            'remaining', NULL
        );
    END IF;

    -- 3. Check quota remaining (question-based by mac)
    SELECT questions_used, extra_purchased
    INTO v_quota
    FROM user_question_quota
    WHERE mac_address = p_mac_address
      AND month_key = TO_CHAR(NOW(), 'YYYY-MM');

    IF v_quota IS NOT NULL THEN
        v_total_allowed := p_free_limit + v_quota.extra_purchased;
        v_remaining := GREATEST(0, v_total_allowed - v_quota.questions_used);
    ELSE
        v_remaining := p_free_limit;
    END IF;

    IF v_remaining <= 0 THEN
        RETURN json_build_object(
            'allowed', FALSE,
            'reason', 'quota_exhausted',
            'session_id', p_session_id,
            'remaining', 0
        );
    END IF;

    -- 4. Insert new active session
    INSERT INTO game_session_protection (mac_address, agent_type, session_id, status, started_at)
    VALUES (p_mac_address, p_agent_type, p_session_id, 'active', NOW());

    RETURN json_build_object(
        'allowed', TRUE,
        'reason', 'session_started',
        'session_id', p_session_id,
        'remaining', v_remaining
    );
END;
$$;
