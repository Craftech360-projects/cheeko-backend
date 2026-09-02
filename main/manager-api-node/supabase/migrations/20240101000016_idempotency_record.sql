-- Replayed responses for retried writes.
--
-- A dropped multipart response makes the parent app retry an upload it has
-- already delivered. Without a record of the first call, the retry appends a
-- second copy of the recording, or bumps the pack version a second time and
-- sends every toy holding that card off to re-download it for nothing.
--
-- The whole response is stored, not a flag: a replay has to answer with the same
-- card the first call did, or the app adopts a body that never existed.

CREATE TABLE IF NOT EXISTS idempotency_record (
  id            BIGSERIAL PRIMARY KEY,
  -- parent + endpoint + item. Scoping to the parent is what stops a guessed key
  -- from returning someone else's card.
  scope         VARCHAR(255) NOT NULL,
  idem_key      VARCHAR(255) NOT NULL,
  -- 'in_progress' while the first call is still running, 'done' once it answered
  status        VARCHAR(20)  NOT NULL DEFAULT 'in_progress',
  status_code   INTEGER,
  response_body JSONB,
  create_date   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_scope_key
  ON idempotency_record (scope, idem_key);

-- Records expire after 24h; the sweep deletes by age.
CREATE INDEX IF NOT EXISTS idx_idempotency_create_date
  ON idempotency_record (create_date);
