-- Parent Rules (ADR-0004): per-child custom instructions, subordinate to the
-- Governing Prompt. VARCHAR(500) enforces the length cap at the DB level.
ALTER TABLE "kid_profile" ADD COLUMN "parent_rule" VARCHAR(500);
