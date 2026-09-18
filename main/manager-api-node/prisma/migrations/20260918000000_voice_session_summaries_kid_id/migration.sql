-- A session summary is what the child said, so it belongs to the child.
--
-- Until now the row was keyed by MAC only: finding or deleting one child's
-- summaries meant joining through voice_sessions, and a hand-me-down toy mixed
-- two children under one MAC. kid_id makes it one indexed query, and ON DELETE
-- CASCADE means deleting the child deletes their summaries.
--
-- Rows with no kid (unpaired devices) keep kid_id NULL; the MAC-scoped purge on
-- device unbind still covers those.

ALTER TABLE "voice_session_summaries" ADD COLUMN "kid_id" BIGINT;

-- Backfill from the session. voice_sessions.kid_id is itself FK'd to kid_profile,
-- so every value copied here already satisfies the constraint added below.
UPDATE "voice_session_summaries" s
SET "kid_id" = v."kid_id"
FROM "voice_sessions" v
WHERE v."session_id" = s."session_id"
  AND v."kid_id" IS NOT NULL;

ALTER TABLE "voice_session_summaries"
  ADD CONSTRAINT "voice_session_summaries_kid_id_fkey"
  FOREIGN KEY ("kid_id") REFERENCES "kid_profile"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE INDEX "idx_voice_session_summaries_kid_updated"
  ON "voice_session_summaries" ("kid_id", "updated_at" DESC);
