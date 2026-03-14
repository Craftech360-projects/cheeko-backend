-- Migration: Create Subscription Plans, User Subscriptions, and Token Quota tables
-- Description: Adds token-based quota system alongside existing question-based system.
--              subscription_plan defines plan tiers with quota_type (question/token/time).
--              user_subscription links users to plans.
--              user_token_quota tracks weighted token usage per user per month.

-- =============================================
-- subscription_plan - Defines available subscription tiers
-- =============================================
CREATE TABLE IF NOT EXISTS subscription_plan (
    id BIGSERIAL PRIMARY KEY,
    plan_code VARCHAR(50) NOT NULL UNIQUE,
    plan_name VARCHAR(100) NOT NULL,
    quota_type VARCHAR(20) NOT NULL DEFAULT 'question',  -- 'question', 'token', 'time'
    question_limit INTEGER DEFAULT 20,                    -- for question-based plans
    token_limit INTEGER DEFAULT 50000,                    -- for token-based plans
    time_limit_secs INTEGER DEFAULT 3600,                 -- for time-based plans
    audio_token_weight NUMERIC(4,2) DEFAULT 1.5,          -- audio tokens cost 1.5x
    text_token_weight NUMERIC(4,2) DEFAULT 1.0,           -- text tokens cost 1.0x
    price_inr INTEGER DEFAULT 0,                          -- price in paise (29900 = ₹299)
    price_usd INTEGER DEFAULT 0,                          -- price in cents (999 = $9.99)
    billing_period VARCHAR(20) DEFAULT 'monthly',         -- 'monthly', 'yearly', 'free'
    is_active BOOLEAN DEFAULT TRUE,
    features JSONB DEFAULT '{}',                          -- additional plan features
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE subscription_plan IS 'Available subscription tiers with quota type and limits';

-- =============================================
-- user_subscription - Links users to their active plan
-- =============================================
CREATE TABLE IF NOT EXISTS user_subscription (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
    plan_id BIGINT NOT NULL REFERENCES subscription_plan(id),
    status VARCHAR(20) NOT NULL DEFAULT 'active',         -- 'active', 'cancelled', 'grace', 'expired'
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,                  -- NULL = never expires (free plan)
    grace_ends_at TIMESTAMP WITH TIME ZONE,               -- 3 days after expiry
    auto_renew BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Only one active/grace subscription per user
CREATE UNIQUE INDEX idx_user_subscription_active
    ON user_subscription(user_id)
    WHERE status IN ('active', 'grace');

CREATE INDEX idx_user_subscription_user_id ON user_subscription(user_id);
CREATE INDEX idx_user_subscription_status ON user_subscription(status);

COMMENT ON TABLE user_subscription IS 'Links users to their subscription plan. Only one active subscription per user.';

-- =============================================
-- user_token_quota - Tracks weighted token usage per user per month
-- =============================================
CREATE TABLE IF NOT EXISTS user_token_quota (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
    month_key VARCHAR(7) NOT NULL,                        -- 'YYYY-MM'
    tokens_used INTEGER NOT NULL DEFAULT 0,               -- weighted tokens consumed
    raw_input_tokens INTEGER NOT NULL DEFAULT 0,          -- raw input tokens (for analytics)
    raw_output_tokens INTEGER NOT NULL DEFAULT 0,         -- raw output tokens (for analytics)
    extra_purchased INTEGER NOT NULL DEFAULT 0,           -- admin-granted extra tokens
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, month_key)
);

CREATE INDEX idx_user_token_quota_user_id ON user_token_quota(user_id);
CREATE INDEX idx_user_token_quota_month_key ON user_token_quota(month_key);

COMMENT ON TABLE user_token_quota IS 'Tracks weighted token usage per user per month for token-based plans';
COMMENT ON COLUMN user_token_quota.tokens_used IS 'Weighted tokens: audio*weight + text*weight';
COMMENT ON COLUMN user_token_quota.raw_input_tokens IS 'Unweighted total input tokens for analytics';
COMMENT ON COLUMN user_token_quota.raw_output_tokens IS 'Unweighted total output tokens for analytics';

-- =============================================
-- Seed subscription plans
-- =============================================
INSERT INTO subscription_plan (plan_code, plan_name, quota_type, question_limit, token_limit, time_limit_secs, audio_token_weight, text_token_weight, price_inr, price_usd, billing_period)
VALUES
    ('free_question', 'Free (Questions)',   'question', 20,    0,     0,    1.0, 1.0, 0,     0,   'free'),
    ('free_token',    'Free (Tokens)',      'token',    0,     10000, 0,    1.5, 1.0, 0,     0,   'free'),
    ('basic_token',   'Basic Token Plan',   'token',    0,     50000, 0,    1.5, 1.0, 29900, 499, 'monthly'),
    ('pro_token',     'Pro Token Plan',     'token',    0,     200000,0,    1.5, 1.0, 59900, 999, 'monthly'),
    ('unlimited',     'Unlimited',          'token',    0,     -1,    0,    1.5, 1.0, 99900, 1999,'monthly')
ON CONFLICT (plan_code) DO NOTHING;


-- =============================================
-- RPC: consume_token_quota - Atomic token consumption
-- =============================================
CREATE OR REPLACE FUNCTION consume_token_quota(
    p_user_id BIGINT,
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
    INSERT INTO user_token_quota (user_id, month_key, tokens_used, raw_input_tokens, raw_output_tokens, extra_purchased)
    VALUES (p_user_id, p_month_key, p_weighted_tokens, p_raw_input, p_raw_output, 0)
    ON CONFLICT (user_id, month_key)
    DO UPDATE SET
        tokens_used = user_token_quota.tokens_used + p_weighted_tokens,
        raw_input_tokens = user_token_quota.raw_input_tokens + p_raw_input,
        raw_output_tokens = user_token_quota.raw_output_tokens + p_raw_output,
        updated_at = CURRENT_TIMESTAMP
    RETURNING
        user_token_quota.tokens_used,
        user_token_quota.extra_purchased
    INTO v_tokens_used, v_extra_purchased;

    -- token_limit = -1 means unlimited
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

COMMENT ON FUNCTION consume_token_quota IS 'Atomically consumes weighted tokens for a user/month. Uses UPSERT for race-condition safety.';


-- =============================================
-- RPC: grant_extra_tokens - Atomic grant of extra tokens
-- =============================================
CREATE OR REPLACE FUNCTION grant_extra_tokens(
    p_user_id BIGINT,
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
    INSERT INTO user_token_quota (user_id, month_key, tokens_used, raw_input_tokens, raw_output_tokens, extra_purchased)
    VALUES (p_user_id, p_month_key, 0, 0, 0, p_amount)
    ON CONFLICT (user_id, month_key)
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

COMMENT ON FUNCTION grant_extra_tokens IS 'Atomically grants extra tokens for a user/month.';
