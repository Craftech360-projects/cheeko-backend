-- Migration: Add time-based quota system
-- Description: Adds user_time_quota table for tracking session duration per device per month.
--              Adds consume_time_quota and grant_extra_time RPCs.
--              Seeds time-based subscription plans.

-- =============================================
-- TABLE: user_time_quota - Tracks time usage per device per month
-- =============================================
CREATE TABLE IF NOT EXISTS user_time_quota (
    id BIGSERIAL PRIMARY KEY,
    mac_address VARCHAR(20) NOT NULL,
    user_id BIGINT REFERENCES sys_user(id) ON DELETE SET NULL,  -- kept for analytics joins
    month_key VARCHAR(7) NOT NULL,                               -- 'YYYY-MM'
    seconds_used INTEGER NOT NULL DEFAULT 0,                     -- total seconds consumed
    extra_purchased INTEGER NOT NULL DEFAULT 0,                  -- admin-granted extra seconds
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(mac_address, month_key)
);

CREATE INDEX idx_time_quota_mac ON user_time_quota(mac_address);
CREATE INDEX idx_time_quota_month_key ON user_time_quota(month_key);

COMMENT ON TABLE user_time_quota IS 'Tracks session time usage per device per month for time-based plans';
COMMENT ON COLUMN user_time_quota.seconds_used IS 'Total session seconds consumed this month';
COMMENT ON COLUMN user_time_quota.extra_purchased IS 'Admin-granted extra seconds';

-- =============================================
-- RPC: consume_time_quota - Atomic time consumption
-- =============================================
CREATE OR REPLACE FUNCTION consume_time_quota(
    p_mac_address VARCHAR(20),
    p_month_key VARCHAR(7),
    p_seconds INTEGER,
    p_time_limit INTEGER
)
RETURNS TABLE(
    out_seconds_used INTEGER,
    out_extra_purchased INTEGER,
    out_remaining INTEGER,
    out_is_exhausted BOOLEAN,
    out_month_key VARCHAR(7)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_seconds_used INTEGER;
    v_extra_purchased INTEGER;
    v_total_allowed INTEGER;
    v_remaining INTEGER;
BEGIN
    INSERT INTO user_time_quota (mac_address, month_key, seconds_used, extra_purchased)
    VALUES (p_mac_address, p_month_key, p_seconds, 0)
    ON CONFLICT (mac_address, month_key)
    DO UPDATE SET
        seconds_used = user_time_quota.seconds_used + p_seconds,
        updated_at = CURRENT_TIMESTAMP
    RETURNING
        user_time_quota.seconds_used,
        user_time_quota.extra_purchased
    INTO v_seconds_used, v_extra_purchased;

    -- time_limit = -1 means unlimited
    IF p_time_limit = -1 THEN
        v_remaining := -1;
        RETURN QUERY SELECT v_seconds_used, v_extra_purchased, v_remaining, FALSE, p_month_key;
        RETURN;
    END IF;

    v_total_allowed := p_time_limit + v_extra_purchased;
    v_remaining := GREATEST(0, v_total_allowed - v_seconds_used);

    RETURN QUERY SELECT
        v_seconds_used,
        v_extra_purchased,
        v_remaining,
        (v_remaining <= 0),
        p_month_key;
END;
$$;

COMMENT ON FUNCTION consume_time_quota IS 'Atomically consumes session seconds for a device/month. Uses UPSERT for race-condition safety.';

-- =============================================
-- RPC: grant_extra_time - Atomic grant of extra seconds
-- =============================================
CREATE OR REPLACE FUNCTION grant_extra_time(
    p_mac_address VARCHAR(20),
    p_month_key VARCHAR(7),
    p_amount INTEGER,
    p_time_limit INTEGER
)
RETURNS TABLE(
    out_seconds_used INTEGER,
    out_extra_purchased INTEGER,
    out_remaining INTEGER,
    out_is_exhausted BOOLEAN,
    out_month_key VARCHAR(7)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_seconds_used INTEGER;
    v_extra_purchased INTEGER;
    v_total_allowed INTEGER;
    v_remaining INTEGER;
BEGIN
    INSERT INTO user_time_quota (mac_address, month_key, seconds_used, extra_purchased)
    VALUES (p_mac_address, p_month_key, 0, p_amount)
    ON CONFLICT (mac_address, month_key)
    DO UPDATE SET
        extra_purchased = user_time_quota.extra_purchased + p_amount,
        updated_at = CURRENT_TIMESTAMP
    RETURNING
        user_time_quota.seconds_used,
        user_time_quota.extra_purchased
    INTO v_seconds_used, v_extra_purchased;

    IF p_time_limit = -1 THEN
        v_remaining := -1;
        RETURN QUERY SELECT v_seconds_used, v_extra_purchased, v_remaining, FALSE, p_month_key;
        RETURN;
    END IF;

    v_total_allowed := p_time_limit + v_extra_purchased;
    v_remaining := GREATEST(0, v_total_allowed - v_seconds_used);

    RETURN QUERY SELECT
        v_seconds_used,
        v_extra_purchased,
        v_remaining,
        (v_remaining <= 0),
        p_month_key;
END;
$$;

COMMENT ON FUNCTION grant_extra_time IS 'Atomically grants extra seconds for a device/month.';

-- =============================================
-- Seed time-based subscription plans
-- =============================================
INSERT INTO subscription_plan (plan_code, plan_name, quota_type, question_limit, token_limit, time_limit_secs, audio_token_weight, text_token_weight, price_inr, price_usd, billing_period)
VALUES
    ('free_time',   'Free (Time)',       'time', 0, 0, 1800,   1.0, 1.0, 0,     0,    'free'),
    ('basic_time',  'Basic Time Plan',   'time', 0, 0, 7200,   1.0, 1.0, 29900, 499,  'monthly'),
    ('pro_time',    'Pro Time Plan',     'time', 0, 0, 21600,  1.0, 1.0, 59900, 999,  'monthly')
ON CONFLICT (plan_code) DO NOTHING;

-- =============================================
-- Seed default quota system parameters
-- =============================================
INSERT INTO sys_params (param_code, param_value, value_type, remark)
VALUES
    ('default_quota_type', 'question', 'string', 'Default quota system for free users (question/token/time)'),
    ('default_free_token_limit', '10000', 'number', 'Free monthly token limit per device'),
    ('default_free_time_limit', '1800', 'number', 'Free monthly time limit in seconds per device (1800 = 30 minutes)')
ON CONFLICT (param_code) DO NOTHING;
