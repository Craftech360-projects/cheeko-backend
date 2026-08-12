-- Which Child was paired to a Device, and when.
--
-- Nothing reads this yet. It exists because there is no record anywhere that a
-- toy changed hands, so once one does, that device's MAC-keyed history (imagine
-- gallery, analytics rollups) can never be split between the two children --
-- there is no other attribution signal. A survey of this database on 2026-08-12
-- found no device has changed hands yet, which is exactly why adding it now is
-- cheap: there is no backlog to reconstruct.
CREATE TABLE IF NOT EXISTS device_kid_assignment (
  id          BIGSERIAL PRIMARY KEY,
  mac_address VARCHAR(20)  NOT NULL,
  kid_id      BIGINT       NOT NULL,
  assigned_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_device_kid_assignment_mac
  ON device_kid_assignment (mac_address, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_kid_assignment_kid
  ON device_kid_assignment (kid_id, assigned_at DESC);

-- Open a row for every device already paired. assigned_at is the device's
-- create_date, which is a lower bound rather than the true pairing moment --
-- that was never recorded. A lower bound is what splitting historical rows
-- needs: anything before the device existed belongs to nobody.
INSERT INTO device_kid_assignment (mac_address, kid_id, assigned_at)
SELECT d.mac_address, d.kid_id, COALESCE(d.create_date, now())
FROM ai_device d
WHERE d.kid_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM device_kid_assignment a
    WHERE a.mac_address = d.mac_address AND a.ended_at IS NULL
  );
