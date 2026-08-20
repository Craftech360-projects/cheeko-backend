-- Character progress in the DB for EVERY character, not just the scored banks.
--
-- Unscored characters (Tikku, Masti, Tara, Nani, Mitthu, Cheeko, Chanda) track
-- progress only in their per-turn MEMO line, which lives in memory/state/ and is
-- pruned after 48h — Tikku's earned ladder level was forgotten if a child
-- skipped two days, and nothing was queryable for the parent app. Same reason
-- the Wonder Question got a table (ADR-0006: durable memory does not expire).
--
-- Two tables, JSONB payloads parsed from the MEMO's key=value fields:
--   kid_character_state  — current state, upserted; the worker restores it into
--                          Saved State each session AFTER the 48h prune.
--   kid_session_progress — append-only, one row per (session, memo type); the
--                          parent-app / analytics feed (parent_summary etc.).
--
-- Attribution follows the child (kid_id) like the answer log; rows written
-- while a device is Unlinked carry kid_id NULL + device_mac, matching the quiz
-- fallback pattern.

-- CreateTable
CREATE TABLE IF NOT EXISTS "kid_character_state" (
    "id" BIGSERIAL NOT NULL,
    "kid_id" BIGINT,
    "device_mac" VARCHAR(20) NOT NULL,
    "state_type" VARCHAR(50) NOT NULL,
    "character" VARCHAR(100),
    "memo" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kid_character_state_pkey" PRIMARY KEY ("id")
);

-- One current state per (child, type); device rows cover the unlinked case.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_kid_character_state_kid_type"
  ON "kid_character_state"("kid_id", "state_type") WHERE "kid_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_kid_character_state_mac_type"
  ON "kid_character_state"("device_mac", "state_type") WHERE "kid_id" IS NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "kid_session_progress" (
    "id" BIGSERIAL NOT NULL,
    "kid_id" BIGINT,
    "device_mac" VARCHAR(20) NOT NULL,
    "character" VARCHAR(100),
    "state_type" VARCHAR(50) NOT NULL,
    "session_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "memo" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kid_session_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_kid_session_progress_kid_time" ON "kid_session_progress"("kid_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_kid_session_progress_mac_time" ON "kid_session_progress"("device_mac", "created_at");
CREATE INDEX IF NOT EXISTS "idx_kid_session_progress_type_date" ON "kid_session_progress"("state_type", "session_date");
