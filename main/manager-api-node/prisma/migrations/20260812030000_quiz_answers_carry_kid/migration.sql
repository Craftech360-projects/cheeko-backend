-- Quiz and riddle progress belongs to the Child, not the toy.
--
-- Cleared and Current Level are derived from these rows on every call, so with
-- device_mac as the only key a child who changed toys restarted at Level 1 and
-- a sibling inheriting a toy resumed at the older child's level.
--
-- device_mac stays, written on every row: it is the audit trail of which toy
-- asked, and the fallback for a device with no child paired yet. Reads on that
-- fallback path must also require kid_id IS NULL, or a toy handed to a sibling
-- before the parent picks a child would read the previous child's whole log.
ALTER TABLE quiz_question_answer   ADD COLUMN IF NOT EXISTS kid_id BIGINT;
ALTER TABLE riddle_question_answer ADD COLUMN IF NOT EXISTS kid_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_quiz_answer_kid_time
  ON quiz_question_answer (kid_id, answered_at);
CREATE INDEX IF NOT EXISTS idx_riddle_answer_kid_time
  ON riddle_question_answer (kid_id, answered_at);

-- Attribute existing rows to whichever child the device is paired to now. A
-- survey on 2026-08-12 found no device whose answer log predates its current
-- child, so on this data the backfill is lossless. Re-check before running it
-- anywhere that survey has not been repeated.
UPDATE quiz_question_answer a
SET kid_id = d.kid_id
FROM ai_device d
WHERE lower(d.mac_address) = lower(a.device_mac)
  AND d.kid_id IS NOT NULL
  AND a.kid_id IS NULL;

UPDATE riddle_question_answer a
SET kid_id = d.kid_id
FROM ai_device d
WHERE lower(d.mac_address) = lower(a.device_mac)
  AND d.kid_id IS NOT NULL
  AND a.kid_id IS NULL;
