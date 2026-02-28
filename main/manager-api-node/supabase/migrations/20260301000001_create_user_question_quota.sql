-- Migration: Create User Question Quota Table
-- Description: Per-user monthly question quota for subscription-like limits

-- =============================================
-- user_question_quota - Tracks questions used per user per month
-- =============================================
CREATE TABLE IF NOT EXISTS user_question_quota (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
    month_key VARCHAR(7) NOT NULL,        -- 'YYYY-MM' e.g. '2026-03'
    questions_used INTEGER NOT NULL DEFAULT 0,
    extra_purchased INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, month_key)
);

-- Indexes for performance
CREATE INDEX idx_user_question_quota_user_id ON user_question_quota(user_id);
CREATE INDEX idx_user_question_quota_month_key ON user_question_quota(month_key);

-- Comments for documentation
COMMENT ON TABLE user_question_quota IS 'Tracks per-user monthly question usage for quota enforcement';
COMMENT ON COLUMN user_question_quota.user_id IS 'References sys_user.id - the device owner';
COMMENT ON COLUMN user_question_quota.month_key IS 'YYYY-MM format for natural monthly reset without cron jobs';
COMMENT ON COLUMN user_question_quota.questions_used IS 'Number of questions consumed this month';
COMMENT ON COLUMN user_question_quota.extra_purchased IS 'Additional questions granted by admin for this month';

-- Seed the configurable free monthly limit into sys_params
INSERT INTO sys_params (param_code, param_value, value_type, param_type, remark)
VALUES ('free_monthly_quota', '20', 'number', 1, 'Free questions per user per month')
ON CONFLICT (param_code) DO NOTHING;
