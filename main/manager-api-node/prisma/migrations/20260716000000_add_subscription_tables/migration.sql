-- prisma/migrations/20260716000000_add_subscription_tables/migration.sql
-- SUB-1 walking skeleton: subscription spine + plan catalog.

-- Plan catalog. Limits live in the DB so they are tunable without a deploy
-- (spec §1). NULL image limit = unlimited.
CREATE TABLE IF NOT EXISTS "subscription_plans" (
    "id"                     BIGSERIAL PRIMARY KEY,
    "tier"                   TEXT NOT NULL,
    "name"                   TEXT NOT NULL,
    "price_inr"              INTEGER NOT NULL,
    "monthly_question_limit" INTEGER NOT NULL,
    "daily_question_limit"   INTEGER NOT NULL,
    "daily_minutes_limit"    INTEGER NOT NULL,
    "monthly_image_limit"    INTEGER,
    "daily_image_limit"      INTEGER,
    "features"               JSONB,
    "razorpay_plan_id"       TEXT,
    "is_active"              BOOLEAN NOT NULL DEFAULT true,
    "created_at"             TIMESTAMPTZ(6) DEFAULT now(),
    "updated_at"             TIMESTAMPTZ(6) DEFAULT now(),
    CONSTRAINT "subscription_plans_tier_key" UNIQUE ("tier")
);

CREATE INDEX IF NOT EXISTS "idx_subscription_plans_active" ON "subscription_plans" ("is_active");

-- Subscription spine. Keyed by MAC and deliberately NOT FK'd to ai_device:
-- unbind deletes the ai_device row (device.service.js:184) and subscription
-- state — trial_used above all — must survive that.
CREATE TABLE IF NOT EXISTS "device_subscriptions" (
    "id"                       BIGSERIAL PRIMARY KEY,
    "mac_address"              VARCHAR(50) NOT NULL,
    "status"                   TEXT NOT NULL,
    "plan_id"                  BIGINT REFERENCES "subscription_plans" ("id") ON DELETE SET NULL,
    "user_id"                  BIGINT,
    "trial_started_at"         TIMESTAMPTZ(6),
    "trial_ends_at"            TIMESTAMPTZ(6),
    "trial_used"               BOOLEAN NOT NULL DEFAULT false,
    "billing_cycle"            TEXT NOT NULL DEFAULT 'monthly',
    "current_period_start"     TIMESTAMPTZ(6),
    "current_period_end"       TIMESTAMPTZ(6),
    "grace_until"              TIMESTAMPTZ(6),
    "cancel_at_period_end"     BOOLEAN NOT NULL DEFAULT false,
    "razorpay_customer_id"     TEXT,
    "razorpay_subscription_id" TEXT,
    "created_at"               TIMESTAMPTZ(6) DEFAULT now(),
    "updated_at"               TIMESTAMPTZ(6) DEFAULT now(),
    CONSTRAINT "device_subscriptions_mac_address_key" UNIQUE ("mac_address"),
    CONSTRAINT "device_subscriptions_status_check" CHECK (
        "status" IN ('trial', 'active', 'grace', 'lapsed', 'cancelled')
    )
);

CREATE INDEX IF NOT EXISTS "idx_device_subscriptions_status" ON "device_subscriptions" ("status");
CREATE INDEX IF NOT EXISTS "idx_device_subscriptions_razorpay_sub" ON "device_subscriptions" ("razorpay_subscription_id");

-- Webhook ledger. razorpay_event_id UNIQUE is the idempotency key — Razorpay
-- delivers at-least-once and unordered.
CREATE TABLE IF NOT EXISTS "subscription_events" (
    "id"                       BIGSERIAL PRIMARY KEY,
    "razorpay_event_id"        TEXT NOT NULL,
    "event_type"               TEXT NOT NULL,
    "mac_address"              VARCHAR(50),
    "razorpay_subscription_id" TEXT,
    "payload"                  JSONB,
    "processed_at"             TIMESTAMPTZ(6),
    "created_at"               TIMESTAMPTZ(6) DEFAULT now(),
    CONSTRAINT "subscription_events_razorpay_event_id_key" UNIQUE ("razorpay_event_id")
);

CREATE INDEX IF NOT EXISTS "idx_subscription_events_mac" ON "subscription_events" ("mac_address");

-- Audit trail for admin overrides (comp/extend, trial re-grant, plan override).
CREATE TABLE IF NOT EXISTS "subscription_admin_audit" (
    "id"           BIGSERIAL PRIMARY KEY,
    "admin_user"   TEXT NOT NULL,
    "action"       TEXT NOT NULL,
    "mac_address"  VARCHAR(50),
    "reason"       TEXT,
    "before_state" JSONB,
    "after_state"  JSONB,
    "created_at"   TIMESTAMPTZ(6) DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_subscription_admin_audit_mac" ON "subscription_admin_audit" ("mac_address");

-- Plan catalog seed (spec §1). razorpay_plan_id stays NULL until the Razorpay
-- plan objects exist (SUB-6). Daily minute values are the pricing-doc §4b
-- starting points and are expected to be tuned in the DB.
INSERT INTO "subscription_plans" (
    "tier", "name", "price_inr",
    "monthly_question_limit", "daily_question_limit", "daily_minutes_limit",
    "monthly_image_limit", "daily_image_limit", "features"
) VALUES
    ('starter', 'Starter', 199, 100, 15,  8, 150,  15,
     '{"characters": "all"}'),
    ('family',  'Family',  499, 300, 40, 15, NULL, 25,
     '{"characters": "all", "memory": true, "weekly_summary": true}'),
    ('premium', 'Premium', 999, 800, 80, 30, NULL, NULL,
     '{"characters": "all", "memory": true, "weekly_summary": true, "kid_profiles": 2, "deep_insights": true}')
ON CONFLICT ("tier") DO NOTHING;
