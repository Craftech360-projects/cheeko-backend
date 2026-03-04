-- Game Session Protection
-- Allows active game sessions to finish even if monthly quota expires mid-game.
-- Prevents starting NEW games once quota is exhausted.

-- ============================================================================
-- TABLE: game_session_protection
-- ============================================================================
CREATE TABLE IF NOT EXISTS game_session_protection (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES sys_user(id),
    mac_address VARCHAR(20) NOT NULL,
    agent_type VARCHAR(50) NOT NULL,       -- 'math_tutor', 'riddle_solver', 'word_ladder'
    session_id VARCHAR(100) NOT NULL,      -- room_name for correlation
    status VARCHAR(20) NOT NULL DEFAULT 'active',  -- 'active', 'completed', 'abandoned'
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Core anti-exploit mechanism: only 1 active session per user per agent_type
CREATE UNIQUE INDEX idx_game_session_protection_active
    ON game_session_protection (user_id, agent_type) WHERE status = 'active';

-- Lookup indexes
CREATE INDEX idx_game_session_protection_user ON game_session_protection (user_id);
CREATE INDEX idx_game_session_protection_session ON game_session_protection (session_id);

-- ============================================================================
-- RPC: start_game_session
-- Atomic function that:
--   1. Closes stale active sessions (older than p_stale_minutes)
--   2. Checks for existing active session
--   3. Checks quota
--   4. Inserts new active session if allowed
-- ============================================================================
CREATE OR REPLACE FUNCTION start_game_session(
    p_user_id BIGINT,
    p_mac_address VARCHAR,
    p_agent_type VARCHAR,
    p_session_id VARCHAR,
    p_free_limit INT DEFAULT 20,
    p_stale_minutes INT DEFAULT 60
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    v_stale_count INT;
    v_active_count INT;
    v_questions_used INT;
    v_extra_purchased INT;
    v_total_allowed INT;
    v_remaining INT;
    v_month_key TEXT;
BEGIN
    -- Step 1: Close stale active sessions for this user (older than p_stale_minutes)
    UPDATE game_session_protection
    SET status = 'abandoned',
        ended_at = NOW(),
        updated_at = NOW()
    WHERE user_id = p_user_id
      AND status = 'active'
      AND started_at < NOW() - (p_stale_minutes || ' minutes')::INTERVAL;
    GET DIAGNOSTICS v_stale_count = ROW_COUNT;

    IF v_stale_count > 0 THEN
        RAISE NOTICE 'Closed % stale game sessions for user %', v_stale_count, p_user_id;
    END IF;

    -- Step 2: Check if an active session already exists for this user + agent_type
    SELECT COUNT(*) INTO v_active_count
    FROM game_session_protection
    WHERE user_id = p_user_id
      AND agent_type = p_agent_type
      AND status = 'active';

    IF v_active_count > 0 THEN
        RETURN json_build_object(
            'allowed', false,
            'reason', 'active_session_exists',
            'session_id', p_session_id
        );
    END IF;

    -- Step 3: Check quota from user_question_quota
    v_month_key := TO_CHAR(NOW(), 'YYYY-MM');

    SELECT COALESCE(questions_used, 0), COALESCE(extra_purchased, 0)
    INTO v_questions_used, v_extra_purchased
    FROM user_question_quota
    WHERE user_id = p_user_id AND month_key = v_month_key;

    -- If no row exists, user hasn't used any questions yet
    IF NOT FOUND THEN
        v_questions_used := 0;
        v_extra_purchased := 0;
    END IF;

    v_total_allowed := p_free_limit + v_extra_purchased;
    v_remaining := v_total_allowed - v_questions_used;

    IF v_remaining <= 0 THEN
        RETURN json_build_object(
            'allowed', false,
            'reason', 'quota_exhausted',
            'session_id', p_session_id,
            'remaining', 0
        );
    END IF;

    -- Step 4: Insert new active session
    INSERT INTO game_session_protection (user_id, mac_address, agent_type, session_id, status, started_at, created_at, updated_at)
    VALUES (p_user_id, p_mac_address, p_agent_type, p_session_id, 'active', NOW(), NOW(), NOW());

    RETURN json_build_object(
        'allowed', true,
        'reason', 'session_started',
        'session_id', p_session_id,
        'remaining', v_remaining
    );
END;
$$;
