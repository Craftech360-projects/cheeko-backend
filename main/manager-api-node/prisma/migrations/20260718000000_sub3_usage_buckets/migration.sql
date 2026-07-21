-- SUB-3: bucket enforcement needs two things the schema lacks.

-- Exactly-once guard for the 80%-of-monthly-bucket push. Claimed with a
-- conditional UPDATE (same pattern as last_reminder_day): eligible when NULL
-- or older than the current period anchor, so each new period re-arms it.
ALTER TABLE "device_subscriptions"
  ADD COLUMN IF NOT EXISTS "bucket_alert_sent_at" TIMESTAMPTZ;

-- Imagine images only ever landed in S3 — nothing to SUM against plan image
-- limits. One row per generated image, written from the imagine-upload path.
CREATE TABLE IF NOT EXISTS "device_image_generations" (
  "id" BIGSERIAL PRIMARY KEY,
  "mac_address" VARCHAR(50) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_device_image_generations_mac_created"
  ON "device_image_generations" ("mac_address", "created_at" DESC);
