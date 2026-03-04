-- Migration: Add atomic RPC functions for quota operations
-- Description: Eliminates race conditions in increment and grant operations
--              by using INSERT...ON CONFLICT (atomic upsert) instead of SELECT+UPDATE
-- NOTE: Output columns use out_ prefix to avoid PostgreSQL ambiguity with parameter names

-- Drop old signatures first (required when changing RETURNS TABLE columns)
DROP FUNCTION IF EXISTS increment_question_quota(BIGINT, VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS grant_extra_quota(BIGINT, VARCHAR, INTEGER, INTEGER);

-- =============================================
-- increment_question_quota - Atomic increment by 1
-- =============================================
CREATE OR REPLACE FUNCTION increment_question_quota(
    p_user_id BIGINT,
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
    INSERT INTO user_question_quota (user_id, month_key, questions_used, extra_purchased)
    VALUES (p_user_id, p_month_key, 1, 0)
    ON CONFLICT (user_id, month_key)
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

COMMENT ON FUNCTION increment_question_quota IS 'Atomically increments question count for a user/month. Uses UPSERT to avoid race conditions and UNIQUE constraint violations.';

-- =============================================
-- grant_extra_quota - Atomic grant of extra questions
-- =============================================
CREATE OR REPLACE FUNCTION grant_extra_quota(
    p_user_id BIGINT,
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
    INSERT INTO user_question_quota (user_id, month_key, questions_used, extra_purchased)
    VALUES (p_user_id, p_month_key, 0, p_amount)
    ON CONFLICT (user_id, month_key)
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

COMMENT ON FUNCTION grant_extra_quota IS 'Atomically grants extra questions for a user/month. Uses UPSERT to avoid race conditions and UNIQUE constraint violations.';
