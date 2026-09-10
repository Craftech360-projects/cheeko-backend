-- Device warranty: when a toy's 6-month warranty started and when it ends.
--
-- The warranty starts the first time a parent activates the toy with its
-- 6-digit code, and must not restart when the toy is unbound and bound again.
-- So it cannot live on ai_device: a hard unbind or an account deletion removes
-- that row, and the next bind creates a fresh one. This table is keyed by MAC
-- with no foreign key, so nothing that happens to the device, its owner or
-- their account touches it.
--
-- The unique MAC is what makes it "first activation only": the bind inserts
-- with ON CONFLICT DO NOTHING, so every later activation - two racing ones
-- included - is a no-op.
--
-- activated_at is the moment of that first activation and is never edited; it
-- stays NULL for a record an admin added by hand. warranty_start/warranty_end
-- begin as activated_at and activated_at + 6 months, and are what an admin
-- corrects or extends. first_user_id has no foreign key on purpose: the record
-- has to outlive the account.
--
-- No backfill: toys bound before this shipped get a record at their next
-- 6-digit activation, or when an admin adds one from the Devices page.
--
-- SAFE ON A LIVE DATABASE: a new table only; nothing existing is altered.

CREATE TABLE IF NOT EXISTS device_warranty (
  id             BIGSERIAL PRIMARY KEY,
  mac_address    VARCHAR(20)  NOT NULL,
  activated_at   TIMESTAMPTZ,
  warranty_start TIMESTAMPTZ  NOT NULL,
  warranty_end   TIMESTAMPTZ  NOT NULL,
  first_user_id  BIGINT,
  note           TEXT,
  updated_by     BIGINT,
  update_date    TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_device_warranty_mac
  ON device_warranty (mac_address);
