-- The attempt log (ADR-0009, decision 3).
--
-- Ships BEFORE the mastery rule, not alongside it. Once a revealed answer stops
-- clearing a question, every mis-scored answer costs a child a whole day. Without
-- this table the first signal that mastery is hurting a child is a parent
-- complaint, with no data on which questions stall, how many tries they take, or
-- how often speech recognition was the real culprit. Log first, then enforce.
--
-- Non-authoritative by design: nothing that gates progression reads it, so a
-- failed insert costs a measurement rather than a child's progress. That is also
-- why there is no foreign key and why one table serves both banks — an orphan
-- row here is harmless in a way an orphan answer row would not be.
CREATE TABLE IF NOT EXISTS question_attempt (
  id          BIGSERIAL PRIMARY KEY,
  device_mac  VARCHAR(20) NOT NULL,
  kid_id      BIGINT,
  bank        VARCHAR(10) NOT NULL,
  question_id BIGINT      NOT NULL,
  attempt_no  INTEGER     NOT NULL,
  verdict     VARCHAR(10) NOT NULL,
  transcript  TEXT,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reads are "every attempt at this question by this device", in order.
CREATE INDEX IF NOT EXISTS idx_question_attempt_bank_question_device
  ON question_attempt (bank, question_id, device_mac);
-- And "this child's attempts over time", for the per-child diagnostics the
-- mastery rule will need.
CREATE INDEX IF NOT EXISTS idx_question_attempt_kid_time
  ON question_attempt (kid_id, answered_at);
