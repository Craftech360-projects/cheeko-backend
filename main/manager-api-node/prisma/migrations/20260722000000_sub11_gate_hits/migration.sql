-- SUB-11: refused-verdict ledger for the admin "gate hits by reason" metric.
CREATE TABLE IF NOT EXISTS "subscription_gate_hits" (
  "id"          BIGSERIAL PRIMARY KEY,
  "mac_address" VARCHAR(50) NOT NULL,
  "reason"      TEXT NOT NULL,
  "flow"        TEXT NOT NULL DEFAULT 'voice',
  "created_at"  TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_subscription_gate_hits_created"
  ON "subscription_gate_hits" ("created_at");
