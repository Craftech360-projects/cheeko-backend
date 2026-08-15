-- Chat history belongs to the Child.
--
-- voice_sessions.kid_id and its index have existed since the table was created,
-- but only one of the two upsert paths ever populated it: a survey on 2026-08-12
-- found 451 sessions with it null. So the column was declared, indexed, and
-- unusable.
--
-- Messages deliberately gain nothing. A message belongs to its session and the
-- session belongs to the child; giving the message its own child column would be
-- a second copy of the same fact, free to drift.
UPDATE voice_sessions v
SET kid_id = d.kid_id
FROM ai_device d
WHERE lower(d.mac_address) = lower(v.mac_address)
  AND d.kid_id IS NOT NULL
  AND v.kid_id IS NULL;
