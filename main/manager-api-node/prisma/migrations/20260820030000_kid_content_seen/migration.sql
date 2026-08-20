-- What content a child has already been given, per bank.
--
-- The unscored characters have no answer log, so "already heard" lived only in
-- the character's MEMO line (jokes_told=, wonders_answered=, ...). Two things
-- were wrong with that as the ONLY record:
--
--   1. kid_character_state holds one row per state_type, so each session
--      overwrites the last. The list survived only as far as the model chose to
--      copy it forward, inside a line the prompt caps in length - it truncates
--      silently after a few sessions.
--   2. The serve endpoint rotated by a (date, device) hash with no idea what the
--      child had heard, so it handed back already-told items and asked the model
--      to filter them itself. A repeat needed only one lapse of attention.
--
-- This is the durable, unbounded-history version of what those MEMO fields were
-- reaching for, and it is what lets the server EXCLUDE rather than hope. It is
-- the same shape as the story/question ledgers the scored characters already
-- had (picoclaw quiz_state.go updateLedgers), moved server-side because these
-- characters keep no local ledger at all.

CREATE TABLE IF NOT EXISTS "kid_content_seen" (
    "id" BIGSERIAL NOT NULL,
    "kid_id" BIGINT,
    "device_mac" VARCHAR(20) NOT NULL,
    "bank" VARCHAR(20) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kid_content_seen_pkey" PRIMARY KEY ("id")
);

-- One row per (child, bank, item). Partial uniques mirror kid_character_state:
-- a linked device is scoped by child, an unlinked one by its own MAC.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_kid_content_seen_kid"
  ON "kid_content_seen"("kid_id", "bank", "code") WHERE "kid_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_kid_content_seen_mac"
  ON "kid_content_seen"("device_mac", "bank", "code") WHERE "kid_id" IS NULL;

-- The lookup the serve endpoint makes on every session.
CREATE INDEX IF NOT EXISTS "idx_kid_content_seen_kid_bank" ON "kid_content_seen"("kid_id", "bank");
CREATE INDEX IF NOT EXISTS "idx_kid_content_seen_mac_bank" ON "kid_content_seen"("device_mac", "bank");
-- Age-pruning reads this; see contentbank.service RECYCLE_AFTER_DAYS.
CREATE INDEX IF NOT EXISTS "idx_kid_content_seen_at" ON "kid_content_seen"("seen_at");
