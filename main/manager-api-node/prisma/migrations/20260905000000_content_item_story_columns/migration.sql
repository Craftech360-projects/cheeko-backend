-- content_item.story_number and story_title exist in schema.prisma but were
-- never added to any database by a migration. Prisma's generated client lists
-- every model column in its UPDATE ... RETURNING, so their absence broke
-- *every* write to content_item, not just ones that set them:
--
--   Invalid `tx.content_item.update()` invocation
--   The column `(not available)` does not exist in the current database
--
-- The message names no column because the failure is in the returning clause,
-- not in a bound parameter. Custom-card edits were the first code path to
-- update this table, which is why long-standing drift only surfaced now.
--
-- IF NOT EXISTS because this was already applied by hand to the dev database
-- (DB1) on 2026-09-02 to unblock testing; this makes that box and every other
-- one converge on the same state.
--
-- Nullable and with no backfill: nothing populates these yet. The point is to
-- make the database match the model so writes stop failing — if a feature
-- later needs real story numbers, that is its own migration.

ALTER TABLE content_item ADD COLUMN IF NOT EXISTS story_number integer;
ALTER TABLE content_item ADD COLUMN IF NOT EXISTS story_title  varchar(255);
