-- Migration: Add status columns to ai_card_time_quota
-- Description: Adds remaining_seconds and status columns for real-time app display
--              Updates RPCs to maintain these columns automatically

-- =============================================
-- 1. Add new columns (safe - no data loss)
-- =============================================
ALTER TABLE ai_card_time_quota
  ADD COLUMN IF NOT EXISTS remaining_seconds INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

COMMENT ON COLUMN ai_card_time_quota.remaining_seconds IS 'Real-time remaining seconds for app display. Auto-updated by RPCs.';
COMMENT ON COLUMN ai_card_time_quota.status IS '"active", "exhausted", or "not_configured"';

-- =============================================
-- 2. Backfill existing rows
-- =============================================
-- Update remaining_seconds and status for all existing rows
-- This joins with rfid_card_mapping to get the time limit
UPDATE ai_card_time_quota q
SET 
  remaining_seconds = GREATEST(0, 
    (COALESCE(cm.monthly_time_limit_secs, 0) + q.extra_purchased) - q.seconds_used
  ),
  status = CASE
    WHEN COALESCE(cm.monthly_time_limit_secs, 0) = 0 AND q.extra_purchased = 0 THEN 'not_configured'
    WHEN q.seconds_used >= COALESCE(cm.monthly_time_limit_secs, 0) + q.extra_purchased THEN 'exhausted'
    ELSE 'active'
  END
FROM rfid_card_mapping cm
WHERE q.rfid_uid = cm.rfid_uid;

-- For cards without a matching rfid_card_mapping entry, mark as not_configured
UPDATE ai_card_time_quota q
SET 
  remaining_seconds = 0,
  status = 'not_configured'
WHERE rfid_uid NOT IN (SELECT rfid_uid FROM rfid_card_mapping);

-- =============================================
-- 3. Update consume_ai_card_time RPC to maintain remaining_seconds and status
-- =============================================
CREATE OR REPLACE FUNCTION consume_ai_card_time(
  p_rfid_uid VARCHAR(100),
  p_month_key VARCHAR(7),
  p_seconds INTEGER,
  p_time_limit INTEGER
)
RETURNS TABLE(
  out_seconds_used INTEGER,
  out_extra_purchased INTEGER,
  out_remaining INTEGER,
  out_is_exhausted BOOLEAN,
  out_month_key VARCHAR(7),
  out_remaining_seconds INTEGER,
  out_status VARCHAR(20)
)
LANGUAGE plpgsql AS $$
DECLARE
  v_seconds_used INTEGER;
  v_extra_purchased INTEGER;
  v_total_allowed INTEGER;
  v_remaining INTEGER;
  v_remaining_secs INTEGER;
  v_status VARCHAR(20);
BEGIN
  INSERT INTO ai_card_time_quota (rfid_uid, month_key, seconds_used, extra_purchased, remaining_seconds, status)
  VALUES (p_rfid_uid, p_month_key, p_seconds, 0, 0, 'active')
  ON CONFLICT (rfid_uid, month_key)
  DO UPDATE SET
    seconds_used = ai_card_time_quota.seconds_used + p_seconds,
    updated_at = CURRENT_TIMESTAMP
  RETURNING
    ai_card_time_quota.seconds_used,
    ai_card_time_quota.extra_purchased
  INTO v_seconds_used, v_extra_purchased;

  IF p_time_limit = -1 THEN
    -- Unlimited
    RETURN QUERY SELECT 
      v_seconds_used, v_extra_purchased, -1, FALSE, p_month_key,
      -1, 'active';
    RETURN;
  END IF;

  v_total_allowed := p_time_limit + v_extra_purchased;
  v_remaining := GREATEST(0, v_total_allowed - v_seconds_used);
  v_remaining_secs := v_remaining;
  v_status := CASE
    WHEN p_time_limit = 0 AND v_extra_purchased = 0 THEN 'not_configured'
    WHEN v_remaining <= 0 THEN 'exhausted'
    ELSE 'active'
  END;

  -- Update the status columns
  UPDATE ai_card_time_quota
  SET remaining_seconds = v_remaining_secs,
      status = v_status
  WHERE rfid_uid = p_rfid_uid AND month_key = p_month_key;

  RETURN QUERY SELECT
    v_seconds_used,
    v_extra_purchased,
    v_remaining,
    (v_remaining <= 0),
    p_month_key,
    v_remaining_secs,
    v_status;
END;
$$;

-- =============================================
-- 4. Update grant_ai_card_extra_time RPC to maintain remaining_seconds and status
-- =============================================
CREATE OR REPLACE FUNCTION grant_ai_card_extra_time(
  p_rfid_uid VARCHAR(100),
  p_month_key VARCHAR(7),
  p_amount INTEGER,
  p_time_limit INTEGER
)
RETURNS TABLE(
  out_seconds_used INTEGER,
  out_extra_purchased INTEGER,
  out_remaining INTEGER,
  out_is_exhausted BOOLEAN,
  out_month_key VARCHAR(7),
  out_remaining_seconds INTEGER,
  out_status VARCHAR(20)
)
LANGUAGE plpgsql AS $$
DECLARE
  v_seconds_used INTEGER;
  v_extra_purchased INTEGER;
  v_total_allowed INTEGER;
  v_remaining INTEGER;
  v_remaining_secs INTEGER;
  v_status VARCHAR(20);
BEGIN
  INSERT INTO ai_card_time_quota (rfid_uid, month_key, seconds_used, extra_purchased, remaining_seconds, status)
  VALUES (p_rfid_uid, p_month_key, 0, p_amount, 0, 'active')
  ON CONFLICT (rfid_uid, month_key)
  DO UPDATE SET
    extra_purchased = ai_card_time_quota.extra_purchased + p_amount,
    updated_at = CURRENT_TIMESTAMP
  RETURNING
    ai_card_time_quota.seconds_used,
    ai_card_time_quota.extra_purchased
  INTO v_seconds_used, v_extra_purchased;

  IF p_time_limit = -1 THEN
    RETURN QUERY SELECT 
      v_seconds_used, v_extra_purchased, -1, FALSE, p_month_key,
      -1, 'active';
    RETURN;
  END IF;

  v_total_allowed := p_time_limit + v_extra_purchased;
  v_remaining := GREATEST(0, v_total_allowed - v_seconds_used);
  v_remaining_secs := v_remaining;
  v_status := CASE
    WHEN p_time_limit = 0 AND v_extra_purchased = 0 THEN 'not_configured'
    WHEN v_remaining <= 0 THEN 'exhausted'
    ELSE 'active'
  END;

  -- Update the status columns
  UPDATE ai_card_time_quota
  SET remaining_seconds = v_remaining_secs,
      status = v_status
  WHERE rfid_uid = p_rfid_uid AND month_key = p_month_key;

  RETURN QUERY SELECT
    v_seconds_used,
    v_extra_purchased,
    v_remaining,
    (v_remaining <= 0),
    p_month_key,
    v_remaining_secs,
    v_status;
END;
$$;

-- =============================================
-- Down Migration (rollback):
-- ALTER TABLE ai_card_time_quota DROP COLUMN IF EXISTS remaining_seconds;
-- ALTER TABLE ai_card_time_quota DROP COLUMN IF EXISTS status;
-- =============================================
