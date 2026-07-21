-- Trial reminder idempotency (SUB-2 criterion 5).
-- Nullable int: no table rewrite, no backfill. NULL = no reminder sent yet.
-- The cron claims a day with a conditional UPDATE, so a restart or a second
-- instance cannot double-push a parent.
ALTER TABLE "device_subscriptions"
  ADD COLUMN IF NOT EXISTS "last_reminder_day" INTEGER;
