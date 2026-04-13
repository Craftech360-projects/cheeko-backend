-- Migration: Create AI Card Time Quota System
-- Description: Adds per-card monthly time tracking with atomic RPC consumption
--              and recharge capabilities for the prepaid AI Card subscription model.
--              AI cards have independent time buckets keyed by rfid_uid + month_key.
--              Quota is shared across all users/devices that tap the same card.

-- =============================================
-- Step 0: Clean slate - drop any partial state from failed migrations
-- =============================================
DROP FUNCTION IF EXISTS consume_ai_card_time CASCADE;
DROP FUNCTION IF EXISTS grant_ai_card_extra_time CASCADE;
DROP TABLE IF EXISTS ai_card_time_quota CASCADE;

-- Root-cause fix:
-- Some environments have schema drift where sys_params.param_code lost its UNIQUE
-- constraint and/or sys_params.id lost its auto-generated default.
-- That breaks ON CONFLICT (param_code) and plain INSERTs later in this migration.
-- Normalize duplicates, restore id auto-generation, then restore uniqueness.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'sys_params' AND column_name = 'param_code'
  ) THEN
    DELETE FROM sys_params a
    USING sys_params b
    WHERE a.id < b.id
      AND a.param_code = b.param_code;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'sys_params'
        AND column_name = 'id'
        AND column_default IS NULL
    ) THEN
      CREATE SEQUENCE IF NOT EXISTS sys_params_id_seq;

      PERFORM setval(
        'sys_params_id_seq',
        COALESCE((SELECT MAX(id) FROM sys_params), 0) + 1,
        false
      );

      ALTER TABLE sys_params
      ALTER COLUMN id SET DEFAULT nextval('sys_params_id_seq');

      ALTER SEQUENCE sys_params_id_seq OWNED BY sys_params.id;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'sys_params'
        AND c.contype = 'u'
        AND pg_get_constraintdef(c.oid) = 'UNIQUE (param_code)'
    ) THEN
      ALTER TABLE sys_params
      ADD CONSTRAINT sys_params_param_code_key UNIQUE (param_code);
    END IF;
  END IF;
END $$;

-- =============================================
-- 1. Add monthly_time_limit_secs to rfid_card_mapping
-- =============================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rfid_card_mapping' AND column_name = 'monthly_time_limit_secs'
  ) THEN
    ALTER TABLE rfid_card_mapping ADD COLUMN monthly_time_limit_secs INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

COMMENT ON COLUMN rfid_card_mapping.monthly_time_limit_secs
  IS 'Monthly time limit in seconds for this AI card. 0 = disabled until configured/recharged.';

-- =============================================
-- 2. ai_card_time_quota - Tracks time usage per card per month
-- =============================================
CREATE TABLE ai_card_time_quota (
  id BIGSERIAL PRIMARY KEY,
  rfid_uid VARCHAR(100) NOT NULL,
  month_key VARCHAR(7) NOT NULL,
  seconds_used INTEGER NOT NULL DEFAULT 0,
  extra_purchased INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(rfid_uid, month_key)
);

-- Additional indexes
CREATE INDEX idx_ai_card_time_quota_rfid ON ai_card_time_quota(rfid_uid);
CREATE INDEX idx_ai_card_time_quota_month_key ON ai_card_time_quota(month_key);

COMMENT ON TABLE ai_card_time_quota IS 'Tracks session time per AI card (RFID UID) per month.';

-- =============================================
-- 3. RPC: consume_ai_card_time - Atomic time consumption
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
  out_month_key VARCHAR(7)
)
LANGUAGE plpgsql AS $$
DECLARE
  v_seconds_used INTEGER;
  v_extra_purchased INTEGER;
  v_total_allowed INTEGER;
  v_remaining INTEGER;
BEGIN
  INSERT INTO ai_card_time_quota (rfid_uid, month_key, seconds_used, extra_purchased)
  VALUES (p_rfid_uid, p_month_key, p_seconds, 0)
  ON CONFLICT (rfid_uid, month_key)
  DO UPDATE SET
    seconds_used = ai_card_time_quota.seconds_used + p_seconds,
    updated_at = CURRENT_TIMESTAMP
  RETURNING
    ai_card_time_quota.seconds_used,
    ai_card_time_quota.extra_purchased
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

COMMENT ON FUNCTION consume_ai_card_time IS 'Atomically consumes session seconds for a card/month.';

-- =============================================
-- 4. RPC: grant_ai_card_extra_time - Atomic grant of extra seconds
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
  out_month_key VARCHAR(7)
)
LANGUAGE plpgsql AS $$
DECLARE
  v_seconds_used INTEGER;
  v_extra_purchased INTEGER;
  v_total_allowed INTEGER;
  v_remaining INTEGER;
BEGIN
  INSERT INTO ai_card_time_quota (rfid_uid, month_key, seconds_used, extra_purchased)
  VALUES (p_rfid_uid, p_month_key, 0, p_amount)
  ON CONFLICT (rfid_uid, month_key)
  DO UPDATE SET
    extra_purchased = ai_card_time_quota.extra_purchased + p_amount,
    updated_at = CURRENT_TIMESTAMP
  RETURNING
    ai_card_time_quota.seconds_used,
    ai_card_time_quota.extra_purchased
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

COMMENT ON FUNCTION grant_ai_card_extra_time IS 'Atomically grants extra seconds for a card/month.';

-- =============================================
-- 5. Seed: Set default 50-minute (3000s) limit for existing AI cards
-- =============================================
UPDATE rfid_card_mapping
SET monthly_time_limit_secs = 3000
WHERE card_type = 'ai' AND monthly_time_limit_secs = 0;

-- =============================================
-- 6. Seed: Default quota fail mode sys_param
-- =============================================
INSERT INTO sys_params (param_code, param_value, value_type, param_type, remark)
VALUES ('ai_card_quota_fail_mode', 'open', 'string', 1, 'Fail-open mode for AI card quota when API unreachable')
ON CONFLICT (param_code) DO NOTHING;

-- =============================================
-- Down Migration (rollback):
-- DROP FUNCTION IF EXISTS consume_ai_card_time CASCADE;
-- DROP FUNCTION IF EXISTS grant_ai_card_extra_time CASCADE;
-- DROP TABLE IF EXISTS ai_card_time_quota CASCADE;
-- ALTER TABLE rfid_card_mapping DROP COLUMN IF EXISTS monthly_time_limit_secs;
-- =============================================
